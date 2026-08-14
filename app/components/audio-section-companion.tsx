"use client";

import {
  Check,
  ChevronDown,
  Headphones,
  Layers3,
  ListTree,
  Play,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAudioPlayer } from "./audio-player-provider";
import {
  currentAudioChapterAt,
  level1AudioChapterMarkers,
  playerSecondsForChapter,
  type AudioChapterL1,
} from "../lib/audio-chapters";
import {
  loadRuntimeSemanticAudioChapters,
  type LoadedRuntimeSemanticAudioChapters,
} from "../lib/audio-runtime-semantic-package";
import {
  loadSectionTitleLocales,
  localizedSectionTitle,
  type LoadedSectionTitleLocales,
} from "../lib/audio-section-title-locales";
import {
  audioSummaryDisplayMarker,
  audioSummaryDisplayName,
  audioSummaryDisplayTitle,
  audioSummaryForId,
  type AudioSummarySource,
} from "../lib/audio-summaries";
import {
  QUESTION_AUDIO_CHOICE_EVENT,
  type QuestionAudioChoiceRequest,
} from "../lib/audio-player-section-events";

type LoadedSectionBundle = {
  sourceId: string;
  runtime: LoadedRuntimeSemanticAudioChapters;
  locales: LoadedSectionTitleLocales | null;
};

type QuestionPlaybackScope = {
  sourceId: string;
  questionId: string;
  sectionId: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
};

const sectionBundleRequests = new Map<string, Promise<LoadedSectionBundle>>();

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function loadSectionBundle(source: AudioSummarySource) {
  const key = `${source.id}:${source.revision}`;
  const existing = sectionBundleRequests.get(key);
  if (existing) return existing;
  const pending = (async (): Promise<LoadedSectionBundle> => {
    const runtime = await loadRuntimeSemanticAudioChapters(source);
    let locales: LoadedSectionTitleLocales | null = null;
    try {
      locales = await loadSectionTitleLocales(source, {
        expectedSourceSha256: runtime.pair.source_sha256,
        expectedChaptersSha256: runtime.pair.chapters_sha256,
      });
    } catch {
      // Canonical Section titles remain a safe fallback when a locale pack is unavailable.
    }
    return { sourceId: source.id, runtime, locales };
  })();
  sectionBundleRequests.set(key, pending);
  void pending.catch(() => {
    if (sectionBundleRequests.get(key) === pending) sectionBundleRequests.delete(key);
  });
  return pending;
}

function questionNumber(questionId: string) {
  const match = /-Q(\d{3})$/u.exec(questionId);
  return match ? Number(match[1]) : null;
}

function questionChapter(
  source: AudioSummarySource,
  bundle: LoadedSectionBundle,
  questionId: string,
) {
  const questions = bundle.runtime.metadata.chapters.slice(1, 6);
  const direct = questions.find((chapter) => chapter.title.toUpperCase() === questionId.toUpperCase());
  if (direct) return direct;
  const number = questionNumber(questionId);
  if (
    number === null
    || !Number.isInteger(source.questionStart)
    || !Number.isInteger(source.questionEnd)
    || number < Number(source.questionStart)
    || number > Number(source.questionEnd)
  ) return null;
  return questions[number - Number(source.questionStart)] ?? null;
}

function questionScope(
  source: AudioSummarySource,
  bundle: LoadedSectionBundle,
  questionId: string,
): QuestionPlaybackScope | null {
  if (bundle.runtime.metadata.profile !== "question-bank-five") return null;
  const chapter = questionChapter(source, bundle, questionId);
  if (!chapter) return null;
  const index = bundle.runtime.metadata.chapters.findIndex((candidate) => candidate.id === chapter.id);
  const next = bundle.runtime.metadata.chapters[index + 1];
  if (!next) return null;
  const startSeconds = playerSecondsForChapter(chapter);
  const endSeconds = playerSecondsForChapter(next);
  if (!(endSeconds > startSeconds)) return null;
  return {
    sourceId: source.id,
    questionId,
    sectionId: chapter.id,
    title: localizedSectionTitle(bundle.locales, chapter.id, chapter.title, "zh-TW"),
    startSeconds,
    endSeconds,
  };
}

