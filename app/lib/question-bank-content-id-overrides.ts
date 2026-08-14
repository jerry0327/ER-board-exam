/**
 * Browser-safe projection of
 * `specs/question-bank-content-id-overrides.v1.json`.
 *
 * The canonical registry stays outside player metadata so the reason/audit
 * prose never ships.  Each mapping remains evidence-bound to the immutable
 * formal SRC SHA-256; a source revision therefore fails closed.
 */

export type QuestionBankContentIdOverride = {
  sourceSha256: string;
  questionIds: readonly [string, string, string, string, string];
};

export const QUESTION_BANK_CONTENT_ID_OVERRIDES: Readonly<Record<string, QuestionBankContentIdOverride>> = {
  "115A-Q131-Q135.src": {
    sourceSha256: "63e2f8d1bb7a9f45647d113acd26b5aab88a6ff64098c535196d0b23310438f4",
    questionIds: ["115A-Q136", "115A-Q137", "115A-Q138", "115A-Q139", "115A-Q140"],
  },
  "115A-Q136-Q140.src": {
    sourceSha256: "281d02e08aed2563bfd4d0c534087135849fe6f63f3239c2cf700fe071800162",
    questionIds: ["115A-Q131", "115A-Q132", "115A-Q133", "115A-Q134", "115A-Q135"],
  },
};
