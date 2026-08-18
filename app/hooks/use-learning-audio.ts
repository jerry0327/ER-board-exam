"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useAudioPlayer } from "../components/audio-player-provider";
import { requestQuestionAudioChoice } from "../lib/audio-player-section-events";
import {
  audioSummaryDisplayName,
  audioSummaryForLearningResource,
  loadAudioSummaryCatalog,
  type LearningAudioLocator,
  type AudioSummarySource,
} from "../lib/audio-summaries";

type UseLearningAudioOptions = {
  contentReady: boolean;
  noun: string;
  resource: LearningAudioLocator | null;
};

export function useLearningAudio({
  contentReady,
  noun,
  resource,
}: UseLearningAudioOptions) {
  const player = useAudioPlayer();
  const currentSourceId = player.current?.id ?? null;
  const loadSource = player.load;
  const openPlayer = player.openPlayer;
  const prepareDecoder = player.prepare;
  const prepareShell = player.prepareShell;
  const prefetchSource = player.prefetchSource;
  const primeSource = player.primeSource;
  const [catalogReady, setCatalogReady] = useState(false);

  useEffect(() => {
    if (catalogReady || !contentReady || !resource) return;
    let active = true;
    void loadAudioSummaryCatalog()
      .then(() => {
        if (active) setCatalogReady(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [catalogReady, contentReady, resource]);

  const source: AudioSummarySource | null = catalogReady
    ? audioSummaryForLearningResource(resource)
    : null;
  const isCurrent = Boolean(source && currentSourceId === source.id);
  const isQuestionAudio = resource?.kind === "question" && Boolean(resource.questionId);
  const actionLabel = isQuestionAudio
    ? "選擇播放方式"
    : isCurrent
      ? "顯示音檔播放器"
      : `載入本${noun}音檔`;

  useEffect(() => {
    if (!contentReady || !source || isCurrent) return;

    // The chapter payload is comparatively small, so start fetching it as soon
    // as the visible learning content has resolved. Delay the heavyweight
    // decoder warmup until after the next paint so it never competes with the
    // reader's first meaningful frame. On capable devices primeSource keeps the
    // first decoded windows ready in the Worker for a later user gesture.
    prepareShell();
    prefetchSource(source);
    let timer: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        if (document.visibilityState !== "visible") return;
        prepareDecoder();
        if (!primeSource(source)) prefetchSource(source);
      }, 240);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [contentReady, isCurrent, prefetchSource, prepareDecoder, prepareShell, primeSource, source]);

  const prepare = useCallback(() => {
    if (!contentReady || !source) return;
    prepareShell();
    prepareDecoder();
    if (!primeSource(source)) prefetchSource(source);
  }, [contentReady, prefetchSource, prepareDecoder, prepareShell, primeSource, source]);

  const open = useCallback((event?: MouseEvent<HTMLElement>) => {
    if (!source) return;
    prepare();
    if (resource?.kind === "question" && resource.questionId) {
      const clickedTrigger = event?.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : typeof document !== "undefined" && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      requestQuestionAudioChoice(
        { sourceId: source.id, questionId: resource.questionId },
        clickedTrigger,
      );
      return;
    }
    if (currentSourceId === source.id) openPlayer();
    else void loadSource(source);
  }, [currentSourceId, loadSource, openPlayer, prepare, resource, source]);

  return {
    actionLabel,
    accessibleLabel: source ? `${actionLabel} ${audioSummaryDisplayName(source)}` : "",
    isCurrent,
    open,
    prepare,
    source,
  };
}
