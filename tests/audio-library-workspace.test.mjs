import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const [catalogSource, view, reader, boardGuide, tintinalliGuide, rosensGuide, supplementalGuide, emsGuide, ailsGuide, learningAudio, sourceRegistry, provider, layout, css] = await Promise.all([
  readFile(new URL("../app/lib/audio-summaries.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/views/audio-library-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/reader-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/board-textbook-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/rosens-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/supplemental-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ems-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ails-guide-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/hooks/use-learning-audio.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/learning-source-registry.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/audio-player-provider.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/site.css", import.meta.url), "utf8"),
]);

const executableCatalog = stripTypeScriptTypes(catalogSource, { mode: "strip" });

const runtimeEntries = [
  {
    id: "tintinalli-001",
    collectionId: "tintinalli",
    collectionTitle: "Tintinalli's Emergency Medicine",
    kind: "textbook-chapter",
    sequence: 1,
    textbook: "tintinalli",
    chapterId: "001",
    chapterLabel: "CH.001",
    title: "Prehospital Care",
    file: "releases/aaaaaaaaaaaa/Tintinalli_CH001_Prehospital Care",
    durationSeconds: 700,
    encodedSpeed: 1.4,
    revision: "aaaaaaaaaaaa",
    dataBytes: 9000,
    dataSha256: "6".repeat(64),
    metadataBytes: 900,
    metadataSha256: "a".repeat(64),
  },
  {
    id: "goldfrank-001",
    collectionId: "goldfrank",
    collectionTitle: "Goldfrank's Toxicologic Emergencies",
    kind: "textbook-chapter",
    sequence: 1,
    textbook: "goldfrank",
    chapterId: "001",
    chapterLabel: "CH.001",
    title: "Historical Principles and Perspectives",
    file: "releases/bbbbbbbbbbbb/goldfrank-CH001",
    durationSeconds: 680,
    encodedSpeed: 1.4,
    revision: "bbbbbbbbbbbb",
    dataBytes: 9500,
    dataSha256: "b".repeat(64),
    metadataBytes: 950,
    metadataSha256: "c".repeat(64),
  },
  {
    id: "rosens-001",
    collectionId: "rosens",
    collectionTitle: "Rosen's Emergency Medicine",
    kind: "textbook-chapter",
    sequence: 1,
    textbook: "rosens",
    chapterId: "001",
    chapterLabel: "CH.001",
    title: "Airway",
    file: "releases/111111111111/Rosens_CH001_Airway",
    durationSeconds: 900,
    encodedSpeed: 1.4,
    revision: "111111111111",
    dataBytes: 1000,
    dataSha256: "a".repeat(64),
    metadataBytes: 100,
    metadataSha256: "b".repeat(64),
  },
  {
    id: "rosens-002",
    collectionId: "rosens",
    collectionTitle: "Rosen's Emergency Medicine",
    kind: "textbook-chapter",
    sequence: 2,
    textbook: "rosens",
    chapterId: "002",
    chapterLabel: "CH.002",
    title: "Mechanical Ventilation",
    file: "releases/222222222222/Rosens_CH002_Mechanical Ventilation",
    durationSeconds: 840,
    encodedSpeed: 1.4,
    revision: "222222222222",
    dataBytes: 2000,
    dataSha256: "c".repeat(64),
    metadataBytes: 200,
    metadataSha256: "d".repeat(64),
  },
  {
    id: "rosens-003",
    collectionId: "rosens",
    collectionTitle: "Rosen's Emergency Medicine",
    kind: "textbook-chapter",
    sequence: 3,
    textbook: "rosens",
    chapterId: "003",
    chapterLabel: "CH.003",
    title: "Shock",
    file: "releases/333333333333/Rosens_CH003_Shock",
    durationSeconds: 780,
    encodedSpeed: 1.4,
    revision: "333333333333",
    dataBytes: 3000,
    dataSha256: "e".repeat(64),
    metadataBytes: 300,
    metadataSha256: "f".repeat(64),
  },
  {
    id: "rosens-004",
    collectionId: "rosens",
    collectionTitle: "Rosen's Emergency Medicine",
    kind: "textbook-chapter",
    sequence: 4,
    textbook: "rosens",
    chapterId: "004",
    chapterLabel: "CH.004",
    title: "Brain Resuscitation",
    file: "releases/444444444444/Rosens_CH004_Brain Resuscitation",
    durationSeconds: 720,
    encodedSpeed: 1.4,
    revision: "444444444444",
    dataBytes: 4000,
    dataSha256: "1".repeat(64),
    metadataBytes: 400,
    metadataSha256: "2".repeat(64),
  },
  {
    id: "rosens-193",
    collectionId: "rosens",
    collectionTitle: "Rosen's Emergency Medicine",
    kind: "textbook-chapter",
    sequence: 193,
    textbook: "rosens",
    chapterId: "193",
    chapterLabel: "CH.193",
    title: "Global Emergency Medicine",
    file: "releases/555555555555/Rosens_CH193_Global Emergency Medicine",
    durationSeconds: 760,
    encodedSpeed: 1.4,
    revision: "555555555555",
    dataBytes: 5000,
    dataSha256: "3".repeat(64),
    metadataBytes: 500,
    metadataSha256: "4".repeat(64),
  },
  {
    id: "rosens-208",
    collectionId: "rosens",
    collectionTitle: "Rosen's Emergency Medicine",
    kind: "textbook-chapter",
    sequence: 208,
    textbook: "rosens",
    chapterId: "208",
    chapterLabel: "CH.208",
    title: "Tactical Emergency Medical Support and Urban Search and Rescue",
    file: "releases/666666666666/Rosens_CH208_Tactical Emergency Medical Support",
    durationSeconds: 820,
    encodedSpeed: 1.4,
    revision: "666666666666",
    dataBytes: 6000,
    dataSha256: "5".repeat(64),
    metadataBytes: 600,
    metadataSha256: "6".repeat(64),
  },
  {
    id: "questions-115b_q001-q005",
    collectionId: "questions",
    collectionTitle: "Emergency Board Questions",
    kind: "question-set",
    sequence: 1,
    textbook: "question_bank",
    chapterId: "115B_Q001-Q005",
    chapterLabel: "115B Q.001–005",
    title: "Question Review",
    file: "releases/777777777777/115B_Q001-Q005_Question Review",
    durationSeconds: 640,
    encodedSpeed: 1.4,
    revision: "777777777777",
    dataBytes: 7000,
    dataSha256: "7".repeat(64),
    metadataBytes: 700,
    metadataSha256: "8".repeat(64),
    questionExam: "115B",
    questionStart: 1,
    questionEnd: 5,
  },
  {
    id: "board-guide-1a",
    collectionId: "board-guides",
    collectionTitle: "題庫學習指引",
    kind: "textbook-chapter",
    sequence: 1,
    textbook: "board",
    chapterId: "1A",
    chapterLabel: "單元 1A",
    title: "救命的生理邏輯",
    file: "releases/888888888888/board_guide_1A_救命的生理邏輯",
    durationSeconds: 1200,
    encodedSpeed: 1.4,
    revision: "888888888888",
    dataBytes: 8000,
    dataSha256: "9".repeat(64),
    metadataBytes: 800,
    metadataSha256: "0".repeat(64),
  },
];
const runtimeCatalogRevision = createHash("sha256")
  .update(JSON.stringify(runtimeEntries))
  .digest("hex")
  .slice(0, 20);

