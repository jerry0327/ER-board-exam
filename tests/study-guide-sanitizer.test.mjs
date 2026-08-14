import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { extractMarkdownOutline } from "../app/lib/markdown-heading.ts";
import { rosensChapters } from "../app/lib/rosens-catalog.ts";
import { sanitizeStudyGuideMarkdown } from "../app/lib/study-guide-markdown.ts";
import {
  auditHeadingCategories,
  headingCategory,
  normalizeStandaloneMathDelimiters,
  normalizeStudyGuideSource,
  parseGuideMarkdown,
} from "../scripts/lib/study-guide-reading-modes.mjs";

const catalog = JSON.parse(await readFile(new URL("../public/guides/manifest.json", import.meta.url), "utf8"));
const availablePacks = catalog.packs.filter((pack) => pack.status === "available");
const internalMetadataPattern = /(?:來源定位|來源與視覺審閱|來源、頁界與視覺審閱紀錄|視覺審閱確認|版本與審閱範圍|審閱範圍|章節識別|完整性檢查|來源檔|print\s+p{1,2}\.?\s*\d|PDF\s+pages?\s*\d|rendered\s+p\.?\s*\d|逐頁\s*(?:render|檢視|檢查|核對|複核|覆核|審閱)|V1\s*(?:→|->)\s*V2|Reviewer|Integrator|私人工作檔|公開\s*release|原文摘錄|上傳\s*PDF|完整\s*(?:reference list|references|bibliography)|不在本次審閱範圍|(?:均|皆)可(?:完整|清楚|可靠)?(?:判|辨)讀)/iu;
const openingEditorialPattern = /(?:資料來源|來源(?:定位|範圍|與(?:完整性|視覺|審閱)|限制|品質)|原始\s*PDF|提供的\s*PDF|上傳\s*PDF|print\s+p|PDF\s+pages?|逐頁|視覺審閱|審閱範圍|版本(?:提醒|警示|提示|定位|界線|警語|注意|註記|安全|與)|出版年代|source-era|臨床更新重點|臨床時效|時效(?:提醒|警示)|疑似[^。]{0,40}(?:已在|標示)|完整(?:性檢查|審閱範圍)|章節(?:識別|定位|可見性))/iu;

const explicitOpeningEditorialPattern = /(?:版本與使用提醒|(?:重大)?時代性提醒|臨床更新重點|資料來源|來源與範圍|版本提醒|使用提醒|編輯說明|適用性提醒|教材說明|內容說明)/u;

function inspectedOpening(markdown) {
  const { nodes } = parseGuideMarkdown(markdown);
  const selected = [];
  let majorHeadings = 0;
  let nodesAfterFirstMajorHeading = 0;
  let firstMajorHeading = "";
  let firstMajorIndex = -1;
  for (const item of nodes) {
    if (item.heading?.depth === 2) {
      majorHeadings += 1;
      if (!firstMajorHeading) {
        firstMajorHeading = item.heading.label;
        firstMajorIndex = item.index;
      }
      if (majorHeadings > 1) break;
    }
    if (majorHeadings === 1 && item.heading?.depth >= 3) break;
    if (majorHeadings === 1 && item.heading?.depth !== 2) {
      nodesAfterFirstMajorHeading += 1;
      if (nodesAfterFirstMajorHeading > 8) break;
    }
    selected.push(item.raw);
  }
  const nextMajorIndex = nodes.findIndex((item) => item.index > firstMajorIndex && item.heading?.depth === 2);
  const firstMajorHasContent = firstMajorIndex >= 0 && nodes
    .slice(firstMajorIndex + 1, nextMajorIndex < 0 ? undefined : nextMajorIndex)
    .some((item) => !["thematicBreak", "html", "definition"].includes(item.node.type) && item.text.trim().length > 0);
  const hasLeadingSeparator = firstMajorIndex >= 0 && nodes
    .slice(0, firstMajorIndex)
    .some((item) => item.node.type === "thematicBreak");
  return { firstMajorHasContent, firstMajorHeading, hasLeadingSeparator, markdown: selected.join("\n\n") };
}

