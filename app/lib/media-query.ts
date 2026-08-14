type MediaQueryListener = (event: MediaQueryListEvent) => void;

type CompatibleMediaQueryList = MediaQueryList & {
  addListener?: (listener: MediaQueryListener) => void;
  removeListener?: (listener: MediaQueryListener) => void;
};

export function subscribeToMediaQuery(
  media: MediaQueryList,
  listener: MediaQueryListener,
) {
  const compatible = media as CompatibleMediaQueryList;
  if (typeof compatible.addEventListener === "function") {
    try {
      compatible.addEventListener("change", listener);
      return () => {
        try {
          compatible.removeEventListener?.("change", listener);
        } catch {
          // A partial WebView implementation can reject cleanup after teardown.
        }
      };
    } catch {
      // Fall through to the legacy MediaQueryList API.
    }
  }
  if (typeof compatible.addListener === "function") {
    try {
      compatible.addListener(listener);
      return () => {
        try {
          compatible.removeListener?.(listener);
        } catch {
          // Cleanup is best-effort on older embedded browsers.
        }
      };
    } catch {
      // Theme and layout remain usable without a live system-theme listener.
    }
  }
  return () => undefined;
}
