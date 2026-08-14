export function motionSafeScrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

export function scrollPageToTop() {
  if (typeof window === "undefined") return;
  window.scrollTo({ top: 0, behavior: motionSafeScrollBehavior() });
}

export function scrollElementIntoView(
  target: Element | null | undefined,
  options: Omit<ScrollIntoViewOptions, "behavior"> = {},
) {
  target?.scrollIntoView({ ...options, behavior: motionSafeScrollBehavior() });
}

export function scrollContainerToOrigin(target: HTMLElement | null | undefined) {
  target?.scrollTo({ top: 0, left: 0, behavior: motionSafeScrollBehavior() });
}
