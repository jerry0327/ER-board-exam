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
  assert.match(css, /\.audio-player-dock\.is-stowed \.audio-player-mini,\s*\.audio-player-dock\.is-stowed \.audio-player-details\s*\{\s*display: none;/u);
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
  assert.match(provider, /worklet\.disconnect\(\);\s*worklet\.connect\(context\.destination\);/u);
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
  assert.doesNotMatch(compact, /連續播放|隨機複習|chapter-end|播放上一章/u);
});

test("audio warmup separates shell, decoder, and revisioned source prefetch", () => {
  assert.match(provider, /const prepareShell = useCallback/u);
  assert.match(provider, /const prefetchAudioSource = useCallback/u);
  assert.match(provider, /const prefetchKey = `\$\{source\.id\}:\$\{source\.revision\}`/u);
  assert.match(provider, /fetch\(url, \{ cache: "force-cache" \}\)/u);
  assert.match(provider, /if \(!shouldSpeculativelyWarmAudio\(\) \|\| sourcePrefetchesRef\.current\.has\(prefetchKey\)\) return/u);
  assert.match(provider, /function shouldSpeculativelyWarmAudio\(\)[\s\S]*?\["slow-2g", "2g"\][\s\S]*?memory === undefined \|\| memory >= 4/u);
  assert.match(provider, /const preparePlayer = useCallback\(\(\) => \{\s*if \(!shouldSpeculativelyWarmAudio\(\)\) return;/u);
  assert.match(provider, /if \(decoderWarmRequestedRef\.current\) return;\s*decoderWarmRequestedRef\.current = true;\s*decoderWarmInFlightRef\.current = true;\s*ensureWorker\(\)\.postMessage\(\{ kind: "warm" \}\)/u);
  assert.match(provider, /decoderWarmInFlightRef\.current[\s\S]*?message\.requestId === undefined[\s\S]*?decoderWarmRequestedRef\.current = false;[\s\S]*?warmup will retry on demand/u);
  assert.doesNotMatch(provider, /if \(currentRef\.current \|\| workerRef\.current\) return/u);
  const dismiss = provider.slice(
    provider.indexOf("function dismissPlayer"),
    provider.indexOf("function releasePlayer"),
  );
  assert.match(dismiss, /releaseAudioOutput\(\);[\s\S]*?scheduleDecoderRetentionRelease\(\);/u);
  assert.doesNotMatch(dismiss, /workerRef\.current\?\.terminate\(\)|releaseDecoderResources\(\)/u);
  const decoderRelease = provider.slice(
    provider.indexOf("function releaseDecoderResources"),
    provider.indexOf("function releaseAudioOutput"),
  );
  assert.match(decoderRelease, /workerRef\.current\?\.terminate\(\);\s*workerRef\.current = null;\s*decoderWarmRequestedRef\.current = false;\s*decoderWarmInFlightRef\.current = false;/u);
  const release = provider.slice(
    provider.indexOf("function releasePlayer"),
    provider.indexOf("const persistPlayerState = useCallback"),
  );
  assert.match(release, /releaseDecoderResources\(\);/u);
  const teardown = provider.slice(provider.indexOf("useEffect(() => () =>"));
  assert.match(teardown, /releaseDecoderResources\(\);/u);
  assert.match(provider, /const DECODER_RETENTION_VISIBLE_MS = 90_000;/u);
  assert.match(provider, /const DECODER_RETENTION_HIDDEN_MS = 10_000;/u);
  assert.match(provider, /const DECODER_RETENTION_LOW_MEMORY_MS = 15_000;/u);
  assert.match(provider, /stored\.collectionId === current\.collectionId/u);
});

test("high-capability readers can predecode one bounded 3.4 second audio head after explicit intent", () => {
  assert.match(provider, /const AUDIO_PRIME_SECONDS = 3\.4;/u);
  assert.match(provider, /function shouldPredecodeAudio\(\)[\s\S]*?!\("gpu" in navigator\)[\s\S]*?memory < 6[\s\S]*?pointer: coarse[\s\S]*?hardwareConcurrency \|\| 1\) >= 6/u);
  assert.match(provider, /const primeAudioSource = useCallback/u);
  assert.match(provider, /kind: "prime",\s*requestId,\s*sourceKey,\s*seconds: AUDIO_PRIME_SECONDS/u);
  assert.match(worker, /const DEFAULT_PRIME_SECONDS = 3\.4;/u);
  assert.match(worker, /const MAX_PRIME_WINDOWS = 4;/u);
  assert.match(worker, /primedPcmByOffset = new Map\(\)/u);
  assert.match(worker, /kind: "primed"/u);
  assert.match(worker, /primedPcmByOffset\.get\(requestedOffset\)/u);
});

test("chapter-end sleep and continuous play have unambiguous completion semantics", () => {
  const finish = provider.slice(
    provider.indexOf("function finishPlayback"),
    provider.indexOf("function requestAudioStart"),
  );
  assert.match(finish, /sleepTimerSettingRef\.current === "chapter-end"[\s\S]*?setSleepTimerState\(null\);\s*return;/u);
  assert.match(finish, /if \(continuousPlayRef\.current && plannedNextSource\(\)\)/u);
  assert.ok(
    finish.indexOf('sleepTimerSettingRef.current === "chapter-end"')
      < finish.indexOf("continuousPlayRef.current && plannedNextSource()"),
  );
});

test("very narrow expanded players use a non-clipping two-row control layout", () => {
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*?\.audio-player-controls\s*\{[^}]*grid-template-areas:\s*"transport transport"\s*"rate utilities";[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/u);
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*?\.audio-player-rate\s*\{[^}]*grid-area: rate;/u);
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*?\.audio-player-transport\s*\{[^}]*grid-area: transport;[^}]*min-width: 0;/u);
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*?\.audio-player-utilities\s*\{[^}]*grid-area: utilities;/u);
});

