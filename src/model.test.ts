import assert from "node:assert/strict";
import { test } from "node:test";
import { API_VERSION, checkWorkerVersion, chooseExercise, DEFAULT_SETTINGS, exerciseChoices, exerciseOptions, parseAction, parseRepResult, parseSettings } from "./model.ts";

const challenging = {
  ...DEFAULT_SETTINGS, difficulty: "challenging" as const, selection: "random" as const,
  randomExerciseIds: ["squats", "pushups", "plank"],
};

test("legacy settings retain gentle behavior and gain default selection preferences", () => {
  const { selection: _selection, randomExerciseIds: _ids, ...legacy } = DEFAULT_SETTINGS;
  assert.deepEqual(parseSettings(legacy), DEFAULT_SETTINGS);
  assert.equal(chooseExercise(parseSettings(legacy)).id, "march");
});

test("legacy calendar preferences require new setup without embedding a personal source", () => {
  const { calendar: _calendar, timeZone: _timeZone, ...legacy } = DEFAULT_SETTINGS;
  const migrated = parseSettings(legacy);
  assert.equal(migrated.calendar, null);
  assert.equal(migrated.timeZone, "America/New_York");
  assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, timeZone: "not/a-zone" }), /valid IANA/);
  assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, calendar: { type: "other" } }), /calendar source/);
  assert.deepEqual(parseSettings({ ...DEFAULT_SETTINGS, calendar: { type: "google" }, timeZone: "Europe/London" }).calendar, { type: "google" });
});

test("stale workers instruct users to reload without deleting data", () => {
  assert.doesNotThrow(() => checkWorkerVersion(API_VERSION));
  for (const version of [undefined, null, 0, 3, 4, "1"]) {
    assert.throws(() => checkWorkerVersion(version), /different versions.*Reload.*history are kept/);
  }
});

test("preference errors identify the invalid field rather than blaming every setting", () => {
  for (const [patch, message] of [
    [{ goal: "unknown" }, /movement goal/],
    [{ difficulty: "unknown" }, /movement style/],
    [{ duration: "3" }, /break length/],
    [{ frequency: 5 }, /daily intention/],
    [{ workStart: "" }, /start time/],
    [{ workEnd: "" }, /end time/],
    [{ workStart: "17:00", workEnd: "09:00" }, /Check AM\/PM/],
    [{ enabled: "true" }, /reminders/],
  ] as const) {
    assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, ...patch }), message);
  }
});

test("challenging style offers all six bodyweight movements independently of the gentle goal", () => {
  const expected = ["squats", "pushups", "reverse-lunges", "plank", "mountain-climbers", "jumping-jacks"];
  for (const goal of ["energy", "mobility"] as const) {
    assert.deepEqual(exerciseOptions({ goal, difficulty: "challenging" }).map((item) => item.id), expected);
  }
  for (const goal of ["energy", "mobility"] as const) {
    for (const difficulty of ["gentle", "steady"] as const) {
      assert.equal(exerciseOptions({ goal, difficulty }).length, 2);
    }
  }
});

test("random picks stay inside the selected set and avoid the current exercise", () => {
  const settings = parseSettings(challenging);
  assert.deepEqual(exerciseChoices(settings).map((item) => item.id), settings.randomExerciseIds);
  assert.equal(chooseExercise(settings, undefined, () => 0).id, "squats");
  assert.equal(chooseExercise(settings, undefined, () => .999).id, "plank");
  assert.equal(chooseExercise(settings, "squats", () => 0).id, "pushups");
  const single = parseSettings({ ...challenging, randomExerciseIds: ["pushups"] });
  assert.equal(chooseExercise(single, "pushups").id, "pushups");
});

test("selection preferences reject empty random sets, unknown IDs, wrong styles, and malformed values", () => {
  for (const patch of [
    { randomExerciseIds: [] }, { randomExerciseIds: ["unknown"] },
    { randomExerciseIds: ["march"] }, { randomExerciseIds: "squats" },
    { selection: "anything" }, { selection: null }, { randomExerciseIds: null },
  ]) {
    assert.throws(() => parseSettings({ ...challenging, ...patch }));
  }
  assert.deepEqual(parseSettings({ ...challenging, randomExerciseIds: ["squats", "squats"] }).randomExerciseIds, ["squats"]);
});

test("rep summaries accept only consistent bounded integers and never persist extra camera data", () => {
  const reps = { targetReps: 10, completedReps: 9, automaticReps: 10, manualAdjustment: -1, countingMode: "camera" };
  assert.deepEqual(parseRepResult({ ...reps, video: "not stored", landmarks: [1, 2, 3] }), reps);
  for (const patch of [
    { completedReps: 0 }, { targetReps: 0 }, { targetReps: 101 }, { completedReps: 1.5 },
    { automaticReps: NaN }, { manualAdjustment: Infinity }, { completedReps: 1001 },
    { manualAdjustment: -1001 }, { countingMode: "verified" }, { countingMode: "manual" },
  ]) assert.throws(() => parseRepResult({ ...reps, ...patch }));
  assert.deepEqual(parseAction({ type: "complete-reps", id: "break", reps }),
    { type: "complete-reps", id: "break", reps });
  assert.deepEqual(parseAction({ type: "start-early", id: "break" }), { type: "start-early", id: "break" });
});
