import assert from "node:assert/strict";
import { test } from "node:test";
import { Controller, type Ports } from "./controller.ts";
import { DEFAULT_SETTINGS as BASE_SETTINGS, initialState, type AppState, type ExerciseBreak, type Snapshot } from "./model.ts";
import { MINUTE, zonedInstant } from "./time.ts";

const at = (clock: string, date = "2026-10-28") => zonedInstant(`${date}T${clock}`);
const DEFAULT_SETTINGS = {
  ...BASE_SETTINGS,
  calendar: { type: "bookings" as const, url: "https://bookings.cloud.microsoft/bookwithme/user/test%40example.com/meetingtype/test-type?anonymous" },
};

function harness() {
  let state = initialState();
  let now = at("09:00");
  let fail = false;
  let free = true;
  let fetchCount = 0;
  let alarms: ExerciseBreak[] = [];
  const notifications: string[] = [];
  const notificationButtons: string[][] = [];
  const ports: Ports = {
    async load() { return structuredClone(state); },
    async save(value) { state = structuredClone(value); },
    async clearData() { state = initialState(); },
    async fetchSnapshot(date, time, settings): Promise<Snapshot> {
      fetchCount++;
      if (fail) throw new Error("Offline; availability cannot be verified.");
      return { date, fetchedAt: new Date(time).toISOString(), timeZone: settings.timeZone,
        available: free ? [{
          start: new Date(zonedInstant(`${date}T09:00`, settings.timeZone)).toISOString(),
          end: new Date(zonedInstant(`${date}T17:00`, settings.timeZone)).toISOString(),
        }] : [], blocked: [] };
    },
    async syncAlarms(items) { alarms = structuredClone(items); },
    async notify(id, _title, _message, buttons) {
      notifications.push(id);
      notificationButtons.push(buttons?.map((b) => b.title) ?? []);
    },
    async clearNotifications() {},
  };
  return {
    controller: new Controller(ports, () => now), ports,
    setTime: (value: number) => { now = value; }, setOffline: (value: boolean) => { fail = value; },
    setFree: (value: boolean) => { free = value; }, state: (): AppState => structuredClone(state),
    alarms: () => alarms, notifications, notificationButtons, fetches: () => fetchCount,
  };
}

test("enabling reminders without a calendar fails explicitly before any fetch", async () => {
  const h = harness();
  await assert.rejects(h.controller.run({ type: "settings", settings: BASE_SETTINGS }), /Add your public Bookings/);
  assert.equal(h.fetches(), 0);
  assert.equal(h.state().settings, null);
  assert.deepEqual(h.alarms(), []);
});

test("upgrading a personalized install requires a chosen source but preserves exercise history", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const saved = h.state();
  saved.settings!.calendar = null;
  saved.breaks[0].status = "completed";
  await h.ports.save(saved);
  const upgraded = await h.controller.run({ type: "get" });
  assert.equal(upgraded.settings?.enabled, false);
  assert.equal(upgraded.snapshot, null);
  assert.match(upgraded.lastError!, /Choose your own calendar source/);
  assert.equal(upgraded.breaks[0].status, "completed");
  assert.ok(upgraded.breaks.slice(1).every((item) => item.status === "cancelled"));
  assert.deepEqual(h.alarms(), []);
});

test("changing calendar source never reuses old availability, even if the new source is offline", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  h.setOffline(true);
  await assert.rejects(h.controller.run({
    type: "settings", settings: { ...DEFAULT_SETTINGS, calendar: { type: "google" } },
  }), /Offline/);
  assert.equal(h.state().settings?.calendar?.type, "google");
  assert.equal(h.state().snapshot, null);
  assert.ok(h.state().breaks.every((item) => item.status === "cancelled"));
  assert.deepEqual(h.alarms(), []);
});

