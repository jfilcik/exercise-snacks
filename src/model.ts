import { parseCalendarSource, type CalendarSource } from "./calendar-source.ts";
import { TIME_ZONE, validateTimeZone } from "./time.ts";

export type Interval = { start: string; end: string };
export type Snapshot = {
  date: string;
  fetchedAt: string;
  timeZone: string;
  available: Interval[];
  blocked: Interval[];
};
export type Settings = {
  calendar: CalendarSource | null;
  timeZone: string;
  goal: "energy" | "mobility";
  difficulty: "gentle" | "steady" | "challenging";
  selection: "suggested" | "random";
  randomExerciseIds: string[];
  duration: 2 | 3 | 5;
  frequency: 2 | 3;
  workStart: string;
  workEnd: string;
  enabled: boolean;
};
export type ExerciseBreak = {
  id: string;
  date: string;
  scheduledAt: string;
  duration: number;
  exerciseId: string;
  status: "planned" | "ready" | "active" | "completed" | "skipped" | "missed" | "cancelled";
  snoozes: number;
  scheduleMode?: "calendar" | "spaced";
  startedAt?: string;
  completedAt?: string;
  reps?: RepSummary;
};
export type RepResult = {
  targetReps: number;
  completedReps: number;
  automaticReps: number;
  manualAdjustment: number;
  countingMode: "camera" | "manual";
};
export type RepSummary = RepResult & { elapsedSeconds: number };
export type AppState = {
  version: 1;
  settings: Settings | null;
  snapshot: Snapshot | null;
  breaks: ExerciseBreak[];
  lastError: string | null;
};
export type Action =
  | { type: "get" | "refresh" | "heartbeat" | "reset" | "test-notification" | "connect-google" | "disconnect-google" }
  | { type: "settings"; settings: Settings }
  | { type: "start" | "start-early" | "complete" | "skip" | "snooze" | "different" | "alarm"; id: string }
  | { type: "complete-reps"; id: string; reps: RepResult };
export const API_VERSION = 5;
export type Reply = ({ ok: true; state: AppState } | { ok: false; error: string }) & { apiVersion: typeof API_VERSION };

export function checkWorkerVersion(version: unknown): void {
  if (version !== API_VERSION) {
    throw new Error("The popup and background worker are different versions. Open chrome://extensions or edge://extensions, click Reload on Exercise Snacks, then reopen it. Your saved settings and history are kept.");
  }
}

