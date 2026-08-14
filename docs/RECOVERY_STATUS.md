# Recovery Status

**Baseline date:** 2026-08-14

## What is confirmed

- 急專補給站曾有多個連續發布版本，包含 v95、v96、v97。
- 歷史版本已具有題庫、章節學習指引、學習音檔與行動版介面。
- 現存資料中可確認題庫儀表板、題目卡片、Tintinalli 章節學習指引與 Rosen's 音檔列表等 UI 狀態。
- 現存 Library 另有字幕、轉錄、SNAC/SMAC 實驗與處理資產，但這些不等同完整網站 source tree。

## What is not currently available

目前尚未取得可以忠實還原完整 v97 runtime 的完整專案 ZIP / source tree。因此本 recovery baseline **不宣稱自己就是 v97**，也不把零散實驗檔案拼成虛假的舊版網站。

## Baseline purpose

本版本先建立：

1. 可維護的 GitHub 結構。
2. 安全與公開內容邊界。
3. 大型音訊 / SMAC-SNAC 資產策略。
4. 舊版視覺與恢復資訊的保存位置。
5. 未來最新版匯入的 migration 程序。

## Next recovery step

取得目前電腦上的最新版專案後：

1. 對最新版建立完整 file inventory 與 checksum。
2. 掃描 secrets、PHI、絕對路徑與大型 binary。
3. 確認既有 build / runtime 方式。
4. 將 source、content、subtitles、scripts 與 media references 分層匯入。
5. 驗證首頁、題庫、學習指引、播放器、字幕、搜尋與手機版主要流程。
6. 建立 migration commit / PR，保留 recovery baseline 歷史。
7. 合併後建立穩定版本標記。

## Historical evidence policy

`archive/` 與 `docs/screenshots/legacy/` 只作為恢復與比較參考；它們不是 production source。任何無法確認來源、授權或是否屬於正式版本的檔案，不會直接提升為 canonical content。
