import { parseReaderAnnotationScope } from "./annotation-source.ts";
import type { FullQuestion, QuestionIndex } from "./types";
import { fetchCompressedStatic } from "./compressed-static.ts";

export type ExplanationPackId = "original" | "concise";

export const explanationPacks: Array<{
  id: ExplanationPackId;
  label: string;
  shortLabel: string;
  detail: string;
}> = [
  {
    id: "concise",
    label: "精要詳解",
    shortLabel: "精要詳解",
    detail: "精簡重點，適合快速建立脈絡。",
  },
  {
    id: "original",
    label: "詳細詳解",
    shortLabel: "詳細詳解",
    detail: "保留完整推理、選項分析與延伸細節。",
  },
];

type ExplanationPackChunk = {
  schemaVersion: number;
  packId: "concise";
  exam: string;
  questionCount: number;
  explanations: Record<string, string>;
};

export type ResolvedExplanation = {
  markdown: string;
  requestedPackId: ExplanationPackId;
  resolvedPackId: ExplanationPackId;
  fallback: boolean;
};

const conciseChunkCache = new Map<string, Promise<ExplanationPackChunk>>();

function loadConciseChunk(exam: string) {
  if (!conciseChunkCache.has(exam)) {
    const request = fetchCompressedStatic(`/data/explanation-packs/concise/${exam}.json`, { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`找不到 ${exam} 精要詳解`);
        return response.json() as Promise<ExplanationPackChunk>;
      })
      .then((chunk) => {
        if (chunk.packId !== "concise" || chunk.exam !== exam || !chunk.explanations) {
          throw new Error(`${exam} 精要詳解格式錯誤`);
        }
        return chunk;
      })
      .catch((error: unknown) => {
        conciseChunkCache.delete(exam);
        throw error;
      });
    conciseChunkCache.set(exam, request);
  }
  return conciseChunkCache.get(exam)!;
}

export async function resolveExplanation(question: FullQuestion, requestedPackId: ExplanationPackId): Promise<ResolvedExplanation> {
  if (requestedPackId === "original") {
    return { markdown: question.explanation, requestedPackId, resolvedPackId: "original", fallback: false };
  }

  try {
    const chunk = await loadConciseChunk(question.exam);
    const markdown = chunk.explanations[question.id];
    if (!markdown?.trim()) throw new Error(`找不到 ${question.id} 精要詳解`);
    return { markdown, requestedPackId, resolvedPackId: "concise", fallback: false };
  } catch {
    return { markdown: question.explanation, requestedPackId, resolvedPackId: "original", fallback: true };
  }
}

export function prefetchQuestionExplanation(question: Pick<QuestionIndex, "exam">, packId: ExplanationPackId) {
  if (packId === "concise") void loadConciseChunk(question.exam).catch(() => undefined);
}

/** New Reader ids encode their pack; legacy h_/h_c_ ids retain their original meaning. */
export function annotationExplanationPack(annotationId?: string | null): ExplanationPackId | null {
  if (!annotationId?.startsWith("h_")) return null;
  const readerScope = parseReaderAnnotationScope(annotationId);
  if (readerScope) return readerScope.packId;
  return annotationId.startsWith("h_c_") ? "concise" : "original";
}

export function explanationPackLabel(packId: ExplanationPackId) {
  return explanationPacks.find((pack) => pack.id === packId)?.shortLabel ?? "詳細詳解";
}
