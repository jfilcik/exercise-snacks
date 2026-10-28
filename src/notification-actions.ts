import type { Action, AppState } from "./model.ts";

export const REMINDER_PREFIX = "exercise-snacks:";
export const REMINDER_BUTTONS: chrome.notifications.ButtonOptions[] = [
  { title: "Start" },
  { title: "Snooze" },
];

export function notificationAction(notificationId: string, buttonIndex: number): Action | null {
  if (!notificationId.startsWith(REMINDER_PREFIX)) return null;
  const id = notificationId.slice(REMINDER_PREFIX.length);
  if (!id || id === "test") return null;
  if (buttonIndex === 0) return { type: "start", id };
  if (buttonIndex === 1) return { type: "snooze", id };
  return null;
}

export async function handleNotificationButton(
  notificationId: string,
  buttonIndex: number,
  dispatch: (action: Action) => Promise<AppState>,
  openApp: () => Promise<unknown>,
): Promise<boolean> {
  const action = notificationAction(notificationId, buttonIndex);
  if (!action) return false;
  try {
    await dispatch(action);
  } finally {
    await openApp();
  }
  return true;
}
