import assert from "node:assert/strict";
import test from "node:test";

import { withFetchTimeout } from "../scripts/lib/fetch-with-timeout.mjs";

test("fetch timeout stays active until the response body operation finishes", async () => {
  let cleared = false;
  let timeoutCallback = null;
  const result = withFetchTimeout(60_000, async (signal) => {
    assert.equal(signal.aborted, false);
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return "unreachable";
  }, {
    setTimer(callback) {
      timeoutCallback = callback;
      return { unref() {} };
    },
    clearTimer() {
      cleared = true;
    },
  });

  assert.equal(typeof timeoutCallback, "function");
  timeoutCallback();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(cleared, true);
});

test("fetch timeout always clears its timer after success or failure", async () => {
  let clearCount = 0;
  const timerOptions = {
    setTimer() {
      return { unref() {} };
    },
    clearTimer() {
      clearCount += 1;
    },
  };

  assert.equal(await withFetchTimeout(1_000, async () => "ok", timerOptions), "ok");
  await assert.rejects(
    withFetchTimeout(1_000, async () => {
      throw new Error("body read failed");
    }, timerOptions),
    /body read failed/u,
  );
  assert.equal(clearCount, 2);
});
