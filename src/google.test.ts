import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleCalendarProvider, parseGoogleAvailability } from "./google.ts";

const date = "2026-10-28";
const now = Date.parse(`${date}T09:00:00Z`);
const response = () => ({
  timeMin: `${date}T00:00:00Z`, timeMax: "2026-10-29T00:00:00Z",
  calendars: { primary: { busy: [
    { start: `${date}T10:00:00Z`, end: `${date}T11:00:00Z` },
    { start: `${date}T10:30:00Z`, end: `${date}T12:00:00Z` },
  ] } },
});

test("Google primary-calendar busy intervals are merged and subtracted from the entire verified day", () => {
  const snapshot = parseGoogleAvailability(response(), date, now, "UTC");
  assert.deepEqual(snapshot.blocked, [{ start: `${date}T10:00:00.000Z`, end: `${date}T12:00:00.000Z` }]);
  assert.deepEqual(snapshot.available, [
    { start: `${date}T00:00:00.000Z`, end: `${date}T10:00:00.000Z` },
    { start: `${date}T12:00:00.000Z`, end: "2026-10-29T00:00:00.000Z" },
  ]);
  assert.equal(snapshot.timeZone, "UTC");
});

test("Google missing/error calendars, bad intervals, and partial coverage never become free time", () => {
  for (const value of [
    {}, { ...response(), calendars: {} },
    { ...response(), timeMin: `${date}T01:00:00Z` },
    { ...response(), calendars: { primary: { errors: [{ reason: "forbidden" }], busy: [] } } },
    { ...response(), calendars: { primary: {} } },
    { ...response(), calendars: { primary: { busy: [{ start: `${date}T11:00:00Z`, end: `${date}T10:00:00Z` }] } } },
    { ...response(), calendars: { primary: { busy: [{ start: `${date}T10:00:00`, end: `${date}T11:00:00` }] } } },
    { ...response(), calendars: { primary: { busy: [{ start: "2026-02-30T10:00:00Z", end: `${date}T11:00:00Z` }] } } },
  ]) assert.throws(() => parseGoogleAvailability(value, date, now, "UTC"));
});

test("an empty verified Google busy list is free time, while a fully busy day has no openings", () => {
  const value = response();
  value.calendars.primary.busy = [];
  assert.equal(parseGoogleAvailability(value, date, now, "UTC").available.length, 1);
  value.calendars.primary.busy = [{ start: value.timeMin, end: value.timeMax }];
  assert.deepEqual(parseGoogleAvailability(value, date, now, "UTC").available, []);
});

test("Google free/busy uses only the primary calendar and a transient noninteractive token", async () => {
  const provider = new GoogleCalendarProvider({
    async get(interactive) { assert.equal(interactive, false); return "test-only-token"; },
    async invalidate() { assert.fail("successful requests must not invalidate tokens"); },
  }, async (url, init) => {
    assert.equal(url, "https://www.googleapis.com/calendar/v3/freeBusy");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-only-token");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.items, [{ id: "primary" }]);
    assert.equal(body.timeZone, "UTC");
    assert.equal(body.timeMin, `${date}T00:00:00.000Z`);
    return Response.json(response());
  });
  assert.equal((await provider.getAvailability(date, now, "UTC")).available.length, 2);
});

test("Google rejects expired authorization and API errors without retrying or inventing availability", async () => {
  for (const status of [401, 403, 429, 500]) {
    let invalidated = false;
    const provider = new GoogleCalendarProvider({
      async get() { return "test-only-token"; },
      async invalidate(token) { assert.equal(token, "test-only-token"); invalidated = true; },
    }, async () => new Response("", { status }));
    await assert.rejects(provider.getAvailability(date, now, "UTC"), status === 401 ? /Connect Google Calendar again/ : new RegExp(`HTTP ${status}`));
    assert.equal(invalidated, status === 401);
  }
});

test("Google respects 23- and 25-hour local days across DST", () => {
  for (const [day, start, end, hours] of [
    ["2026-03-08", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z", 23],
    ["2026-11-01", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z", 25],
  ] as const) {
    const result = parseGoogleAvailability({ timeMin: start, timeMax: end, calendars: { primary: { busy: [] } } }, day, Date.parse(start), "America/New_York");
    assert.equal((Date.parse(result.available[0].end) - Date.parse(result.available[0].start)) / 3_600_000, hours);
  }
});
