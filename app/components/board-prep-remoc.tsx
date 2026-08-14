"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileCheck2,
  Hourglass,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { useRemocCourseProgress } from "../hooks/use-remoc-course-progress";
import { integrateRegionalCourseListings } from "../lib/remoc-course-integration";
import {
  REMOC_CENTRAL_HOME_URL,
  REMOC_COURSE_LISTINGS_ENDPOINT,
  REMOC_NORTH_COURSES_URL,
  REMOC_SOUTH_COURSES_URL,
  normalizeRegionalCourseListingsPayload,
  type RegionalCourseListing,
} from "../lib/remoc-course-listings";
import {
  DISASTER_COURSES_ENDPOINT,
  DISASTER_COURSE_RECOGNITION_FORMS_URL,
  DISASTER_COURSE_RECOGNITION_SNAPSHOT_URL,
  DISASTER_COURSE_RECOGNITION_SNAPSHOT_UPDATED_AT,
  DISASTER_COURSE_RECOGNIZED_FALLBACK,
  REMOC_114_CENTRAL_SCHEDULE_URL,
  REMOC_115_ANNOUNCEMENT_URL,
  REMOC_115_PENDING_COURSES,
  REMOC_115_SCHEDULE_URL,
  REMOC_CATEGORY_OPTIONS,
  REMOC_REGION_OPTIONS,
  REMOC_STATIC_SCHEDULE_ROC_YEAR,
  disasterCourseCategories,
  disasterCourseTiming,
  formatRocDateFromIso,
  normalizeDisasterCoursePayload,
  pendingCourseHasRecognition,
  rocYearFromIsoDate,
  type DisasterChecklistItemId,
  type RegionalDisasterCourse,
  type RemocCategory,
  type RemocRegion,
} from "../lib/remoc-course-data";
import {
  remocCourseCompletionKey,
  remocCourseProgressTargets,
  summarizeRemocCourseProgress,
  type RemocCourseCompletionRecord,
  type RemocCourseProgress,
} from "../lib/remoc-course-progress";
import { remocRegistrationTone } from "../lib/course-registration-status";

type Props = {
  accountKey: string | null;
  quotaYear: number;
  region: RemocRegion;
  onRegionCountsChange: (counts: Record<RemocRegion, number>) => void;
  onOpenChecklistItem: (itemId: DisasterChecklistItemId) => void;
  onApplyCourseProgress: (progress: RemocCourseProgress, courses: RemocCourseCompletionRecord[]) => void;
};

type TimelineGroup = "ongoing" | "upcoming" | "tentative" | "completed";
type RecognitionFilter = "all" | "recognized" | "pending";

const timelineLabels: Record<TimelineGroup, { title: string; description?: string }> = {
  ongoing: { title: "課程進行中" },
  upcoming: { title: "接下來的課程" },
  tentative: { title: "已公告，尚待認列", description: "尚無認列時數" },
  completed: { title: "已辦課程" },
};

function taiwanDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function courseRequirementLabel(course: RegionalDisasterCourse) {
  const categories = disasterCourseCategories(course);
  if (!categories.length && course.recognitions.some((recognition) => recognition.kind === "intro")) return "初階災難訓練";
  return categories.map((category) => category === "hazmat" ? "毒化災" : category === "nuclear" ? "核災" : "HICS／DMAT／其他").join("、");
}

function normalizedSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-Hant").replace(/\s+/gu, " ").trim();
}

function courseMatchesSearch(course: RegionalDisasterCourse, query: string) {
  const terms = normalizedSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const searchable = normalizedSearchText([
    course.title,
    course.location,
    course.dateLabel,
    ...course.regions,
    ...course.recognitions.flatMap((recognition) => [recognition.label, recognition.hoursText]),
    course.listing?.registrationLabel ?? "",
    course.listing?.sourceName ?? "",
  ].join(" "));
  return terms.every((term) => searchable.includes(term));
}

function displayHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "");
}

function latestRecognizedCourseRocYear(courses: RegionalDisasterCourse[]) {
  return courses.reduce<number | null>((latest, course) => {
    const year = rocYearFromIsoDate(course.startDate);
    return year !== null && (latest === null || year > latest) ? year : latest;
  }, null);
}

