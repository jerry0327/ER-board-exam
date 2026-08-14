# 急診專科題庫：長期產品交辦規範

本檔只供後續開發、審查與代理流程讀取，不得在網站介面、說明頁、下載內容或公開資產中顯示、引用或摘要。

## 使用者與產品語氣

- 主要使用者是準備台灣急診專科醫師考試的住院醫師。介面以自然、精準、專業的繁體中文撰寫，像成熟的醫學教育產品，不像 AI 對話、開發工具或資料後台。
- 文案只說明使用者此刻能做什麼、看到什麼，以及下一步是什麼。不要宣傳實作方式、資料流、儲存機制或開發成果。
- 禁止將與使用者溝通時的技術說明直接搬進產品，例如「已匯入」「待匯入」「上傳後」「備援快照」「來源失敗」「回傳資料」「本機／裝置範圍」「不會上傳伺服器」「離線保存」「背景同步」「JSON／CSV／Markdown 格式」等。
- 禁止口號式或過度防衛的提示卡，例如「列出不等於訓練認定」「仍需確認」「僅供參考」「資料請再核對」。若資訊不確定，就不要把它當成完成項目；若確有必要的法規、臨床或時效限制，只在會影響當下決策的位置，用一句具體文字說清楚。
- 不要向使用者展示內部匯入、索引、清理、同步、快取、來源比對、版本遷移、資料格式或錯誤管線狀態。非阻斷性的背景狀態直接隱藏；阻斷操作時只說清楚結果與可採取的下一步。
- 不以 JSON、CSV、Markdown 或其他工程格式命名按鈕。沒有完整還原流程的下載不得稱為「備份」。若提供下載，按鈕名稱必須描述用途，例如「下載筆記」或「列印學習摘要」。
- 保留使用者已指定的高品質、沉穩、非 AI 模板感介面；避免功能宣稱、重複說明、空泛標語、過多 badge、警告框與狀態框。

## 全站視覺語言（所有後續頁面與元件均須遵守）

### 唯一視覺權威

- 全站固定為三種正式顯示模式：「淺色」是暖白紙張與石色桌面；「深色」是柔和深綠黑；「純黑」是 OLED 真黑。三種模式共用完全相同的資訊架構、元件、排印與幾何尺寸，切換不得造成換行、位置或功能改變。系統深色偏好只自動選擇「深色」，純黑必須由使用者明確選擇。
- `app/site.css` 是唯一的 runtime stylesheet 入口，也是唯一可以新增或調整色票、材質、陰影、圓角、動態與元件外觀的檔案。`app/layout.tsx` 只能匯入 `site.css`；任何 view／component 不得直接匯入 CSS。禁止新增 `*-v2.css`、`*-redesign.css`、`*-override.css` 或以主題、頁面、改版名稱建立另一張視覺覆蓋層。
- `app/globals.css`、`app/board-prep.css`、`app/recognized-courses.css`、`app/practice-tools.css`、`app/spotlight.css` 與 `app/analytics-map.css` 只由 `site.css` 匯入，屬凍結的結構相容模組。它們只能保留功能狀態與必要幾何，不得新增色碼、自訂色票、材質、陰影、主題 selector 或視覺版本規則；可移除已被 `site.css` 取代的舊 selector。
- Cascade layer 順序固定為 `a11y, vendor, legacy, site-tokens, site-base, site-components, site-layout, site-features, site-utilities`。KaTeX 等第三方樣式必須在 `vendor` layer，所有相容模組必須在 `legacy` layer。禁止 `!important`、無 layer 的本地 CSS、以 specificity 競賽覆寫，或新增另一個最終視覺 layer。
- 所有顏色值只可存在 `site.css` 的 light／dark／black token blocks；元件一律使用 `--site-canvas`、`--site-paper`、`--site-ink`、`--site-primary`、`--site-success`、`--site-warning`、`--site-danger` 等語意 token。新元件不得直接寫 hex、rgb、hsl、lab 或 named color。
- 淺色核心固定為 canvas `#f1ede4`、paper `#fbf8f1`、paper-deep `#e8e1d4`、ink `#28312d`、muted `#6f746c`、sage `#839483`、oxblood `#792f32`；深色固定為 canvas `#121714`、paper `#1b221e`、paper-deep `#111713`、ink `#edf2ed`、sage `#9db3a0`、oxblood text `#e19a9f`、action fill `#913d45`；純黑固定為 canvas `#000000`、paper `#050505`、ink `#f4f4f4`、sage `#a5b7a8`、oxblood text `#e7a0a5`、action fill `#963f47`。
- 材質以固定暖色／深綠背景漸層、1% 紙面染色、半透明 chrome、細線與低對比紙張陰影完成；不得加入雜訊圖、霓虹發光、厚重浮空陰影、滿版裝飾圖、過量 pill 或「每個資訊一張卡」的卡片牆。oxblood 是原始品牌與主要操作色，同時需以圖示、文字和結構區分錯誤／刪除語意，不能只靠顏色。

