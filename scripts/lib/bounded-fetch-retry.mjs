const RETRYABLE_STATUS_SET = new Set([408, 425, 429, 500, 502, 503, 504]);
const NETWORK_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export const RETRYABLE_HTTP_STATUSES = Object.freeze([...RETRYABLE_STATUS_SET]);

export class RetryableHttpError extends Error {
  constructor(status, { retryAfter = null } = {}) {
    super(`retryable HTTP ${status}`);
    this.name = "RetryableHttpError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function isRetryableHttpStatus(status) {
  return RETRYABLE_STATUS_SET.has(status);
}

export function isRetryableNetworkError(error) {
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current instanceof TypeError || current?.name === "TypeError" || current?.name === "NetworkError") {
      return true;
    }
    if (current?.name === "AbortError" || current?.name === "TimeoutError") return true;
    if (typeof current?.code === "string" && NETWORK_ERROR_CODES.has(current.code)) {
      return true;
    }
    current = current?.cause;
  }
  return false;
}

function retryReason(error) {
  if (error instanceof RetryableHttpError) return `HTTP ${error.status}`;
  return "network error";
}

function retryAfterMilliseconds(value, now) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, timestamp - now());
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Retries only transport failures and explicitly retryable HTTP responses.
 * Validation, response-shape and hash errors pass through immediately.
 */
export async function withBoundedRetry(operation, {
  label = "Request",
  maxAttempts = 5,
  baseDelayMs = 500,
  maxDelayMs = 5_000,
  sleep = defaultSleep,
  now = Date.now,
  onRetry = null,
} = {}) {
  if (typeof operation !== "function") throw new TypeError("Retry operation must be a function");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
    throw new TypeError("Retry delays must be non-negative finite numbers");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const retryable = error instanceof RetryableHttpError || isRetryableNetworkError(error);
      if (!retryable) throw error;

      const reason = retryReason(error);
      if (attempt === maxAttempts) {
        // Deliberately omit the original error message: fetch failures must not
        // accidentally print request headers or the operator credential.
        throw new Error(`${label} failed after ${maxAttempts} attempts (${reason})`);
      }

      const exponentialDelay = baseDelayMs * (2 ** (attempt - 1));
      const serverDelay = error instanceof RetryableHttpError
        ? retryAfterMilliseconds(error.retryAfter, now)
        : 0;
      const delayMs = Math.min(maxDelayMs, Math.max(exponentialDelay, serverDelay));
      onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        reason,
      });
      await sleep(delayMs);
    }
  }

  throw new Error(`${label} exhausted its retry budget`);
}
