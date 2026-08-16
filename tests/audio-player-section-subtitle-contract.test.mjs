import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [companion, provider, events, css, learningAudio, readerView] = await Promise.all([
  readFile(new URL("../app/components/audio-section-companion.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/audio-player-provider.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/audio-player-section-events.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  readFile(new URL("../app/hooks/use-learning-audio.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
]);

const marker = "/* Original player skeleton: Section, subtitle and Settings enhancements only. */";
const markerIndex = css.indexOf(marker);
assert.ok(markerIndex >= 0, "original-skeleton enhancement CSS marker must exist");
const enhancementStart = css.lastIndexOf("@layer site-features", markerIndex);
const enhancement = css.slice(enhancementStart);

test("Section and subtitle runtime stays revision-safe and shares player-time seek helpers", () => {
  assert.match(companion, /sourceRevision: string;/u);
  assert.match(companion, /SECTION_BUNDLE_CACHE_LIMIT = 6/u);
  assert.match(companion, /while \(sectionBundleRequests\.size > SECTION_BUNDLE_CACHE_LIMIT\)/u);
  assert.match(companion, /rememberSectionBundleRequest\(key, existing\)/u);
  assert.match(companion, /rememberSectionBundleRequest\(key, pending\)/u);
  assert.match(companion, /scopeHasPlaybackIntent = player\.isPlaying/u);
  assert.match(companion, /scopeIsRendering = player\.phase === "playing"/u);
  assert.match(companion, /if \(!activeScope \|\| !scopeIsRendering\) return;/u);
  assert.doesNotMatch(companion, /scopeIsPlaying/u);
  assert.match(companion, /bundle\.sourceRevision === currentSource\.revision/u);
  assert.match(companion, /scope\.sourceRevision === currentSource\.revision/u);
  assert.match(companion, /currentSubtitleCueAt\(activeBundle\.runtime\.subtitle, player\.position\)/u);
  assert.match(companion, /siteSecondsFromSourceSeconds\(cue\.startSourceSeconds\)/u);
  assert.match(companion, /playerSecondsForChapter\(chapter\)/u);
  assert.match(companion, /requestAnimationFrame\(\(\) => setSectionOpen\(false\)\)/u);
  assert.match(companion, /questions\.find\(\(chapter\) => questionNumber\(chapter\.title\) === number\)/u);
  assert.match(companion, /audio-section-inline-title/u);
  assert.match(companion, /currentTitle \?\? "段落"/u);
});

test("Section enhancements mount into a dedicated slot without replacing the original player skeleton", () => {
  assert.match(provider, /audio-player-time-current[\s\S]*?audio-section-inline-slot[\s\S]*?audio-player-time-duration/u);
  assert.match(companion, /document\.querySelector<HTMLElement>\("\.audio-section-inline-slot"\)/u);
  assert.doesNotMatch(provider, /className="audio-section-slot"/u);
  assert.match(provider, /<label className="audio-player-rate">[\s\S]*?<div className="audio-player-transport" role="group" aria-label="播放控制">[\s\S]*?<div className="audio-player-utilities">/u);
  assert.match(provider, /className="audio-player-stow"/u);
  assert.match(provider, /className="audio-player-restore"/u);
  assert.match(provider, /className="audio-player-edge-progress"/u);
  assert.doesNotMatch(enhancement, /(?:^|\n)\s*\.audio-player-dock(?:\.is-(?:expanded|collapsed|stowed))?\s*(?:,|\{)/u);
  assert.doesNotMatch(enhancement, /\.audio-player-mini\s*\{/u);
  assert.doesNotMatch(enhancement, /\.audio-player-details\s*\{/u);
});

test("Section menu renders canonical L1 and nested L2 navigation", () => {
  assert.match(companion, /chapter\.children\.map\(\(child\) =>/u);
  assert.match(companion, /audio-section-list-l1/u);
  assert.match(companion, /audio-section-list-l2/u);
  assert.match(companion, /audio-section-sublist/u);
  assert.match(companion, /seekChapter\(child\)/u);
  assert.match(companion, /playerSecondsForChapter\(child\)/u);
  assert.match(companion, /currentPositionChapter\?\.l2/u);
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

test("Settings and anchored question-choice menu support dismissal and focus lifecycle", () => {
  assert.match(provider, /settingsDetailsRef/u);
  assert.match(provider, /details\.open = false/u);
  assert.match(provider, /event\.key !== "Escape"/u);
  assert.match(provider, /document\.addEventListener\("pointerdown", handlePointerDown\)/u);
  assert.doesNotMatch(companion, /document\.body\.style\.overflow = "hidden"/u);
  assert.doesNotMatch(companion, /event\.key !== "Tab"/u);
  assert.doesNotMatch(companion, /audio-question-choice-backdrop/u);
  assert.match(companion, /audio-question-choice-popover/u);
  assert.match(companion, /role="menu"/u);
  assert.match(companion, /window\.addEventListener\("scroll", handleViewportChange, true\)/u);
  assert.match(events, /type QuestionAudioChoiceEventDetail/u);
  assert.match(learningAudio, /event\?\.currentTarget instanceof HTMLElement/u);
  assert.match(learningAudio, /requestQuestionAudioChoice\([\s\S]*?clickedTrigger/u);
  assert.match(companion, /request\.trigger instanceof HTMLElement/u);
  assert.match(readerView, /function openQuestionAudio\(event: ReactMouseEvent<HTMLButtonElement>\)/u);
  assert.match(readerView, /openQuestionAudioPlayer\(event\)/u);
  assert.match(readerView, /className="reading-toolbar-audio"[\s\S]*?onClick=\{openQuestionAudio\}/u);
  assert.match(readerView, /className="guide-audio-action"[\s\S]*?onClick=\{openQuestionAudio\}/u);
  assert.match(companion, /preferredLeft = anchor\.left \+ anchor\.width \/ 2 - menuBox\.width \/ 2/u);
  assert.match(companion, /const top = anchor\.bottom \+ gap/u);
  assert.match(companion, /questionChoiceTriggerRef\.current\?\.focus\(\)/u);
  assert.match(companion, /ref=\{questionDialogRef\}/u);
});

test("mobile player uses one symmetric control rail and moves destructive close into Settings", () => {
  assert.match(css, /Player finishing pass v3/u);
  assert.match(css, /grid-template-columns:\s*44px 50px 56px 50px 44px;/u);
  assert.match(css, /\.audio-player-rate\s*\{[^}]*grid-column:\s*2;/u);
  assert.match(css, /\.audio-player-secondary-left \.audio-player-reset\s*\{[^}]*grid-column:\s*3;/u);
  assert.match(css, /\.audio-player-settings\s*\{[^}]*grid-column:\s*4;/u);
  assert.match(css, /\.audio-player-close\s*\{\s*display:\s*none;/u);
  assert.match(provider, /className="audio-player-settings-dismiss"[\s\S]*?<span>關閉播放器<\/span>/u);
});

test("expanded timeline is a clean progress surface without permanent chapter ticks", () => {
  assert.doesNotMatch(companion, /audio-section-node-tooltip/u);
  assert.doesNotMatch(companion, /className=\{`audio-section-node/u);
  assert.match(companion, /audio-section-track-base/u);
  assert.match(companion, /audio-section-track-progress/u);
  assert.match(companion, /audio-section-playhead/u);
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

test("advanced playback options live only in Settings while the original transport remains visible", () => {
  const detailsStart = provider.indexOf('<div id="learning-audio-details" className="audio-player-details">');
  const detailsEnd = provider.indexOf('{error && (', detailsStart);
  const details = provider.slice(detailsStart, detailsEnd);
  assert.match(details, /<details[\s\S]*?className="audio-player-settings"/u);
  assert.match(details, /className="audio-player-settings-panel"[\s\S]*?睡眠計時[\s\S]*?字幕[\s\S]*?連續播放[\s\S]*?隨機複習[\s\S]*?接下來/u);
  assert.doesNotMatch(details, /<div className="audio-player-options" role="group" aria-label="播放選項">[\s\S]*?<\/div>\s*<\/div>\s*\{error/u);
  assert.match(details, /aria-label="播放上一章"[\s\S]*?aria-label="倒退 15 秒"[\s\S]*?audio-player-main-toggle[\s\S]*?aria-label="快進 30 秒"[\s\S]*?"播放下一章"/u);
});

test("incremental presentation follows the design contract without redefining the player shell", () => {
  assert.equal((css.match(/Original player skeleton: Section, subtitle and Settings enhancements only\./gu) ?? []).length, 1);
  assert.doesNotMatch(css, /Audio Player consolidated Section \+ subtitle presentation/u);
  assert.doesNotMatch(enhancement, /!important/u);
  assert.doesNotMatch(enhancement, /(?:min|max)-width:\s*(?:700|701|1200)px/u);
  const fontSizes = [...enhancement.matchAll(/font-size:\s*(\d+)px/gu)].map((match) => Number(match[1]));
  assert.ok(fontSizes.length > 0 && fontSizes.every((size) => size >= 12), `sub-12px enhancement text found: ${fontSizes.filter((size) => size < 12).join(",")}`);
  assert.match(enhancement, /@media \(max-width: 600px\)/u);
  assert.match(enhancement, /@media \(pointer: coarse\)/u);
  assert.doesNotMatch(companion, /className=\{`audio-section-node/u);
  assert.match(companion, /className="audio-section-node-layer" aria-hidden="true"/u);
  assert.match(enhancement, /\.audio-section-track-base,\s*\.audio-section-track-progress/u);
  assert.doesNotMatch(enhancement, /audio-player-(?:volume|fullscreen)/u);
  const settingsOptionsStart = enhancement.indexOf(".audio-player-settings-panel .audio-player-options");
  assert.ok(settingsOptionsStart >= 0, "Settings options selector must exist");
  const settingsOptionsEnd = enhancement.indexOf("}", settingsOptionsStart);
  const settingsOptionsBlock = enhancement.slice(settingsOptionsStart, settingsOptionsEnd + 1);
  assert.match(settingsOptionsBlock, /display:\s*grid;/u);
  assert.match(enhancement, /\.audio-subtitle-float\s*\{/u);
});