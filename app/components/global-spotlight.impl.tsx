"use client";

import {
  ArrowRight,
  BarChart3,
  BookMarked,
  BookOpenText,
  CircleDot,
  ClipboardCheck,
  Compass,
  FileText,
  Files,
  GraduationCap,
  Headphones,
  LayoutDashboard,
  Leaf,
  Library,
  NotebookPen,
  Play,
  RotateCcw,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/use-dialog-focus";
import type { AnyGuideAnnotationSource } from "../lib/annotation-source";
import {
  audioSummaries,
  audioSummaryDisplayName,
  loadAudioSummaryCatalog,
  type AudioSummarySource,
} from "../lib/audio-summaries";
import { LEARNING_SOURCE_REGISTRY } from "../lib/learning-source-registry";
import { learningDocuments } from "../lib/learning-documents";
import { loadGoldfrankGuideManifest, type GoldfrankGuideChapter } from "../lib/goldfrank-guides";
import {
  SPOTLIGHT_NAVIGATION_ACTIONS,
  SPOTLIGHT_QUICK_VIEWS,
  searchSpotlight,
} from "../lib/spotlight";
import { loadSearchCatalog, matchesSearch, prefetchQuestion } from "../lib/question-data";
import { rosensChapters, type RosensChapter } from "../lib/rosens-catalog";
import { supplementalSectionDisplayId } from "../lib/supplemental-guide-ids";
import { loadStudyGuideCatalog, type StudyGuideChapter } from "../lib/study-guides";
import type { NavView, QuestionIndex, StudyAnnotation } from "../lib/types";

export type GlobalSpotlightProps = {
  questions: QuestionIndex[];
  annotations?: StudyAnnotation[];
  onOpenReader: (questionId: string) => void;
  onOpenAnnotation?: (resourceId: string, annotationId: string) => void;
  onOpenTintinalli: (chapter: number | string) => void;
  onOpenRosens: (chapter: string) => void;
  onOpenGoldfrank: (chapter: string) => void;
  onPlayAudio: (source: AudioSummarySource) => void;
  onOpenDocument: (documentId: string) => void;
  onNavigate: (view: NavView) => void;
  onStartQuestions: (questionIds: string[]) => void;
  initiallyOpen?: boolean;
  onOpen?: () => void;
  className?: string;
  triggerLabel?: string;
};

const navigationIcons: Record<NavView, LucideIcon> = {
  總覽: LayoutDashboard,
  開始作答: CircleDot,
  題庫瀏覽: Search,
  詳解閱讀: Library,
  學習指引: GraduationCap,
  錯題本: RotateCcw,
  筆記本: BookMarked,
  學習分析: BarChart3,
  備考中心: ClipboardCheck,
  休息站: Leaf,
  學習音檔: Headphones,
  學習文件: Files,
};

function previewText(value: string, fallback: string) {
  return value.replace(/\s+/gu, " ").trim() || fallback;
}

function rosensDisplayId(chapterId: string) {
  if (chapterId.startsWith("e")) return `e${Number(chapterId.slice(1))}`;
  return chapterId.toLocaleUpperCase("en");
}

function guideAnnotationLabels(
  source: AnyGuideAnnotationSource | null,
  tintinalliChapter: StudyGuideChapter | null,
  rosensChapter: RosensChapter | null,
) {
  if (!source) return null;
  if (source.resourceKind === "unit") {
    return {
      title: `考題對照指引・單元 ${source.unitCode}`,
      context: "急診專科考題總指引・雙向追溯",
    };
  }
  if (source.resourceKind === "page") {
    return {
      title: `AILS・${source.pageId}`,
      context: "AILS 學習指引",
    };
  }
  if (source.resourceKind === "chapter") {
    if (source.textbook === "ems") {
      return {
        title: `EMS 第 ${source.chapter} 章`,
        context: LEARNING_SOURCE_REGISTRY.ems.title,
      };
    }
    if (source.textbook === "goldfrank") {
      return {
        title: `${LEARNING_SOURCE_REGISTRY.goldfrank.title} · Chapter ${source.chapterId}`,
        context: `${LEARNING_SOURCE_REGISTRY.goldfrank.title} · 11th Edition`,
      };
    }
    if (source.textbook === "tintinalli") {
      return {
        title: `Chapter ${source.chapterId} · ${tintinalliChapter?.title ?? LEARNING_SOURCE_REGISTRY.tintinalli.title}`,
        context: `${LEARNING_SOURCE_REGISTRY.tintinalli.title}${tintinalliChapter?.sectionTitle ? ` · ${tintinalliChapter.sectionTitle}` : ""}`,
      };
    }
    const displayId = rosensChapter?.displayId ?? rosensDisplayId(source.chapterId);
    const chapterKind = rosensChapter?.kind === "echapter" ? "eChapter" : "Chapter";
    return {
      title: `${chapterKind} ${displayId} · ${rosensChapter?.title ?? LEARNING_SOURCE_REGISTRY.rosens.title}`,
      context: `${LEARNING_SOURCE_REGISTRY.rosens.title}${rosensChapter?.sectionTitle ? ` · ${rosensChapter.sectionTitle}` : ""}`,
    };
  }
  if (source.resourceKind === "section") {
    const sectionId = supplementalSectionDisplayId(source.sectionId);
    const textbook = LEARNING_SOURCE_REGISTRY[source.textbook].title;
    return {
      title: `${textbook} · Section ${sectionId} Overview`,
      context: "Section Overview",
    };
  }
  return {
    title: `${LEARNING_SOURCE_REGISTRY[source.textbook].title} · Whole-Book Overview`,
    context: "Whole-Book Overview",
  };
}

export default function GlobalSpotlight({
  questions,
  annotations = [],
  onOpenReader,
  onOpenAnnotation,
  onOpenTintinalli,
  onOpenRosens,
  onOpenGoldfrank,
  onPlayAudio,
  onOpenDocument,
  onNavigate,
  onStartQuestions,
  initiallyOpen = false,
  onOpen,
  className = "",
  triggerLabel = "全站搜尋",
}: GlobalSpotlightProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [query, setQuery] = useState("");
  const [searchVersion, setSearchVersion] = useState(0);
  const [tintinalliChapters, setTintinalliChapters] = useState<StudyGuideChapter[]>([]);
  const [goldfrankChapters, setGoldfrankChapters] = useState<GoldfrankGuideChapter[]>([]);
  const [audioCatalog, setAudioCatalog] = useState(audioSummaries);
  const [partialNotice, setPartialNotice] = useState("");
  const deferredQuery = useDeferredValue(query);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRequestedRef = useRef(false);
  const guideRequestedRef = useRef(false);
  const goldfrankGuideRequestedRef = useRef(false);
  const audioRequestedRef = useRef(false);

  const closeSpotlight = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const openSpotlight = useCallback(() => {
    onOpen?.();
    setOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [onOpen]);

  useDialogFocus(open, dialogRef, closeSpotlight);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.altKey || (!event.metaKey && !event.ctrlKey) || event.key.toLocaleLowerCase() !== "k") return;
      const activeModal = document.querySelector<HTMLElement>("[aria-modal='true']");
      if (activeModal && activeModal.id !== "global-spotlight-dialog") return;
      event.preventDefault();
      openSpotlight();
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [openSpotlight]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  useEffect(() => {
    if (!open || audioRequestedRef.current) return;
    audioRequestedRef.current = true;
    void loadAudioSummaryCatalog().then(setAudioCatalog);
  }, [open]);

  useEffect(() => {
    if (!open || searchRequestedRef.current) return;
    searchRequestedRef.current = true;
    void loadSearchCatalog()
      .then(() => setSearchVersion(1))
      .catch(() => {
        searchRequestedRef.current = false;
        setPartialNotice("部分搜尋結果暫時無法顯示。");
      });
  }, [open]);

  useEffect(() => {
    if (!open || guideRequestedRef.current) return;
    guideRequestedRef.current = true;
    void loadStudyGuideCatalog()
      .then((catalog) => setTintinalliChapters(catalog.chapters))
      .catch(() => {
        guideRequestedRef.current = false;
        setPartialNotice((current) => current || "Tintinalli 章目暫時無法顯示。");
      });
  }, [open]);

  useEffect(() => {
    if (!open || goldfrankGuideRequestedRef.current) return;
    goldfrankGuideRequestedRef.current = true;
    void loadGoldfrankGuideManifest()
      .then((manifest) => setGoldfrankChapters(manifest.chapters))
      .catch(() => {
        goldfrankGuideRequestedRef.current = false;
        setPartialNotice((current) => current || "Goldfrank 章目暫時無法顯示。");
      });
  }, [open]);

  const results = useMemo(() => searchSpotlight({
    query: deferredQuery,
    questions,
    tintinalliChapters,
    rosensChapters,
    goldfrankChapters,
    audioSummaries: audioCatalog,
    learningDocuments,
    annotations,
    resources: [],
    questionMatches: (question, value) => matchesSearch(question, value, searchVersion),
  }), [annotations, audioCatalog, deferredQuery, goldfrankChapters, questions, searchVersion, tintinalliChapters]);

  const quickActions = useMemo(() => SPOTLIGHT_QUICK_VIEWS
    .map((view) => SPOTLIGHT_NAVIGATION_ACTIONS.find((action) => action.view === view))
    .filter((action): action is (typeof SPOTLIGHT_NAVIGATION_ACTIONS)[number] => Boolean(action)), []);
  const perform = (action: () => void) => {
    closeSpotlight();
    action();
  };

  const focusFirstResult = (activate: boolean) => {
    const first = dialogRef.current?.querySelector<HTMLElement>("[data-spotlight-action]");
    if (!first) return;
    if (activate) first.click();
    else first.focus();
  };

  const hasQuery = Boolean(deferredQuery.trim());
  const waitingForDeferredQuery = query !== deferredQuery;

  return (
    <div className={`global-spotlight ${className}`.trim()}>
      <button
        type="button"
        className="quiet-button spotlight-trigger"
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="global-spotlight-dialog"
        aria-keyshortcuts="Control+K Meta+K"
        title={triggerLabel}
        onClick={openSpotlight}
      >
        <Search size={17} />
        <span>{triggerLabel}</span>
        <kbd aria-hidden="true"><i>⌘</i><b>K</b></kbd>
      </button>

      {open && createPortal((
        <div
          className="spotlight-overlay"
          role="presentation"
          onPointerDown={(event) => { if (event.target === event.currentTarget) closeSpotlight(); }}
        >
          <section
            id="global-spotlight-dialog"
            ref={dialogRef}
            className="spotlight-dialog overlay-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="global-spotlight-heading"
            aria-describedby="global-spotlight-description"
            tabIndex={-1}
          >
            <header className="spotlight-search-header">
              <Search aria-hidden="true" />
              <div>
                <h2 id="global-spotlight-heading">全站搜尋</h2>
                <p id="global-spotlight-description">題目、學習指引、音檔、文件與筆記</p>
                <input
                  ref={inputRef}
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (query !== deferredQuery) return;
                    if (event.key === "ArrowDown") { event.preventDefault(); focusFirstResult(false); }
                    if (event.key === "Enter") { event.preventDefault(); focusFirstResult(true); }
                  }}
                  placeholder="搜尋題號、疾病、章號、音檔或筆記…"
                  aria-label="搜尋全站內容"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {query && <button type="button" className="icon-button spotlight-clear" aria-label="清除搜尋" onClick={() => setQuery("")}><X size={17} /></button>}
              <button type="button" className="icon-button spotlight-close" aria-label="關閉全站搜尋" onClick={closeSpotlight}><X /></button>
            </header>

            <div className="spotlight-results" aria-busy={waitingForDeferredQuery}>
              {!hasQuery ? (
                <>
                  <section className="spotlight-group" aria-labelledby="spotlight-quick-heading">
                    <header><Compass /><h3 id="spotlight-quick-heading">常用功能</h3></header>
                    <div className="spotlight-quick-grid">
                      {quickActions.map((action) => {
                        const Icon = navigationIcons[action.view];
                        return (
                          <button className="quiet-button" key={action.view} type="button" data-spotlight-action onClick={() => perform(() => onNavigate(action.view))}>
                            <Icon /><span><strong>{action.label}</strong><small>{action.description}</small></span><ArrowRight />
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </>
              ) : (
                <>
                  {results.navigation.length > 0 && (
                    <section className="spotlight-group" aria-labelledby="spotlight-navigation-heading">
                      <header><Compass /><h3 id="spotlight-navigation-heading">站內功能</h3><span>{results.navigation.length}</span></header>
                      <div className="spotlight-result-list">
                        {results.navigation.map((action) => {
                          const Icon = navigationIcons[action.view];
                          return <button key={action.view} type="button" className="quiet-button spotlight-result" data-spotlight-action onClick={() => perform(() => onNavigate(action.view))}><Icon /><span><strong>{action.label}</strong><small>{action.description}</small></span><ArrowRight /></button>;
                        })}
                      </div>
                    </section>
                  )}

                  {results.questions.length > 0 && (
                    <section className="spotlight-group" aria-labelledby="spotlight-question-heading">
                      <header><CircleDot /><h3 id="spotlight-question-heading">題目與詳解</h3><span>{results.questions.length}</span></header>
                      <div className="spotlight-result-list">
                        {results.questions.map((question) => (
                          <article className="paper-card spotlight-question-result" key={question.id} onPointerEnter={() => prefetchQuestion(question)}>
                            <button type="button" className="quiet-button spotlight-result" data-spotlight-action onFocus={() => prefetchQuestion(question)} onClick={() => perform(() => onOpenReader(question.id))}>
                              <FileText /><span><strong>{question.title}</strong><small>{question.id}・{question.category}</small><em>{question.stem}</em></span><ArrowRight />
                            </button>
                            {!question.excludedFromPractice && !question.allCredit && (
                              <button type="button" className="quiet-button spotlight-practice-one" aria-label={`練習 ${question.id}`} onClick={() => perform(() => onStartQuestions([question.id]))}><Play /><span>練這題</span></button>
                            )}
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  {results.tintinalli.length > 0 && (
                    <section className="spotlight-group" aria-labelledby="spotlight-tintinalli-heading">
                      <header><BookOpenText /><h3 id="spotlight-tintinalli-heading">{LEARNING_SOURCE_REGISTRY.tintinalli.title}</h3><span>{results.tintinalli.length}</span></header>
                      <div className="spotlight-result-list">
                        {results.tintinalli.map((chapter) => (
                          <button key={chapter.id} type="button" className="quiet-button spotlight-result" data-spotlight-action onClick={() => perform(() => onOpenTintinalli(chapter.id))}>
                            <BookOpenText /><span><strong>Chapter {String(chapter.id).padStart(3, "0")}・{chapter.title}</strong><small>{chapter.sectionTitle}{chapter.available ? "・可閱讀" : "・章目可瀏覽"}</small></span><ArrowRight />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {results.rosens.length > 0 && (
                    <section className="spotlight-group" aria-labelledby="spotlight-rosens-heading">
                      <header><GraduationCap /><h3 id="spotlight-rosens-heading">{LEARNING_SOURCE_REGISTRY.rosens.title}</h3><span>{results.rosens.length}</span></header>
                      <div className="spotlight-result-list">
                        {results.rosens.map((chapter) => (
                          <button key={chapter.id} type="button" className="quiet-button spotlight-result" data-spotlight-action onClick={() => perform(() => onOpenRosens(chapter.id))}>
                            <GraduationCap /><span><strong>Chapter {chapter.displayId}・{chapter.title}</strong><small>{chapter.ordinal !== Number(chapter.id) ? `全書序號 ${chapter.ordinal}・` : ""}Volume {chapter.volume}・{chapter.sectionTitle}</small></span><ArrowRight />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {results.goldfrank.length > 0 && (
                    <section className="spotlight-group" aria-labelledby="spotlight-goldfrank-heading">
                      <header><GraduationCap /><h3 id="spotlight-goldfrank-heading">{LEARNING_SOURCE_REGISTRY.goldfrank.title}</h3><span>{results.goldfrank.length}</span></header>
                      <div className="spotlight-result-list">
                        {results.goldfrank.map((chapter) => (
                          <button key={chapter.id} type="button" className="quiet-button spotlight-result" data-spotlight-action onClick={() => perform(() => onOpenGoldfrank(chapter.id))}>
                            <GraduationCap /><span><strong>Chapter {chapter.id}・{chapter.title}</strong><small>{LEARNING_SOURCE_REGISTRY.goldfrank.title} · 11th Edition</small></span><ArrowRight />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {results.audio.length > 0 && (
                    <section className="spotlight-group" aria-labelledby="spotlight-audio-heading">
                      <header><Headphones /><h3 id="spotlight-audio-heading">學習音檔</h3><span>{results.audio.length}</span></header>
                      <div className="spotlight-result-list">
                        {results.audio.map((source) => (
                          <button key={source.id} type="button" className="quiet-button spotlight-result" data-spotlight-action onClick={() => perform(() => onPlayAudio(source))}>
                            <Headphones /><span><strong>{audioSummaryDisplayName(source)}</strong><small>{source.collectionTitle}</small></span><Play />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {results.documents.length > 0 && (
                    <section className="spotlight-group" aria-labelledby="spotlight-document-heading">
                      <header><Files /><h3 id="spotlight-document-heading">學習文件</h3><span>{results.documents.length}</span></header>
                      <div className="spotlight-result-list">
                        {results.documents.map((document) => (
                          <button key={document.id} type="button" className="quiet-button spotlight-result" data-spotlight-action onClick={() => perform(() => onOpenDocument(document.id))}>
                            <Files /><span><strong>{document.title}</strong><small>{document.format}・{document.subtitle}</small></span><ArrowRight />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {results.annotations.length > 0 && (
                    <section className="spotlight-group" aria-labelledby="spotlight-annotation-heading">
                      <header><NotebookPen /><h3 id="spotlight-annotation-heading">我的筆記</h3><span>{results.annotations.length}</span></header>
                      <div className="spotlight-result-list">
                        {results.annotations.map(({ annotation, question, guide, rosensChapter, guideSource }) => {
                          const labels = guideAnnotationLabels(guideSource, guide, rosensChapter);
                          const title = labels?.title ?? question?.title ?? annotation.questionId;
                          const kindLabel = annotation.kind === "highlight"
                            ? "重點標記"
                            : annotation.kind === "excerpt"
                              ? "內容摘錄"
                              : guideSource
                                ? guideSource.resourceKind === "chapter" ? "章節筆記" : "指南筆記"
                                : "題目筆記";
                          const context = labels ? `${labels.context}・${kindLabel}` : `${annotation.questionId}・${kindLabel}`;
                          return (
                            <button key={annotation.id} type="button" className="quiet-button spotlight-result spotlight-note-result" data-spotlight-action onClick={() => perform(() => {
                              if (onOpenAnnotation) {
                                onOpenAnnotation(annotation.questionId, annotation.id);
                              } else if (!guideSource) {
                                onOpenReader(annotation.questionId);
                              } else if (guideSource.resourceKind === "unit") {
                                onNavigate("學習指引");
                              } else if (guideSource.resourceKind === "page") {
                                onNavigate("學習指引");
                              } else if (guideSource.textbook === "rosens") {
                                onOpenRosens(guideSource.resourceKind === "chapter"
                                  ? guideSource.chapterId
                                  : guideSource.resourceKind === "overview" ? "overview" : `section-${guideSource.sectionId}`);
                              } else if (guideSource.textbook === "goldfrank" && guideSource.resourceKind === "chapter") {
                                onOpenGoldfrank(guideSource.chapterId);
                              } else if (guideSource.resourceKind === "chapter") {
                                onOpenTintinalli(guideSource.chapter);
                              } else {
                                onOpenTintinalli(guideSource.resourceKind === "overview" ? "overview" : `section-${guideSource.sectionId}`);
                              }
                            })}>
                              <NotebookPen /><span><strong>{title}</strong><small>{context}</small><em>{previewText(annotation.body || annotation.quote.replace(/^#{1,4}\s+/gmu, "").replace(/\|/gu, " "), "尚未加入筆記內容")}</em></span><ArrowRight />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {!waitingForDeferredQuery && results.count === 0 && (
                    <div className="spotlight-empty" role="status"><Search /><h3>找不到符合的內容</h3><p>可以改用較短的疾病名稱、題號或英文關鍵字。</p><button type="button" onClick={() => setQuery("")}>回到常用功能</button></div>
                  )}
                </>
              )}
            </div>

            <footer className="spotlight-footer">
              <span className="spotlight-status" role="status" aria-live="polite">{waitingForDeferredQuery ? "正在搜尋…" : hasQuery ? `${results.count} 項結果` : "輸入關鍵字開始搜尋"}</span>
              {partialNotice && <span className="spotlight-partial-notice">{partialNotice}</span>}
              <span className="spotlight-key-help"><kbd>Tab</kbd> 切換・<kbd>Enter</kbd> 開啟・<kbd>Esc</kbd> 關閉</span>
            </footer>
          </section>
        </div>
      ), document.body)}
    </div>
  );
}
