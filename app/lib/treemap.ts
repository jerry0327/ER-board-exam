export type TreemapItem<T> = { id: string; value: number; data: T };
export type TreemapTile<T> = TreemapItem<T> & { x: number; y: number; width: number; height: number };

type Rect = { x: number; y: number; width: number; height: number };

export function layoutTreemap<T>(source: TreemapItem<T>[]): TreemapTile<T>[] {
  const items = source.filter((item) => item.value > 0).sort((left, right) => right.value - left.value);
  const output: TreemapTile<T>[] = [];

  const place = (nodes: TreemapItem<T>[], rect: Rect) => {
    if (!nodes.length) return;
    if (nodes.length === 1) {
      output.push({ ...nodes[0], ...rect });
      return;
    }

    const total = nodes.reduce((sum, item) => sum + item.value, 0);
    let running = 0;
    let split = 1;
    let smallestDifference = Number.POSITIVE_INFINITY;
    for (let index = 1; index < nodes.length; index += 1) {
      running += nodes[index - 1].value;
      const difference = Math.abs(total / 2 - running);
      if (difference < smallestDifference) {
        smallestDifference = difference;
        split = index;
      }
    }

    const first = nodes.slice(0, split);
    const second = nodes.slice(split);
    const firstValue = first.reduce((sum, item) => sum + item.value, 0);
    const ratio = firstValue / total;
    if (rect.width >= rect.height) {
      const firstWidth = rect.width * ratio;
      place(first, { ...rect, width: firstWidth });
      place(second, { x: rect.x + firstWidth, y: rect.y, width: rect.width - firstWidth, height: rect.height });
    } else {
      const firstHeight = rect.height * ratio;
      place(first, { ...rect, height: firstHeight });
      place(second, { x: rect.x, y: rect.y + firstHeight, width: rect.width, height: rect.height - firstHeight });
    }
  };

  place(items, { x: 0, y: 0, width: 100, height: 100 });
  return output;
}
