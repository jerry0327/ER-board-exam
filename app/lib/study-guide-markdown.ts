import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { tintDetailedOpeningLiteralRewrites } from "./study-guide-corrections-tint-detailed.ts";
import { tintConciseOpeningLiteralRewrites } from "./study-guide-corrections-tint-concise.ts";
import { rosensOpeningLiteralRewrites } from "./study-guide-corrections-rosens.ts";

type GuideNode = {
  type: string;
  value?: string;
  depth?: number;
  children?: GuideNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

type ParsedNode = {
  node: GuideNode;
  raw: string;
  text: string;
  heading: { depth: number; label: string } | null;
};

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/**
 * Keep the learner-facing document heading aligned with the canonical
 * textbook catalog without rewriting any chapter body content. The first
 * root H1 is replaced in place; a missing H1 is added once at the start.
 */
export function normalizeStudyGuideDocumentTitle(markdown: string, documentTitle: string) {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  const title = documentTitle.replace(/[\t\n ]+/gu, " ").trim();
  if (!title) return normalized;

  // Every published guide currently uses an ATX document title. Scan that
  // common path without parsing the entire (often very long) chapter, while
  // still ignoring heading-looking lines inside fenced code blocks.
  let offset = 0;
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of normalized.split("\n")) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null;
    } else if (!fence && /^ {0,3}#(?:[\t ]+|$)/u.test(line)) {
      return `${normalized.slice(0, offset)}# ${title}${normalized.slice(offset + line.length)}`;
    }
    offset += line.length + 1;
  }

  // Preserve compatibility with a possible Setext H1 or another valid root
  // heading form before deciding that the document truly has no title.
  const tree = parser.parse(normalized);
  const parsedHeading = (tree.children as unknown as GuideNode[]).find((node) => (
    node.type === "heading"
    && node.depth === 1
    && Number.isInteger(node.position?.start?.offset)
    && Number.isInteger(node.position?.end?.offset)
  ));
  const start = parsedHeading?.position?.start?.offset;
  const end = parsedHeading?.position?.end?.offset;
  if (typeof start === "number" && typeof end === "number" && end > start) {
    return `${normalized.slice(0, start)}# ${title}${normalized.slice(end)}`;
  }

  return normalized ? `# ${title}\n\n${normalized}` : `# ${title}\n`;
}

