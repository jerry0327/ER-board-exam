/**
 * Question stems are source text, not Markdown. Some archived questions still
 * contain authoring delimiters; keep their meaning without rendering markup.
 */
function stripEditorialNotes(value: string) {
  const inlineNote = value.search(/\s+(?:\*\*圖片\*\*\s*)?>\s*(?=(?:\*\*)?(?:註[：:]|原題|原始|題目中文|題幹原文|題目所附|圖片註記|本次|本輸入|本解析))/u);
  let result = inlineNote >= 0 ? value.slice(0, inlineNote) : value;

  const directImageNote = result.search(/\s+(?:\*\*)?(?:(?:題目)?圖片|原題(?:含[^：:\n]{0,20}圖片|圖像與資料重建)|圖像描述(?:（[^）\n]{0,80}）|\([^\)\n]{0,80}\))?)\s*[：:](?:\*\*)?/u);
  if (directImageNote >= 0) result = result.slice(0, directImageNote);

  const editorialSection = result.search(/(?<=[\s。；;])(?:\*\*)?(?:#{2,6}\s+\S|題圖(?:為|顯示|重點(?:應保守理解為)?\s*[：:]?)|圖中(?:重點(?:為)?\s*[：:]?|可見)|圖示重點(?:可讀為)?\s*[：:]?|圖片重點\s*[：:]?|(?:影像|圖像)(?:重點|重建|提示)\s*[：:]?|心電圖(?:重點|資訊|監視器波形可保守描述為)\s*[：:]?|本題\s+ECG\b|圖片補充描述\s*[：:]?|原題(?:附|\s+ECG)|原始(?:題本|圖像(?:為|顯示))|本次已查到|官方(?:題圖|題本附圖))(?:\*\*)?/iu);
  if (editorialSection >= 0) {
    const note = result.slice(editorialSection);
    const resumedStem = note.match(/[。！？]\s*((?:抽血檢查發現|下列(?:關於)?|有關(?:於)?|關於|請問|問[：:])[\s\S]*)$/u)?.[1] ?? "";
    result = `${result.slice(0, editorialSection).trimEnd()}${resumedStem ? ` ${resumedStem}` : ""}`;
  }

  if (/^>\s*(?=(?:\*\*)?(?:註[：:]|原題|原始|題目中文|題幹原文|題目所附|圖片註記|本次|本輸入|本解析))/u.test(result)) {
    const withoutMarker = result.replace(/^>\s*/u, "");
    const originalStem = withoutMarker.match(/[。！？?]\s+((?:\d{1,3}\s*歲|一位|一名|有關|關於|下列)[\s\S]*)$/u);
    result = originalStem?.[1] ?? withoutMarker;
  } else {
    result = result.replace(/^>\s*(?=\S)/u, "");
  }
  return result
    .replace(/^\d{3}[AB]?\s*年度第\s*\d+\s*題[。．]\s*/u, "")
    .replace(
      /^(?:(?:本題為|本題未提供|題目未提供)[^。！？\n]*[。！？]\s*)(?=(?:關於|對於|下列|根據))/u,
      "",
    )
    .replace(/\s+(?:\*\*)?圖片(?:\*\*)?\s*$/u, "");
}

export function plainQuestionText(value: string) {
  return stripEditorialNotes(value)
    .replace(/(\d)\s*\*\s*(?=\d)/gu, "$1 × ")
    .replace(/[ \t]+\*[ \t]+(?=\S)/gu, "\n")
    .replace(/^\*[ \t]+(?=\S)/gmu, "")
    .replace(/\*/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/([^\s。！？?]{2,12}[?？])\s+\1$/u, "$1")
    .trim();
}
