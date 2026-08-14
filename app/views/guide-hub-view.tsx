"use client";

import { ArrowRight, BookOpenText, Library, Play } from "lucide-react";
import { parseAnyGuideAnnotationResourceId } from "../lib/annotation-source";
import type { AilsRouteId } from "../lib/app-route";
import type { GuideProgressRecord, GuideResourceProgressRecord } from "../lib/types";
import { rosensCatalogStats } from "../lib/rosens-catalog";

type Props = {
  progressMap: Map<number, GuideProgressRecord>;
  resourceProgressMap: Map<string, GuideResourceProgressRecord>;
  onOpenTintinalli: (resource: number | string) => void;
  onOpenRosens: (chapter: string) => void;
  onOpenGoldfrank: (chapter?: string) => void;
  onOpenAils: (page?: AilsRouteId) => void;
  onOpenBoard: (unitCode?: string) => void;
  onOpenEms: (chapter?: string) => void;
};

type Continuation = { resource: number | string; label: string; lastOpenedAt: string };

function resourceContinuation(record: GuideResourceProgressRecord): (Continuation & { textbook: "tintinalli" | "rosens" | "goldfrank" | "board" | "ems" }) | null {
  if (!record.lastOpenedAt) return null;
  const source = parseAnyGuideAnnotationResourceId(record.resourceId);
  if (!source) return null;
  if (source.resourceKind === "unit") {
    return { textbook: "board", resource: source.unitCode, label: `單元 ${source.unitCode}`, lastOpenedAt: record.lastOpenedAt };
  }
  if (source.resourceKind !== "chapter") return null;
  if (source.textbook === "ems") {
    return { textbook: "ems", resource: source.chapterId, label: `第 ${source.chapter} 章`, lastOpenedAt: record.lastOpenedAt };
  }
  if (source.textbook === "tintinalli") {
    return { textbook: source.textbook, resource: source.chapter, label: `Chapter ${String(source.chapter).padStart(3, "0")}`, lastOpenedAt: record.lastOpenedAt };
  }
  const displayId = source.chapterId.startsWith("e") ? `e${Number(source.chapterId.slice(1))}` : source.chapterId;
  return { textbook: source.textbook, resource: source.chapterId, label: `Chapter ${displayId}`, lastOpenedAt: record.lastOpenedAt };
}

function GuideOverviewLink({ sectionCount, onOpen }: { sectionCount: number; onOpen: () => void }) {
  return (
    <button type="button" className="guide-book-route guide-book-route-overview" onClick={onOpen}>
      <BookOpenText size={17} />
      <span><small>全書總覽</small><strong>共 {sectionCount} 節</strong></span>
      <ArrowRight size={16} />
    </button>
  );
}