test("playback progress persists without high-frequency whole-app updates", () => {
  assert.match(provider, /function updatePlaybackPosition\(next: number\)[\s\S]*?positionRef\.current = safe;[\s\S]*?now - lastPositionPaintRef\.current < 250/u);
  assert.match(provider, /window\.setInterval\(\(\) => \{\s*if \(playingIntentRef\.current\) persistPlayerState\(\);\s*\}, 5_000\)/u);
  assert.match(provider, /window\.addEventListener\("pagehide", persistPlayerState\)/u);
  assert.match(provider, /document\.addEventListener\("visibilitychange", saveWhenHidden\)/u);
  assert.match(provider, /if \(phase === "paused"\) persistPlayerState\(\)/u);
  assert.match(provider, /if \(serialized === lastPersistedPlayerStateRef\.current\) return;[\s\S]*?localStorage\.setItem\(PLAYER_STORAGE_KEY, serialized\)/u);
  assert.doesNotMatch(provider, /\}, 700\);[\s\S]{0,120}\[continuousPlay, current, expanded, playbackRate, position/u);
  assert.match(provider, /<span className="sr-only" aria-live="polite">\{liveStatus\}<\/span>/u);
  assert.doesNotMatch(provider, /aria-live="polite">\{status\}/u);
});

test("source changes install duration before clamping their resume position", () => {
  const loadSource = provider.slice(
    provider.indexOf("async function loadSource"),
    provider.indexOf("function savedListeningPosition"),
  );
  const newSourceBranch = loadSource.slice(
    loadSource.indexOf("if (currentRef.current?.id !== source.id)"),
    loadSource.indexOf("} else {"),
  );
  assert.ok(newSourceBranch.indexOf("durationRef.current = source.durationSeconds") >= 0);
  assert.ok(
    newSourceBranch.indexOf("durationRef.current = source.durationSeconds")
      < newSourceBranch.indexOf("updatePosition(startAt)"),
  );
});

