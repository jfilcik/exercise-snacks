import { chooseExercise, EXERCISES, exerciseChoices, initialState, parseRepResult, parseSettings, type Action, type AppState, type ExerciseBreak, type Settings, type Snapshot } from "./model.ts";
import { REMINDER_BUTTONS } from "./notification-actions.ts";
import { fits, fitsWorkday, makePlan, nextSnooze, snapshotFresh } from "./scheduler.ts";
import { dateInZone, MINUTE } from "./time.ts";

export interface Ports {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
  clearData(): Promise<void>;
  fetchSnapshot(date: string, now: number, settings: Settings): Promise<Snapshot>;
  connectGoogle?(): Promise<void>;
  disconnectGoogle?(): Promise<void>;
  syncAlarms(items: ExerciseBreak[]): Promise<void>;
  notify(id: string, title: string, message: string, buttons?: chrome.notifications.ButtonOptions[]): Promise<void>;
  clearNotifications(keepIds: string[]): Promise<void>;
}

export class Controller {
  private ports: Ports;
  private clock: () => number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ports: Ports, clock = Date.now) { this.ports = ports; this.clock = clock; }

  run(action: Action): Promise<AppState> {
    const result = this.queue.then(() => this.apply(action));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async refresh(state: AppState, now: number, force = false): Promise<void> {
    if (!state.settings?.enabled) return;
    if (!state.settings.calendar) {
      state.snapshot = null;
      state.lastError = null;
    } else if (force || !snapshotFresh(state.snapshot, now) || state.lastError) {
      try {
        const snapshot = await this.ports.fetchSnapshot(dateInZone(now, state.settings.timeZone), now, state.settings);
        now = this.clock();
        if (snapshot.timeZone !== state.settings.timeZone ||
            snapshot.date !== dateInZone(now, state.settings.timeZone) || !snapshotFresh(snapshot, now)) {
          throw new Error("Calendar returned stale availability or a different day or time zone. Availability was not used.");
        }
        state.snapshot = snapshot;
        state.lastError = null;
      } catch (reason) {
        state.snapshot = null;
        state.lastError = reason instanceof Error ? reason.message : String(reason);
      }
    }
    now = this.clock();
    const date = dateInZone(now, state.settings.timeZone);
    for (const item of state.breaks) {
      if (!["planned", "ready"].includes(item.status)) continue;
      const time = Date.parse(item.scheduledAt);
      if (item.date !== date || now - time > (item.status === "ready" ? 10 : 5) * MINUTE) {
        item.status = "missed";
      } else if (!this.reminderFits(state, item, Math.max(time, now), now)) {
        item.status = "cancelled";
      } else if (item.scheduleMode === "spaced" && snapshotFresh(state.snapshot, now) &&
          !state.lastError && fits(state.snapshot, state.settings, Math.max(time, now), item.duration)) {
        item.scheduleMode = "calendar";
      }
    }
    this.plan(state, now);
  }

  private reminderFits(state: AppState, item: ExerciseBreak, start: number, now: number): boolean {
    if (!state.settings) return false;
    return item.scheduleMode === "spaced"
      ? fitsWorkday(item.date, state.settings, start, item.duration)
      : !state.lastError && snapshotFresh(state.snapshot, now) && fits(state.snapshot, state.settings, start, item.duration);
  }

  private plan(state: AppState, now: number): void {
    if (!state.settings) return;
    if (!state.lastError && snapshotFresh(state.snapshot, now)) {
      state.breaks.push(...makePlan(state.snapshot, state.settings, state.breaks, now));
    }
    state.breaks.push(...makePlan(null, state.settings, state.breaks, now));
  }

  private async persist(state: AppState): Promise<void> {
    await this.ports.save(state);
    const now = this.clock();
    await this.ports.syncAlarms(state.settings?.enabled
      ? state.breaks.filter((b) => b.status === "planned" && this.reminderFits(state, b, Date.parse(b.scheduledAt), now)) : []);
    await this.ports.clearNotifications(state.breaks.filter((b) => b.status === "ready").map((b) => b.id));
  }

  private async apply(action: Action): Promise<AppState> {
    let state = await this.ports.load();
    let now = this.clock();
    try {
      if (state.settings) state.settings = parseSettings(state.settings);
      if (action.type === "get") return state;
      if (action.type === "reset") {
        await this.ports.disconnectGoogle?.();
        await this.ports.clearData();
        state = initialState();
      } else if (action.type === "settings") {
        const settings = parseSettings(action.settings);
        state.settings = settings;
        state.snapshot = null;
        state.lastError = null;
        for (const item of state.breaks) {
          if (item.status === "planned" || item.status === "ready") item.status = "cancelled";
        }
        await this.refresh(state, now, true);
      } else if (action.type === "heartbeat" || action.type === "refresh") {
        await this.refresh(state, now, action.type === "refresh");
      } else if (action.type === "test-notification") {
        await this.ports.notify("test", "Exercise Snacks is ready", "Notifications are working. Reminders use your work hours; time-based reminders are not verified free slots.");
        return state;
      } else if (action.type === "connect-google") {
        if (!this.ports.connectGoogle) throw new Error("Google Calendar sign-in is unavailable in this build.");
        await this.ports.connectGoogle();
        return state;
      } else if (action.type === "disconnect-google") {
        if (!this.ports.disconnectGoogle) throw new Error("Google Calendar sign-in is unavailable in this build.");
        if (state.settings?.calendar?.type === "google") {
          state.settings.enabled = false;
          state.snapshot = null;
          state.lastError = null;
          for (const item of state.breaks) {
            if (["planned", "ready"].includes(item.status)) item.status = "cancelled";
          }
          await this.persist(state);
        }
        await this.ports.disconnectGoogle();
      } else {
        if (["alarm", "start", "snooze"].includes(action.type)) {
          await this.refresh(state, now, true);
          now = this.clock();
        }
        const id = "id" in action ? action.id : null;
        const item = state.breaks.find((b) => b.id === id);
        if (!item) throw new Error("This break no longer exists. Refresh the extension.");
        if (action.type === "alarm") {
          if (item.status === "planned") {
            if (!state.settings?.enabled || !this.reminderFits(state, item, now, now) ||
                now - Date.parse(item.scheduledAt) > 5 * MINUTE ||
                state.breaks.some((b) => b.id !== item.id && ["ready", "active"].includes(b.status))) {
              item.status = "missed";
            } else if (Date.parse(item.scheduledAt) <= now + 1000) {
              const exercise = EXERCISES.find((e) => e.id === item.exerciseId)!;
              // Persist readiness before notification so a worker restart cannot issue it twice.
              item.status = "ready";
              await this.ports.save(state);
              await this.ports.notify(
                item.id,
                `${item.duration} minutes for you`,
                item.scheduleMode === "spaced"
                  ? `${exercise.name}. Time-based reminder, not a verified free slot. Start when it suits you, or snooze.`
                  : `${exercise.name}. Choose Start or Snooze below, or open the app to skip.`,
                REMINDER_BUTTONS,
              );
            }
          }
        } else if (action.type === "start" || action.type === "start-early") {
          if (item.status === "active") { await this.persist(state); return state; }
          if (!["planned", "ready"].includes(item.status) || !state.settings ||
              item.date !== dateInZone(now, state.settings.timeZone)) {
            throw new Error("Choose one of today's planned snacks that hasn't ended.");
          }
          if (action.type === "start" && (!state.settings.enabled ||
              Date.parse(item.scheduledAt) > now || !this.reminderFits(state, item, now, now))) {
            throw new Error("This break is not available now. Open Today and choose Start now to start manually without checking the calendar.");
          }
          if (state.breaks.some((b) => b.status === "active" && b.id !== item.id)) {
            throw new Error("Finish or skip your current exercise first.");
          }
          item.status = "active";
          item.startedAt = new Date(now).toISOString();
          if (action.type === "start-early") {
            if (state.lastError) {
              state.snapshot = null;
              state.lastError = null;
            }
            item.scheduledAt = item.startedAt;
            for (const other of state.breaks) {
              if (other.id !== item.id && ["planned", "ready"].includes(other.status) &&
                  Math.abs(Date.parse(other.scheduledAt) - now) < 60 * MINUTE) {
                other.status = "cancelled";
              }
            }
            this.plan(state, now);
          }
        } else if (action.type === "complete-reps") {
          if (item.status !== "completed") {
            if (item.status !== "active" || !item.startedAt || item.exerciseId !== "squats") {
              throw new Error("Rep counting is available for an active squat break only.");
            }
            const reps = parseRepResult(action.reps);
            item.reps = {
              ...reps,
              elapsedSeconds: Math.min(item.duration * 60, Math.max(0, Math.floor((now - Date.parse(item.startedAt)) / 1000))),
            };
            item.status = "completed";
            item.completedAt = new Date(now).toISOString();
          }
        } else if (action.type === "complete") {
          if (item.status !== "completed") {
            if (item.status !== "active" || !item.startedAt ||
                now < Date.parse(item.startedAt) + item.duration * MINUTE) {
              throw new Error("Finish the exercise timer before marking this break complete.");
            }
            item.status = "completed";
            item.completedAt = new Date(now).toISOString();
          }
        } else if (action.type === "skip") {
          if (!["planned", "ready", "active"].includes(item.status)) throw new Error("This break has already ended.");
          item.status = "skipped";
        } else if (action.type === "snooze") {
          if (!["planned", "ready"].includes(item.status) || item.snoozes >= 2 ||
              !state.settings?.enabled || item.date !== dateInZone(now, state.settings.timeZone)) {
            throw new Error("This break cannot be snoozed. Each break allows two snoozes.");
          }
          item.scheduledAt = nextSnooze(state.snapshot, state.settings, item, state.breaks, now);
          item.status = "planned";
          item.snoozes += 1;
        } else if (action.type === "different") {
          if (!["planned", "ready"].includes(item.status) || !state.settings) {
            throw new Error("You can only change an exercise that has not started yet.");
          }
          if (!exerciseChoices(state.settings).some((candidate) => candidate.id !== item.exerciseId)) {
            throw new Error("Only one exercise is selected. Add another in Settings to switch exercises.");
          }
          item.exerciseId = chooseExercise(state.settings, item.exerciseId).id;
        }
      }
      await this.persist(state);
      return state;
    } catch (reason) {
      state.lastError = reason instanceof Error ? reason.message : String(reason);
      await this.ports.save(state);
      await this.ports.syncAlarms([]);
      await this.ports.clearNotifications([]);
      throw reason;
    }
  }
}
