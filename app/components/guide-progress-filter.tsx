"use client";

import type { GuideReadState } from "../lib/types";

export type GuideProgressFilterValue = "all" | "reading" | "later" | "done" | "bookmarked";

type ProgressLike = {
  readState?: GuideReadState;
  bookmarked?: number | boolean;
} | null | undefined;

export function matchesGuideProgressFilter(progress: ProgressLike, filter: GuideProgressFilterValue) {
  if (filter === "all") return true;
  if (filter === "bookmarked") return progress?.bookmarked === 1 || progress?.bookmarked === true;
  return progress?.readState === filter;
}

type Props = {
  value: GuideProgressFilterValue;
  onChange: (value: GuideProgressFilterValue) => void;
  ariaLabel: string;
};

/** Shared personal-progress filter used by every textbook chapter catalog. */
export default function GuideProgressFilter({ value, onChange, ariaLabel }: Props) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as GuideProgressFilterValue)} aria-label={ariaLabel}>
      <option value="all">我的全部進度</option>
      <option value="reading">閱讀中</option>
      <option value="later">稍後閱讀</option>
      <option value="done">已完成</option>
      <option value="bookmarked">已收藏</option>
    </select>
  );
}
