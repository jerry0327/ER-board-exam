"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Check, CheckCircle2, ChevronDown, Download, ExternalLink, FileText, Search, Trash2, Upload } from "lucide-react";
import { useRecognizedCourseProgress } from "../hooks/use-recognized-course-progress";
import { BOARD_PREP_ATTACHMENT_ACCEPT, type BoardPrepAttachmentMeta } from "../lib/board-prep-attachments";
import {
  SEM_RECOGNITION_FORMS_URL,
  exerciseLabels,
  normalizeCourseSearchText,
  recognitionBadges,
  recognizedCourseSummary,
  recognitionLabels,
  type ExerciseCategory,
  type RecognitionCategory,
  type RecognizedCourseSummary,
  type SemRecognitionFeed,
  type SemRecognizedCourse,
} from "../lib/sem-recognized-courses";
import { taiwanDateKey } from "../lib/taiwan-date";

type Props = {
  accountKey: string | null;
  quotaYear: number;
  attachments: BoardPrepAttachmentMeta[];
  addAttachment: (itemId: string, file: File) => Promise<BoardPrepAttachmentMeta>;
  replaceAttachment: (itemId: string, current: BoardPrepAttachmentMeta, file: File) => Promise<BoardPrepAttachmentMeta>;
  removeAttachment: (id: string) => Promise<boolean>;
  downloadAttachment: (id: string) => Promise<unknown>;
  attachmentsEnabled: boolean;
  onApplyToChecklist: (summary: RecognizedCourseSummary) => void;
};

const categoryOptions: { value: string; label: string }[] = [
  { value: "all", label: "全部類別" },
  ...Object.entries(recognitionLabels).map(([value, label]) => ({ value, label })),
  ...Object.entries(exerciseLabels).map(([value, label]) => ({ value, label })),
];

function displayDate(course: SemRecognizedCourse) {
  if (!course.startDate) return course.dateRaw;
  const format = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2})$/u, "$1/$2/$3");
  return course.endDate && course.endDate !== course.startDate ? `${format(course.startDate)}–${format(course.endDate)}` : format(course.startDate);
}

function displaySourceRevision(value: string) {
  return /^\d{7}$/u.test(value) ? `${value.slice(0, 3)}/${value.slice(3, 5)}/${value.slice(5, 7)}` : value;
}

