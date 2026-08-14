"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

export type ReadingEdition = "concise" | "detailed";
export type ReadingDepth = "quick" | "standard" | "full" | "raw";
export type ReadingVariantValue = {
  edition: ReadingEdition;
  depth: ReadingDepth;
};

export type ReadingEditionOption = {
  id: ReadingEdition;
  label: string;
  detail?: string;
  disabled?: boolean;
  reason?: string;
};

export type ReadingDepthOption = {
  id: ReadingDepth;
  label: string;
  detail?: string;
  disabled?: boolean;
  reason?: string;
};

export const defaultReadingDepthOptions: ReadingDepthOption[] = [
  { id: "quick", label: "速讀", detail: "約五分鐘掌握重點" },
  { id: "standard", label: "普通", detail: "保留脈絡與必要細節" },
  { id: "full", label: "完整版", detail: "顯示完整內容與深入延伸" },
];

type SelectorStage = "collapsed" | "editions" | "depth";

type Props = {
  value: ReadingVariantValue;
  onCommit: (value: ReadingVariantValue) => void;
  editionOptions: ReadingEditionOption[];
  depthOptions?: ReadingDepthOption[];
  busy?: boolean;
  locked?: boolean;
  lockedReason?: string;
  ariaLabel?: string;
  className?: string;
};

const optionStyle = (index: number) => ({ "--index": index } as CSSProperties);

