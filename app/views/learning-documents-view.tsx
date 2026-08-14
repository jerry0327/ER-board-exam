"use client";

import { ExternalLink, FileText, Files } from "lucide-react";
import LearningDocumentPreview from "../components/learning-document-preview";
import { learningDocumentById, learningDocuments } from "../lib/learning-documents";

type Props = {
  requestedDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
};

export default function LearningDocumentsView({ requestedDocumentId, onSelectDocument }: Props) {
  const selectedDocument = learningDocumentById(requestedDocumentId) ?? learningDocuments[0] ?? null;

  if (!selectedDocument) {
    return (
      <main className="workspace-page learning-documents-page">
        <div className="empty-state"><Files /><h1>學習文件</h1><p>目前沒有可閱讀的文件。</p></div>
      </main>
    );
  }

  return (
    <main className="workspace-page learning-documents-page">
      <header className="learning-documents-heading">
        <div>
          <p className="eyebrow"><span />REFERENCE LIBRARY</p>
          <h1>學習文件</h1>
          <p>圖譜、講義與簡報集中閱讀。</p>
        </div>
        <p><strong>{learningDocuments.length}</strong><span>份文件</span></p>
      </header>

      <div className="learning-documents-workspace">
        <aside className="learning-document-library" aria-label="學習文件清單">
          <header><Files size={18} /><span><strong>文件庫</strong><small>PDF・Word・PowerPoint</small></span></header>
          <nav>
            {learningDocuments.map((document) => (
              <div key={document.id} className={document.id === selectedDocument.id ? "active" : undefined}>
                <button
                  type="button"
                  aria-current={document.id === selectedDocument.id ? "page" : undefined}
                  onClick={() => onSelectDocument(document.id)}
                >
                  <FileText size={18} aria-hidden="true" />
                  <span>
                    <strong>{document.title}</strong>
                    <small>{document.format}{document.pageCount ? `・${document.pageCount} 頁` : ""}</small>
                  </span>
                </button>
                {document.id === selectedDocument.id && (
                  <a
                    href={document.previewHref}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`另頁開啟 ${document.title}`}
                  >
                    <ExternalLink aria-hidden="true" />
                  </a>
                )}
              </div>
            ))}
          </nav>
        </aside>

        <section className="learning-document-viewer" aria-label={selectedDocument.title}>
          <h2 className="sr-only">{selectedDocument.title}</h2>
          <div className="learning-document-frame">
            <LearningDocumentPreview
              key={selectedDocument.id}
              href={selectedDocument.previewHref}
              externalHref={selectedDocument.previewHref}
              expectedPageCount={selectedDocument.pageCount}
              title={selectedDocument.title}
            />
          </div>
          <p className="learning-document-mobile-hint">可用頁碼跳轉與縮放；放大後可在頁面內拖曳閱讀。</p>
        </section>
      </div>
    </main>
  );
}
