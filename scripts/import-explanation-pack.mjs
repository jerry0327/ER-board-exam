import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const PACK_ID = "concise";
const SCHEMA_VERSION = 1;
const CANONICAL_SECTIONS = [
  "核心理由",
  "考場解題路徑",
  "選項分析",
  "核心知識整理",
  "常見陷阱與變形",
  "延伸學習",
  "參考資料",
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`無法辨識的參數：${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`參數 ${token} 缺少值`);
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

function readMarkdownFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(entryPath);
    }
  };
  visit(directory);
  return files;
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseFrontmatter(markdown) {
  const normalized = markdown.replaceAll("\r\n", "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/u);
  if (!match) return { attributes: {}, body: normalized };
  const attributes = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/u);
    if (field) attributes[field[1]] = unquote(field[2]);
  }
  return { attributes, body: normalized.slice(match[0].length) };
}

function splitLevelTwoSections(body) {
  const sections = new Map();
  let current = null;
  for (const line of body.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/u);
    if (heading) {
      current = heading[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  return new Map([...sections].map(([heading, lines]) => [heading, lines.join("\n")]));
}

function stripImageBlocks(markdown) {
  const lines = markdown.split("\n");
  const kept = [];
  let skippedHeadingLevel = null;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/u);
    if (skippedHeadingLevel !== null) {
      if (!heading || heading[1].length > skippedHeadingLevel) continue;
      skippedHeadingLevel = null;
    }
    if (heading && /^(?:原題圖像|原題影像|題目圖片|圖片描述|影像描述)(?:\s|$)/u.test(heading[2])) {
      skippedHeadingLevel = heading[1].length;
      continue;
    }
    kept.push(line);
  }

  return kept.join("\n")
    .replace(/!\[[^\]]*\]\([^\n)]*\)/gu, "")
    .replace(/<img\b[^>]*>/giu, "");
}

function stripPipelineProvenance(markdown) {
  const provenanceOnlyLine = /(?:原始\s*\d[\d,]*\s*題\s*CSV|本批\s*依\s*官方\s*PDF|題庫總數修正)/iu;

  return markdown
    .split("\n")
    .map((line) => {
      if (provenanceOnlyLine.test(line)) return "";

      return line
        .replace(/本題同時修正資料與醫學：\s*原\s*CSV[^；\n|]*；\s*(?=官方)/giu, "")
        .replace(/題庫專案將其列為[^。\n|]*(?:。|(?=\s*\|)|$)/giu, "")
        .replace(/(?:[；，]\s*)?(?:且\s*)?原始(?:選項)?\s*OCR[^。\n|]*(?:。|(?=\s*\|)|$)/giu, "")
        .replace(/(?:[；，]\s*)?本題由官方\s*PDF[^。\n|]*(?:。|(?=\s*\|)|$)/giu, "")
        .replace(/[ \t]+\|$/u, " |")
        .trimEnd();
    })
    .join("\n");
}

function stripEditorialBoilerplate(markdown) {
  return markdown
    .replace(/^>\s*\*\*答案核對提醒：\*\*[^\n]*$/gmu, "")
    .replace(/本題的作答重點是把「([^」]+)」放回急診優先順序，而不是只背單一名詞。遇到相似題型時，先辨認是否存在立即威脅、可逆原因與需要同步處置的問題，再判斷題目要求的是診斷、檢查、藥物或程序。/gu, "先確認「$1」涉及的立即威脅、可逆原因與處置順序。")
    .replace(/本題的判讀重點是先辨識「([^」]+)」所代表的急診風險，再依病人的穩定度決定處置順序。考試作答時要區分疾病名稱、診斷工具、治療適應症與禁忌；臨床上則需同步處理立即威脅，不能為了等待完整檢查而延誤救命措施。/gu, "先辨識「$1」的急診風險，再依病人穩定度安排處置。")
    .replace(/因此，本題作答時應抓住「(.+?)」。若實際在急診處理，則必須依病人穩定度、時間敏感性與可逆病因同步推進，而不是只背官方選項。/gu, "本題關鍵：$1")
    .replace(/套回本題，最重要的判斷軸是「(.+?)」。官方答案須依試卷原樣保存；若此題列入人工複核，則代表答案成立需要額外條件，或題目在現行標準下可能不只有一種合理解讀。/gu, "本題關鍵：$1")
    .replace(/套回本題，應先抓住：「(.+?)」官方答案仍依試卷原樣保存；若列入人工複核，代表答案成立需要額外條件，或現行標準下存在更精確的處置方式。/gu, "本題關鍵：$1")
    .replace(/官方將此項列為答案。官方答案需附加條件或現行指引校正\s*現行判斷應回到：/gu, "考試答案。現行觀點：")
    .replace(/官方將此項列為答案。官方答案與現行原則一致\s*現行判斷應回到：/gu, "考試答案。重點：")
    .replace(/官方將此項列為答案，考古題作答應原樣保留；但本題已列人工複核。/gu, "考試答案。")
    .replace(/官方將此選項列為答案，考古題作答應原樣保留；但本題已列人工複核。/gu, "考試答案。")
    .replace(/此選項是官方答案，且仍是現行最接近的選項；但必須補上條件與年代校正。/gu, "考試答案；適用條件如下。")
    .replace(/官方答案需附加條件或現行指引校正/gu, "官方答案需附加適用條件；現行指引已有更新。")
    .replace(/官方正解重點為/gu, "考試重點為")
    .replace(/官方將此項列為正確或最佳答案。/gu, "考試答案。")
    .replace(/此項不是本題官方最佳答案。題幹的主要判斷應回到：/gu, "不是最佳答案。")
    .replace(/不是本題官方最佳答案。此敘述的主要問題是：/gu, "不是最佳答案。問題在於：")
    .replace(/\s*現行應回到以下原則：/gu, " 現行觀點：")
    .replace(/此項不是官方最佳答案。判讀時需回到「(.+?)」，並避免(.+?)。。/gu, "不是最佳答案。$1 需避免$2。")
    .replace(/此項可能是部分處置或鑑別，但沒有抓住題目最關鍵的診斷／治療優先順序。/gu, "不是最佳答案。")
    .replace(/此項在特定條件下可能有角色，但不是官方最佳答案，且題幹不足以把它列為普遍首選。/gu, "不是最佳答案。")
    .replace(/；考古題選([A-E])/gu, "；考試答案為 $1")
    .replace(/考古題選([A-E])/gu, "考試答案為 $1")
    .replace(/^### 答案核對$/gmu, "### 考試答案與現行觀點")
    .replace(/^### 官方答案核對$/gmu, "### 考試答案")
    .replace(/^### 現行臨床判定$/gmu, "### 現行臨床觀點")
    .replace(/^### 年代與指引校正$/gmu, "### 現行指引差異")
    .replace(/官方答案核對/gu, "考試答案說明")
    .replace(/現行判定/gu, "現行臨床觀點")
    .replace(/答案狀態/gu, "考試答案")
    .replace(/年代辨識/gu, "現行差異")
    .replace(/^本題已列入人工複核清單。這不代表詳解未完成，而是表示官方答案、題幹用語或當年教材與現行標準之間存在需要保留的差異；使用時應同時閱讀官方答案與現行臨床判定。$/gmu, "")
    .replace(/^本題已列入人工複核。最常見錯誤是為了配合官方答案而忽略同題其他過時或過度絕對的選項；詳解已把官方答案與現行判定分開。$/gmu, "")
    .replace(/^本題已列入人工複核清單。$/gmu, "")
    .replace(/^本題已列入人工複核。$/gmu, "")
    .replace(/這不代表詳解未完成，而是表示官方答案、題幹用語或當年教材與現行標準之間存在需要保留的差異；使用時應同時閱讀官方答案與現行臨床觀點。/gu, "")
    .replace(/最常見錯誤是為了配合官方答案而忽略同題其他過時或過度絕對的選項；詳解已把官方答案與現行臨床觀點分開。/gu, "")
    .replace(/^題目有混合線索，需人工複核。$/gmu, "")
    .replace(/官方 C 保留，但標記需人工複核。/gu, "考試答案為 C。")
    .replace(/保留官方 ([A-E]) 作為歷史答案。專案標記需人工複核，日後若製作現行法規題庫應另建最新版條文映射。/gu, "考試答案為 $1；現行法規應另依最新版條文判定。")
    .replace(/本題不是指引更新問題，而是命題語意問題；詳解將其列入人工複核。/gu, "本題的歧義來自命題語意，而非指引更新。")
    .replace(/列為重大疑義與人工複核。/gu, "存在重大疑義。")
    .replace(/(?:，?故|，)列入人工複核。/gu, "。")
    .replace(/解題時先辨識題目是在考診斷、立即處置、禁忌、風險分層或歷史規範，再依生命徵象、器官威脅、時間窗與可逆原因決定處置順序。/gu, "")
    .replace(/考古題作答必須保留當年官方答案；若現行醫學、法規或可用資源已改變，應以今日指引與病人即時生理狀態作臨床決策，不能直接把舊題選項當成處方。/gu, "")
    .replace(/考古題作答需保留當年官方答案；若現行指引、法規或可用資源已改變，今日臨床應以病人即時生理、最新指引與院內流程決策。/gu, "")
    .replace(/因此準備考古題時要同時保留「當年應試答案」與「今日臨床答案」，兩者不一致時以現行安全照護為準。/gu, "")
    .replace(/對於考古題中的固定數值、絕對用語或舊式流程，應保留官方答案供應試追溯，但臨床採用時須重新核對最新指引與院內資源。/gu, "")
    .replace(/本題須將病史、生命徵象、理學檢查與檢驗／影像整合，避免以單一數值或經典徵象作絕對排除。/gu, "")
    .replace(/本題的判斷應將「當年考試預期答案」與「今日急診決策」分開。/gu, "")
    .replace(/本題涉及需更新的觀念或答案條件，已分開保存官方答案與現行臨床觀點。/gu, "")
    .replace(/本題涉及可能隨指引或法規更新的數值與流程，官方答案保留供考古追溯；臨床應依最新版資料。/gu, "")
    .replace(/^本題核心(?:原則|觀念)(?:目前)?仍可使用；[^\n]*$/gmu, "")
    .replace(/年代校正方面，/gu, "")
    .replace(/^- \*\*現行差異：\*\* 核心未變。$/gmu, "")
    .replace(/官方答案仍依試卷原樣保存；若列入人工複核，代表答案成立需要額外條件，或現行標準下存在更精確的處置方式。/gu, "")
    .replace(/官方答案須依試卷原樣保存；若此題列入人工複核，則代表答案成立需要額外條件，或題目在現行標準下可能不只有一種合理解讀。/gu, "")
    .replace(/臨床上仍須依病人嚴重度與完整情境判斷。/gu, "")
    .replace(/本題在真實急診中仍須於處置後重新評估生命徵象、症狀、檢驗或影像變化。/gu, "")
    .replace(/本題若出現在真實急診，需將官方答案轉化為可執行的優先順序，並在處置後重新評估生命徵象、症狀、檢驗或影像變化。/gu, "")
    .replace(/另要承認 B 是合理檢查，使本題需標記複核。/gu, "B 也是合理檢查，因此並非完美單選題。")
    .replace(/官方 C 保留，但現行詳解明確指出 B 亦合理。/gu, "考試答案為 C；現行臨床上 B 亦屬合理檢查。")
    .replace(/依現行急診原則，仍須結合病人的生命徵象、病程時間、禁忌症與可逆原因，不能脫離題幹條件單獨套用。/gu, "")
    .replace(/即使官方答案在出題年代可以成立，也不能把單一數字、單一影像徵象或單一藥名當成完整處置；必須把病人的穩定度、禁忌與後續 definitive treatment 一併納入。/gu, "")
    .replace(/完成初步處置後仍應重新評估生命徵象、意識、尿量、疼痛、氧合與治療反應，並決定是否需要 ICU、手術、介入、轉院或專科共同照護。/gu, "")
    .replace(/作答時先從題幹找出時間軸、生命徵象、器官低灌流、神經或氣道紅旗，再判斷哪一個選項真正改變當下處置。/gu, "")
    .replace(/檢查、治療及專科會診應依病人穩定度與時間窗平行推進，不能只背單一藥物、數字或影像名稱。/gu, "")
    .replace(/處置應回到病人的穩定度、時間窗、可逆原因與是否需要立即專科介入，並於每一個步驟後重新評估。/gu, "")
    .replace(/急診處置應先辨識立即生命威脅，再依穩定度、時間窗、禁忌與可取得資源安排檢查、治療及追蹤。/gu, "")
    .replace(/急診處置應先辨識立即生命威脅，整合病史、身體檢查、床邊檢驗與影像，並在每一步治療後重新評估，而非只依單一選項或數值。/gu, "")
    .replace(/常見錯誤是只記住官方選項，卻忽略題目中的適用條件、病人生理狀態或年代差異。/gu, "")
    .replace(/作答時不能只抓一個關鍵字；臨床上更需同步評估生命徵象、器官灌流、特殊族群、時間窗與可能迅速惡化的併發症。/gu, "")
    .replace(/最常見的錯誤是忽略題目問的是「最適當、較不適當、正確或錯誤」，或把當年教材中的固定門檻直接套入今日臨床。/gu, "")
    .replace(/題幹中的病史、生命徵象、時間軸與檢查結果，應先被轉換成病人的立即風險，再決定檢查與治療順序。/gu, "")
    .replace(/^- 遇到「較適當／較不適當」題，需先確認題目極性，再比較處置優先順序與成立條件。$/gmu, "")
    .replace(/檢查與治療應依病人穩定度、時間窗及可逆病因平行推進，而不是只記住單一藥物或單一數值。/gu, "")
    .replace(/本題最常見陷阱是選到部分正確但沒有處理核心病理或處置優先順序的選項。/gu, "")
    .replace(/最常見陷阱是忽略題幹的決策層級，只以單一檢驗或關鍵字作答。/gu, "")
    .replace(/最常見錯誤是只背官方答案字母，沒有把題幹中的時間、穩定度與危險徵象轉換成臨床決策。/gu, "")
    .replace(/最常見陷阱是只背官方答案字母，沒有辨識題目的年代、用語或複數合理答案。/gu, "")
    .replace(/本題最常見陷阱是看見單一關鍵字便作答，忽略題幹問的是不適當選項。/gu, "")
    .replace(/- 本題官方答案：([A-E])；先確認題目問的是「較適當」或「較不適當」。/gu, "- 考試答案：$1。")
    .replace(/判讀時需回到「先辨識「(.+?)」的關鍵線索，再依穩定度與時間敏感性選出最能直接改變處置的選項。」，並避免[^。]+。/gu, "先辨識「$1」的關鍵線索與處置優先順序。")
    .replace(/^### [^\n]+\n\n(?=## )/gmu, "")
    .replace(/[^。\n]*人工複核[^。\n]*。?/gu, "")
    .replace(/常見失分方式是忽略題目中的時間軸、穩定度或特殊族群，只憑單一關鍵字作答。本題尤其要避免把「([^」]+)」的舊式口訣當成沒有例外的規則。/gu, "「$1」需依題幹條件判讀，不能只套用單一口訣。")
    .replace(/常見陷阱是只抓住題幹中的單一關鍵字，忽略時間軸、生命徵象、特殊族群與題目問的是「正確、錯誤、最適當或最不適當」。/gu, "先確認題目極性、時間軸與成立條件。")
    .replace(/最常見的失分方式是只抓住選項中的單一關鍵字，卻忽略題幹的穩定度、時間窗、禁忌、族群差異或題目問的是正向還是反向。/gu, "先確認題目極性、穩定度、時間窗與禁忌。")
    .replace(/最常見的錯誤是忽略題目問的是正確、錯誤、較適當或較不適當，或只抓單一關鍵字而沒有把生命徵象與處置優先順序放回情境。/gu, "先確認題目極性與處置優先順序。")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function sanitizeSection(markdown) {
  const metadataLine = /^\s*(?:[-*>]\s*)?\**(?:題目\s*ID|官方來源|PDF\s*頁碼|官方題本\s*(?:URL|SHA-256)|原始題庫\s*exam_id|來源\s*PDF|source_(?:page|pdf|sha256)|批次|最後更新|版本資訊|版本紀錄)\**\s*[：:]/iu;
  return stripEditorialBoilerplate(stripPipelineProvenance(stripImageBlocks(markdown)))
    .split("\n")
    .filter((line) => !metadataLine.test(line))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function firstSection(sections, names) {
  for (const name of names) {
    const content = sanitizeSection(sections.get(name) ?? "");
    if (content) return content;
  }
  return "";
}

function combineSubsections(entries) {
  return entries
    .map(([heading, content]) => [heading, sanitizeSection(content)])
    .filter(([, content]) => content)
    .map(([heading, content]) => `### ${heading}\n\n${content}`)
    .join("\n\n");
}

