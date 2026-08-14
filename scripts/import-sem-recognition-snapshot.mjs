import { readFile, writeFile } from "node:fs/promises";
import { parseRecognitionWorkbook } from "../app/lib/sem-recognized-courses.server.ts";
import { SEM_RECOGNITION_CURRENT_FILE_URL } from "../app/lib/sem-recognized-courses.ts";

const input = process.argv[2];
const output = process.argv[3] ?? new URL("../app/data/sem-recognized-courses.snapshot.json", import.meta.url);
if (!input) throw new Error("usage: node --experimental-strip-types scripts/import-sem-recognition-snapshot.mjs <file.xlsx>");
const courses = parseRecognitionWorkbook(new Uint8Array(await readFile(input)), SEM_RECOGNITION_CURRENT_FILE_URL, "1150715");
await writeFile(output, `${JSON.stringify({
  updatedAt: "2026-07-15T16:17:58+08:00",
  sourceUrl: SEM_RECOGNITION_CURRENT_FILE_URL,
  sourceRevision: "1150715",
  courses,
}, null, 2)}\n`);
console.log(`wrote ${courses.length} courses`);