### 排印、表面與元件

- 介面標題可使用 `--site-display`，操作使用 `--site-sans`，長篇中文閱讀使用 `--site-reading`，年度、倒數、題號與進度數字可使用 `--site-mono`。所有可見文字絕對下限 12px，一般介面至少 14px；長篇正文桌面 17px／32px、手機 16px／29px，主要觸控控制至少 44×44px。
- spacing 只使用 4、8、12、16、24、32、48、64px 的 4px 基準；控制圓角以 8–10px、紙面與浮層以 14px 為準，pill 只用於真正的單值狀態。真正需要邊界的工作區才使用 `paper-card`，禁止卡片套同語意卡片。
- 文字密集的題目、章節、錯題與筆記使用連續列、完整列底色與髮絲分隔，不把每一列做成獨立浮起的圓角卡。選取、目前位置、成功、警告與錯誤可用整體底色、完整邊界、字重及圖示區分；禁止單側彩色邊線或單側 inset shadow。
- 帶圖示或清除按鈕的複合搜尋欄只能有一個可見外框，由外層承擔 `focus-within` 完整焦點環；內層 `input` 不得再有背景、邊框、圓角或陰影。
- 空白、載入與錯誤狀態應延續頁面的編輯式框架，以安靜的實線、清楚標題與可採取的下一步呈現；禁止大型虛線佔位框、技術階段文案或為了填滿畫面而增加裝飾卡。
- 主要按鈕使用 `--site-primary-fill` 與 `--site-on-primary`；次要按鈕使用透明或 paper 底加邊線。資訊、成功、警告、錯誤的語意不可在不同頁面交換。
- 所有表單、標籤、篩選、導覽、進度、dialog、drawer 與 bottom sheet 必須重用 `site.css` 的共用語彙；新增面板先組合既有語彙，確定不存在時才在 `site-components` 新增一次全站元件。
- 頁面操作必須先按使用者任務排序：每個區塊只保留一個明確主要動作，低頻篩選、來源、說明與進階設定以 `details`、drawer、sheet 或 dialog 漸進揭露。禁止用平鋪大量按鈕取代資訊架構。

### 網格與響應式

- 1080p 以 12 欄、最大內容寬 1600px；4K 仍維持可讀行長與有意義留白，最大內容寬 2160px，不把卡片等比例放大。手機以 390px 與 430px 為驗收基準，保留同一資訊架構並改為單欄。
- 全站主要斷點只使用 840px 與 600px。840px 以下切換桌機導覽／閱讀欄；600px 以下啟用底部導覽、safe-area、單欄按鈕與緊湊排印。禁止為單頁再增加相近斷點。
- sticky header、reader toolbar、drawer、lightbox、搜尋、學習資料 dialog 與閱讀工具必須使用 `--site-header-height`、safe-area token 與固定 z-index 階層：header 80、bottom nav 90、floating action 95、overlay backdrop 100、overlay panel／drawer 101、theme menu 110、spotlight 160／161。面板一定高於自己的遮罩，浮層不得被頁面 animation、transform 或 overflow 建立的 stacking context 裁切。
- 手機 drawer／sheet 關閉時必須 `inert` 且 `aria-hidden`；trigger 保留 `aria-haspopup`、`aria-controls`、`aria-expanded`；開啟後鎖定焦點與背景捲動，Escape 關閉並將焦點還給 trigger。Reader／guide 的窄版目錄必須經共用 `ReadingCatalogLayer` portal 到 `document.body`，不可再留在 route transition 的 stacking context 內。

### 動態與驗收

- 動態只服務定位與回饋：控制回饋 100ms、狀態切換 160ms、drawer／dialog 220ms；使用 `--site-ease`。禁止漂浮、彈跳、旋轉裝飾與大幅 parallax，也不得攔截 wheel 或 touch 模擬阻力；保留 iPhone／Android 原生慣性捲動。任何程式化捲動必須經 `app/lib/motion.ts`，尊重 `prefers-reduced-motion`。
- focus-visible 必須清楚且不只靠顏色；正文跳轉要保留 sticky header offset。桌面與手機都不得出現水平爆版、固定列遮住內容或小於觸控尺寸的關閉按鈕。
- 每次視覺修改必須通過設計系統契約、建置、型別、lint 與完整測試；至少檢查 1920×1080、3840×2160、390×844、430×932，以及 light／dark／black。每個尺寸都要驗證無水平溢位、圖像不超出容器、表格／公式／程式碼可在自身範圍水平捲動、固定列不遮住內容、overlay 可點擊與關閉。新增頁面若未遵守以上規範，不得發布。

## 公開存取、個人資料與同步