function normalizeExplanation(markdown) {
  const { attributes, body } = parseFrontmatter(markdown);
  const sections = splitLevelTwoSections(body);
  const answerReview = firstSection(sections, ["答案判定"])
    || combineSubsections([
      ["考試答案", sections.get("官方答案核對") ?? ""],
      ["現行臨床觀點", sections.get("現行臨床判定") ?? ""],
    ])
    || (attributes.answer_status ? sanitizeSection(String(attributes.answer_status)) : "");
  const coreLogic = firstSection(sections, ["核心作答邏輯"]);
  const core = [
    answerReview ? `### 考試答案與現行觀點\n\n${answerReview}` : "",
    coreLogic ? `### 作答關鍵\n\n${coreLogic}` : "",
  ].filter(Boolean).join("\n\n");
  const examPath = firstSection(sections, ["詳細解析", "完整詳解"]);
  const options = firstSection(sections, ["各選項解析", "選項逐一解析"]);
  const knowledge = firstSection(sections, ["應試考點", "必背考點"]);
  const traps = firstSection(sections, ["常見陷阱"]);
  const extension = combineSubsections([
    ["急診實務補充", sections.get("急診臨床補充") ?? sections.get("急診實務補充") ?? ""],
    ["現行指引差異", sections.get("時代／指引校正") ?? sections.get("年代／指引校正") ?? ""],
  ]);
  const references = firstSection(sections, ["參考資料"]);
  const canonical = new Map([
    ["核心理由", core],
    ["考場解題路徑", examPath],
    ["選項分析", options],
    ["核心知識整理", knowledge],
    ["常見陷阱與變形", traps],
    ["延伸學習", extension],
    ["參考資料", references],
  ]);

  for (const heading of CANONICAL_SECTIONS) {
    assert.ok(canonical.get(heading), `缺少可匯入內容：${heading}`);
  }

  return stripEditorialBoilerplate(CANONICAL_SECTIONS
    .map((heading) => `## ${heading}\n\n${canonical.get(heading)}`)
    .join("\n\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim());
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}

function loadReviewIds(reviewIndexPath) {
  if (!reviewIndexPath || !fs.existsSync(reviewIndexPath)) return new Set();
  const rows = parseCsv(fs.readFileSync(reviewIndexPath, "utf8"));
  assert.ok(rows.length > 1, "人工複核索引沒有資料");
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/u, "").trim());
  const idIndex = headers.indexOf("question_id");
  assert.notEqual(idIndex, -1, "人工複核索引缺少 question_id 欄位");
  return new Set(rows.slice(1).map((row) => row[idIndex]?.trim()).filter(Boolean));
}

