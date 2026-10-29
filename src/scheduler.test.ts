import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, parseAction, parseSettings, type ExerciseBreak, type Snapshot } from "./model.ts";
import { fits, makePlan, nextSnooze, snapshotFresh } from "./scheduler.ts";
import { MINUTE, zonedInstant } from "./time.ts";

const at = (time: string) => new Date(zonedInstant(`2026-10-28T${time}`)).toISOString();
const now = Date.parse(at("09:00"));
const snapshot: Snapshot = {
  date: "2026-10-28", fetchedAt: at("09:00"), timeZone: "America/New_York",
  available: [{ start: at("10:00"), end: at("11:00") }, { start: at("13:00"), end: at("14:05") }, { start: at("17:00"), end: at("18:00") }],
  blocked: [],
};

test("plans up to three real opportunities, wholly inside free windows and work hours", () => {
  const plan = makePlan(snapshot, DEFAULT_SETTINGS, [], now);
  assert.equal(plan.length, 3);
  for (const item of plan) {
    assert.ok(fits(snapshot, DEFAULT_SETTINGS, Date.parse(item.scheduledAt), item.duration));
    assert.ok(Date.parse(item.scheduledAt) >= now + 2 * MINUTE);
  }
  for (let i = 1; i < plan.length; i++) {
    assert.ok(Date.parse(plan[i].scheduledAt) - Date.parse(plan[i - 1].scheduledAt) >= 60 * MINUTE);
  }
});

test("does not invent opportunities on blocked days, weekends, after hours, or while paused", () => {
  assert.deepEqual(makePlan({ ...snapshot, available: [] }, DEFAULT_SETTINGS, [], now), []);
  assert.deepEqual(makePlan({ ...snapshot, date: "2026-10-31" }, DEFAULT_SETTINGS, [], now), []);
  assert.deepEqual(makePlan(snapshot, { ...DEFAULT_SETTINGS, enabled: false }, [], now), []);
  assert.deepEqual(makePlan(snapshot, DEFAULT_SETTINGS, [], Date.parse(at("18:00"))), []);
});

test("random plans use only the opted-in challenging set without consecutive repeats", () => {
  const settings = parseSettings({
    ...DEFAULT_SETTINGS, difficulty: "challenging", selection: "random",
    randomExerciseIds: ["squats", "pushups"],
  });
  const plan = makePlan(snapshot, settings, [], now, () => 0);
  assert.deepEqual(plan.map((item) => item.exerciseId), ["squats", "pushups", "squats"]);
  const continued = makePlan(snapshot, settings, [plan[0]], now, () => 0);
  assert.equal(continued[0].exerciseId, "pushups");
  assert.ok(continued.every((item) => fits(snapshot, settings, Date.parse(item.scheduledAt), item.duration)));
  const fixed = makePlan(snapshot, { ...settings, randomExerciseIds: ["pushups"] }, [], now);
  assert.deepEqual(fixed.map((item) => item.exerciseId), ["pushups", "pushups", "pushups"]);
});

test("completed, skipped, and missed breaks consume the daily budget", () => {
  const old = makePlan(snapshot, DEFAULT_SETTINGS, [], now).map((b, i) => ({
    ...b, status: (["completed", "skipped", "missed"] as const)[i],
  }));
  assert.deepEqual(makePlan(snapshot, DEFAULT_SETTINGS, old, now), []);
  const cancelled: ExerciseBreak[] = old.map((b) => ({ ...b, status: "cancelled" }));
  assert.equal(makePlan(snapshot, DEFAULT_SETTINGS, cancelled, now).length, 3);
});

test("snooze is at least fifteen minutes later and never inside blocked time or outside work", () => {
  const item = makePlan(snapshot, DEFAULT_SETTINGS, [], now)[0];
  const snoozed = nextSnooze(snapshot, DEFAULT_SETTINGS, item, [item], Date.parse(at("10:55")));
  assert.equal(snoozed, at("13:00"));
  const future = { ...item, scheduledAt: at("13:00") };
  assert.ok(Date.parse(nextSnooze(snapshot, DEFAULT_SETTINGS, future, [future], now)) >= Date.parse(at("13:15")));
  assert.throws(() => nextSnooze(snapshot, DEFAULT_SETTINGS, item, [item], Date.parse(at("16:55"))), /No suitable/);
});

