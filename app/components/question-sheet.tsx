"use client";

import { ArrowRight, BookOpenText, Bookmark, Check, CheckCircle2, Circle, CircleAlert, Layers3, XCircle } from "lucide-react";
import type { AnnotationExcerptRequest, Confidence, FullQuestion, ProgressRecord } from "../lib/types";
import type { AnswerSelectionIntent } from "../hooks/use-answer-selection";
import { sameAnswer } from "../lib/session-evaluation";
import { coreReasonFromExplanation } from "../lib/explanation-mode";
import MarkdownContent from "./markdown-content";
import QuestionMedia from "./question-media";
import type { BoardTraceTarget } from "../lib/board-trace";

type Props = {
  question: FullQuestion;
  selectedKeys?: string[];
  submitted?: boolean;
  confidence?: Confidence;
  bookmarked?: boolean;
  progress?: ProgressRecord;
  reader?: boolean;
  flashcard?: boolean;
  showFullExplanation?: boolean;
  onSelect?: (key: string, intent?: AnswerSelectionIntent) => void;
  onConfidence?: (value: Confidence) => void;
  onSubmit?: () => void;
  onBookmark?: () => void;
  onShowExplanation?: () => void;
  submitLabel?: string;
  busy?: boolean;
  explanationMarkdown?: string;
  explanationRaw?: boolean;
  explanationLoading?: boolean;
  onOpenGuide?: (chapter: number) => void;
  onAddExplanationToNotes?: (excerpt: AnnotationExcerptRequest) => void;
  traceTargets?: readonly BoardTraceTarget[];
  requestedTraceTarget?: BoardTraceTarget | null;
  onOpenBoardTraceTarget?: (target: BoardTraceTarget) => void;
};