function sourceDescriptor(filePath) {
  const name = path.basename(filePath);
  const match = name.match(/^ROC(\d{3})(?:-([AB]))?-Q(\d{3})\.md$/u);
  assert.ok(match, `無法辨識題目檔名：${name}`);
  const [, year, paper, questionNumber] = match;
  const sourceId = `ROC${year}${paper ? `-${paper}` : ""}-Q${questionNumber}`;
  if (year === "113" && paper === "B") return { sourceId, skipped: true };
  const exam = year === "113" && paper === "A" ? "113" : `${year}${paper ?? ""}`;
  return { sourceId, skipped: false, exam, targetId: `${exam}-Q${questionNumber}` };
}

function frontmatterReviewFlag(markdown) {
  const { attributes } = parseFrontmatter(markdown);
  return /^(?:true|yes|1)$/iu.test(String(attributes.needs_human_review ?? ""));
}

function ensureOutputDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) fs.unlinkSync(path.join(directory, entry.name));
  }
}

const args = parseArgs(process.argv.slice(2));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDirectory = path.resolve(args.source ?? "");
if (!args.source) throw new Error("請使用 --source 指定解壓後的 questions 目錄");
assert.ok(fs.existsSync(sourceDirectory), `找不到來源目錄：${sourceDirectory}`);

