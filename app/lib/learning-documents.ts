export type LearningDocument = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  format: "PDF" | "Word" | "PowerPoint";
  downloadName: string;
  originalHref: string;
  previewHref: string;
  pageCount?: number;
  fileSizeLabel: string;
  layoutLabel: string;
};

export const supportedLearningDocumentFormats = ["PDF", "Word", "PowerPoint"] as const;

export const learningDocuments: readonly LearningDocument[] = [
  {
    id: "emergency-clinical-decision-atlas",
    title: "急診臨床決策圖譜",
    subtitle: "急診專科醫師口試與筆試複習",
    description: "涵蓋危急辨識、鑑別診斷、檢查與處置，以及毒物、EMS、災難與高齡急診。",
    format: "PDF",
    downloadName: "急診臨床決策圖譜.pdf",
    originalHref: "/learning-documents/emergency-clinical-decision-atlas-9273814f8395.pdf",
    previewHref: "/learning-documents/emergency-clinical-decision-atlas-9273814f8395.pdf",
    pageCount: 90,
    fileSizeLabel: "約 3 MB",
    layoutLabel: "A4 橫式",
  },
];

export function learningDocumentById(id: string | null | undefined) {
  const normalized = (id ?? "").normalize("NFKC").trim().toLowerCase();
  return learningDocuments.find((document) => document.id === normalized) ?? null;
}
