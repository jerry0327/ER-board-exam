/**
 * Best-effort background warmup for the small semantic subtitle manifest.
 *
 * This never asks for a chapter HXT bundle, an HXM timing sidecar, raw SRC,
 * or chapter JSON. Actual playback still performs the complete hash-bound
 * pair verification in `loadRuntimeSemanticAudioChapters`.
 */

import { validateRuntimeSemanticSubtitleManifest } from "./audio-runtime-semantic-package.ts";

type NavigatorHints = Navigator & {
  connection?: { effectiveType?: string; saveData?: boolean };
  deviceMemory?: number;
};

export type WarmRuntimeSemanticManifestOptions = {
  fetch?: typeof globalThis.fetch;
  manifestUrl?: string;
};

let pendingWarm: Promise<boolean> | null = null;

/**
 * The manifest is a small, Brotli-served index rather than a decoder or an
 * audio payload.  Keep the network safeguards, but do not exclude mobile
 * Safari merely because it intentionally omits `deviceMemory`.
 */
export function shouldBackgroundWarmRuntimeSemanticManifest() {
  if (typeof window === "undefined" || typeof document === "undefined" || document.visibilityState !== "visible") {
    return false;
  }
  const navigatorHints = navigator as NavigatorHints;
  const connection = navigatorHints.connection;
  if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) return false;
  if (connection?.effectiveType && connection.effectiveType !== "4g") return false;
  if ((navigator.hardwareConcurrency || 1) < 4) return false;
  const memory = navigatorHints.deviceMemory;
  return memory === undefined || memory >= 4;
}

/**
 * Fetch and structurally validate only the startup manifest.  Failure is
 * deliberately silent: it is a latency optimization, never a playback gate.
 */
export function warmRuntimeSemanticManifest(
  options: WarmRuntimeSemanticManifestOptions = {},
): Promise<boolean> {
  if (!shouldBackgroundWarmRuntimeSemanticManifest()) return Promise.resolve(false);
  if (pendingWarm) return pendingWarm;
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) return Promise.resolve(false);
  const request = (async () => {
    try {
      const response = await fetcher(options.manifestUrl ?? "/subtitles-runtime/manifest.json", {
        cache: "force-cache",
      });
      if (!response.ok) return false;
      const text = await response.text();
      const value: unknown = JSON.parse(text);
      if (`${JSON.stringify(value, null, 2)}\n` !== text) return false;
      validateRuntimeSemanticSubtitleManifest(value);
      return true;
    } catch {
      return false;
    }
  })();
  pendingWarm = request;
  void request.finally(() => {
    if (pendingWarm === request) pendingWarm = null;
  });
  return request;
}
