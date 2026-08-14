# Importing the Current Version

這份文件定義日後取得使用者電腦上的最新版專案時，如何安全地「覆蓋更新」而不破壞 Git 歷史。

## 原則

**最新版可以取代目前 baseline 的 runtime source，但不會抹除 baseline commit。** Git 會保留每一次 migration，因此任何錯誤都可以回復。

## Import workflow

### 1. Inventory

- 解壓最新版專案到乾淨工作目錄。
- 列出檔案數、總大小、主要副檔名與最大檔案。
- 建立 SHA-256 inventory，保留原始 package hash。

### 2. Safety scan

匯入前檢查：

- `.env` / API keys / tokens / credentials
- 病人個資與院內敏感資料
- 本機 absolute paths
- 不應公開的第三方原始教材
- 超大型 binary / 重複 build artifacts

### 3. Preserve behavior first

先確認目前最新版如何啟動、建置與部署。第一個 migration PR 以「功能等價」為目標，不在同一批修改中進行大規模 framework rewrite。

### 4. Classify files

將既有檔案依實際結構映射到：

- `app/` — runtime source
- `content/` — 題庫 / 指引 / metadata
- `subtitles/` — 字幕與章節資訊
- `media/` — manifests / small required assets
- `scripts/` — build / conversion / validation
- `archive/` — 只需保留、不參與 runtime 的舊檔

如果最新版既有結構已經合理，優先保留而不是為了符合這份文件硬搬目錄。

### 5. Large assets

- 判斷哪些 binary 必須隨 source versioning。
- immutable 大型資產優先 Release / external storage。
- 需要 Git LFS 的檔案先建立明確 `.gitattributes`，不要事後才把大型 binary 從歷史中清除。

### 6. Validation

至少驗證：

- 首頁可載入且無阻塞錯誤
- 題庫可瀏覽 / 作答 / 看詳解
- 學習指引可搜尋與開啟
- 音訊播放器可載入、播放、切換
- 字幕時間軸與音訊對應
- 手機版底部導航與主要操作正常
- missing asset / 404 / console errors
- build 可以從乾淨環境重現

### 7. Migration PR

所有最新版匯入集中在獨立 migration branch，完成 diff 與驗證後再 merge 至 `main`。

建議 commit message：

```text
import current 急專補給站 source
```

### 8. Stable checkpoint

合併後保存明確版本標記與 release note，記錄：source commit、資產 manifest 版本、已知問題與部署版本。

## Never do this

不要直接刪掉 repository 再重新上傳最新版。那會失去可追蹤歷史，也讓問題難以定位。正確做法是讓最新版成為 **下一個 Git commit / migration**。
