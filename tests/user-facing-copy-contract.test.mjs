import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [fullPath] : [];
  }));
  return nested.flat();
}

test("user-facing copy does not expose implementation language or defensive slogans", async () => {
  const roots = ["app/views", "app/components", "app/hooks", "app/api"].map((entry) => path.join(projectRoot, entry));
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const sources = await Promise.all(files.map(async (file) => ({ file, content: await readFile(file, "utf8") })));
  const forbidden = [
    /列出不等於訓練認定/u,
    /不會上傳(?:到)?伺服器/u,
    /僅存本機/u,
    /這台裝置/u,
    /此裝置/u,
    /本機內容/u,
    /離線保存/u,
    /目前離線/u,
    /背景同步/u,
    /背景接上/u,
    /保存在此瀏覽器/u,
    /只保存在/u,
    /已同步/u,
    /尚未同步/u,
    /儲存範圍/u,
    /不上傳.*雲端/u,
    /開發者用語/u,
    /備援快照/u,
    /課程快照/u,
    /公告快照/u,
    /來源暫時失敗/u,
    /回到原始資料確認/u,
    /正文已匯入/u,
    /正文待匯入/u,
    /依匯入狀態/u,
    /正文上傳後/u,
    /請提供有效的 JSON 資料/u,
    /可搜尋兩年前或更早/u,
    /本站已有詳細版學習指引/u,
    /帶入完訓清單/u,
    /完整題目索引/u,
    /已合併最新進度/u,
    /有另一個版本/u,
    /資料格式無效/u,
    /(?:章節進度|筆記|學習紀錄)格式不正確/u,
    /資料列有/u,
    /目前仍在課程日期範圍內/u,
    /依日期由近到遠排列/u,
    /可用來整理/u,
    /可調整關鍵字/u,
    /計入完訓進度/u,
    /完訓進度新增/u,
    /請重新開啟頁面/u,
    /加入附件/u,
    /逐次完成紀錄/u,
    /留存證明/u,
    /不是專科考試通過率預測/u,
    /不直接視為固定弱點/u,
    /進度已安全保存/u,
    /保護作答進度/u,
    /只保存在這一輪/u,
    /你的全域選擇沒有變更/u,
    /書目來源：/u,
    /白袍口袋/u,
    /本輪能力剖面/u,
    /學習資料已有更新/u,
    /這次操作沒有完成/u,
    /重置狀態無法確認/u,
    /內容待確認/u,
    /平行題會合併呈現/u,
    /不重複題目覆蓋/u,
    /避免只做幾題就產生假高分/u,
    /無法確認目前登入帳號/u,
  ];

  for (const { file, content } of sources) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `${path.relative(projectRoot, file)} contains ${pattern}`);
    }
    assert.doesNotMatch(content, />\s*(?:JSON|CSV|Markdown)\s*</u, `${path.relative(projectRoot, file)} exposes a file format as a control label`);
    assert.doesNotMatch(content, /JSON／CSV/u, `${path.relative(projectRoot, file)} exposes engineering formats`);
  }
});

test("the internal handoff is not referenced by the product bundle", async () => {
  const files = await sourceFiles(path.join(projectRoot, "app"));
  const content = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(content, /長期產品交辦規範|AGENTS\.md/u);
});

test("the footer uses a direct study-purpose description and offers a real back-to-top action", async () => {
  const app = await readFile(path.join(projectRoot, "app/question-bank-app.tsx"), "utf8");
  assert.match(app, /歷屆題庫、學習指引與音檔，為急診專科考試而整理。/u);
  assert.doesNotMatch(app, /臨床處置請依現行指引|請依各院指引|院內流程/u);
  assert.match(app, /className="site-footer-to-top"[^>]*scrollPageToTop[\s\S]*回到上方/u);
});
