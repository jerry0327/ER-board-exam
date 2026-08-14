# 字幕、Section 與 runtime 壓縮交班

本文件只供維護網站與內容生產的對話／代理讀取，不屬於公開網站內容。凡新增題庫年度、教材音訊、字幕、Section、播放器內容包或壓縮格式，必須先讀完本文件及其指向的契約。

## 1. 權威來源與閱讀順序

1. 音訊匯入、SNAC、R2、暖機：`docs/audio-architecture.md`。
2. RAW ASR：工作區 `scripts/raw_asr_hybrid/README.md`。
3. 正式字幕與 cue：工作區 `scripts/final_src_refinement/README.md`、`SUBTITLE_CUE_SPEC.md`。
4. Chapter／Section：工作區 `specs/SRC_CHAPTER_SECTION_SPEC_v1.md`、player schema、validator。
5. runtime semantic codec：工作區 `specs/subtitle-runtime-semantic-pack-v1.md` 與同名 schema；`subtitle-hxt-hxm-v1.md` 是底層無損 framing 參考，正式部署仍以 semantic-pack manifest、browser decoder 與全量 round-trip gate 為準。

若本專案以獨立 checkout 存在，先定位同一個 Sites project ID 的 workspace root；不得從較舊 snapshot 覆蓋較新的工作副本。

## 2. 新內容完整生產流程

1. 建立精確 inventory，驗證原始音訊數量、stem、collection、SHA-256，絕不改動來源 M4A／Opus。
2. 以既有 hybrid pipeline 產生 immutable RAW SRC。每個 SRC 需符合 `precision-src-v2`、原速時間軸、A lower pitch／B higher pitch、UTF-8/LF。
3. AI 逐章完整閱讀，修正醫學／藥名／數字／明顯辨識錯誤與繁中語句，並親自決定 semantic cue；程式只能做時間比例分配與 validator。
4. 低風險走 exact-hash BULK FAST gate；speaker 大量改動、source conflict、re-ASR、難詞或 validator 問題走獨立 exception review。每個 exact lineage 最多一次獨立 review；PASS 直接發布，FAIL 後只允許一次最小 successor repair，再由不同於作者與 reviewer 的 terminal adjudicator 一次定案，禁止第二 reviewer 或 reviewer-repair-reviewer 迴圈。完整狀態機見 workspace `specs/ONE_REVIEW_THEN_ADJUDICATE_v1.md`。RAW 與已發布 CAS 永遠不可被就地改寫。
5. 正式 SRC 發布後，另一條流程逐章完整閱讀製作最多兩層 Section；不重新 ASR、不改字幕、不改時間或 speaker。
6. 對每個同 stem pair 驗證 source hash、cue indexes、timeline partition、導論／總結、QB 題號與 L1/L2 規則；作者 review state 與 compact player JSON 分根保存。
7. 全量完成後建立人類可讀交接包與機器 runtime 包；兩者都要有 manifest、每檔 SHA-256、數量、collection 路徑及無 missing／extra／collision 證明。

### Canonical SRC contract

SRC 是 UTF-8 without BOM、LF、單一 final LF 的 JSON Lines。第一行為 canonical header，之後每 cue 只含固定順序的 `start`、`end`、`speaker`、`text`；時間格式固定 `HH:MM:SS.mmm`，speaker 只能是 `A`／`B`。目前 corpus 的 collection inventory 是 Board 39、EMS 24、Goldfrank 140、Question Bank 664、Rosen 236、Tintinalli 330，共 1,433。新增內容時不可沿用舊總數，必須由新 manifest 精確重算。

```json
{"start":"00:00:00.000","end":"00:00:03.240","speaker":"A","text":"逐字字幕。"}
```

不要把上例當完整 header；header 必須由當期 pipeline 的 `precision-src-v2` schema 產生並由 strict validator byte-order 驗證。Final 的檔名／相對 collection 路徑必須與穩定音訊 locator 唯一配對。

## 3. Subtitle hard gates

