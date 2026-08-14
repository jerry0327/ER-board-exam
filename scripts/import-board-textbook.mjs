import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteIndexPath = path.join(projectRoot, "public", "data", "index.json");
const runtimeRoot = path.join(projectRoot, ".sites-runtime");
const traceVersion = "R2-GLOBAL-FINAL-v2.43";
const schemaVersion = 1;

// Unit reverse hits stay compact as canonical atom IDs. `questionRefs` resolves
// their canonical question prefix to one site ID or an A/B alias list. Forward
// shards use the inverse shape: site question ID -> canonical route ID -> route.

const entrySuffixes = {
  markdown: "/01_全書部署版/急診專科歷屆考題總指引_全書逐題追溯版_v2.43.md",
  registry: "/02_文字節點與標籤/text_node_registry_fullbook_v2.43.jsonl",
  reverse: "/04_前端部署索引/node_to_atoms_reverse_index_v2.43.json",
  bundles: "/04_前端部署索引/question_trace_bundles_by_id_v2.43.json",
  units: "/04_前端部署索引/unit_route_manifest_v2.43.json",
};

const bQuestionExceptions = new Map(Object.entries({
  "114B-Q003": "ROC114-P103",
  "114B-Q028": "ROC114-P128",
  "114B-Q032": "ROC114-P132",
  "114B-Q044": "ROC114-P144",
  "114B-Q091": "ROC114-P191",
  "114B-Q115": "ROC114-P015",
  "114B-Q131": "ROC114-P031",
  "114B-Q146": "ROC114-P046",
  "114B-Q169": "ROC114-P069",
  "114B-Q175": "ROC114-P075",
  "115B-Q034": "ROC115-P134",
  "115B-Q067": "ROC115-P167",
  "115B-Q136": "ROC115-P036",
  "115B-Q155": "ROC115-P055",
  "115B-Q178": "ROC115-P078",
  "115B-Q184": "ROC115-P084",
  "115B-Q196": "ROC115-P096",
}));

function usage() {
  return "Usage: npm run import:board-textbook -- <traceability-zip> [--dry-run]";
}

function parseArguments(argv) {
  let zipPath = null;
  let dryRun = false;
  for (const argument of argv) {
    if (argument === "--dry-run") dryRun = true;
    else if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    else if (zipPath) throw new Error(`Unexpected argument: ${argument}`);
    else zipPath = path.resolve(argument);
  }
  if (!zipPath || !fs.existsSync(zipPath)) throw new Error(usage());
  if (!fs.statSync(zipPath).isFile()) throw new Error(`ZIP path is not a file: ${zipPath}`);
  return { zipPath, dryRun };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function listZipEntries(zipPath) {
  const result = spawnSync("unzip", ["-Z1", zipPath], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Unable to list ZIP entries: ${result.stderr.trim()}`);
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

function resolveZipEntries(zipPath) {
  const entries = listZipEntries(zipPath);
  return Object.fromEntries(Object.entries(entrySuffixes).map(([key, suffix]) => {
    const matches = entries.filter((entry) => entry.endsWith(suffix));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one ZIP entry ending in ${suffix}; found ${matches.length}`);
    }
    return [key, matches[0]];
  }));
}

function unzipProcess(zipPath, entry) {
  return spawn("unzip", ["-p", zipPath, entry], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function readZipEntry(zipPath, entry, maxBytes) {
  const child = unzipProcess(zipPath, entry);
  const chunks = [];
  const errors = [];
  let bytes = 0;
  let tooLarge = false;
  child.stderr.on("data", (chunk) => {
    if (errors.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) errors.push(chunk);
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (tooLarge) reject(new Error(`ZIP entry exceeds ${maxBytes} bytes: ${entry}`));
      else if (code !== 0) reject(new Error(`unzip -p failed for ${entry} (${signal ?? code}): ${Buffer.concat(errors).toString("utf8").trim()}`));
      else resolve();
    });
  });
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      tooLarge = true;
      child.kill("SIGTERM");
      return;
    }
    chunks.push(chunk);
  });
  await completed;
  return Buffer.concat(chunks, bytes);
}

async function readZipJson(zipPath, entry, maxBytes = 64 * 1024 * 1024) {
  const bytes = await readZipEntry(zipPath, entry, maxBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`ZIP entry is not valid UTF-8 JSON: ${entry}`, { cause: error });
  }
}

async function readZipJsonLines(zipPath, entry, onRecord) {
  const child = unzipProcess(zipPath, entry);
  const errors = [];
  child.stderr.on("data", (chunk) => {
    if (errors.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) errors.push(chunk);
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code !== 0) reject(new Error(`unzip -p failed for ${entry} (${signal ?? code}): ${Buffer.concat(errors).toString("utf8").trim()}`));
      else resolve();
    });
  });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        onRecord(JSON.parse(line), lineNumber);
      } catch (error) {
        child.kill("SIGTERM");
        throw new Error(`Invalid JSONL record at ${entry}:${lineNumber}`, { cause: error });
      }
    }
    await completed;
  } catch (error) {
    lines.close();
    await completed.catch(() => undefined);
    throw error;
  }
}

