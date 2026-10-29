import { API_VERSION, type AppState, type RepResult } from "./model.ts";

const now = new Date();
const nowIso = now.toISOString();
const settings: NonNullable<AppState["settings"]> = {
  calendar: null,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  goal: "energy",
  difficulty: "challenging",
  selection: "suggested",
  randomExerciseIds: ["squats"],
  duration: 3,
  frequency: 3,
  workStart: "00:00",
  workEnd: "23:59",
  enabled: false,
};
const state: AppState = {
  version: 1,
  settings,
  snapshot: null,
  breaks: [{
    id: "camera-preview-squat",
    date: nowIso.slice(0, 10),
    scheduledAt: nowIso,
    startedAt: nowIso,
    duration: 3,
    exerciseId: "squats",
    status: "active",
    snoozes: 0,
  }],
  lastError: null,
};
const listeners = new Set<() => void>();

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    runtime: {
      id: "exercise-snacks-camera-preview",
      getURL: (path: string) => new URL(path, `${location.origin}/`).href,
      sendMessage: async (action: { type: string; id?: string; reps?: RepResult }) => {
        const item = state.breaks.find((entry) => entry.id === action.id);
        if (action.type === "complete-reps" && item?.status === "active" && action.reps) {
          item.status = "completed";
          item.completedAt = new Date().toISOString();
          item.reps = {
            ...action.reps,
            elapsedSeconds: Math.min(item.duration * 60, Math.max(0, Math.floor(
              (Date.parse(item.completedAt) - Date.parse(item.startedAt ?? item.scheduledAt)) / 1000,
            ))),
          };
          for (const listener of listeners) listener();
        } else if (action.type === "skip" && item?.status === "active") {
          item.status = "skipped";
          for (const listener of listeners) listener();
        }
        return { apiVersion: API_VERSION, ok: true, state: structuredClone(state) };
      },
    },
    storage: {
      onChanged: {
        addListener: (listener: () => void) => listeners.add(listener),
        removeListener: (listener: () => void) => listeners.delete(listener),
      },
    },
  },
});

void import("./coach.tsx");
