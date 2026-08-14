import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { boardPrepProfile } from "../../../db/schema";
import { normalizeBoardPrepState } from "../../lib/board-prep";
import { userIdentityFor } from "../user-identity";
import { privateJson } from "../private-response";

export const dynamic = "force-dynamic";

function publicProfile(row: typeof boardPrepProfile.$inferSelect) {
  return { state: normalizeBoardPrepState(JSON.parse(row.state)), revision: row.revision, updatedAt: row.updatedAt };
}

export async function GET(request: Request) {
  try {
    const identity = await userIdentityFor(request);
    if (!identity) return privateJson({ error: "請重新整理頁面後再試。" }, { status: 401 });
    const db = await getDb();
    const [row] = await db.select().from(boardPrepProfile).where(eq(boardPrepProfile.userId, identity.userId)).limit(1);
    return privateJson(row ? publicProfile(row) : { state: null, revision: 0, accountKey: identity.accountKey, legacyAccountKey: identity.legacyAccountKey });
  } catch {
    return privateJson({ error: "目前無法載入清單，請稍後再試。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await userIdentityFor(request);
  if (!identity) return Response.json({ error: "請重新整理頁面後再試。" }, { status: 401 });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "無法儲存，請再試一次。" }, { status: 400 }); }
  if (!input || typeof input !== "object") return Response.json({ error: "無法儲存，請再試一次。" }, { status: 400 });
  const body = input as { state?: unknown; baseRevision?: unknown };
  if (!Number.isInteger(body.baseRevision) || Number(body.baseRevision) < 0) return Response.json({ error: "無法儲存，請再試一次。" }, { status: 400 });
  const state = normalizeBoardPrepState(body.state);
  const serialized = JSON.stringify(state);
  if (serialized.length > 100_000) return Response.json({ error: "無法儲存，請再試一次。" }, { status: 413 });
  try {
    const db = await getDb();
    const [existing] = await db.select().from(boardPrepProfile).where(eq(boardPrepProfile.userId, identity.userId)).limit(1);
    if ((existing?.revision ?? 0) !== Number(body.baseRevision)) {
      return Response.json({ error: "內容已有變更，請重新整理後再試。", ...(existing ? publicProfile(existing) : { state: null, revision: 0 }) }, { status: 409 });
    }
    const now = new Date().toISOString();
    const revision = Number(body.baseRevision) + 1;
    if (existing) {
      const [updated] = await db.update(boardPrepProfile).set({ state: serialized, revision, updatedAt: now })
        .where(and(
          eq(boardPrepProfile.userId, identity.userId),
          eq(boardPrepProfile.revision, Number(body.baseRevision)),
        )).returning();
      if (!updated) {
        const [current] = await db.select().from(boardPrepProfile).where(eq(boardPrepProfile.userId, identity.userId)).limit(1);
        return Response.json({ error: "內容已有變更，請重新整理後再試。", ...(current ? publicProfile(current) : { state: null, revision: 0 }) }, { status: 409 });
      }
      return Response.json(publicProfile(updated));
    }
    const [created] = await db.insert(boardPrepProfile)
      .values({ userId: identity.userId, state: serialized, revision, updatedAt: now })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      const [current] = await db.select().from(boardPrepProfile).where(eq(boardPrepProfile.userId, identity.userId)).limit(1);
      return Response.json({ error: "內容已有變更，請重新整理後再試。", ...(current ? publicProfile(current) : { state: null, revision: 0 }) }, { status: 409 });
    }
    return Response.json(publicProfile(created));
  } catch {
    return Response.json({ error: "目前無法更新清單，請稍後再試。" }, { status: 503 });
  }
}