function compactRegistry(zipPath, entry) {
  const nodesById = new Map();
  const paragraphsByUnit = new Map();
  const sentencesByParagraph = new Map();
  const counts = { paragraphCount: 0, sentenceCount: 0 };

  const ready = readZipJsonLines(zipPath, entry, (record) => {
    if (!record || typeof record !== "object" || typeof record.nodeId !== "string") {
      throw new Error("Registry record is missing nodeId");
    }
    if (nodesById.has(record.nodeId)) throw new Error(`Duplicate registry node: ${record.nodeId}`);
    if (!record.unitCode || !record.sectionId || !["paragraph", "sentence"].includes(record.nodeType)) {
      throw new Error(`Registry node is incomplete: ${record.nodeId}`);
    }
    const node = {
      nodeId: record.nodeId,
      nodeType: record.nodeType,
      unitCode: record.unitCode,
      sectionId: record.sectionId,
      paragraphId: record.nodeType === "paragraph" ? record.nodeId : record.parentParagraphId,
      sourceTag: record.sourceTag,
      text: record.text,
      paragraphOrder: record.paragraphOrder,
      sentenceOrder: record.sentenceOrder ?? null,
      selector: record.selector,
    };
    if (!node.paragraphId || typeof node.text !== "string") throw new Error(`Registry node is incomplete: ${record.nodeId}`);
    nodesById.set(node.nodeId, node);
    if (node.nodeType === "paragraph") {
      counts.paragraphCount += 1;
      const unitNodes = paragraphsByUnit.get(node.unitCode) ?? [];
      unitNodes.push(node);
      paragraphsByUnit.set(node.unitCode, unitNodes);
    } else {
      counts.sentenceCount += 1;
      const sentenceNodes = sentencesByParagraph.get(node.paragraphId) ?? [];
      sentenceNodes.push(node);
      sentencesByParagraph.set(node.paragraphId, sentenceNodes);
    }
  });
  return { ready, nodesById, paragraphsByUnit, sentencesByParagraph, counts };
}

function archiveQuestionIdForSite(question, questionsById, visiting = new Set()) {
  const exception = bQuestionExceptions.get(question.id);
  if (exception) return exception;
  const match = /^(\d{3})([AB]?)-Q(\d{3})$/u.exec(question.id);
  if (!match) throw new Error(`Unsupported site question id: ${question.id}`);
  const [, year, sitting, number] = match;
  const numericYear = Number(year);
  if (sitting === "B") {
    if (!question.canonicalId || question.canonicalId === question.id) {
      throw new Error(`B-version question lacks canonical mapping: ${question.id}`);
    }
    if (visiting.has(question.id)) throw new Error(`Canonical question cycle at ${question.id}`);
    const canonical = questionsById.get(question.canonicalId);
    if (!canonical) throw new Error(`Missing canonical question ${question.canonicalId} for ${question.id}`);
    visiting.add(question.id);
    return archiveQuestionIdForSite(canonical, questionsById, visiting);
  }
  return numericYear <= 112 ? `ROC${year}-Q${number}` : `ROC${year}-P${number}`;
}

function buildCrosswalk(siteQuestions, bundles) {
  if (siteQuestions.length !== 3_320) throw new Error(`Expected 3320 site questions; found ${siteQuestions.length}`);
  const questionsById = new Map(siteQuestions.map((question) => [question.id, question]));
  if (questionsById.size !== siteQuestions.length) throw new Error("Site index contains duplicate question ids");
  const archiveBySite = new Map();
  const aliasesByArchive = new Map();
  for (const question of siteQuestions) {
    const archiveId = archiveQuestionIdForSite(question, questionsById);
    if (!bundles[archiveId]) throw new Error(`No trace bundle for ${question.id} -> ${archiveId}`);
    archiveBySite.set(question.id, archiveId);
    const aliases = aliasesByArchive.get(archiveId) ?? [];
    aliases.push(question.id);
    aliasesByArchive.set(archiveId, aliases);
  }
  if (archiveBySite.size !== 3_320) throw new Error(`Expected 3320 site mappings; found ${archiveBySite.size}`);
  if (aliasesByArchive.size !== 2_920) {
    throw new Error(`Expected 2920 canonical question mappings; found ${aliasesByArchive.size}`);
  }
  const bundleIds = Object.keys(bundles);
  if (bundleIds.length !== 2_920) throw new Error(`Expected 2920 trace bundles; found ${bundleIds.length}`);
  const unmappedBundles = bundleIds.filter((id) => !aliasesByArchive.has(id));
  if (unmappedBundles.length) throw new Error(`Trace bundles have no site question mapping: ${unmappedBundles.slice(0, 8).join(", ")}`);
  for (const aliases of aliasesByArchive.values()) aliases.sort((left, right) => left.localeCompare(right, "en"));
  return { archiveBySite, aliasesByArchive };
}

function representativeQuestionId(aliases) {
  return [...aliases].sort((left, right) => {
    const leftB = /B-Q/u.test(left) ? 1 : 0;
    const rightB = /B-Q/u.test(right) ? 1 : 0;
    return leftB - rightB || left.localeCompare(right, "en");
  })[0];
}

function parseAtomId(atomId) {
  const match = /^(ROC\d{3}-[QP]\d{3})(?:-OPT-([A-E]))?$/u.exec(atomId);
  if (!match) throw new Error(`Unsupported trace atom id: ${atomId}`);
  return { archiveId: match[1], optionKey: match[2] ?? null };
}

function canonicalAtomReference(atomId, aliasesByArchive, onArchiveQuestion) {
  const { archiveId, optionKey } = parseAtomId(atomId);
  const aliases = aliasesByArchive.get(archiveId);
  if (!aliases?.length) throw new Error(`Reverse atom has no site alias: ${atomId}`);
  if (optionKey && !atomId.endsWith(`-OPT-${optionKey}`)) throw new Error(`Malformed option atom: ${atomId}`);
  onArchiveQuestion?.(archiveId);
  return atomId;
}

