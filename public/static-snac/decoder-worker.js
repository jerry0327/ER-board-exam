import * as ort from "./ort.webgpu.min.mjs?v=46988a5a025f";

const resolveWorkerUrl = (path) => new URL(path, import.meta.url).href;
const SAMPLE_RATE = 24_000;
const FINE_FRAME_SAMPLES = 512;
const WINDOW_FRAMES = 48;
const HOP_FRAMES = 40;
const CENTER_START = 4 * FINE_FRAME_SAMPLES;
const KEEP_SAMPLES = HOP_FRAMES * FINE_FRAME_SAMPLES;
const CROSSFADE_SAMPLES = Math.round(SAMPLE_RATE * 0.012);
const DEFAULT_PRIME_SECONDS = 3.4;
const MAX_PRIME_WINDOWS = 4;
const FACTORS = [2_048, 1_024, 512];

let session = null;
let sessionPromise = null;
let sessionBackend = "wasm";
let chapterCodes = null;
let activeChapterKey = null;
let activeChapterDuration = 0;
let activeLoadRequestId = 0;
let activeLoadController = null;
let previousTail = null;
let previousGeneration = -1;
let previousFineOffset = -HOP_FRAMES;
let decodeBusy = false;
let pendingDecode = null;
let primedChapterKey = null;
let primedPcmByOffset = new Map();

function chapterCacheKey(chapterFile, revision, expected) {
  return [
    chapterFile,
    revision ?? "",
    expected?.dataSha256 ?? "",
    expected?.metadataSha256 ?? "",
  ].join(":");
}

function resetDecodeContinuity() {
  previousTail = null;
  previousGeneration = -1;
  previousFineOffset = -HOP_FRAMES;
}

function validateExpected(expected) {
  if (
    !expected
    || !Number.isInteger(expected.dataBytes)
    || !Number.isInteger(expected.metadataBytes)
    || !/^[a-f0-9]{64}$/u.test(expected.dataSha256)
    || !/^[a-f0-9]{64}$/u.test(expected.metadataSha256)
  ) {
    throw new Error("Chapter integrity metadata is unavailable.");
  }
}

