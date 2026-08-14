import assert from "node:assert/strict";
import test from "node:test";
import { parseDecisionTree } from "../app/lib/decision-tree.ts";

test("turns an ASCII clinical algorithm into bounded hierarchy rows", () => {
  const rows = parseDecisionTree(`Tachycardia with pulse
├─ Unstable?
│  ├─ Yes → synchronized cardioversion
│  └─ No
├─ Narrow QRS?
│  └─ Wide QRS?`);
  assert.deepEqual(rows, [
    { level: 0, label: "Tachycardia with pulse", outcome: "", terminal: false },
    { level: 1, label: "Unstable?", outcome: "", terminal: false },
    { level: 2, label: "Yes", outcome: "synchronized cardioversion", terminal: true },
    { level: 2, label: "No", outcome: "", terminal: false },
    { level: 1, label: "Narrow QRS?", outcome: "", terminal: false },
    { level: 2, label: "Wide QRS?", outcome: "", terminal: true },
  ]);
});

test("leaves ordinary arrow prose alone", () => {
  assert.equal(parseDecisionTree("胸痛 → ECG → 處置"), null);
});

test("drops connector-only lines from the real tachycardia tree", () => {
  const rows = parseDecisionTree(`Tachycardia with pulse
│
├─ Unstable?
│  ├─ Yes → synchronized cardioversion
│  └─ No
│
├─ Narrow QRS?
│  ├─ Yes
│  │  ├─ Regular → vagal maneuvers → adenosine
│  │  └─ Irregular → AF/flutter/MAT
│  │
│  └─ Wide QRS?
│     ├─ Regular monomorphic → VT until proven otherwise
│     └─ Irregular wide → avoid AV nodal blockers`);
  assert.equal(rows?.length, 11);
  assert.equal(rows?.some((row) => row.label === "│" || !row.label), false);
});
