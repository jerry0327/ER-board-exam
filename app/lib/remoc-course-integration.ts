import type { RegionalCourseListing } from "./remoc-course-listings.ts";
import type {
  DisasterCourseRecognition,
  RegionalDisasterCourse,
  RemocCategory,
} from "./remoc-course-data.ts";

function normalizedCourseText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/\b(?:19|20)\d{2}\b/gu, "")
    .replace(/\d{3}\s*年度?/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigrams(value: string) {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
  return result;
}

function titleSimilarity(left: string, right: string) {
  const a = normalizedCourseText(left);
  const b = normalizedCourseText(right);
  if (!a || !b) return 0;
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 8) return 1;
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  if (!leftPairs.size || !rightPairs.size) return a === b ? 1 : 0;
  let shared = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) shared += 1;
  return shared / Math.min(leftPairs.size, rightPairs.size);
}

function dateRangesOverlap(left: Pick<RegionalCourseListing, "startDate" | "endDate">, right: Pick<RegionalDisasterCourse, "startDate" | "endDate">) {
  return left.startDate <= right.endDate && left.endDate >= right.startDate;
}

export function categoryForRegionalCourseTitle(value: string): RemocCategory {
  const text = normalizedCourseText(value);
  if (/毒化|化災|化學物質|化學災害|毒物/u.test(text)) return "hazmat";
  if (/核災|輻傷|輻射|放射|核子事故/u.test(text)) return "nuclear";
  return "other";
}

export function regionalCourseListingMatchesCourse(listing: RegionalCourseListing, course: RegionalDisasterCourse) {
  if (listing.region !== course.regions[0] && !course.regions.includes(listing.region)) return false;
  if (!dateRangesOverlap(listing, course)) return false;
  if (titleSimilarity(listing.title, course.title) >= 0.68) return true;
  const listingLocation = normalizedCourseText(listing.location);
  const courseLocation = normalizedCourseText(course.location);
  const locationMatches = Math.min(listingLocation.length, courseLocation.length) >= 4
    && (listingLocation.includes(courseLocation) || courseLocation.includes(listingLocation));
  return locationMatches && categoryForRegionalCourseTitle(listing.title) === categoryForRegionalCourseTitle(course.title)
    && titleSimilarity(listing.title, course.title) >= 0.42;
}

function listingRecognition(listing: RegionalCourseListing): DisasterCourseRecognition {
  const kind = categoryForRegionalCourseTitle(listing.title);
  return {
    kind,
    label: kind === "hazmat" ? "毒化災課程" : kind === "nuclear" ? "核災課程" : "其他災難課程",
    hoursText: "尚待認列",
    checklistItemId: kind === "hazmat" ? "disaster.hazmat-6h" : kind === "nuclear" ? "disaster.nuclear-6h" : "disaster.other-6h",
  };
}

function courseListingDetails(listing: RegionalCourseListing): NonNullable<RegionalDisasterCourse["listing"]> {
  return {
    registrationLabel: listing.registrationLabel,
    status: listing.status,
    sourceName: listing.sourceName,
    sourceUrl: listing.sourceUrl,
    detailUrl: listing.detailUrl,
    ...(listing.brochureUrl ? { brochureUrl: listing.brochureUrl } : {}),
    ...(listing.deadline ? { deadline: listing.deadline } : {}),
  };
}

export function regionalCourseListingToPendingCourse(listing: RegionalCourseListing): RegionalDisasterCourse {
  return {
    id: `listing-${listing.id}`,
    title: listing.title,
    dateLabel: listing.dateLabel,
    startDate: listing.startDate,
    endDate: listing.endDate,
    location: listing.location,
    regions: [listing.region],
    recognitions: [listingRecognition(listing)],
    sourceUrl: listing.detailUrl,
    recognitionStatus: "pending",
    dateCertainty: "confirmed",
    listing: courseListingDetails(listing),
  };
}

function listingIdentity(listing: RegionalCourseListing) {
  return `${listing.region}|${listing.startDate}|${normalizedCourseText(listing.title)}`;
}

function listingQuality(listing: RegionalCourseListing) {
  let directRegionSource = 0;
  try {
    const host = new URL(listing.sourceUrl).hostname;
    if ((listing.region === "north" && host === "remocnorth7.webnode.tw")
      || (listing.region === "central" && host === "eoc.vghtc.gov.tw")
      || (listing.region === "south" && host === "seoc.hosp.ncku.edu.tw")) directRegionSource = 4;
  } catch { /* Normalized payloads already require a valid source URL. */ }
  return (listing.status === "open" ? 8 : listing.status !== "unknown" ? 4 : 0)
    + (listing.detailUrl !== listing.sourceUrl ? 2 : 0)
    + (listing.brochureUrl ? 1 : 0)
    + directRegionSource;
}

export function integrateRegionalCourseListings(
  recognizedCourses: RegionalDisasterCourse[],
  announcedCourses: RegionalDisasterCourse[],
  rawListings: RegionalCourseListing[],
) {
  const listingByIdentity = new Map<string, RegionalCourseListing>();
  for (const listing of rawListings) {
    const key = listingIdentity(listing);
    const current = listingByIdentity.get(key);
    if (!current || listingQuality(listing) > listingQuality(current)) listingByIdentity.set(key, listing);
  }
  const listings = [...listingByIdentity.values()];
  const matchedListings = new Set<string>();
  const recognized = recognizedCourses.map((course) => {
    const listing = listings.find((candidate) => regionalCourseListingMatchesCourse(candidate, course));
    if (!listing) return course;
    matchedListings.add(listingIdentity(listing));
    return { ...course, listing: courseListingDetails(listing) };
  });
  const pendingFromListings = listings
    .filter((listing) => !matchedListings.has(listingIdentity(listing)))
    .map(regionalCourseListingToPendingCourse);
  const pending = announcedCourses.filter((course) => (
    !recognized.some((recognizedCourse) => recognizedCourse.regions.some((region) => course.regions.includes(region))
      && recognizedCourse.startDate <= course.endDate && recognizedCourse.endDate >= course.startDate
      && titleSimilarity(recognizedCourse.title, course.title) >= 0.68)
    && !listings.some((listing) => regionalCourseListingMatchesCourse(listing, course))
  ));
  return [...recognized, ...pendingFromListings, ...pending];
}
