# 音訊架構與維護交班

本文件是「急專補給站」音訊功能的集中交班資料。修改音檔來源、分類、播放器、SNAC 解碼器、R2 或部署流程前，先閱讀本文件；不要只依畫面或單一腳本推測整條管線。

## 1. 架構摘要

音訊使用 24 kHz mono 的 SNAC 封裝。瀏覽器端由 Web Worker 載入解碼 runtime 與模型，解碼後透過 AudioWorklet 播放。使用者仍必須以點擊等手勢真正啟動瀏覽器音訊；背景暖機只能先下載、初始化與編譯，不能繞過瀏覽器的 autoplay 規則。

資料流如下：

1. `scripts/snac-library.config.json` 定義收藏 ID、顯示名稱、來源檔名規則與預期集數。
2. `npm run import:snac-library` 驗證每個 SNAC payload／metadata，建立內容摘要 release 路徑與邏輯 catalog。
3. `npm run compress:snac-audio` 與 `npm run compress:audio-runtime` 產生 Brotli q11 資產及具大小、SHA-256、logical path、stored path、R2 key 的 manifest。
4. 建置時 `scripts/generate-managed-audio-manifest.mjs` 合併兩份 manifest，產生 Worker 使用的精確 allowlist；`scripts/audit-audio-runtime.mjs`、built-route audits 與 artifact validation 會阻擋不一致的版本。
5. `worker/index.ts` 只服務 allowlist 內的邏輯 URL。正式環境先讀取有正確 custom metadata、大小與 hash 的 R2 物件，缺少時才回退到部署 artifact 內的 `.brp`。
6. 前端 `app/lib/audio-summaries.ts` 載入 runtime catalog，依穩定資源 ID 建立索引；`app/hooks/use-learning-audio.ts` 把所有 reader 接到同一套解析、預載與播放入口；`app/components/audio-player-provider.tsx` 負責 shell 暖機、decoder Worker、AudioWorklet、單集預抓、有限預解碼、播放狀態與續播。

## 2. 主要檔案與權責

| 檔案 | 權責 |
| --- | --- |
| `scripts/snac-library.config.json` | 收藏 ID、標題、來源命名規則、預期集數；ID 是持久資料，不因改文案或換色而改名。 |
| `scripts/import-snac-library.mjs` | 匯入與驗證 SNAC，產生 release-scoped catalog。 |
| `scripts/compress-snac-audio.mjs` | 壓縮 catalog、metadata、payload，產生 R2 key 與 compression manifest。 |
| `scripts/compress-audio-runtime.mjs` | 壓縮模型分片與 WASM runtime。 |
| `scripts/lib/managed-audio-manifest.mjs` | allowlist、namespace、hash、migration marker 的共同驗證規則。 |
| `worker/index.ts` | R2-first、static-fallback、cache、operator seed／verify 路由。 |
| `app/components/audio-player-provider.tsx` | runtime 暖機、解碼、播放、待播清單、續播與來源預抓。 |
| `app/hooks/use-learning-audio.ts` | 所有學習 reader 共用的 catalog 解析、正文顯示後暖機、聆聽入口。 |
| `app/lib/audio-summaries.ts` | catalog 狀態、穩定資源索引與所有使用者可見音檔名稱。 |
| `app/lib/learning-source-registry.ts` | 教材／來源名稱、順序、書脊標誌、主題 token 與能力。 |
| `app/data/textbook-sections.json` | Tintinalli、Rosen’s 與未來教材共用的輕量 Section 邊界。 |
| `app/views/audio-library-view.tsx` | 收藏卡、年度／狀態篩選、搜尋與音檔清單。 |

`worker/managed-audio-manifest.generated.ts` 是建置產物，不應手動編輯。

## 3. 新增或更新音檔

1. 保持既有 collection ID；新增收藏時，先在 `scripts/snac-library.config.json` 加入唯一 ID、穩定檔名規則、來源類型與精確 `expectedItems`。來源路徑是匯入端設定，不是 runtime URL。
2. 音檔必須帶可驗證的穩定 locator，顯示名稱與檔名不參與掛接：

   - 教科書章節：`textbook + chapterId`
   - 教科書 Section：`textbook + sectionId`，且 `kind = textbook-section`
   - 題庫詳解：`questionExam + questionStart + questionEnd`
   - 題庫學習指引：`textbook = board + chapterId = unitCode`

   使用者明示的教材、Section 或章節範圍是最高優先資料。若未明示，匯入工作只能依序採用內嵌 metadata、可唯一解析的章號／題號、再與既有 catalog 做唯一交集。標題可協助提出候選但不可直接決定。沒有唯一答案、章號越界、筆數不合或同一資源重複時，匯入必須 fail closed，輸出待確認映射並停止發布。
3. 題庫音檔需提供民國年度／卷別與題號起訖，現在每集固定五題；畫面名稱由結構化欄位產生，不顯示匯入檔名或 `title`。
4. 執行：

   ```bash
   npm run import:snac-library
   npm run compress:snac-audio
   npm run audit:audio-runtime
   npm test
   ```