test("only explicit Google connect invokes sign-in; disconnect pauses saved Google reminders", async () => {
  const h = harness();
  let connects = 0;
  let disconnects = 0;
  h.ports.connectGoogle = async () => { connects++; };
  h.ports.disconnectGoogle = async () => { disconnects++; };
  await h.controller.run({ type: "settings", settings: { ...DEFAULT_SETTINGS, calendar: { type: "google" } } });
  await h.controller.run({ type: "heartbeat" });
  assert.equal(connects, 0);
  await h.controller.run({ type: "connect-google" });
  assert.equal(connects, 1);
  await h.controller.run({ type: "disconnect-google" });
  assert.equal(disconnects, 1);
  assert.equal(h.state().settings?.enabled, false);
  assert.equal(h.state().snapshot, null);
  assert.deepEqual(h.alarms(), []);
  await h.controller.run({ type: "reset" });
  assert.equal(disconnects, 2);
});

test("calendar dates and work hours use the selected zone, not UTC or the old Eastern default", async () => {
  const h = harness();
  h.setTime(Date.parse("2026-10-28T15:00:00Z"));
  await h.controller.run({ type: "settings", settings: { ...DEFAULT_SETTINGS, timeZone: "Asia/Tokyo" } });
  assert.equal(h.state().snapshot?.date, "2026-10-29");
  assert.equal(h.state().snapshot?.timeZone, "Asia/Tokyo");
  assert.equal(h.state().breaks.length, 3);
  assert.ok(h.state().breaks.every((item) => item.date === "2026-10-29" &&
    Date.parse(item.scheduledAt) >= zonedInstant("2026-10-29T09:00", "Asia/Tokyo") &&
    Date.parse(item.scheduledAt) < zonedInstant("2026-10-29T17:00", "Asia/Tokyo")));
});

test("onboarding persists the local plan and restores it through another controller", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  assert.equal(h.state().breaks.length, 3);
  assert.equal(h.alarms().length, 3);
  const restarted = new Controller(h.ports, () => at("09:01"));
  assert.deepEqual(await restarted.run({ type: "get" }), h.state());
  await restarted.run({ type: "heartbeat" });
  assert.equal(h.fetches(), 1);
});

test("reminders recheck availability and a repeated alarm cannot notify twice", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  h.setTime(Date.parse(item.scheduledAt));
  await h.controller.run({ type: "alarm", id: item.id });
  await h.controller.run({ type: "alarm", id: item.id });
  assert.deepEqual(h.notifications, [item.id]);
  assert.deepEqual(h.notificationButtons, [["Start", "Snooze"]]);
  assert.equal(h.state().breaks[0].status, "ready");
  assert.equal(h.fetches(), 3);
});

test("new busy time cancels the planned reminder rather than interrupting a meeting", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  h.setFree(false);
  h.setTime(Date.parse(item.scheduledAt));
  await h.controller.run({ type: "alarm", id: item.id });
  assert.deepEqual(h.notifications, []);
  assert.equal(h.state().breaks.find((b) => b.id === item.id)?.status, "cancelled");
  assert.deepEqual(h.alarms(), []);
});

test("offline data pauses alarms, surfaces errors, and recovers on refresh", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  h.setOffline(true);
  await assert.rejects(h.controller.run({ type: "refresh" }), /Offline/);
  assert.match(h.state().lastError!, /Offline/);
  assert.deepEqual(h.alarms(), []);
  h.setOffline(false);
  await h.controller.run({ type: "refresh" });
  assert.equal(h.state().lastError, null);
  assert.equal(h.alarms().length, 3);
});

test("start, persisted timer, and concurrent completion count exactly one exercise", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  h.setTime(Date.parse(item.scheduledAt));
  await h.controller.run({ type: "start", id: item.id });
  assert.equal(h.state().breaks[0].status, "active");
  await assert.rejects(h.controller.run({ type: "complete", id: item.id }), /timer/);
  h.setTime(Date.parse(item.scheduledAt) + item.duration * MINUTE);
  await Promise.all([
    h.controller.run({ type: "complete", id: item.id }),
    h.controller.run({ type: "complete", id: item.id }),
  ]);
  assert.equal(h.state().breaks.filter((b) => b.status === "completed").length, 1);
  assert.ok(h.state().breaks[0].completedAt);
});

