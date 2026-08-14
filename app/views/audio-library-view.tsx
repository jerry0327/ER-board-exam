"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  FolderPlus,
  Headphones,
  ListMusic,
  ListPlus,
  Pause,
  PencilLine,
  Play,
  Save,
  Search,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import AudioPlaylistDestinationPicker from "../components/audio-playlist-destination-picker";
import { useAudioPlayer } from "../components/audio-player-provider";
import { useAudioPlaylists } from "../hooks/use-audio-playlists";
import {
  audioSummaryDisplayMarker,
  audioSummaryDisplayName,
  audioSummaryDisplayTitle,
  audioSummaryForId,
  audioSummaryLibraryId,
  audioSummaryLibraryTitle,
  audioSummaries,
  currentAudioSummaryCatalogError,
  loadAudioSummaryCatalog,
  upcomingAudioSummaries,
  type AudioSummarySource,
} from "../lib/audio-summaries";
import { learningSourceForAudioLibrary } from "../lib/learning-source-registry";
import { textbookAudioSectionForSource, textbookAudioSections } from "../lib/textbook-audio-sections";

const AUDIO_PAGE_SIZE = 24;
const AUDIO_QUEUE_RENDER_LIMIT = 24;
const CUSTOM_PLAYLIST_RENDER_LIMIT = 12;

type AudioCollectionSummary = {
  id: string;
  title: string;
  itemCount: number;
  durationSeconds: number;
};

function audioCollectionPresentation(collection: Pick<AudioCollectionSummary, "id" | "title">) {
  if (collection.id === "all") return { mark: "ALL", kicker: "完整書架", theme: "all", order: 0 };
  const source = learningSourceForAudioLibrary(collection.id);
  return source ? {
    mark: source.mark,
    kicker: source.audioKicker,
    theme: source.theme,
    order: source.order,
  } : {
    mark: collection.title.trim().slice(0, 1).toLocaleUpperCase() || "A",
    kicker: "AUDIO GUIDE",
    theme: "default",
    order: 100,
  };
}

function AudioCollectionCard({
  collection,
  active,
  onSelect,
}: {
  collection: AudioCollectionSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const presentation = audioCollectionPresentation(collection);
  return (
    <button
      type="button"
      className={`audio-collection-card audio-collection-${presentation.theme}${active ? " is-active" : ""}`}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span className="audio-collection-mark" aria-hidden="true">{presentation.mark}</span>
      <span className="audio-collection-copy">
        <small>{presentation.kicker}</small>
        <strong>{collection.title}</strong>
        <span>{collection.itemCount} 集 · {formatDuration(collection.durationSeconds)}</span>
      </span>
    </button>
  );
}

function normalizedSearchValue(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s._:/\\–—-]+/gu, "");
}

