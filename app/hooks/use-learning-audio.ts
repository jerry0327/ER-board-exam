"use client";

import { useCallback, useEffect, useState } from "react";
import { useAudioPlayer } from "../components/audio-player-provider";
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
  const actionLabel = isCurrent ? "顯示音檔播放器" : `載入本${noun}音檔`;

  const prepare = useCallback(() => {
    if (!contentReady || !source) return;
    prepareShell();
    prepareDecoder();
    if (!primeSource(source)) prefetchSource(source);
  }, [contentReady, prefetchSource, prepareDecoder, prepareShell, primeSource, source]);

  const open = useCallback(() => {
    if (!source) return;
    prepare();
    if (currentSourceId === source.id) openPlayer();
    else void loadSource(source);
  }, [currentSourceId, loadSource, openPlayer, prepare, source]);

  return {
    actionLabel,
    accessibleLabel: source ? `${actionLabel} ${audioSummaryDisplayName(source)}` : "",
    isCurrent,
    open,
    prepare,
    source,
  };
}
