import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import {
  parseBoardTraceLocatorIndex,
  reconcileBoardTraceLocations,
  resolveBoardTraceHits,
} from "../app/lib/board-trace.ts";
import remarkBoardTrace from "../app/lib/remark-board-trace.ts";

test("board trace comments become stable paragraph metadata without visible nodes", () => {
  const tree = unified()
    .use(remarkParse)
    .use(remarkBoardTrace)
    .runSync(unified().use(remarkParse).parse("<!--board-trace:tp-example:3:7-->\n\n可追溯段落。"));

  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].type, "paragraph");
  assert.deepEqual(tree.children[0].data.hProperties, {
    id: "tp-example",
    "data-board-trace-node": "tp-example",
    "data-board-trace-direct": 3,
    "data-board-trace-related": 7,
  });
});

test("ordinary HTML and malformed trace comments never gain trace metadata", () => {
  const parser = unified().use(remarkParse).use(remarkBoardTrace);
  const tree = parser.runSync(parser.parse("<span>保留為一般 HTML AST</span>\n\n<!--board-trace:bad-->\n\n普通段落。"));
  assert.equal(tree.children.filter((node) => node.type === "html").length, 1);
  assert.equal(tree.children.at(-1).data, undefined);
});

test("compact canonical atoms resolve to one representative question and all A/B aliases", () => {
  const data = {
    schemaVersion: 1,
    unitCode: "9B1",
    questionRefs: {
      "ROC114-P103": ["114A-Q003", "114B-Q003"],
      "ROC115-P167": "115B-Q067",
    },
    paragraphs: {},
    sentences: {},
  };

  assert.deepEqual(resolveBoardTraceHits(data, ["ROC114-P103-OPT-C", "ROC115-P167", "invalid"]), [
    {
      canonicalAtomId: "ROC114-P103-OPT-C",
      canonicalQuestionId: "ROC114-P103",
      questionId: "114A-Q003",
      aliases: ["114A-Q003", "114B-Q003"],
      optionKey: "C",
    },
    {
      canonicalAtomId: "ROC115-P167",
      canonicalQuestionId: "ROC115-P167",
      questionId: "115B-Q067",
      aliases: ["115B-Q067"],
      optionKey: null,
    },
  ]);
});

test("same-paragraph sentence and paragraph routes collapse to one precise destination", () => {
  const locations = [
    {
      unitCode: "1A",
      paragraphId: "tp-aed-placement",
      nodeId: "ts-aed-exact",
      relation: "primary",
      sectionId: "sec-aed",
    },
    {
      unitCode: "1A",
      paragraphId: "tp-aed-placement",
      nodeId: "tp-aed-placement",
      relation: "related",
      sectionId: "sec-aed",
    },
    {
      unitCode: "1A",
      paragraphId: "tp-aed-timing",
      nodeId: "tp-aed-timing",
      relation: "related",
      sectionId: "sec-aed",
    },
  ];

  assert.deepEqual(reconcileBoardTraceLocations(locations), [locations[0], locations[2]]);
});

test("human locator ignores the preface and numbers visible H3 sections, paragraphs, and sentences", () => {
  const markdown = `## 單元標題

這是單元導言，不應讓第一個正文大標變成第二節。

### 一、第一個正文大標

這是本節第一段。

<!--board-trace:tp-first:1:0-->

這是本節第二段。

### 二、第二個正文大標

<!--board-trace:tp-second:0:1-->

這是第二節第一段。`;
  const data = {
    schemaVersion: 1,
    unitCode: "1A",
    questionRefs: {},
    paragraphs: {
      "tp-first": { direct: [], related: [] },
      "tp-second": { direct: [], related: [] },
    },
    sentences: {
      "ts-first-a": { paragraphId: "tp-first", exact: "第一句" },
      "ts-first-b": { paragraphId: "tp-first", exact: "第二句" },
    },
  };

  const index = parseBoardTraceLocatorIndex(markdown, data);

  assert.deepEqual(index.get("tp-first"), {
    heading: "一、第一個正文大標",
    paragraphOrdinal: 2,
    sectionOrdinal: 1,
    sentenceOrdinals: {
      "ts-first-a": 1,
      "ts-first-b": 2,
    },
  });
  assert.deepEqual(index.get("tp-second"), {
    heading: "二、第二個正文大標",
    paragraphOrdinal: 1,
    sectionOrdinal: 2,
    sentenceOrdinals: {},
  });
  assert.equal(index.get("tp-first").heading.includes("sec-"), false);
  assert.equal(index.get("tp-first").heading.includes("tp-"), false);
  assert.equal(index.get("tp-first").heading.includes("ts-"), false);
});
