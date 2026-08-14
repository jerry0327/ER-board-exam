# Architecture

## Design goal

GitHub `main` is the canonical, recoverable source of truth for 急專補給站. ChatGPT Site, local IDEs, Codex, and future deployment platforms should consume or update the same version-controlled project rather than becoming independent master copies.

## Logical layers

```text
Browser / installed web app
        │
        ▼
app/                 UI, navigation, player, state, search
        │
        ├── content/     question bank + study-guide structured text
        ├── subtitles/   SRT / VTT / SRC and chapter metadata
        └── media/       manifests and references to audio / SMAC-SNAC assets

scripts/              import, validation, conversion, integrity checks
docs/                 architecture, recovery and maintenance documentation
archive/              non-canonical historical material
```

## Source-control rules

- Source code, Markdown, JSON, small data files, subtitles, manifests and small images belong in Git whenever redistribution rights permit.
- Large binary assets are not embedded repeatedly in Git history. They are referenced through versioned manifests and stored using GitHub Releases, Git LFS, or approved object storage according to `ASSET_STRATEGY.md`.
- Runtime code must not depend on a developer's local absolute path.
- Secrets are injected at deployment time and never stored in source control.
- Generated files should be reproducible from source where practical.

## Content model

Each learning object should eventually have a stable identifier independent of its display title. A manifest should be able to map that identifier to:

- collection / textbook / question-bank group
- chapter or question number
- title
- content path
- subtitle path
- media asset identifier
- duration where applicable
- version / checksum
- availability state

This allows the player and search UI to change without renaming the underlying educational corpus.

## Migration principle

When the current full project is supplied, preserve its working behavior first. Do not perform a speculative framework rewrite during import. Inventory the existing tree, establish a reproducible build, separate large/private assets, then refactor incrementally behind Git history.
