"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookMarked, Highlighter, MessageSquareText, NotebookPen, Pencil, Plus, Trash2, X } from "lucide-react";
import AnnotationDrawer from "./annotation-drawer";
import MarkdownContent from "./markdown-content";
import {
  annotationBlockAnchorFrom,
  annotationBlockKey,
  annotationBlockMetadata,
  annotationBlockSourceOffset,
  annotationCanonicalHeadingKey,
  excerptBlockKind,
  nearestAnnotationSourceOffset,
} from "../lib/annotation-block-anchor";
import { ANNOTATION_EXCERPT_QUOTE_LIMIT } from "../lib/annotation-limits";
import { annotationExplanationPack, type ExplanationPackId } from "../lib/explanation-packs";
import { guideLegacyAnnotationId, guideResourceAnnotationId, parseReaderAnnotationScope } from "../lib/annotation-source";
import { scrollElementIntoView } from "../lib/motion";
import type { AnnotationExcerptRequest, StudyAnnotation } from "../lib/types";

export type ContentAnnotationSource = {
  resourceId: string;
  eyebrow: string;
  panelLabel: string;
  rootNoteTitle: string;
  rootNoteDescription: string;
  rootNotePlaceholder: string;
  emptyHint: string;
  kind: "question" | "guide";
  annotationPrefix: string;
  /** Reading depth/raw mode that produced an excerpt. */
  contentScope?: string;
  explanationPack?: ExplanationPackId;
  /** Additional ids from an older representation that belong to this source. */
  legacyIds?: string[];
};

export type ContentAnnotationDraft = {
  id: string;
  questionId: string;
  kind: StudyAnnotation["kind"];
  body: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  startOffset?: number | null;
  endOffset?: number | null;
};

export type ContentAnnotationToolsProps = {
  source: ContentAnnotationSource;
  contentKey: string;
  pendingExcerpt?: AnnotationExcerptRequest | null;
  onExcerptHandled?: () => void;
  annotations: StudyAnnotation[];
  annotationStatus?: "loading" | "synced" | "local" | "error";
  onUpsert: (draft: ContentAnnotationDraft) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  hideTrigger?: boolean;
  /**
   * Change this token to open the panel from an external toolbar. A string
   * matching an annotation id opens that item; a positive number opens the
   * list. Zero/null/undefined are inert initial values.
   */
  openRequest?: string | number | null;
  onOpenChange?: (open: boolean) => void;
  /** Backward-compatible deep link used to restore and reveal a highlight. */
  requestedAnnotationId?: string | null;
};

type SelectionAnchor = {
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
};

function randomId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function scopedAnnotationId(prefix: string) {
  const normalized = prefix.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 48);
  const safePrefix = normalized.startsWith("h_") ? normalized : `h_${normalized || "content"}_`;
  return `${safePrefix}${randomId()}`;
}

function rootNoteId(source: ContentAnnotationSource) {
  if (source.kind === "guide") {
    const guideId = guideLegacyAnnotationId(source.resourceId) ?? guideResourceAnnotationId(source.resourceId);
    if (guideId) return guideId;
  }
  return `q_${source.resourceId.replace(/[^A-Za-z0-9_-]/gu, "_")}`;
}

function contentRoot(resourceId: string) {
  const containers = document.querySelectorAll<HTMLElement>("[data-content-annotation-root], [data-question-annotation-root]");
  for (const container of containers) {
    const id = container.dataset.contentAnnotationRoot ?? container.dataset.questionAnnotationRoot;
    if (id !== resourceId) continue;
    if (container.matches(".markdown-body")) return container;
    return container.querySelector<HTMLElement>(".full-explanation .markdown-body")
      ?? container.querySelector<HTMLElement>(".markdown-body")
      ?? container.querySelector<HTMLElement>(".full-explanation .guide-raw-source")
      ?? (container.matches(".guide-raw-source") ? container : null);
  }
  return null;
}

function textNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent?.closest(".katex, script, style, [data-annotation-action]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function textMap(root: HTMLElement) {
  const nodes = textNodes(root);
  let text = "";
  const spans = nodes.map((node) => {
    const start = text.length;
    text += node.data;
    return { node, start, end: text.length };
  });
  return { text, spans };
}