- 完整內容／時間 partition；不得摘要、刪字、補寫音訊未說內容。
- 1–6 秒、最多 32 display cells 為偏好；7 秒／36 cells 為硬上限。
- 禁止拆醫學／藥物／英文詞、縮寫、數字＋單位、否定＋謂語、修飾語＋中心詞與不可分句法。
- A/B 保留 RAW，除非完整上下文與原 M4A 支持強持續衝突或明確 turn；短音高異常不可自動翻標。
- 只對關鍵不可讀片語做 targeted re-ASR；需記錄範圍、backend、原音裁決與是否為 source-content conflict。
- publish 必須 exact candidate hash、strict validator、cue QA、必要 review、原子 no-clobber、formal/staging/CAS 後驗證一致。

### 一次審核與終局裁決

- Reviewer 必須與 primary actor 不同，並完整綁定 candidate、RAW、M4A、proof 與 approval hash；同一 lineage 不得建立第二份內容 review。
- Reviewer PASS：依 normal exact-hash gate 原子發布。Reviewer FAIL：一次寫完全部可辨識缺陷與 durable issue ledger，避免用多輪 reviewer 逐項補抓。
- FAIL 後只有一個 source-faithful successor repair；不得靜默改寫原音。醫學／官方來源衝突要放在非公開 conflict sidecar，由裁決者依 immutable M4A、RAW、正式題源、SRC/Section 契約與 gate 證據定案。
- Terminal adjudicator 必須同時不同於 failed candidate 的作者與 reviewer；若需要 mechanical successor primary，只負責綁定裁決核准的最小 byte delta，不再做內容 review，也不可兼任 adjudicator。
- `approve` 必須在同一原子 transaction 內驗證 exact lineage、通過所有 gate、resolve 綁定 issues 並發布；`block` 是終局 fail-closed，不得重新送回作者／reviewer 迴圈。Section metadata、codec/package 與播放器交付也遵守相同一次審核上限。

## 4. Section hard gates

- 先全文理解，再 macro outline、L2、boundary localization、title refinement、QA。
- Textbook／study 通常 6–8 個 L1；長音訊也優先把資訊密度放入 0–3 個 L2，不用固定分鐘或模板湊數。
- QB 恰 7 個 L1：導論、五個完整題號、總結；題號順序跟隨音訊而非強制排序，每題一個同範圍 `topic_label`。
- 每個 start 必須等於現有 SRC cue start；L1 完整無 gap／overlap，最後 end 等於最後 cue end；subsection children 完整覆蓋父區間。
- player JSON 只保留 schema/source/source_sha256/profile/chapters 與必要節點欄位；confidence、boundary_reason、qa、notes 留在非公開 review state。

### Player Section wire contract

Top-level key order固定：`schema, source, source_sha256, profile, chapters`。L1 key order固定：`id, level, title, start, end, start_cue, end_cue, children`。L2 key order固定：`id, level, type, title, start, end, start_cue, end_cue`。正式檔 2-space、LF、no BOM、單一 final LF；多餘欄位一律拒絕。

```json
{
  "schema": "subtitle-chapters-v1",
  "source": "115A-Q041-Q045.src",
  "source_sha256": "<64 lowercase hex>",
  "profile": "question-bank-five",
  "chapters": [
    {
      "id": "l1-01",
      "level": 1,
      "title": "導論",
      "start": "00:00:00.000",
      "end": "00:01:20.000",
      "start_cue": 1,
      "end_cue": 30,
      "children": []
    }
  ]
}
```

正式檔要包含完整實際 chapters；範例只展示欄位。Study profile 使用 `textbook-study`。`subsection` children 必須完整 partition 父 L1；QB 的 `topic_label` child 必須與父題相同範圍。Progress bar 只畫 L1，drawer 顯示 L1＋縮排 L2，播放時顯示目前 L1/L2。

## 5. Runtime semantic codec

Canonical SRC 是製作與交接母檔；網站 runtime 使用版本化二進位 representation，目標是消除每 cue 重複 JSON key 與完整 timestamp。

最低要求：

