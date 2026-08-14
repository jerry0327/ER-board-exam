type MarkdownNode = {
  type: string;
  value?: string;
  data?: {
    hProperties?: Record<string, string | number>;
  };
};

type MarkdownParent = MarkdownNode & { children?: MarkdownNode[] };

const markerPattern = /^\s*<!--board-trace:([^:>]+):(\d+):(\d+)-->\s*$/u;

/**
 * Turns compact build-time comments into stable, non-interactive DOM metadata.
 * The comment itself is removed, so it never appears in copied text or notes.
 */
export default function remarkBoardTrace() {
  return (tree: MarkdownParent) => {
    const visit = (parent: MarkdownParent) => {
      const children = parent.children;
      if (!children) return;
      for (let index = 0; index < children.length; index += 1) {
        const node = children[index];
        if (node.type === "html" && node.value) {
          const match = markerPattern.exec(node.value);
          if (match) {
            const target = children[index + 1];
            if (target) {
              target.data = target.data ?? {};
              target.data.hProperties = {
                ...(target.data.hProperties ?? {}),
                id: match[1],
                "data-board-trace-node": match[1],
                "data-board-trace-direct": Number(match[2]),
                "data-board-trace-related": Number(match[3]),
              };
            }
            children.splice(index, 1);
            index -= 1;
            continue;
          }
        }
        visit(node as MarkdownParent);
      }
    };
    visit(tree);
  };
}
