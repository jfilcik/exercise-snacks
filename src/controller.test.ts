import assert from "node:assert/strict";
import { test } from "node:test";
import { Controller, type Ports } from "./controller.ts";
import { completedMinutes, DEFAULT_SETTINGS as BASE_SETTINGS, initialState, type AppState, type ExerciseBreak, type Snapshot } from "./model.ts";
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
  const notificationMessages: string[] = [];
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
      notificationMessages.push(_message);
      notificationButtons.push(buttons?.map((b) => b.title) ?? []);
    },
    async clearNotifications() {},
  };
  return {
    controller: new Controller(ports, () => now), ports,
    setTime: (value: number) => { now = value; }, setOffline: (value: boolean) => { fail = value; },
    setFree: (value: boolean) => { free = value; }, state: (): AppState => structuredClone(state),
    alarms: () => alarms, notifications, notificationMessages, notificationButtons, fetches: () => fetchCount,
  };
}

test("enabling reminders without a calendar plans evenly without making calendar requests", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: BASE_SETTINGS });
  assert.equal(h.fetches(), 0);
  assert.equal(h.state().snapshot, null);
  assert.equal(h.state().lastError, null);
  assert.deepEqual(h.alarms().map(item => Date.parse(item.scheduledAt)), [at("11:00"), at("13:00"), at("15:00")]);
  assert.ok(h.alarms().every(item => item.scheduleMode === "spaced"));
  const first = h.alarms()[0];
  h.setTime(Date.parse(first.scheduledAt));
  await h.controller.run({ type: "alarm", id: first.id });
  await h.controller.run({ type: "alarm", id: first.id });
  assert.deepEqual(h.notifications, [first.id]);
  assert.match(h.notificationMessages[0], /Time-based reminder, not a verified free slot/);
  await h.controller.run({ type: "start", id: first.id });
  assert.equal(h.state().breaks.find(item => item.id === first.id)?.status, "active");
  assert.equal(h.fetches(), 0);
});

test("a saved install without a calendar keeps reminders enabled and preserves history", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const saved = h.state();
  saved.settings!.calendar = null;
  saved.breaks[0].status = "completed";
  await h.ports.save(saved);
  const upgraded = await h.controller.run({ type: "heartbeat" });
  assert.equal(upgraded.settings?.enabled, true);
  assert.equal(upgraded.snapshot, null);
  assert.equal(upgraded.lastError, null);
  assert.equal(upgraded.breaks[0].status, "completed");
  assert.equal(h.alarms().length, 2);
  assert.ok(h.alarms().every((item) => item.scheduleMode === "spaced"));
});

test("calendar-free reminders remain stable across refresh, snooze, late wake, and weekday rollover", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: BASE_SETTINGS });
  const original = h.state().breaks;
  h.setTime(at("09:10"));
  await h.controller.run({ type: "heartbeat" });
  assert.deepEqual(h.state().breaks, original);
  const first = original[0];
  h.setTime(Date.parse(first.scheduledAt));
  await h.controller.run({ type: "snooze", id: first.id });
  assert.equal(h.state().breaks[0].snoozes, 1);
  assert.equal(Date.parse(h.state().breaks[0].scheduledAt), at("11:15"));
  h.setTime(at("11:40"));
  await h.controller.run({ type: "alarm", id: first.id });
  assert.equal(h.state().breaks[0].status, "missed");
  assert.deepEqual(h.notifications, []);
  assert.equal(h.alarms().length, 2);
  h.setTime(at("09:00", "2026-10-31"));
  await h.controller.run({ type: "heartbeat" });
  assert.deepEqual(h.alarms(), []);
  h.setTime(at("09:00", "2026-11-02"));
  await h.controller.run({ type: "heartbeat" });
  assert.equal(h.alarms().length, 3);
  assert.equal(h.fetches(), 0);
});

test("too few calendar gaps fill only the remaining daily budget with time-based reminders", async () => {
  const h = harness();
  h.ports.fetchSnapshot = async (date, time, settings) => ({
    date, fetchedAt: new Date(time).toISOString(), timeZone: settings.timeZone,
    available: [{ start: new Date(at("10:00")).toISOString(), end: new Date(at("10:05")).toISOString() }],
    blocked: [],
  });
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  assert.equal(h.alarms().filter(item => item.scheduleMode === "calendar").length, 1);
  assert.equal(h.alarms().filter(item => item.scheduleMode === "spaced").length, 2);
  const original = h.state().breaks;
  await h.controller.run({ type: "refresh" });
  assert.deepEqual(h.state().breaks, original);
});