function courseMatchesCategory(course: SemRecognizedCourse, category: string) {
  if (category === "all") return true;
  if (["intro", "hazmat", "nuclear", "other"].includes(category)) return course.hours[category as RecognitionCategory] > 0;
  return course.exerciseKinds.includes(category as ExerciseCategory);
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ProgressMetric({ label, value, target, suffix = "小時" }: { label: string; value: number; target: number; suffix?: string }) {
  const percent = target ? Math.min(100, Math.round(value / target * 100)) : 0;
  return <article className={value >= target ? "recognized-metric paper-card done" : "recognized-metric paper-card"}>
    <div><span>{label}</span>{value >= target && <CheckCircle2 aria-label="已達成" />}</div>
    <strong>{value}<small> / {target} {suffix}</small></strong>
    <span className="recognized-meter" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
  </article>;
}

export default function RecognizedCoursesArea(props: Props) {
  const progress = useRecognizedCourseProgress(props.accountKey);
  const completionDialogRef = useRef<HTMLDialogElement>(null);
  const [feed, setFeed] = useState<SemRecognitionFeed | null>(null);
  const [catalogNotice, setCatalogNotice] = useState("");
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("all");
  const [category, setCategory] = useState("all");
  const [completionFilter, setCompletionFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(40);
  const [pendingCourses, setPendingCourses] = useState<SemRecognizedCourse[]>([]);
  const [completionDate, setCompletionDate] = useState(taiwanDateKey);
  const [busy, setBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const today = taiwanDateKey();

  useEffect(() => {
    const dialog = completionDialogRef.current;
    if (!dialog || !pendingCourses.length || dialog.open) return;
    dialog.showModal();
  }, [pendingCourses.length]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/recognized-courses", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("目前無法載入課程，請稍後再試。");
        return response.json() as Promise<SemRecognitionFeed>;
      })
      .then((value) => { if (!controller.signal.aborted) setFeed(value); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setCatalogNotice(error instanceof Error ? error.message : "目前無法載入課程，請稍後再試。");
      });
    return () => controller.abort();
  }, []);

  const courses = useMemo(() => feed?.courses ?? [], [feed]);
  const summary = useMemo(() => recognizedCourseSummary(progress.completions, courses, props.quotaYear), [courses, progress.completions, props.quotaYear]);
  const years = useMemo(() => [...new Set(courses.map((course) => course.rocYear).filter(Boolean))].sort((a, b) => b - a), [courses]);
  const filtered = useMemo(() => {
    const normalizedQuery = normalizeCourseSearchText(query);
    return courses.filter((course) => {
      const completed = progress.byCourseId.has(course.id);
      if (year !== "all" && course.rocYear !== Number(year)) return false;
      if (!courseMatchesCategory(course, category)) return false;
      if (completionFilter === "completed" && !completed) return false;
      if (completionFilter === "incomplete" && completed) return false;
      if (normalizedQuery && !normalizeCourseSearchText(`${course.title} ${course.location} ${course.dateRaw}`).includes(normalizedQuery)) return false;
      return true;
    });
  }, [category, completionFilter, courses, progress.byCourseId, query, year]);
  const visible = filtered.slice(0, visibleCount);

  const attachmentMap = useMemo(() => {
    const map = new Map<string, BoardPrepAttachmentMeta[]>();
    for (const attachment of props.attachments) map.set(attachment.itemId, [...(map.get(attachment.itemId) ?? []), attachment]);
    return map;
  }, [props.attachments]);

  const metrics = props.quotaYear <= 107
    ? <>
        <ProgressMetric label="基礎課程" value={summary.hours.intro} target={14} />
        <ProgressMetric label="災難演習" value={Number(Object.values(summary.exerciseHours).reduce((total, value) => total + value, 0).toFixed(2))} target={8} />
      </>
    : <>
        <ProgressMetric label="初階災難" value={summary.hours.intro} target={summary.targets.intro} />
        <ProgressMetric label="毒化災" value={summary.hours.hazmat} target={summary.targets.hazmat} />
        <ProgressMetric label="核災／輻傷" value={summary.hours.nuclear} target={summary.targets.nuclear} />
        <ProgressMetric label="其他認列" value={summary.hours.other} target={summary.targets.other} />
        <ProgressMetric label="不同型態演習" value={summary.exerciseCount} target={3} suffix="類" />
        {summary.targets.jointDiscussions > 0 && <ProgressMetric label="聯合討論會" value={summary.jointDiscussions} target={3} suffix="次" />}
      </>;

  const toggleSelection = (courseId: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(courseId)) next.delete(courseId); else next.add(courseId);
    return next;
  });

  const openCompletion = (targets: SemRecognizedCourse[]) => {
    setPendingCourses(targets.filter((course) => !progress.byCourseId.has(course.id) && (!course.startDate || course.startDate <= today)));
    setCompletionDate(today);
    setActionNotice("");
  };

  const confirmCompletion = async () => {
    if (!pendingCourses.length || !completionDate) return;
    setBusy(true);
    try {
      for (const course of pendingCourses) await progress.save(course, { completedAt: completionDate });
      setSelected((current) => {
        const next = new Set(current);
        for (const course of pendingCourses) next.delete(course.id);
        return next;
      });
      setActionNotice(`已標記 ${pendingCourses.length} 門課程。`);
      setPendingCourses([]);
    } catch (error) {
      setActionNotice(error instanceof Error ? error.message : "無法標記完成，請再試一次。");
    } finally { setBusy(false); }
  };

  const saveRecord = async (course: SemRecognizedCourse, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await progress.save(course, {
        completedAt: String(form.get("completedAt") ?? ""),
        certificateNumber: String(form.get("certificateNumber") ?? ""),
        note: String(form.get("note") ?? ""),
      });
      setActionNotice("完成紀錄已儲存。");
    } catch (error) { setActionNotice(error instanceof Error ? error.message : "無法儲存，請再試一次。"); }
    finally { setBusy(false); }
  };

  const handleFile = async (recordKey: string, event: ChangeEvent<HTMLInputElement>, current?: BoardPrepAttachmentMeta) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    try {
      if (current) await props.replaceAttachment(recordKey, current, file); else await props.addAttachment(recordKey, file);
      setActionNotice(current ? "證明文件已更換。" : "證明文件已上傳。");
    } catch (error) { setActionNotice(error instanceof Error ? error.message : "無法儲存證明文件，請再試一次。"); }
    finally { setBusy(false); }
  };

  return <section className="recognized-area" aria-labelledby="recognized-title">
    <header className="recognized-header">
      <div>
        <h2 id="recognized-title">歷年認列課程</h2>
        <p>依課名、日期或地點搜尋，並標記已完成的課程。</p>
      </div>
      <a href={SEM_RECOGNITION_FORMS_URL} target="_blank" rel="noreferrer">查看認證清單 <ExternalLink /></a>
    </header>

    <div className="recognized-summary-grid" aria-label="災難醫學時數進度">{metrics}</div>
    <section className="recognized-tools-panel paper-card" aria-label="課程累計與篩選">
      <div className="recognized-transfer-row">
        <p>已完成 <strong>{summary.courses.length}</strong> 門課程</p>
        <button className="primary-button" type="button" onClick={() => props.onApplyToChecklist(summary)} disabled={!summary.courses.length}>更新完訓清單</button>
      </div>
      <div className="recognized-filters">
        <label className="recognized-search"><Search /><span className="sr-only">搜尋課程</span><input className="field-control" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(40); }} placeholder="搜尋課名或地點" /></label>
        <label><span>年度</span><select className="field-control" value={year} onChange={(event) => { setYear(event.target.value); setVisibleCount(40); }}><option value="all">全部年度</option>{years.map((value) => <option key={value} value={value}>{value} 年</option>)}</select></label>
        <label><span>認列類別</span><select className="field-control" value={category} onChange={(event) => { setCategory(event.target.value); setVisibleCount(40); }}>{categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>完成狀態</span><select className="field-control" value={completionFilter} onChange={(event) => { setCompletionFilter(event.target.value); setVisibleCount(40); }}><option value="all">全部狀態</option><option value="completed">已完成</option><option value="incomplete">尚未完成</option></select></label>
      </div>
    </section>

    <div className="recognized-result-line" aria-live="polite">
      <span>{feed ? `共 ${filtered.length} 門課程` : "正在讀取課程…"}</span>
      {feed && <span>認證清單日期 {displaySourceRevision(feed.sourceRevision)}</span>}
    </div>
    {(catalogNotice || progress.notice || actionNotice) && <p className="board-prep-notice" role="status">{catalogNotice || progress.notice || actionNotice}</p>}

    {selected.size > 0 && <div className="recognized-selection-bar floating-action-bar">
      <span>已選 {selected.size} 門</span>
      <button type="button" onClick={() => openCompletion(courses.filter((course) => selected.has(course.id)))}>標記為完成</button>
      <button type="button" onClick={() => setSelected(new Set())}>取消選取</button>
    </div>}

    <div className="recognized-table-wrap paper-card">
      <table className="recognized-table">
        <thead><tr><th><span className="sr-only">選取</span></th><th>日期與課程</th><th>地點</th><th>可認列內容</th><th>完成狀態</th></tr></thead>
        <tbody>
          {visible.map((course) => {
            const completion = progress.byCourseId.get(course.id);
            const future = Boolean(course.startDate && course.startDate > today);
            const recordKey = `recognized:${course.id}`;
            const courseAttachments = attachmentMap.get(recordKey) ?? [];
            return [
              <tr key={course.id} className={completion ? "completed" : ""}>
                <td data-label="選取"><label className="recognized-select"><input type="checkbox" aria-label={`選取課程：${course.title}`} checked={selected.has(course.id)} disabled={Boolean(completion) || future} onChange={() => toggleSelection(course.id)} /><span>{selected.has(course.id) && <Check />}</span></label></td>
                <td data-label="課程"><time>{displayDate(course)}</time><strong>{course.title}</strong></td>
                <td data-label="地點">{course.location || "地點請見課程公告"}</td>
                <td data-label="認列內容"><div className="recognized-badges">{recognitionBadges(course).map((badge) => <span data-recognition={badge.key} key={badge.key}>{badge.label}</span>)}</div></td>
                <td data-label="完成狀態">{completion
                  ? <span className="recognized-complete-label"><CheckCircle2 /> 已完成</span>
                  : future
                    ? <span className="recognized-future-label">尚未開課</span>
                    : <button className="quiet-button" type="button" onClick={() => openCompletion([course])}>標記完成</button>}</td>
              </tr>,
              completion && <tr className="recognized-detail-row" key={`${course.id}-details`}><td colSpan={5}>
                <details className="recognized-evidence">
                  <summary><span>{props.attachmentsEnabled ? "證明、證書號與備註" : "日期、證書號與備註"}</span><ChevronDown /></summary>
                  <div className="recognized-evidence-body">
                    <form onSubmit={(event) => void saveRecord(course, event)}>
                      <label>完成日期<input className="field-control" name="completedAt" type="date" defaultValue={completion.completedAt} max={today} /></label>
                      <label>證書號<input className="field-control" name="certificateNumber" type="text" defaultValue={completion.certificateNumber} maxLength={200} placeholder="選填" /></label>
                      <label className="recognized-note-field">備註<textarea className="field-control" name="note" defaultValue={completion.note} maxLength={2000} rows={3} placeholder="例：紙本護照頁次、主辦單位或需補充的事項" /></label>
                      <div className="recognized-record-actions"><button className="primary-button" type="submit" disabled={busy}>儲存</button><button className="danger-text-button" type="button" onClick={() => { if (window.confirm("要將這門課改為未完成嗎？")) void progress.remove(course.id); }}>改為未完成</button></div>
                    </form>
                    {props.attachmentsEnabled && <section className="recognized-files" aria-label="證明文件">
                      <header><div><FileText /><span>證明文件</span></div><label className="quiet-button"><Upload /> 上傳<input type="file" accept={BOARD_PREP_ATTACHMENT_ACCEPT} onChange={(event) => void handleFile(recordKey, event)} /></label></header>
                      {courseAttachments.length ? <ul>{courseAttachments.map((attachment) => <li key={attachment.id}>
                        <div><strong>{attachment.name}</strong><small>{fileSize(attachment.size)}</small></div>
                        <button type="button" onClick={() => void props.downloadAttachment(attachment.id)}><Download /> 下載</button>
                        <label><Upload /> 更換<input type="file" accept={BOARD_PREP_ATTACHMENT_ACCEPT} onChange={(event) => void handleFile(recordKey, event, attachment)} /></label>
                        <button type="button" onClick={() => { if (window.confirm("要刪除這份證明嗎？")) void props.removeAttachment(attachment.id); }}><Trash2 /> 刪除</button>
                      </li>)}</ul> : <p>尚未上傳證明文件。</p>}
                    </section>}
                  </div>
                </details>
              </td></tr>,
            ];
          })}
          {feed && !visible.length && <tr><td colSpan={5} className="recognized-empty">沒有符合條件的課程。</td></tr>}
        </tbody>
      </table>
    </div>
    {visibleCount < filtered.length && <button className="recognized-more" type="button" onClick={() => setVisibleCount((count) => count + 40)}>顯示更多課程</button>}

    {pendingCourses.length > 0 && <dialog
      ref={completionDialogRef}
      className="recognized-dialog"
      aria-labelledby="recognized-dialog-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else setPendingCourses([]);
      }}
    >
      <div className="recognized-dialog-card overlay-panel">
        <h3 id="recognized-dialog-title">確認完成課程</h3>
        <p>{pendingCourses.length === 1 ? pendingCourses[0].title : `共 ${pendingCourses.length} 門課程`}</p>
        <label>完成日期<input className="field-control" type="date" value={completionDate} max={today} onChange={(event) => setCompletionDate(event.target.value)} /></label>
        <div><button type="button" className="quiet-button" onClick={() => setPendingCourses([])} disabled={busy}>返回</button><button type="button" className="primary-button" onClick={() => void confirmCompletion()} disabled={busy || !completionDate}>{busy ? "處理中…" : "確認完成"}</button></div>
      </div>
    </dialog>}
  </section>;
}