function ProgressTile({
  label,
  value,
  target,
  unit,
  note,
  completedOverride,
  onOpen,
}: {
  label: string;
  value: number;
  target: number | null;
  unit: string;
  note?: string;
  completedOverride?: boolean;
  onOpen: () => void;
}) {
  const percent = target ? Math.min(100, Math.round(value / target * 100)) : 0;
  const completed = completedOverride ?? (target !== null && value >= target);
  return (
    <button className={completed ? "completed" : ""} type="button" onClick={onOpen}>
      <span><strong>{label}</strong><small>{note ?? (target ? `目標 ${target} ${unit}` : "已完成課程合計")}</small></span>
      <span className="remoc-progress-value"><strong>{displayHours(value)}</strong>{target !== null && <em>/ {target}</em>}<small>{unit}</small></span>
      {target !== null && <span className="remoc-progress-meter" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>}
      <ArrowRight aria-hidden="true" />
    </button>
  );
}

function CourseCard({
  course,
  timing,
  completed,
  today,
  canMarkCompleted,
  onToggleCompleted,
}: {
  course: RegionalDisasterCourse;
  timing: TimelineGroup;
  completed: boolean;
  today: string;
  canMarkCompleted: boolean;
  onToggleCompleted: () => void;
}) {
  const recognized = course.recognitionStatus === "recognized";
  return (
    <article className={`remoc-course-card paper-card remoc-course-${recognized ? "recognized" : "pending"}`}>
      <header>
        <div className="remoc-course-date"><CalendarClock /><span><small>{timing === "completed" ? "已辦理" : timing === "ongoing" ? "辦理中" : "課程日期"}</small><strong>{course.dateLabel}</strong></span></div>
        <span className={`remoc-recognition-status ${recognized ? "recognized" : "pending"}`}>
          {recognized ? <BadgeCheck /> : <Hourglass />}{recognized ? "已認列" : "尚待認列"}
        </span>
      </header>

      <div className="remoc-course-copy">
        <p>{courseRequirementLabel(course)}</p>
        <h4>{course.title}</h4>
        <div className="remoc-course-location"><MapPin /><span>{course.location}</span></div>
        {course.listing && (
          <div className="remoc-registration">
            <span className="course-registration-badge" data-status={remocRegistrationTone(course.listing.status, course.listing.registrationLabel, course.listing.deadline, today)}>{course.listing.registrationLabel}</span>
            <small>{course.listing.sourceName}</small>
          </div>
        )}
        <div className="remoc-course-inline-actions">
          <a href={course.listing?.detailUrl ?? course.sourceUrl} target="_blank" rel="noopener noreferrer">
            {course.listing?.status === "open" ? "報名與課程資訊" : "課程資訊"}<ExternalLink />
          </a>
          {course.listing?.brochureUrl && <a href={course.listing.brochureUrl} target="_blank" rel="noopener noreferrer">課程簡章<ExternalLink /></a>}
          {recognized && (canMarkCompleted || completed) && (
            <button type="button" aria-pressed={completed} onClick={onToggleCompleted}>
              <BookOpenCheck />{completed ? "改為未完成" : "標記完成"}
            </button>
          )}
        </div>
      </div>

      <div className="remoc-recognition-list" aria-label="時數與完訓項目">
        {course.recognitions.map((recognition, index) => (
          <div key={`${recognition.kind}-${recognition.hoursText}-${index}`}>
            <CheckCircle2 />
            <span><strong>{recognition.label}</strong><small>{recognized ? `認列 ${recognition.hoursText}` : "尚無認列時數"}</small></span>
          </div>
        ))}
      </div>

    </article>
  );
}