export const initialState = (): AppState => ({
  version: 1, settings: null, snapshot: null, breaks: [], lastError: null,
});
export const DEFAULT_SETTINGS: Settings = {
  calendar: null, timeZone: TIME_ZONE,
  goal: "energy", difficulty: "gentle", duration: 3, frequency: 3,
  selection: "suggested", randomExerciseIds: ["march", "seated-reach"],
  workStart: "09:00", workEnd: "17:00", enabled: true,
};
export const EXERCISES = [
  { id: "shoulders", name: "Shoulder reset", goal: "mobility", difficulty: "gentle",
    instruction: "Sit or stand comfortably. Slowly roll your shoulders, then reach gently overhead. Alternate with relaxed arm circles at your own pace." },
  { id: "ankle-circles", name: "Ankle reset", goal: "mobility", difficulty: "gentle",
    instruction: "Sit comfortably and slowly circle one ankle, then the other. Keep each movement small and relaxed." },
  { id: "ankles", name: "Desk-side reset", goal: "mobility", difficulty: "steady",
    instruction: "Stand beside your desk for support. Alternate gentle heel raises with small shoulder circles. Keep the movement slow and comfortable." },
  { id: "standing-reset", name: "Standing reset", goal: "mobility", difficulty: "steady",
    instruction: "Stand comfortably. Reach one arm overhead at a time, then gently shift your weight from side to side." },
  { id: "march", name: "A little movement", goal: "energy", difficulty: "gentle",
    instruction: "Seated or standing, gently march in place. Let your arms swing comfortably. Take pauses whenever you like." },
  { id: "seated-reach", name: "Reach and reset", goal: "energy", difficulty: "gentle",
    instruction: "Stay seated or stand. Reach your arms forward, then overhead if comfortable. Alternate with a few relaxed arm circles." },
  { id: "walk", name: "Walk and reset", goal: "energy", difficulty: "steady",
    instruction: "Take a comfortable walk around your room or hallway. Keep an easy pace, relax your shoulders, and return when the timer ends." },
  { id: "side-steps", name: "Easy side steps", goal: "energy", difficulty: "steady",
    instruction: "Stand with room to move. Take a few comfortable steps side to side, then walk in place. Keep an easy pace." },
  { id: "squats", name: "Bodyweight squats", goal: "energy", difficulty: "challenging",
    instruction: "Try 5-10 controlled squats to a comfortable depth, then rest. Keep your feet planted and knees tracking with your toes. Repeat only if comfortable; the timer includes rest." },
  { id: "pushups", name: "Push-ups", goal: "energy", difficulty: "challenging",
    instruction: "Try 3-8 controlled push-ups, then rest. Use a wall or your knees to reduce the load. Keep your body aligned and breathe throughout. The timer includes rest, not nonstop reps." },
  { id: "reverse-lunges", name: "Reverse lunges", goal: "energy", difficulty: "challenging",
    instruction: "Step back into a comfortable lunge, then return to standing. Try 3-5 per side, then rest. Use stable support for balance and reduce the depth if needed." },
  { id: "plank", name: "Plank", goal: "energy", difficulty: "challenging",
    instruction: "Try a 10-20 second forearm plank, then rest. Keep your body aligned and breathe normally. Lower your knees to reduce the load. Repeat only if comfortable." },
  { id: "mountain-climbers", name: "Mountain climbers", goal: "energy", difficulty: "challenging",
    instruction: "From a comfortable high plank, slowly bring one knee forward at a time for 10-20 seconds, then rest. Step rather than jump and keep your movements controlled." },
  { id: "jumping-jacks", name: "Jumping jacks", goal: "energy", difficulty: "challenging",
    instruction: "Try 10-20 seconds of easy jumping jacks, then rest. For a lower-impact option, step one foot out at a time instead of jumping. Leave clear space around you." },
] as const;

export function exerciseOptions(settings: Pick<Settings, "goal" | "difficulty">) {
  return EXERCISES.filter((exercise) => exercise.difficulty === settings.difficulty &&
    (settings.difficulty === "challenging" || exercise.goal === settings.goal));
}

export function exerciseChoices(settings: Settings) {
  const options = exerciseOptions(settings);
  return settings.selection === "random"
    ? options.filter((exercise) => settings.randomExerciseIds.includes(exercise.id)) : options;
}

export function chooseExercise(settings: Settings, currentId?: string, random = Math.random) {
  const options = exerciseChoices(settings);
  if (options.length === 0) throw new Error("Select at least one exercise for your random mix.");
  if (settings.selection === "random") {
    const alternatives = options.filter((exercise) => exercise.id !== currentId);
    const pool = alternatives.length > 0 ? alternatives : options;
    return pool[Math.floor(random() * pool.length)];
  }
  const current = options.findIndex((exercise) => exercise.id === currentId);
  return options[(current + 1) % options.length];
}

