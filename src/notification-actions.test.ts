import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState } from "./model.ts";
import { handleNotificationButton, notificationAction, REMINDER_BUTTONS, REMINDER_PREFIX } from "./notification-actions.ts";

test("desktop reminder exposes direct Start and Snooze actions", () => {
  const id = `${REMINDER_PREFIX}break-123`;
  assert.deepEqual(REMINDER_BUTTONS, [{ title: "Start" }, { title: "Snooze" }]);
  assert.deepEqual(notificationAction(id, 0), { type: "start", id: "break-123" });
  assert.deepEqual(notificationAction(id, 1), { type: "snooze", id: "break-123" });
});

test("notification actions cannot dispatch for test notifications or unknown buttons", () => {
  assert.equal(notificationAction("exercise-snacks:test", 0), null);
  assert.equal(notificationAction("foreign:break-123", 0), null);
  assert.equal(notificationAction(`${REMINDER_PREFIX}break-123`, 2), null);
  assert.equal(notificationAction(`${REMINDER_PREFIX}`, 0), null);
});

test("notification actions start or snooze, then open the app to show the result", async () => {
  for (const [index, expected] of [
    [0, { type: "start", id: "break-123" }],
    [1, { type: "snooze", id: "break-123" }],
  ] as const) {
    const calls: string[] = [];
    assert.equal(await handleNotificationButton(
      `${REMINDER_PREFIX}break-123`,
      index,
      async (action) => { calls.push(action.type); return initialState(); },
      async () => { calls.push("open"); },
    ), true);
    assert.deepEqual(calls, [expected.type, "open"]);
  }
});

test("notification action still opens app after an action error so the user can see it", async () => {
  const calls: string[] = [];
  await assert.rejects(handleNotificationButton(
    `${REMINDER_PREFIX}break-123`,
    0,
    async () => { throw new Error("No suitable window."); },
    async () => { calls.push("open"); },
  ), /No suitable window/);
  assert.deepEqual(calls, ["open"]);
});
