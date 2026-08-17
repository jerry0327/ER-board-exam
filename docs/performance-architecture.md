# 載入效能與轉場交班

本文件記錄「急專補給站」目前的瓶頸排序、render-first 策略與可接受的背景工作。它只供開發與代理流程使用，不屬於公開網站資產。

## 1. 目前瓶頸排序（2026-08-06 基準）

| 優先 | 項目 | 已量測規模／特性 | 現行處理 |
| --- | --- | --- | --- |
| 1 | SNAC decoder runtime／模型 | runtime 邏輯 76,974,090 bytes，Brotli q11 後 51,871,335 bytes；遠大於任何 route chunk | 學習指引／音檔頁先 render，900 ms 後只有高能力、4G、可見裝置在 idle 暖機；hover／focus／pointer intent 可提前，其他裝置維持按播放才載入 |
| 2 | 首次音檔來源＋第一個 decode window | 需抓單集 metadata／payload並開始推論 | 正文顯示後預抓當前來源；高能力裝置預解碼最多 3.4 秒 |
| 3 | 題庫索引與全文搜尋 | 完整索引約 1.58 MB raw／243 KB stored；首屏 planning index 約 351 KB raw／17 KB stored；搜尋資料約 2.07 MB raw／498 KB stored | 首屏只取 planning index；完整索引在首頁 paint 後 idle 載入，低速／省流量連線則等到題庫操作；搜尋 catalog 在使用者需要時 lazy load |
| 4 | 學習文件 PDF viewer | worker 約 1.31 MB raw／390 KB gzip，viewer 約 483 KB raw／144 KB gzip；文件本身 q11 約 1.55 MB | 僅進入「學習文件」後按需載入，不列入學習首頁 sibling 預載 |
| 5 | Markdown renderer／全站 CSS | 2026-08-06 基準：共用 Markdown chunk 約 463 KB raw／137 KB gzip；CSS 約 440 KB raw／73 KB gzip | reader 才需要 Markdown chunk；共享 token／foundation 維持核心 CSS 權威，analytics map、備考、認列課程、作答工具與 spotlight 樣式改由既有 lazy owner 按需載入；每次效能變更仍須以 build 重新量測 |
| 6 | 教材 reader 與內容 pack | production route chunk：學習首頁約 18 KB raw／5 KB gzip，詳解約 32 KB／10 KB，音檔約 32 KB／10 KB；正文位於 q11 content packs | 學習首頁先 render，再逐一 idle preload reader；Markdown 仍按章抓取 |
| 7 | 視覺轉場 | 純 UI 工作，不應成為等待來源 | 只使用短 crossfade，動畫不等待網路或資料 |

新增內容後應重跑 build／artifact audit 並更新實際數字；不要用舊數字替新瓶頸下結論。

## 2. Render-first 順序

1. 立即呈現固定 header、route shell、標題與目前已有的首屏內容。
2. 首次 paint 後再載入該主分頁最可能使用的 route chunk；一次一個，使用 idle callback／短 timer 並可取消。
3. 路由意圖先預抓小型音訊 shell；學習指引／音檔／具體詳解內容真正顯示後，高能力裝置可在 900 ms + idle 時段初始化 decoder。靠近、聚焦或觸碰主要音訊導覽入口時可把同一暖機提前；當前來源與預解碼仍只在具體音訊入口意圖後執行。
4. 明確播放意圖後，只有高能力可見裝置進一步預解碼 3.4 秒；不預解整章，不同時預解多章。
5. 使用者明確點擊永遠可打斷背景 prime，正常播放優先。

`StartupHome` 與各 route fallback 必須是穩定、可理解的第一層畫面；若一個 API 尚未完成，優先保留已顯示內容與局部 skeleton，不回退成整頁 spinner。導覽按鈕短標籤與頁面正式標題分開保存：fallback 只顯示正式 `pageTitle`，且必須與目的頁穩定 H1 相同，避免 lazy route 接上時出現「音檔 → 學習音檔」等文字替換與 layout shift。

## 3. 主分頁與子頁預載

