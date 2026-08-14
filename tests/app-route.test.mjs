import assert from "node:assert/strict";
import test from "node:test";
import {
  ailsGuideHash,
  boardGuideHash,
  emsGuideHash,
  goldfrankGuideHash,
  guideHash,
  learningDocumentHash,
  normalizePrepRouteId,
  parseAppHash,
  prepHash,
  readerHash,
  readerTraceHash,
  textbookGuideHash,
} from "../app/lib/app-route.ts";

test("round-trips the learning-document library and selected files", () => {
  assert.equal(learningDocumentHash(), "#documents");
  assert.equal(learningDocumentHash("emergency-clinical-decision-atlas"), "#documents/emergency-clinical-decision-atlas");
  assert.deepEqual(parseAppHash("#documents/emergency-clinical-decision-atlas"), {
    view: "學習文件",
    resourceId: "emergency-clinical-decision-atlas",
    annotationId: null,
  });
  assert.deepEqual(parseAppHash("#documents/../reader"), {
    view: "學習文件",
    resourceId: null,
    annotationId: null,
  });
});

test("round-trips guide and question deep links", () => {
  assert.deepEqual(parseAppHash("#guides/057"), { view: "學習指引", resourceId: "57", annotationId: null });
  assert.equal(guideHash(57), "#guides/tintinalli/057");
  assert.equal(guideHash(57, "h_g_cf_note-1"), "#guides/tintinalli/057/annotation/h_g_cf_note-1");
  assert.deepEqual(parseAppHash("#guides/tintinalli/057/annotation/h_g_cf_note-1"), { view: "學習指引", resourceId: "57", annotationId: "h_g_cf_note-1", textbookId: "tintinalli" });
  assert.deepEqual(parseAppHash("#reader/112-q029"), { view: "詳解閱讀", resourceId: "112-Q029", annotationId: null });
  assert.equal(readerHash("112-q029"), "#reader/112-Q029");
  assert.equal(readerHash("112-Q029", "note-1"), "#reader/112-Q029/annotation/note-1");
});

test("round-trips bidirectional source-guide deep links", () => {
  const sourceHash = boardGuideHash("1a", "ts-example_1", "114B-Q003", "option-C");
  assert.equal(sourceHash, "#guides/board/1A/trace/ts-example_1/from/114B-Q003/option-C");
  assert.deepEqual(parseAppHash(sourceHash), {
    view: "學習指引",
    resourceId: "1A",
    annotationId: null,
    guideModuleId: "board",
    traceNodeId: "ts-example_1",
    traceQuestionId: "114B-Q003",
    traceTarget: "option-C",
  });
  assert.deepEqual(parseAppHash(boardGuideHash("2b", null, null, null, "h_gb2b_full_note")), {
    view: "學習指引",
    resourceId: "2B",
    annotationId: "h_gb2b_full_note",
    guideModuleId: "board",
  });
  assert.equal(boardGuideHash("9b1"), "#guides/board/9B1");
  assert.deepEqual(parseAppHash("#guides/board/9B2"), {
    view: "學習指引",
    resourceId: "9B2",
    annotationId: null,
    guideModuleId: "board",
  });
  assert.equal(readerTraceHash("114b-q003", "option-C"), "#reader/114B-Q003/trace/option-C");
  assert.deepEqual(parseAppHash(readerTraceHash("114b-q003", "option-C")), {
    view: "詳解閱讀",
    resourceId: "114B-Q003",
    annotationId: null,
    traceTarget: "option-C",
  });
  assert.deepEqual(parseAppHash("#guides/board/not-a-unit"), {
    view: "學習指引",
    resourceId: null,
    annotationId: null,
    guideModuleId: "board",
  });
});

