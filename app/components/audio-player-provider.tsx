"use client";

import {
  Captions,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Headphones,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  RotateCw,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Timer,
  Volume2,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  adjacentAudioSummary,
  audioSummaryDisplayMarker,
  audioSummaryDisplayName,
  audioSummaryDisplayTitle,
  audioSummaryForId,
  hasAlternativeAudioSummary,
  loadAudioSummaryCatalog,
  randomAudioSummary,
  type AudioSummarySource,
} from "../lib/audio-summaries";
import {
  AUDIO_PLAYBACK_RATES,
  encodedSecondsFromSiteSeconds,
  siteSecondsFromEncodedSeconds,
  transportPlaybackRate,
  validAudioPlaybackRate,
} from "../lib/audio-playback";
import { QUESTION_BANK_READY_ATTRIBUTE, QUESTION_BANK_READY_EVENT } from "../lib/app-readiness";
import { AUDIO_PLAYER_SETTINGS_OPEN_EVENT } from "../lib/audio-player-section-events";

const SAMPLE_RATE = 24_000;
const FINE_FRAME_SAMPLES = 512;
const HOP_FINE_FRAMES = 40;
const WINDOW_FINE_FRAMES = 48;
const MAX_BUFFER_SECONDS = 10;
const AUDIO_RENDER_STALL_MS = 2_500;
const AUDIO_RECOVERY_BACKOFF_MS = [3_000, 10_000, 30_000] as const;
const AUDIO_PRIME_SECONDS = 3.4;
const DECODER_RETENTION_VISIBLE_MS = 90_000;
const DECODER_RETENTION_HIDDEN_MS = 10_000;
const DECODER_RETENTION_LOW_MEMORY_MS = 15_000;
const RESTORE_PLAYBACK_LONG_PRESS_MS = 420;
const RESTORE_DISMISS_LONG_PRESS_MS = 680;
const RESTORE_DRAG_CANCEL_DISTANCE = 12;
const RESTORE_DISMISS_MAGNETIC_RADIUS = 104;
const DECODER_WORKER_REVISION = "bdab012161e8";
const OUTPUT_WORKLET_REVISION = "e91e50c7014b";
const PLAYER_STORAGE_KEY = "em-board-audio-player-v2";
const LEGACY_PLAYER_STORAGE_KEY = "em-board-audio-player-v1";
const LISTENING_HISTORY_STORAGE_KEY = "em-board-audio-listening-history-v1";
const SUBTITLE_PREFERENCE_KEY = "em-board-audio-subtitles-v1";
const AUDIO_SHELL_URLS = [
  `/static-snac/decoder-worker.js?v=${DECODER_WORKER_REVISION}`,
  "/static-snac/ort.webgpu.min.mjs?v=46988a5a025f",
  "/static-snac/model-manifest.json?v=e713dc34ba7e",
  `/static-snac/snac-output.worklet.js?v=${OUTPUT_WORKLET_REVISION}`,
] as const;

type PlayerPhase =
  | "idle"
  | "loading"
  | "ready"
  | "buffering"
  | "playing"
  | "paused"
  | "error";

type AudioSleepTimer = 15 | 30 | 45 | 60 | "chapter-end" | null;

type RestoreGestureVisual = {
  armed: boolean;
  overDismissTarget: boolean;
};

const IDLE_RESTORE_GESTURE: RestoreGestureVisual = {
  armed: false,
  overDismissTarget: false,
};

function rubberBandOffset(value: number, minimum: number, maximum: number) {
  if (value < minimum) return minimum + (value - minimum) * .24;
  if (value > maximum) return maximum + (value - maximum) * .24;
  return value;
}

type ReadyMessage = {
  kind: "ready";
  requestId: number;
  backend: "webgpu" | "wasm";
  duration: number;
  fineFrames: number;
};

type DecodedMessage = {
  kind: "decoded";
  generation: number;
  decodeMs: number;
  pcm: ArrayBuffer;
};

type PrimedMessage = {
  kind: "primed";
  requestId: number;
  sourceKey: string;
  backend: "webgpu" | "wasm";
  seconds: number;
  windows: number;
};

type WorkerMessage =
  | ReadyMessage
  | DecodedMessage
  | PrimedMessage
  | { kind: "warmed"; backend: "webgpu" | "wasm" }
  | { kind: "progress"; loadedBytes: number; totalBytes: number }
  | {
      kind: "error";
      message: string;
      requestId?: number;
      generation?: number;
    };

type WorkletMessage =
  | {
      kind: "stats";
      generation: number;
      bufferedFrames: number;
      renderedFrames: number;
    }
  | {
      kind: "error";
      generation: number;
      message: string;
    };

type StoredPlayerState = {
  sourceId: string;
  position: number;
  rate: number;
  expanded: boolean;
  stowed?: boolean;
  continuousPlay?: boolean;
  queueIds?: string[];
  randomReview?: boolean;
};

function normalizeStoredPlayerState(value: unknown): StoredPlayerState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StoredPlayerState>;
  if (typeof candidate.sourceId !== "string" || !candidate.sourceId.trim()) return null;
  const position = typeof candidate.position === "number" && Number.isFinite(candidate.position)
    ? Math.max(0, candidate.position)
    : 0;
  const queueIds = Array.isArray(candidate.queueIds)
    ? [...new Set(candidate.queueIds.filter((id): id is string => typeof id === "string" && Boolean(id)))].slice(0, 200)
    : [];
  return {
    sourceId: candidate.sourceId,
    position,
    rate: validAudioPlaybackRate(typeof candidate.rate === "number" ? candidate.rate : 1),
    expanded: candidate.expanded === true,
    stowed: candidate.stowed === true,
    continuousPlay: candidate.continuousPlay !== false,
    queueIds,
    randomReview: candidate.randomReview === true,
  };
}

type AudioListeningRecord = {
  completed: boolean;
  duration: number;
  resumePosition: number;
  furthestPosition: number;
  updatedAt: string;
};

type AudioListeningHistory = Record<string, AudioListeningRecord>;

type AudioPlayerContextValue = {
  current: AudioSummarySource | null;
  phase: PlayerPhase;
  loadProgress: number;
  position: number;
  duration: number;
  playbackRate: number;
  isPlaying: boolean;
  listeningHistory: AudioListeningHistory;
  load: (source: AudioSummarySource) => Promise<void>;
  play: (source: AudioSummarySource) => Promise<void>;
  playSequence: (items: readonly AudioSummarySource[]) => Promise<void>;
  pause: () => void;
  toggle: () => Promise<void>;
  seek: (seconds: number) => void;
  playPrevious: () => Promise<void>;
  playNext: () => Promise<void>;
  hasPrevious: boolean;
  hasNext: boolean;
  setPlaybackRate: (rate: number) => void;
  continuousPlay: boolean;
  setContinuousPlay: (enabled: boolean) => void;
  randomReview: boolean;
  setRandomReview: (enabled: boolean) => void;
  queue: AudioSummarySource[];
  addToQueue: (source: AudioSummarySource) => void;
  removeFromQueue: (sourceId: string) => void;
  moveQueueItem: (sourceId: string, direction: -1 | 1) => void;
  clearQueue: () => void;
  sleepTimer: AudioSleepTimer;
  setSleepTimer: (setting: AudioSleepTimer) => void;
  prepareShell: () => void;
  prefetchSource: (source: AudioSummarySource) => void;
  primeSource: (source: AudioSummarySource) => boolean;
  prepare: () => void;
  openPlayer: () => void;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  stowed: boolean;
  queueOpen: boolean;
  subtitlesEnabled: boolean;
  setSubtitlesEnabled: (enabled: boolean) => void;
};

function readListeningHistory(): AudioListeningHistory {
  try {
    const value = JSON.parse(window.localStorage.getItem(LISTENING_HISTORY_STORAGE_KEY) ?? "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([sourceId, record]) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) return [];
      const candidate = record as Partial<AudioListeningRecord> & { position?: unknown };
      const legacyPosition = typeof candidate.position === "number"
        ? candidate.position
        : null;
      const rawResumePosition = typeof candidate.resumePosition === "number"
        ? candidate.resumePosition
        : legacyPosition ?? candidate.furthestPosition;
      const rawFurthestPosition = typeof candidate.furthestPosition === "number"
        ? candidate.furthestPosition
        : legacyPosition ?? rawResumePosition;
      if (
        typeof rawResumePosition !== "number"
        || typeof rawFurthestPosition !== "number"
        || typeof candidate.duration !== "number"
        || typeof candidate.completed !== "boolean"
        || typeof candidate.updatedAt !== "string"
      ) return [];
      const duration = Math.max(0, candidate.duration);
      const resumePosition = Math.max(
        0,
        Math.min(duration || Number.MAX_SAFE_INTEGER, rawResumePosition),
      );
      const furthestPosition = Math.max(
        resumePosition,
        Math.min(duration || Number.MAX_SAFE_INTEGER, rawFurthestPosition),
      );
      return [[sourceId, {
        completed: candidate.completed,
        duration,
        resumePosition,
        furthestPosition,
        updatedAt: candidate.updatedAt,
      } satisfies AudioListeningRecord]];
    }));
  } catch {
    return {};
  }
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function requiredPrebufferSeconds(rate: number) {
  if (rate >= 2) return 4;
  if (rate >= 1.5) return 2.5;
  return 1.5;
}

function audioContextIsRunning(context: AudioContext | null) {
  return Boolean(context && String(context.state) === "running");
}

function encodedAudioPath(file: string) {
  return file.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function shouldSpeculativelyWarmAudio() {
  if (document.visibilityState !== "visible") return false;
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
      deviceMemory?: number;
    }
  ).connection;
  if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) {
    return false;
  }
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return memory === undefined || memory >= 4;
}

function shouldPredecodeAudio() {
  if (!shouldSpeculativelyWarmAudio() || !("gpu" in navigator)) return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory < 6) return false;
  if (memory === undefined && window.matchMedia("(pointer: coarse)").matches) return false;
  return (navigator.hardwareConcurrency || 1) >= 6;
}

function audioSourceCacheKey(source: AudioSummarySource) {
  return `${source.id}:${source.revision}`;
}

export function useAudioPlayer() {
  const value = useContext(AudioPlayerContext);
  if (!value) throw new Error("Audio player must be used within AudioPlayerProvider.");
  return value;
}