test("snapshot freshness has a strict 15-minute limit and respects local dates", () => {
  assert.equal(snapshotFresh(snapshot, now + 14 * MINUTE), true);
  assert.equal(snapshotFresh(snapshot, now + 15 * MINUTE), false);
  assert.equal(snapshotFresh(snapshot, now - 1), false);
  assert.equal(snapshotFresh(null, now), false);
});

test("calendar-free plans divide the remaining workday evenly and keep the daily budget", () => {
  const plan = makePlan(null, DEFAULT_SETTINGS, [], now);
  assert.deepEqual(plan.map(item => item.scheduledAt), [at("11:00"), at("13:00"), at("15:00")]);
  assert.ok(plan.every(item => item.scheduleMode === "spaced"));
  const afternoon = makePlan(null, DEFAULT_SETTINGS, [], Date.parse(at("13:00")));
  assert.deepEqual(afternoon.map(item => item.scheduledAt), [at("14:00"), at("15:00"), at("16:00")]);
  assert.deepEqual(makePlan(null, DEFAULT_SETTINGS, plan, now), []);
  assert.deepEqual(makePlan(null, DEFAULT_SETTINGS, plan.map(item => ({ ...item, status: "skipped" })), now), []);
  assert.deepEqual(makePlan(null, { ...DEFAULT_SETTINGS, enabled: false }, [], now), []);
  assert.deepEqual(makePlan(null, DEFAULT_SETTINGS, [], Date.parse(at("17:00"))), []);
  assert.deepEqual(makePlan(null, DEFAULT_SETTINGS, [], Date.parse("2026-10-31T14:00:00Z")), []);
});

test("time-based fallback fills only remaining spots and respects verified reminders and actual starts", () => {
  const oneWindow = { ...snapshot, available: [{ start: at("10:00"), end: at("10:05") }] };
  const verified = makePlan(oneWindow, DEFAULT_SETTINGS, [], now);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].scheduleMode, "calendar");
  const fallback = makePlan(null, DEFAULT_SETTINGS, verified, now);
  assert.equal(fallback.length, 2);
  const combined = [...verified, ...fallback].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  assert.ok(fallback.every(item => item.scheduleMode === "spaced"));
  assert.ok(combined.every((item, index) => !index ||
    Date.parse(item.scheduledAt) - Date.parse(combined[index - 1].scheduledAt) >= 60 * MINUTE));
});

test("time-based snooze works without a snapshot and never leaves the workday", () => {
  const plan = makePlan(null, DEFAULT_SETTINGS, [], now);
  const item = plan[0];
  assert.equal(nextSnooze(null, DEFAULT_SETTINGS, item, plan, Date.parse(item.scheduledAt)), at("11:15"));
  assert.throws(() => nextSnooze(null, DEFAULT_SETTINGS, item, plan, Date.parse(at("16:58"))), /No suitable/);
});

test("rejects malformed or overnight preferences and untrusted internal actions", () => {
  assert.deepEqual(parseSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  for (const patch of [{ workStart: "17:00", workEnd: "09:00" }, { duration: "3" }, { workStart: "25:00" }, { frequency: 99 }, { enabled: "true" }]) {
    assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, ...patch }));
  }
  assert.throws(() => parseAction({ type: "heartbeat" }));
  assert.throws(() => parseAction({ type: "alarm", id: "fake" }));
  assert.throws(() => parseAction({ type: "start" }));
  assert.deepEqual(parseAction({ type: "skip", id: "break" }), { type: "skip", id: "break" });
  assert.deepEqual(parseAction({ type: "different", id: "break" }), { type: "different", id: "break" });
});