function reverseHits(reverseRecord, aliasesByArchive, onArchiveQuestion) {
  if (!reverseRecord) return { direct: [], related: [] };
  const directIds = Array.isArray(reverseRecord.primaryAtomIds) ? reverseRecord.primaryAtomIds : [];
  const directSet = new Set(directIds);
  const relatedIds = (Array.isArray(reverseRecord.relatedAtomIds) ? reverseRecord.relatedAtomIds : [])
    .filter((atomId) => !directSet.has(atomId));
  return {
    direct: directIds.map((atomId) => canonicalAtomReference(atomId, aliasesByArchive, onArchiveQuestion)),
    related: relatedIds.map((atomId) => canonicalAtomReference(atomId, aliasesByArchive, onArchiveQuestion)),
  };
}

function stripRawAnchors(markdown) {
  return markdown
    .replace(/^[ \t]*<a\s+(?:id|name)=["'][^"']+["'][^>]*><\/a>[ \t]*$/gimu, "")
    .replace(/[ \t]*\{#[A-Za-z0-9_-]+\}[ \t]*$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .concat("\n");
}

function splitUnitMarkdown(fullMarkdown, units) {
  const anchorPattern = /^<a id="(unit-[^"]+)"><\/a>$/gmu;
  const anchors = [...fullMarkdown.matchAll(anchorPattern)];
  if (anchors.length !== 39) throw new Error(`Expected 39 unit anchors in Markdown; found ${anchors.length}`);
  const byUnitId = new Map(units.map((unit) => [unit.unitId, unit]));
  const result = new Map();
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const unit = byUnitId.get(anchor[1]);
    if (!unit) throw new Error(`Markdown unit anchor is absent from manifest: ${anchor[1]}`);
    const start = anchor.index;
    const end = index + 1 < anchors.length ? anchors[index + 1].index : fullMarkdown.length;
    result.set(unit.unitCode, stripRawAnchors(fullMarkdown.slice(start, end)));
  }
  if (result.size !== units.length) throw new Error(`Expected ${units.length} Markdown units; found ${result.size}`);
  return result;
}

function visibleText(node) {
  if (!node || typeof node !== "object") return "";
  if (["text", "inlineCode", "code", "yaml", "toml"].includes(node.type)) return node.value ?? "";
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if (node.type === "break") return " ";
  if (node.type === "html") return String(node.value ?? "").replace(/<[^>]+>/gu, " ");
  const children = Array.isArray(node.children) ? node.children : [];
  if (["list", "listItem", "blockquote", "table", "tableRow", "root"].includes(node.type)) {
    return children.map(visibleText).filter(Boolean).join(" ");
  }
  if (node.type === "tableCell") return children.map(visibleText).join("");
  return children.map(visibleText).join("");
}

function canonicalVisible(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function outerNodeTag(node) {
  if (node.type === "paragraph") return "p";
  if (node.type === "blockquote") return "blockquote";
  if (node.type === "table") return "table";
  if (node.type === "list") return node.ordered ? "ol" : "ul";
  return null;
}

function markdownOuterNodes(markdown) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  return tree.children
    .map((node) => ({
      node,
      tag: outerNodeTag(node),
      text: visibleText(node),
      key: canonicalVisible(visibleText(node)),
      offset: node.position?.start?.offset,
      endOffset: node.position?.end?.offset,
    }))
    .filter((entry) => entry.tag && Number.isSafeInteger(entry.offset) && Number.isSafeInteger(entry.endOffset));
}

function matchParagraphs(unit, markdown, registryParagraphs, { allowGroups = false } = {}) {
  const outerNodes = markdownOuterNodes(markdown);
  const matches = new Map();
  const used = new Set();
  const candidatesByKey = new Map();
  const candidatesByVisibleKey = new Map();
  outerNodes.forEach((candidate, index) => {
    const key = `${candidate.tag}\u0000${candidate.key}`;
    const candidates = candidatesByKey.get(key) ?? [];
    candidates.push(index);
    candidatesByKey.set(key, candidates);
    const visibleCandidates = candidatesByVisibleKey.get(candidate.key) ?? [];
    visibleCandidates.push(index);
    candidatesByVisibleKey.set(candidate.key, visibleCandidates);
  });

  const unmatched = [];
  for (const paragraph of registryParagraphs) {
    const expectedKey = canonicalVisible(paragraph.text);
    const candidateIndex = candidatesByKey.get(`${paragraph.sourceTag}\u0000${expectedKey}`)
      ?.find((index) => !used.has(index))
      ?? candidatesByVisibleKey.get(expectedKey)?.find((index) => !used.has(index));
    if (candidateIndex === undefined) {
      unmatched.push({ paragraph, expectedKey });
      continue;
    }
    used.add(candidateIndex);
    matches.set(paragraph.nodeId, { ...outerNodes[candidateIndex], parts: [outerNodes[candidateIndex]] });
  }

  if (allowGroups) {
    for (let unmatchedIndex = unmatched.length - 1; unmatchedIndex >= 0; unmatchedIndex -= 1) {
      const { paragraph, expectedKey } = unmatched[unmatchedIndex];
      if (paragraph.sourceTag !== "p") continue;
      let found = null;
      for (let start = 0; start < outerNodes.length && !found; start += 1) {
        if (used.has(start) || outerNodes[start].tag !== paragraph.sourceTag) continue;
        let combinedKey = "";
        const parts = [];
        for (let end = start; end < Math.min(outerNodes.length, start + 4); end += 1) {
          const candidate = outerNodes[end];
          if (used.has(end) || candidate.tag !== paragraph.sourceTag) break;
          if (parts.length) {
            const previous = parts.at(-1);
            if (markdown.slice(previous.endOffset, candidate.offset).trim()) break;
          }
          combinedKey += candidate.key;
          parts.push(candidate);
          if (combinedKey === expectedKey && parts.length > 1) {
            found = { start, end, parts };
            break;
          }
          if (!expectedKey.startsWith(combinedKey)) break;
        }
      }
      if (!found) continue;
      for (let index = found.start; index <= found.end; index += 1) used.add(index);
      matches.set(paragraph.nodeId, {
        ...found.parts[0],
        endOffset: found.parts.at(-1).endOffset,
        text: found.parts.map((part) => part.text).join(" "),
        key: found.parts.map((part) => part.key).join(""),
        parts: found.parts,
      });
      unmatched.splice(unmatchedIndex, 1);
    }
  }

  if (unmatched.length) {
    const { paragraph, expectedKey } = unmatched[0];
      const nearby = outerNodes
        .map((candidate) => ({ candidate, overlap: candidate.key.slice(0, 24) === expectedKey.slice(0, 24) ? 1 : 0 }))
        .sort((left, right) => right.overlap - left.overlap)
        .slice(0, 3)
        .map(({ candidate }) => `${candidate.tag}:${candidate.text.slice(0, 100)}`)
        .join(" | ");
      throw new Error(`Unable to align ${unit.unitCode}/${paragraph.nodeId} (${paragraph.sourceTag}): ${nearby}`);
  }
  return { matches, outerNodeCount: outerNodes.length };
}

