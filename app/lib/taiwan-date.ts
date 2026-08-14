const taiwanCalendarDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function taiwanDateKey(date = new Date()) {
  const parts = taiwanCalendarDate.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
