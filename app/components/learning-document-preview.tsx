"use client";

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";
import { subscribeToMediaQuery } from "../lib/media-query";
import { scrollContainerToOrigin } from "../lib/motion";

type Props = {
  href: string;
  title: string;
  expectedPageCount?: number;
  externalHref: string;
};

type ReaderStatus = "loading" | "ready" | "error";

const MOBILE_READER_QUERY = "(max-width: 840px), (hover: none) and (pointer: coarse)";
const ZOOM_LEVELS = [1, 1.25, 1.5, 2] as const;
const MAX_OUTPUT_SCALE = 1.5;

function subscribeToMobileReader(change: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia(MOBILE_READER_QUERY);
  return subscribeToMediaQuery(media, change);
}

function getMobileReaderSnapshot() {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_READER_QUERY).matches;
}

function getServerMobileReaderSnapshot() {
  return false;
}

function nextZoom(current: number, direction: -1 | 1) {
  const index = ZOOM_LEVELS.findIndex((level) => level === current);
  const nextIndex = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + direction));
  return ZOOM_LEVELS[nextIndex];
}

export default function LearningDocumentPreview({
  href,
  title,
  expectedPageCount,
  externalHref,
}: Props) {
  const useMobileReader = useSyncExternalStore(
    subscribeToMobileReader,
    getMobileReaderSnapshot,
    getServerMobileReaderSnapshot,
  );

  if (!useMobileReader) {
    return (
      <iframe
        className="learning-document-native-frame"
        src={`${href}#page=1&view=FitH`}
        title={`${title} 文件預覽`}
        loading="lazy"
        allowFullScreen
      />
    );
  }

  return (
    <MobilePdfReader
      href={href}
      title={title}
      expectedPageCount={expectedPageCount}
      externalHref={externalHref}
    />
  );
}