- text stream：按 cue 順序保存 UTF-8 台詞及可逆長度 framing；再以 bundle Brotli 處理正文統計冗餘。
- timing stream：保存首 cue start；每 cue duration 使用 unsigned／ZigZag varint 的 delta／prediction residual；只保存非零 gap 的 cue-index delta＋gap 值。
- speaker stream：保存初始 A/B 與交替 run lengths，或經量測更小且同等簡單的 transition bitset；禁止逐 cue 保存 `"speaker":"A"`。
- Section stream：正式部署固定使用 HXM2 cue-only delta-uvarint。L1 只存 1-based `start_cue` 的遞增差值；`subsection` L2 只存相對父 L1 的 start-cue 差值；Question Bank `topic_label` 不存 timing，直接繼承父範圍。不得另存 timestamp 字串、start/end 毫秒、`end_cue` 或平行 timing JSON；end、`end_cue` 與精確 1 ms start/end 都由同一份無損 cue timeline 推導。
- integrity：格式 magic＋version、source SHA-256、pair/bundle hash、cue count、duration、checksum；decoder 嚴格拒絕 truncated、overlong varint、非法 speaker、overflow、noncanonical encoding 與 trailing bytes。
- random access：若播放器需要，使用固定 stride checkpoint；checkpoint 是否保留必須由實際 seek latency與額外 bytes 決定，不可只憑直覺。

Canonical compact `.chapters.json` 與部署 payload 的責任不同：前者繼續完整保留 `start`、`end`、`start_cue`、`end_cue`，供人類閱讀、schema／timeline 驗證、source-hash 綁定與 exact 重建；production build/import 才將已驗證的 Section 轉成 cue-only HXM2。不得為了縮小製作母檔而移除 canonical 欄位，也不得把 canonical JSON 直接當成 runtime payload。

固定快照基準位於 workspace `reports/section-boundary-deployment-benchmark-current/benchmark.json`，SHA-256 為 `1f8d8fe167e4221180133ba7f908152de6e64209c6d81a69f3b609a54dd5489b`。1,372 個 exact SRC／chapters pairs 的結果：cue-only 45,938 B；delta-ms 74,404 B（比 cue-only 大 61.966128%）；重複 timestamp JSON 1,506,338 B（為 cue-only 31.79067439 倍）。全部 1,372/1,372 通過 canonical SRC／chapters bytes、1 ms timing、L1/L2 start/end/end-cue partition round-trip；7 個非 canonical／invalid pairs 另行 fail closed，未混入分母。最終 1,433 pairs 就緒時必須以固定 snapshot 再跑一次，且 mismatch、snapshot drift、invalid pair 都必須為 0；沒有同等無損且更小的全量證據，不得改回 ms 或 timestamp 格式。

Brotli 規則：

- HXT／正文與多章 bundle 可用 q11；以 10–20 章或既有 8 MiB target 作候選，最後以實測決定。
- 已接近高熵的 timing/speaker stream 可原樣放入 pack；若整包 Brotli 變大或只省微量，避免二次壓縮。
- runtime artifact 不得同時保留原始 `.src`、逐檔 `.src.br` 與 semantic payload 三份。正式切換後只留 manifest 指向的最小可驗證 representation；canonical SRC 留在內容生產／交接包。

## 6. Codec 驗收

必須在當下完整 corpus 上執行，而非只跑樣本：

1. Encode canonical SRC＋compact chapters。
2. 由 production browser decoder 邏輯解回 cues／sections。
3. 逐 cue 比較 text、start ms、end ms、speaker、順序；重建 canonical SRC 並比較 SHA-256。
4. 比較 section L1/L2 的 title、type、cue index、由 cue 推導的 start/end。
5. 驗證 Section binary 只含 canonical cue delta／flags；禁止 timestamp 字串、ms start/end、`end_cue` 或第二份 timing payload，並將解碼結果重建為 byte-identical compact chapters JSON。
6. 測 corruption、截斷、錯 hash、錯版本、混代 pair、重複／overlong varint、整數 overflow、缺檔與多檔。
7. 量測 raw SRC、raw+Brotli、semantic codec、semantic bundle+Brotli 的總 bytes、每章 fetch、decoder JS bytes、冷／暖 parse latency、peak memory。
8. 只有 end-to-end 傳輸與使用者首次顯示確實較佳，且所有 lossless gate 通過，才把播放器 loader 切到新 manifest；否則保留較可靠方案並記錄量測。

交接報告至少列出：canonical SRC bytes、compact chapters bytes、直接 Brotli bytes、semantic text bytes、semantic metadata bytes、bundle bytes、decoder JS bytes、壓縮／解壓時間、冷／暖首個 cue 可用時間、peak memory、檔數／cue 數、nonzero gaps、speaker runs、round-trip mismatches。不得只報壓縮率而省略 decoder 與首播成本。

