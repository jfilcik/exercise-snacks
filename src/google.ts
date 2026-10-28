import type { Interval, Snapshot } from "./model.ts";
import { subtractIntervals, mergeIntervals, type CalendarProvider } from "./bookings.ts";
import { nextDate, zonedInstant } from "./time.ts";

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
export interface GoogleTokens {
  get(interactive: boolean): Promise<string>;
  invalidate(token: string): Promise<void>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Google Calendar returned an unexpected response. Availability was not used.");
  return value as Record<string, unknown>;
}

function instant(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error("Google Calendar returned an invalid timestamp. Availability was not used.");
  }
  return Date.parse(value);
}

export function parseGoogleAvailability(value: unknown, date: string, now: number, timeZone: string): Snapshot {
  const reply = object(value);
  const start = zonedInstant(`${date}T00:00:00`, timeZone);
  const end = zonedInstant(`${nextDate(date)}T00:00:00`, timeZone);
  if (instant(reply.timeMin) !== start || instant(reply.timeMax) !== end) {
    throw new Error("Google Calendar returned incomplete day coverage. Reminders are paused.");
  }
  const calendar = object(object(reply.calendars).primary);
  if (calendar.errors !== undefined && (!Array.isArray(calendar.errors) || calendar.errors.length !== 0)) {
    throw new Error("Google Calendar could not verify your primary calendar. Reconnect or check your account permissions.");
  }
  if (!Array.isArray(calendar.busy)) throw new Error("Google Calendar returned no busy-time list. Availability was not inferred.");
  const blocked: Interval[] = [];
  for (const raw of calendar.busy) {
    const item = object(raw);
    const a = instant(item.start);
    const b = instant(item.end);
    if (b <= a) throw new Error("Google Calendar returned a reversed or empty busy interval.");
    if (b > start && a < end) blocked.push({
      start: new Date(Math.max(start, a)).toISOString(), end: new Date(Math.min(end, b)).toISOString(),
    });
  }
  return {
    date, fetchedAt: new Date(now).toISOString(), timeZone, blocked: mergeIntervals(blocked),
    available: subtractIntervals([{ start: new Date(start).toISOString(), end: new Date(end).toISOString() }], blocked),
  };
}

export class GoogleCalendarProvider implements CalendarProvider {
  private tokens: GoogleTokens;
  private fetcher: typeof fetch;
  constructor(tokens: GoogleTokens, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.tokens = tokens;
    this.fetcher = fetcher;
  }

  async getAvailability(date: string, now: number, timeZone: string): Promise<Snapshot> {
    const token = await this.tokens.get(false);
    const response = await this.fetcher("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: new Date(zonedInstant(`${date}T00:00:00`, timeZone)).toISOString(),
        timeMax: new Date(zonedInstant(`${nextDate(date)}T00:00:00`, timeZone)).toISOString(),
        timeZone, items: [{ id: "primary" }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 401) {
      await this.tokens.invalidate(token);
      throw new Error("Google Calendar authorization expired. Connect Google Calendar again in Settings.");
    }
    if (!response.ok) throw new Error(`Google Calendar returned HTTP ${response.status}. Reminders are paused; check API access and account permissions.`);
    return parseGoogleAvailability(await response.json(), date, now, timeZone);
  }
}