5. 新增教材／來源時，在 `app/lib/learning-source-registry.ts` 登錄名稱、順序、標誌、既有 theme token 與能力；有 Section 階層時同步更新 `app/data/textbook-sections.json`。若多個技術 collection 應呈現為同一本書，catalog 使用相同 `libraryId`／`libraryTitle` 聚合，不複製大卡。
6. Reader 只提供穩定 `resource` locator 給 `useLearningAudio()`。既有 reader 不需為每一章加判斷；只要 catalog 新增相符 ID，工具列與行動閱讀面板會自動出現按鈕。新增全新 reader 時必須沿用這個 hook 與 `GuideReaderToolbar`／`GuideReaderToolsPanel` 的 `audioAction` slot，不可自行載入 catalog 或直接控制播放器。
7. release 目錄由 payload 與 metadata 摘要決定。內容變更會建立新 revision；不要覆寫既有 immutable release，也不要手動修改 catalog hash。

## 4. R2 發布與驗證

R2 namespace 固定為 `managed-audio/v1/`。logical path、stored path、R2 key、大小與 SHA-256 必須全部吻合，Worker 才會讀取物件。operator token 只存在部署 secret 與執行環境，不得寫入命令歷史、文件、原始碼或 Git。

音訊內容有變更時使用兩階段發布：

1. 讓 migration marker 缺席或失效，先建置並發布「含 static fallback」的版本。這個版本的 Worker 已認得新 allowlist，seed 端點也能從 artifact 讀取並核對新 bytes。
2. 使用受控環境把 token 從 stdin 傳入，對正式 origin 執行：

   ```bash
   node scripts/seed-r2-managed-assets.mjs \
     https://emergency-board-questions.jerry3627613.chatgpt.site \
     --token-stdin
   ```

3. 腳本會批次 seed，接著對每個物件實際 GET，比對 metadata、大小與 SHA-256；全部成功後才原子寫入 `public/audio/snac/r2-migration-complete.json`。
4. 再發布一次。建置只有在 marker 與當前 manifest、Site project、origin、Merkle root 全部吻合時，才會從部署 artifact 裁減已遠端驗證的 fallback。

seed 或驗證中斷時不要手動偽造 marker；下一次建置應保守保留 static fallback。也不要直接上傳未列入 allowlist 的 R2 物件，Worker 會拒絕且稽核無法證明內容完整性。

## 5. 解碼器背景暖機

`QuestionBankApp` 的 `prepareAudioForRoute` 是第一層路由觸發點：進入或準備進入「學習指引」、「學習音檔」，以及已知實際題號的「詳解閱讀」時先呼叫 `prepareShell()`，快取小型 decoder Worker 入口、ORT module、model manifest 與 output worklet。目的頁完成首屏後 900 ms，再於 idle 時段由 `prewarmDecoder()` 判斷是否初始化約 52 MB decoder runtime；桌機 hover／鍵盤 focus／pointer-down 等明確導覽意圖可提前啟動同一個暖機。暖機使用單一 Worker/session 與現有 in-flight 狀態去重，實際播放沿用同一份模型，不重新下載或編譯。

`prewarmDecoder()` 比一般 shell 預抓更保守：頁面必須可見、未開 Save-Data、連線明確為 4G、至少 6 logical processors；瀏覽器有 `deviceMemory` 時至少 6 GiB，未知記憶體的 coarse-pointer 裝置不背景載入大型 runtime。條件不符仍保留 `prepareShell()`，並在使用者實際按下播放時走正常 on-demand decoder。題目或 Markdown 顯示後，`useLearningAudio()` 載入 catalog；只有具體來源的音訊入口意圖才預抓／預解碼該來源。

規則：

- 首頁、一般作答與其他沒有音訊內容的路由不可自動載入大型 decoder model；只有學習指引、學習音檔與已指定題目的詳解閱讀可進入 idle decoder 暖機。
- `Save-Data`、2G／slow-2G、背景分頁、低記憶體或沒有明確記憶體能力訊號的裝置要維持保守行為；不得為追求「看似預載」而移除這些保護。
- 路由暖機不可預抓全部章節。單一來源只可在使用者選取、待播、續播或相鄰預測時由 `prefetchSource()` 取得，並以 `source.id + revision` 去重。
- 預解碼固定為最多約 3.4 秒（四個 20,480-sample window，24 kHz 下約 327 KiB PCM）。它只在頁面可見、未開 Save-Data、非 2G／slow-2G、WebGPU 可用且至少 6 個 logical processors 時執行；瀏覽器若回報記憶體則不得低於 6 GiB，記憶體未知的 coarse-pointer 裝置也跳過。條件不符仍可按下播放並走一般 on-demand 解碼。
- 關閉播放器 UI 時立即關閉 AudioContext／AudioWorklet，避免音訊輸出持續佔用；已載入的 idle Worker/session 在可見頁保留 90 秒、背景頁 10 秒、低記憶體裝置 15 秒後才釋放。保留期間沒有 timer 以外的輪詢、下載或推論，重新播放可直接重用模型。這是自動能力策略，不增加一般設定開關。
- 更新 decoder Worker、worklet 或 shell 檔案時，同步更新 revision query；可變入口不可使用沒有版本的永久快取。
- 播放按鈕仍必須能在暖機失敗後重試，不能把背景錯誤變成永久失敗狀態。
- 背景暖機完成但尚無目前來源時立即啟動既有 retention timer；可見頁最多保留 90 秒，避免無限占用模型記憶體。
- 播放器的可見載入回饋只使用一個通用進度指示器：下載比例可信時顯示 determinate 長條，準備／緩衝無法換算時顯示 indeterminate 長條。不得把 decoder、解碼時間、window 或緩衝秒數當成一般使用者文案；無障礙名稱也只描述「音檔準備進度」。