test("source operations cancel stale autoplay and stale async play continuations", () => {
  assert.match(provider, /const sourceOperationRef = useRef\(0\)/u);
  assert.match(provider, /function beginSourceOperation\(\) \{[\s\S]*?sourceOperationRef\.current \+= 1;[\s\S]*?pendingAutoplayRef\.current = false;/u);
  assert.match(provider, /async function loadPausedSource\(source: AudioSummarySource\) \{\s*const operation = beginSourceOperation\(\);/u);
  assert.match(provider, /async function playSource\([\s\S]*?operation = beginSourceOperation\(\),[\s\S]*?await ensureAudioOutput\(\);[\s\S]*?!sourceOperationIsCurrent\(operation\)/u);
  assert.match(provider, /async function startFrom\([\s\S]*?operation = sourceOperationRef\.current,[\s\S]*?await ensureAudioOutput\(\);[\s\S]*?!sourceOperationIsCurrent\(operation\)/u);
  assert.match(provider, /pendingAutoplayRef\.current[\s\S]*?sourceOperationIsCurrent\(autoplayOperation\)/u);
  const pausedLoad = provider.slice(
    provider.indexOf("async function loadPausedSource"),
    provider.indexOf("async function playSource"),
  );
  assert.ok(pausedLoad.indexOf("const operation = beginSourceOperation()") >= 0);
  assert.ok(
    pausedLoad.indexOf("const operation = beginSourceOperation()")
      < pausedLoad.indexOf('phaseRef.current === "loading"'),
  );
});

test("listening history separates resume from furthest progress and migrates legacy records", () => {
  assert.match(provider, /type AudioListeningRecord = \{[\s\S]*?resumePosition: number;[\s\S]*?furthestPosition: number;/u);
  assert.match(provider, /const legacyPosition = typeof candidate\.position === "number"[\s\S]*?rawResumePosition[\s\S]*?legacyPosition \?\? candidate\.furthestPosition/u);
  assert.match(provider, /rawFurthestPosition[\s\S]*?legacyPosition \?\? rawResumePosition/u);
  assert.match(provider, /const furthestPosition = completed[\s\S]*?Math\.max\(previous\?\.furthestPosition \?\? 0, position\)/u);
  assert.match(provider, /previous\.resumePosition === resumePosition[\s\S]*?previous\.furthestPosition === furthestPosition[\s\S]*?return;/u);
  assert.match(provider, /if \(!saved \|\| saved\.completed \|\| saved\.resumePosition < 5\) return 0;/u);
});

test("paused loads absorb setup failures into a retryable player error", () => {
  const pausedLoad = provider.slice(
    provider.indexOf("async function loadPausedSource"),
    provider.indexOf("async function playSource"),
  );
  assert.match(pausedLoad, /phaseRef\.current !== "error"/u);
  assert.match(pausedLoad, /try \{[\s\S]*?await loadSource\(source, startAt, false, operation\);[\s\S]*?catch \(reason\)/u);
  assert.match(pausedLoad, /if \(!sourceOperationIsCurrent\(operation\)\) return;[\s\S]*?failPlayback\(\);/u);
});

test("a committed paused seek persists once without reviving the periodic paused writer", () => {
  const seek = provider.slice(
    provider.indexOf("function seekTo"),
    provider.indexOf("function previewSeek"),
  );
  assert.match(seek, /if \(resume\)[\s\S]*?else \{[\s\S]*?recordListeningProgress\(\);/u);
  assert.match(seek, /clearTimeout\(pausedSeekPersistTimerRef\.current\)[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?persistPlayerStateRef\.current\(\);[\s\S]*?\}, 250\)/u);
  assert.match(provider, /persistPlayerStateRef\.current = persistPlayerState;/u);
});

test("playlist playback replaces the remaining queue atomically under one operation", () => {
  assert.match(provider, /playSequence: \(items: readonly AudioSummarySource\[\]\) => Promise<void>/u);
  assert.match(provider, /async function playSequence\(items: readonly AudioSummarySource\[\]\) \{[\s\S]*?const operation = beginSourceOperation\(\);[\s\S]*?updateQueue\(remaining\.map\(\(source\) => source\.id\)\);[\s\S]*?await playSource\(first, operation\);/u);
  assert.match(provider, /playSequence,\s*pause: pausePlayback/u);
});

test("playback rates and revisioned chapter fetches use one shared contract", () => {
  assert.match(playback, /AUDIO_PLAYBACK_RATES = \[1, 1\.2, 1\.5, 1\.8, 2\] as const/u);
  assert.doesNotMatch(playback, /\[0\.8,/u);
  assert.match(provider, /\{AUDIO_PLAYBACK_RATES\.map\(\(rate\) =>/u);
  assert.match(provider, /chapterFile: source\.file,\s*revision: source\.revision,/u);
  assert.match(provider, /expected:\s*\{\s*dataBytes: source\.dataBytes,\s*dataSha256: source\.dataSha256,\s*metadataBytes: source\.metadataBytes,\s*metadataSha256: source\.metadataSha256,/u);
  assert.match(worker, /async function loadChapter\(chapterFile, revision, expected, requestId\)/u);
  assert.match(worker, /Number\.isInteger\(expected\.dataBytes\)[\s\S]{0,180}expected\.metadataSha256/u);
  assert.match(worker, /const versionQuery = revision[\s\S]{0,100}encodeURIComponent\(revision\)/u);
  assert.match(worker, /fetch\(`\$\{chapterBase\}\.snac\.json\$\{versionQuery\}`/u);
  assert.match(worker, /fetch\(`\$\{chapterBase\}\.snac\$\{versionQuery\}`/u);
  assert.match(worker, /loadChapter\(\s*event\.data\.chapterFile,\s*event\.data\.revision,\s*event\.data\.expected,\s*event\.data\.requestId,/u);
  assert.match(worker, /const constrained = connection\?\.saveData[\s\S]*?\["slow-2g", "2g"\][\s\S]*?memory < 4/u);
  assert.match(worker, /const concurrency = constrained \? 1 : Math\.min\(2, manifest\.parts\.length\)/u);
  assert.match(worker, /await Promise\.all\(Array\.from\(\{ length: concurrency \}, fetchNextPart\)\)/u);
});

test("mutable audio runtime entry points use content-derived cache revisions", () => {
  assert.match(
    provider,
    new RegExp(`const DECODER_WORKER_REVISION = "${revisionFor(worker)}"`),
  );
  assert.match(
    provider,
    new RegExp(`const OUTPUT_WORKLET_REVISION = "${revisionFor(worklet)}"`),
  );
  assert.match(provider, /decoder-worker\.js\?v=\$\{DECODER_WORKER_REVISION\}/u);
  assert.match(provider, /snac-output\.worklet\.js\?v=\$\{OUTPUT_WORKLET_REVISION\}/u);
  assert.match(provider, /worker\.addEventListener\("error"/u);
  assert.match(provider, /worker\.addEventListener\("messageerror"/u);
});

test("decoder Worker transport failures are disposed before retry", () => {
  assert.match(provider, /const handleWorkerFailure = \(message: string\) => \{[\s\S]*?if \(workerRef\.current !== worker\) return;[\s\S]*?worker\.terminate\(\);[\s\S]*?workerRef\.current = null;[\s\S]*?workerReadySourceIdRef\.current = null;[\s\S]*?inFlightRef\.current = false;/u);
  assert.match(provider, /if \(workerBootstrapUrlRef\.current === bootstrapUrl\) \{\s*URL\.revokeObjectURL\(bootstrapUrl\);\s*workerBootstrapUrlRef\.current = null;/u);
  assert.match(provider, /worker\.addEventListener\("error",[\s\S]*?handleWorkerFailure/u);
  assert.match(provider, /worker\.addEventListener\("messageerror",[\s\S]*?handleWorkerFailure/u);
  assert.match(provider, /if \(workerRef\.current\) return workerRef\.current;[\s\S]*?const bootstrapUrl = URL\.createObjectURL/u);
});

test("SNAC delivery is R2-first, exact-allowlisted and fail-closed", () => {
  assert.match(server, /function optionalDefaultEdgeCache\(\)[\s\S]*?try[\s\S]*?\.caches\?\.default \?\? null[\s\S]*?catch[\s\S]*?return null;/u);
  assert.match(server, /async function matchOptionalEdgeCache\([\s\S]*?catch[\s\S]*?return null;/u);
  assert.match(server, /function putOptionalEdgeCache\([\s\S]*?cache\.put\(key, response\)\.catch\(\(\) => undefined\)[\s\S]*?catch/u);
  assert.match(server, /async function readValidatedR2Object\([\s\S]*?entry\.r2Key\.startsWith\(MANAGED_AUDIO_NAMESPACE\)[\s\S]*?catch[\s\S]*?return null;/u);
  assert.match(server, /const edgeCache = optionalDefaultEdgeCache\(\)/u);
  assert.match(server, /const cached = await matchOptionalEdgeCache\(edgeCache, edgeCacheKey\)/u);
  assert.match(server, /putOptionalEdgeCache\(edgeCache, edgeCacheKey, response\.clone\(\), ctx\)/u);
  assert.doesNotMatch(server, /\(caches as CacheStorage[^\n]*\)\.default/u);
  assert.match(server, /decodedPath = decodeURIComponent\(url\.pathname\)[\s\S]*?managedAudioPath[\s\S]*?managedRuntimePath/u);
  assert.match(server, /const r2Response = await serveManagedAssetFromR2\(request, env, ctx, entry\);[\s\S]*?const staticResponse = await serveManagedAssetFromStatic\(request, env, entry\);[\s\S]*?status: 503/u);
  assert.doesNotMatch(server, /searchParams\.get\("__asset_source"\)/u);
});

test("unrelated routes do not initialize the managed-audio manifest", () => {
  assert.doesNotMatch(server, /^import \{[\s\S]*?MANAGED_AUDIO_ASSET_ROWS[\s\S]*?\} from "\.\/managed-audio-manifest\.generated";/mu);
  assert.match(server, /function loadManagedAudioState\(\)[\s\S]*?import\("\.\/managed-audio-manifest\.generated"\)/u);
  assert.match(server, /const classified = classifyManagedAssetPath\(new URL\(request\.url\)\);[\s\S]*?state = await loadManagedAudioState\(\)/u);
  assert.match(server, /if \(!operatorRoute\) return null;[\s\S]*?if \(!await operatorTokenMatches[\s\S]*?state = await loadManagedAudioState\(\)/u);
});
