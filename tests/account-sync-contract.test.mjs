import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { identityFromRequest } from "../app/api/user-identity.ts";

test("authenticated identity uses the stable Site user id and treats email as metadata", async () => {
  const first = await identityFromRequest(new Request("https://example.test", { headers: {
    "oai-authenticated-user-id": "site-user-1",
    "oai-authenticated-user-email": "  Jerry@Example.com ",
  } }));
  const changedEmail = await identityFromRequest(new Request("https://example.test", { headers: {
    "oai-authenticated-user-id": "site-user-1",
    "oai-authenticated-user-email": "new-address@example.com",
  } }));
  const other = await identityFromRequest(new Request("https://example.test", { headers: {
    "oai-authenticated-user-id": "site-user-2",
    "oai-authenticated-user-email": "jerry@example.com",
  } }));
  assert.equal(first?.userId, "site-user-1");
  assert.equal(first?.accountKey, changedEmail?.accountKey, "email changes must not rotate the account namespace");
  assert.notEqual(first?.legacyAccountKey, changedEmail?.legacyAccountKey, "the old email hash is migration metadata only");
  assert.notEqual(first?.accountKey, other?.accountKey);
  assert.equal(await identityFromRequest(new Request("https://example.test", { headers: {
    "oai-authenticated-user-email": "jerry@example.com",
  } })), null, "email alone must never authenticate a persistent account");
  assert.equal(await identityFromRequest(new Request("https://example.test")), null);
});

test("local progress and annotation stores are account-scoped", async () => {
  const progress = await readFile(new URL("../app/hooks/use-progress.ts", import.meta.url), "utf8");
  const annotations = await readFile(new URL("../app/hooks/use-annotations.ts", import.meta.url), "utf8");
  assert.match(progress, /CACHE_KEY_PREFIX = "em-board-progress-cache-v2:"/);
  assert.match(progress, /OUTBOX_KEY_PREFIX = "em-board-progress-outbox-v2:"/);
  assert.match(progress, /LOCAL_ACCOUNT_KEY = "anonymous-device"/, "未登入時仍應有獨立的裝置端儲存範圍");
  assert.match(progress, /response\.status === 401/, "API 的 localOnly 回應必須切換到本機模式");
  assert.match(progress, /migrateLocalOutbox\(accountKey, remote\.resetGeneration\)/, "登入後應搬移匿名 outbox");
  assert.match(progress, /generation: resetGeneration/, "匿名異動搬入帳號時必須採用帳號目前的重置世代");
  assert.match(progress, /writeOutbox\(LOCAL_ACCOUNT_KEY, \[\]\)/, "只有寫入帳號 outbox 後才能清除匿名來源");
  assert.doesNotMatch(progress, /throw new Error\("學習紀錄尚未完成帳號驗證"\)/, "匿名操作不應因帳號尚未驗證而拒絕");
  assert.match(annotations, /DB_NAME_PREFIX = "em-board-annotations-v2-"/);
  assert.match(annotations, /migrateStoredAnnotations\(LOCAL_ACCOUNT_KEY, accountKey, initialRemote\)/, "登入後必須搬移匿名 IndexedDB 筆記");
  assert.match(annotations, /migrateStoredAnnotations\(session\.legacyAccountKey, accountKey, initialRemote\)/, "穩定身分上線後必須搬移舊 email-hash 帳號筆記");
  assert.match(annotations, /db\.transaction\(\[ANNOTATIONS, OUTBOX\], "readwrite"\)/, "搬移筆記與 outbox 必須在同一個目標交易中耐久化");
  assert.match(annotations, /await putMigrationBatch[\s\S]{0,200}await deleteSourceSnapshots/u, "只有目標交易成功後才能刪除來源資料");
  assert.match(annotations, /annotationMigrationSnapshot\(current\) === snapshot/u, "同步期間更新的匿名筆記不得被清除");
  assert.match(annotations, /local\.syncState !== "conflict"/, "遠端同步不得覆蓋已標記衝突的本機筆記");
  assert.match(annotations, /item\.syncState === "conflict"/, "衝突狀態不得被誤報為同步完成");
  assert.match(annotations, /revision: remote\?\.revision \?\? 0/, "衝突後必須精確採用遠端版號作為下一次儲存基準");
  assert.match(annotations, /left\.baseRevision - right\.baseRevision/, "同一筆筆記的離線異動必須依版號送出");
  assert.match(annotations, /pending\.some\(\(entry\) => entry\.mutationId === mutationId\)/, "同步期間新寫入的異動必須再次送出");
  assert.match(annotations, /remote\.revision >= local\.revision/, "較舊的伺服器回應不得覆蓋較新的本機草稿");
  assert.doesNotMatch(progress, /"local-preview-user"/);
});

test("resets are atomic and stale offline writes cannot recreate cleared progress", async () => {
  const route = await readFile(new URL("../app/api/progress/route.ts", import.meta.url), "utf8");
  assert.match(route, /body\.generation \?\? 0/);
  assert.match(route, /resetGeneration/);
  assert.match(route, /await db\.batch/);
  assert.match(route, /lastMutationId === body\.mutationId/);
  assert.doesNotMatch(route, /studyAnnotation|annotationMutation/);
});
