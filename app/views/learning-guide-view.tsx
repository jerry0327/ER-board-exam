"use client";

import { lazy, useEffect, type ComponentProps } from "react";
import type { AilsRouteId, GuideModuleId, GuideTextbookId } from "../lib/app-route";
import { isSupplementalGuideResourceId } from "../lib/supplemental-guide-ids";
import type { GuideReadState, GuideResourceProgressRecord } from "../lib/types";
import GuideHubView from "./guide-hub-view";
import type GuideViewComponent from "./guide-view";
import type { BoardTraceTarget } from "../lib/board-trace";

const loadGuideView = () => import("./guide-view");
const loadRosensGuideView = () => import("./rosens-guide-view");
const loadSupplementalGuideView = () => import("./supplemental-guide-view");
const loadAilsGuideView = () => import("./ails-guide-view");
const loadBoardTextbookView = () => import("./board-textbook-view");
const loadEmsGuideView = () => import("./ems-guide-view");
const loadGoldfrankGuideView = () => import("./goldfrank-guide-view");

const GuideView = lazy(loadGuideView);
const RosensGuideView = lazy(loadRosensGuideView);
const SupplementalGuideView = lazy(loadSupplementalGuideView);
const AilsGuideView = lazy(loadAilsGuideView);
const BoardTextbookView = lazy(loadBoardTextbookView);
const EmsGuideView = lazy(loadEmsGuideView);
const GoldfrankGuideView = lazy(loadGoldfrankGuideView);

function canWarmGuideReaders() {
  if (document.visibilityState !== "visible") return false;
  const connection = (
    navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }
  ).connection;
  if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return memory === undefined || memory >= 4;
}

type TintinalliProps = Omit<ComponentProps<typeof GuideViewComponent>, "requestedChapter" | "onSelectChapter" | "onOpenLibrary">;

type Props = TintinalliProps & {
  requestedTextbookId: GuideTextbookId | null;
  requestedGuideModuleId: GuideModuleId | null;
  requestedResourceId: string | null;
  requestedTraceNodeId?: string | null;
  requestedTraceQuestionId?: string | null;
  requestedTraceTarget?: BoardTraceTarget | null;
  onOpenLibrary: () => void;
  onOpenTextbookLibrary: (textbookId: GuideTextbookId) => void;
  guideResourceProgressMap: Map<string, GuideResourceProgressRecord>;
  guideResourceProgressStatus: "loading" | "synced" | "offline";
  onOpenGuideResource: (resourceId: string, contentHash: string | null) => Promise<unknown>;
  onMarkGuideResource: (resourceId: string, value: GuideReadState, contentHash: string | null) => Promise<unknown>;
  onBookmarkGuideResource: (resourceId: string, value: boolean) => Promise<unknown>;
  onOpenTintinalli: (resource: number | string) => void;
  onSelectTintinalliChapter: (resource: number | string) => void;
  onOpenRosens: (chapter: string) => void;
  onSelectRosensChapter: (chapter: string) => void;
  onOpenAils: (page?: AilsRouteId) => void;
  onSelectAilsPage: (page: import("../lib/ails-review").AilsPageId) => void;
  onOpenBoard: (unitCode?: string, nodeId?: string | null, questionId?: string | null, target?: BoardTraceTarget | null) => void;
  onSelectBoardUnit: (unitCode: string) => void;
  onOpenEms: (chapter?: string) => void;
  onSelectEmsChapter: (chapter: string) => void;
  onOpenGoldfrank: (chapter?: string) => void;
  onSelectGoldfrankChapter: (chapter: string) => void;
  onOpenReaderTrace: (questionId: string, target: BoardTraceTarget) => void;
};

