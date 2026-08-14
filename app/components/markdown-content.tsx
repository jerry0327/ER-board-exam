"use client";

/* Markdown sources can contain arbitrary remote image dimensions and hosts. */
/* eslint-disable @next/next/no-img-element */

import { isValidElement, memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, BookOpenText, NotebookPen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  annotationBlockAnchor,
  annotationBlockKey,
  annotationBlockSourceOffset,
  annotationCanonicalHeadingKey,
} from "../lib/annotation-block-anchor";
import { markdownHeadingRanges, markdownHeadingSection } from "../lib/markdown-section-excerpt";
import { createHeadingSlugger, markdownHeadingMatchesTitle } from "../lib/markdown-heading";
import { parseMedicalFlow } from "../lib/medical-flow";
import { scrollElementIntoView } from "../lib/motion";
import { parseDecisionTree } from "../lib/decision-tree";
import { normalizeMarkdown } from "../lib/normalize-markdown";
import remarkRepairLiterals from "../lib/remark-repair-literals";
import remarkStructuredFields from "../lib/remark-structured-fields";
import remarkBoardTrace from "../lib/remark-board-trace";
import { isStructuredLabelText } from "../lib/structured-label";
import type { AnnotationExcerptRequest } from "../lib/types";
import type { BoardTraceTarget } from "../lib/board-trace";

type MarkdownVariant = "question" | "guide" | "annotation" | "board";

type PositionedNode = {
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

function safeHref(href?: string) {
  if (!href) return null;
  if (href.startsWith("#")) return href;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? href : null;
  } catch {
    return null;
  }
}

function safeImageSource(src?: string | Blob) {
  if (typeof src !== "string" || src.startsWith("#")) return null;
  return safeHref(src);
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.type === "br") return "\n";
    return textContent(node.props.children);
  }
  return "";
}

function DecisionTree({ value }: { value: string }) {
  const rows = parseDecisionTree(value)!;
  return (
    <div className="decision-tree" role="group" aria-label={`臨床決策流程：${rows[0]?.label ?? "流程圖"}`} data-reading-navigation-ignore>
      {rows.map((row, index) => (
        <div
          className={`decision-tree-row ${row.level === 0 ? "root" : "branch"} ${row.terminal ? "terminal" : ""}`}
          style={{ "--tree-level": row.level } as CSSProperties}
          key={`${row.level}-${row.label}-${index}`}
        >
          {row.level > 0 && <i aria-hidden="true" />}
          <span><strong>{row.label}</strong>{row.outcome && <><b aria-hidden="true">→</b><em>{row.outcome}</em></>}</span>
        </div>
      ))}
    </div>
  );
}