test("changing calendar source never reuses old availability, even if the new source is offline", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  h.setOffline(true);
  await h.controller.run({
    type: "settings", settings: { ...DEFAULT_SETTINGS, calendar: { type: "google" } },
  });
  assert.equal(h.state().settings?.calendar?.type, "google");
  assert.equal(h.state().snapshot, null);
  assert.match(h.state().lastError!, /Offline/);
  assert.equal(h.alarms().length, 3);
  assert.ok(h.alarms().every((item) => item.scheduleMode === "spaced"));
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

test("new busy time cancels a calendar reminder and plans clearly distinguished future time-based reminders", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  h.setFree(false);
  h.setTime(Date.parse(item.scheduledAt));
  await h.controller.run({ type: "alarm", id: item.id });
  assert.deepEqual(h.notifications, []);
  assert.equal(h.state().breaks.find((b) => b.id === item.id)?.status, "cancelled");
  assert.equal(h.alarms().length, 3);
  assert.ok(h.alarms().every((b) => b.scheduleMode === "spaced" && Date.parse(b.scheduledAt) > Date.parse(item.scheduledAt)));
});

test("offline data surfaces errors and uses time-based reminders without treating stale data as free", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  h.setOffline(true);
  await h.controller.run({ type: "refresh" });
  assert.match(h.state().lastError!, /Offline/);
  assert.equal(h.state().snapshot, null);
  assert.equal(h.alarms().length, 3);
  assert.ok(h.alarms().every((item) => item.scheduleMode === "spaced"));
  h.setOffline(false);
  await h.controller.run({ type: "refresh" });
  assert.equal(h.state().lastError, null);
  assert.equal(h.alarms().length, 3);
  assert.ok(h.alarms().every((item) => item.scheduleMode === "calendar"));
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

test("starting early consumes the same planned snack, clears its alarm, persists across restart and never notifies later", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  assert.ok(Date.parse(item.scheduledAt) > at("09:00"));
  await h.controller.run({ type: "start-early", id: item.id });
  const active = h.state().breaks.find((b) => b.id === item.id)!;
  assert.equal(active.status, "active");
  assert.equal(Date.parse(active.startedAt!), at("09:00"));
  assert.equal(active.scheduledAt, active.startedAt);
  assert.ok(!h.alarms().some((alarm) => alarm.id === item.id));
  assert.equal(h.fetches(), 1);
  h.setTime(at("09:01"));
  await h.controller.run({ type: "start-early", id: item.id });
  assert.equal(h.state().breaks.find((b) => b.id === item.id)!.startedAt, active.startedAt);
  const restored = await new Controller(h.ports, () => at("09:02")).run({ type: "get" });
  assert.equal(restored.breaks.find((b) => b.id === item.id)?.status, "active");
  h.setTime(at("09:03"));
  await h.controller.run({ type: "complete", id: item.id });
  h.setTime(Date.parse(item.scheduledAt));
  await h.controller.run({ type: "alarm", id: item.id });
  assert.deepEqual(h.notifications, []);
  assert.equal(h.state().breaks.filter((b) => b.status !== "cancelled").length, 3);
});

test("manual starts do not check availability, work hours, freshness or the reminder toggle", async () => {
  for (const condition of ["busy", "offline", "paused", "before-work", "after-work", "stale", "no-snapshot", "previous-error"]) {
    const h = harness();
    await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
    const item = h.state().breaks[0];
    const saved = h.state();
    if (condition === "busy") { h.setFree(false); saved.snapshot!.available = []; }
    if (condition === "offline") h.setOffline(true);
    if (condition === "paused") saved.settings!.enabled = false;
    if (condition === "before-work") h.setTime(at("08:00"));
    if (condition === "after-work") h.setTime(at("18:00"));
    if (condition === "stale") saved.snapshot!.fetchedAt = new Date(at("08:00")).toISOString();
    if (condition === "no-snapshot") saved.snapshot = null;
    if (condition === "previous-error") saved.lastError = "Offline; availability cannot be verified.";
    await h.ports.save(saved);
    await h.controller.run({ type: "start-early", id: item.id });
    assert.equal(h.state().breaks.find((b) => b.id === item.id)?.status, "active", condition);
    assert.equal(h.fetches(), 1, condition);
    assert.equal(h.state().lastError, null, condition);
    assert.ok(!h.alarms().some((b) => b.id === item.id), condition);
    if (["no-snapshot", "previous-error"].includes(condition)) {
      assert.equal(h.state().snapshot, null);
      assert.deepEqual(h.alarms(), []);
    }
  }
});

test("notification starts still recheck the calendar and reject busy or offline availability", async () => {
  for (const offline of [false, true]) {
    const h = harness();
    await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
    const item = h.state().breaks[0];
    h.setTime(Date.parse(item.scheduledAt));
    if (offline) h.setOffline(true);
    else h.setFree(false);
    await assert.rejects(h.controller.run({ type: "start", id: item.id }), /planned snacks/);
    assert.equal(h.fetches(), 2);
    assert.ok(h.state().breaks.every((b) => b.status !== "active"));
  }
});

test("manual starts cannot reopen finished snacks or start another day's plan", async () => {
  for (const status of ["completed", "skipped", "missed", "cancelled"] as const) {
    const h = harness();
    await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
    const saved = h.state();
    saved.breaks[0].status = status;
    await h.ports.save(saved);
    await assert.rejects(h.controller.run({ type: "start-early", id: saved.breaks[0].id }), /planned snacks/);
    assert.equal(h.fetches(), 1);
  }
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  h.setTime(at("09:00", "2026-10-29"));
  await assert.rejects(h.controller.run({ type: "start-early", id: h.state().breaks[0].id }), /planned snacks/);
});

