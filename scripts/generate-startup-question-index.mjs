import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

export const STARTUP_QUESTION_FIELDS = [
  "id",
  "exam",
  "year",
  "number",
  "allCredit",
  "category",
  "canonicalId",
  "excludedFromPractice",
];

export function startupQuestionIndex(payload) {
  if (!payload || !Array.isArray(payload.questions) || !payload.questions.length) {
    throw new Error("data/index.json does not contain a question index");
  }
  if (!/^[a-f0-9]{64}$/u.test(payload.questionDataRevision)) {
    throw new Error("data/index.json does not contain a valid question data revision");
  }

  const questions = payload.questions.map((question) => {
    if (!question || typeof question !== "object" || typeof question.id !== "string") {
      throw new Error("data/index.json contains an invalid question row");
    }
    return Object.fromEntries(
      STARTUP_QUESTION_FIELDS
        .filter((field) => Object.hasOwn(question, field))
        .map((field) => [field, question[field]]),
    );
  });

  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error("data/index.json contains duplicate question ids");
  }
  return { questionDataRevision: payload.questionDataRevision, questions };
}

export function writeStartupQuestionIndex({
  input = path.join(projectRoot, "public", "data", "index.json"),
  output = path.join(projectRoot, "public", "data", "startup-index.json"),
} = {}) {
  const payload = JSON.parse(fs.readFileSync(input, "utf8"));
  const startup = startupQuestionIndex(payload);
  const bytes = Buffer.from(JSON.stringify(startup), "utf8");
  const temporary = `${output}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, output);
  return { questions: startup.questions.length, bytes: bytes.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const result = writeStartupQuestionIndex();
  console.log(`Generated startup question index: ${result.questions} questions, ${result.bytes} bytes`);
}