export default function ReadingVariantSelector({
  value,
  onCommit,
  editionOptions,
  depthOptions = defaultReadingDepthOptions,
  busy = false,
  locked = false,
  lockedReason,
  ariaLabel = "選擇內容版本與閱讀程度",
  className = "",
}: Props) {
  const [stage, setStage] = useState<SelectorStage>("collapsed");
  const [draftEdition, setDraftEdition] = useState<ReadingEdition>(value.edition);
  const rootRef = useRef<HTMLDivElement>(null);
  const previousStageRef = useRef<SelectorStage>("collapsed");
  const committingRef = useRef(false);
  const id = useId();
  const editionPanelId = `${id}-reading-variant-editions`;
  const depthPanelId = `${id}-reading-variant-depths`;
  const interactionLocked = busy || locked;

  const currentEdition = editionOptions.find((option) => option.id === value.edition);
  const currentDepth = depthOptions.find((option) => option.id === value.depth);
  const draftEditionOption = editionOptions.find((option) => option.id === draftEdition);
  const summary = `${currentEdition?.label ?? value.edition}｜${currentDepth?.label ?? value.depth}`;

  useEffect(() => {
    if (previousStageRef.current === stage) return;
    previousStageRef.current = stage;
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const preferred = root.querySelector<HTMLElement>("[data-selector-preferred='true']:not(:disabled):not([aria-disabled='true'])");
      const fallback = root.querySelector<HTMLElement>("[data-selector-focus]:not(:disabled):not([aria-disabled='true'])");
      (preferred ?? fallback)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [stage]);

  const openEditions = () => {
    if (interactionLocked) return;
    setDraftEdition(value.edition);
    setStage("editions");
  };

  const selectEdition = (option: ReadingEditionOption) => {
    if (interactionLocked || option.disabled) return;
    setDraftEdition(option.id);
    setStage("depth");
  };

  const commitVariant = (edition: ReadingEdition, option: ReadingDepthOption, collapse: boolean) => {
    const editionOption = editionOptions.find((candidate) => candidate.id === edition);
    if (interactionLocked || editionOption?.disabled || option.disabled || committingRef.current) return;
    committingRef.current = true;
    onCommit({ edition, depth: option.id });
    if (collapse) setStage("collapsed");
    queueMicrotask(() => { committingRef.current = false; });
  };

  const commitDepth = (option: ReadingDepthOption) => {
    commitVariant(draftEdition, option, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || interactionLocked || stage === "collapsed") return;
    event.preventDefault();
    event.stopPropagation();
    setStage(stage === "depth" ? "editions" : "collapsed");
  };

  const liveMessage = busy
    ? "正在更新閱讀內容"
    : stage === "editions"
      ? "請選擇內容版本"
      : stage === "depth"
        ? `已選擇${draftEditionOption?.label ?? draftEdition}，請選擇閱讀程度`
        : `目前為${summary}`;

  return (
    <div
      ref={rootRef}
      className={`reading-variant-selector ${className}`.trim()}
      data-stage={stage}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      aria-disabled={interactionLocked || undefined}
      onKeyDown={onKeyDown}
      role="group"
    >
      <span className="reading-variant-selector__status" aria-live="polite" aria-atomic="true">{liveMessage}</span>

      <div
        className="reading-variant-selector__desktop-matrix"
        style={{ "--reading-depth-count": depthOptions.length } as CSSProperties}
        role="group"
        aria-label="所有內容版本與閱讀程度"
      >
        {editionOptions.map((edition, editionIndex) => (
          <div key={edition.id} className="reading-variant-selector__desktop-row" role="group" aria-label={edition.label}>
            <div className="reading-variant-selector__desktop-heading">
              <strong>{edition.label}</strong>
              <small>{edition.disabled ? (edition.reason ?? "目前尚未開放") : edition.detail}</small>
            </div>
            <div className="reading-variant-selector__desktop-depths">
              {depthOptions.map((option, depthIndex) => {
                const unavailable = Boolean(edition.disabled || option.disabled);
                const unavailableReason = edition.disabled ? edition.reason : option.reason;
                const current = value.edition === edition.id && value.depth === option.id;
                return (
                  <button
                    key={`${edition.id}-${option.id}`}
                    type="button"
                    className={`reading-variant-selector__desktop-choice ${current ? "is-current" : ""}`.trim()}
                    style={optionStyle((editionIndex * depthOptions.length) + depthIndex)}
                    aria-label={`${edition.label}，${option.label}${unavailableReason ? `，${unavailableReason}` : ""}`}
                    aria-pressed={current}
                    aria-disabled={unavailable || undefined}
                    disabled={interactionLocked}
                    title={locked ? lockedReason : unavailable ? unavailableReason : option.detail}
                    onClick={() => commitVariant(edition.id, option, false)}
                  >
                    <strong>{option.label}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="reading-variant-selector__mobile-flow">
        {stage === "collapsed" && (
          <button
            type="button"
            className="reading-variant-selector__summary"
            aria-controls={editionPanelId}
            aria-expanded="false"
            aria-label={`變更閱讀模式，目前為${summary}`}
            data-selector-focus
            data-selector-preferred="true"
            disabled={interactionLocked}
            title={locked ? lockedReason : undefined}
            onClick={openEditions}
          >
            <span>{currentEdition?.label ?? value.edition}</span>
            <i aria-hidden="true" />
            <strong>{currentDepth?.label ?? value.depth}</strong>
            <b aria-hidden="true">⌄</b>
          </button>
        )}

        {stage === "editions" && (
          <div id={editionPanelId} className="reading-variant-selector__stage reading-variant-selector__stage--types" role="group" aria-label="內容版本">
            {editionOptions.map((option, index) => {
              const unavailable = Boolean(option.disabled);
              const reasonId = `${id}-type-${option.id}-reason`;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`reading-variant-selector__option ${draftEdition === option.id ? "is-selected" : ""}`.trim()}
                  style={optionStyle(index)}
                  aria-pressed={draftEdition === option.id}
                  aria-disabled={unavailable || undefined}
                  aria-describedby={unavailable && option.reason ? reasonId : undefined}
                  aria-controls={depthPanelId}
                  data-selector-focus
                  data-selector-preferred={draftEdition === option.id ? "true" : undefined}
                  disabled={interactionLocked}
                  onClick={() => selectEdition(option)}
                >
                  <span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
                  {unavailable && <em id={reasonId}>{option.reason ?? "目前尚未開放"}</em>}
                </button>
              );
            })}
          </div>
        )}

        {stage === "depth" && (
          <div id={depthPanelId} className="reading-variant-selector__stage reading-variant-selector__stage--complexity" role="group" aria-label="閱讀程度">
            <button
              type="button"
              className="reading-variant-selector__type-chip"
              aria-label={`返回內容版本選擇，目前選擇${draftEditionOption?.label ?? draftEdition}`}
              aria-controls={editionPanelId}
              aria-expanded="true"
              data-selector-focus
              disabled={interactionLocked}
              onClick={() => setStage("editions")}
            >
              <span>{draftEditionOption?.label ?? draftEdition}</span>
              <b aria-hidden="true">‹</b>
            </button>
            <div className="reading-variant-selector__complexities" role="group" aria-label="選擇閱讀程度">
              {depthOptions.map((option, index) => {
                const unavailable = Boolean(option.disabled);
                const reasonId = `${id}-complexity-${option.id}-reason`;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`reading-variant-selector__complexity ${value.edition === draftEdition && value.depth === option.id ? "is-current" : ""}`.trim()}
                    style={optionStyle(index)}
                    aria-pressed={value.edition === draftEdition && value.depth === option.id}
                    aria-disabled={unavailable || undefined}
                    aria-describedby={unavailable && option.reason ? reasonId : undefined}
                    data-selector-focus
                    data-selector-preferred={value.edition === draftEdition && value.depth === option.id ? "true" : undefined}
                    disabled={interactionLocked}
                    onClick={() => commitDepth(option)}
                  >
                    <strong>{option.label}</strong>
                    {option.detail && <small>{option.detail}</small>}
                    {unavailable && <em id={reasonId}>{option.reason ?? "目前尚未開放"}</em>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
