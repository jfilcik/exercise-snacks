import type { Interval, Snapshot } from "./model.ts";
import { parseBookingUrl } from "./calendar-source.ts";
import { dateInZone, nextDate, TIME_ZONE, wallTime, zonedInstant } from "./time.ts";
import { windowsToIana } from "./windows-zone.ts";

// The personal-Bookings web client uses this shared marker for every owner's staff.
export const PERSONAL_BOOKINGS_STAFF_ID = "1c1c7887-e0fc-479b-ac7d-6983d0f026ff";
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AvailabilityContext = {
  windowsZone: string; ianaZone: string; zoneLabel?: string; timeZone: string;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bookings response format changed. Open the booking page and refresh later.");
  }
  return value as Record<string, unknown>;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.map((item) => ({ ...item })).sort((a, b) => a.start.localeCompare(b.start));
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) {
      if (interval.end > previous.end) previous.end = interval.end;
    } else merged.push(interval);
  }
  return merged;
}

export function subtractIntervals(available: Interval[], blocked: Interval[]): Interval[] {
  let result = mergeIntervals(available);
  for (const block of mergeIntervals(blocked)) {
    result = result.flatMap((slot) => {
      if (block.end <= slot.start || block.start >= slot.end) return [slot];
      const pieces: Interval[] = [];
      if (block.start > slot.start) pieces.push({ start: slot.start, end: block.start });
      if (block.end < slot.end) pieces.push({ start: block.end, end: slot.end });
      return pieces;
    });
  }
  return result;
}

export function parseAvailability(value: unknown, date: string, now: number, context: AvailabilityContext): Snapshot {
  const responses = object(value).staffAvailabilityResponse;
  if (!Array.isArray(responses) || responses.length !== 1) throw new Error("Bookings staff availability is missing.");
  const staff = object(responses[0]);
  if (staff.staffId !== PERSONAL_BOOKINGS_STAFF_ID || !Array.isArray(staff.availabilityItems)) {
    throw new Error("Bookings staff or availability format changed.");
  }
  const start = zonedInstant(`${date}T00:00:00`, context.timeZone);
  const end = zonedInstant(`${nextDate(date)}T00:00:00`, context.timeZone);
  const available: Interval[] = [];
  const blocked: Interval[] = [];
  const coverage: Interval[] = [];
  for (const raw of staff.availabilityItems) {
    const item = object(raw);
    const from = object(item.startDateTime);
    const to = object(item.endDateTime);
    if (typeof from.dateTime !== "string" || typeof to.dateTime !== "string" ||
        ![context.windowsZone, context.zoneLabel, context.ianaZone].includes(String(from.timeZone)) ||
        ![context.windowsZone, context.zoneLabel, context.ianaZone].includes(String(to.timeZone)) || typeof item.status !== "string") {
      throw new Error("Bookings returned an unsupported time zone or interval.");
    }
    const a = zonedInstant(from.dateTime, context.ianaZone);
    const b = zonedInstant(to.dateTime, context.ianaZone);
    if (b <= a) throw new Error("Bookings returned a reversed or empty interval.");
    const clipped = { start: new Date(Math.max(start, a)).toISOString(), end: new Date(Math.min(end, b)).toISOString() };
    if (clipped.end <= clipped.start) continue;
    coverage.push(clipped);
    (item.status === "BOOKINGSAVAILABILITYSTATUS_AVAILABLE" ? available : blocked).push(clipped);
  }
  const covered = mergeIntervals(coverage);
  if (covered.length !== 1 || Date.parse(covered[0].start) !== start || Date.parse(covered[0].end) !== end) {
    throw new Error("Bookings returned incomplete day coverage. Reminders are paused until a complete refresh.");
  }
  return {
    date, fetchedAt: new Date(now).toISOString(), timeZone: context.timeZone,
    available: subtractIntervals(available, blocked), blocked: mergeIntervals(blocked),
  };
}