- Dashboard 保持 eager；其他互斥主 view 維持 dynamic import。
- 主 view 首次完成 paint 後，`QuestionBankApp` 依 `relatedRouteViews` 暖最相關 sibling，受 visibility、Save-Data、2G／slow-2G 與記憶體條件限制。
- 學習首頁的卡片先 render；650 ms 後才在 idle 時段依序載入各教材 reader module，中間保留 160 ms 間隔。不要改成 `Promise.all()` 或頂層 eager import。
- 內容 pack、全文搜尋與音訊 catalog 仍按用途獨立；預載 route JavaScript 不代表預載全部資料。

## 4. 轉場決策

主分頁切換採 View Transition API 的漸進增強：若支援、頁面可見、記憶體合理且使用者未要求 reduced motion，冷 route 最多保留舊畫面 120 ms 等待 chunk；之後不論 chunk 是否完成都提交新 route shell。只有 `route-stage` 的舊 snapshot 約 110 ms 淡出、新 snapshot 約 140 ms 淡入並做 2 px 內的定位收斂；root、固定 topbar 與手機 bottom nav 不做 snapshot 動畫，避免固定導覽消失或雙影。不使用大面積滑動、彈跳或阻尼 overshoot。

Reader／guide 的窄版目錄經 `ReadingCatalogLayer` portal 到 `document.body`，使用全視窗 flex scroller；這是為了跨出 `route-stage` 的 transition stacking context，確保目錄與最後一列永遠高於播放器及底部導覽。

理由與外部依據：

- [Microsoft Fluent 2 Motion](https://fluent2.microsoft.design/motion) 建議頂層導覽使用快速 fade，避免大型 UI 滑動。
- [Chrome View Transitions](https://developer.chrome.com/docs/web-platform/view-transitions) 以 old／new snapshot 漸進增強；非同步資料不應鎖在 transition callback 中等待。
- [Apple Designing Fluid Interfaces](https://developer.apple.com/videos/play/wwdc2018/803/) 建議先使用無 overshoot 的完整 damping，彈性只在手勢動量有明確物理意義時使用。
- [Apple Human Interface Guidelines: Motion](https://developer.apple.com/design/human-interface-guidelines/motion) 要求動態服務理解、回饋與 reduced-motion 可及性。

## 5. 音訊效能、記憶體與能耗

- 四個預解碼 window 共約 3.413 秒、約 327 KiB mono Float32 PCM；Worker 只保留一個來源的 bounded cache。
- WebGPU 推論是短暫能耗尖峰，因此只在 WebGPU、至少 6 logical processors、良好連線與可見頁面執行；瀏覽器若回報記憶體則須至少 6 GiB，記憶體未知的 coarse-pointer 裝置直接跳過。低能力裝置跳過 prime，比強迫預解碼更省電也更快。
- 關閉播放器時 AudioContext／AudioWorklet 立即釋放；Worker/session 空閒保留 90／10／15 秒（可見／背景／低記憶體），期間不持續運算。這可避免使用者立即播放下一集時再次下載／編譯約 52 MB runtime。
- 播放器不向一般使用者顯示 decoder、decode window 或緩衝秒數。能真實量測下載比例時使用 determinate 細長條；無法可靠估算剩餘量的準備／緩衝改用 indeterminate 細長條，不製造假百分比。技術數值只留在診斷 data attribute 與日誌。
- 不提供一般設定開關。這些選項涉及裝置能力且自動降級可預測；只有實際 telemetry 顯示自動策略造成可觀問題時，才評估新增「省電」類使用者選項。

## 6. 效能變更的完成條件

- `npm run build`、型別、lint、完整測試、audio runtime audit 與 artifact validation 全部通過。
- Agent preview 至少檢查 1920×1080、3840×2160、390×844、430×932；確認第一屏先出現、無整頁 loading 回歸、tab 轉場不閃白、reduced motion 無動畫。
- Network／Performance 檢查要證明首頁、一般題庫與非音訊流程沒有 decoder model；學習指引／音檔／具體詳解先完成首屏，再依能力於 idle 暖機，或由 hover／focus／pointer intent 提前；正文先於 source prime，切換相鄰頁不重複抓相同 runtime 或 source revision。
- 新增預載前必須說明觸發時點、取消條件、網路／CPU／記憶體上限與失敗 fallback。缺任何一項不得默認背景執行。
