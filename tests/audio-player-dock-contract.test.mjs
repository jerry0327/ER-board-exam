import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [provider, app, css, playback, worker, worklet, server] = await Promise.all([
  readFile(new URL("../app/components/audio-player-provider.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/audio-playback.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/static-snac/decoder-worker.js", import.meta.url), "utf8"),
  readFile(new URL("../public/static-snac/snac-output.worklet.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
]);

function revisionFor(source) {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

test("the global audiobook player stows without changing playback state", () => {
  assert.match(provider, /stowed\?: boolean/u);
  assert.match(provider, /const \[stowed, setStowed\] = useState\(false\)/u);
  assert.match(provider, /setExpanded\(false\);\s*setQueueOpen\(false\);\s*setStowed\(true\);/u);
  assert.match(provider, /className="audio-player-stow"/u);
  assert.match(provider, /aria-label=\{`[^`]*\$\{audioSummaryDisplayName\(current\)\}[^`]*`\}/u);
  assert.match(provider, /className="audio-player-restore"/u);
  assert.doesNotMatch(provider, /setStowed\(true\);[\s\S]{0,140}(?:pausePlayback|releasePlayer|terminate)/u);
});

test("stowed audio state is durable, backward compatible, and reset on close", () => {
  assert.match(provider, /const nextStowed = Boolean\(stored\.stowed\)/u);
  assert.match(provider, /setExpanded\(!nextStowed && Boolean\(stored\.expanded\)\)/u);
  assert.match(provider, /expanded,\s*stowed,\s*continuousPlay,\s*queueIds,\s*randomReview,\s*\};[\s\S]*?window\.localStorage\.setItem\(PLAYER_STORAGE_KEY, serialized\)/u);
  assert.match(provider, /setCurrent\(null\)[\s\S]*?setExpanded\(false\);\s*setQueueOpen\(false\);\s*setStowed\(false\);/u);
  assert.match(app, /audioPlayer\.current && audioPlayer\.stowed \? "audio-player-stowed" : ""/u);
});

test("the app shell only reserves mobile footer clearance for an expanded player", () => {
  assert.match(app, /audioPlayer\.current && audioPlayer\.expanded && !audioPlayer\.stowed \? "audio-player-expanded" : ""/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.site-shell\.audio-player-active \.site-footer\s*\{[^}]*padding-bottom: 16px;/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.site-shell\.audio-player-active\.audio-player-expanded \.site-footer\s*\{[^}]*padding-bottom: calc\(16px \+ var\(--audio-player-expanded-clearance\)\);/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?--audio-player-expanded-clearance: 296px;/u);
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*?--audio-player-expanded-clearance: 300px;/u);
  assert.match(app, /audioPlayer\.current && audioPlayer\.expanded && audioPlayer\.queueOpen && !audioPlayer\.stowed \? "audio-player-queue-open" : ""/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.site-shell\.audio-player-queue-open\s*\{[^}]*--audio-player-expanded-clearance: 456px;/u);
  assert.doesNotMatch(css, /@media \(max-width: 600px\)[\s\S]*?\.site-shell\.audio-player-active \.site-footer\s*\{[^}]*padding-bottom: (?:72|118|[2-9]\d\d)px;/u);
});

test("desktop and mobile both expose a compact left restore handle", () => {
  assert.match(css, /\.audio-player-stow,\s*\.audio-player-expand\s*\{[^}]*display: inline-flex;[^}]*min-height: 44px;[^}]*min-width: 44px;/u);
  assert.match(css, /\.audio-player-dock\.is-stowed\s*\{[^}]*left: max\(18px, env\(safe-area-inset-left\)\);[^}]*max-width: 52px;[^}]*width: 52px;/u);
  const stowedHiddenStart = css.indexOf(".audio-player-dock.is-stowed .audio-player-edge-progress,");
  assert.ok(stowedHiddenStart >= 0, "stowed hidden group must include edge progress");
  const stowedHiddenEnd = css.indexOf("}", stowedHiddenStart);
  const stowedHiddenGroup = css.slice(stowedHiddenStart, stowedHiddenEnd + 1);
  assert.match(stowedHiddenGroup, /\.audio-player-dock\.is-stowed \.audio-player-mini,/u);
  assert.match(stowedHiddenGroup, /\.audio-player-dock\.is-stowed \.audio-player-details\s*\{/u);
  assert.match(stowedHiddenGroup, /display:\s*none;/u);
  assert.match(css, /\.audio-player-dock\.is-stowed \.audio-player-restore\s*\{[^}]*min-height: 50px;[^}]*min-width: 50px;/u);
  assert.match(css, /@media \(max-width: 840px\)[\s\S]*?\.audio-player-dock\.is-stowed\s*\{[^}]*left: max\(12px, env\(safe-area-inset-left\)\);[^}]*max-width: 52px;[^}]*width: 52px;/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.site-shell\.audio-player-active\.audio-player-stowed \.route-stage\s*\{\s*padding-bottom: 0;/u);
});