- 正式站預設為「持連結即可使用」的公開網站，不要求 ChatGPT、Google 或本站帳密。匿名使用者必須能完成作答、閱讀、收藏、筆記、學習指引與備考清單等主要流程。
- 匿名身分固定使用 `anonymous-device`，作答進度、閱讀進度、筆記與完訓清單只保存在該瀏覽器的 LocalStorage／IndexedDB。介面不得主動說明儲存位置、同步機制或技術狀態；成功狀態只說「已儲存」，非阻斷背景狀態直接隱藏，失敗時只說結果與可採取的下一步。
- 匿名資料不得寫入共用伺服器帳號，也不得用一個固定使用者 ID 代替所有訪客；這會造成不同使用者互相看到或覆蓋資料。未取得可信身分時，所有個人寫入必須留在使用者裝置。
- 匿名裝置日後取得可信身分時，`anonymous-device` 的 annotation IndexedDB 必須先將筆記與對應 outbox 在帳號資料庫的同一交易中耐久化，才可按來源快照清除匿名資料；重跑必須冪等。同一 annotation ID 若帳號端已有不同內容，保留帳號原文，匿名內容以可重現的 duplicate ID 另存，且 highlight／excerpt duplicate 必須保留原 `h_r_`／`h_gt` 閱讀來源 scope，絕不可覆蓋或隱藏任一份。
- 目前公開站沒有可選式登入客戶端，不得新增無法真正同步的登入按鈕。若日後確認需要跨裝置同步，優先延伸既有 ChatGPT 身分流程，並先完成權限、資料遷移、登出與刪除流程；不要同時增加 Google OAuth 或自建帳密。
- 證明文件與其他需要伺服器保存的個人檔案，只能在取得可信身分後開放。匿名模式若不支援附件，操作必須明確停用，不可把檔案掛在共用匿名空間。
- 將公開站切回需登入模式、增加第三方登入或自建帳號，均屬產品與資安決策，不可由後續版面工作順手更動。

## 筆記與內容摘錄

