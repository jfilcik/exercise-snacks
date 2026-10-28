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
