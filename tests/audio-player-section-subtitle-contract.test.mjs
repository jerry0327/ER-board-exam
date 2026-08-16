import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [companion, provider, events, css] = await Promise.all([
  readFile(new URL("../app/components/audio-section-companion.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/audio-player-provider.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/audio-player-section-events.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
]);

const marker = "/* Audio Player consolidated Section + subtitle presentation */";
const markerIndex = css.indexOf(marker);
assert.ok(markerIndex >= 0, "consolidated player CSS marker must exist");
const consolidatedStart = css.lastIndexOf("@layer site-features", markerIndex);
const consolidated = css.slice(consolidatedStart);

test("Section and subtitle runtime stays revision-safe and shares player-time seek helpers", () => {
  assert.match(companion, /sourceRevision: string;/u);
  assert.match(companion, /bundle\.sourceRevision === currentSource\.revision/u);
  assert.match(companion, /scope\.sourceRevision === currentSource\.revision/u);
  assert.match(companion, /currentSubtitleCueAt\(activeBundle\.runtime\.subtitle, player\.position\)/u);
  assert.match(companion, /siteSecondsFromSourceSeconds\(cue\.startSourceSeconds\)/u);
  assert.match(companion, /playerSecondsForChapter\(chapter\)/u);
  assert.match(companion, /requestAnimationFrame\(\(\) => setSectionOpen\(false\)\)/u);
  assert.match(companion, /questions\.find\(\(chapter\) => questionNumber\(chapter\.title\) === number\)/u);
  assert.match(companion, /\{currentTitle && <strong title=\{currentTitle\}>\{currentTitle\}<\/strong>\}/u);
});

test("Section popover has explicit ownership, dismissal, focus return, and Settings exclusion", () => {
  assert.match(companion, /aria-haspopup="dialog"/u);
  assert.match(companion, /aria-controls="audio-player-section-panel"/u);
  assert.match(companion, /id="audio-player-section-panel"/u);
  assert.match(companion, /role="dialog"/u);
  assert.match(companion, /document\.addEventListener\("pointerdown", handlePointerDown\)/u);
  assert.match(companion, /event\.key !== "Escape"/u);
  assert.match(companion, /window\.requestAnimationFrame\(\(\) => trigger\.focus\(\)\)/u);
  assert.match(companion, /AUDIO_PLAYER_SETTINGS_OPEN_EVENT/u);
  assert.match(companion, /document\.querySelector<HTMLDetailsElement>\("\.audio-player-settings\[open\]"\)/u);
  assert.match(events, /AUDIO_PLAYER_SETTINGS_OPEN_EVENT = "em-board-audio-player-settings-open"/u);
  assert.match(provider, /window\.dispatchEvent\(new Event\(AUDIO_PLAYER_SETTINGS_OPEN_EVENT\)\)/u);
});

test("Settings and question-choice overlays support keyboard dismissal and focus lifecycle", () => {
  assert.match(provider, /settingsDetailsRef/u);
  assert.match(provider, /details\.open = false/u);
  assert.match(provider, /event\.key !== "Escape"/u);
  assert.match(provider, /document\.addEventListener\("pointerdown", handlePointerDown\)/u);
  assert.match(companion, /document\.body\.style\.overflow = "hidden"/u);
  assert.match(companion, /event\.key !== "Tab"/u);
  assert.match(companion, /questionChoiceTriggerRef\.current\?\.focus\(\)/u);
  assert.match(companion, /ref=\{questionDialogRef\}/u);
});

test("subtitle preference is durable and cue buttons expose a meaningful seek label", () => {
  assert.match(provider, /SUBTITLE_PREFERENCE_KEY = "em-board-audio-subtitles-v1"/u);
  assert.match(provider, /localStorage\.getItem\(SUBTITLE_PREFERENCE_KEY\) === "true"/u);
  assert.match(provider, /localStorage\.setItem\(SUBTITLE_PREFERENCE_KEY, enabled \? "true" : "false"\)/u);
  assert.match(provider, /aria-pressed=\{subtitlesEnabled\}/u);
  assert.match(companion, /aria-label=\{`從 \$\{formatTime\(siteSecondsFromSourceSeconds\(cue\.startSourceSeconds\)\)\} 播放字幕：\$\{cue\.text\}`\}/u);
  assert.match(provider, /aria-label="快進 30 秒"/u);
  assert.doesNotMatch(provider, /(?:Volume2|Maximize2|gainNodeRef|updateVolume)/u);
});

test("player presentation is one feature layer and follows the player design contract", () => {
  assert.equal((css.match(/Audio Player consolidated Section \+ subtitle presentation/gu) ?? []).length, 1);
  for (const oldMarker of [
    "Audio Section Companion",
    "Audio Player final verified feature-layer styling",
    "Audio Player final screenshot polish",
    "Audio Player final input reset",
    "Audio Player final companion finishing rules",
    "Audio Player section-node primitives",
    "Audio Player final runtime presentation",
  ]) assert.doesNotMatch(css, new RegExp(oldMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.doesNotMatch(consolidated, /!important/u);
  assert.doesNotMatch(consolidated, /(?:min|max)-width:\s*(?:700|701|1200)px/u);
  const fontSizes = [...consolidated.matchAll(/font-size:\s*(\d+)px/gu)].map((match) => Number(match[1]));
  assert.ok(fontSizes.length > 0 && fontSizes.every((size) => size >= 12), `sub-12px player text found: ${fontSizes.filter((size) => size < 12).join(",")}`);
  assert.match(consolidated, /@media \(max-width: 600px\)/u);
  assert.match(consolidated, /@media \(pointer: coarse\)/u);
  assert.match(consolidated, /\.audio-section-node,[\s\S]*?pointer-events: none;/u);
  assert.match(consolidated, /\.audio-subtitle-line\s*\{\s*min-height: 44px;/u);
  assert.doesNotMatch(consolidated, /audio-player-(?:volume|fullscreen)/u);
  assert.match(consolidated, /@media \(max-width: 600px\)[\s\S]*?\.audio-player-utilities \{[\s\S]*?display: flex;[\s\S]*?justify-content: flex-end;/u);
});
