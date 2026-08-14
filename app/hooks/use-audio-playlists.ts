"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUDIO_PLAYLIST_COUNT_LIMIT,
  AUDIO_PLAYLIST_ITEM_LIMIT,
  AUDIO_PLAYLIST_NAME_LIMIT,
  createAudioPlaylistId,
  normalizeAudioPlaylist,
  normalizeAudioPlaylistDraft,
  normalizeAudioPlaylists,
  sameAudioPlaylistContent,
  type AudioPlaylist,
  type AudioPlaylistDraft,
} from "../lib/audio-playlists";
import { loadAccountSession } from "../lib/account-session";

const LOCAL_STORAGE_KEY = "em-board-audio-playlists-v1:anonymous-device";

export type AudioPlaylistStatus = "loading" | "local" | "saving" | "synced" | "error";

function readLocalPlaylists() {
  try {
    return normalizeAudioPlaylists(JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function writeLocalPlaylists(playlists: AudioPlaylist[]) {
  try {
    if (playlists.length) window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(playlists));
    else window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

type RemoteSaveResult =
  | { playlist: AudioPlaylist; conflict: false }
  | { playlist: AudioPlaylist | null; conflict: true; message: string };

async function saveRemotePlaylist(
  playlist: AudioPlaylistDraft,
  baseRevision: number,
): Promise<RemoteSaveResult> {
  const response = await fetch("/api/audio-playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playlist, baseRevision }),
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: unknown;
    playlist?: unknown;
  };
  const saved = normalizeAudioPlaylist(payload.playlist);
  if (response.status === 409) {
    return {
      playlist: saved,
      conflict: true,
      message: typeof payload.error === "string" ? payload.error : "播放清單已有更新。",
    };
  }
  if (!response.ok || !saved) {
    throw new Error(typeof payload.error === "string" ? payload.error : "無法儲存播放清單，請再試一次。");
  }
  return { playlist: saved, conflict: false };
}

async function deleteRemotePlaylist(playlist: AudioPlaylist) {
  const response = await fetch("/api/audio-playlists", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: playlist.id, baseRevision: playlist.revision }),
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: unknown;
    playlist?: unknown;
  };
  if (response.status === 409) {
    return {
      removed: false as const,
      playlist: normalizeAudioPlaylist(payload.playlist),
      message: typeof payload.error === "string" ? payload.error : "播放清單已有更新。",
    };
  }
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "無法刪除播放清單，請再試一次。");
  }
  return { removed: true as const, playlist: null, message: "" };
}