function MobilePdfReader({ href, title, expectedPageCount, externalHref }: Props) {
  const [status, setStatus] = useState<ReaderStatus>("loading");
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(expectedPageCount ?? 0);
  const [zoom, setZoom] = useState<number>(1);
  const [stageWidth, setStageWidth] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let loadedDocument: PDFDocumentProxy | null = null;

    async function loadDocument() {
      await Promise.resolve();
      if (disposed) return;
      setStatus("loading");
      setProgress(0);

      try {
        const [pdfjs, workerModule] = await Promise.all([
          import("pdfjs-dist/legacy/build/pdf.mjs"),
          import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
        ]);
        if (disposed) return;

        pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
        loadingTask = pdfjs.getDocument({
          url: href,
          disableRange: true,
        });
        loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
          if (!disposed && total > 0) setProgress(Math.min(1, loaded / total));
        };
        loadedDocument = await loadingTask.promise;
        if (disposed) {
          await loadingTask.destroy();
          return;
        }

        setDocument(loadedDocument);
        setPageCount(loadedDocument.numPages);
        setPageNumber(1);
        setZoom(1);
        setStatus("ready");
      } catch {
        if (!disposed) setStatus("error");
      }
    }

    void loadDocument();
    return () => {
      disposed = true;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [attempt, href]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setStageWidth(Math.floor(width));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (status !== "ready" || !document || !canvas || stageWidth <= 0) return;

    let disposed = false;
    let renderTask: RenderTask | null = null;

    async function renderPage() {
      try {
        const page = await document!.getPage(pageNumber);
        if (disposed) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = stageWidth / baseViewport.width;
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const outputScale = Math.min(window.devicePixelRatio || 1, MAX_OUTPUT_SCALE);

        canvas!.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas!.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas!.style.width = `${Math.floor(viewport.width)}px`;
        canvas!.style.height = `${Math.floor(viewport.height)}px`;

        renderTask = page.render({
          canvas: canvas!,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;
      } catch (error) {
        if (!disposed && (!(error instanceof Error) || error.name !== "RenderingCancelledException")) {
          setStatus("error");
        }
      }
    }

    void renderPage();
    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, stageWidth, status, zoom]);

  function goToPage(nextPage: number) {
    const boundedPage = Math.min(pageCount, Math.max(1, nextPage));
    setPageNumber(boundedPage);
    scrollContainerToOrigin(stageRef.current);
  }

  function commitPageInput(input: HTMLInputElement) {
    const requestedPage = Number.parseInt(input.value, 10);
    const nextPage = Number.isFinite(requestedPage) ? requestedPage : pageNumber;
    const boundedPage = Math.min(pageCount, Math.max(1, nextPage));
    input.value = String(boundedPage);
    goToPage(boundedPage);
  }

  function handlePageInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      commitPageInput(event.currentTarget);
      event.currentTarget.blur();
    }
  }

  function changeZoom(direction: -1 | 1) {
    setZoom((current) => nextZoom(current, direction));
    scrollContainerToOrigin(stageRef.current);
  }

  function retry() {
    setDocument(null);
    setStatus("loading");
    setAttempt((current) => current + 1);
  }

  const zoomPercent = Math.round(zoom * 100);
  const loadingPercent = Math.round(progress * 100);

  return (
    <div className="learning-document-pdf-reader" data-reading-navigation-ignore>
      <div className="learning-document-pdf-toolbar" aria-label="PDF 閱讀工具">
        <div className="learning-document-pdf-page-controls" role="group" aria-label="頁面切換">
          <button
            type="button"
            onClick={() => goToPage(pageNumber - 1)}
            disabled={status !== "ready" || pageNumber <= 1}
            aria-label="上一頁"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <label>
            <span className="sr-only">目前頁碼</span>
            <input
              key={`${href}-${pageNumber}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={Math.max(1, pageCount)}
              defaultValue={pageNumber}
              disabled={status !== "ready"}
              onBlur={(event) => commitPageInput(event.currentTarget)}
              onKeyDown={handlePageInputKeyDown}
            />
            <span aria-hidden="true">/</span>
            <output aria-label={`共 ${pageCount || expectedPageCount || 0} 頁`}>
              {pageCount || expectedPageCount || "—"}
            </output>
          </label>
          <button
            type="button"
            onClick={() => goToPage(pageNumber + 1)}
            disabled={status !== "ready" || pageNumber >= pageCount}
            aria-label="下一頁"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>

        <div className="learning-document-pdf-zoom-controls" role="group" aria-label="頁面縮放">
          <button
            type="button"
            onClick={() => changeZoom(-1)}
            disabled={status !== "ready" || zoom <= ZOOM_LEVELS[0]}
            aria-label="縮小頁面"
          >
            <ZoomOut aria-hidden="true" />
          </button>
          <button
            type="button"
            className="learning-document-pdf-zoom-value"
            onClick={() => {
              setZoom(1);
              scrollContainerToOrigin(stageRef.current);
            }}
            disabled={status !== "ready"}
            aria-label={`目前縮放 ${zoomPercent}%，點一下恢復適合寬度`}
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            onClick={() => changeZoom(1)}
            disabled={status !== "ready" || zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            aria-label="放大頁面"
          >
            <ZoomIn aria-hidden="true" />
          </button>
        </div>
      </div>

      <div ref={stageRef} className="learning-document-pdf-stage" aria-live="polite">
        {status === "loading" ? (
          <div className="learning-document-pdf-state">
            <FileText aria-hidden="true" />
            <strong>正在開啟文件</strong>
            <span>{loadingPercent > 0 ? `${loadingPercent}%` : "準備閱讀畫面…"}</span>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="learning-document-pdf-state learning-document-pdf-error" role="alert">
            <FileText aria-hidden="true" />
            <strong>暫時無法顯示這份文件</strong>
            <span>可以重新載入，或改用新分頁閱讀。</span>
            <div>
              <button type="button" onClick={retry}><RefreshCw aria-hidden="true" />重新載入</button>
              <a href={externalHref} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />另頁開啟</a>
            </div>
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          className="learning-document-pdf-canvas"
          role="img"
          aria-label={`${title}第 ${pageNumber} 頁`}
          hidden={status !== "ready"}
        />
      </div>
    </div>
  );
}
