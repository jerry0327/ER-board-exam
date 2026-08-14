import { parseAnyGuideAnnotationResourceId } from "./annotation-source.ts";

export type AnnotationBodyKind = "question_note" | "highlight" | "excerpt";

/** Keep the server limit aligned with every guide source accepted by the shared parser. */
export function annotationBodyLimit(questionId: string, kind: AnnotationBodyKind) {
  return kind === "question_note" && parseAnyGuideAnnotationResourceId(questionId)
    ? 12_000
    : 4_000;
}
