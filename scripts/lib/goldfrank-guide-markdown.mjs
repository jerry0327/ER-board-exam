import { sanitizeStudyGuideMarkdown } from "../../app/lib/study-guide-markdown.ts";

// This validator is intentionally limited to production/source inventory. It
// must not reject concrete clinical, dose, legal-jurisdiction, or evidence-age
// warnings that learners need at the point of use.
const productionLanguagePattern = /(?:^(?:>\s*)?(?:#{2,6}\s+|\*{0,2})?(?:資料來源|章節來源|來源與視覺審閱|章節(?:範圍|圖像|視覺|可及性)|檔案範圍|原章範圍|資料範圍與時效性)(?:核對|說明|註記)?(?:\*{0,2})?\s*[：:]?|(?:原始|來源|上傳|本目標|同一)\s*(?:章節\s*)?(?:PDF|檔案|來源檔)|(?:PDF|來源檔)[^。\n]{0,160}(?:頁碼|頁尾|正文|未納入|未審閱|可辨識)|(?:沒有|未附|未提供|未包含)[^。\n]{0,120}(?:\bECG\b[^。\n]{0,80}(?:臨床照片|流程圖|algorithm)|臨床照片[^。\n]{0,80}(?:流程圖|algorithm)|(?:radiograph|ultrasound)[^。\n]{0,80}(?:臨床照片|流程圖|algorithm))|(?:章首|開章|Chapter opener)[^。\n]{0,100}(?:照片|photograph)[^。\n]{0,60}裝飾|(?:核心|主要|真正具有臨床資訊|醫學性|唯一具有臨床教學意義)[^。\n]{0,100}視覺內容|本指南(?:依據|以|整合|忠實)|(?:以下依|依據)\s*(?:本章|Goldfrank)[^。\n]{0,80}(?:整理|整合|pp?\.)|本章內容依\s+\*?\*?Goldfrank|(?:以下|下列)[^。；\n]{0,100}忠實(?:整理|整合)|忠實(?:整理|整合)(?:自|本章|章節)|所有頁面、表格與圖示均可辨識|已完整整合於|google\.com\/s2\/favicons|utm_source=chatgpt\.com)/imu;

const sourceCitationBlockPattern = /^(?:>\s*)?(?:\*)?(?:\*\*)?(?:資料來源|章節來源|來源)(?:\*\*)?：(?:\*\*)?\s*(?:(?:使用者提供[^\n]*?)?\*?Goldfrank)[^\n]*\*?$/iu;
const pureInventoryBlockPatterns = [
  /^唯一非表格影像是章首[\s\S]*$/iu,
  /^沒有正式 diagnostic criteria[\s\S]*$/iu,
  /^原章沒有特定 antidote dose[\s\S]*$/iu,
  /^PDF\s*最後另附一頁[\s\S]*$/iu,
  /^共\s*\d+\s*頁[。；;，,][\s\S]*$/iu,
  /^PDF\s*共\s*\d+\s*頁[：:][\s\S]*$/iu,
  /^沒有 clinical photograph[\s\S]*$/iu,
  /^整體視覺內容主要為[\s\S]*$/iu,
  /^視覺內容以[\s\S]*$/iu,
  /^>\s*視覺內容包括[\s\S]*$/iu,
  /^>\s*\*\*章節圖像與可及性說明[\s\S]*$/iu,
];

const literalRewrites = [
  [
    /## 1\. Toxicologic Misfortunes and Catastrophes in History\n\n### 1\.1 臨床適用提醒\n\n沒有正式 diagnostic criteria、antidote dosing、disposition rule、臨床影像或 treatment algorithm；因此下文不補造未提供的劑量或治療門檻。Nigeria diethylene glycol 事件另指向外部章節「SC9」，但該交叉參照內容不在PDF 中，故不推測其內容。/gu,
    "## 1. 閱讀架構\n\n本章依暴露途徑、易感人口、辨識延遲與系統失靈理解歷史上的大規模中毒；事件中的劑量、統計與處置應依其年代及情境解讀，不可直接當作現代臨床門檻。",
  ],
  [
    /> 以下依本章內容整理。章中的設備可用性、成本與使用統計屬該版出版時的資料；個別毒物的實際 ECTR indication、停止條件與濃度門檻，仍須配合毒物專章及當代 guideline。/gu,
    "> **版本提醒：**設備可用性、成本與使用統計屬該版出版時的資料；個別毒物的實際 ECTR indication、停止條件與濃度門檻，仍須配合毒物專章及當代 guideline。",
  ],
  [
    /> \*\*檔案範圍說明：\*\*PDF 前 4 頁為本章正文，包含 Table 3–1 至 3–6。PDF 最後一頁的 \*\*Case Study 2\*\*[\s\S]*?不把它誤列為 Chapter 3 正文。/gu,
    "> **內容提醒：**文末的 Case Study 2 屬 Chapter 4，請作延伸病例閱讀。",
  ],
  [
    /> 本章及 SC1 為 Goldfrank 第 11 版、約 2018 年的內容。[\s\S]*?真正具有臨床資訊的視覺內容是 Fig\. 4-1 流程圖及各表格。/gu,
    "> **版本與安全提醒：**SC1 的產品供應、價格、儲存條件、公共衛生取得途徑及建議庫存量均屬該版時代資料，實際使用前必須依目前藥品仿單、醫院藥事政策、毒物中心與區域規範重新確認。glucarpidase 的攝氏儲存範圍缺少上限；lyophilized hydroxocobalamin 的華氏範圍印作「15°F–30°F」，疑為單位錯誤。",
  ],
  [
    /本指南忠實整理 Goldfrank 11e 的章節內容與當時證據。/gu,
    "本章內容反映 Goldfrank 11e 出版時的證據。",
  ],
  [
    /本目標 PDF 除 Chapter 5「Techniques Used to Prevent Gastrointestinal Absorption」外，亦包含：/gu,
    "本章除 Chapter 5「Techniques Used to Prevent Gastrointestinal Absorption」外，亦涵蓋：",
  ],
  [
    /## 10\. 附錄：來源 PDF 附帶的 Section II Case Study 3/gu,
    "## 10. 附錄：Section II Case Study 3",
  ],
  [
    /> 本章正文為書頁 236–241，核心在於建立各類 withdrawal syndrome 的共同神經適應模型，而非提供每一種物質的完整劑量、監測與 disposition protocol。來源 PDF 最後另附兩頁 \*\*Section II Case Study 3\*\*，並非本章正文；其內容另列於文末附錄。/gu,
    "> 本章核心在於建立各類 withdrawal syndrome 的共同神經適應模型，而非提供每一種物質的完整劑量、監測與 disposition protocol；另收錄的 **Section II Case Study 3** 列於文末附錄。",
  ],
  [
    /目前沒有chemotherapy overdose dose、transfusion\/G-CSF thresholds、febrile-neutropenia antibiotic algorithm、特定 disposition criteria 或 transplant indications。這些臨床決策必須依個別藥物章節與現行臨床指引處理。/gu,
    "Chemotherapy overdose 的 transfusion／G-CSF thresholds、febrile-neutropenia antibiotics、disposition 與 transplant decisions，必須依個別藥物、病人狀況及現行臨床指引處理。",
  ],
  [
    /> 原章範圍：\*Goldfrank’s Toxicologic Emergencies\*, 11e，Chapter 27，pp\. 389–398。以下數值、藥物清單、表格與圖像解讀均以原章為主；另於文末獨立標示現行實務校正。/gu,
    "",
  ],
  [
    /> 本指南依據 \*Goldfrank’s Toxicologic Emergencies\*, 11e，第 29 章正文 pp\.411–423，以及 Tables 29-1–29-7、Figures 29-1–29-3 整合。低體溫心搏停止的藥物段落反映(?:本章引用的\s*)?2015 AHA-era 資料，臨床實務仍應以現行復甦指引與院內 protocol 為準。/gu,
    "> **版本提醒：**低體溫心搏停止的藥物段落反映 2015 年 AHA 資料；臨床實務仍應以現行復甦指引與院內 protocol 為準。",
  ],
  [
    /> \*\*章節範圍註記：\*\*[\s\S]*?> \*\*資料年代：\*\*流行病學主要來自 2011–2015 AAPCC\/NPDS 與 2005–2014 CDC\/NEISS；費用資料亦為歷史估計，應視為教科書時期數據，而非目前統計。/gu,
    "> **資料年代提醒：**流行病學主要來自 2011–2015 AAPCC／NPDS 與 2005–2014 CDC／NEISS；費用資料亦為歷史估計，應視為教科書時期數據，而非目前統計。",
  ],
  [
    /### 1\.1 視覺內容\n\n開篇結構式呈現 colchicine、podophyllotoxin、vinblastine 與 vincristine。/gu,
    "### 1.1 結構圖與核心表格\n\n開篇結構式呈現 colchicine、podophyllotoxin、vinblastine 與 vincristine。",
  ],
  [
    /另有一張未附 caption 的花卉照片，不能據此辨認特定毒性植物。核心圖表是 Table 34-1 的 colchicine 三期病程及 Table 34-2 的 antimitotic overdose 比較。/gu,
    "核心圖表是 Table 34-1 的 colchicine 三期病程及 Table 34-2 的 antimitotic overdose 比較。",
  ],
  [
    /Intrathecal vincristine／vinblastine 一定是 medication error，屬於 \*\*life-threatening neurosurgical emergency\*\*。正文將處置指向 Special Considerations SC7／SC8，Table 34-2 只列 SC7；這些內容不在本 PDF，故不能由取得完整 CSF drainage／lavage 或其他 rescue protocol。/gu,
    "Intrathecal vincristine／vinblastine 一定是 medication error，屬於 **life-threatening neurosurgical emergency**。本章未涵蓋完整的 CSF drainage／lavage 或其他 rescue protocol，應立即依 neurosurgical／toxicologic emergency 流程處理。",
  ],
  [
    /Intrathecal error 應立即按 neurosurgical／toxicologic emergency 處理；PDF 未提供完整 rescue procedure。/gu,
    "Intrathecal error 應立即按 neurosurgical／toxicologic emergency 處理；本章未涵蓋完整 rescue procedure。",
  ],
  [
    /- 章首植物照片為裝飾性影像，沒有診斷性 caption。\s*- 目前沒有ECG、radiograph、CT／MRI、ultrasound、clinical photograph、正式 treatment algorithm 或 diagnostic decision rule；因此不能從捏造固定解毒劑劑量、觀察時間或出院標準。/gu,
    "本章未提供固定解毒劑劑量、觀察時間或出院標準；實務上應依毒物特性、病人狀況與毒物專家建議個別決定。",
  ],
  [
    /\*\*來源陷阱：\*\*Vitamin D 欄標題有 b、c 上標，但 PDF 只見孤立的 b、c，沒有可讀定義。/gu,
    "**表格校讀提醒：**Vitamin D 欄標題有 b、c 上標，但表內沒有定義其意義。",
  ],
  [
    /以下依 Goldfrank 11e 本章內容整理。/gu,
    "",
  ],
  [
    /原 PDF 的 Table 44-1 在 vitamin D 欄標有上標 b、c，但頁面未提供可辨識的註腳定義；/gu,
    "Table 44-1 的 vitamin D 欄標有上標 b、c，但未定義其意義；",
  ],
  [
    /完整 extravasation management 另轉介至 Special Considerations SC8；該內容不在本 PDF，故此處不延伸未提供的細節。/gu,
    "完整 extravasation management 另見 Special Considerations SC8；本章不延伸未提供的細節。",
  ],
  [
    /> 原章為 Goldfrank 第 11 版；舊 FDA pregnancy letter categories、藥物上市狀態及交互作用矩陣具有年代性，臨床處方仍須查詢現行資料。本章未附專屬 ECG、影像學或臨床照片；視覺核心是突觸機轉圖、VPA–carnitine metabolism 圖及五張表。/gu,
    "> **版本提醒：**舊 FDA pregnancy letter categories、藥物上市狀態及交互作用矩陣具有年代性，臨床處方仍須查詢現行資料。",
  ],
  [
    /> 本章主文涵蓋 antiepileptic overdose[\s\S]*?未混入本章內容。/gu,
    "",
  ],
  [
    /> 本章除主文外，還包括 \*\*Antidotes in Depth A8：Dextrose\*\* 與 \*\*A9：Octreotide\*\*。以下依 Goldfrank 第 11 版內容整合；其中部分藥物、insulin 製劑、pregnancy category 與裝置敘述具有版本年代背景，已在文末標示。/gu,
    "> **版本提醒：**部分藥物、insulin 製劑、pregnancy category 與裝置敘述具有版本年代背景，臨床使用時須核對現行資料。",
  ],
  [
    /> 本指南忠實整合 \*\*Goldfrank 11e Chapter 50\*\*。流行病學資料主要截至 2015 年，職業暴露清單與規範主要反映 2016 年前後資料；完整臨床劑量、現行 oncology protocol 與法規須另依最新專科資源確認。/gu,
    "> **版本提醒：**流行病學資料主要截至 2015 年，職業暴露清單與規範主要反映 2016 年前後資料；完整臨床劑量、現行 oncology protocol 與法規須依最新專科資源確認。",
  ],
  [
    /> \*\*時點說明：\*\*本章包含 2015 年流行病學、成書時 WHO／CDC 用藥、2018 年疫苗試行及研究中新藥等歷史資料。以下忠實整理第 11 版章節內容；涉及現行瘧疾治療與預防政策時，不應直接視為 2026 年指引。/gu,
    "> **時點說明：**本章包含 2015 年流行病學、成書時 WHO／CDC 用藥、2018 年疫苗試行及研究中新藥等歷史資料；涉及現行瘧疾治療與預防政策時，不應直接視為 2026 年指引。",
  ],
  [
    /> \*\*版本提示：\*\*本章引用 2015 ACLS、舊式 FDA pregnancy letter category，以及較早期的 gastric lavage／whole-bowel irrigation 敘述。以下忠實整理章節內容；實際臨床仍須與當地最新 toxicology、resuscitation 與藥物使用規範核對。/gu,
    "> **版本提示：**本章引用 2015 ACLS、舊式 FDA pregnancy letter category，以及較早期的 gastric lavage／whole-bowel irrigation 敘述；實際臨床仍須與當地最新 toxicology、resuscitation 與藥物使用規範核對。",
  ],
  [
    /> 本指南以 \*\*Goldfrank 11th edition（2018）\*\*為範圍，除第 51 章主文外，亦整合 PDF 後附的 A12 Folates、A13 Glucarpidase、A14 Uridine triacetate、SC7 Intrathecal xenobiotics 與 SC8 Extravasation。舊式 FDA pregnancy category、產品供應與仿單用語均屬版本資訊；實際臨床應再依現行院內 oncology protocol、藥品仿單與毒物專家意見執行。/gu,
    "> **版本提醒：**本章同時涵蓋 A12 Folates、A13 Glucarpidase、A14 Uridine triacetate、SC7 Intrathecal xenobiotics 與 SC8 Extravasation。舊式 FDA pregnancy category、產品供應與仿單用語均屬版本資訊；實際臨床應依現行院內 oncology protocol、藥品仿單與毒物專家意見執行。",
  ],
  [
    /章首為裝飾性的花卉照片，沒有額外毒理標註。結構圖包括/gu,
    "結構圖包括",
  ],
  [
    /Table 54-1 至 Table 54-5 的內容均已整合於前述各節。目前沒有需要另行判讀的 ECG、radiograph、CT\/MRI、ultrasound 或 clinical photograph。/gu,
    "Table 54-1 至 Table 54-5 的重點分列於前述各節。",
  ],
  [
    /但目前 PDF 無法可靠確認每一個斜體藥名。/gu,
    "但該版的版面資訊不足以可靠確認每一個斜體藥名。",
  ],
  [
    /> 原書另有兩處內部不一致：([\s\S]*?)本指南並列呈現，不擅自修正。原表以斜體標示出版時未獲 FDA 核准的藥物，但 PDF 無法可靠辨識全部斜體列。/gu,
    "> **表格校讀提醒：**原書另有兩處內部不一致：$1兩種數值並列呈現，實務上須依現行毒理資源與個案情境判斷。",
  ],
  [
    /> 資料來源：\*Goldfrank’s Toxicologic Emergencies\*, 11e, Chapter 63, pp\.985–993。章中的流行病學數字、FDA 事件與品牌 caffeine 含量屬該版歷史資料，不代表目前產品配方或現行統計。/gu,
    "> **版本提醒：**流行病學數字、FDA 事件與品牌 caffeine 含量屬該版歷史資料，不代表目前產品配方或現行統計。",
  ],
  [
    /> 本指南依據 Goldfrank 11e 第 70 章完整內容整理，包括 Figure 70-1、Figure 70-2、Table 70-1、圖說與表註。ECTR 建議採本章引用的 2015 ExTRIP consensus；實際臨床仍應配合當前毒物中心、腎臟科與院內流程。/gu,
    "> **版本提醒：**ECTR 建議反映 2015 ExTRIP consensus；實際臨床仍應配合當前毒物中心、腎臟科與院內流程。",
  ],
  [
    /用的 Fig\. 8-29 位於其他章節，未包含在PDF 中，因此只能依文字描述。/gu,
    "書中引用的 Fig. 8-29 未隨本章提供，因此僅依文字描述。",
  ],
  [
    /引用 Fig\. 8-29 描述 vasculitis angiography，但該跨章圖片未包含於PDF；可確認的只有正文所述 beading／narrowing。/gu,
    "引用 Fig. 8-29 描述 vasculitis angiography；該圖未隨本章提供，因此以正文所述 beading／narrowing 為準。",
  ],
  [
    /References 頁面除第 10 頁起首的兩個 summary points 外，未提供額外處置表格或治療流程。/gu,
    "本章未另提供處置表格或治療流程。",
  ],
  [
    /本 PDF 頁面可可靠辨識箭頭所指 mammillary enhancement，但版面看起來只完整呈現一個 panel，似有另一平面遭裁切或未完整顯示。/gu,
    "圖中可辨識箭頭所指 mammillary enhancement，但其中一個 panel 未完整呈現。",
  ],
  [
    /> 本章除 \*\*Ethanol\*\* 正文外，PDF 亦附有正文直接引用的 \*\*Antidotes in Depth A27: Thiamine Hydrochloride\*\*，因此兩部分一併整合。/gu,
    "",
  ],
  [
    /> 本章部分內容反映第 11 版出版年代，例如 2015 年濫用統計、sevoflurane 包裝標示、職業暴露規範及 gastric lavage 病例。以下忠實整理章節內容；實際臨床仍應核對現行藥品標示與當地毒物中心建議。/gu,
    "> **版本提醒：**2015 年濫用統計、sevoflurane 包裝標示、職業暴露規範及 gastric lavage 病例反映第 11 版出版年代；實際臨床仍應核對現行藥品標示與當地毒物中心建議。",
  ],
  [
    /> \*\*版本與安全提醒：\*\*下列劑量與處置忠實整理自 Goldfrank 第 11 版本章及其附錄 \*\*Antidotes in Depth A24: Dantrolene Sodium\*\*。Malignant hyperthermia（MH）的聯絡方式、cooling strategy、藥品標示與製劑供應可能隨年代改變，真正急救時須依現行機構及 MH 專業組織流程調整。原章表 66–3 有一處 sodium bicarbonate 上限疑似嚴重錯植，詳見 MH 治療段落。/gu,
    "> **版本與安全提醒：**Malignant hyperthermia（MH）的聯絡方式、cooling strategy、藥品標示與製劑供應可能隨年代改變，真正急救時須依現行機構及 MH 專業組織流程調整。原章表 66–3 有一處 sodium bicarbonate 上限疑似嚴重錯植，詳見 MH 治療段落。",
  ],
  [
    /> 依據 Goldfrank’s Toxicologic Emergencies, 11e, Chapter 78, pp\. 1172–1177。\s*> 參考許多 disulfiram-like interactions、嚴重不良反應及 fomepizole 經驗來自 case reports／case series，應理解為\*\*章節報告的關聯與處置經驗\*\*，不能將每一項都視為具有相同證據強度。/gu,
    "> **證據提醒：**許多 disulfiram-like interactions、嚴重不良反應及 fomepizole 經驗來自 case reports／case series，不能將每一項都視為具有相同證據強度。",
  ],
  [
    /> \*\*版本與素材說明：\*\*以下依 Goldfrank 11e 第 77 章內容整理；章中劑量與治療順位反映該版文獻與作者觀點，不能取代現行院內 protocol。正文交叉引用第 14 章 Figs\. 14-1、14-2，但這兩張圖不在本章 PDF 內，因此未直接檢視其圖像內容；本章本身沒有 ECG、影像學圖片或獨立治療流程圖。/gu,
    "> **版本提醒：**劑量與治療順位反映該版文獻與作者觀點，不能取代現行院內 protocol。第 14 章交叉引用圖未隨本章提供，因此不據圖像推論。",
  ],
  [
    /> \*\*章節圖像與可及性說明：\*\*共 5 頁。章首圖片為裝飾性照片；沒有臨床照片、ECG、影像、流程圖或治療 algorithm。Hematologic system 段落引用 \*\*Fig\. 20-3\*\* 說明 heme synthesis，但該圖位於其他章節，不在所附內容中，因此以下僅依文字解釋其 ALAD 機轉。/gu,
    "> **圖表提醒：**Hematologic system 段落引用 Fig. 20-3 說明 heme synthesis；該圖未隨本章提供，因此以下依文字解釋其 ALAD 機轉。",
  ],
  [
    /> 本指南依 \*\*Goldfrank’s Toxicologic Emergencies, 11e, Chapter 85\*\* 整合。章內法規數值與 leishmaniasis 療程均為該版次所載年代資料，不代表 2026 年現行規範。章內核心視覺內容為 Table 85–1 與 Table 85–2；沒有臨床影像、ECG、放射影像或正式治療流程圖。/gu,
    "> **版本提醒：**法規數值與 leishmaniasis 療程均為該版次所載年代資料，不代表 2026 年現行規範。",
  ],
  [
    /> 本指南依 \*\*Goldfrank’s Toxicologic Emergencies 11e Chapter 86\*\*，並納入同一檔案所附的 \*\*Antidotes in Depth: Dimercaprol（BAL）\*\*。職業暴露標準、DMPS 在美國的可近性、舊式 pregnancy category、BAL 製劑與部分療程均屬本章出版時點資料；臨床個案仍應依所在地 poison center／medical toxicologist 的即時建議處理。/gu,
    "> **版本提醒：**職業暴露標準、DMPS 在美國的可近性、舊式 pregnancy category、BAL 製劑與部分療程均屬該版資料；臨床個案仍應依所在地 poison center／medical toxicologist 的即時建議處理。",
  ],
  [
    /> 本章 PDF 同時包含 Chapter 93、Antidotes in Depth A29（Succimer／DMPS）與 A30（CaNa₂EDTA）。以下統一以 \*\*µg\/dL\*\* 表示血鉛濃度；原書的 mcg\/dL 與之相同。/gu,
    "> **單位提醒：**以下統一以 **µg/dL** 表示血鉛濃度；原書的 mcg/dL 與之相同。",
  ],
  [
    /以下是依內容整理的實務框架，\*\*不是提供的正式演算法\*\*。/gu,
    "下列框架用於整理急診評估，**不是經驗證的正式演算法**。",
  ],
  [
    /> 依據 \*Goldfrank’s Toxicologic Emergencies\*, 11e，第 94 章，pp\. 1319–1323。以下忠實整合該章內容；章內文獻大致截至 2017 年，\*\*不等同於 2026 年最新臨床指引\*\*。/gu,
    "> **版本提醒：**章內文獻大致截至 2017 年，**不等同於 2026 年最新臨床指引**。",
  ],
  [
    /> \*\*資料範圍註記：\*\*本指南依 \*Goldfrank’s Toxicologic Emergencies\*, 11th edition，第 104 章及隨附 \*\*Antidotes in Depth A32: Calcium\*\* 整合；章稿日期為 2018 年。實際臨床用藥、配製與侵入性處置仍應依最新 poison center、medical toxicology、藥局及院內 protocol 執行。/gu,
    "> **版本提醒：**實際臨床用藥、配製與侵入性處置應依最新 poison center、medical toxicology、藥局及院內 protocol 執行。",
  ],
  [
    /> \*\*版本註記：\*\*本指南忠實整合 Goldfrank’s Toxicologic Emergencies 第 11 版 Chapter 105（章節排版日期 2018）。職業暴露限值、產品管制、致癌分類與在地 ICU／disposition protocols 可能已有更新，實際臨床應再核對現行規範。/gu,
    "> **版本提醒：**職業暴露限值、產品管制、致癌分類與在地 ICU／disposition protocols 可能已有更新，實際臨床應核對現行規範。",
  ],
  [
    /> \*\*版本與證據提醒：\*\*本章部分處置——尤其 dilution、極大量酸吞食後的 gastric aspiration、grade IIb corticosteroid、CT grading 與 esophageal stent——主要來自 animal study、retrospective series 或有限的人體研究。以下忠實整理本章的臨床架構，並標示其證據邊界，避免把少數例外誤當成常規處置。/gu,
    "> **版本與證據提醒：**本章部分處置——尤其 dilution、極大量酸吞食後的 gastric aspiration、grade IIb corticosteroid、CT grading 與 esophageal stent——主要來自 animal study、retrospective series 或有限的人體研究，不能把少數例外誤當成常規處置。",
  ],
  [
    /> 本章內容依 \*\*Goldfrank’s Toxicologic Emergencies, 11e\*\* 第 99 章及同一章後附錄 \*\*A31 Prussian Blue\*\* 整合。原章為 2018 年資料；其中 gastric lavage、舊式 pregnancy category C 與藥品供應方式屬章中時代背景，實際臨床處置仍應同步聯絡 medical toxicologist／毒物中心並依當地規範調整。/gu,
    "> **版本提醒：**gastric lavage、舊式 pregnancy category C 與藥品供應方式屬 2018 年前後資料；實際臨床處置仍應同步聯絡 medical toxicologist／毒物中心並依當地規範調整。",
  ],
  [
    /> 本指南整合 Chapter 106 正文、Table 106-1、Figures 106-1～106-4、Table 106-2，以及隨章的 \*\*A33 Fomepizole、A34 Ethanol、SC9 Diethylene Glycol\*\*。來源 PDF 最後 4 頁是與農藥中毒有關的非本章內容，未納入。以下劑量與門檻依 Goldfrank 11e；實際臨床仍須與當地毒物中心、腎臟科、藥師及院內 dialysis protocol 核對。/gu,
    "> **版本提醒：**本章同時涵蓋 A33 Fomepizole、A34 Ethanol 與 SC9 Diethylene Glycol。劑量與門檻反映 Goldfrank 11e；實際臨床仍須與當地毒物中心、腎臟科、藥師及院內 dialysis protocol 核對。",
  ],
  [/本 PDF 有不同章節表述：/gu, "本章原文有兩種不同表述："],
  [/這是同一 PDF 的實際矛盾，不能自行抹平。/gu, "這是本章原文的實際矛盾，不能自行抹平。"],
  [/同一 PDF 的 pediatric atropine 起始劑量/gu, "本章原文的 pediatric atropine 起始劑量"],
  [/#### 本 PDF 內的重大兒科劑量矛盾/gu, "#### 本章原文的重大兒科劑量矛盾"],
  [/本 PDF 的 pediatric thiosulfate 劑量/gu, "本章原文的 pediatric thiosulfate 劑量"],
  [/原始章節內部無法自行調和/gu, "本章原文無法自行調和"],
  [
    /- Chapter opener 的 poppy photograph 為裝飾性圖片，沒有臨床內容。/gu,
    "",
  ],
  [
    /> \*\*版本提醒：\*\*以下劑量、疫苗排程、隔離期間與藥物可用性，忠實反映 \*Goldfrank’s Toxicologic Emergencies, 11e\* 本章的資料背景，主要來自 2018 年以前文獻。真實生物事件應服從當時最新的公共衛生、感染管制與災難醫療指引。本章原文另有一處將 \*\*Yersinia pestis\*\* 誤寫為 gram-positive；本指南已校正為 \*\*gram-negative coccobacillus\*\*。/gu,
    "> **版本與安全提醒：**劑量、疫苗排程、隔離期間與藥物可用性主要反映 2018 年以前文獻；真實生物事件應服從當時最新的公共衛生、感染管制與災難醫療指引。本章原文將 **Yersinia pestis** 誤寫為 gram-positive，正確為 **gram-negative coccobacillus**。",
  ],
  [
    /> 本指南以 Goldfrank 11e Chapter 128、A44、A45 的完整 20 頁內容為主，包括正文、Tables 128–1 至 128–4、Figure 128–1、Table\/Figure A44–1、Figure A45–1、圖說與表下注記。原章中的年代性統計與法規數字會標為「原章資料」；核物理錯誤、藥品標示與妊娠安全則另以現行官方資料校正。章內引用的 REMM\/REAC\/TS 外部互動演算法並未嵌入 PDF，因此只核對其現行一般原則，未將外部工具內容冒充為章內資料。/gu,
    "> **版本提醒：**年代性統計與法規數字反映該版資料；核物理、藥品標示與妊娠安全應依現行官方資料校正。REMM／REAC／TS 互動演算法須以現行官方工具與個案情境核對。",
  ],
  [
    /> \*\*年代提醒：\*\*本章的流行病學、醫療利用、成本與資訊科技數據，主要反映第 11 版出版前、約截至 2017–2018 年的歷史證據。專科考試應掌握其\*\*系統原理、資料偏差與公共衛生邏輯\*\*，不宜把舊數字直接視為目前統計或現行地區政策。\s*> 本章沒有獨立的臨床影像或治療流程圖；核心視覺內容為 Table 130–1 與 Table 130–2。/gu,
    "> **年代提醒：**本章的流行病學、醫療利用、成本與資訊科技數據，主要反映第 11 版出版前、約截至 2017–2018 年的歷史證據。專科考試應掌握其**系統原理、資料偏差與公共衛生邏輯**，不宜把舊數字直接視為目前統計或現行地區政策。",
  ],
  [
    /> \*\*資料範圍與時效性：\*\*以下依據 \*Goldfrank’s Toxicologic Emergencies\*, 11e, Chapter 126, pp\.1741–1752。此容屬 2018 年前後的教材資料；其中聯絡電話、PPE 層級運用、自動注射器配置與 hypochlorite 作法可能隨時代、產品濃度及機構規範改變，實際事件應依當地 HAZMAT、毒物中心、公共衛生與災難應變流程。cyanide 的詳細解毒治療留待第 123 章，肺刺激性毒物的完整治療留待第 121 章，亦未提出正式的偵測標準、cholinesterase 數值界線或固定觀察時數。/gu,
    "> **版本提醒：**聯絡電話、PPE 層級運用、自動注射器配置與 hypochlorite 作法反映 2018 年前後資料，可能隨時代、產品濃度及機構規範改變；實際事件應依當地 HAZMAT、毒物中心、公共衛生與災難應變流程。",
  ],
  [
    /> \*\*版本提醒：\*\*本章內容完成於 2018 年，所述法規、機關職掌、電話、網站、資料庫名稱及化學物質數量均屬章節當時的美國制度。臨床實務中的通報、保密與勞工權益，仍須依所在地現行法規確認。本章沒有藥物劑量、解毒劑療程、影像、ECG 或急性中毒處置流程圖；核心在於\*\*辨認職業暴露、建立因果關係、控制危害及履行公共衛生責任\*\*。/gu,
    "> **版本提醒：**本章內容完成於 2018 年，所述法規、機關職掌、電話、網站、資料庫名稱及化學物質數量均屬章節當時的美國制度。臨床實務中的通報、保密與勞工權益，仍須依所在地現行法規確認；核心在於**辨認職業暴露、建立因果關係、控制危害及履行公共衛生責任**。",
  ],
  [
    /所有頁面、表格與圖示均可辨識；但部分數據、人口預測與制度描述屬章節出版時的歷史資料，臨床採用時仍須依現行法規、院內政策及最新藥物安全指引更新。/gu,
    "部分數據、人口預測與制度描述屬章節出版時的歷史資料；臨床採用時仍須依現行法規、院內政策及最新藥物安全指引更新。",
  ],
  [
    /臨床上涉及的是藥害辨識、監測與監管，\*\*沒有提供特定中毒的 antidote dosing、resuscitation、ICU admission、disposition 或 follow-up algorithm\*\*。/gu,
    "本章重點是藥害辨識、監測與監管；個別中毒的 resuscitation、ICU admission、disposition 與 follow-up 應依現行臨床指引處理。",
  ],
  [
    /> \*\*範圍與時效提醒：\*\*本 PDF 前半為 Chapter 139，後半接續 SC11 酒精功能受損評估。SC11 所列法定濃度、州法、判例與交通統計，是本章出版時的美國歷史與法制背景，\*\*不得直接視為 2026 年台灣或任何司法管轄區的現行法律\*\*；實際案件必須查核案發時、案發地的法規與證據規則。/gu,
    "> **法律與時效提醒：**SC11 所列法定濃度、州法、判例與交通統計，是出版時的美國歷史與法制背景，**不得直接視為 2026 年台灣或任何司法管轄區的現行法律**；實際案件必須查核案發時、案發地的法規與證據規則。",
  ],
  [/原始章節有兩處明顯內部不一致/gu, "本章原文有兩處明顯內部不一致"],
];

// The shared sanitizer deliberately removes source-framing prose. A small
// number of source chapters used that prose as the grammatical subject or
// accidentally encoded formulas as Setext headings. These exact, unique
// rewrites repair only the affected clinical passages.
const clinicalLiteralRewrites = [
  [/\n的基本 contrast 原則：/gu, "\nContrast 選擇的基本原則："],
  [/\n的狹義 receptor-based 定義，/gu, "\n依狹義 receptor-based 定義，"],
  [/\n的主要 Ca²⁺ channels 包括：/gu, "\n主要 Ca²⁺ channels 包括："],
  [/\n的早期 biomarkers 仍屬研究性質：/gu, "\n早期 biomarkers 仍屬研究性質："],
  [/black henna tattoos；的 sensitization frequency 約 \*\*5%\*\*。/gu, "black henna tattoos；PPD sensitization frequency 約 **5%**。"],
  [/\n的 triad：\n\n> \*\*microangiopathic hemolytic anemia/gu, "\nAcquired immune TTP 的典型 triad：\n\n> **microangiopathic hemolytic anemia"],
  [/非競技運動者。的較舊研究顯示：/gu, "非競技運動者。較舊研究顯示："],
  [/\n的市售 adulterants：/gu, "\n常見市售 adulterants："],
  [/Amygdalin 是 Rosaceae 果核中的 cyanogenic glycoside。的種子濃度為：/gu, "Amygdalin 是 Rosaceae 果核中的 cyanogenic glycoside。部分種子的 amygdalin 濃度為："],
  [/Overdose reports 缺乏。的核准狀態已具有明顯時效性。/gu, "Overdose reports 缺乏；該藥的核准狀態已具有明顯時效性。"],
  [/對 foxglove 治療 dropsy 的作用作出系統描述。的 2011–2015 年美國 poison-center 歷史資料顯示/gu, "對 foxglove 治療 dropsy 的作用作出系統描述。2011–2015 年美國 poison-center 歷史資料顯示"],
  [/breast milk concentration 約 2–4 mcg\/mL；的乳汁／母體血清比例/gu, "breast milk concentration 約 2–4 mcg/mL；乳汁／母體血清比例"],
  [/Whipped-cream chargers 或 bulbs，俗稱 \*\*whippets\*\*，是常見來源。的歷史性 2015 年資料顯示/gu, "Whipped-cream chargers 或 bulbs，俗稱 **whippets**，是常見來源。2015 年歷史資料顯示"],
  [/High fresh-gas flow 可降低其濃度。的 sevoflurane package labeling 警示：/gu, "High fresh-gas flow 可降低其濃度。該版 sevoflurane package labeling 警示："],
  [/此時尚不可能有 receptor upregulation。的可能機轉是/gu, "此時尚不可能有 receptor upregulation。另一項可能機轉是"],
  [/\n的 log D：/gu, "\n各藥物的 log D："],
  [/\n的整體結構比較，/gu, "\n整體結構比較顯示，"],
  [/Ethanol 不只存在於酒類。的暴露來源包括：/gu, "Ethanol 不只存在於酒類。其他暴露來源包括："],
  [/PPI 提高 gastric pH，可使 colloidal bismuth subcitrate 更可溶並增加吸收。的 2 週療程研究顯示/gu, "PPI 提高 gastric pH，可使 colloidal bismuth subcitrate 更可溶並增加吸收。一項 2 週療程研究顯示"],
  [/部分 malignancy 風險增加有關。的試驗顯示/gu, "部分 malignancy 風險增加有關。一項試驗顯示"],
  [/\n的 extremity regimen 為：/gu, "\nExtremity infusion regimen 為："],
  [/眼部 exposure 應早期 ophthalmology。的 ophthalmologist-directed regimen 為：/gu, "眼部 exposure 應早期 ophthalmology consultation。一項 ophthalmologist-directed regimen 為："],
  [/\n的概括：\n\n- \*\*Phase 2a\*\*/gu, "\nPhase 2 的概括：\n\n- **Phase 2a**"],
  [/\n的 medication-use system。/gu, "\n這些要素共同構成成熟的 medication-use system。"],
  [/\n的交互作用。上市後很快又累積更多涉及不同 CYP pathways 的 DDI。/gu, "\nInitial label 已列出上述交互作用；上市後很快又累積更多涉及不同 CYP pathways 的 DDI。"],
  [/\n的 chronological custody。其目的在防止污染、調包或身分錯置。/gu, "\n上述 chronological custody 的目的在防止污染、調包或身分錯置。"],
  [/\\text\{Measured serum osmolality\}\n\n\\text\{Calculated serum osmolarity\}/gu, "\\text{Measured serum osmolality}\n-\n\\text{Calculated serum osmolarity}"],
  [
    /\\frac\{C_\{\\text\{measured\}\}\}\n\{\(0\.25\\times albumin,\[g\/dL\]\)\+0\.1\}/gu,
    "\\frac{C_{\\text{measured}}}{0.25\\times \\mathrm{albumin}\\ (\\mathrm{g/dL})+0.1}",
  ],
  [
    /9\. \\frac\{14\}\{0\.25\(2\)\+0\.1\}\n\n23\.3\\text\{ mg\/L\}/gu,
    "\\frac{14}{0.25(2)+0.1}=23.3\\ \\mathrm{mg/L}",
  ],
  [
    /\[\n\[H\^\+\] = 10\^\{-3\};M,\\quad pH=3\n\]/gu,
    "$$$$\n[H^+] = 10^{-3}\\ \\mathrm{M},\\quad \\mathrm{pH}=3\n$$$$",
  ],
  [/\* ：若低於 30°C 的初次電擊無效/gu, "* **再電擊時機**：若低於 30°C 的初次電擊無效"],
  [
    /\[\n\[PG\];\(\\mathrm\{mg\/dL\}\)=-82\.1\+6\.5\\times\(\\mathrm\{osmolar\\ gap\}\)\n\]/gu,
    "$$$$\n[\\mathrm{PG}]\\ (\\mathrm{mg/dL})=-82.1+6.5\\times(\\mathrm{osmolar\\ gap})\n$$$$",
  ],
  [/原書\?sfvrsn=33b348e_2\)/gu, ""],
  [
    /成人建議：\n\n# Hydrofluoric Acid and Fluorides\n\n20\\ \\text\{mL of 20% solution\}/gu,
    "成人建議：\n\n$$$$\n\\text{Magnesium sulfate }4\\ \\mathrm{g}=20\\ \\mathrm{mL\\ of\\ 20\\%\\ solution}\n$$$$",
  ],
  [
    /25\\ \\text\{mL of 10% calcium gluconate\}\n\+\n75\\ \\text\{mL water-soluble lubricant\}/gu,
    "$$$$\n25\\ \\text{mL of 10\\% calcium gluconate}\n+\n75\\ \\text{mL water-soluble lubricant}\n$$$$",
  ],
  [
    /10\\ \\text\{mL of 10% calcium gluconate\}\n\+\n40\\ \\text\{mL D5W 或 NS\}/gu,
    "$$$$\n10\\ \\text{mL of 10\\% calcium gluconate}\n+\n40\\ \\text{mL D5W 或 NS}\n$$$$",
  ],
  [
    /用概念式：\n\n其中 為 absorbed dose， 為 radiation weighting， 為 tissue weighting。/gu,
    "教學概念式為：\n\n$$$$\nE\\approx D\\times w_R\\times w_T\n$$$$\n\n其中 **D** 為 absorbed dose，**w_R** 為 radiation weighting，**w_T** 為 tissue weighting。",
  ],
  [
    /- ：neutrophil-to-lymphocyte ratio。\n- ：無 emesis。\n- ：有 emesis。/gu,
    "$$$$\nT=\\frac{N}{L}+E\n$$$$\n\n- **N/L**：neutrophil-to-lymphocyte ratio。\n- **E=0**：無 emesis。\n- **E=1**：有 emesis。",
  ],
  [
    /(?:原章)?設定 。下降愈快通常代表 dose 愈高，但感染、藥物、trauma、stress response 與 baseline hematologic disease 都會干擾。/gu,
    "原章以 serial absolute lymphocyte count 的下降速度作為 dose-estimation 線索。下降愈快通常代表 dose 愈高，但感染、藥物、trauma、stress response 與 baseline hematologic disease 都會干擾。",
  ],
  [
    /### 25\.1 Widmark equation\n\n其中：\n\n- ：採樣時體內已達平衡的 ethanol amount；\n- ：blood ethanol concentration；\n- ：body weight；\n- ：water-distribution factor，約女性 \*\*0\.6\*\*、男性 \*\*0\.7\*\*。/gu,
    "### 25.1 Widmark equation\n\n$$$$\nA=C\\times W\\times r\n$$$$\n\n其中：\n\n- **A**：採樣時體內已達平衡的 ethanol amount；\n- **C**：blood ethanol concentration；\n- **W**：body weight；\n- **r**：water-distribution factor，約女性 **0.6**、男性 **0.7**。",
  ],
];

function normalizeMarkdown(markdown) {
  return `${markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

function cleanedLinkTarget(value) {
  try {
    const url = new URL(value);
    url.searchParams.delete("utm_source");
    return url.toString();
  } catch {
    return value.replace(/([?&])utm_source=chatgpt\.com(?:&|$)/giu, "$1").replace(/[?&]$/u, "");
  }
}

function collapseRepeatedLabel(value) {
  let label = value.replace(/!\[\]\(https:\/\/www\.google\.com\/s2\/favicons\?[^)]+\)/giu, "");
  label = label.replace(/\+\d+(?=\D|$)/gu, "").trim();
  if (label.length % 2 === 0 && label.slice(0, label.length / 2) === label.slice(label.length / 2)) {
    label = label.slice(0, label.length / 2);
  }
  return label || "官方資料";
}

function officialLinkLabel(label, target) {
  let hostname = "";
  try {
    hostname = new URL(target).hostname.toLowerCase();
  } catch {
    return collapseRepeatedLabel(label);
  }
  const officialLabels = [
    [/dailymed\.nlm\.nih\.gov$/u, "DailyMed"],
    [/(?:^|\.)fda\.gov$/u, "FDA"],
    [/(?:^|\.)cdc\.gov$/u, "CDC"],
    [/(?:^|\.)nist\.gov$/u, "NIST"],
    [/pubmed\.ncbi\.nlm\.nih\.gov$/u, "PubMed"],
    [/(?:^|\.)osha\.gov$/u, "OSHA"],
    [/(?:^|\.)federalregister\.gov$/u, "Federal Register"],
    [/(?:^|\.)pfizer\.com$/u, "Pfizer"],
  ];
  return officialLabels.find(([pattern]) => pattern.test(hostname))?.[1]
    || collapseRepeatedLabel(label);
}

function cleanCitationWidgets(markdown) {
  return markdown
    .replace(/\[([^\]]*google\.com\/s2\/favicons[^\]]*)\]\((https?:\/\/[^)\s]+)\)/giu, (_whole, label, target) => (
      `[${officialLinkLabel(label, target)}](${cleanedLinkTarget(target)})`
    ))
    .replace(/!\[\]\(https:\/\/www\.google\.com\/s2\/favicons\?[^)]+\)/giu, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/giu, (_whole, label, target) => (
      `[${officialLinkLabel(label, target)}](${cleanedLinkTarget(target)})`
    ))
    .replace(/(https?:\/\/[^\s)>]+)/giu, (url) => cleanedLinkTarget(url));
}

function removeSourceInventoryBlocks(markdown) {
  return markdown
    .split(/\n\s*\n/gu)
    .filter((block) => {
      const value = block.trim();
      return value
        && !sourceCitationBlockPattern.test(value)
        && !pureInventoryBlockPatterns.some((pattern) => pattern.test(value));
    })
    .join("\n\n");
}

function removeEmptyInventoryHeadings(markdown) {
  return markdown
    .replace(/^#{2,6}[ \t]+\d+(?:\.\d+)*\.?[ \t]*$/gmu, "")
    .replace(/^### 10\.1 視覺內容[ \t]*$/gmu, "")
    .replace(/^### 12\.1 視覺內容與資料限制[ \t]*$/gmu, "");
}

export const goldfrankProductionLanguagePattern = productionLanguagePattern;

export function sanitizeGoldfrankProductionNotes(markdown) {
  let learner = cleanCitationWidgets(markdown);
  for (const [pattern, replacement] of literalRewrites) learner = learner.replace(pattern, replacement);
  for (const [pattern, replacement] of clinicalLiteralRewrites) learner = learner.replace(pattern, replacement);
  learner = removeSourceInventoryBlocks(learner);
  learner = learner
    .replace(/該交叉參照內容不在PDF 中，故不推測其內容。/gu, "本章未涵蓋該交叉參照內容，因此不延伸未提供的細節。")
    .replace(/未包含在PDF 中/gu, "未隨本章提供")
    .replace(/未包含於PDF/gu, "未隨本章提供")
    .replace(/不在PDF 內/gu, "未隨本章提供")
    .replace(/不在本 PDF/gu, "未隨本章提供")
    .replace(/原 PDF/gu, "本章原文")
    .replace(/目前 PDF/gu, "該版內容")
    .replace(/本 PDF/gu, "本章原文")
    .replace(/同一 PDF/gu, "本章原文")
    .replace(/(^|[。！？；;]\s*)指出/gmu, "$1資料顯示")
    .replace(/(^|[。！？；;]\s*)列出/gmu, "$1包括")
    .replace(/(^|[。！？；;]\s*)提及/gmu, "$1相關資料提及")
    .replace(/(^|[。！？；;]\s*)認為/gmu, "$1當時資料認為")
    .replace(/(^|[。！？；;]\s*)記載/gmu, "$1原文記載")
    .replace(/(^|[。！？；;]\s*)稱/gmu, "$1原文稱")
    .replace(/(^|[。！？；;]\s*)(?:描述|引用|引述|報告|說明|呈現)/gmu, "$1資料顯示")
    .replace(/(^|[。！？；;]\s*)提出/gmu, "$1當時文獻提出")
    .replace(/[ \t]+\n/gu, "\n");
  learner = removeEmptyInventoryHeadings(learner);
  return normalizeMarkdown(learner);
}

export function sanitizeGoldfrankGuideMarkdown(markdown) {
  return sanitizeGoldfrankProductionNotes(sanitizeStudyGuideMarkdown(markdown));
}
