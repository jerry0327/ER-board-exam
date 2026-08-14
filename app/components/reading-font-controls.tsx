"use client";

import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { ReadingFontLevel } from "../hooks/use-reading-font-preference";

type Props = {
  level: ReadingFontLevel;
  onChange: (level: ReadingFontLevel) => void;
  className?: string;
  noun?: string;
  label?: ReactNode;
  ariaLabel?: string;
  decreaseLabel?: string;
  increaseLabel?: string;
  decreaseTitle?: string;
  increaseTitle?: string;
  disabled?: boolean;
};

/** Shared three-step font control; className may add layout only. */
export default function ReadingFontControls({
  level,
  onChange,
  className,
  noun = "閱讀文字",
  label = "字級",
  ariaLabel,
  decreaseLabel,
  increaseLabel,
  decreaseTitle,
  increaseTitle,
  disabled = false,
}: Props) {
  const smaller = decreaseLabel ?? `縮小${noun}`;
  const larger = increaseLabel ?? `放大${noun}`;

  return (
    <div className={["reading-font-controls", className].filter(Boolean).join(" ")} role="group" aria-label={ariaLabel ?? `調整${noun}大小`} data-reading-font-level={level}>
      <button type="button" aria-label={smaller} title={decreaseTitle ?? smaller} disabled={disabled || level === 0} onClick={() => onChange(Math.max(0, level - 1) as ReadingFontLevel)}><Minus /></button>
      <span>{label}</span>
      <button type="button" aria-label={larger} title={increaseTitle ?? larger} disabled={disabled || level === 2} onClick={() => onChange(Math.min(2, level + 1) as ReadingFontLevel)}><Plus /></button>
    </div>
  );
}
