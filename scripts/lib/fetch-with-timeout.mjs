export async function withFetchTimeout(timeoutMs, operation, {
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Fetch timeout must be a positive finite number");
  }
  if (typeof operation !== "function") {
    throw new TypeError("Fetch timeout operation must be a function");
  }

  const controller = new AbortController();
  const timeout = setTimer(() => controller.abort(), timeoutMs);
  timeout?.unref?.();
  try {
    return await operation(controller.signal);
  } finally {
    clearTimer(timeout);
  }
}
