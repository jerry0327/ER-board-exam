import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeStudyGuideSource } from "./lib/study-guide-reading-modes.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSourceRoot = [path.resolve(projectRoot, ".."), path.resolve(projectRoot, "..", "..")]
  .find((candidate) => fs.existsSync(path.join(candidate, "outputs", "02_learning_guides")))
  ?? path.resolve(projectRoot, "..");
const sourceRoot = process.argv[2] ? path.resolve(process.argv[2]) : defaultSourceRoot;
const tintinalliManifestPath = path.join(projectRoot, "public", "guides", "manifest.json");
const rosensManifestPath = path.join(projectRoot, "public", "guides", "rosens", "manifest.json");
const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");

const tintinalliPacks = [
  {
    id: "concise",
    label: "精要版",
    description: "聚焦急診決策、重要門檻與高價值鑑別。",
    standardRoot: path.join(sourceRoot, "outputs", "02_learning_guides", "tintinalli-concise"),
    quickRoot: path.join(sourceRoot, "outputs", "02_learning_guides", "tintinalli-concise"),
  },
  {
    id: "detailed",
    label: "詳細版",
    description: "完整呈現病理生理、診斷推理、處置流程與延伸重點。",
    standardRoot: path.join(sourceRoot, "outputs", "02_learning_guides", "tintinalli-detailed"),
    quickRoot: path.join(sourceRoot, "outputs", "02_learning_guides", "tintinalli-detailed"),
  },
];
const rosensStandardRoot = path.join(sourceRoot, "outputs", "02_learning_guides", "rosens");
const rosensQuickRoot = path.join(sourceRoot, "outputs", "02_learning_guides", "rosens");

for (const directory of [
  ...tintinalliPacks.flatMap((pack) => [pack.standardRoot, pack.quickRoot]),
  rosensStandardRoot,
  rosensQuickRoot,
]) {
  if (!fs.existsSync(directory)) throw new Error(`找不到手寫濃縮內容：${directory}`);
}

const tintinalliCatalog = JSON.parse(fs.readFileSync(tintinalliManifestPath, "utf8"));
const rosensCatalog = JSON.parse(fs.readFileSync(rosensManifestPath, "utf8"));
if (
  tintinalliCatalog.schemaVersion !== 3
  || tintinalliCatalog.totalChapters !== 303
  || tintinalliCatalog.chapters?.length !== 303
) {
  throw new Error("Tintinalli 學習指引目錄不完整");
}
if (
  rosensCatalog.schemaVersion !== 1
  || rosensCatalog.textbookId !== "rosens"
  || rosensCatalog.totalEntries !== 208
  || rosensCatalog.chapters?.length !== 208
) {
  throw new Error("Rosen’s 學習指引目錄不完整");
}

const preparedWrites = [];
const tierHashes = new Set();
const metrics = {
  tintinalli: {},
  rosens: { chapters: 0, fullBytes: 0, standardBytes: 0, quickBytes: 0 },
};

for (const packDefinition of tintinalliPacks) {
  const pack = tintinalliCatalog.packs.find((entry) => entry.id === packDefinition.id);
  if (!pack || pack.status !== "available" || pack.importedChapters !== 303) {
    throw new Error(`Tintinalli ${packDefinition.id} 版本尚未完整`);
  }

  const packMetrics = { chapters: 0, fullBytes: 0, standardBytes: 0, quickBytes: 0 };
  for (let chapterNumber = 1; chapterNumber <= 303; chapterNumber += 1) {
    const chapter = tintinalliCatalog.chapters[chapterNumber - 1];
    const current = chapter?.contents?.[packDefinition.id];
    if (chapter?.id !== chapterNumber || !current?.available || !current.modes?.full?.markdownPath) {
      throw new Error(`Tintinalli ${packDefinition.id} Chapter ${chapterNumber} 完整內容遺失`);
    }

    const padded = String(chapterNumber).padStart(3, "0");
    const standard = readAuthoredMarkdown(
      path.join(packDefinition.standardRoot, `tintinalli-CH${padded}-${packDefinition.id}-standard.md`),
      `${packDefinition.id} Chapter ${chapterNumber} 標準`,
    );
    const quick = readAuthoredMarkdown(
      path.join(packDefinition.quickRoot, `tintinalli-CH${padded}-${packDefinition.id}-quick.md`),
      `${packDefinition.id} Chapter ${chapterNumber} 速讀`,
    );
    const fullPath = publicPath(current.modes.full.markdownPath);
    const fullBuffer = fs.readFileSync(fullPath);

    validateTierOrder({
      label: `Tintinalli ${packDefinition.id} Chapter ${chapterNumber}`,
      fullBuffer,
      standardBuffer: standard.buffer,
      quickBuffer: quick.buffer,
    });
    registerTierHash(standard.buffer, `${packDefinition.id}/standard/${padded}`);
    registerTierHash(quick.buffer, `${packDefinition.id}/quick/${padded}`);

    const filename = `chapter-${padded}.md`;
    const standardPath = path.join(projectRoot, "public", "guides", "packs", packDefinition.id, "key-points", filename);
    const quickPath = path.join(projectRoot, "public", "guides", "packs", packDefinition.id, "quick", filename);
    preparedWrites.push([standardPath, standard.buffer], [quickPath, quick.buffer]);

    current.modes.focus = contentEntry(
      `/guides/packs/${packDefinition.id}/key-points/${filename}`,
      standard.buffer,
    );
    current.modes.quick = contentEntry(
      `/guides/packs/${packDefinition.id}/quick/${filename}`,
      quick.buffer,
    );

    packMetrics.chapters += 1;
    packMetrics.fullBytes += fullBuffer.length;
    packMetrics.standardBytes += standard.buffer.length;
    packMetrics.quickBytes += quick.buffer.length;
  }

  pack.label = packDefinition.label;
  pack.description = packDefinition.description;
  metrics.tintinalli[packDefinition.id] = packMetrics;
}

