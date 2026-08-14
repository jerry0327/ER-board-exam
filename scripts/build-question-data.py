#!/usr/bin/env python3
"""Build browser-friendly, chunked question-bank data from the source archive.

The source Markdown is intentionally preserved from the official-answer section
onward. Metadata that is useful for navigation is normalized into the index,
while repetitive authoring metadata is left out of the browser payload.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, ImageOps


META_RE = re.compile(r"^- ([a-z_]+):\s*(.*)$", re.MULTILINE)
TITLE_RE = re.compile(r"^#\s+([^|\n]+?)\s*\|\s*(.+?)\s*$", re.MULTILINE)
OPTION_RE = re.compile(r"^([A-F])\.\s*(.+?)(?=\n[A-F]\.\s|\Z)", re.MULTILINE | re.DOTALL)

TEXTBOOK_LOCATOR_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "textbook-locators.v1.json"
TEXTBOOK_META_FIELDS = (
    "project_tags",
    "clinical_tags",
    "chapter_tags",
    "source_locator_tags",
    "exam_concept_tags",
    "search_keywords",
    "additional_tags",
)
TINTINALLI_9E_RE = re.compile(
    r"Tintinalli[^\n]{0,130}\b(?:9e|9th\s+ed(?:ition)?)\b",
    re.IGNORECASE,
)
TEXTBOOK_CONTEXT_RE = re.compile(
    r"Tintinalli|\b(?:Section|CH\.?|Chapter)\s*\d|\bBack\s+Index\b",
    re.IGNORECASE,
)
SECTION_LOCATOR_RE = re.compile(r"\bSection\s+(\d{1,2})(?:\D|$)", re.IGNORECASE)
CHAPTER_LOCATOR_RE = re.compile(
    r"\b(?:CH\.?|Chapter)\s*[:.]?\s*(\d{1,3})(?:\D|$)",
    re.IGNORECASE,
)
TABLE_LOCATOR_RE = re.compile(r"\bTables?\s+(\d{1,3}-\d+[A-Za-z]?)", re.IGNORECASE)
FIGURE_LOCATOR_RE = re.compile(r"\bFigures?\s+(\d{1,3}-\d+[A-Za-z]?)", re.IGNORECASE)
PAGE_RANGE_BEGIN_RE = re.compile(
    r"\bprint\s+page\s+range\s+beginning\s+around\s+p?\.?\s*(?P<start>\d{1,4})",
    re.IGNORECASE,
)
PRINT_PAGE_LIST_RE = re.compile(
    r"\b(?:relevant\s+)?print\s+pages?\s*:\s*(?:pp?\.\s*)?"
    r"(?P<body>\d{1,4}(?:\s*[-–—~～]\s*\d{1,4})?"
    r"(?:\s*[,，、]\s*\d{1,4}(?:\s*[-–—~～]\s*\d{1,4})?)+)",
    re.IGNORECASE,
)
PAGE_LIST_ITEM_RE = re.compile(
    r"(?P<start>\d{1,4})(?:\s*[-–—~～]\s*(?P<end>\d{1,4}))?"
)
PRINT_PAGE_RE = re.compile(
    r"\bprint\s+(?:pp?\.?|pages?)\s*"
    r"(?P<modifier>approximately|approx(?:imately)?\.?|around|about|circa|starts?\s+at|約)?\s*"
    r"(?:pp?\.?\s*)?(?P<start>\d{1,4})"
    r"(?:\s*(?:[-–—~～]|to|至)\s*(?:pp?\.?\s*)?(?P<end>\d{1,4}))?",
    re.IGNORECASE,
)
PAGE_COLON_RE = re.compile(
    r"\bpages?\s*[:：]\s*(?P<start>\d{1,4})"
    r"(?:\s*(?:[-–—~～]|to|至)\s*(?P<end>\d{1,4}))?",
    re.IGNORECASE,
)
P_DOT_RE = re.compile(
    r"(?<![\w])pp?\.\s*(?P<start>\d{1,4})"
    r"(?:\s*(?:[-–—~～]|to|至)\s*(?:pp?\.?\s*)?(?P<end>\d{1,4}))?",
    re.IGNORECASE,
)
PAGE_WORD_RE = re.compile(
    r"\bpages?\s+(?P<start>\d{1,4})"
    r"(?:\s*(?:[-–—~～]|to|至)\s*(?P<end>\d{1,4}))?",
    re.IGNORECASE,
)
PUBLIC_TAG_LOCATOR_RE = re.compile(
    r"(?:"
    r"\bprint\s+(?:pp?\.?|pages?)\b"
    r"|\bpages?\s*[:：]\s*\d"
    r"|(?<![\w])pp?\.\s*\d"
    r"|\bpages?\s+(?:(?:approximately|approx(?:imately)?\.?|around|about|starts?\s+at|約)\s*)?"
    r"(?:pp?\.?\s*)?\d"
    r")",
    re.IGNORECASE,
)

QUESTION_REPAIRS = {
    "113-Q037": Path(__file__).with_name("question-repairs") / "113-Q037.normalized.final.md",
}

# Guard against silently applying a stale repair if a future source archive
# corrects the mismatched Markdown itself.
REPAIR_ARCHIVE_MARKERS = {
    "113-Q037": ("Scleroderma renal crisis", "Captopril"),
}


def compact(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def between(text: str, start: str, end: str | None = None) -> str:
    try:
        value = text.split(start, 1)[1]
    except IndexError:
        return ""
    if end and end in value:
        value = value.split(end, 1)[0]
    return value.strip()


def split_tags(value: str) -> list[str]:
    seen: set[str] = set()
    tags: list[str] = []
    for part in re.split(r"\s*;\s*", value):
        item = compact(part)
        key = item.casefold()
        if item and key not in seen:
            seen.add(key)
            tags.append(item)
    return tags


def _overlaps(span: tuple[int, int], occupied: list[tuple[int, int]]) -> bool:
    return any(span[0] < end and span[1] > start for start, end in occupied)


def _source_locator_context(value: str) -> dict[str, list[object]]:
    return {
        "chapters": sorted({int(match) for match in CHAPTER_LOCATOR_RE.findall(value)}),
        "sections": sorted({int(match) for match in SECTION_LOCATOR_RE.findall(value)}),
        "tables": sorted(set(TABLE_LOCATOR_RE.findall(value))),
        "figures": sorted(set(FIGURE_LOCATOR_RE.findall(value))),
    }


def _page_relation(modifier: str | None) -> str:
    value = compact(modifier or "").casefold()
    if value.startswith("start"):
        return "starts_at"
    if value:
        return "approximate"
    return "exact"


def _page_entry(
    source_field: str,
    source_value: str,
    raw: str,
    start: int,
    end: int | None,
    relation: str,
) -> dict[str, object]:
    context = _source_locator_context(source_value)
    return {
        "pageStart": start,
        "pageEnd": None if relation == "starts_at" else (end or start),
        "relation": relation,
        "raw": compact(raw),
        "field": source_field,
        "localChapters": context["chapters"],
        "localSections": context["sections"],
        "tables": context["tables"],
        "figures": context["figures"],
    }


def extract_page_entries(
    source_field: str,
    source_value: str,
    *,
    allow_contextual_p: bool = False,
    allow_contextual_page_word: bool = False,
) -> list[dict[str, object]]:
    """Extract page locators from one metadata tag or one reference bullet.

    Running on bounded source fragments is intentional: a whole-document
    regex can combine a textbook page on one line with a year on the next.
    """
    value = unicodedata.normalize("NFKC", source_value)
    occupied: list[tuple[int, int]] = []
    entries: list[dict[str, object]] = []

    for match in PAGE_RANGE_BEGIN_RE.finditer(value):
        occupied.append(match.span())
        entries.append(_page_entry(
            source_field,
            value,
            match.group(0),
            int(match.group("start")),
            None,
            "starts_at",
        ))

    for match in PRINT_PAGE_LIST_RE.finditer(value):
        if _overlaps(match.span(), occupied):
            continue
        occupied.append(match.span())
        for item in PAGE_LIST_ITEM_RE.finditer(match.group("body")):
            entries.append(_page_entry(
                source_field,
                value,
                item.group(0),
                int(item.group("start")),
                int(item.group("end")) if item.group("end") else None,
                "exact",
            ))

    for match in PRINT_PAGE_RE.finditer(value):
        if _overlaps(match.span(), occupied):
            continue
        occupied.append(match.span())
        relation = _page_relation(match.group("modifier"))
        entries.append(_page_entry(
            source_field,
            value,
            match.group(0),
            int(match.group("start")),
            int(match.group("end")) if match.group("end") else None,
            relation,
        ))

    for match in PAGE_COLON_RE.finditer(value):
        if _overlaps(match.span(), occupied):
            continue
        occupied.append(match.span())
        entries.append(_page_entry(
            source_field,
            value,
            match.group(0),
            int(match.group("start")),
            int(match.group("end")) if match.group("end") else None,
            "exact",
        ))

    # A bare `p.` or `pages` is normally accepted only when the same bounded
    # source fragment identifies Tintinalli or a textbook section/chapter.
    # Metadata can opt into narrowly scoped field/document context below; the
    # references parser deliberately cannot, keeping AHA, ACEP, CDC, and
    # official-exam PDF pages out of the textbook map.
    has_local_context = bool(TEXTBOOK_CONTEXT_RE.search(value))
    contextual_patterns: list[re.Pattern[str]] = []
    if has_local_context or allow_contextual_p:
        contextual_patterns.append(P_DOT_RE)
    if has_local_context or allow_contextual_page_word:
        contextual_patterns.append(PAGE_WORD_RE)
    for pattern in contextual_patterns:
        for match in pattern.finditer(value):
            if _overlaps(match.span(), occupied):
                continue
            occupied.append(match.span())
            entries.append(_page_entry(
                source_field,
                value,
                match.group(0),
                int(match.group("start")),
                int(match.group("end")) if match.group("end") else None,
                "exact",
            ))

    return entries


def extract_textbook_locators(text: str, meta: dict[str, str]) -> list[dict[str, object]]:
    document_chapters = sorted({int(match) for match in CHAPTER_LOCATOR_RE.findall(text)})
    document_sections = sorted({int(match) for match in SECTION_LOCATOR_RE.findall(text)})
    has_textbook_context = bool(document_chapters or TINTINALLI_9E_RE.search(text))
    if not has_textbook_context:
        return []

    entries: list[dict[str, object]] = []
    for field in TEXTBOOK_META_FIELDS:
        field_value = meta.get(field, "")
        field_names_tintinalli = bool(re.search(r"\bTintinalli\b", field_value, re.IGNORECASE))
        for tag in split_tags(field_value):
            entries.extend(extract_page_entries(
                f"metadata.{field}",
                tag,
                # Some generated metadata splits `Tintinalli; CH 173; p.1881`
                # into separate semicolon tags. A bare p./pp. remains safe when
                # that question has a mapped textbook chapter. Do not extend
                # the same inference to references or generic `page 11` tags.
                allow_contextual_p=bool(document_chapters),
                allow_contextual_page_word=field_names_tintinalli,
            ))

    references = between(text, "## 9. 參考資料")
    for line in references.splitlines():
        if line.strip():
            entries.extend(extract_page_entries("references", line))

    grouped: dict[tuple[int, int | None, str], dict[str, object]] = {}
    for entry in entries:
        start = int(entry["pageStart"])
        end = entry["pageEnd"]
        if start < 1 or start > 2200 or (end is not None and (int(end) < start or int(end) > 2200)):
            continue
        key = (start, int(end) if end is not None else None, str(entry["relation"]))
        target = grouped.setdefault(key, {
            "chapters": set(),
            "sections": set(),
            "tables": set(),
            "figures": set(),
            "evidence": set(),
        })
        target["chapters"].update(entry["localChapters"])
        target["sections"].update(entry["localSections"])
        target["tables"].update(entry["tables"])
        target["figures"].update(entry["figures"])
        target["evidence"].add((str(entry["field"]), str(entry["raw"])))

    edition_basis = "explicit" if TINTINALLI_9E_RE.search(text) else "corpus-inferred"
    locators: list[dict[str, object]] = []
    for (start, end, relation), grouped_entry in sorted(
        grouped.items(),
        key=lambda item: (item[0][0], item[0][1] or 9999, item[0][2]),
    ):
        local_chapters = sorted(grouped_entry["chapters"])
        candidate_chapters = local_chapters or document_chapters
        local_sections = sorted(grouped_entry["sections"])
        candidate_sections = local_sections or document_sections
        width = 0 if end is None else end - start
        if relation != "exact" or width > 20:
            confidence = "low"
        elif edition_basis != "explicit" or len(candidate_chapters) != 1:
            confidence = "medium"
        else:
            confidence = "high"

        locator: dict[str, object] = {
            "bookId": "tintinalli-em-9e-print",
            "pageStart": start,
            "pageEnd": end,
            "relation": relation,
            "granularity": "open-ended" if end is None else (
                "section-range" if width > 20 else ("page" if width == 0 else "page-range")
            ),
            "section": candidate_sections[0] if len(candidate_sections) == 1 else None,
            "chapter": candidate_chapters[0] if len(candidate_chapters) == 1 else None,
            "candidateChapters": candidate_chapters,
            "editionBasis": edition_basis,
            "confidence": confidence,
            "evidence": [
                {"field": field, "raw": raw}
                for field, raw in sorted(grouped_entry["evidence"])
            ],
        }
        if grouped_entry["tables"]:
            locator["tables"] = sorted(grouped_entry["tables"])
        if grouped_entry["figures"]:
            locator["figures"] = sorted(grouped_entry["figures"])
        locators.append(locator)
    return locators


def contains_public_locator(tag: str) -> bool:
    value = unicodedata.normalize("NFKC", tag)
    if PUBLIC_TAG_LOCATOR_RE.search(value):
        return True
    # A few source tags flatten a comma-separated page list into bare numeric
    # fragments (for example `1429; 1432–1433`). Those fragments have no
    # useful standalone meaning in the public tag UI.
    return bool(re.fullmatch(r"\d{1,4}(?:\s*[-–—~～]\s*\d{1,4})?", value))


CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("兒科急症", ("pediatric", "pediatrics", "child", "infant", "neonat")),
    ("婦產科急症", ("obstetric", "gynecology", "pregnan", "postpartum", "pelvic inflammatory", "vaginal")),
    ("毒物學", ("toxicology", "toxin", "poison", "overdose", "envenomation", "dyshemoglobin")),
    ("環境急症", ("environmental", "heat illness", "hypothermia", "drowning", "altitude", "diving")),
    ("外傷", ("trauma", "burn", "wound", "hemorrhage", "blunt", "penetrating")),
    ("骨科急症", ("orthopedic", "fracture", "dislocation", "compartment syndrome", "tendon")),
    ("心血管急症", ("cardiovascular", "cardiac", "coronary", "arrhythm", "aortic", "heart failure", "shock")),
    ("呼吸急症", ("respiratory", "pulmonary", "asthma", "copd", "pneumonia", "ventilat", "airway")),
    ("神經急症", ("neurolog", "stroke", "seizure", "headache", "mening", "spinal cord")),
    ("腸胃與肝膽", ("gastro", "hepat", "bowel", "abdominal", "pancrea", "esoph", "intestinal")),
    ("腎臟與泌尿", ("renal", "urolog", "kidney", "urinary", "dialysis", "genital")),
    ("內分泌與代謝", ("endocrine", "diabet", "thyroid", "adrenal", "electrolyte", "metabolic")),
    ("感染症", ("infectious", "infection", "sepsis", "antibiotic", "fever", "hiv", "tuberculosis")),
    ("血液與腫瘤", ("hematolog", "oncolog", "anemia", "coag", "thrombo", "neutropen")),
    ("眼耳鼻喉與牙科", ("ophthalm", "ocular", "eye", "otolaryng", "ear", "nose", "dental", "oral")),
    ("皮膚急症", ("dermatolog", "skin", "rash", "urticaria")),
    ("精神與行為", ("psychiatr", "behavior", "suicide", "agitation")),
    ("急救與災難醫學", ("resuscitation", "cardiac arrest", "ems", "disaster", "prehospital", "chemical disaster")),
    ("高齡與特殊族群", ("geriatric", "elderly", "older adult", "immunocompromised")),
]

SECTION_LABELS = {
    1: "到院前照護",
    2: "災難醫學",
    3: "急救復甦",
    4: "急救處置與技術",
    5: "止痛與鎮靜",
    6: "傷口照護",
    7: "心血管急症",
    8: "呼吸急症",
    9: "腸胃與肝膽",
    10: "腎臟與泌尿",
    11: "婦產科急症",
    12: "兒科急症",
    13: "感染症",
    14: "神經急症",
    15: "毒物學",
    16: "環境急症",
    17: "內分泌與代謝",
    18: "血液與腫瘤",
    19: "眼耳鼻喉與牙科",
    20: "皮膚急症",
    21: "外傷",
    22: "骨科急症",
    23: "肌肉骨骼疾病",
    24: "精神與行為",
    25: "虐待與暴力",
    26: "特殊情境",
}


def source_sections(meta: dict[str, str]) -> list[int]:
    """Extract only explicit Tintinalli section locators from chapter metadata."""
    sections: list[int] = []
    for tag in split_tags(meta.get("chapter_tags", "")):
        match = re.match(r"^Section\s+(\d{1,2})(?:\D|$)", tag, re.I)
        if not match:
            continue
        value = int(match.group(1))
        if value in SECTION_LABELS and value not in sections:
            sections.append(value)
    return sections


def classify(tags: list[str], title: str, sections: list[int]) -> str:
    haystack = " ".join([title, *tags]).casefold()
    if sections:
        return SECTION_LABELS[sections[0]]
    for category, needles in CATEGORY_RULES:
        if any(needle in haystack for needle in needles):
            return category
    return "綜合急診醫學"


def content_fingerprint(stem: str, options: list[dict[str, str]]) -> str:
    value = " ".join([stem, *(option["text"] for option in options)])
    value = unicodedata.normalize("NFKC", value).casefold()
    value = "".join(char for char in value if unicodedata.category(char)[0] not in {"P", "S", "Z"})
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]


def evidence_key(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return "".join(
        char
        for char in value
        if char in {"%", "/"} or unicodedata.category(char)[0] not in {"P", "Z"}
    )


def validate_source_repair(
    outer: zipfile.ZipFile,
    docx_name: str,
    question: dict[str, object],
) -> None:
    """Prove repaired stem, options, and official answer still match the DOCX."""
    try:
        with zipfile.ZipFile(io.BytesIO(outer.read(docx_name))) as docx:
            root = ET.fromstring(docx.read("word/document.xml"))
    except (KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        raise RuntimeError(f"cannot validate source repair from {docx_name}") from error

    source_text = " ".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))
    source = evidence_key(source_text)
    claims = [
        ("source id", f"題號{str(question['id']).replace('-Q', '-')}"),
        ("stem", str(question["stem"])),
        *(
            (f"option {option['key']}", str(option["text"]))
            for option in question["options"]
        ),
    ]
    missing = [label for label, value in claims if evidence_key(value) not in source]
    answer_markers = [f"答案{key}" for key in question["answerKeys"]]
    if any(evidence_key(marker) not in source for marker in answer_markers):
        missing.append("official answer")
    if missing:
        raise RuntimeError(
            f"source repair {question['id']} does not match {docx_name}: {', '.join(missing)}"
        )


def exam_sort_key(exam: str) -> tuple[int, str]:
    match = re.match(r"(\d+)([AB]?)", exam)
    return (int(match.group(1)) if match else 999, match.group(2) if match else exam)


def exam_label(exam: str) -> str:
    match = re.match(r"(\d+)([AB]?)", exam)
    if not match:
        return exam
    suffix = f"・{match.group(2)}卷" if match.group(2) else ""
    return f"民國 {int(match.group(1))} 年{suffix}"


def answer_keys(raw: str, answer_text: str) -> tuple[list[str], bool]:
    combined = f"{raw} {answer_text}"
    all_credit = "全部給分" in combined or "all credit" in combined.casefold()
    keys: list[str] = []
    for value in re.findall(r"(?<![A-Za-z])([A-F])(?![A-Za-z])", raw.upper()):
        if value not in keys:
            keys.append(value)
    if not keys and not all_credit:
        first = re.match(r"\s*([A-F])(?:\.|、|，|,|$)", answer_text.upper())
        if first:
            keys = [first.group(1)]
    return keys, all_credit


def extract_images(
    outer: zipfile.ZipFile,
    docx_name: str,
    question_id: str,
    image_dir: Path,
) -> list[str]:
    try:
        docx_bytes = outer.read(docx_name)
    except KeyError:
        return []

    try:
        docx = zipfile.ZipFile(io.BytesIO(docx_bytes))
    except zipfile.BadZipFile:
        return []

    media = sorted(name for name in docx.namelist() if name.startswith("word/media/"))
    results: list[str] = []
    for index, media_name in enumerate(media, start=1):
        try:
            raw = docx.read(media_name)
            with Image.open(io.BytesIO(raw)) as source:
                image = ImageOps.exif_transpose(source)
                if image.mode not in ("RGB", "RGBA"):
                    image = image.convert("RGBA" if "transparency" in image.info else "RGB")
                image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                target = image_dir / f"{question_id}-{index}.webp"
                image.save(target, "WEBP", quality=84, method=6)
                results.append(f"/data/images/{target.name}")
        except Exception:
            # A broken or unsupported embedded asset should not block 3,320
            # otherwise usable questions.
            continue
    return results


def parse_question(
    outer: zipfile.ZipFile,
    name: str,
    image_dir: Path,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    archive_text = (
        outer.read(name)
        .decode("utf-8-sig", errors="replace")
        .replace("\r\n", "\n")
    )
    archive_question_id = Path(name).name.split(".normalized.final.md", 1)[0]
    repair_path = QUESTION_REPAIRS.get(archive_question_id)
    repaired = repair_path is not None
    if repair_path is not None:
        missing_markers = [
            marker
            for marker in REPAIR_ARCHIVE_MARKERS[archive_question_id]
            if marker.casefold() not in archive_text.casefold()
        ]
        if missing_markers:
            raise RuntimeError(
                f"archive content changed for {archive_question_id}; review or remove its local repair"
            )
        text = repair_path.read_text(encoding="utf-8")
        missing_sections = [section for section in range(1, 10) if f"## {section}." not in text]
        if missing_sections:
            raise RuntimeError(
                f"source repair {archive_question_id} is missing sections: {missing_sections}"
            )
    else:
        text = archive_text

    # React Markdown correctly blocks raw HTML. Preserve source strings that
    # merely look like tags (one legacy question contains literal <C>ABCDE).
    text = re.sub(r"<([A-F])>", r"&lt;\1&gt;", text)
    meta = {key: compact(value) for key, value in META_RE.findall(text)}
    title_match = TITLE_RE.search(text)
    if not title_match:
        raise ValueError(f"Missing title: {name}")

    question_id = compact(meta.get("question_id", title_match.group(1)))
    exam = question_id.split("-Q", 1)[0]
    number_match = re.search(r"-Q(\d+)$", question_id)
    number = int(number_match.group(1)) if number_match else 0
    title = compact(title_match.group(2))

    question_block = between(text, "## 2. 題幹重建", "## 3. 官方答案")
    stem = compact(between(question_block, "### 題幹", "### 選項"))
    raw_options = between(question_block, "### 選項")
    options = [
        {"key": key, "text": compact(value)}
        for key, value in OPTION_RE.findall(raw_options)
    ]

    answer_section = between(text, "## 3. 官方答案", "## 4. 考場解題路徑")
    answer_markdown = between(answer_section, "### 官方答案", "### 題型")
    answer_text = compact(answer_markdown)
    keys, all_credit = answer_keys(meta.get("official_answer", ""), answer_text)

    tag_fields = ("project_tags", "clinical_tags", "chapter_tags", "exam_concept_tags", "search_keywords")
    tags: list[str] = []
    seen: set[str] = set()
    for field in tag_fields:
        for tag in split_tags(meta.get(field, "")):
            key = tag.casefold()
            if key not in seen:
                seen.add(key)
                tags.append(tag)

    body_start = text.find("## 3. 官方答案")
    explanation = text[body_start:].strip() if body_start >= 0 else ""
    source_id = meta.get("source_id", question_id.replace("-Q", "-"))
    docx_name = f"EXTRACTED_QUESTION_DOCX/{exam}/{source_id}.docx"
    images = extract_images(outer, docx_name, question_id, image_dir)

    sections = source_sections(meta)
    category = classify(tags, title, sections)
    short_tags = []
    for tag in tags:
        if (
            len(tag) <= 72
            and not contains_public_locator(tag)
            and not re.search(r"(?:chapter:|table \d)", tag, re.I)
        ):
            short_tags.append(tag)
        if len(short_tags) >= 14:
            break

    question = {
        "id": question_id,
        "exam": exam,
        "year": int(meta.get("source_year", re.match(r"\d+", exam).group(0))),
        "number": number,
        "title": title,
        "contentHash": content_fingerprint(stem, options),
        "stem": stem,
        "options": options,
        "answerKeys": keys,
        "answerText": answer_text,
        "allCredit": all_credit,
        "questionType": meta.get("question_type", "一般選擇題"),
        "focus": meta.get("exam_focus", category),
        "category": category,
        "tags": short_tags,
        "sourceSections": sections,
        "images": images,
        "explanation": explanation,
    }
    if repaired:
        validate_source_repair(outer, docx_name, question)
    return question, extract_textbook_locators(text, meta)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/data"))
    parser.add_argument("--textbook-output", type=Path, default=TEXTBOOK_LOCATOR_OUTPUT)
    args = parser.parse_args()

    output = args.output.resolve()
    textbook_output = args.textbook_output.resolve()
    try:
        textbook_output.relative_to(output)
    except ValueError:
        pass
    else:
        raise ValueError("textbook locator data must remain outside the public output directory")
    questions_dir = output / "questions"
    images_dir = output / "images"
    # Rebuild only the assets owned by this script. Optional sidecar datasets
    # (for example explanation-packs) must survive a base question rebuild.
    for owned_dir in (questions_dir, images_dir):
        if owned_dir.exists():
            shutil.rmtree(owned_dir)
    for owned_file in (
        output / "manifest.json",
        output / "index.json",
        output / "startup-index.json",
        output / "search.json",
    ):
        if owned_file.exists():
            owned_file.unlink()
    questions_dir.mkdir(parents=True)
    images_dir.mkdir(parents=True)

    groups: dict[str, list[dict[str, object]]] = defaultdict(list)
    category_counts: Counter[str] = Counter()
    source_section_counts: Counter[int] = Counter()
    validation: Counter[str] = Counter()
    textbook_questions: dict[str, list[dict[str, object]]] = {}

    with zipfile.ZipFile(args.archive) as outer:
        names = [
            name
            for name in outer.namelist()
            if name.startswith("FINAL_MD/") and name.endswith(".normalized.final.md")
        ]
        names.sort(key=lambda value: (
            exam_sort_key(Path(value).name.split("-Q", 1)[0]),
            int(re.search(r"-Q(\d+)", value).group(1)),
        ))

        for position, name in enumerate(names, start=1):
            question, textbook_locators = parse_question(outer, name, images_dir)
            if textbook_locators:
                textbook_questions[str(question["id"])] = textbook_locators
            groups[str(question["exam"])].append(question)
            category_counts[str(question["category"])] += 1
            source_section_counts.update(question["sourceSections"])
            validation["questions"] += 1
            validation["options"] += len(question["options"])
            validation["withImages"] += bool(question["images"])
            validation["imageAssets"] += len(question["images"])
            validation["multiAnswer"] += len(question["answerKeys"]) > 1 and not bool(question["allCredit"])
            validation["allCredit"] += bool(question["allCredit"])
            validation["missingStem"] += not bool(question["stem"])
            validation["missingOptions"] += not bool(question["options"])
            validation["missingAnswer"] += not bool(question["answerKeys"]) and not bool(question["allCredit"])
            validation["missingExplanation"] += not bool(question["explanation"])
            validation["quarantined"] += question.get("qualityStatus") == "source-mismatch"
            if position % 250 == 0:
                print(f"parsed {position}/{len(names)}", flush=True)

    expected_validation = {
        "questions": 3320,
        "options": 14800,
        "withImages": 167,
        "imageAssets": 180,
        "multiAnswer": 20,
        "allCredit": 6,
        "missingStem": 0,
        "missingOptions": 0,
        "missingAnswer": 0,
        "missingExplanation": 0,
        "quarantined": 0,
    }
    mismatches = {
        key: {"expected": expected, "actual": validation[key]}
        for key, expected in expected_validation.items()
        if validation[key] != expected
    }
    if mismatches:
        raise RuntimeError(f"archive validation failed: {json.dumps(mismatches, ensure_ascii=False)}")

    duplicates: dict[str, list[dict[str, object]]] = defaultdict(list)
    for questions in groups.values():
        for question in questions:
            duplicates[str(question["contentHash"])].append(question)
    for fingerprint, members in duplicates.items():
        if len(members) > 1:
            canonical = sorted(members, key=lambda item: (exam_sort_key(str(item["exam"])), int(item["number"])))[0]
            for member in members:
                member["duplicateGroup"] = fingerprint
                member["canonicalId"] = canonical["id"]

    light_index: list[dict[str, object]] = []
    search_index: list[list[str]] = []
    group_manifest: list[dict[str, object]] = []
    question_revision_entries: list[tuple[str, bytes]] = []
    for exam in sorted(groups, key=exam_sort_key):
        questions = sorted(groups[exam], key=lambda question: int(question["number"]))
        exam_dir = questions_dir / exam
        exam_dir.mkdir(parents=True, exist_ok=True)
        group_manifest.append({
            "id": exam,
            "label": exam_label(exam),
            "count": len(questions),
            "file": f"/data/questions/{exam}/",
        })
        for question in questions:
            logical_path = f"data/questions/{exam}/{question['id']}.json"
            question_bytes = json.dumps(
                question, ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8")
            (exam_dir / f"{question['id']}.json").write_bytes(question_bytes)
            question_revision_entries.append((logical_path, question_bytes))
            light_index.append({
                key: question[key]
                for key in (
                    "id", "exam", "year", "number", "title", "stem", "answerKeys",
                    "allCredit", "questionType", "focus", "category", "sourceSections", "images",
                )
            })
            search_index.append([
                str(question["id"]),
                compact(" ".join([
                    str(question["focus"]),
                    *(str(tag) for tag in question["tags"]),
                    *(str(option["text"]) for option in question["options"]),
                ])),
            ])
            if "qualityStatus" in question:
                light_index[-1]["qualityStatus"] = question["qualityStatus"]
                light_index[-1]["excludedFromPractice"] = question.get("excludedFromPractice", False)
            if "duplicateGroup" in question:
                light_index[-1]["duplicateGroup"] = question["duplicateGroup"]
                light_index[-1]["canonicalId"] = question["canonicalId"]

    categories = [
        {"id": name, "count": count}
        for name, count in category_counts.most_common()
    ]
    sections = [
        {"id": section, "label": SECTION_LABELS[section], "count": source_section_counts[section]}
        for section in sorted(source_section_counts)
    ]
    source_hash = hashlib.sha256(args.archive.read_bytes()).hexdigest()[:16]
    all_textbook_locators = [
        locator
        for locators in textbook_questions.values()
        for locator in locators
    ]
    textbook_validation = {
        "questionsWithLocators": len(textbook_questions),
        "questionsWithoutLocators": validation["questions"] - len(textbook_questions),
        "explicitEditionQuestions": sum(
            bool(locators and locators[0]["editionBasis"] == "explicit")
            for locators in textbook_questions.values()
        ),
        "inferredEditionQuestions": sum(
            bool(locators and locators[0]["editionBasis"] == "corpus-inferred")
            for locators in textbook_questions.values()
        ),
        "approximateOrOpenEndedQuestions": sum(
            any(locator["relation"] != "exact" for locator in locators)
            for locators in textbook_questions.values()
        ),
        "wideRangeQuestions": sum(
            any(locator["granularity"] == "section-range" for locator in locators)
            for locators in textbook_questions.values()
        ),
        "minimumPage": min(int(locator["pageStart"]) for locator in all_textbook_locators),
        "maximumPage": max(
            int(locator["pageEnd"] if locator["pageEnd"] is not None else locator["pageStart"])
            for locator in all_textbook_locators
        ),
    }
    expected_textbook_validation = {
        "questionsWithLocators": 2278,
        "questionsWithoutLocators": 1042,
        "explicitEditionQuestions": 1970,
        "inferredEditionQuestions": 308,
        "approximateOrOpenEndedQuestions": 14,
        "wideRangeQuestions": 65,
        "minimumPage": 1,
        "maximumPage": 2114,
    }
    textbook_mismatches = {
        key: {"expected": expected, "actual": textbook_validation[key]}
        for key, expected in expected_textbook_validation.items()
        if textbook_validation[key] != expected
    }
    if textbook_mismatches:
        raise RuntimeError(
            "textbook locator validation failed: "
            f"{json.dumps(textbook_mismatches, ensure_ascii=False)}"
        )

    textbook_payload = {
        "schemaVersion": 1,
        "sourceHash": source_hash,
        "books": {
            "tintinalli-em-9e-print": {
                "title": "Tintinalli’s Emergency Medicine: A Comprehensive Study Guide",
                "edition": 9,
                "pagination": "print",
            },
        },
        "validation": textbook_validation,
        "questions": textbook_questions,
    }
    textbook_output.parent.mkdir(parents=True, exist_ok=True)
    textbook_output.write_text(
        json.dumps(textbook_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    manifest = {
        "title": "急專補給站",
        "totalQuestions": len(light_index),
        "totalExplanations": len(light_index) - validation["quarantined"],
        "sourceHash": source_hash,
        "groups": group_manifest,
        "categories": categories,
        "sourceSections": sections,
        "validation": dict(validation),
        "duplicateGroups": sum(1 for members in duplicates.values() if len(members) > 1),
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    question_revision_hash = hashlib.sha256()
    for logical_path, question_bytes in sorted(question_revision_entries):
        question_revision_hash.update(logical_path.encode("utf-8"))
        question_revision_hash.update(b"\0")
        question_revision_hash.update(str(len(question_bytes)).encode("ascii"))
        question_revision_hash.update(b"\0")
        question_revision_hash.update(question_bytes)
        question_revision_hash.update(b"\0")
    question_data_revision = question_revision_hash.hexdigest()

    (output / "index.json").write_text(
        json.dumps({
            "questionDataRevision": question_data_revision,
            "questions": light_index,
        }, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    startup_fields = (
        "id", "exam", "year", "number", "allCredit", "category",
        "canonicalId", "excludedFromPractice",
    )
    startup_index = [
        {key: question[key] for key in startup_fields if key in question}
        for question in light_index
    ]
    (output / "startup-index.json").write_text(
        json.dumps({
            "questionDataRevision": question_data_revision,
            "questions": startup_index,
        }, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output / "search.json").write_text(
        json.dumps({"questions": search_index}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