export interface CalendarProvider {
  getAvailability(date: string, now: number, timeZone: string): Promise<Snapshot>;
}

export class BookingsCalendarProvider implements CalendarProvider {
  private fetcher: typeof fetch;
  private source: ReturnType<typeof parseBookingUrl>;
  constructor(url: string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.source = parseBookingUrl(url);
    this.fetcher = fetcher;
  }

  private async request(url: string, body?: unknown): Promise<unknown> {
    const response = await this.fetcher(url, {
      method: body ? "POST" : "GET",
      credentials: "omit", cache: "no-store", redirect: "error",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`Bookings returned HTTP ${response.status}. Reminders are paused; check the public booking page.`);
    }
    return response.json();
  }

  async getAvailability(date = dateInZone(Date.now()), now = Date.now(), timeZone = TIME_ZONE): Promise<Snapshot> {
    const [mailbox, domain] = this.source.mailbox.split("@");
    let tenant = domain;
    if (!guid.test(tenant)) {
      const metadata = object(await this.request(`https://login.microsoftonline.com/${encodeURIComponent(domain)}/.well-known/openid-configuration`));
      if (typeof metadata.authorization_endpoint !== "string") throw new Error("Microsoft tenant discovery returned no authorization endpoint.");
      const endpoint = new URL(metadata.authorization_endpoint);
      tenant = endpoint.pathname.split("/")[1];
      if (endpoint.origin !== "https://login.microsoftonline.com" || !guid.test(tenant)) {
        throw new Error("Microsoft tenant discovery returned an unsupported tenant. No availability was inferred.");
      }
    }
    const businessId = `mbx:${mailbox}@${tenant}`;
    const base = `https://bookings.cloud.microsoft/BookingsService/api/V1/bookingBusinessesc2/${encodeURIComponent(businessId)}`;
    const [businessReply, serviceReply] = await Promise.all([
      this.request(`${base}/`), this.request(`${base}/services/${this.source.meetingType}`),
    ]);
    const business = object(object(businessReply).businessInfo);
    const service = object(object(serviceReply).service);
    const settings = object(business.settings);
    if (business.id !== businessId || business.isPublished !== true ||
        typeof business.businessTimeZone !== "string" ||
        settings.authType !== "BOOKINGS_SELF_SERVICE_PAGE_AUTH_TYPE_ANONYMOUS" ||
        typeof service.serviceId !== "string" || !guid.test(service.serviceId) || service.isPrivate !== false ||
        service.isHiddenFromCustomers === true ||
        service.restrictionType !== "BOOKING_SERVICE_RESTRICTION_PUBLIC") {
      throw new Error("The booking page, its privacy settings, or its time zone changed. No availability was inferred.");
    }
    if (typeof service.description === "string" && service.description.trim().startsWith("{")) {
      const description = object(JSON.parse(service.description));
      if (description.isAuthRequired !== undefined && description.isAuthRequired !== 0) {
        throw new Error("This Bookings meeting type requires sign-in. Only public anonymous meeting types are supported.");
      }
    }
    const windowsZone = business.businessTimeZone;
    const ianaZone = windowsToIana(windowsZone);
    const reply = await this.request(`${base}/getStaffAvailability`, {
      staffIds: [PERSONAL_BOOKINGS_STAFF_ID],
      startDateTime: { dateTime: wallTime(zonedInstant(`${date}T00:00:00`, timeZone), ianaZone), timeZone: windowsZone },
      endDateTime: { dateTime: wallTime(zonedInstant(`${nextDate(date)}T00:00:00`, timeZone), ianaZone), timeZone: windowsZone },
      serviceId: service.serviceId,
    });
    return parseAvailability(reply, date, now, {
      windowsZone, ianaZone, timeZone,
      zoneLabel: typeof business.businessTimeZoneName === "string" ? business.businessTimeZoneName : undefined,
    });
  }
}