test("routes the textbook library and Rosen's catalog without changing legacy Tintinalli links", () => {
  assert.deepEqual(parseAppHash("#guides"), { view: "學習指引", resourceId: null, annotationId: null });
  assert.equal(textbookGuideHash("tintinalli"), "#guides/tintinalli");
  assert.equal(textbookGuideHash("rosens"), "#guides/rosens");
  assert.deepEqual(parseAppHash(textbookGuideHash("tintinalli")), { view: "學習指引", resourceId: null, annotationId: null, textbookId: "tintinalli" });
  assert.deepEqual(parseAppHash(textbookGuideHash("rosens")), { view: "學習指引", resourceId: null, annotationId: null, textbookId: "rosens" });
  assert.deepEqual(parseAppHash("#guides/rosens/e16"), { view: "學習指引", resourceId: "e16", annotationId: null, textbookId: "rosens" });
  assert.deepEqual(parseAppHash("#guides/rosens/e1"), { view: "學習指引", resourceId: "e01", annotationId: null, textbookId: "rosens" });
  assert.deepEqual(parseAppHash("#guides/rosens/1"), { view: "學習指引", resourceId: "001", annotationId: null, textbookId: "rosens" });
  assert.equal(textbookGuideHash("rosens", 1), "#guides/rosens/001");
  assert.equal(textbookGuideHash("rosens", "e1"), "#guides/rosens/e01");
  assert.equal(textbookGuideHash("rosens", "119b"), "#guides/rosens/001");
  assert.equal(textbookGuideHash("tintinalli", 57), "#guides/tintinalli/057");
  assert.equal(textbookGuideHash("rosens", "overview"), "#guides/rosens/overview");
  assert.equal(textbookGuideHash("rosens", "section-03-10"), "#guides/rosens/section-03-10");
  assert.equal(textbookGuideHash("rosens", "section-03-10", "h_grs03-10_full_note"), "#guides/rosens/section-03-10/annotation/h_grs03-10_full_note");
  assert.equal(textbookGuideHash("tintinalli", "overview"), "#guides/tintinalli/overview");
  assert.equal(textbookGuideHash("tintinalli", "section-07"), "#guides/tintinalli/section-07");
  assert.deepEqual(parseAppHash("#guides/tintinalli/section-26"), { view: "學習指引", resourceId: "section-26", annotationId: null, textbookId: "tintinalli" });
  assert.deepEqual(parseAppHash("#guides/rosens/overview"), { view: "學習指引", resourceId: "overview", annotationId: null, textbookId: "rosens" });
  assert.deepEqual(parseAppHash("#guides/rosens/section-05-08"), { view: "學習指引", resourceId: "section-05-08", annotationId: null, textbookId: "rosens" });
  assert.deepEqual(parseAppHash("#guides/rosens/section-05-09"), { view: "學習指引", resourceId: null, annotationId: null, textbookId: "rosens" });
  assert.deepEqual(parseAppHash("#guides/rosens/119b"), { view: "學習指引", resourceId: null, annotationId: null, textbookId: "rosens" });
  assert.equal(textbookGuideHash("rosens", "e1", "h_gre01_detailed-full_note"), "#guides/rosens/e01/annotation/h_gre01_detailed-full_note");
  assert.deepEqual(parseAppHash("#guides/rosens/e01/annotation/h_gre01_detailed-full_note"), { view: "學習指引", resourceId: "e01", annotationId: "h_gre01_detailed-full_note", textbookId: "rosens" });
  assert.deepEqual(parseAppHash("#guides/rosens/119b"), { view: "學習指引", resourceId: null, annotationId: null, textbookId: "rosens" });
  assert.deepEqual(parseAppHash("#guides/rosens/193"), { view: "學習指引", resourceId: null, annotationId: null, textbookId: "rosens" });
  assert.deepEqual(parseAppHash("#guides/rosens/e17"), { view: "學習指引", resourceId: null, annotationId: null, textbookId: "rosens" });
});

test("keeps an invalid chapter link in the guide view without selecting a wrong chapter", () => {
  assert.deepEqual(parseAppHash("#guides/999"), { view: "學習指引", resourceId: null, annotationId: null });
});

test("routes the AILS module only inside the learning guide", () => {
  assert.equal(ailsGuideHash(), "#guides/ails/home");
  assert.equal(ailsGuideHash("qbank"), "#guides/ails/qbank");
  assert.equal(ailsGuideHash("answers"), "#guides/ails/answers");
  assert.equal(ailsGuideHash("master", "h_gamaster_full_note-1"), "#guides/ails/master/annotation/h_gamaster_full_note-1");
  assert.equal(ailsGuideHash("not-a-page"), "#guides/ails/home");
  assert.deepEqual(parseAppHash("#guides/ails/master"), {
    view: "學習指引",
    resourceId: "master",
    annotationId: null,
    guideModuleId: "ails",
  });
  assert.deepEqual(parseAppHash("#guides/ails/answers"), {
    view: "學習指引",
    resourceId: "answers",
    annotationId: null,
    guideModuleId: "ails",
  });
  assert.deepEqual(parseAppHash("#guides/ails/master/annotation/h_gamaster_full_note-1"), {
    view: "學習指引",
    resourceId: "master",
    annotationId: "h_gamaster_full_note-1",
    guideModuleId: "ails",
  });
  assert.deepEqual(parseAppHash("#guides/ails/not-a-page"), {
    view: "學習指引",
    resourceId: "home",
    annotationId: null,
    guideModuleId: "ails",
  });
});