function sectionLabel(
  bundle: LoadedSectionBundle,
  chapter: AudioChapterL1,
) {
  return localizedSectionTitle(bundle.locales, chapter.id, chapter.title, "zh-TW");
}

const STYLES = String.raw`
.audio-player-details {
  display: flex;
  flex-direction: column;
}
.audio-player-timeline {
  position: relative;
}
.audio-section-companion {
  border-bottom: 1px solid color-mix(in srgb, var(--site-line-strong) 48%, transparent);
  margin: -2px 0 9px;
  order: -1;
  padding: 0 0 8px;
}
.audio-section-summary {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 38px;
}
.audio-section-current {
  min-width: 0;
}
.audio-section-current small,
.audio-section-current strong {
  display: block;
}
.audio-section-current small {
  color: var(--site-muted);
  font-size: 11px;
  line-height: 1.25;
  margin-bottom: 2px;
}
.audio-section-current strong {
  color: var(--site-ink);
  font-size: 13px;
  font-weight: 760;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.audio-section-scope-badge {
  background: color-mix(in srgb, var(--site-primary) 10%, var(--site-paper));
  border: 1px solid color-mix(in srgb, var(--site-primary) 25%, var(--site-line));
  border-radius: 999px;
  color: var(--site-primary);
  display: inline-flex;
  font-size: 10px;
  font-weight: 760;
  margin-left: 6px;
  padding: 2px 6px;
  vertical-align: 1px;
}
.audio-section-toggle {
  align-items: center;
  background: var(--site-surface-muted);
  border: 1px solid var(--site-line);
  border-radius: var(--site-radius);
  color: var(--site-ink-soft);
  cursor: pointer;
  display: inline-flex;
  gap: 5px;
  min-height: 36px;
  padding: 0 9px;
}
.audio-section-toggle:hover {
  background: var(--site-surface-hover);
}
.audio-section-toggle svg {
  height: 15px;
  width: 15px;
}
.audio-section-toggle svg:last-child {
  height: 13px;
  transition: rotate 160ms var(--site-ease);
  width: 13px;
}
.audio-section-toggle[aria-expanded="true"] svg:last-child {
  rotate: 180deg;
}
.audio-section-panel {
  background: color-mix(in srgb, var(--site-paper) 92%, transparent);
  border: 1px solid var(--site-line);
  border-radius: 12px;
  box-shadow: var(--site-shadow-card);
  margin-top: 7px;
  max-height: 242px;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 5px;
}
.audio-section-panel header {
  align-items: center;
  color: var(--site-muted);
  display: flex;
  font-size: 11px;
  justify-content: space-between;
  padding: 4px 7px 6px;
}
.audio-section-list {
  display: grid;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.audio-section-list button {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  display: grid;
  gap: 8px;
  grid-template-columns: 31px minmax(0, 1fr) auto;
  min-height: 38px;
  padding: 5px 7px;
  text-align: left;
  width: 100%;
}
.audio-section-list button:hover {
  background: var(--site-surface-hover);
}
.audio-section-list button.is-current {
  background: color-mix(in srgb, var(--site-primary) 9%, var(--site-surface-muted));
  color: var(--site-primary);
}
.audio-section-list .audio-section-number {
  color: var(--site-muted);
  font-family: var(--site-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.audio-section-list strong {
  font-size: 12px;
  font-weight: 690;
  line-height: 1.35;
  min-width: 0;
}
.audio-section-list time {
  color: var(--site-muted);
  font-family: var(--site-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.audio-section-list button.is-current time,
.audio-section-list button.is-current .audio-section-number {
  color: currentColor;
}
.audio-section-boundaries {
  inset: 1px 8px auto 8px;
  height: 16px;
  pointer-events: none;
  position: absolute;
  z-index: 2;
}
.audio-section-boundaries i {
  background: color-mix(in srgb, var(--site-paper) 96%, var(--site-ink) 4%);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--site-ink) 24%, transparent);
  height: 8px;
  position: absolute;
  top: 4px;
  width: 1px;
}
.audio-player-dock.is-section-list-open .audio-player-timeline,
.audio-player-dock.is-section-list-open .audio-player-controls,
.audio-player-dock.is-section-list-open .audio-player-options,
.audio-player-dock.is-section-list-open .audio-player-queue-panel,
.audio-player-dock.is-section-list-open .audio-player-retry {
  display: none !important;
}
.audio-player-dock.is-question-scope .audio-player-timeline > input:first-child,
.audio-player-dock.is-question-scope .audio-player-timeline > input:first-child + div {
  display: none;
}
.audio-question-scope-timeline input {
  accent-color: var(--site-primary);
  cursor: pointer;
  display: block;
  inline-size: 100%;
  margin: 0;
}
.audio-question-scope-time {
  align-items: center;
  color: var(--site-muted);
  display: grid;
  font-family: var(--site-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  gap: 8px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  margin-top: 1px;
}
.audio-question-scope-time strong {
  color: var(--site-primary);
  font-family: var(--site-sans);
  font-size: 10px;
  font-weight: 760;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.audio-question-choice-backdrop {
  align-items: center;
  background: var(--site-scrim);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 20px;
  position: fixed;
  z-index: 170;
}
.audio-question-choice {
  background: var(--site-paper);
  border: 1px solid var(--site-line);
  border-radius: var(--site-overlay-radius);
  box-shadow: var(--site-shadow-overlay);
  color: var(--site-ink);
  max-width: 470px;
  padding: 18px;
  width: 100%;
}
.audio-question-choice > header {
  align-items: start;
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) 38px;
  margin-bottom: 13px;
}
.audio-question-choice > header small,
.audio-question-choice > header strong {
  display: block;
}
.audio-question-choice > header small {
  color: var(--site-primary);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: .04em;
  margin-bottom: 4px;
}
.audio-question-choice > header strong {
  font-family: var(--site-display);
  font-size: 19px;
  line-height: 1.35;
}
.audio-question-choice-close {
  align-items: center;
  background: transparent;
  border: 1px solid var(--site-line);
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex;
  height: 38px;
  justify-content: center;
  width: 38px;
}
.audio-question-choice-close svg {
  height: 17px;
  width: 17px;
}
.audio-question-source {
  background: var(--site-surface-muted);
  border: 1px solid var(--site-line);
  border-radius: 10px;
  color: var(--site-muted);
  display: flex;
  font-size: 11px;
  gap: 7px;
  margin-bottom: 10px;
  padding: 8px 10px;
}
.audio-question-source strong {
  color: var(--site-ink);
  font-size: 11px;
}
.audio-question-choice-options {
  display: grid;
  gap: 8px;
}
.audio-question-choice-option {
  align-items: center;
  background: var(--site-surface-muted);
  border: 1px solid var(--site-line);
  border-radius: 11px;
  cursor: pointer;
  display: grid;
  gap: 11px;
  grid-template-columns: 38px minmax(0, 1fr) 18px;
  min-height: 70px;
  padding: 10px 12px;
  text-align: left;
  width: 100%;
}
.audio-question-choice-option:hover {
  background: var(--site-surface-hover);
  border-color: color-mix(in srgb, var(--site-primary) 30%, var(--site-line));
}
.audio-question-choice-option:disabled {
  cursor: wait;
  opacity: .58;
}
.audio-question-choice-option > svg:first-child {
  color: var(--site-primary);
  height: 22px;
  width: 22px;
}
.audio-question-choice-option > svg:last-child {
  color: var(--site-muted);
  height: 16px;
  width: 16px;
}
.audio-question-choice-option strong,
.audio-question-choice-option small {
  display: block;
}
.audio-question-choice-option strong {
  font-size: 13px;
  line-height: 1.35;
}
.audio-question-choice-option small {
  color: var(--site-muted);
  font-size: 11px;
  line-height: 1.45;
  margin-top: 3px;
}
.audio-question-choice-error {
  color: var(--site-danger);
  font-size: 11px;
  line-height: 1.5;
  margin: 9px 2px 0;
}
@media (max-width: 600px) {
  .audio-section-companion {
    margin-bottom: 7px;
    padding-bottom: 7px;
  }
  .audio-section-summary {
    min-height: 34px;
  }
  .audio-section-current small {
    font-size: 10px;
  }
  .audio-section-current strong {
    font-size: 12px;
  }
  .audio-section-toggle {
    min-height: 34px;
    padding-inline: 8px;
  }
  .audio-section-toggle span {
    display: none;
  }
  .audio-section-panel {
    max-height: min(38vh, 230px);
  }
  .audio-section-list button {
    min-height: 40px;
  }
  .audio-question-choice-backdrop {
    align-items: flex-end;
    padding: 0;
  }
  .audio-question-choice {
    border-bottom: 0;
    border-left: 0;
    border-radius: 18px 18px 0 0;
    border-right: 0;
    max-width: none;
    padding: 17px 16px calc(18px + env(safe-area-inset-bottom));
  }
  .audio-question-choice > header strong {
    font-size: 18px;
  }
  .audio-question-choice-option {
    min-height: 68px;
  }
}
`;

