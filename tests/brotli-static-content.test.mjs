import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditCompressedRoot,
  brotliQuality,
  compressRawFiles,
  computeQuestionDataRevision,
  contentPackDirectory,
  contentPackFiles,
  contentPackMaxRawBytes,
  contentPackSchemaVersion,
  contentPackSingletonBytes,
  contentPackTargetBytes,
  discardExpandedStaticContent,
  expandCompressedFiles,
  legacyBrotliFiles,
  markStaticContentTransactionRunning,
  markStaticContentTransactionSucceeded,
  preserveFailedExpandedStaticContent,
  rawFiles,
  readContentPackIndex,
  startupSingletonLogicalPaths,
} from "../scripts/lib/static-content-codec.mjs";

function legacyBrotli(bytes) {
  return brotliCompressSync(bytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  });
}

async function directorySnapshot(directory, root = directory, output = new Map()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await directorySnapshot(absolute, root, output);
    else output.set(path.relative(root, absolute), await readFile(absolute));
  }
  return output;
}

function assertSnapshotsEqual(actual, expected) {
  assert.equal(actual.size, expected.size);
  for (const [relative, bytes] of expected) {
    assert.deepEqual(actual.get(relative), bytes, relative);
  }
}

test("Brotli q11 packs are deterministic, lossless, record-aligned, and reusable", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-pack-"));
  const dataRoot = path.join(contentRoot, "data");
  const guideRoot = path.join(contentRoot, "guides");
  const jsonPath = path.join(dataRoot, "sample.json");
  const secondJsonPath = path.join(dataRoot, "second.json");
  const markdownPath = path.join(guideRoot, "chapter.md");
  const json = Buffer.from(JSON.stringify({ title: "急診題庫", body: "長期保存的靜態教材".repeat(80) }), "utf8");
  const secondJson = Buffer.from(JSON.stringify({ title: "第二題", body: "鑑別診斷".repeat(50) }), "utf8");
  const markdown = Buffer.from(`# 學習指引\n\n${"處置與例外。\n".repeat(90)}`, "utf8");

  try {
    await mkdir(dataRoot, { recursive: true });
    await mkdir(guideRoot, { recursive: true });
    await writeFile(jsonPath, json);
    await writeFile(secondJsonPath, secondJson);
    await writeFile(markdownPath, markdown);

    const first = compressRawFiles({ contentRoot, targetBytes: 700 });
    assert.equal(brotliQuality, 11);
    assert.equal(contentPackTargetBytes, 8 * 1024 * 1024);
    assert.equal(contentPackSingletonBytes, 1024 * 1024);
    assert.equal(first.files, 3);
    assert.ok(first.packs >= 2);
    assert.equal(first.updatedFiles, first.packs + 2);
    assert.equal(rawFiles(contentRoot).length, 0);
    assert.equal(legacyBrotliFiles(contentRoot).length, 0);
    assert.equal(contentPackFiles(contentRoot).length, first.packs);

    const index = readContentPackIndex(contentRoot);
    assert.equal(index.v, contentPackSchemaVersion);
    assert.equal(index.t, 700);
    assert.equal(index.s, 700);
    assert.deepEqual(index.e.map(([logicalPath]) => logicalPath), [
      "data/sample.json",
      "data/second.json",
      "guides/chapter.md",
    ]);
    const oversized = index.e.find(([logicalPath]) => logicalPath === "data/sample.json");
    assert.equal(oversized[2], 0);
    assert.equal(index.p[oversized[1]][1], oversized[3]);
    assert.equal(oversized.length, 4);
    const digestSidecar = await readFile(path.join(
      contentPackDirectory(contentRoot),
      "digests",
      index.d[0],
    ));
    assert.equal(digestSidecar.length, index.e.length * 32);
    assert.equal(createHash("sha256").update(digestSidecar).digest("hex"), index.d[2]);
    const entryNumber = index.e.indexOf(oversized);
    assert.equal(
      digestSidecar.subarray(entryNumber * 32, (entryNumber + 1) * 32).toString("hex"),
      createHash("sha256").update(json).digest("hex"),
    );

    const audit = auditCompressedRoot(contentRoot);
    assert.equal(audit.files, 3);
    assert.equal(audit.packs, first.packs);
    assert.equal(audit.logicalBytes, json.length + secondJson.length + markdown.length);
    assert.ok(audit.storedBytes > 0);

    const firstSnapshot = await directorySnapshot(contentPackDirectory(contentRoot));
    expandCompressedFiles(contentRoot);
    assert.deepEqual(await readFile(jsonPath), json);
    assert.deepEqual(await readFile(secondJsonPath), secondJson);
    assert.deepEqual(await readFile(markdownPath), markdown);

    const second = compressRawFiles({ contentRoot, targetBytes: 700 });
    assert.equal(second.updatedFiles, 0);
    assert.equal(second.reusedFiles, 3);
    assertSnapshotsEqual(await directorySnapshot(contentPackDirectory(contentRoot)), firstSnapshot);

    const reblocked = compressRawFiles({ contentRoot, targetBytes: 900 });
    assert.ok(reblocked.updatedFiles > 0);
    assert.equal(readContentPackIndex(contentRoot).t, 900);

    expandCompressedFiles(contentRoot);
    const changed = Buffer.from(JSON.stringify({ title: "急診題庫", body: "內容已變更".repeat(100) }), "utf8");
    const addedPath = path.join(guideRoot, "new.md");
    const added = Buffer.from("# 新章節\n\n新增內容。", "utf8");
    await writeFile(jsonPath, changed);
    await unlink(secondJsonPath);
    await writeFile(addedPath, added);
    const third = compressRawFiles({ contentRoot, targetBytes: 700 });
    assert.equal(third.files, 3);
    assert.ok(third.updatedFiles > 0);
    expandCompressedFiles(contentRoot);
    assert.deepEqual(await readFile(jsonPath), changed);
    await assert.rejects(readFile(secondJsonPath), /ENOENT/u);
    assert.deepEqual(await readFile(addedPath), added);

    compressRawFiles({ contentRoot, targetBytes: 700 });
    const firstPack = contentPackFiles(contentRoot)[0];
    const corrupted = await readFile(firstPack);
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
    await writeFile(firstPack, corrupted);
    assert.throws(() => auditCompressedRoot(contentRoot), /摘要不符|無法解壓/u);
  } finally {
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("startup manifests use dedicated packs so first render never expands an 8 MiB corpus pack", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-startup-"));
  const startupFiles = [
    ["data/manifest.json", JSON.stringify({ count: 2 })],
    ["data/startup-index.json", JSON.stringify({ questions: [{ id: "Q001" }] })],
    ["guides/links.json", JSON.stringify({ "Q001": ["001"] })],
    ["guides/manifest.json", JSON.stringify({ chapters: ["001"] })],
  ];
  const chapter = ["guides/tintinalli/001.md", `# 第一章\n\n${"急診處置原則。\n".repeat(500)}`];

  try {
    for (const [logicalPath, value] of [...startupFiles, chapter]) {
      const target = path.join(contentRoot, logicalPath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, value);
    }

    compressRawFiles({ contentRoot, targetBytes: contentPackTargetBytes });
    const index = readContentPackIndex(contentRoot);
    for (const [logicalPath] of startupFiles) {
      assert.equal(startupSingletonLogicalPaths.has(logicalPath), true);
      const [, packNumber, offset, length] = index.e.find(([entryPath]) => entryPath === logicalPath);
      assert.equal(offset, 0);
      assert.equal(length, index.p[packNumber][1]);
    }

    const reused = compressRawFiles({ contentRoot, targetBytes: contentPackTargetBytes });
    assert.equal(reused.updatedFiles, 0);
  } finally {
    discardExpandedStaticContent(contentRoot);
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("a legacy v1 pack index is expanded and repacked with a digest sidecar", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-v1-index-"));
  const logicalPath = "data/legacy.json";
  const raw = Buffer.from(JSON.stringify({ version: "legacy-v1" }), "utf8");
  const compressed = legacyBrotli(raw);
  const packHash = createHash("sha256").update(compressed).digest("hex");
  const packRoot = path.join(contentPackDirectory(contentRoot), "packs");

  try {
    await mkdir(packRoot, { recursive: true });
    await writeFile(path.join(packRoot, `${packHash}.brp`), compressed);
    await writeFile(
      path.join(contentPackDirectory(contentRoot), "index.brp"),
      legacyBrotli(Buffer.from(JSON.stringify({
        v: 1,
        t: 1024,
        s: 1024,
        p: [[`${packHash}.brp`, raw.length, packHash]],
        e: [[logicalPath, 0, 0, raw.length]],
      }), "utf8")),
    );

    const migrated = compressRawFiles({ contentRoot, targetBytes: 1024 });
    assert.equal(migrated.files, 1);
    const index = readContentPackIndex(contentRoot);
    assert.equal(index.v, contentPackSchemaVersion);
    assert.equal(index.e[0].length, 4);
    const digestSidecar = await readFile(path.join(
      contentPackDirectory(contentRoot),
      "digests",
      index.d[0],
    ));
    assert.equal(digestSidecar.toString("hex"), createHash("sha256").update(raw).digest("hex"));
    expandCompressedFiles(contentRoot);
    assert.deepEqual(await readFile(path.join(contentRoot, logicalPath)), raw);
  } finally {
    discardExpandedStaticContent(contentRoot);
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("question data revisions cover question paths and exact bytes only", () => {
  const original = Buffer.from('{"id":"115B-Q200","answerKeys":["B"]}', "utf8");
  const changed = Buffer.from('{"id":"115B-Q200","answerKeys":["C"]}', "utf8");
  const logicalPath = "data/questions/115B/115B-Q200.json";
  const revision = computeQuestionDataRevision([
    [logicalPath, original],
    ["guides/ignored.md", Buffer.from("not part of the question corpus")],
  ]);
  assert.match(revision, /^[a-f0-9]{64}$/u);
  assert.notEqual(computeQuestionDataRevision([[logicalPath, changed]]), revision);
  assert.notEqual(
    computeQuestionDataRevision([["data/questions/115A/115B-Q200.json", original]]),
    revision,
  );
  assert.equal(computeQuestionDataRevision([[logicalPath, original]]), revision);
});

test("question packs reject missing or stale aggregate revision metadata", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-question-revision-"));
  const detailPath = path.join(contentRoot, "data", "questions", "115B", "115B-Q200.json");
  const detail = Buffer.from('{"id":"115B-Q200"}', "utf8");
  try {
    await mkdir(path.dirname(detailPath), { recursive: true });
    await writeFile(detailPath, detail);
    await mkdir(path.join(contentRoot, "data"), { recursive: true });
    for (const name of ["index.json", "startup-index.json"]) {
      await writeFile(
        path.join(contentRoot, "data", name),
        JSON.stringify({ questionDataRevision: "0".repeat(64), questions: [{ id: "115B-Q200" }] }),
      );
    }
    assert.throws(
      () => compressRawFiles({ contentRoot, targetBytes: 1024 }),
      /題庫版本摘要與題目內容不符/u,
    );
  } finally {
    discardExpandedStaticContent(contentRoot);
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("legacy per-file Brotli assets migrate atomically into indexed packs", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-migrate-"));
  const jsonPath = path.join(contentRoot, "data", "legacy.json");
  const markdownPath = path.join(contentRoot, "guides", "legacy.md");
  const json = Buffer.from(JSON.stringify({ title: "舊資料", valid: true }), "utf8");
  const markdown = Buffer.from("# 舊章節\n\n仍可完整還原。", "utf8");

  try {
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await mkdir(path.dirname(markdownPath), { recursive: true });
    await writeFile(`${jsonPath}.br`, legacyBrotli(json));
    await writeFile(`${markdownPath}.br`, legacyBrotli(markdown));

    const migrated = compressRawFiles({ contentRoot, targetBytes: 1024 });
    assert.equal(migrated.files, 2);
    assert.equal(legacyBrotliFiles(contentRoot).length, 0);
    assert.ok(readContentPackIndex(contentRoot));
    expandCompressedFiles(contentRoot);
    assert.deepEqual(await readFile(jsonPath), json);
    assert.deepEqual(await readFile(markdownPath), markdown);
  } finally {
    discardExpandedStaticContent(contentRoot);
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("mixed indexed and legacy content is only cleaned when every legacy file is redundant", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-mixed-"));
  const jsonPath = path.join(contentRoot, "data", "sample.json");
  const extraPath = path.join(contentRoot, "guides", "newer.md.br");
  const json = Buffer.from(JSON.stringify({ title: "已封裝資料" }), "utf8");
  const extra = Buffer.from("# 尚未封裝的新資料", "utf8");

  try {
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await mkdir(path.dirname(extraPath), { recursive: true });
    await writeFile(jsonPath, json);
    compressRawFiles({ contentRoot, targetBytes: 1024 });

    await writeFile(extraPath, legacyBrotli(extra));
    assert.throws(
      () => compressRawFiles({ contentRoot, targetBytes: 1024 }),
      /殘留的舊 Brotli 內容不一致/u,
    );
    assert.deepEqual(await readFile(extraPath), legacyBrotli(extra));

    await unlink(extraPath);
    await writeFile(`${jsonPath}.br`, legacyBrotli(json));
    const reused = compressRawFiles({ contentRoot, targetBytes: 1024 });
    assert.equal(reused.updatedFiles, 0);
    assert.equal(legacyBrotliFiles(contentRoot).length, 0);
    expandCompressedFiles(contentRoot);
    assert.deepEqual(await readFile(jsonPath), json);
  } finally {
    discardExpandedStaticContent(contentRoot);
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("an interrupted cleanup marker never authorizes deletion of newly arrived legacy content", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-cleanup-"));
  const jsonPath = path.join(contentRoot, "data", "sample.json");
  const extraPath = path.join(contentRoot, "guides", "newer.md.br");
  const markerPath = path.join(
    path.dirname(contentRoot),
    `.${path.basename(contentRoot)}.static-content-transaction.json`,
  );
  const json = Buffer.from(JSON.stringify({ title: "已封裝資料" }), "utf8");
  const extra = Buffer.from("# 清理開始後才抵達的新資料", "utf8");

  try {
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await mkdir(path.dirname(extraPath), { recursive: true });
    await writeFile(jsonPath, json);
    compressRawFiles({ contentRoot, targetBytes: 1024 });

    const indexBytes = await readFile(path.join(contentPackDirectory(contentRoot), "index.brp"));
    await writeFile(`${jsonPath}.br`, legacyBrotli(json));
    await writeFile(extraPath, legacyBrotli(extra));
    await writeFile(markerPath, JSON.stringify({
      v: 1,
      kind: "packed",
      fingerprint: createHash("sha256").update(indexBytes).digest("hex"),
      phase: "cleanup",
    }));

    assert.throws(
      () => compressRawFiles({ contentRoot, targetBytes: 1024 }),
      /殘留的舊 Brotli 內容不一致/u,
    );
    assert.deepEqual(await readFile(extraPath), legacyBrotli(extra));
    assert.equal(legacyBrotliFiles(contentRoot).length, 2);
  } finally {
    await rm(markerPath, { force: true });
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("an interrupted partial expansion is completed safely before repacking", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-partial-"));
  const firstPath = path.join(contentRoot, "data", "first.json");
  const secondPath = path.join(contentRoot, "guides", "second.md");
  const first = Buffer.from(JSON.stringify({ title: "第一筆", body: "完整資料" }), "utf8");
  const second = Buffer.from("# 第二筆\n\n不可遺失。", "utf8");

  try {
    await mkdir(path.dirname(firstPath), { recursive: true });
    await mkdir(path.dirname(secondPath), { recursive: true });
    await writeFile(firstPath, first);
    await writeFile(secondPath, second);
    compressRawFiles({ contentRoot, targetBytes: 1024 });

    // Simulate a process dying after writing only one expanded file and before its marker.
    await writeFile(firstPath, first);
    const recovered = compressRawFiles({ contentRoot, targetBytes: 1024 });
    assert.equal(recovered.files, 2);
    assert.equal(rawFiles(contentRoot).length, 0);
    expandCompressedFiles(contentRoot);
    assert.deepEqual(await readFile(firstPath), first);
    assert.deepEqual(await readFile(secondPath), second);
  } finally {
    discardExpandedStaticContent(contentRoot);
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("an unmarked partial edit is preserved and rejected instead of replacing the corpus", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-unsafe-"));
  const firstPath = path.join(contentRoot, "data", "first.json");
  const secondPath = path.join(contentRoot, "guides", "second.md");
  const first = Buffer.from(JSON.stringify({ title: "原始資料" }), "utf8");
  const changed = Buffer.from(JSON.stringify({ title: "未標記的修改" }), "utf8");
  const second = Buffer.from("# 仍在壓縮包中的內容", "utf8");

  try {
    await mkdir(path.dirname(firstPath), { recursive: true });
    await mkdir(path.dirname(secondPath), { recursive: true });
    await writeFile(firstPath, first);
    await writeFile(secondPath, second);
    compressRawFiles({ contentRoot, targetBytes: 1024 });
    await writeFile(firstPath, changed);

    assert.throws(
      () => compressRawFiles({ contentRoot, targetBytes: 1024 }),
      /未受交易標記保護/u,
    );
    assert.deepEqual(await readFile(firstPath), changed);

    discardExpandedStaticContent(contentRoot);
    expandCompressedFiles(contentRoot);
    assert.deepEqual(await readFile(firstPath), first);
    assert.deepEqual(await readFile(secondPath), second);
  } finally {
    discardExpandedStaticContent(contentRoot);
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("orphan packs are pruned and pack targets above 32 MiB are rejected", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-limits-"));
  const jsonPath = path.join(contentRoot, "data", "sample.json");

  try {
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, Buffer.from(JSON.stringify({ valid: true }), "utf8"));
    compressRawFiles({ contentRoot, targetBytes: 1024 });
    const orphan = path.join(contentPackDirectory(contentRoot), "packs", `${"0".repeat(64)}.brp`);
    await writeFile(orphan, Buffer.from("orphan"));

    const reused = compressRawFiles({ contentRoot, targetBytes: 1024 });
    assert.equal(reused.updatedFiles, 0);
    await assert.rejects(readFile(orphan), /ENOENT/u);
    assert.throws(
      () => compressRawFiles({
        contentRoot,
        targetBytes: contentPackMaxRawBytes + 1,
      }),
      /1 至 32 MiB/u,
    );
  } finally {
    discardExpandedStaticContent(contentRoot);
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("a killed child transaction is discarded, while a succeeded child transaction commits", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-phase-"));
  const firstPath = path.join(contentRoot, "data", "first.json");
  const secondPath = path.join(contentRoot, "guides", "second.md");
  const first = Buffer.from(JSON.stringify({ version: "original" }), "utf8");
  const second = Buffer.from("# Original", "utf8");
  const committed = Buffer.from(JSON.stringify({ version: "committed" }), "utf8");

  try {
    await mkdir(path.dirname(firstPath), { recursive: true });
    await mkdir(path.dirname(secondPath), { recursive: true });
    await writeFile(firstPath, first);
    await writeFile(secondPath, second);
    compressRawFiles({ contentRoot, targetBytes: 1024 });

    expandCompressedFiles(contentRoot);
    markStaticContentTransactionRunning(contentRoot);
    await writeFile(firstPath, Buffer.from("{ invalid partial child output", "utf8"));
    await unlink(secondPath);
    compressRawFiles({ contentRoot, targetBytes: 1024 });
    expandCompressedFiles(contentRoot);
    assert.deepEqual(await readFile(firstPath), first);
    assert.deepEqual(await readFile(secondPath), second);

    markStaticContentTransactionRunning(contentRoot);
    await writeFile(firstPath, committed);
    markStaticContentTransactionSucceeded(contentRoot);
    compressRawFiles({ contentRoot, targetBytes: 1024 });
    expandCompressedFiles(contentRoot);
    assert.deepEqual(await readFile(firstPath), committed);
    assert.deepEqual(await readFile(secondPath), second);
  } finally {
    discardExpandedStaticContent(contentRoot);
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("a succeeded transaction that deleted every raw file resets to the intact packed corpus", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-empty-success-"));
  const jsonPath = path.join(contentRoot, "data", "sample.json");
  const json = Buffer.from(JSON.stringify({ version: "intact-packed-copy" }), "utf8");
  let recoveryRoot = null;

  try {
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, json);
    compressRawFiles({ contentRoot, targetBytes: 1024 });
    expandCompressedFiles(contentRoot);
    markStaticContentTransactionRunning(contentRoot);
    await unlink(jsonPath);
    markStaticContentTransactionSucceeded(contentRoot);

    assert.throws(
      () => compressRawFiles({ contentRoot, targetBytes: 1024 }),
      /全部文字資產均被刪除/u,
    );
    recoveryRoot = preserveFailedExpandedStaticContent(contentRoot);
    assert.ok(recoveryRoot);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(recoveryRoot, "recovery.json"), "utf8")),
      {
        v: 1,
        createdAt: JSON.parse(await readFile(path.join(recoveryRoot, "recovery.json"), "utf8")).createdAt,
        files: 0,
        transaction: {
          v: 1,
          kind: "packed",
          fingerprint: createHash("sha256")
            .update(await readFile(path.join(contentPackDirectory(contentRoot), "index.brp")))
            .digest("hex"),
          phase: "succeeded",
        },
      },
    );
    const recovered = compressRawFiles({ contentRoot, targetBytes: 1024 });
    assert.equal(recovered.reusedFiles, 1);
    expandCompressedFiles(contentRoot);
    assert.deepEqual(await readFile(jsonPath), json);
  } finally {
    discardExpandedStaticContent(contentRoot);
    if (recoveryRoot) await rm(recoveryRoot, { force: true, recursive: true });
    await rm(contentRoot, { force: true, recursive: true });
  }
});

test("missing source metadata cannot turn a partial expansion into a new corpus", async () => {
  const contentRoot = await mkdtemp(path.join(os.tmpdir(), "board-brotli-missing-index-"));
  const firstPath = path.join(contentRoot, "data", "first.json");
  const secondPath = path.join(contentRoot, "guides", "second.md");

  try {
    await mkdir(path.dirname(firstPath), { recursive: true });
    await mkdir(path.dirname(secondPath), { recursive: true });
    await writeFile(firstPath, Buffer.from(JSON.stringify({ first: true }), "utf8"));
    await writeFile(secondPath, Buffer.from("# Second", "utf8"));
    compressRawFiles({ contentRoot, targetBytes: 1024 });
    expandCompressedFiles(contentRoot);
    await unlink(secondPath);
    await unlink(path.join(contentPackDirectory(contentRoot), "index.brp"));

    assert.throws(
      () => compressRawFiles({ contentRoot, targetBytes: 1024 }),
      /索引遺失或損壞/u,
    );
    assert.deepEqual(
      JSON.parse(await readFile(firstPath, "utf8")),
      { first: true },
    );
  } finally {
    discardExpandedStaticContent(contentRoot);
    await rm(contentRoot, { force: true, recursive: true });
  }
});
