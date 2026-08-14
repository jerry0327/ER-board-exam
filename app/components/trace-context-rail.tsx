"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Link2 } from "lucide-react";
import type { TraceabilityContext } from "./traceability-types";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type RailPosition = {
  left: number;
  top: number;
};

export type TraceContextRailProps = {
  /** The one currently active stem, option, or textbook passage. */
  anchorElement: HTMLElement | null;
  open: boolean;
  panelId: string;
  panelOpen: boolean;
  context?: TraceabilityContext | null;
  count?: number;
  label?: string;
  ariaLabel?: string;
  showLabel?: boolean;
  placement?: "auto" | "left" | "right";
  offset?: number;
  className?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  onOpenPanel: (context?: TraceabilityContext) => void;
  onDismiss?: () => void;
};

const VIEWPORT_MARGIN = 8;
const DEFAULT_OFFSET = 8;

function isOutsideViewport(rect: DOMRect) {
  return rect.bottom <= 0
    || rect.top >= window.innerHeight
    || rect.right <= 0
    || rect.left >= window.innerWidth;
}

/**
 * The single contextual action shared by every mapped block in a reader.
 *
 * The parent only changes `anchorElement`; this component follows it without
 * mounting a button for every sentence or answer option.
 */
export default function TraceContextRail({
  anchorElement,
  open,
  panelId,
  panelOpen,
  context,
  count,
  label = "查看對照",
  ariaLabel,
  showLabel = false,
  placement = "auto",
  offset = DEFAULT_OFFSET,
  className,
  triggerRef,
  onOpenPanel,
  onDismiss,
}: TraceContextRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<RailPosition | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!open || !anchorElement) {
      setPosition(null);
      return;
    }

    let animationFrame = 0;
    const updatePosition = () => {
      animationFrame = 0;
      if (!anchorElement.isConnected) {
        setPosition(null);
        return;
      }

      const anchorRect = anchorElement.getBoundingClientRect();
      if (isOutsideViewport(anchorRect)) {
        setPosition(null);
        return;
      }

      const railRect = railRef.current?.getBoundingClientRect();
      const railWidth = Math.max(44, railRect?.width ?? 44);
      const railHeight = Math.max(44, railRect?.height ?? 44);
      const rightPosition = anchorRect.right + offset;
      const leftPosition = anchorRect.left - offset - railWidth;
      const rightFits = rightPosition + railWidth <= window.innerWidth - VIEWPORT_MARGIN;
      const leftFits = leftPosition >= VIEWPORT_MARGIN;

      let left: number;
      if (placement === "right") left = rightFits ? rightPosition : leftPosition;
      else if (placement === "left") left = leftFits ? leftPosition : rightPosition;
      else if (rightFits) left = rightPosition;
      else if (leftFits) left = leftPosition;
      else left = Math.min(
        window.innerWidth - VIEWPORT_MARGIN - railWidth,
        Math.max(VIEWPORT_MARGIN, anchorRect.right - railWidth),
      );

      const centeredTop = anchorRect.top + (anchorRect.height - railHeight) / 2;
      const top = Math.min(
        window.innerHeight - VIEWPORT_MARGIN - railHeight,
        Math.max(VIEWPORT_MARGIN, centeredTop),
      );
      setPosition({ left, top });
    };
    const schedulePositionUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updatePosition);
    };

    updatePosition();
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(schedulePositionUpdate);
    observer?.observe(anchorElement);
    if (railRef.current) observer?.observe(railRef.current);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
    };
  }, [anchorElement, offset, open, placement]);

  useEffect(() => {
    if (!open || panelOpen || !anchorElement || !onDismiss) return;
    const cancelDismiss = () => {
      if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    };
    const scheduleDismiss = () => {
      if (dismissTimerRef.current !== null) return;
      dismissTimerRef.current = window.setTimeout(() => {
        dismissTimerRef.current = null;
        onDismiss();
      }, 520);
    };
    const targetIsWithinContext = (target: EventTarget | null) => target instanceof Node
      && (anchorElement.contains(target) || Boolean(railRef.current?.contains(target)));
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      if (targetIsWithinContext(event.target)) cancelDismiss();
      else scheduleDismiss();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (targetIsWithinContext(event.target)) cancelDismiss();
      else scheduleDismiss();
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      cancelDismiss();
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [anchorElement, onDismiss, open, panelOpen]);

  if (!open || !anchorElement || typeof document === "undefined") return null;

  const normalizedCount = typeof count === "number" ? Math.max(0, count) : undefined;
  const accessibleLabel = ariaLabel
    ?? [label, context?.label, normalizedCount === undefined ? null : `共 ${normalizedCount} 筆`]
      .filter(Boolean)
      .join("，");
  const style: CSSProperties = {
    left: position?.left ?? 0,
    minHeight: 44,
    minWidth: 44,
    position: "fixed",
    top: position?.top ?? 0,
    visibility: position ? "visible" : "hidden",
    zIndex: "var(--site-z-floating, 95)",
  };

  return createPortal(
    <div
      ref={railRef}
      className={["trace-context-rail", "floating-action-bar", className].filter(Boolean).join(" ")}
      role="toolbar"
      aria-label="追溯對照快捷工具"
      data-reading-navigation-ignore
      data-traceability-context-kind={context?.target.kind}
      style={style}
    >
      <button
        ref={triggerRef}
        type="button"
        className="trace-context-rail-button outline-button"
        aria-label={accessibleLabel}
        aria-haspopup="dialog"
        aria-controls={panelId}
        aria-expanded={panelOpen}
        data-reading-navigation-ignore
        style={{ minHeight: 44, minWidth: 44 }}
        onClick={() => onOpenPanel(context ?? undefined)}
      >
        <Link2 size={17} aria-hidden="true" />
        {showLabel && <span>{label}</span>}
        {normalizedCount !== undefined && (
          <span className="trace-context-rail-count" aria-hidden="true">{normalizedCount}</span>
        )}
      </button>
    </div>,
    document.body,
  );
}
