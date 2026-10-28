import assert from "node:assert/strict";
import { test } from "node:test";
import { BookingsCalendarProvider, parseAvailability as parse, PERSONAL_BOOKINGS_STAFF_ID, subtractIntervals } from "./bookings.ts";
import { parseBookingUrl } from "./calendar-source.ts";
import { windowsToIana } from "./windows-zone.ts";
import { dateInZone, zonedInstant } from "./time.ts";

const date = "2026-10-28";
const now = Date.parse("2026-10-28T13:00:00Z");
const SOURCE = {
  business: "mbx:example-user@11111111-2222-4333-8444-555555555555",
  service: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", staff: PERSONAL_BOOKINGS_STAFF_ID,
};
const BOOKING_URL = "https://bookings.cloud.microsoft/bookwithme/user/example-user%40example.com/meetingtype/example-type?anonymous";
const parseAvailability = (value: unknown, day: string, time: number) => parse(value, day, time, {
  windowsZone: "Eastern Standard Time", ianaZone: "America/New_York", timeZone: "America/New_York",
});
function metadata(url: string) {
  return url.includes("/.well-known/")
    ? { authorization_endpoint: "https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/oauth2/v2.0/authorize" }
    : url.includes("/services/")
      ? { service: { serviceId: SOURCE.service, isPrivate: false, restrictionType: "BOOKING_SERVICE_RESTRICTION_PUBLIC" } }
      : { businessInfo: { id: SOURCE.business, isPublished: true, businessTimeZone: "Eastern Standard Time",
        settings: { authType: "BOOKINGS_SELF_SERVICE_PAGE_AUTH_TYPE_ANONYMOUS" } } };
}
const point = (clock: string) => ({ dateTime: `${date}T${clock}:00`, timeZone: "Eastern Standard Time" });
const item = (status: string, a: string, b: string) => ({
  status: `BOOKINGSAVAILABILITYSTATUS_${status}`,
  startDateTime: point(a), endDateTime: point(b),
});
const reply = (items: unknown[]) => ({ staffAvailabilityResponse: [{ staffId: SOURCE.staff, availabilityItems: items }] });
const covered = [
  item("OUT_OF_OFFICE", "00:00", "09:00"),
  item("AVAILABLE", "09:00", "17:00"),
  { ...item("OUT_OF_OFFICE", "17:00", "23:59"), endDateTime: { dateTime: "2026-10-29T00:00:00", timeZone: "Eastern Standard Time" } },
];

test("Eastern wall times use DST, not the misleading fixed offset in the API label", () => {
  assert.equal(new Date(zonedInstant("2026-10-28T13:00:00")).toISOString(), "2026-10-28T17:00:00.000Z");
  assert.equal(new Date(zonedInstant("2026-11-03T13:00:00")).toISOString(), "2026-11-03T18:00:00.000Z");
  assert.equal(dateInZone("2026-10-29T02:00:00Z"), "2026-10-28");
  assert.throws(() => zonedInstant("2026-11-01T01:30:00"), /Ambiguous/);
  assert.throws(() => zonedInstant("2026-03-08T02:30:00"), /nonexistent/);
  assert.throws(() => zonedInstant("2026-02-30T12:00:00"), /invalid date/);
});

test("normalizes explicit free windows and subtracts busy/unknown overlapping intervals", () => {
  const parsed = parseAvailability(reply([
    ...covered, item("BUSY", "10:00", "11:00"), item("UNKNOWN_NEW_STATUS", "10:30", "12:00"),
    item("BUSY", "10:00", "11:00"),
  ]), date, now);
  assert.deepEqual(parsed.available, [
    { start: "2026-10-28T13:00:00.000Z", end: "2026-10-28T14:00:00.000Z" },
    { start: "2026-10-28T16:00:00.000Z", end: "2026-10-28T21:00:00.000Z" },
  ]);
  assert.equal(parsed.timeZone, "America/New_York");
  assert.equal(parsed.date, date);
});

test("fails closed on absent, incomplete, malformed, or unexpected staff data", () => {
  assert.throws(() => parseAvailability({}, date, now), /missing/);
  assert.throws(() => parseAvailability(reply([]), date, now), /incomplete day coverage/);
  assert.throws(() => parseAvailability(reply([item("AVAILABLE", "09:00", "10:00")]), date, now), /incomplete/);
  assert.throws(() => parseAvailability(reply([item("BUSY", "12:00", "11:00")]), date, now), /reversed/);
  assert.throws(() => parseAvailability({ staffAvailabilityResponse: [{ staffId: "another-person", availabilityItems: covered }] }, date, now), /staff/);
  assert.throws(() => parseAvailability(reply([{ ...covered[0], startDateTime: { dateTime: "2026-10-28T00:00:00", timeZone: "Pacific Standard Time" } }]), date, now), /time zone/);
});

test("an explicitly fully blocked day is successful, not an error or invented free time", () => {
  const result = parseAvailability(reply(covered.map((i) => ({ ...i, status: "BOOKINGSAVAILABILITYSTATUS_BUSY" }))), date, now);
  assert.deepEqual(result.available, []);
  assert.equal(result.blocked.length, 1);
});

test("interval subtraction handles fully blocked and nested overlaps", () => {
  const i = (a: string, b: string) => ({ start: a, end: b });
  assert.deepEqual(subtractIntervals([i("01", "09")], [i("00", "10")]), []);
  assert.deepEqual(subtractIntervals([i("01", "09"), i("03", "08")], [i("04", "06")]), [i("01", "04"), i("06", "09")]);
});

