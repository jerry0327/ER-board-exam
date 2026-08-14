import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "../../../db";
import { attemptLog, progressResetState, questionProgress } from "../../../db/schema";
import { isChronologicallyOlder, scheduleReview } from "../../lib/review-schedule";
import { userIdentityFor } from "../user-identity";
import { privateJson } from "../private-response";

export const dynamic = "force-dynamic";

type ProgressAction = (
  | {
      action: "attempt";
      mutationId: string;
      questionId: string;
      selectedKeys: string[];
      correct: boolean | null;
      confidence: "low" | "normal" | "high";
      mode: "study" | "exam";
      attemptedAt?: string;
    }
  | { action: "bookmark"; questionId: string; value: boolean }
  | { action: "read"; questionId: string; value: "reading" | "done" | "later" | "unread" }
  | { action: "mastery"; questionId: string; value: "pending" | "mastered" | "none" }
) & { generation?: number };

type ResetType = "attempts" | "reading" | "bookmarks";
type ResetRequest = { mutationId: string; baseGeneration: number; types: ResetType[]; questionIds?: string[] };

const confidenceValues = new Set(["low", "normal", "high"]);
const modeValues = new Set(["study", "exam"]);
const readValues = new Set(["reading", "done", "later", "unread"]);
const masteryValues = new Set(["pending", "mastered", "none"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validQuestionId(value: unknown): value is string {
  return typeof value === "string" && /^\d{3}[AB]?-Q\d{3}$/.test(value);
}

function parseAction(value: unknown): ProgressAction | null {
  if (!isRecord(value) || !validQuestionId(value.questionId) || typeof value.action !== "string") return null;
  if (value.generation !== undefined && (!Number.isInteger(value.generation) || Number(value.generation) < 0)) return null;
  if (value.action === "attempt") {
    if (
      typeof value.mutationId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(value.mutationId) ||
      !Array.isArray(value.selectedKeys) || !value.selectedKeys.every((key) => typeof key === "string" && /^[A-F]$/.test(key)) ||
      !(typeof value.correct === "boolean" || value.correct === null) ||
      typeof value.confidence !== "string" || !confidenceValues.has(value.confidence) ||
      typeof value.mode !== "string" || !modeValues.has(value.mode)
    ) return null;
    if (value.attemptedAt !== undefined) {
      if (typeof value.attemptedAt !== "string") return null;
      const attemptedAt = Date.parse(value.attemptedAt);
      if (!Number.isFinite(attemptedAt) || attemptedAt < Date.now() - 366 * 86_400_000 || attemptedAt > Date.now() + 300_000) return null;
    }
    return value as ProgressAction;
  }
  if (value.action === "bookmark" && typeof value.value === "boolean") return value as ProgressAction;
  if (value.action === "read" && typeof value.value === "string" && readValues.has(value.value)) return value as ProgressAction;
  if (value.action === "mastery" && typeof value.value === "string" && masteryValues.has(value.value)) return value as ProgressAction;
  return null;
}

function parseReset(value: unknown): ResetRequest | null {
  if (!isRecord(value) || !Array.isArray(value.types)) return null;
  if (typeof value.mutationId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(value.mutationId)) return null;
  if (!Number.isInteger(value.baseGeneration) || Number(value.baseGeneration) < 0) return null;
  const allowed = new Set<ResetType>(["attempts", "reading", "bookmarks"]);
  const types = [...new Set(value.types)].filter((item): item is ResetType => typeof item === "string" && allowed.has(item as ResetType));
  if (!types.length || types.length !== value.types.length) return null;
  if (value.questionIds === undefined) return { mutationId: value.mutationId, baseGeneration: Number(value.baseGeneration), types };
  if (!Array.isArray(value.questionIds) || value.questionIds.length < 1 || value.questionIds.length > 4000 || !value.questionIds.every(validQuestionId)) return null;
  return { mutationId: value.mutationId, baseGeneration: Number(value.baseGeneration), types, questionIds: [...new Set(value.questionIds)] };
}

async function getProgress(userId: string, questionId: string) {
  const db = await getDb();
  const [progress] = await db
    .select()
    .from(questionProgress)
    .where(and(eq(questionProgress.userId, userId), eq(questionProgress.questionId, questionId)))
    .limit(1);
  return progress;
}

async function getResetGeneration(userId: string) {
  const db = await getDb();
  const [state] = await db.select().from(progressResetState).where(eq(progressResetState.userId, userId)).limit(1);
  return state ?? { userId, generation: 0, lastMutationId: null, updatedAt: null };
}

function publicProgress(row: typeof questionProgress.$inferSelect) {
  const { userId: _userId, generation: _generation, ...progress } = row;
  void _userId;
  void _generation;
  return progress;
}

function publicAttempt(row: typeof attemptLog.$inferSelect) {
  const {
    userId: _userId,
    generation: _generation,
    aggregateApplied: _aggregateApplied,
    ...attempt
  } = row;
  void _userId;
  void _generation;
  void _aggregateApplied;
  return attempt;
}

function isStaleGenerationError(error: unknown) {
  return error instanceof Error && error.message.includes("stale-progress-generation");
}

export async function GET(request: Request) {
  try {
    const identity = await userIdentityFor(request);
    if (!identity) return privateJson({ localOnly: true, progress: [], attempts: [] }, { status: 401 });
    const { userId, accountKey } = identity;
    const db = await getDb();
    const [progress, attempts, resetState] = await Promise.all([
      db.select().from(questionProgress).where(eq(questionProgress.userId, userId)),
      db
        .select()
        .from(attemptLog)
        .where(eq(attemptLog.userId, userId))
        .orderBy(desc(attemptLog.createdAt), desc(attemptLog.id))
        .limit(1000),
      getResetGeneration(userId),
    ]);
    return privateJson({
      accountKey,
      legacyAccountKey: identity.legacyAccountKey,
      resetGeneration: resetState.generation,
      progress: progress.map(publicProgress),
      attempts: attempts.map(publicAttempt),
    });
  } catch {
    return privateJson({ error: "無法載入學習進度，請再試一次。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "無法更新學習進度，請再試一次。" }, { status: 400 });
  }
  const body = parseAction(raw);
  if (!body) return Response.json({ error: "無法更新學習進度，請再試一次。" }, { status: 400 });

  try {
    const identity = await userIdentityFor(request);
    if (!identity) return Response.json({ localOnly: true }, { status: 401 });
    const { userId } = identity;
    const db = await getDb();
    await db.insert(progressResetState).values({
      userId,
      generation: 0,
      lastMutationId: null,
      updatedAt: new Date().toISOString(),
    }).onConflictDoNothing();
    const resetState = await getResetGeneration(userId);
    if ((body.generation ?? 0) !== resetState.generation) {
      return Response.json({ error: "學習進度已更新，請重新整理後再試。", resetGeneration: resetState.generation }, { status: 409 });
    }
    const now = new Date().toISOString();
    const existing = await getProgress(userId, body.questionId);
    const generation = body.generation ?? 0;

    if (body.action === "attempt") {
      const selectedKeys = [...new Set(body.selectedKeys)].sort();
      const answeredAt = body.attemptedAt ?? now;
      const [recordedAttempt] = await db.select({ aggregateApplied: attemptLog.aggregateApplied })
        .from(attemptLog)
        .where(and(eq(attemptLog.userId, userId), eq(attemptLog.mutationId, body.mutationId)))
        .limit(1);
      if (recordedAttempt?.aggregateApplied) {
        const current = await getProgress(userId, body.questionId);
        return Response.json({ progress: current ? publicProgress(current) : null });
      }

      const historicalAttempt = isChronologicallyOlder(existing?.lastAttemptAt ?? null, answeredAt);
      const [firstScoredAttempt] = await db
        .select({ correct: attemptLog.correct })
        .from(attemptLog)
        .where(and(
          eq(attemptLog.userId, userId),
          eq(attemptLog.questionId, body.questionId),
          isNotNull(attemptLog.correct),
        ))
        .orderBy(asc(attemptLog.createdAt), asc(attemptLog.id))
        .limit(1);

      const review = scheduleReview({
        previous: {
          streak: existing?.streak ?? 0,
          dueAt: existing?.dueAt ?? null,
          wrongState: existing?.wrongState === "pending" || existing?.wrongState === "mastered"
            ? existing.wrongState
            : "none",
        },
        correct: body.correct,
        confidence: body.confidence,
        answeredAt,
      });
      const firstAttemptCorrect = existing?.firstAttemptCorrect
        ?? firstScoredAttempt?.correct
        ?? (body.correct === null ? null : body.correct ? 1 : 0);

      const attemptUpdate = historicalAttempt
        ? {
            attempts: sql`${questionProgress.attempts} + 1`,
            correctAttempts: sql`${questionProgress.correctAttempts} + ${body.correct === true ? 1 : 0}`,
            firstAttemptCorrect,
            generation,
            updatedAt: now,
          }
        : {
            attempts: sql`${questionProgress.attempts} + 1`,
            correctAttempts: sql`${questionProgress.correctAttempts} + ${body.correct === true ? 1 : 0}`,
            firstAttemptCorrect,
            lastAnswer: JSON.stringify(selectedKeys),
            lastCorrect: body.correct === null ? null : body.correct ? 1 : 0,
            lastConfidence: body.confidence,
            wrongState: review.wrongState,
            streak: review.streak,
            dueAt: review.dueAt,
            lastAttemptAt: answeredAt,
            generation,
            updatedAt: now,
          };

      const pendingAttempt = sql`EXISTS (
        SELECT 1 FROM ${attemptLog}
        WHERE ${attemptLog.userId} = ${userId}
          AND ${attemptLog.mutationId} = ${body.mutationId}
          AND ${attemptLog.aggregateApplied} = 0
      )`;
      const progressUpsert = db.insert(questionProgress)
        .values({
          userId,
          questionId: body.questionId,
          attempts: 1,
          correctAttempts: body.correct === true ? 1 : 0,
          firstAttemptCorrect,
          lastAnswer: JSON.stringify(selectedKeys),
          lastCorrect: body.correct === null ? null : body.correct ? 1 : 0,
          lastConfidence: body.confidence,
          wrongState: review.wrongState,
          streak: review.streak,
          dueAt: review.dueAt,
          lastAttemptAt: answeredAt,
          generation,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [questionProgress.userId, questionProgress.questionId],
          // Older offline attempts remain in the immutable log and counts, but
          // cannot move the user's current rolling schedule backwards.
          set: attemptUpdate,
          setWhere: pendingAttempt,
        });
      await db.batch([
        db.insert(attemptLog).values({
          mutationId: body.mutationId,
          userId,
          questionId: body.questionId,
          selectedKeys: JSON.stringify(selectedKeys),
          correct: body.correct === null ? null : body.correct ? 1 : 0,
          confidence: body.confidence,
          mode: body.mode,
          generation,
          aggregateApplied: 0,
          createdAt: answeredAt,
        }).onConflictDoNothing(),
        progressUpsert,
        db.update(attemptLog).set({ aggregateApplied: 1 }).where(and(
          eq(attemptLog.userId, userId),
          eq(attemptLog.mutationId, body.mutationId),
          eq(attemptLog.aggregateApplied, 0),
        )),
      ]);
    } else if (body.action === "bookmark") {
      await db
        .insert(questionProgress)
        .values({ userId, questionId: body.questionId, bookmarked: body.value ? 1 : 0, generation, updatedAt: now })
        .onConflictDoUpdate({ target: [questionProgress.userId, questionProgress.questionId], set: { bookmarked: body.value ? 1 : 0, generation, updatedAt: now } });
    } else if (body.action === "read") {
      await db
        .insert(questionProgress)
        .values({ userId, questionId: body.questionId, readState: body.value, generation, updatedAt: now })
        .onConflictDoUpdate({ target: [questionProgress.userId, questionProgress.questionId], set: { readState: body.value, generation, updatedAt: now } });
    } else {
      await db
        .insert(questionProgress)
        .values({ userId, questionId: body.questionId, wrongState: body.value, generation, updatedAt: now })
        .onConflictDoUpdate({ target: [questionProgress.userId, questionProgress.questionId], set: { wrongState: body.value, generation, updatedAt: now } });
    }

    const current = await getProgress(userId, body.questionId);
    return Response.json({ progress: current ? publicProgress(current) : null });
  } catch (error) {
    if (isStaleGenerationError(error)) {
      return Response.json({ error: "學習進度已更新，請重新整理後再試。" }, { status: 409 });
    }
    return Response.json({ error: "無法更新學習進度，請再試一次。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "無法清除學習紀錄，請再試一次。" }, { status: 400 });
  }
  const body = parseReset(raw);
  if (!body) return Response.json({ error: "無法清除學習紀錄，請再試一次。" }, { status: 400 });

  try {
    const identity = await userIdentityFor(request);
    if (!identity) return Response.json({ localOnly: true }, { status: 401 });
    const { userId } = identity;
    const db = await getDb();
    await db.insert(progressResetState).values({
      userId,
      generation: 0,
      lastMutationId: null,
      updatedAt: new Date().toISOString(),
    }).onConflictDoNothing();
    const resetState = await getResetGeneration(userId);
    if (resetState.lastMutationId === body.mutationId) return Response.json({ ok: true, resetGeneration: resetState.generation });
    if (body.baseGeneration !== resetState.generation) {
      return Response.json({ error: "學習進度已有變更，請重新整理後再試。", resetGeneration: resetState.generation }, { status: 409 });
    }

    const now = new Date().toISOString();
    const nextGeneration = resetState.generation + 1;
    const chunks: Array<string[] | null> = body.questionIds
      ? Array.from({ length: Math.ceil(body.questionIds.length / 100) }, (_, index) => body.questionIds!.slice(index * 100, index * 100 + 100))
      : [null];
    const resetWon = sql`EXISTS (
      SELECT 1 FROM ${progressResetState}
      WHERE ${progressResetState.userId} = ${userId}
        AND ${progressResetState.generation} = ${nextGeneration}
        AND ${progressResetState.lastMutationId} = ${body.mutationId}
    )`;
    const queries: BatchItem<"sqlite">[] = [
      db.update(progressResetState).set({
        generation: nextGeneration,
        lastMutationId: body.mutationId,
        updatedAt: now,
      }).where(and(
        eq(progressResetState.userId, userId),
        eq(progressResetState.generation, body.baseGeneration),
      )),
    ];

    for (const questionIds of chunks) {
      const progressWhere = questionIds
        ? and(eq(questionProgress.userId, userId), inArray(questionProgress.questionId, questionIds), resetWon)
        : and(eq(questionProgress.userId, userId), resetWon);
      const attemptWhere = questionIds
        ? and(eq(attemptLog.userId, userId), inArray(attemptLog.questionId, questionIds), resetWon)
        : and(eq(attemptLog.userId, userId), resetWon);

      if (body.types.includes("attempts")) queries.push(db.delete(attemptLog).where(attemptWhere));

      if (body.types.length === 3) {
        queries.push(db.delete(questionProgress).where(progressWhere));
        continue;
      }
      if (body.types.includes("attempts")) {
        queries.push(db.update(questionProgress).set({
          attempts: 0,
          correctAttempts: 0,
          firstAttemptCorrect: null,
          lastAnswer: null,
          lastCorrect: null,
          lastConfidence: null,
          wrongState: "none",
          streak: 0,
          dueAt: null,
          lastAttemptAt: null,
          generation: nextGeneration,
          updatedAt: now,
        }).where(progressWhere));
      }
      if (body.types.includes("reading")) {
        queries.push(db.update(questionProgress).set({ readState: "unread", generation: nextGeneration, updatedAt: now }).where(progressWhere));
      }
      if (body.types.includes("bookmarks")) {
        queries.push(db.update(questionProgress).set({ bookmarked: 0, generation: nextGeneration, updatedAt: now }).where(progressWhere));
      }

      queries.push(db.delete(questionProgress).where(and(
        progressWhere,
        eq(questionProgress.attempts, 0),
        eq(questionProgress.correctAttempts, 0),
        isNull(questionProgress.firstAttemptCorrect),
        isNull(questionProgress.lastAnswer),
        isNull(questionProgress.lastCorrect),
        isNull(questionProgress.lastConfidence),
        eq(questionProgress.bookmarked, 0),
        eq(questionProgress.readState, "unread"),
        eq(questionProgress.wrongState, "none"),
        eq(questionProgress.streak, 0),
        isNull(questionProgress.dueAt),
        isNull(questionProgress.lastAttemptAt),
      )));
    }

    await db.batch(queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

    const finalState = await getResetGeneration(userId);
    if (finalState.generation !== nextGeneration || finalState.lastMutationId !== body.mutationId) {
      return Response.json({ error: "學習進度已有變更，請重新整理後再試。", resetGeneration: finalState.generation }, { status: 409 });
    }
    return Response.json({ ok: true, resetGeneration: finalState.generation });
  } catch {
    return Response.json({ error: "無法清除學習紀錄，請再試一次。" }, { status: 500 });
  }
}
