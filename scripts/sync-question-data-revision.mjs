import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeQuestionDataRevision } from "./lib/static-content-codec.mjs";
import { startupQuestionIndex } from "./generate-startup-question-index.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : [absolute];
  });
}

function atomicJsonWrite(target, payload) {
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, Buffer.from(JSON.stringify(payload), "utf8"));
  fs.renameSync(temporary, target);
}

export function syncQuestionDataRevision({
  publicRoot = path.join(projectRoot, "public"),
} = {}) {
  const questionRoot = path.join(publicRoot, "data", "questions");
  const entries = walkFiles(questionRoot)
    .filter((file) => file.endsWith(".json"))
    .map((file) => [
      path.relative(publicRoot, file).split(path.sep).join("/"),
      fs.readFileSync(file),
    ]);
  const questionDataRevision = computeQuestionDataRevision(entries);
  if (!questionDataRevision) throw new Error("題目明細資料不存在，無法建立題庫版本摘要");

  const fullPath = path.join(publicRoot, "data", "index.json");
  const startupPath = path.join(publicRoot, "data", "startup-index.json");
  const full = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  if (!Array.isArray(full.questions) || !full.questions.length) {
    throw new Error("data/index.json does not contain a question index");
  }
  for (const question of full.questions) {
    if (!question || typeof question !== "object") {
      throw new Error("data/index.json contains an invalid question row");
    }
    delete question.contentHash;
  }
  full.questionDataRevision = questionDataRevision;
  const startup = startupQuestionIndex(full);
  atomicJsonWrite(fullPath, full);
  atomicJsonWrite(startupPath, startup);
  return {
    questionDataRevision,
    questions: full.questions.length,
    questionFiles: entries.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  console.log(JSON.stringify(syncQuestionDataRevision(), null, 2));
}
