from pathlib import Path

path = Path("app/components/audio-section-companion.tsx")
text = path.read_text()

old_decl = '''const sectionBundleRequests = new Map<string, Promise<LoadedSectionBundle>>();\n'''
new_decl = '''const SECTION_BUNDLE_CACHE_LIMIT = 6;\nconst sectionBundleRequests = new Map<string, Promise<LoadedSectionBundle>>();\n\nfunction rememberSectionBundleRequest(key: string, request: Promise<LoadedSectionBundle>) {\n  sectionBundleRequests.delete(key);\n  sectionBundleRequests.set(key, request);\n  while (sectionBundleRequests.size > SECTION_BUNDLE_CACHE_LIMIT) {\n    const oldestKey = sectionBundleRequests.keys().next().value as string | undefined;\n    if (!oldestKey) break;\n    sectionBundleRequests.delete(oldestKey);\n  }\n}\n'''
if old_decl not in text:
    raise SystemExit("Section bundle cache declaration not found")
text = text.replace(old_decl, new_decl, 1)

old_existing = '''  const existing = sectionBundleRequests.get(key);\n  if (existing) return existing;\n'''
new_existing = '''  const existing = sectionBundleRequests.get(key);\n  if (existing) {\n    rememberSectionBundleRequest(key, existing);\n    return existing;\n  }\n'''
if old_existing not in text:
    raise SystemExit("Section bundle cache lookup not found")
text = text.replace(old_existing, new_existing, 1)

old_set = '''  sectionBundleRequests.set(key, pending);\n  void pending.catch(() => {\n'''
new_set = '''  rememberSectionBundleRequest(key, pending);\n  void pending.catch(() => {\n'''
if old_set not in text:
    raise SystemExit("Section bundle cache insertion not found")
text = text.replace(old_set, new_set, 1)
path.write_text(text)

test_path = Path("tests/audio-player-section-subtitle-contract.test.mjs")
test = test_path.read_text()
anchor = '''  assert.match(companion, /sourceRevision: string;/u);\n'''
replacement = '''  assert.match(companion, /sourceRevision: string;/u);\n  assert.match(companion, /SECTION_BUNDLE_CACHE_LIMIT = 6/u);\n  assert.match(companion, /while \\(sectionBundleRequests\\.size > SECTION_BUNDLE_CACHE_LIMIT\\)/u);\n  assert.match(companion, /rememberSectionBundleRequest\\(key, existing\\)/u);\n  assert.match(companion, /rememberSectionBundleRequest\\(key, pending\\)/u);\n'''
if anchor not in test:
    raise SystemExit("Section contract test anchor not found")
test = test.replace(anchor, replacement, 1)
test_path.write_text(test)

print("Bounded decoded Section bundle cache to six recent entries")
# trigger=1
