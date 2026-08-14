import assert from "node:assert/strict";
import test from "node:test";
import { parseMedicalFlow } from "../app/lib/medical-flow.ts";

test("parses the real contamination decision into steps, discreet connectors, and two branches", () => {
  const parts = parseMedicalFlow(`Unknown biologic hazard：
暫採 standard + contact + airborne precautions
                         ↓
是否仍有 residual contamination？
  ├─ 有：入口外 controlled disrobing + soap/warm-water shower
  └─ 無：以 isolation／source control 為主
                         ↓
啟動 EOP incident-specific annex`);

  assert.deepEqual(parts, [
    { type: "step", lines: ["Unknown biologic hazard：", "暫採 standard + contact + airborne precautions"], question: false },
    { type: "connector", label: "" },
    { type: "step", lines: ["是否仍有 residual contamination？"], question: true },
    {
      type: "branches",
      nested: false,
      branches: [
        { depth: 0, label: "有", lines: ["入口外 controlled disrobing + soap/warm-water shower"] },
        { depth: 0, label: "無", lines: ["以 isolation／source control 為主"] },
      ],
    },
    { type: "connector", label: "" },
    { type: "step", lines: ["啟動 EOP incident-specific annex"], question: false },
  ]);
});

test("supports nested binary decisions without exposing tree glyphs", () => {
  const parts = parseMedicalFlow(`Brief resolved event
  ↓
仍有症狀或history/exam找到原因？
  ├─ Yes → 不是BRUE，依診斷處理
  └─ No  → 符合BRUE criteria？
            ├─ No → 依症狀/其他診斷處理
            └─ Yes → 是否全部lower-risk？
                      ├─ Yes → minimal testing + observation
                      └─ No  → targeted higher-risk evaluation`);
  const group = parts?.find((part) => part.type === "branches");
  assert.equal(group?.type, "branches");
  assert.equal(group.nested, true);
  assert.deepEqual(group.branches.map(({ depth, label }) => ({ depth, label })), [
    { depth: 0, label: "Yes" },
    { depth: 0, label: "No" },
    { depth: 1, label: "No" },
    { depth: 1, label: "Yes" },
    { depth: 2, label: "Yes" },
    { depth: 2, label: "No" },
  ]);
});

test("supports many branches and attaches vertical continuation lines to their parent", () => {
  const parts = parseMedicalFlow(`GI blood suspected
│
├─ Unstable / moderate-large ongoing bleed
│    ├─ ABC + IV/IO + crossmatch + blood products
│    ├─ Correct temperature/Ca/coagulation
│    └─ GI/surgery/PICU
│
└─ Stable
     → targeted evaluation`);
  const group = parts?.find((part) => part.type === "branches");
  assert.equal(group?.type, "branches");
  assert.equal(group.branches.length, 5);
  assert.equal(group.branches.at(-1)?.lines.at(-1), "targeted evaluation");
});

test("leaves source code and ordinary prose untouched", () => {
  assert.equal(parseMedicalFlow("胸痛 → ECG → 處置"), null);
  assert.equal(parseMedicalFlow("const next = () => {\n  return value;\n};\n↓\nend"), null);
});

test("supports timed connectors and horizontal split diagrams", () => {
  const timed = parseMedicalFlow(`Initial bite
↓ 數小時
Pain and swelling
↓ Day 3–4
Hemorrhagic blister`);
  assert.deepEqual(timed?.filter((part) => part.type === "connector"), [
    { type: "connector", label: "數小時" },
    { type: "connector", label: "Day 3–4" },
  ]);

  const horizontal = parseMedicalFlow(`Plain radiograph
┌────────┴─────────┐
Positive             Negative
↓                    ↓
Admit                CT or MRI`);
  const groups = horizontal?.filter((part) => part.type === "branches");
  assert.equal(groups?.length, 1);
  assert.deepEqual(groups?.[0].branches.map((branch) => branch.lines[0]), ["Positive", "Negative"]);
  assert.equal(JSON.stringify(horizontal).includes("┌"), false);
});
