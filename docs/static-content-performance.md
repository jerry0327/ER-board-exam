# Static content performance contract

Updated 2026-08-10.

- Normal Brotli q11 content packs target 8 MiB raw instead of 32 MiB. The
  32 MiB decoded LRU can therefore retain roughly four normal hot packs instead
  of one.
- Files above the 1 MiB singleton threshold still receive a dedicated pack. The
  32 MiB hard raw limit remains as a safety ceiling for an exceptional singleton.
- Content-pack index v3 keeps ordered full SHA-256 entry digests in a
  content-addressed binary sidecar. The Worker loads that sidecar only when a
  non-question `?v=` must be verified, so ordinary cold startup does not parse
  thousands of repeated hexadecimal digests. Legacy v1/v2 indexes remain
  readable.
- Question detail files share one top-level `questionDataRevision`, computed
  from every sorted `/data/questions/**` path and its exact bytes. Both question
  indexes retain that revision once, and question detail URLs receive one-year
  immutable caching only for an exact matching revision. Mismatches, duplicate
  version parameters, and use on any other path remain revalidated.
- Vite `/assets/*` filenames are content-hashed and immutable through both Sites
  `_headers` and the Worker fallback. Fixed manifests and pack indexes revalidate.
