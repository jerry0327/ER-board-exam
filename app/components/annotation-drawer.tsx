"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, X } from "lucide-react";
import { useDialogFocus } from "../hooks/use-dialog-focus";

type Props = {
  open: boolean;
  id?: string;
  ariaLabel: string;
  eyebrow: string;
  title: string;
  backLabel?: string;
  backDisabled?: boolean;
  onBack?: () => void;
  onClose: () => void;
  children: ReactNode;
};

/** Shared right-side note window used by question explanations and learning guides. */
export default function AnnotationDrawer({
  open,
  id,
  ariaLabel,
  eyebrow,
  title,
  backLabel = "返回筆記清單",
  backDisabled,
  onBack,
  onClose,
  children,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  useDialogFocus(open, panelRef, onClose);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="annotation-panel-backdrop" onClick={onClose}>
      <aside
        ref={panelRef}
        id={id}
        tabIndex={-1}
        className="annotation-panel drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <button type="button" aria-label={backLabel} disabled={backDisabled ?? !onBack} onClick={onBack}>
            <ArrowLeft />
          </button>
          <div><span>{eyebrow}</span><strong>{title}</strong></div>
          <button type="button" aria-label={`關閉${ariaLabel}`} onClick={onClose}><X /></button>
        </header>
        {children}
      </aside>
    </div>,
    document.body,
  );
}
