"use client";

import { useCallback, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Link2, Tags, X } from "lucide-react";
import { useMediaQueryMatch, useOverlayFocusManagement } from "../hooks/use-overlay-focus-management";
import {
  DEFAULT_TRACEABILITY_VISIBLE_COUNT,
  type TraceabilityAlias,
  type TraceabilityItem,
  type TraceabilityOptionItem,
  type TraceabilityOptionSelectHandler,
  type TraceabilityQuestionItem,
  type TraceabilityQuestionSelectHandler,
  type TraceabilityReferenceItem,
  type TraceabilityReferenceSelectHandler,
} from "./traceability-types";

export type TraceabilityPanelProps = {
  open: boolean;
  id: string;
  ariaLabel: string;
  title: string;
  eyebrow?: string;
  description?: string;
  directItems: readonly TraceabilityItem[];
  relatedItems: readonly TraceabilityItem[];
  directLabel?: string;
  relatedLabel?: string;
  directHint?: string;
  relatedHint?: string;
  directEmptyLabel?: string;
  relatedEmptyLabel?: string;
  countUnit?: string;
  initialVisibleCount?: number;
  loadMoreCount?: number;
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
  triggerRef?: RefObject<HTMLElement | null>;
  closeOnSelect?: boolean;
  onClose: () => void;
  onSelectQuestion?: TraceabilityQuestionSelectHandler;
  onSelectOption?: TraceabilityOptionSelectHandler;
  onSelectReference?: TraceabilityReferenceSelectHandler;
};

type TraceabilityGroupProps = {
  headingId: string;
  label: string;
  hint?: string;
  kind: "direct" | "related";
  emptyLabel: string;
  countUnit: string;
  items: readonly TraceabilityItem[];
  visibleCount: number;
  loadMoreCount: number;
  onLoadMore: () => void;
  onSelectQuestion?: TraceabilityQuestionSelectHandler;
  onSelectOption?: TraceabilityOptionSelectHandler;
  onSelectReference?: TraceabilityReferenceSelectHandler;
  onItemActivated: () => void;
};

const MOBILE_PANEL_QUERY = "(max-width: 600px)";
const MAX_VISIBLE_ALIASES = 3;

