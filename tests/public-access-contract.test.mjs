import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readLegacyCss } from "./css-test-utils.mjs";

test("anonymous visitors keep core study data in their own browser", async () => {
  const [progress, guide, annotations, boardPrep, recognized] = await Promise.all([
    readFile(new URL("../app/hooks/use-progress.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-guide-progress.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-annotations.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-board-prep.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-recognized-course-progress.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [progress, guide, annotations, boardPrep]) {
    assert.match(source, /LOCAL_ACCOUNT_KEY = "anonymous-device"/u);
  }
  assert.match(annotations, /identityResponse\.status === 401\) \{ await activateLocalState\(\); return; \}/u);
  assert.match(annotations, /accountKey === LOCAL_ACCOUNT_KEY/u);
  assert.match(boardPrep, /window\.localStorage\.setItem\(`\$\{LEGACY_KEY_PREFIX\}\$\{LOCAL_ACCOUNT_KEY\}`/u);
  assert.match(boardPrep, /accountKey === LOCAL_ACCOUNT_KEY/u);
  assert.match(recognized, /LOCAL_ACCOUNT_KEY = "anonymous-device"/u);
  assert.match(recognized, /writeLocal\(accountKey, next\)/u);
});

test("anonymous board-prep screens do not expose server-only evidence controls", async () => {
  const [view, recognized, boardPrep] = await Promise.all([
    readFile(new URL("../app/views/board-prep-view.impl.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/recognized-courses-area.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/use-board-prep.ts", import.meta.url), "utf8"),
  ]);
  assert.match(view, /attachmentsEnabled=\{attachmentReady\}/u);
  assert.match(recognized, /\{props\.attachmentsEnabled && <section className="recognized-files"/u);
  assert.match(boardPrep, /!accountKey \|\| accountKey === LOCAL_ACCOUNT_KEY/u);
});

test("public-mode copy keeps storage mechanics out of the reset flow", async () => {
  const [dialog, css, app] = await Promise.all([
    readFile(new URL("../app/components/learning-data-dialog.tsx", import.meta.url), "utf8"),
    readLegacyCss(),
    readFile(new URL("../app/question-bank-app.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(dialog, /此瀏覽器|已同步|尚未同步/u);
  assert.match(dialog, /清除後無法復原，所選紀錄會一併移除/u);
  assert.match(dialog, /disabled=\{busy \|\| !types\.length \|\| syncStatus === "loading"\}/u);
  assert.match(dialog, /<legend className="sr-only">選擇要清除的紀錄<\/legend>/u);
  assert.match(dialog, /<div className="learning-reset-heading">/u);
  assert.doesNotMatch(css, /\.learning-select-all\s*\{[^}]*position:\s*absolute/su);
  assert.match(css, /\.learning-reset-choices \.learning-select-all\s*\{[^}]*min-height:\s*44px/su);
  assert.match(css, /\.learning-reset-heading\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/su);
  assert.match(app, /急專補給站/u);
});

test("handoff keeps public access and note extraction decisions explicit", async () => {
  const handoff = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
  assert.match(handoff, /正式站預設為「持連結即可使用」的公開網站/u);
  assert.match(handoff, /匿名資料不得寫入共用伺服器帳號/u);
  assert.match(handoff, /目前公開站沒有可選式登入客戶端/u);
  assert.match(handoff, /把詳解或學習指引中的主標題、標題、次標題、次次標題或表格加入筆記使用 `excerpt`/u);
});
