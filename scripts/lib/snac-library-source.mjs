function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function interpolateSnacSourceTemplate(template, groups, label) {
  const value = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, key) => {
    const replacement = groups?.[key];
    assert(replacement !== undefined, `${label}: missing template group ${key}.`);
    return replacement;
  });
  assert(!/[{}]/u.test(value), `${label}: invalid template.`);
  return value;
}

export function parseSnacSourceFilename(collection, filename) {
  const filenamePattern = new RegExp(collection.filenamePattern, "u");
  const match = filenamePattern.exec(filename);
  if (!match) return null;

  const capturedResourceId = collection.resourceIdTemplate
    ? interpolateSnacSourceTemplate(collection.resourceIdTemplate, match.groups, filename)
    : match.groups?.resourceId;
  assert(
    typeof capturedResourceId === "string" && capturedResourceId.length > 0,
    `${filename}: resource id is unavailable.`,
  );
  const resourceId = Number.isInteger(collection.resourceIdPadStart)
    ? capturedResourceId.padStart(collection.resourceIdPadStart, "0")
    : capturedResourceId;

  return { match, resourceId };
}

export function resolveSnacCollectionSourceMode({
  collection,
  sourceDirectoryExists,
  matchingMetadataCount,
  sourceDirectory,
}) {
  assert(typeof sourceDirectoryExists === "boolean", `${collection.id}: source directory state is invalid.`);
  assert(
    Number.isInteger(matchingMetadataCount) && matchingMetadataCount >= 0,
    `${collection.id}: matching metadata count is invalid.`,
  );
  if (
    collection.retainExistingIfSourceMissing === true
    && (!sourceDirectoryExists || matchingMetadataCount === 0)
  ) return "retain-existing";
  assert(
    sourceDirectoryExists,
    `${collection.id}: source directory is unavailable${sourceDirectory ? `: ${sourceDirectory}` : "."}`,
  );
  assert(
    matchingMetadataCount === collection.expectedItems,
    `${collection.id}: expected ${collection.expectedItems} metadata files, found ${matchingMetadataCount}.`,
  );
  return "import-source";
}

export function resolveSnacSourceDisplayTitle({
  collection,
  match,
  resourceId,
  sectionTitle,
  existingTitle,
  filename,
}) {
  const capturedTitle = match.groups?.title?.replaceAll("_", " ").trim();
  const templateGroups = { ...match.groups, resourceId };
  const fallbackTitle = collection.defaultTitleTemplate
    ? interpolateSnacSourceTemplate(collection.defaultTitleTemplate, templateGroups, filename)
    : collection.defaultTitle;
  const title = collection.itemTitles?.[resourceId]
    ?? sectionTitle
    ?? capturedTitle
    ?? existingTitle
    ?? fallbackTitle;
  assert(typeof title === "string" && title.trim().length > 0, `${filename}: display title is unavailable.`);
  return title.trim();
}

export function normalizeRetainedSnacEntry({ collection, entry, sectionMetadata }) {
  const canonicalTitle = collection.itemTitles?.[entry.chapterId]
    ?? sectionMetadata?.title
    ?? entry.title;
  assert(
    typeof canonicalTitle === "string" && canonicalTitle.trim().length > 0,
    `${collection.id}:${entry.chapterId}: retained display title is unavailable.`,
  );
  const title = canonicalTitle.trim();
  return {
    ...entry,
    collectionTitle: collection.title,
    ...(collection.libraryId ? {
      libraryId: collection.libraryId,
      libraryTitle: collection.libraryTitle || collection.title,
    } : {}),
    title,
    ...(collection.kind === "textbook-section" ? {
      sectionLabel: collection.defaultSectionLabel
        ?? sectionMetadata?.label
        ?? entry.sectionLabel,
      sectionTitle: title,
    } : {}),
  };
}
