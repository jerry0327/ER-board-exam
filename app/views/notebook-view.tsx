"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookMarked, Highlighter, NotebookPen, Search, Trash2 } from "lucide-react";
import { parseAnyGuideAnnotationResourceId, type AnyGuideAnnotationSource } from "../lib/annotation-source";
import { LEARNING_SOURCE_REGISTRY } from "../lib/learning-source-registry";
import { rosensChapters, type RosensChapter } from "../lib/rosens-catalog";
import { supplementalSectionDisplayId } from "../lib/supplemental-guide-ids";
import { loadStudyGuideCatalog, type StudyGuideChapter } from "../lib/study-guides";
import type { GuideProgressRecord, GuideResourceProgressRecord, ProgressRecord, QuestionIndex, StudyAnnotation } from "../lib/types";
import MarkdownContent from "../components/markdown-content";

type Props = {
  annotations: StudyAnnotation[];
  questions: QuestionIndex[];
  progressMap: Map<string, ProgressRecord>;
  guideProgressMap?: ReadonlyMap<number, GuideProgressRecord>;
  guideResourceProgressMap?: ReadonlyMap<string, GuideResourceProgressRecord>;
  onUpsert: (draft: {
    id: string; questionId: string; kind: StudyAnnotation["kind"]; body: string;
    quote?: string; prefix?: string; suffix?: string; startOffset?: number | null; endOffset?: number | null;
  }) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  onOpenAnnotation: (resourceId: string, annotationId: string) => void;
};

const emptyGuideProgressMap: ReadonlyMap<number, GuideProgressRecord> = new Map();
const emptyGuideResourceProgressMap: ReadonlyMap<string, GuideResourceProgressRecord> = new Map();
const rosensChapterMap = new Map(rosensChapters.map((chapter) => [chapter.id, chapter]));

function rosensDisplayId(chapterId: string) {
  if (chapterId.startsWith("e")) return `e${Number(chapterId.slice(1))}`;
  return chapterId.toLocaleUpperCase("en");
}

function guideLabels(
  source: AnyGuideAnnotationSource,
  tintinalliChapter?: StudyGuideChapter,
  rosensChapter?: RosensChapter,
) {
  if (source.resourceKind === "unit") {
    return {
      title: `考題對照指引 ${source.unitCode}`,
      context: `歷屆考題對照指引・單元 ${source.unitCode}`,
    };
  }
  if (source.resourceKind === "chapter") {
    if (source.textbook === "ems") {
      return {
        title: `EMS 第 ${source.chapter} 章`,
        context: LEARNING_SOURCE_REGISTRY.ems.title,
      };
    }
    if (source.textbook === "goldfrank") {
      return {
        title: `${LEARNING_SOURCE_REGISTRY.goldfrank.title} · Chapter ${source.chapterId}`,
        context: `${LEARNING_SOURCE_REGISTRY.goldfrank.title} · 11th Edition`,
      };
    }
    if (source.textbook === "tintinalli") {
      return {
        title: tintinalliChapter?.title ?? `${LEARNING_SOURCE_REGISTRY.tintinalli.title} · Chapter ${source.chapterId}`,
        context: `${LEARNING_SOURCE_REGISTRY.tintinalli.title} · Chapter ${source.chapterId}${tintinalliChapter?.sectionTitle ? ` · ${tintinalliChapter.sectionTitle}` : ""}`,
      };
    }
    const displayId = rosensChapter?.displayId ?? rosensDisplayId(source.chapterId);
    const chapterKind = rosensChapter?.kind === "echapter" ? "eChapter" : "Chapter";
    return {
      title: rosensChapter?.title ?? `${LEARNING_SOURCE_REGISTRY.rosens.title} · ${chapterKind} ${displayId}`,
      context: `${LEARNING_SOURCE_REGISTRY.rosens.title} · ${chapterKind} ${displayId}${rosensChapter?.sectionTitle ? ` · ${rosensChapter.sectionTitle}` : ""}`,
    };
  }

  if (source.resourceKind === "section") {
    const sectionId = supplementalSectionDisplayId(source.sectionId);
    const textbook = LEARNING_SOURCE_REGISTRY[source.textbook].title;
    return {
      title: `${textbook} · Section ${sectionId} Overview`,
      context: "Section Overview",
    };
  }

  return {
    title: `${LEARNING_SOURCE_REGISTRY[source.textbook].title} · Whole-Book Overview`,
    context: "Whole-Book Overview",
  };
}

