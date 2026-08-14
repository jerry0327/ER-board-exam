import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { guideProgress } from "../../../db/schema";
import { userIdentityFor } from "../user-identity";
import { privateJson } from "../private-response";

export const dynamic = "force-dynamic";

type GuideAction =
  | { action: "open"; chapterId: number; contentHash?: string | null; occurredAt?: string }
  | { action: "read"; chapterId: number; value: "unread" | "reading" | "done" | "later"; contentHash?: string | null; occurredAt?: string }
  | { action: "bookmark"; chapterId: number; value: boolean; occurredAt?: string }
  | { action: "note"; chapterId: number; value: string; occurredAt?: string };

const readStates = new Set(["unread", "reading", "done", "later"]);

function parseAction(value: unknown): GuideAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!Number.isInteger(input.chapterId) || Number(input.chapterId) < 1 || Number(input.chapterId) > 303) return null;
  if (input.occurredAt !== undefined) {
    if (typeof input.occurredAt !== "string") return null;
    const timestamp = Date.parse(input.occurredAt);
    if (!Number.isFinite(timestamp) || timestamp < Date.now() - 366 * 86_400_000 || timestamp > Date.now() + 300_000) return null;
  }
  if (input.contentHash !== undefined && input.contentHash !== null && (typeof input.contentHash !== "string" || input.contentHash.length > 128)) return null;
  if (input.action === "open") return input as GuideAction;
  if (input.action === "read" && typeof input.value === "string" && readStates.has(input.value)) return input as GuideAction;
  if (input.action === "bookmark" && typeof input.value === "boolean") return input as GuideAction;
  if (input.action === "note" && typeof input.value === "string" && input.value.length <= 12_000) return input as GuideAction;
  return null;
}

async function getChapter(userId: string, chapterId: number) {
  const db = await getDb();
  const [record] = await db.select().from(guideProgress).where(and(eq(guideProgress.userId, userId), eq(guideProgress.chapterId, chapterId))).limit(1);
  return record;
}

function publicProgress(row: typeof guideProgress.$inferSelect) {
  const { userId: _userId, ...progress } = row;
  void _userId;
  return progress;
}

export async function GET(request: Request) {
  try {
    const identity = await userIdentityFor(request);
    if (!identity) return privateJson({ localOnly: true, progress: [] }, { status: 401 });
    const db = await getDb();
    const progress = await db.select().from(guideProgress).where(eq(guideProgress.userId, identity.userId));
    return privateJson({ accountKey: identity.accountKey, legacyAccountKey: identity.legacyAccountKey, progress: progress.map(publicProgress) });
  } catch {
    return privateJson({ error: "無法載入閱讀進度，請再試一次。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "無法更新閱讀進度，請再試一次。" }, { status: 400 });
  }
  const body = parseAction(raw);
  if (!body) return Response.json({ error: "無法更新閱讀進度，請再試一次。" }, { status: 400 });

  try {
    const identity = await userIdentityFor(request);
    if (!identity) return Response.json({ localOnly: true }, { status: 401 });
    const db = await getDb();
    const now = new Date().toISOString();
    const occurredAt = body.occurredAt ?? now;
    const existing = await getChapter(identity.userId, body.chapterId);
    const insert = {
      userId: identity.userId,
      chapterId: body.chapterId,
      readState: existing?.readState ?? "unread",
      bookmarked: existing?.bookmarked ?? 0,
      note: existing?.note ?? "",
      contentHash: existing?.contentHash ?? null,
      lastOpenedAt: existing?.lastOpenedAt ?? null,
      completedAt: existing?.completedAt ?? null,
      updatedAt: now,
    };
    const set: Partial<typeof insert> = { updatedAt: now };
    if (body.action === "open") {
      insert.lastOpenedAt = occurredAt;
      insert.contentHash = body.contentHash ?? null;
      set.lastOpenedAt = occurredAt;
      set.contentHash = body.contentHash ?? null;
    } else if (body.action === "read") {
      insert.readState = body.value;
      insert.contentHash = body.contentHash ?? insert.contentHash;
      insert.completedAt = body.value === "done" ? occurredAt : body.value === "unread" ? null : insert.completedAt;
      set.readState = insert.readState;
      set.contentHash = insert.contentHash;
      set.completedAt = insert.completedAt;
    } else if (body.action === "bookmark") {
      insert.bookmarked = body.value ? 1 : 0;
      set.bookmarked = insert.bookmarked;
    } else {
      insert.note = body.value;
      set.note = insert.note;
    }
    await db.insert(guideProgress).values(insert).onConflictDoUpdate({
      target: [guideProgress.userId, guideProgress.chapterId],
      set,
    });
    const progress = await getChapter(identity.userId, body.chapterId);
    return Response.json({ progress: progress ? publicProgress(progress) : null });
  } catch {
    return Response.json({ error: "無法更新閱讀進度，請再試一次。" }, { status: 500 });
  }
}