test("skip is not replaced with more reminders, and pause/reset clear alarms", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  await h.controller.run({ type: "skip", id: item.id });
  await h.controller.run({ type: "refresh" });
  assert.equal(h.state().breaks.filter((b) => b.status !== "cancelled").length, 3);
  assert.equal(h.alarms().length, 2);
  await h.controller.run({ type: "settings", settings: { ...DEFAULT_SETTINGS, enabled: false } });
  assert.deepEqual(h.alarms(), []);
  await h.controller.run({ type: "reset" });
  assert.deepEqual(h.state(), initialState());
});

test("snooze is bounded to twice and is persisted", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  h.setTime(Date.parse(item.scheduledAt));
  await h.controller.run({ type: "snooze", id: item.id });
  await h.controller.run({ type: "snooze", id: item.id });
  await assert.rejects(h.controller.run({ type: "snooze", id: item.id }), /two snoozes/);
  assert.equal(h.state().breaks.find((b) => b.id === item.id)?.snoozes, 2);
});

test("different exercise cycles through matching movement options without changing the schedule", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  const scheduledAt = item.scheduledAt;
  const firstExercise = item.exerciseId;
  await h.controller.run({ type: "different", id: item.id });
  const changed = h.state().breaks.find((candidate) => candidate.id === item.id)!;
  assert.notEqual(changed.exerciseId, firstExercise);
  assert.equal(changed.scheduledAt, scheduledAt);
  assert.equal(changed.status, "planned");
  assert.equal(h.alarms().length, 3);
});

test("random choices persist through restart and refresh; different stays within the selected set", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: {
    ...DEFAULT_SETTINGS, difficulty: "challenging", selection: "random", randomExerciseIds: ["squats", "pushups"],
  } });
  const before = h.state();
  const item = before.breaks[0];
  await h.controller.run({ type: "different", id: item.id });
  const changed = h.state().breaks.find((candidate) => candidate.id === item.id)!;
  assert.equal(changed.exerciseId, item.exerciseId === "squats" ? "pushups" : "squats");
  assert.equal(changed.scheduledAt, item.scheduledAt);
  const restarted = new Controller(h.ports, () => at("09:01"));
  const saved = await restarted.run({ type: "get" });
  assert.deepEqual(saved.settings, before.settings);
  await restarted.run({ type: "refresh" });
  assert.deepEqual(h.state().breaks, saved.breaks);
});

test("a single-exercise set remains fixed and gives an explicit error for different exercise", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: {
    ...DEFAULT_SETTINGS, difficulty: "challenging", selection: "random", randomExerciseIds: ["squats"],
  } });
  const item = h.state().breaks[0];
  await assert.rejects(h.controller.run({ type: "different", id: item.id }), /Only one exercise/);
  assert.equal(h.state().breaks.find((candidate) => candidate.id === item.id)?.exerciseId, "squats");
});

test("next-day heartbeat keeps history but expires yesterday's pending reminders", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const oldIds = h.state().breaks.map((b) => b.id);
  h.setTime(at("09:00", "2026-10-29"));
  await h.controller.run({ type: "heartbeat" });
  assert.equal(h.state().breaks.filter((b) => oldIds.includes(b.id) && b.status === "missed").length, 3);
  assert.equal(h.alarms().length, 3);
  assert.ok(h.alarms().every((b) => b.date === "2026-10-29"));
});

test("late browser wake-up does not fire a backlog of reminders", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  h.setTime(Date.parse(item.scheduledAt) + 20 * MINUTE);
  await h.controller.run({ type: "alarm", id: item.id });
  assert.deepEqual(h.notifications, []);
  assert.equal(h.state().breaks.find((b) => b.id === item.id)?.status, "missed");
});

test("notification failure is explicit and the reminder is not delivered twice", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  h.setTime(Date.parse(item.scheduledAt));
  h.ports.notify = async () => { throw new Error("Notifications are blocked."); };
  await assert.rejects(h.controller.run({ type: "alarm", id: item.id }), /Notifications are blocked/);
  assert.match(h.state().lastError!, /Notifications are blocked/);
  assert.equal(h.state().breaks.find((b) => b.id === item.id)?.status, "ready");
  await h.controller.run({ type: "alarm", id: item.id });
  assert.deepEqual(h.notifications, []);
});
