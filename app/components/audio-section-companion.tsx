"use client";

import { ChevronDown } from "lucide-react";
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
  currentSubtitleCueAt,
  level1AudioChapterMarkers,
  playerSecondsForChapter,
  type AudioChapterL1,
  type AudioChapterL2,
  type SubtitleCue,
} from "../lib/audio-chapters";
import type { LoadedRuntimeSemanticAudioChapters } from "../lib/audio-runtime-semantic-package";
import { siteSecondsFromSourceSeconds } from "../lib/audio-playback";
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
  AUDIO_PLAYER_SETTINGS_OPEN_EVENT,
  QUESTION_AUDIO_CHOICE_EVENT,
  type QuestionAudioChoiceEventDetail,
  type QuestionAudioChoiceEventDetail,
  type QuestionAudioChoiceEventDetail,
  type QuestionAudioChoiceRequest,
} from "../lib/audio-player-section-events";

type LoadedSectionBundle = {
  sourceId: string;
  sourceRevision: string;
  runtime: LoadedRuntimeSemanticAudioChapters;
  locales: LoadedSectionTitleLocales | null;
};

type QuestionPlaybackScope = {
  sourceId: string;
  sourceRevision: string;
  questionId: string;
  sectionId: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
};

const SECTION_BUNDLE_CACHE_LIMIT = 6;
const sectionBundleRequests = new Map<string, Promise<LoadedSectionBundle>>();

function rememberSectionBundleRequest(key: string, request: Promise<LoadedSectionBundle>) {
  sectionBundleRequests.delete(key);
  sectionBundleRequests.set(key, request);
  while (sectionBundleRequests.size > SECTION_BUNDLE_CACHE_LIMIT) {
    const oldestKey = sectionBundleRequests.keys().next().value as string | undefined;
    if (!oldestKey) break;
    sectionBundleRequests.delete(oldestKey);
  }
}

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
  if (existing) {
    rememberSectionBundleRequest(key, existing);
    return existing;
  }
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
    return { sourceId: source.id, sourceRevision: source.revision, runtime, locales };
  })();
  rememberSectionBundleRequest(key, pending);
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
  return questions.find((chapter) => questionNumber(chapter.title) === number) ?? null;
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
    sourceRevision: source.revision,
    questionId,
    sectionId: chapter.id,
    title: localizedSectionTitle(bundle.locales, chapter.id, chapter.title, "zh-TW"),
    startSeconds,
    endSeconds,
  };
}