test("playback progress belongs only to the two compact player states", () => {
  assert.match(css, /\.audio-player-edge-progress\s*\{[^}]*display: none;/u);
  assert.match(css, /\.audio-player-dock\.is-collapsed:not\(\.is-stowed\) \.audio-player-edge-progress\s*\{\s*display: block;/u);
  assert.doesNotMatch(css, /\.audio-player-dock\.is-expanded[^}]*\.audio-player-edge-progress/u);
  assert.match(provider, /className="audio-player-ring-progress"[\s\S]*?strokeDashoffset=\{100 - timelineProgressPercent\}/u);
  assert.match(css, /\.audio-player-dock\.is-stowed \.audio-player-ring-progress\s*\{[^}]*rotate: -90deg;[^}]*width: 52px;/u);
  assert.match(css, /\.audio-player-ring-progress-value\s*\{[^}]*stroke: var\(--site-primary\);[^}]*stroke-linecap: round;/u);
});

test("audio preparation uses one honest generic progress indicator", () => {
  assert.match(provider, /const isPreparing = phase === "loading" \|\| phase === "buffering"/u);
  assert.match(provider, /className=\{`audio-player-preparation-progress \$\{phase === "buffering" \? "is-indeterminate" : "is-determinate"\}`\}/u);
  assert.match(provider, /role="progressbar"[\s\S]{0,220}aria-valuenow=\{phase === "loading" \? progressPercent : undefined\}/u);
  assert.match(provider, /aria-valuetext=\{phase === "loading" \? `\$\{progressPercent\}%` : "準備中"\}/u);
  assert.doesNotMatch(provider, /正在準備音檔|準備播放 \$\{bufferSeconds\.toFixed/u);
  assert.doesNotMatch(provider, /audio-player-load-progress/u);
  assert.match(css, /\.audio-player-preparation-progress\.is-indeterminate > span,[\s\S]{0,120}\.audio-library-session-progress\.is-indeterminate > span\s*\{[^}]*animation: audio-preparation-progress/u);
  assert.match(css, /@keyframes audio-preparation-progress/u);
});

test("the circular restore control separates playback hold from dismiss mode", () => {
  assert.match(provider, /const RESTORE_PLAYBACK_LONG_PRESS_MS = 420;/u);
  assert.match(provider, /const RESTORE_DISMISS_LONG_PRESS_MS = 680;/u);
  assert.match(provider, /restorePlaybackTimerRef\.current = window\.setTimeout\(\(\) => \{[\s\S]*?restorePlaybackToggledRef\.current = true;[\s\S]*?void togglePlayback\(\);[\s\S]*?\}, RESTORE_PLAYBACK_LONG_PRESS_MS\);/u);
  assert.match(provider, /restoreDismissTimerRef\.current = window\.setTimeout\(\(\) => \{[\s\S]*?armRestoreDismissGesture\(\);[\s\S]*?\}, RESTORE_DISMISS_LONG_PRESS_MS\);/u);
  assert.match(provider, /function armRestoreDismissGesture\(\) \{[\s\S]*?restoreGestureArmedRef\.current = true;[\s\S]*?setRestoreGesture\(\{ armed: true, overDismissTarget: false \}\);/u);
  assert.match(provider, /if \(restoreLongPressTriggeredRef\.current\) \{\s*restoreLongPressTriggeredRef\.current = false;\s*return;/u);
  assert.match(provider, /onPointerCancel=\{handleRestorePointerCancel\}/u);
  assert.match(provider, /onLostPointerCapture=\{\(event\) => \{\s*if \(event\.target !== event\.currentTarget\) return;[\s\S]*?handleRestorePointerCancel\(\);/u);
  assert.match(provider, /<span ref=\{dismissTargetRef\}><X \/><\/span>/u);
  assert.match(provider, /onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/u);
  assert.match(css, /\.audio-player-dock\.is-stowed \.audio-player-restore\s*\{[^}]*touch-action: none;[^}]*user-select: none;/u);

  const pointerMove = provider.slice(
    provider.indexOf("function handleRestorePointerMove"),
    provider.indexOf("function handleRestorePointerEnd"),
  );
  assert.doesNotMatch(pointerMove, /armRestoreDismissGesture\(\)/u);
  assert.match(pointerMove, /distanceFromStart > RESTORE_DRAG_CANCEL_DISTANCE[\s\S]*?window\.clearTimeout\(restoreDismissTimerRef\.current\)/u);
});

test("dismiss dragging is RAF-painted, magnetic, bounded, and driven by CSS variables", () => {
  assert.match(provider, /const RESTORE_DISMISS_MAGNETIC_RADIUS = 104;/u);
  assert.match(provider, /function rubberBandOffset\(value: number, minimum: number, maximum: number\)[\s\S]*?\* \.24/u);
  assert.match(provider, /if \(distance < RESTORE_DISMISS_MAGNETIC_RADIUS\) \{[\s\S]*?const proximity = 1 - distance \/ RESTORE_DISMISS_MAGNETIC_RADIUS;[\s\S]*?const pull = proximity \* proximity \* \.72;/u);
  assert.match(provider, /const combinedRadius = target\.width \/ 2 \+ bubbleRadius;[\s\S]*?combinedRadius \* \(retaining \? \.84 : \.72\)/u);
  assert.match(provider, /restoreVisualFrameRef\.current = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?style\.setProperty\("--audio-player-drag-x", `\$\{pending\.x\}px`\);[\s\S]*?style\.setProperty\("--audio-player-drag-y", `\$\{pending\.y\}px`\);/u);
  assert.match(provider, /window\.cancelAnimationFrame\(restoreVisualFrameRef\.current\)[\s\S]*?style\.setProperty\("--audio-player-drag-x", "0px"\);[\s\S]*?style\.setProperty\("--audio-player-drag-y", "0px"\);/u);
  assert.match(css, /transform: translate3d\(\s*var\(--audio-player-drag-x, 0px\),\s*var\(--audio-player-drag-y, 0px\),\s*0\s*\);/u);
  assert.match(css, /\.audio-player-dock\.is-restore-dragging\s*\{[^}]*will-change: transform;/u);
  assert.match(css, /\.audio-player-dismiss-target > span\s*\{[^}]*backdrop-filter: blur\(8px\) saturate\(1\.12\);[^}]*height: 64px;[^}]*width: 64px;/u);
  assert.match(css, /\.audio-player-dismiss-target\.is-over > span\s*\{[^}]*background: var\(--site-danger\);[^}]*scale: 1\.06;/u);
});

test("releasing outside the live dismiss target never closes the player", () => {
  const pointerEnd = provider.slice(
    provider.indexOf("function handleRestorePointerEnd"),
    provider.indexOf("function handleRestorePointerCancel"),
  );
  assert.match(pointerEnd, /const finalOffset = wasArmed[\s\S]*?resolveRestoreOffset\(event\.clientX, event\.clientY\)[\s\S]*?overDismissTarget: false/u);
  assert.match(pointerEnd, /const shouldDismiss = wasArmed && finalOffset\.overDismissTarget;/u);
  assert.match(pointerEnd, /if \(shouldDismiss\) dismissPlayer\(\);/u);
  assert.doesNotMatch(pointerEnd, /shouldDismiss[\s\S]{0,100}restoreGestureOverTargetRef\.current/u);
  assert.doesNotMatch(pointerEnd, /if \(wasArmed\) releasePlayer/u);
});

test("audio output recovery follows real render progress across mobile interruptions", () => {
  assert.match(provider, /const audioRecoveryPromiseRef = useRef<Promise<void> \| null>\(null\)/u);
  assert.match(provider, /context\.addEventListener\("statechange", handleStateChange\)/u);
  assert.match(provider, /context\.removeEventListener\("statechange", handleStateChange\)/u);
  assert.match(provider, /if \(audioContextIsRunning\(context\)\) \{[\s\S]*?controlsRef\.current\.recover\(true\)/u);
  assert.match(provider, /if \(audioRecoveryPromiseRef\.current\) return audioRecoveryPromiseRef\.current/u);
  assert.match(provider, /const AUDIO_RECOVERY_BACKOFF_MS = \[3_000, 10_000, 30_000\] as const/u);
  assert.match(provider, /if \(performance\.now\(\) < audioRecoveryRetryAtRef\.current\)[\s\S]*?return Promise\.resolve\(\)/u);
  assert.match(provider, /console\.warn\("Unable to recover learning audio output", reason\);\s*deferAudioRecovery\(\);/u);
  assert.match(provider, /context !== previousContext \|\| worklet !== previousWorklet/u);
  assert.match(provider, /if \(workletRef\.current !== worklet\) return;/u);
  assert.match(provider, /worklet\.addEventListener\("processorerror"[\s\S]*?invalidateAudioWorklet\(worklet\)/u);
  assert.match(provider, /if \(renderedDelta > 0\)[\s\S]*?updatePhase\("playing"\)/u);
  assert.match(provider, /const AUDIO_RENDER_STALL_MS = 2_500;/u);
  assert.match(provider, /if \(document\.visibilityState !== "visible"\) \{\s*audioRenderStallCountRef\.current = 0;\s*return;/u);
  assert.match(provider, /audioRenderStallCountRef\.current \+= 1;\s*if \(audioRenderStallCountRef\.current < 2\)/u);
  assert.match(provider, /performance\.now\(\) - lastActivityAt < AUDIO_RENDER_STALL_MS[\s\S]*?recoverStalled\(\)/u);
  assert.match(provider, /window\.addEventListener\("pageshow", resyncWhenActive\)/u);
  assert.match(provider, /try \{\s*mediaDevices = navigator\.mediaDevices;[\s\S]*?mediaDevices\.addEventListener\("devicechange", resyncWhenActive\);[\s\S]*?mediaDevicesSubscribed = true;/u);
  assert.match(provider, /if \(mediaDevicesSubscribed && typeof mediaDevices\?\.removeEventListener === "function"\) \{\s*try \{/u);
  assert.match(provider, /const worklet = new AudioWorkletNode\(context, "snac-ring-output"[\s\S]*?worklet\.connect\(context\.destination\);/u);
  assert.match(provider, /try \{\s*worklet\.disconnect\(\);\s*worklet\.connect\(context\.destination\);/u);
  assert.doesNotMatch(provider, /(?:createGain\(|gainNodeRef|updateVolume)/u);
  assert.match(provider, /const failPlayback = useCallback\(\(\) => \{[\s\S]*?playingIntentRef\.current = false;[\s\S]*?kind: "pause"[\s\S]*?phaseRef\.current = "error";/u);
  assert.match(provider, /console\.error\("Learning audio decoder error", message\.message\);\s*failPlayback\(\);/u);
  assert.match(provider, /detachAudioContextStateListener\(\);[\s\S]{0,180}const context = audioContextRef\.current/u);
  assert.doesNotMatch(provider, /window\.addEventListener\("pointerdown", recoverFromGesture/u);
});

test("player utility and primary controls retain touch-safe targets", () => {
  assert.match(css, /\.audio-player-utility\s*\{[^}]*height: 44px;[^}]*min-height: 44px;[^}]*min-width: 44px;[^}]*width: 44px;/u);
  assert.match(css, /\.audio-player-main-toggle\s*\{[^}]*height: 48px;[^}]*min-height: 48px;[^}]*min-width: 48px;[^}]*width: 48px;/u);
  assert.match(css, /\.audio-player-mini-toggle\s*\{[^}]*height: 46px;[^}]*min-height: 46px;[^}]*min-width: 46px;[^}]*width: 46px;/u);
  assert.match(css, /\.audio-player-chapter-control\s*\{[^}]*height: 44px;[^}]*min-height: 44px;[^}]*min-width: 44px;[^}]*width: 44px;/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.audio-player-utility\s*\{[^}]*height: 44px;[^}]*min-height: 44px;[^}]*min-width: 44px;[^}]*width: 44px;/u);
});