export default function LearningGuideView({
  requestedTextbookId,
  requestedGuideModuleId,
  requestedResourceId,
  requestedTraceNodeId,
  requestedTraceQuestionId,
  requestedTraceTarget,
  onOpenLibrary,
  onOpenTextbookLibrary,
  guideResourceProgressMap,
  guideResourceProgressStatus,
  onOpenGuideResource,
  onMarkGuideResource,
  onBookmarkGuideResource,
  onOpenTintinalli,
  onSelectTintinalliChapter,
  onOpenRosens,
  onSelectRosensChapter,
  onOpenAils,
  onSelectAilsPage,
  onOpenBoard,
  onSelectBoardUnit,
  onOpenEms,
  onSelectEmsChapter,
  onOpenGoldfrank,
  onSelectGoldfrankChapter,
  onOpenReaderTrace,
  ...guideProps
}: Props) {
  const showingHub = !requestedGuideModuleId && !requestedTextbookId && !requestedResourceId;
  useEffect(() => {
    if (!showingHub || !canWarmGuideReaders()) return;
    const loaders = [
      loadGuideView,
      loadRosensGuideView,
      loadSupplementalGuideView,
      loadBoardTextbookView,
      loadEmsGuideView,
      loadGoldfrankGuideView,
      loadAilsGuideView,
    ];
    let cancelled = false;
    let index = 0;
    let timerId: number | null = null;
    let idleId: number | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const schedule = () => {
      if (cancelled || index >= loaders.length || !canWarmGuideReaders()) return;
      const run = () => {
        idleId = null;
        timerId = null;
        if (cancelled || !canWarmGuideReaders()) return;
        const load = loaders[index];
        index += 1;
        void load().catch(() => undefined).finally(() => {
          if (!cancelled) timerId = window.setTimeout(schedule, 160);
        });
      };
      if (idleWindow.requestIdleCallback) idleId = idleWindow.requestIdleCallback(run, { timeout: 1_400 });
      else timerId = window.setTimeout(run, 100);
    };
    timerId = window.setTimeout(schedule, 650);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      if (idleId !== null) idleWindow.cancelIdleCallback?.(idleId);
    };
  }, [showingHub]);

  if (requestedGuideModuleId === "ails") {
    return (
      <AilsGuideView
        requestedPage={requestedResourceId}
        requestedAnnotationId={guideProps.requestedAnnotationId}
        annotations={guideProps.annotations}
        annotationStatus={guideProps.annotationStatus}
        progressMap={guideResourceProgressMap}
        progressStatus={guideResourceProgressStatus}
        onSelectPage={onSelectAilsPage}
        onOpenLibrary={onOpenLibrary}
        onOpenResource={onOpenGuideResource}
        onMarkResource={onMarkGuideResource}
        onBookmarkResource={onBookmarkGuideResource}
        onAnnotationOpenChange={guideProps.onAnnotationOpenChange}
        onUpsert={guideProps.onUpsertAnnotation}
        onRemove={guideProps.onRemoveAnnotation}
      />
    );
  }

  if (requestedGuideModuleId === "board") {
    return (
      <BoardTextbookView
        questions={guideProps.questions}
        requestedUnitCode={requestedResourceId}
        requestedTraceNodeId={requestedTraceNodeId}
        requestedTraceQuestionId={requestedTraceQuestionId}
        requestedTraceTarget={requestedTraceTarget}
        requestedAnnotationId={guideProps.requestedAnnotationId}
        annotations={guideProps.annotations}
        annotationStatus={guideProps.annotationStatus}
        progressMap={guideResourceProgressMap}
        progressStatus={guideResourceProgressStatus}
        onSelectUnit={onSelectBoardUnit}
        onOpenLibrary={onOpenLibrary}
        onOpenReader={guideProps.onOpenReader}
        onOpenReaderTrace={onOpenReaderTrace}
        onOpenResource={onOpenGuideResource}
        onMarkResource={onMarkGuideResource}
        onBookmarkResource={onBookmarkGuideResource}
        onAnnotationOpenChange={guideProps.onAnnotationOpenChange}
        onUpsert={guideProps.onUpsertAnnotation}
        onRemove={guideProps.onRemoveAnnotation}
      />
    );
  }

  if (requestedGuideModuleId === "ems") {
    return (
      <EmsGuideView
        requestedChapter={requestedResourceId}
        requestedAnnotationId={guideProps.requestedAnnotationId}
        progressMap={guideResourceProgressMap}
        progressStatus={guideResourceProgressStatus}
        annotations={guideProps.annotations}
        annotationStatus={guideProps.annotationStatus}
        onSelectChapter={onSelectEmsChapter}
        onOpenLibrary={onOpenLibrary}
        onOpenResource={onOpenGuideResource}
        onMarkResource={onMarkGuideResource}
        onBookmarkResource={onBookmarkGuideResource}
        onAnnotationOpenChange={guideProps.onAnnotationOpenChange}
        onUpsert={guideProps.onUpsertAnnotation}
        onRemove={guideProps.onRemoveAnnotation}
      />
    );
  }

  if (requestedGuideModuleId === "goldfrank") {
    return (
      <GoldfrankGuideView
        requestedChapter={requestedResourceId}
        requestedAnnotationId={guideProps.requestedAnnotationId}
        progressMap={guideResourceProgressMap}
        progressStatus={guideResourceProgressStatus}
        annotations={guideProps.annotations}
        annotationStatus={guideProps.annotationStatus}
        onSelectChapter={onSelectGoldfrankChapter}
        onOpenLibrary={onOpenLibrary}
        onOpenResource={onOpenGuideResource}
        onMarkResource={onMarkGuideResource}
        onBookmarkResource={onBookmarkGuideResource}
        onAnnotationOpenChange={guideProps.onAnnotationOpenChange}
        onUpsert={guideProps.onUpsertAnnotation}
        onRemove={guideProps.onRemoveAnnotation}
      />
    );
  }

  if (!requestedTextbookId && !requestedResourceId) {
    return <GuideHubView progressMap={guideProps.progressMap} resourceProgressMap={guideResourceProgressMap} onOpenTintinalli={onOpenTintinalli} onOpenRosens={onOpenRosens} onOpenGoldfrank={onOpenGoldfrank} onOpenAils={onOpenAils} onOpenBoard={onOpenBoard} onOpenEms={onOpenEms} />;
  }

  const supplementalResource = isSupplementalGuideResourceId(requestedTextbookId ?? "tintinalli", requestedResourceId);
  if (supplementalResource) {
    const textbookId = requestedTextbookId ?? "tintinalli";
    return (
      <SupplementalGuideView
        textbookId={textbookId}
        requestedResourceId={requestedResourceId}
        requestedAnnotationId={guideProps.requestedAnnotationId}
        annotations={guideProps.annotations}
        annotationStatus={guideProps.annotationStatus}
        progressMap={guideResourceProgressMap}
        progressStatus={guideResourceProgressStatus}
        onSelectResource={textbookId === "rosens" ? onSelectRosensChapter : onSelectTintinalliChapter}
        onOpenChapterLibrary={() => onOpenTextbookLibrary(textbookId)}
        onOpenChapter={(chapter) => {
          if (textbookId === "rosens") onOpenRosens(String(chapter));
          else onOpenTintinalli(chapter);
        }}
        onOpenLibrary={onOpenLibrary}
        onOpenResource={onOpenGuideResource}
        onMarkResource={onMarkGuideResource}
        onBookmarkResource={onBookmarkGuideResource}
        onAnnotationOpenChange={guideProps.onAnnotationOpenChange}
        onUpsert={guideProps.onUpsertAnnotation}
        onRemove={guideProps.onRemoveAnnotation}
      />
    );
  }

  if (requestedTextbookId === "rosens") {
    return (
      <RosensGuideView
        requestedChapter={requestedResourceId}
        requestedAnnotationId={guideProps.requestedAnnotationId}
        progressMap={guideResourceProgressMap}
        progressStatus={guideResourceProgressStatus}
        annotations={guideProps.annotations}
        annotationStatus={guideProps.annotationStatus}
        onSelectChapter={onSelectRosensChapter}
        onOpenResource={onOpenGuideResource}
        onMarkResource={onMarkGuideResource}
        onBookmarkResource={onBookmarkGuideResource}
        onAnnotationOpenChange={guideProps.onAnnotationOpenChange}
        onUpsertAnnotation={guideProps.onUpsertAnnotation}
        onRemoveAnnotation={guideProps.onRemoveAnnotation}
        onOpenLibrary={onOpenLibrary}
      />
    );
  }

  return (
    <GuideView
      {...guideProps}
      requestedChapter={requestedResourceId === null ? null : Number(requestedResourceId)}
      onSelectChapter={(chapter) => onSelectTintinalliChapter(chapter)}
      onOpenLibrary={onOpenLibrary}
    />
  );
}
