# Semantic subtitle runtime delivery

The website never deploys repeated raw `precision-src-v2` JSONL as its primary
subtitle asset. The editable and AI-handoff authority remains the exact `.src`
plus same-stem `subtitle-chapters-v1` JSON pair. Website runtime delivery is a
hash-bound reversible pair:

- HXT2: UTF-8 header, cue text and section titles; 10–20 chapter HXT bundles
  are Brotli q11 content-pack assets.
- HXM2: opaque binary 1 ms durations, sparse gaps, A/B runs, checkpoints and
  section cue indexes; one identity, content-addressed HXM sidecar per
  chapter.

Section boundaries are deployed as delta-coded 1-based cue starts. L1 stores
one start cue; `subsection` L2 stores one start-cue delta from its parent; a
Question Bank `topic_label` inherits its parent and stores no timing. The
runtime never repeats Section timestamp strings, millisecond start/end pairs,
or end-cue values. Exact start/end times are derived from the same lossless
HXM2 cue timeline already needed for subtitles. This preserves 1 ms accuracy
while keeping Section navigation smaller than a parallel timestamp payload.

The fixed-snapshot deployment benchmark confirms this choice across 1,372
exact pairs: cue-only boundaries total 45,938 bytes, delta-ms boundaries total
74,404 bytes, and repeated timestamp JSON totals 1,506,338 bytes. Every pair
passed exact canonical-byte, Section-partition, and 1 ms timing round-trip.
See `reports/section-boundary-deployment-benchmark-current/benchmark.json` at
the repository root; invalid/noncanonical pairs are separately fail-closed and
must be repaired or receive one final terminal disposition before deployment.

The loader reconstructs the canonical SRC and canonical player section JSON,
checks source/section/HXT/HXM SHA-256 bindings and CRC, then uses the normal
subtitle and chapter validators. An audio identity listed in
`terminal-unavailable.json` has no publishable subtitle/section pair, so the
runtime must keep subtitle/section data unavailable for that identity and must
never substitute content that is not bound to the current manifest.

## Why timing remains one sidecar per chapter

An HXT bundle is required in every first playback. Bundling HXM therefore does
not remove a first-play request; it instead brings unrelated high-entropy
timing bytes into the first transfer and expands the cache invalidation scope
when one chapter changes. Per-file HXM keeps a chapter correction local and is
safe for the expected full corpus asset count.

Run this after a new runtime-pack build to validate the choice against the
actual completed corpus:

```powershell
node ../../../scripts/benchmark_hxm_identity_delivery.mjs `
  <runtime-pack-dir> <scratch-semantic-content-root> <report.json>
```

The report compares per-file, 10-member and 20-member HXM identity delivery
using actual HXT q11 stored bytes. Do not treat an incomplete corpus snapshot
as a deployable pack or as a permanent size baseline.

## Warmup and deployment gates

On eligible learning-audio routes, the existing 900 ms idle warmup
best-effort fetches **only** `/subtitles-runtime/manifest.json`. It respects
visible-page, Save-Data and slow-connection guards. Because the Brotli index is
small, a capable mobile browser that does not expose `deviceMemory` may warm
the manifest; the much larger SNAC decoder still keeps its stricter resource
gate. This never prefetches HXT, HXM, raw SRC or section JSON. First playback
always performs the full hash and structural checks.

The importer refuses installation until the exact 1,433-audio disposition gate
passes: publishable HXT2/HXM2 pairs plus hash-bound terminal-unavailable
identities must equal `39/24/140/664/236/330` for
board-guides/ems/goldfrank/question-bank/rosens/tintinalli. The two sets must
be disjoint. A partial pack may only be checked with explicit
`--dry-run --allow-partial`; it is not deployable.