- 題庫與學習指引的筆記屬同一功能，必須共用同一套 annotation 資料管線、右側筆記 drawer、Markdown 預覽、筆記本匯入、遮罩、標頭、編輯欄與焦點管理。不得在正文中插入頁內筆記卡，也不得新增學習指引專用的筆記資料流或視覺 CSS；`guide_progress.note` 只保留作舊資料遷移來源，不能再接收新筆記。
- 遷移舊版 `guide_progress.note` 時，只有 annotation 與 guide progress 已確認為同一 `accountKey`，且登入狀態兩邊皆為 `synced`（匿名狀態則兩邊皆為 `anonymous-device` 的本機模式）後，才可在共享筆記落盤後清除舊欄位。任何帳號、API 或同步狀態不一致都必須保留舊資料並等待下次重試，禁止把伺服器筆記降級到匿名裝置儲存。
- `guide_progress.note` 的舊資料遷移必須在 App 層掃描全部 303 章進度，不能等使用者開啟該章才搬移；先耐久寫入 shared annotation，再清空舊欄位。若 shared root note 已存在，現有 shared 內容優先且不得被舊欄覆寫，但仍須清除已完成遷移的舊欄位，讓筆記本與全站搜尋在未開章時也能立即看到全部舊筆記。
- 一般題目／章節筆記使用 `question_note`；反白畫線使用 `highlight`；把詳解或學習指引中的主標題、標題、次標題、次次標題或表格加入筆記使用 `excerpt`。三者共用現有 annotation 儲存、離線 outbox、同步、預覽、搜尋與回到原文流程，不另建平行筆記系統。
- `excerpt.quote` 保存來源 Markdown，`excerpt.body` 保存使用者補充；標題／表格另以既有 `prefix` 欄保存可攜的穩定來源區塊 anchor 與閱讀深度，讓筆記本與搜尋的「回到原文」先還原建立時的精要／詳細範圍，再精準捲動並聚焦原區塊。詳解閱讀新建的 `highlight`／`excerpt` ID 必須同時編入實際顯示的 pack 與 quick／standard／full／raw 深度，深連結優先由 ID 還原來源深度；舊 `h_`／`h_c_` ID 仍分別視為詳細／精要且預設完整模式，不能破壞舊筆記。摘錄上限可高於短反白，但必須有明確伺服器驗證。不得把完整 HTML、React 節點或不可攜的 DOM 結構寫入資料庫。
- annotation 深連結只可暫時衍生 effective pack／mode 來還原來源，不得把該來源寫回使用者原本的閱讀偏好；關閉 drawer 後立刻恢復原偏好。一般 `q_` 根筆記沒有閱讀 scope，不得擅自切到完整模式。annotations 仍在 loading 時不可誤判連結失效；完成載入並保留短暫 grace 後仍找不到、已刪除或不屬於該來源的 annotation，必須回到無 annotation 的 base route 並解除閱讀控制鎖定。
- 標題與表格的「加入筆記」操作必須排除在反白文字索引之外，避免新增按鈕後破壞既有 highlight offset。桌機反白工具列與編輯面板使用 portal 掛到 `document.body`，不可被閱讀欄的 sticky／overflow 容器裁切。
- 點擊 H1–H4 標題的摘錄入口時，必須保存「該標題＋其下全部正文、表格與較低層子標題」，直到下一個同級或更高層標題才停止；題庫詳解與學習指引共用同一段落範圍解析器。標題的 anchor／fallback key 仍只以標題本身建立，確保既有只含標題的舊摘錄與正文更新後仍能回到原位置。表格入口則只保存該表格。
- 標題與表格的摘錄入口採小型圖示，融入標題左側線條、選項 A／B／C／D 標記或表格邊角；桌機由整個標題／表格 hover 顯示，鍵盤 focus 與觸控裝置則必須保持可發現。不得在每個區塊重複放置醒目的「加入筆記」文字按鈕。
- 摘錄在筆記本、搜尋結果與編輯預覽都要可辨識且可閱讀；新增標題層級時，沿用同一個摘錄入口與可存取名稱，不要再新增一套卡片操作。
- 詳解閱讀與學習指引的字級、精要／詳細選擇器、稍後、讀完、收藏、筆記、上一／下一、左右方向鍵與左右滑動手勢必須使用共用元件或 hook；內容名詞可以是「題」或「章」，但操作順序、狀態保存、觸控排除範圍與桌機／手機行為不得各自實作。
- Tintinalli、Rosen’s 與全書／Section 指南的頂部工具列必須共用 `GuideReaderToolbar`，右側及手機閱讀工具面板必須共用 `GuideReaderToolsPanel`；教科書切換、前後篇、字級、稍後、讀完、收藏、筆記與文章目錄的順序不得在各 reader 內重複組裝。兩本章節目錄的個人進度篩選必須共用 `GuideProgressFilter`，包含「稍後閱讀」。只有來源本身不同的版本／深度、相關題目與卷／Section 資訊可以作為插槽或資料差異。
- 學習指引首頁的 Tintinalli、Rosen’s 與 AILS 必須共用同一套書封、左側書脊與整合式底部操作列語言。兩本教科書只能由個別章節進度驅動續讀；全書／Section 入口必須收在各自大卡內，並共用同一個 `GuideOverviewLink` 結構與圖示。AILS 以跨欄專題卷呈現，卡內提供內容總覽、選題作答與詳解閱讀三個入口。所有卡片容器本身不可為互動元素；各入口必須是合法的兄弟控制，禁止巢狀按鈕或在卡內再貼一張次卡。全書／Section reader 必須提供醒目的個別章節目錄入口，且教科書根路由在手機直接開啟 drawer、桌機顯示既有側欄，不得把「開啟目前已顯示目錄」當成無反應的主要動作。
- AILS 在全站主導覽中維持學習指引底下的一個名為「AILS」的單一模組，不另增全站主分頁。正文與表格沿用既有 guide reader；272 題題庫、隨機測驗與完整詳解必須離開正文閱讀目錄，分別直接重用既有 `BrowseView`、`PracticeView`、`ReaderView` 與 `QuestionSheet`，不得另建平行的選題、作答、結果或詳解介面。只有主題庫沒有的記憶卡翻面／自評可保留薄層控制器，題面與解析仍須重用 `QuestionSheet`。題庫練習提交後立即回饋，記憶卡只做自評而不計分，隨機測驗一輪不重複且交卷後才揭曉答案；詳解入口必須支援不作答直接閱讀。AILS 題目必須使用獨立資料、作答狀態、收藏、熟練與 practice-session 命名空間，不得進入急診專科主題庫、錯題本或分析。AILS 內容必須轉成本站既有 `MarkdownContent`、表格與共用題庫表面，不得匯入原始 HTML 的 CSS 或 JavaScript。
- 閱讀版本／程度的視覺與互動共用 `ReadingVariantSelector`；Tintinalli 與 Rosen’s 的裝置偏好共用 namespaced persistence hook，但各教科書必須保留獨立 storage key。詳解閱讀既有的 `useExplanationPreferences` 是全站題目詳解偏好，語意與範圍不同，不得為了表面統一而改寫、覆蓋或與教科書偏好共用 key。
- 新使用者的題目詳解固定預設為詳細版 `original`＋`full`，Tintinalli 與 Rosen’s 的閱讀深度固定預設為 `full`；AILS 與補充指引維持完整正文。既有 storage key 與所有合法已儲存偏好必須保留，不能用新版預設覆寫使用者已選擇的速讀或標準模式。
- Rosen’s 固定為 192 個核心章與 e01–e16，共 208 篇可閱讀正文；不要自行插入 119B 或偏移 eChapter 對應。所有章節共用詳解閱讀／Tintinalli 的字級、閱讀程度、稍後、讀完、收藏、筆記、上一／下一與手勢管線；Rosen’s 進度使用 namespaced string resource ID，不能改寫既有 Tintinalli 數字章進度。
- 所有會自行處理水平手勢或方向鍵的內容區（表格、程式碼、公式、文字流程與圖表）必須位於共用導覽排除範圍；新型內容無既有 selector 可重用時，在最小互動根節點加上 `data-reading-navigation-ignore`，不可為單一頁面另寫一套滑動判斷。

## 長期內容擴充決策規則