for (let sequence = 1; sequence <= 208; sequence += 1) {
  const chapter = rosensCatalog.chapters[sequence - 1];
  const expectedId = sequence <= 192
    ? String(sequence).padStart(3, "0")
    : `e${String(sequence - 192).padStart(2, "0")}`;
  if (chapter?.id !== expectedId || !chapter.available || !chapter.modes?.full?.markdownPath) {
    throw new Error(`Rosen’s ${expectedId} 完整內容遺失`);
  }

  const padded = String(sequence).padStart(3, "0");
  const standard = readAuthoredMarkdown(
    path.join(rosensStandardRoot, `rosens-CH${padded}-standard.md`),
    `Rosen’s ${expectedId} 標準`,
  );
  const quick = readAuthoredMarkdown(
    path.join(rosensQuickRoot, `rosens-CH${padded}-quick.md`),
    `Rosen’s ${expectedId} 速讀`,
  );
  const fullBuffer = fs.readFileSync(publicPath(chapter.modes.full.markdownPath));

  validateTierOrder({
    label: `Rosen’s ${expectedId}`,
    fullBuffer,
    standardBuffer: standard.buffer,
    quickBuffer: quick.buffer,
  });
  registerTierHash(standard.buffer, `rosens/standard/${padded}`);
  registerTierHash(quick.buffer, `rosens/quick/${padded}`);

  const chapterRoot = path.join(projectRoot, "public", "guides", "rosens", "detailed", expectedId);
  preparedWrites.push(
    [path.join(chapterRoot, "standard.md"), standard.buffer],
    [path.join(chapterRoot, "quick.md"), quick.buffer],
  );
  chapter.modes.standard = contentEntry(
    `/guides/rosens/detailed/${expectedId}/standard.md`,
    standard.buffer,
  );
  chapter.modes.quick = contentEntry(
    `/guides/rosens/detailed/${expectedId}/quick.md`,
    quick.buffer,
  );

  metrics.rosens.chapters += 1;
  metrics.rosens.fullBytes += fullBuffer.length;
  metrics.rosens.standardBytes += standard.buffer.length;
  metrics.rosens.quickBytes += quick.buffer.length;
}

// All 1,628 authored documents and their existing full counterparts have
// passed validation before production content is replaced.
for (const [targetPath, buffer] of preparedWrites) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  atomicWrite(targetPath, buffer);
}
atomicWrite(tintinalliManifestPath, Buffer.from(`${JSON.stringify(tintinalliCatalog, null, 2)}\n`, "utf8"));
atomicWrite(rosensManifestPath, Buffer.from(`${JSON.stringify(rosensCatalog, null, 2)}\n`, "utf8"));

console.log(JSON.stringify({
  importedAuthoredDocuments: preparedWrites.length,
  uniqueAuthoredDocuments: tierHashes.size,
  metrics,
}, null, 2));

function readAuthoredMarkdown(sourcePath, label) {
  if (!fs.existsSync(sourcePath)) throw new Error(`${label}缺少檔案：${sourcePath}`);
  const sourceBuffer = fs.readFileSync(sourcePath);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(sourceBuffer);
  const markdown = normalizeStudyGuideSource(decoded)
    .replace(/[ \t]+$/gmu, "")
    .trimEnd()
    .concat("\n");
  const buffer = Buffer.from(markdown, "utf8");

  if (!/^#\s+\S+/mu.test(markdown)) throw new Error(`${label}缺少主標題`);
  if ((markdown.match(/^#\s+\S+/gmu) ?? []).length !== 1) throw new Error(`${label}必須只有一個主標題`);
  if (markdown.includes("\r") || markdown.includes("\uFFFD") || markdown.charCodeAt(0) === 0xfeff) {
    throw new Error(`${label}文字編碼不正確`);
  }
  if (buffer.length < 1_000) throw new Error(`${label}內容過短`);
  return { markdown, buffer };
}

function validateTierOrder({ label, fullBuffer, standardBuffer, quickBuffer }) {
  if (!(quickBuffer.length < standardBuffer.length && standardBuffer.length < fullBuffer.length)) {
    throw new Error(
      `${label} 未符合速讀 < 標準 < 完整：${quickBuffer.length} < ${standardBuffer.length} < ${fullBuffer.length}`,
    );
  }
  if (digest(quickBuffer) === digest(standardBuffer) || digest(standardBuffer) === digest(fullBuffer)) {
    throw new Error(`${label}閱讀程度內容重複`);
  }
}

function registerTierHash(buffer, label) {
  const hash = digest(buffer);
  if (tierHashes.has(hash)) throw new Error(`手寫濃縮內容重複：${label}`);
  tierHashes.add(hash);
}

function contentEntry(markdownPath, buffer) {
  const hash = digest(buffer);
  return {
    markdownPath,
    contentHash: hash.slice(0, 16),
    sourceSha256: hash,
    bytes: buffer.length,
  };
}

function publicPath(markdownPath) {
  if (!/^\/guides\/[A-Za-z0-9._@+()/+-]+\.md$/u.test(markdownPath)) {
    throw new Error(`不安全的學習指引路徑：${markdownPath}`);
  }
  return path.join(projectRoot, "public", ...markdownPath.slice(1).split("/"));
}

function atomicWrite(targetPath, bytes) {
  const temporaryPath = `${targetPath}.tmp-authored-${process.pid}`;
  fs.writeFileSync(temporaryPath, bytes);
  fs.rmSync(targetPath, { force: true });
  fs.renameSync(temporaryPath, targetPath);
}