const internalBlockPattern = /<!--[\t ]*INTERNAL_(?:SOURCE_)?REVIEW_START[\t ]*-->[\s\S]*?<!--[\t ]*INTERNAL_(?:SOURCE_)?REVIEW_END[\t ]*-->/giu;
const explicitOpeningEditorialLabelPattern = /^(?:版本與使用提醒|(?:重大)?時代性提醒|臨床更新重點|資料來源|來源與範圍|來源完整性與臨床使用注意|版本提醒|版次提醒|使用提醒|編輯說明|適用性提醒|制度適用範圍|教材說明|內容說明|最重要限制|資料時效|(?:重大)?更新提醒|法規與資源警示|時效與語言警示|時效、制度與用藥警示|法律與制度警示|時效與操作安全警示|用藥提醒|藥物劑量說明|章內用藥資料警示|章內分類提醒|原章的重要安全勘誤|來源文字注意|圖說校讀|範圍提醒|時效、法規與病人安全警示)$/u;
const explicitOpeningEditorialLanguagePattern = /(?:本指南(?:整合|以|依)|依上傳章節|上傳章節|(?:原\s*)?PDF|原電子版|內部標示為\s*Chapter|本章(?:部分|中的|主要反映|內容約反映|大量引用|涵蓋|實際聚焦|沒有|原電子版|為\s*(?:19|20)\d{2}[- ]?era)|以下(?:依|以|忠實|完整|均保留|是依)[^。；\n]{0,100}(?:整理|整合|重組|保留|內容)|供(?:章節|專科考試)|準備(?:本章|考試)|實際臨床[^。；\n]{0,80}(?:依|核對|配合)|應(?:再)?依(?:現行|最新)|版本(?:時點|差異|性|提醒)|時效(?:提示|提醒)|適用範圍|資料年代提醒|來源陷阱|來源與版本|原章|原書(?:內容|成人|原文|使用|的獨立)|教科書|本章引用|本版教材|第\s*[九9]\s*版|抗生素表引用|考試與概念價值|適合作為本章考題|實際作業須依|Tintinalli(?:['’]s)?[^。；\n]{0,80}(?:9e|第\s*9\s*版)|Rosen['’]?s[^。；\n]{0,80}(?:10e|第\s*10\s*版)|source\s+table|不是現行(?:臨床)?[^。；\n]{0,50}(?:表|時程|方案)|本章出版時|章節出版時|資料與指引年代|不應視為即時|不是個案法律意見|外部連結|腳註[^。；\n]{0,60}(?:缺失|未顯示|未展開)|轉檔|排版錯誤|typo|完整\s*reference list|章末題解|Rosen['’]s Emergency Medicine[^。\n]{0,80}(?:Chapter|Ch\.|pp\.)|藥物劑量依病人體重[^。；\n]{0,80}protocol)/iu;
const productionHeadingPattern = /^(?:(?:第\s*\d+\s*章|本章|原章)\s*)?(?:來源(?:定位|[、，與].*(?:審閱|核對|稽核|檢查|紀錄)|與範圍)?|章節(?:識別|定位|範圍(?:與完整性)?)|資料範圍限制|章內可存取性說明|可存取性說明|審閱範圍|版本與(?:審閱|視覺|使用|用藥|安全)|視覺(?:審閱|核對|檢查)|完整性檢查|圖表.*(?:核對|審閱|稽核)|表格.*(?:核對|審閱|稽核)|製作.*(?:紀錄|流程)|工作(?:流程|紀錄)|生產.*紀錄|版本(?:提醒|警示|註記)|內容(?:範圍|說明)|教材說明|資料年代提醒)$/iu;
const openingProductionSubheadingPattern = /(?:先處理)?版本差異|哪些內容不能直接當成現行標準|來源完整性|圖表與編輯問題|PDF\s*(?:限制|問題)|原文(?:矛盾|勘誤)|資料(?:來源|校正)|出版時(?:點|資料)/iu;
const openingMajorHeadingOverrides: Record<string, string> = {
  "食道、胃與十二指腸": "先辨認不能等待的上消化道急症",
  "Brain and Cranial Nerve Disorders": "神經定位與危險病灶辨識",
  "Dermatologic Presentations": "危險皮膚表現的第一輪辨識",
  "White Blood Cell Disorders": "白血球異常的急診判讀流程",
  "Electrolyte Disorders｜電解質異常": "電解質異常的共同評估框架",
  "Diabetes Mellitus and Disorders of Glucose Homeostasis": "高血糖危象與低血糖的急診總覽",
  "新生兒復甦（Neonatal Resuscitation）": "新生兒復甦的核心決策",
  "Pediatric Musculoskeletal Disorders｜兒童肌肉骨骼疾病": "兒童骨骼的結構與風險判讀",
  "Blood Gases, Pulse Oximetry, and Capnography": "檢體可靠性與通氣、氧合、酸鹼判讀",
  "抗心律不整藥與降血壓藥之藥理學": "先預測藥物對自律性、傳導與不反應期的影響",
  "Post–Cardiac Arrest Syndrome": "復甦後先穩定氧合、灌流與神經保護",
  "Ethical Issues of Resuscitation": "先釐清病人意願、醫療效益與決策權責",
  "Cardiac Pacing and Implanted Defibrillation": "先辨認需要立即電氣治療的節律",
  "Local and Regional Anesthesia": "先選擇安全且足夠的局部麻醉策略",
  "成人程序鎮靜與止痛": "鎮靜前先完成風險分層與救援準備",
  "傷口評估": "先排除深部結構損傷與高風險污染",
  "顏面與頭皮撕裂傷": "先辨認危及功能與外觀的深部損傷",
  "Arm, Forearm, and Hand Lacerations": "先確認肌腱、神經、血管與關節完整性",
  "Thigh, Leg, and Foot Lacerations": "先排除深部結構損傷與缺血",
  "軟組織異物": "先定位異物並判斷取出風險",
  "穿刺傷與咬傷": "先辨認深部感染、異物與特殊暴露",
  "急性冠心症": "先以症狀、心電圖與心肌損傷指標分層",
  "Aortic Dissection and Related Aortic Syndromes": "先辨認急性主動脈症候群的高風險線索",
  "急性氣喘與氣喘重積狀態": "先判斷呼吸衰竭與即將疲乏",
  "Upper Gastrointestinal Bleeding": "先穩定循環並辨認高風險出血",
  "一般外科手術併發症": "先辨認需要立即手術處置的併發症",
  "Complications of Urologic Procedures and Devices": "先辨認阻塞、感染、出血與裝置失效",
  "非妊娠女性的腹部與骨盆疼痛": "先排除出血、扭轉、感染與妊娠相關急症",
  "Maternal Emergencies After 20 Weeks of Pregnancy and in the Peripartum Period": "先穩定母體並辨認高血壓、出血與感染急症",
  "Pelvic Inflammatory Disease": "先評估感染嚴重度與輸卵管卵巢膿瘍",
  "婦科處置併發症": "先辨認出血、感染、穿孔與器材併發症",
  "Emergency Care of Children": "兒童急診先以外觀、呼吸與循環快速分層",
  "新生兒與兒童轉送": "轉送前先穩定氣道、呼吸、循環與體溫",
  "嬰幼兒與兒童眼科急症": "先保護視力並排除眼球與眼眶急症",
  "嬰幼兒與兒童頸部腫塊": "先排除氣道威脅與深頸部感染",
  "嬰幼兒與兒童喘鳴": "先區分細支氣管炎、氣喘與異物吸入",
  "兒童暈厥、心律不整與心電圖判讀": "先辨認心因性暈厥與危險心律",
  "嬰幼兒與兒童急性腹痛": "先排除扭轉、阻塞、腸套疊與闌尾炎",
  "Gastrointestinal Bleeding in Infants and Children": "先穩定循環並依年齡定位出血來源",
  "嬰幼兒與兒童泌尿道感染": "先辨認敗血症、腎盂腎炎與泌尿道異常",
  "嬰幼兒與兒童血液急症": "先辨認出血、溶血與骨髓衰竭",
  "嬰幼兒與兒童代謝急症": "從類似敗血症的表現辨識代謝急症",
  "Rashes in Infants and Children": "先釐清暴露史與高風險感染線索",
  "自發性蛛網膜下腔出血與腦內出血": "先辨認非外傷性顱內出血",
  "Ataxia and Gait Disturbances": "急性步態異常的初步分流",
  "中樞神經系統程序與裝置": "先辨認感染、阻塞、出血與裝置失效",
  "Monoamine Oxidase Inhibitors": "先辨認 serotonin toxicity 與高血壓急症",
  "Hyperosmolar Hyperglycemic State": "極度游離水缺失與高滲透壓是處置核心",
  "Hyperthyroidism and Thyroid Storm": "先辨認甲狀腺風暴與器官失代償",
  "Anemia and Polycythemia": "先判斷氧輸送不足、溶血與高黏滯風險",
  "皮膚疾病的初始評估與處置": "皮膚病灶的初步危險分流",
  "Skin Disorders—Groin and Skinfolds": "先依分布辨識皺褶部位病灶",
  "側腹與臀部創傷": "先排除後腹腔、骨盆與大血管損傷",
  "肘與前臂損傷": "肘與前臂損傷的初步檢查",
  "髖部與股骨損傷": "先處理出血、脫位與高能量骨折",
  "非外傷性手部疾病": "非外傷性手部疾病的初步分流",
  "足部軟組織問題": "足部軟組織問題的初步分流",
  "Injection Drug Users": "注射藥物使用者的四類急診風險",
  "精神健康疾患：急診評估與處置": "先評估自傷、他傷、譫妄與決策能力",
  "移植病人": "先辨認感染、排斥與免疫抑制併發症",
  "死亡告知與預立醫療指示": "先確認資訊、決策者與溝通目標",
  "Procedural Sedation and Analgesia": "鎮靜前先完成風險分層與救援準備",
  "成人發燒": "先判斷不穩定、高體溫與需要立即抗感染治療的情境",
  "噁心與嘔吐": "先排除阻塞、中樞病灶、毒物與代謝急症",
  "Genitourinary Trauma": "先辨認腎臟、輸尿管、膀胱與尿道損傷",
  "周邊血管創傷": "先辨認出血、缺血與需要立即重建的損傷",
  "General Principles of Orthopedic Injuries": "先確認神經血管、開放傷與關節穩定性",
  "手腕與前臂損傷": "先辨認隱匿骨折與神經血管損傷",
  "Humerus and Elbow Injuries": "先確認關節對位、神經與血管完整性",
  "Femur and Hip Injuries": "先處理出血、脫位與高能量骨折",
  "Ankle and Foot Injuries": "先辨認不穩定骨折、Lisfranc 與距骨損傷",
  "Implantable Cardiac Devices": "先辨認裝置失效與需要立即電氣治療的節律",
  "Pericardial and Myocardial Disease": "先排除心包填塞、心肌炎與高風險心包炎",
  "感染性心內膜炎與瓣膜性心臟病": "先辨認敗血症、急性瓣膜失代償與栓塞",
  "腹主動脈瘤": "先辨認破裂或即將破裂的腹主動脈瘤",
  "肝臟與膽道疾病": "先排除膽管炎、急性肝衰竭與高風險阻塞",
  "Factitious Disorders and Malingering": "先排除真實急症，再評估症狀產生的動機",
  "Thyroid and Adrenal Disorders": "先辨認甲狀腺風暴、黏液水腫昏迷與腎上腺危象",
  "皮膚與軟組織感染": "先辨認壞死性感染、深部膿瘍與全身毒性",
  "中毒病人的整體處置": "先穩定 ABC，再以 toxidrome 與暴露史定位",
  "Plants, Herbal Medications, and Mushrooms": "先依臨床症候群與潛伏期判斷毒性",
  "Care of the Pediatric Patient": "兒童急診先以外觀、呼吸與循環快速分層",
  "兒童呼吸道處置": "先辨認即將呼吸衰竭並準備分級氣道策略",
  "兒童復甦": "先依年齡與體重同步處理氧合、通氣與灌流",
  "兒童心臟疾病": "先辨認休克、低氧與危險心律",
  "小兒胃腸道疾病": "先排除阻塞、扭轉、出血與腹膜炎",
  "妊娠併發症": "先排除異位妊娠、出血與妊娠高血壓急症",
  "妊娠期藥物治療": "以母體穩定與胎兒風險共同決定用藥",
  "高齡病人的急診照護": "先辨認非典型表現、衰弱與功能基線改變",
  "高齡藥物治療": "先辨認多重用藥、腎功能與交互作用風險",
  "高齡者虐待與忽視": "先辨認敘述矛盾、功能依賴與安全風險",
  "實體器官移植病人的急診處置": "先辨認感染、排斥與免疫抑制併發症",
  "重度肥胖病人的急診照護": "先處理氣道、通氣、搬運與劑量估算風險",
  "具攻擊性與難以應對的病人": "先確保安全並排除譫妄、毒物與器質性病因",
  "Multiculturalism, Diversity, and Care Delivery": "以語言、文化與信任改善急診決策",
  "Quality Improvement and Patient Safety": "先辨認系統風險並建立可衡量的改善循環",
  "Air Medical Transport": "先判斷轉送效益、風險與任務適配性",
  "Gastrointestinal Procedures and Devices": "先確認適應症、氣道安全、位置與管路成熟度",
  "Nose and Sinus Disorders in Infants and Children": "先區分細菌性鼻竇炎、鼻腔異物與高風險鼻出血",
  "Acetaminophen 中毒": "早期無症狀也不能排除嚴重中毒",
  "Beta-Blockers": "嚴重中毒的核心是灌流失敗",
  "Vitamins and Herbals": "Natural、vitamin 與 dietary supplement 都可能造成毒性",
  "Heat Emergencies": "先判斷有無 CNS dysfunction",
  "Systemic Rheumatic Diseases": "系統性風濕病可造成多器官急症",
  "Anticholinergics": "先辨認 anticholinergic toxidrome 與 sodium-channel toxicity",
};
const learnerFacingHeadingRewrites: ReadonlyArray<readonly [RegExp, string]> = [
  [/急診(?:最重要的|的核心)原則\s*[：:]\s*先隔離，再證實/u, "急診的核心原則：先隔離，再證實"],
  [/先抓住核心\s*[：:]\s*T1DM不是「血糖高」，而是\s*絕對\s*insulin不足/iu, "T1DM 的核心是絕對 insulin 不足"],
  [/HHS的本質\s*[：:]\s*不是「血糖比DKA更高」，而是\s*極度\s*free-water deficit\s*[＋+]\s*hyperosmolality/iu, "HHS 的本質：極度 free-water deficit 與 hyperosmolality"],
  [/先(?:改掉|修正)最危險的直覺\s*[：:]\s*體重正常，不代表(?:風險低|營養風險低)/u, "體重正常不代表營養風險低"],
  [/整章最重要的臨床原則/u, "外觀與 walking status 不能排除深部爆炸傷"],
  [/這章不是藥名背誦，而是「給藥前先預測會把\s*conduction\s*推向哪裡」/iu, "給藥前先預測對 automaticity、conduction 與 refractory period 的影響"],
  [/這章真正要教的\s*[：:]?\s*把「看起來像\s*sepsis」的代謝病抓出來/iu, "從類似 sepsis 的表現辨識代謝急症"],
  [/這章有兩條線\s*[：:]\s*治療劑量的不良反應，比\s*acute overdose\s*更常造成重病/iu, "治療劑量不良反應常比 acute overdose 更嚴重"],
  [/整章只先問一件事\s*[：:]\s*病人能不能維持\s*upper airway[？?]?/iu, "先判斷病人能否維持 upper airway"],
  [/先抓住的兩個時間軸/u, "先掌握兩條關鍵時間軸"],
  [/Table\s*5-1\s*的分類，不是互斥標籤/iu, "災難分類可同時重疊"],
  [/Table\s*25-1\s*的臨床意義/iu, "妊娠生理變化對復甦的影響"],
  [/主要\s*indications\s*[（(]\s*Table\s*33-1\s*[）)]/iu, "Pericardiocentesis 的主要適應症"],
  [/Table\s*91-5\s*的\s*outpatient regimen/iu, "Outpatient antimicrobial regimens"],
  [/Table\s*91-6\s*的\s*inpatient options/iu, "Inpatient antimicrobial options"],
  [/Table\s*121-1\s*[：:]\s*耳痛鑑別/iu, "耳痛的鑑別診斷"],
  [/Table\s*123-1\s*[：:]\s*三種可診斷的病程\s*pattern/iu, "三種具診斷價值的病程 pattern"],
  [/立即提高風險的線索\s*[（(]\s*Table\s*130-2\s*[）)]/iu, "立即提高風險的線索"],
  [/Table\s*165-1\s*[：:]\s*高風險\s*red flags/iu, "高風險 red flags"],
  [/time goals\s*[（(]\s*Table\s*167-8\s*概念\s*[）)]/iu, "Stroke evaluation 的時間目標"],
  [/先判斷\s*central\s*還是\s*peripheral\s*[（(]\s*Table\s*172-1\s*[）)]/iu, "先區分 central 與 peripheral vertigo"],
  [/Contraindications\s*[（(]\s*Table\s*175-1\s*[）)]/iu, "Lumbar puncture 的禁忌與延後條件"],
  [/Table\s*198-2\s*的兩組數字不可混淆/iu, "兩組血中濃度數值的判讀"],
  [/Table\s*201-2\s*[：:]\s*三層表型/iu, "Cholinergic crisis 的 receptor-specific 表型"],
  [/Table\s*201-3\s*[：:]\s*治療流程/iu, "Organophosphate／carbamate 治療流程"],
  [/Table\s*201-6\s*[：:]\s*non-anticoagulant rodenticides/iu, "Non-anticoagulant rodenticides"],
  [/Table\s*203-2\s*整合/iu, "Lead toxicity 的系統表現"],
  [/Table\s*203-3\s*(?:source-era\s*)?chelation guide/iu, "Lead chelation"],
  [/Table\s*203-4/iu, "Arsenic toxicity 的時間軸"],
  [/Table\s*203-6\s*(?:source\s*)?chelation/iu, "Mercury chelation"],
  [/Less common metals\s*[（(]\s*Table\s*203-7\s*[）)]/iu, "Less common metals"],
  [/Table\s*205-1\s*[：:]\s*Hypervitaminosis總表/iu, "Hypervitaminosis 的主要表現與處置"],
  [/Table\s*205-2\s*[：:]\s*「Generally safe」仍可能嚴重/iu, "高劑量 vitamin 的嚴重毒性"],
  [/Figure\s*207-1\s*[：:]\s*Fe²⁺變Fe³⁺之後，oxygen為什麼送不到組織[？?]?/iu, "Methemoglobin 造成組織缺氧的機轉"],
  [/Figure\s*207-2\s*[：:]\s*為何\s*50%\s*MetHb\s*比\s*50%\s*anemia\s*更危險[？?]?/iu, "Methemoglobinemia 與 anemia 的氧輸送差異"],
  [/Figure\s*207-3\s*[：:]\s*cyanotic patient的實用算法/iu, "Cyanotic patient 的評估流程"],
  [/Table\s*299-1\s*的核心語彙/iu, "Transgender healthcare 的核心語彙"],
  [/Fig(?:ure)?\.?\s*18\.8\s*的急診分流邏輯/iu, "急診分流邏輯"],
  [/Fig(?:ure)?\.?\s*82\.2\s*[：:]\s*症狀導向鑑別演算法/iu, "症狀導向鑑別流程"],
  [/Fig(?:ure)?\.?\s*83\.1\s*的床邊化流程/iu, "床邊判讀流程"],
  [/IHS\s*的\s*14\s*類頭痛分類\s*[（(]\s*Box\s*89\.1\s*[）)]/iu, "IHS 的 14 類頭痛分類"],
  [/Figure\s*104\.1\s*的急診風險分層/iu, "急診風險分層"],
  [/Table\s*109\.1/iu, "正常 hemogram 參考值"],
  [/Table\s*120\.1/iu, "臨床判讀重點"],
  [/先建立整章臨床地圖/u, "冷傷的臨床分類"],
  [/先建立整章的臨床模型/u, "臨床分類與處置架構"],
  [/章節核心\s*[：:]?/u, "核心概念："],
  [/先建立整章(?:的)?\s*/u, "建立"],
  [/先掌握整章主線/u, "早期無症狀不代表安全"],
  [/先抓住整章主軸/u, "先判斷有無 CNS dysfunction"],
  [/整章最重要的診斷分岔/u, "最重要的診斷分岔"],
  [/整章的核心/u, "核心概念"],
  [/整章核心/u, "核心概念"],
  [/這一章最重要的急診概念/u, "嚴重出血應先補充凝血因子"],
  [/這不是「關節痛章節」/u, "系統性風濕病可造成多器官急症"],
  [/先把整章濃縮成急診的四個問題/u, "急診先回答四個問題"],
  [/這章真正要學的是\s*[：:]\s*先排除\s*secondary headache，再談\s*migraine/iu, "先排除 secondary headache，再評估 migraine"],
  [/先用「缺陷在哪裡」理解整章/u, "依缺陷位置分類"],
  [/整章最重要的觀念\s*[：:]\s*醫療與採證是兩條平行但獨立的路徑/u, "醫療與採證是平行且獨立的流程"],
  [/這一章要用同一套思路讀/u, "電解質異常的共同判讀框架"],
  [/這一章要先建立的臨床框架/u, "腹痛的危險分流與臨床框架"],
  [/這一章真正要記住的不是「多少濃度」，而是三件事/u, "Salicylate 中毒的 pH、通氣與透析時機"],
  [/^(\d+(?:\.\d+)*\.?\s+)?(?:Fig(?:ure)?|Table|Box)\.?\s*\d+(?:[A-Za-z]|\.\d+|-\d+)*(?:\s*[～~–—-]\s*\d+(?:\.\d+)*)?\s*(?:的|[：:｜|])?\s*/iu, "$1"],
];

const learnerFacingTextRewrites: ReadonlyArray<readonly [RegExp, string]> = [
  [/Table\s*6-1\s*的時間軸是整章最重要的框架\s*[：:]/iu, "災後疾病負擔可依 acute、immediate postevent 與 recovery 三階段判讀："],
  [/本章最重要的觀念\s*[：:]\s*急診治療的不是血壓計上的數字，而是血壓造成或惡化的急性\s*target-organ injury/iu, "急診治療的目標不是血壓數字本身，而是血壓造成或惡化的急性 target-organ injury"],
  [/本章定位\s*[：:]\s*急診神經學檢查不是追求「形式上的完整」[^。]*[。]?/u, "急診神經學檢查應針對當下臨床問題，依序判斷是否有病灶、病灶位置與可能病因。"],
  [/急診定位\s*[：:]\s*本章不是要在\s*ED\s*重新確診所有慢性神經病[^。]*[。]?/iu, "慢性神經疾病急診評估的重點，是辨識呼吸／吞嚥失代償、感染、藥物中斷、iatrogenic worsening 與照護資源崩解。"],
  [/Table\s*79-3\s*的\s*建議為\s*Lactated Ringer['’]s\s*2\.5[–—-]4\s*L[^。]*[。]?/iu, "初始補液可使用 Lactated Ringer’s，並依 HR、MAP、尿量、creatinine 與 hematocrit 頻繁重評。"],
  [/有\s*acute cholangitis\s*或持續\s*CBD obstruction\s*者需早期\s*ERCP\s*[；;]\s*24\s*小時內為\s*參考[。]?/iu, "有 acute cholangitis 或持續 CBD obstruction 時應安排早期 ERCP；時機依病情與現行流程決定。"],
  [/No proven antidote[。.]Steroid\s*[／/]\s*cyclophosphamide資料互相矛盾[；;]列dexamethasone\s*(?:source\s*)?regimen，但不可當普遍standard[。]?/iu, "目前沒有已證實的 antidote；steroid／cyclophosphamide 證據不一致，dexamethasone 不應視為常規治療。"],
  [/Below上述(?:source\s*)?threshold/iu, "低於上述 blood-level threshold 且無症狀"],
  [/Table\s*203-5\s*(?:source\s*)?regimen\s*[：:]/iu, "嚴重 arsenic 中毒的 chelation 方案可使用："],
  [/symptomatic\s*[，,]\s*或(?:source-era\s*)?metHb\s*>\s*25%\s*[：:]\s*methylene blue/iu, "有症狀者，或 metHb 顯著升高且具高風險特徵者：評估使用 methylene blue"],
  [/Table\s*4-1\s*可濃縮為四大規劃軸/iu, "大型活動醫療規劃可分為四軸"],
  [/Figure\s*26-1\s*把流程畫成\s*/iu, "缺血後再灌流可依序造成 "],
  [/Table\s*29A-1\s*的實用版\s*[：:]\s*/iu, "插管前應由團隊口頭確認 "],
  [/將bed調至operator xiphoid附近\s*[（(]\s*Figure\s*29A-1\s*[）)]/iu, "將 bed 調至 operator xiphoid 附近"],
  [/\s*[（(]\s*Figure\s*29A-[234]\s*[）)]/giu, ""],
  [/Table\s*29A-2\s*[／/]\s*LEMON概念/iu, "困難氣道可依 LEMON 評估"],
  [/Figure\s*34-1\s*的pressure[–—-]volume curve有兩段/iu, "心包壓力–容積曲線可分為兩段"],
  [/Table\s*43-1\s*列出上述motor examination[。]?/iu, "Motor examination 應逐一確認主動活動、力量、疼痛與動作連續性。"],
  [/依Figure\s*54-1/iu, ""],
  [/Table\s*54-1\s*的grade\s*1[–—-]6只表示音量/iu, "Murmur grade 1–6 只表示音量"],
  [/Figure\s*60-3\s*顯示12-cm AAA、calcified wall與surrounding hemorrhage\s*[／/]\s*inflammation[。]?/iu, "巨大 AAA 合併周圍出血或發炎時，應高度懷疑破裂或即將破裂。"],
  [/Figure\s*79-1\s*對比normal pancreas、interstitial pancreatitis與necrotizing disease[^。]*[。]?/iu, "Necrosis 在增強影像上呈不增強區；影像嚴重度必須與 organ failure 合併判讀。"],
  [/Table\s*86-2\s*的誤置與損傷清單很廣[^。]*[。]?/iu, "置管併發症包括 epistaxis、氣道誤置、esophageal／bronchial injury、pneumothorax、GI perforation 與管路打結；遇到阻力應停止。"],
  [/Table\s*91-1\s*的complicated risk包括\s*[：:]/iu, "Complicated UTI 的高風險條件包括："],
  [/Table\s*91-4\s*提醒dysuria differential仍包括\s*[：:]/iu, "Dysuria 的鑑別診斷仍包括："],
  [/Table\s*105-1\s*列出的問題應擴充成一份「operative history」\s*[：:]/iu, "手術病史應重建為一份完整 operative history："],
  [/Figure\s*115-1\s*的重點不是一張「給藥流程圖」，而是反覆循環\s*[：:]/iu, "疼痛處理需依評估、介入、重評與調整反覆循環："],
  [/Figure\s*121-1\s*將耳分為\s*[：:]/iu, "耳部解剖可分為："],
  [/Figure\s*123-2\s*顯示adolescent pansinusitis[^。]*[。]?/iu, "Adolescent pansinusitis 若合併 orbital、bone 或 CNS complication 警訊，應立即升級影像與專科處置。"],
  [/Figure\s*127-1\s*以管徑與流速說明\s*[：:]\s*/iu, ""],
  [/Figures?\s*141-2\s*[～~–—-]\s*141-6\s*顯示\s*distal tibial\s*SH\s*I[–—-]IV[。.]?\s*Figure\s*141-1\s*提醒\s*/iu, "Salter–Harris I–IV 與長骨解剖共同決定 "],
  [/Figure\s*152-1\s*顯示由表至深的/iu, "軟組織由表至深依序為 "],
  [/Table\s*153-1\s*可濃縮為「5 Ps」\s*[：:]/iu, "Sexual history 可依「5 Ps」完整詢問："],
  [/Table\s*160-1\s*把incubation分成很實用的三群\s*[：:]/iu, "Incubation period 可分為三群："],
  [/再看syndrome\s*[（(]\s*Table\s*160-2\s*[）)]\s*[：:]/iu, "再依 syndrome 分流："],
  [/Table\s*161-1\s*提示問\s*[：:]/iu, "Zoonotic exposure history 應包含："],
  [/Table\s*163-1\s*的實用流程\s*[：:]/iu, "Returned traveler 的初始評估流程："],
  [/Figure\s*185-1\s*比較常見alcohol結構與molecular weight[^。]*[。]?/iu, "Alcohol toxicity 的關鍵，是毒性主要來自 parent compound 或 metabolite："],
  [/Table\s*202-1\s*顯示anticholinergic activity遍布prescription、OTC與plants\s*[：:]/iu, "具有 anticholinergic activity 的來源廣泛，包括 prescription drugs、OTC products 與 plants："],
  [/Table\s*203-1\s*涵蓋/iu, "Lead 的常見暴露源包括 "],
  [/Table\s*209-1\s*提醒\s*[，,]\s*secondary causes包括\s*[：:]/iu, "Secondary hypothermia 的原因包括："],
  [/Table\s*221-1\s*列出的高危植物包括/iu, "高危植物包括"],
  [/常見來源\s*[（(]\s*Table\s*222-1\s*[）)]\s*[：:]/iu, "常見 CO 來源包括："],
  [/Table\s*223-1\s*提醒\s*[，,]\s*diabetes並非只有T1DM與T2DM/iu, "Diabetes 除 T1DM 與 T2DM 外，還包括 gestational、genetic、exocrine pancreatic、endocrine、drug-induced 與其他類型"],
  [/Table\s*224-1\s*把併發症分成多系統\s*[：:]/iu, "T2DM 的慢性併發症可分為多個系統："],
  [/Figure\s*225-1\s*的重點是\s*[：:]\s*病人的total-body potassium嚴重不足/iu, "DKA 患者的 total-body potassium 通常嚴重不足"],
  [/Figure\s*227-1\s*顯示HHS與DKA共享insulin deficiency/iu, "HHS 與 DKA 都涉及 insulin deficiency"],
  [/Table\s*254-1\s*列出Level I trauma center所需的人力與資源\s*[；;]\s*Table\s*254-2則提醒/iu, "Level I trauma center 需具備完整人力與資源；轉送決策應整合"],
  [/因此methemoglobinemia不只是「functional anemia」[。.]Figure\s*207-2顯示\s*[：:]/iu, "因此 methemoglobinemia 不只是 functional anemia；與單純 anemia 的差異如下："],
  [/可直接進Chapter\s*49的ACS treatment/iu, "應直接依 ACS 治療流程處置"],
  [/考點是\s*necrosis為不增強區/iu, "Necrosis 在增強影像上呈不增強區"],
  [/教科書亦提及成人可用\s*/u, "成人可考慮 "],
  [/考試核心\s*[：:]\s*visual acuity是眼睛的vital sign/iu, "Visual acuity 是眼睛的 vital sign"],
  [/β-blockers與calcium channel blockers分別見Chapters\s*194、195[。]?/iu, ""],
  [/必須結合Chapter\s*204\s*[／/]\s*207的co-oximetry限制解讀/iu, "必須結合 co-oximetry 的限制解讀"],
  [/Carboxyhemoglobin\s*[：:]\s*CO與Hb結合\s*[，,]\s*另見Chapter\s*222/iu, "Carboxyhemoglobin 是 CO 與 Hb 結合後形成的 dyshemoglobin"],
  [/\*\*Carboxyhemoglobin\*\*\s*[：:]\s*CO與Hb結合\s*[，,]\s*另見\s*Chapter\s*222[。]?/iu, "**Carboxyhemoglobin** 是 CO 與 Hb 結合後形成的 dyshemoglobin。"],
  [/Chapter\s*206支持MDAC\s*[；;]\s*selected severe case可考慮dialysis/iu, "Dapsone 中毒可考慮 MDAC；selected severe cases 可評估 dialysis"],
  [/Sea snakes?[^。]*詳見Chapter\s*213[。]?/iu, "Sea snake envenomation 以 neuromuscular toxicity 與 rhabdomyolysis 為主。"],
  [/Worldwide unintentional drug overdose/iu, "Worldwide unintentional drug overdose"],
  [/亦指出\s+worldwide unintentional drug overdose/iu, "Worldwide unintentional drug overdose"],
  [/^，\s*(?=在美國)/gmu, ""],
  [/^：\s*(?=\*\*)/gmu, ""],
  [/以下處置、手術門檻與藥物方案整理/gu, "以下整理急診處置、手術門檻與藥物方案"],
  [/資料顯示\s*[，,]\s*(?:指出|認為)\s*[，,]/gu, "資料顯示，"],
  [/資料顯示\s*[，,]\s*估計\s*[，,]/gu, "資料估計，"],
  [/Systemic Lupus International Collaborating Clinics\s*[（(]SLICC[）)]\s*分類要素，也提到\s*EULAR\/ACR\s*與\s*SLICC\s*都屬於\s*\*\*classification criteria[^。]*[。]?/iu, "SLICC 與 EULAR/ACR 都是 classification criteria，而非可單獨確立診斷的統一 diagnostic criteria。"],
  [/急診評估聚焦於的不是/u, "急診評估的重點不是"],
  [/Tularemia\s*與\s*Q fever\s*在也被視為/iu, "Tularemia 與 Q fever 也可能被用作"],
  [/以下劑量是本容[^。]*[。]?/u, ""],
  [/(^|[。\n]\s*)的歷史 epidemiology/gmu, "$1歷史 epidemiology"],
  [/這些是\*\*?的\s*(\d{4}\s*年資料)/gu, "這些是 **$1"],
  [/所述年代性範圍為\s*[：:]\s*/gu, ""],
  [/Bronchiolitis 主要見於未滿 2 歲兒童，以病毒感染造成 wheezing、congestion 為主；重點是pneumonia、pertussis、cystic fibrosis（CF）與 bronchopulmonary dysplasia（BPD）。/iu, "Bronchiolitis 主要見於未滿 2 歲兒童，以病毒感染造成 wheezing 與 congestion 為主；其他重要鑑別包括 pneumonia、pertussis、cystic fibrosis（CF）與 bronchopulmonary dysplasia（BPD）。"],
  [/(^|[。\n]\s*)的風險管理問題，是在\s*EUS/gmu, "$1EUS 的主要風險管理問題，是在 EUS"],
  [/\|\s*類別\s*\|\s*的主要威脅\s*\|/gu, "| 類別 | 主要威脅 |"],
  [/依\s*SBP\s*<\s*90\s*mm\s*Hg\s*的操作性定義，約\s*0\.4%[–—-]1\.3%\s*的\s*ED\s*患者符合\s*shock。的院內死亡率約為\s*septic shock\s*26%、cardiogenic shock\s*39%[–—-]48%。/iu, "依 SBP <90 mm Hg 的操作性定義，約 0.4%–1.3% 的 ED 患者符合 shock；其中 septic shock 的院內死亡率約 26%，cardiogenic shock 約 39%–48%。"],
  [/資料顯示\s*[，,]\s*指出\s+COPD/gu, "資料顯示，COPD"],
  [/整合出的安全思路\s*[，,]\s*急診首先要/gu, "急診首先要"],
  [/當時資料\s*[，,]\s*美國/gu, "歷史資料顯示，美國"],
  [/這是\s+這套分類/gu, "上述 early/late PVE 分界屬歷史分類"],
  [/把\s*methylxanthines\s*與\s*nicotine\s*放在一起討論/iu, "Methylxanthines 與 nicotine 雖同屬毒理主題"],
  [/僅寫可使用\s*cimetidine\s*的\s*standard doses[^。]*[。]?/iu, "Cimetidine 可減少 active metabolite formation，但目前沒有足以支持固定急診劑量的資料，應由毒物專家個別決定。"],
  [/Supportive\/source control\s*[；;]\s*[，,]\s*major uncontrolled bleed/iu, "Supportive care 與 source control 為主；major uncontrolled bleeding"],
  [/\*\*\*\*/gu, "** "],
  [/後者過去通常稱為\s*dementia\s*[，,]\s*仍沿用\s*dementia\s*一詞/iu, "Major neurocognitive disorder 過去多稱 dementia；以下沿用 dementia 以便臨床辨識"],
  [/以下已整合各表格的劑量、pharmacokinetics、註腳、禁忌、監測與版本陷阱[。]?/iu, ""],
  [/全章核心\s*[：:]/gu, "核心原則："],
  [/本章的核心不是單純背誦「在哪裡下針」，而是建立一套安全順序\s*[：:]/gu, "安全操作應依下列順序完成："],
  [/本章原文存在數個重要衝突或疑似排印錯誤[^。]*[。]?/gu, ""],
  [/以下保留章中數值供考試複習[^。]*[。]?/gu, ""],
  [/上述 early\/late PVE 分界屬歷史分類，後續版本或其他指引可能採用不同時間界線[。]?/iu, "Early／late PVE 的時間分界會因指引而異；臨床應依現行感染性心內膜炎指引判定。"],
  [/部分技術細節屬版本，實際處置仍須配合現行院內流程及相關專科判斷[。]?/gu, "技術細節應依現行院內流程與相關專科判斷。"],
  [/本章的核心不是「胸痛等不等於心肌梗塞」，而是\s*[：:]?/gu, ""],
  [/章節範圍為紙本第\s*334\s*[～~–—-]\s*352\s*頁[。]?/gu, ""],
  [/一般眼外傷與\s*scleritis、episcleritis、uveitis、iritis\s*等內容主要見\s*Chapter\s*241[。]?/iu, ""],
  [/Lyme disease、Rocky Mountain spotted fever\s*等\s*tick-borne rash\s*另見其他章節；遇到\s*tick exposure、旅行史或群聚個案時，仍須納入鑑別[。]?/iu, "有 tick exposure、旅行史或群聚個案時，應將 Lyme disease、Rocky Mountain spotted fever 等 tick-borne disease 納入鑑別。"],
  [/整章重點在於\*\*臨床辨識、解剖定位與處置分流\*\*，而非提供固定檢驗套組或單一治療方案[。]?/gu, "急診評估需整合臨床辨識、解剖定位與處置分流，不能依賴固定檢驗套組或單一治療方案。"],
  [/最重要的三類為\s*carboxyhemoglobin、methemoglobin（MetHb）及\s*sulfhemoglobin（SulfHb）；carboxyhemoglobinemia\s*因重要性與盛行率另見\s*Chapter\s*222，主要處理後兩者[。]?/iu, "最重要的三類為 carboxyhemoglobin、methemoglobin（MetHb）及 sulfhemoglobin（SulfHb）；以下聚焦 methemoglobin 與 sulfhemoglobin。"],
  [/臨床上涉及腹股溝（groin）、臀裂（intergluteal cleft）、腋窩（axilla）、乳房下皺褶（inframammary folds）及腹部\s*pannus\s*等部位的常見皮膚病。\*\*Sexually transmitted infections\s*並不在完整討論範圍內，另見\s*Chapter\s*153；molluscum contagiosum\s*另見\s*Chapter\s*251。\*\*/iu, "腹股溝（groin）、臀裂（intergluteal cleft）、腋窩（axilla）、乳房下皺褶（inframammary folds）及腹部 pannus 等皮膚皺褶，容易因潮濕、摩擦與微生物增生而出現特定皮膚病灶。"],
  [/急診評估聚焦於常見的趾甲、滑囊、足底筋膜、神經壓迫、肌腱與前足疼痛。Melanoma、tinea pedis、diabetic foot ulcer、onychomycosis、corns、warts\s*另見\s*Chapter\s*253；糖尿病足潰瘍亦見\s*Chapter\s*224；足底穿刺傷見\s*Chapter\s*46；下肢\s*osteomyelitis\s*見\s*Chapter\s*281[。]?/iu, "常見足部軟組織問題包括趾甲、滑囊、足底筋膜、神經壓迫、肌腱與前足疼痛；若有感染、缺血、深部潰瘍或 osteomyelitis 線索，應優先處理。"],
  [/以下以較少污名化的現代用語\s*\*\*people who inject drugs（PWID）\*\*\s*指稱患者[。]?/iu, "People who inject drugs（PWID）常因感染、血管損傷、毒物暴露與戒斷就醫；評估時應使用精確且不污名化的語言。"],
  [/Figure\s*15-1\s*的真正意義是把\s*H⁺\s*視為一個共同池/iu, "H⁺ 可視為一個共同池"],
  [/Table\s*22-1\s*的\s*Chain of Survival\s*包含五環/iu, "Chain of Survival 包含五環"],
  [/Figure\s*29A-4\s*所示的\s*\*\*suction-assisted laryngoscopy airway decontamination,\s*SALAD\*\*/iu, "**Suction-assisted laryngoscopy airway decontamination（SALAD）**"],
  [/Figure\s*29A-6\s*以傳統方式顯示\s*oral、pharyngeal、laryngeal axes/iu, "傳統氣道定位會比較 oral、pharyngeal、laryngeal axes"],
  [/Table\s*68-2\s*要求同時具備/iu, "安全出院條件需同時具備"],
  [/視覺核心為\s*Table\s*72-1、72-2、72-3；沒有獨立\s*figure、影像病例或流程圖[。]?/iu, ""],
  [/Figure\s*77-1[～~–—-]77-3、Tables\s*77-1[～~–—-]77-4、圖說與\s*button-battery algorithm footnotes\s*均納入；所有相關內容皆可可靠辨識[。]?/iu, ""],
  [/例如\s*Figure\s*109-1\s*所示的\s*Broselow®\s*tape/iu, "例如 Broselow® tape"],
  [/Figure\s*121-1\s*將耳分為三部分/iu, "耳部解剖可分為三部分"],
  [/Table\s*124-1\s*提供快速定位，但位置只能縮小鑑別，不能單獨確定病原/iu, "病灶位置可快速縮小鑑別，但不能單獨確定病原"],
  [/Figure\s*141-1\s*以\s*femur\s*顯示/iu, "長骨解剖包括"],
  [/Figure\s*141-3\s*的\s*SH-II\s*有\s*dorsal epiphyseal displacement、需\s*reduction；Figure\s*141-4\s*的\s*CT\s*顯示\s*fracture\s*同時通過\s*physis\s*與\s*metaphysis/iu, "SH-II 可出現 dorsal epiphyseal displacement 並需要 reduction；骨折線可同時通過 physis 與 metaphysis"],
  [/\*\*Figure\s*141-5\s*caption\s*的「medial epiphysis」與後文的\s*anterolateral\s*定義及\s*physeal-closure mechanism\s*不一致；考試與臨床應採後者[。]?/iu, "**Tillaux fracture 是 distal tibia anterolateral SH-III transitional fracture。**"],
  [/Figure\s*185-1\s*顯示\s*molecular weight/iu, "常見 toxic alcohol 的 molecular weight 為"],
  [/一般\s*conventional doses\s*很少造成\s*clinically significant methemoglobinemia，但\s*Table\s*207-1\s*所列來源皆應熟悉/iu, "一般 conventional doses 很少造成 clinically significant methemoglobinemia，但仍應熟悉常見氧化劑與高風險暴露來源"],
  [/Figure\s*229-1\s*將\s*thyroid storm\s*的臨床表現分成四個核心系統/iu, "Thyroid storm 的臨床表現可分成四個核心系統"],
  [/Table\s*240-1\s*將\s*oncologic emergencies\s*分成四類/iu, "Oncologic emergencies 可分成四類"],
  [/Figure\s*254-1\s*將創傷系統分為/iu, "完整創傷系統可分為"],
  [/Table\s*254-1\s*列出四項/iu, "核心能力包括四項"],
  [/\*\*Figure\s*257-2\s*的六位病人皆為\s*GCS\s*4，CT\s*卻分別顯示/iu, "**相同 GCS 可能對應完全不同的顱內病灶，包括"],
  [/Figure\s*260-3\s*的\s*C7\s*橫切面顯示/iu, "C7 橫切面可見"],
  [/Figure\s*275-1\s*的小腿橫切面顯示/iu, "小腿橫切面可見"],
  [/Table\s*91-2\s*提醒不同情境的\s*organisms\s*會改變/iu, "不同臨床情境的常見 organisms 會改變"],
  [/Table\s*201-5\s*以\s*20%\s*paraquat concentrate\s*估算/iu, "以 20% paraquat concentrate 估算"],
  [/Figure\s*207-3\s*把\s*HbM\s*與\s*enzyme deficiency\s*列入\s*methylene-blue failure differential/iu, "Methylene-blue failure 的鑑別包括 HbM 與 enzyme deficiency"],
  [/Figure\s*225-1\s*的重點是\s*[：:]\s*/iu, ""],
  [/Figure\s*65\.7[–—-]65\.8\s*的核心訊息是\s*[：:]/iu, "核心判讀原則是："],
  [/Table\s*74\.1\s*評估的是\s*[：:]/iu, "較能區分 VTE 確診與未確診者的因素包括："],
  [/Figure\s*79-1\s*對比\s*normal pancreas、interstitial pancreatitis\s*與\s*necrotizing disease；Necrosis\s*在增強影像上呈不增強區，且影像嚴重度必須與\s*organ failure\s*整合[。]?/iu, "Necrosis 在增強影像上呈不增強區；影像嚴重度必須與 organ failure 合併判讀。"],
  [/這一章真正要學的是\s*\*\*systems medicine\*\*\s*[：:]/iu, "EMS 應以 **systems medicine** 的架構運作："],
  [/這一章最重要的臨床框架是\s*[：:]/u, "臨床評估可依下列框架進行："],
  [/這一章的共同主軸是\s*[：:]\s*病人可能都以\s*\*\*dyspnea、chest pain、syncope、arrhythmia或shock\*\*\s*到院，但病變位置不同——myocardium、pericardium，或已植入的LVAD。急診不是先追求精準分子分類，而是先回答\s*[：:]/iu, "Dyspnea、chest pain、syncope、arrhythmia 或 shock 都可能來自 myocardium、pericardium 或已植入的 LVAD；急診應先區分："],
  [/這一章最重要的不是背呼吸器名稱，而是建立一套固定的床邊推理\s*[：:]/u, "床邊評估應依固定順序進行："],
  [/整章可濃縮為\s*[：:]/u, "核心原則如下："],
  [/Table\s*91-9\s*列出的\s*false red urine\s*包括\s*[：:]/iu, "False red urine 的原因包括："],
  [/Table\s*91-10\s*列\s*/iu, "顯著疾病的風險因子包括 "],
];

function applyLearnerFacingRewrites(
  value: string,
  rules: ReadonlyArray<readonly [RegExp, string]>,
) {
  return rules.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), value);
}
const generatedQuickHeadingPattern = /^(高產重點|注意事項與考題陷阱)[（(]原文摘錄[）)]$/u;
const generatedQuickNotePattern = /以下內容只重新編排[^。！？]*(?:不改寫|原文區塊)[^。！？]*[。！？]?/u;
const readerEditorialBlockquoteLabelPattern = /^(?:資料來源|來源(?:定位|範圍|與(?:完整性|範圍|視覺(?:審閱|範圍)|審閱範圍)|限制|品質)|原始資料限制|資料範圍(?:說明|限制)|章節(?:識別|定位|範圍(?:與視覺審閱)?|可見性說明)|完整(?:性檢查|審閱範圍)|審閱範圍|視覺審閱確認|版本(?:提醒|警示|提示|定位|界線|警語|注意|註記|安全提醒|與使用提醒|與用藥提醒|與臨床安全提醒|與審閱範圍)|重大版本提醒|教材版本提示|資料與版本註記|劑量與版本提醒|司法管轄與版本提醒|臨床(?:更新重點|時效警示|時效提醒|版本提醒)|時效(?:提醒|警示|警告|性提醒|與安全提醒|與病人安全警示)|重大時效提醒|用語與時效警示)$/iu;
const readerEditorialSourceAttributionPattern = /^資料來源\s*[：:]\s*(?:[*_`~\s]*)(?:Rosen['’]?s|Tintinalli)/iu;
const openingEditorialLanguagePattern = /(?:資料來源|來源(?:定位|範圍|與(?:完整性|視覺|審閱)|限制|品質)|原始\s*PDF|提供的\s*PDF|上傳\s*PDF|print\s+p|PDF\s+pages?|逐頁|視覺審閱|審閱範圍|版本(?:提醒|警示|提示|定位|界線|警語|注意|註記|安全|與)|出版年代|source-era|臨床更新重點|臨床時效|時效(?:提醒|警示)|疑似[^。]{0,40}(?:已在|標示)|完整(?:性檢查|審閱範圍)|章節(?:識別|定位|可見性))/iu;
const safetyConclusionPattern = /(?:病人安全|安全警示|重大.*勘誤|原書.*(?:錯誤|誤植)|危險錯誤|絕不可|不可照用|正確(?:寫成|為|單位)|疑缺|相差千倍|現行|實際(?:照護|處方|下單|劑量|作業)|protocol|guideline|藥典|仿單|法律|法規)/iu;
const clinicalReminderPattern = /(?:臨床|實際|現行|應(?:依|以|優先)|必須|不可|絕不可|病人安全|病安|時效|勘誤|誤植|危險錯誤|法律|法規|藥典|仿單|guideline|protocol|source-era)/iu;
const pureProductionProcessPatterns = [
  /(?:上傳(?:檔案|版本|之|\s*Section)|已建立索引|逐像素|已抽查|原始\s*PDF)/iu,
  /(?:已(?:逐頁|完整)?(?:檢視|檢查|核對|複核|覆核|審閱)|已納入(?:正文|完整正文)|不在本次審閱範圍|未聲稱已審閱)/iu,
  /(?:所有|相關|本章|章內|PDF\s*內|可取得的)?[^。！？；;]{0,90}(?:頁面|內容|正文|文字|表格|圖像|圖片|圖說|元素|視覺元素|captions?|footnotes?)[^。！？；;]{0,50}(?:(?:均|皆)可(?:完整|清楚|可靠)?(?:判|辨)讀|均已(?:納入|審閱|檢視|核對)|已完整(?:包含|提供)|未發現無法(?:存取|讀取|判讀|解釋))/iu,
  /(?:上傳|本|原|來源)\s*(?:的\s*)?PDF[^。！？；;]{0,120}(?:已(?:完整)?(?:包含|提供|納入)|未(?:內含|內嵌|包含|嵌入|收錄|附)|無法(?:審閱|檢視)|均可(?:清楚|可靠)?判讀)/iu,
  /(?:完整\s*)?(?:reference list|references|bibliography|參考文獻(?:表|清單)?)[^。！？；;]{0,120}(?:未(?:內含|包含|嵌入|收錄|納入|附|審閱)|僅(?:標示|註明|置於|指向)|位於線上|不在本次審閱範圍|無法逐篇)/iu,
  /PDF\s*未(?:內含|包含)[^。！？]{0,80}(?:reference|參考文獻)[^。！？]{0,80}(?:未逐篇|未驗證|無法驗證)?/iu,
  /未(?:印出|列出)[^。！？；;]{0,40}(?:reference list|references|bibliography)/iu,
  /未將[^。！？；;]{0,60}參考文獻[^。！？；;]{0,30}納入/u,
  /(?:外部|線上)[^。！？；;]{0,50}(?:影片|video|reference|bibliography)[^。！？；;]{0,80}(?:未(?:嵌入|包含|納入)|無法(?:審閱|檢視)|未能審閱)/iu,
  /(?:影片|video|reference|bibliography)[^。！？；;]{0,80}(?:未(?:嵌入|包含|納入)|無法(?:審閱|檢視)|未能審閱)[^。！？；;]{0,50}(?:上傳\s*PDF|外部|線上)?/iu,
  /(?:這些?|上述|兩項)[^。！？；;]{0,50}未(?:內嵌|嵌入|包含|納入)於上傳\s*PDF[^。！？；;]{0,100}未(?:實際|能)?(?:審閱|檢視)/iu,
  /(?:本章|原章)[^。！？；;]{0,80}(?:沒有|未提供)(?:獨立|正式)?\s*(?:algorithm|flowchart|流程圖|boxed pearl)[^。！？；;]{0,120}(?:重新|整合|教學架構)/iu,
  /以下(?:涵蓋|整合|納入)[^。！？；;]{0,120}(?:正文|表(?:格)?|圖|Tables?|Figures?|照片|註解|圖說)/iu,
  /以下以\s*(?:Tintinalli|Rosen['’]?s)[^。！？；;]{0,160}(?:主體|基礎|依據|內容)/iu,
  /本章原文為\s*(?:Tintinalli|Rosen['’]?s)[^。！？；;]{0,160}(?:出版年代|保留原章|臨床校正)/iu,
  /原章(?:的)?\s*(?:Tables?|Figures?)[^。！？；;]{0,160}(?:均|皆)納入/iu,
  /原書部分[^。！？；;]{0,160}(?:出版年代|章節與考試內容)/iu,
  /本章使用的部分[^。！？；;]{0,120}(?:出版年代|原文|文末)/iu,
  /(?:本章|原章)[^。！？；;]{0,80}(?:沒有|未附|未提供)[^。！？；;]{0,60}(?:圖片|影像|圖解|流程圖|演算法|algorithm|flowchart|圖說|臨床照片)/iu,
  /(?:核心視覺內容|主要結構化內容)[^。！？；;]{0,100}(?:表格|Tables?|Figures?|Key Concepts|題問答)/iu,
  /以下已整合[^。！？；;]{0,180}(?:全文|Tables?|Figures?|圖說|續文)/iu,
  /(?:這|以下)(?:是)?依(?:本章|全章|正文)[^。！？；;]{0,120}(?:重組|重整|整理|整合)[^。！？；;]{0,80}(?:不是|並非)[^。！？；;]{0,60}(?:algorithm|flowchart|流程圖)/iu,
  /(?:不是|並非)原書[^。！？；;]{0,80}(?:algorithm|flowchart|流程圖)/iu,
  /[^。！？；;]{0,160}教材年代資料/iu,
  /(?:以下數字與治療目標|以下發生率與手術分布)[^。！？；;]{0,220}(?:原章版本|Tintinalli|即時發生率)/iu,
  /(?:以下整理忠於本章|以下整理忠實反映第\s*\d+\s*版)[^。！？；;]{0,220}/iu,
  /本章原始抗生素表[^。！？；;]{0,220}(?:guidance|保留|現行)/iu,
  /(?:並非|不是)原表原文/iu,
  /(?:章內全部|原章(?:的)?\s*(?:Tables?|Figures?))[^。！？；;]{0,180}(?:均|皆)納入/iu,
  /未發現無法辨讀的內容/iu,
  /(?:所有內容均可辨讀|所有靜態章節頁面均可清楚判讀|所有相關頁面均可清楚判讀)/u,
];

// These patterns intentionally require production context. Ordinary clinical
// uses of words such as source, table, figure, or rendered are not metadata.
const highConfidenceProductionPatterns = [
  /(?:^|[：:；;，,\s])(?:來源檔|來源定位|章節識別|章節定位|審閱範圍|完整性檢查)[：:：]?/iu,
  /`?[^`\s]+\.pdf`?/iu,
  /\b(?:print\s+p{1,2}\.?|PDF\s+pages?|rendered\s+p\.?)\s*\d/iu,
  /(?:^|\s)p\.?\s*\d+[^。！？]{0,70}(?:Chapter\s*\d+|本章|章末|章首|開始|結束|完成)/iu,
  /(?:印刷|紙本)頁\s*\d+(?:\s*[–—-]\s*\d+)?/iu,
  /同章\s*p\.?\s*\d+/iu,
  /(?:共頁|shared[- ]page)\s*(?:章界|boundary|boundaries|分界)?/iu,
  /(?:頁界|章界|欄位起訖|頁面分界|實際版面分界)/u,
  /(?:逐頁\s*(?:render|檢視|檢查|核對|審閱)|(?:render|視覺)(?:ed)?[^。！？]{0,36}(?:檢查|核對|審閱|確認))/iu,
  /(?:視覺審閱|視覺檢查|視覺核對|視覺內容稽核)/u,
  /(?:Tables?|Figures?|captions?|footnotes?)[^。！？]{0,90}(?:已(?:納入|核對|檢查|審閱)|逐頁|render|視覺)/iu,
  /以下(?:涵蓋|整合|納入)[^。！？；;]{0,120}(?:正文|表(?:格)?|圖|Tables?|Figures?|照片|註解|圖說)/iu,
  /(?:未發現|沒有)[^。！？]{0,24}(?:無法|不可|不可靠)[^。！？]{0,16}判讀/iu,
  /(?:V1\s*(?:→|->)\s*V2|Reviewer(?:\s+Audit)?|Integrator(?:\s+Final\s+Plan)?|私人工作檔|工作區|公開\s*release)/iu,
  /(?:本章|本講義|原章)[^。！？]{0,48}(?:來源為|整理自|依)[^。！？]{0,48}Tintinalli/iu,
  /Tintinalli[^。！？]{0,80}(?:Section\s*\d+|Chapter\s*\d+|print\s+p)/iu,
  /(?:本講義|本章)[^。！？]{0,32}(?:完整覆核|完整審閱|已完成)[^。！？]{0,80}(?:頁面|圖表|表格|正文|審閱|工作流)/iu,
  /(?:本講義|講義)[^。！？]{0,40}(?:重組教學|不是逐字翻譯|重新編排)/iu,
  /以下以\s*(?:Tintinalli|Rosen['’]?s)[^。！？；;]{0,160}(?:主體|基礎|依據|內容)/iu,
  /本章原文為\s*(?:Tintinalli|Rosen['’]?s)/iu,
  /原章(?:的)?\s*(?:Tables?|Figures?)[^。！？；;]{0,160}(?:均|皆)納入/iu,
  /原書部分[^。！？；;]{0,160}(?:出版年代|章節與考試內容)/iu,
  /本章使用的部分[^。！？；;]{0,120}(?:出版年代|原文|文末)/iu,
  /(?:所有內容均可辨讀|不在本次審閱範圍)/u,
];

function nodeText(node: GuideNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join(" ").replace(/\s+/gu, " ").trim();
}

function sourceSlice(source: string, node: GuideNode) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "";
  return source.slice(start as number, end as number).trimEnd();
}

function plainLabel(value: string) {
  return value.replace(/[*_`~]/gu, "").replace(/\s+/gu, " ").trim();
}

function normalizeRuntimeMathBlocks(markdown: string) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  let fence: { character: string; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence || !/^\s*(?:\\?\[)\s*$/u.test(lines[index])) continue;

    let closingIndex = index + 1;
    while (
      closingIndex < lines.length
      && closingIndex - index <= 24
      && !/^\s*(?:\\?\])\s*$/u.test(lines[closingIndex])
    ) {
      if (/^\s*(?:\\?\[|`{3,}|~{3,})/u.test(lines[closingIndex])) {
        break;
      }
      closingIndex += 1;
    }
    if (
      closingIndex >= lines.length
      || !/^\s*(?:\\?\])\s*$/u.test(lines[closingIndex])
      || closingIndex === index + 1
    ) {
      continue;
    }

    const indent = lines[index].match(/^\s*/u)?.[0] ?? "";
    for (let contentIndex = index + 1; contentIndex < closingIndex; contentIndex += 1) {
      const formulaLabel = /^\s*#{1,6}\s+/u.test(lines[contentIndex]);
      lines[contentIndex] = lines[contentIndex].replace(
        /^(\s*)#{1,6}\s+(?:\d+(?:\.\d+)*\s+)?/u,
        "$1",
      );
      if (
        formulaLabel
        && lines.slice(index + 1, contentIndex).every((line) => line.trim().length === 0)
        && lines.slice(contentIndex + 1, closingIndex).some((line) => line.trim().length > 0)
        && !/(?:=|\\approx|\\equiv|[<>])\s*$/u.test(lines[contentIndex])
      ) {
        lines[contentIndex] = `${lines[contentIndex].trimEnd()} =`;
      }
      if (/^\s*={3,}\s*$/u.test(lines[contentIndex])) lines[contentIndex] = `${indent}=`;
      lines[contentIndex] = lines[contentIndex].replace(/(^|[^\\])%/gu, "$1\\%");
    }
    lines[index] = `${indent}$$`;
    lines[closingIndex] = `${indent}$$`;
    index = closingIndex;
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function stripStructuralOutlinePrefix(value: string) {
  return value.replace(/^\d+(?:\.\d+){0,3}\.?\s+/u, "");
}

function isProductionHeading(label: string) {
  return productionHeadingPattern.test(stripStructuralOutlinePrefix(plainLabel(label)));
}

function hasProductionContext(value: string) {
  const plain = plainLabel(value);
  return highConfidenceProductionPatterns.some((pattern) => pattern.test(value) || pattern.test(plain));
}

function isPureProductionProcess(value: string) {
  return pureProductionProcessPatterns.some((pattern) => pattern.test(value));
}

function softenLocatorInSafetyConclusion(value: string) {
  return value
    .replace(/rendered\s+p\.?\s*\d+(?:[–—-]\d+)?\s*(?:明確)?(?:印出|顯示|寫(?:成|為)?)/giu, "原書內容顯示")
    .replace(/print\s+p\.?\s*\d+(?:[–—-]\d+)?\s*(?:的正文與\s*)?(?:Table\s*[\w.-]+\s*)?(?:寫(?:成|為)?|顯示|印出)/giu, "原書內容顯示")
    .replace(/同章\s*p\.?\s*\d+(?:[–—-]\d+)?/giu, "同章其他段落")
    .replace(/\bprint\s+p{1,2}\.?\s*\d+(?:\s*[–—-]\s*\d+)?/giu, "原書")
    .replace(/\bPDF\s+pages?\s*\d+(?:\s*[–—-]\s*\d+)?/giu, "原書頁面")
    .replace(/`?[^`\s]+\.pdf`?/giu, "原書")
    .replace(/\s{2,}/gu, " ");
}

function sanitizeClause(clause: string) {
  const trimmed = clause.trim();
  if (!trimmed) return "";
  if (generatedQuickNotePattern.test(trimmed)) return "";
  if (!hasProductionContext(trimmed)) return trimmed;
  if (isPureProductionProcess(trimmed)) return "";
  if (safetyConclusionPattern.test(trimmed)) return softenLocatorInSafetyConclusion(trimmed);
  return "";
}

function sanitizeSentence(sentence: string) {
  if (isPureProductionProcess(sentence)) {
    const clauses = sentence.split(/([；;])/u);
    const kept: string[] = [];
    for (let index = 0; index < clauses.length; index += 2) {
      const clause = clauses[index] ?? "";
      if (isPureProductionProcess(clause)) continue;
      const cleaned = sanitizeClause(clause);
      if (cleaned) kept.push(cleaned);
    }
    let value = kept.join("；");
    if (value && /[。！？]$/u.test(sentence.trim()) && !/[。！？]$/u.test(value)) value += sentence.trim().slice(-1);
    return value;
  }
  if (!hasProductionContext(sentence)) return sentence.trim();
  if (safetyConclusionPattern.test(sentence)) {
    // A production clause and a current clinical warning are often joined by
    // a semicolon. Remove only the production clause in that case.
    const clauses = sentence.split(/([；;])/u);
    const kept: string[] = [];
    for (let index = 0; index < clauses.length; index += 2) {
      const cleaned = sanitizeClause(clauses[index] ?? "");
      if (cleaned) kept.push(cleaned);
    }
    let value = kept.join("；");
    if (value && /[。！？]$/u.test(sentence.trim()) && !/[。！？]$/u.test(value)) value += sentence.trim().slice(-1);
    if (!value && isPureProductionProcess(sentence)) return "";
    return value || softenLocatorInSafetyConclusion(sentence.trim());
  }
  return "";
}

function splitMarkdownSentences(value: string) {
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (!/[。！？]/u.test(value[index])) continue;
    let end = index + 1;
    const candidate = value.slice(start, end);
    const strongCount = (candidate.match(/(?<!\\)\*\*/gu) ?? []).length;
    const underscoreStrongCount = (candidate.match(/(?<!\\)__/gu) ?? []).length;
    if (strongCount % 2 === 1 && value.startsWith("**", end)) end += 2;
    else if (underscoreStrongCount % 2 === 1 && value.startsWith("__", end)) end += 2;
    sentences.push(value.slice(start, end));
    start = end;
    index = end - 1;
  }
  if (start < value.length) sentences.push(value.slice(start));
  return sentences.length ? sentences : [value];
}

function sanitizeParagraphBody(value: string) {
  const normalized = value.replace(generatedQuickNotePattern, "").trim();
  if (!normalized) return "";
  // Markdown emphasis commonly closes immediately after punctuation. Keep the
  // closing marker with the sentence so removing an adjacent source sentence
  // cannot leave an orphan `*` or `**` in the learner-facing paragraph.
  const sentences = splitMarkdownSentences(normalized);
  return sentences.map(sanitizeSentence).filter(Boolean).join("").trim();
}

function sanitizeBlockquote(raw: string) {
  const body = raw
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/u, ""))
    .join("\n");
  const paragraphs = body.split(/\n\s*\n/gu)
    .map((paragraph) => sanitizeParagraphBody(paragraph))
    .filter(Boolean);
  if (!paragraphs.length) return "";
  return paragraphs.map((paragraph) => paragraph.split("\n").map((line) => `> ${line}`).join("\n")).join("\n>\n");
}

function leadingBlockquoteLabel(body: string) {
  const bold = body.match(/^\*\*([^*\n]{1,100})\*\*\s*[：:]?/u);
  return bold?.[1]?.trim().replace(/[：:]$/u, "") ?? "";
}

function isReaderEditorialBlockquoteBody(body: string) {
  if (readerEditorialSourceAttributionPattern.test(body)) return true;
  const label = leadingBlockquoteLabel(body);
  return Boolean(
    label
    && (
      explicitOpeningEditorialLabelPattern.test(plainLabel(label))
      || readerEditorialBlockquoteLabelPattern.test(label)
    )
  );
}

function isReaderEditorialBlockquote(raw: string) {
  const body = raw
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/u, ""))
    .join("\n")
    .trimStart();
  return isReaderEditorialBlockquoteBody(body);
}

function splitBlockquoteParagraphs(raw: string) {
  return raw
    .split(/\n\s*>\s*\n/gu)
    .map((segment) => segment.trimEnd())
    .filter(Boolean);
}

function isOpeningEditorialBlockquoteParagraph(raw: string) {
  const body = raw
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/u, ""))
    .join("\n")
    .trim();
  return (
    isReaderEditorialBlockquote(raw)
    || openingEditorialLanguagePattern.test(body)
    || explicitOpeningEditorialLanguagePattern.test(body)
  );
}

function isOpeningEditorialSentence(value: string) {
  const text = plainLabel(value);
  return (
    openingEditorialLanguagePattern.test(text)
    || explicitOpeningEditorialLanguagePattern.test(text)
    || isPureProductionProcess(text)
  );
}

function partitionOpeningEditorialParagraph(raw: string) {
  const sentences = splitMarkdownSentences(raw);
  const kept: string[] = [];
  const relocated: string[] = [];
  for (const sentence of sentences) {
    if (isOpeningEditorialSentence(sentence)) {
      relocated.push(sentence.trim());
      continue;
    }
    const cleaned = sanitizeSentence(sentence);
    if (cleaned) kept.push(cleaned);
  }
  return {
    kept: finalizeLearnerBlock(rewriteSourceFraming(kept.join(""))),
    relocated: relocated.filter(Boolean),
  };
}

function sanitizeList(raw: string) {
  const lines = raw.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const item = line.match(/^(\s*(?:[-+*]|\d+[.)])\s+)([\s\S]*)$/u);
    if (!item) {
      const cleaned = sanitizeParagraphBody(line);
      if (cleaned) kept.push(cleaned);
      continue;
    }
    const cleaned = sanitizeParagraphBody(item[2]);
    if (cleaned) kept.push(`${item[1]}${cleaned}`);
  }
  return kept.join("\n");
}

function rewriteSourceFraming(value: string) {
  const rewritten = applyLearnerFacingRewrites(value, learnerFacingTextRewrites)
    .replace(/\s*〔(?:(?:Rosen['’]?s|Tintinalli)[^〕\n]*|(?:Ch(?:apter)?\.?\s*\d+|PDF\s*(?:pp?\.?|pages?))[^〕\n]*)〕/giu, "")
    .replace(/\s*\(\[[^\]\n]+\]\[\d+\]\)/gu, "")
    .replace(/依本章(?:內容)?(?:所述)?\s*/gu, "")
    .replace(/(?:以下)?(?:處置|手術門檻|藥物方案|劑量|內容)\s*依本章(?:內容)?整理\s*[；;，,]?\s*/gu, "")
    .replace(/本章反覆強調\s*[：:，,]?\s*/gu, "")
    .replace(/本章(?:亦|也)?(?:特別)?(?:強調|認為|建議|記載|說明|提及|提到)\s*[，,]?\s*/gu, "")
    .replace(/本章所引\s*/gu, "")
    .replace(/本章列出的\s*/gu, "")
    .replace(/本章所列(?:的)?\s*/gu, "參考")
    .replace(/本章所述\s*/gu, "")
    .replace(/本章真正要(?:處理|學習|教)(?:的問題|的是)?\s*/gu, "真正的臨床重點是")
    .replace(/本章最重要的(?:臨床)?(?:觀念|原則|命題|分類|一句話|禁忌)/gu, "最重要的臨床重點")
    .replace(/本章(?:的)?急診核心/gu, "急診核心")
    .replace(/本章(?:的)?臨床主軸/gu, "臨床主軸")
    .replace(/本章(?:的)?核心(?:轉折|問題|主線|總綱|框架|概念|原則)?/gu, "核心臨床觀念")
    .replace(/本章可濃縮成/gu, "臨床決策可濃縮成")
    .replace(/本章可用\s*/gu, "可用")
    .replace(/本章同時處理\s*/gu, "臨床上需同時處理")
    .replace(/本章處理的是\s*/gu, "臨床上需處理")
    .replace(/本章處理的\s*/gu, "")
    .replace(/本章處理\s*/gu, "臨床上需處理")
    .replace(/本章實際包含\s*/gu, "臨床處置包含")
    .replace(/本章主要討論\s*/gu, "臨床重點為")
    .replace(/本章討論\s*/gu, "臨床上涉及")
    .replace(/本章聚焦(?:於)?\s*/gu, "急診評估聚焦於")
    .replace(/本章重點(?:則)?是\s*/gu, "重點是")
    .replace(/本章特別提醒\s*[：:]?/gu, "需特別注意：")
    .replace(/本章提醒\s*/gu, "需注意")
    .replace(/本章成人\s*/gu, "成人")
    .replace(/本章藥物\s*/gu, "相關藥物")
    .replace(/本章表格常用\s*/gu, "常用")
    .replace(/本章使用的術語\s*/gu, "常用術語為")
    .replace(/本章使用\s*/gu, "臨床上使用")
    .replace(/本章將\s+([^。；;\n|]{1,100}?)\s+視為/gu, "$1 可視為")
    .replace(/本章將\s+([^。；;\n|]{1,100}?)\s+定義為/gu, "$1 定義為")
    .replace(/本章將\s+([^。；;\n|]{1,100}?)\s+描述為/gu, "$1 是")
    .replace(/本章將\s+([^。；;\n|]{1,100}?)\s+列為/gu, "$1 屬")
    .replace(/本章將\s*/gu, "")
    .replace(/本章定義(?:為)?\s*/gu, "定義為")
    .replace(/本章對\s+([^。；;\n]{1,80}?)\s+的定義/gu, "$1 的定義")
    .replace(/本章引用的研究顯示\s*/gu, "相關研究顯示，")
    .replace(/本章引用的早期論點/gu, "早期資料")
    .replace(/本章引用的\s*/gu, "")
    .replace(/本章背景資料亦指出\s*/gu, "背景資料顯示，")
    .replace(/本章流行病學資料指出\s*/gu, "流行病學資料顯示，")
    .replace(/本章出版時資料顯示\s*/gu, "歷史資料顯示，")
    .replace(/本章以美國人口趨勢為背景，指出\s*/gu, "美國人口趨勢資料顯示，")
    .replace(/本章以\s*24\s*週作為簡化的\s*viability\s*界線/giu, "傳統上曾以 24 週作為簡化的 viability 界線")
    .replace(/本章原則上以\s*/gu, "傳統上以")
    .replace(/本章整體採\s*/gu, "建議採")
    .replace(/本章以\s+([^。；;\n]{1,100}?)\s+為主/gu, "重點為 $1")
    .replace(/本章以\s*/gu, "以")
    .replace(/本章僅(?:在|於)\s*/gu, "僅在")
    .replace(/本章僅概述\s*/gu, "此處僅概述")
    .replace(/本章(?:並)?未指定\s*/gu, "沒有固定")
    .replace(/本章(?:並)?未(?:另行)?詳述\s*/gu, "")
    .replace(/本章(?:並)?未(?:進一步)?展開\s*/gu, "")
    .replace(/本章(?:並)?未提供\s*/gu, "目前沒有")
    .replace(/本章沒有\s*/gu, "目前沒有")
    .replace(/在本章的\s*/gu, "在")
    .replace(/理解本章時(?:應)?\s*/gu, "")
    .replace(/本章提出的\s*/gu, "")
    .replace(/本章採用的病程分類/gu, "常用病程分類")
    .replace(/本章採用的\s*/gu, "常用")
    .replace(/本章的五個最重要訊息是\s*[：:]?/gu, "五項核心訊息包括：")
    .replace(/全章最重要的觀念/gu, "核心觀念")
    .replace(/本章的重點不是\s*/gu, "重點不在於")
    .replace(/本章的急診核心不是\s*/gu, "急診處置不只在於")
    .replace(/本章的核心\s*[，,]\s*不是\s*/gu, "核心不在於")
    .replace(/本章的核心命題/gu, "核心臨床觀念")
    .replace(/本章的核心數字/gu, "重要數據")
    .replace(/本章的臨床主軸可以濃縮成/gu, "臨床處置可分為")
    .replace(/本章的五個核心訊息是\s*[：:]?/gu, "核心訊息包括：")
    .replace(/本章最重要的任務不是\s*/gu, "急性期不只在於")
    .replace(/先抓住本章最重要的臨床觀念/gu, "核心臨床觀念")
    .replace(/先抓住本章的臨床主軸/gu, "核心臨床主軸")
    .replace(/先抓住本章最重要\s*/gu, "先抓住最重要")
    .replace(/本章最實用的急診原則/gu, "實用急診原則")
    .replace(/本章最重要的五項原則/gu, "五項核心原則")
    .replace(/本章處理的是兩個\s*/gu, "臨床上應分開處理兩個")
    .replace(/本章討論兩種\s*/gu, "兩種")
    .replace(/本章實際涵蓋三條\s*/gu, "臨床上可分為三條")
    .replace(/本章其實在比較三種\s*/gu, "臨床上需比較三種")
    .replace(/本章建立的是\s*/gu, "可採用")
    .replace(/本章採用的操作性標準/gu, "常用操作性標準")
    .replace(/本章採用的診斷定義/gu, "常用診斷定義")
    .replace(/本章以成人\s+PSA\s+為主/giu, "成人 PSA 的核心流程")
    .replace(/本章以\s+([^。；;\n]{1,60})\s+為背景/gu, "$1 是重要背景")
    .replace(/本章聚焦的不是\s*/gu, "重點不在於")
    .replace(/本章所列數據/gu, "所列數據")
    .replace(/本章資料(?:中|顯示)?\s*[，,]?\s*/gu, "資料顯示，")
    .replace(/本章背景資料指出\s*/gu, "背景資料顯示，")
    .replace(/章中歷史性資料顯示\s*/gu, "歷史資料顯示，")
    .replace(/章中(?:也)?(?:特別)?(?:提到|指出|強調|列出|引用|引述|呈現)\s*[，,]?\s*/gu, "")
    .replace(/章中的\s*/gu, "")
    .replace(/章內(?:所)?列(?:的)?\s*/gu, "參考")
    .replace(/章內(?:所)?述\s*/gu, "")
    .replace(/章內(?:的)?\s*/gu, "")
    .replace(/章中(?:的)?\s*/gu, "")
    .replace(/章節處置重點/gu, "處置重點")
    .replace(/章中定義/gu, "定義")
    .replace(/章中呈現的\s*/gu, "")
    .replace(/正文並未另外提供([^。！？\n]{0,100})/gu, "目前沒有$1")
    .replace(/章內資料顯示\s*/gu, "資料顯示，")
    .replace(/章內將\s+([^。；;\n]{1,80}?)\s+列為/gu, "$1 屬")
    .replace(/章中將\s+[^。；;\n]{0,50}\s*概分為/gu, "臨床上可概分為")
    .replace(/章內以\s*/gu, "可用")
    .replace(/章內可接受成角/gu, "常用可接受成角")
    .replace(/章內重要流行病學數字/gu, "流行病學與高風險族群")
    .replace(/本章列出的正常\s+hemogram/giu, "正常 hemogram 參考值")
    .replace(/本章的歷史背景數字/gu, "歷史背景資料")
    .replace(/章節引用的\s*/gu, "")
    .replace(/章中部分人口、法規與研究數據取自特定年份，以下均保留年代，應視為本章的證據背景，而非即時統計或完整法律意見[。！？]?/gu, "")
    .replace(/以上皆為原章年代資料[^。！？]*[。！？]?/gu, "")
    .replace(/本章引用的\s*出版年代資料顯示\s*[，,]?\s*/gu, "歷史資料顯示，")
    .replace(/本章引用(?:的)?\s*(?:source-era\s*)?資料(?:指出|顯示)\s*[，,]?\s*/giu, "資料顯示，")
    .replace(/本章引用(?:的)?\s*(?:source-era\s*)?(?=(?:\d{4}\s*年|美國|全球|severe\s+sepsis|poison-center|CDC|WHO))/giu, "")
    .replace(/原章(?:所引|引用的?)\s*/gu, "")
    .replace(/原章(?:亦|也|另)?(?:特別)?(?:指出|報告|認為|強調|提到|提出|描述|稱|引用)\s*[，,]?\s*/gu, "")
    .replace(/原章資料顯示\s*[，,]?\s*/gu, "資料顯示，")
    .replace(/原章年代\s*[，,]?\s*/gu, "當時，")
    .replace(/原章一般以\s*/gu, "常以 ")
    .replace(/原章通常\s*/gu, "通常")
    .replace(/原章的\s+WHO\s+framework/giu, "WHO framework")
    .replace(/原章小型研究/gu, "一項小型研究")
    .replace(/原章依\s+([^。；;\n]{1,80})\s+列出定義/gu, "可依 $1 定義")
    .replace(/原章\s+(?:Figures?|Tables?)\s*[\w.-]+(?:\s*(?:至|[-–—])\s*[\w.-]+)?\s*(?:的重點是|之重點是)\s*[：:]/giu, "核心概念是：")
    .replace(/原章\s+(?:Figures?|Tables?)\s*[\w.-]+(?:\s*(?:至|[-–—])\s*[\w.-]+)?\s*(?:將|依|整理(?:為)?|列出)\s*/giu, "")
    .replace(/原章估計\s*/gu, "估計")
    .replace(/原章(?:將|把)\s*/gu, "")
    .replace(/原章(?:以|使用的?|列出的?|建議)\s*/gu, "")
    .replace(/原章常見\s*/gu, "常見")
    .replace(/原章出版時亦?指出\s*[，,]?\s*/gu, "當時資料顯示，")
    .replace(/原章(?:的)?背景數字(?:如下)?\s*[：:]?/gu, "具臨床意義的數據包括：")
    .replace(/本章資料指出\s*/gu, "資料顯示，")
    .replace(/本章(?:特別)?(?:指出|提到|報告|估計)\s*[，,]?\s*/gu, "")
    .replace(/本章引用的歷史資料\s*/gu, "歷史資料")
    .replace(/本章的主題不是\s*/gu, "重點不在於")
    .replace(/本章的核心不是\s*/gu, "核心不在於")
    .replace(/本章採較廣義的疾病光譜，涵蓋\s*/gu, "臨床表型可涵蓋")
    .replace(/本章常將\s*/gu, "臨床上常將")
    .replace(/本章稱其為\s*/gu, "這是")
    .replace(/本章稱為\s*/gu, "稱為")
    .replace(/本章對\s+([^。\n]{1,60}?)\s+的描述是/gu, "$1 是")
    .replace(/本章內容主要聚焦高齡者，也特別指出下列功能受損者的脆弱性\s*[：:]/gu, "除高齡者外，下列功能受損者也特別脆弱：")
    .replace(/本章實際聚焦於[^。！？]*；並未獨立詳述[^。！？]*[。！？]?/gu, "")
    .replace(/本章最常見/gu, "最常見")
    .replace(/本章最重要的觀念\s*[：:]?/gu, "最重要的觀念是：")
    .replace(/本章最重要的原則(?:只有一句)?\s*[：:]?/gu, "最重要的原則是：")
    .replace(/本章原則是\s*[：:]?/gu, "")
    .replace(/本章一般建議/gu, "一般建議")
    .replace(/本章沒有提供([^。！？\n]{0,80})/gu, "目前沒有$1")
    .replace(/本章引用的\s+complication rate/giu, "短期周邊輸注的 complication rate")
    .replace(/本章不是在討論\s*/gu, "臨床重點不是")
    .replace(/本章將其分為\s*/gu, "臨床上可分為")
    .replace(/本章涵蓋的急診情境包括\s*/gu, "常見急診情境包括")
    .replace(/本章涵蓋\s*/gu, "臨床評估涵蓋")
    .replace(/本章沿用\s*(\*?[^。；;\n]{1,60}?)\s*一詞/gu, "臨床上曾使用 $1 一詞")
    .replace(/本章沿用\s*術語\s*/gu, "傳統術語為")
    .replace(/本章使用的術語\s*/gu, "常用術語為")
    .replace(/章內定義為\s*/gu, "定義為")
    .replace(/教材(?:也)?(?:指出|列出|提到)\s*[，,]?\s*/gu, "")
    .replace(/教材所引用的\s*/gu, "")
    .replace(/教材引用的\s*/gu, "")
    .replace(/本版教材的歷史背景/gu, "歷史背景資料")
    .replace(/這些數字是歷史背景資料，不宜直接視為目前的\s*/gu, "這些數據會隨年代與地區變動，不宜直接視為目前的 ")
    .replace(/另引用\s*(?=\d{4}\s*[–—-]\s*\d{4}\s*年)/gu, "")
    .replace(/教科書時期資料顯示\s*[，,]?\s*/gu, "歷史資料顯示，")
    .replace(/依原書年代資料\s*/gu, "歷史資料顯示，")
    .replace(/原書與現代概念的差異/gu, "臨床概念的演變")
    .replace(/原書使用舊稱\s*/gu, "舊稱")
    .replace(/Tintinalli(?:['’]s)?(?: Emergency Medicine)?\s*(?:第\s*\d+\s*版|9e)?\s*(?:的|所)?\s*(?:資料)?(?:指出|估計|顯示)\s*[，,]?\s*/giu, "資料顯示，")
    .replace(/Tintinalli(?:['’]s)?(?: Emergency Medicine)?\s*(?:第\s*\d+\s*版|9e)\s*採用的\s*定義為/giu, "常用定義為")
    .replace(/Tintinalli(?:['’]s)?(?: Emergency Medicine)?\s*(?:第\s*\d+\s*版|9e)\s*的歷史資料中/giu, "歷史資料中")
    .replace(/Tintinalli(?:['’]s)?(?: Emergency Medicine)?\s*(?:第\s*\d+\s*版|9e)?\s*(?:指出|認為)\s*[，,]?\s*/giu, "")
    .replace(/\bSource\s+寫\s*/giu, "資料顯示，")
    .replace(/\bSource\s+DSM-5-era\s+概念為\s*[：:]?/giu, "DSM-5 診斷架構為：")
    .replace(/這些數字屬於出版年代與特定國家的估計，真正考點在於\s*[：:]/gu, "不同年代與地區的估計會變動；臨床重點是：")
    .replace(/章中歷史背景資料指出\s*[，,]?\s*/gu, "歷史資料顯示，")
    .replace(/這些數字屬出版年代的流行病學背景[。！？]?/gu, "")
    .replace(/本章以出版年代的\s*(\d{4})\s*年資料開場\s*[：:]/gu, "$1 年資料顯示：")
    .replace(/這些是歷史背景，不是\s*\d{4}\s*年即時流行病學[。！]?/gu, "")
    .replace(/本章出版年代的北美死亡率/gu, "北美資料中的死亡率")
    .replace(/書中引用的美國人口預估為[^。！？；;]*[；;。！？]\s*這是出版年代的流行病學背景，而非現況數字[。！？]?/gu, "人口老化使老年創傷的比重持續上升。")
    .replace(/書中提到，一項\s*validated frailty score\s*對不良結果的預測甚至優於/giu, "Frailty score 對不良結果的預測可能優於")
    .replace(/；本章未指定量表名稱或\s*cutoff[。！？]?/giu, "。量表選擇與判讀門檻應依臨床情境與院內流程。")
    .replace(/這些數字、法律分類及藥物市場狀況均屬教科書出版年代背景，不應視為目前統計或現行法規[。！？]?/gu, "")
    .replace(/原文另有數個疑似排版錯誤或內部矛盾，已在文末集中標示，避免誤作臨床處方[。！？]?/gu, "")
    .replace(/\bSource\s*(?:數據|data)\s*[：:]?/giu, "資料顯示：")
    .replace(/原表寫\s*/gu, "")
    .replace(/\bSource(?:指出|將|報告|估計|列出|建議|強調)\s*[，,]?\s*/giu, "")
    .replace(/\bsource\s+的\s*/giu, "")
    .replace(/\bsource-era\s*/giu, "")
    .replace(/原章成人劑量\s*[／/]\s*要點/gu, "成人劑量／要點")
    .replace(/原章列於\s*/gu, "常用於")
    .replace(/原章期望值\s*[／/]\s*解讀/gu, "期望值／解讀")
    .replace(/原章值/gu, "參考值")
    .replace(/Tintinalli\s*9e\s*regimen/giu, "治療方案")
    .replace(/Source\s*caveat/giu, "判讀注意")
    .replace(/教材所引資料中\s*/gu, "資料顯示，")
    .replace(/這些是教科書出版時的\s*/gu, "這些")
    .replace(/這些是\*\*?教科書出版時點\*\*?的歷史背景數字\s*[，,]\s*而非[^。！？]*[。！？]?/gu, "")
    .replace(/這些是\*\*?教科書出版時點\*\*?的歷史背景數字[。！？]?/gu, "")
    .replace(/這些是教科書出版時點的歷史背景數字[。！？]?/gu, "")
    .replace(/這些是的\s*統計/gu, "統計資料顯示")
    .replace(/(?:這是)?原章內部的分類用語差異/gu, "不同資料表的分類方式並不一致")
    .replace(/原章符號註腳中的\s*/gu, "")
    .replace(/原章的\s+Clinical Approach box\s*/giu, "臨床處置重點")
    .replace(/原章文字疑點\s*[：:]/gu, "重要校正：")
    .replace(/原章的慢性藥物敘述屬內容，不取代現行\s*/gu, "慢性藥物治療應依現行 ")
    .replace(/考試與實務要分開\s*[：:]\s*表格/gu, "表格")
    .replace(/章節對\s+gauge\s+的文字不完全一致/giu, "不同段落對 gauge 的描述不完全一致")
    .replace(/本章定義\s+drowning\s+為/giu, "Drowning 是")
    .replace(/第\s*9\s*版\s*Table\s*215-2\s*仍使用\s*near-drowning/giu, "較舊資料仍使用 near-drowning")
    .replace(/原章的\s*/gu, "")
    .replace(/原章\s*/gu, "")
    .replace(/這些數字屬出版年代的流行病學背景[。！？]?/gu, "")
    .replace(/本章使用的\s+source-era\s+術語\s*/giu, "既有術語")
    .replace(/章末考題(?:的)?\s*/gu, "")
    .replace(/考題真正要問的是\s*[：:]?/gu, "判讀關鍵是：")
    .replace(/考題數值/gu, "參考數值")
    .replace(/考題重點/gu, "臨床重點")
    .replace(/考題陷阱/gu, "判讀陷阱")
    .replace(/考試陷阱/gu, "判讀陷阱")
    .replace(/供考試複習/gu, "作為判讀參考")
    .replace(/教材報告\s*/gu, "資料顯示，")
    .replace(/教材的\s*/gu, "")
    .replace(/教科書式\s*/gu, "典型")
    .replace(/教材考點/gu, "重要背景")
    .replace(/廣泛性皮膚疾病[：:]\s*急診專科考試整合指南/gu, "廣泛性皮膚疾病")
    .replace(/急診專科考試整合指南/gu, "")
    .replace(/以上是整理的急診整合架構，不是(?:原書|既有資料)提供的正式\s*/gu, "以下為急診整合架構，並非正式 ")
    .replace(/為避免(?:原書|既有資料)\s*/gu, "為避免")
    .replace(/原書正文另稱\s*/gu, "另有資料稱")
    .replace(/Tintinalli\s*9e\s*的\s*分類/giu, "這套分類")
    .replace(/本章(?:的)?\s*/gu, "")
    .replace(/全章/gu, "整體")
    .replace(/\b\d{2}_[A-Za-z][A-Za-z0-9_]*\b/gu, "")
    .replace(/([；。])的\s+([A-Z])/gu, "$1$2")
    .replace(/(^|[。！？]\s*)的警訊包括\s*[：:]?/gmu, "$1重要警訊包括：")
    .replace(/(^|[。！？]\s*)的流行病學/gmu, "$1流行病學")
    .replace(/(^|[。！？]\s*)的合理解釋是\s*[：:]?/gmu, "$1可能的解釋是：")
    .replace(/(^|\n)SBP\s*<\s*90\s*mm\s*Hg\s+為標準估計/giu, "$1若以 SBP <90 mm Hg 為標準估計")
    .replace(/該版本的\s*範例/gu, "常見範例")
    .replace(/資料顯示\s*[，,]\s*[，,]/gu, "資料顯示，")
    .replace(/^(?:資料|背景資料|歷史資料)顯示\s*[：:]\s*$/gmu, "")
    .replace(/\bsource-era\s*/giu, "")
    .replace(/\bsource\s+(?=(?:regimen|threshold)\b)/giu, "")
    .replace(/教科書(?:亦|也)?(?:指出|列出|提到|提及)\s*[，,]?\s*/gu, "")
    .replace(/考試核心\s*[：:]\s*/gu, "")
    .replace(/考點是\s*/gu, "")
    .replace(/\s*[（(]\s*(?:Tables?|Figures?)\s*\d+[A-Za-z]?(?:[-–—.]\d+)?(?:\s*(?:[,、～~–—]|and|至)\s*(?:Tables?|Figures?)?\s*\d+[A-Za-z]?(?:[-–—.]\d+)?)?\s*[）)]/giu, "")
    .replace(/(?:，\s*){2,}/gu, "，")
    .replace(/具有及地區差異/gu, "具有制度與地區差異")
    .replace(/具有明顯\s*屬性/gu, "已不符合現行治療標準")
    .replace(/(^|[。！？]\s*)的?\s*expert consensus\s*偏好/gimu, "$1Expert consensus 偏好")
    .replace(/在\s+三種主要表現為/gu, "常見三種主要表現為")
    .replace(/這些\s+hemodynamic thresholds\s*[；;]/giu, "這些 hemodynamic thresholds 僅供風險判讀；")
    .replace(/\s*，\s*[；;]/gu, "；")
    .replace(/，；/gu, "；")
    .replace(/屬\s*[；;]/gu, "；")
    .replace(/\s*，\s*[；;]/gu, "；")
    .replace(/，；/gu, "；")
    .replace(/某些人口學\s*risk factors\s*[，,]?\s*但這些只能/giu, "人口學 risk factors 可調整風險判斷，但只能")
    .replace(/^：\s*$/gmu, "")
    .replace(/。\s*[：:]\s*/gu, "。")
    .replace(/^的典型流程是\s*[：:]?/gmu, "典型流程是：")
    .replace(/^(\s{0,3})-(?=\p{L})/gmu, "$1- ")
    .replace(/[ \t]{2,}/gu, " ");

  return applyLearnerFacingRewrites(rewritten, learnerFacingTextRewrites)
    .replace(/^，\s*/gmu, "")
    .replace(/^：\s*(?=\S)/gmu, "")
    .replace(/資料顯示\s*[，,]\s*(?:指出|認為)\s*[，,]/gu, "資料顯示，")
    .replace(/資料顯示\s*[，,]\s*估計\s*[，,]/gu, "資料估計，")
    .replace(/資料顯示\s*[，,]\s*[：:]/gu, "")
    .replace(/急診評估聚焦於的不是/gu, "急診評估的重點不是")
    .replace(/(^|[。\n]\s*)的歷史 epidemiology/gmu, "$1歷史 epidemiology")
    .replace(/這些是\*\*?的\s*(\d{4}\s*年資料)/gu, "這些是 **$1")
    .replace(/(^|[。\n]\s*)的風險管理問題/gmu, "$1主要風險管理問題")
    .replace(/\|\s*類別\s*\|\s*的主要威脅\s*\|/gu, "| 類別 | 主要威脅 |")
    .replace(/(^|\n)以下處置、手術門檻與藥物方案整理/gmu, "$1以下整理急診處置、手術門檻與藥物方案")
    .replace(/\*\*\s+\*\*/gu, " ")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function removeStandaloneMarkdownFragments(value: string) {
  return value
    .split("\n")
    .filter((line) => !/^\s*(?:>\s*|(?:>\s*)?(?:\*{1,3}|_{1,3}))\s*$/u.test(line))
    .join("\n")
    .trim();
}

function repairUnbalancedStrongMarkers(value: string) {
  const markers = value.match(/(?<!\\)\*\*/gu) ?? [];
  if (markers.length % 2 === 0) return value;
  const lines = value.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].trim()) continue;
    lines[index] = `${lines[index].trimEnd()}**`;
    return lines.join("\n");
  }
  return value;
}

function finalizeLearnerBlock(value: string) {
  return repairUnbalancedStrongMarkers(removeStandaloneMarkdownFragments(value));
}

function sanitizeTopLevelNode(item: ParsedNode) {
  if (item.node.type === "blockquote") {
    return finalizeLearnerBlock(rewriteSourceFraming(sanitizeBlockquote(item.raw)));
  }
  if (item.node.type === "paragraph") return finalizeLearnerBlock(rewriteSourceFraming(sanitizeParagraphBody(item.raw)));
  if (item.node.type === "list") return finalizeLearnerBlock(rewriteSourceFraming(sanitizeList(item.raw)));
  if (item.node.type === "table") return finalizeLearnerBlock(rewriteSourceFraming(item.raw));
  if (item.node.type === "heading") {
    const generated = plainLabel(item.text).match(generatedQuickHeadingPattern);
    if (generated) return `${"#".repeat(item.heading?.depth ?? 2)} ${generated[1]}`;
  }
  return item.raw;
}

function isStandaloneOpeningSubtitle(item: ParsedNode) {
  if (item.node.type !== "paragraph") return false;
  const match = item.raw.trim().match(/^\*\*([^*\n]{2,120})\*\*$/u);
  if (!match) return false;
  return !/[。；;!?！？]/u.test(match[1]);
}

function learnerFacingDocumentTitle(label: string) {
  return plainLabel(label)
    .replace(/^(?:Tintinalli(?:['’]s)?(?: Emergency Medicine)?\s*)?第\s*\d+\s*章\s*[｜|：:\-—–]\s*/iu, "")
    .replace(/^CH\s*\d+\s*[｜|：:\-—–]\s*/iu, "")
    .replace(/^(?:第\s*\d+\s*章|Chapter\s+\d+|Rosen['’]s Emergency Medicine\s*第\s*\d+\s*章)\s*[｜|：:\-—–]?\s*/iu, "")
    .replace(/^Tintinalli['’]s Emergency Medicine(?:\s*9e|\s*第\s*9\s*版)?(?:\s*第\s*\d+\s*章)?$/iu, "")
    .replace(/[—–-]\s*急診專科考試整合指南\s*$/u, "")
    .replace(/[：:—–-]?\s*急診(?:皮膚表現)?(?:專科考試)?(?:整合)?(?:讀書|學習)?指南\s*$/u, "")
    .replace(/[：:]\s*$/u, "")
    .trim();
}

function canonicalDocumentTitle(nodes: ParsedNode[]) {
  const h1 = nodes.find((item) => item.heading?.depth === 1)?.heading?.label ?? "";
  const fromH1 = learnerFacingDocumentTitle(h1);
  if (fromH1 && !/^(?:Rosen['’]s|Tintinalli['’]s)\s+Emergency Medicine\b/iu.test(fromH1)) {
    return fromH1;
  }
  const firstClinicalH2 = nodes.find((item) => (
    item.heading?.depth === 2
    && !isProductionHeading(item.heading.label)
  ))?.heading?.label ?? "";
  return stripStructuralOutlinePrefix(plainLabel(firstClinicalH2))
    .replace(/急診(?:皮膚表現)?(?:專科考試)?(?:整合)?(?:讀書|學習)?指南/gu, "")
    .replace(/[：:]\s*$/u, "")
    .trim();
}

function rewriteLearnerFacingHeading(
  raw: string,
  heading: NonNullable<ParsedNode["heading"]>,
  documentTitle: string,
) {
  let label = applyLearnerFacingRewrites(
    plainLabel(heading.label),
    learnerFacingHeadingRewrites,
  )
    .replace(/[：:—–-]?\s*急診(?:皮膚表現)?專科考試(?:整合)?(?:讀書|學習)?指南\s*$/u, "")
    .replace(/[：:—–-]?\s*急診整合讀書指南\s*$/u, "")
    .replace(/[：:—–-]?\s*急診專科考試整合講義\s*$/u, "")
    .replace(/與專科考試整合\s*$/u, "")
    .replace(/\b急診專科考試(?:整合)?(?:讀書|學習)?指南\b/gu, "")
    .replace(/\b急診專科考試整合講義\b/gu, "")
    .replace(/\s*(?:學習|讀書)指南\s*$/u, "")
    .replace(/專科考試與床邊陷阱整合/gu, "床邊判讀陷阱")
    .replace(/專科考試快速整合/gu, "快速臨床整合")
    .replace(/專科考試陷阱整合/gu, "常見判斷陷阱")
    .replace(/急診與專科考試整合重點/gu, "急診處置重點")
    .replace(/^(\d+(?:\.\d+)*)\.\s*考試整合$/u, "$1. 核心臨床重點")
    .replace(/本章的核心命題/gu, "核心臨床觀念")
    .replace(/本章的核心數字/gu, "重要數據")
    .replace(/本章最重要的五個觀念/gu, "五個核心觀念")
    .replace(/本章最重要的五項原則/gu, "五項核心原則")
    .replace(/全章最重要的觀念/gu, "核心觀念")
    .replace(/先抓住本章最重要的臨床觀念/gu, "核心臨床觀念")
    .replace(/先抓住本章的臨床主軸/gu, "核心臨床主軸")
    .replace(/這章真正要教的是什麼[？?]?/gu, "社會條件如何改變急診照護")
    .replace(/章內重要流行病學數字/gu, "流行病學與高風險族群")
    .replace(/本章列出的正常\s+hemogram/giu, "正常 hemogram 參考值")
    .replace(/本章的歷史背景數字/gu, "歷史背景資料")
    .replace(/原章的重要安全勘誤/gu, "重要安全校正")
    .replace(/原章表格缺漏/gu, "表格資料限制")
    .replace(/章內用藥資料警示/gu, "重要用藥校正")
    .replace(/章內分類提醒/gu, "分類差異")
    .replace(/原書生理錯誤/gu, "重要生理校正")
    .replace(/自我疏忽的原文矛盾/gu, "自我疏忽的判讀重點")
    .replace(/定義與章節範圍/gu, "核心定義與風險分層")
    .replace(/Seizure classification\s*[：:]\s*先知道原書術語，再換成現行語言/giu, "Seizure classification：臨床分類架構")
    .replace(/原章的\s+epidemiology/giu, "Epidemiology")
    .replace(/Table\s*175-2\s*正常\s*CSF(?:\s*[（(][^）)]*[）)])?/giu, "正常 CSF 參考值")
    .replace(/^(\d+(?:\.\d+)*)\s*[—–-]\s*Space$/iu, "$1. 空間與隱私")
    .replace(/\s*[（(]\s*[）)]\s*$/u, "")
    .replace(/\bsource therapeutic descriptors\b/giu, "治療濃度描述")
    .replace(/\bsource-era\b/giu, "")
    .replace(/先用急診思維統整全章/gu, "急診整合思維")
    .replace(/先抓住本章/gu, "先抓住")
    .replace(/先理解本章/gu, "先理解")
    .replace(/本章真正要教的/gu, "首要臨床重點")
    .replace(/本章(?:的)?\s*/gu, "")
    .replace(/全章第一個問題/gu, "首要問題")
    .replace(/全章共同/gu, "共同")
    .replace(/全章/gu, "整體")
    .replace(/整體核心/gu, "核心")
    .replace(/整體最重要/gu, "最重要")
    .replace(/章內(?:的)?\s*/gu, "")
    .replace(/章中(?:的)?\s*/gu, "")
    .replace(/教材的\s*/gu, "")
    .replace(/考題陷阱/gu, "判讀陷阱")
    .replace(/考試陷阱/gu, "判讀陷阱")
    .replace(/原章常見/gu, "常見")
    .replace(/原章(?:的)?\s*/gu, "")
    .replace(/原書\s*/gu, "")
    .replace(/\s*[（(]\s*(?:Fig(?:ure)?|Table|Box)\.?\s*\d+(?:[A-Za-z]|\.\d+|-\d+)*(?:\s*[～~–—-]\s*\d+(?:\.\d+)*)?\s*[）)]/giu, "")
    .replace(/([：:])\s+(?=\S)/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();

  if (heading.depth === 1) {
    label = learnerFacingDocumentTitle(label) || label;
  }
  const structuralMatch = label.match(/^(\d+(?:\.\d+)*)\.\s*/u);
  if (
    heading.depth === 2
    && structuralMatch?.[1] === "1"
    && openingMajorHeadingOverrides[documentTitle]
  ) {
    label = `1. ${openingMajorHeadingOverrides[documentTitle]}`;
  }
  if (
    heading.depth === 2
    && structuralMatch
    && stripStructuralOutlinePrefix(label) === documentTitle
  ) {
    label = `${structuralMatch[1]}. 急診辨識與處置`;
  }
  if (structuralMatch && label.slice(structuralMatch[0].length).trim().length === 0) {
    label = `${structuralMatch[1]}. ${
      heading.depth === 2 ? "急診辨識與處置" : (documentTitle || "核心臨床架構")
    }`;
  }
  if (!label) return raw;
  return `${"#".repeat(heading.depth)} ${label}`;
}

function openingEditorialIndices(nodes: ParsedNode[]) {
  const indices = new Set<number>();
  let majorHeadingCount = 0;
  let nodesAfterFirstMajorHeading = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const item = nodes[index];
    if (item.heading?.depth === 2) {
      majorHeadingCount += 1;
      if (majorHeadingCount > 1) break;
      continue;
    }
    if (majorHeadingCount === 1) {
      if (item.heading && item.heading.depth >= 3) break;
      nodesAfterFirstMajorHeading += 1;
      if (nodesAfterFirstMajorHeading > 8) break;
    }
    if (
      (item.node.type === "blockquote" && isReaderEditorialBlockquote(item.raw))
      || (majorHeadingCount === 0 && isStandaloneOpeningSubtitle(item))
      || (
        ["blockquote", "paragraph", "list"].includes(item.node.type)
        && (
          openingEditorialLanguagePattern.test(item.text)
          || explicitOpeningEditorialLanguagePattern.test(item.text)
        )
      )
    ) {
      indices.add(index);
    }
  }
  return indices;
}

function hasReadableContent(value: string) {
  return value.replace(/^[#>*+\-\d.)\s`_~|:]+/gmu, "").trim().length > 0;
}

function headingMajorNumber(label: string) {
  const match = plainLabel(label).match(/^(\d+)(?=(?:\.\d+)*\.?(?:\s|[：:｜|]))/u);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

function replaceHeadingMajorNumber(raw: string, replacements: Map<number, number>) {
  return raw.replace(
    /^(\s{0,3}#{2,6}\s+)(\d+)(?=(?:\.\d+)*\.?(?:\s|[：:｜|]))/u,
    (match, prefix: string, value: string) => {
      const replacement = replacements.get(Number(value));
      return replacement === undefined ? match : `${prefix}${replacement}`;
    },
  );
}

function collapseEmptyOpeningMajorSection(nodes: ParsedNode[], cleaned: string[]) {
  const firstMajorIndex = nodes.findIndex((item, index) => (
    item.heading?.depth === 2 && hasReadableContent(cleaned[index] ?? "")
  ));
  if (firstMajorIndex < 0 || headingMajorNumber(nodes[firstMajorIndex].heading?.label ?? "") !== 1) return;

  const nextMajorIndex = nodes.findIndex((item, index) => (
    index > firstMajorIndex
    && item.heading?.depth === 2
    && hasReadableContent(cleaned[index] ?? "")
  ));
  if (nextMajorIndex < 0 || headingMajorNumber(nodes[nextMajorIndex].heading?.label ?? "") !== 2) return;

  const openingContent = nodes
    .slice(firstMajorIndex + 1, nextMajorIndex)
    .map((_item, offset) => cleaned[firstMajorIndex + 1 + offset] ?? "")
    .filter(hasReadableContent);
  const openingPlainText = openingContent
    .join(" ")
    .replace(/[#>*_`~|[\]()]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const thinScopeSection = (
    openingContent.length <= 2
    && openingPlainText.length <= 220
    && /(?:Table|Figure|內容範圍|涵蓋範圍|後續章節|後續小節|另節展開|本章導讀|制度適用範圍|核心重點)/iu.test(
      `${nodes[firstMajorIndex].heading?.label ?? ""} ${openingPlainText}`,
    )
  );
  if (openingContent.length && !thinScopeSection) return;

  cleaned[firstMajorIndex] = "";
  for (let index = firstMajorIndex + 1; index < nextMajorIndex; index += 1) {
    if (nodes[index].node.type === "thematicBreak" || thinScopeSection) cleaned[index] = "";
  }

  const replacements = new Map<number, number>();
  for (let index = nextMajorIndex; index < nodes.length; index += 1) {
    if (nodes[index].heading?.depth !== 2 || !hasReadableContent(cleaned[index] ?? "")) continue;
    const current = headingMajorNumber(nodes[index].heading?.label ?? "");
    if (current !== null && current >= 2) replacements.set(current, current - 1);
  }
  if (!replacements.has(2)) return;

  for (let index = nextMajorIndex; index < nodes.length; index += 1) {
    if (!nodes[index].heading || !hasReadableContent(cleaned[index] ?? "")) continue;
    cleaned[index] = replaceHeadingMajorNumber(cleaned[index], replacements);
  }
}

function renameOpeningAbbreviationSection(nodes: ParsedNode[], cleaned: string[]) {
  const firstMajorIndex = nodes.findIndex((item, index) => (
    item.heading?.depth === 2 && hasReadableContent(cleaned[index] ?? "")
  ));
  if (firstMajorIndex < 0 || headingMajorNumber(nodes[firstMajorIndex].heading?.label ?? "") !== 1) return;
  const nextMajorIndex = nodes.findIndex((item, index) => (
    index > firstMajorIndex
    && item.heading?.depth === 2
    && hasReadableContent(cleaned[index] ?? "")
  ));
  const openingText = cleaned
    .slice(firstMajorIndex + 1, nextMajorIndex < 0 ? undefined : nextMajorIndex)
    .filter(hasReadableContent)
    .join("\n\n");
  if (!/^本文縮寫\s*[：:]/u.test(openingText.trim())) return;
  cleaned[firstMajorIndex] = "## 1. 常用縮寫";
}

function removeOpeningSeparators(nodes: ParsedNode[], cleaned: string[]) {
  const firstMajorIndex = nodes.findIndex((item, index) => (
    item.heading?.depth === 2 && hasReadableContent(cleaned[index] ?? "")
  ));
  if (firstMajorIndex < 0) return;

  for (let index = 0; index < firstMajorIndex; index += 1) {
    if (nodes[index].node.type === "thematicBreak") cleaned[index] = "";
  }

  for (let index = firstMajorIndex + 1; index < nodes.length; index += 1) {
    if (nodes[index].node.type !== "thematicBreak" || !(cleaned[index] ?? "").trim()) continue;
    let previous = index - 1;
    while (previous >= 0 && !hasReadableContent(cleaned[previous] ?? "")) previous -= 1;
    let next = index + 1;
    while (next < nodes.length && !hasReadableContent(cleaned[next] ?? "")) next += 1;
    if (
      previous >= 0
      && next < nodes.length
      && (nodes[previous].heading || nodes[next].heading)
    ) {
      cleaned[index] = "";
    }
  }
}

function relocateOpeningProductionSubsections(nodes: ParsedNode[], cleaned: string[]) {
  const relocated: string[] = [];
  const firstMajorIndex = nodes.findIndex((item, index) => (
    item.heading?.depth === 2 && hasReadableContent(cleaned[index] ?? "")
  ));
  if (firstMajorIndex < 0) return relocated;
  const nextMajorIndex = nodes.findIndex((item, index) => (
    index > firstMajorIndex
    && item.heading?.depth === 2
    && hasReadableContent(cleaned[index] ?? "")
  ));
  const sectionLimit = nextMajorIndex < 0 ? nodes.length : nextMajorIndex;

  for (let index = firstMajorIndex + 1; index < sectionLimit; index += 1) {
    const heading = nodes[index].heading;
    if (heading?.depth !== 3) {
      continue;
    }
    let end = index + 1;
    while (
      end < sectionLimit
      && !(nodes[end].heading && (nodes[end].heading?.depth ?? 7) <= heading.depth)
    ) {
      end += 1;
    }
    const body = cleaned
      .slice(index + 1, end)
      .filter(hasReadableContent)
      .join("\n\n")
      .trim();
    const readableBodyItems = nodes
      .slice(index + 1, end)
      .map((item, offset) => ({
        item,
        value: cleaned[index + 1 + offset] ?? "",
      }))
      .filter(({ value }) => hasReadableContent(value));
    const productionOnlyBody = readableBodyItems.length > 0 && readableBodyItems.every(({ item, value }) => (
      item.node.type === "thematicBreak"
      || (
        item.node.type === "blockquote"
        && (
          isReaderEditorialBlockquote(value)
          || explicitOpeningEditorialLanguagePattern.test(nodeText(item.node))
        )
      )
    ));
    if (
      !openingProductionSubheadingPattern.test(plainLabel(heading.label))
      && !productionOnlyBody
    ) {
      continue;
    }
    if (body) relocated.push(`**版本與安全校正**\n\n${body}`);
    for (let cursor = index; cursor < end; cursor += 1) cleaned[cursor] = "";
    index = end - 1;
  }
  return relocated;
}

const globalProductionBlockPattern =
  /(?:來源與視覺審閱|章節範圍為紙本|已逐頁(?:\s*render\s*並)?核對|表格缺漏|影像核對|本指南不自行|版本與用藥安全提醒|原文寫|原文存在數個重要衝突|疑似排印錯誤|危險單位錯誤|print\s+pp?\.?|utm_source=chatgpt\.com)/iu;

function relocateGlobalProductionBlocks(nodes: ParsedNode[], cleaned: string[]) {
  const relocated: string[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const item = nodes[index];
    const value = cleaned[index] ?? "";
    if (item.node.type === "definition") {
      if (/^\s*\[\d+\]:/u.test(item.raw) || /utm_source=chatgpt\.com/iu.test(item.raw)) {
        cleaned[index] = "";
      }
      continue;
    }
    if (!hasReadableContent(value) || item.heading) continue;

    const original = item.text || item.raw;
    const productionBlock = (
      globalProductionBlockPattern.test(value)
      || (
        item.node.type === "blockquote"
        && (
          isReaderEditorialBlockquote(value)
          || isPureProductionProcess(value)
          || explicitOpeningEditorialLanguagePattern.test(value)
        )
      )
    );
    if (!productionBlock) continue;

    // Preserve clinically consequential corrections, but keep them out of the
    // reading flow. Pure source inventory and review-process prose is dropped.
    if (safetyConclusionPattern.test(original)) {
      relocated.push(`**資料與安全校正**\n\n${value}`);
    }
    cleaned[index] = "";
  }
  return relocated;
}

function removeEmptySubheadings(nodes: ParsedNode[], cleaned: string[]) {
  for (let index = 0; index < nodes.length; index += 1) {
    const heading = nodes[index].heading;
    if (!heading || heading.depth < 3 || !hasReadableContent(cleaned[index] ?? "")) continue;
    let end = index + 1;
    while (
      end < nodes.length
      && !(nodes[end].heading && (nodes[end].heading?.depth ?? 7) <= heading.depth)
    ) {
      end += 1;
    }
    const hasBody = nodes
      .slice(index + 1, end)
      .some((item, offset) => (
        item.node.type !== "thematicBreak"
        && !item.heading
        && hasReadableContent(cleaned[index + 1 + offset] ?? "")
      ));
    if (!hasBody) cleaned[index] = "";
  }
}

function removeRedundantOpeningSubheading(nodes: ParsedNode[], cleaned: string[]) {
  const firstMajorIndex = nodes.findIndex((item, index) => (
    item.heading?.depth === 2 && hasReadableContent(cleaned[index] ?? "")
  ));
  if (firstMajorIndex < 0) return;
  const firstMinorIndex = nodes.findIndex((item, index) => (
    index > firstMajorIndex
    && item.heading?.depth === 3
    && hasReadableContent(cleaned[index] ?? "")
  ));
  if (firstMinorIndex < 0) return;
  const nextMajorIndex = nodes.findIndex((item, index) => (
    index > firstMajorIndex
    && item.heading?.depth === 2
    && hasReadableContent(cleaned[index] ?? "")
  ));
  if (nextMajorIndex >= 0 && firstMinorIndex > nextMajorIndex) return;

  const majorLabel = stripStructuralOutlinePrefix(
    plainLabel(cleaned[firstMajorIndex] ?? "").replace(/^#{2,6}\s+/u, ""),
  ).replace(/[：:]\s*$/u, "").trim();
  const minorLabel = stripStructuralOutlinePrefix(
    plainLabel(cleaned[firstMinorIndex] ?? "").replace(/^#{2,6}\s+/u, ""),
  ).replace(/[：:]\s*$/u, "").trim();
  if (majorLabel && minorLabel && majorLabel === minorLabel) {
    cleaned[firstMinorIndex] = "";
  }
}

function moveLeadingClinicalContentUnderFirstMajorHeading(
  nodes: ParsedNode[],
  cleaned: string[],
) {
  const h1Index = nodes.findIndex((item, index) => (
    item.heading?.depth === 1 && hasReadableContent(cleaned[index] ?? "")
  ));
  const firstMajorIndex = nodes.findIndex((item, index) => (
    index > h1Index
    && item.heading?.depth === 2
    && hasReadableContent(cleaned[index] ?? "")
  ));
  if (h1Index < 0 || firstMajorIndex < 0) return;

  const leadingClinicalBlocks: string[] = [];
  for (let index = h1Index + 1; index < firstMajorIndex; index += 1) {
    const value = cleaned[index] ?? "";
    if (!hasReadableContent(value)) continue;
    const item = nodes[index];
    if (item.node.type === "thematicBreak" || isStandaloneOpeningSubtitle(item)) {
      cleaned[index] = "";
      continue;
    }
    if (
      isPureProductionProcess(value)
      || openingEditorialLanguagePattern.test(value)
      || explicitOpeningEditorialLanguagePattern.test(value)
    ) {
      cleaned[index] = "";
      continue;
    }
    if (
      !item.heading
      && ["paragraph", "blockquote", "list", "table", "code", "math"].includes(item.node.type)
    ) {
      leadingClinicalBlocks.push(value);
      cleaned[index] = "";
    }
  }
  if (!leadingClinicalBlocks.length) return;
  cleaned[firstMajorIndex] = [
    cleaned[firstMajorIndex],
    ...leadingClinicalBlocks,
  ].join("\n\n");
}

function applyOpeningMajorHeadingOverride(
  nodes: ParsedNode[],
  cleaned: string[],
  documentTitle: string,
) {
  const replacement = openingMajorHeadingOverrides[documentTitle];
  if (!replacement) return;
  const firstMajorIndex = nodes.findIndex((item, index) => (
    item.heading?.depth === 2 && hasReadableContent(cleaned[index] ?? "")
  ));
  if (firstMajorIndex < 0) return;
  cleaned[firstMajorIndex] = `## 1. ${replacement}`;
}

function renumberVisibleHeadingHierarchy(nodes: ParsedNode[], cleaned: string[]) {
  let major = 0;
  let minor = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const heading = nodes[index].heading;
    if (!heading || !hasReadableContent(cleaned[index] ?? "")) continue;
    if (heading.depth === 2) {
      major += 1;
      minor = 0;
      cleaned[index] = cleaned[index].replace(
        /^(\s{0,3}##\s+)(?:\d+(?:\.\d+)*\.?\s*)?/u,
        `$1${major}. `,
      );
      continue;
    }
    if (heading.depth === 3 && major > 0) {
      minor += 1;
      cleaned[index] = cleaned[index].replace(
        /^(\s{0,3}###\s+)(?:\d+(?:\.\d+)*\.?\s*)?/u,
        `$1${major}.${minor} `,
      );
    }
  }
}

function stripVisualLocatorsFromVisibleHeadings(nodes: ParsedNode[], cleaned: string[]) {
  for (let index = 0; index < nodes.length; index += 1) {
    if (!nodes[index].heading || !hasReadableContent(cleaned[index] ?? "")) continue;
    const originalLabel = plainLabel(nodes[index].heading?.label ?? "");
    cleaned[index] = cleaned[index]
      .replace(
        /^(\s{0,3}#{2,6}\s+(?:\d+(?:\.\d+)*\.?\s+)?)(?:Fig(?:ure)?|Table|Box)\.?\s*\d+(?:[A-Za-z]|\.\d+|-\d+)*(?:\s*[～~–—-]\s*\d+(?:\.\d+)*)?\s*(?:的|[：:｜|])?\s*/iu,
        "$1",
      )
      .replace(
        /\s*[（(]\s*(?:Fig(?:ure)?|Table|Box)\.?\s*\d+(?:[A-Za-z]|\.\d+|-\d+)*(?:\s*[～~–—-]\s*\d+(?:\.\d+)*)?\s*[）)]/giu,
        "",
      )
      .trimEnd();
    if (/Table\s*91-5/iu.test(originalLabel)) {
      cleaned[index] = cleaned[index].replace(
        /^(\s{0,3}#{2,6}\s+(?:\d+(?:\.\d+)*\.?\s+)?).+$/u,
        "$1Outpatient antimicrobial regimens",
      );
    } else if (/Table\s*91-6/iu.test(originalLabel)) {
      cleaned[index] = cleaned[index].replace(
        /^(\s{0,3}#{2,6}\s+(?:\d+(?:\.\d+)*\.?\s+)?).+$/u,
        "$1Inpatient antimicrobial options",
      );
    } else if (/Figure\s*272-12/iu.test(originalLabel)) {
      cleaned[index] = cleaned[index].replace(
        /^(\s{0,3}#{2,6}\s+(?:\d+(?:\.\d+)*\.?\s+)?).+$/u,
        "$1依血流動力學反應選擇骨盆出血控制路徑",
      );
    }
  }
}

const manualOpeningLiteralRewrites: ReadonlyArray<readonly [string, string]> = [
  ...tintDetailedOpeningLiteralRewrites,
  ...tintConciseOpeningLiteralRewrites,
  ...rosensOpeningLiteralRewrites,
];

function applyManualOpeningLiteralRewrites(value: string) {
  let corrected = value;
  for (const [original, replacement] of manualOpeningLiteralRewrites) {
    corrected = corrected.replaceAll(original, replacement);
  }
  return corrected
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function promoteHeading(
  nodes: ParsedNode[],
  cleaned: string[],
  index: number,
  depth: number,
  label?: string,
) {
  const heading = nodes[index]?.heading;
  if (!heading || !hasReadableContent(cleaned[index] ?? "")) return;
  heading.depth = depth;
  nodes[index].node.depth = depth;
  cleaned[index] = `${"#".repeat(depth)} ${label ?? stripStructuralOutlinePrefix(
    plainLabel(cleaned[index]).replace(/^#{2,6}\s+/u, ""),
  )}`;
}

function normalizeManualTitleScopedHierarchy(
  nodes: ParsedNode[],
  cleaned: string[],
  documentTitle: string,
) {
  if (documentTitle === "Pharmacology of Vasopressors and Inotropes") {
    const firstMajorIndex = nodes.findIndex((item, index) => (
      item.heading?.depth === 2 && hasReadableContent(cleaned[index] ?? "")
    ));
    const nextMajorIndex = nodes.findIndex((item, index) => (
      index > firstMajorIndex
      && item.heading?.depth === 2
      && hasReadableContent(cleaned[index] ?? "")
    ));
    if (
      firstMajorIndex >= 0
      && nextMajorIndex > firstMajorIndex
      && cleaned
        .slice(firstMajorIndex + 1, nextMajorIndex)
        .some((value) => /^(?:本文|常用)縮寫\s*[：:]/u.test(value.trim()))
    ) {
      for (let index = firstMajorIndex; index < nextMajorIndex; index += 1) {
        cleaned[index] = "";
      }
    }
    return;
  }

  if (documentTitle === "Dyshemoglobinemias") {
    for (let index = 0; index < nodes.length; index += 1) {
      const heading = nodes[index].heading;
      if (!heading || heading.depth !== 3) continue;
      const label = stripStructuralOutlinePrefix(plainLabel(heading.label));
      if (!/^Methemoglobinemia$|^Sulfhemoglobinemia$/iu.test(label)) continue;
      promoteHeading(nodes, cleaned, index, 2, label);
      for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
        const childHeading = nodes[cursor].heading;
        if (childHeading && childHeading.depth <= 3) break;
        if (childHeading?.depth === 4) promoteHeading(nodes, cleaned, cursor, 3);
      }
    }
    return;
  }

  if (documentTitle !== "Hyperthyroidism and Thyroid Storm") return;
  const firstMajorIndex = nodes.findIndex((item, index) => (
    item.heading?.depth === 2 && hasReadableContent(cleaned[index] ?? "")
  ));
  if (firstMajorIndex >= 0) cleaned[firstMajorIndex] = "";

  let promoted = 0;
  for (let index = Math.max(0, firstMajorIndex + 1); index < nodes.length; index += 1) {
    const heading = nodes[index].heading;
    if (!heading || !hasReadableContent(cleaned[index] ?? "")) continue;
    if (heading.depth === 3) {
      promoted += 1;
      promoteHeading(
        nodes,
        cleaned,
        index,
        2,
        promoted === 1
          ? "Thyroid storm 是臨床診斷，不是 hormone level 診斷"
          : undefined,
      );
    } else if (heading.depth === 4) {
      promoteHeading(nodes, cleaned, index, 3);
    }
  }
}

/**
 * Remove source-location and production-review notes from learner-facing
 * guides. The original Markdown remains untouched for the opt-in raw depth.
 * Clinical version, legal, guideline, dosage, and patient-safety cautions are
 * retained even when they share a source paragraph with internal metadata.
 */
export function sanitizeStudyGuideMarkdown(markdown: string) {
  const source = normalizeRuntimeMathBlocks(markdown.replace(internalBlockPattern, ""));
  const tree = parser.parse(source);
  const nodes = (tree.children as unknown as GuideNode[]).map<ParsedNode>((node) => ({
    node,
    raw: sourceSlice(source, node),
    text: nodeText(node).trim(),
    heading: node.type === "heading" && typeof node.depth === "number"
      ? { depth: node.depth, label: nodeText(node).trim() }
      : null,
  }));
  const relocatedOpeningIndices = openingEditorialIndices(nodes);
  const openingPartitions = nodes.map((item, index) => {
    if (!relocatedOpeningIndices.has(index)) return { kept: item.raw, relocated: [] as string[] };
    if (item.node.type === "paragraph") {
      return partitionOpeningEditorialParagraph(item.raw);
    }
    if (item.node.type !== "blockquote") {
      const kept = sanitizeTopLevelNode(item);
      // Plain production prose is not useful as an appendix. If it also
      // contains learner-facing clinical content, retain only the sanitized
      // clinical sentences in place.
      return { kept, relocated: [] as string[] };
    }

    const paragraphs = splitBlockquoteParagraphs(item.raw);
    const relocated = paragraphs.filter(isOpeningEditorialBlockquoteParagraph);
    if (paragraphs.length >= 3 && relocated.length / paragraphs.length > 0.5) {
      return { kept: "", relocated: paragraphs };
    }
    const kept = paragraphs
      .filter((paragraph) => !isOpeningEditorialBlockquoteParagraph(paragraph))
      .join("\n>\n");
    return { kept, relocated };
  });
  const relocatedOpeningNotes = openingPartitions.flatMap((partition) => partition.relocated).filter(Boolean);
  const cleaned = nodes.map((item, index) => {
    const kept = openingPartitions[index].kept;
    if (!kept) return "";
    if (kept === item.raw) return sanitizeTopLevelNode(item);
    if (item.node.type === "blockquote") {
      return finalizeLearnerBlock(rewriteSourceFraming(sanitizeBlockquote(kept)));
    }
    return kept;
  });
  const relocatedOpeningSections = relocateOpeningProductionSubsections(nodes, cleaned);
  const documentTitle = canonicalDocumentTitle(nodes);
  for (let index = 0; index < nodes.length; index += 1) {
    const heading = nodes[index].heading;
    if (!heading || !hasReadableContent(cleaned[index] ?? "")) continue;
    if (heading.depth === 1 && documentTitle) {
      cleaned[index] = `# ${documentTitle}`;
      continue;
    }
    cleaned[index] = rewriteLearnerFacingHeading(cleaned[index], heading, documentTitle);
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const heading = nodes[index].heading;
    if (!heading || !isProductionHeading(heading.label)) continue;
    let containsClinicalReminder = false;
    for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
      const next = nodes[cursor].heading;
      if (next && next.depth <= heading.depth) break;
      if (!hasReadableContent(cleaned[cursor] ?? "")) continue;
      if (clinicalReminderPattern.test(cleaned[cursor] ?? "")) containsClinicalReminder = true;
      else cleaned[cursor] = "";
    }
    cleaned[index] = containsClinicalReminder
      ? `${"#".repeat(heading.depth)} 臨床適用提醒`
      : "";
  }

  const relocatedGlobalProductionNotes = relocateGlobalProductionBlocks(nodes, cleaned);
  renameOpeningAbbreviationSection(nodes, cleaned);
  removeEmptySubheadings(nodes, cleaned);
  removeRedundantOpeningSubheading(nodes, cleaned);
  collapseEmptyOpeningMajorSection(nodes, cleaned);
  moveLeadingClinicalContentUnderFirstMajorHeading(nodes, cleaned);
  applyOpeningMajorHeadingOverride(nodes, cleaned, documentTitle);
  normalizeManualTitleScopedHierarchy(nodes, cleaned, documentTitle);
  removeOpeningSeparators(nodes, cleaned);
  renumberVisibleHeadingHierarchy(nodes, cleaned);
  stripVisualLocatorsFromVisibleHeadings(nodes, cleaned);

  const learnerBody = applyManualOpeningLiteralRewrites(
    cleaned.filter(Boolean).join("\n\n").replace(/\n{3,}/gu, "\n\n").trimEnd(),
  );
  const relocatedAppendixItems = [
    ...relocatedOpeningNotes,
    ...relocatedOpeningSections,
    ...relocatedGlobalProductionNotes,
  ];
  const relocatedAppendix = relocatedAppendixItems.length
    ? `\n\n---\n\n${relocatedAppendixItems.join("\n\n")}`
    : "";
  return `${learnerBody}${relocatedAppendix}\n`;
}