export default function QuestionSheet({
  question,
  selectedKeys = [],
  submitted = false,
  confidence = "normal",
  bookmarked = false,
  progress,
  reader = false,
  flashcard = false,
  showFullExplanation = false,
  onSelect,
  onConfidence,
  onSubmit,
  onBookmark,
  onShowExplanation,
  submitLabel = "提交答案",
  busy = false,
  explanationMarkdown,
  explanationRaw = false,
  explanationLoading = false,
  onOpenGuide,
  onAddExplanationToNotes,
  traceTargets = [],
  requestedTraceTarget,
  onOpenBoardTraceTarget,
}: Props) {
  const multi = question.answerKeys.length > 1;
  const correct = question.allCredit ? null : sameAnswer(selectedKeys, question.answerKeys);
  const negative = /錯誤|不適當|except/i.test(question.questionType);
  const reveal = reader || submitted;
  const showStudyMetadata = reader || submitted || flashcard;
  const activeExplanation = explanationMarkdown ?? question.explanation;
  const coreReason = explanationRaw ? "" : coreReasonFromExplanation(activeExplanation);

  return (
    <article className={`question-sheet paper-card ${reader ? "reader-sheet reading-paper-surface" : ""}`} aria-busy={busy}>
      <header className="question-sheet-meta">
        <span className="question-number">{question.id}</span>
        {showStudyMetadata && <span className="topic-chip">{question.category}</span>}
        {showStudyMetadata && <span className={negative ? "polarity-badge negative" : "polarity-badge"}>{negative ? "否定問法" : question.questionType}</span>}
        {showStudyMetadata && multi && <span className="multi-badge"><Layers3 size={13} />複數答案</span>}
        {showStudyMetadata && question.allCredit && <span className="all-credit-badge">全部給分・不列入統計</span>}
        {question.qualityStatus === "source-mismatch" && <span className="quality-badge"><CircleAlert size={13} />不納入練習</span>}
        <button className={`bookmark-button ${bookmarked ? "saved" : ""}`} onClick={onBookmark} aria-label={bookmarked ? "取消收藏" : "收藏題目"} aria-pressed={bookmarked}>
          <Bookmark size={21} fill={bookmarked ? "currentColor" : "none"} />
        </button>
      </header>

      {showStudyMetadata && onOpenGuide && Boolean(question.tintinalliChapters?.length) && (
        <nav className="question-guide-links" aria-label="本題對應的 Tintinalli 學習指引">
          <BookOpenText size={16} /><span>對應學習指引</span>
          {question.tintinalliChapters!.slice(0, 5).map((chapter) => <button key={chapter} onClick={() => onOpenGuide(chapter)}>Ch. {chapter}</button>)}
          {question.tintinalliChapters!.length > 5 && <small>另 {question.tintinalliChapters!.length - 5} 章</small>}
        </nav>
      )}

      <div
        className={`question-stem-wrap ${requestedTraceTarget === "stem" ? "trace-target-highlight" : ""}`.trim()}
        data-board-question-trace-target={traceTargets.includes("stem") ? "stem" : undefined}
        tabIndex={traceTargets.includes("stem") ? 0 : undefined}
        onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") event.stopPropagation(); }}
      >
        {showStudyMetadata && <p className="question-title">{question.title}</p>}
        <h1 id={`question-heading-${question.id}`} tabIndex={-1}>{question.stem}</h1>
        <QuestionMedia images={question.images} questionId={question.id} />
      </div>

      <div
        className={`answer-options ${reveal ? "revealed" : ""}`}
        role={reader || flashcard ? "list" : "group"}
        aria-label={reader || flashcard ? "答案選項" : multi ? "答案選項，可複選" : "答案選項，再次按下可取消"}
      >
        {question.options.map((option) => {
          const selected = selectedKeys.includes(option.key);
          const official = question.answerKeys.includes(option.key);
          const state = reveal ? official ? "official" : selected ? "incorrect" : "" : selected ? "selected" : "";
          const content = <>
              <span className="option-key">{option.key}</span>
              <span className="option-text">{option.text}</span>
              {reveal && official && <span className="answer-state"><Check size={16} />正解</span>}
              {reveal && selected && !official && <span className="answer-state wrong"><XCircle size={16} />你的答案</span>}
              {!reveal && selected && <CheckCircle2 className="selection-check" size={19} />}
              {!reveal && !selected && <Circle className="selection-check" size={19} />}
            </>;
          const traceTarget = `option-${option.key.toUpperCase()}` as BoardTraceTarget;
          if (reader || flashcard) return <div key={option.key} className={`reader-option ${state} ${requestedTraceTarget === traceTarget ? "trace-target-highlight" : ""}`.trim()} role="listitem" data-board-question-trace-target={traceTargets.includes(traceTarget) ? traceTarget : undefined} tabIndex={traceTargets.includes(traceTarget) ? 0 : undefined} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") event.stopPropagation(); }}>{content}</div>;
          return (
            <button
              key={option.key}
              type="button"
              className={state}
              disabled={submitted || busy || question.qualityStatus === "source-mismatch"}
              aria-pressed={selected}
              onClick={(event) => onSelect?.(option.key, event.detail > 1 ? "clear" : "toggle")}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect?.(option.key, "clear");
              }}
            >
              {content}
            </button>
          );
        })}
      </div>

      {!reader && !flashcard && !submitted && question.qualityStatus !== "source-mismatch" && (
        <div className="answer-controls">
          <fieldset className="confidence-control">
            <legend>作答前信心</legend>
            {(["low", "normal", "high"] as Confidence[]).map((value) => (
              <button key={value} aria-pressed={confidence === value} disabled={busy} className={confidence === value ? "active" : ""} onClick={() => onConfidence?.(value)}>
                {value === "low" ? "不確定" : value === "high" ? "有把握" : "普通"}
              </button>
            ))}
          </fieldset>
          <button className="primary-button submit-answer" disabled={busy || (!selectedKeys.length && !question.allCredit)} onClick={onSubmit}>
            {busy ? "送出中…" : submitLabel}<ArrowRight size={18} />
          </button>
        </div>
      )}

      {submitted && (
        <section className={`answer-reveal ${reader || flashcard ? "neutral" : correct === true ? "correct" : correct === false ? "incorrect" : "neutral"}`} aria-live="polite">
          <div className="outcome-line">
            {flashcard ? <BookOpenText /> : question.allCredit ? <CircleAlert /> : correct ? <CheckCircle2 /> : <XCircle />}
            <div>
              <strong>{flashcard ? "答案與解析" : question.allCredit ? "本題全部給分" : correct ? "答對了" : "答錯了"}</strong>
              <span>官方答案：{question.answerKeys.length ? question.answerKeys.join("、") : question.answerText}</span>
            </div>
            {progress?.wrongState === "mastered" && <span className="mastered-chip"><Check size={14} />已掌握</span>}
          </div>
          {!showFullExplanation && !explanationLoading && coreReason && (
            <div className="core-reason">
              <h2>核心理由</h2>
              <MarkdownContent markdown={coreReason} />
            </div>
          )}
          {!showFullExplanation && explanationLoading && <p className="explanation-loading" role="status">正在載入所選詳解…</p>}
          {!showFullExplanation && question.qualityStatus !== "source-mismatch" && (
            <button className="outline-button expand-explanation" disabled={explanationLoading} onClick={onShowExplanation}>展開解析<ArrowRight size={18} /></button>
          )}
        </section>
      )}

      {(reader || showFullExplanation) && (
        <section className="full-explanation" aria-label={explanationRaw ? "題目詳解進階內容" : "題目詳解"}>
          {explanationLoading
            ? <p className="explanation-loading" role="status">正在載入所選詳解…</p>
            : explanationRaw
              ? <pre className="guide-raw-source"><code>{activeExplanation}</code></pre>
              : <MarkdownContent
                  markdown={activeExplanation}
                  onAddToNotes={onAddExplanationToNotes}
                  questionTraceActions={onOpenBoardTraceTarget ? { targets: traceTargets, onOpen: onOpenBoardTraceTarget } : undefined}
                />}
        </section>
      )}

      {submitted && !reader && !flashcard && (
        <div className="post-answer-actions">
          <button className="text-action" onClick={onBookmark}><Bookmark size={18} />{bookmarked ? "已收藏" : "加入收藏"}</button>
        </div>
      )}
    </article>
  );
}