function sectionLabel(
  bundle: LoadedSectionBundle,
  chapter: AudioChapterL1 | AudioChapterL2,
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
  const [dockTarget, setDockTarget] = useState<HTMLElement | null>(null);
  const sectionToggleRef = useRef<HTMLButtonElement | null>(null);
  const sectionPanelRef = useRef<HTMLElement | null>(null);
  const questionDialogRef = useRef<HTMLElement | null>(null);
  const questionChoiceTriggerRef = useRef<HTMLElement | null>(null);
  const currentSource = player.current;
  const activeBundle = bundle && currentSource && bundle.sourceId === currentSource.id && bundle.sourceRevision === currentSource.revision ? bundle : null;
  const activeScope = scope && currentSource && scope.sourceId === currentSource.id && scope.sourceRevision === currentSource.revision ? scope : null;

  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-audio-scoped-playback", Boolean(activeScope));
    return () => { root.removeAttribute("data-audio-scoped-playback"); };
  }, [activeScope]);

  useEffect(() => {
    const handleChoice = (event: Event) => {
      const request = (event as CustomEvent<QuestionAudioChoiceEventDetail>).detail;
      if (!request?.sourceId || !request.questionId) return;
      setChoiceError(null);
      setLoadingChoice(false);
      setSectionOpen(false);
      const settings = document.querySelector<HTMLDetailsElement>(".audio-player-settings[open]");
      if (settings) settings.open = false;
      questionChoiceTriggerRef.current = request.trigger instanceof HTMLElement
        ? request.trigger
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setQuestionChoice({ sourceId: request.sourceId, questionId: request.questionId });
    };
    window.addEventListener(QUESTION_AUDIO_CHOICE_EVENT, handleChoice as EventListener);
    return () => window.removeEventListener(QUESTION_AUDIO_CHOICE_EVENT, handleChoice as EventListener);
  }, []);

  useEffect(() => {
    // The question audio menu stays anchored without locking page scroll.
    if (!questionChoice) return;
    const menu = questionDialogRef.current;
    const trigger = questionChoiceTriggerRef.current;
    if (!menu || !trigger) return;

    const positionMenu = () => {
      const anchor = trigger.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      const gutter = 8;
      const gap = 8;
      const maxLeft = Math.max(gutter, window.innerWidth - menuBox.width - gutter);
      const preferredLeft = anchor.left + anchor.width / 2 - menuBox.width / 2;
      const left = Math.min(maxLeft, Math.max(gutter, preferredLeft));
      const top = anchor.bottom + gap;
      const maxHeight = Math.max(88, window.innerHeight - top - gutter);
      const caretX = Math.min(menuBox.width - 18, Math.max(18, anchor.left + anchor.width / 2 - left));
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      menu.style.maxHeight = `${Math.round(maxHeight)}px`;
      menu.style.setProperty("--audio-question-caret-x", `${Math.round(caretX)}px`);
    };

    const focusFrame = window.requestAnimationFrame(() => {
      const anchor = trigger.getBoundingClientRect();
      const roomBelow = window.innerHeight - anchor.bottom - 16;
      if (roomBelow < Math.min(112, menu.scrollHeight + 8)) {
        trigger.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        window.requestAnimationFrame(positionMenu);
      } else {
        positionMenu();
      }
      menu.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || menu.contains(target) || trigger.contains(target)) return;
      setQuestionChoice(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setQuestionChoice(null);
    };
    const handleViewportChange = () => positionMenu();

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.requestAnimationFrame(() => questionChoiceTriggerRef.current?.focus());
    };
  }, [questionChoice]);

  useEffect(() => {
    const closeFrame = window.requestAnimationFrame(() => setSectionOpen(false));
    if (!currentSource) {
      const clearFrame = window.requestAnimationFrame(() => setBundle(null));
      return () => {
        window.cancelAnimationFrame(closeFrame);
        window.cancelAnimationFrame(clearFrame);
      };
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
      window.cancelAnimationFrame(closeFrame);
    };
  }, [currentSource]);

  useEffect(() => {
    if (!scope) return;
    if (currentSource && scope.sourceId === currentSource.id && scope.sourceRevision === currentSource.revision) return;
    const frame = window.requestAnimationFrame(() => setScope(null));
    return () => window.cancelAnimationFrame(frame);
  }, [currentSource, scope]);


  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      frame = 0;
      setDockTarget(player.stowed || !currentSource
        ? null
        : document.querySelector<HTMLElement>(".audio-player-dock"));
    });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [currentSource, player.stowed]);

  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (!player.expanded || player.stowed || !currentSource) {
        setSectionOpen(false);
        setDetailsTarget(null);
        setTimelineTarget(null);
        return;
      }
      setDetailsTarget(document.querySelector<HTMLElement>(".audio-section-inline-slot"));
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
    const handleSettingsOpen = () => setSectionOpen(false);
    window.addEventListener(AUDIO_PLAYER_SETTINGS_OPEN_EVENT, handleSettingsOpen);
    return () => window.removeEventListener(AUDIO_PLAYER_SETTINGS_OPEN_EVENT, handleSettingsOpen);
  }, []);

  useEffect(() => {
    if (!sectionOpen || !activeBundle) return;
    const panel = sectionPanelRef.current;
    const trigger = sectionToggleRef.current;
    if (!panel || !trigger) return;
    const focusFrame = window.requestAnimationFrame(() => {
      (panel.querySelector<HTMLElement>('[aria-current="true"]') ?? panel.querySelector<HTMLElement>("button"))?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || panel.contains(target) || trigger.contains(target)) return;
      setSectionOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSectionOpen(false);
      window.requestAnimationFrame(() => trigger.focus());
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeBundle, sectionOpen]);

  const scopePosition = player.position;
  const scopeHasPlaybackIntent = player.isPlaying;
  const scopeIsRendering = player.phase === "playing";
  const scopePlaybackRate = player.playbackRate;
  const scopePause = player.pause;
  const scopeSeek = player.seek;

  useEffect(() => {
    if (!activeScope) return;
    const tolerance = 0.06;
    if (scopePosition < activeScope.startSeconds - tolerance) {
      scopeSeek(activeScope.startSeconds);
      return;
    }
    if (scopePosition >= activeScope.endSeconds - tolerance) {
      if (scopeHasPlaybackIntent) scopePause();
      if (Math.abs(scopePosition - activeScope.endSeconds) > tolerance) {
        scopeSeek(activeScope.endSeconds);
      }
    }
  }, [activeScope, scopeHasPlaybackIntent, scopePause, scopePosition, scopeSeek]);

  useEffect(() => {
    if (!activeScope || !scopeIsRendering) return;
    const remaining = activeScope.endSeconds - scopePosition;
    if (remaining <= 0.06) return;
    const milliseconds = Math.max(20, remaining / Math.max(0.25, scopePlaybackRate) * 1000 + 20);
    const timer = window.setTimeout(() => {
      scopePause();
      scopeSeek(activeScope.endSeconds);
    }, milliseconds);
    return () => window.clearTimeout(timer);
  }, [activeScope, scopeIsRendering, scopePause, scopePlaybackRate, scopePosition, scopeSeek]);

  const chapters = activeBundle?.runtime.metadata.chapters ?? [];
  const markers = useMemo(
    () => activeBundle ? level1AudioChapterMarkers(activeBundle.runtime.metadata) : [],
    [activeBundle],
  );
  const currentPositionChapter = activeBundle
    ? currentAudioChapterAt(activeBundle.runtime.metadata, player.position)
    : null;
  const currentChapter = currentPositionChapter?.l1 ?? null;
  const currentL2 = currentPositionChapter?.l2 ?? null;
  const currentIndex = currentChapter ? chapters.findIndex((chapter) => chapter.id === currentChapter.id) : -1;
  const l2Count = chapters.reduce((total, chapter) => total + chapter.children.length, 0);
  const currentTitle = activeScope?.title
    ?? (activeBundle && currentChapter ? sectionLabel(activeBundle, currentChapter) : null);
  const currentSubtitleCue = activeBundle && player.subtitlesEnabled
    ? currentSubtitleCueAt(activeBundle.runtime.subtitle, player.position)
    : null;
  const subtitleCueIndex = currentSubtitleCue ? currentSubtitleCue.index - 1 : -1;
  const subtitleWindow = activeBundle && subtitleCueIndex >= 0
    ? activeBundle.runtime.subtitle.cues.slice(
      Math.max(0, subtitleCueIndex - 1),
      Math.min(activeBundle.runtime.subtitle.cues.length, subtitleCueIndex + 2),
    )
    : [];

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

  function seekSubtitleCue(cue: SubtitleCue) {
    setScope(null);
    player.seek(siteSecondsFromSourceSeconds(cue.startSourceSeconds));
  }

  function seekChapter(chapter: AudioChapterL1 | AudioChapterL2) {
    setScope(null);
    setSectionOpen(false);
    player.seek(playerSecondsForChapter(chapter));
    window.requestAnimationFrame(() => sectionToggleRef.current?.focus());
  }

  function toggleSectionPanel() {
    if (sectionOpen) {
      setSectionOpen(false);
      window.requestAnimationFrame(() => sectionToggleRef.current?.focus());
      return;
    }
    const settings = document.querySelector<HTMLDetailsElement>(".audio-player-settings[open]");
    if (settings) settings.open = false;
    setSectionOpen(true);
  }

  const subtitlePortal = player.subtitlesEnabled && activeBundle && dockTarget && currentSubtitleCue
    ? createPortal(
      <aside className="audio-subtitle-float" aria-label="同步字幕">
        <div className="audio-subtitle-lines">
          {subtitleWindow.map((cue) => {
            const isCurrent = cue.index === currentSubtitleCue.index;
            return (
              <button
                key={cue.index}
                type="button"
                className={`audio-subtitle-line ${isCurrent ? "is-current" : cue.index < currentSubtitleCue.index ? "is-previous" : "is-next"}`}
                aria-current={isCurrent ? "true" : undefined}
                aria-label={`從 ${formatTime(siteSecondsFromSourceSeconds(cue.startSourceSeconds))} 播放字幕：${cue.text}`}
                onClick={() => seekSubtitleCue(cue)}
              >
                <span>{cue.text}</span>
              </button>
            );
          })}
        </div>
        <span className="sr-only" aria-live="polite">{currentSubtitleCue.text}</span>
      </aside>,
      dockTarget,
    )
    : null;

  const sectionPortal = activeBundle && detailsTarget
    ? createPortal(
      <div className="audio-section-companion audio-section-companion-inline">
        <button
          ref={sectionToggleRef}
          type="button"
          className="audio-section-toggle audio-section-inline-control"
          aria-expanded={sectionOpen}
          aria-haspopup="dialog"
          aria-controls="audio-player-section-panel"
          aria-label={`目前段落 ${currentIndex >= 0 ? currentIndex + 1 : 1} / ${Math.max(1, chapters.length)}：${currentTitle ?? "段落"}；開啟段落選單`}
          onClick={toggleSectionPanel}
        >
          <span className="audio-section-inline-index">{activeScope ? "本題" : `${currentIndex >= 0 ? currentIndex + 1 : 1}/${Math.max(1, chapters.length)}`}</span>
          <strong className="audio-section-inline-title">{currentTitle ?? "段落"}</strong>
          <ChevronDown aria-hidden="true" />
        </button>
      </div>,
      detailsTarget,
    )
    : null;

  const sectionListPortal = activeBundle && dockTarget && sectionOpen
    ? createPortal(
      <section
        ref={sectionPanelRef}
        id="audio-player-section-panel"
        className="audio-section-panel audio-section-panel-floating"
        role="dialog"
        aria-labelledby="audio-player-section-panel-title"
      >
        <header>
          <span id="audio-player-section-panel-title">段落</span>
          <span>{chapters.length} 主段 · {l2Count} 子段</span>
        </header>
        <ol className="audio-section-list">
          {chapters.map((chapter, index) => {
            const startSeconds = markers[index]?.playerStartSeconds ?? playerSecondsForChapter(chapter);
            const isCurrent = chapter.id === currentChapter?.id;
            return (
              <li key={chapter.id} className="audio-section-l1-item">
                <button
                  type="button"
                  className={`audio-section-list-l1 ${isCurrent ? "is-current" : ""}`.trim()}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => seekChapter(chapter)}
                >
                  <span className="audio-section-list-dot" aria-hidden="true" />
                  <strong>{sectionLabel(activeBundle, chapter)}</strong>
                  <time>{formatTime(startSeconds)}</time>
                </button>
                {chapter.children.length > 0 && (
                  <ol className="audio-section-sublist" aria-label={`${sectionLabel(activeBundle, chapter)} 子段落`}>
                    {chapter.children.map((child) => {
                      const isCurrentL2 = child.id === currentL2?.id;
                      return (
                        <li key={child.id}>
                          <button
                            type="button"
                            className={`audio-section-list-l2 ${isCurrentL2 ? "is-current-l2" : ""}`.trim()}
                            aria-current={isCurrentL2 ? "location" : undefined}
                            onClick={() => seekChapter(child)}
                          >
                            <span className="audio-section-list-branch" aria-hidden="true">↳</span>
                            <strong>{sectionLabel(activeBundle, child)}</strong>
                            <time>{formatTime(playerSecondsForChapter(child))}</time>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      </section>,
      dockTarget,
    )
    : null;

  const timelinePortal = activeBundle && timelineTarget && !activeScope
    ? createPortal(
      <div className="audio-section-node-layer" aria-hidden="true">
        <span className="audio-section-track-base" aria-hidden="true" />
        <span
          className="audio-section-track-progress"
          aria-hidden="true"
          style={{ width: `${Math.min(100, Math.max(0, player.position / Math.max(1, player.duration) * 100))}%` }}
        />
        <span
          className="audio-section-playhead"
          aria-hidden="true"
          style={{ left: `${Math.min(100, Math.max(0, player.position / Math.max(1, player.duration) * 100))}%` }}
        />
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
      {subtitlePortal}
      {sectionPortal}
      {sectionListPortal}
      {timelinePortal}
      {scopeTimelinePortal}
      {questionChoice && (
        <section
          ref={questionDialogRef}
          className="audio-question-choice audio-question-choice-popover"
          role="menu"
          aria-label="選擇播放方式"
        >
          <button
            type="button"
            role="menuitem"
            className="audio-question-choice-option"
            disabled={!choiceSource || loadingChoice}
            onClick={() => void chooseFullQuestionSet()}
          >
            完整音檔
          </button>
          <button
            type="button"
            role="menuitem"
            className="audio-question-choice-option"
            disabled={!choiceSource || loadingChoice}
            aria-busy={loadingChoice || undefined}
            onClick={() => void chooseQuestionOnly()}
          >
            {loadingChoice ? "載入中…" : "只播放本題"}
          </button>
          {choiceError && <p className="audio-question-choice-error">{choiceError}</p>}
        </section>
      )}
    </>
  );
}