const outputRoot = path.resolve(args.output ?? path.join(projectRoot, "public/data/explanation-packs"));
const baseIndexPath = path.resolve(args.index ?? path.join(projectRoot, "public/data/index.json"));
const autoReviewIndex = path.join(path.dirname(sourceDirectory), "indexes", "優先人工複核.csv");
const reviewIndexPath = path.resolve(args["review-index"] ?? autoReviewIndex);
const reviewIds = loadReviewIds(reviewIndexPath);
const baseIndex = JSON.parse(fs.readFileSync(baseIndexPath, "utf8"));
const baseQuestions = baseIndex.questions ?? [];
const expectedIds = new Set(baseQuestions.map((question) => question.id));
const expectedExams = [...new Set(baseQuestions.map((question) => question.exam))].sort();
const markdownFiles = readMarkdownFiles(sourceDirectory);
const chunks = new Map(expectedExams.map((exam) => [exam, new Map()]));
const stats = {
  sourceQuestions: markdownFiles.length,
  importedQuestions: 0,
  skippedParallelDuplicates: 0,
  duplicateTargetIds: 0,
  unexpectedTargetIds: 0,
  archiveReviewFlags: reviewIds.size,
  mappedReviewFlags: 0,
  frontmatterReviewFlags: 0,
};
const seen = new Set();