function rangeFromOffsets(root: HTMLElement, start: number, end: number) {
  const { spans } = textMap(root);
  const startSpan = spans.find((span) => start >= span.start && start <= span.end);
  const endSpan = spans.find((span) => end >= span.start && end <= span.end);
  if (!startSpan || !endSpan) return null;
  const range = document.createRange();
  range.setStart(startSpan.node, Math.min(start - startSpan.start, startSpan.node.length));
  range.setEnd(endSpan.node, Math.min(end - endSpan.start, endSpan.node.length));
  return range;
}

function locateAnnotation(root: HTMLElement, annotation: StudyAnnotation) {
  if (!annotation.quote) return null;
  const { text } = textMap(root);
  const stored = annotation.startOffset ?? -1;
  if (stored >= 0 && text.slice(stored, stored + annotation.quote.length) === annotation.quote) {
    return rangeFromOffsets(root, stored, stored + annotation.quote.length);
  }
  const matches: number[] = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const found = text.indexOf(annotation.quote, cursor);
    if (found < 0) break;
    const prefixMatches = !annotation.prefix
      || text.slice(Math.max(0, found - annotation.prefix.length), found) === annotation.prefix;
    const suffixMatches = !annotation.suffix
      || text.slice(found + annotation.quote.length, found + annotation.quote.length + annotation.suffix.length) === annotation.suffix;
    if (prefixMatches && suffixMatches) matches.push(found);
    cursor = found + Math.max(1, annotation.quote.length);
  }
  return matches.length === 1
    ? rangeFromOffsets(root, matches[0], matches[0] + annotation.quote.length)
    : null;
}

function elementWithData(root: HTMLElement, attribute: string, value: string) {
  return [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)]
    .find((element) => element.getAttribute(attribute) === value) ?? null;
}

function companionElements(resourceId: string) {
  return [...document.querySelectorAll<HTMLElement>("[data-content-annotation-companion]")]
    .filter((element) => element.dataset.contentAnnotationCompanion === resourceId);
}

function elementWithDataForSource(root: HTMLElement, resourceId: string, attribute: string, value: string) {
  return companionElements(resourceId).find((element) => element.getAttribute(attribute) === value)
    ?? elementWithData(root, attribute, value)
    ?? null;
}

function locateExcerptBlock(root: HTMLElement, annotation: StudyAnnotation, resourceId: string) {
  if (annotation.kind !== "excerpt") return null;
  const anchor = annotationBlockAnchorFrom(annotation);
  if (anchor) {
    const exact = elementWithDataForSource(root, resourceId, "data-annotation-anchor", anchor);
    if (exact) return exact;
  }
  const block = excerptBlockKind(annotation.quote);
  if (!block) return null;
  const key = annotationBlockKey(block, annotation.quote);
  const companionMatches = companionElements(resourceId)
    .filter((element) => element.dataset.annotationBlockKey === key);
  if (companionMatches.length === 1) return companionMatches[0];
  const rootMatches = [...root.querySelectorAll<HTMLElement>("[data-annotation-block-key]")]
    .filter((element) => element.dataset.annotationBlockKey === key);
  if (rootMatches.length === 1) return rootMatches[0];
  if (block !== "heading") return null;

  const canonicalKey = annotationCanonicalHeadingKey(annotation.quote);
  const canonicalMatches = [
    ...companionElements(resourceId)
      .filter((element) => element.dataset.annotationCanonicalHeadingKey === canonicalKey),
    ...root.querySelectorAll<HTMLElement>("[data-annotation-canonical-heading-key]"),
  ].filter((element, index, matches) => (
    element.dataset.annotationCanonicalHeadingKey === canonicalKey
    && matches.indexOf(element) === index
  ));
  if (canonicalMatches.length === 1) return canonicalMatches[0];

  const legacyOffset = annotationBlockSourceOffset(anchor);
  if (legacyOffset === null) return null;
  const nearestIndex = nearestAnnotationSourceOffset(
    legacyOffset,
    canonicalMatches.map((element) => {
      const value = element.dataset.annotationSourceOffset;
      if (!value || !/^\d+$/u.test(value)) return null;
      const offset = Number.parseInt(value, 10);
      return Number.isSafeInteger(offset) ? offset : null;
    }),
  );
  return nearestIndex === null ? null : canonicalMatches[nearestIndex];
}

