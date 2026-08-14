export type CourseRegistrationTone = "open" | "closing" | "full" | "closed" | "not-open" | "cancelled" | "unknown";
export type CourseRegistrationStatus = "open" | "full" | "closed" | "unknown";

export function courseRegistrationTone(label: string): CourseRegistrationTone {
  if (/即將.*截止|截止倒數/u.test(label)) return "closing";
  if (/報名中|開放報名|可報名/u.test(label)) return "open";
  if (/已額滿|額滿/u.test(label)) return "full";
  if (/報名截止|已截止/u.test(label)) return "closed";
  if (/尚未開放|即將開放/u.test(label)) return "not-open";
  if (/取消/u.test(label)) return "cancelled";
  return "unknown";
}

function dateNumber(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
}

export function remocRegistrationTone(status: CourseRegistrationStatus, label: string, deadline: string | undefined, today: string): CourseRegistrationTone {
  const labelled = courseRegistrationTone(label);
  if (labelled === "cancelled") return labelled;
  if (status === "full") return "full";
  if (status === "closed") return "closed";
  if (labelled === "not-open") return labelled;
  if (status === "open") {
    if (labelled === "closing") return labelled;
    const remainingDays = (dateNumber(deadline ?? "") - dateNumber(today)) / 86_400_000;
    return Number.isFinite(remainingDays) && remainingDays >= 0 && remainingDays <= 7 ? "closing" : "open";
  }
  return labelled;
}
