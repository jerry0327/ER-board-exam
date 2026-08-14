# 急專補給站 / EM Study Hub

急診專科考試與持續學習平台的主版本庫（source of truth）。

> **Repository status:** recovery baseline. 目前尚未匯入最新版完整網站 source tree；本版本先保存正式專案結構、維運規則、資產策略與可確認的舊版視覺參考。之後匯入最新版時，會保留這段 Git 歷史，不需要重建 repository。

## 專案範圍

本 repository 預計管理：

- 網站 / Web App 原始碼
- 急診專科題庫的結構化資料與自行整理內容
- 學習指引與章節 metadata
- 字幕檔（SRT / VTT / SRC 等）
- 音訊與 SMAC/SNAC 資產的 manifest、索引與版本資訊
- 建置、轉換、驗證與部署 scripts
- 專案文件與歷史版本參考

大型 binary 資產不應直接無限制地堆入 Git history；詳見 [`docs/ASSET_STRATEGY.md`](docs/ASSET_STRATEGY.md)。

## Repository 結構

```text
.
├── app/                 # 網站 / Web App source（最新版匯入後建立）
├── content/             # 題庫、學習指引、結構化文字內容
├── subtitles/           # SRT / VTT / SRC 與字幕索引
├── media/               # 音訊 / SMAC/SNAC manifest；大型檔案另行管理
├── scripts/             # 建置、轉換、驗證工具
├── archive/             # 舊版、實驗版本與歷史參考
├── docs/                # 架構、維運、安全與匯入文件
└── .github/             # GitHub workflow / repository 設定
```

## 目前狀態

- 已建立正式 GitHub recovery baseline。
- 已確認過去存在 v95 / v96 / v97 等舊版發布紀錄。
- 目前可取得的是舊版視覺截圖、字幕 / SNAC 相關周邊資產與部分內容檔；**尚未找到可直接還原完整網站的 v97 source tree / ZIP**。
- 因此目前不會把零散檔案冒充成「完整舊版」。已確認的歷史資料會放在 `archive/` 與 `docs/screenshots/legacy/`。
- 待最新版專案檔提供後，依 [`docs/IMPORT_LATEST.md`](docs/IMPORT_LATEST.md) 進行正式匯入與版本接軌。

## 開發與更新原則

1. `main` 保持可追蹤、可回復。
2. 大型更新先在 feature / migration branch 完成，再合併回 `main`。
3. 不把 API key、密碼、token、病人個資或院內敏感資料 commit 進 Git。
4. 文字內容與程式碼優先使用 Git；大型音訊與模型資產使用 Release / Git LFS / object storage 規劃。
5. 每次重大匯入或部署建立明確 tag，方便回到任一穩定版本。

## Public repository 注意事項

這個 repository 目前是 **Public**。公開內容必須確認具有公開權限。第三方教科書原文、完整受著作權保護內容、未授權音訊、病人資料與任何機密資訊不得因為「是學習用途」就直接公開上傳。

## Medical / educational use

本專案是學習與考試準備工具，不取代臨床判斷、院內流程或最新版專業指引。臨床使用前應核對當下有效的 guideline、藥品資訊與院內規範。

## License

目前**尚未指定 open-source license**。在正式釐清程式碼與內容授權邊界前，不預設第三方可以任意再利用 repository 內容。