function localPlaylist(draft: AudioPlaylistDraft, existing?: AudioPlaylist): AudioPlaylist {
  const now = new Date().toISOString();
  return {
    ...draft,
    revision: 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

async function migrateLocalPlaylists(local: AudioPlaylist[], remote: AudioPlaylist[]) {
  if (!local.length) return remote;
  const merged = [...remote];
  for (const playlist of local) {
    const matching = merged.find((candidate) => candidate.id === playlist.id);
    if (matching && sameAudioPlaylistContent(matching, playlist)) continue;
    let id = playlist.id;
    while (merged.some((candidate) => candidate.id === id)) id = createAudioPlaylistId();
    const result = await saveRemotePlaylist({
      id,
      name: playlist.name,
      itemIds: playlist.itemIds,
    }, 0);
    if (result.conflict) throw new Error(result.message);
    merged.push(result.playlist);
  }
  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  return merged;
}

export function useAudioPlaylists() {
  const [playlists, setPlaylists] = useState<AudioPlaylist[]>([]);
  const [status, setStatus] = useState<AudioPlaylistStatus>("loading");
  const [accountKey, setAccountKey] = useState<string | null>(null);
  const playlistsRef = useRef<AudioPlaylist[]>([]);
  const remoteRef = useRef(false);
  const mountedRef = useRef(false);

  const replace = useCallback((next: AudioPlaylist[]) => {
    playlistsRef.current = next;
    if (mountedRef.current) setPlaylists(next);
  }, []);

  const activateLocal = useCallback((next = readLocalPlaylists(), failed = false) => {
    remoteRef.current = false;
    setAccountKey(null);
    replace(next);
    setStatus(failed ? "error" : "local");
  }, [replace]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void loadAccountSession()
      .then((session) => {
        if (!session.authenticated) return null;
        return fetch("/api/audio-playlists", { cache: "no-store", signal: controller.signal });
      })
      .then(async (response) => {
        if (!response || response.status === 401) {
          activateLocal();
          return;
        }
        if (!response.ok) throw new Error(await responseError(response, "無法載入播放清單。"));
        const payload = await response.json() as { accountKey?: unknown; playlists?: unknown };
        if (typeof payload.accountKey !== "string" || !payload.accountKey) {
          throw new Error("暫時無法準備播放清單。");
        }
        const remote = normalizeAudioPlaylists(payload.playlists);
        const migrated = await migrateLocalPlaylists(readLocalPlaylists(), remote);
        if (controller.signal.aborted) return;
        remoteRef.current = true;
        setAccountKey(payload.accountKey);
        replace(migrated);
        setStatus("synced");
      })
      .catch(() => {
        if (!controller.signal.aborted) activateLocal(readLocalPlaylists(), true);
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [activateLocal, replace]);

  const save = useCallback(async (draft: AudioPlaylistDraft, baseRevision: number) => {
    const normalized = normalizeAudioPlaylistDraft(draft);
    if (!normalized) throw new Error(`播放清單名稱需為 1–${AUDIO_PLAYLIST_NAME_LIMIT} 個字。`);
    const current = playlistsRef.current.find((playlist) => playlist.id === normalized.id);
    if (!remoteRef.current) {
      const saved = localPlaylist(normalized, current);
      const next = current
        ? playlistsRef.current.map((playlist) => playlist.id === saved.id ? saved : playlist)
        : [saved, ...playlistsRef.current];
      if (!writeLocalPlaylists(next)) throw new Error("播放清單暫時無法儲存，請再試一次。");
      replace(next);
      setStatus("local");
      return saved;
    }

    setStatus("saving");
    try {
      const result = await saveRemotePlaylist(normalized, baseRevision);
      if (result.conflict) {
        if (result.playlist) {
          replace(playlistsRef.current.map((playlist) => (
            playlist.id === result.playlist!.id ? result.playlist! : playlist
          )));
        }
        setStatus("error");
        throw new Error(result.message);
      }
      const next = current
        ? playlistsRef.current.map((playlist) => playlist.id === result.playlist.id ? result.playlist : playlist)
        : [result.playlist, ...playlistsRef.current];
      replace(next);
      setStatus("synced");
      return result.playlist;
    } catch (error) {
      setStatus("error");
      throw error;
    }
  }, [replace]);

  const create = useCallback(async (name: string, initialItemIds: string[] = []) => {
    if (playlistsRef.current.length >= AUDIO_PLAYLIST_COUNT_LIMIT) {
      throw new Error(`最多可建立 ${AUDIO_PLAYLIST_COUNT_LIMIT} 份自訂播放清單。`);
    }
    if (initialItemIds.length > AUDIO_PLAYLIST_ITEM_LIMIT) {
      throw new Error(`每份播放清單最多可加入 ${AUDIO_PLAYLIST_ITEM_LIMIT} 集。`);
    }
    return save({ id: createAudioPlaylistId(), name, itemIds: initialItemIds }, 0);
  }, [save]);

  const rename = useCallback(async (id: string, name: string) => {
    const playlist = playlistsRef.current.find((candidate) => candidate.id === id);
    if (!playlist) throw new Error("找不到這份播放清單。");
    return save({ id, name, itemIds: playlist.itemIds }, playlist.revision);
  }, [save]);

  const addItem = useCallback(async (id: string, sourceId: string) => {
    const playlist = playlistsRef.current.find((candidate) => candidate.id === id);
    if (!playlist) throw new Error("請先選擇一份自訂播放清單。");
    if (playlist.itemIds.includes(sourceId)) return playlist;
    if (playlist.itemIds.length >= AUDIO_PLAYLIST_ITEM_LIMIT) {
      throw new Error(`「${playlist.name}」已達 ${AUDIO_PLAYLIST_ITEM_LIMIT} 集上限。`);
    }
    return save({ ...playlist, itemIds: [...playlist.itemIds, sourceId] }, playlist.revision);
  }, [save]);

  const removeItem = useCallback(async (id: string, sourceId: string) => {
    const playlist = playlistsRef.current.find((candidate) => candidate.id === id);
    if (!playlist) throw new Error("找不到這份播放清單。");
    return save({ ...playlist, itemIds: playlist.itemIds.filter((itemId) => itemId !== sourceId) }, playlist.revision);
  }, [save]);

  const moveItem = useCallback(async (id: string, sourceId: string, direction: -1 | 1) => {
    const playlist = playlistsRef.current.find((candidate) => candidate.id === id);
    if (!playlist) throw new Error("找不到這份播放清單。");
    const index = playlist.itemIds.indexOf(sourceId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= playlist.itemIds.length) return playlist;
    const itemIds = [...playlist.itemIds];
    [itemIds[index], itemIds[target]] = [itemIds[target], itemIds[index]];
    return save({ ...playlist, itemIds }, playlist.revision);
  }, [save]);

  const remove = useCallback(async (id: string) => {
    const playlist = playlistsRef.current.find((candidate) => candidate.id === id);
    if (!playlist) return;
    if (!remoteRef.current) {
      const next = playlistsRef.current.filter((candidate) => candidate.id !== id);
      if (!writeLocalPlaylists(next)) throw new Error("播放清單暫時無法移除，請再試一次。");
      replace(next);
      setStatus("local");
      return;
    }

    setStatus("saving");
    try {
      const result = await deleteRemotePlaylist(playlist);
      if (!result.removed) {
        if (result.playlist) {
          replace(playlistsRef.current.map((candidate) => (
            candidate.id === result.playlist!.id ? result.playlist! : candidate
          )));
        }
        setStatus("error");
        throw new Error(result.message);
      }
      replace(playlistsRef.current.filter((candidate) => candidate.id !== id));
      setStatus("synced");
    } catch (error) {
      setStatus("error");
      throw error;
    }
  }, [replace]);

  return {
    playlists,
    status,
    accountKey,
    create,
    rename,
    addItem,
    removeItem,
    moveItem,
    remove,
  };
}
