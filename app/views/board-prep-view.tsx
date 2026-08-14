"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  GraduationCap,
  Paperclip,
  Radar,
  Trash2,
  Upload,
} from "lucide-react";
import BoardPrepRemoc from "../components/board-prep-remoc";
import RecognizedCoursesArea from "../components/recognized-courses-area";
import { useBoardPrep } from "../hooks/use-board-prep";
import { normalizePrepRouteId, type PrepRouteId } from "../lib/app-route";
import { scrollElementIntoView } from "../lib/motion";
import {
  BOARD_PREP_ATTACHMENT_ACCEPT,
  BOARD_PREP_ATTACHMENT_MAX_BYTES,
  type BoardPrepAttachmentMeta,
} from "../lib/board-prep-attachments";
import {
  BOARD_PREP_MAX_QUOTA_YEAR,
  BOARD_PREP_MIN_QUOTA_YEAR,
  boardPrepOccurrenceEntries,
  boardPrepRuleProgress,
  type BoardPrepCompletionState,
} from "../lib/board-prep";
import {
  BOARD_PREP_RADAR_SOURCES,
  BOARD_PREP_RULES_PAGE_URL,
  type BoardResourceAnnouncement,
  type BoardResourceCourse,
} from "../lib/board-prep-data";
import { resolveCurrentExamResources } from "../lib/current-exam-resources";
import {
  formatRocDateFromIso,
  REMOC_REGION_OPTIONS,
  resolveDisasterChecklistTarget,
  type DisasterChecklistItemId,
  type RemocRegion,
} from "../lib/remoc-course-data";
import {
  completedExerciseEntries,
  type RemocCourseCompletionRecord,
  type RemocCourseProgress,
} from "../lib/remoc-course-progress";
import { courseRegistrationTone } from "../lib/course-registration-status";
import type { ExerciseCategory, RecognizedCourseSummary } from "../lib/sem-recognized-courses";
import { taiwanDateKey } from "../lib/taiwan-date";

type Props = {
  accountKey: string | null;
  routeId: string | null;
  onRouteChange: (route: PrepRouteId) => void;
};
type TabId = "checklist" | "recognized" | "upcoming" | "exam";
type UpcomingTabId = "society" | "remoc";
type BoardResourceNews = BoardResourceAnnouncement & { category: string };
type BoardResourceDisplay = {
  updatedAt: string;
  courses: BoardResourceCourse[];
  announcements: BoardResourceAnnouncement[];
  news: BoardResourceNews[];
};
type CompletionFields = Pick<BoardPrepCompletionState, "completedAt" | "certificateNumber" | "note">;

const tabs: Array<{ id: TabId; label: string; detail: string; icon: typeof Check }> = [
  { id: "checklist", label: "我的資格", detail: "缺項、證明與進度", icon: Check },
  { id: "upcoming", label: "找近期課程", detail: "學會與 REMOC", icon: Radar },
  { id: "recognized", label: "核對認列", detail: "認證時數清單", icon: CheckCircle2 },
  { id: "exam", label: "甄審文件", detail: "簡章、範圍與試題", icon: GraduationCap },
];

const SOCIETY_ACTIVITY_LINKS = BOARD_PREP_RADAR_SOURCES.filter((source) => [
  "sem-activities",
  "sem-non-hosted-activities",
  "sem-aha-activities",
  "sem-online-learning",
].includes(source.id));

const OFFICIAL_TRAINING_CURRICULUM_URL = "https://www.sem.org.tw/Doc/%E5%B0%88%E7%A7%91%E9%86%AB%E5%B8%AB%E8%A8%93%E7%B7%B4%E8%AA%B2%E7%A8%8B%E5%9F%BA%E6%BA%96";
const OFFICIAL_EXAM_PRINCIPLES_URL = "https://www.sem.org.tw/Content/%E7%94%84%E5%AF%A9%E5%8E%9F%E5%89%87";
const OFFICIAL_PAST_EXAMS_URL = "https://www.sem.org.tw/ExamRegister/PastExam";
const OFFICIAL_EXAM_NEWS_URL = "https://www.sem.org.tw/News/7/Index";
const OFFICIAL_NEWS_URL = "https://www.sem.org.tw/News";
const CURRENT_ORAL_TOPICS = ["外傷", "非外傷", "兒科", "EMS", "災難（毒化災）", "大量傷患", "復甦急救及醫病溝通", "高齡醫學", "綜合題型"];
const ORAL_EXAMPLE_LINKS = [
  { label: "115 年口試程序公告", url: "https://www.sem.org.tw/News/7/Details/1581" },
  { label: "口試流程及注意事項", url: "https://tsem.blob.core.windows.net/newscontainer/0.115%E5%B9%B4%E5%BA%A6%E5%8F%A3%E8%A9%A6%E6%B5%81%E7%A8%8B%E5%8F%8A%E6%B3%A8%E6%84%8F%E4%BA%8B%E9%A0%85%28%E5%85%AC%E5%91%8A%29.pdf" },
  { label: "個別面試例題（考生版）", url: "https://tsem.blob.core.windows.net/newscontainer/05112026101417_1.%E6%96%B0%E5%9E%8B%E5%80%8B%E5%88%A5%E9%9D%A2%E8%A9%A6%E8%80%83%E9%A1%8C%E6%A1%88%E4%BE%8B_%E8%80%83%E7%94%9F%E7%89%88.pdf" },
  { label: "個別面試例題（評分表）", url: "https://tsem.blob.core.windows.net/newscontainer/05112026101417_2.%E6%96%B0%E5%9E%8B%E5%80%8B%E5%88%A5%E9%9D%A2%E8%A9%A6%E8%80%83%E9%A1%8C%E6%A1%88%E4%BE%8B_%E8%A9%95%E5%88%86%E8%A1%A8%201.pdf" },
  { label: "115 年口試時程表", url: "https://tsem.blob.core.windows.net/newscontainer/3.115%E5%B9%B4%E5%8F%A3%E8%A9%A6%E6%99%82%E7%A8%8B%E8%A1%A8.pdf" },
] as const;

