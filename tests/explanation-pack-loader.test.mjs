import assert from "node:assert/strict";
import test from "node:test";
import { annotationExplanationPack, resolveExplanation } from "../app/lib/explanation-packs.ts";

const question = {
  id: "TEST-Q001",
  exam: "TEST",
  explanation: "## 核心理由\n\n原版內容",
};

function decodedBrotliJson(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-encoding": "br", "content-type": "application/octet-stream" },
  });
}

test("original explanations resolve without a sidecar request", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("不應請求精要分卷"); };
  try {
    const resolved = await resolveExplanation(question, "original");
    assert.equal(resolved.markdown, question.explanation);
    assert.equal(resolved.resolvedPackId, "original");
    assert.equal(resolved.fallback, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("concise explanations resolve from an exam chunk and safely fall back", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, cache: init?.cache });
    return decodedBrotliJson(url.includes("MISS")
      ? { schemaVersion: 1, packId: "concise", exam: "MISS", questionCount: 0, explanations: {} }
      : { schemaVersion: 1, packId: "concise", exam: "TEST", questionCount: 1, explanations: { "TEST-Q001": "## 核心理由\n\n精要內容" } });
  };
  try {
    const concise = await resolveExplanation(question, "concise");
    assert.match(concise.markdown, /精要內容/u);
    assert.equal(concise.resolvedPackId, "concise");
    assert.equal(concise.fallback, false);

    const fallback = await resolveExplanation({ ...question, id: "MISS-Q001", exam: "MISS" }, "concise");
    assert.equal(fallback.markdown, question.explanation);
    assert.equal(fallback.resolvedPackId, "original");
    assert.equal(fallback.fallback, true);
    assert.deepEqual(calls.map((call) => call.url), [
      "/data/explanation-packs/concise/TEST.json",
      "/data/explanation-packs/concise/MISS.json",
    ]);
    assert.ok(calls.every((call) => call.cache === "no-cache"));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("transient concise failures are retried once and the recovered pack is cached", async () => {
  const previousFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "/data/explanation-packs/concise/RETRY.json");
    attempts += 1;
    if (attempts === 1) return new Response("temporarily unavailable", { status: 503 });
    return decodedBrotliJson({
      schemaVersion: 1,
      packId: "concise",
      exam: "RETRY",
      questionCount: 1,
      explanations: { "RETRY-Q001": "## 核心理由\n\n重試成功" },
    });
  };
  try {
    const retryQuestion = { ...question, id: "RETRY-Q001", exam: "RETRY" };
    const recovered = await resolveExplanation(retryQuestion, "concise");
    assert.equal(recovered.fallback, false);
    assert.match(recovered.markdown, /重試成功/u);
    assert.match((await resolveExplanation(retryQuestion, "concise")).markdown, /重試成功/u);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("highlight IDs infer their pack while question notes remain cross-pack", () => {
  assert.equal(annotationExplanationPack("h_old-highlight"), "original");
  assert.equal(annotationExplanationPack("h_c_new-highlight"), "concise");
  assert.equal(annotationExplanationPack("h_r_original_quick_new-highlight"), "original");
  assert.equal(annotationExplanationPack("h_r_concise_standard_new-highlight"), "concise");
  assert.equal(annotationExplanationPack("q_TEST-Q001"), null);
});
