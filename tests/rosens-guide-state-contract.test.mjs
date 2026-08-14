import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  boardGuideAnnotationResourceId,
  boardGuideAnnotationScopePrefix,
  emsGuideAnnotationResourceId,
  emsGuideAnnotationScopePrefix,
  guideResourceAnnotationId,
  guideSupplementalAnnotationScopePrefix,
  parseAnyGuideAnnotationResourceId,
  parseEmsGuideAnnotationScope,
  parseGuideAnnotationResourceId,
  parseRosensGuideAnnotationResourceId,
  parseRosensGuideAnnotationScope,
  rosensGuideAnnotationResourceId,
  rosensGuideAnnotationScopePrefix,
} from "../app/lib/annotation-source.ts";

const [hook, api, annotationsApi, schema, migration, annotationTools] = await Promise.all([
  readFile(new URL("../app/hooks/use-guide-resource-progress.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/guide-resource-progress/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/annotations/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0006_bouncy_red_wolf.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/components/content-annotation-tools.tsx", import.meta.url), "utf8"),
]);

test("guide annotation resources discriminate textbook and resource kind", () => {
  assert.equal(rosensGuideAnnotationResourceId(1), "guide-rosens-001");
  assert.equal(rosensGuideAnnotationResourceId("e1"), "guide-rosens-e01");
  assert.equal(rosensGuideAnnotationResourceId("119b"), null);
  assert.equal(parseRosensGuideAnnotationResourceId("guide-rosens-119b"), null);
  assert.deepEqual(parseRosensGuideAnnotationResourceId("guide-rosens-e16"), {
    kind: "guide",
    textbook: "rosens",
    resourceKind: "chapter",
    chapterId: "e16",
    resourceId: "guide-rosens-e16",
  });
  assert.equal(parseGuideAnnotationResourceId("guide-rosens-001"), null, "legacy Tintinalli parser stays chapter-specific");
  assert.equal(parseAnyGuideAnnotationResourceId("guide-tintinalli-overview")?.resourceKind, "overview");
  assert.deepEqual(parseAnyGuideAnnotationResourceId("guide-tintinalli-section-03"), {
    kind: "guide",
    textbook: "tintinalli",
    resourceKind: "section",
    sectionId: "03",
    resourceId: "guide-tintinalli-section-03",
  });
  assert.equal(parseAnyGuideAnnotationResourceId("guide-tintinalli-section-27"), null);
  assert.equal(parseAnyGuideAnnotationResourceId("guide-rosens-overview")?.resourceKind, "overview");
  assert.deepEqual(parseAnyGuideAnnotationResourceId("guide-rosens-section-03-10"), {
    kind: "guide",
    textbook: "rosens",
    resourceKind: "section",
    sectionId: "03-10",
    resourceId: "guide-rosens-section-03-10",
  });
  assert.equal(parseAnyGuideAnnotationResourceId("guide-rosens-section-05-09"), null);
  assert.equal(guideResourceAnnotationId("guide-rosens-overview"), "q_guide-rosens-overview");
  assert.equal(guideResourceAnnotationId("guide-rosens-section-03-10"), "q_guide-rosens-section-03-10");
  assert.equal(guideSupplementalAnnotationScopePrefix("guide-rosens-section-03-10", "full"), "h_grs03-10_full_");
  assert.equal(boardGuideAnnotationResourceId("1a"), "guide-board-1A");
  assert.deepEqual(parseAnyGuideAnnotationResourceId("guide-board-1A"), {
    kind: "guide",
    textbook: "board",
    resourceKind: "unit",
    unitCode: "1A",
    resourceId: "guide-board-1A",
  });
  assert.equal(boardGuideAnnotationScopePrefix("guide-board-1A", "full"), "h_gb1a_full_");
  assert.equal(guideResourceAnnotationId("guide-board-1A"), "q_guide-board-1A");
  assert.equal(boardGuideAnnotationResourceId("9b1"), "guide-board-9B1");
  assert.equal(parseAnyGuideAnnotationResourceId("guide-board-9B2")?.unitCode, "9B2");
  assert.equal(emsGuideAnnotationResourceId(1), "guide-ems-001");
  assert.equal(emsGuideAnnotationResourceId("24"), "guide-ems-024");
  assert.equal(emsGuideAnnotationResourceId(25), null);
  assert.deepEqual(parseAnyGuideAnnotationResourceId("guide-ems-007"), {
    kind: "guide",
    textbook: "ems",
    resourceKind: "chapter",
    chapter: 7,
    chapterId: "007",
    resourceId: "guide-ems-007",
  });
  assert.equal(parseAnyGuideAnnotationResourceId("guide-ems-025"), null);
  assert.equal(emsGuideAnnotationScopePrefix("guide-ems-007", "full"), "h_ge007_full_");
});

test("Rosen's highlight ids restore their chapter and reading depth", () => {
  const prefix = rosensGuideAnnotationScopePrefix("guide-rosens-e01", "detailed-full");
  assert.equal(prefix, "h_gre01_detailed-full_");
  assert.deepEqual(parseRosensGuideAnnotationScope(`${prefix}note`), {
    kind: "guide",
    textbook: "rosens",
    chapterId: "e01",
    packId: "detailed",
    mode: "full",
  });
  assert.equal(parseRosensGuideAnnotationScope("h_gr119b_detailed-full_note"), null);
});

test("EMS highlight ids restore their chapter and reading depth", () => {
  const prefix = emsGuideAnnotationScopePrefix("guide-ems-007", "standard");
  assert.equal(prefix, "h_ge007_standard_");
  assert.deepEqual(parseEmsGuideAnnotationScope(`${prefix}note`), {
    kind: "guide",
    textbook: "ems",
    chapterId: "007",
    mode: "standard",
  });
  assert.equal(parseEmsGuideAnnotationScope("h_ge025_full_note"), null);
});

test("namespaced progress storage preserves the legacy numeric Tintinalli table", () => {
  assert.match(schema, /export const guideProgress = sqliteTable\(/u);
  assert.match(schema, /export const guideResourceProgress = sqliteTable\([\s\S]*?"guide_resource_progress"/u);
  assert.match(schema, /primaryKey\(\{ columns: \[table\.userId, table\.resourceId\] \}\)/u);
  assert.match(migration, /CREATE TABLE `guide_resource_progress`/u);
  assert.match(migration, /PRIMARY KEY\(`user_id`, `resource_id`\)/u);
  assert.match(api, /parseAnyGuideAnnotationResourceId\(input\.resourceId\)/u);
  assert.match(api, /target: \[guideResourceProgress\.userId, guideResourceProgress\.resourceId\]/u);
  assert.match(hook, /em-board-guide-resource-progress-cache-v1:/u);
  assert.match(hook, /em-board-guide-resource-progress-outbox-v1:/u);
  assert.match(hook, /new Map\(records\.map\(\(record\) => \[record\.resourceId, record\]\)\)/u);
  assert.match(hook, /openResource/u);
  assert.match(hook, /markResource/u);
  assert.match(hook, /bookmarkResource/u);
});

test("the shared annotation API and note drawer accept all guide resource ids", () => {
  assert.match(annotationsApi, /parseAnyGuideAnnotationResourceId\(value\)/u);
  assert.match(annotationsApi, /annotationBodyLimit\(value\.questionId, value\.kind\)/u);
  assert.match(annotationTools, /guideLegacyAnnotationId\(source\.resourceId\) \?\? guideResourceAnnotationId\(source\.resourceId\)/u);
});
