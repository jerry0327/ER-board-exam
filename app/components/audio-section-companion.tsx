"use client";

import {
  ChevronDown,
  ListTree,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAudioPlayer } from "./audio-player-provider";
import {
  currentAudioChapterAt,
  level1AudioChapterMarkers,
  playerSecondsForChapter,
  type AudioChapterL1,
} from "../lib/audio-chapters";
import type { LoadedRuntimeSemanticAudioChapters } from "../lib/audio-runtime-semantic-package";
import {
  loadSectionTitleLocales,
  localizedSectionTitle,
  type LoadedSectionTitleLocales,
} from "../lib/audio-section-title-locales";
import {
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
    const { loadRuntimeSemanticAudioChapters } = await import("../lib/audio-runtime-semantic-package");
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
  const currentSource = player.current;
  const activeBundle = bundle?.sourceId === currentSource?.id ? bundle : null;
  const activeScope = scope?.sourceId === currentSource?.id ? scope : null;

  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-audio-scoped-playback", Boolean(activeScope));
    return () => { root.removeAttribute("data-audio-scoped-playback"); };
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
    if (!currentSource) {
      if (scope) setScope(null);
      return;
    }
    if (scope && scope.sourceId !== currentSource.id) setScope(null);
  }, [currentSource, scope]);

  useEffect(() => {
    if (!player.expanded || player.stowed || !currentSource) {
      setSectionOpen(false);
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
    dock.classList.toggle("is-question-scope", Boolean(activeScope));
    return () => {
      dock.classList.remove("has-audio-sections", "is-question-scope");
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
            <small>{activeScope ? "只播放本題" : "目前段落"}</small>
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
                      <span className="audio-section-list-dot" aria-hidden="true" />
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
      <div className="audio-section-node-layer">
        <span className="audio-section-track-base" aria-hidden="true" />
        <span
          className="audio-section-track-progress"
          aria-hidden="true"
          style={{ width: `${Math.min(100, Math.max(0, player.position / Math.max(1, player.duration) * 100))}%` }}
        />
        {markers.map((marker, index) => {
          const chapter = chapters[index];
          if (!chapter) return null;
          const left = Math.min(100, Math.max(0, marker.playerStartSeconds / Math.max(1, player.duration) * 100));
          const isCurrent = chapter.id === currentChapter?.id;
          const isPast = marker.playerStartSeconds <= player.position;
          const label = sectionLabel(activeBundle, chapter);
          return (
            <button
              key={marker.id}
              type="button"
              className={`audio-section-node ${isCurrent ? "is-current" : ""} ${isPast ? "is-past" : ""}`.trim()}
              style={{ left: `${left}%` }}
              aria-label={`從 ${formatTime(marker.playerStartSeconds)} 播放：${label}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                seekChapter(chapter);
              }}
            >
              <span className="audio-section-node-tooltip" role="tooltip">
                <strong>{label}</strong>
                <time>{formatTime(marker.playerStartSeconds)}</time>
              </span>
            </button>
          );
        })}
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
              <strong id="question-audio-choice-title">選擇播放方式</strong>
              <button
                type="button"
                className="audio-question-choice-close"
                aria-label="關閉"
                onClick={() => setQuestionChoice(null)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="audio-question-choice-options">
              <button
                type="button"
                className="audio-question-choice-option"
                disabled={!choiceSource || loadingChoice}
                onClick={() => void chooseFullQuestionSet()}
              >
                <span>完整音檔</span>
              </button>
              <button
                type="button"
                className="audio-question-choice-option"
                disabled={!choiceSource || loadingChoice}
                aria-busy={loadingChoice || undefined}
                onClick={() => void chooseQuestionOnly()}
              >
                <span>{loadingChoice ? "載入中…" : "只播放本題"}</span>
              </button>
            </div>
            {choiceError && <p className="audio-question-choice-error">{choiceError}</p>}
          </section>
        </div>
      )}
    </>
  );
}