const emptyCompletion: BoardPrepCompletionState = {
  completed: false,
  completedAt: "",
  certificateNumber: "",
  note: "",
  updatedAt: "",
};

function displayDate(value: string) {
  if (!value) return "日期未提供";
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/u)?.[0];
  if (!dateOnly) return value;
  const [year, month, day] = dateOnly.split("-");
  return `${year}/${month}/${day}`;
}

function fileSizeLabel(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeExternalUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.sem.org.tw" ? url.href : "";
  } catch {
    return "";
  }
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.slice(0, 500) : typeof value === "number" ? String(value) : fallback;
}

function normalizeBoardResourceFeed(value: unknown): BoardResourceDisplay | null {
  if (!value || typeof value !== "object") return null;
  const input = value as { updatedAt?: unknown; courses?: unknown; announcements?: unknown; news?: unknown };
  const courses: BoardResourceCourse[] = Array.isArray(input.courses) ? input.courses.flatMap((course) => {
    if (!course || typeof course !== "object") return [];
    const item = course as Partial<BoardResourceCourse>;
    const url = safeExternalUrl(item.url);
    const title = textValue(item.title);
    if (!title || !url) return [];
    return [{
      id: textValue(item.id, `${title}:${url}`),
      title,
      organizer: textValue(item.organizer, "主辦單位請見活動頁"),
      date: textValue(item.date),
      credits: typeof item.credits === "number" && Number.isFinite(item.credits) ? item.credits : null,
      sponsorType: textValue(item.sponsorType),
      registrationStatus: textValue(item.registrationStatus),
      url,
      source: textValue(item.source, "官方活動頁"),
    }];
  }).slice(0, 20) : [];
  const announcements: BoardResourceAnnouncement[] = Array.isArray(input.announcements) ? input.announcements.flatMap((announcement) => {
    if (!announcement || typeof announcement !== "object") return [];
    const item = announcement as Partial<BoardResourceAnnouncement>;
    const url = safeExternalUrl(item.url);
    const title = textValue(item.title);
    if (!title || !url) return [];
    return [{ id: textValue(item.id, `${title}:${url}`), title, date: textValue(item.date), url }];
  }).slice(0, 12) : [];
  const news: BoardResourceNews[] = Array.isArray(input.news) ? input.news.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<BoardResourceNews>;
    const url = safeExternalUrl(item.url);
    const title = textValue(item.title);
    if (!title || !url) return [];
    return [{ id: textValue(item.id, `${title}:${url}`), category: textValue(item.category, "all"), title, date: textValue(item.date), url }];
  }).slice(0, 12) : [];
  return { updatedAt: textValue(input.updatedAt), courses, announcements, news };
}

function SocietyCourseSection({ feed, loading }: { feed: BoardResourceDisplay | null; loading: boolean }) {
  return (
    <section className="society-course-section" aria-labelledby="society-course-title">
      <header className="course-panel-header paper-card">
        <div className="course-panel-heading">
          <p className="eyebrow"><span />台灣急診醫學會</p>
          <h2 id="society-course-title">近期課程與積分活動</h2>
          <p>查看近期課程日期、主辦單位、積分與報名狀態。</p>
          {feed?.updatedAt && <small className="course-panel-updated">資料更新：{formatRocDateFromIso(feed.updatedAt.slice(0, 10))}</small>}
        </div>
        <nav className="course-panel-actions" aria-label="學會課程入口">
          {SOCIETY_ACTIVITY_LINKS.map((source) => <a className="quiet-button" key={source.id} href={source.url} target="_blank" rel="noopener noreferrer"><span>{source.label}</span><ExternalLink /></a>)}
        </nav>
      </header>

      {feed?.courses.length ? <div className="society-course-grid">
        {feed.courses.map((course) => <a className="paper-card society-course-card" key={course.id} href={course.url} target="_blank" rel="noopener noreferrer">
          <header><span>{course.sponsorType || "積分活動"}</span>{course.registrationStatus && <strong className="course-registration-badge" data-status={courseRegistrationTone(course.registrationStatus)}>{course.registrationStatus}</strong>}</header>
          <h3>{course.title}</h3>
          <p>{course.organizer}</p>
          <footer><time>{displayDate(course.date)}</time>{course.credits !== null && <span>{course.credits} 積分</span>}<em>查看活動<ExternalLink /></em></footer>
        </a>)}
      </div> : <div className="paper-card society-course-empty"><CalendarDays /><p>{loading ? "正在讀取近期課程…" : "目前沒有近期課程。"}</p></div>}
    </section>
  );
}