## 7. 網站匯入、暖機與部署

- 使用既有 content-pack importer／allowlist／hash 驗證，不讓 view 自己拼 pack 或繞過 Worker。
- 首頁與非音訊流程不得載入大型 SNAC decoder。進入學習指引／音檔或具體詳解後，先 render；900 ms 後只在可見、4G、未省流量、至少 6 cores 且記憶體足夠的裝置 idle 暖機。hover／focus／pointer intent 可提前；播放仍必須由使用者 gesture 啟動 AudioContext。
- 不預抓全部音訊。只有具體選取、待播、續播或相鄰預測來源可 fetch；以 source id＋revision 去重。字幕／Section 很小，可隨該具體 source 一起抓取，但不能阻擋 SNAC 基本播放。
- decoder 暖機、source prefetch、subtitle load 任一失敗都必須可在播放時重試；背景失敗不得永久污染狀態。
- 展開播放器的目前字幕固定放在目前 Level 1／Level 2 之下、transport controls 之上；只顯示當前完整 cue。章節與逐字稿是同一空間的按需抽屜，不永久占用正文寬度；逐字稿依目前 L1 分組，點 cue 可 seek，active cue 自動捲入視野。跟讀焦點採即時 lyrics 的當前句突出概念，但以完整醫學 cue 為單位，不做逐字卡拉 OK 動畫。
- 進度條採 YouTube Chapters 概念：只以 Level 1 分成有細縫的連續區段，播放填色可跨段連續前進；Level 2 絕不切碎進度條。hover／pointer drag 顯示所在 L1 標題與時間，實際 seek 仍連續且不吸附 chapter boundary。完整 L1／L2 目錄只在播放器內按需展開。
- A／B 是匿名製作標籤，不得直接顯示給使用者。runtime 必須無損保留 speaker stream；介面只可用不帶字母的輕微縮排提示換人，不使用單側彩色邊線。未來只有在資料提供經驗證、具語意的角色或姓名時，才顯示 speaker label。
- 桌機播放器固定於底部中央；手機作為避開 bottom navigation／safe area 的浮動底層。短螢幕的整個播放器必須受 `dvh` 上限約束並可內部捲動，任何 320 px 寬／568 px 高以上的支援 viewport 都不可把關閉、播放、章節或字幕切換控制推到畫面外。
- 部署前先在 workspace root 執行 `python scripts/audit_subtitle_delivery_readiness.py`，再依 AGENTS.md 跑完整 test、typecheck、lint、build、artifact/audio/content-pack audits；確認 1,433 個音訊身分全部落在互斥的「可發布 HXM2 pair」或「hash-bound terminal-unavailable」之一，並驗證 manifest、hash、CRC、codec round-trip與桌機／手機 player 行為。終局 block 是完成的不可用裁決，不得反覆修訂，也不得載入舊 fallback 字幕；其餘 final／Section 缺件、actionable manager issue、proxy 未解項或 metadata validator error 必須阻擋發佈。
- 正式發布依既有 Sites／R2 兩階段流程，不提交 secret，不偽造 migration marker。只有全量字幕與 Section gate 完成才部署最終版本。

部署 gate 至少包含：

```text
subtitle final count == audio catalog count == section count == manifest pair count
missing == extra == collision == orphan == 0
SRC strict/cue/speaker/UTF-8/timeline gates == pass
Section schema/hash/cue alignment/L1-L2 coverage == pass
semantic codec full-corpus exact round-trip mismatches == 0
content-pack index/hash/CRC/Brotli extraction == pass
unit tests + typecheck + lint + production build + artifact audits == pass
```

## 8. 未來年度最小操作清單

1. 加入來源音訊與穩定 locator／年度題號範圍。
2. 更新 expected inventory；跑 RAW pipeline 至完整 gate。
3. 逐章 AI 精修與發布 final SRC。
4. 逐章建立 compact Section＋review state。
5. 跑全量 validator與 source-hash reconciliation。
6. 以 production codec encode、全量 lossless round-trip、重建 manifest/content pack。
7. 匯入網站、測字幕／Section／seek／warm-up，最後依 Sites release 流程部署。

不得因舊年度已存在而複製章節模板、跳過全文閱讀、信任檔名代替內容、覆寫 canonical source，或只跑抽樣 codec 驗證。