export function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") throw new Error("Settings are missing.");
  const s = value as Record<string, unknown>;
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!["energy", "mobility"].includes(String(s.goal))) {
    throw new Error("Choose a movement goal: more movement or a posture reset.");
  }
  if (!["gentle", "steady", "challenging"].includes(String(s.difficulty))) {
    throw new Error("Choose a movement style: gentle, easy standing/walking, or challenging. If you just updated the app, reload the extension first.");
  }
  if (typeof s.duration !== "number" || ![2, 3, 5].includes(s.duration)) {
    throw new Error("Choose a break length of 2, 3, or 5 minutes.");
  }
  if (typeof s.frequency !== "number" || ![2, 3].includes(s.frequency)) {
    throw new Error("Choose a daily intention of 2 or 3 exercise snacks.");
  }
  if (typeof s.workStart !== "string" || !time.test(s.workStart)) {
    throw new Error("Set a valid workday start time.");
  }
  if (typeof s.workEnd !== "string" || !time.test(s.workEnd)) {
    throw new Error("Set a valid workday end time.");
  }
  if (s.workStart >= s.workEnd) {
    throw new Error("Workday start must be before workday end on the same day. Check AM/PM in both time fields.");
  }
  if (typeof s.enabled !== "boolean") {
    throw new Error("Choose whether local reminders are enabled.");
  }
  const settings: Settings = {
    calendar: parseCalendarSource(s.calendar), timeZone: validateTimeZone(s.timeZone ?? TIME_ZONE),
    goal: s.goal as Settings["goal"], difficulty: s.difficulty as Settings["difficulty"],
    selection: "suggested", randomExerciseIds: [],
    duration: s.duration as Settings["duration"], frequency: s.frequency as Settings["frequency"],
    workStart: s.workStart, workEnd: s.workEnd, enabled: s.enabled,
  };
  if (s.selection !== undefined && s.selection !== "suggested" && s.selection !== "random") {
    throw new Error("Choose suggested exercises or a random mix.");
  }
  settings.selection = s.selection ?? "suggested";
  const eligibleIds: string[] = exerciseOptions(settings).map((exercise) => exercise.id);
  if (s.randomExerciseIds !== undefined &&
      (!Array.isArray(s.randomExerciseIds) ||
       !s.randomExerciseIds.every((id: unknown) => typeof id === "string" && eligibleIds.includes(id)))) {
    throw new Error("Choose exercises from your current movement style.");
  }
  settings.randomExerciseIds = s.randomExerciseIds === undefined
    ? eligibleIds : [...new Set<string>(s.randomExerciseIds)];
  if (settings.selection === "random" && settings.randomExerciseIds.length === 0) {
    throw new Error("Select at least one exercise for your random mix.");
  }
  return settings;
}

export function parseAction(value: unknown): Action {
  if (!value || typeof value !== "object") throw new Error("Invalid extension request.");
  const a = value as Record<string, unknown>;
  if (a.type === "settings") return { type: "settings", settings: parseSettings(a.settings) };
  if (["get", "refresh", "reset", "test-notification", "connect-google", "disconnect-google"].includes(String(a.type))) {
    return { type: a.type as "get" | "refresh" | "reset" | "test-notification" | "connect-google" | "disconnect-google" };
  }
  if (a.type === "complete-reps" && typeof a.id === "string") {
    return { type: "complete-reps", id: a.id, reps: parseRepResult(a.reps) };
  }
  if (["start", "start-early", "complete", "skip", "snooze", "different"].includes(String(a.type)) && typeof a.id === "string") {
    return { type: a.type as "start" | "start-early" | "complete" | "skip" | "snooze" | "different", id: a.id };
  }

  throw new Error("Unknown extension action.");
}

export function parseRepResult(value: unknown): RepResult {
  if (!value || typeof value !== "object") throw new Error("Rep summary is missing.");
  const r = value as Record<string, unknown>;
  function integer(key: string, min: number, max: number): number {
    const n = r[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
      throw new Error(`Invalid ${key} in rep summary.`);
    }
    return n;
  }
  const targetReps = integer("targetReps", 1, 100);
  const completedReps = integer("completedReps", 1, 1000);
  const automaticReps = integer("automaticReps", 0, 1000);
  const manualAdjustment = integer("manualAdjustment", -1000, 1000);
  if ((r.countingMode !== "camera" && r.countingMode !== "manual") ||
      completedReps !== automaticReps + manualAdjustment ||
      (r.countingMode === "manual" && automaticReps !== 0)) {
    throw new Error("Rep count, adjustments, and counting mode do not agree.");
  }
  return { targetReps, completedReps, automaticReps, manualAdjustment, countingMode: r.countingMode };
}

export function completedMinutes(items: ExerciseBreak[]): number {
  return Math.round(items.filter((item) => item.status === "completed")
    .reduce((sum, item) => sum + (item.reps ? item.reps.elapsedSeconds / 60 : item.duration), 0) * 10) / 10;
}
