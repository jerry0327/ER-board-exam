const KNOWN_STRUCTURED_LABELS = new Set([
  "判斷", "理由", "陷阱／修正", "陷阱修正", "修正",
  "變形／適用條件", "變形", "適用條件", "補充",
]);

export function isStructuredLabelText(value: string) {
  const text = value.trim();
  const label = text.replace(/[：:]$/u, "").trim();
  if (!label || label.length > 32) return false;
  return /[：:]$/u.test(text) || KNOWN_STRUCTURED_LABELS.has(label);
}