function matchesAudioSearch(
  source: AudioSummarySource,
  query: string,
) {
  const tokens = query.trim().split(/\s+/u).map(normalizedSearchValue).filter(Boolean);
  if (!tokens.length) return true;
  const questionTerms = source.questionStart && source.questionEnd
    ? Array.from(
      { length: source.questionEnd - source.questionStart + 1 },
      (_, index) => `q${source.questionStart! + index} ${source.questionStart! + index}`,
    ).join(" ")
    : "";
  const searchable = normalizedSearchValue(
    `${source.chapterLabel} ${source.chapterId} ${source.title} ${source.collectionTitle} ${source.collectionId} ${source.textbook} ${questionTerms}`,
  );
  return tokens.every((token) => searchable.includes(token));
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function shuffledSources(sources: readonly AudioSummarySource[]) {
  const next = [...sources];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function questionExamLabel(exam: string) {
  const match = exam.match(/^(\d{3})([AB])?$/u);
  if (!match) return exam;
  const year = Number(match[1]);
  return match[2] ? `民國 ${year} 年 ${match[2]} 卷` : `民國 ${year} 年`;
}

function playerStatus(phase: ReturnType<typeof useAudioPlayer>["phase"]) {
  if (phase === "loading" || phase === "buffering") return null;
  if (phase === "playing") return "播放中";
  if (phase === "paused") return "已暫停";
  if (phase === "error") return "暫時無法播放";
  return "選擇章節開始播放";
}

export default function AudioLibraryView() {
  const player = useAudioPlayer();
  const customPlaylists = useAudioPlaylists();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [collectionId, setCollectionId] = useState("all");
  const [questionExam, setQuestionExam] = useState("all");
  const [textbookSectionId, setTextbookSectionId] = useState("all");
  const [listeningFilter, setListeningFilter] = useState<"all" | "unfinished" | "completed">("all");
  const [page, setPage] = useState(1);
  const [sources, setSources] = useState(audioSummaries);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState("");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [renameDraft, setRenameDraft] = useState<{ id: string; value: string } | null>(null);
  const [playlistNotice, setPlaylistNotice] = useState("");
  const [playlistPage, setPlaylistPage] = useState(1);
  const [queuePage, setQueuePage] = useState(1);
  const [playlistPickerSource, setPlaylistPickerSource] = useState<AudioSummarySource | null>(null);
  const [playlistPickerPending, setPlaylistPickerPending] = useState("");
  const [playlistPickerError, setPlaylistPickerError] = useState("");
  const playlistAddTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    void loadAudioSummaryCatalog().then((catalog) => {
      if (!active) return;
      setSources(catalog);
      setCatalogFailed(Boolean(currentAudioSummaryCatalogError()));
      setCatalogLoading(false);
    });
    return () => { active = false; };
  }, [catalogAttempt]);

  useEffect(() => {
    if (!playlistNotice) return;
    const timeout = window.setTimeout(() => setPlaylistNotice(""), 4_500);
    return () => window.clearTimeout(timeout);
  }, [playlistNotice]);

  const collections = useMemo(() => {
    const grouped = new Map<string, {
      id: string;
      title: string;
      kind: (typeof sources)[number]["kind"];
      itemCount: number;
      durationSeconds: number;
    }>();
    for (const source of sources) {
      const libraryId = audioSummaryLibraryId(source);
      const collection = grouped.get(libraryId) ?? {
        id: libraryId,
        title: audioSummaryLibraryTitle(source),
        kind: source.kind,
        itemCount: 0,
        durationSeconds: 0,
      };
      collection.itemCount += 1;
      collection.durationSeconds += source.durationSeconds;
      grouped.set(libraryId, collection);
    }
    return [...grouped.values()].sort((left, right) => {
      const leftOrder = audioCollectionPresentation(left).order;
      const rightOrder = audioCollectionPresentation(right).order;
      return leftOrder - rightOrder || left.title.localeCompare(right.title, "zh-Hant");
    });
  }, [sources]);
  const allCollection = useMemo<AudioCollectionSummary>(() => ({
    id: "all",
    title: "全部音檔",
    itemCount: sources.length,
    durationSeconds: sources.reduce((total, source) => total + source.durationSeconds, 0),
  }), [sources]);
  const selectedCollection = collections.find((collection) => collection.id === collectionId) ?? null;
  const questionCollection = collections.find((collection) => collection.kind === "question-set") ?? null;
  const showQuestionExamFilter = selectedCollection?.kind === "question-set";
  const textbookSections = useMemo(() => textbookAudioSections(collectionId), [collectionId]);
  const showTextbookSectionFilter = textbookSections.length > 0;
  const questionExams = useMemo(() => (
    [...new Set(
      sources
        .filter((source) => source.kind === "question-set" && source.questionExam)
        .map((source) => source.questionExam!),
    )].sort((left, right) => right.localeCompare(left, "zh-Hant", { numeric: true }))
  ), [sources]);
  const filteredSources = useMemo(() => {
    return sources.filter((source) => {
      if (collectionId !== "all" && audioSummaryLibraryId(source) !== collectionId) return false;
      if (questionExam !== "all" && source.questionExam !== questionExam) return false;
      if (textbookSectionId !== "all" && textbookAudioSectionForSource(source)?.id !== textbookSectionId) return false;
      const completed = Boolean(player.listeningHistory[source.id]?.completed);
      if (listeningFilter === "completed" && !completed) return false;
      if (listeningFilter === "unfinished" && completed) return false;
      return matchesAudioSearch(source, deferredQuery);
    });
  }, [collectionId, deferredQuery, listeningFilter, player.listeningHistory, questionExam, sources, textbookSectionId]);

  const pageCount = Math.max(1, Math.ceil(filteredSources.length / AUDIO_PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const pageStart = (activePage - 1) * AUDIO_PAGE_SIZE;
  const visibleSources = filteredSources.slice(pageStart, pageStart + AUDIO_PAGE_SIZE);
  const sequentialNext = player.current ? upcomingAudioSummaries(player.current.id, 6) : [];
  const queuedIds = new Set(player.queue.map((source) => source.id));
  const queuePageCount = Math.max(1, Math.ceil(player.queue.length / AUDIO_QUEUE_RENDER_LIMIT));
  const activeQueuePage = Math.min(queuePage, queuePageCount);
  const queuePageStart = (activeQueuePage - 1) * AUDIO_QUEUE_RENDER_LIMIT;
  const visibleQueue = player.queue.slice(queuePageStart, queuePageStart + AUDIO_QUEUE_RENDER_LIMIT);
  const activePlaylist = customPlaylists.playlists.find((playlist) => playlist.id === activePlaylistId)
    ?? customPlaylists.playlists[0]
    ?? null;
  const activePlaylistItems = activePlaylist?.itemIds.map((id) => ({ id, source: audioSummaryForId(id) })) ?? [];
  const playlistPageCount = Math.max(
    1,
    Math.ceil(activePlaylistItems.length / CUSTOM_PLAYLIST_RENDER_LIMIT),
  );
  const activePlaylistPage = Math.min(playlistPage, playlistPageCount);
  const playlistPageStart = (activePlaylistPage - 1) * CUSTOM_PLAYLIST_RENDER_LIMIT;
  const visiblePlaylistItems = activePlaylistItems.slice(
    playlistPageStart,
    playlistPageStart + CUSTOM_PLAYLIST_RENDER_LIMIT,
  );
  const playlistStorageLabel = customPlaylists.status === "loading"
    ? "正在準備"
    : customPlaylists.status === "saving"
      ? "正在儲存"
      : customPlaylists.status === "error"
        ? "請再試一次"
        : "已儲存";
  const playlistBusy = customPlaylists.status === "loading" || customPlaylists.status === "saving";
  const currentProgress = player.duration > 0
    ? Math.min(100, Math.max(0, player.position / player.duration * 100))
    : 0;
  const playerPreparing = player.phase === "loading" || player.phase === "buffering";
  const currentPlayerStatus = playerStatus(player.phase);
  const sessionProgress = playerPreparing
    ? Math.min(100, Math.max(0, player.loadProgress * 100))
    : currentProgress;

  async function addSourceToPlaylist(playlistId: string, playlistName: string, source: AudioSummarySource) {
    if (playlistPickerPending) return;
    setPlaylistPickerError("");
    setPlaylistPickerPending(playlistId);
    try {
      await customPlaylists.addItem(playlistId, source.id);
      setActivePlaylistId(playlistId);
      setPlaylistNotice(`已將 ${audioSummaryDisplayName(source)} 加入「${playlistName}」。`);
      setPlaylistPickerSource(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "無法加入播放清單。";
      setPlaylistPickerError(message);
      setPlaylistNotice(message);
    } finally {
      setPlaylistPickerPending("");
    }
  }

  function requestPlaylistDestination(source: AudioSummarySource, trigger: HTMLElement) {
    playlistAddTriggerRef.current = trigger;
    setPlaylistNotice("");
    setPlaylistPickerError("");
    if (customPlaylists.playlists.length !== 1) {
      setPlaylistPickerSource(source);
      return;
    }
    const onlyPlaylist = customPlaylists.playlists[0];
    if (onlyPlaylist.itemIds.includes(source.id)) {
      setPlaylistNotice(`${audioSummaryDisplayName(source)} 已在「${onlyPlaylist.name}」。`);
      return;
    }
    void addSourceToPlaylist(onlyPlaylist.id, onlyPlaylist.name, source);
  }

  function playSequence(items: readonly AudioSummarySource[], label: string, shuffle = false) {
    const playable = shuffle ? shuffledSources(items) : [...items];
    if (!playable.length) return;
    void player.playSequence(playable);
    setPlaylistNotice(`${shuffle ? "已隨機排列並播放" : "正在播放"}${label}。`);
  }

  function selectCollection(nextCollectionId: string) {
    setCollectionId(nextCollectionId);
    if (collections.find((collection) => collection.id === nextCollectionId)?.kind !== "question-set") {
      setQuestionExam("all");
    }
    setTextbookSectionId("all");
    setPage(1);
  }

  return (
    <main className="workspace-page audio-library-page">
      <header className="audio-library-heading">
        <div>
          <p className="eyebrow"><span />AUDIOBOOK LIBRARY</p>
          <h1>學習音檔</h1>
          <p>依章節安排聆聽順序，離開此頁後仍可繼續播放。</p>
        </div>
        {sources.length > 0 && (
          <p aria-label={`共 ${sources.length} 集`}>
            <strong>{sources.length}</strong><span>集</span>
          </p>
        )}
      </header>

      {playlistNotice && (
        <div
          className="audio-library-toast"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>{playlistNotice}</span>
          <button
            type="button"
            aria-label="關閉通知"
            onClick={() => setPlaylistNotice("")}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      {player.current && (
        <section className="paper-card audio-library-session" aria-label="目前播放">
          <span className="audio-library-session-mark"><Headphones aria-hidden="true" /></span>
          <div>
            <small>目前播放</small>
            <h2>{audioSummaryDisplayName(player.current)}</h2>
            <p>
              {currentPlayerStatus && <>{currentPlayerStatus}<span aria-hidden="true"> · </span></>}
              {formatDuration(player.position)} / {formatDuration(player.duration)}
            </p>
          </div>
          <button type="button" className="quiet-button" onClick={player.openPlayer}>
            <SlidersHorizontal aria-hidden="true" />播放控制
          </button>
          <span className={`audio-library-session-progress ${playerPreparing ? "is-preparing" : ""} ${player.phase === "buffering" ? "is-indeterminate" : ""}`.trim()} aria-hidden="true">
            <span style={player.phase === "buffering" ? undefined : { width: `${sessionProgress}%` }} />
          </span>
        </section>
      )}

      <div className="audio-library-workspace">
        <section className="paper-card audio-library-catalog" aria-label="音檔目錄">
          {collections.length > 1 && (
            <nav className="audio-collection-shelf" aria-label="音檔播放清單">
              <AudioCollectionCard
                collection={allCollection}
                active={collectionId === "all"}
                onSelect={() => selectCollection("all")}
              />
              {collections.map((collection) => (
                <AudioCollectionCard
                  key={collection.id}
                  collection={collection}
                  active={collectionId === collection.id}
                  onSelect={() => selectCollection(collection.id)}
                />
              ))}
            </nav>
          )}

          <div className="audio-library-tools">
            <label>
              <Search aria-hidden="true" />
              <span className="sr-only">搜尋音檔</span>
              <input
                className="field-control"
                type="search"
                value={query}
                placeholder="搜尋章節、年度或題號"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            {showQuestionExamFilter && (
              <select
                className="field-control"
                aria-label="依歷屆考題年度篩選"
                value={questionExam}
                onChange={(event) => {
                  const nextExam = event.target.value;
                  setQuestionExam(nextExam);
                  if (nextExam !== "all" && questionCollection) {
                    setCollectionId(questionCollection.id);
                  }
                  setPage(1);
                }}
              >
                <option value="all">全部題庫年度</option>
                {questionExams.map((exam) => (
                  <option key={exam} value={exam}>{questionExamLabel(exam)}</option>
                ))}
              </select>
            )}
            {showTextbookSectionFilter && (
              <select
                className="field-control"
                aria-label={`依 ${selectedCollection?.title ?? "教科書"} Section 篩選`}
                value={textbookSectionId}
                onChange={(event) => {
                  setTextbookSectionId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">全部 {textbookSections.length} Sections</option>
                {textbookSections.map((section) => (
                  <option key={section.id} value={section.id}>{section.label} · {section.title}</option>
                ))}
              </select>
            )}
            <select
              className="field-control"
              aria-label="依聆聽狀態篩選"
              value={listeningFilter}
              onChange={(event) => {
                setListeningFilter(event.target.value as typeof listeningFilter);
                setPage(1);
              }}
            >
              <option value="all">全部聆聽狀態</option>
              <option value="unfinished">尚未聽完</option>
              <option value="completed">已聽完</option>
            </select>
            <button
              type="button"
              className="quiet-button audio-library-shuffle"
              disabled={!filteredSources.length}
              onClick={() => playSequence(filteredSources, "目前篩選的音檔", true)}
            >
              <Shuffle aria-hidden="true" />隨機播放
            </button>
            <span>{filteredSources.length > 0 ? `${pageStart + 1}–${pageStart + visibleSources.length} / ${filteredSources.length}` : "0 個結果"}</span>
          </div>

          {catalogFailed && sources.length === 0 ? (
            <div className="audio-library-empty">
              <Headphones aria-hidden="true" />
              <p>音檔目錄暫時無法載入。</p>
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  setCatalogLoading(true);
                  setCatalogFailed(false);
                  setCatalogAttempt((value) => value + 1);
                }}
              >
                重新載入
              </button>
            </div>
          ) : catalogLoading && sources.length === 0 ? (
            <div className="audio-library-empty"><Headphones aria-hidden="true" /><p>正在載入音檔目錄…</p></div>
          ) : visibleSources.length > 0 ? (
            <ol className="audio-chapter-list">
              {visibleSources.map((source) => {
                const current = player.current?.id === source.id;
                const sourcePlaying = current && player.isPlaying;
                const queued = queuedIds.has(source.id);
                const displayName = audioSummaryDisplayName(source);
                const listening = player.listeningHistory[source.id];
                const listeningPercent = listening?.duration > 0
                  ? Math.min(99, Math.round(listening.furthestPosition / listening.duration * 100))
                  : 0;
                const rowClassName = [
                  current ? "is-current" : "",
                  source.kind === "question-set" ? "is-question-set" : "",
                ].filter(Boolean).join(" ") || undefined;
                return (
                  <li key={source.id} className={rowClassName}>
                    <span className="audio-chapter-number">{audioSummaryDisplayMarker(source)}</span>
                    <div>
                      <strong>{audioSummaryDisplayTitle(source)}</strong>
                      <span>{source.collectionTitle} · {formatDuration(source.durationSeconds)}{listening?.completed ? " · 已聽完" : listeningPercent > 0 ? ` · 已聽 ${listeningPercent}%` : ""}</span>
                    </div>
                    <div className="audio-chapter-actions">
                      <button
                        type="button"
                        className="icon-button audio-playlist-add"
                        aria-label={customPlaylists.playlists.length > 1
                          ? `選擇要將 ${displayName} 加入哪份播放清單`
                          : customPlaylists.playlists.length === 1
                            ? `將 ${displayName} 加入「${customPlaylists.playlists[0].name}」`
                            : `建立播放清單並加入 ${displayName}`}
                        title={customPlaylists.playlists.length > 1 ? "選擇播放清單" : "加入播放清單"}
                        disabled={playlistBusy || (
                          customPlaylists.playlists.length === 1
                          && customPlaylists.playlists[0].itemIds.includes(source.id)
                        )}
                        onClick={(event) => requestPlaylistDestination(source, event.currentTarget)}
                      >
                        <FolderPlus aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-button audio-queue-add"
                        aria-label={queued
                          ? `${displayName} 已在待播清單`
                          : `將 ${displayName} 加入待播清單`}
                        disabled={current || queued}
                        onClick={() => player.addToQueue(source)}
                      >
                        <ListPlus aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={current ? "quiet-button" : "primary-button"}
                        aria-label={`${sourcePlaying ? "暫停" : current ? "繼續播放" : "播放"} ${displayName}`}
                        onClick={() => {
                          if (sourcePlaying) player.pause();
                          else void player.play(source);
                        }}
                      >
                        {sourcePlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                        {sourcePlaying ? "暫停" : current ? "繼續" : "播放"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="audio-library-empty"><Search aria-hidden="true" /><p>找不到符合的音檔。</p></div>
          )}

          {filteredSources.length > AUDIO_PAGE_SIZE && (
            <footer className="audio-library-pagination" aria-label="音檔清單分頁">
              <button
                type="button"
                className="quiet-button"
                disabled={activePage === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft aria-hidden="true" />上一頁
              </button>
              <span>第 {activePage} / {pageCount} 頁</span>
              <button
                type="button"
                className="quiet-button"
                disabled={activePage === pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                下一頁<ChevronRight aria-hidden="true" />
              </button>
            </footer>
          )}
        </section>

        <aside className="paper-card audio-up-next" aria-labelledby="audio-up-next-heading">
          <header>
            <span><ListMusic aria-hidden="true" /></span>
            <div>
              <small>PLAY NEXT</small>
              <h2 id="audio-up-next-heading">待播清單</h2>
            </div>
            {player.queue.length > 0 && <strong>{player.queue.length}</strong>}
          </header>

          <label className="audio-continuous-toggle">
            <span>
              <strong>接續播放</strong>
              <small>開啟後依待播、隨機或章節順序繼續</small>
            </span>
            <input
              type="checkbox"
              checked={player.continuousPlay}
              onChange={(event) => player.setContinuousPlay(event.target.checked)}
            />
          </label>

          <label className="audio-sleep-timer">
            <span><Clock3 aria-hidden="true" /><strong>睡眠計時</strong></span>
            <select
              className="field-control"
              value={player.sleepTimer ?? ""}
              aria-label="睡眠計時"
              onChange={(event) => player.setSleepTimer(
                event.target.value === "chapter-end"
                  ? "chapter-end"
                  : event.target.value
                    ? Number(event.target.value) as 15 | 30 | 45 | 60
                    : null,
              )}
            >
              <option value="">關閉</option>
              <option value="chapter-end">本章播完</option>
              <option value="15">15 分鐘</option>
              <option value="30">30 分鐘</option>
              <option value="45">45 分鐘</option>
              <option value="60">60 分鐘</option>
            </select>
          </label>

          <section className="audio-custom-playlists" aria-labelledby="audio-custom-playlists-heading">
            <header>
              <div>
                <small>CUSTOM PLAYLISTS</small>
                <h3 id="audio-custom-playlists-heading">自訂播放清單</h3>
              </div>
              <span>{playlistStorageLabel}</span>
            </header>

            <form
              className="audio-playlist-create"
              onSubmit={(event) => {
                event.preventDefault();
                setPlaylistNotice("");
                void customPlaylists.create(newPlaylistName)
                  .then((created) => {
                    setActivePlaylistId(created.id);
                    setPlaylistPage(1);
                    setNewPlaylistName("");
                    setPlaylistNotice(`已建立「${created.name}」。`);
                  })
                  .catch((error: unknown) => setPlaylistNotice(
                    error instanceof Error ? error.message : "無法建立播放清單。",
                  ));
              }}
            >
              <label>
                <span className="sr-only">新播放清單名稱</span>
                <input
                  className="field-control"
                  value={newPlaylistName}
                  maxLength={60}
                  placeholder="新增播放清單"
                  disabled={playlistBusy}
                  onChange={(event) => setNewPlaylistName(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="icon-button"
                aria-label="建立自訂播放清單"
                disabled={playlistBusy || !newPlaylistName.trim()}
              >
                <FolderPlus aria-hidden="true" />
              </button>
            </form>

            {activePlaylist ? (
              <div className="audio-playlist-editor">
                <label className="audio-playlist-picker">
                  <span>目前清單</span>
                  <select
                    className="field-control"
                    value={activePlaylist.id}
                    disabled={playlistBusy}
                    onChange={(event) => {
                      setActivePlaylistId(event.target.value);
                      setPlaylistPage(1);
                      setRenameDraft(null);
                    }}
                  >
                    {customPlaylists.playlists.map((playlist) => (
                      <option key={playlist.id} value={playlist.id}>
                        {playlist.name}（{playlist.itemIds.length}）
                      </option>
                    ))}
                  </select>
                </label>

                <form
                  className="audio-playlist-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const nextName = renameDraft?.id === activePlaylist.id
                      ? renameDraft.value
                      : activePlaylist.name;
                    setPlaylistNotice("");
                    void customPlaylists.rename(activePlaylist.id, nextName)
                      .then((saved) => {
                        setRenameDraft(null);
                        setPlaylistNotice(`已將清單改名為「${saved.name}」。`);
                      })
                      .catch((error: unknown) => setPlaylistNotice(
                        error instanceof Error ? error.message : "無法重新命名播放清單。",
                      ));
                  }}
                >
                  <PencilLine aria-hidden="true" />
                  <label>
                    <span className="sr-only">播放清單名稱</span>
                    <input
                      className="field-control"
                      value={renameDraft?.id === activePlaylist.id ? renameDraft.value : activePlaylist.name}
                      maxLength={60}
                      disabled={playlistBusy}
                      onChange={(event) => setRenameDraft({ id: activePlaylist.id, value: event.target.value })}
                    />
                  </label>
                  <button
                    type="submit"
                    className="icon-button"
                    aria-label="儲存播放清單名稱"
                    disabled={playlistBusy || !(renameDraft?.id === activePlaylist.id && renameDraft.value.trim())}
                  >
                    <Save aria-hidden="true" />
                  </button>
                </form>

                <div className="audio-playlist-toolbar">
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={playlistBusy || activePlaylistItems.every((item) => !item.source)}
                    onClick={() => playSequence(
                      activePlaylistItems.map((item) => item.source).filter((source): source is AudioSummarySource => Boolean(source)),
                      `「${activePlaylist.name}」`,
                    )}
                  >
                    <Play aria-hidden="true" />播放清單
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={playlistBusy || activePlaylistItems.every((item) => !item.source)}
                    onClick={() => playSequence(
                      activePlaylistItems.map((item) => item.source).filter((source): source is AudioSummarySource => Boolean(source)),
                      `「${activePlaylist.name}」`,
                      true,
                    )}
                  >
                    <Shuffle aria-hidden="true" />隨機播放
                  </button>
                  <button
                    type="button"
                    className="danger-text-button"
                    disabled={playlistBusy}
                    onClick={() => {
                      if (!window.confirm(`要刪除「${activePlaylist.name}」嗎？`)) return;
                      setPlaylistNotice("");
                      void customPlaylists.remove(activePlaylist.id)
                        .then(() => {
                          setActivePlaylistId("");
                          setPlaylistPage(1);
                          setRenameDraft(null);
                          setPlaylistNotice("已刪除播放清單。");
                        })
                        .catch((error: unknown) => setPlaylistNotice(
                          error instanceof Error ? error.message : "無法刪除播放清單。",
                        ));
                    }}
                  >
                    <Trash2 aria-hidden="true" />刪除
                  </button>
                </div>

                {activePlaylistItems.length > 0 ? (
                  <ol className="audio-playlist-items">
                    {visiblePlaylistItems.map(({ id, source }, index) => {
                      const absoluteIndex = playlistPageStart + index;
                      return (
                        <li key={id}>
                          <span>{String(absoluteIndex + 1).padStart(2, "0")}</span>
                          <span>
                            <strong>{source ? audioSummaryDisplayName(source) : "已無法使用的音檔"}</strong>
                            <small>{source ? formatDuration(source.durationSeconds) : id}</small>
                          </span>
                          <div className="audio-playlist-item-actions">
                            <button
                              type="button"
                              aria-label="往前移"
                              disabled={playlistBusy || absoluteIndex === 0}
                              onClick={() => void customPlaylists.moveItem(activePlaylist.id, id, -1).catch((error: unknown) => (
                                setPlaylistNotice(error instanceof Error ? error.message : "無法調整順序。")
                              ))}
                            ><ChevronUp aria-hidden="true" /></button>
                            <button
                              type="button"
                              aria-label="往後移"
                              disabled={playlistBusy || absoluteIndex === activePlaylist.itemIds.length - 1}
                              onClick={() => void customPlaylists.moveItem(activePlaylist.id, id, 1).catch((error: unknown) => (
                                setPlaylistNotice(error instanceof Error ? error.message : "無法調整順序。")
                              ))}
                            ><ChevronDown aria-hidden="true" /></button>
                            <button
                              type="button"
                              aria-label={`從自訂播放清單移除 ${source?.chapterLabel ?? id}`}
                              disabled={playlistBusy}
                              onClick={() => void customPlaylists.removeItem(activePlaylist.id, id).catch((error: unknown) => (
                                setPlaylistNotice(error instanceof Error ? error.message : "無法移除音檔。")
                              ))}
                            ><Trash2 aria-hidden="true" /></button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="audio-playlist-empty">從左側章節清單加入想收藏的音檔。</p>
                )}
                {playlistPageCount > 1 && (
                  <div className="audio-playlist-pagination" aria-label="自訂播放清單分頁">
                    <button
                      type="button"
                      aria-label="上一頁自訂播放清單"
                      disabled={activePlaylistPage === 1}
                      onClick={() => setPlaylistPage((value) => Math.max(1, value - 1))}
                    ><ChevronLeft aria-hidden="true" /></button>
                    <span>{activePlaylistPage} / {playlistPageCount}</span>
                    <button
                      type="button"
                      aria-label="下一頁自訂播放清單"
                      disabled={activePlaylistPage === playlistPageCount}
                      onClick={() => setPlaylistPage((value) => Math.min(playlistPageCount, value + 1))}
                    ><ChevronRight aria-hidden="true" /></button>
                  </div>
                )}
              </div>
            ) : customPlaylists.status !== "loading" ? (
              <p className="audio-playlist-empty">建立第一份清單後，即可逐集加入想複習的內容。</p>
            ) : null}

          </section>

          {player.queue.length > 0 ? (
            <>
              <div className="audio-queue-heading">
                <span>接下來播放</span>
                <button type="button" className="text-action" onClick={player.clearQueue}>清空</button>
              </div>
              <ol className="audio-queue-list">
                {visibleQueue.map((source, index) => {
                  const absoluteIndex = queuePageStart + index;
                  return (
                    <li key={source.id}>
                      <button
                        type="button"
                        className="audio-queue-title"
                        onClick={() => void player.play(source)}
                      >
                        <span>{String(absoluteIndex + 1).padStart(2, "0")}</span>
                        <span>
                          <strong>{audioSummaryDisplayName(source)}</strong>
                          <small>{formatDuration(source.durationSeconds)}</small>
                        </span>
                        <Play aria-hidden="true" />
                      </button>
                      <div className="audio-queue-actions" aria-label={`${audioSummaryDisplayName(source)} 清單位置`}>
                        <button
                          type="button"
                          aria-label="往前移"
                          disabled={absoluteIndex === 0}
                          onClick={() => player.moveQueueItem(source.id, -1)}
                        ><ChevronUp aria-hidden="true" /></button>
                        <button
                          type="button"
                          aria-label="往後移"
                          disabled={absoluteIndex === player.queue.length - 1}
                          onClick={() => player.moveQueueItem(source.id, 1)}
                        ><ChevronDown aria-hidden="true" /></button>
                        <button
                          type="button"
                          aria-label={`從待播清單移除 ${audioSummaryDisplayName(source)}`}
                          onClick={() => player.removeFromQueue(source.id)}
                        ><Trash2 aria-hidden="true" /></button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {queuePageCount > 1 && (
                <div className="audio-queue-pagination" aria-label="待播清單分頁">
                  <button
                    type="button"
                    aria-label="上一頁待播清單"
                    disabled={activeQueuePage === 1}
                    onClick={() => setQueuePage((value) => Math.max(1, value - 1))}
                  ><ChevronLeft aria-hidden="true" /></button>
                  <span>{activeQueuePage} / {queuePageCount}</span>
                  <button
                    type="button"
                    aria-label="下一頁待播清單"
                    disabled={activeQueuePage === queuePageCount}
                    onClick={() => setQueuePage((value) => Math.min(queuePageCount, value + 1))}
                  ><ChevronRight aria-hidden="true" /></button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="audio-queue-empty">從章節清單加入想依序聆聽的內容。</p>
              {player.current && sequentialNext.length > 0 && (
                <>
                  <div className="audio-queue-heading"><span>接著聽</span></div>
                  <ol className="audio-sequential-list">
                    {sequentialNext.map((source, index) => (
                      <li key={source.id}>
                        <button type="button" onClick={() => void player.play(source)}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <span>
                            <strong>{audioSummaryDisplayName(source)}</strong>
                            <small>{formatDuration(source.durationSeconds)}</small>
                          </span>
                          <Play aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </>
          )}
        </aside>
      </div>
      <AudioPlaylistDestinationPicker
        key={playlistPickerSource?.id ?? "closed"}
        open={Boolean(playlistPickerSource)}
        sourceId={playlistPickerSource?.id ?? ""}
        sourceLabel={playlistPickerSource ? audioSummaryDisplayName(playlistPickerSource) : ""}
        playlists={customPlaylists.playlists}
        busy={playlistBusy || Boolean(playlistPickerPending)}
        pendingId={playlistPickerPending}
        error={playlistPickerError}
        triggerRef={playlistAddTriggerRef}
        onClose={() => {
          if (playlistPickerPending) return;
          setPlaylistPickerSource(null);
          setPlaylistPickerError("");
        }}
        onSelect={(playlist) => {
          if (playlistPickerSource) {
            void addSourceToPlaylist(playlist.id, playlist.name, playlistPickerSource);
          }
        }}
        onCreate={(name) => {
          const source = playlistPickerSource;
          if (!source || playlistPickerPending) return;
          setPlaylistPickerPending("create");
          setPlaylistPickerError("");
          void customPlaylists.create(name, [source.id])
            .then((created) => {
              setActivePlaylistId(created.id);
              setPlaylistNotice(`已建立「${created.name}」並加入 ${audioSummaryDisplayName(source)}。`);
              setPlaylistPickerSource(null);
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "無法建立播放清單。";
              setPlaylistPickerError(message);
              setPlaylistNotice(message);
            })
            .finally(() => setPlaylistPickerPending(""));
        }}
      />
    </main>
  );
}