for (const filePath of markdownFiles) {
  const descriptor = sourceDescriptor(filePath);
  if (descriptor.skipped) {
    stats.skippedParallelDuplicates += 1;
    continue;
  }
  const markdown = fs.readFileSync(filePath, "utf8");
  const frontmatterFlag = frontmatterReviewFlag(markdown);
  if (frontmatterFlag) stats.frontmatterReviewFlags += 1;
  const needsReview = reviewIds.has(descriptor.sourceId) || frontmatterFlag;
  if (needsReview) stats.mappedReviewFlags += 1;

  if (!expectedIds.has(descriptor.targetId)) {
    stats.unexpectedTargetIds += 1;
    throw new Error(`來源題目找不到本站對應 ID：${descriptor.sourceId} → ${descriptor.targetId}`);
  }
  if (seen.has(descriptor.targetId)) {
    stats.duplicateTargetIds += 1;
    throw new Error(`來源題目重複映射：${descriptor.targetId}`);
  }
  seen.add(descriptor.targetId);
  const explanation = normalizeExplanation(markdown);
  chunks.get(descriptor.exam).set(descriptor.targetId, explanation);
  stats.importedQuestions += 1;
}

const missingTargetIds = [...expectedIds].filter((id) => !seen.has(id));
assert.equal(stats.sourceQuestions, 3520, "來源詳解題數應為 3,520 題");
assert.equal(stats.importedQuestions, expectedIds.size, "匯入題數必須與本站題數一致");
assert.equal(stats.skippedParallelDuplicates, 200, "應只略過 ROC113-B 的 200 題平行重複題");
assert.equal(stats.duplicateTargetIds, 0, "不得有重複目標 ID");
assert.equal(stats.unexpectedTargetIds, 0, "不得有未對應目標 ID");
assert.deepEqual(missingTargetIds, [], `仍有 ${missingTargetIds.length} 題缺少精要詳解`);

