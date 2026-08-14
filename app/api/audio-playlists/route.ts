import { and, count, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { audioPlaylist } from "../../../db/schema";
import {
  AUDIO_PLAYLIST_COUNT_LIMIT,
  normalizeAudioPlaylist,
  normalizeAudioPlaylistDraft,
  validAudioPlaylistId,
} from "../../lib/audio-playlists";
import { userIdentityFor } from "../user-identity";
import { privateJson } from "../private-response";

export const dynamic = "force-dynamic";

function publicPlaylist(row: typeof audioPlaylist.$inferSelect) {
  try {
    return normalizeAudioPlaylist({
      id: row.id,
      name: row.name,
      itemIds: JSON.parse(row.itemIds),
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch {
    return null;
  }
}

async function currentPlaylist(userId: string, id: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(audioPlaylist)
    .where(and(eq(audioPlaylist.userId, userId), eq(audioPlaylist.id, id)))
    .limit(1);
  return row;
}

export async function GET(request: Request) {
  try {
    const identity = await userIdentityFor(request);
    if (!identity) {
      return privateJson(
        { localOnly: true, playlists: [] },
        { status: 401 },
      );
    }
    const db = await getDb();
    const rows = await db
      .select()
      .from(audioPlaylist)
      .where(and(
        eq(audioPlaylist.userId, identity.userId),
        isNull(audioPlaylist.deletedAt),
      ))
      .orderBy(desc(audioPlaylist.updatedAt));
    const playlists = rows
      .map(publicPlaylist)
      .filter((playlist): playlist is NonNullable<typeof playlist> => Boolean(playlist));
    return privateJson({ accountKey: identity.accountKey, legacyAccountKey: identity.legacyAccountKey, playlists });
  } catch {
    return privateJson({ error: "目前無法載入自訂播放清單，請稍後再試。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await userIdentityFor(request);
  if (!identity) return Response.json({ localOnly: true }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "無法儲存播放清單，請再試一次。" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Response.json({ error: "無法儲存播放清單，請再試一次。" }, { status: 400 });
  }
  const body = raw as { playlist?: unknown; baseRevision?: unknown };
  const draft = normalizeAudioPlaylistDraft(body.playlist);
  const baseRevision = Number(body.baseRevision);
  if (!draft || !Number.isInteger(baseRevision) || baseRevision < 0) {
    return Response.json({ error: "無法儲存播放清單，請再試一次。" }, { status: 400 });
  }
  const itemIds = JSON.stringify(draft.itemIds);
  if (itemIds.length > 150_000) {
    return Response.json({ error: "這份播放清單的內容太多。" }, { status: 413 });
  }

  try {
    const db = await getDb();
    const now = new Date().toISOString();
    if (baseRevision === 0) {
      const [total] = await db
        .select({ value: count() })
        .from(audioPlaylist)
        .where(and(
          eq(audioPlaylist.userId, identity.userId),
          isNull(audioPlaylist.deletedAt),
        ));
      if (Number(total?.value ?? 0) >= AUDIO_PLAYLIST_COUNT_LIMIT) {
        return Response.json({ error: `最多可建立 ${AUDIO_PLAYLIST_COUNT_LIMIT} 份自訂播放清單。` }, { status: 409 });
      }
      const [created] = await db
        .insert(audioPlaylist)
        .values({
          userId: identity.userId,
          id: draft.id,
          name: draft.name,
          itemIds,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return Response.json({ playlist: publicPlaylist(created) }, { status: 201 });
    } else {
      const [updated] = await db
        .update(audioPlaylist)
        .set({
          name: draft.name,
          itemIds,
          revision: baseRevision + 1,
          updatedAt: now,
        })
        .where(and(
          eq(audioPlaylist.userId, identity.userId),
          eq(audioPlaylist.id, draft.id),
          eq(audioPlaylist.revision, baseRevision),
          isNull(audioPlaylist.deletedAt),
        ))
        .returning();
      if (updated) return Response.json({ playlist: publicPlaylist(updated) });
    }

    const current = await currentPlaylist(identity.userId, draft.id);
    return Response.json(
      {
        error: "這份播放清單已在其他裝置更新，請再試一次。",
        playlist: current && !current.deletedAt ? publicPlaylist(current) : null,
      },
      { status: 409 },
    );
  } catch {
    return Response.json({ error: "目前無法儲存自訂播放清單，請稍後再試。" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const identity = await userIdentityFor(request);
  if (!identity) return Response.json({ localOnly: true }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "無法刪除播放清單，請再試一次。" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Response.json({ error: "無法刪除播放清單，請再試一次。" }, { status: 400 });
  }
  const body = raw as { id?: unknown; baseRevision?: unknown };
  const baseRevision = Number(body.baseRevision);
  if (!validAudioPlaylistId(body.id) || !Number.isInteger(baseRevision) || baseRevision < 1) {
    return Response.json({ error: "無法刪除播放清單，請再試一次。" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const now = new Date().toISOString();
    const [removed] = await db
      .update(audioPlaylist)
      .set({ deletedAt: now, updatedAt: now, revision: baseRevision + 1 })
      .where(and(
        eq(audioPlaylist.userId, identity.userId),
        eq(audioPlaylist.id, body.id),
        eq(audioPlaylist.revision, baseRevision),
        isNull(audioPlaylist.deletedAt),
      ))
      .returning({ id: audioPlaylist.id });
    if (removed) return Response.json({ ok: true, id: removed.id });

    const current = await currentPlaylist(identity.userId, body.id);
    if (!current || current.deletedAt) return Response.json({ ok: true, id: body.id });
    return Response.json(
      { error: "這份播放清單已在其他裝置更新，請再試一次。", playlist: publicPlaylist(current) },
      { status: 409 },
    );
  } catch {
    return Response.json({ error: "目前無法刪除自訂播放清單，請稍後再試。" }, { status: 503 });
  }
}