function excerptLabel(value: string) {
  const heading = /^#{1,4}\s+(.+)$/mu.exec(value)?.[1]?.replace(/[*_`]/gu, "").trim();
  if (heading) return heading;
  const setextHeading = /^\s*([^\n|]+)\n\s*(?:=+|-+)\s*$/mu.exec(value)?.[1]?.replace(/[*_`]/gu, "").trim();
  if (setextHeading) return setextHeading;
  if (/^\s*\|.+\|/mu.test(value)) return "表格摘錄";
  return "內容摘錄";
}

function scopedIdMatches(source: ContentAnnotationSource, id: string) {
  if (source.kind === "question" && source.explanationPack) {
    const readerScope = parseReaderAnnotationScope(id);
    if (readerScope) return id.startsWith(source.annotationPrefix);
    // Legacy Reader ids predate depth-aware annotation scopes. They remain
    // available in the full view only, which is also the deep-link fallback.
    return source.contentScope === "full"
      && annotationExplanationPack(id) === source.explanationPack;
  }
  return id.startsWith(source.annotationPrefix);
}

function annotationTitle(source: ContentAnnotationSource, annotation: Pick<ContentAnnotationDraft, "kind">) {
  if (annotation.kind === "question_note") return source.rootNoteTitle;
  if (annotation.kind === "excerpt") return "內容摘錄";
  return "重點附註";
}

export default function ContentAnnotationTools({
  source,
  contentKey,
  pendingExcerpt,
  onExcerptHandled,
  annotations,
  annotationStatus = "synced",
  onUpsert,
  onRemove,
  hideTrigger = false,
  openRequest,
  onOpenChange,
  requestedAnnotationId,
}: ContentAnnotationToolsProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionAnchor | null>(null);
  const [editing, setEditing] = useState<ContentAnnotationDraft | null>(null);
  const [notice, setNotice] = useState("");
  const previousOpenRef = useRef(false);
  const handledOpenRequestRef = useRef<string | number | null | undefined>(null);
  const handledRequestedAnnotationRef = useRef<string | null>(null);
  const unavailableRequestedAnnotationRef = useRef<string | null>(null);
  const returnTargetRef = useRef<HTMLElement | null>(null);
  const currentRootNoteId = useMemo(() => rootNoteId(source), [source]);
  const legacyIds = useMemo(
    () => new Set([currentRootNoteId, ...(source.legacyIds ?? [])]),
    [currentRootNoteId, source.legacyIds],
  );
  const sourceAnnotations = useMemo(() => annotations.filter((item) => {
    if (item.questionId !== source.resourceId) return false;
    if (source.kind === "question") {
      return item.kind === "question_note"
        || legacyIds.has(item.id)
        || scopedIdMatches(source, item.id);
    }
    return item.kind === "question_note"
      || legacyIds.has(item.id)
      || scopedIdMatches(source, item.id);
  }), [annotations, legacyIds, source]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  const showPanel = useCallback((draft?: ContentAnnotationDraft | null) => {
    clearSelection();
    if (draft !== undefined) setEditing(draft);
    setPanelOpen(true);
  }, [clearSelection]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setEditing(null);
    clearSelection();
    const target = returnTargetRef.current;
    returnTargetRef.current = null;
    if (target?.isConnected) {
      window.requestAnimationFrame(() => {
        scrollElementIntoView(target, { block: "center" });
        target.focus({ preventScroll: true });
      });
    }
  }, [clearSelection]);

  useEffect(() => {
    if (previousOpenRef.current === panelOpen) return;
    previousOpenRef.current = panelOpen;
    onOpenChange?.(panelOpen);
  }, [onOpenChange, panelOpen]);

  useEffect(() => {
    const activeRequest = typeof openRequest === "number" ? openRequest > 0 : Boolean(openRequest);
    if (!activeRequest || Object.is(handledOpenRequestRef.current, openRequest)) return;
    handledOpenRequestRef.current = openRequest;
    const requested = typeof openRequest === "string"
      ? sourceAnnotations.find((item) => item.id === openRequest)
      : null;
    showPanel(requested ? { ...requested } : null);
  }, [openRequest, showPanel, sourceAnnotations]);

  useEffect(() => {
    const requestKey = requestedAnnotationId ? `${source.resourceId}:${requestedAnnotationId}` : null;
    if (!requestKey) {
      // A deep link can be opened again without remounting the reader. Reset
      // the handled marker when the parent returns to the source's base route.
      handledRequestedAnnotationRef.current = null;
      unavailableRequestedAnnotationRef.current = null;
      return;
    }
    if (handledRequestedAnnotationRef.current === requestKey) return;
    const requested = sourceAnnotations.find((item) => item.id === requestedAnnotationId);
    if (!requested) return;
    const frame = window.requestAnimationFrame(() => {
      handledRequestedAnnotationRef.current = requestKey;
      showPanel({ ...requested });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedAnnotationId, showPanel, source.resourceId, sourceAnnotations]);

  useEffect(() => {
    const requestKey = requestedAnnotationId ? `${source.resourceId}:${requestedAnnotationId}` : null;
    if (!requestKey || annotationStatus === "loading") return;
    if (sourceAnnotations.some((item) => item.id === requestedAnnotationId)) return;
    if (unavailableRequestedAnnotationRef.current === requestKey) return;
    // Sync can publish its final state one render before a just-migrated local
    // annotation reaches React. Keep a short grace window, then return an
    // unresolved/deleted deep link to the source's base route so controls do
    // not remain locked forever.
    const timer = window.setTimeout(() => {
      unavailableRequestedAnnotationRef.current = requestKey;
      onOpenChange?.(false);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [annotationStatus, onOpenChange, requestedAnnotationId, source.resourceId, sourceAnnotations]);

  useEffect(() => {
    if (!requestedAnnotationId) returnTargetRef.current = null;
    const root = contentRoot(source.resourceId);
    if (!root) return;
    const registry = (CSS as unknown as { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } }).highlights;
    const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const ranges = sourceAnnotations
      .filter((item) => item.kind === "highlight")
      .map((item) => ({ item, range: locateAnnotation(root, item) }))
      .filter((value): value is { item: StudyAnnotation; range: Range } => Boolean(value.range));
    if (registry && HighlightConstructor) {
      registry.set("study-highlights", new HighlightConstructor(...ranges.map((item) => item.range)));
    }
    if (requestedAnnotationId) {
      const requestedAnnotation = sourceAnnotations.find((item) => item.id === requestedAnnotationId);
      const requestedRange = ranges.find((item) => item.item.id === requestedAnnotationId)?.range;
      const excerptTarget = requestedAnnotation ? locateExcerptBlock(root, requestedAnnotation, source.resourceId) : null;
      const target = excerptTarget ?? requestedRange?.startContainer.parentElement ?? null;
      returnTargetRef.current = excerptTarget;
      if (target) {
        requestAnimationFrame(() => {
          scrollElementIntoView(target, { block: "center" });
          excerptTarget?.focus({ preventScroll: true });
        });
      }
    }
    return () => { registry?.delete("study-highlights"); };
  }, [contentKey, requestedAnnotationId, source.resourceId, sourceAnnotations]);

  useEffect(() => {
    if (!pendingExcerpt) return;
    const frame = window.requestAnimationFrame(() => {
      if (pendingExcerpt.markdown.length > ANNOTATION_EXCERPT_QUOTE_LIMIT) {
        showPanel(null);
        setNotice("這個區段過長，請改由較小的子標題加入筆記。");
        onExcerptHandled?.();
        return;
      }
      const root = contentRoot(source.resourceId);
      returnTargetRef.current = root
        ? elementWithDataForSource(root, source.resourceId, "data-annotation-anchor", pendingExcerpt.sourceAnchor)
        : null;
      showPanel({
        id: scopedAnnotationId(source.annotationPrefix),
        questionId: source.resourceId,
        kind: "excerpt",
        body: "",
        quote: pendingExcerpt.markdown,
        prefix: annotationBlockMetadata(pendingExcerpt.sourceAnchor, source.contentScope),
        suffix: "",
        startOffset: null,
        endOffset: null,
      });
      setNotice("");
      onExcerptHandled?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onExcerptHandled, pendingExcerpt, showPanel, source.annotationPrefix, source.contentScope, source.resourceId]);

  useEffect(() => {
    let timer = 0;
    const capture = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const nativeSelection = window.getSelection();
        if (!nativeSelection || nativeSelection.isCollapsed || !nativeSelection.rangeCount) {
          setSelection(null);
          return;
        }
        const range = nativeSelection.getRangeAt(0);
        const root = contentRoot(source.resourceId);
        if (!root || !root.contains(range.startContainer) || !root.contains(range.endContainer)) {
          setSelection(null);
          return;
        }
        const element = range.commonAncestorContainer instanceof Element
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
        if (element?.closest("[data-annotation-action]")) {
          setSelection(null);
          return;
        }
        if (element?.closest(".katex")) {
          setNotice("數學式請改用筆記。");
          setSelection(null);
          return;
        }
        const raw = range.toString();
        const quote = raw.trim();
        if (!quote) {
          setSelection(null);
          return;
        }
        if (quote.length > 1200) {
          setNotice("反白內容超過 1,200 字；請縮短範圍，或使用區塊旁的筆記圖示。");
          setSelection(null);
          return;
        }
        const leading = raw.length - raw.trimStart().length;
        const map = textMap(root);
        const startSpan = range.startContainer instanceof Text
          ? map.spans.find((span) => span.node === range.startContainer)
          : null;
        if (!startSpan) {
          setNotice("選取範圍太長，請縮短後再試。");
          setSelection(null);
          return;
        }
        const startOffset = startSpan.start + range.startOffset + leading;
        const anchor = {
          quote,
          startOffset,
          endOffset: startOffset + quote.length,
          prefix: map.text.slice(Math.max(0, startOffset - 48), startOffset),
          suffix: map.text.slice(startOffset + quote.length, startOffset + quote.length + 48),
        };
        const overlaps = sourceAnnotations.some((item) => item.kind === "highlight"
          && item.startOffset !== null
          && item.endOffset !== null
          && anchor.startOffset < item.endOffset
          && anchor.endOffset > item.startOffset);
        if (overlaps) {
          setNotice("這段文字已經有重點標記。");
          setSelection(null);
          return;
        }
        setNotice("");
        setSelection(anchor);
      }, 240);
    };
    document.addEventListener("selectionchange", capture);
    document.addEventListener("pointerup", capture);
    document.addEventListener("keyup", capture);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", capture);
      document.removeEventListener("pointerup", capture);
      document.removeEventListener("keyup", capture);
    };
  }, [source.resourceId, sourceAnnotations]);

  const saveHighlight = async (withNote: boolean) => {
    if (!selection) return;
    const draft: ContentAnnotationDraft = {
      id: scopedAnnotationId(source.annotationPrefix),
      questionId: source.resourceId,
      kind: "highlight",
      body: "",
      ...selection,
    };
    if (withNote) {
      showPanel(draft);
      return;
    }
    try {
      await onUpsert(draft);
      clearSelection();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "重點尚未儲存");
    }
  };

  const openRootNote = () => {
    const existing = sourceAnnotations.find((item) => item.id === currentRootNoteId)
      ?? sourceAnnotations.find((item) => item.kind === "question_note");
    showPanel(existing
      ? { ...existing }
      : { id: currentRootNoteId, questionId: source.resourceId, kind: "question_note", body: "" });
  };

  const overlays = selection ? (
    <div className="selection-action-bar floating-action-bar" role="toolbar" aria-label="選取文字操作">
      <span title={selection.quote}>{selection.quote}</span>
      <div className="selection-action-buttons">
        <button onClick={() => void saveHighlight(false)}><Highlighter size={17} />畫重點</button>
        <button aria-label="將選取文字加入筆記" onClick={() => void saveHighlight(true)}><MessageSquareText size={17} />加筆記</button>
        <button aria-label="取消選取" onClick={clearSelection}><X size={18} /></button>
      </div>
    </div>
  ) : null;

  const bodyLimit = editing?.kind === "question_note" && source.kind === "guide" ? 12_000 : 4_000;

  return <>
    {/* LightningCSS does not yet parse the CSS Custom Highlight pseudo-element;
        keep this single shared rule beside the one annotation implementation. */}
    <style>{`::highlight(study-highlights){background-color:var(--site-study-highlight-wash);color:inherit;text-decoration-color:var(--site-study-highlight-stroke);text-decoration-line:underline;text-decoration-skip-ink:none;text-decoration-thickness:.52em;text-underline-offset:-.28em}@media (forced-colors:active){::highlight(study-highlights){background-color:Highlight;color:HighlightText;text-decoration:none}}`}</style>
    {!hideTrigger && (
      <div className="reader-annotation-control">
        <button aria-haspopup="dialog" aria-expanded={panelOpen} aria-controls="content-note-drawer" onClick={() => showPanel()}>
          <BookMarked size={17} />筆記{sourceAnnotations.length > 0 && <span>{sourceAnnotations.length}</span>}
        </button>
      </div>
    )}
    {typeof document !== "undefined" && createPortal(overlays, document.body)}
    <AnnotationDrawer
      open={panelOpen}
      id="content-note-drawer"
      ariaLabel={source.panelLabel}
      eyebrow={source.eyebrow}
      title={editing ? annotationTitle(source, editing) : source.panelLabel}
      backDisabled={!editing}
      onBack={() => setEditing(null)}
      onClose={closePanel}
    >
      {notice && <p className="annotation-notice" role="status">{notice}</p>}
      {editing ? (
        <div className="annotation-editor">
          {editing.quote && (editing.kind === "excerpt"
            ? <div className="annotation-excerpt-preview"><MarkdownContent markdown={editing.quote} variant="annotation" /></div>
            : <blockquote>{editing.quote}</blockquote>)}
          {source.kind === "guide" && editing.kind === "question_note" && editing.body.trim() && (
            <div className="annotation-excerpt-preview"><MarkdownContent markdown={editing.body} variant="annotation" /></div>
          )}
          <label>筆記<textarea autoFocus value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} maxLength={bodyLimit} placeholder={editing.kind === "question_note" ? source.rootNotePlaceholder : editing.kind === "excerpt" ? "補充這個內容區塊的重點、用途或待查事項…" : "補充為什麼這段重要…"} /></label>
          <small>{editing.body.length.toLocaleString("zh-TW")} / {bodyLimit.toLocaleString("zh-TW")}</small>
          <button className="primary-button" onClick={() => { void onUpsert(editing).then(() => setEditing(null)).catch((error) => setNotice(error instanceof Error ? error.message : "筆記尚未儲存")); }}>儲存筆記</button>
        </div>
      ) : (
        <div className="annotation-list">
          <button className="new-question-note" onClick={openRootNote}><Plus /><span><strong>{source.rootNoteTitle}</strong><small>{source.rootNoteDescription}</small></span></button>
          {sourceAnnotations.map((annotation) => (
            <article key={annotation.id}>
              <div>{annotation.kind === "highlight" ? <Highlighter /> : annotation.kind === "excerpt" ? <NotebookPen /> : <BookMarked />}</div>
              <button onClick={() => setEditing({ ...annotation })}><strong>{annotation.kind === "excerpt" ? excerptLabel(annotation.quote) : annotation.quote || source.rootNoteTitle}</strong><span>{annotation.body || (annotation.kind === "excerpt" ? "已保存原文格式" : "尚未加入附註")}</span></button>
              <button aria-label="編輯" onClick={() => setEditing({ ...annotation })}><Pencil /></button>
              <button aria-label="刪除" onClick={() => { if (window.confirm("確定刪除這則筆記？")) void onRemove(annotation.id); }}><Trash2 /></button>
            </article>
          ))}
          {!sourceAnnotations.length && <p>{source.emptyHint}</p>}
        </div>
      )}
    </AnnotationDrawer>
  </>;
}