function normalizeCount(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function targetLabel(item: TraceabilityItem) {
  if (item.target.kind === "option") {
    return `題目 ${item.target.questionId}・選項 ${item.target.optionKey}`;
  }
  if (item.target.kind === "question") return `題目 ${item.target.questionId}`;
  return item.locator ?? "來源段落";
}

function aliasLabel(alias: TraceabilityAlias) {
  if (typeof alias === "string") return alias;
  return alias.canonicalLabel
    ? `${alias.label} → ${alias.canonicalLabel}`
    : alias.label;
}

function isQuestionItem(item: TraceabilityItem): item is TraceabilityQuestionItem {
  return item.target.kind === "question";
}

function isOptionItem(item: TraceabilityItem): item is TraceabilityOptionItem {
  return item.target.kind === "option";
}

function isReferenceItem(item: TraceabilityItem): item is TraceabilityReferenceItem {
  return item.target.kind === "reference";
}

function TraceabilityAliases({ aliases }: { aliases?: readonly TraceabilityAlias[] }) {
  if (!aliases?.length) return null;
  const visible = aliases.slice(0, MAX_VISIBLE_ALIASES);
  const remaining = aliases.length - visible.length;
  return (
    <span className="traceability-item-aliases">
      <Tags size={14} aria-hidden="true" />
      <span>別名：{visible.map(aliasLabel).join("、")}{remaining > 0 ? `，另 ${remaining} 個` : ""}</span>
    </span>
  );
}

function TraceabilityResult({
  item,
  onSelectQuestion,
  onSelectOption,
  onSelectReference,
  onItemActivated,
}: Pick<
  TraceabilityGroupProps,
  "onSelectQuestion" | "onSelectOption" | "onSelectReference" | "onItemActivated"
> & { item: TraceabilityItem }) {
  const canActivate = isQuestionItem(item)
    ? Boolean(onSelectQuestion)
    : isOptionItem(item)
      ? Boolean(onSelectOption)
      : Boolean(onSelectReference);
  const matchedOptionKeys = isQuestionItem(item)
    ? [...new Set(item.matchedOptionKeys ?? [])].sort((left, right) => left.localeCompare(right, "en"))
    : [];

  const activate = () => {
    if (isQuestionItem(item)) onSelectQuestion?.(item.target.questionId, item);
    else if (isOptionItem(item)) {
      onSelectOption?.(item.target.questionId, item.target.optionKey, item);
    } else if (isReferenceItem(item)) {
      onSelectReference?.(item.target.resourceId, item.target.anchorId, item);
    }
    onItemActivated();
  };

  const content = (
    <>
      <span className="traceability-item-copy">
        <span className="traceability-item-eyebrow">{item.eyebrow ?? targetLabel(item)}</span>
        <strong>{item.title}</strong>
        {item.excerpt && <span className="traceability-item-excerpt">{item.excerpt}</span>}
        {item.locator && (
          <span className="traceability-item-locator">{item.locator}</span>
        )}
        <TraceabilityAliases aliases={item.aliases} />
      </span>
      {canActivate && <ChevronRight className="traceability-item-chevron" size={17} aria-hidden="true" />}
    </>
  );

  const result = canActivate ? (
    <button
      type="button"
      className="traceability-item"
      data-reading-navigation-ignore
      style={{ minHeight: 44, textAlign: "left", width: "100%" }}
      onClick={activate}
    >
      {content}
    </button>
  ) : (
    <div className="traceability-item traceability-item-static">{content}</div>
  );

  if (!isQuestionItem(item)) return result;
  const questionId = item.target.questionId;
  const fallbackMatches = {
    matchesQuestionStem: Boolean(item.matchesQuestionStem),
    optionKeys: matchedOptionKeys,
  };
  const matchRows = item.directMatches || item.relatedMatches
    ? [
      item.directMatches ? { key: "direct", label: "直接考到", matches: item.directMatches } : null,
      item.relatedMatches ? {
        key: "related",
        label: item.directMatches ? "同題延伸" : "延伸位置",
        matches: item.relatedMatches,
      } : null,
    ].filter((row): row is NonNullable<typeof row> => Boolean(row))
    : fallbackMatches.matchesQuestionStem || fallbackMatches.optionKeys.length
      ? [{ key: "matched", label: "對照位置", matches: fallbackMatches }]
      : [];

  if (!matchRows.length) return result;

  return (
    <div className="traceability-question-item">
      {result}
      <div className="traceability-match-rows">
        {matchRows.map((row) => (
          <div
            key={row.key}
            className={`traceability-option-targets is-${row.key}`}
            role="group"
            aria-label={`題目 ${questionId} ${row.label}`}
          >
            <span className="traceability-option-targets-label">{row.label}</span>
            {row.matches.matchesQuestionStem && (onSelectQuestion ? (
              <button
                type="button"
                className="traceability-option-target"
                aria-label={`開啟 ${questionId} 題幹的詳解與來源對照`}
                data-reading-navigation-ignore
                onClick={() => {
                  onSelectQuestion(questionId, item);
                  onItemActivated();
                }}
              >
                題幹
              </button>
            ) : <span className="traceability-option-target traceability-option-target-static">題幹</span>)}
            {row.matches.optionKeys.map((optionKey) => onSelectOption ? (
              <button
                key={optionKey}
                type="button"
                className="traceability-option-target"
                aria-label={`開啟 ${questionId} 選項 ${optionKey} 的詳解與來源對照`}
                data-reading-navigation-ignore
                onClick={() => {
                  onSelectOption(questionId, optionKey, item);
                  onItemActivated();
                }}
              >
                {optionKey}
              </button>
            ) : (
              <span key={optionKey} className="traceability-option-target traceability-option-target-static">
                {optionKey}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TraceabilityGroup({
  headingId,
  label,
  hint,
  kind,
  emptyLabel,
  countUnit,
  items,
  visibleCount,
  loadMoreCount,
  onLoadMore,
  onSelectQuestion,
  onSelectOption,
  onSelectReference,
  onItemActivated,
}: TraceabilityGroupProps) {
  const visibleItems = items.slice(0, visibleCount);
  const remaining = Math.max(0, items.length - visibleItems.length);
  const nextCount = Math.min(loadMoreCount, remaining);

  return (
    <section className={`traceability-group is-${kind}`} aria-labelledby={headingId}>
      <header className="traceability-group-heading">
        <span><h2 id={headingId}>{label}</h2>{hint && <small>{hint}</small>}</span>
        <span aria-label={`${items.length} ${countUnit}`}>{items.length}</span>
      </header>
      {visibleItems.length > 0 ? (
        <ol className="traceability-list">
          {visibleItems.map((item, index) => (
            <li
              key={item.id}
              aria-posinset={index + 1}
              aria-setsize={items.length}
            >
              <TraceabilityResult
                item={item}
                onSelectQuestion={onSelectQuestion}
                onSelectOption={onSelectOption}
                onSelectReference={onSelectReference}
                onItemActivated={onItemActivated}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="traceability-group-empty">{emptyLabel}</p>
      )}
      {remaining > 0 && (
        <button
          type="button"
          className="traceability-load-more text-action"
          aria-label={`顯示更多${label}，目前顯示 ${visibleItems.length} ${countUnit}，共 ${items.length} ${countUnit}`}
          data-reading-navigation-ignore
          style={{ minHeight: 44, minWidth: 44 }}
          onClick={onLoadMore}
        >
          <ChevronDown size={16} aria-hidden="true" />
          顯示更多 {nextCount} 筆
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {`${label}目前顯示 ${visibleItems.length} ${countUnit}，共 ${items.length} ${countUnit}`}
      </span>
    </section>
  );
}

/**
 * Shared bidirectional traceability window.
 *
 * It is a right drawer on desktop and a bottom sheet on small screens. Only
 * the first 20 records in each group are mounted by default; more are added in
 * bounded batches so a large relationship index never floods the DOM.
 */
export default function TraceabilityPanel({
  open,
  id,
  ariaLabel,
  title,
  eyebrow = "雙向追溯",
  description,
  directItems,
  relatedItems,
  directLabel = "直接對照",
  relatedLabel = "相關概念",
  directHint,
  relatedHint,
  directEmptyLabel = "目前沒有直接對照。",
  relatedEmptyLabel = "目前沒有相關概念。",
  countUnit = "筆",
  initialVisibleCount = DEFAULT_TRACEABILITY_VISIBLE_COUNT,
  loadMoreCount = DEFAULT_TRACEABILITY_VISIBLE_COUNT,
  loading = false,
  loadingLabel = "正在載入追溯資料…",
  className,
  triggerRef,
  closeOnSelect = false,
  onClose,
  onSelectQuestion,
  onSelectOption,
  onSelectReference,
}: TraceabilityPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const compact = useMediaQueryMatch(MOBILE_PANEL_QUERY);
  const initialCount = normalizeCount(initialVisibleCount, DEFAULT_TRACEABILITY_VISIBLE_COUNT);
  const pageCount = normalizeCount(loadMoreCount, initialCount);
  const [visibleDirect, setVisibleDirect] = useState(initialCount);
  const [visibleRelated, setVisibleRelated] = useState(initialCount);
  const headingId = `${id}-heading`;
  const descriptionId = description ? `${id}-description` : undefined;
  const directHeadingId = `${id}-direct-heading`;
  const relatedHeadingId = `${id}-related-heading`;

  const closePanel = useCallback(() => {
    setVisibleDirect(initialCount);
    setVisibleRelated(initialCount);
    onClose();
  }, [initialCount, onClose]);

  useOverlayFocusManagement({
    open,
    panelRef,
    triggerRef,
    onClose: closePanel,
    initialFocusSelector: "[data-traceability-panel-initial-focus]",
  });

  const backdropStyle = useMemo<CSSProperties>(() => ({
    alignItems: compact ? "flex-end" : "stretch",
    display: "flex",
    justifyContent: "flex-end",
  }), [compact]);
  const panelStyle = useMemo<CSSProperties | undefined>(() => compact ? ({
    height: "min(86dvh, 760px)",
    marginLeft: 0,
    marginTop: "auto",
    maxWidth: "none",
    overflowY: "auto",
    paddingBottom: "max(16px, env(safe-area-inset-bottom))",
    width: "100%",
  }) : undefined, [compact]);
  const panelClassName = [
    "traceability-panel",
    "annotation-panel",
    compact ? "bottom-sheet-panel" : "drawer-panel",
    className,
  ].filter(Boolean).join(" ");
  const onItemActivated = () => {
    if (closeOnSelect) closePanel();
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="traceability-panel-backdrop annotation-panel-backdrop"
      data-reading-navigation-ignore
      style={backdropStyle}
      onClick={(event) => {
        if (event.target === event.currentTarget) closePanel();
      }}
    >
      <aside
        ref={panelRef}
        id={id}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        aria-busy={loading || undefined}
        tabIndex={-1}
        data-panel-layout={compact ? "bottom-sheet" : "right-drawer"}
        data-reading-navigation-ignore
        style={panelStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <span
            className="traceability-panel-header-icon"
            aria-hidden="true"
            style={{ display: "grid", height: 44, placeItems: "center", width: 44 }}
          >
            <Link2 size={18} />
          </span>
          <div>
            <span>{eyebrow}</span>
            <strong id={headingId}>{title}</strong>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={`關閉${ariaLabel}`}
            data-overlay-close
            data-reading-navigation-ignore
            data-traceability-panel-initial-focus
            onClick={closePanel}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {description && <p id={descriptionId} className="traceability-panel-description">{description}</p>}
        {loading && <p className="traceability-panel-loading" role="status">{loadingLabel}</p>}

        <div className="traceability-panel-groups">
          <TraceabilityGroup
            headingId={directHeadingId}
            label={directLabel}
            hint={directHint}
            kind="direct"
            emptyLabel={directEmptyLabel}
            countUnit={countUnit}
            items={directItems}
            visibleCount={visibleDirect}
            loadMoreCount={pageCount}
            onLoadMore={() => setVisibleDirect((count) => Math.min(directItems.length, count + pageCount))}
            onSelectQuestion={onSelectQuestion}
            onSelectOption={onSelectOption}
            onSelectReference={onSelectReference}
            onItemActivated={onItemActivated}
          />
          <TraceabilityGroup
            headingId={relatedHeadingId}
            label={relatedLabel}
            hint={relatedHint}
            kind="related"
            emptyLabel={relatedEmptyLabel}
            countUnit={countUnit}
            items={relatedItems}
            visibleCount={visibleRelated}
            loadMoreCount={pageCount}
            onLoadMore={() => setVisibleRelated((count) => Math.min(relatedItems.length, count + pageCount))}
            onSelectQuestion={onSelectQuestion}
            onSelectOption={onSelectOption}
            onSelectReference={onSelectReference}
            onItemActivated={onItemActivated}
          />
        </div>
      </aside>
    </div>,
    document.body,
  );
}
