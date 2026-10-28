export const MINUTE = 60_000;
export const TIME_ZONE = "America/New_York";

export function validateTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Choose a valid IANA time zone, such as America/New_York or Europe/London.");
  try { return new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).resolvedOptions().timeZone; }
  catch { throw new Error("Choose a valid IANA time zone, such as America/New_York or Europe/London."); }
}

export function wallTime(value: number, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(value)).replace(" ", "T");
}
export function dateInZone(value: number | string, timeZone = TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function zonedInstant(local: string, timeZone = TIME_ZONE): number {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.\d{1,7})?)?$/.exec(local);
  if (!match) throw new Error("Bookings returned an unsupported local timestamp.");
  const normalized = `${match[1]}T${match[2]}:${match[3] ?? "00"}`;
  const utc = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 19) !== normalized) {
    throw new Error("Bookings returned an invalid date.");
  }
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const wall = (instant: number) => formatter.format(new Date(instant)).replace(" ", "T");
  const offsets = new Set(
    [-86_400_000, 0, 86_400_000].map((delta) => {
      const sample = utc + delta;
      return Date.parse(`${wall(sample)}Z`) - sample;
    }),
  );
  const candidates = [...offsets].map((offset) => utc - offset).filter((t) => wall(t) === normalized);
  if (candidates.length !== 1) {
    throw new Error("Ambiguous or nonexistent daylight-saving time; availability was not inferred.");
  }
  return candidates[0];
}

export function timeLabel(instant: string, timeZone = TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", minute: "2-digit",
  }).format(new Date(instant));
}
