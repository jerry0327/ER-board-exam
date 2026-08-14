"use client";

import type { ReactNode, RefObject } from "react";
import { BookCheck, Bookmark, ChevronRight, Clock3, Library, ListTree, Menu, SlidersHorizontal, X } from "lucide-react";
import type { ReadingFontLevel } from "../hooks/use-reading-font-preference";
import type { GuideReadState } from "../lib/types";
import ReadingFontControls from "./reading-font-controls";
import ReadingNextPrev from "./reading-next-prev";

export type GuideOutlineItem = {
  id: string;
  label: string;
  level: number;
};

type GuideTextbookSwitcherProps = {
  currentTextbook: string;
  onOpenLibrary: () => void;
  rail?: boolean;
};

export function GuideTextbookSwitcher({ currentTextbook, onOpenLibrary, rail = false }: GuideTextbookSwitcherProps) {
  return (
    <button
      type="button"
      className={["guide-textbook-switcher", rail ? "guide-textbook-switcher-rail" : ""].filter(Boolean).join(" ")}
      aria-label={`切換教科書，目前為 ${currentTextbook}`}
      onClick={onOpenLibrary}
    >
      <Library size={16} />
      <span><small>切換教科書</small><strong>{currentTextbook}</strong></span>
      <ChevronRight size={14} />
    </button>
  );
}

type GuideReaderToolbarProps = {
  className?: string;
  ariaLabel: string;
  libraryTriggerRef: RefObject<HTMLButtonElement | null>;
  libraryAriaLabel: string;
  libraryControlsId: string;
  libraryOpen: boolean;
  showLibraryTrigger: boolean;
  onOpenLibrary: () => void;
  positionCurrent: ReactNode;
  positionTotal: ReactNode;
  navigation: {
    noun: string;
    ariaLabel?: string;
    canPrevious: boolean;
    canNext: boolean;
    onPrevious: () => void;
    onNext: () => void;
  };
  outlineTriggerRef: RefObject<HTMLButtonElement | null>;
  outlineAvailable: boolean;
  outlineControlsId: string;
  outlineOpen: boolean;
  outlineLabel: string;
  onOpenOutline: () => void;
  audioAction?: ReactNode;
  traceAction?: ReactNode;
  fontLevel: ReadingFontLevel;
  onFontChange: (level: ReadingFontLevel) => void;
  fontNoun: string;
  mobileToolsTriggerRef: RefObject<HTMLButtonElement | null>;
  mobileToolsControlsId: string;
  mobileToolsOpen: boolean;
  showMobileToolsTrigger: boolean;
  onOpenMobileTools: () => void;
};