function alignUnitMarkdown(unit, markdown, registryParagraphs) {
  const initial = matchParagraphs(unit, markdown, registryParagraphs, { allowGroups: true });
  const replacements = [];
  let mergedParagraphs = 0;
  for (const match of initial.matches.values()) {
    if (match.parts.length > 1) mergedParagraphs += 1;
    for (let index = 1; index < match.parts.length; index += 1) {
      const previous = match.parts[index - 1];
      const current = match.parts[index];
      if (markdown.slice(previous.endOffset, current.offset).trim()) {
        throw new Error(`Cannot safely merge Markdown blocks in ${unit.unitCode}`);
      }
      replacements.push({ start: previous.endOffset, end: current.offset });
    }
  }
  if (!replacements.length) return { markdown, matches: initial.matches, mergedParagraphs };
  replacements.sort((left, right) => right.start - left.start);
  let alignedMarkdown = markdown;
  for (const replacement of replacements) {
    alignedMarkdown = `${alignedMarkdown.slice(0, replacement.start)} ${alignedMarkdown.slice(replacement.end)}`;
  }
  const aligned = matchParagraphs(unit, alignedMarkdown, registryParagraphs);
  return { markdown: alignedMarkdown, matches: aligned.matches, mergedParagraphs };
}

function injectParagraphMarkers(markdown, paragraphMatches, paragraphTrace) {
  const insertions = [];
  for (const [paragraphId, trace] of paragraphTrace) {
    if (!trace.direct.length && !trace.related.length) continue;
    const match = paragraphMatches.get(paragraphId);
    if (!match) throw new Error(`Traceable paragraph was not aligned to Markdown: ${paragraphId}`);
    insertions.push({
      offset: match.offset,
      marker: `<!--board-trace:${paragraphId}:${trace.direct.length}:${trace.related.length}-->\n\n`,
    });
  }
  insertions.sort((left, right) => right.offset - left.offset);
  let output = markdown;
  for (const insertion of insertions) {
    output = `${output.slice(0, insertion.offset)}${insertion.marker}${output.slice(insertion.offset)}`;
  }
  return output;
}

function routeFlags(route, node) {
  const flags = [];
  if (node.unitCode !== route.canonicalHomeUnitCode) flags.push("cross-unit");
  if (Array.isArray(route.canonicalSourceUnits) && !route.canonicalSourceUnits.includes(node.unitCode)) {
    flags.push("outside-declared-source-units");
  }
  if (route.imageDependent) flags.push("image-dependent");
  if (route.historicalOrQuarantine) flags.push("historical-or-quarantine");
  return flags;
}

function buildLocations(route, nodesById) {
  if (!route?.primaryNodeId || !route.primaryDeployableParagraphId) throw new Error("Trace route lacks a primary target");
  const targetIds = [
    route.primaryNodeId,
    ...(Array.isArray(route.targetNodeIds) ? route.targetNodeIds : []),
    ...(Array.isArray(route.deployableParagraphIds) ? route.deployableParagraphIds : []),
  ];
  const seen = new Set();
  const locations = [];
  for (const nodeId of targetIds) {
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) throw new Error(`Trace route targets an unknown registry node: ${nodeId}`);
    const relation = nodeId === route.primaryNodeId ? "primary" : "related";
    const paragraphId = node.nodeType === "paragraph" ? node.nodeId : node.paragraphId;
    if (relation === "primary" && paragraphId !== route.primaryDeployableParagraphId) {
      throw new Error(`Primary node ${nodeId} does not belong to ${route.primaryDeployableParagraphId}`);
    }
    locations.push({
      unitCode: node.unitCode,
      paragraphId,
      nodeId,
      relation,
      sectionId: node.sectionId,
      flags: routeFlags(route, node),
    });
  }
  if (!locations.some((location) => location.relation === "primary")) throw new Error("Trace route has no primary location");
  return locations;
}