export default function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<AudioSummarySource | null>(null);
  const [phase, setPhase] = useState<PlayerPhase>("idle");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [subtitlesEnabled, setSubtitlesEnabledState] = useState(false);
  const [continuousPlay, setContinuousPlayState] = useState(true);
  const [randomReview, setRandomReviewState] = useState(false);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [sleepTimer, setSleepTimerState] = useState<AudioSleepTimer>(null);
  const [expanded, setExpanded] = useState(false);
  const [stowed, setStowed] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [bufferSeconds, setBufferSeconds] = useState(0);
  const [runtimeBackend, setRuntimeBackend] = useState<"pending" | "webgpu" | "wasm">("pending");
  const [lastDecodeMs, setLastDecodeMs] = useState(0);
  const [error, setError] = useState(false);
  const [listeningHistory, setListeningHistory] = useState<AudioListeningHistory>({});
  const [restoreGesture, setRestoreGesture] = useState<RestoreGestureVisual>(
    IDLE_RESTORE_GESTURE,
  );
  const [queueOpen, setQueueOpen] = useState(false);
  const [randomNextId, setRandomNextId] = useState<string | null>(null);
  const settingsDetailsRef = useRef<HTMLDetailsElement | null>(null);


  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setSubtitlesEnabledState(window.localStorage.getItem(SUBTITLE_PREFERENCE_KEY) === "true");
      } catch {
        // Subtitle preference is optional when storage is unavailable.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);


  useEffect(() => {
    const closeSettings = (restoreFocus: boolean) => {
      const details = settingsDetailsRef.current;
      if (!details?.open) return;
      details.open = false;
      if (restoreFocus) {
        window.requestAnimationFrame(() => details.querySelector<HTMLElement>("summary")?.focus());
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const details = settingsDetailsRef.current;
      const target = event.target;
      if (!details?.open || !(target instanceof Node) || details.contains(target)) return;
      closeSettings(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !settingsDetailsRef.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      closeSettings(true);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (expanded && !stowed) return;
    if (settingsDetailsRef.current) settingsDetailsRef.current.open = false;
  }, [expanded, stowed]);

  const currentRef = useRef<AudioSummarySource | null>(null);
  const listeningHistoryRef = useRef<AudioListeningHistory>({});
  const phaseRef = useRef<PlayerPhase>("idle");
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const playbackRateRef = useRef(1);
  const volumeRef = useRef(1);
  const continuousPlayRef = useRef(true);
  const randomReviewRef = useRef(false);
  const queueIdsRef = useRef<string[]>([]);
  const randomNextIdRef = useRef<string | null>(null);
  const recentRandomIdsRef = useRef<string[]>([]);
  const sleepTimerSettingRef = useRef<AudioSleepTimer>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const decoderWarmRequestedRef = useRef(false);
  const decoderWarmInFlightRef = useRef(false);
  const decoderRetentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primeRequestCounterRef = useRef(0);
  const activePrimeRequestIdRef = useRef<number | null>(null);
  const activePrimeSourceKeyRef = useRef<string | null>(null);
  const pendingPrimeSourceRef = useRef<AudioSummarySource | null>(null);
  const primeAudioSourceRef = useRef<(source: AudioSummarySource) => void>(() => undefined);
  const primedSourceKeyRef = useRef<string | null>(null);
  const userActivatedAudioRef = useRef(false);
  const shellWarmPromiseRef = useRef<Promise<void> | null>(null);
  const sourcePrefetchesRef = useRef(new Map<string, Promise<void>>());
  const workerBootstrapUrlRef = useRef<string | null>(null);
  const workerReadySourceIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioOutputPromiseRef = useRef<Promise<void> | null>(null);
  const audioRecoveryPromiseRef = useRef<Promise<void> | null>(null);
  const audioRecoveryFailureCountRef = useRef(0);
  const audioRecoveryRetryAtRef = useRef(0);
  const audioContextStateCleanupRef = useRef<(() => void) | null>(null);
  const playerLifecycleRef = useRef(0);
  const generationRef = useRef(0);
  const loadRequestRef = useRef(0);
  const sourceOperationRef = useRef(0);
  const pendingAutoplayRef = useRef(false);
  const pendingAutoplayOperationRef = useRef(0);
  const pendingStartAtRef = useRef(0);
  const playingIntentRef = useRef(false);
  const audioStartedRef = useRef(false);
  const inFlightRef = useRef(false);
  const nextFineOffsetRef = useRef(0);
  const maxFineFramesRef = useRef(0);
  const bufferedFramesRef = useRef(0);
  const lastRenderedFramesRef = useRef(0);
  const outputSampleRateRef = useRef(SAMPLE_RATE);
  const lastAudioRenderProgressAtRef = useRef(0);
  const lastAudioStartRequestAtRef = useRef(0);
  const lastAudioResyncAtRef = useRef(0);
  const audioRenderStallCountRef = useRef(0);
  const lastPositionPaintRef = useRef(0);
  const lastMediaSessionPositionRef = useRef(0);
  const lastPersistedPlayerStateRef = useRef<string | null>(null);
  const seekResumeRef = useRef(false);
  const seekTargetRef = useRef(0);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedSeekPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistPlayerStateRef = useRef<() => void>(() => undefined);
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const playerDockRef = useRef<HTMLElement>(null);
  const dismissTargetRef = useRef<HTMLSpanElement>(null);
  const restorePlaybackTimerRef = useRef<number | null>(null);
  const restoreDismissTimerRef = useRef<number | null>(null);
  const restoreVisualFrameRef = useRef<number | null>(null);
  const restoreVisualOffsetRef = useRef({ x: 0, y: 0 });
  const restorePendingVisualRef = useRef<{ x: number; y: number } | null>(null);
  const restorePointerIdRef = useRef<number | null>(null);
  const restorePointerStartRef = useRef({ x: 0, y: 0 });
  const restoreBubbleStartRef = useRef({
    bottom: 0,
    centerX: 0,
    centerY: 0,
    left: 0,
    right: 0,
    top: 0,
  });
  const restoreGestureArmedRef = useRef(false);
  const restoreGestureMovedRef = useRef(false);
  const restoreGestureOverTargetRef = useRef(false);
  const restorePlaybackToggledRef = useRef(false);
  const restoreLongPressTriggeredRef = useRef(false);
  const titleButtonRef = useRef<HTMLButtonElement>(null);
  const messageHandlerRef = useRef<(message: WorkerMessage) => void>(() => undefined);
  const controlsRef = useRef<{
    play: () => Promise<void>;
    pause: () => void;
    recover: (resetBackoff?: boolean) => Promise<void>;
    recoverStalled: () => Promise<void>;
    seek: (seconds: number) => void;
    previous: () => Promise<void>;
    next: () => Promise<void>;
  }>({
    play: async () => undefined,
    pause: () => undefined,
    recover: async () => undefined,
    recoverStalled: async () => undefined,
    seek: () => undefined,
    previous: async () => undefined,
    next: async () => undefined,
  });

  function clearDecoderRetentionTimer() {
    if (decoderRetentionTimerRef.current !== null) {
      clearTimeout(decoderRetentionTimerRef.current);
      decoderRetentionTimerRef.current = null;
    }
  }

  function decoderRetentionDelay() {
    if (document.visibilityState === "hidden") return DECODER_RETENTION_HIDDEN_MS;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (memory !== undefined && memory < 4) return DECODER_RETENTION_LOW_MEMORY_MS;
    return DECODER_RETENTION_VISIBLE_MS;
  }

  function releaseDecoderResources() {
    clearDecoderRetentionTimer();
    workerRef.current?.terminate();
    workerRef.current = null;
    decoderWarmRequestedRef.current = false;
    decoderWarmInFlightRef.current = false;
    activePrimeRequestIdRef.current = null;
    activePrimeSourceKeyRef.current = null;
    pendingPrimeSourceRef.current = null;
    primedSourceKeyRef.current = null;
    workerReadySourceIdRef.current = null;
    inFlightRef.current = false;
    if (workerBootstrapUrlRef.current) {
      URL.revokeObjectURL(workerBootstrapUrlRef.current);
      workerBootstrapUrlRef.current = null;
    }
    releaseAudioOutput();
  }

  function releaseAudioOutput() {
    workletRef.current?.disconnect();
    workletRef.current = null;
    gainNodeRef.current?.disconnect();
    gainNodeRef.current = null;
    detachAudioContextStateListener();
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  }

  function scheduleDecoderRetentionRelease() {
    clearDecoderRetentionTimer();
    if (!workerRef.current) return;
    decoderRetentionTimerRef.current = setTimeout(() => {
      decoderRetentionTimerRef.current = null;
      if (!currentRef.current) releaseDecoderResources();
    }, decoderRetentionDelay());
  }

  const prepareShell = useCallback(() => {
    userActivatedAudioRef.current = true;
    if (shellWarmPromiseRef.current) return;
    if (!shouldSpeculativelyWarmAudio()) return;
    const pending = Promise.all(AUDIO_SHELL_URLS.map(async (url) => {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Audio runtime shell could not preload: ${url}`);
      await response.arrayBuffer();
    })).then(() => undefined);
    shellWarmPromiseRef.current = pending;
    void pending.catch(() => {
      if (shellWarmPromiseRef.current === pending) shellWarmPromiseRef.current = null;
    });
  }, []);

  const prefetchAudioSource = useCallback((source: AudioSummarySource) => {
    const prefetchKey = `${source.id}:${source.revision}`;
    if (!shouldSpeculativelyWarmAudio() || sourcePrefetchesRef.current.has(prefetchKey)) return;
    const base = `/audio/snac/${encodedAudioPath(source.file)}`;
    const revision = `?v=${encodeURIComponent(source.revision)}`;
    const pending = Promise.all([
      `${base}.snac${revision}`,
      `${base}.snac.json${revision}`,
    ].map(async (url) => {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Audio chapter could not preload: ${source.id}`);
      await response.arrayBuffer();
    })).then(() => undefined);
    sourcePrefetchesRef.current.set(prefetchKey, pending);
    void pending.catch(() => {
      if (sourcePrefetchesRef.current.get(prefetchKey) === pending) {
        sourcePrefetchesRef.current.delete(prefetchKey);
      }
    });
  }, []);

  function updatePhase(next: PlayerPhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function detachAudioContextStateListener() {
    audioContextStateCleanupRef.current?.();
    audioContextStateCleanupRef.current = null;
  }

  function markAudioOutputUnavailable() {
    audioStartedRef.current = false;
    if (
      playingIntentRef.current
      && currentRef.current
      && phaseRef.current !== "loading"
      && phaseRef.current !== "error"
    ) {
      updatePhase("buffering");
    }
  }

  function resetAudioRecoveryBackoff() {
    audioRecoveryFailureCountRef.current = 0;
    audioRecoveryRetryAtRef.current = 0;
  }

  function deferAudioRecovery() {
    const failureIndex = Math.min(
      audioRecoveryFailureCountRef.current,
      AUDIO_RECOVERY_BACKOFF_MS.length - 1,
    );
    audioRecoveryFailureCountRef.current += 1;
    // Called only from transport recovery events, never during render.
    // eslint-disable-next-line react-hooks/purity
    audioRecoveryRetryAtRef.current = performance.now()
      + AUDIO_RECOVERY_BACKOFF_MS[failureIndex];
  }

  function invalidateAudioWorklet(worklet: AudioWorkletNode) {
    if (workletRef.current !== worklet) return false;
    generationRef.current += 1;
    inFlightRef.current = false;
    audioStartedRef.current = false;
    worklet.disconnect();
    workletRef.current = null;
    bufferedFramesRef.current = 0;
    lastRenderedFramesRef.current = 0;
    audioRenderStallCountRef.current = 0;
    setBufferSeconds(0);
    markAudioOutputUnavailable();
    return true;
  }

  function attachAudioContextStateListener(context: AudioContext) {
    detachAudioContextStateListener();
    const handleStateChange = () => {
      if (audioContextRef.current !== context) return;
      if (audioContextIsRunning(context)) {
        if (playingIntentRef.current) void controlsRef.current.recover(true);
        return;
      }

      markAudioOutputUnavailable();
      const contextState = String(context.state);
      if (
        playingIntentRef.current
        && (document.visibilityState === "visible" || contextState === "closed")
      ) {
        void controlsRef.current.recover(contextState === "closed");
      }
    };
    context.addEventListener("statechange", handleStateChange);
    audioContextStateCleanupRef.current = () => {
      context.removeEventListener("statechange", handleStateChange);
    };
  }

  function updatePosition(next: number) {
    const safe = Math.max(0, Math.min(durationRef.current || Number.MAX_SAFE_INTEGER, next));
    if (positionRef.current === safe) return;
    positionRef.current = safe;
    setPosition(safe);
  }

  function updatePlaybackPosition(next: number) {
    const safe = Math.max(0, Math.min(durationRef.current || Number.MAX_SAFE_INTEGER, next));
    positionRef.current = safe;
    // Audio worklet messages drive this throttled paint outside render.
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now();
    if (now - lastPositionPaintRef.current < 250) return;
    lastPositionPaintRef.current = now;
    setPosition(safe);
  }

  const recordListeningProgress = useCallback((forceCompleted = false) => {
    if (document.documentElement.hasAttribute("data-audio-scoped-playback")) return;
    const source = currentRef.current;
    if (!source) return;
    const duration = Math.max(0, durationRef.current || source.durationSeconds);
    const position = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, positionRef.current));
    const previous = listeningHistoryRef.current[source.id];
    const completed = forceCompleted
      || Boolean(previous?.completed)
      || (duration > 0 && position / duration >= .92);
    const resumePosition = completed && forceCompleted ? duration : position;
    const furthestPosition = completed
      ? duration
      : Math.max(previous?.furthestPosition ?? 0, position);
    if (!previous && resumePosition <= 0 && furthestPosition <= 0 && !completed) return;
    if (
      previous
      && previous.completed === completed
      && previous.duration === duration
      && previous.resumePosition === resumePosition
      && previous.furthestPosition === furthestPosition
    ) {
      return;
    }
    const next: AudioListeningRecord = {
      completed,
      duration,
      resumePosition,
      furthestPosition,
      updatedAt: new Date().toISOString(),
    };
    const history = { ...listeningHistoryRef.current, [source.id]: next };
    listeningHistoryRef.current = history;
    setListeningHistory(history);
    try {
      window.localStorage.setItem(LISTENING_HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Listening history is best-effort and never blocks playback.
    }
  }, []);

  function beginSourceOperation() {
    sourceOperationRef.current += 1;
    pendingAutoplayRef.current = false;
    pendingAutoplayOperationRef.current = sourceOperationRef.current;
    return sourceOperationRef.current;
  }

  function sourceOperationIsCurrent(operation: number) {
    return operation === sourceOperationRef.current;
  }

  function resetOutput(generation: number) {
    workletRef.current?.port.postMessage({ kind: "reset", generation });
    bufferedFramesRef.current = 0;
    lastRenderedFramesRef.current = 0;
    setBufferSeconds(0);
  }

  function pausePlayback() {
    if (!currentRef.current) return;
    recordListeningProgress();
    playingIntentRef.current = false;
    audioStartedRef.current = false;
    pendingAutoplayRef.current = false;
    workletRef.current?.port.postMessage({
      kind: "pause",
      generation: generationRef.current,
    });
    updatePhase("paused");
  }

  const failPlayback = useCallback(() => {
    playingIntentRef.current = false;
    audioStartedRef.current = false;
    pendingAutoplayRef.current = false;
    inFlightRef.current = false;
    workletRef.current?.port.postMessage({
      kind: "pause",
      generation: generationRef.current,
    });
    setError(true);
    phaseRef.current = "error";
    setPhase("error");
  }, []);

  function updateQueue(nextIds: string[]) {
    const unique = [...new Set(nextIds)].filter((id) => Boolean(audioSummaryForId(id)));
    queueIdsRef.current = unique;
    setQueueIds(unique);
  }

  function setRandomCandidate(sourceId: string | null) {
    randomNextIdRef.current = sourceId;
    setRandomNextId(sourceId);
  }

  function chooseRandomNext() {
    const currentSourceId = currentRef.current?.id;
    const storedCandidate = audioSummaryForId(randomNextIdRef.current);
    if (
      storedCandidate
      && storedCandidate.id !== currentSourceId
      && storedCandidate.collectionId === currentRef.current?.collectionId
    ) {
      return storedCandidate;
    }
    const candidate = randomAudioSummary(currentSourceId, recentRandomIdsRef.current);
    setRandomCandidate(candidate?.id ?? null);
    if (candidate) prefetchAudioSource(candidate);
    return candidate;
  }

  function plannedNextSource() {
    const queued = audioSummaryForId(queueIdsRef.current[0]);
    if (queued) return queued;
    if (randomReviewRef.current) return chooseRandomNext();
    return adjacentAudioSummary(currentRef.current?.id, 1);
  }

  function addToQueue(source: AudioSummarySource) {
    if (source.id === currentRef.current?.id || queueIdsRef.current.includes(source.id)) return;
    updateQueue([...queueIdsRef.current, source.id]);
  }

  function removeFromQueue(sourceId: string) {
    updateQueue(queueIdsRef.current.filter((id) => id !== sourceId));
  }

  function moveQueueItem(sourceId: string, direction: -1 | 1) {
    const index = queueIdsRef.current.indexOf(sourceId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= queueIdsRef.current.length) return;
    const next = [...queueIdsRef.current];
    [next[index], next[target]] = [next[target], next[index]];
    updateQueue(next);
  }

  function updateVolume(value: number) {
    const next = Math.max(0, Math.min(1, value));
    volumeRef.current = next;
    setVolumeState(next);
    const context = audioContextRef.current;
    const gain = gainNodeRef.current;
    if (context && gain) gain.gain.setTargetAtTime(next, context.currentTime, 0.015);
  }

  function connectWorkletToOutput(worklet: AudioWorkletNode, context: AudioContext) {
    let gain = gainNodeRef.current;
    if (!gain || gain.context !== context) {
      gain?.disconnect();
      gain = context.createGain();
      gain.gain.value = volumeRef.current;
      gain.connect(context.destination);
      gainNodeRef.current = gain;
    }
    worklet.disconnect();
    worklet.connect(gain);
  }

  function updateSleepTimer(setting: AudioSleepTimer) {
    if (sleepTimerRef.current !== null) clearTimeout(sleepTimerRef.current);
    sleepTimerRef.current = null;
    const safeSetting = setting === "chapter-end" || [15, 30, 45, 60].includes(Number(setting))
      ? setting
      : null;
    sleepTimerSettingRef.current = safeSetting;
    setSleepTimerState(safeSetting);
    if (!safeSetting || safeSetting === "chapter-end") return;
    sleepTimerRef.current = setTimeout(() => {
      sleepTimerRef.current = null;
      sleepTimerSettingRef.current = null;
      setSleepTimerState(null);
      pausePlayback();
    }, safeSetting * 60_000);
  }

  function finishPlayback() {
    const completedSourceId = currentRef.current?.id;
    playingIntentRef.current = false;
    audioStartedRef.current = false;
    inFlightRef.current = false;
    workletRef.current?.port.postMessage({
      kind: "pause",
      generation: generationRef.current,
    });
    updatePosition(durationRef.current);
    recordListeningProgress(true);
    updatePhase("paused");
    if (sleepTimerSettingRef.current === "chapter-end") {
      sleepTimerSettingRef.current = null;
      setSleepTimerState(null);
      return;
    }
    if (continuousPlayRef.current && plannedNextSource()) {
      window.setTimeout(() => {
        if (currentRef.current?.id === completedSourceId) {
          void playNextSource();
        }
      }, 0);
    }
  }

  function requestAudioStart(worklet: AudioWorkletNode) {
    worklet.port.postMessage({
      kind: "play",
      generation: generationRef.current,
    });
    audioStartedRef.current = true;
    audioRenderStallCountRef.current = 0;
    // Called from a user/media transport event, never during render.
    // eslint-disable-next-line react-hooks/purity
    lastAudioStartRequestAtRef.current = performance.now();
    updatePhase("buffering");
  }

  function maybeStartAudio() {
    if (
      !playingIntentRef.current
      || audioStartedRef.current
      || !audioContextIsRunning(audioContextRef.current)
      || !workletRef.current
      || bufferedFramesRef.current / SAMPLE_RATE
        < requiredPrebufferSeconds(playbackRateRef.current)
    ) {
      return;
    }
    requestAudioStart(workletRef.current);
  }

  const pump = useCallback(() => {
    const worker = workerRef.current;
    if (
      !worker
      || workerReadySourceIdRef.current !== currentRef.current?.id
      || !playingIntentRef.current
      || inFlightRef.current
      || bufferedFramesRef.current / SAMPLE_RATE >= MAX_BUFFER_SECONDS
      || nextFineOffsetRef.current + WINDOW_FINE_FRAMES > maxFineFramesRef.current
    ) {
      return;
    }
    inFlightRef.current = true;
    worker.postMessage({
      kind: "decode",
      generation: generationRef.current,
      fineOffset: nextFineOffsetRef.current,
    });
    nextFineOffsetRef.current += HOP_FINE_FRAMES;
  }, []);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const workerModuleUrl = new URL(
      `/static-snac/decoder-worker.js?v=${DECODER_WORKER_REVISION}`,
      window.location.origin,
    ).href;
    const bootstrapUrl = URL.createObjectURL(new Blob(
      [`import ${JSON.stringify(workerModuleUrl)};`],
      { type: "text/javascript" },
    ));
    const worker = new Worker(bootstrapUrl, {
      type: "module",
      name: "learning-audio",
    });
    worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
      messageHandlerRef.current(event.data);
    });
    const handleWorkerFailure = (message: string) => {
      // A Worker that emitted an error is no longer a safe transport. Remove it
      // before exposing retry so the next attempt creates a fresh Worker and a
      // fresh bootstrap URL instead of posting back into the failed instance.
      if (workerRef.current !== worker) return;
      worker.terminate();
      workerRef.current = null;
      decoderWarmRequestedRef.current = false;
      decoderWarmInFlightRef.current = false;
      activePrimeRequestIdRef.current = null;
      activePrimeSourceKeyRef.current = null;
      pendingPrimeSourceRef.current = null;
      primedSourceKeyRef.current = null;
      workerReadySourceIdRef.current = null;
      inFlightRef.current = false;
      if (workerBootstrapUrlRef.current === bootstrapUrl) {
        URL.revokeObjectURL(bootstrapUrl);
        workerBootstrapUrlRef.current = null;
      }
      console.error("Learning audio worker failure", message);
      failPlayback();
    };
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      handleWorkerFailure(event.message || "Decoder worker could not be loaded.");
    });
    worker.addEventListener("messageerror", () => {
      handleWorkerFailure("Decoder worker returned an unreadable message.");
    });
    workerRef.current = worker;
    workerBootstrapUrlRef.current = bootstrapUrl;
    return worker;
  }, [failPlayback]);

  async function activateAudioOutput() {
    const lifecycle = playerLifecycleRef.current;
    if (String(audioContextRef.current?.state) === "closed") {
      detachAudioContextStateListener();
      const closedWorklet = workletRef.current;
      if (closedWorklet) invalidateAudioWorklet(closedWorklet);
      audioContextRef.current = null;
      bufferedFramesRef.current = 0;
      lastRenderedFramesRef.current = 0;
      setBufferSeconds(0);
    }
    if (audioContextRef.current && workletRef.current) {
      const context = audioContextRef.current;
      if (!audioContextIsRunning(context)) await context.resume();
      if (
        lifecycle !== playerLifecycleRef.current
        || audioContextRef.current !== context
      ) {
        return;
      }
      if (!audioContextIsRunning(context)) {
        throw new Error("Audio output is not active.");
      }
      return;
    }

    const context = audioContextRef.current ?? new AudioContext(
      { latencyHint: "playback", sampleRate: SAMPLE_RATE },
    );
    if (!audioContextRef.current) {
      audioContextRef.current = context;
      attachAudioContextStateListener(context);
    }
    await context.audioWorklet.addModule(
      `/static-snac/snac-output.worklet.js?v=${OUTPUT_WORKLET_REVISION}`,
    );
    if (!audioContextIsRunning(context)) await context.resume();
    if (lifecycle !== playerLifecycleRef.current || audioContextRef.current !== context) {
      if (context.state !== "closed") await context.close().catch(() => undefined);
      return;
    }
    const worklet = new AudioWorkletNode(context, "snac-ring-output", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    connectWorkletToOutput(worklet, context);
    worklet.addEventListener("processorerror", () => {
      if (
        lifecycle !== playerLifecycleRef.current
        || !invalidateAudioWorklet(worklet)
      ) {
        return;
      }
      console.warn("Learning audio output processor stopped; rebuilding output.");
      void controlsRef.current.recover(true).then(() => {
        if (playingIntentRef.current && !workletRef.current) {
          void controlsRef.current.recover(true);
        }
      });
    });
    worklet.port.addEventListener(
      "message",
      (event: MessageEvent<WorkletMessage>) => {
        const message = event.data;
        if (workletRef.current !== worklet) return;
        if (message.generation !== generationRef.current) return;
        if (message.kind === "error") {
          console.error("Audio output error", message.message);
          failPlayback();
          return;
        }

        bufferedFramesRef.current = message.bufferedFrames;
        setBufferSeconds(message.bufferedFrames / SAMPLE_RATE);
        const renderedDelta = Math.max(
          0,
          message.renderedFrames - lastRenderedFramesRef.current,
        );
        lastRenderedFramesRef.current = message.renderedFrames;
        if (playingIntentRef.current) {
          if (renderedDelta > 0) {
            lastAudioRenderProgressAtRef.current = performance.now();
            audioRenderStallCountRef.current = 0;
            if (
              audioStartedRef.current
              && audioContextIsRunning(audioContextRef.current)
              && phaseRef.current !== "playing"
            ) {
              updatePhase("playing");
            }
          }
          updatePlaybackPosition(
            positionRef.current
              + renderedDelta / outputSampleRateRef.current * playbackRateRef.current,
          );
          if (
            positionRef.current >= durationRef.current - 0.08
            || (
              nextFineOffsetRef.current + WINDOW_FINE_FRAMES > maxFineFramesRef.current
              && message.bufferedFrames < 256
            )
          ) {
            finishPlayback();
            return;
          }
          if (audioStartedRef.current && message.bufferedFrames < 256) {
            worklet.port.postMessage({
              kind: "pause",
              generation: generationRef.current,
            });
            audioStartedRef.current = false;
            updatePhase("buffering");
          }
          pump();
        }
      },
    );
    worklet.port.start();
    if (lifecycle !== playerLifecycleRef.current || audioContextRef.current !== context) {
      worklet.disconnect();
      if (context.state !== "closed") await context.close().catch(() => undefined);
      return;
    }
    outputSampleRateRef.current = context.sampleRate;
    workletRef.current = worklet;
    if (!audioContextIsRunning(context)) {
      throw new Error("Audio output is not active.");
    }
  }

  function ensureAudioOutput() {
    if (audioOutputPromiseRef.current) return audioOutputPromiseRef.current;
    const pending = activateAudioOutput();
    audioOutputPromiseRef.current = pending;
    const clearPending = () => {
      if (audioOutputPromiseRef.current === pending) {
        audioOutputPromiseRef.current = null;
      }
    };
    void pending.then(clearPending, clearPending);
    return pending;
  }

  function recoverAudioPlayback(resetBackoff = false) {
    if (resetBackoff) resetAudioRecoveryBackoff();
    if (audioRecoveryPromiseRef.current) return audioRecoveryPromiseRef.current;
    const source = currentRef.current;
    if (!source || !playingIntentRef.current) return Promise.resolve();
    // Recovery is invoked from media lifecycle events, never during render.
    // eslint-disable-next-line react-hooks/purity
    if (performance.now() < audioRecoveryRetryAtRef.current) {
      return Promise.resolve();
    }

    const lifecycle = playerLifecycleRef.current;
    const sourceId = source.id;
    const previousContext = audioContextRef.current;
    const previousWorklet = workletRef.current;
    const pending = (async () => {
      try {
        await ensureAudioOutput();
        if (
          lifecycle !== playerLifecycleRef.current
          || currentRef.current?.id !== sourceId
          || !playingIntentRef.current
        ) {
          return;
        }

        const context = audioContextRef.current;
        const worklet = workletRef.current;
        if (!audioContextIsRunning(context) || !worklet) {
          deferAudioRecovery();
          markAudioOutputUnavailable();
          return;
        }
        resetAudioRecoveryBackoff();

        if (context !== previousContext || worklet !== previousWorklet) {
          if (workerReadySourceIdRef.current === sourceId) {
            await startFrom(positionRef.current, lifecycle);
          }
          return;
        }

        if (audioStartedRef.current) {
          return;
        }

        worklet.port.postMessage({
          kind: "rate",
          generation: generationRef.current,
          rate: transportPlaybackRate(
            playbackRateRef.current,
            source.encodedSpeed,
          ),
        });
        if (bufferedFramesRef.current > 256) {
          requestAudioStart(worklet);
          setError(false);
          pump();
          return;
        }

        markAudioOutputUnavailable();
        maybeStartAudio();
        pump();
      } catch (reason) {
        if (
          lifecycle !== playerLifecycleRef.current
          || currentRef.current?.id !== sourceId
          || !playingIntentRef.current
        ) {
          return;
        }
        console.warn("Unable to recover learning audio output", reason);
        deferAudioRecovery();
        markAudioOutputUnavailable();
      }
    })();
    audioRecoveryPromiseRef.current = pending;
    const clearPending = () => {
      if (audioRecoveryPromiseRef.current === pending) {
        audioRecoveryPromiseRef.current = null;
      }
    };
    void pending.then(clearPending, clearPending);
    return pending;
  }

  async function startFrom(
    seconds: number,
    lifecycle = playerLifecycleRef.current,
    operation = sourceOperationRef.current,
  ) {
    const source = currentRef.current;
    if (!source || workerReadySourceIdRef.current !== source.id) return;
    await ensureAudioOutput();
    if (
      lifecycle !== playerLifecycleRef.current
      || !sourceOperationIsCurrent(operation)
      || currentRef.current?.id !== source.id
    ) return;
    const requested = seconds >= durationRef.current - 0.1 ? 0 : seconds;
    generationRef.current += 1;
    const generation = generationRef.current;
    const encodedSeconds = encodedSecondsFromSiteSeconds(
      Math.max(0, requested),
      source.encodedSpeed,
    );
    const requestedFineFrame = Math.floor(
      encodedSeconds * SAMPLE_RATE
        / FINE_FRAME_SAMPLES
        / HOP_FINE_FRAMES,
    ) * HOP_FINE_FRAMES;
    nextFineOffsetRef.current = Math.min(
      Math.max(0, requestedFineFrame),
      Math.max(0, maxFineFramesRef.current - WINDOW_FINE_FRAMES),
    );
    updatePosition(
      siteSecondsFromEncodedSeconds(
        (nextFineOffsetRef.current + 4) * FINE_FRAME_SAMPLES / SAMPLE_RATE,
        source.encodedSpeed,
      ),
    );
    inFlightRef.current = false;
    playingIntentRef.current = true;
    audioStartedRef.current = false;
    setError(false);
    updatePhase("buffering");
    resetOutput(generation);
    workletRef.current?.port.postMessage({
      kind: "rate",
      generation,
      rate: transportPlaybackRate(
        playbackRateRef.current,
        source.encodedSpeed,
      ),
    });
    pump();
  }

  async function loadSource(
    source: AudioSummarySource,
    startAt: number,
    autoplay: boolean,
    operation: number,
  ) {
    if (!sourceOperationIsCurrent(operation)) return;
    clearDecoderRetentionTimer();
    activePrimeRequestIdRef.current = null;
    activePrimeSourceKeyRef.current = null;
    pendingPrimeSourceRef.current = null;
    if (primedSourceKeyRef.current !== audioSourceCacheKey(source)) {
      primedSourceKeyRef.current = null;
    }
    if (currentRef.current?.id !== source.id) {
      pausePlayback();
      durationRef.current = source.durationSeconds;
      setDuration(source.durationSeconds);
      currentRef.current = source;
      setCurrent(source);
      updatePosition(startAt);
    } else {
      durationRef.current = source.durationSeconds;
      setDuration(source.durationSeconds);
      updatePosition(startAt);
    }
    pendingAutoplayRef.current = autoplay;
    pendingAutoplayOperationRef.current = operation;
    pendingStartAtRef.current = startAt;
    workerReadySourceIdRef.current = null;
    setLoadProgress(0);
    setError(false);
    updatePhase("loading");
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    decoderWarmRequestedRef.current = true;
    ensureWorker().postMessage({
      kind: "load",
      requestId,
      chapterFile: source.file,
      revision: source.revision,
      expected: {
        dataBytes: source.dataBytes,
        dataSha256: source.dataSha256,
        metadataBytes: source.metadataBytes,
        metadataSha256: source.metadataSha256,
      },
    });
  }

  function savedListeningPosition(source: AudioSummarySource) {
    const saved = listeningHistoryRef.current[source.id];
    if (!saved || saved.completed || saved.resumePosition < 5) return 0;
    return Math.min(saved.resumePosition, Math.max(0, source.durationSeconds - 5));
  }

  async function loadPausedSource(source: AudioSummarySource) {
    const operation = beginSourceOperation();
    setStowed(false);
    setExpanded(true);
    try {
      const sameSource = currentRef.current?.id === source.id;
      if (sameSource && playingIntentRef.current) return;
      if (
        sameSource
        && phaseRef.current !== "error"
        && (workerReadySourceIdRef.current === source.id || phaseRef.current === "loading")
      ) {
        return;
      }
      const startAt = sameSource ? positionRef.current : savedListeningPosition(source);
      await loadSource(source, startAt, false, operation);
    } catch (reason) {
      if (!sourceOperationIsCurrent(operation)) return;
      console.error("Unable to load learning audio", reason);
      failPlayback();
    }
  }

  async function playSource(
    source: AudioSummarySource,
    operation = beginSourceOperation(),
  ) {
    const lifecycle = playerLifecycleRef.current;
    try {
      if (!sourceOperationIsCurrent(operation)) return;
      resetAudioRecoveryBackoff();
      if (queueIdsRef.current.includes(source.id)) removeFromQueue(source.id);
      await ensureAudioOutput();
      if (
        lifecycle !== playerLifecycleRef.current
        || !sourceOperationIsCurrent(operation)
      ) return;
      const sameSource = currentRef.current?.id === source.id;
      if (sameSource && playingIntentRef.current) {
        await recoverAudioPlayback(true);
        return;
      }
      if (sameSource && workerReadySourceIdRef.current === source.id) {
        if (bufferedFramesRef.current > 256) {
          playingIntentRef.current = true;
          workletRef.current?.port.postMessage({
            kind: "rate",
            generation: generationRef.current,
            rate: transportPlaybackRate(
              playbackRateRef.current,
              source.encodedSpeed,
            ),
          });
          if (workletRef.current) requestAudioStart(workletRef.current);
          pump();
          return;
        }
        await startFrom(positionRef.current, lifecycle, operation);
        return;
      }
      const startAt = sameSource ? positionRef.current : savedListeningPosition(source);
      if (
        lifecycle !== playerLifecycleRef.current
        || !sourceOperationIsCurrent(operation)
      ) return;
      await loadSource(source, startAt, true, operation);
    } catch (reason) {
      if (
        lifecycle !== playerLifecycleRef.current
        || !sourceOperationIsCurrent(operation)
      ) return;
      console.error("Unable to start learning audio", reason);
      failPlayback();
    }
  }

  async function playSequence(items: readonly AudioSummarySource[]) {
    const unique = [...new Map(items.map((source) => [source.id, source])).values()];
    const [first, ...remaining] = unique;
    if (!first) return;
    const operation = beginSourceOperation();
    updateQueue(remaining.map((source) => source.id));
    await playSource(first, operation);
  }

  async function playAdjacentSource(direction: -1 | 1) {
    const adjacent = adjacentAudioSummary(currentRef.current?.id, direction);
    if (adjacent) await playSource(adjacent);
  }

  async function playNextSource() {
    const queued = audioSummaryForId(queueIdsRef.current[0]);
    if (queued) {
      await playSource(queued);
      return;
    }
    if (randomReviewRef.current) {
      const previousSourceId = currentRef.current?.id;
      const random = chooseRandomNext();
      if (!random) return;
      if (previousSourceId) {
        recentRandomIdsRef.current = [
          previousSourceId,
          ...recentRandomIdsRef.current.filter((id) => id !== previousSourceId),
        ].slice(0, 8);
      }
      setRandomCandidate(null);
      await playSource(random);
      return;
    }
    await playAdjacentSource(1);
  }

  async function togglePlayback() {
    if (playingIntentRef.current) {
      pausePlayback();
      return;
    }
    const source = currentRef.current;
    if (source) await playSource(source);
  }

  function seekTo(seconds: number, resume = playingIntentRef.current) {
    if (seekTimerRef.current !== null) {
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
    seekResumeRef.current = false;
    const target = Math.max(0, Math.min(durationRef.current, seconds));
    if (playingIntentRef.current) pausePlayback();
    updatePosition(target);
    if (resume) {
      void startFrom(target);
    } else {
      generationRef.current += 1;
      inFlightRef.current = false;
      resetOutput(generationRef.current);
      recordListeningProgress();
      if (pausedSeekPersistTimerRef.current !== null) {
        clearTimeout(pausedSeekPersistTimerRef.current);
      }
      pausedSeekPersistTimerRef.current = setTimeout(() => {
        pausedSeekPersistTimerRef.current = null;
        persistPlayerStateRef.current();
      }, 250);
    }
  }

  function previewSeek(seconds: number) {
    if (seekTimerRef.current !== null) clearTimeout(seekTimerRef.current);
    if (!seekResumeRef.current) seekResumeRef.current = playingIntentRef.current;
    if (playingIntentRef.current) pausePlayback();
    const target = Math.max(0, Math.min(durationRef.current, seconds));
    seekTargetRef.current = target;
    updatePosition(target);
    seekTimerRef.current = setTimeout(commitSeekPreview, 220);
  }

  function commitSeekPreview() {
    if (seekTimerRef.current === null) return;
    clearTimeout(seekTimerRef.current);
    seekTimerRef.current = null;
    const resume = seekResumeRef.current;
    seekResumeRef.current = false;
    seekTo(seekTargetRef.current, resume);
  }

  function jumpBy(seconds: number) {
    seekResumeRef.current = false;
    seekTo(positionRef.current + seconds);
  }

  function updatePlaybackRate(rate: number) {
    const next = validAudioPlaybackRate(rate);
    playbackRateRef.current = next;
    setPlaybackRateState(next);
    const source = currentRef.current;
    workletRef.current?.port.postMessage({
      kind: "rate",
      generation: generationRef.current,
      rate: transportPlaybackRate(next, source?.encodedSpeed),
    });
  }

  function updateContinuousPlay(enabled: boolean) {
    continuousPlayRef.current = enabled;
    setContinuousPlayState(enabled);
  }

  function updateRandomReview(enabled: boolean) {
    randomReviewRef.current = enabled;
    setRandomReviewState(enabled);
    setRandomCandidate(null);
    if (enabled) chooseRandomNext();
  }

  const preparePlayer = useCallback(() => {
    if (!shouldSpeculativelyWarmAudio()) return;
    clearDecoderRetentionTimer();
    prepareShell();
    if (decoderWarmRequestedRef.current) return;
    decoderWarmRequestedRef.current = true;
    decoderWarmInFlightRef.current = true;
    ensureWorker().postMessage({ kind: "warm" });
  }, [ensureWorker, prepareShell]);

  const primeAudioSource = useCallback((source: AudioSummarySource) => {
    if (!shouldPredecodeAudio() || currentRef.current) return false;
    const sourceKey = audioSourceCacheKey(source);
    if (
      primedSourceKeyRef.current === sourceKey
      || activePrimeSourceKeyRef.current === sourceKey
    ) return true;
    if (activePrimeRequestIdRef.current !== null) {
      pendingPrimeSourceRef.current = source;
      return true;
    }
    clearDecoderRetentionTimer();
    prepareShell();
    primeRequestCounterRef.current += 1;
    const requestId = -primeRequestCounterRef.current;
    activePrimeRequestIdRef.current = requestId;
    activePrimeSourceKeyRef.current = sourceKey;
    decoderWarmRequestedRef.current = true;
    decoderWarmInFlightRef.current = true;
    ensureWorker().postMessage({
      kind: "prime",
      requestId,
      sourceKey,
      seconds: AUDIO_PRIME_SECONDS,
      chapterFile: source.file,
      revision: source.revision,
      expected: {
        dataBytes: source.dataBytes,
        dataSha256: source.dataSha256,
        metadataBytes: source.metadataBytes,
        metadataSha256: source.metadataSha256,
      },
    });
    return true;
  }, [ensureWorker, prepareShell]);
  useEffect(() => {
    primeAudioSourceRef.current = primeAudioSource;
  }, [primeAudioSource]);

  function clearRestoreLongPressTimers() {
    if (restorePlaybackTimerRef.current !== null) {
      window.clearTimeout(restorePlaybackTimerRef.current);
      restorePlaybackTimerRef.current = null;
    }
    if (restoreDismissTimerRef.current !== null) {
      window.clearTimeout(restoreDismissTimerRef.current);
      restoreDismissTimerRef.current = null;
    }
  }

  function paintRestoreVisual(x: number, y: number) {
    restorePendingVisualRef.current = { x, y };
    if (restoreVisualFrameRef.current !== null) return;
    restoreVisualFrameRef.current = window.requestAnimationFrame(() => {
      restoreVisualFrameRef.current = null;
      const pending = restorePendingVisualRef.current;
      if (!pending) return;
      restorePendingVisualRef.current = null;
      restoreVisualOffsetRef.current = pending;
      playerDockRef.current?.style.setProperty("--audio-player-drag-x", `${pending.x}px`);
      playerDockRef.current?.style.setProperty("--audio-player-drag-y", `${pending.y}px`);
    });
  }

  function resetRestoreVisual() {
    if (restoreVisualFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreVisualFrameRef.current);
      restoreVisualFrameRef.current = null;
    }
    restorePendingVisualRef.current = null;
    restoreVisualOffsetRef.current = { x: 0, y: 0 };
    playerDockRef.current?.style.setProperty("--audio-player-drag-x", "0px");
    playerDockRef.current?.style.setProperty("--audio-player-drag-y", "0px");
  }

  function resetRestoreGesture() {
    clearRestoreLongPressTimers();
    restorePointerIdRef.current = null;
    restoreGestureArmedRef.current = false;
    restoreGestureMovedRef.current = false;
    restoreGestureOverTargetRef.current = false;
    restorePlaybackToggledRef.current = false;
    resetRestoreVisual();
    setRestoreGesture(IDLE_RESTORE_GESTURE);
  }

  function boundedRestoreOffset(clientX: number, clientY: number) {
    const rawX = clientX - restorePointerStartRef.current.x;
    const rawY = clientY - restorePointerStartRef.current.y;
    const bubble = restoreBubbleStartRef.current;
    const margin = 10;
    return {
      x: rubberBandOffset(
        rawX,
        margin - bubble.left,
        window.innerWidth - margin - bubble.right,
      ),
      y: rubberBandOffset(
        rawY,
        margin - bubble.top,
        window.innerHeight - margin - bubble.bottom,
      ),
    };
  }

  function restoreBubbleHitsDismissTarget(
    offsetX: number,
    offsetY: number,
    retaining: boolean,
  ) {
    const target = dismissTargetRef.current?.getBoundingClientRect();
    if (!target) return false;
    const bubble = restoreBubbleStartRef.current;
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    const distance = Math.hypot(
      bubble.centerX + offsetX - targetX,
      bubble.centerY + offsetY - targetY,
    );
    const bubbleRadius = (bubble.right - bubble.left) / 2;
    const combinedRadius = target.width / 2 + bubbleRadius;
    return distance <= combinedRadius * (retaining ? .84 : .72);
  }

  function resolveRestoreOffset(clientX: number, clientY: number) {
    const bounded = boundedRestoreOffset(clientX, clientY);
    const target = dismissTargetRef.current?.getBoundingClientRect();
    let x = bounded.x;
    let y = bounded.y;
    if (target) {
      const bubble = restoreBubbleStartRef.current;
      const targetX = target.left + target.width / 2;
      const targetY = target.top + target.height / 2;
      const bubbleX = bubble.centerX + x;
      const bubbleY = bubble.centerY + y;
      const distance = Math.hypot(bubbleX - targetX, bubbleY - targetY);
      if (distance < RESTORE_DISMISS_MAGNETIC_RADIUS) {
        const proximity = 1 - distance / RESTORE_DISMISS_MAGNETIC_RADIUS;
        const pull = proximity * proximity * .72;
        x += (targetX - bubbleX) * pull;
        y += (targetY - bubbleY) * pull;
      }
    }
    return {
      x,
      y,
      overDismissTarget: restoreBubbleHitsDismissTarget(
        x,
        y,
        restoreGestureOverTargetRef.current,
      ),
    };
  }

  function armRestoreDismissGesture() {
    if (restoreGestureArmedRef.current) return;
    restoreGestureArmedRef.current = true;
    restoreLongPressTriggeredRef.current = true;
    setRestoreGesture({ armed: true, overDismissTarget: false });
  }

  function handleRestorePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    clearRestoreLongPressTimers();
    restorePointerIdRef.current = event.pointerId;
    restorePointerStartRef.current = { x: event.clientX, y: event.clientY };
    const bubble = event.currentTarget.getBoundingClientRect();
    restoreBubbleStartRef.current = {
      bottom: bubble.bottom,
      centerX: bubble.left + bubble.width / 2,
      centerY: bubble.top + bubble.height / 2,
      left: bubble.left,
      right: bubble.right,
      top: bubble.top,
    };
    restoreGestureArmedRef.current = false;
    restoreGestureMovedRef.current = false;
    restoreGestureOverTargetRef.current = false;
    restorePlaybackToggledRef.current = false;
    restoreLongPressTriggeredRef.current = false;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    // Starting AudioContext while the pointer event is trusted keeps long-press
    // playback reliable after restoring a paused session on mobile browsers.
    if (!playingIntentRef.current && !audioContextRef.current) {
      void ensureAudioOutput().catch(() => undefined);
    }

    const pointerId = event.pointerId;
    restorePlaybackTimerRef.current = window.setTimeout(() => {
      if (restorePointerIdRef.current !== pointerId) return;
      restorePlaybackTimerRef.current = null;
      restorePlaybackToggledRef.current = true;
      restoreLongPressTriggeredRef.current = true;
      void togglePlayback();
    }, RESTORE_PLAYBACK_LONG_PRESS_MS);
    restoreDismissTimerRef.current = window.setTimeout(() => {
      if (restorePointerIdRef.current !== pointerId) return;
      restoreDismissTimerRef.current = null;
      armRestoreDismissGesture();
    }, RESTORE_DISMISS_LONG_PRESS_MS);
  }

  function handleRestorePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || restorePointerIdRef.current !== event.pointerId) return;
    const rawOffsetX = event.clientX - restorePointerStartRef.current.x;
    const rawOffsetY = event.clientY - restorePointerStartRef.current.y;
    const distanceFromStart = Math.hypot(rawOffsetX, rawOffsetY);

    if (!restoreGestureArmedRef.current) {
      if (distanceFromStart > RESTORE_DRAG_CANCEL_DISTANCE) {
        if (restoreDismissTimerRef.current !== null) {
          window.clearTimeout(restoreDismissTimerRef.current);
          restoreDismissTimerRef.current = null;
        }
        if (!restorePlaybackToggledRef.current) {
          clearRestoreLongPressTimers();
        }
        restoreGestureMovedRef.current = true;
        restoreLongPressTriggeredRef.current = true;
      }
    }
    if (!restoreGestureArmedRef.current) {
      return;
    }

    restoreGestureMovedRef.current = true;
    const resolved = resolveRestoreOffset(event.clientX, event.clientY);
    paintRestoreVisual(resolved.x, resolved.y);
    if (restoreGestureOverTargetRef.current !== resolved.overDismissTarget) {
      restoreGestureOverTargetRef.current = resolved.overDismissTarget;
      setRestoreGesture({ armed: true, overDismissTarget: resolved.overDismissTarget });
    }
  }

  function handleRestorePointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || restorePointerIdRef.current !== event.pointerId) return;
    clearRestoreLongPressTimers();
    const wasArmed = restoreGestureArmedRef.current;
    const finalOffset = wasArmed
      ? resolveRestoreOffset(event.clientX, event.clientY)
      : { x: 0, y: 0, overDismissTarget: false };
    const shouldDismiss = wasArmed && finalOffset.overDismissTarget;
    restorePointerIdRef.current = null;
    restoreGestureArmedRef.current = false;
    restoreGestureOverTargetRef.current = false;
    resetRestoreVisual();
    setRestoreGesture(IDLE_RESTORE_GESTURE);
    if (wasArmed || restoreGestureMovedRef.current || restorePlaybackToggledRef.current) {
      restoreLongPressTriggeredRef.current = true;
    }
    restoreGestureMovedRef.current = false;
    restorePlaybackToggledRef.current = false;
    if (shouldDismiss) dismissPlayer();
  }

  function handleRestorePointerCancel() {
    const suppressClick = restoreLongPressTriggeredRef.current
      || restoreGestureMovedRef.current
      || restorePlaybackToggledRef.current;
    resetRestoreGesture();
    restoreLongPressTriggeredRef.current = suppressClick;
  }

  function clearPlayerState() {
    currentRef.current = null;
    workerReadySourceIdRef.current = null;
    setCurrent(null);
    updateQueue([]);
    updateSleepTimer(null);
    setDuration(0);
    durationRef.current = 0;
    updatePosition(0);
    setExpanded(false);
    setQueueOpen(false);
    setStowed(false);
    setError(false);
    updatePhase("idle");
    try {
      window.localStorage.removeItem(PLAYER_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_PLAYER_STORAGE_KEY);
      lastPersistedPlayerStateRef.current = null;
    } catch {
      // The player remains usable for this visit.
    }
  }

  function dismissPlayer() {
    playerLifecycleRef.current += 1;
    sourceOperationRef.current += 1;
    loadRequestRef.current += 1;
    audioOutputPromiseRef.current = null;
    audioRecoveryPromiseRef.current = null;
    resetAudioRecoveryBackoff();
    resetRestoreGesture();
    if (seekTimerRef.current !== null) {
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
    if (pausedSeekPersistTimerRef.current !== null) {
      clearTimeout(pausedSeekPersistTimerRef.current);
      pausedSeekPersistTimerRef.current = null;
    }
    pausePlayback();
    generationRef.current += 1;
    inFlightRef.current = false;
    pendingAutoplayRef.current = false;
    releaseAudioOutput();
    clearPlayerState();
    // Keep only the decoder Worker/session alive. It is idle and does not
    // consume CPU until a later source load arrives.
    scheduleDecoderRetentionRelease();
  }

  function releasePlayer() {
    playerLifecycleRef.current += 1;
    sourceOperationRef.current += 1;
    loadRequestRef.current += 1;
    audioOutputPromiseRef.current = null;
    audioRecoveryPromiseRef.current = null;
    resetAudioRecoveryBackoff();
    resetRestoreGesture();
    if (seekTimerRef.current !== null) {
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
    if (pausedSeekPersistTimerRef.current !== null) {
      clearTimeout(pausedSeekPersistTimerRef.current);
      pausedSeekPersistTimerRef.current = null;
    }
    pausePlayback();
    generationRef.current += 1;
    releaseDecoderResources();
    clearPlayerState();
  }

  const persistPlayerState = useCallback(() => {
    if (!current) return;
    recordListeningProgress();
    try {
      const stored: StoredPlayerState = {
        sourceId: current.id,
        position: positionRef.current,
        rate: playbackRate,
        expanded,
        stowed,
        continuousPlay,
        queueIds,
        randomReview,
      };
      const serialized = JSON.stringify(stored);
      if (serialized === lastPersistedPlayerStateRef.current) return;
      window.localStorage.setItem(PLAYER_STORAGE_KEY, serialized);
      lastPersistedPlayerStateRef.current = serialized;
    } catch {
      // Playback is not blocked when the browser declines local storage.
    }
  }, [continuousPlay, current, expanded, playbackRate, queueIds, randomReview, recordListeningProgress, stowed]);
  useEffect(() => {
    persistPlayerStateRef.current = persistPlayerState;
  }, [persistPlayerState]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const history = readListeningHistory();
      listeningHistoryRef.current = history;
      setListeningHistory(history);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    messageHandlerRef.current = (message) => {
      if (message.kind === "progress") {
        setLoadProgress(
          Math.min(1, message.loadedBytes / Math.max(1, message.totalBytes)),
        );
        return;
      }
      if (message.kind === "error") {
        if (
          message.requestId !== undefined
          && message.requestId === activePrimeRequestIdRef.current
        ) {
          activePrimeRequestIdRef.current = null;
          activePrimeSourceKeyRef.current = null;
          primedSourceKeyRef.current = null;
          decoderWarmInFlightRef.current = false;
          decoderWarmRequestedRef.current = false;
          scheduleDecoderRetentionRelease();
          const pendingPrime = pendingPrimeSourceRef.current;
          pendingPrimeSourceRef.current = null;
          if (pendingPrime && !currentRef.current) {
            queueMicrotask(() => primeAudioSourceRef.current(pendingPrime));
          }
          console.warn("Learning audio predecode will retry on demand", message.message);
          return;
        }
        if (
          decoderWarmInFlightRef.current
          && message.requestId === undefined
          && message.generation === undefined
        ) {
          decoderWarmInFlightRef.current = false;
          decoderWarmRequestedRef.current = false;
          console.warn("Learning audio decoder warmup will retry on demand", message.message);
          return;
        }
        if (
          (message.requestId !== undefined
            && message.requestId !== loadRequestRef.current)
          || (message.generation !== undefined
            && message.generation !== generationRef.current)
        ) {
          return;
        }
        console.error("Learning audio decoder error", message.message);
        failPlayback();
        return;
      }
      if (message.kind === "warmed") {
        decoderWarmInFlightRef.current = false;
        setRuntimeBackend(message.backend);
        return;
      }
      if (message.kind === "primed") {
        if (message.requestId !== activePrimeRequestIdRef.current) return;
        activePrimeRequestIdRef.current = null;
        activePrimeSourceKeyRef.current = null;
        if (currentRef.current) {
          pendingPrimeSourceRef.current = null;
          return;
        }
        primedSourceKeyRef.current = message.sourceKey;
        decoderWarmInFlightRef.current = false;
        decoderWarmRequestedRef.current = true;
        setRuntimeBackend(message.backend);
        scheduleDecoderRetentionRelease();
        const pendingPrime = pendingPrimeSourceRef.current;
        pendingPrimeSourceRef.current = null;
        if (pendingPrime) queueMicrotask(() => primeAudioSourceRef.current(pendingPrime));
        return;
      }
      if (message.kind === "ready") {
        if (message.requestId !== loadRequestRef.current || !currentRef.current) return;
        workerReadySourceIdRef.current = currentRef.current.id;
        setRuntimeBackend(message.backend);
        maxFineFramesRef.current = message.fineFrames;
        const siteDuration = siteSecondsFromEncodedSeconds(
          message.duration,
          currentRef.current.encodedSpeed,
        );
        durationRef.current = siteDuration;
        setDuration(siteDuration);
        setLoadProgress(1);
        updatePhase("ready");
        const autoplayOperation = pendingAutoplayOperationRef.current;
        if (
          pendingAutoplayRef.current
          && sourceOperationIsCurrent(autoplayOperation)
        ) {
          pendingAutoplayRef.current = false;
          void startFrom(
            pendingStartAtRef.current,
            playerLifecycleRef.current,
            autoplayOperation,
          ).catch((reason) => {
            if (!sourceOperationIsCurrent(autoplayOperation)) return;
            console.error("Unable to start learning audio", reason);
            failPlayback();
          });
        }
        return;
      }
      if (message.generation !== generationRef.current) return;
      inFlightRef.current = false;
      setLastDecodeMs(message.decodeMs);
      bufferedFramesRef.current += HOP_FINE_FRAMES * FINE_FRAME_SAMPLES;
      workletRef.current?.port.postMessage(
        {
          kind: "push",
          generation: message.generation,
          pcm: message.pcm,
        },
        [message.pcm],
      );
      maybeStartAudio();
      pump();
    };
  });

  useEffect(() => {
    controlsRef.current = {
      play: async () => {
        const source = currentRef.current;
        if (!source) return;
        if (playingIntentRef.current) {
          await recoverAudioPlayback(true);
          return;
        }
        await playSource(source);
      },
      pause: pausePlayback,
      recover: recoverAudioPlayback,
      recoverStalled: async () => {
        const stalledWorklet = workletRef.current;
        if (stalledWorklet && invalidateAudioWorklet(stalledWorklet)) {
          await recoverAudioPlayback(true);
          if (playingIntentRef.current && !workletRef.current) {
            await recoverAudioPlayback(true);
          }
        }
      },
      seek: seekTo,
      previous: () => playAdjacentSource(-1),
      next: playNextSource,
    };
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!playingIntentRef.current || !currentRef.current) return;
      if (document.visibilityState !== "visible") {
        audioRenderStallCountRef.current = 0;
        return;
      }
      if (!audioContextIsRunning(audioContextRef.current)) {
        audioStartedRef.current = false;
        audioRenderStallCountRef.current = 0;
        if (phaseRef.current === "playing") {
          phaseRef.current = "buffering";
          setPhase("buffering");
        }
        if (document.visibilityState === "visible") {
          void controlsRef.current.recover();
        }
        return;
      }
      if (!audioStartedRef.current) {
        audioRenderStallCountRef.current = 0;
        return;
      }
      const lastActivityAt = Math.max(
        lastAudioRenderProgressAtRef.current,
        lastAudioStartRequestAtRef.current,
      );
      if (performance.now() - lastActivityAt < AUDIO_RENDER_STALL_MS) {
        audioRenderStallCountRef.current = 0;
        return;
      }
      audioRenderStallCountRef.current += 1;
      if (audioRenderStallCountRef.current < 2) {
        if (phaseRef.current === "playing") {
          phaseRef.current = "buffering";
          setPhase("buffering");
        }
        return;
      }
      audioRenderStallCountRef.current = 0;
      void controlsRef.current.recoverStalled();
    }, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    const readPersistedPlayer = () => {
      let currentStored: string | null = null;
      let legacyStored: string | null = null;
      try {
        currentStored = window.localStorage.getItem(PLAYER_STORAGE_KEY);
        legacyStored = currentStored
          ? null
          : window.localStorage.getItem(LEGACY_PLAYER_STORAGE_KEY);
      } catch {
        return null;
      }
      if (!currentStored && !legacyStored) return null;
      try {
        return {
          legacy: Boolean(legacyStored),
          stored: normalizeStoredPlayerState(JSON.parse(currentStored ?? legacyStored ?? "null")),
        };
      } catch {
        return null;
      }
    };
    const persisted = readPersistedPlayer();
    if (!persisted?.stored) return;
    const stored = persisted.stored;

    const restorePersistedPlayer = () => {
      void loadAudioSummaryCatalog().then(() => {
        if (!active) return;
        try {
          const source = audioSummaryForId(stored.sourceId);
          if (!source) return;
          const nextRate = validAudioPlaybackRate(stored.rate);
          const restoredPosition = persisted.legacy
            ? siteSecondsFromEncodedSeconds(stored.position, source.encodedSpeed)
            : stored.position;
          currentRef.current = source;
          positionRef.current = Math.max(
            0,
            Math.min(source.durationSeconds, restoredPosition),
          );
          durationRef.current = source.durationSeconds;
          playbackRateRef.current = nextRate;
          continuousPlayRef.current = stored.continuousPlay !== false;
          randomReviewRef.current = Boolean(stored.randomReview);
          const restoredQueueIds = (stored.queueIds ?? [])
            .filter((id) => id !== source.id && Boolean(audioSummaryForId(id)));
          queueIdsRef.current = restoredQueueIds;
          phaseRef.current = "paused";
          setCurrent(source);
          setPosition(positionRef.current);
          setDuration(source.durationSeconds);
          setPlaybackRateState(nextRate);
          setContinuousPlayState(continuousPlayRef.current);
          setRandomReviewState(randomReviewRef.current);
          setQueueIds(restoredQueueIds);
          const nextStowed = Boolean(stored.stowed);
          setExpanded(!nextStowed && Boolean(stored.expanded));
          setStowed(nextStowed);
          setPhase("paused");
          if (persisted.legacy) window.localStorage.removeItem(LEGACY_PLAYER_STORAGE_KEY);
        } catch {
          // Start with an empty player when the saved state is unavailable.
        }
      });
    };

    if (document.documentElement.getAttribute(QUESTION_BANK_READY_ATTRIBUTE) === "true") {
      restorePersistedPlayer();
    } else {
      window.addEventListener(QUESTION_BANK_READY_EVENT, restorePersistedPlayer, { once: true });
    }
    return () => {
      active = false;
      window.removeEventListener(QUESTION_BANK_READY_EVENT, restorePersistedPlayer);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(persistPlayerState, 250);
    return () => window.clearTimeout(timer);
  }, [current, persistPlayerState]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!userActivatedAudioRef.current) return;
      if (!current) {
        setRandomCandidate(null);
        return;
      }
      const queued = audioSummaryForId(queueIds[0]);
      if (queued) {
        prefetchAudioSource(queued);
        return;
      }
      if (randomReview) {
        const stored = audioSummaryForId(randomNextIdRef.current);
        const next = stored
          && stored.id !== current.id
          && stored.collectionId === current.collectionId
          ? stored
          : randomAudioSummary(current.id, recentRandomIdsRef.current);
        setRandomCandidate(next?.id ?? null);
        if (next) prefetchAudioSource(next);
        return;
      }
      setRandomCandidate(null);
      const next = adjacentAudioSummary(current.id, 1);
      if (next) prefetchAudioSource(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [current, prefetchAudioSource, queueIds, randomReview]);

  useEffect(() => {
    if (!current) return;
    const interval = window.setInterval(() => {
      if (playingIntentRef.current) persistPlayerState();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [current, persistPlayerState]);

  useEffect(() => {
    if (!current) return;
    const recoverWhenActive = () => {
      if (document.visibilityState !== "visible" || !playingIntentRef.current) return;
      if (
        !audioContextIsRunning(audioContextRef.current)
        || !audioStartedRef.current
      ) {
        void controlsRef.current.recover();
      }
    };
    const resyncWhenActive = () => {
      if (document.visibilityState !== "visible" || !playingIntentRef.current) return;
      const now = performance.now();
      if (now - lastAudioResyncAtRef.current < 600) {
        recoverWhenActive();
        return;
      }
      lastAudioResyncAtRef.current = now;
      const context = audioContextRef.current;
      const worklet = workletRef.current;
      if (context && worklet && audioContextIsRunning(context)) {
        try {
          worklet.disconnect();
          connectWorkletToOutput(worklet, context);
        } catch {
          // A later hard-recovery pass replaces a graph that cannot reconnect.
        }
      }
      audioStartedRef.current = false;
      if (phaseRef.current !== "loading" && phaseRef.current !== "error") {
        phaseRef.current = "buffering";
        setPhase("buffering");
      }
      void controlsRef.current.recover(true);
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        persistPlayerState();
        return;
      }
      resyncWhenActive();
    };
    window.addEventListener("pagehide", persistPlayerState);
    window.addEventListener("pageshow", resyncWhenActive);
    window.addEventListener("focus", recoverWhenActive);
    document.addEventListener("visibilitychange", saveWhenHidden);
    let mediaDevices: MediaDevices | null = null;
    let mediaDevicesSubscribed = false;
    try {
      mediaDevices = navigator.mediaDevices;
      if (typeof mediaDevices?.addEventListener === "function") {
        mediaDevices.addEventListener("devicechange", resyncWhenActive);
        mediaDevicesSubscribed = true;
      }
    } catch {
      mediaDevices = null;
    }
    return () => {
      window.removeEventListener("pagehide", persistPlayerState);
      window.removeEventListener("pageshow", resyncWhenActive);
      window.removeEventListener("focus", recoverWhenActive);
      document.removeEventListener("visibilitychange", saveWhenHidden);
      if (mediaDevicesSubscribed && typeof mediaDevices?.removeEventListener === "function") {
        try {
          mediaDevices.removeEventListener("devicechange", resyncWhenActive);
        } catch {
          // A partial device API must not break application teardown.
        }
      }
    };
  }, [current, persistPlayerState]);

  useEffect(() => {
    if (phase === "paused") persistPlayerState();
  }, [persistPlayerState, phase]);

  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession || typeof mediaSession.setActionHandler !== "function") return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => { void controlsRef.current.play(); }],
      ["pause", () => controlsRef.current.pause()],
      ["stop", () => controlsRef.current.pause()],
      ["previoustrack", () => { void controlsRef.current.previous(); }],
      ["nexttrack", () => { void controlsRef.current.next(); }],
      ["seekbackward", (details) => controlsRef.current.seek(
        positionRef.current - (details.seekOffset ?? 10),
      )],
      ["seekforward", (details) => controlsRef.current.seek(
        positionRef.current + (details.seekOffset ?? 30),
      )],
      ["seekto", (details) => {
        if (typeof details.seekTime === "number") {
          controlsRef.current.seek(details.seekTime);
        }
      }],
    ];
    for (const [action, handler] of handlers) {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported system controls are omitted.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // The browser already released this control.
        }
      }
    };
  }, []);

  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession) return;
    try {
      mediaSession.playbackState = phase === "playing" ? "playing"
        : current ? "paused"
        : "none";
      mediaSession.metadata = current && typeof globalThis.MediaMetadata === "function"
        ? new globalThis.MediaMetadata({
            title: audioSummaryDisplayName(current),
            artist: current.collectionTitle,
            album: "急專補給站",
            artwork: [
              { src: "/brand/jizhuan-rosc-icon-192.png", sizes: "192x192", type: "image/png" },
              { src: "/brand/jizhuan-rosc-icon-512.png", sizes: "512x512", type: "image/png" },
            ],
          })
        : null;
    } catch {
      // Partial WebView Media Session implementations must not unmount the app.
    }
  }, [current, phase]);

  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession || typeof mediaSession.setPositionState !== "function" || !current || duration <= 0) return;
    const now = performance.now();
    if (phase === "playing" && now - lastMediaSessionPositionRef.current < 1_000) return;
    lastMediaSessionPositionRef.current = now;
    try {
      mediaSession.setPositionState({
        duration,
        playbackRate,
        position: Math.min(duration, Math.max(0, position)),
      });
    } catch {
      // Some browsers expose Media Session without position controls.
    }
  }, [current, duration, phase, playbackRate, position]);

  useEffect(() => () => {
    playerLifecycleRef.current += 1;
    sourceOperationRef.current += 1;
    generationRef.current += 1;
    playingIntentRef.current = false;
    audioOutputPromiseRef.current = null;
    audioRecoveryPromiseRef.current = null;
    resetAudioRecoveryBackoff();
    clearRestoreLongPressTimers();
    if (restoreVisualFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreVisualFrameRef.current);
    }
    if (seekTimerRef.current !== null) clearTimeout(seekTimerRef.current);
    if (pausedSeekPersistTimerRef.current !== null) {
      clearTimeout(pausedSeekPersistTimerRef.current);
    }
    releaseDecoderResources();
    if (sleepTimerRef.current !== null) clearTimeout(sleepTimerRef.current);
    // These teardown helpers read only refs; rerunning cleanup on every render
    // would terminate an active player rather than improve dependency safety.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const releaseWhenHidden = () => {
      if (document.visibilityState === "hidden" && !currentRef.current && workerRef.current) {
        scheduleDecoderRetentionRelease();
      }
    };
    document.addEventListener("visibilitychange", releaseWhenHidden);
    return () => document.removeEventListener("visibilitychange", releaseWhenHidden);
    // The scheduler is ref-only and must not churn this document listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  function updateSubtitlesEnabled(enabled: boolean) {
    setSubtitlesEnabledState(enabled);
    try {
      window.localStorage.setItem(SUBTITLE_PREFERENCE_KEY, enabled ? "true" : "false");
    } catch {
      // Keep the in-memory preference when storage is unavailable.
    }
  }

  const queuedSources = queueIds
    .map((id) => audioSummaryForId(id))
    .filter((source): source is AudioSummarySource => Boolean(source));
  const canPlayNext = queueIds.length > 0
    || (randomReview && hasAlternativeAudioSummary(current?.id))
    || Boolean(adjacentAudioSummary(current?.id, 1));
  const value: AudioPlayerContextValue = {
    current,
    phase,
    loadProgress,
    position,
    duration,
    playbackRate,
    isPlaying: phase === "playing" || phase === "buffering",
    listeningHistory,
    load: loadPausedSource,
    play: playSource,
    playSequence,
    pause: pausePlayback,
    toggle: togglePlayback,
    seek: seekTo,
    playPrevious: () => playAdjacentSource(-1),
    playNext: playNextSource,
    hasPrevious: Boolean(adjacentAudioSummary(current?.id, -1)),
    hasNext: canPlayNext,
    setPlaybackRate: updatePlaybackRate,
    continuousPlay,
    setContinuousPlay: updateContinuousPlay,
    randomReview,
    setRandomReview: updateRandomReview,
    queue: queuedSources,
    addToQueue,
    removeFromQueue,
    moveQueueItem,
    clearQueue: () => updateQueue([]),
    sleepTimer,
    setSleepTimer: updateSleepTimer,
    prepareShell,
    prefetchSource: prefetchAudioSource,
    primeSource: primeAudioSource,
    prepare: preparePlayer,
    openPlayer: () => {
      setStowed(false);
      setExpanded(true);
    },
    expanded,
    setExpanded,
    stowed,
    queueOpen,
    subtitlesEnabled,
    setSubtitlesEnabled: updateSubtitlesEnabled,
  };

  const progressPercent = Math.min(100, Math.max(0, Math.round(loadProgress * 100)));
  const timelineProgressPercent = duration > 0
    ? Math.min(100, Math.max(0, position / duration * 100))
    : 0;
  const isPlaybackActive = phase === "playing" || phase === "buffering";
  const isPreparing = phase === "loading" || phase === "buffering";
  const status = error
    ? "目前無法播放，請再試一次"
    : phase === "playing"
      ? "播放中"
      : phase === "paused"
        ? "已暫停"
        : "可播放";
  const accessibleStatus = isPreparing
    ? phase === "loading"
      ? `音檔準備進度 ${progressPercent}%`
      : "音檔準備中"
    : status;
  const liveStatus = error
    ? "播放失敗，請再試一次"
    : phase === "loading"
      ? `音檔準備進度 ${progressPercent}%`
      : phase === "buffering"
        ? "音檔準備中"
        : phase === "playing"
          ? "播放中"
          : phase === "paused"
            ? "已暫停"
            : "可播放";
  const randomNextSource = audioSummaryForId(randomNextId);
  const nextUpSource = queuedSources[0]
    ?? (randomReview
      && randomNextSource?.collectionId === current?.collectionId
      ? randomNextSource
      : null)
    ?? (!randomReview ? adjacentAudioSummary(current?.id, 1) : null);
  const sleepTimerLabel = sleepTimer === "chapter-end"
    ? "本章播完停止"
    : sleepTimer
      ? `${sleepTimer} 分鐘後停止`
      : "睡眠計時";

  return (
    <AudioPlayerContext.Provider value={value}>
      {children}
      {current && stowed && restoreGesture.armed && (
        <div
          className={`audio-player-dismiss-target ${restoreGesture.overDismissTarget ? "is-over" : ""}`.trim()}
          aria-hidden="true"
        >
          <span ref={dismissTargetRef}><X /></span>
        </div>
      )}
      {current && (
        <section
          ref={playerDockRef}
          className={`audio-player-dock ${expanded ? "is-expanded" : "is-collapsed"} ${stowed ? "is-stowed" : ""} ${restoreGesture.armed ? "is-restore-dragging" : ""} ${restoreGesture.overDismissTarget ? "is-over-dismiss" : ""}`.trim()}
          aria-label="學習音檔播放器"
          data-audio-backend={runtimeBackend}
          data-audio-buffer-seconds={bufferSeconds.toFixed(3)}
          data-audio-decode-ms={lastDecodeMs.toFixed(1)}
          data-audio-phase={phase}
          data-audio-rate={playbackRate}
          data-audio-transport-rate={transportPlaybackRate(
            playbackRate,
            current.encodedSpeed,
          ).toFixed(4)}
        >
          <span className="audio-player-edge-progress" aria-hidden="true">
            <span style={{
              width: `${timelineProgressPercent}%`,
              minWidth: timelineProgressPercent > 0 ? 3 : 0,
            }} />
          </span>
          <span className="sr-only" aria-live="polite">{liveStatus}</span>
          <button
            ref={restoreButtonRef}
            type="button"
            className="audio-player-restore"
            aria-label={`顯示播放器：${audioSummaryDisplayName(current)}，${accessibleStatus}；長按可${isPlaybackActive ? "暫停" : "播放"}`}
            onPointerDown={handleRestorePointerDown}
            onPointerMove={handleRestorePointerMove}
            onPointerUp={handleRestorePointerEnd}
            onPointerCancel={handleRestorePointerCancel}
            onLostPointerCapture={(event) => {
              if (event.target !== event.currentTarget) return;
              if (restorePointerIdRef.current !== null) handleRestorePointerCancel();
            }}
            onKeyDown={(event) => {
              if (event.key === "Delete") {
                event.preventDefault();
                releasePlayer();
              } else if (event.key === "Escape") {
                event.preventDefault();
                handleRestorePointerCancel();
              }
            }}
            aria-keyshortcuts="Delete"
            onContextMenu={(event) => event.preventDefault()}
            onClick={() => {
              if (restoreLongPressTriggeredRef.current) {
                restoreLongPressTriggeredRef.current = false;
                return;
              }
              setExpanded(false);
              setQueueOpen(false);
              setStowed(false);
              window.requestAnimationFrame(() => titleButtonRef.current?.focus());
            }}
          >
            <svg
              className="audio-player-ring-progress"
              viewBox="0 0 52 52"
              aria-hidden="true"
              focusable="false"
            >
              <circle
                className="audio-player-ring-progress-track"
                cx="26"
                cy="26"
                r="24"
                pathLength="100"
              />
              <circle
                className="audio-player-ring-progress-value"
                cx="26"
                cy="26"
                r="24"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={100 - timelineProgressPercent}
              />
            </svg>
            <Headphones className="audio-player-restore-mark" aria-hidden="true" />
            <ChevronRight className="audio-player-restore-chevron" aria-hidden="true" />
          </button>
          <div className="audio-player-mini">
            <Headphones className="audio-player-mark" aria-hidden="true" />
            <button
              type="button"
              className="audio-player-stow"
              aria-label="將播放器收至左側"
              onClick={() => {
                setExpanded(false);
                setQueueOpen(false);
                setStowed(true);
                window.requestAnimationFrame(() => restoreButtonRef.current?.focus());
              }}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              ref={titleButtonRef}
              type="button"
              className="audio-player-title"
              aria-expanded={expanded}
              aria-controls="learning-audio-details"
              onClick={() => {
                if (expanded) setQueueOpen(false);
                setExpanded(!expanded);
              }}
            >
              <strong>{audioSummaryDisplayName(current)}</strong>
              {!isPreparing && <span>{status}</span>}
            </button>
            <time className="audio-player-mini-time">
              <span>{formatTime(position)}</span>
              <span aria-hidden="true">/</span>
              <span>{formatTime(duration)}</span>
            </time>
            <button
              type="button"
              className="audio-player-mini-toggle"
              aria-label={isPlaybackActive ? "暫停" : "播放"}
              disabled={phase === "loading"}
              onClick={() => void togglePlayback()}
            >
              {isPlaybackActive
                ? <Pause aria-hidden="true" />
                : <Play aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="audio-player-expand"
              aria-label={expanded ? "收起播放器" : "展開播放器"}
              aria-expanded={expanded}
              aria-controls="learning-audio-details"
              onClick={() => {
                if (expanded) setQueueOpen(false);
                setExpanded(!expanded);
              }}
            >
              {expanded
                ? <ChevronDown aria-hidden="true" />
                : <ChevronUp aria-hidden="true" />}
            </button>
            {!expanded && (
              <button
                type="button"
                className="audio-player-mini-close"
                aria-label="關閉播放器"
                onClick={dismissPlayer}
              >
                <X aria-hidden="true" />
              </button>
            )}
            {isPreparing && (
              <span
                className={`audio-player-preparation-progress ${phase === "buffering" ? "is-indeterminate" : "is-determinate"}`}
                role="progressbar"
                aria-label="音檔準備進度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={phase === "loading" ? progressPercent : undefined}
                aria-valuetext={phase === "loading" ? `${progressPercent}%` : "準備中"}
              >
                <span style={phase === "loading" ? { width: `${progressPercent}%` } : undefined} />
              </span>
            )}
          </div>

          {expanded && (
            <div id="learning-audio-details" className="audio-player-details">
              <div className="audio-player-timeline">
                <input
                  type="range"
                  min="0"
                  max={Math.max(1, duration)}
                  step="0.1"
                  value={Math.min(position, Math.max(1, duration))}
                  disabled={phase === "loading"}
                  aria-label="播放進度"
                  onInput={(event) => previewSeek(Number(event.currentTarget.value))}
                  onChange={(event) => previewSeek(Number(event.currentTarget.value))}
                  onPointerUp={commitSeekPreview}
                  onPointerCancel={commitSeekPreview}
                  onKeyUp={commitSeekPreview}
                  onBlur={commitSeekPreview}
                />
                <div>
                  <span>{formatTime(position)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="audio-player-controls">
                <div className="audio-player-transport" role="group" aria-label="播放控制">
                  <button type="button" className="audio-player-skip" aria-label="倒退 15 秒" disabled={phase === "loading"} onClick={() => jumpBy(-15)}>
                    <RotateCcw aria-hidden="true" /><span>15</span>
                  </button>
                  <button type="button" className="audio-player-chapter-control" aria-label="播放上一章" disabled={phase === "loading" || !adjacentAudioSummary(current.id, -1)} onClick={() => void playAdjacentSource(-1)}>
                    <SkipBack aria-hidden="true" />
                  </button>
                  <button type="button" className="audio-player-main-toggle" aria-label={isPlaybackActive ? "暫停" : "播放"} disabled={phase === "loading"} onClick={() => void togglePlayback()}>
                    {isPlaybackActive ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  </button>
                  <button type="button" className="audio-player-chapter-control" aria-label={randomReview ? "隨機播放下一章" : "播放下一章"} disabled={phase === "loading" || !canPlayNext} onClick={() => void playNextSource()}>
                    <SkipForward aria-hidden="true" />
                  </button>
                  <button type="button" className="audio-player-skip" aria-label="快進 15 秒" disabled={phase === "loading"} onClick={() => jumpBy(15)}>
                    <span>15</span><RotateCw aria-hidden="true" />
                  </button>
                </div>

                <label className="audio-player-rate">
                  <span>速度</span>
                  <select className="field-control" value={playbackRate} aria-label="播放速度" onChange={(event) => updatePlaybackRate(Number(event.target.value))}>
                    {AUDIO_PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
                  </select>
                </label>

                <div className="audio-player-utilities">
                  <label className="audio-player-volume">
                    <Volume2 aria-hidden="true" />
                    <input type="range" min="0" max="1" step="0.05" value={volume} aria-label="音量" onChange={(event) => updateVolume(Number(event.target.value))} />
                  </label>
                  <details
                    ref={settingsDetailsRef}
                    className="audio-player-settings"
                    onToggle={(event) => {
                      if (event.currentTarget.open) window.dispatchEvent(new Event(AUDIO_PLAYER_SETTINGS_OPEN_EVENT));
                    }}
                  >
                    <summary className="audio-player-utility" aria-label="播放設定" aria-haspopup="menu"><Settings aria-hidden="true" /></summary>
                    <div className="audio-player-settings-panel">
                      <div className="audio-player-options" role="group" aria-label="播放選項">
                        <label className="audio-player-option audio-player-option-select">
                          <Timer aria-hidden="true" />
                          <select value={sleepTimer ?? ""} aria-label={sleepTimerLabel} onChange={(event) => updateSleepTimer(event.target.value === "chapter-end" ? "chapter-end" : event.target.value ? Number(event.target.value) as 15 | 30 | 45 | 60 : null)}>
                            <option value="">睡眠計時</option><option value="chapter-end">本章播完</option><option value="15">15 分鐘</option><option value="30">30 分鐘</option><option value="45">45 分鐘</option><option value="60">60 分鐘</option>
                          </select>
                        </label>
                        <button type="button" className={`audio-player-option audio-player-subtitle-option ${subtitlesEnabled ? "is-active" : ""}`.trim()} aria-pressed={subtitlesEnabled} onClick={() => updateSubtitlesEnabled(!subtitlesEnabled)}>
                          <Captions aria-hidden="true" /><span><strong>字幕</strong><small>{subtitlesEnabled ? "開" : "關"}</small></span>
                        </button>
                        <button type="button" className={`audio-player-option ${continuousPlay ? "is-active" : ""}`.trim()} aria-pressed={continuousPlay} onClick={() => updateContinuousPlay(!continuousPlay)}>
                          <Repeat2 aria-hidden="true" /><span><strong>連續播放</strong><small>{continuousPlay ? "開" : "關"}</small></span>
                        </button>
                        <button type="button" className={`audio-player-option ${randomReview ? "is-active" : ""}`.trim()} aria-pressed={randomReview} onClick={() => updateRandomReview(!randomReview)}>
                          <Shuffle aria-hidden="true" /><span><strong>隨機複習</strong><small>{randomReview ? "開" : "關"}</small></span>
                        </button>
                        <button type="button" className={`audio-player-option ${queueOpen ? "is-active" : ""}`.trim()} aria-expanded={queueOpen} aria-controls="audio-player-queue-panel" onClick={() => setQueueOpen((open) => !open)}>
                          <ListMusic aria-hidden="true" /><span><strong>接下來</strong><small>{queuedSources.length > 0 ? `${queuedSources.length} 章` : nextUpSource ? "下一章" : "已播完"}</small></span>
                        </button>
                      </div>
                      {queueOpen && (
                        <section id="audio-player-queue-panel" className="audio-player-queue-panel" aria-label="待播內容">
                          <header><span>{queuedSources.length > 0 ? "待播清單" : randomReview ? "隨機複習下一章" : "依章節順序"}</span>{queuedSources.length > 0 && <button type="button" onClick={() => updateQueue([])}>清除</button>}</header>
                          {queuedSources.length > 0 ? <ol>{queuedSources.slice(0, 4).map((source) => <li key={source.id}><span><small>{audioSummaryDisplayMarker(source)}</small><strong>{audioSummaryDisplayTitle(source)}</strong></span><button type="button" aria-label={`從待播清單移除 ${audioSummaryDisplayName(source)}`} onClick={() => removeFromQueue(source.id)}><X aria-hidden="true" /></button></li>)}</ol> : nextUpSource ? <p><small>{audioSummaryDisplayMarker(nextUpSource)}</small><strong>{audioSummaryDisplayTitle(nextUpSource)}</strong></p> : <p>這個系列已經播放到最後一章。</p>}
                          {!continuousPlay && <small className="audio-player-queue-note">連續播放已關閉，本章播完後會停下。</small>}
                        </section>
                      )}
                      <div className="audio-player-settings-actions"><button type="button" disabled={phase === "loading"} onClick={() => seekTo(0)}>回到開頭</button><button type="button" onClick={dismissPlayer}>關閉播放器</button></div>
                    </div>
                  </details>
                  <button type="button" className="audio-player-utility audio-player-fullscreen" aria-label="切換播放器全螢幕" onClick={() => { const dock = playerDockRef.current; if (!dock) return; if (document.fullscreenElement) void document.exitFullscreen(); else if (dock.requestFullscreen) void dock.requestFullscreen(); }}>
                    <Maximize2 aria-hidden="true" />
                  </button>
                </div>
              </div>

              {error && (
                <button
                  type="button"
                  className="text-action audio-player-retry"
                  onClick={() => void playSource(current)}
                >
                  再試一次
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </AudioPlayerContext.Provider>
  );
}