function encodeRelativePath(value) {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function verifiedBytes(response, expectedBytes, expectedSha256, label) {
  if (!response.ok) throw new Error(`${label} could not be loaded.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== expectedBytes) throw new Error(`${label} size verification failed.`);
  if (await sha256Hex(bytes) !== expectedSha256) throw new Error(`${label} integrity verification failed.`);
  return bytes;
}

function unpack12(bytes, offset, count) {
  const values = new BigInt64Array(count);
  let accumulator = 0;
  let availableBits = 0;
  let sourceOffset = offset;
  for (let index = 0; index < count; index += 1) {
    while (availableBits < 12) {
      accumulator |= bytes[sourceOffset] << availableBits;
      sourceOffset += 1;
      availableBits += 8;
    }
    values[index] = BigInt(accumulator & 0x0fff);
    accumulator >>>= 12;
    availableBits -= 12;
  }
  return values;
}

function parsePacket(chapterBytes, packetInfo) {
  const [byteOffset, byteLength, , , trimStart, trimEnd] = packetInfo;
  const bytes = chapterBytes.subarray(byteOffset, byteOffset + byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "SNC1") {
    throw new Error("SNC1 packet header is invalid.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lengths = [
    view.getUint32(13, true),
    view.getUint32(17, true),
    view.getUint32(21, true),
  ];
  const values = unpack12(bytes, 25, lengths.reduce((sum, value) => sum + value, 0));
  const result = [];
  let offset = 0;
  lengths.forEach((length, index) => {
    const code = values.slice(offset, offset + length);
    result.push(code.slice(
      trimStart / FACTORS[index],
      code.length - trimEnd / FACTORS[index],
    ));
    offset += length;
  });
  return result;
}

function concatenateCodebooks(packetCodes) {
  return [0, 1, 2].map((codebook) => {
    const total = packetCodes.reduce((sum, codes) => sum + codes[codebook].length, 0);
    const combined = new BigInt64Array(total);
    let offset = 0;
    packetCodes.forEach((codes) => {
      combined.set(codes[codebook], offset);
      offset += codes[codebook].length;
    });
    return combined;
  });
}

async function fetchModel() {
  const manifest = await fetch(
    resolveWorkerUrl("./model-manifest.json?v=e713dc34ba7e"),
    { cache: "force-cache" },
  ).then((response) => {
    if (!response.ok) throw new Error("Static model manifest could not be loaded.");
    return response.json();
  });
  const combined = new Uint8Array(manifest.totalBytes);
  let loadedBytes = 0;
  let nextPartIndex = 0;
  const connection = self.navigator?.connection;
  const memory = self.navigator?.deviceMemory;
  const cores = self.navigator?.hardwareConcurrency || 1;
  const constrained = connection?.saveData
    || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")
    || (typeof memory === "number" && memory < 4);
  const highBandwidth = connection?.effectiveType === "4g"
    && (typeof connection?.downlink !== "number" || connection.downlink <= 0 || connection.downlink >= 8);
  const highCapability = highBandwidth
    && (typeof memory !== "number" || memory >= 8)
    && cores >= 8;
  const mediumCapability = !constrained
    && (typeof memory !== "number" || memory >= 4)
    && cores >= 4;
  const concurrency = constrained
    ? 1
    : highCapability
      ? Math.min(4, manifest.parts.length)
      : mediumCapability
        ? Math.min(3, manifest.parts.length)
        : Math.min(2, manifest.parts.length);
  const fetchNextPart = async () => {
    while (nextPartIndex < manifest.parts.length) {
      const part = manifest.parts[nextPartIndex];
      nextPartIndex += 1;
      const buffer = await fetch(resolveWorkerUrl(part.url), {
        cache: "force-cache",
      }).then((response) => {
        if (!response.ok) throw new Error(`Static model part failed: ${part.url}`);
        return response.arrayBuffer();
      });
      const bytes = new Uint8Array(buffer);
      combined.set(bytes, part.offset);
      loadedBytes += bytes.byteLength;
      self.postMessage({
        kind: "progress",
        loadedBytes,
        totalBytes: manifest.totalBytes,
      });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, fetchNextPart));
  return combined;
}

async function ensureSession() {
  if (session) return session;
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const threads = Math.min(2, Math.max(1, navigator.hardwareConcurrency || 1));
    const webgpuAvailable = "gpu" in navigator;
    ort.env.wasm.numThreads = threads;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = resolveWorkerUrl("./");
    if (webgpuAvailable) ort.env.webgpu.powerPreference = "high-performance";
    const model = await fetchModel();

    if (webgpuAvailable) {
      try {
        session = await ort.InferenceSession.create(model, {
          executionProviders: [
            {
              name: "webgpu",
              preferredLayout: "NHWC",
              validationMode: "basic",
            },
            "wasm",
          ],
          graphOptimizationLevel: "all",
          enableCpuMemArena: false,
          enableMemPattern: false,
        });
        sessionBackend = "webgpu";
      } catch (error) {
        console.warn("WebGPU initialization failed; using the compatible path.", error);
      }
    }
    if (!session) {
      session = await ort.InferenceSession.create(model, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
    }
    return session;
  })().catch((error) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

async function loadChapterData(chapterFile, revision, expected, requestId) {
  validateExpected(expected);
  activeLoadController?.abort();
  activeLoadController = null;
  activeLoadRequestId = requestId;
  pendingDecode = null;
  const cacheKey = chapterCacheKey(chapterFile, revision, expected);
  if (chapterCodes && activeChapterKey === cacheKey) {
    return {
      cacheKey,
      duration: activeChapterDuration,
      fineFrames: chapterCodes[2].length,
    };
  }

  resetDecodeContinuity();
  primedChapterKey = null;
  primedPcmByOffset = new Map();
  const controller = new AbortController();
  activeLoadController = controller;
  const chapterBase = resolveWorkerUrl(`/audio/snac/${encodeRelativePath(chapterFile)}`);
  const versionQuery = revision
    ? `?v=${encodeURIComponent(revision)}`
    : "";
  const [manifestBuffer, chapterBuffer] = await Promise.all([
    fetch(`${chapterBase}.snac.json${versionQuery}`, {
      cache: "force-cache",
      signal: controller.signal,
    }).then((response) => verifiedBytes(
      response,
      expected.metadataBytes,
      expected.metadataSha256,
      "Chapter manifest",
    )),
    fetch(`${chapterBase}.snac${versionQuery}`, {
      cache: "force-cache",
      signal: controller.signal,
    }).then((response) => verifiedBytes(
      response,
      expected.dataBytes,
      expected.dataSha256,
      "Chapter SNAC data",
    )),
    ensureSession(),
  ]);
  if (requestId !== activeLoadRequestId) return;

  const manifest = JSON.parse(new TextDecoder().decode(manifestBuffer));
  const chapterBytes = new Uint8Array(chapterBuffer);
  if (
    manifest.dataBytes !== expected.dataBytes
    || manifest.dataSha256 !== expected.dataSha256
  ) {
    throw new Error("Chapter manifest and audio payload do not match.");
  }
  const nextCodes = concatenateCodebooks(
    manifest.packets.map((packet) => parsePacket(chapterBytes, packet)),
  );
  if (requestId !== activeLoadRequestId) return;
  chapterCodes = nextCodes;
  activeChapterKey = cacheKey;
  activeChapterDuration = manifest.playbackDurationSeconds;
  activeLoadController = null;
  return {
    cacheKey,
    duration: activeChapterDuration,
    fineFrames: chapterCodes[2].length,
  };
}

async function loadChapter(chapterFile, revision, expected, requestId) {
  const loaded = await loadChapterData(chapterFile, revision, expected, requestId);
  if (!loaded || requestId !== activeLoadRequestId) return;
  self.postMessage({
    kind: "ready",
    requestId,
    backend: sessionBackend,
    duration: loaded.duration,
    fineFrames: loaded.fineFrames,
  });
}

async function decodeWindowPcm(message) {
  if (!session || !chapterCodes) throw new Error("Static decoder is not ready.");
  const codes = chapterCodes;
  const fineOffset = Math.min(
    Math.max(0, message.fineOffset),
    codes[2].length - WINDOW_FRAMES,
  );
  const feeds = {
    codes0: new ort.Tensor(
      "int64",
      codes[0].slice(fineOffset / 4, fineOffset / 4 + 12),
      [1, 12],
    ),
    codes1: new ort.Tensor(
      "int64",
      codes[1].slice(fineOffset / 2, fineOffset / 2 + 24),
      [1, 24],
    ),
    codes2: new ort.Tensor(
      "int64",
      codes[2].slice(fineOffset, fineOffset + 48),
      [1, 48],
    ),
  };
  const decodeStarted = performance.now();
  const result = await session.run(feeds);
  const decodeMs = performance.now() - decodeStarted;
  const source = result.audio.data;
  const pcm = new Float32Array(KEEP_SAMPLES);
  pcm.set(source.subarray(CENTER_START, CENTER_START + KEEP_SAMPLES));
  for (let index = 0; index < pcm.length; index += 1) {
    if (!Number.isFinite(pcm[index])) {
      throw new Error("Decoder returned invalid audio samples.");
    }
  }

  const isContinuous = previousGeneration === message.generation
    && previousFineOffset + HOP_FRAMES === fineOffset
    && previousTail;
  if (isContinuous) {
    for (let index = 0; index < CROSSFADE_SAMPLES; index += 1) {
      const phase = (index + 0.5) / CROSSFADE_SAMPLES * Math.PI / 2;
      pcm[index] = previousTail[index] * Math.cos(phase)
        + pcm[index] * Math.sin(phase);
    }
  } else {
    const fadeSamples = Math.min(120, pcm.length);
    for (let index = 0; index < fadeSamples; index += 1) {
      pcm[index] *= Math.sin((index + 0.5) / fadeSamples * Math.PI / 2);
    }
  }
  previousTail = new Float32Array(CROSSFADE_SAMPLES);
  previousTail.set(source.subarray(
    CENTER_START + KEEP_SAMPLES,
    CENTER_START + KEEP_SAMPLES + CROSSFADE_SAMPLES,
  ));
  previousGeneration = message.generation;
  previousFineOffset = fineOffset;

  return { pcm, fineOffset, decodeMs };
}

async function decodeWindow(message) {
  const requestedOffset = Math.min(
    Math.max(0, message.fineOffset),
    chapterCodes[2].length - WINDOW_FRAMES,
  );
  const primedPcm = primedChapterKey === activeChapterKey
    ? primedPcmByOffset.get(requestedOffset)
    : null;
  const decoded = primedPcm
    ? { pcm: primedPcm.slice(), fineOffset: requestedOffset, decodeMs: 0 }
    : await decodeWindowPcm(message);
  if (primedPcm) {
    previousGeneration = message.generation;
    previousFineOffset = requestedOffset;
  }
  self.postMessage({
    kind: "decoded",
    generation: message.generation,
    fineOffset: decoded.fineOffset,
    decodeMs: decoded.decodeMs,
    pcm: decoded.pcm.buffer,
  }, [decoded.pcm.buffer]);
}

async function drainDecodeQueue() {
  if (decodeBusy) return;
  decodeBusy = true;
  try {
    while (pendingDecode) {
      const message = pendingDecode;
      pendingDecode = null;
      await decodeWindow(message);
    }
  } catch (error) {
    self.postMessage({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    decodeBusy = false;
    if (pendingDecode) void drainDecodeQueue();
  }
}

async function primeChapter(message) {
  const loaded = await loadChapterData(
    message.chapterFile,
    message.revision,
    message.expected,
    message.requestId,
  );
  if (!loaded || message.requestId !== activeLoadRequestId) return;
  if (decodeBusy) throw new Error("Decoder is busy with active playback.");

  const requestedSeconds = Number.isFinite(message.seconds)
    ? Math.min(DEFAULT_PRIME_SECONDS, Math.max(0, message.seconds))
    : DEFAULT_PRIME_SECONDS;
  const secondsPerWindow = KEEP_SAMPLES / SAMPLE_RATE;
  const availableWindows = Math.max(
    0,
    Math.floor((loaded.fineFrames - WINDOW_FRAMES) / HOP_FRAMES) + 1,
  );
  const windowCount = Math.min(
    MAX_PRIME_WINDOWS,
    availableWindows,
    Math.max(1, Math.ceil(requestedSeconds / secondsPerWindow)),
  );
  const nextPrimedPcm = new Map();
  resetDecodeContinuity();
  decodeBusy = true;
  try {
    for (let index = 0; index < windowCount; index += 1) {
      if (message.requestId !== activeLoadRequestId) return;
      const fineOffset = index * HOP_FRAMES;
      const decoded = await decodeWindowPcm({
        generation: message.requestId,
        fineOffset,
      });
      if (message.requestId !== activeLoadRequestId) return;
      nextPrimedPcm.set(decoded.fineOffset, decoded.pcm);
    }
    if (message.requestId !== activeLoadRequestId) return;
    primedChapterKey = loaded.cacheKey;
    primedPcmByOffset = nextPrimedPcm;
    self.postMessage({
      kind: "primed",
      requestId: message.requestId,
      sourceKey: message.sourceKey,
      backend: sessionBackend,
      seconds: windowCount * secondsPerWindow,
      windows: windowCount,
    });
  } finally {
    decodeBusy = false;
    if (pendingDecode) void drainDecodeQueue();
  }
}

self.addEventListener("message", async (event) => {
  try {
    if (event.data.kind === "warm") {
      await ensureSession();
      self.postMessage({ kind: "warmed", backend: sessionBackend });
      return;
    }
    if (event.data.kind === "load") {
      await loadChapter(
        event.data.chapterFile,
        event.data.revision,
        event.data.expected,
        event.data.requestId,
      );
      return;
    }
    if (event.data.kind === "prime") {
      await primeChapter(event.data);
      return;
    }
    if (event.data.kind === "decode") {
      pendingDecode = event.data;
      void drainDecodeQueue();
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    self.postMessage({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
      requestId: event.data.kind === "load" || event.data.kind === "prime"
        ? event.data.requestId
        : undefined,
      generation: event.data.kind === "decode" ? event.data.generation : undefined,
    });
  }
});