function buildQuestionRoute(bundle, aliases, nodesById) {
  const options = {};
  for (const option of bundle.options ?? []) {
    if (!/^[A-E]$/u.test(option.optionLetter) || options[option.optionLetter]) {
      throw new Error(`Invalid or duplicate option route in ${bundle.questionId}`);
    }
    options[option.optionLetter] = buildLocations(option, nodesById);
  }
  return {
    questionId: representativeQuestionId(aliases),
    canonicalQuestionId: bundle.questionId,
    aliases,
    stem: buildLocations(bundle.questionRoute, nodesById),
    options,
  };
}

function buildForwardNodeHits(bundles, nodesById) {
  const byNode = new Map();
  const add = (nodeId, atomId, relation) => {
    const hits = byNode.get(nodeId) ?? { direct: new Set(), related: new Set() };
    if (relation === "primary") {
      hits.direct.add(atomId);
      hits.related.delete(atomId);
    } else if (!hits.direct.has(atomId)) {
      hits.related.add(atomId);
    }
    byNode.set(nodeId, hits);
  };
  for (const bundle of Object.values(bundles)) {
    const routes = [[bundle.questionId, bundle.questionRoute]];
    for (const option of bundle.options ?? []) routes.push([`${bundle.questionId}-OPT-${option.optionLetter}`, option]);
    for (const [atomId, route] of routes) {
      for (const location of buildLocations(route, nodesById)) add(location.nodeId, atomId, location.relation);
    }
  }
  return byNode;
}

function mergeForwardHits(directIds, relatedIds, forwardHits, referencedArchiveQuestions) {
  if (!forwardHits) return 0;
  let supplemented = 0;
  const record = (atomId) => {
    const match = /^(ROC\d{3}-[QP]\d{3})(?:-OPT-[A-E])?$/u.exec(atomId);
    if (!match) throw new Error(`Invalid canonical atom in forward route: ${atomId}`);
    referencedArchiveQuestions.add(match[1]);
  };
  for (const atomId of forwardHits.direct) {
    if (!directIds.has(atomId) && !relatedIds.has(atomId)) supplemented += 1;
    directIds.add(atomId);
    relatedIds.delete(atomId);
    record(atomId);
  }
  for (const atomId of forwardHits.related) {
    if (!directIds.has(atomId) && !relatedIds.has(atomId)) {
      relatedIds.add(atomId);
      supplemented += 1;
    }
    record(atomId);
  }
  return supplemented;
}

function sentenceSelector(node, hits) {
  const quote = node.selector?.textQuote;
  if (!quote?.exact) throw new Error(`Sentence node lacks a text quote selector: ${node.nodeId}`);
  const firstCodePoints = (value, count) => [...value].slice(0, count).join("");
  const lastCodePoints = (value, count) => [...value].slice(-count).join("");
  const selector = {
    paragraphId: node.paragraphId,
    exact: quote.exact,
  };
  // The source registry stores very large neighbouring paragraphs. A short
  // quote context is enough to repair an exact match without repeating the
  // textbook throughout every unit shard.
  if (quote.prefix) selector.prefix = lastCodePoints(quote.prefix, 32);
  if (quote.suffix) selector.suffix = firstCodePoints(quote.suffix, 32);
  selector.direct = hits.direct;
  selector.related = hits.related;
  return selector;
}

function canonicalTokenMap(value) {
  const tokens = [];
  let sourceOffset = 0;
  for (const sourceCharacter of value) {
    const start = sourceOffset;
    sourceOffset += sourceCharacter.length;
    const normalized = sourceCharacter.normalize("NFKC").toLocaleLowerCase("en");
    for (const character of normalized) {
      if (/^[\p{P}\p{S}\s]$/u.test(character)) continue;
      tokens.push({ character, start, end: sourceOffset });
    }
  }
  return tokens;
}