test("an early session cannot replace another active session", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const [first, second] = h.state().breaks;
  await h.controller.run({ type: "start-early", id: first.id });
  await assert.rejects(h.controller.run({ type: "start-early", id: second.id }), /current exercise/);
  assert.equal(h.state().breaks.filter((b) => b.status === "active").length, 1);
});

test("starting a later snack early moves a nearby reminder instead of pinging again minutes later", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const [first, , last] = h.state().breaks;
  const now = Date.parse(first.scheduledAt) - MINUTE;
  h.setTime(now);
  await h.controller.run({ type: "start-early", id: last.id });
  assert.equal(h.state().breaks.find((b) => b.id === first.id)?.status, "cancelled");
  assert.equal(h.state().breaks.find((b) => b.id === last.id)?.status, "active");
  assert.ok(h.alarms().every((b) => Date.parse(b.scheduledAt) - now >= 60 * MINUTE));
  assert.equal(h.fetches(), 1);
  assert.equal(h.state().breaks.filter((b) => b.status !== "cancelled").length, 3);
  await h.controller.run({ type: "heartbeat" });
  assert.equal(h.state().breaks.filter((b) => b.status !== "cancelled").length, 3);
  assert.ok(h.alarms().every((b) => Date.parse(b.scheduledAt) - now >= 60 * MINUTE));
  assert.ok(!h.alarms().some((b) => b.id === first.id || b.id === last.id));
});

test("camera and manually counted squats save only summary data, real elapsed time and one completion", async () => {
  for (const countingMode of ["camera", "manual"] as const) {
    const h = harness();
    await h.controller.run({ type: "settings", settings: {
      ...DEFAULT_SETTINGS, difficulty: "challenging", selection: "random", randomExerciseIds: ["squats"],
    } });
    const item = h.state().breaks[0];
    await h.controller.run({ type: "start-early", id: item.id });
    h.setTime(at("09:00") + 45_000);
    const action = { type: "complete-reps" as const, id: item.id, reps: {
      targetReps: 10, completedReps: 9, automaticReps: countingMode === "camera" ? 10 : 0,
      manualAdjustment: countingMode === "camera" ? -1 : 9, countingMode,
    } };
    await Promise.all([h.controller.run(action), h.controller.run(action)]);
    const done = h.state().breaks.filter((b) => b.status === "completed");
    assert.equal(done.length, 1);
    assert.deepEqual(done[0].reps, { ...action.reps, elapsedSeconds: 45 });
    assert.equal(completedMinutes(done), .8);
    const restored = await new Controller(h.ports).run({ type: "get" });
    assert.deepEqual(restored.breaks.find((b) => b.id === item.id)?.reps, done[0].reps);
  }
});

test("rep completion rejects unsupported movements, inactive sessions and malformed summaries", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: DEFAULT_SETTINGS });
  const item = h.state().breaks[0];
  const action = { type: "complete-reps" as const, id: item.id, reps: {
    targetReps: 10, completedReps: 10, automaticReps: 0, manualAdjustment: 10, countingMode: "manual" as const,
  } };
  await assert.rejects(h.controller.run(action), /active squat/);
  await h.controller.run({ type: "start-early", id: item.id });
  await assert.rejects(h.controller.run(action), /active squat/);
  assert.equal(h.state().breaks.filter((b) => b.status === "completed").length, 0);
  const squat = harness();
  await squat.controller.run({ type: "settings", settings: {
    ...DEFAULT_SETTINGS, difficulty: "challenging", selection: "random", randomExerciseIds: ["squats"],
  } });
  const id = squat.state().breaks[0].id;
  await squat.controller.run({ type: "start-early", id });
  await assert.rejects(squat.controller.run({
    ...action, id, reps: { ...action.reps, completedReps: 999 },
  }), /do not agree/);
  assert.equal(squat.state().breaks.find((b) => b.id === id)?.status, "active");
});

test("counted sets cap elapsed credit at the break window and preserve legacy timer totals", async () => {
  const h = harness();
  await h.controller.run({ type: "settings", settings: {
    ...DEFAULT_SETTINGS, difficulty: "challenging", selection: "random", randomExerciseIds: ["squats"],
  } });
  const id = h.state().breaks[0].id;
  await h.controller.run({ type: "start-early", id });
  h.setTime(at("10:00"));
  await h.controller.run({ type: "complete-reps", id, reps: {
    targetReps: 10, completedReps: 5, automaticReps: 0, manualAdjustment: 5, countingMode: "manual",
  } });
  const done = h.state().breaks.find((b) => b.id === id)!;
  assert.equal(done.reps?.elapsedSeconds, done.duration * 60);
  assert.equal(completedMinutes([done, { ...done, id: "legacy", reps: undefined }]), done.duration * 2);
});
