import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const [
  modelSource,
  hookSource,
  apiSource,
  schemaSource,
  viewSource,
  pickerSource,
  playerSource,
  siteCss,
] = await Promise.all([
  readFile(new URL("../app/lib/audio-playlists.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/hooks/use-audio-playlists.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/audio-playlists/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/views/audio-library-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/audio-playlist-destination-picker.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/audio-player-provider.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
]);

const modelUrl = `data:text/javascript;base64,${Buffer.from(
  stripTypeScriptTypes(modelSource, { mode: "strip" }),
).toString("base64")}`;
const model = await import(`${modelUrl}#audio-playlists-${Date.now()}`);

test("audio playlist model keeps stable ordered source ids and rejects oversized input", () => {
  const playlist = model.normalizeAudioPlaylist({
    id: "pl_12345678",
    name: "  重點複習  ",
    itemIds: ["rosens-003", "rosens-001", "rosens-003"],
    revision: 2,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T01:00:00.000Z",
  });
  assert.deepEqual(playlist?.itemIds, ["rosens-003", "rosens-001"]);
  assert.equal(playlist?.name, "重點複習");
  assert.equal(model.normalizeAudioPlaylistDraft({
    id: "pl_12345678",
    name: "清單",
    itemIds: Array.from({ length: model.AUDIO_PLAYLIST_ITEM_LIMIT + 1 }, (_, index) => `audio-${index}`),
  }), null);
  assert.equal(model.normalizeAudioPlaylistDraft({ id: "bad", name: "清單", itemIds: [] }), null);
  assert.match(model.createAudioPlaylistId(), /^pl_[A-Za-z0-9_-]{8,96}$/u);
});

test("playlist content comparison treats item order as meaningful", () => {
  assert.equal(model.sameAudioPlaylistContent(
    { name: "複習", itemIds: ["rosens-001", "rosens-002"] },
    { name: "複習", itemIds: ["rosens-001", "rosens-002"] },
  ), true);
  assert.equal(model.sameAudioPlaylistContent(
    { name: "複習", itemIds: ["rosens-001", "rosens-002"] },
    { name: "複習", itemIds: ["rosens-002", "rosens-001"] },
  ), false);
});

test("custom playlists reuse trusted identity without exposing storage mechanics", () => {
  assert.match(schemaSource, /export const audioPlaylist = sqliteTable\(\s*"audio_playlist"/u);
  assert.match(schemaSource, /primaryKey\(\{ columns: \[table\.userId, table\.id\] \}\)/u);
  assert.match(apiSource, /userIdentityFor\(request\)/u);
  assert.match(apiSource, /\{ localOnly: true, playlists: \[\] \}/u);
  assert.match(apiSource, /eq\(audioPlaylist\.revision, baseRevision\)/u);
  assert.match(apiSource, /isNull\(audioPlaylist\.deletedAt\)/u);
  assert.match(hookSource, /em-board-audio-playlists-v1:anonymous-device/u);
  assert.match(hookSource, /migrateLocalPlaylists\(readLocalPlaylists\(\), remote\)/u);
  assert.match(hookSource, /window\.localStorage\.removeItem\(LOCAL_STORAGE_KEY\)/u);
  assert.match(viewSource, /"已儲存"/u);
  assert.doesNotMatch(viewSource, /此瀏覽器|已同步|尚未同步/u);
  assert.match(viewSource, /自訂播放清單/u);
});

test("queue and saved playlists remain separate and both cap rendered rows", () => {
  assert.match(viewSource, /const AUDIO_QUEUE_RENDER_LIMIT = 24/u);
  assert.match(viewSource, /const CUSTOM_PLAYLIST_RENDER_LIMIT = 12/u);
  assert.match(viewSource, /player\.queue\.slice\(queuePageStart, queuePageStart \+ AUDIO_QUEUE_RENDER_LIMIT\)/u);
  assert.match(viewSource, /activePlaylistItems\.slice\(\s*playlistPageStart,\s*playlistPageStart \+ CUSTOM_PLAYLIST_RENDER_LIMIT/u);
  assert.match(viewSource, /className="audio-queue-pagination"/u);
  assert.match(viewSource, /className="audio-playlist-pagination"/u);
  assert.match(viewSource, /player\.addToQueue\(source\)/u);
  assert.match(viewSource, /customPlaylists\.addItem\(playlistId, source\.id\)/u);
  assert.match(viewSource, /customPlaylists\.moveItem/u);
  assert.match(viewSource, /customPlaylists\.removeItem/u);
});

test("playlist add flow never silently chooses the newest list when several exist", () => {
  assert.match(viewSource, /function requestPlaylistDestination\(source: AudioSummarySource, trigger: HTMLElement\)/u);
  assert.match(viewSource, /if \(customPlaylists\.playlists\.length !== 1\) \{\s*setPlaylistPickerSource\(source\);\s*return;/u);
  assert.match(viewSource, /const onlyPlaylist = customPlaylists\.playlists\[0\];[\s\S]*?addSourceToPlaylist\(onlyPlaylist\.id, onlyPlaylist\.name, source\)/u);
  assert.doesNotMatch(viewSource, /customPlaylists\.addItem\(activePlaylist\.id, source\.id\)/u);
  assert.match(viewSource, /onClick=\{\(event\) => requestPlaylistDestination\(source, event\.currentTarget\)\}/u);
  assert.match(viewSource, /customPlaylists\.playlists\.length > 1[\s\S]*?選擇要將/u);
  assert.match(viewSource, /customPlaylists\.playlists\.length === 1[\s\S]*?itemIds\.includes\(source\.id\)/u);
});

test("zero, one, and many-playlist destinations have complete accessible flows", () => {
  assert.match(viewSource, /<AudioPlaylistDestinationPicker[\s\S]*?open=\{Boolean\(playlistPickerSource\)\}/u);
  assert.match(viewSource, /playlists=\{customPlaylists\.playlists\}/u);
  assert.match(viewSource, /triggerRef=\{playlistAddTriggerRef\}/u);
  assert.match(pickerSource, /useOverlayFocusManagement\(\{[\s\S]*?open,[\s\S]*?panelRef,[\s\S]*?triggerRef,[\s\S]*?onClose/u);
  assert.match(pickerSource, /role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="audio-playlist-picker-title"/u);
  assert.match(pickerSource, /playlists\.map\(\(playlist\) => \{[\s\S]*?playlist\.itemIds\.includes\(sourceId\)[\s\S]*?playlist\.itemIds\.length >= AUDIO_PLAYLIST_ITEM_LIMIT/u);
  assert.match(pickerSource, /<ul className="audio-playlist-destination-list">[\s\S]*?<li key=\{playlist\.id\}>[\s\S]*?<button[\s\S]*?type="button"/u);
  assert.doesNotMatch(pickerSource, /<button[\s\S]{0,160}?role="listitem"/u);
  assert.match(pickerSource, /disabled=\{busy \|\| included \|\| full\}/u);
  assert.match(pickerSource, /<Check aria-hidden="true" \/>已加入/u);
  assert.match(pickerSource, /playlists\.length \? "或建立新清單" : "建立第一份清單並加入"/u);
  assert.match(pickerSource, /AUDIO_PLAYLIST_COUNT_LIMIT/u);
  assert.match(pickerSource, /createPortal\([\s\S]*?document\.body/u);
  assert.match(siteCss, /\.audio-playlist-picker-backdrop\s*\{[^}]*align-items: center;[^}]*position: fixed;/u);
  assert.match(siteCss, /@media \(max-width: 600px\)[\s\S]*?\.audio-playlist-picker-backdrop\s*\{[^}]*align-items: flex-end;[^}]*padding: 0;/u);
  assert.match(siteCss, /@media \(max-width: 600px\)[\s\S]*?\.audio-playlist-destination-picker\s*\{[^}]*max-height: min\(78dvh, 720px\);[^}]*width: 100%;/u);
});

test("playlist notices are transient, dismissible, and announced without stealing focus", () => {
  assert.match(viewSource, /if \(!playlistNotice\) return;[\s\S]*?window\.setTimeout\(\(\) => setPlaylistNotice\(""\), 4_500\)/u);
  assert.match(viewSource, /className="audio-library-toast"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/u);
  assert.match(viewSource, /aria-label="關閉通知"[\s\S]*?onClick=\{\(\) => setPlaylistNotice\(""\)\}/u);
  assert.match(siteCss, /\.audio-library-toast > button\s*\{[^}]*min-height: 32px;[^}]*min-width: 32px;/u);
});

test("creating from an add intent stores the first audio atomically", () => {
  assert.match(hookSource, /const create = useCallback\(async \(name: string, initialItemIds: string\[\] = \[\]\) => \{/u);
  assert.match(hookSource, /return save\(\{ id: createAudioPlaylistId\(\), name, itemIds: initialItemIds \}, 0\);/u);
  assert.match(viewSource, /customPlaylists\.create\(name, \[source\.id\]\)/u);
  assert.match(viewSource, /已建立「\$\{created\.name\}」並加入 \$\{audioSummaryDisplayName\(source\)\}/u);
  assert.doesNotMatch(viewSource, /customPlaylists\.create\(name\)[\s\S]{0,180}customPlaylists\.addItem/u);
  assert.match(hookSource, /if \(playlist\.itemIds\.includes\(sourceId\)\) return playlist;/u);
  assert.match(hookSource, /playlist\.itemIds\.length >= AUDIO_PLAYLIST_ITEM_LIMIT[\s\S]*?已達 \$\{AUDIO_PLAYLIST_ITEM_LIMIT\} 集上限/u);
});

test("listening history is durable, resumable, and visible in the library", () => {
  assert.match(playerSource, /const LISTENING_HISTORY_STORAGE_KEY = "em-board-audio-listening-history-v1";/u);
  assert.match(playerSource, /function readListeningHistory\(\): AudioListeningHistory[\s\S]*?window\.localStorage\.getItem\(LISTENING_HISTORY_STORAGE_KEY\)/u);
  assert.match(playerSource, /const candidate = record as Partial<AudioListeningRecord> & \{ position\?: unknown \};[\s\S]*?legacyPosition[\s\S]*?rawResumePosition[\s\S]*?rawFurthestPosition/u);
  assert.match(playerSource, /const completed = forceCompleted[\s\S]*?position \/ duration >= \.92/u);
  assert.match(playerSource, /const resumePosition = completed && forceCompleted \? duration : position;/u);
  assert.match(playerSource, /const furthestPosition = completed[\s\S]*?Math\.max\(previous\?\.furthestPosition \?\? 0, position\)/u);
  assert.match(playerSource, /window\.localStorage\.setItem\(LISTENING_HISTORY_STORAGE_KEY, JSON\.stringify\(history\)\)/u);
  assert.match(playerSource, /if \(!saved \|\| saved\.completed \|\| saved\.resumePosition < 5\) return 0;/u);
  assert.match(playerSource, /load: loadPausedSource/u);
  assert.match(playerSource, /listeningHistory,/u);
  assert.match(viewSource, /player\.listeningHistory\[source\.id\]/u);
  assert.match(viewSource, /listening\.furthestPosition \/ listening\.duration/u);
  assert.match(viewSource, /option value="unfinished">尚未聽完<\/option>/u);
  assert.match(viewSource, /option value="completed">已聽完<\/option>/u);
  assert.match(viewSource, /listening\?\.completed \? " · 已聽完" : listeningPercent > 0 \? ` · 已聽 \$\{listeningPercent\}%`/u);
});

test("continue-listening suggestions are contextual and shuffle respects the active filter", () => {
  assert.match(viewSource, /const sequentialNext = player\.current \? upcomingAudioSummaries\(player\.current\.id, 6\) : \[\];/u);
  assert.match(viewSource, /player\.current && sequentialNext\.length > 0/u);
  assert.match(viewSource, /<div className="audio-queue-heading"><span>接著聽<\/span><\/div>/u);
  assert.doesNotMatch(viewSource, /upcomingAudioSummaries\(player\.current\?\.id, 6\)/u);
  assert.doesNotMatch(viewSource, />接續章節</u);
  assert.match(viewSource, /function shuffledSources\(sources: readonly AudioSummarySource\[\]\)[\s\S]*?for \(let index = next\.length - 1; index > 0; index -= 1\)[\s\S]*?Math\.random\(\)/u);
  assert.match(viewSource, /onClick=\{\(\) => playSequence\(filteredSources, "目前篩選的音檔", true\)\}/u);
  assert.match(viewSource, /const playable = shuffle \? shuffledSources\(items\) : \[\.\.\.items\];[\s\S]*?player\.playSequence\(playable\)/u);
  assert.doesNotMatch(viewSource, /player\.clearQueue\(\);[\s\S]{0,180}?playable\.slice\(1\)\.forEach\(player\.addToQueue\)/u);
  assert.match(playerSource, /async function playSequence\(items: readonly AudioSummarySource\[\]\)[\s\S]*?beginSourceOperation\(\)[\s\S]*?updateQueue\(remaining\.map\(\(source\) => source\.id\)\)[\s\S]*?playSource\(first, operation\)/u);
});
