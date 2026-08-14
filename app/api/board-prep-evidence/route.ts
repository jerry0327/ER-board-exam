import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { boardPrepEvidence, boardPrepEvidenceCleanup, boardPrepProfile, disasterCourseCompletion } from "../../../db/schema";
import { normalizeBoardPrepState } from "../../lib/board-prep";
import { BOARD_PREP_ATTACHMENT_MAX_BYTES } from "../../lib/board-prep-attachments";
import { userIdentityFor } from "../user-identity";
import { privateJson } from "../private-response";

export const dynamic = "force-dynamic";

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

async function getEvidenceBucket() {
  const { env } = await import("cloudflare:workers");
  return env.BUCKET;
}

function safeName(value: string) {
  return value.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/gu, "_").slice(0, 180) || "證明文件";
}

function evidenceMeta(row: typeof boardPrepEvidence.$inferSelect) {
  return {
    id: row.id,
    itemId: row.recordKey,
    name: row.filename,
    type: row.contentType,
    size: row.size,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function detectedMime(bytes: Uint8Array) {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  return "";
}

async function recordCanReceiveEvidence(userId: string, recordKey: string) {
  const db = await getDb();
  if (recordKey.startsWith("recognized:")) {
    const courseId = recordKey.slice("recognized:".length);
    const [completion] = await db.select({ courseId: disasterCourseCompletion.courseId }).from(disasterCourseCompletion)
      .where(and(eq(disasterCourseCompletion.userId, userId), eq(disasterCourseCompletion.courseId, courseId), isNull(disasterCourseCompletion.deletedAt))).limit(1);
    return Boolean(completion);
  }
  const [profile] = await db.select({ state: boardPrepProfile.state }).from(boardPrepProfile).where(eq(boardPrepProfile.userId, userId)).limit(1);
  if (!profile) return false;
  const item = normalizeBoardPrepState(JSON.parse(profile.state)).items[recordKey];
  return item?.completed === true || Object.values(item?.occurrences ?? {}).some((occurrence) => occurrence.completed);
}

async function retryEvidenceCleanup(userId: string) {
  const db = await getDb();
  const pending = await db.select().from(boardPrepEvidenceCleanup)
    .where(eq(boardPrepEvidenceCleanup.userId, userId))
    .orderBy(asc(boardPrepEvidenceCleanup.updatedAt))
    .limit(8);
  if (!pending.length) return;

  const bucket = await getEvidenceBucket();
  for (const item of pending) {
    try {
      await bucket.delete(item.objectKey);
      await db.delete(boardPrepEvidenceCleanup).where(and(
        eq(boardPrepEvidenceCleanup.userId, userId),
        eq(boardPrepEvidenceCleanup.objectKey, item.objectKey),
      ));
    } catch {
      await db.update(boardPrepEvidenceCleanup).set({
        attempts: sql`${boardPrepEvidenceCleanup.attempts} + 1`,
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(boardPrepEvidenceCleanup.userId, userId),
        eq(boardPrepEvidenceCleanup.objectKey, item.objectKey),
      )).catch(() => undefined);
    }
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  try {
    const identity = await userIdentityFor(request);
    if (!identity) return privateJson({ error: "請重新整理頁面後再試。", attachments: [] }, { status: 401 });
    const db = await getDb();
    await retryEvidenceCleanup(identity.userId).catch(() => undefined);
    if (!id) {
      const rows = await db.select().from(boardPrepEvidence)
        .where(and(eq(boardPrepEvidence.userId, identity.userId), isNull(boardPrepEvidence.deletedAt)))
        .orderBy(desc(boardPrepEvidence.updatedAt));
      return privateJson({ attachments: rows.map(evidenceMeta) });
    }
    const [row] = await db.select().from(boardPrepEvidence)
      .where(and(eq(boardPrepEvidence.userId, identity.userId), eq(boardPrepEvidence.id, id), isNull(boardPrepEvidence.deletedAt))).limit(1);
    if (!row) return privateJson({ error: "找不到這份證明" }, { status: 404 });
    const bucket = await getEvidenceBucket();
    const object = await bucket.get(row.objectKey);
    if (!object) return privateJson({ error: "找不到這份證明" }, { status: 404 });
    const encoded = encodeURIComponent(row.filename);
    return new Response(object.body, {
      headers: {
        "Content-Type": row.contentType,
        "Content-Length": String(row.size),
        "Content-Disposition": `attachment; filename="document"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-store",
        Vary: "oai-authenticated-user-id",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return privateJson({ error: "證明文件暫時無法載入" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await userIdentityFor(request);
  if (!identity) return Response.json({ error: "請重新整理頁面後再上傳證明。" }, { status: 401 });
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: "請重新選擇檔案" }, { status: 400 }); }
  const file = form.get("file");
  const recordKey = String(form.get("recordKey") ?? "");
  const replaceId = String(form.get("replaceId") ?? "");
  const baseRevision = Number(form.get("baseRevision") ?? 0);
  if (!(file instanceof File) || !/^(?:recognized:sem-course-[a-z0-9]+|[a-z0-9][a-z0-9.-]{1,100})$/u.test(recordKey)) {
    return Response.json({ error: "請重新選擇檔案" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > BOARD_PREP_ATTACHMENT_MAX_BYTES) return Response.json({ error: "檔案上限為 10 MB。" }, { status: 413 });
  const extension = file.name.toLocaleLowerCase().split(".").at(-1) ?? "";
  const expectedMime = MIME_BY_EXTENSION[extension];
  const buffer = await file.arrayBuffer();
  const contentType = detectedMime(new Uint8Array(buffer));
  if (!expectedMime || !contentType || contentType !== expectedMime) return Response.json({ error: "請上傳 PDF、JPG 或 PNG 檔案。" }, { status: 415 });
  let newObjectKey = "";
  let bucket: R2Bucket | null = null;
  let metadataCommitted = false;
  try {
    if (!await recordCanReceiveEvidence(identity.userId, recordKey)) return Response.json({ error: "請先將這筆項目記為完成" }, { status: 409 });
    const db = await getDb();
    const now = new Date().toISOString();
    const id = replaceId || `evidence_${crypto.randomUUID()}`;
    const [old] = replaceId ? await db.select().from(boardPrepEvidence)
      .where(and(eq(boardPrepEvidence.userId, identity.userId), eq(boardPrepEvidence.id, replaceId), isNull(boardPrepEvidence.deletedAt))).limit(1) : [];
    if (replaceId && (!old || old.recordKey !== recordKey || old.revision !== baseRevision)) {
      return Response.json({ error: "內容已有變更，請重新整理後再試。" }, { status: 409 });
    }
    const revision = (old?.revision ?? 0) + 1;
    const digest = bytesToHex(await crypto.subtle.digest("SHA-256", buffer));
    newObjectKey = `${identity.userId}/board-prep/${id}/v${revision}-${crypto.randomUUID()}`;
    bucket = await getEvidenceBucket();
    await bucket.put(newObjectKey, buffer, { httpMetadata: { contentType } });
    const values = {
      userId: identity.userId,
      id,
      recordKey,
      objectKey: newObjectKey,
      filename: safeName(file.name),
      contentType,
      size: file.size,
      sha256: digest,
      revision,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };
    let row: typeof boardPrepEvidence.$inferSelect;
    if (old) {
      const [updated] = await db.update(boardPrepEvidence).set(values)
        .where(and(eq(boardPrepEvidence.userId, identity.userId), eq(boardPrepEvidence.id, id), eq(boardPrepEvidence.revision, baseRevision))).returning();
      if (!updated) throw new Error("revision-conflict");
      row = updated;
    } else {
      [row] = await db.insert(boardPrepEvidence).values(values).returning();
    }
    metadataCommitted = true;
    await retryEvidenceCleanup(identity.userId).catch(() => undefined);
    return Response.json({ attachment: evidenceMeta(row) });
  } catch (error) {
    // Once D1 points at the new key it is the authoritative object and must
    // never be removed by compensation. The trigger-created tombstone owns
    // cleanup of the previous key instead.
    if (!metadataCommitted && newObjectKey && bucket) await bucket.delete(newObjectKey).catch(() => undefined);
    if (error instanceof Error && error.message === "revision-conflict") return Response.json({ error: "內容已有變更，請重新整理後再試。" }, { status: 409 });
    return Response.json({ error: "證明文件暫時無法儲存" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const identity = await userIdentityFor(request);
  if (!identity) return Response.json({ error: "請重新整理頁面後再刪除證明。" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^evidence_[a-f\d-]+$/u.test(id)) return Response.json({ error: "找不到這份證明" }, { status: 404 });
  try {
    const db = await getDb();
    const [row] = await db.select().from(boardPrepEvidence)
      .where(and(eq(boardPrepEvidence.userId, identity.userId), eq(boardPrepEvidence.id, id))).limit(1);
    if (!row) {
      await retryEvidenceCleanup(identity.userId).catch(() => undefined);
      return Response.json({ removed: true });
    }
    if (row.deletedAt) {
      await retryEvidenceCleanup(identity.userId).catch(() => undefined);
      return Response.json({ removed: true });
    }
    const now = new Date().toISOString();
    const [deleted] = await db.update(boardPrepEvidence).set({ deletedAt: now, updatedAt: now, revision: row.revision + 1 })
      .where(and(
        eq(boardPrepEvidence.userId, identity.userId),
        eq(boardPrepEvidence.id, id),
        eq(boardPrepEvidence.revision, row.revision),
        isNull(boardPrepEvidence.deletedAt),
      )).returning({ id: boardPrepEvidence.id });
    if (!deleted) return Response.json({ error: "內容已有變更，請重新整理後再試。" }, { status: 409 });
    await retryEvidenceCleanup(identity.userId).catch(() => undefined);
    return Response.json({ removed: true });
  } catch {
    return Response.json({ error: "證明文件暫時無法刪除" }, { status: 503 });
  }
}
