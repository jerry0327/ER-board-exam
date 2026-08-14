type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

function literalBoldNodes(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const matcher = /\*\*([\s\S]+?)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(value))) {
    const before = value.slice(cursor, match.index);
    if (before) nodes.push({ type: "text", value: before });

    const leading = match[1].match(/^\s*/)?.[0] ?? "";
    const trailingLength = match[1].match(/\s*$/)?.[0].length ?? 0;
    const contentEnd = Math.max(leading.length, match[1].length - trailingLength);
    const content = match[1].slice(leading.length, contentEnd);
    const trailing = match[1].slice(contentEnd);
    if (leading) nodes.push({ type: "text", value: leading });
    if (content) nodes.push({ type: "strong", children: [{ type: "text", value: content }] });
    if (trailing) nodes.push({ type: "text", value: trailing });
    cursor = matcher.lastIndex;
  }

  const remainder = value.slice(cursor);
  if (remainder) nodes.push({ type: "text", value: remainder.replace(/\*\*/g, "") });
  return nodes.length ? nodes : [{ type: "text", value: value.replace(/\*\*/g, "") }];
}

export default function remarkRepairLiterals() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children) return;
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (child.type === "text" && child.value?.includes("**")) {
          const replacements = literalBoldNodes(child.value);
          node.children.splice(index, 1, ...replacements);
          index += replacements.length - 1;
        } else {
          visit(child);
        }
      }
    };
    visit(tree);
  };
}
