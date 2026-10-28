import { chooseExercise, type ExerciseBreak, type Settings, type Snapshot } from "./model.ts";
import { dateInZone, MINUTE, zonedInstant } from "./time.ts";

export function workBounds(date: string, settings: Settings): [number, number] {
  return [zonedInstant(`${date}T${settings.workStart}`, settings.timeZone), zonedInstant(`${date}T${settings.workEnd}`, settings.timeZone)];
}

export function fits(snapshot: Snapshot, settings: Settings, start: number, duration: number): boolean {
  const end = start + duration * MINUTE;
  const [workStart, workEnd] = workBounds(snapshot.date, settings);
  return start >= workStart && end <= workEnd && dateInZone(start, settings.timeZone) === snapshot.date &&
    snapshot.available.some((slot) => start >= Date.parse(slot.start) && end <= Date.parse(slot.end));
}

export function snapshotFresh(snapshot: Snapshot | null, now: number): snapshot is Snapshot {
  return snapshot !== null && snapshot.date === dateInZone(now, snapshot.timeZone) &&
    now >= Date.parse(snapshot.fetchedAt) && now - Date.parse(snapshot.fetchedAt) < 15 * MINUTE;
}

export function makePlan(snapshot: Snapshot, settings: Settings, previous: ExerciseBreak[], now: number, random = Math.random): ExerciseBreak[] {
  if (!settings.enabled || [0, 6].includes(new Date(`${snapshot.date}T12:00:00Z`).getUTCDay())) return [];
  const today = previous.filter((b) => b.date === snapshot.date && b.status !== "cancelled");
  const needed = Math.max(0, settings.frequency - today.length);
  const [start, end] = workBounds(snapshot.date, settings);
  const candidates: number[] = [];
  for (let t = Math.ceil(Math.max(now + 2 * MINUTE, start) / (5 * MINUTE)) * 5 * MINUTE;
    t + settings.duration * MINUTE <= end; t += 5 * MINUTE) {
    if (fits(snapshot, settings, t, settings.duration)) candidates.push(t);
  }
  const chosen: number[] = today.map((b) => Date.parse(b.startedAt ?? b.scheduledAt));
  const additions: number[] = [];
  for (let i = 0; i < needed; i++) {
    const target = Math.max(start, now) + (end - Math.max(start, now)) * (i + 1) / (needed + 1);
    const eligible = candidates.filter((t) => chosen.every((other) => Math.abs(t - other) >= 60 * MINUTE));
    eligible.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    if (eligible.length === 0) break;
    const t = eligible[0];
    chosen.push(t);
    additions.push(t);
  }
  today.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const plan: ExerciseBreak[] = [];
  let lastExerciseId: string | undefined;
  let historyIndex = 0;
  for (const time of additions.sort((a, b) => a - b)) {
    while (historyIndex < today.length && Date.parse(today[historyIndex].scheduledAt) <= time) {
      lastExerciseId = today[historyIndex++].exerciseId;
    }
    const exercise = chooseExercise(settings,
      settings.selection === "random" ? lastExerciseId : undefined, random);
    plan.push({
      id: crypto.randomUUID(), date: snapshot.date, scheduledAt: new Date(time).toISOString(),
      duration: settings.duration, exerciseId: exercise.id, status: "planned", snoozes: 0,
    });
    lastExerciseId = exercise.id;
  }
  return plan;
}

export function nextSnooze(snapshot: Snapshot, settings: Settings, item: ExerciseBreak, breaks: ExerciseBreak[], now: number): string {
  const [, workEnd] = workBounds(snapshot.date, settings);
  const earliest = Math.max(now, Date.parse(item.scheduledAt)) + 15 * MINUTE;
  for (let t = Math.ceil(earliest / MINUTE) * MINUTE; t < workEnd; t += MINUTE) {
    if (fits(snapshot, settings, t, item.duration) &&
        breaks.filter((b) => b.id !== item.id && b.date === item.date && b.status !== "cancelled")
          .every((b) => Math.abs(t - Date.parse(b.startedAt ?? b.scheduledAt)) >= 60 * MINUTE)) {
      return new Date(t).toISOString();
    }
  }
  throw new Error("No suitable free slot remains for snoozing today. You can skip this break instead.");
}
