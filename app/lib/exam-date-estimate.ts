const DAY_MS = 86_400_000;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function firstSaturday(year: number, monthIndex: number) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const day = 1 + ((6 - first.getUTCDay() + 7) % 7);
  return new Date(Date.UTC(year, monthIndex, day));
}

export function estimateEmergencyBoardDates(year: number) {
  const written = firstSaturday(year, 4);
  if (written.getUTCDate() <= 2) written.setUTCDate(written.getUTCDate() + 7);
  const oral = firstSaturday(year, 5);

  return {
    writtenDate: dateKey(written.getUTCFullYear(), written.getUTCMonth() + 1, written.getUTCDate()),
    oralDate: dateKey(oral.getUTCFullYear(), oral.getUTCMonth() + 1, oral.getUTCDate()),
  };
}

function dateValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function nextEmergencyBoardEstimate(today: string) {
  const currentYear = Number(today.slice(0, 4));
  let targetYear = currentYear;
  let dates = estimateEmergencyBoardDates(targetYear);

  if (today > dates.oralDate) {
    targetYear += 1;
    dates = estimateEmergencyBoardDates(targetYear);
  }

  const milestone = today <= dates.writtenDate ? "written" : "oral";
  const targetDate = milestone === "written" ? dates.writtenDate : dates.oralDate;
  const daysRemaining = Math.max(0, Math.ceil((dateValue(targetDate) - dateValue(today)) / DAY_MS));

  return {
    ...dates,
    targetYear,
    rocYear: targetYear - 1911,
    milestone,
    targetDate,
    daysRemaining,
  } as const;
}

export function formatExamEstimateDate(value: string) {
  return value.replaceAll("-", "/");
}