function ChecklistEvidence({
  value,
  attachments = [],
  busy = false,
  disabled = false,
  attachmentDisabled = false,
  summary = "日期、證書與備註",
  notePlaceholder = "紙本護照頁次（選填）",
  showFields = true,
  showAttachments = true,
  compactSummary = false,
  onChange,
  onFile,
  onDownload,
  onRemove,
}: {
  value: CompletionFields;
  attachments?: BoardPrepAttachmentMeta[];
  busy?: boolean;
  disabled?: boolean;
  attachmentDisabled?: boolean;
  summary?: string;
  notePlaceholder?: string;
  showFields?: boolean;
  showAttachments?: boolean;
  compactSummary?: boolean;
  onChange: (patch: Partial<CompletionFields>) => void;
  onFile?: (event: ChangeEvent<HTMLInputElement>, current?: BoardPrepAttachmentMeta) => void;
  onDownload?: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <details className="checklist-evidence checklist-evidence-compact">
      <summary>
        {!compactSummary && <span className="checklist-evidence-title"><Paperclip />{summary}</span>}
        <span className="checklist-evidence-toggle" aria-hidden="true">
          <span className="checklist-evidence-closed-label">展開</span>
          <span className="checklist-evidence-open-label">收闔</span>
          <ChevronDown />
        </span>
      </summary>
      <div className="checklist-evidence-body">
        {showFields && <div className="checklist-evidence-fields">
          <label>完成日期<input className="field-control" type="date" value={value.completedAt} max={taiwanDateKey()} disabled={disabled} onChange={(event) => onChange({ completedAt: event.target.value })} /></label>
          <label>證書號<input className="field-control" type="text" value={value.certificateNumber} maxLength={500} disabled={disabled} placeholder="選填" onChange={(event) => onChange({ certificateNumber: event.target.value })} /></label>
          <label className="wide">備註<textarea className="field-control" value={value.note} maxLength={2000} rows={3} disabled={disabled} placeholder={notePlaceholder} onChange={(event) => onChange({ note: event.target.value })} /></label>
        </div>}
        {showAttachments && onFile && <section className="board-prep-attachments">
          <div className="board-prep-attachment-heading">
            <span><Paperclip />證明文件</span>
            <label className={busy ? "busy" : ""}><Upload />{busy ? "上傳中…" : "上傳證明"}<input type="file" accept={BOARD_PREP_ATTACHMENT_ACCEPT} disabled={disabled || attachmentDisabled || busy} onChange={(event) => onFile(event)} /></label>
          </div>
          <small>PDF／JPG／PNG，單檔上限 {BOARD_PREP_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB</small>
          {attachments.length > 0 ? <ul>{attachments.map((attachment) => <li key={attachment.id}>
            <FileText />
            <span><strong>{attachment.name}</strong><small>{fileSizeLabel(attachment.size)}・{displayDate(attachment.updatedAt ?? attachment.createdAt)}</small></span>
            <button type="button" aria-label={`下載 ${attachment.name}`} onClick={() => onDownload?.(attachment.id)}><Download /></button>
            <label className="board-prep-replace-file" aria-label={`更換 ${attachment.name}`}><Upload /><input type="file" accept={BOARD_PREP_ATTACHMENT_ACCEPT} disabled={disabled || attachmentDisabled || busy} onChange={(event) => onFile(event, attachment)} /></label>
            <button type="button" aria-label={`刪除 ${attachment.name}`} onClick={() => onRemove?.(attachment.id)}><Trash2 /></button>
          </li>)}</ul> : <p className="checklist-no-file">尚未上傳證明文件。</p>}
        </section>}
      </div>
    </details>
  );
}

export default function BoardPrepView({ accountKey, routeId, onRouteChange }: Props) {
  const boardPrep = useBoardPrep(accountKey);
  const [remocRegionCounts, setRemocRegionCounts] = useState<Record<RemocRegion, number>>({ north: 0, central: 0, south: 0 });
  const [notice, setNotice] = useState("");
  const [pendingAttachmentItem, setPendingAttachmentItem] = useState("");
  const [resourceFeed, setResourceFeed] = useState<BoardResourceDisplay | null>(null);
  const [resourceLoading, setResourceLoading] = useState(true);
  const normalizedRoute = normalizePrepRouteId(routeId);
  const activeTab: TabId = normalizedRoute.startsWith("upcoming/")
    ? "upcoming"
    : normalizedRoute as TabId;
  const activeUpcomingTab: UpcomingTabId = normalizedRoute.startsWith("upcoming/remoc/")
    ? "remoc"
    : "society";
  const remocRegion: RemocRegion = normalizedRoute.startsWith("upcoming/remoc/")
    ? normalizedRoute.split("/").at(-1) as RemocRegion
    : "north";

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/board-resources", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("resource-unavailable")))
      .then((payload: unknown) => setResourceFeed(normalizeBoardResourceFeed(payload)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResourceFeed(null);
      })
      .finally(() => { if (!controller.signal.aborted) setResourceLoading(false); });
    return () => controller.abort();
  }, []);

  const currentExamResources = useMemo(
    () => resolveCurrentExamResources(resourceFeed?.announcements ?? []),
    [resourceFeed?.announcements],
  );
  const currentExamNoticeUrl = currentExamResources.notice?.url ?? OFFICIAL_EXAM_NEWS_URL;
  const currentOralExamUrl = currentExamResources.oralProcedure?.url ?? OFFICIAL_EXAM_NEWS_URL;
  const currentWrittenExamUrl = currentExamResources.writtenExam?.url ?? OFFICIAL_PAST_EXAMS_URL;
  const currentExamYearLabel = currentExamResources.year ? `${currentExamResources.year} 年` : "最新";
  const latestSocietyNews = useMemo(() => {
    const examUrls = new Set(resourceFeed?.announcements.map((announcement) => announcement.url) ?? []);
    return (resourceFeed?.news ?? []).filter((entry) => !examUrls.has(entry.url)).slice(0, 6);
  }, [resourceFeed?.announcements, resourceFeed?.news]);

  const attachmentsByItem = useMemo(() => {
    const result = new Map<string, BoardPrepAttachmentMeta[]>();
    for (const attachment of boardPrep.attachments) result.set(attachment.itemId, [...(result.get(attachment.itemId) ?? []), attachment]);
    return result;
  }, [boardPrep.attachments]);

  const selectTab = (tab: TabId) => {
    const route: PrepRouteId = tab === "upcoming" ? "upcoming/society" : tab;
    onRouteChange(route);
    window.requestAnimationFrame(() => document.getElementById(`board-prep-${tab}-tab`)?.focus());
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[next].id);
  };

  const selectSocietyCourses = () => {
    onRouteChange("upcoming/society");
    window.requestAnimationFrame(() => document.getElementById("board-prep-upcoming-society-tab")?.focus());
  };

  const selectRemocRegion = (region: RemocRegion) => {
    onRouteChange(`upcoming/remoc/${region}`);
  };

  const handleUpcomingTabKey = (event: KeyboardEvent<HTMLButtonElement>, current: UpcomingTabId) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home" || (event.key === "ArrowLeft" && current === "remoc")) selectSocietyCourses();
    else if (event.key === "End" || (event.key === "ArrowRight" && current === "society")) selectRemocRegion(remocRegion);
  };

  const handleFile = async (itemId: string, event: ChangeEvent<HTMLInputElement>, current?: BoardPrepAttachmentMeta) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setPendingAttachmentItem(itemId);
    setNotice("");
    try {
      if (current) await boardPrep.replaceAttachment(itemId, current, file);
      else await boardPrep.addAttachment(itemId, file);
      setNotice(current ? "證明文件已更換。" : "證明文件已上傳。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "證明文件暫時無法儲存。");
    } finally {
      setPendingAttachmentItem("");
    }
  };

  const removeAttachment = (attachment: BoardPrepAttachmentMeta) => {
    if (!window.confirm(`要刪除「${attachment.name}」嗎？`)) return;
    void boardPrep.removeAttachment(attachment.id).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "證明文件暫時無法刪除。"));
  };

  const openChecklistItem = (requestedItemId: DisasterChecklistItemId) => {
    const availableItemIds = new Set(boardPrep.sections.flatMap((section) => section.items.map((item) => item.id)));
    const itemId = resolveDisasterChecklistTarget(requestedItemId, availableItemIds);
    onRouteChange("checklist");
    window.setTimeout(() => {
      const target = document.getElementById(`board-prep-item-${itemId}`);
      scrollElementIntoView(target, { block: "center" });
      target?.focus({ preventScroll: true });
    }, 80);
  };

  const finishTransfer = (count: number) => {
    setNotice(count ? `已將 ${count} 項標為完成。` : "沒有新的項目可標記。");
    onRouteChange("checklist");
    if (count) window.setTimeout(() => scrollElementIntoView(document.querySelector<HTMLElement>("[id^='board-prep-item-disaster.']"), { block: "center" }), 80);
  };

  const applyRecognizedSummary = (summary: RecognizedCourseSummary) => {
    let count = 0;
    const applyItem = (itemId: string, completed: boolean, completedAt = taiwanDateKey()) => {
      if (!completed || boardPrep.state.items[itemId]?.completed) return;
      boardPrep.updateItem(itemId, { completed: true, completedAt });
      count += 1;
    };
    if (boardPrep.state.quotaYear <= 107) {
      applyItem("disaster.basic-14h", summary.hours.intro >= 14);
      applyItem("disaster.exercise-8h", Object.values(summary.exerciseHours).reduce((total, value) => total + value, 0) >= 8);
    } else {
      applyItem(boardPrep.state.quotaYear >= 112 ? "disaster.intro" : "disaster.intro-16h", summary.hours.intro >= 16);
      if (boardPrep.state.quotaYear >= 112) {
        applyItem("disaster.hazmat-6h", summary.hours.hazmat >= 6);
        applyItem("disaster.nuclear-6h", summary.hours.nuclear >= 6);
        applyItem("disaster.other-6h", summary.hours.other >= 6);
      } else {
        applyItem("disaster.special-24h", summary.hours.hazmat >= 8 && summary.hours.nuclear >= 8 && summary.hours.other >= 8);
      }
      const keyByKind: Record<ExerciseCategory, string> = { dmat: "1", hospital: "2", special: "3" };
      for (const kind of summary.exerciseKinds) {
        const key = keyByKind[kind];
        if (boardPrep.state.items["disaster.drills-3"]?.occurrences?.[key]?.completed) continue;
        const course = summary.courses.find((entry) => entry.exerciseKinds.includes(kind));
        boardPrep.updateOccurrence("disaster.drills-3", key, {
          completed: true,
          completedAt: course?.endDate || course?.startDate || taiwanDateKey(),
          note: course?.title ?? "",
        });
        count += 1;
      }
      if (boardPrep.state.quotaYear >= 112 && summary.jointDiscussions >= 3) {
        const discussions = summary.courses.filter((course) => /災難應變與醫療聯合討論會/u.test(course.title)).slice(0, 3);
        for (let index = 0; index < 3; index += 1) {
          const key = String(index + 1);
          if (boardPrep.state.items["disaster.joint-discussion-3"]?.occurrences?.[key]?.completed) continue;
          const course = discussions[index];
          boardPrep.updateOccurrence("disaster.joint-discussion-3", key, {
            completed: true,
            completedAt: course?.endDate || course?.startDate || taiwanDateKey(),
            note: course?.title ?? "",
          });
          count += 1;
        }
      }
    }
    finishTransfer(count);
  };

  const applyRemocCourseProgress = (progress: RemocCourseProgress, courses: RemocCourseCompletionRecord[]) => {
    const latestCompletionFor = (kinds: string[]) => courses
      .filter((course) => course.recognitions.some((recognition) => kinds.includes(recognition.kind)))
      .map((course) => course.completedAt)
      .sort()
      .at(-1) ?? taiwanDateKey();
    let count = 0;
    const applyItem = (itemId: string, completed: boolean, kinds: string[]) => {
      if (!completed || boardPrep.state.items[itemId]?.completed) return;
      boardPrep.updateItem(itemId, { completed: true, completedAt: latestCompletionFor(kinds) });
      count += 1;
    };
    if (boardPrep.state.quotaYear <= 107) {
      const courseHours = progress.introHours + progress.hazmatHours + progress.nuclearHours + progress.otherHours;
      applyItem("disaster.basic-14h", courseHours >= 14, ["intro", "hazmat", "nuclear", "other"]);
      applyItem("disaster.exercise-8h", progress.exerciseHours >= 8, ["exercise-dmat", "exercise-hospital", "exercise-special"]);
    } else {
      applyItem(boardPrep.state.quotaYear >= 112 ? "disaster.intro" : "disaster.intro-16h", progress.introHours >= 16, ["intro"]);
      if (boardPrep.state.quotaYear >= 112) {
        applyItem("disaster.hazmat-6h", progress.hazmatHours >= 6, ["hazmat"]);
        applyItem("disaster.nuclear-6h", progress.nuclearHours >= 6, ["nuclear"]);
        applyItem("disaster.other-6h", progress.otherHours >= 6, ["other"]);
      } else {
        applyItem("disaster.special-24h", progress.hazmatHours >= 8 && progress.nuclearHours >= 8 && progress.otherHours >= 8, ["hazmat", "nuclear", "other"]);
      }
      const keyByKind = { "exercise-dmat": "1", "exercise-hospital": "2", "exercise-special": "3" } as const;
      for (const exercise of completedExerciseEntries(courses)) {
        const key = keyByKind[exercise.kind];
        if (boardPrep.state.items["disaster.drills-3"]?.occurrences?.[key]?.completed) continue;
        boardPrep.updateOccurrence("disaster.drills-3", key, {
          completed: true,
          completedAt: exercise.completedAt,
          note: exercise.title,
        });
        count += 1;
      }
    }
    finishTransfer(count);
  };

  const attachmentReady = boardPrep.ready && boardPrep.attachmentStatus === "ready";

  return (
    <main className="workspace-page board-prep-page">
      <header className="page-intro compact-intro board-prep-intro">
        <div className="board-prep-hero-copy">
          <p className="eyebrow"><span />急診專科甄審</p>
          <h1>住院醫師必修與甄審進度</h1>
          <p>依容額年度或收訓日期查看必修項目，完成後可補登日期、證書號與備註。</p>
        </div>
        <details className="board-prep-context">
          <summary>
            <span><small>目前適用規則</small><strong>{boardPrep.cohort.label}</strong></span>
            <span>調整年度與查看依據<ChevronDown /></span>
          </summary>
          <section className="board-prep-controls" aria-label="適用規則">
            <div className="board-prep-rule-picker">
              <div className="board-prep-mode-tabs" role="group" aria-label="選擇適用年度">
                <button aria-pressed={boardPrep.state.selectionMode === "quota-year"} onClick={() => boardPrep.setSelectionMode("quota-year")}>依容額年度</button>
                <button aria-pressed={boardPrep.state.selectionMode === "training-start"} onClick={() => boardPrep.setSelectionMode("training-start")}>依收訓日期</button>
              </div>
              {boardPrep.state.selectionMode === "quota-year" ? <label>訓練容額年度<select className="field-control" value={boardPrep.state.quotaYear} disabled={!boardPrep.ready} onChange={(event) => boardPrep.setQuotaYear(Number(event.target.value))}>{Array.from({ length: BOARD_PREP_MAX_QUOTA_YEAR - BOARD_PREP_MIN_QUOTA_YEAR + 1 }, (_, index) => BOARD_PREP_MIN_QUOTA_YEAR + index).map((year) => <option key={year} value={year}>{year} 年度</option>)}</select></label>
                : <label>開始收訓日期<input className="field-control" type="date" value={boardPrep.state.trainingStartDate} disabled={!boardPrep.ready} min={`${BOARD_PREP_MIN_QUOTA_YEAR + 1911}-08-01`} max={`${BOARD_PREP_MAX_QUOTA_YEAR + 1912}-07-31`} onChange={(event) => boardPrep.setTrainingStartDate(event.target.value)} /></label>}
              <div className="board-prep-cohort-result"><CalendarDays /><span><small>適用容額</small><strong>{boardPrep.cohort.label}</strong></span></div>
            </div>
            <nav className="board-prep-rule-links" aria-label="官方規則">
              <a href={BOARD_PREP_RULES_PAGE_URL} target="_blank" rel="noopener noreferrer">官方必修課程表<ExternalLink /></a>
              <a href={OFFICIAL_TRAINING_CURRICULUM_URL} target="_blank" rel="noopener noreferrer">訓練課程基準<ExternalLink /></a>
            </nav>
          </section>
        </details>
        <div className="board-prep-progress" aria-label={`已完成 ${boardPrep.summary.completed} / ${boardPrep.summary.total} 項`}>
          <div><span>完訓進度</span><strong>{boardPrep.summary.percent}%</strong></div>
          <span className="board-prep-progress-track" aria-hidden="true"><i style={{ width: `${boardPrep.summary.percent}%` }} /></span>
          <p><strong>{boardPrep.summary.completed}</strong> / {boardPrep.summary.total} 項<small>{boardPrep.summary.remaining ? `還有 ${boardPrep.summary.remaining} 項` : "清單已完成"}</small></p>
        </div>
      </header>

      <section className="board-prep-workspace" aria-label="備考工作區">
        <nav className="board-prep-workspace-tabs" role="tablist" aria-label="備考內容">
          <span className="board-prep-workspace-label">備考流程</span>
          {tabs.map(({ id, label, detail, icon: Icon }, index) => <button key={id} id={`board-prep-${id}-tab`} type="button" role="tab" aria-selected={activeTab === id} aria-controls={`prep-panel-${id}`} tabIndex={activeTab === id ? 0 : -1} onClick={() => selectTab(id)} onKeyDown={handleTabKey}><span className="board-prep-tab-index">{String(index + 1).padStart(2, "0")}</span><Icon /><span><strong>{label}</strong><small>{detail}</small></span></button>)}
        </nav>
        <div className="board-prep-workspace-content">

      {(notice || boardPrep.attachmentNotice) && <p className="board-prep-notice" role="status">{notice || boardPrep.attachmentNotice}</p>}

      <section id="prep-panel-checklist" role="tabpanel" aria-labelledby="board-prep-checklist-tab" hidden={activeTab !== "checklist"} className="board-prep-checklist-workspace">
        <section className="board-prep-checklist" aria-label={`${boardPrep.cohort.label}必修清單`}>
            {boardPrep.sections.map((section, sectionIndex) => {
              const sectionProgress = section.items.reduce((total, item) => {
                const progress = boardPrepRuleProgress(item, boardPrep.state.items[item.id]);
                return { completed: total.completed + progress.completed, total: total.total + progress.total };
              }, { completed: 0, total: 0 });
              return <article className="board-prep-section paper-card" key={section.id}>
                <header><div><span>{String(sectionIndex + 1).padStart(2, "0")}</span><div><h2>{section.title}</h2></div></div><strong>{sectionProgress.completed} / {sectionProgress.total}</strong></header>
                <div className="board-prep-requirements">{section.items.map((item) => {
                  const itemState = boardPrep.state.items[item.id];
                  const value = itemState ?? { ...emptyCompletion, occurrences: {} };
                  const itemAttachments = attachmentsByItem.get(item.id) ?? [];
                  const occurrenceTracking = item.tracking?.kind === "occurrences" ? item.tracking : null;
                  const passportTracking = item.tracking?.kind === "passport" ? item.tracking : null;
                  const itemProgress = boardPrepRuleProgress(item, itemState);
                  return <article id={section.id === "disaster" ? `board-prep-item-${item.id}` : undefined} tabIndex={section.id === "disaster" ? -1 : undefined} className={`board-prep-requirement board-prep-requirement-${item.tracking?.kind ?? "standard"} ${itemState?.completed ? "completed" : ""} ${!occurrenceTracking && itemState?.completed ? "has-compact-evidence" : ""}`} key={item.id}>
                    <div className={`board-prep-requirement-main ${occurrenceTracking || passportTracking ? "board-prep-requirement-main-copy" : ""}`}>
                      {!occurrenceTracking && !passportTracking && <label className="board-prep-check"><input type="checkbox" aria-label={`${item.title}：${itemState?.completed ? "取消完成" : "標示完成"}`} checked={itemState?.completed ?? false} disabled={!boardPrep.ready} onChange={(event) => boardPrep.updateItem(item.id, { completed: event.target.checked, completedAt: event.target.checked ? value.completedAt || taiwanDateKey() : "" })} /><span aria-hidden="true">{itemState?.completed && <Check />}</span></label>}
                      <div className="board-prep-requirement-copy"><div className="board-prep-requirement-title"><h3>{item.title}</h3>{item.requiresCertificate && <span>需證明</span>}{occurrenceTracking && <em>{itemProgress.completed} / {itemProgress.total}</em>}</div>{item.officialNote && <p>{item.officialNote}</p>}</div>
                    </div>

                    {passportTracking && <label className="board-prep-passport-confirmation"><input type="checkbox" aria-label={`${item.title}：${passportTracking.completionLabel}`} checked={itemState?.completed ?? false} disabled={!boardPrep.ready} onChange={(event) => boardPrep.updateItem(item.id, { completed: event.target.checked, completedAt: event.target.checked ? value.completedAt || taiwanDateKey() : "" })} /><span aria-hidden="true">{itemState?.completed && <Check />}</span><strong>{passportTracking.completionLabel}</strong></label>}

                    {occurrenceTracking && <fieldset className="board-prep-occurrences"><legend>完成場次</legend>{boardPrepOccurrenceEntries(item).map((entry) => {
                      const occurrence = itemState?.occurrences?.[entry.key] ?? emptyCompletion;
                      return <div className={`board-prep-occurrence ${occurrence.completed ? "completed" : ""}`} key={entry.key}>
                        <label className="board-prep-occurrence-check"><input type="checkbox" aria-label={`${item.title} ${entry.label}：${occurrence.completed ? "取消完成" : "標示完成"}`} checked={occurrence.completed} disabled={!boardPrep.ready} onChange={(event) => boardPrep.updateOccurrence(item.id, entry.key, { completed: event.target.checked, completedAt: event.target.checked ? occurrence.completedAt || taiwanDateKey() : "" })} /><span aria-hidden="true">{occurrence.completed && <Check />}</span><strong>{entry.label}</strong></label>
                        {occurrence.completed && <ChecklistEvidence value={occurrence} disabled={!boardPrep.ready} summary="日期、證書與備註" notePlaceholder={occurrenceTracking.notePlaceholder} showAttachments={false} onChange={(patch) => boardPrep.updateOccurrence(item.id, entry.key, patch)} />}
                      </div>;
                    })}</fieldset>}

                    {!occurrenceTracking && itemState?.completed && <ChecklistEvidence value={value} attachments={itemAttachments} busy={pendingAttachmentItem === item.id} disabled={!boardPrep.ready} attachmentDisabled={!attachmentReady} compactSummary onChange={(patch) => boardPrep.updateItem(item.id, patch)} onFile={(event, current) => void handleFile(item.id, event, current)} onDownload={(id) => void boardPrep.downloadAttachment(id).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "證明文件暫時無法下載。"))} onRemove={(id) => { const attachment = itemAttachments.find((entry) => entry.id === id); if (attachment) removeAttachment(attachment); }} />}
                    {occurrenceTracking && itemProgress.completed > 0 && <ChecklistEvidence value={value} attachments={itemAttachments} busy={pendingAttachmentItem === item.id} disabled={!boardPrep.ready} attachmentDisabled={!attachmentReady} summary="證明文件" showFields={false} onChange={(patch) => boardPrep.updateItem(item.id, patch)} onFile={(event, current) => void handleFile(item.id, event, current)} onDownload={(id) => void boardPrep.downloadAttachment(id).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "證明文件暫時無法下載。"))} onRemove={(id) => { const attachment = itemAttachments.find((entry) => entry.id === id); if (attachment) removeAttachment(attachment); }} />}
                  </article>;
                })}</div>
              </article>;
            })}
        </section>
      </section>

      <section id="prep-panel-recognized" role="tabpanel" aria-labelledby="board-prep-recognized-tab" hidden={activeTab !== "recognized"}>{activeTab === "recognized" && <RecognizedCoursesArea accountKey={accountKey} quotaYear={boardPrep.state.quotaYear} attachments={boardPrep.attachments} attachmentsEnabled={attachmentReady} addAttachment={boardPrep.addAttachment} replaceAttachment={boardPrep.replaceAttachment} removeAttachment={boardPrep.removeAttachment} downloadAttachment={boardPrep.downloadAttachment} onApplyToChecklist={applyRecognizedSummary} />}</section>

      <section id="prep-panel-upcoming" role="tabpanel" aria-labelledby="board-prep-upcoming-tab" hidden={activeTab !== "upcoming"} className="board-prep-upcoming">
        {activeTab === "upcoming" && <>
          <nav className="board-prep-upcoming-selector reading-variant-selector" role="tablist" aria-label="近期開課類別">
            <span className="reading-variant-selector__status" aria-live="polite" aria-atomic="true">{activeUpcomingTab === "society" ? "目前顯示學會課程" : `目前顯示${REMOC_REGION_OPTIONS.find((option) => option.id === remocRegion)?.label ?? "北部"} REMOC 課程`}</span>
            <div className="board-prep-upcoming-selector__options reading-variant-selector__stage reading-variant-selector__stage--types">
              <button
                className={`reading-variant-selector__option ${activeUpcomingTab === "society" ? "is-selected" : ""}`.trim()}
                id="board-prep-upcoming-society-tab"
                type="button"
                role="tab"
                aria-selected={activeUpcomingTab === "society"}
                aria-controls="prep-panel-upcoming-society"
                tabIndex={activeUpcomingTab === "society" ? 0 : -1}
                onClick={selectSocietyCourses}
                onKeyDown={(event) => handleUpcomingTabKey(event, "society")}
              >
                <span><strong>學會課程</strong><small>近期課程與積分活動</small></span>
              </button>
              <button
                className={`reading-variant-selector__option ${activeUpcomingTab === "remoc" ? "is-selected" : ""}`.trim()}
                id="board-prep-upcoming-remoc-tab"
                type="button"
                role="tab"
                aria-selected={activeUpcomingTab === "remoc"}
                aria-controls="prep-panel-upcoming-remoc"
                tabIndex={activeUpcomingTab === "remoc" ? 0 : -1}
                onClick={() => selectRemocRegion(remocRegion)}
                onKeyDown={(event) => handleUpcomingTabKey(event, "remoc")}
              >
                <span><strong>REMOC 課程</strong><small>依地區查找開課</small></span>
              </button>
            </div>
            {activeUpcomingTab === "remoc" && <label className="board-prep-region-picker">課程地區
              <select className="field-control" aria-label="選擇 REMOC 課程地區" value={remocRegion} onChange={(event) => selectRemocRegion(event.target.value as RemocRegion)}>
                {REMOC_REGION_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}・{remocRegionCounts[option.id]} 場</option>)}
              </select>
            </label>}
          </nav>
          <section id="prep-panel-upcoming-society" role="tabpanel" aria-labelledby="board-prep-upcoming-society-tab" hidden={activeUpcomingTab !== "society"} className="board-prep-upcoming-panel"><SocietyCourseSection feed={resourceFeed} loading={resourceLoading} /></section>
          <section id="prep-panel-upcoming-remoc" role="tabpanel" aria-labelledby="board-prep-upcoming-remoc-tab" hidden={activeUpcomingTab !== "remoc"} className="board-prep-upcoming-panel"><BoardPrepRemoc accountKey={accountKey} quotaYear={boardPrep.state.quotaYear} region={remocRegion} onRegionCountsChange={setRemocRegionCounts} onOpenChecklistItem={openChecklistItem} onApplyCourseProgress={applyRemocCourseProgress} /></section>
        </>}
      </section>

      <section id="prep-panel-exam" role="tabpanel" aria-labelledby="board-prep-exam-tab" hidden={activeTab !== "exam"} className="board-prep-exam">
        <header className="board-prep-panel-heading"><div><h2>考試範圍與官方文件</h2></div></header>
        <article className="official-scope paper-card"><div className="scope-icon"><GraduationCap /></div><div><span>命題依據</span><h3>急診醫學科專科醫師訓練課程基準</h3><p>筆試與口試皆以訓練課程基準為範圍。</p><div className="scope-links"><a href={currentExamNoticeUrl} target="_blank" rel="noopener noreferrer">{currentExamResources.notice?.label ?? "最新甄審公告"} <ExternalLink /></a><a href={OFFICIAL_EXAM_PRINCIPLES_URL} target="_blank" rel="noopener noreferrer">甄審原則 <ExternalLink /></a><a href={OFFICIAL_TRAINING_CURRICULUM_URL} target="_blank" rel="noopener noreferrer">訓練課程基準 <ExternalLink /></a><a href={OFFICIAL_PAST_EXAMS_URL} target="_blank" rel="noopener noreferrer">歷屆筆試 <ExternalLink /></a><a href={currentOralExamUrl} target="_blank" rel="noopener noreferrer">{currentExamResources.oralProcedure?.label ?? "最新口試公告"} <ExternalLink /></a></div></div></article>

        <div className="exam-facts-grid">
          <article className="paper-card"><FileText /><div><small>筆試</small><h3>中文選擇題，考試 3 小時</h3><p>專有名詞可使用英文；命題範圍依訓練課程基準。</p><a href={currentExamNoticeUrl} target="_blank" rel="noopener noreferrer">查看{currentExamResources.notice?.label ?? "最新甄審公告"}<ExternalLink /></a></div></article>
          <article className="paper-card"><GraduationCap /><div><small>口試</small><h3>與筆試採相同內容範圍</h3><p>當年度流程、題型與示例由學會另行公告。</p><a href={currentOralExamUrl} target="_blank" rel="noopener noreferrer">查看{currentExamResources.oralProcedure?.label ?? "最新口試公告"}<ExternalLink /></a></div></article>
          <article className="paper-card"><CheckCircle2 /><div><small>歷屆試題</small><h3>官方筆試題目與答案</h3><a href={currentWrittenExamUrl} target="_blank" rel="noopener noreferrer">{currentExamResources.writtenExam?.label ?? "查看歷屆筆試"}<ExternalLink /></a></div></article>
        </div>

        <section className="paper-card current-oral-topics" aria-labelledby="current-oral-topics-title">
          <header>
            <div><p>{currentExamYearLabel}甄審</p><h3 id="current-oral-topics-title">當年度公告與歷年公開範例</h3></div>
            <a href={currentOralExamUrl} target="_blank" rel="noopener noreferrer">查看當年度官方公告<ExternalLink /></a>
          </header>
          <div className="current-oral-topic-reference"><strong>歷年公開範例・115 年公告題型</strong><ul>{CURRENT_ORAL_TOPICS.map((topic) => <li key={topic}>{topic}</li>)}</ul></div>
          <details className="current-oral-details">
            <summary>
              <span><strong>115 年口試流程與官方公開例題</strong><small>歷年公開資料摘要；原始公告與附件保留於展開內容</small></span>
              <span className="checklist-evidence-toggle"><span className="checklist-evidence-closed-label">展開</span><span className="checklist-evidence-open-label">收闔</span><ChevronDown /></span>
            </summary>
            <div className="current-oral-details-body">
              <section className="current-oral-flow" aria-labelledby="current-oral-flow-title">
                <h4 id="current-oral-flow-title">115 年流程摘要</h4>
                <ol>
                  <li><time>08:30–09:20</time><span><strong>報到</strong><small>攜帶准考證與身分證件；電子通訊及穿戴裝置關機後集中管理。</small></span></li>
                  <li><time>09:20–09:50</time><span><strong>抽籤分組</strong><small>A–J 共 10 組，並依服務與訓練關係遵守迴避原則。</small></span></li>
                  <li><time>10:00–14:50</time><span><strong>個別面試</strong><small>全程錄音；2 站、每站 30 分鐘與 2 題，共 4 題。每題 15 分鐘，第 12 分鐘提醒。</small></span></li>
                  <li><time>14:50 起</time><span><strong>結束</strong><small>繳回識別證，依出口指引離開考場。</small></span></li>
                </ol>
              </section>
              <section className="current-oral-example" aria-labelledby="current-oral-example-title">
                <h4 id="current-oral-example-title">隨 115 公告附上的官方公開例題</h4>
                <p>57 歲男性，聲音沙啞並反覆發燒 7–8 日。應試路徑依序為病史詢問、身體檢查、初步診斷、檢驗、可能診斷、特殊檢查、治療處置與病情說明；互動的完整性、必要性、順序及時間掌握均列入評量。</p>
              </section>
              <section className="current-oral-scoring" aria-labelledby="current-oral-scoring-title">
                <h4 id="current-oral-scoring-title">評分表可見重點</h4>
                <p>公開附件可見病史 16%、身體檢查 15%，並列出 TOCC、危及生命的頭頸與呼吸道感染、聲帶檢查等重點。目前公開資料未包含其餘評分頁、完整答案與後續配分。</p>
              </section>
              <nav className="current-oral-source-links" aria-label="官方口試公告與附件">
                {ORAL_EXAMPLE_LINKS.map((source) => <a className="quiet-button" key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ExternalLink /></a>)}
              </nav>
            </div>
          </details>
        </section>

        <section className="official-news-panel paper-card" aria-label="官方最新公告">
          <section aria-labelledby="exam-announcements-title">
            <header><h3 id="exam-announcements-title">甄審公告</h3><a className="quiet-button" href={OFFICIAL_EXAM_NEWS_URL} target="_blank" rel="noopener noreferrer">全部甄審公告<ExternalLink /></a></header>
            {resourceFeed?.announcements.length ? <div className="official-news-list">{resourceFeed.announcements.slice(0, 6).map((announcement) => <a key={announcement.id} href={announcement.url} target="_blank" rel="noopener noreferrer"><time>{displayDate(announcement.date)}</time><strong>{announcement.title}</strong><ExternalLink /></a>)}</div> : <p className="official-news-empty">{resourceLoading ? "正在讀取甄審公告…" : "目前沒有可顯示的甄審公告。"}</p>}
          </section>
          <section aria-labelledby="society-news-title">
            <header><h3 id="society-news-title">學會最新消息</h3><a className="quiet-button" href={OFFICIAL_NEWS_URL} target="_blank" rel="noopener noreferrer">全部消息<ExternalLink /></a></header>
            {latestSocietyNews.length ? <div className="official-news-list">{latestSocietyNews.map((entry) => <a key={entry.id} href={entry.url} target="_blank" rel="noopener noreferrer"><time>{displayDate(entry.date)}</time><strong>{entry.title}</strong><ExternalLink /></a>)}</div> : <p className="official-news-empty">{resourceLoading ? "正在讀取學會消息…" : "目前沒有可顯示的學會消息。"}</p>}
          </section>
        </section>
      </section>
        </div>
      </section>
    </main>
  );
}
