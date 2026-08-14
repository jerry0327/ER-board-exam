import { isStructuredLabelText } from "./structured-label.ts";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

function nodeText(node: MarkdownNode): string {
  if (node.type === "text") return node.value ?? "";
  return node.children?.map(nodeText).join("") ?? "";
}

function isStructuredLabel(node: MarkdownNode) {
  if (node.type !== "strong") return false;
  return isStructuredLabelText(nodeText(node));
}

export default function remarkStructuredFields() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children) return;
      if (node.type === "paragraph") {
        for (let index = 1; index < node.children.length; index += 1) {
          const child = node.children[index];
          const previous = node.children[index - 1];
          if (isStructuredLabel(child) && previous.type !== "break") {
            node.children.splice(index, 0, { type: "break" });
            index += 1;
          }
        }
      }
      node.children.forEach(visit);
    };
    visit(tree);
  };
}