test("provider uses only observed public endpoints with no credentials or writes", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    const value = url.endsWith("/getStaffAvailability") ? reply(covered) : metadata(url);
    return new Response(JSON.stringify(value), { status: 200 });
  };
  const result = await new BookingsCalendarProvider(BOOKING_URL, fetcher).getAvailability(date, now);
  assert.equal(result.available.length, 1);
  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.ok(["https://bookings.cloud.microsoft", "https://login.microsoftonline.com"].includes(new URL(request.url).origin));
    assert.equal(request.init?.credentials, "omit");
    assert.equal(request.init?.redirect, "error");
  }
  const availability = requests.find((r) => r.url.endsWith("/getStaffAvailability"))!;
  const body = JSON.parse(String(availability.init?.body));
  assert.equal(body.startDateTime.dateTime, "2026-10-28T00:00:00");
  assert.equal(body.endDateTime.dateTime, "2026-10-29T00:00:00");
  assert.deepEqual(body.staffIds, [SOURCE.staff]);
  assert.equal(body.serviceId, SOURCE.service);
});

test("HTTP errors never become empty successful schedules", async () => {
  const fetcher: typeof fetch = async () => new Response("Forbidden", { status: 403 });
  await assert.rejects(new BookingsCalendarProvider(BOOKING_URL, fetcher).getAvailability(date, now), /HTTP 403/);
});

test("native worker fetch retains its global receiver", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function (this: typeof globalThis) {
    assert.equal(this, globalThis);
    return new Response("Forbidden", { status: 403 });
  };
  try {
    await assert.rejects(new BookingsCalendarProvider(BOOKING_URL).getAvailability(date, now), /HTTP 403/);
  } finally { globalThis.fetch = original; }
});

test("private or changed booking configuration fails before requesting availability", async () => {
  let availabilityCalled = false;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    availabilityCalled ||= url.endsWith("/getStaffAvailability");
    return new Response(JSON.stringify(url.includes("/services/")
      ? { service: { serviceId: SOURCE.service, isPrivate: true } }
      : metadata(url)));
  };
  await assert.rejects(new BookingsCalendarProvider(BOOKING_URL, fetcher).getAvailability(date, now), /privacy settings/);
  assert.equal(availabilityCalled, false);
});

test("public meeting-type URL parsing rejects unrelated hosts, shared pages, and malformed mailbox paths", () => {
  assert.equal(parseBookingUrl(BOOKING_URL).mailbox, "example-user@example.com");
  assert.equal(parseBookingUrl(BOOKING_URL.replace("bookings.cloud.microsoft", "outlook.office.com")).url, BOOKING_URL);
  for (const url of [
    "https://example.com/bookwithme/user/a%40example.com/meetingtype/abc",
    BOOKING_URL.replace("https:", "http:"),
    "https://bookings.cloud.microsoft/book/team/",
    BOOKING_URL.replace("example-user%40example.com", "%2F%40example.com"),
    BOOKING_URL.replace("bookings.cloud.microsoft", "user:password@bookings.cloud.microsoft"),
  ]) assert.throws(() => parseBookingUrl(url));
});

test("Windows zones use official CLDR mapping, not fixed UTC offsets", () => {
  assert.equal(windowsToIana("Eastern Standard Time"), "America/New_York");
  assert.equal(windowsToIana("Pacific Standard Time"), "America/Los_Angeles");
  assert.equal(windowsToIana("GMT Standard Time"), "Europe/London");
  assert.throws(() => windowsToIana("Unknown Standard Time"), /valid IANA/);
});

test("the selected day is requested in the source zone and returned in the user's zone", async () => {
  let body: Record<string, unknown> | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    if (!String(input).endsWith("/getStaffAvailability")) return Response.json(metadata(String(input)));
    body = JSON.parse(String(init?.body));
    const request = body as { startDateTime: { dateTime: string }; endDateTime: { dateTime: string } };
    return Response.json(reply([{
      status: "BOOKINGSAVAILABILITYSTATUS_AVAILABLE",
      startDateTime: { ...request.startDateTime, timeZone: "Eastern Standard Time" },
      endDateTime: { ...request.endDateTime, timeZone: "Eastern Standard Time" },
    }]));
  };
  const result = await new BookingsCalendarProvider(BOOKING_URL, fetcher).getAvailability(date, now, "Europe/London");
  assert.equal(result.timeZone, "Europe/London");
  assert.deepEqual(result.available, [{ start: "2026-10-28T00:00:00.000Z", end: "2026-10-29T00:00:00.000Z" }]);
  assert.deepEqual(body?.startDateTime, { dateTime: "2026-10-27T20:00:00", timeZone: "Eastern Standard Time" });
});

test("untrusted tenant discovery and sign-in-required meeting types fail before availability", async () => {
  for (const mode of ["tenant", "auth"] as const) {
    let availabilityCalled = false;
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      availabilityCalled ||= url.endsWith("/getStaffAvailability");
      if (mode === "tenant" && url.includes("/.well-known/")) {
        return Response.json({ authorization_endpoint: "https://example.com/11111111-2222-4333-8444-555555555555/oauth2/authorize" });
      }
      if (mode === "auth" && url.includes("/services/")) {
        return Response.json({ service: { serviceId: SOURCE.service, isPrivate: false,
          restrictionType: "BOOKING_SERVICE_RESTRICTION_PUBLIC", description: '{"isAuthRequired":1}' } });
      }
      return Response.json(metadata(url));
    };
    await assert.rejects(new BookingsCalendarProvider(BOOKING_URL, fetcher).getAvailability(date, now), mode === "tenant" ? /unsupported tenant/ : /requires sign-in/);
    assert.equal(availabilityCalled, false);
  }
});