/** Shared top toolbar for every textbook and supplemental guide reader. */
export function GuideReaderToolbar({
  className,
  ariaLabel,
  libraryTriggerRef,
  libraryAriaLabel,
  libraryControlsId,
  libraryOpen,
  showLibraryTrigger,
  onOpenLibrary,
  positionCurrent,
  positionTotal,
  navigation,
  outlineTriggerRef,
  outlineAvailable,
  outlineControlsId,
  outlineOpen,
  outlineLabel,
  onOpenOutline,
  audioAction,
  traceAction,
  fontLevel,
  onFontChange,
  fontNoun,
  mobileToolsTriggerRef,
  mobileToolsControlsId,
  mobileToolsOpen,
  showMobileToolsTrigger,
  onOpenMobileTools,
}: GuideReaderToolbarProps) {
  return (
    <div className={["guide-toolbar", "reading-toolbar", className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
      {showLibraryTrigger && <button ref={libraryTriggerRef} className="guide-list-trigger reading-toolbar-library" aria-label={libraryAriaLabel} aria-controls={libraryControlsId} aria-expanded={libraryOpen} onClick={onOpenLibrary}><Menu size={17} /><span>目錄</span></button>}
      <span className="guide-toolbar-position reading-toolbar-position"><strong>{positionCurrent}</strong><small>/ {positionTotal}</small></span>
      <ReadingNextPrev className="guide-toolbar-step-controls reading-toolbar-steps" variant="icons" noun={navigation.noun} ariaLabel={navigation.ariaLabel} canPrevious={navigation.canPrevious} canNext={navigation.canNext} onPrevious={navigation.onPrevious} onNext={navigation.onNext} />
      <button ref={outlineTriggerRef} className="guide-toc-trigger reading-toolbar-outline" disabled={!outlineAvailable} aria-haspopup="dialog" aria-controls={outlineControlsId} aria-expanded={outlineOpen} onClick={onOpenOutline}><ListTree size={16} /><span>{outlineLabel}</span></button>
      {audioAction}
      {traceAction}
      <ReadingFontControls className="guide-font-controls reading-toolbar-font" level={fontLevel} onChange={onFontChange} noun={fontNoun} />
      {showMobileToolsTrigger && <button ref={mobileToolsTriggerRef} className="guide-mobile-tools-trigger reading-toolbar-tools" aria-haspopup="dialog" aria-expanded={mobileToolsOpen} aria-controls={mobileToolsControlsId} onClick={onOpenMobileTools}><SlidersHorizontal size={16} /><span>閱讀</span></button>}
    </div>
  );
}

type GuideProgressActions = {
  available: boolean;
  readState: GuideReadState;
  bookmarked: boolean;
  bookmarkNoun?: "本章" | "本文";
  onToggleLater: () => void;
  onToggleDone: () => void;
  onToggleBookmark: () => void;
  annotationControl: ReactNode;
};

type GuideReaderToolsPanelProps = {
  panelRef: RefObject<HTMLElement | null>;
  id: string;
  open: boolean;
  className?: string;
  ariaLabel: string;
  hidden?: boolean;
  summary: ReactNode;
  fontLevel: ReadingFontLevel;
  onFontChange: (level: ReadingFontLevel) => void;
  fontNoun: string;
  onClose: () => void;
  currentTextbook: string;
  onOpenLibrary: () => void;
  navigation: ReactNode;
  audioAction?: ReactNode;
  traceControl?: ReactNode;
  progressActions?: GuideProgressActions | null;
  onActionCapture?: () => void;
  variantSelector?: ReactNode;
  outlineItems?: GuideOutlineItem[];
  outlineAriaLabel?: string;
  onSelectOutline?: (id: string) => void;
};

/**
 * Shared right rail and mobile reading panel for every textbook guide.
 * Book-specific views provide data and variant selectors, never panel chrome.
 */
export default function GuideReaderToolsPanel({
  panelRef,
  id,
  open,
  className,
  ariaLabel,
  hidden = false,
  summary,
  fontLevel,
  onFontChange,
  fontNoun,
  onClose,
  currentTextbook,
  onOpenLibrary,
  navigation,
  audioAction,
  traceControl,
  progressActions,
  onActionCapture,
  variantSelector,
  outlineItems = [],
  outlineAriaLabel = "本章文章目錄",
  onSelectOutline,
}: GuideReaderToolsPanelProps) {
  const panelClasses = ["guide-utility-panel", className, open ? "mobile-open" : ""].filter(Boolean).join(" ");
  const readState = progressActions?.readState ?? "unread";
  const bookmarkNoun = progressActions?.bookmarkNoun ?? "本章";

  return (
    <aside
      ref={panelRef}
      id={id}
      className={panelClasses}
      aria-label={ariaLabel}
      aria-hidden={hidden || undefined}
      inert={hidden ? true : undefined}
      role={open ? "dialog" : undefined}
      aria-modal={open ? true : undefined}
    >
      <div className="guide-utility-inner overlay-panel">
        <header className="mobile-reading-tools-heading">
          <div><SlidersHorizontal size={17} /><span><strong>閱讀工具</strong><small>{summary}</small></span></div>
          <ReadingFontControls className="mobile-reading-font-tools" level={fontLevel} onChange={onFontChange} noun={fontNoun} />
          <button type="button" className="mobile-reading-tools-close" aria-label="關閉閱讀工具" onClick={onClose}><X /></button>
        </header>

        {open && variantSelector}

        <GuideTextbookSwitcher rail currentTextbook={currentTextbook} onOpenLibrary={onOpenLibrary} />
        {navigation}
        {audioAction}
        {traceControl}

        {progressActions && (
          <div className="reader-actions-bar guide-actions-bar" onClickCapture={onActionCapture}>
            <button
              type="button"
              disabled={!progressActions.available}
              aria-label={readState === "later" ? "取消稍後再讀" : "加入稍後再讀"}
              aria-pressed={readState === "later"}
              className={readState === "later" ? "active" : ""}
              onClick={progressActions.onToggleLater}
            >
              <Clock3 size={17} /><span className="reader-action-label-full">{readState === "later" ? "已排入稍後" : "稍後再讀"}</span><span className="reader-action-label-short">稍後</span>
            </button>
            <button
              type="button"
              disabled={!progressActions.available}
              aria-label={readState === "done" ? "取消已讀標記" : "標記為已讀完"}
              aria-pressed={readState === "done"}
              className={readState === "done" ? "active done" : ""}
              onClick={progressActions.onToggleDone}
            >
              <BookCheck size={17} /><span className="reader-action-label-full">{readState === "done" ? "已讀完" : "標記讀完"}</span><span className="reader-action-label-short">讀完</span>
            </button>
            <button
              type="button"
              aria-label={progressActions.bookmarked ? `取消收藏${bookmarkNoun}` : `收藏${bookmarkNoun}`}
              aria-pressed={progressActions.bookmarked}
              className={progressActions.bookmarked ? "active" : ""}
              onClick={progressActions.onToggleBookmark}
            >
              <Bookmark size={17} fill={progressActions.bookmarked ? "currentColor" : "none"} /><span>收藏</span>
            </button>
            {progressActions.annotationControl}
          </div>
        )}

        {!open && variantSelector}

        {outlineItems.length > 0 && (
          <nav className="guide-outline guide-outline-rail" aria-label={outlineAriaLabel}>
            <header><ListTree size={17} /><span>文章目錄・{outlineItems.length}</span></header>
            {outlineItems.map((item) => (
              <button type="button" key={item.id} data-level={item.level} onClick={() => { onSelectOutline?.(item.id); if (open) onClose(); }}>{item.label}</button>
            ))}
          </nav>
        )}
      </div>
    </aside>
  );
}