test("audio catalog stays out of the app bundle and hydrates at runtime", async () => {
  assert.match(catalogSource, /export const audioSummaries: AudioSummarySource\[\] = \[\];/u);
  assert.doesNotMatch(catalogSource, /id:\s*["']rosens-/u);
  assert.match(catalogSource, /fetch\("\/audio\/snac\/catalog\.json", \{ cache: "no-cache" \}\)/u);
  assert.match(catalogSource, /typeof source\.revision === "string"/u);
  assert.match(catalogSource, /\^\[a-f0-9\]\{12,64\}\$/u);

  globalThis.__audioCatalogFixture = runtimeEntries;
  globalThis.__audioCatalogRequests = [];
  const catalogHarness = `
const window = {};
const fetch = async (url, init) => {
  globalThis.__audioCatalogRequests.push({ url, init });
  return {
    ok: true,
    async json() {
      return {
        schema: "em-board-audio-catalog-v2",
        catalogRevision: "${runtimeCatalogRevision}",
        itemCount: globalThis.__audioCatalogFixture.length,
        entries: globalThis.__audioCatalogFixture,
      };
    },
  };
};
${executableCatalog}
`;
  const catalogUrl = `data:text/javascript;base64,${Buffer.from(catalogHarness).toString("base64")}`;

  try {
    const catalog = await import(`${catalogUrl}#runtime-${Date.now()}`);
    assert.deepEqual(catalog.audioSummaries, []);
    assert.deepEqual(await catalog.loadAudioSummaryCatalog(), runtimeEntries);
    assert.deepEqual(await catalog.loadAudioSummaryCatalog(), runtimeEntries);
    assert.deepEqual(globalThis.__audioCatalogRequests, [{
      url: "/audio/snac/catalog.json",
      init: { cache: "no-cache" },
    }]);
    assert.equal(catalog.audioSummaryForId("rosens-002")?.revision, "222222222222");
    assert.equal(catalog.audioSummaryForTintinalliChapter(1)?.id, "tintinalli-001");
    assert.equal(catalog.audioSummaryForLearningResource({ kind: "textbook-chapter", textbookId: "tintinalli", chapterId: 1 })?.id, "tintinalli-001");
    assert.equal(catalog.audioSummaryForLearningResource({ kind: "textbook-chapter", textbookId: "goldfrank", chapterId: "001" })?.id, "goldfrank-001");
    assert.equal(catalog.audioSummaryForLearningResource({ kind: "question", questionId: "115B-Q003" })?.id, "questions-115b_q001-q005");
    assert.equal(catalog.audioSummaryForRosensChapter("e01")?.id, "rosens-193");
    assert.equal(catalog.audioSummaryForRosensChapter("e1")?.id, "rosens-193");
    assert.equal(catalog.audioSummaryForRosensChapter("e16")?.id, "rosens-208");
    assert.equal(catalog.audioSummaryForRosensChapter("e17"), null);
    assert.equal(catalog.audioSummaryForQuestion("115B-Q003")?.id, "questions-115b_q001-q005");
    assert.equal(catalog.audioSummaryForQuestion("115b-q005")?.id, "questions-115b_q001-q005");
    assert.equal(catalog.audioSummaryForQuestion("115B-Q006"), null);
    assert.equal(catalog.audioSummaryForQuestion("115A-Q003"), null);
    const questionAudio = catalog.audioSummaryForId("questions-115b_q001-q005");
    assert.equal(catalog.audioSummaryDisplayMarker(questionAudio), "題庫");
    assert.equal(catalog.audioSummaryDisplayTitle(questionAudio), "115B · Q001–005");
    assert.equal(catalog.audioSummaryDisplayName(questionAudio), "115B · Q001–005");
    assert.equal(catalog.audioSummaryForBoardGuideUnit("1a")?.id, "board-guide-1a");
    assert.equal(catalog.audioSummaryForBoardGuideUnit("2B"), null);
    assert.equal(catalog.randomAudioSummary("rosens-002")?.collectionId, "rosens");
    assert.equal(catalog.randomAudioSummary("questions-115b_q001-q005"), null);
    assert.equal(catalog.adjacentAudioSummary("rosens-002", -1)?.id, "rosens-001");
    assert.equal(catalog.adjacentAudioSummary("rosens-002", 1)?.id, "rosens-003");
    assert.equal(catalog.adjacentAudioSummary("rosens-001", -1), null);
    assert.equal(catalog.adjacentAudioSummary("rosens-004", 1)?.id, "rosens-193");
    assert.deepEqual(
      catalog.upcomingAudioSummaries("rosens-002", 2).map((source) => source.id),
      ["rosens-003", "rosens-004"],
    );
  } finally {
    delete globalThis.__audioCatalogFixture;
    delete globalThis.__audioCatalogRequests;
  }
});

test("question explanations expose the matching five-question audio item", () => {
  assert.match(reader, /useLearningAudio\(\{/u);
  assert.match(reader, /resource: question \? \{ kind: "question", questionId: question\.id \} : null/u);
  assert.match(learningAudio, /if \(catalogReady \|\| !contentReady \|\| !resource\) return;[\s\S]*?loadAudioSummaryCatalog\(\)/u);
  assert.match(learningAudio, /audioSummaryForLearningResource\(resource\)/u);
  assert.match(reader, /className="reading-toolbar-audio"/u);
  assert.match(reader, /<small>本題組音檔<\/small>/u);
  assert.match(learningAudio, /if \(currentSourceId === source\.id\) openPlayer\(\);\s*else void loadSource\(source\);/u);
  assert.doesNotMatch(reader, /\.srt\b|字幕時間/u);
});

test("board learning-guide units expose their matching SNAC audio", () => {
  assert.match(catalogSource, /audioSummaryForBoardGuideUnit/u);
  assert.match(boardGuide, /resource: selectedUnit \? \{ kind: "board-unit", unitCode: selectedUnit\.unitCode \} : null/u);
  assert.match(boardGuide, /useLearningAudio\(\{/u);
  assert.match(boardGuide, /className="reading-toolbar-audio"/u);
  assert.match(boardGuide, /className="guide-audio-action"/u);
});

test("Tintinalli and future learning readers attach audio by stable resource identity", () => {
  assert.match(catalogSource, /type LearningAudioLocator/u);
  assert.match(catalogSource, /readers never infer attachment from a display name/u);
  assert.match(catalogSource, /audioSummaryForLearningResource/u);
  assert.match(tintinalliGuide, /resource: \{ kind: "textbook-chapter", textbookId: "tintinalli", chapterId: selectedId \}/u);
  assert.match(tintinalliGuide, /audioAction=\{selectedAudio \? \(/u);
  assert.match(tintinalliGuide, /<small>學習音檔<\/small>/u);
  for (const learningReader of [rosensGuide, supplementalGuide, emsGuide, ailsGuide]) {
    assert.match(learningReader, /useLearningAudio\(\{/u);
    assert.match(learningReader, /audioAction=\{selectedAudio \? \(/u);
  }
  assert.match(supplementalGuide, /normalizeTextbookAudioSectionId\(textbookId, String\(selectedEntry\.section\)\)/u);
  assert.match(learningAudio, /const prepare = useCallback\(\(\) => \{[\s\S]*?prepareShell\(\);\s*prepareDecoder\(\);\s*if \(!primeSource\(source\)\) prefetchSource\(source\);/u);
  assert.doesNotMatch(learningAudio, /requestIdleCallback|prepareDecoder\(\);[\s\S]*?useEffect/u);
});

test("audio library delegates transport to one global player", () => {
  assert.equal((layout.match(/<AudioPlayerProvider>/gu) ?? []).length, 1);
  assert.match(view, /\{sources\.length > 0 && \([\s\S]*?aria-label=\{`共 \$\{sources\.length\} 集`\}[\s\S]*?<strong>\{sources\.length\}<\/strong><span>集<\/span>/u);
  assert.doesNotMatch(view, /<p><strong>\{sources\.length\}<\/strong><span>集<\/span><\/p>/u);
  assert.match(view, /const player = useAudioPlayer\(\)/u);
  assert.doesNotMatch(view, /preparePlayer\(\)/u);
  assert.match(view, /loadAudioSummaryCatalog\(\)\.then/u);
  assert.match(view, /currentAudioSummaryCatalogError\(\)/u);
  assert.match(view, /setCatalogAttempt\(\(value\) => value \+ 1\)/u);
  assert.match(view, /音檔目錄暫時無法載入/u);
  assert.match(view, /className="paper-card audio-library-session"/u);
  assert.match(view, /onClick=\{player\.openPlayer\}/u);
  assert.match(view, /player\.addToQueue\(source\)/u);
  assert.match(view, /player\.moveQueueItem\(source\.id, -1\)/u);
  assert.match(view, /player\.moveQueueItem\(source\.id, 1\)/u);
  assert.match(view, /player\.removeFromQueue\(source\.id\)/u);
  assert.match(view, /onClick=\{player\.clearQueue\}/u);
  assert.match(view, /player\.setSleepTimer/u);
  assert.match(view, /checked=\{player\.continuousPlay\}/u);
  assert.match(view, /className="paper-card audio-up-next"/u);
  assert.match(view, /type="search"/u);
  assert.match(view, /const AUDIO_PAGE_SIZE = 24/u);
  assert.match(view, /const pageStart = \(activePage - 1\) \* AUDIO_PAGE_SIZE/u);
  assert.match(view, /filteredSources\.slice\(pageStart, pageStart \+ AUDIO_PAGE_SIZE\)/u);
  assert.match(view, /className="audio-library-pagination"/u);
  assert.match(view, /className="audio-collection-shelf"/u);
  assert.match(view, /learningSourceForAudioLibrary\(collection\.id\)/u);
  assert.match(sourceRegistry, /tintinalli:[\s\S]*?mark: "T"[\s\S]*?audioKicker: "TINTINALLI · 9E"/u);
  assert.match(sourceRegistry, /rosens:[\s\S]*?mark: "R"[\s\S]*?audioKicker: "ROSEN’S · 10E"/u);
  assert.match(sourceRegistry, /board:[\s\S]*?mark: "指"[\s\S]*?audioKicker: "BOARD GUIDE"/u);
  assert.match(sourceRegistry, /questions:[\s\S]*?mark: "Q"[\s\S]*?audioKicker: "BOARD REVIEW"/u);
  assert.match(view, /function AudioCollectionCard/u);
  assert.match(view, /audio-collection-card audio-collection-/u);
  assert.match(view, /audio-collection-mark/u);
  assert.doesNotMatch(view, /aria-label="篩選音檔收藏"/u);
  assert.doesNotMatch(view, /<option value="all">全部收藏<\/option>/u);
  assert.match(view, /const \[questionExam, setQuestionExam\] = useState\("all"\)/u);
  assert.match(view, /const showQuestionExamFilter = selectedCollection\?\.kind === "question-set"/u);
  assert.match(view, /\{showQuestionExamFilter && \(/u);
  assert.match(view, /source\.questionExam !== questionExam/u);
  assert.match(view, /aria-label="依歷屆考題年度篩選"/u);
  assert.match(view, /全部題庫年度/u);
  assert.match(view, /questionExamLabel\(exam\)/u);
  assert.match(view, /const showTextbookSectionFilter = textbookSections\.length > 0/u);
  assert.match(view, /\{showTextbookSectionFilter && \(/u);
  assert.match(view, /textbookAudioSectionForSource\(source\)\?\.id !== textbookSectionId/u);
  assert.match(view, /搜尋章節、年度或題號/u);
  assert.match(view, /audioSummaryDisplayMarker\(source\)/u);
  assert.match(view, /audioSummaryDisplayTitle\(source\)/u);
  assert.match(view, /audioSummaryDisplayName\(source\)/u);
  assert.match(view, /source\.kind === "question-set" \? "is-question-set" : ""/u);
  assert.doesNotMatch(view, /<strong>\{source\.title\}<\/strong>/u);
  assert.doesNotMatch(view, /const preparePlayer = player\.prepare|preparePlayer\(\)/u);
  assert.doesNotMatch(view, /顯示更多音檔/u);
  assert.doesNotMatch(view, /audio-now-playing|player\.playPrevious|player\.playNext|player\.seek\(/u);
  assert.doesNotMatch(view, /<audio\b|<AudioPlayerProvider/u);
});

test("global player restores runtime catalog state without blocking homepage startup", () => {
  assert.match(provider, /continuousPlay\?: boolean/u);
  assert.match(provider, /queueIds\?: string\[\]/u);
  assert.match(provider, /randomReview\?: boolean/u);
  assert.match(provider, /void loadAudioSummaryCatalog\(\)\.then/u);
  assert.match(provider, /if \(!currentStored && !legacyStored\) return null;/u);
  assert.match(provider, /normalizeStoredPlayerState\(JSON\.parse/u);
  assert.match(provider, /QUESTION_BANK_READY_EVENT/u);
  const restoreStart = provider.indexOf("const restorePersistedPlayer");
  const restoreEnd = provider.indexOf("useEffect(() => {\n    if (!current) return;", restoreStart);
  const restoreEffect = provider.slice(restoreStart, restoreEnd);
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  assert.doesNotMatch(restoreEffect, /preparePlayer\(\)|prepareShell\(\)|prefetchAudioSource\(/u);
  assert.match(provider, /function plannedNextSource\(\) \{[\s\S]*?audioSummaryForId\(queueIdsRef\.current\[0\]\)[\s\S]*?randomReviewRef\.current[\s\S]*?adjacentAudioSummary/u);
  assert.match(provider, /void playNextSource\(\)/u);
  assert.match(provider, /const queued = audioSummaryForId\(queueIdsRef\.current\[0\]\)/u);
  assert.match(provider, /\["previoustrack"/u);
  assert.match(provider, /\["nexttrack"/u);
  assert.match(provider, /stored\.continuousPlay !== false/u);
  assert.match(provider, /randomReviewRef\.current = Boolean\(stored\.randomReview\)/u);
  assert.doesNotMatch(provider, /requestIdleCallback/u);
  assert.match(provider, /const preparePlayer = useCallback/u);
});

test("documents and audio use the full workspace and responsive columns", () => {
  assert.match(css, /\.audio-library-page,\s*\.learning-documents-page\s*\{\s*max-width: var\(--site-max\)/u);
  assert.match(css, /\.audio-library-workspace\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/u);
  assert.match(css, /\.audio-library-catalog\s*\{[^}]*flex: 2\.5 1 760px;/u);
  assert.match(css, /\.audio-up-next\s*\{[^}]*flex: 1 1 300px;/u);
  assert.match(css, /@media \(max-width: 840px\)[\s\S]*?\.audio-library-catalog,\s*\.audio-up-next\s*\{[^}]*flex-basis: 100%/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.audio-library-tools > select\s*\{[^}]*flex: 0 0 auto;[^}]*max-width: none;[^}]*min-width: 0;[^}]*min-height: 44px;[^}]*width: 100%;/u);
  assert.match(css, /\.audio-collection-tintinalli\s*\{[^}]*--audio-collection-color: var\(--site-guide-tintinalli\)/u);
  assert.match(css, /\.audio-collection-rosens\s*\{[^}]*--audio-collection-color: var\(--site-guide-rosens\)/u);
  assert.match(css, /\.audio-collection-board\s*\{[^}]*--audio-collection-color: var\(--site-guide-board\)/u);
  assert.match(css, /\.audio-collection-card\.is-active\s*\{[^}]*background: color-mix\([^}]*border-color: color-mix\([^}]*box-shadow: none;/u);
  assert.doesNotMatch(css, /box-shadow:\s*inset 0 -3px 0 var\(--audio-collection-accent\)/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.audio-collection-shelf\s*\{[^}]*scroll-snap-type: inline mandatory;/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.audio-chapter-list > li\.is-question-set\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.audio-chapter-list > li\.is-question-set \.audio-chapter-number\s*\{[^}]*display: none;/u);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.audio-chapter-list > li\.is-question-set \.audio-chapter-actions\s*\{[^}]*grid-column: 1;/u);
  assert.match(view, /<section className="paper-card audio-library-catalog" aria-label="音檔目錄">/u);
  assert.doesNotMatch(view, /audio-catalog-heading|audio-library-book-mark/u);
  assert.doesNotMatch(css, /audio-library-catalog > header|audio-library-book-mark/u);
});
