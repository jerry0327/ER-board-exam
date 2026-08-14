import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { disasterCourseCompletion } from "../../../db/schema";
import { normalizeRecognizedCourseCompletion, type SemRecognizedCourse } from "../../lib/sem-recognized-courses";
import { userIdentityFor } from "../user-identity";
import { privateJson } from "../private-response";

export const dynamic = "force-dynamic";

function publicCompletion(row: typeof disasterCourseCompletion.$inferSelect) {
  return {
    courseId: row.courseId,
    completedAt: row.completedAt,
    certificateNumber: row.certificateNumber,
    note: row.note,
    snapshot: JSON.parse(row.courseSnapshot) as SemRecognizedCourse,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

export async function GET(request: Request) {
  try {
    const identity = await userIdentityFor(request);
    if (!identity) return privateJson({ error: "請重新整理頁面後再試。", completions: [] }, { status: 401 });
    const db = await getDb();
    const rows = await db.select().from(disasterCourseCompletion)
      .where(and(eq(disasterCourseCompletion.userId, identity.userId), isNull(disasterCourseCompletion.deletedAt)))
      .orderBy(desc(disasterCourseCompletion.updatedAt));
    return privateJson({ completions: rows.map(publicCompletion) });
  } catch {
    return privateJson({ error: "目前無法載入完成狀態，請稍後再試。", completions: [] }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await userIdentityFor(request);
  if (!identity) return Response.json({ error: "請重新整理頁面後再試。" }, { status: 401 });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "無法儲存，請再試一次。" }, { status: 400 }); }
  if (!input || typeof input !== "object") return Response.json({ error: "無法儲存，請再試一次。" }, { status: 400 });
  const body = input as Record<string, unknown>;
  const action = body.action === "remove" ? "remove" : "upsert";
  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  const baseRevision = Number(body.baseRevision);
  if (!/^sem-course-[a-z0-9]+$/u.test(courseId) || !Number.isInteger(baseRevision) || baseRevision < 0) {
    return Response.json({ error: "無法儲存，請再試一次。" }, { status: 400 });
  }
  const normalized = action === "upsert" ? normalizeRecognizedCourseCompletion({
    courseId,
    completedAt: body.completedAt,
    certificateNumber: body.certificateNumber,
    note: body.note,
    snapshot: body.snapshot,
    updatedAt: new Date().toISOString(),
  }) : null;
  if (action === "upsert" && (!normalized || !/^\d{4}-\d{2}-\d{2}$/u.test(normalized.completedAt))) {
    return Response.json({ error: "請選擇完成日期" }, { status: 400 });
  }
  const snapshotJson = normalized ? JSON.stringify(normalized.snapshot) : "";
  if (snapshotJson.length > 30_000) return Response.json({ error: "無法儲存，請再試一次。" }, { status: 413 });
  try {
    const db = await getDb();
    const [existing] = await db.select().from(disasterCourseCompletion)
      .where(and(eq(disasterCourseCompletion.userId, identity.userId), eq(disasterCourseCompletion.courseId, courseId))).limit(1);
    if ((existing?.revision ?? 0) !== baseRevision) {
      return Response.json({ error: "內容已有變更，請重新整理後再試。", completion: existing && !existing.deletedAt ? publicCompletion(existing) : null }, { status: 409 });
    }
    const now = new Date().toISOString();
    const revision = baseRevision + 1;
    if (existing) {
      const values = action === "remove"
        ? { revision, updatedAt: now, deletedAt: now }
        : {
            completedAt: normalized!.completedAt,
            certificateNumber: normalized!.certificateNumber,
            note: normalized!.note,
            courseSnapshot: snapshotJson,
            revision,
            updatedAt: now,
            deletedAt: null,
          };
      const [updated] = await db.update(disasterCourseCompletion).set(values)
        .where(and(eq(disasterCourseCompletion.userId, identity.userId), eq(disasterCourseCompletion.courseId, courseId), eq(disasterCourseCompletion.revision, baseRevision))).returning();
      if (!updated) return Response.json({ error: "內容已有變更，請重新整理後再試。" }, { status: 409 });
      return Response.json({ completion: action === "remove" ? null : publicCompletion(updated) });
    }
    if (action === "remove") return Response.json({ completion: null });
    const [created] = await db.insert(disasterCourseCompletion).values({
      userId: identity.userId,
      courseId,
      completedAt: normalized!.completedAt,
      certificateNumber: normalized!.certificateNumber,
      note: normalized!.note,
      courseSnapshot: snapshotJson,
      revision,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).returning();
    return Response.json({ completion: publicCompletion(created) });
  } catch {
    return Response.json({ error: "無法儲存，請稍後再試。" }, { status: 503 });
  }
}
