# EM Board Exam — Version 1

Version 1 is the canonical starting point for this repository.

## Application

- Full application source under `app/`, `worker/`, `db/`, and supporting project files.
- Reproducible Node.js/Vinext build configuration and validation scripts.
- Question-bank, study, progress, annotation, document, and audio workflows are included.

## Learning and question content

The packed-content corpus contains 6,525 logical files:

- 3,374 structured data files.
- 3,076 study-guide files.
- 75 subtitle-runtime files stored inside content packs.

The question-bank runtime manifest contains 3,320 questions covering ROC years 94 through 115B (2005–2026).

## Audio assets

- 1,433 audio chapters.
- 2,875 managed audio assets.
- 173,665,746 bytes of validated SNAC chapter data.
- Static SNAC decoder/model/runtime assets required by the browser audio pipeline.

## Subtitle and section data assets

- 1,433 semantic subtitle pairs.
- 1,433 section-title locale pairs.
- 1,433 HXM timing / speaker / section sidecars.
- 74 HXT text bundles containing 31,371,708 bytes of text data.
- Runtime manifest SHA-256: `10792f9b1c7915654ed0d12f87d3bf7a9023d34485abe7907464dd291f9704b8`.

These files are retained as structured source assets for search, indexing, parsing, synchronization, and future product development.

## Validation

Repository CI checks source contracts and the integrity of the deployable asset set. Development-only tests that depend on external workspace fixtures skip explicitly when those fixtures are not present in a standalone checkout.