export default function BoardPrepRemoc({ accountKey, quotaYear, region, onRegionCountsChange, onOpenChecklistItem, onApplyCourseProgress }: Props) {
  const [category, setCategory] = useState<"all" | RemocCategory>("all");
  const [recognitionFilter, setRecognitionFilter] = useState<RecognitionFilter>("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [recognizedCourses, setRecognizedCourses] = useState<RegionalDisasterCourse[]>(DISASTER_COURSE_RECOGNIZED_FALLBACK);
  const [recognitionSourceStatus, setRecognitionSourceStatus] = useState<"live" | "snapshot">("snapshot");
  const [recognitionUpdatedAt, setRecognitionUpdatedAt] = useState(DISASTER_COURSE_RECOGNITION_SNAPSHOT_UPDATED_AT);
  const [recognitionSourceUrl, setRecognitionSourceUrl] = useState(DISASTER_COURSE_RECOGNITION_SNAPSHOT_URL);
  const [courseListings, setCourseListings] = useState<RegionalCourseListing[]>([]);
  const [expandedCompletedRegion, setExpandedCompletedRegion] = useState<RemocRegion | null>(null);
  const courseProgress = useRemocCourseProgress(accountKey);
  const progressTargets = remocCourseProgressTargets(quotaYear);
  const today = taiwanDateKey();
  const todayRocYear = rocYearFromIsoDate(today) ?? REMOC_STATIC_SCHEDULE_ROC_YEAR;
  const recognitionRocYear = useMemo(
    () => latestRecognizedCourseRocYear(recognizedCourses) ?? REMOC_STATIC_SCHEDULE_ROC_YEAR,
    [recognizedCourses],
  );
  const recognitionYearIsCurrent = recognitionRocYear === todayRocYear;
  const useStaticSchedule = recognitionSourceStatus === "live"
    && recognitionYearIsCurrent
    && recognitionRocYear === REMOC_STATIC_SCHEDULE_ROC_YEAR;
  const courseReferenceUrl = useStaticSchedule
    ? REMOC_115_SCHEDULE_URL
    : recognitionSourceStatus === "live"
      ? recognitionSourceUrl
      : DISASTER_COURSE_RECOGNITION_FORMS_URL;
  const courseReferenceLabel = useStaticSchedule
    ? `${recognitionRocYear} 年課程表`
    : recognitionSourceStatus === "live"
      ? `${recognitionRocYear} 年認證清單`
      : "官方課程與認證入口";
  const recognitionDocumentUrl = recognitionSourceStatus === "live"
    ? recognitionSourceUrl
    : DISASTER_COURSE_RECOGNITION_FORMS_URL;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(DISASTER_COURSES_ENDPOINT, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("course-list-unavailable");
        return response.json();
      })
      .then((payload: unknown) => {
        const normalized = normalizeDisasterCoursePayload(payload);
        if (!normalized?.courses.length) return;
        setRecognizedCourses(normalized.courses.map((course) => ({ ...course, recognitionStatus: "recognized" as const })));
        setRecognitionSourceStatus(normalized.status);
        setRecognitionUpdatedAt(normalized.updatedAt);
        setRecognitionSourceUrl(normalized.sourceUrl);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(REMOC_COURSE_LISTINGS_ENDPOINT, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("regional-course-list-unavailable");
        return response.json();
      })
      .then((payload: unknown) => {
        const normalized = normalizeRegionalCourseListingsPayload(payload);
        if (normalized) setCourseListings(normalized.courses);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, []);

  const announcedCourses = useMemo(() => useStaticSchedule
    ? REMOC_115_PENDING_COURSES.filter((course) => !pendingCourseHasRecognition(course, recognizedCourses))
    : [], [recognizedCourses, useStaticSchedule]);
  const allCourses = useMemo(() => integrateRegionalCourseListings(recognizedCourses, announcedCourses, courseListings), [announcedCourses, courseListings, recognizedCourses]);

  const completedCourses = useMemo(() => {
    const currentByKey = new Map(recognizedCourses.map((course) => [remocCourseCompletionKey(course), course]));
    return courseProgress.completedCourses.map((record) => {
      const current = currentByKey.get(record.key);
      return current ? {
        ...record,
        title: current.title,
        dateLabel: current.dateLabel,
        startDate: current.startDate,
        location: current.location,
        sourceUrl: current.sourceUrl,
        recognitions: current.recognitions.map((recognition) => ({ ...recognition })),
      } : record;
    });
  }, [courseProgress.completedCourses, recognizedCourses]);
  const progress = useMemo(() => summarizeRemocCourseProgress(completedCourses), [completedCourses]);

  const regionCounts = useMemo(() => Object.fromEntries(REMOC_REGION_OPTIONS.map((option) => [
    option.id,
    allCourses.filter((course) => course.regions.includes(option.id)).length,
  ])) as Record<RemocRegion, number>, [allCourses]);

  useEffect(() => onRegionCountsChange(regionCounts), [onRegionCountsChange, regionCounts]);
  const showCompleted = expandedCompletedRegion === region;

  const categoryCounts = useMemo(() => Object.fromEntries(REMOC_CATEGORY_OPTIONS.map((option) => [
    option.id,
    allCourses.filter((course) => course.regions.includes(region))
      .filter((course) => recognitionFilter === "all" || course.recognitionStatus === recognitionFilter)
      .filter((course) => !openOnly || course.listing?.status === "open")
      .filter((course) => courseMatchesSearch(course, searchQuery))
      .filter((course) => option.id === "all" || disasterCourseCategories(course).includes(option.id)).length,
  ])) as Record<"all" | RemocCategory, number>, [allCourses, openOnly, recognitionFilter, region, searchQuery]);

  const recognitionCounts = useMemo(() => ({
    all: allCourses.filter((course) => course.regions.includes(region))
      .filter((course) => category === "all" || disasterCourseCategories(course).includes(category))
      .filter((course) => !openOnly || course.listing?.status === "open")
      .filter((course) => courseMatchesSearch(course, searchQuery)).length,
    recognized: allCourses.filter((course) => course.regions.includes(region) && course.recognitionStatus === "recognized")
      .filter((course) => category === "all" || disasterCourseCategories(course).includes(category))
      .filter((course) => !openOnly || course.listing?.status === "open")
      .filter((course) => courseMatchesSearch(course, searchQuery)).length,
    pending: allCourses.filter((course) => course.regions.includes(region) && course.recognitionStatus === "pending")
      .filter((course) => category === "all" || disasterCourseCategories(course).includes(category))
      .filter((course) => !openOnly || course.listing?.status === "open")
      .filter((course) => courseMatchesSearch(course, searchQuery)).length,
  }), [allCourses, category, openOnly, region, searchQuery]);

  const openCourseCount = useMemo(() => allCourses
    .filter((course) => course.regions.includes(region) && course.listing?.status === "open")
    .filter((course) => category === "all" || disasterCourseCategories(course).includes(category))
    .filter((course) => recognitionFilter === "all" || course.recognitionStatus === recognitionFilter)
    .filter((course) => courseMatchesSearch(course, searchQuery)).length, [allCourses, category, recognitionFilter, region, searchQuery]);

  const visibleCourses = useMemo(() => allCourses
    .filter((course) => course.regions.includes(region))
    .filter((course) => category === "all" || disasterCourseCategories(course).includes(category))
    .filter((course) => recognitionFilter === "all" || course.recognitionStatus === recognitionFilter)
    .filter((course) => !openOnly || course.listing?.status === "open")
    .filter((course) => courseMatchesSearch(course, searchQuery))
    .sort((left, right) => {
      if (left.recognitionStatus !== right.recognitionStatus) return left.recognitionStatus === "recognized" ? -1 : 1;
      return left.startDate.localeCompare(right.startDate) || left.title.localeCompare(right.title, "zh-Hant");
    }), [allCourses, category, openOnly, recognitionFilter, region, searchQuery]);

  const groupedCourses = useMemo(() => {
    const groups: Record<TimelineGroup, RegionalDisasterCourse[]> = { ongoing: [], upcoming: [], tentative: [], completed: [] };
    for (const course of visibleCourses) groups[disasterCourseTiming(course, today)].push(course);
    return groups;
  }, [today, visibleCourses]);

  const selectedRegion = REMOC_REGION_OPTIONS.find((option) => option.id === region) ?? REMOC_REGION_OPTIONS[0];
  const selectedRegionSourceUrl = region === "north"
    ? courseListings.find((course) => course.region === "north" && course.status === "open")?.detailUrl ?? REMOC_NORTH_COURSES_URL
    : region === "central" ? REMOC_CENTRAL_HOME_URL : REMOC_SOUTH_COURSES_URL;
  const recognizedCourseHours = progress.introHours + progress.hazmatHours + progress.nuclearHours + progress.otherHours;
  const specialCourseHours = progress.hazmatHours + progress.nuclearHours + progress.otherHours;
  const specialCourseCompleted = progressTargets.mode === "special-24h"
    && progress.hazmatHours >= progressTargets.hazmatHours
    && progress.nuclearHours >= progressTargets.nuclearHours
    && progress.otherHours >= progressTargets.otherHours;
  const progressTileCount = progressTargets.mode === "basic-14h" ? 2 : progressTargets.mode === "special-24h" ? 3 : 5;
  const exerciseKindLabels = progress.exerciseKinds.map((kind) => (
    kind === "exercise-dmat" ? "DMAT" : kind === "exercise-hospital" ? "醫院應變" : "特殊災害"
  ));
  const clearFilters = () => {
    setCategory("all");
    setRecognitionFilter("all");
    setOpenOnly(false);
    setSearchQuery("");
    setExpandedCompletedRegion(null);
  };
  return (
    <section className="remoc-hub" id="board-prep-remoc-panel">
      <section className="remoc-summary-panel paper-card" aria-labelledby="remoc-course-title">
        <div className="remoc-summary-copy">
          <header className="course-panel-header remoc-summary-header">
            <div className="course-panel-heading">
              <p className="eyebrow"><span />{recognitionRocYear} 年度災難課程</p>
              <h2 id="remoc-course-title">區域 REMOC 課程</h2>
              <p>查看北區、中區與南區課程的日期、報名方式與認證時數。</p>
            </div>
            <nav className="course-panel-actions" aria-label="REMOC 課程入口">
              <a className="quiet-button" href={courseReferenceUrl} target="_blank" rel="noopener noreferrer"><CalendarClock /><span>{courseReferenceLabel}</span><ExternalLink /></a>
              <a className="quiet-button" href={DISASTER_COURSE_RECOGNITION_FORMS_URL} target="_blank" rel="noopener noreferrer"><FileCheck2 /><span>學會認證清單</span><ExternalLink /></a>
              <small>認證清單日期：{formatRocDateFromIso(recognitionUpdatedAt)}</small>
            </nav>
          </header>

          <section className="remoc-progress-panel" aria-labelledby="remoc-progress-title">
            <header>
              <div><p>我的認列時數</p><h3 id="remoc-progress-title">已完成課程</h3></div>
              <div className="remoc-progress-actions">
                <span>{progress.courseCount} 堂</span>
                <button className="primary-button" type="button" disabled={!courseProgress.ready || progress.courseCount === 0} onClick={() => onApplyCourseProgress(progress, completedCourses)}>更新完訓清單</button>
              </div>
            </header>
            {completedCourses.length > 0 && (
              <details className="remoc-completed-courses">
                <summary>查看已完成課程 <ChevronDown /></summary>
                <div>{completedCourses.map((course) => (
                  <div key={course.key}>
                    <span><strong>{course.title}</strong><small>{course.dateLabel}・{course.location}</small></span>
                    <button type="button" disabled={!courseProgress.ready} onClick={() => courseProgress.removeCourse(course.key)}>移除</button>
                  </div>
                ))}</div>
              </details>
            )}
          </section>
        </div>

        <div className="remoc-progress-grid" data-count={progressTileCount} aria-label="認列時數與演習進度">
          {progressTargets.mode === "basic-14h" && (
            <>
              <ProgressTile label="認列課程" value={recognizedCourseHours} target={progressTargets.courseHours} unit="小時" onOpen={() => onOpenChecklistItem("disaster.intro")} />
              <ProgressTile label="災難演習" value={progress.exerciseHours} target={progressTargets.exerciseHours} unit="小時" onOpen={() => onOpenChecklistItem("disaster.drills-3")} />
            </>
          )}
          {progressTargets.mode === "special-24h" && (
            <>
              <ProgressTile label="初階訓練" value={progress.introHours} target={progressTargets.introHours} unit="小時" onOpen={() => onOpenChecklistItem("disaster.intro")} />
              <ProgressTile label="特殊災難訓練" value={specialCourseHours} target={progressTargets.specialHours} completedOverride={specialCourseCompleted} unit="小時" note={`毒化 ${displayHours(progress.hazmatHours)}／核災 ${displayHours(progress.nuclearHours)}／其他 ${displayHours(progress.otherHours)}`} onOpen={() => onOpenChecklistItem("disaster.hazmat-6h")} />
              <ProgressTile label="演習型態" value={progress.exerciseCount} target={progressTargets.exerciseCount} unit="種" note={exerciseKindLabels.length ? exerciseKindLabels.join("、") : undefined} onOpen={() => onOpenChecklistItem("disaster.drills-3")} />
            </>
          )}
          {progressTargets.mode === "modern" && (
            <>
              <ProgressTile label="初階訓練" value={progress.introHours} target={progressTargets.introHours} unit="小時" onOpen={() => onOpenChecklistItem("disaster.intro")} />
              <ProgressTile label="毒化災" value={progress.hazmatHours} target={progressTargets.hazmatHours} unit="小時" onOpen={() => onOpenChecklistItem("disaster.hazmat-6h")} />
              <ProgressTile label="核災" value={progress.nuclearHours} target={progressTargets.nuclearHours} unit="小時" onOpen={() => onOpenChecklistItem("disaster.nuclear-6h")} />
              <ProgressTile label="其他認證" value={progress.otherHours} target={progressTargets.otherHours} unit="小時" onOpen={() => onOpenChecklistItem("disaster.other-6h")} />
              <ProgressTile label="演習型態" value={progress.exerciseCount} target={progressTargets.exerciseCount} unit="種" note={exerciseKindLabels.length ? exerciseKindLabels.join("、") : undefined} onOpen={() => onOpenChecklistItem("disaster.drills-3")} />
            </>
          )}
        </div>
      </section>

      <section className="paper-card remoc-course-browser" id="remoc-region-panel" aria-labelledby="remoc-region-title">
        <header className="remoc-browser-toolbar">
          <div><p>地區</p><h3 id="remoc-region-title">{selectedRegion.label}課程</h3><a href={selectedRegionSourceUrl} target="_blank" rel="noopener noreferrer">官方課程頁<ExternalLink /></a></div>
          <div className="remoc-filter-bar">
            <label className="field-shell remoc-filter-search">
              <Search aria-hidden="true" />
              <input type="search" aria-label="搜尋課程" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜尋課名、地點或認列內容" />
              {searchQuery && <button type="button" aria-label="清除搜尋" onClick={() => setSearchQuery("")}><X /></button>}
            </label>
            <div className="remoc-filter-strip" aria-label="課程篩選">
              <div className="remoc-filter-group" role="group" aria-label="課程類別">
                {REMOC_CATEGORY_OPTIONS.map((option) => (
                  <button className="quiet-button" key={option.id} type="button" aria-pressed={category === option.id} onClick={() => { setCategory(option.id); setExpandedCompletedRegion(null); }}>
                    {option.id === "all" ? "全部課程" : option.label}<span>{categoryCounts[option.id]}</span>
                  </button>
                ))}
              </div>
              <span className="remoc-filter-divider" aria-hidden="true" />
              <div className="remoc-filter-group remoc-filter-status" role="group" aria-label="課程狀態">
                <button className="quiet-button" type="button" aria-pressed={recognitionFilter === "recognized"} onClick={() => { setRecognitionFilter((value) => value === "recognized" ? "all" : "recognized"); setExpandedCompletedRegion(null); }}>
                  已認列<span>{recognitionCounts.recognized}</span>
                </button>
                <button className="quiet-button" type="button" aria-pressed={recognitionFilter === "pending"} onClick={() => { setRecognitionFilter((value) => value === "pending" ? "all" : "pending"); setExpandedCompletedRegion(null); }}>
                  待認列<span>{recognitionCounts.pending}</span>
                </button>
                <button className="quiet-button" type="button" aria-pressed={openOnly} onClick={() => { setOpenOnly((value) => !value); setExpandedCompletedRegion(null); }}>
                  可報名<span>{openCourseCount}</span>
                </button>
                {(searchQuery || category !== "all" || recognitionFilter !== "all" || openOnly) && (
                  <button className="text-action remoc-filter-clear" type="button" onClick={clearFilters}><X />清除</button>
                )}
              </div>
            </div>
            <output aria-live="polite">{visibleCourses.length} 場</output>
          </div>
        </header>

        {visibleCourses.length ? (
          <div className="remoc-timeline">
            {(["ongoing", "upcoming", "tentative"] as TimelineGroup[]).map((group) => groupedCourses[group].length > 0 && (
              <section className={`remoc-timeline-group remoc-timeline-${group}`} key={group}>
                <header><span /><div><h3>{timelineLabels[group].title}</h3>{timelineLabels[group].description && <p>{timelineLabels[group].description}</p>}</div><strong>{groupedCourses[group].length} 場</strong></header>
                <div className="remoc-course-grid">{groupedCourses[group].map((course) => <CourseCard key={course.id} course={course} timing={group} completed={courseProgress.hasCourse(course)} today={today} canMarkCompleted={courseProgress.ready && course.endDate <= today} onToggleCompleted={() => courseProgress.toggleCourse(course, course.endDate <= today ? course.endDate : today)} />)}</div>
              </section>
            ))}

            {groupedCourses.completed.length > 0 && (
              <section className="remoc-timeline-group remoc-timeline-completed">
                <button className="remoc-completed-toggle" type="button" aria-expanded={showCompleted} onClick={() => setExpandedCompletedRegion((value) => value === region ? null : region)}>
                  <span><CheckCircle2 /><span><strong>{timelineLabels.completed.title}</strong><small>{groupedCourses.completed.length} 場</small></span></span>
                  <ChevronDown />
                </button>
                {showCompleted && <div className="remoc-course-grid">{groupedCourses.completed.map((course) => <CourseCard key={course.id} course={course} timing="completed" completed={courseProgress.hasCourse(course)} today={today} canMarkCompleted={courseProgress.ready} onToggleCompleted={() => courseProgress.toggleCourse(course, course.endDate)} />)}</div>}
              </section>
            )}
          </div>
        ) : (
          <div className="remoc-empty-state">
            <CalendarClock />
            <h3>{searchQuery || category !== "all" || recognitionFilter !== "all" || openOnly ? "找不到符合條件的課程" : `${selectedRegion.label}目前沒有課程`}</h3>
            {searchQuery || category !== "all" || recognitionFilter !== "all" || openOnly ? <button type="button" onClick={clearFilters}>清除篩選</button> : <a href={courseReferenceUrl} target="_blank" rel="noopener noreferrer">{courseReferenceLabel}<ExternalLink /></a>}
          </div>
        )}

        {region === "central" && useStaticSchedule && (
          <footer className="remoc-central-reference">
            <span><CalendarClock /><span><strong>114 年歷史課程表：中區化災、輻傷、DMAT 與 HICS</strong></span></span>
            <a href={REMOC_114_CENTRAL_SCHEDULE_URL} target="_blank" rel="noopener noreferrer">查看歷史課程表<ExternalLink /></a>
          </footer>
        )}
      </section>

      <footer className="remoc-hub-footnote">
        {useStaticSchedule && <a href={REMOC_115_ANNOUNCEMENT_URL} target="_blank" rel="noopener noreferrer">學會 {recognitionRocYear} 年 REMOC 課程公告<ExternalLink /></a>}
        <a href={recognitionDocumentUrl} target="_blank" rel="noopener noreferrer">{formatRocDateFromIso(recognitionUpdatedAt)} 時數認證清單<ExternalLink /></a>
      </footer>
    </section>
  );
}
