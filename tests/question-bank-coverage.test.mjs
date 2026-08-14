import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { questionBankArchiveRange } from "../app/lib/question-bank-summary.ts";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function readPackedJson(logicalPath) {
  const contentPackRoot = path.join(projectRoot, "public", "content-packs");
  const indexBytes = await readFile(path.join(contentPackRoot, "index.brp"));
  const index = JSON.parse(brotliDecompressSync(indexBytes).toString("utf8"));
  const entry = index.e.find(([entryPath]) => entryPath === logicalPath);
  assert.ok(entry, `${logicalPath} is present in the content-pack index`);
  const [, packNumber, offset, length] = entry;
  const [packName, rawBytes] = index.p[packNumber];
  const packedBytes = await readFile(path.join(contentPackRoot, "packs", packName));
  const decoded = brotliDecompressSync(packedBytes, { maxOutputLength: rawBytes });
  return JSON.parse(decoded.subarray(offset, offset + length).toString("utf8"));
}

test("derives the archive range from exam groups, including split A/B papers", () => {
  const range = questionBankArchiveRange([
    { id: "094", label: "民國 94 年", count: 100, file: "/094/" },
    { id: "114A", label: "民國 114 年・A卷", count: 200, file: "/114A/" },
    { id: "114B", label: "民國 114 年・B卷", count: 200, file: "/114B/" },
    { id: "115A", label: "民國 115 年・A卷", count: 200, file: "/115A/" },
    { id: "115B", label: "民國 115 年・B卷", count: 200, file: "/115B/" },
  ]);

  assert.deepEqual(range, {
    earliestRocYear: 94,
    latestRocYear: 115,
    gregorianLabel: "2005—2026",
    rocLabel: "民國 94—115 年",
  });
});

test("keeps dashboard and metadata coverage synchronized with the packed manifest", async () => {
  const manifest = await readPackedJson("data/manifest.json");
  const range = questionBankArchiveRange(manifest.groups);
  assert.ok(range);

  const [dashboard, startup, layout] = await Promise.all([
    readFile(path.join(projectRoot, "app", "views", "dashboard-view.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "question-bank-app.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "layout.tsx"), "utf8"),
  ]);
  const formattedTotal = manifest.totalQuestions.toLocaleString("en-US");

  assert.equal(range.latestRocYear, 115);
  assert.equal(range.gregorianLabel, "2005—2026");
  assert.equal(manifest.totalQuestions, 3320);
  assert.match(dashboard, /questionBankArchiveRange\(manifest\.groups\)/u);
  assert.doesNotMatch(dashboard, /1999—2024/u);
  assert.doesNotMatch(startup, /1999—2024|3,320/u);
  assert.match(layout, new RegExp(`民國 94–115 年（2005–2026）共 ${formattedTotal} 題`, "u"));
});

test("keeps historical 114 course material explicitly labeled as historical", async () => {
  const remoc = await readFile(path.join(projectRoot, "app", "components", "board-prep-remoc.tsx"), "utf8");
  assert.match(remoc, /114 年歷史課程表：中區化災、輻傷、DMAT 與 HICS/u);
  assert.match(remoc, /REMOC_114_CENTRAL_SCHEDULE_URL/u);
});
