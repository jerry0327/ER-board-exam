import { and, desc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "../../../db";
import { annotationMutation, studyAnnotation } from "../../../db/schema";
import { userIdentityFor } from "../user-identity";
import { annotationBodyLimit } from "../../lib/annotation-body-limit";
import { ANNOTATION_EXCERPT_QUOTE_LIMIT } from "../../lib/annotation-limits";
import { parseAnyGuideAnnotationResourceId } from "../../lib/annotation-source";
import { privateJson } from "../private-response";

export const dynamic = "force-dynamic";

type AnnotationInput = {
  id: string;
  questionId: string;
  kind: "question_note" | "highlight" | "excerpt";
  body: string;
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number | null;
  endOffset: number | null;
  createdAt: string;
};

type MutationInput = {
  action: "upsert" | "delete";
  mutationId: string;
  baseRevision: number;
  annotation: AnnotationInput;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validResourceId(value: unknown): value is string {
  return typeof value === "string" && (
    /^\d{3}[AB]?-Q\d{3}$/.test(value)
    || /^guide-tintinalli-(?:00[1-9]|0[1-9]\d|[12]\d{2}|30[0-3])$/.test(value)
    || Boolean(parseAnyGuideAnnotationResourceId(value))
  );
}

function parseAnnotation(value: unknown): AnnotationInput | null {
  if (!isRecord(value) || !validResourceId(value.questionId)) return null;
  if (typeof value.id !== "string" || !/^(?:q_[A-Za-z0-9_-]{3,100}|h_[A-Za-z0-9_-]{8,100})$/.test(value.id)) return null;
  if (value.kind !== "question_note" && value.kind !== "highlight" && value.kind !== "excerpt") return null;
  const bodyLimit = annotationBodyLimit(value.questionId, value.kind);
  if (typeof value.body !== "string" || value.body.length > bodyLimit) return null;
  if (typeof value.quote !== "string" || value.quote.length > (value.kind === "excerpt" ? ANNOTATION_EXCERPT_QUOTE_LIMIT : 1200)) return null;
  if (typeof value.prefix !== "string" || value.prefix.length > 80) return null;
  if (typeof value.suffix !== "string" || value.suffix.length > 80) return null;
  if ((value.kind === "highlight" || value.kind === "excerpt") && !value.quote.trim()) return null;
  if (!(value.startOffset === null || Number.isInteger(value.startOffset)) || !(value.endOffset === null || Number.isInteger(value.endOffset))) return null;
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return null;
  return value as AnnotationInput;
}

function parseMutation(value: unknown): MutationInput | null {
  if (!isRecord(value) || (value.action !== "upsert" && value.action !== "delete")) return null;
  if (typeof value.mutationId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(value.mutationId)) return null;
  if (!Number.isInteger(value.baseRevision) || Number(value.baseRevision) < 0) return null;
  const annotation = parseAnnotation(value.annotation);
  return annotation ? { action: value.action, mutationId: value.mutationId, baseRevision: Number(value.baseRevision), annotation } : null;
}

async function getAnnotation(userId: string, id: string) {
  const db = await getDb();
  const [annotation] = await db.select().from(studyAnnotation).where(and(eq(studyAnnotation.userId, userId), eq(studyAnnotation.id, id))).limit(1);
  return annotation;
}

function publicAnnotation(row: typeof studyAnnotation.$inferSelect | undefined) {
  if (!row) return undefined;
  const { userId: _userId, lastMutationId: _lastMutationId, ...annotation } = row;
  void _userId;
  void _lastMutationId;
  return annotation;
}

export async function GET(request: Request) {
  try {
    const identity = await userIdentityFor(request);
    if (!identity) return privateJson({ localOnly: true, annotations: [] }, { status: 401 });
    const { userId, accountKey } = identity;
    const db = await getDb();
    const annotations = await db.select().from(studyAnnotation).where(eq(studyAnnotation.userId, userId)).orderBy(desc(studyAnnotation.updatedAt));
    return privateJson({
      accountKey,
      legacyAccountKey: identity.legacyAccountKey,
      annotations: annotations.map((annotation) => publicAnnotation(annotation)),
    });
  } catch {
    return privateJson({ error: "無法載入筆記，請再試一次。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await userIdentityFor(request);
  if (!identity) return Response.json({ localOnly: true }, { status: 401 });
  const { userId } = identity;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "無法更新筆記，請再試一次。" }, { status: 400 });
  }
  const body = parseMutation(raw);
  if (!body) return Response.json({ error: "無法更新筆記，請再試一次。" }, { status: 400 });

  try {
    const db = await getDb();
    const [receipt] = await db.select().from(annotationMutation).where(and(eq(annotationMutation.userId, userId), eq(annotationMutation.mutationId, body.mutationId))).limit(1);
    if (receipt?.applied) return Response.json({ annotation: publicAnnotation(await getAnnotation(userId, receipt.annotationId)) });

    const existing = await getAnnotation(userId, body.annotation.id);
    if ((existing?.revision ?? 0) !== body.baseRevision) {
      return Response.json({ error: "無法更新筆記，請重新整理後再試。", annotation: existing }, { status: 409 });
    }

    const now = new Date().toISOString();
    const values = {
      userId,
      id: body.annotation.id,
      questionId: body.annotation.questionId,
      kind: body.annotation.kind,
      body: body.annotation.body,
      quote: body.annotation.quote,
      prefix: body.annotation.prefix,
      suffix: body.annotation.suffix,
      startOffset: body.annotation.startOffset,
      endOffset: body.annotation.endOffset,
      revision: body.baseRevision + 1,
      lastMutationId: body.mutationId,
      createdAt: existing?.createdAt ?? body.annotation.createdAt,
      updatedAt: now,
      deletedAt: body.action === "delete" ? now : null,
    };

    const pendingReceipt = sql`EXISTS (
      SELECT 1 FROM ${annotationMutation}
      WHERE ${annotationMutation.userId} = ${userId}
        AND ${annotationMutation.mutationId} = ${body.mutationId}
        AND ${annotationMutation.annotationId} = ${body.annotation.id}
        AND ${annotationMutation.applied} = 0
    )`;
    const write = existing
      ? db.update(studyAnnotation).set(values).where(and(
          eq(studyAnnotation.userId, userId),
          eq(studyAnnotation.id, body.annotation.id),
          eq(studyAnnotation.revision, body.baseRevision),
          pendingReceipt,
        ))
      : db.insert(studyAnnotation).values(values).onConflictDoNothing();
    const queries: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db.insert(annotationMutation).values({
        userId,
        mutationId: body.mutationId,
        annotationId: body.annotation.id,
        applied: 0,
        createdAt: now,
      }).onConflictDoNothing(),
      write,
      db.update(annotationMutation).set({ applied: 1 }).where(and(
        eq(annotationMutation.userId, userId),
        eq(annotationMutation.mutationId, body.mutationId),
        eq(annotationMutation.annotationId, body.annotation.id),
        eq(annotationMutation.applied, 0),
        sql`EXISTS (
          SELECT 1 FROM ${studyAnnotation}
          WHERE ${studyAnnotation.userId} = ${userId}
            AND ${studyAnnotation.id} = ${body.annotation.id}
            AND ${studyAnnotation.lastMutationId} = ${body.mutationId}
        )`,
      )),
    ];
    await db.batch(queries);

    const [storedReceipt] = await db.select().from(annotationMutation).where(and(
      eq(annotationMutation.userId, userId),
      eq(annotationMutation.mutationId, body.mutationId),
    )).limit(1);
    const stored = await getAnnotation(userId, body.annotation.id);
    if (!storedReceipt?.applied || stored?.lastMutationId !== body.mutationId) {
      return Response.json({ error: "無法更新筆記，請重新整理後再試。", annotation: publicAnnotation(stored) }, { status: 409 });
    }
    return Response.json({ annotation: publicAnnotation(stored) });
  } catch {
    return Response.json({ error: "無法更新筆記，請再試一次。" }, { status: 500 });
  }
}