- 新資料先判定為既有來源內容、新版本／深度、全新來源或附屬資產；先找現有 importer、manifest、registry、reader 與測試。能以資料擴充既有流程就不另建平行 UI、parser、狀態或 CSS。使用者明示的教材與章節／題號範圍優先，仍須由 manifest 與實際筆數驗證。
- 題目／詳解、教科書章節與 Section 都保留穩定 ID，沿用既有共用 reader、導覽、進度、筆記、搜尋、閱讀偏好與可選音訊。新增全新來源才擴充 source registry、taxonomy、importer 與 route；來源特有能力使用 slot，不複製整個 reader。
- 題庫教科書對照、來源追溯、相關章節、音訊與文件皆是可選關聯；缺少時只隱藏該能力，不得阻擋新年度題目／詳解或新章節上線。只有輸入明確宣稱含有某關聯，而該關聯重複、越界或矛盾時才 fail closed。
- 未知類型先確認穩定 identity、最接近的既有資料管線、應繼承能力與真正特殊差異。identity 無法唯一確定或可能破壞舊資料時停止發布並回報；不要猜測性掛接，也不要把暫時作法固化成全站規則。
- 新內容仍須通過既有 sanitize、hash、Brotli q11 content pack、lazy／render-first、完整測試與桌機／手機預覽；交班文件不進 `public/`。完成標準是內容與既有能力一致，不只是檔案已放入。

## 報考與完訓清單的記錄原則

- 真實世界要求「參加 N 次／N 場」時，畫面必須提供 N 個可獨立完成的欄位，至少包含各自的勾選框與日期。不得用一個布林勾選代表全部完成。
- 學會聯合討論會 3 次與不同型態演習 3 場都屬逐次記錄；每一次必須能分開完成。
- 超音波案例與中毒病例屬紙本學習護照的彙整項目。網站只提供一個「護照已完成」確認，不得依 10 例、12 例或各類別展開大量勾選框，也不得因此扭曲整體進度權重。
- 以課程類別與時數分列的要求必須各自記錄。112–115 年容額的毒化災 6 小時、核災 6 小時及其他認證課程 6 小時是三個獨立項目，絕不可合併。較早容額的歷史規則仍依當時課程表呈現，不套用新制時數。
- 不因數字出現在名稱中就自動拆分。只有可獨立參加或完成的場次才展開；紙本案例總量、課程時數與整體評核維持合適的單一紀錄。
- 調整項目 ID、完成次數或進度分母時，必須保留既有使用者紀錄與附件可見性，並為舊狀態提供遷移測試。
- 完成日期、證書號、備註與證明文件只在項目已完成後提供；整組使用原生收合區塊，預設收起，不得自動展開。逐次場次若要記錄日期、證書號或備註，也採相同的預設收合方式。
- 證明文件必須支援上傳、下載、更換與刪除。更換檔案時先保存新檔並確認紀錄更新，再移除舊檔，避免更新中斷造成證明遺失。

## 內容與來源

