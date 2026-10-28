import { BookingsCalendarProvider } from "./bookings.ts";
import { GoogleCalendarProvider, GOOGLE_SCOPE, type GoogleTokens } from "./google.ts";
import { Controller } from "./controller.ts";
import { API_VERSION, initialState, parseAction, type Action, type AppState, type Reply } from "./model.ts";
import { handleNotificationButton, REMINDER_PREFIX } from "./notification-actions.ts";

const STATE_KEY = "exerciseSnacksV1";
const HEARTBEAT = "exercise-snacks-refresh";
const PREFIX = REMINDER_PREFIX;
const googleTokens: GoogleTokens = {
  async get(interactive) {
    const oauth = chrome.runtime.getManifest().oauth2;
    if (!oauth?.client_id || !oauth.scopes?.includes(GOOGLE_SCOPE)) {
      throw new Error("Google sign-in is not configured in this build. Follow the Google Calendar OAuth setup in the README and rebuild.");
    }
    const result = await chrome.identity.getAuthToken({ interactive, scopes: [GOOGLE_SCOPE] });
    if (!result.token || (result.grantedScopes && !result.grantedScopes.includes(GOOGLE_SCOPE))) {
      throw new Error("Google Calendar free/busy permission was not granted. Connect again if your account policy allows it.");
    }
    return result.token;
  },
  async invalidate(token) { await chrome.identity.removeCachedAuthToken({ token }); },
};
const google = new GoogleCalendarProvider(googleTokens);

function clearNotification(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.notifications.clear(id, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

const controller = new Controller({
  async load() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    const state: AppState | undefined = stored[STATE_KEY];
    if (state && state.version !== 1) throw new Error("Unsupported saved data version. Reset local data in extension settings.");
    return state ?? initialState();
  },
  async save(state) {
    await chrome.storage.local.set({ [STATE_KEY]: state });
    await chrome.action.setBadgeText({ text: state.lastError ? "!" : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b74325" });
  },
  async clearData() { await chrome.storage.local.clear(); },
  fetchSnapshot(date, now, settings) {
    if (settings.calendar?.type === "bookings") {
      return new BookingsCalendarProvider(settings.calendar.url).getAvailability(date, now, settings.timeZone);
    }
    if (settings.calendar?.type === "google") return google.getAvailability(date, now, settings.timeZone);
    throw new Error("Choose a calendar source in Settings.");
  },
  async connectGoogle() { await googleTokens.get(true); },
  async disconnectGoogle() {
    if (chrome.runtime.getManifest().oauth2?.client_id) await chrome.identity.clearAllCachedAuthTokens();
  },
  async syncAlarms(items) {
    const alarms = await chrome.alarms.getAll();
    await Promise.all(alarms.filter((a) => a.name.startsWith(PREFIX)).map((a) => chrome.alarms.clear(a.name)));
    await Promise.all(items.map((item) => chrome.alarms.create(`${PREFIX}${item.id}`, {
      when: Math.max(Date.now() + 1000, Date.parse(item.scheduledAt)),
    })));
  },
  async notify(id, title, message, buttons) {
    const permission = await new Promise<string>((resolve, reject) => {
      chrome.notifications.getPermissionLevel((value) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(value);
      });
    });
    if (permission !== "granted") {
      throw new Error("Notifications are blocked. Allow this extension's notifications in Chrome/Edge and your OS settings.");
    }
    await chrome.notifications.create(`${PREFIX}${id}`, {
      type: "basic", iconUrl: chrome.runtime.getURL("icon128.png"),
      title, message, priority: 0, buttons,
    });
  },
  async clearNotifications(keepIds) {
    const ids = await new Promise<string[]>((resolve, reject) => {
      chrome.notifications.getAll((value) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(Object.keys(value));
      });
    });
    await Promise.all(ids
      .filter((id) => id.startsWith(PREFIX) && !keepIds.includes(id.slice(PREFIX.length)))
      .map(clearNotification));
  },
});

async function dispatch(action: Action): Promise<AppState> {
  try { return await controller.run(action); }
  catch (reason) {
    console.error("Exercise Snacks:", reason);
    await chrome.action.setBadgeText({ text: "!" });
    throw reason;
  }
}

async function heartbeat() {
  await chrome.alarms.create(HEARTBEAT, { periodInMinutes: 5 });
  await dispatch({ type: "heartbeat" });
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (reply: Reply) => void) => {
  if (sender.id !== chrome.runtime.id) return;
  let action: Action;
  try { action = parseAction(message); }
  catch (reason) {
    sendResponse({ apiVersion: API_VERSION, ok: false, error: reason instanceof Error ? reason.message : String(reason) });
    return;
  }
  void dispatch(action).then(
    (state) => sendResponse({ apiVersion: API_VERSION, ok: true, state }),
    (reason: unknown) => sendResponse({ apiVersion: API_VERSION, ok: false, error: reason instanceof Error ? reason.message : String(reason) }),
  );
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  const action: Action = alarm.name === HEARTBEAT
    ? { type: "heartbeat" }
    : { type: "alarm", id: alarm.name.slice(PREFIX.length) };
  if (alarm.name === HEARTBEAT || alarm.name.startsWith(PREFIX)) {
    void dispatch(action).catch(() => { /* dispatch logs and shows the error badge. */ });
  }
});
chrome.runtime.onInstalled.addListener(() => {
  void heartbeat().catch((reason: unknown) => console.error("Initialization failed:", reason));
});
chrome.runtime.onStartup.addListener(() => {
  void heartbeat().catch((reason: unknown) => console.error("Startup failed:", reason));
});
chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith(PREFIX)) {
    void clearNotification(id).then(() => chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }))
      .catch((reason: unknown) => console.error("Could not open exercise session:", reason));
  }
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  void clearNotification(notificationId)
    .then(() => handleNotificationButton(
      notificationId,
      buttonIndex,
      dispatch,
      () => chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }),
    ))
    .catch((reason: unknown) => console.error("Notification action failed:", reason));
});