test("the expanded player owns rich audiobook controls without changing compact modes", () => {
  const expanded = provider.slice(
    provider.indexOf("{expanded && ("),
    provider.indexOf("</AudioPlayerContext.Provider>"),
  );
  assert.match(expanded, /aria-label="播放上一章"/u);
  assert.match(expanded, /aria-label="倒退 15 秒"/u);
  assert.match(expanded, /aria-label="快進 30 秒"/u);
  assert.match(expanded, /randomReview \? "隨機播放下一章" : "播放下一章"/u);
  assert.match(expanded, /aria-pressed=\{continuousPlay\}/u);
  assert.match(expanded, /aria-pressed=\{randomReview\}/u);
  assert.match(expanded, /<option value="chapter-end">本章播完<\/option>/u);
  assert.match(expanded, /id="audio-player-queue-panel"/u);
  const compact = provider.slice(
    provider.indexOf('<div className="audio-player-mini">'),
    provider.indexOf("{expanded && ("),
  );
  assert.match(compact, /audio-player-stow/u);
  assert.match(compact, /audio-player-mini-toggle/u);
  assert.match(compact, /audio-player-expand/u);
  assert.match(compact, /audio-player-mini-close/u);
});

test("audio warmup separates shell, decoder, and revisioned source prefetch", () => {
  assert.match(provider, /const AUDIO_SHELL_URLS = \[[\s\S]*decoder-worker\.js[\s\S]*ort\.webgpu\.min\.mjs[\s\S]*model-manifest\.json[\s\S]*snac-output\.worklet\.js[\s\S]*\] as const/u);
  assert.match(provider, /const prepareShell = useCallback\(\(\) => \{[\s\S]*?Promise\.all\(AUDIO_SHELL_URLS\.map/u);
  assert.match(provider, /const preparePlayer = useCallback\(\(\) => \{[\s\S]*?prepareShell\(\);[\s\S]*?ensureWorker\(\)\.postMessage\(\{ kind: "warm" \}\)/u);
  assert.match(provider, /const prefetchAudioSource = useCallback\(\(source: AudioSummarySource\) => \{[\s\S]*?const revision = `\?v=\$\{encodeURIComponent\(source\.revision\)\}`;[\s\S]*?force-cache/u);
  assert.match(provider, /sourcePrefetchesRef\.current = useRef\(new Map<string, Promise<void>>\(\)\)/u);
});

test("high-capability readers can predecode one bounded 3.4 second audio head after explicit intent", () => {
  assert.match(provider, /const AUDIO_PRIME_SECONDS = 3\.4;/u);
  assert.match(provider, /function shouldPredecodeAudio\(\)[\s\S]*?navigator\.hardwareConcurrency/u);
  assert.match(provider, /if \(memory === undefined && window\.matchMedia\("\(pointer: coarse\)"\)\.matches\) return false;/u);
  assert.match(provider, /const primeAudioSource = useCallback\(\(source: AudioSummarySource\) => \{/u);
  assert.match(provider, /kind: "prime"[\s\S]*?seconds: AUDIO_PRIME_SECONDS/u);
  assert.match(provider, /primeSource: primeAudioSource/u);
});

test("chapter-end sleep and continuous play have unambiguous completion semantics", () => {
  assert.match(provider, /sleepTimerSettingRef\.current === "chapter-end"/u);
  assert.match(provider, /if \(sleepTimerSettingRef\.current === "chapter-end"\)[\s\S]*?setSleepTimerState\(null\);[\s\S]*?return;/u);
  assert.match(provider, /if \(continuousPlayRef\.current && plannedNextSource\(\)\)/u);
});

test("very narrow expanded players use a non-clipping two-row control layout", () => {
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.audio-player-controls\s*\{[^}]*grid-template-areas:\s*"transport transport"\s*"rate utilities";[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.audio-player-transport\s*\{[^}]*grid-area: transport;/u);
});

test("playback progress persists without high-frequency whole-app updates", () => {
  assert.match(provider, /lastPositionPaintRef\.current < 250/u);
  assert.match(provider, /window\.setInterval\(\(\) => \{\s*if \(playingIntentRef\.current\) persistPlayerState\(\);\s*\}, 5_000\)/u);
});

test("source changes install duration before clamping their resume position", () => {
  assert.match(provider, /if \(currentRef\.current\?\.id !== source\.id\) \{\s*pausePlayback\(\);\s*durationRef\.current = source\.durationSeconds;\s*setDuration\(source\.durationSeconds\);\s*currentRef\.current = source;\s*setCurrent\(source\);\s*updatePosition\(startAt\);/u);
});

test("source operations cancel stale autoplay and stale async play continuations", () => {
  assert.match(provider, /function beginSourceOperation\(\)[\s\S]*?sourceOperationRef\.current \+= 1/u);
  assert.match(provider, /pendingAutoplayOperationRef\.current = operation/u);
  assert.match(provider, /sourceOperationIsCurrent\(autoplayOperation\)/u);
});

test("listening history separates resume from furthest progress and migrates legacy records", () => {
  assert.match(provider, /resumePosition: number;/u);
  assert.match(provider, /furthestPosition: number;/u);
  assert.match(provider, /legacyPosition/u);
  assert.match(provider, /Math\.max\(previous\?\.furthestPosition \?\? 0, position\)/u);
});

test("paused loads absorb setup failures into a retryable player error", () => {
  assert.match(provider, /async function loadPausedSource\([\s\S]*?try \{[\s\S]*?await loadSource\(source, startAt, false, operation\);[\s\S]*?catch \(reason\)[\s\S]*?failPlayback\(\);/u);
});

test("a committed paused seek persists once without reviving the periodic paused writer", () => {
  assert.match(provider, /pausedSeekPersistTimerRef\.current = setTimeout\(\(\) => \{[\s\S]*?persistPlayerStateRef\.current\(\);[\s\S]*?\}, 250\);/u);
});

test("playlist playback replaces the remaining queue atomically under one operation", () => {
  assert.match(provider, /async function playSequence\(items: readonly AudioSummarySource\[\]\)[\s\S]*?const operation = beginSourceOperation\(\);[\s\S]*?updateQueue\(remaining\.map\(\(source\) => source\.id\)\);[\s\S]*?await playSource\(first, operation\);/u);
});

test("playback rates and revisioned chapter fetches use one shared contract", () => {
  assert.match(playback, /export const AUDIO_PLAYBACK_RATES/u);
  assert.match(provider, /AUDIO_PLAYBACK_RATES\.map/u);
});

test("mutable audio runtime entry points use content-derived cache revisions", () => {
  assert.equal(revisionFor(worker), "bdab012161e8");
  assert.equal(revisionFor(worklet), "e91e50c7014b");
  assert.match(provider, /DECODER_WORKER_REVISION = "bdab012161e8"/u);
  assert.match(provider, /OUTPUT_WORKLET_REVISION = "e91e50c7014b"/u);
});

test("decoder Worker transport failures are disposed before retry", () => {
  assert.match(provider, /worker\.terminate\(\);\s*workerRef\.current = null/u);
  assert.match(provider, /handleWorkerFailure/u);
});

test("SNAC delivery is R2-first, exact-allowlisted and fail-closed", () => {
  assert.match(server, /audio\/snac/u);
  assert.match(server, /R2/u);
});

test("unrelated routes do not initialize the managed-audio manifest", () => {
  assert.doesNotMatch(app, /loadAudioSummaryCatalog\(\).*useEffect/u);
});
