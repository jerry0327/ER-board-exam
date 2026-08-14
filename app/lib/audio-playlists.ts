export const AUDIO_PLAYLIST_NAME_LIMIT = 60;
export const AUDIO_PLAYLIST_ITEM_LIMIT = 1_200;
export const AUDIO_PLAYLIST_COUNT_LIMIT = 50;

const PLAYLIST_ID_PATTERN = /^pl_[A-Za-z0-9_-]{8,96}$/u;
const AUDIO_SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,95}$/u;

export type AudioPlaylist = {
  id: string;
  name: string;
  itemIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type AudioPlaylistDraft = Pick<AudioPlaylist, "id" | "name" | "itemIds">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validAudioPlaylistId(value: unknown): value is string {
  return typeof value === "string" && PLAYLIST_ID_PATTERN.test(value);
}

export function validAudioSourceId(value: unknown): value is string {
  return typeof value === "string" && AUDIO_SOURCE_ID_PATTERN.test(value);
}

function normalizedItemIds(value: unknown) {
  if (!Array.isArray(value) || value.length > AUDIO_PLAYLIST_ITEM_LIMIT) return null;
  if (!value.every(validAudioSourceId)) return null;
  return [...new Set(value)];
}

export function normalizeAudioPlaylistDraft(value: unknown): AudioPlaylistDraft | null {
  if (!isRecord(value) || !validAudioPlaylistId(value.id)) return null;
  if (typeof value.name !== "string") return null;
  const name = value.name.trim();
  if (!name || name.length > AUDIO_PLAYLIST_NAME_LIMIT) return null;
  const itemIds = normalizedItemIds(value.itemIds);
  if (!itemIds) return null;
  return { id: value.id, name, itemIds };
}

export function normalizeAudioPlaylist(value: unknown): AudioPlaylist | null {
  const draft = normalizeAudioPlaylistDraft(value);
  if (!draft || !isRecord(value)) return null;
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0) return null;
  if (
    typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
    || !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return null;
  }
  return {
    ...draft,
    revision: Number(value.revision),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function normalizeAudioPlaylists(value: unknown) {
  if (!Array.isArray(value)) return [];
  const playlists = value
    .map(normalizeAudioPlaylist)
    .filter((playlist): playlist is AudioPlaylist => Boolean(playlist));
  return [...new Map(playlists.map((playlist) => [playlist.id, playlist])).values()]
    .slice(0, AUDIO_PLAYLIST_COUNT_LIMIT);
}

export function createAudioPlaylistId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `pl_${crypto.randomUUID()}`;
  }
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export function sameAudioPlaylistContent(
  left: Pick<AudioPlaylist, "name" | "itemIds">,
  right: Pick<AudioPlaylist, "name" | "itemIds">,
) {
  return left.name === right.name
    && left.itemIds.length === right.itemIds.length
    && left.itemIds.every((id, index) => id === right.itemIds[index]);
}