export default function GuideHubView({ progressMap, resourceProgressMap, onOpenTintinalli, onOpenRosens, onOpenGoldfrank, onOpenAils, onOpenBoard, onOpenEms }: Props) {
  const namespacedContinuations = [...resourceProgressMap.values()].map(resourceContinuation).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const latestTintinalli = [
    ...[...progressMap.values()].filter((record) => Boolean(record.lastOpenedAt)).map((record) => ({
      resource: record.chapterId,
      label: `Chapter ${String(record.chapterId).padStart(3, "0")}`,
      lastOpenedAt: record.lastOpenedAt!,
    })),
    ...namespacedContinuations.filter((item) => item.textbook === "tintinalli"),
  ].sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt))[0] ?? null;
  const latestRosens = namespacedContinuations
    .filter((item) => item.textbook === "rosens")
    .sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt))[0] ?? null;
  const latestGoldfrank = namespacedContinuations
    .filter((item) => item.textbook === "goldfrank")
    .sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt))[0] ?? null;
  const latestBoard = namespacedContinuations
    .filter((item) => item.textbook === "board")
    .sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt))[0] ?? null;
  const latestEms = namespacedContinuations
    .filter((item) => item.textbook === "ems")
    .sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt))[0] ?? null;
  const tintinalliResource = latestTintinalli?.resource ?? 1;
  const rosensResource = String(latestRosens?.resource ?? "001");
  const goldfrankResource = String(latestGoldfrank?.resource ?? "001");

  return (
    <main className="guide-hub-page">
      <header className="guide-hub-intro">
        <div className="guide-hub-kicker"><Library size={15} /><span>學習內容</span></div>
        <h1>選擇學習指引</h1>
        <p>六套教材涵蓋急診醫學、臨床毒理、到院前照護與專科考點；以下依原書與教材定位整理。</p>
      </header>

      <section className="guide-book-grid" aria-label="選擇學習指引">
        <article className="guide-book-card tintinalli" aria-labelledby="tintinalli-guide-title">
          <span className="guide-book-spine" aria-hidden="true"><i>T</i><b>9</b></span>
          <div className="guide-book-copy">
            <span className="guide-book-meta"><em>TINTINALLI · 9TH EDITION</em><small>303 CHAPTERS · 26 SECTIONS</small></span>
            <h2 id="tintinalli-guide-title">Tintinalli’s Emergency Medicine:<br />A Comprehensive Study Guide</h2>
            <span className="guide-book-description">第 9 版綜合急診醫學教科書，從到院前照護、復甦與症狀導向評估，到各系統急症、毒理、環境傷害、特殊族群及急診處置，完整涵蓋急診臨床核心。</span>
            <span className="guide-book-status"><i /><span>303 章 · 26 節 · 全書總覽</span></span>
          </div>
          <div className="guide-book-routes" role="group" aria-label="Tintinalli 閱讀入口">
            <button type="button" className="guide-book-route guide-book-route-chapter" onClick={() => onOpenTintinalli(tintinalliResource)}>
              <span><small>章節閱讀</small><strong>{latestTintinalli ? `繼續 ${latestTintinalli.label}` : "從 Chapter 001 開始"}</strong></span>
              <ArrowRight size={17} />
            </button>
            <GuideOverviewLink sectionCount={26} onOpen={() => onOpenTintinalli("overview")} />
          </div>
        </article>

        <article className="guide-book-card rosens" aria-labelledby="rosens-guide-title">
          <span className="guide-book-spine" aria-hidden="true"><i>R</i><b>10</b></span>
          <div className="guide-book-copy">
            <span className="guide-book-meta"><em>ROSEN’S · 10TH EDITION</em><small>208 CHAPTERS · 2 VOLUMES</small></span>
            <h2 id="rosens-guide-title">Rosen’s Emergency Medicine:<br />Concepts and Clinical Practice</h2>
            <span className="guide-book-description">第 10 版雙冊急診醫學參考書，以臨床概念與實務為主軸，涵蓋復甦、症狀表現、創傷、各器官系統急症、特殊族群、公共衛生、EMS 與災難醫療。</span>
            <span className="guide-book-status"><i /><span>{rosensCatalogStats.importedChapters} 章 · 27 節 · 全書總覽</span></span>
          </div>
          <div className="guide-book-routes" role="group" aria-label="Rosen 閱讀入口">
            <button type="button" className="guide-book-route guide-book-route-chapter" onClick={() => onOpenRosens(rosensResource)}>
              <span><small>章節閱讀</small><strong>{latestRosens ? `繼續 ${latestRosens.label}` : "從 Chapter 001 開始"}</strong></span>
              <ArrowRight size={17} />
            </button>
            <GuideOverviewLink sectionCount={27} onOpen={() => onOpenRosens("overview")} />
          </div>
        </article>

        <article className="guide-book-card goldfrank" aria-labelledby="goldfrank-guide-title">
          <span className="guide-book-spine" aria-hidden="true"><i>G</i><b>11</b></span>
          <div className="guide-book-copy">
            <span className="guide-book-meta"><em>GOLDFRANK’S · 11TH EDITION</em><small>140 CHAPTERS · TOXICOLOGY</small></span>
            <h2 id="goldfrank-guide-title">Goldfrank’s<br />Toxicologic Emergencies</h2>
            <span className="guide-book-description">第 11 版臨床毒理學權威教科書，系統整理毒理學基本原理、暴露評估、各類藥物與毒物、解毒劑，以及中毒病人的診斷、支持治療與進階處置。</span>
            <span className="guide-book-status"><i /><span>140 章 · 臨床與醫學毒理學</span></span>
          </div>
          <div className="guide-book-routes" role="group" aria-label="Goldfrank 學習指引入口">
            <button type="button" className="guide-book-route guide-book-route-chapter" onClick={() => onOpenGoldfrank(goldfrankResource)}>
              <span><small>章節閱讀</small><strong>{latestGoldfrank ? `繼續 ${latestGoldfrank.label}` : "從 Chapter 001 開始"}</strong></span>
              <ArrowRight size={17} />
            </button>
          </div>
        </article>

        <article className="guide-book-card ems" aria-labelledby="ems-guide-title">
          <span className="guide-book-spine" aria-hidden="true"><i>E</i><b>24</b></span>
          <div className="guide-book-copy">
            <span className="guide-book-meta"><em>EMS · PREHOSPITAL CARE</em><small>R-EMS TEXTBOOK · 24 CHAPTERS</small></span>
            <h2 id="ems-guide-title">急診住院醫師<br />緊急醫療救護教科書</h2>
            <span className="guide-book-description">台灣急診醫學會 EMS 委員會編寫的住院醫師訓練教材，涵蓋緊急救護體系、派遣與檢傷、到院前處置、醫療指導、災難應變、品質管理與研究。</span>
            <span className="guide-book-status"><i /><span>24 章 · 台灣到院前緊急醫療救護</span></span>
          </div>
          <div className="guide-book-routes" role="group" aria-label="EMS 學習指引入口">
            <button type="button" className="guide-book-route guide-book-route-chapter" onClick={() => onOpenEms(String(latestEms?.resource ?? "001"))}>
              <span><small>章節閱讀</small><strong>{latestEms ? `繼續 ${latestEms.label}` : "從第 1 章開始"}</strong></span>
              <ArrowRight size={17} />
            </button>
          </div>
        </article>

        <article className="guide-book-card ails" aria-labelledby="ails-guide-title">
          <span className="guide-book-spine" aria-hidden="true"><i>A</i><b>3</b></span>
          <div className="guide-book-copy">
            <span className="guide-book-meta"><em>AILS · 第三版</em><small>急性中毒救命術 · 10 篇複習內容</small></span>
            <h2 id="ails-guide-title">AILS急性中毒救命術</h2>
            <span className="guide-book-description">台灣急診醫學會出版的第三版急性中毒教材，以中毒病人的初始評估為核心，涵蓋 toxidrome、常見毒物、解毒劑、除污、強化排除與特殊暴露處置。</span>
            <span className="guide-book-status"><i /><span>10 篇複習內容 · 272 題練習</span></span>
          </div>
          <div className="guide-book-routes guide-book-routes-ails" role="group" aria-label="AILS 學習入口">
            <button type="button" className="guide-book-route guide-book-route-chapter guide-book-route-ails-content" onClick={() => onOpenAils("home")}>
              <span><small>開始複習</small><strong>先看重點總覽</strong></span>
              <ArrowRight size={17} />
            </button>
            <button type="button" className="guide-book-route guide-book-route-compact guide-book-route-ails-practice" onClick={() => onOpenAils("qbank")}>
              <Play size={15} />
              <span><small>題目練習</small><strong>自己選題作答</strong></span>
              <ArrowRight size={14} />
            </button>
            <button type="button" className="guide-book-route guide-book-route-compact guide-book-route-ails-answers" onClick={() => onOpenAils("answers")}>
              <BookOpenText size={15} />
              <span><small>完整詳解</small><strong>直接閱讀詳解</strong></span>
              <ArrowRight size={14} />
            </button>
          </div>
        </article>

        <article className="guide-book-card board" aria-labelledby="board-guide-title">
          <span className="guide-book-spine" aria-hidden="true"><i>Q</i><b>39</b></span>
          <div className="guide-book-copy">
            <span className="guide-book-meta"><em>BOARD QUESTION MAP</em><small>39 UNITS · 2,920 QUESTIONS</small></span>
            <h2 id="board-guide-title">歷屆考題<br />對照指引</h2>
            <span className="guide-book-description">依歷屆急診專科醫師甄審題目與參考文獻編成的考點教材，按急診核心領域整理題幹、選項、關鍵知識與來源依據。</span>
            <span className="guide-book-status"><i /><span>39 單元 · 2,920 題可對照</span></span>
          </div>
          <div className="guide-book-routes guide-book-routes-board" role="group" aria-label="考題對照指引入口">
            <button type="button" className="guide-book-route guide-book-route-chapter" onClick={() => onOpenBoard(String(latestBoard?.resource ?? "1A"))}>
              <span><small>考題對照</small><strong>{latestBoard ? `繼續 ${latestBoard.label}` : "從單元 1A 開始"}</strong></span>
              <ArrowRight size={17} />
            </button>
          </div>
        </article>
      </section>
    </main>
  );
}
