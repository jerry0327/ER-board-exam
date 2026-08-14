"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { FullQuestion, PracticeSession } from "../lib/types";

export type AnswerSelectionIntent = "toggle" | "clear";

export function applyAnswerSelection(
  session: PracticeSession | null,
  question: FullQuestion | null,
  key: string,
  intent: AnswerSelectionIntent = "toggle",
) {
  if (!session || !question || session.completed) return session;
  if (session.ids[session.cursor] !== question.id) return session;
  if (session.mode === "study" && session.submitted.includes(question.id)) return session;
  if (question.qualityStatus === "source-mismatch" || !question.options.some((option) => option.key === key)) return session;

  const existing = session.answers[question.id] ?? [];
  const selected = intent === "clear" || existing.includes(key)
    ? existing.filter((value) => value !== key)
    : question.answerKeys.length > 1
      ? [...existing, key]
      : [key];

  if (selected.length === existing.length && selected.every((value, index) => value === existing[index])) return session;
  return { ...session, answers: { ...session.answers, [question.id]: selected } };
}

export function useAnswerSelection(
  question: FullQuestion | null,
  setSession: Dispatch<SetStateAction<PracticeSession | null>>,
) {
  return useCallback((key: string, intent: AnswerSelectionIntent = "toggle") => {
    setSession((session) => applyAnswerSelection(session, question, key, intent));
  }, [question, setSession]);
}