test("all available learner-facing guide modes hide production metadata and retain readable headings", async () => {
  assert.deepEqual(availablePacks.map((pack) => pack.id), ["concise", "detailed"]);

  const headingTotals = { numeric: 0, "chinese-number": 0, letter: 0, part: 0 };
  const semanticLetterHeadings = [];
  for (const pack of availablePacks) {
    for (const mode of ["quick", "key-points", "full"]) {
      const guideDirectory = new URL(`../public/guides/packs/${pack.id}/${mode}/`, import.meta.url);
      const files = (await readdir(guideDirectory)).filter((file) => file.endsWith(".md")).sort();
      assert.equal(files.length, 303, `${pack.id}/${mode} should publish 303 guides`);
      for (const file of files) {
        const sourceLabel = `${pack.id}/${mode}/${file}`;
        const raw = await readFile(new URL(file, guideDirectory), "utf8");
        const learner = sanitizeStudyGuideMarkdown(raw);
        const opening = mode === "full" ? inspectedOpening(learner) : null;
        assert.doesNotMatch(
          opening?.markdown ?? learner,
          internalMetadataPattern,
          `${sourceLabel} 仍在開頭或精簡版本中呈現內部製作資訊`,
        );
        const h1Count = (learner.match(/^#\s+\S+/gmu) ?? []).length;
        assert.ok(h1Count > 0, `${sourceLabel} 應保留文章主標題`);
        if (mode !== "full") {
          assert.equal(h1Count, 1, `${sourceLabel} 應只有一個文章主標題`);
          continue;
        }
        assert.ok(extractMarkdownOutline(learner).length > 0, `${sourceLabel} 沒有可解析的完整文章大綱`);
        assert.match(opening.firstMajorHeading, /^1\.\s+\S/u, `${sourceLabel} 第一個大標必須從 1. 開始`);
        assert.equal(opening.firstMajorHasContent, true, `${sourceLabel} 第一個大標不可是空殼`);
        assert.doesNotMatch(opening.markdown, openingEditorialPattern, `${sourceLabel} 開頭仍含製作或免責文字`);
        assert.equal(opening.hasLeadingSeparator, false, `${sourceLabel} 第一個大標前不可殘留分隔線`);
        assert.doesNotMatch(opening.markdown, explicitOpeningEditorialPattern, `${sourceLabel} 開場不可出現編輯性註記`);
        const counts = auditHeadingCategories(raw);
        for (const key of Object.keys(headingTotals)) headingTotals[key] += counts[key];
        for (const item of extractMarkdownOutline(raw)) {
          if (headingCategory(item.label) === "letter") {
            semanticLetterHeadings.push({ sourceLabel, label: item.label });
          }
        }
      }
    }
  }

  assert.ok(headingTotals.numeric > 0, "H2/H3 should use numeric hierarchy");
  assert.equal(headingTotals["chinese-number"], 0, "Chinese structural numbering should be normalized");
  assert.equal(headingTotals.part, 0, "Part structural numbering should be normalized");
  assert.ok(headingTotals.letter <= 20, "Only a small number of semantic letter headings should remain");
  for (const { sourceLabel, label } of semanticLetterHeadings) {
    assert.match(
      label,
      /^(?:[A-Z]-[\p{L}\p{N}]|[A-Z]\.\s*[a-z]|[MARCH][：:]\s*\S)/u,
      `${sourceLabel} retained a non-semantic letter prefix: ${label}`,
    );
  }
});

test("all 208 Rosen full guides begin with a visible 1. major heading and no editorial preface", async () => {
  for (const chapter of rosensChapters) {
    const raw = await readFile(
      new URL(`../public/guides/rosens/detailed/${chapter.id}/full.md`, import.meta.url),
      "utf8",
    );
    const learner = sanitizeStudyGuideMarkdown(raw);
    const opening = inspectedOpening(learner);
    assert.match(opening.firstMajorHeading, /^1\.\s+\S/u, `Rosen ${chapter.id} 第一個大標必須從 1. 開始`);
    assert.equal(opening.firstMajorHasContent, true, `Rosen ${chapter.id} 第一個大標不可是空殼`);
    assert.equal(opening.hasLeadingSeparator, false, `Rosen ${chapter.id} 第一個大標前不可殘留分隔線`);
    assert.doesNotMatch(opening.markdown, explicitOpeningEditorialPattern, `Rosen ${chapter.id} 開場不可出現編輯性註記`);
    assert.doesNotMatch(opening.markdown, openingEditorialPattern, `Rosen ${chapter.id} 開頭仍含製作或免責文字`);
  }
});

test("sanitizer removes review process but preserves patient-safety conclusions", async () => {
  const fullGuideDirectory = new URL("../public/guides/packs/concise/full/", import.meta.url);
  const raw = await readFile(new URL("chapter-146.md", fullGuideDirectory), "utf8");
  const learner = sanitizeStudyGuideMarkdown(raw);
  assert.match(learner, /25／50／100 grams/);
  assert.match(learner, /絕不可使用grams/);
  assert.match(learner, /25／50／100 milligrams/);
  const opening = inspectedOpening(learner).markdown;
  assert.doesNotMatch(opening, /print\s+p/iu);
  assert.doesNotMatch(opening, /逐頁|視覺檢查|render/iu);
});

test("sanitizer removes learner-facing source, version, and update disclaimers", () => {
  const source = [
    "# Pain Management",
    "",
    "> 資料來源：*Rosen’s Emergency Medicine: Concepts and Clinical Practice*, Chapter 17, pp. 158–166.e1。",
    "",
    "> **版本與使用提醒：**以下藥物劑量依本章內容整理；臨床使用仍應核對當地規範。提供的 PDF 沒有 Table 6.7 註腳。",
    "",
    "## 1. 急診疼痛照護的臨床主軸",
    "",
    "> **臨床更新重點**：本表並非完整 protocol；疑似單位錯誤或版本敏感內容已在相應段落標示。",
    "",
    "真正的臨床內容。",
    "",
    "## 2. 後段補充",
    "",
    "> **版本提醒：**這個後段補充依使用者要求保留。",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  const opening = learner.slice(0, learner.indexOf("## 2. 後段補充"));
  assert.doesNotMatch(opening, /版本與使用提醒|臨床更新重點|資料來源|Table 6\.7|pp\.\s*158/u);
  assert.match(learner, /^## 1\. 急診疼痛照護的臨床主軸$/mu);
  assert.match(learner, /真正的臨床內容/u);
  assert.match(learner, /版本與使用提醒/u);
  assert.match(learner, /臨床更新重點/u);
  assert.match(learner, /資料來源/u);
  assert.doesNotMatch(learner, /後段補充依使用者要求保留/u);
});

test("sanitizer removes an empty opening shell and renumbers the remaining hierarchy", () => {
  const source = [
    "# Disaster Preparedness",
    "",
    "## 1. Disaster Preparedness",
    "",
    "> **版本與使用提醒：**以下內容依來源版本整理。",
    "",
    "---",
    "",
    "## 2. 先建立正確觀念",
    "",
    "真正的臨床內容。",
    "",
    "### 2.1 災難與大量傷患事件",
    "",
    "次層內容。",
    "",
    "## 3. 現場處置",
    "",
    "後續內容。",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  const opening = inspectedOpening(learner);
  assert.equal(opening.firstMajorHeading, "1. 先建立正確觀念");
  assert.equal(opening.firstMajorHasContent, true);
  assert.equal(opening.hasLeadingSeparator, false);
  assert.doesNotMatch(learner, /^## 1\. Disaster Preparedness$/mu);
  assert.match(learner, /^### 1\.1 災難與大量傷患事件$/mu);
  assert.match(learner, /^## 2\. 現場處置$/mu);
  assert.match(learner, /版本與使用提醒/u);
});

test("sanitizer moves explicit opening notes, removes orphan separators, and renders exported equations", () => {
  const source = [
    "# Approach to Nontraumatic Shock",
    "",
    "---",
    "",
    "## 1. 非創傷性休克：從灌流生理到急診復甦",
    "",
    "> **時代性提醒：**本章反映舊版出版時的證據；臨床執行須依現行 protocol 核對。",
    "",
    "---",
    "",
    "## 2. 先抓住最重要的概念：Shock 不等於 hypotension",
    "",
    "臨床可用以下關係理解：",
    "",
    "[",
    "DO_2 = CO \\times CaO_2",
    "]",
    "",
    "[",
    "#### \\text{Corrected retic \\%}",
    "",
    "\\text{measured retic \\%} \\times \\frac{\\text{patient Hct}}{\\text{normal Hct}}",
    "]",
    "",
    "其中心輸出量與動脈血氧含量共同決定氧輸送。",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  const opening = inspectedOpening(learner);
  assert.equal(opening.firstMajorHeading, "1. 先抓住最重要的概念：Shock 不等於 hypotension");
  assert.equal(opening.firstMajorHasContent, true);
  assert.equal(opening.hasLeadingSeparator, false);
  assert.doesNotMatch(learner.slice(0, learner.lastIndexOf("\n---\n")), /時代性提醒/u);
  assert.match(learner, /^\$\$\nDO_2 = CO \\times CaO_2\n\$\$$/mu);
  assert.match(learner, /\\text\{Corrected retic \\%\} =/u);
  assert.match(learner, /\n---\n\n> \*\*時代性提醒：\*\*/u);
});

test("sanitizer relocates only the editorial paragraph from a mixed opening blockquote", () => {
  const source = [
    "# Toxicology",
    "",
    "## 1. 劑量與安全界線",
    "",
    "> **版本與使用提醒：**以下內容依來源版本整理。",
    ">",
    "> **劑量安全：**Glucagon infusion 為 1–15 mg/h，不是 5 mg/kg/h。",
    "",
    "## 2. 後續處置",
    "",
    "持續監測。",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  const firstSection = learner.slice(0, learner.indexOf("## 2. 後續處置"));
  assert.doesNotMatch(firstSection, /版本與使用提醒/u);
  assert.match(firstSection, /Glucagon infusion 為 1–15 mg\/h/u);
  assert.match(learner.slice(learner.lastIndexOf("\n---\n")), /版本與使用提醒/u);
});

test("sanitizer removes standalone emphasis markers from the opening", () => {
  const source = [
    "# Airway",
    "",
    "*",
    "",
    "**",
    "",
    "## 1. Initial airway assessment",
    "",
    "Assess oxygenation and ventilation.",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  assert.equal(learner.split(/\r?\n/gu).some((line) => line === "*" || line === "**"), false);
  assert.match(learner, /^## 1\. Initial airway assessment$/mu);
  assert.match(learner, /Assess oxygenation and ventilation\./u);
});

test("sanitizer balances emphasis after removing a source sentence and preserves clinical bold", () => {
  const source = [
    "# Airway",
    "",
    "## 1. Initial care",
    "",
    "**來源定位：** print p. 12。**臨床重點：**先處理 airway。",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  assert.doesNotMatch(learner.split(/\n---\n/u)[0], /來源定位|print\s+p\.\s*12/iu);
  assert.match(learner, /來源定位[\s\S]*print\s+p\.\s*12/iu);
  assert.match(learner, /\*\*臨床重點：\*\*先處理 airway。/u);
  assert.equal((learner.match(/\*\*/gu) ?? []).length % 2, 0);
});

test("sanitizer collapses short opening scope or continuation sections and renumbers the hierarchy", () => {
  const cases = [
    {
      heading: "## 1. Table、Figure 與內容範圍",
      body: "Table 1-1 與 Figure 1-1 只列出本章涵蓋範圍。",
    },
    {
      heading: "## 1. 本章導讀",
      body: "以下主題將在後續章節展開。",
    },
  ];

  for (const fixture of cases) {
    const source = [
      "# Shock",
      "",
      fixture.heading,
      "",
      fixture.body,
      "",
      "## 2. Initial resuscitation",
      "",
      "Restore perfusion while identifying the cause.",
      "",
      "### 2.1 Hemodynamic reassessment",
      "",
      "Repeat the examination after each intervention.",
      "",
      "## 3. Disposition",
      "",
      "Match disposition to residual instability.",
      "",
    ].join("\n");
    const learner = sanitizeStudyGuideMarkdown(source);
    const learnerOpening = learner.split(/\n---\n/u)[0];
    assert.equal(inspectedOpening(learner).firstMajorHeading, "1. Initial resuscitation");
    assert.doesNotMatch(learnerOpening, new RegExp(fixture.body.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.match(learner, /^### 1\.1 Hemodynamic reassessment$/mu);
    assert.match(learner, /^## 2\. Disposition$/mu);
  }
});

test("sanitizer rewrites study-guide shell H2 headings to the learner clinical title", () => {
  for (const shellHeading of [
    "## 1. 急診專科考試整合讀書指南",
    "## 1. Sepsis 學習指南",
  ]) {
    const source = [
      "# Sepsis",
      "",
      shellHeading,
      "",
      "Recognize shock and start time-sensitive treatment.",
      "",
    ].join("\n");
    const learner = sanitizeStudyGuideMarkdown(source);
    assert.match(learner, /^## 1\. 急診辨識與處置$/mu);
    assert.doesNotMatch(learner, /急診專科考試整合|學習指南/u);
  }
});

test("sanitizer removes a redundant opening H3 and its orphan separator", () => {
  const source = [
    "# Upper GI Emergencies",
    "",
    "## 1. Immediate threats",
    "",
    "---",
    "",
    "### 1.1 Immediate threats",
    "",
    "Treat obstruction, perforation, and hemorrhage first.",
    "",
    "## 2. Definitive evaluation",
    "",
    "Choose testing from the suspected lesion.",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  const opening = learner.slice(0, learner.indexOf("## 2. Definitive evaluation"));
  assert.match(opening, /^## 1\. Immediate threats$/mu);
  assert.doesNotMatch(opening, /^###\s+/mu);
  assert.doesNotMatch(opening, /^---$/mu);
  assert.match(opening, /Treat obstruction, perforation, and hemorrhage first\./u);
});

test("sanitizer moves a production-only opening subsection to the appendix", () => {
  const source = [
    "# Glucose Emergencies",
    "",
    "## 1. DKA, HHS, and hypoglycemia",
    "",
    "### 1.1 Diabetes and glucose homeostasis",
    "",
    "> **版本與使用提醒：**本章內容約反映 2021 年資料，實際處置須依現行 protocol。",
    "",
    "---",
    "",
    "### 1.2 Immediate triage",
    "",
    "Treat neuroglycopenia immediately.",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  const appendixStart = learner.lastIndexOf("\n---\n");
  assert.match(learner, /^### 1\.1 Immediate triage$/mu);
  assert.doesNotMatch(learner.slice(0, appendixStart), /版本與使用提醒|2021 年資料/u);
  assert.match(learner.slice(appendixStart), /版本與使用提醒|2021 年資料/u);
});

test("sanitizer moves opening limitation and safety notices to the intact document appendix", () => {
  const source = [
    "# Toxicology",
    "",
    "> **最重要限制：**不確定劑量時必須先查證，不可憑印象下單。",
    "",
    "> **時效、法規與病人安全警示：**實際處置須符合現行法規與病人安全流程。",
    "",
    "## 1. Initial stabilization",
    "",
    "先處理 airway、breathing 與 circulation。",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  const appendixStart = learner.lastIndexOf("\n---\n");
  assert.ok(appendixStart > learner.indexOf("先處理 airway"));
  assert.doesNotMatch(learner.slice(0, appendixStart), /最重要限制|時效、法規與病人安全警示/u);
  const appendix = learner.slice(appendixStart);
  assert.match(appendix, /> \*\*最重要限制：\*\*不確定劑量時必須先查證，不可憑印象下單。/u);
  assert.match(appendix, /> \*\*時效、法規與病人安全警示：\*\*實際處置須符合現行法規與病人安全流程。/u);
});

test("detailed high-risk chapters retain learner-facing clinical and legal cautions", async () => {
  const detailedDirectory = new URL("../public/guides/packs/detailed/full/", import.meta.url);
  const [carbonMonoxide, eyeEmergencies, legalIssues] = await Promise.all([
    readFile(new URL("chapter-222.md", detailedDirectory), "utf8").then(sanitizeStudyGuideMarkdown),
    readFile(new URL("chapter-241.md", detailedDirectory), "utf8").then(sanitizeStudyGuideMarkdown),
    readFile(new URL("chapter-303.md", detailedDirectory), "utf8").then(sanitizeStudyGuideMarkdown),
  ]);
  assert.match(carbonMonoxide, /不是[^。！？]{0,50}HBOT[^。！？]{0,30}絕對命令/u);
  assert.match(eyeEmergencies, /source-era|現行|更新/iu);
  assert.match(legalIssues, /台灣[^。！？]{0,120}(?:法律|法規|制度|適用)/u);
});

test("standalone source-exported equations become display math outside code fences", () => {
  const source = "# Chapter 1\n\n[\nCPP\n===\n\nMAP-ICP\n]\n\n```txt\n[\nnot math\n]\n```\n";
  assert.equal(normalizeStandaloneMathDelimiters(source), "# Chapter 1\n\n$$\nCPP\n=\n\nMAP-ICP\n$$\n\n```txt\n[\nnot math\n]\n```\n");
});

test("source normalization protects currency and visible percent signs from math parsing", () => {
  const source = "費用由 US$650 降至 US$150，另有 $2309；公式 $x+y$ 保持原樣。\n\n| Cost | $$ |\n\n[\nDose=4\\times %\\text{TBSA}\n]\n";
  const normalized = normalizeStudyGuideSource(source);
  assert.match(normalized, /US\\\$650 降至 US\\\$150/u);
  assert.match(normalized, /另有 \\\$2309；公式 \$x\+y\$ 保持原樣/u);
  assert.match(normalized, /\| Cost \| \\\$\\\$ \|/u);
  assert.match(normalized, /^\$\$\nDose=4\\times \\%\\text\{TBSA\}\n\$\$$/mu);
});

test("sanitizer places clinical prose after the first numbered major heading", () => {
  const source = [
    "# Fever",
    "",
    "先判斷病人是否不穩定，再依暴露與免疫狀態縮小鑑別。",
    "",
    "## 1. Initial assessment",
    "",
    "取得完整生命徵象。",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  assert.ok(learner.indexOf("## 1. Initial assessment") < learner.indexOf("先判斷病人是否不穩定"));
  assert.ok(learner.indexOf("先判斷病人是否不穩定") < learner.indexOf("取得完整生命徵象"));
});

test("sanitizer reapplies the canonical clinical opening after removing a thin scope section", () => {
  const source = [
    "# 急性冠心症",
    "",
    "## 1. 章節範圍",
    "",
    "章節範圍為紙本第 334～352 頁。",
    "",
    "## 2. 先掌握整章的臨床主軸",
    "",
    "先取得 12-lead ECG 並評估再灌流需求。",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  assert.match(learner, /^## 1\. 先以症狀、心電圖與心肌損傷指標分層$/mu);
  assert.doesNotMatch(learner.split(/\n---\n/u)[0], /紙本第 334/u);
});

test("sanitizer removes numeric source definitions and keeps global production blocks out of the reading flow", () => {
  const source = [
    "# Toxicology",
    "",
    "## 1. Initial stabilization",
    "",
    "先處理 airway、breathing 與 circulation。",
    "",
    "> **來源與視覺審閱：**已逐頁 render 並核對 print pp. 1–5。",
    "",
    "[1]: https://example.com/source?utm_source=chatgpt.com",
    "",
    "持續監測神經與心血管狀態。",
    "",
  ].join("\n");
  const learner = sanitizeStudyGuideMarkdown(source);
  const body = learner.split(/\n---\n/u)[0];
  assert.doesNotMatch(body, /來源與視覺審閱|逐頁|print\s+pp/iu);
  assert.doesNotMatch(learner, /^\[1\]:/mu);
  assert.match(body, /持續監測神經與心血管狀態/u);
});