test("round-trips EMS learning-guide chapters and notes", () => {
  assert.equal(emsGuideHash(), "#guides/ems/001");
  assert.equal(emsGuideHash(24), "#guides/ems/024");
  assert.equal(emsGuideHash("7", "h_ge007_full_note-1"), "#guides/ems/007/annotation/h_ge007_full_note-1");
  assert.equal(emsGuideHash(25), "#guides/ems/001");
  assert.deepEqual(parseAppHash("#guides/ems/024"), {
    view: "學習指引",
    resourceId: "024",
    annotationId: null,
    guideModuleId: "ems",
  });
  assert.deepEqual(parseAppHash("#guides/ems/007/annotation/h_ge007_full_note-1"), {
    view: "學習指引",
    resourceId: "007",
    annotationId: "h_ge007_full_note-1",
    guideModuleId: "ems",
  });
  assert.deepEqual(parseAppHash("#guides/ems/999"), {
    view: "學習指引",
    resourceId: "001",
    annotationId: null,
    guideModuleId: "ems",
  });
});

test("round-trips Goldfrank learning-guide chapters and notes", () => {
  assert.equal(goldfrankGuideHash(), "#guides/goldfrank/001");
  assert.equal(goldfrankGuideHash(140), "#guides/goldfrank/140");
  assert.equal(goldfrankGuideHash("7", "h_gg007_full_note-1"), "#guides/goldfrank/007/annotation/h_gg007_full_note-1");
  assert.equal(goldfrankGuideHash(141), "#guides/goldfrank/001");
  assert.deepEqual(parseAppHash("#guides/goldfrank/140"), {
    view: "學習指引",
    resourceId: "140",
    annotationId: null,
    guideModuleId: "goldfrank",
  });
  assert.deepEqual(parseAppHash("#guides/goldfrank/007/annotation/h_gg007_full_note-1"), {
    view: "學習指引",
    resourceId: "007",
    annotationId: "h_gg007_full_note-1",
    guideModuleId: "goldfrank",
  });
  assert.deepEqual(parseAppHash("#guides/goldfrank/999"), {
    view: "學習指引",
    resourceId: "001",
    annotationId: null,
    guideModuleId: "goldfrank",
  });
});

test("round-trips every controlled board-preparation deep route", () => {
  const prepRoutes = [
    "checklist",
    "recognized",
    "upcoming/society",
    "upcoming/remoc/north",
    "upcoming/remoc/central",
    "upcoming/remoc/south",
    "exam",
  ];

  assert.deepEqual(parseAppHash("#prep"), {
    view: "備考中心",
    resourceId: "checklist",
    annotationId: null,
  });

  for (const route of prepRoutes) {
    assert.equal(normalizePrepRouteId(route), route);
    assert.equal(prepHash(route), `#prep/${route}`);
    assert.deepEqual(parseAppHash(prepHash(route)), {
      view: "備考中心",
      resourceId: route,
      annotationId: null,
    });
  }
});

test("invalid board-preparation paths return to the checklist without leaking arbitrary route state", () => {
  assert.equal(normalizePrepRouteId(null), "checklist");
  assert.equal(normalizePrepRouteId("UPCOMING/REMOC/CENTRAL"), "upcoming/remoc/central");
  for (const hash of [
    "#prep/upcoming",
    "#prep/upcoming/remoc",
    "#prep/upcoming/remoc/east",
    "#prep/recognized/extra",
    "#prep/not-a-panel",
  ]) {
    assert.deepEqual(parseAppHash(hash), {
      view: "備考中心",
      resourceId: "checklist",
      annotationId: null,
    });
  }
});