- 官方連結、新聞與公告應盡量由官方列表／索引頁動態解析，不得把目前年度的 detail URL 或檔名當成永久入口。甄審簡章、口試程序、筆試試題與答案、合格名單、REMOC 開課及認證清單都要由標題、日期與民國年度辨識最新有效資料；畫面年度文字必須來自同一筆來源，不可把舊年度內容改標成新年度。
- 跨年度解析不得逐年新增 115、116、117 等固定分支，也不得只比對一條完整標題。先正規化全形／半形、空白與標點，再依「三位數民國年度＋急診專科醫師＋簡章／口試或面試流程／筆試題目與答案／最終合格名單」等結構辨識；規則要涵蓋同義詞與順序變化，同時排除申覆、疑義、初審結果及訓練醫院認定。有人開啟網站且快取到期時應自動刷新官方索引，不得要求每年人工改碼或替換 URL。
- 可長期指向官方索引頁的入口直接使用索引頁；必須開啟年度附件時，保留最近一次成功解析的官方 URL 作來源失敗備援。若無法可靠辨識新年度資料，寧可顯示官方索引入口，也不得持續把過期年度 detail URL 當成「最新」。每次新增官方來源需補解析、去重、來源失敗與跨年度測試。
- 官方規則以台灣急診醫學會現行資料為準，內部保留來源連結與查核日期；介面只提供有用的官方入口，不反覆顯示來源防衛文字。
- 區域 EMOC／REMOC 課程必須依北部、中部、南部分頁整理，並直接標示可對應的毒化災、核災、其他認證課程或演習項目；同一課程不得因跨區或同時含課程與演習時數而重複算成兩門課。
- 區域開課資訊的固定源頭包括北區 REMOC 課程頁、中區臺中榮總 EOC 公告及南區成大 REMOC 活動總覽。中區公告若代轉其他區課程，依實際場地歸區；北區與臺北區是不同區域，不得混列。來源暫時無法讀取時保留最近可用課程，不得把清單直接清空。
- 開課頁與學會認證清單負責不同資訊：開課頁提供日期、地點、名額、報名與簡章；只有最新學會認證清單能決定毒化災、核災、其他及演習認列內容。整併時以年度、日期、正規化課名與地點比對，不以可變動的報名頁 ID 當課程主鍵。
- 學會活動與積分課程放在「近期開課」，但必須與北部、中部、南部 REMOC 區域課程分成獨立區塊；完訓清單只保留完訓項目與個人完成資料，不放課程活動卡。
- 「住院醫師災難醫學訓練課程時數認證清單」是不定期更新的主資料來源。不得把特定日期檔名永久寫死；應先從台灣急診醫學會「各類表單」頁找出最新檔案，再讀取最新年度工作表，並保留可用的最近版本供來源暫時無法讀取時使用。
- 區域課程頁的年度標題、認證更新日與清單連結必須跟隨最新認證檔，不得把 115 年或任何單一年份永久寫在介面；對使用者顯示的年度與日期採民國格式。
- 只有認證清單已填入的時數才能顯示為可計入相應項目。年度預告或尚未出現在認證清單的 REMOC 場次可以提供報名資訊，但不得先加入完成時數或標成已認列。
- 課程若只認列部分時數，介面必須顯示實際認列時數；不得因課程名稱符合類別，就把整堂課時數全部算入。已認列課程可帶使用者前往對應完訓項目，但不應在未確認累計時數前自動勾選完成。
- 課程清單資料量大時，必須提供關鍵字搜尋，並可交叉篩選地區、課程類別、認列狀態與可報名場次；已認列且可報名的課程在排序與視覺層級上優先。
- 使用者可將已完成且已認列的課程加入個人累計；毒化災、核災與其他課程依認列小時分開加總，演習依 DMAT／醫院緊急應變／特殊災害三種認列型態計算，同一課程跨區只算一次。尚待認列課程不得加入累計。
- 累計目標必須跟隨容額年度：107 年顯示基礎課程 14 小時與演習 8 小時；108–111 年顯示初階 16 小時、毒化／核災／其他各 8 小時組成的特殊災難 24 小時，以及三種演習；112–115 年顯示初階、毒化災 6 小時、核災 6 小時、其他 6 小時及三種演習。帶入完訓清單前保留一次明確的使用者操作，不因瀏覽或報名自動完成。
- 備考中心頁首必須沿用其他內頁的無外框 `page-intro`；主分頁、近期課程次分頁與內容卡依序建立階層，但 grid row 必須由內容高度決定。REMOC 的 2／3／5 個進度項目在桌機各自吃滿同一列，手機維持兩欄再單欄，不得用固定三欄或 viewport 拉伸製造空洞。
- 教科書、題目與詳解的臨床／法律／版本時效警示可保留，但必須具體且與該章節直接相關；不得把通用免責聲明灑在全站。
- 甄審資訊只呈現當年度簡章、訓練課程基準、口試程序與官方考古題。不得因使用者舉例、一般慣例或本站既有教材而推定官方指定書目；當年度官方文件未明列教科書時，介面不得自行列出任何書名。AILS 的完訓課程與證書仍只放在完訓項目；使用者提供的 AILS 急性中毒複習內容可作為學習指引內的獨立學習模組，但不得描述成官方甄審指定書目或官方讀書來源。
- 原稿閱讀功能只可留在設定中的進階選項，不得在一般頁面宣傳其技術格式。

## 音訊資產、背景預載與分類介面

- 音訊工作先完整閱讀 `docs/audio-architecture.md`；效能與轉場依 `docs/performance-architecture.md`。技術細節與可調參數留在這兩份文件與測試，不在本檔固化。
- 音訊只以穩定資源 identity 掛接，不以顯示名稱或檔名判定。使用者明示映射優先；缺少時只接受可唯一驗證的推導，模糊、多重或越界就停止該批音訊發布並回報。
- 所有學習 reader 共用 `useLearningAudio`；catalog 有相符 identity 時，閱讀工具與音訊書架自動出現一致入口，沒有時隱藏。新來源的名稱、標誌、排序與主題由共用 source registry 提供，不在各 view 複製規則。
- 音訊書架只保留一套來源大卡，不另加重複的選中來源標頭。題庫年度只在題庫出現；具 Section 階層的教材顯示各自選擇器且互不污染；題庫顯示名稱由結構化欄位產生，不暴露匯入檔名。
- 正文／題目先 render；只有使用者對音檔按鈕產生 pointer／click 播放意圖後，才可依裝置能力、可見度、連線與 Save-Data 暖機 decoder、預抓當前來源與有限預解碼。關閉 UI 後只可短暫保留完全 idle 的 decoder；策略自動降級，除非量測證明需要，不新增一般使用者設定開關。
- SNAC runtime 與資產維持內容摘要、精確 allowlist、Brotli q11、R2-first／static-fallback 與兩階段驗證發布；不得提交 operator secret 或繞過既有 import、hash、壓縮與 audit。

## 字幕、Section 與最小化 runtime codec

