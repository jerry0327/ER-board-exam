"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, BookOpenText, Layers3, Play, RotateCw, Shuffle } from "lucide-react";
import QuestionSheet from "../components/question-sheet";
import { useAilsQuestionProgress } from "../hooks/use-ails-question-progress";
import {
  ailsQuestionId,
  ailsQuestionNumberFromId,
  buildAilsQuestionCollection,
  type AilsQuestionMode,
} from "../lib/ails-questions";
import type { AilsQuestion } from "../lib/ails-review";
import { scrollPageToTop } from "../lib/motion";
import type { QuestionIndex } from "../lib/types";
import BrowseView from "./browse-view";
import PracticeView from "./practice-view";
import ReaderView from "./reader-view";

type Props = {
  initialMode: AilsQuestionMode;
  initialReaderNum?: number;
  questions: AilsQuestion[];
  topics: string[];
  onSelectMode: (mode: AilsQuestionMode) => void;
  onBackToContent: () => void;
};

type Workspace = "browse" | "practice" | "reader" | "cards";
type ReaderBack = "browse" | "practice" | "cards";

const modeLabels: Record<AilsQuestionMode, string> = {
  qbank: "選題作答",
  cards: "記憶卡",
  quiz: "隨機測驗",
};

function AilsModeActions({
  activeMode,
  onSelectMode,
  onBackToContent,
}: {
  activeMode: AilsQuestionMode;
  onSelectMode: (mode: AilsQuestionMode) => void;
  onBackToContent: () => void;
}) {
  return (
    <nav className="results-heading-actions" aria-label="AILS 學習模式">
      <button type="button" className="text-action" onClick={onBackToContent}><ArrowLeft size={16} />AILS 內容</button>
      {(Object.keys(modeLabels) as AilsQuestionMode[]).map((mode) => (
        <button
          type="button"
          key={mode}
          className="quiet-button"
          aria-current={activeMode === mode ? "page" : undefined}
          onClick={() => onSelectMode(mode)}
        >
          {mode === "qbank" ? <Layers3 size={15} /> : mode === "cards" ? <RotateCw size={15} /> : <Shuffle size={15} />}
          {modeLabels[mode]}
        </button>
      ))}
    </nav>
  );
}

