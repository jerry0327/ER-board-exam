# EM Board Exam

急診專科醫師考試與持續學習 Web 平台。Repository 內保存可重建網站所需的應用程式原始碼、題庫、學習指引、音訊、字幕／section 資料、測試與維運工具；`main` 作為正式開發基準。

## 目前內容

- 3,320 題急診專科題庫，涵蓋 ROC 94–115B（2005–2026）。
- 1,433 個學習音訊章節；managed audio assets 2,875 個。
- SNAC 音訊資料與瀏覽器端 runtime。
- 1,433 組語意字幕 timing / speaker / section sidecar（HXM）。
- 74 個字幕文字 bundle（HXT/HXTB），以及 1,433 組 section title locale。
- 章節學習指引、題目詳解、文件與靜態 content packs。
- TypeScript/Vite/Vinext 應用程式、Cloudflare Worker、測試與資料維護 scripts。

詳細資產統計見 [`docs/ASSET_INVENTORY_V1.json`](docs/ASSET_INVENTORY_V1.json)。

## 開發環境

- Node.js `>=22.13.0`
- npm
- Linux 環境建議具備 `flock`、`curl` 與 GNU `timeout`

```bash
npm ci
npm run dev
```

建立正式產物：

```bash
npm run build
```

TypeScript 檢查：

```bash
npx tsc --noEmit
```

執行完整測試：

```bash
npm test
```

## 主要目錄

```text
app/                         Web UI 與應用程式邏輯
public/data/                 題庫與結構化資料 runtime
public/guides/               學習指引 content packs
public/audio/                音訊與 SNAC 資產
public/subtitles-runtime/    HXT/HXM 字幕與 section runtime assets
public/subtitles-title-locales/ section 標題 locale
scripts/                     匯入、壓縮、稽核與維運工具
tests/                       contract / runtime / integration tests
worker/                      Cloudflare Worker
build/                       Vite/Sites build source helpers
docs/                        架構與資料格式文件
```

## 資料與資產維護

- 音訊架構：[`docs/audio-architecture.md`](docs/audio-architecture.md)
- 字幕 runtime 格式：[`docs/semantic-subtitle-runtime.md`](docs/semantic-subtitle-runtime.md)
- 字幕資料製作與部署：[`docs/subtitle-production-and-deployment.md`](docs/subtitle-production-and-deployment.md)
- 效能架構：[`docs/performance-architecture.md`](docs/performance-architecture.md)
- Version 1 資產清單：[`docs/ASSET_INVENTORY_V1.json`](docs/ASSET_INVENTORY_V1.json)
- 全檔 SHA-256：[`docs/FILE_MANIFEST_V1.sha256`](docs/FILE_MANIFEST_V1.sha256)

## 版本控制原則

`main` 是可直接交接的正式基準。功能修改請建立 branch，完成 typecheck、相關測試與 build 後再合併；不要把 `node_modules/`、`.sites-runtime/`、`.vinext/` 或其他可重建的本機 runtime/cache 納入 Git。
