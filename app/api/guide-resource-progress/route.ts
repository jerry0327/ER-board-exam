import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { guideResourceProgress } from "../../../db/schema";
import { parseAnyGuideAnnotationResourceId } from "../../lib/annotation-source";
import { userIdentityFor } from "../user-identity";
import { privateJson } from "../private-response";

export const dynamic = "force-dynamic";

type GuideResourceAction =
  | { action: "open"; resourceId: string; contentHash?: string | null; occurredAt?: string }
  | { action: "read"; resourceId: string; value: "unread" | "reading" | "done" | "later"; contentHash?: string | null; occurredAt?: string }
  | { action: "bookmark"; resourceId: string; value: boolean; occurredAt?: string };

const readStates = new Set(["unread", "reading", "done", "later"]);

function parseAction(value: unknown): GuideResourceAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.resourceId !== "string" || !parseAnyGuideAnnotationResourceId(input.resourceId)) return null;
  if (input.occurredAt !== undefined) {
    if (typeof input.occurredAt !== "string") return null;
    const timestamp = Date.parse(input.occurredAt);
    if (!Number.isFinite(timestamp) || timestamp < Date.now() - 366 * 86_400_000 || timestamp > Date.now() + 300_000) return null;
  }
  if (input.contentHash !== undefined && input.contentHash !== null && (typeof input.contentHash !== "string" || input.contentHash.length > 128)) return null;
  if (input.action === "open") return input as GuideResourceAction;
  if (input.action === "read" && typeof input.value === "string" && readStates.has(input.value)) return input as GuideResourceAction;
  if (input.action === "bookmark" && typeof input.value === "boolean") return input as GuideResourceAction;
  return null;
}

async function getResource(userId: string, resourceId: string) {
  const db = await getDb();
  const [record] = await db.select().from(guideResourceProgress).where(and(
    eq(guideResourceProgress.userId, userId),
    eq(guideResourceProgress.resourceId, resourceId),
  )).limit(1);
  return record;
}

function publicProgress(row: typeof guideResourceProgress.$inferSelect) {
  const { userId: _userId, ...progress } = row;
  void _userId;
  return progress;
}

export async function GET(request: Request) {
  try {
    const identity = await userIdentityFor(request);
    if (!identity) return privateJson({ localOnly: true, progress: [] }, { status: 401 });
    const db = await getDb();
    const progress = await db.select().from(guideResourceProgress).where(eq(guideResourceProgress.userId, identity.userId));
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
    const existing = await getResource(identity.userId, body.resourceId);
    const insert = {
      userId: identity.userId,
      resourceId: body.resourceId,
      readState: existing?.readState ?? "unread",
      bookmarked: existing?.bookmarked ?? 0,
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
    } else {
      insert.bookmarked = body.value ? 1 : 0;
      set.bookmarked = insert.bookmarked;
    }
    await db.insert(guideResourceProgress).values(insert).onConflictDoUpdate({
      target: [guideResourceProgress.userId, guideResourceProgress.resourceId],
      set,
    });
    const progress = await getResource(identity.userId, body.resourceId);
    return Response.json({ progress: progress ? publicProgress(progress) : null });
  } catch {
    return Response.json({ error: "無法更新閱讀進度，請再試一次。" }, { status: 500 });
  }
}
