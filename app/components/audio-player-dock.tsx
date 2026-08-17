"use client";

import {
  Captions,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Headphones,
  ListMusic,
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
  X,
} from "lucide-react";
import type {
  PointerEventHandler,
  RefObject,
} from "react";
import {
  adjacentAudioSummary,
  audioSummaryDisplayMarker,
  audioSummaryDisplayName,
  audioSummaryDisplayTitle,
  audioSummaryForId,
  type AudioSummarySource,
} from "../lib/audio-summaries";
import {
  AUDIO_PLAYBACK_RATES,
  transportPlaybackRate,
} from "../lib/audio-playback";
import { AUDIO_PLAYER_SETTINGS_OPEN_EVENT } from "../lib/audio-player-section-events";

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

export type AudioPlayerDockController = {
  current: AudioSummarySource;
  phase: PlayerPhase;
  loadProgress: number;
  position: number;
  duration: number;
  playbackRate: number;
  runtimeBackend: "pending" | "webgpu" | "wasm";
  bufferSeconds: number;
  lastDecodeMs: number;
  expanded: boolean;
  stowed: boolean;
  restoreGesture: RestoreGestureVisual;
  error: boolean;
  subtitlesEnabled: boolean;
  continuousPlay: boolean;
  randomReview: boolean;
  randomNextId: string | null;
  queueOpen: boolean;
  queuedSources: AudioSummarySource[];
  canPlayNext: boolean;
  hasPrevious: boolean;
  sleepTimer: AudioSleepTimer;
  restoreButtonRef: RefObject<HTMLButtonElement | null>;
  playerDockRef: RefObject<HTMLElement | null>;
  dismissTargetRef: RefObject<HTMLSpanElement | null>;
  titleButtonRef: RefObject<HTMLButtonElement | null>;
  settingsDetailsRef: RefObject<HTMLDetailsElement | null>;
  restorePointerIdRef: RefObject<number | null>;
  restoreLongPressTriggeredRef: RefObject<boolean>;
  handleRestorePointerDown: PointerEventHandler<HTMLButtonElement>;
  handleRestorePointerMove: PointerEventHandler<HTMLButtonElement>;
  handleRestorePointerEnd: PointerEventHandler<HTMLButtonElement>;
  handleRestorePointerCancel: () => void;
  releasePlayer: () => void;
  dismissPlayer: () => void;
  setExpanded: (expanded: boolean) => void;
  setStowed: (stowed: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  togglePlayback: () => Promise<void>;
  previewSeek: (seconds: number) => void;
  commitSeekPreview: () => void;
  updatePlaybackRate: (rate: number) => void;
  playPrevious: () => Promise<void>;
  jumpBy: (seconds: number) => void;
  playNext: () => Promise<void>;
  updateSleepTimer: (setting: AudioSleepTimer) => void;
  updateSubtitlesEnabled: (enabled: boolean) => void;
  updateContinuousPlay: (enabled: boolean) => void;
  updateRandomReview: (enabled: boolean) => void;
  clearQueue: () => void;
  removeFromQueue: (sourceId: string) => void;
  seekTo: (seconds: number) => void;
  retry: () => Promise<void>;
};

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export default function AudioPlayerDock({ controller }: { controller: AudioPlayerDockController }) {
  const {
    current,
    phase,
    loadProgress,
    position,
    duration,
    playbackRate,
    runtimeBackend,
    bufferSeconds,
    lastDecodeMs,
    expanded,
    stowed,
    restoreGesture,
    error,
    subtitlesEnabled,
    continuousPlay,
    randomReview,
    randomNextId,
    queueOpen,
    queuedSources,
    canPlayNext,
    hasPrevious,
    sleepTimer,
    restoreButtonRef,
    playerDockRef,
    dismissTargetRef,
    titleButtonRef,
    settingsDetailsRef,
    restorePointerIdRef,
    restoreLongPressTriggeredRef,
    handleRestorePointerDown,
    handleRestorePointerMove,
    handleRestorePointerEnd,
    handleRestorePointerCancel,
    releasePlayer,
    dismissPlayer,
    setExpanded,
    setStowed,
    setQueueOpen,
    togglePlayback,
    previewSeek,
    commitSeekPreview,
    updatePlaybackRate,
    playPrevious,
    jumpBy,
    playNext,
    updateSleepTimer,
    updateSubtitlesEnabled,
    updateContinuousPlay,
    updateRandomReview,
    clearQueue,
    removeFromQueue,
    seekTo,
    retry,
  } = controller;

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
      && randomNextSource?.collectionId === current.collectionId
      ? randomNextSource
      : null)
    ?? (!randomReview ? adjacentAudioSummary(current.id, 1) : null);
  const sleepTimerLabel = sleepTimer === "chapter-end"
    ? "本章播完停止"
    : sleepTimer
      ? `${sleepTimer} 分鐘後停止`
      : "睡眠計時";

  return (
    <>
      {stowed && restoreGesture.armed && (
        <div
          className={`audio-player-dismiss-target ${restoreGesture.overDismissTarget ? "is-over" : ""}`.trim()}
          aria-hidden="true"
        >
          <span ref={dismissTargetRef}><X /></span>
        </div>
      )}
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
              <div className="audio-player-time-row">
                <span className="audio-player-time-current">{formatTime(position)}</span>
                <div className="audio-section-inline-slot" />
                <span className="audio-player-time-duration">{formatTime(duration)}</span>
              </div>
            </div>

            <div className="audio-player-controls">
              <div className="audio-player-secondary-left">
                <label className="audio-player-rate">
                  <span>速度</span>
                  <select
                    className="field-control"
                    value={playbackRate}
                    aria-label="播放速度"
                    onChange={(event) => updatePlaybackRate(Number(event.target.value))}
                  >
                    {AUDIO_PLAYBACK_RATES.map((rate) => (
                      <option key={rate} value={rate}>{rate}×</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="audio-player-utility audio-player-reset"
                  aria-label="回到開頭"
                  disabled={phase === "loading"}
                  onClick={() => seekTo(0)}
                >
                  <RotateCcw aria-hidden="true" />
                </button>
              </div>

              <div className="audio-player-transport" role="group" aria-label="播放控制">
                <button
                  type="button"
                  className="audio-player-chapter-control"
                  aria-label="播放上一章"
                  disabled={phase === "loading" || !hasPrevious}
                  onClick={() => void playPrevious()}
                >
                  <SkipBack aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="audio-player-skip"
                  aria-label="倒退 15 秒"
                  disabled={phase === "loading"}
                  onClick={() => jumpBy(-15)}
                >
                  <RotateCcw aria-hidden="true" /><span>15</span>
                </button>
                <button
                  type="button"
                  className="audio-player-main-toggle"
                  aria-label={isPlaybackActive ? "暫停" : "播放"}
                  disabled={phase === "loading"}
                  onClick={() => void togglePlayback()}
                >
                  {isPlaybackActive ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="audio-player-skip"
                  aria-label="快進 30 秒"
                  disabled={phase === "loading"}
                  onClick={() => jumpBy(30)}
                >
                  <span>30</span><RotateCw aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="audio-player-chapter-control"
                  aria-label={randomReview ? "隨機播放下一章" : "播放下一章"}
                  disabled={phase === "loading" || !canPlayNext}
                  onClick={() => void playNext()}
                >
                  <SkipForward aria-hidden="true" />
                </button>
              </div>

              <div className="audio-player-utilities">
                <details
                  ref={settingsDetailsRef}
                  className="audio-player-settings"
                  onToggle={(event) => {
                    if (event.currentTarget.open) window.dispatchEvent(new Event(AUDIO_PLAYER_SETTINGS_OPEN_EVENT));
                  }}
                >
                  <summary className="audio-player-utility" aria-label="播放設定">
                    <Settings aria-hidden="true" />
                  </summary>
                  <div className="audio-player-settings-panel">
                    <div className="audio-player-options" role="group" aria-label="播放選項">
                      <label className="audio-player-option audio-player-option-select">
                        <Timer aria-hidden="true" />
                        <select
                          value={sleepTimer ?? ""}
                          aria-label={sleepTimerLabel}
                          onChange={(event) => updateSleepTimer(
                            event.target.value === "chapter-end"
                              ? "chapter-end"
                              : event.target.value
                                ? Number(event.target.value) as 15 | 30 | 45 | 60
                                : null,
                          )}
                        >
                          <option value="">睡眠計時</option>
                          <option value="chapter-end">本章播完</option>
                          <option value="15">15 分鐘</option>
                          <option value="30">30 分鐘</option>
                          <option value="45">45 分鐘</option>
                          <option value="60">60 分鐘</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        className={`audio-player-option audio-player-subtitle-option ${subtitlesEnabled ? "is-active" : ""}`.trim()}
                        aria-pressed={subtitlesEnabled}
                        onClick={() => updateSubtitlesEnabled(!subtitlesEnabled)}
                      >
                        <Captions aria-hidden="true" />
                        <span><strong>字幕</strong><small>{subtitlesEnabled ? "開" : "關"}</small></span>
                      </button>
                      <button
                        type="button"
                        className={`audio-player-option ${continuousPlay ? "is-active" : ""}`.trim()}
                        aria-pressed={continuousPlay}
                        onClick={() => updateContinuousPlay(!continuousPlay)}
                      >
                        <Repeat2 aria-hidden="true" />
                        <span><strong>連續播放</strong><small>{continuousPlay ? "開" : "關"}</small></span>
                      </button>
                      <button
                        type="button"
                        className={`audio-player-option ${randomReview ? "is-active" : ""}`.trim()}
                        aria-pressed={randomReview}
                        onClick={() => updateRandomReview(!randomReview)}
                      >
                        <Shuffle aria-hidden="true" />
                        <span><strong>隨機複習</strong><small>{randomReview ? "開" : "關"}</small></span>
                      </button>
                      <button
                        type="button"
                        className={`audio-player-option ${queueOpen ? "is-active" : ""}`.trim()}
                        aria-expanded={queueOpen}
                        aria-controls="audio-player-queue-panel"
                        onClick={() => setQueueOpen(!queueOpen)}
                      >
                        <ListMusic aria-hidden="true" />
                        <span>
                          <strong>接下來</strong>
                          <small>{queuedSources.length > 0 ? `${queuedSources.length} 章` : nextUpSource ? "下一章" : "已播完"}</small>
                        </span>
                      </button>
                    </div>
                    {queueOpen && (
                      <section id="audio-player-queue-panel" className="audio-player-queue-panel" aria-label="待播內容">
                        <header>
                          <span>{queuedSources.length > 0 ? "待播清單" : randomReview ? "隨機複習下一章" : "依章節順序"}</span>
                          {queuedSources.length > 0 && <button type="button" onClick={clearQueue}>清除</button>}
                        </header>
                        {queuedSources.length > 0 ? (
                          <ol>
                            {queuedSources.slice(0, 4).map((source) => (
                              <li key={source.id}>
                                <span><small>{audioSummaryDisplayMarker(source)}</small><strong>{audioSummaryDisplayTitle(source)}</strong></span>
                                <button type="button" aria-label={`從待播清單移除 ${audioSummaryDisplayName(source)}`} onClick={() => removeFromQueue(source.id)}>
                                  <X aria-hidden="true" />
                                </button>
                              </li>
                            ))}
                          </ol>
                        ) : nextUpSource ? (
                          <p><small>{audioSummaryDisplayMarker(nextUpSource)}</small><strong>{audioSummaryDisplayTitle(nextUpSource)}</strong></p>
                        ) : (
                          <p>這個系列已經播放到最後一章。</p>
                        )}
                        {!continuousPlay && <small className="audio-player-queue-note">連續播放已關閉，本章播完後會停下。</small>}
                      </section>
                    )}
                    <button
                      type="button"
                      className="audio-player-settings-dismiss"
                      onClick={dismissPlayer}
                    >
                      <X aria-hidden="true" />
                      <span>關閉播放器</span>
                    </button>
                  </div>
                </details>
                <button
                  type="button"
                  className="audio-player-utility audio-player-close"
                  aria-label="關閉播放器"
                  onClick={dismissPlayer}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            </div>

            {error && (
              <button
                type="button"
                className="text-action audio-player-retry"
                onClick={() => void retry()}
              >
                再試一次
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