export default function AilsQuestionCenterView({
  initialMode,
  initialReaderNum,
  questions,
  topics,
  onSelectMode,
  onBackToContent,
}: Props) {
  const progress = useAilsQuestionProgress();
  const collection = useMemo(() => buildAilsQuestionCollection(questions, topics), [questions, topics]);
  const [workspace, setWorkspace] = useState<Workspace>(() => (
    initialReaderNum ? "reader" : initialMode === "qbank" ? "browse" : initialMode === "cards" ? "cards" : "practice"
  ));
  const [readerId, setReaderId] = useState(() => ailsQuestionId(initialReaderNum ?? 1));
  const [readerBack, setReaderBack] = useState<ReaderBack>(initialReaderNum ? "browse" : "practice");
  const [practiceLaunch, setPracticeLaunch] = useState<{ ids: string[]; nonce: number; mode: "study" | "exam" } | null>(null);
  const [cardIds, setCardIds] = useState(() => collection.questions.map((question) => question.id));
  const [cardIndex, setCardIndex] = useState(0);
  const [cardRevealed, setCardRevealed] = useState(false);

  const loadAilsQuestion = useCallback(async (question: QuestionIndex) => {
    const full = collection.questionById.get(question.id);
    if (!full) throw new Error(`找不到題目 ${question.id}`);
    return full;
  }, [collection.questionById]);
  const prefetchAilsQuestion = useCallback(() => undefined, []);
  const modeActions = (
    <AilsModeActions
      activeMode={initialMode}
      onSelectMode={onSelectMode}
      onBackToContent={onBackToContent}
    />
  );

  const openReader = (questionId: string, back: ReaderBack) => {
    setReaderId(questionId);
    setReaderBack(back);
    setWorkspace("reader");
    scrollPageToTop();
  };

  if (workspace === "reader") {
    return (
      <ReaderView
        manifest={collection.manifest}
        questions={collection.questions}
        progressMap={progress.progressMap}
        requestedQuestionId={readerId}
        requestedAnnotationId={null}
        explanationPack="original"
        explanationMode="full"
        rawDraftMode={false}
        annotations={[]}
        annotationStatus="local"
        onExplanationSelectionChange={() => undefined}
        onBookmark={progress.setBookmarkById}
        onMarkRead={progress.markReadById}
        onSelectQuestion={setReaderId}
        onOpenGuide={() => undefined}
        onAnnotationOpenChange={() => undefined}
        onUpsertAnnotation={async () => undefined}
        onRemoveAnnotation={async () => undefined}
        questionLoader={loadAilsQuestion}
        questionPrefetcher={prefetchAilsQuestion}
        searchCatalogLoader={null}
        annotationsEnabled={false}
        variantSelectionEnabled={false}
        headerActions={(
          <button type="button" className="text-action" onClick={() => setWorkspace(readerBack)}>
            <ArrowLeft size={16} />{readerBack === "practice" ? "返回本輪結果" : readerBack === "cards" ? "返回記憶卡" : "返回 AILS 題庫"}
          </button>
        )}
      />
    );
  }

  if (workspace === "practice") {
    return (
      <PracticeView
        manifest={collection.manifest}
        questions={collection.questions}
        progressMap={progress.progressMap}
        accountKey="anonymous-device"
        explanationPack="original"
        explanationMode="full"
        onAttempt={(questionId, selectedKeys, correct, confidence) => progress.recordAttemptById(questionId, selectedKeys, correct, confidence)}
        onAttempts={progress.recordAttemptsById}
        onBookmark={progress.setBookmarkById}
        onOpenReader={(questionId) => openReader(questionId, "practice")}
        onOpenGuide={() => undefined}
        launch={practiceLaunch}
        onLaunchConsumed={() => setPracticeLaunch(null)}
        questionLoader={loadAilsQuestion}
        questionPrefetcher={prefetchAilsQuestion}
        sessionNamespace="ails"
        canonicalizeSelection={false}
        showStudyPlan={false}
        showExamFilter={false}
        initialFilters={{ mode: initialMode === "quiz" ? "exam" : "study", count: initialMode === "quiz" ? 20 : 10 }}
        headerActions={modeActions}
        copy={{
          eyebrow: "AILS 題庫",
          title: initialMode === "quiz" ? "建立 AILS 隨機測驗" : "建立 AILS 練習",
          description: initialMode === "quiz"
            ? "使用急診題庫既有的模擬考面板；整輪交卷後才公布答案與逐題解析。"
            : "使用急診題庫既有的作答面板；每題提交後可立即閱讀解析。",
          categoryLabel: "中毒主題",
          allCategoriesLabel: "全部中毒主題",
        }}
      />
    );
  }

  if (workspace === "cards") {
    const currentId = cardIds[cardIndex] ?? collection.questions[0]?.id;
    const current = currentId ? collection.questionById.get(currentId) : undefined;
    const currentNumber = currentId ? ailsQuestionNumberFromId(currentId) : null;
    const advanceCard = (mastered: boolean) => {
      if (currentNumber) progress.setMastered(currentNumber, mastered);
      setCardRevealed(false);
      setCardIndex((index) => cardIds.length ? (index + 1) % cardIds.length : 0);
      scrollPageToTop();
    };
    const shuffleCards = () => {
      setCardIds((ids) => {
        const next = [...ids];
        for (let index = next.length - 1; index > 0; index -= 1) {
          const target = Math.floor(Math.random() * (index + 1));
          [next[index], next[target]] = [next[target], next[index]];
        }
        return next;
      });
      setCardIndex(0);
      setCardRevealed(false);
    };

    return (
      <main className="workspace-page practice-session-page">
        <header className="page-intro compact-intro">
          <p className="eyebrow"><span />AILS 主動回憶</p>
          <h1>記憶卡</h1>
          <p>先在心中作答，再翻面核對；這個模式只記錄熟練度，不計入題庫正確率。</p>
          {modeActions}
        </header>
        {current && (
          <>
            <div className="session-toolbar">
              <div><span>記憶卡</span><strong>{cardIndex + 1} / {cardIds.length}</strong></div>
              <div className="session-progress" role="progressbar" aria-label="記憶卡進度" aria-valuemin={1} aria-valuemax={cardIds.length} aria-valuenow={cardIndex + 1}><i style={{ width: `${((cardIndex + 1) / cardIds.length) * 100}%` }} /></div>
              <button type="button" className="text-action" onClick={shuffleCards}><Shuffle size={16} />重新洗牌</button>
            </div>
            <QuestionSheet
              question={current}
              flashcard
              submitted={cardRevealed}
              showFullExplanation={cardRevealed}
              bookmarked={progress.progressMap.get(current.id)?.bookmarked === 1}
              progress={progress.progressMap.get(current.id)}
              onBookmark={() => progress.setBookmarkById(current.id, progress.progressMap.get(current.id)?.bookmarked !== 1)}
            />
            <nav className="question-navigation" aria-label="AILS 記憶卡操作">
              {!cardRevealed ? (
                <button type="button" className="primary-button" onClick={() => setCardRevealed(true)}><BookOpenText size={17} />顯示答案與解析</button>
              ) : (
                <>
                  <button type="button" className="outline-button" onClick={() => advanceCard(false)}>還不熟</button>
                  <button type="button" className="text-action" onClick={() => openReader(current.id, "cards")}><BookOpenText size={16} />專注閱讀詳解</button>
                  <button type="button" className="primary-button" onClick={() => advanceCard(true)}>已掌握<Play size={16} /></button>
                </>
              )}
            </nav>
          </>
        )}
      </main>
    );
  }

  return (
    <BrowseView
      manifest={collection.manifest}
      questions={collection.questions}
      progressMap={progress.progressMap}
      onOpenReader={(questionId) => openReader(questionId, "browse")}
      onStartQuestions={(ids) => {
        setPracticeLaunch({ ids, nonce: Date.now(), mode: "study" });
        setWorkspace("practice");
      }}
      selectionStorageKey="em-board-ails-browse-selection-v1"
      searchCatalogLoader={null}
      questionPrefetcher={prefetchAilsQuestion}
      canonicalizeSelection={false}
      showExamFilter={false}
      showSourceSectionFilter={false}
      headerActions={modeActions}
      copy={{
        eyebrow: "AILS 題庫",
        title: "搜尋、選題與直接閱讀詳解",
        searchAriaLabel: "搜尋 AILS 題號、題幹、選項或解析",
        searchPlaceholder: "搜尋毒物、處置、解毒劑或題目內容…",
        categoryLabel: "中毒主題",
        allCategoriesLabel: "全部中毒主題",
        selectionNoun: "題",
        selectionDetail: "只建立 AILS 題組，不會加入急診專科題庫。",
        startLabel: "開始作答",
      }}
    />
  );
}