function tokenRanges(text, exact) {
  const source = canonicalTokenMap(text);
  const target = canonicalTokenMap(exact).map((item) => item.character);
  if (!target.length || target.length > source.length) return [];
  const ranges = [];
  for (let start = 0; start <= source.length - target.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < target.length; offset += 1) {
      if (source[start + offset].character !== target[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) ranges.push({ start: source[start].start, end: source[start + target.length - 1].end });
  }
  return ranges;
}

function literalRanges(text, exact) {
  const ranges = [];
  let start = text.indexOf(exact);
  while (start >= 0) {
    ranges.push({ start, end: start + exact.length });
    start = text.indexOf(exact, start + Math.max(1, exact.length));
  }
  return ranges;
}

function alignSentenceSelector(text, selector, expectedOffset = 0) {
  const candidates = literalRanges(text, selector.exact);
  const repaired = candidates.length ? false : true;
  if (!candidates.length) candidates.push(...tokenRanges(text, selector.exact));
  if (!candidates.length) return { selector: null, repaired: false, ambiguous: false };
  const prefixKey = canonicalVisible(selector.prefix ?? "");
  const suffixKey = canonicalVisible(selector.suffix ?? "");
  const score = ({ start, end }) => {
    const before = canonicalVisible(text.slice(0, start));
    const after = canonicalVisible(text.slice(end));
    return (prefixKey && before.endsWith(prefixKey) ? 1 : 0)
      + (suffixKey && after.startsWith(suffixKey) ? 1 : 0);
  };
  const ranked = candidates.map((range) => ({
    ...range,
    score: score(range),
    distance: Math.abs(range.start - expectedOffset),
  })).sort((left, right) => right.score - left.score || left.distance - right.distance || left.start - right.start);
  const selected = ranked[0];
  const firstCodePoints = (value, count) => [...value].slice(0, count).join("");
  const lastCodePoints = (value, count) => [...value].slice(-count).join("");
  const aligned = {
    ...selector,
    exact: text.slice(selected.start, selected.end),
  };
  const prefix = lastCodePoints(text.slice(0, selected.start), 32);
  const suffix = firstCodePoints(text.slice(selected.end), 32);
  if (prefix) aligned.prefix = prefix;
  else delete aligned.prefix;
  if (suffix) aligned.suffix = suffix;
  else delete aligned.suffix;
  return {
    selector: aligned,
    repaired,
    ambiguous: ranked.length > 1
      && ranked[0].score === ranked[1].score
      && ranked[0].distance === ranked[1].distance,
  };
}

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value)}\n`);
}

function commitOutputDirectories(stagedBoard, stagedTrace) {
  const targets = [
    { staged: stagedBoard, target: path.join(projectRoot, "public", "guides", "board") },
    { staged: stagedTrace, target: path.join(projectRoot, "public", "data", "board-trace") },
  ];
  const backups = targets.map(({ target }, index) => `${target}.backup-import-${process.pid}-${index}`);
  const installed = [];
  try {
    targets.forEach(({ target }, index) => {
      fs.rmSync(backups[index], { force: true, recursive: true });
      if (fs.existsSync(target)) fs.renameSync(target, backups[index]);
    });
    targets.forEach(({ staged, target }, index) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(staged, target);
      installed.push(index);
    });
    for (const backup of backups) fs.rmSync(backup, { force: true, recursive: true });
  } catch (error) {
    for (const index of [...installed].reverse()) fs.rmSync(targets[index].target, { force: true, recursive: true });
    targets.forEach(({ target }, index) => {
      if (fs.existsSync(backups[index])) fs.renameSync(backups[index], target);
    });
    throw error;
  }
}

async function main() {
  if (process.env.STATIC_CONTENT_LOCK_HELD !== "1") {
    throw new Error("Run this importer through npm run import:board-textbook so static content is expanded safely");
  }
  const { zipPath, dryRun } = parseArguments(process.argv.slice(2));
  if (!fs.existsSync(siteIndexPath)) throw new Error(`Expanded site index is missing: ${siteIndexPath}`);
  const entries = resolveZipEntries(zipPath);
  const registry = compactRegistry(zipPath, entries.registry);
  const [fullMarkdownBytes, unitManifest, bundles, reverseIndex] = await Promise.all([
    readZipEntry(zipPath, entries.markdown, 16 * 1024 * 1024),
    readZipJson(zipPath, entries.units, 4 * 1024 * 1024),
    readZipJson(zipPath, entries.bundles),
    readZipJson(zipPath, entries.reverse),
    registry.ready,
  ]);
  const fullMarkdown = new TextDecoder("utf-8", { fatal: true }).decode(fullMarkdownBytes);
  const siteIndex = JSON.parse(fs.readFileSync(siteIndexPath, "utf8"));
  if (!Array.isArray(siteIndex.questions)) throw new Error("public/data/index.json has no questions array");

  const units = Object.values(unitManifest).sort((left, right) => left.unitOrder - right.unitOrder);
  if (units.length !== 39) throw new Error(`Expected 39 units; found ${units.length}`);
  if (new Set(units.map((unit) => unit.unitCode)).size !== 39) throw new Error("Unit manifest contains duplicate unit codes");
  if (registry.nodesById.size !== 15_099) throw new Error(`Expected 15099 registry nodes; found ${registry.nodesById.size}`);
  if (registry.counts.paragraphCount !== 2_847 || registry.counts.sentenceCount !== 12_252) {
    throw new Error(`Unexpected registry shape: ${registry.counts.paragraphCount} paragraphs, ${registry.counts.sentenceCount} sentences`);
  }
  const reverseEntries = Object.entries(reverseIndex);
  if (reverseEntries.length !== 11_036) throw new Error(`Expected 11036 reverse-index nodes; found ${reverseEntries.length}`);
  for (const [nodeId, reverse] of reverseEntries) {
    const registryNode = registry.nodesById.get(nodeId);
    if (!registryNode) throw new Error(`Reverse index targets an unknown registry node: ${nodeId}`);
    if (reverse.unitCode !== registryNode.unitCode || reverse.paragraphId !== registryNode.paragraphId) {
      throw new Error(`Reverse index disagrees with registry metadata for ${nodeId}`);
    }
  }

  const { archiveBySite, aliasesByArchive } = buildCrosswalk(siteIndex.questions, bundles);
  const forwardNodeHits = buildForwardNodeHits(bundles, registry.nodesById);
  const unitMarkdown = splitUnitMarkdown(fullMarkdown, units);
  const stagingRoot = path.join(runtimeRoot, `board-textbook-import-${process.pid}`);
  const stagedBoard = path.join(stagingRoot, "guides", "board");
  const stagedUnits = path.join(stagedBoard, "units");
  const stagedTrace = path.join(stagingRoot, "data", "board-trace");
  const stagedRoutes = path.join(stagedTrace, "routes");
  fs.rmSync(stagingRoot, { force: true, recursive: true });
  fs.mkdirSync(stagedUnits, { recursive: true });
  fs.mkdirSync(stagedRoutes, { recursive: true });

  let optionCount = 0;
  for (const bundle of Object.values(bundles)) optionCount += bundle.options?.length ?? 0;
  if (optionCount !== 13_199) throw new Error(`Expected 13199 option routes; found ${optionCount}`);
  const canonicalAtomCount = Object.keys(bundles).length + optionCount;
  if (canonicalAtomCount !== 16_119) throw new Error(`Expected 16119 canonical atoms; found ${canonicalAtomCount}`);
  let siteExpandedOptionCount = 0;
  for (const question of siteIndex.questions) {
    siteExpandedOptionCount += bundles[archiveBySite.get(question.id)]?.options?.length ?? 0;
  }
  const siteExpandedAtomCount = siteIndex.questions.length + siteExpandedOptionCount;
  if (siteExpandedOptionCount !== 14_799 || siteExpandedAtomCount !== 18_119) {
    throw new Error(`Unexpected site-expanded atom counts: ${siteExpandedOptionCount} options, ${siteExpandedAtomCount} total`);
  }

  const manifestUnits = [];
  let markedParagraphs = 0;
  let mergedParagraphs = 0;
  let sourceTagMismatches = 0;
  let ambiguousSentenceSelectors = 0;
  let repairedSentenceSelectors = 0;
  let traceableSentenceCount = 0;
  let forwardSupplementedReverseHits = 0;
  let markdownBytes = 0;
  let traceBytes = 0;
  try {
    for (const unit of units) {
      const paragraphs = [...(registry.paragraphsByUnit.get(unit.unitCode) ?? [])]
        .sort((left, right) => left.paragraphOrder - right.paragraphOrder);
      if (paragraphs.length !== unit.paragraphCount) {
        throw new Error(`${unit.unitCode} registry/manifest paragraph mismatch: ${paragraphs.length}/${unit.paragraphCount}`);
      }
      const sentenceCount = paragraphs.reduce(
        (total, paragraph) => total + (registry.sentencesByParagraph.get(paragraph.nodeId)?.length ?? 0),
        0,
      );
      if (paragraphs.length + sentenceCount !== unit.nodeCount) {
        throw new Error(`${unit.unitCode} registry/manifest node mismatch: ${paragraphs.length + sentenceCount}/${unit.nodeCount}`);
      }
      const sourceMarkdown = unitMarkdown.get(unit.unitCode);
      if (!sourceMarkdown) throw new Error(`Missing Markdown for unit ${unit.unitCode}`);
      const aligned = alignUnitMarkdown(unit, sourceMarkdown, paragraphs);
      const { matches } = aligned;
      mergedParagraphs += aligned.mergedParagraphs;
      for (const paragraph of paragraphs) {
        if (matches.get(paragraph.nodeId)?.tag !== paragraph.sourceTag) sourceTagMismatches += 1;
      }
      const paragraphTrace = new Map();
      const paragraphData = {};
      const sentenceData = {};
      const referencedArchiveQuestions = new Set();
      let directAtomCount = 0;
      let relatedAtomCount = 0;
      for (const paragraph of paragraphs) {
        const paragraphHits = reverseHits(
          reverseIndex[paragraph.nodeId],
          aliasesByArchive,
          (archiveId) => referencedArchiveQuestions.add(archiveId),
        );
        const directIds = new Set(paragraphHits.direct);
        const relatedIds = new Set(paragraphHits.related.filter((atomId) => !directIds.has(atomId)));
        forwardSupplementedReverseHits += mergeForwardHits(
          directIds,
          relatedIds,
          forwardNodeHits.get(paragraph.nodeId),
          referencedArchiveQuestions,
        );
        const sentences = [...(registry.sentencesByParagraph.get(paragraph.nodeId) ?? [])]
          .sort((left, right) => left.sentenceOrder - right.sentenceOrder);
        for (const sentence of sentences) {
          const reverse = reverseIndex[sentence.nodeId];
          const forwardHits = forwardNodeHits.get(sentence.nodeId);
          if (!reverse && !forwardHits) continue;
          const reverseSentenceHits = reverse
            ? reverseHits(reverse, aliasesByArchive, (archiveId) => referencedArchiveQuestions.add(archiveId))
            : { direct: [], related: [] };
          const sentenceDirectIds = new Set(reverseSentenceHits.direct);
          const sentenceRelatedIds = new Set(reverseSentenceHits.related.filter((atomId) => !sentenceDirectIds.has(atomId)));
          forwardSupplementedReverseHits += mergeForwardHits(
            sentenceDirectIds,
            sentenceRelatedIds,
            forwardHits,
            referencedArchiveQuestions,
          );
          if (!sentenceDirectIds.size && !sentenceRelatedIds.size) continue;
          const sentenceHits = { direct: [...sentenceDirectIds], related: [...sentenceRelatedIds] };
          for (const atomId of sentenceHits.direct) {
            directIds.add(atomId);
            relatedIds.delete(atomId);
          }
          for (const atomId of sentenceHits.related) {
            if (!directIds.has(atomId)) relatedIds.add(atomId);
          }
          const sourceSelector = sentenceSelector(sentence, sentenceHits);
          const paragraphText = matches.get(paragraph.nodeId)?.text ?? "";
          const paragraphStart = paragraph.selector?.textPosition?.start;
          const sentenceStart = sentence.selector?.textPosition?.start;
          const expectedOffset = Number.isSafeInteger(paragraphStart) && Number.isSafeInteger(sentenceStart)
            ? Math.max(0, sentenceStart - paragraphStart)
            : 0;
          const alignedSelector = alignSentenceSelector(paragraphText, sourceSelector, expectedOffset);
          if (!alignedSelector.selector) {
            throw new Error(`Sentence selector does not match aligned Markdown: ${unit.unitCode}/${sentence.nodeId}`);
          }
          if (alignedSelector.repaired) repairedSentenceSelectors += 1;
          if (alignedSelector.ambiguous) ambiguousSentenceSelectors += 1;
          sentenceData[sentence.nodeId] = alignedSelector.selector;
          traceableSentenceCount += 1;
        }
        const hits = { direct: [...directIds], related: [...relatedIds] };
        paragraphTrace.set(paragraph.nodeId, hits);
        paragraphData[paragraph.nodeId] = hits;
        directAtomCount += hits.direct.length;
        relatedAtomCount += hits.related.length;
        if (hits.direct.length || hits.related.length) markedParagraphs += 1;
      }
      const outputMarkdown = injectParagraphMarkers(aligned.markdown, matches, paragraphTrace);
      if (/<a\s+(?:id|name)=/iu.test(outputMarkdown) || /\{#[A-Za-z0-9_-]+\}/u.test(outputMarkdown)) {
        throw new Error(`Raw anchors remain in unit ${unit.unitCode}`);
      }
      const markdownTarget = path.join(stagedUnits, `${unit.unitCode}.md`);
      fs.writeFileSync(markdownTarget, outputMarkdown);
      const unitTrace = {
        schemaVersion,
        traceVersion,
        unitCode: unit.unitCode,
        questionRefs: Object.fromEntries([...referencedArchiveQuestions].sort((left, right) => left.localeCompare(right, "en"))
          .map((archiveId) => {
            const aliases = aliasesByArchive.get(archiveId);
            return [archiveId, aliases.length === 1 ? aliases[0] : aliases];
          })),
        paragraphs: paragraphData,
        sentences: sentenceData,
      };
      const traceTarget = path.join(stagedUnits, `${unit.unitCode}.json`);
      writeJson(traceTarget, unitTrace);
      const markdownSize = fs.statSync(markdownTarget).size;
      const traceSize = fs.statSync(traceTarget).size;
      markdownBytes += markdownSize;
      traceBytes += traceSize;
      manifestUnits.push({
        unitCode: unit.unitCode,
        unitId: unit.unitId,
        title: unit.unitTitle,
        order: unit.unitOrder,
        paragraphCount: paragraphs.length,
        directAtomCount,
        relatedAtomCount,
        contentHash: digest(Buffer.from(outputMarkdown, "utf8")),
        markdownPath: `/guides/board/units/${unit.unitCode}.md`,
        tracePath: `/guides/board/units/${unit.unitCode}.json`,
      });
    }

    const questionsByExam = new Map();
    for (const question of siteIndex.questions) {
      const questions = questionsByExam.get(question.exam) ?? [];
      questions.push(question);
      questionsByExam.set(question.exam, questions);
    }
    let shardQuestionCount = 0;
    for (const [exam, questions] of [...questionsByExam.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
      const questionRoutes = {};
      const routes = {};
      for (const question of questions) {
        const archiveId = archiveBySite.get(question.id);
        if (!archiveId) throw new Error(`No archive route for site question ${question.id}`);
        questionRoutes[question.id] = archiveId;
        if (!routes[archiveId]) {
          routes[archiveId] = buildQuestionRoute(bundles[archiveId], aliasesByArchive.get(archiveId), registry.nodesById);
        }
        shardQuestionCount += 1;
      }
      const shard = { schemaVersion, traceVersion, exam, questionRoutes, routes };
      const target = path.join(stagedRoutes, `${exam}.json`);
      writeJson(target, shard);
      traceBytes += fs.statSync(target).size;
    }
    if (shardQuestionCount !== 3_320) throw new Error(`Expected 3320 sharded question routes; found ${shardQuestionCount}`);

    const manifest = {
      schemaVersion,
      traceVersion,
      title: "急診專科歷屆考題總指引",
      subtitle: "全書逐題、逐選項雙向追溯版",
      unitCount: 39,
      questionCount: 2_920,
      siteQuestionCount: 3_320,
      optionCount,
      canonicalAtomCount,
      siteExpandedOptionCount,
      siteExpandedAtomCount,
      paragraphCount: registry.counts.paragraphCount,
      sentenceCount: registry.counts.sentenceCount,
      traceableSentenceCount,
      traceableParagraphCount: markedParagraphs,
      units: manifestUnits,
    };
    writeJson(path.join(stagedBoard, "manifest.json"), manifest);

    if (!dryRun) commitOutputDirectories(stagedBoard, stagedTrace);
    console.log(JSON.stringify({
      mode: dryRun ? "dry-run" : "committed",
      zipPath,
      traceVersion,
      siteQuestions: archiveBySite.size,
      canonicalQuestions: aliasesByArchive.size,
      canonicalOptions: optionCount,
      canonicalAtoms: canonicalAtomCount,
      siteExpandedOptions: siteExpandedOptionCount,
      siteExpandedAtoms: siteExpandedAtomCount,
      units: manifestUnits.length,
      paragraphs: registry.counts.paragraphCount,
      markedParagraphs,
      mergedParagraphs,
      sourceTagMismatches,
      ambiguousSentenceSelectors,
      repairedSentenceSelectors,
      sentences: registry.counts.sentenceCount,
      traceableSentences: traceableSentenceCount,
      forwardSupplementedReverseHits,
      markdownBytes,
      traceBytes,
    }, null, 2));
  } finally {
    fs.rmSync(stagingRoot, { force: true, recursive: true });
  }
}

await main();