const conciseDirectory = path.join(outputRoot, PACK_ID);
ensureOutputDirectory(conciseDirectory);
const chunkManifest = [];
for (const exam of expectedExams) {
  const explanations = Object.fromEntries([...chunks.get(exam)].sort(([a], [b]) => a.localeCompare(b)));
  const chunk = {
    schemaVersion: SCHEMA_VERSION,
    packId: PACK_ID,
    exam,
    questionCount: Object.keys(explanations).length,
    explanations,
  };
  const filename = `${exam}.json`;
  fs.writeFileSync(path.join(conciseDirectory, filename), `${JSON.stringify(chunk)}\n`);
  chunkManifest.push({ exam, filename, questionCount: chunk.questionCount });
}

const manifest = {
  schemaVersion: SCHEMA_VERSION,
  defaultPackId: "original",
  totalQuestions: expectedIds.size,
  packs: [
    {
      id: "original",
      label: "深度詳解（預設）",
      questionCount: expectedIds.size,
      bundledWithQuestions: true,
    },
    {
      id: PACK_ID,
      label: "精要詳解",
      questionCount: stats.importedQuestions,
      chunkPattern: "/data/explanation-packs/concise/{exam}.json",
      chunks: chunkManifest,
    },
  ],
  validation: {
    ...stats,
    missingTargetIds: missingTargetIds.length,
    reviewIndexUsed: reviewIds.size > 0,
  },
};
fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  output: outputRoot,
  exams: expectedExams.length,
  ...manifest.validation,
}, null, 2));