- 任何新增年度題庫、教材章節、學習指引音訊、字幕、Section、字幕播放器或部署壓縮工作，先完整閱讀 `docs/subtitle-production-and-deployment.md`；Section 語意規則另讀該文件指向的 `specs/SRC_CHAPTER_SECTION_SPEC_v1.md`，音訊與暖機仍以 `docs/audio-architecture.md` 為準。這些都是內部交班檔，不得放入 `public/`、使用者介面或下載內容。
- Canonical 製作母檔固定為 UTF-8/LF `precision-src-v2` SRC：RAW ASR 不可覆寫，A 永遠是較低音高、B 永遠是較高音高。每章必須完整 AI 閱讀與醫學／數字／繁中精修；程式只可分配時間與驗證，不能用 regex、字典或模板取代語意判斷。
- cue 必須完整覆蓋 RAW 時間與文字，不刪、不摘要、不發明；偏好 1–6 秒／32 cells，硬上限 7 秒／36 cells；禁止拆醫學或英文詞、數字＋單位、否定＋謂語與不可分句法。A/B 原則保留 RAW，只有原音支持的強持續衝突或明確 turn 才可修正；高風險或關鍵不清楚處 fail closed 進例外覆核。
- 全域審核流程固定為「一次獨立審核後終局裁決」：同一 lineage 的 exact candidate 最多交一位真正獨立 reviewer。PASS 直接走 exact-hash 發布；FAIL 必須一次寫完 proof 與 durable issue ledger，之後只允許一個最小、source-faithful successor repair，且不得再交第二位 reviewer，必須由同時不同於原作者與 reviewer 的 terminal adjudicator 一次 approve-and-publish 或 block。若系統需要 mechanical successor primary 綁定裁決者核准的 byte delta，該 actor 也不可兼任裁決者，且不構成第二次內容審核。細節以 workspace `specs/ONE_REVIEW_THEN_ADJUDICATE_v1.md` 為準。
- 每份正式 SRC 都要有同 stem、source SHA 綁定的兩層 `.chapters.json`。逐章完整閱讀後才可決定 Level 1／Level 2；boundary 只能落在既有 cue start，禁止固定分鐘切割、模板複製或 Level 3。Question Bank 固定導論＋五個完整題號（如 `097-Q030`、`115A-Q041`）＋總結，每題一個同範圍 `topic_label`；所有導航標題以繁中為主、醫學英文可並列但不可整段純英文；播放器檔不得含 confidence、boundary_reason、qa 等製作欄位。
- 人類／AI 交接包保留可讀 `.src + .chapters.json + manifest`；正式網站 runtime 不得把重複 `start`／`end`／`speaker` JSONL 原樣交給 Brotli。先以版本化、可逆的二進位 codec 拆出 UTF-8 正文與 timing/speaker streams：首起點、duration delta／residual、稀疏 gap、speaker 起始值＋run/transition。只對有收益的文字或 bundle 使用 Brotli；高熵 metadata 不得為形式一致而再壓縮變大。
- Section 的正式部署契約固定為 **HXM2 cue-only delta-uvarint**：L1 只存 1-based `start_cue` 的遞增差值；`subsection` L2 只存相對父 L1 的 start-cue 差值；Question Bank `topic_label` 不存 timing、直接繼承父範圍。不得在 runtime Section stream 重複 timestamp 字串、start/end 毫秒、`end_cue` 或平行 timing JSON；end、`end_cue` 與精確 1 ms 時間全部由同一份無損 cue timeline 推導。Canonical compact `.chapters.json` 仍完整保留 start/end/cue 欄位，作為可讀製作、schema 驗證與重建權威，只有 build/import 階段轉成 cue-only。
- 此選型的基準證據固定於 workspace `reports/section-boundary-deployment-benchmark-current/benchmark.json`（SHA-256 `1f8d8fe167e4221180133ba7f908152de6e64209c6d81a69f3b609a54dd5489b`）：1,372 個 exact pairs 的 cue-only 共 45,938 B，delta-ms 共 74,404 B（大 61.966128%），重複 timestamp JSON 共 1,506,338 B（31.79067439 倍）；1,372/1,372 通過 canonical SRC／chapters bytes、1 ms timing 與 Section partition round-trip。最終 1,433 pairs 完成後必須重跑同一基準；除非新方案同樣逐檔無損且證明更小，禁止回退成 ms 或 timestamp 部署格式。
- runtime codec 可以不可讀，但編碼器／瀏覽器解碼器／manifest 必須 fail closed；部署前要對全 corpus 逐 cue 還原並證明文字、1 ms start/end、A/B、順序、Section boundary 與 canonical source hash 完全一致。任何 mismatch、缺 pair、孤兒檔、碰撞、非 canonical UTF-8 或 codec 版本不相容都阻擋匯入與部署。原始 SRC 是母檔，不因 runtime codec 而刪除或改寫。
- 使用者介面不得露出匿名 `A`／`B` 字母；它們只屬於無損 speaker stream。播放器把當前 cue 放在目前 L1／L2 與播放控制之間，章節／逐字稿採按需抽屜；逐字稿可用無文字的輕微縮排提示換人，不得使用單側彩色邊線。進度條只以 Level 1 做 YouTube Chapters 式有細縫區段，Level 2 不畫 marker，hover／drag 可顯示 L1 標題但 seek 不吸附。手機／短螢幕必須避開 bottom navigation 與 safe area，整個展開播放器受 `dvh` 上限控制並可內部捲動；離開音檔頁進入學習指引時必須自動收合，點正文亦收合，不得重排或遮住閱讀欄。
- 新格式先在平行 namespace 通過全量 round-trip、大小、冷／暖載入、CPU／記憶體與瀏覽器相容性量測，再原子切換 manifest；不得在證明完成前移除現行可回復路徑。內容 pack 使用內容摘要、精確 allowlist、無未壓縮 runtime 副本及 no-clobber／atomic publication。
- 部署字幕與 Section 前必須先在 workspace root 執行唯讀 `python scripts/audit_subtitle_delivery_readiness.py`；只有 RAW、Opus、final SRC、compact Section、manager issues、proxy spot-check 與 metadata validator 全部通過，才可進入 runtime pack import 與 Sites 發布。不得以手算數量或抽樣驗證取代此 fail-closed gate。