## 6. 收藏卡與命名規範

頂部收藏卡是唯一的來源／收藏選擇器；不要再加入內容相同的下拉選單或選中來源大標頭。頁首「學習音檔」與 active 收藏卡已足以建立層級。搜尋、題庫年度與聆聽狀態是不同維度，仍可並存。

- Tintinalli：`T` 方形標誌，`--site-guide-tintinalli`。
- Rosen’s：`R` 方形標誌，`--site-guide-rosens`。
- 題庫學習指引：`指` 方形標誌，`--site-guide-board`。
- 歷屆題庫音檔：`Q` 方形標誌，獨立的藍色題庫音訊色。
- 全部音檔：`ALL` 方形標誌，本站 primary 色。
- 新分類：先使用 neutral fallback，再依其學習指引來源增加明確 token；不要在 JSX 寫死十六進位色碼。

收藏卡的 identity 與配色由 `learning-source-registry.ts` 提供。題庫年度選擇器只在題庫收藏出現；Tintinalli 與 Rosen’s 只顯示各自的 Section 選擇器。切換收藏時要重設不適用的年度與 Section 篩選，不能讓隱藏條件把另一收藏篩成空白。

手機維持單列、可橫向滑動、scroll snap 與至少 44 px 觸控目標。選中狀態除了顏色，還要有邊框或底線等第二提示。

題庫音檔的使用者可見標題固定為 `115B · Q001–005`；不加 `Q.`，不顯示 `Question Review`、匯入檔名或內容生成標題。桌機左欄只顯示「題庫」作類型提示，手機直接移除該欄，避免題號重複。

## 7. SRC 字幕與章節導航內容包

最終字幕與章節資料使用獨立的 `/subtitles/` 邏輯 namespace，但沿用既有 Brotli q11 content-pack、Worker 解包、entry hash 與 UTF-8 驗證流程。每個項目必須同目錄、同 stem：`<stem>.src` 與 `<stem>.chapters.json`；根目錄另有 `manifest.json`，schema 固定為 `subtitle-player-section-manifest-v1`。

匯入已驗證的播放器內容包：

```bash
npm run import:subtitle-sections -- --package /path/to/package
```

匯入器會逐檔核對 manifest、SHA-256、SRC identity、cue 數、duration、同名配對，以及 compact player JSON 的精確欄位；`confidence`、`boundary_reason`、`qa` 等作者／審查欄位會被拒絕。匯入成功後，原始檔不會以未壓縮副本留在 runtime artifact，而是與 `/data/`、`/guides/` 一起進入索引式 content pack。

前端由 `app/lib/audio-chapter-package.ts` 用音訊 catalog 的穩定 collection/stem 查 manifest；題庫即使位於年度子目錄也按 collection + basename 唯一配對。SRC 與 chapters 各自使用 manifest 內自己的 hash URL，載入後再由 `app/lib/audio-chapters.ts` 驗證 source SHA、cue boundary、L1/L2 partition 與播放器欄位白名單。chapter JSON 永遠保存 1.0x source time；只有 seek、目前章節判斷與 progress marker 投影時，才經 `audio-playback.ts` 換算到本站 1.2x timeline。

## 8. 完成前驗證

至少執行：

```bash
npm test
npm run lint
git diff --check
```

並在 Sites agent preview 檢查首頁、題庫詳解、Tintinalli 章節、Rosen’s 章節與學習音檔：桌機及手機皆須確認：

- catalog 中有 locator 的 reader 會自動出現聆聽按鈕；沒有 locator 的內容不顯示空按鈕。
- Tintinalli、Rosen’s、題庫指引與題庫各自出現在正確大卡，標誌與既有學習指引色票一致。
- 題庫年度只在題庫顯示；Tintinalli／Rosen’s 各自 Section 選擇器正確且互不污染。
- decoder／單集預抓／預解碼均發生在正文 render 之後，不阻擋頁面操作；背景暖機失敗後，實際播放仍能自行重試。
- 關閉播放器後短時間再開另一音檔可重用 Worker，逾時或低能力裝置仍會安全釋放。
