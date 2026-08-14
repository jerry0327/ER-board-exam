import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFragment } from "parse5";

const pageGroups = [
  { id: "start", label: "開始", pages: ["home", "master"] },
  { id: "treatment", label: "治療工具", pages: ["antidotes", "decon"] },
  { id: "topics", label: "整合專題", pages: ["drugs", "pesticides", "environmental", "biotoxins"] },
  { id: "practice", label: "查找與練習", pages: ["names", "qbank", "cards", "quiz", "references"] },
];

const interactivePageIds = new Set(["qbank", "cards", "quiz"]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function pullEnvelope(html, id) {
  const pattern = new RegExp(`<script\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>([\\s\\S]*?)<\\/script>`, "iu");
  const match = html.match(pattern);
  if (!match) throw new Error(`AILS source is missing ${id}.`);
  return JSON.parse(Buffer.from(match[1].trim(), "base64").toString("utf8"));
}

function attr(node, name) {
  return node.attrs?.find((item) => item.name === name)?.value ?? "";
}

function classes(node) {
  return new Set(attr(node, "class").split(/\s+/u).filter(Boolean));
}

function children(node) {
  return node.childNodes ?? [];
}

function descendants(node, predicate) {
  const found = [];
  for (const child of children(node)) {
    if (predicate(child)) found.push(child);
    found.push(...descendants(child, predicate));
  }
  return found;
}

function plainText(node, preserveLines = false) {
  if (node.nodeName === "#text") return node.value ?? "";
  if (node.tagName === "br") return "\n";
  const value = children(node).map((child) => plainText(child, preserveLines)).join("");
  return preserveLines
    ? value.replace(/[ \t]+\n/gu, "\n").replace(/\n[ \t]+/gu, "\n").trim()
    : value.replace(/\s+/gu, " ").trim();
}

function escapeMarkdown(value) {
  return value.replace(/\\/gu, "\\\\").replace(/([`*_])/gu, "\\$1");
}

function inline(node, tableCell = false) {
  if (node.nodeName === "#text") return node.value ?? "";
  const body = children(node).map((child) => inline(child, tableCell)).join("");
  switch (node.tagName) {
    case "br":
      return tableCell ? "；" : "\n";
    case "strong":
    case "b":
      return `**${body.trim()}**`;
    case "em":
      return `*${body.trim()}*`;
    case "a": {
      const href = attr(node, "href");
      if (!/^https?:\/\//iu.test(href)) return body;
      return `[${body.trim() || href}](${href})`;
    }
    default:
      return body;
  }
}

function compactInline(node, tableCell = false) {
  return inline(node, tableCell)
    .replace(/[ \t]*\n[ \t]*/gu, tableCell ? "；" : "\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function tableMarkdown(node) {
  const rows = descendants(node, (item) => item.tagName === "tr");
  if (!rows.length) return "";
  const matrix = rows.map((row) => children(row)
    .filter((cell) => cell.tagName === "th" || cell.tagName === "td")
    .map((cell) => compactInline(cell, true).replace(/\|/gu, "\\|")));
  const width = Math.max(...matrix.map((row) => row.length));
  const normalized = matrix.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  const header = normalized[0];
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function articleSummary(node, index, ordered = false) {
  const headingNode = descendants(node, (item) => ["h3", "h4"].includes(item.tagName))[0];
  const strongNode = descendants(node, (item) => item.tagName === "strong" || item.tagName === "b")[0];
  const spanNode = descendants(node, (item) => item.tagName === "span")[0];
  const paragraph = descendants(node, (item) => item.tagName === "p")[0];
  const title = headingNode ? plainText(headingNode) : strongNode ? plainText(strongNode) : "";
  const detail = paragraph ? compactInline(paragraph) : spanNode ? compactInline(spanNode) : "";
  const marker = ordered ? `${index + 1}.` : "-";
  return `${marker} ${title ? `**${title}**${detail ? " — " : ""}` : ""}${detail}`.trimEnd();
}

function referenceMarkdown(node) {
  return children(node)
    .filter((child) => child.tagName === "article")
    .map((article, index) => {
      const heading = descendants(article, (item) => item.tagName === "h3")[0];
      const paragraph = descendants(article, (item) => item.tagName === "p")[0];
      const link = descendants(article, (item) => item.tagName === "a")[0];
      const title = heading ? compactInline(heading) : `來源 ${index + 1}`;
      const detail = paragraph ? compactInline(paragraph) : "";
      const href = link ? attr(link, "href") : "";
      return `### ${String(index + 1).padStart(2, "0")} · ${title}\n\n${detail}${href ? `\n\n[開啟來源](${href})` : ""}`;
    })
    .join("\n\n");
}

function listMarkdown(node, ordered) {
  let index = 0;
  return children(node)
    .filter((child) => child.tagName === "li")
    .map((item) => {
      const marker = ordered ? `${++index}.` : "-";
      return `${marker} ${compactInline(item)}`;
    })
    .join("\n");
}

function block(node) {
  if (node.nodeName === "#text") {
    const value = (node.value ?? "").replace(/\s+/gu, " ").trim();
    return value ? `${value}\n\n` : "";
  }
  const classNames = classes(node);
  if (classNames.has("cover") || classNames.has("subnav") || classNames.has("interactive-shell")) return "";
  if (classNames.has("flow")) return `${plainText(node, true)}\n\n`;
  if (classNames.has("chapter-caution")) {
    const title = descendants(node, (item) => item.tagName === "b" || item.tagName === "strong")[0];
    const paragraph = descendants(node, (item) => item.tagName === "p")[0];
    return `> **${title ? plainText(title) : "提醒"}**\n>\n> ${paragraph ? compactInline(paragraph) : ""}\n\n`;
  }
  if (classNames.has("metric-grid")) {
    return `${children(node).filter((child) => child.tagName === "article").map((item, index) => articleSummary(item, index)).join("\n")}\n\n`;
  }
  if (classNames.has("reading-path")) {
    return `${children(node).filter((child) => child.tagName === "article").map((item, index) => articleSummary(item, index, true)).join("\n")}\n\n`;
  }
  if (classNames.has("path")) {
    const steps = children(node).filter((child) => child.tagName === "div");
    return `${steps.map((step, index) => {
      const label = descendants(step, (item) => item.tagName === "span")[0];
      const detail = descendants(step, (item) => item.tagName === "small")[0];
      return `${index + 1}. **${label ? compactInline(label) : `步驟 ${index + 1}`}**${detail ? ` — ${compactInline(detail)}` : ""}`;
    }).join("\n")}\n\n`;
  }
  if (classNames.has("grid")) {
    return `${children(node).filter((child) => child.tagName === "article").map((item, index) => articleSummary(item, index)).join("\n")}\n\n`;
  }
  if (classNames.has("reference-list")) return `${referenceMarkdown(node)}\n\n`;

  switch (node.tagName) {
    case "h1":
      return `# ${compactInline(node)}\n\n`;
    case "h2":
      return `## ${compactInline(node)}\n\n`;
    case "h3":
      return `### ${compactInline(node)}\n\n`;
    case "h4":
      return `#### ${compactInline(node)}\n\n`;
    case "p":
      return `${compactInline(node)}\n\n`;
    case "table":
      return `${tableMarkdown(node)}\n\n`;
    case "ul":
      return `${listMarkdown(node, false)}\n\n`;
    case "ol":
      return `${listMarkdown(node, true)}\n\n`;
    case "aside":
      return `> ${compactInline(node)}\n\n`;
    case "article":
      return children(node).map(block).join("");
    case "button":
    case "input":
    case "option":
    case "select":
    case "label":
      return "";
    default:
      return children(node).map(block).join("");
  }
}

function pageRecord(id, title, html) {
  const root = parseFragment(html);
  const cover = descendants(root, (node) => classes(node).has("cover"))[0];
  const kickerNode = cover ? descendants(cover, (node) => classes(node).has("cover-kicker"))[0] : null;
  const deckNode = cover ? descendants(cover, (node) => classes(node).has("cover-deck"))[0] : null;
  const metaNode = cover ? descendants(cover, (node) => classes(node).has("cover-meta"))[0] : null;
  const metadata = metaNode
    ? descendants(metaNode, (node) => node.tagName === "span").map((node) => plainText(node)).filter((value) => value && value !== "離線單檔")
    : [];
  const markdown = interactivePageIds.has(id)
    ? `# ${escapeMarkdown(title)}`
    : `# ${escapeMarkdown(title)}\n\n${children(root).map(block).join("").replace(/\n{3,}/gu, "\n\n").trim()}`;
  return {
    id,
    title,
    kicker: kickerNode ? plainText(kickerNode) : "AILS ACUTE TOXICOLOGY",
    deck: deckNode ? plainText(deckNode) : "",
    metadata,
    markdown,
  };
}

function validateQuestions(value, topics) {
  if (!Array.isArray(value) || value.length !== 272) throw new Error("AILS question bank must contain 272 questions.");
  const ids = value.map((question) => question.num);
  if (ids.some((id, index) => id !== index + 1)) throw new Error("AILS question numbers must be contiguous from 1 to 272.");
  for (const question of value) {
    if (!topics.includes(question.topic)) throw new Error(`Unknown AILS topic on question ${question.num}.`);
    if (!Array.isArray(question.options) || !question.options.some((option) => option.label === question.answer)) {
      throw new Error(`AILS question ${question.num} has an invalid answer.`);
    }
  }
}

const input = argument("--input");
const output = argument("--output") ?? "public/data/ails/review.json";
if (!input) {
  throw new Error("Usage: node scripts/import-ails-review.mjs --input <AILS.html> [--output public/data/ails/review.json]");
}

const source = await readFile(path.resolve(input), "utf8");
const pagesData = pullEnvelope(source, "pagesData");
const questions = pullEnvelope(source, "questionsData");
const titles = pullEnvelope(source, "titlesData");
const topics = pullEnvelope(source, "topicsData");
const pageIds = pageGroups.flatMap((group) => group.pages);

if (pageIds.some((id) => typeof pagesData[id] !== "string" || typeof titles[id] !== "string")) {
  throw new Error("AILS page catalog is incomplete.");
}
validateQuestions(questions, topics);

const payload = {
  schemaVersion: 1,
  title: "AILS急性中毒救命術",
  revisedAt: "2026-07",
  groups: pageGroups,
  pages: pageIds.map((id) => pageRecord(id, titles[id], pagesData[id])),
  topics,
  questions,
};

const outputPath = path.resolve(output);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
console.log(`Wrote ${outputPath} (${payload.pages.length} pages, ${payload.questions.length} questions).`);