## 載入效能與轉場

- 第一眼可讀內容永遠優先：route shell、標題、既有 Markdown／題目內容先 render；非必要 API、相鄰路由 chunk、其他小分頁與音訊工作只能在首次 paint 後依序於 idle 時段背景暖機。不得用等待所有資料的全頁 loading 取代可先呈現的穩定骨架，也不得讓預載工作和第一屏搶網路、CPU 或主執行緒。
- 導覽列的 `label` 只供狹窄按鈕使用；route shell 必須取用同一筆路由資料的正式 `pageTitle`，並與目的頁穩定 H1 一致。禁止先顯示「音檔／指引／詳解」等短標籤，再於 lazy route 完成後換成正式標題，避免文字跳動與版面位移。
- 主分頁只用尊重 reduced motion 的短、漸進增強轉場；動畫不等待非同步資料，也不以彈跳、大幅滑動或延長效果掩飾載入。相關 route／reader 只在當前首屏完成後依序暖機，且能因省流量、弱連線、背景或低資源裝置取消。
- 具體瓶頸、門檻與時間值以 `docs/performance-architecture.md` 的量測為準。未有證據前不 eager 載入大型 catalog、reader、decoder 或全部音訊，也不把自動效能策略轉嫁成使用者必須理解的設定。

## 壓縮文字資產

- `public/data` 與 `public/guides` 的 runtime JSON／Markdown 只保存於 `public/content-packs` 的 8 MiB 目標邏輯分塊（單一大型檔案仍受 32 MiB 安全上限約束）；分塊與索引固定使用 Brotli q11。不得同時提交未壓縮副本、逐檔 `.json.br`／`.md.br` 或舊 `.gz`。
- 前端一律經共用壓縮載入器讀取原本的邏輯 `.json`／`.md` 路徑，由 Worker 查索引、解開單一分塊並只回傳要求的檔案；不得讓 view 自行讀取索引、拼接分塊或改寫既有邏輯 URL。
- 分塊必須依 UTF-8 byte offset 保存完整檔案邊界；大於 1 MiB 的單一檔案獨立成包，讓大型啟動資料可直接傳送而不必每次重新壓縮。分塊使用內容摘要命名並永久快取，固定索引必須重新驗證。
- Worker 對支援 Brotli 的用戶端以快速 Brotli 回傳抽出的單篇內容；剛好佔滿整包的單一檔案可直接傳送既有 q11 stream。identity、HEAD、304 與舊逐檔過渡 fallback 必須維持正確。
- 匯入、重建、稽核與測試必須使用 `package.json` 內的展開／重壓指令；成功重建後必須原子替換分塊並移除孤兒資產，失敗時保留上一版可讀分塊。
- 壓縮須可重現，索引路徑、pack 摘要、位移、長度、UTF-8、JSON 與每一筆還原內容都要驗證；建置產物不得含 runtime 未壓縮 JSON／Markdown或逐檔舊壓縮檔。
- 不得因壓縮更動題號、章節 ID、`markdownPath`、`contentHash`、`sourceSha256`、annotation scope 或閱讀偏好 key。
- 展開／重壓流程具排他性，不得與另一個 build、test 或 import 同時執行。

## 完成前檢查

- 每次修改使用者介面後，搜尋所有使用者可見字串，清除 AI、開發者、資料工程與過度防衛語氣。
- 維持一項自動化文字契約，禁止上述用語與裸露格式按鈕重新進入畫面。
- 變更完訓規則時，測試逐次場次、紙本護照單一確認、分開的毒化災／核災時數、舊紀錄遷移及可存取名稱。
- 不得刪除必要的底層資料安全、同步或離線能力；只把無須打擾使用者的實作細節留在內部。
