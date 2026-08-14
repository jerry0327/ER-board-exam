import assert from "node:assert/strict";
import test from "node:test";
import { layoutTreemap } from "../app/lib/treemap.ts";

test("treemap area is proportional to question count", () => {
  const tiles = layoutTreemap([
    { id: "a", value: 50, data: null },
    { id: "b", value: 30, data: null },
    { id: "c", value: 20, data: null },
  ]);
  const areas = Object.fromEntries(tiles.map((tile) => [tile.id, tile.width * tile.height]));
  assert.ok(Math.abs(areas.a - 5000) < 0.001);
  assert.ok(Math.abs(areas.b - 3000) < 0.001);
  assert.ok(Math.abs(areas.c - 2000) < 0.001);
  assert.ok(tiles.every((tile) => tile.x >= 0 && tile.y >= 0 && tile.x + tile.width <= 100.0001 && tile.y + tile.height <= 100.0001));
});
