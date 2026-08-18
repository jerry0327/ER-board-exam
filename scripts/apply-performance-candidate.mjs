import fs from "node:fs/promises";

async function replaceUnique(file, before, after, label) {
  const source = await fs.readFile(file, "utf8");
  if (source.includes(after)) {
    console.log(`${label}: already applied`);
    return false;
  }
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`${label}: expected exactly one source match`);
  }
  await fs.writeFile(file, source.slice(0, first) + after + source.slice(first + before.length), "utf8");
  console.log(`${label}: applied`);
  return true;
}

let changed = false;

changed = await replaceUnique(
  "app/components/audio-player-provider.tsx",
  `const AUDIO_SHELL_URLS = [\n  \`/static-snac/decoder-worker.js?v=\${DECODER_WORKER_REVISION}\`,\n  "/static-snac/ort.webgpu.min.mjs?v=46988a5a025f",\n  "/static-snac/model-manifest.json?v=e713dc34ba7e",\n  \`/static-snac/snac-output.worklet.js?v=\${OUTPUT_WORKLET_REVISION}\`,\n] as const;`,
  `const AUDIO_SHELL_URLS = [\n  \`/static-snac/decoder-worker.js?v=\${DECODER_WORKER_REVISION}\`,\n  "/static-snac/ort.webgpu.min.mjs?v=46988a5a025f",\n  "/static-snac/ort-wasm-simd-threaded.asyncify.wasm",\n  "/static-snac/model-manifest.json?v=e713dc34ba7e",\n  \`/static-snac/snac-output.worklet.js?v=\${OUTPUT_WORKLET_REVISION}\`,\n] as const;`,
  "audio shell WASM prefetch",
) || changed;

changed = await replaceUnique(
  "app/components/audio-player-provider.tsx",
  `function shouldSpeculativelyWarmAudio() {\n  if (document.visibilityState !== "visible") return false;\n  const connection = (\n    navigator as Navigator & {\n      connection?: { effectiveType?: string; saveData?: boolean };\n      deviceMemory?: number;\n    }\n  ).connection;\n  if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) {\n    return false;\n  }\n  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;\n  return memory === undefined || memory >= 4;\n}\n\nfunction shouldPredecodeAudio() {\n  if (!shouldSpeculativelyWarmAudio() || !("gpu" in navigator)) return false;\n  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;\n  if (memory !== undefined && memory < 6) return false;\n  if (memory === undefined && window.matchMedia("(pointer: coarse)").matches) return false;\n  return (navigator.hardwareConcurrency || 1) >= 6;\n}`,
  `function shouldSpeculativelyWarmAudio() {\n  if (document.visibilityState !== "visible") return false;\n  const connection = (\n    navigator as Navigator & {\n      connection?: { effectiveType?: string; saveData?: boolean; downlink?: number };\n      deviceMemory?: number;\n    }\n  ).connection;\n  if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) {\n    return false;\n  }\n  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;\n  return memory === undefined || memory >= 4;\n}\n\nfunction shouldSpeculativelyWarmDecoder() {\n  if (!shouldSpeculativelyWarmAudio()) return false;\n  const connection = (navigator as Navigator & {\n    connection?: { effectiveType?: string; downlink?: number };\n  }).connection;\n  if (connection?.effectiveType === "3g") return false;\n  if (typeof connection?.downlink === "number" && connection.downlink > 0 && connection.downlink < 5) {\n    return false;\n  }\n  return true;\n}\n\nfunction shouldPredecodeAudio() {\n  if (!shouldSpeculativelyWarmDecoder() || !("gpu" in navigator)) return false;\n  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;\n  if (memory !== undefined && memory < 6) return false;\n  if (memory === undefined && window.matchMedia("(pointer: coarse)").matches) return false;\n  return (navigator.hardwareConcurrency || 1) >= 6;\n}`,
  "decoder warm capability gate",
) || changed;

changed = await replaceUnique(
  "app/components/audio-player-provider.tsx",
  `  const preparePlayer = useCallback(() => {\n    if (!shouldSpeculativelyWarmAudio()) return;`,
  `  const preparePlayer = useCallback(() => {\n    if (!shouldSpeculativelyWarmDecoder()) return;`,
  "decoder warm network gate",
) || changed;

changed = await replaceUnique(
  "public/static-snac/decoder-worker.js",
  `  const connection = self.navigator?.connection;\n  const memory = self.navigator?.deviceMemory;\n  const constrained = connection?.saveData\n    || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")\n    || (typeof memory === "number" && memory < 4);\n  const concurrency = constrained ? 1 : Math.min(2, manifest.parts.length);`,
  `  const connection = self.navigator?.connection;\n  const memory = self.navigator?.deviceMemory;\n  const cores = self.navigator?.hardwareConcurrency || 1;\n  const constrained = connection?.saveData\n    || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")\n    || (typeof memory === "number" && memory < 4);\n  const highBandwidth = connection?.effectiveType === "4g"\n    && (typeof connection?.downlink !== "number" || connection.downlink <= 0 || connection.downlink >= 8);\n  const highCapability = highBandwidth\n    && (typeof memory !== "number" || memory >= 8)\n    && cores >= 8;\n  const mediumCapability = !constrained\n    && (typeof memory !== "number" || memory >= 4)\n    && cores >= 4;\n  const concurrency = constrained\n    ? 1\n    : highCapability\n      ? Math.min(4, manifest.parts.length)\n      : mediumCapability\n        ? Math.min(3, manifest.parts.length)\n        : Math.min(2, manifest.parts.length);`,
  "adaptive model download concurrency",
) || changed;

changed = await replaceUnique(
  "app/question-bank-app.tsx",
  `  const audioPlayer = useAudioPlayer();\n  const prepareAudioShell = audioPlayer.prepareShell;`,
  `  const audioPlayer = useAudioPlayer();\n  const prepareAudioShell = audioPlayer.prepareShell;\n  const prepareAudioDecoder = audioPlayer.prepare;`,
  "capture decoder warm action",
) || changed;

changed = await replaceUnique(
  "app/question-bank-app.tsx",
  `  useEffect(() => {\n    prepareAudioForRoute(activeNav, activeNav === "詳解閱讀" ? requestedQuestionId : null);\n  }, [activeNav, prepareAudioForRoute, requestedQuestionId]);\n\n  useEffect(() => {\n    const targets = relatedRouteViews[activeNav];`,
  `  useEffect(() => {\n    prepareAudioForRoute(activeNav, activeNav === "詳解閱讀" ? requestedQuestionId : null);\n  }, [activeNav, prepareAudioForRoute, requestedQuestionId]);\n\n  useEffect(() => {\n    let frame: number | null = null;\n    let timer: number | null = null;\n    let cancelled = false;\n    const schedule = () => {\n      if (cancelled) return;\n      frame = window.requestAnimationFrame(() => {\n        timer = window.setTimeout(() => {\n          if (!cancelled && document.visibilityState === "visible") prepareAudioDecoder();\n        }, 900);\n      });\n    };\n    if (document.readyState === "complete") schedule();\n    else window.addEventListener("load", schedule, { once: true });\n    return () => {\n      cancelled = true;\n      window.removeEventListener("load", schedule);\n      if (frame !== null) window.cancelAnimationFrame(frame);\n      if (timer !== null) window.clearTimeout(timer);\n    };\n  }, [prepareAudioDecoder]);\n\n  useEffect(() => {\n    const targets = relatedRouteViews[activeNav];`,
  "post-load global decoder warm",
) || changed;

if (!changed) console.log("No candidate changes were needed.");
