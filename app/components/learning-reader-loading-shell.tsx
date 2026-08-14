import { BookOpenText } from "lucide-react";
import { LEARNING_SOURCE_REGISTRY, type LearningSourceId } from "../lib/learning-source-registry";

type Props = {
  description: string;
  sourceId: LearningSourceId;
  title?: string;
};

/**
 * A stable first-paint surface for readers whose catalog/content packs are
 * still opening. Keep this data-free so it never competes with the actual
 * reader payload or turns a short wait into a second loading phase.
 */
export default function LearningReaderLoadingShell({ description, sourceId, title }: Props) {
  const source = LEARNING_SOURCE_REGISTRY[sourceId];
  return (
    <main className="workspace-page route-loading-shell learning-reader-loading-shell" aria-busy="true" aria-labelledby="learning-reader-loading-title">
      <header className="page-intro route-loading-intro">
        <p className="eyebrow"><span aria-hidden="true" />{source.guideKicker}</p>
        <h1 id="learning-reader-loading-title">{title ?? source.title}</h1>
        <p>{description}</p>
        <span className="route-loading-icon" aria-hidden="true"><BookOpenText /></span>
      </header>
      <div className="route-loading-grid" aria-hidden="true">
        <section className="route-loading-panel route-loading-panel-primary"><i /><i /><i /></section>
        <aside className="route-loading-panel"><i /><i /></aside>
      </div>
      <p className="sr-only" aria-live="polite">正在準備閱讀內容</p>
    </main>
  );
}