function MedicalFlow({ value, label }: { value: string; label: string }) {
  const parts = parseMedicalFlow(value)!;
  return (
    <div
      className="medical-flow"
      role="group"
      aria-label={`${label}醫學處置流程`}
      data-reading-navigation-ignore
    >
      {parts.map((part, index) => {
        if (part.type === "connector") {
          return (
            <div className="medical-flow-connector" aria-hidden="true" key={`connector-${index}`}>
              <ArrowDown />
              {part.label && <span>{part.label}</span>}
            </div>
          );
        }
        if (part.type === "branches") {
          return (
            <div className={`medical-flow-branches ${part.nested ? "is-nested" : "is-flat"}`} role="list" aria-label="處置分支" key={`branches-${index}`}>
              {part.branches.map((branch, branchIndex) => (
                <div
                  className="medical-flow-branch"
                  role="listitem"
                  style={{ "--flow-depth": branch.depth } as CSSProperties}
                  key={`${branch.depth}-${branch.label}-${branch.lines.join("-")}-${branchIndex}`}
                >
                  {branch.label && <strong className="medical-flow-branch-label">{branch.label}</strong>}
                  <span className="medical-flow-branch-body">
                    {branch.lines.map((line, lineIndex) => <span key={`${line}-${lineIndex}`}>{line}</span>)}
                  </span>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div className={`medical-flow-step ${part.question ? "is-question" : ""}`} key={`step-${index}`}>
            {part.lines.map((line, lineIndex) => <span key={`${line}-${lineIndex}`}>{line}</span>)}
          </div>
        );
      })}
    </div>
  );
}

function sourceExcerpt(markdown: string, node: PositionedNode | undefined) {
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" && end > start
    ? markdown.slice(start, end).trim()
    : "";
}

type TraceableNode = PositionedNode & {
  properties?: Record<string, unknown>;
};

function boardTraceProps(node: TraceableNode | undefined) {
  const properties = node?.properties;
  const id = typeof properties?.id === "string" ? properties.id : undefined;
  const traceNode = typeof properties?.["data-board-trace-node"] === "string"
    ? properties["data-board-trace-node"] as string
    : id;
  if (!traceNode) return {};
  const direct = Number(properties?.["data-board-trace-direct"] ?? 0);
  const related = Number(properties?.["data-board-trace-related"] ?? 0);
  return {
    id: traceNode,
    className: "board-trace-node",
    "data-board-trace-node": traceNode,
    "data-board-trace-direct": Number.isFinite(direct) ? direct : 0,
    "data-board-trace-related": Number.isFinite(related) ? related : 0,
  };
}

export function AnnotationBlockAction({ label, excerpt, onAddToNotes }: { label: string; excerpt: AnnotationExcerptRequest; onAddToNotes: (excerpt: AnnotationExcerptRequest) => void }) {
  const actionLabel = excerpt.block === "heading" ? `將${label}與其下內容加入筆記` : `將${label}加入筆記`;
  return <button type="button" className="annotation-block-action" data-annotation-action aria-label={actionLabel} title={actionLabel} onClick={() => onAddToNotes(excerpt)}><NotebookPen aria-hidden="true" /><span className="sr-only">加入筆記</span></button>;
}

type QuestionTraceActions = {
  targets: readonly BoardTraceTarget[];
  onOpen: (target: BoardTraceTarget) => void;
};

function MarkdownContent({ markdown, variant = "question", documentTitle, onAddToNotes, questionTraceActions }: { markdown: string; variant?: MarkdownVariant; documentTitle?: string; onAddToNotes?: (excerpt: AnnotationExcerptRequest) => void; questionTraceActions?: QuestionTraceActions }) {
  const normalized = useMemo(
    () => variant === "question" ? normalizeMarkdown(markdown) : markdown.replace(/\r\n?/gu, "\n").trim(),
    [markdown, variant],
  );
  const contentLabel = variant === "board" ? "考題對照指引" : variant === "guide" ? "學習指引" : variant === "annotation" ? "筆記摘錄" : "詳解";
  const headingSlug = createHeadingSlugger();
  const headingRanges = useMemo(() => markdownHeadingRanges(normalized), [normalized]);
  const isLeadingDocumentTitle = (node: PositionedNode | undefined, heading: string) => Boolean(
    documentTitle
    && node?.position?.start?.offset === headingRanges[0]?.start
    && markdownHeadingMatchesTitle(heading, documentTitle)
  );
  const excerptRequest = (node: PositionedNode | undefined, block: AnnotationExcerptRequest["block"], label: string, fallback = "") => {
    const excerpt = sourceExcerpt(normalized, node) || fallback;
    return {
      markdown: excerpt,
      block,
      label,
      sourceAnchor: annotationBlockAnchor(block, excerpt, node?.position?.start?.offset),
    } satisfies AnnotationExcerptRequest;
  };
  const headingExcerptRequest = (node: PositionedNode | undefined, level: number, label: string, fallback = "") => {
    const start = node?.position?.start?.offset;
    const end = node?.position?.end?.offset;
    const headingIdentity = sourceExcerpt(normalized, node) || fallback;
    const excerpt = typeof start === "number" && typeof end === "number" && end > start
      ? markdownHeadingSection(normalized, start, end, level, headingRanges)
      : fallback;
    return {
      markdown: excerpt,
      block: "heading" as const,
      label,
      sourceAnchor: annotationBlockAnchor("heading", headingIdentity, start),
    } satisfies AnnotationExcerptRequest;
  };
  const blockAnchorProps = (excerpt: AnnotationExcerptRequest) => {
    const heading = excerpt.block === "heading";
    return {
      "data-annotation-anchor": excerpt.sourceAnchor,
      "data-annotation-block-key": annotationBlockKey(excerpt.block, excerpt.markdown),
      "data-annotation-canonical-heading-key": heading
        ? annotationCanonicalHeadingKey(excerpt.markdown)
        : undefined,
      "data-annotation-source-offset": heading
        ? annotationBlockSourceOffset(excerpt.sourceAnchor) ?? undefined
        : undefined,
    };
  };
  const headingAction = (excerpt: AnnotationExcerptRequest) => {
    if (!onAddToNotes) return null;
    return <AnnotationBlockAction label={excerpt.label} excerpt={excerpt} onAddToNotes={onAddToNotes} />;
  };
  const traceAction = (target: BoardTraceTarget, label: string) => {
    if (!questionTraceActions?.targets.includes(target)) return null;
    return (
      <button
        type="button"
        className="explanation-trace-action"
        data-annotation-action
        data-reading-navigation-ignore
        aria-label={`查看${label}的考題溯源`}
        title="查看考題溯源"
        onClick={() => questionTraceActions.onOpen(target)}
      >
        <BookOpenText aria-hidden="true" />
        <span>溯源</span>
      </button>
    );
  };
  return (
    <div className="markdown-body" data-markdown-root>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkRepairLiterals, remarkBreaks, remarkStructuredFields, ...(variant === "board" ? [remarkBoardTrace] : [])]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const safe = safeHref(href);
            const external = Boolean(safe && /^https?:/i.test(safe));
            const internalAnchor = Boolean(safe?.startsWith("#"));
            const bareExternal = Boolean(external && safe && textContent(children).trim() === safe);
            const host = bareExternal && safe ? new URL(safe).hostname.replace(/^www\./, "") : "";
            return safe ? (
              <a
                href={safe}
                className={bareExternal ? "source-link" : undefined}
                aria-label={bareExternal ? `開啟外部來源：${host}` : undefined}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                onClick={internalAnchor ? (event) => {
                  event.preventDefault();
                  let id = safe.slice(1);
                  try { id = decodeURIComponent(id); } catch { /* keep the original anchor */ }
                  scrollElementIntoView(document.getElementById(id), { block: "start" });
                } : undefined}
              >
                {bareExternal ? `來源 · ${host} ↗` : children}
              </a>
            ) : <span>{children}</span>;
          },
          table: ({ children, node }) => {
            const excerpt = excerptRequest(node, "table", "表格");
            if (variant !== "board") {
              return <div {...blockAnchorProps(excerpt)} className="table-scroll" role="region" aria-label={`${contentLabel}表格，原文第 ${node?.position?.start.line ?? "未知"} 行，可左右捲動`} tabIndex={0} data-reading-navigation-ignore>{onAddToNotes && excerpt.markdown && <div className="annotation-table-action"><AnnotationBlockAction label="表格" excerpt={excerpt} onAddToNotes={onAddToNotes} /></div>}<table>{children}</table></div>;
            }
            const trace = boardTraceProps(node as TraceableNode);
            return <div {...blockAnchorProps(excerpt)} {...trace} className={["table-scroll", trace.className].filter(Boolean).join(" ")} role="region" aria-label={`${contentLabel}表格，原文第 ${node?.position?.start.line ?? "未知"} 行，可左右捲動`} tabIndex={0} data-reading-navigation-ignore>{onAddToNotes && excerpt.markdown && <div className="annotation-table-action"><AnnotationBlockAction label="表格" excerpt={excerpt} onAddToNotes={onAddToNotes} /></div>}<table>{children}</table></div>;
          },
          th: ({ children }) => <th scope="col">{children}</th>,
          pre: ({ children, node }) => {
            const content = textContent(children).replace(/\n$/u, "");
            return parseMedicalFlow(content)
              ? <MedicalFlow value={content} label={contentLabel} />
              : <pre role="region" aria-label={`${contentLabel}程式碼，原文第 ${node?.position?.start.line ?? "未知"} 行，可左右捲動`} tabIndex={0} data-reading-navigation-ignore>{children}</pre>;
          },
          img: ({ src, alt }) => {
            const safe = safeImageSource(src);
            return safe
              ? <img src={safe} alt={alt ?? ""} loading="lazy" decoding="async" />
              : alt ? <span className="image-alt">{alt}</span> : null;
          },
          p: ({ children, node }) => {
            const content = textContent(children);
            const decisionTree = parseDecisionTree(content);
            if (decisionTree) return <DecisionTree value={content} />;
            const verticalFlow = /\n\s*[↓⇩]\s*\n/u.test(content);
            const treeLines = content.match(/(?:├─|└─)/g)?.length ?? 0;
            const className = verticalFlow ? "flow-sequence" : treeLines >= 2 ? "flow-tree" : undefined;
            if (variant !== "board") {
              return className
                ? <p className={className} role="region" aria-label={verticalFlow ? `${contentLabel}流程，可左右捲動` : `${contentLabel}文字流程圖，可左右捲動`} tabIndex={0} data-reading-navigation-ignore>{children}</p>
                : <p>{children}</p>;
            }
            const trace = boardTraceProps(node as TraceableNode);
            return className
              ? <p {...trace} className={[className, trace.className].filter(Boolean).join(" ")} role="region" aria-label={verticalFlow ? `${contentLabel}流程，可左右捲動` : `${contentLabel}文字流程圖，可左右捲動`} tabIndex={0} data-reading-navigation-ignore>{children}</p>
              : <p {...trace}>{children}</p>;
          },
          ul: ({ children, node }) => <ul {...(variant === "board" ? boardTraceProps(node as TraceableNode) : {})}>{children}</ul>,
          ol: ({ children, node }) => <ol {...(variant === "board" ? boardTraceProps(node as TraceableNode) : {})}>{children}</ol>,
          blockquote: ({ children, node }) => <blockquote {...(variant === "board" ? boardTraceProps(node as TraceableNode) : {})}>{children}</blockquote>,
          strong: ({ children }) => (
            <strong className={isStructuredLabelText(textContent(children)) ? "structured-label" : undefined}>{children}</strong>
          ),
          h1: ({ children, node }) => {
            const heading = textContent(children);
            const headingId = headingSlug(heading);
            if (isLeadingDocumentTitle(node, heading)) return null;
            const excerpt = headingExcerptRequest(node, 1, "主標題", `# ${heading}`);
            return <h1 {...blockAnchorProps(excerpt)} tabIndex={-1} id={headingId} className={`markdown-level-one ${onAddToNotes ? "has-annotation-action" : ""}`}>{children}{headingAction(excerpt)}</h1>;
          },
          h2: ({ children, node }) => {
            const heading = textContent(children);
            const headingId = headingSlug(heading);
            if (isLeadingDocumentTitle(node, heading)) return null;
            const reference = /(?:參考資料|references?)/i.test(heading);
            const excerpt = headingExcerptRequest(node, 2, "標題", `## ${heading}`);
            const stemTraceAction = /(?:核心理由|核心觀念|解題核心)/u.test(heading) ? traceAction("stem", "整題觀念") : null;
            return <h2 {...blockAnchorProps(excerpt)} tabIndex={-1} id={headingId} className={`${reference ? "reference-heading " : ""}${onAddToNotes ? "has-annotation-action" : ""}`.trim() || undefined}>{children}{stemTraceAction}{headingAction(excerpt)}</h2>;
          },
          h3: ({ children, node }) => {
            const heading = textContent(children).trim();
            const headingId = headingSlug(heading);
            if (isLeadingDocumentTitle(node, heading)) return null;
            const excerpt = headingExcerptRequest(node, 3, "次標題", `### ${heading}`);
            const option = heading.match(/^([A-F])[.)、．]\s*(.+)$/u);
            if (option) {
              const target = `option-${option[1]}` as BoardTraceTarget;
              return <h3 {...blockAnchorProps(excerpt)} tabIndex={-1} id={headingId} className={`option-analysis-heading ${onAddToNotes ? "has-annotation-action" : ""}`}><span aria-hidden="true">{option[1]}</span><span>{option[2]}</span>{traceAction(target, `${option[1]} 選項`)}{headingAction(excerpt)}</h3>;
            }
            return <h3 {...blockAnchorProps(excerpt)} tabIndex={-1} id={headingId} className={onAddToNotes ? "has-annotation-action" : undefined}>{children}{headingAction(excerpt)}</h3>;
          },
          h4: ({ children, node }) => {
            const heading = textContent(children);
            const headingId = headingSlug(heading);
            if (isLeadingDocumentTitle(node, heading)) return null;
            const excerpt = headingExcerptRequest(node, 4, "次次標題", `#### ${heading}`);
            return <h4 {...blockAnchorProps(excerpt)} tabIndex={-1} id={headingId} className={onAddToNotes ? "has-annotation-action" : undefined}>{children}{headingAction(excerpt)}</h4>;
          },
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownContent);