export default function AudioSectionCompanion() {
  const player = useAudioPlayer();
  const [bundle, setBundle] = useState<LoadedSectionBundle | null>(null);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [scope, setScope] = useState<QuestionPlaybackScope | null>(null);
  const [questionChoice, setQuestionChoice] = useState<QuestionAudioChoiceRequest | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [loadingChoice, setLoadingChoice] = useState(false);
  const [detailsTarget, setDetailsTarget] = useState<HTMLElement | null>(null);
  const [timelineTarget, setTimelineTarget] = useState<HTMLElement | null>(null);
  const sectionOpenRef = useRef(false);

  const currentSource = player.current;
  const activeBundle = bundle?.sourceId === currentSource?.id ? bundle : null;
  const activeScope = scope?.sourceId === currentSource?.id ? scope : null;

  useEffect(() => {
    sectionOpenRef.current = sectionOpen;
  }, [sectionOpen]);

  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-audio-scoped-playback", Boolean(activeScope));
    return () => root.removeAttribute("data-audio-scoped-playback");
  }, [activeScope]);

  useEffect(() => {
    const handleChoice = (event: Event) => {
      const request = (event as CustomEvent<QuestionAudioChoiceRequest>).detail;
      if (!request?.sourceId || !request.questionId) return;
      setChoiceError(null);
      setLoadingChoice(false);
      setQuestionChoice(request);
    };
    window.addEventListener(QUESTION_AUDIO_CHOICE_EVENT, handleChoice as EventListener);
    return () => window.removeEventListener(QUESTION_AUDIO_CHOICE_EVENT, handleChoice as EventListener);
  }, []);

  useEffect(() => {
    if (!questionChoice) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQuestionChoice(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [questionChoice]);

  useEffect(() => {
    if (!currentSource) {
      setBundle(null);
      setSectionOpen(false);
      return;
    }
    let active = true;
    void loadSectionBundle(currentSource)
      .then((loaded) => {
        if (active) setBundle(loaded);
      })
      .catch(() => {
        if (active) setBundle(null);
      });
    return () => {
      active = false;
    };
  }, [currentSource]);

  useEffect(() => {
    if (scope && currentSource && scope.sourceId !== currentSource.id) setScope(null);
  }, [currentSource, scope]);

  useEffect(() => {
    if (!player.expanded || player.stowed || !currentSource) {
      setDetailsTarget(null);
      setTimelineTarget(null);
      return;
    }
    let frame = window.requestAnimationFrame(() => {
      frame = 0;
      setDetailsTarget(document.querySelector<HTMLElement>(".audio-player-details"));
      setTimelineTarget(document.querySelector<HTMLElement>(".audio-player-timeline"));
    });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [currentSource, player.expanded, player.stowed]);

  useEffect(() => {
    const dock = document.querySelector<HTMLElement>(".audio-player-dock");
    if (!dock) return;
    dock.classList.toggle("has-audio-sections", Boolean(activeBundle));
    dock.classList.toggle("is-section-list-open", Boolean(activeBundle && sectionOpen));
    dock.classList.toggle("is-question-scope", Boolean(activeScope));
    return () => {
      dock.classList.remove("has-audio-sections", "is-section-list-open", "is-question-scope");
    };
  }, [activeBundle, activeScope, sectionOpen]);

  useEffect(() => {
    if (!activeScope) return;
    const tolerance = 0.06;
    if (player.position < activeScope.startSeconds - tolerance) {
      player.seek(activeScope.startSeconds);
      return;
    }
    if (player.position >= activeScope.endSeconds - tolerance) {
      if (player.isPlaying) player.pause();
      if (Math.abs(player.position - activeScope.endSeconds) > tolerance) {
        player.seek(activeScope.endSeconds);
      }
    }
  }, [activeScope, player.isPlaying, player.pause, player.position, player.seek]);

  useEffect(() => {
    if (!activeScope || !player.isPlaying) return;
    const remaining = activeScope.endSeconds - player.position;
    if (remaining <= 0.06) return;
    const milliseconds = Math.max(20, remaining / Math.max(0.25, player.playbackRate) * 1000 + 20);
    const timer = window.setTimeout(() => {
      player.pause();
      player.seek(activeScope.endSeconds);
    }, milliseconds);
    return () => window.clearTimeout(timer);
  }, [activeScope, player.isPlaying, player.pause, player.playbackRate, player.position, player.seek]);

  const chapters = activeBundle?.runtime.metadata.chapters ?? [];
  const markers = useMemo(
    () => activeBundle ? level1AudioChapterMarkers(activeBundle.runtime.metadata) : [],
    [activeBundle],
  );
  const currentChapter = activeBundle
    ? currentAudioChapterAt(activeBundle.runtime.metadata, player.position)?.l1 ?? null
    : null;
  const currentIndex = currentChapter
    ? chapters.findIndex((chapter) => chapter.id === currentChapter.id)
    : -1;
  const currentTitle = activeScope?.title
    ?? (activeBundle && currentChapter ? sectionLabel(activeBundle, currentChapter) : null);

  const choiceSource = questionChoice ? audioSummaryForId(questionChoice.sourceId) : null;

  async function chooseFullQuestionSet() {
    if (!choiceSource) return;
    setScope(null);
    setSectionOpen(false);
    setQuestionChoice(null);
    if (player.current?.id === choiceSource.id) {
      player.openPlayer();
      return;
    }
    await player.load(choiceSource);
  }

  async function chooseQuestionOnly() {
    if (!questionChoice || !choiceSource || loadingChoice) return;
    const hadScopedPlayback = document.documentElement.hasAttribute("data-audio-scoped-playback");
    setLoadingChoice(true);
    setChoiceError(null);
    try {
      const loaded = await loadSectionBundle(choiceSource);
      const nextScope = questionScope(choiceSource, loaded, questionChoice.questionId);
      if (!nextScope) throw new Error("question-section-unavailable");
      document.documentElement.setAttribute("data-audio-scoped-playback", "true");
      if (player.current?.id === choiceSource.id) {
        if (player.isPlaying) player.pause();
        player.openPlayer();
      } else {
        await player.load(choiceSource);
      }
      setBundle(loaded);
      setScope(nextScope);
      setSectionOpen(false);
      player.seek(nextScope.startSeconds);
      setQuestionChoice(null);
    } catch {
      if (!hadScopedPlayback) document.documentElement.removeAttribute("data-audio-scoped-playback");
      setChoiceError("目前無法讀取這一題的精準時間範圍；仍可使用五題完整音檔。");
    } finally {
      setLoadingChoice(false);
    }
  }

  function seekChapter(chapter: AudioChapterL1) {
    setScope(null);
    setSectionOpen(false);
    player.seek(playerSecondsForChapter(chapter));
  }

  const sectionPortal = activeBundle && detailsTarget
    ? createPortal(
      <div className="audio-section-companion">
        <div className="audio-section-summary">
          <div className="audio-section-current">
            <small>
              {activeScope
                ? "單題播放範圍"
                : currentIndex >= 0
                  ? `目前段落 ${currentIndex + 1} / ${chapters.length}`
                  : "段落導覽"}
              {activeScope && <span className="audio-section-scope-badge">播完即停</span>}
            </small>
            <strong title={currentTitle ?? undefined}>{currentTitle ?? "選擇段落"}</strong>
          </div>
          <button
            type="button"
            className="audio-section-toggle"
            aria-expanded={sectionOpen}
            onClick={() => setSectionOpen((open) => !open)}
          >
            <ListTree aria-hidden="true" />
            <span>段落</span>
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
        {sectionOpen && (
          <section className="audio-section-panel" aria-label="音檔段落">
            <header>
              <span>段落</span>
              <span>{chapters.length} 段</span>
            </header>
            <ol className="audio-section-list">
              {chapters.map((chapter, index) => {
                const startSeconds = markers[index]?.playerStartSeconds ?? playerSecondsForChapter(chapter);
                const isCurrent = chapter.id === currentChapter?.id;
                return (
                  <li key={chapter.id}>
                    <button
                      type="button"
                      className={isCurrent ? "is-current" : undefined}
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => seekChapter(chapter)}
                    >
                      <span className="audio-section-number">{String(index + 1).padStart(2, "0")}</span>
                      <strong>{sectionLabel(activeBundle, chapter)}</strong>
                      <time>{formatTime(startSeconds)}</time>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>,
      detailsTarget,
    )
    : null;

  const timelinePortal = activeBundle && timelineTarget && !activeScope
    ? createPortal(
      <div className="audio-section-boundaries" aria-hidden="true">
        {markers.slice(1).map((marker) => (
          <i
            key={marker.id}
            style={{ left: `${Math.min(100, Math.max(0, marker.playerStartSeconds / Math.max(1, player.duration) * 100))}%` }}
          />
        ))}
      </div>,
      timelineTarget,
    )
    : null;

  const scopeTimelinePortal = activeScope && timelineTarget
    ? createPortal(
      <div className="audio-question-scope-timeline">
        <input
          type="range"
          min={activeScope.startSeconds}
          max={activeScope.endSeconds}
          step="0.1"
          value={Math.min(activeScope.endSeconds, Math.max(activeScope.startSeconds, player.position))}
          disabled={player.phase === "loading"}
          aria-label={`${activeScope.questionId} 播放進度`}
          onChange={(event) => player.seek(Number(event.currentTarget.value))}
        />
        <div className="audio-question-scope-time">
          <span>{formatTime(player.position - activeScope.startSeconds)}</span>
          <strong>{activeScope.questionId} · 僅播放本題</strong>
          <span>{formatTime(activeScope.endSeconds - activeScope.startSeconds)}</span>
        </div>
      </div>,
      timelineTarget,
    )
    : null;

  return (
    <>
      <style>{STYLES}</style>
      {sectionPortal}
      {timelinePortal}
      {scopeTimelinePortal}
      {questionChoice && (
        <div
          className="audio-question-choice-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setQuestionChoice(null);
          }}
        >
          <section
            className="audio-question-choice"
            role="dialog"
            aria-modal="true"
            aria-labelledby="question-audio-choice-title"
          >
            <header>
              <div>
                <small>題庫詳解音檔</small>
                <strong id="question-audio-choice-title">選擇播放方式</strong>
              </div>
              <button
                type="button"
                className="audio-question-choice-close"
                aria-label="關閉"
                onClick={() => setQuestionChoice(null)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            {choiceSource && (
              <div className="audio-question-source">
                <span>{audioSummaryDisplayMarker(choiceSource)}</span>
                <strong>{audioSummaryDisplayTitle(choiceSource)}</strong>
              </div>
            )}
            <div className="audio-question-choice-options">
              <button
                type="button"
                className="audio-question-choice-option"
                disabled={!choiceSource || loadingChoice}
                onClick={() => void chooseFullQuestionSet()}
              >
                <Layers3 aria-hidden="true" />
                <span>
                  <strong>五題完整音檔</strong>
                  <small>{choiceSource ? `載入 ${audioSummaryDisplayName(choiceSource)} 的完整五題內容` : "完整題組音檔"}</small>
                </span>
                <Play aria-hidden="true" />
              </button>
              <button
                type="button"
                className="audio-question-choice-option"
                disabled={!choiceSource || loadingChoice}
                onClick={() => void chooseQuestionOnly()}
              >
                <Headphones aria-hidden="true" />
                <span>
                  <strong>只播放 {questionChoice.questionId}</strong>
                  <small>從本題開始；本題講解結束後自動停止，不會接著播放下一題</small>
                </span>
                {loadingChoice ? <span aria-hidden="true">…</span> : <Check aria-hidden="true" />}
              </button>
            </div>
            {choiceError && <p className="audio-question-choice-error">{choiceError}</p>}
          </section>
        </div>
      )}
    </>
  );
}