export default function NotebookView({ annotations, questions, progressMap, guideProgressMap = emptyGuideProgressMap, guideResourceProgressMap = emptyGuideResourceProgressMap, onUpsert, onRemove, onOpenAnnotation }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "wrong" | "due" | "bookmarked">("all");
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState("");
  const [guideChapterMap, setGuideChapterMap] = useState<Map<number, StudyGuideChapter>>(new Map());
  const index = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const hasTintinalliChapterAnnotations = useMemo(
    () => annotations.some((annotation) => {
      const source = parseAnyGuideAnnotationResourceId(annotation.questionId);
      return source?.textbook === "tintinalli" && source.resourceKind === "chapter";
    }),
    [annotations],
  );
  useEffect(() => {
    if (!hasTintinalliChapterAnnotations) return;
    let active = true;
    void loadStudyGuideCatalog()
      .then((catalog) => {
        if (active) setGuideChapterMap(new Map(catalog.chapters.map((chapter) => [chapter.id, chapter])));
      })
      .catch(() => { /* Keep resource ids visible if the catalog is temporarily unavailable. */ });
    return () => { active = false; };
  }, [hasTintinalliChapterAnnotations]);
  const now = new Date().toISOString();
  const results = useMemo(() => annotations.filter((annotation) => {
    const guideSource = parseAnyGuideAnnotationResourceId(annotation.questionId);
    const guideChapter = guideSource?.textbook === "tintinalli" && guideSource.resourceKind === "chapter"
      ? guideChapterMap.get(guideSource.chapter)
      : undefined;
    const rosensChapter = guideSource?.textbook === "rosens" && guideSource.resourceKind === "chapter"
      ? rosensChapterMap.get(guideSource.chapterId)
      : undefined;
    const labels = guideSource ? guideLabels(guideSource, guideChapter, rosensChapter) : null;
    const question = index.get(annotation.questionId);
    const progress = progressMap.get(annotation.questionId);
    if (filter === "wrong" && (guideSource || progress?.wrongState !== "pending")) return false;
    if (filter === "due" && (guideSource || !(progress?.dueAt && progress.dueAt <= now))) return false;
    if (filter === "bookmarked") {
      const resourceBookmark = guideSource
        ? guideResourceProgressMap.get(guideSource.resourceId)?.bookmarked
        : undefined;
      const bookmarked = guideSource
        ? resourceBookmark !== undefined
          ? resourceBookmark === 1
          : guideSource.textbook === "tintinalli" && guideSource.resourceKind === "chapter"
            ? guideProgressMap.get(guideSource.chapter)?.bookmarked === 1
            : false
        : progress?.bookmarked === 1;
      if (!bookmarked) return false;
    }
    const text = `${annotation.questionId} ${question?.title ?? ""} ${question?.category ?? ""} ${labels?.title ?? ""} ${labels?.context ?? ""} ${annotation.quote} ${annotation.body}`.toLocaleLowerCase();
    return !query || text.includes(query.toLocaleLowerCase());
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [annotations, filter, guideChapterMap, guideProgressMap, guideResourceProgressMap, index, now, progressMap, query]);

  return (
    <main className="workspace-page notebook-page">
      <header className="page-intro compact-intro notebook-intro">
        <div><p className="eyebrow"><span />筆記本</p><h1>重點與題目筆記</h1></div>
      </header>
      <div className="notebook-tools">
        <label><Search size={18} aria-hidden="true" /><input aria-label="搜尋筆記" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋題號、標題、重點或筆記" /></label>
        <div>{([ ["all", "全部"], ["wrong", "待釐清"], ["due", "今日到期"], ["bookmarked", "已收藏"] ] as const).map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
      </div>
      <section className="notebook-list" aria-label="筆記清單">
        {results.map((annotation) => {
          const guideSource = parseAnyGuideAnnotationResourceId(annotation.questionId);
          const guideChapter = guideSource?.textbook === "tintinalli" && guideSource.resourceKind === "chapter"
            ? guideChapterMap.get(guideSource.chapter)
            : undefined;
          const rosensChapter = guideSource?.textbook === "rosens" && guideSource.resourceKind === "chapter"
            ? rosensChapterMap.get(guideSource.chapterId)
            : undefined;
          const labels = guideSource ? guideLabels(guideSource, guideChapter, rosensChapter) : null;
          const question = index.get(annotation.questionId);
          const editing = editingId === annotation.id;
          const title = labels?.title ?? question?.title ?? annotation.questionId;
          const context = labels?.context ?? `${annotation.questionId}・${question?.category ?? "題目筆記"}`;
          const quote = annotation.quote && annotation.kind === "excerpt"
            ? <div className="notebook-excerpt-preview"><MarkdownContent markdown={annotation.quote} variant="annotation" /></div>
            : annotation.quote ? <blockquote>{annotation.quote}</blockquote> : null;
          const bodyLimit = guideSource && annotation.kind === "question_note" ? 12_000 : 4_000;
          const body = editing
            ? <div className="notebook-editor"><textarea aria-label={`編輯「${title}」筆記內容`} autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={bodyLimit} /><div><button onClick={() => { setEditingId(""); setDraft(""); }}>取消</button><button className="primary-button" onClick={() => { void onUpsert({ ...annotation, body: draft }).then(() => { setEditingId(""); setDraft(""); }); }}>儲存</button></div></div>
            : annotation.body
              ? guideSource && annotation.kind === "question_note"
                ? <div className="notebook-excerpt-preview"><MarkdownContent markdown={annotation.body} variant="annotation" /></div>
                : <p>{annotation.body}</p>
              : <p className="empty-note">{annotation.kind === "excerpt" ? "已保存原文格式" : "尚未加入附註"}</p>;
          const kindLabel = annotation.kind === "highlight" ? "重點標記" : annotation.kind === "excerpt" ? "內容摘錄" : "筆記";
          const KindIcon = annotation.kind === "highlight" ? Highlighter : annotation.kind === "excerpt" ? NotebookPen : BookMarked;
          return <article className="notebook-card" key={annotation.id}><div className="notebook-kind" role="img" aria-label={kindLabel} title={kindLabel}><KindIcon /></div><div className="notebook-card-copy"><span>{context}</span><h2>{title}</h2>{quote}{body}<small>{new Date(annotation.updatedAt).toLocaleString("zh-TW")}{annotation.syncState === "conflict" ? "・有較新的內容，請重新整理" : ""}</small></div><div className="notebook-card-actions"><button onClick={() => { setEditingId(annotation.id); setDraft(annotation.body); }}>編輯</button><button onClick={() => onOpenAnnotation(annotation.questionId, annotation.id)}>回到內容<ArrowRight size={15} /></button><button aria-label="刪除筆記" onClick={() => { if (window.confirm("確定刪除這則筆記？")) void onRemove(annotation.id); }}><Trash2 size={16} /></button></div></article>;
        })}
        {!results.length && <div className="empty-state"><BookMarked size={31} /><h2>{annotations.length ? "沒有符合條件的筆記" : "還沒有筆記"}</h2></div>}
      </section>
    </main>
  );
}
