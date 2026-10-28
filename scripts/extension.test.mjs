import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";

test("loaded extension: configured calendar, alarms, notifications, persistence, sessions, pause and reset", { timeout: 180_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), "exercise-snacks-e2e-"));
  let context;
  try {
    const dist = resolve(process.env.EXTENSION_DIRECTORY ?? "dist");
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true,
      viewport: { width: 460, height: 800 },
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const bookingUrl = process.env.BOOKINGS_TEST_URL ??
      "https://bookings.cloud.microsoft/bookwithme/user/example-user%40example.invalid/meetingtype/example-type?anonymous";
    if (!process.env.BOOKINGS_TEST_URL) {
      await worker.evaluate(() => {
        const nativeFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.protocol === "chrome-extension:" || url.protocol === "data:") return nativeFetch(input, init);
          assertPublicRequest(init);
          if (url.origin === "https://login.microsoftonline.com" && url.pathname.endsWith("/.well-known/openid-configuration")) {
            return Response.json({ authorization_endpoint: "https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/oauth2/v2.0/authorize" });
          }
          if (url.origin !== "https://bookings.cloud.microsoft") throw new Error("Unexpected external request in fixture test.");
          if (url.pathname.endsWith("/getStaffAvailability")) {
            const body = JSON.parse(init.body);
            return Response.json({ staffAvailabilityResponse: [{
              staffId: "1c1c7887-e0fc-479b-ac7d-6983d0f026ff",
              availabilityItems: [{
                status: "BOOKINGSAVAILABILITYSTATUS_AVAILABLE",
                startDateTime: body.startDateTime, endDateTime: body.endDateTime,
              }],
            }] });
          }
          if (url.pathname.includes("/services/")) return Response.json({ service: {
            serviceId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            isPrivate: false, restrictionType: "BOOKING_SERVICE_RESTRICTION_PUBLIC",
          } });
          return Response.json({ businessInfo: {
            id: "mbx:example-user@11111111-2222-4333-8444-555555555555",
            isPublished: true, businessTimeZone: "UTC", settings: { authType: "BOOKINGS_SELF_SERVICE_PAGE_AUTH_TYPE_ANONYMOUS" },
          } });
        };
        function assertPublicRequest(init) {
          if (init?.credentials !== "omit" || init?.redirect !== "error") throw new Error("Anonymous request safeguards were not applied.");
        }
      });
    }
    worker.on("console", (msg) => { if (msg.type() === "error") console.error("Worker:", msg.text()); });
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/index.html`);
    await page.getByLabel("Calendar source").selectOption("bookings");
    await page.getByLabel("Public Bookings meeting-type link").fill(bookingUrl);
    await page.getByLabel("Time zone", { exact: true }).fill("Not/AZone");
    assert.equal(await page.getByRole("button", { name: "Save & plan my day" }).count(), 1);
    const zone = process.env.BOOKINGS_TEST_TIME_ZONE ?? "America/New_York";
    await page.getByLabel("Time zone", { exact: true }).fill(zone);
    await page.getByRole("button", { name: "Save & plan my day" }).click();
    await page.getByText("Fresh snapshot", { exact: true }).or(page.getByRole("alert")).first().waitFor({ timeout: 90_000 });
    assert.equal(await page.getByRole("alert").count(), 0, await page.locator("body").innerText());
    const get = () => page.evaluate(() => chrome.runtime.sendMessage({ type: "get" }));
    const initial = await get();
    assert.equal(initial.ok, true);
    assert.equal(initial.apiVersion, 2);
    const invalidPreferences = await page.evaluate((settings) =>
      chrome.runtime.sendMessage({ type: "settings", settings: { ...settings, workStart: "17:00", workEnd: "09:00" } }),
    initial.state.settings);
    assert.equal(invalidPreferences.apiVersion, 2);
    assert.equal(invalidPreferences.ok, false);
    assert.match(invalidPreferences.error, /Check AM\/PM/);
    assert.equal(initial.state.snapshot.timeZone, zone);
    assert.equal(initial.state.settings.calendar.type, "bookings");
    assert.equal(initial.state.settings.calendar.url, bookingUrl);
    assert.ok(Array.isArray(initial.state.snapshot.available));
    const alarms = await worker.evaluate(() => chrome.alarms.getAll());
    assert.ok(alarms.some((a) => a.name === "exercise-snacks-refresh"));
    const planned = initial.state.breaks.filter((b) => b.status === "planned");
    assert.equal(alarms.filter((a) => a.name.startsWith("exercise-snacks:")).length, planned.length);
    if (process.env.EXTENSION_SCREENSHOT) {
      const path = resolve(process.env.EXTENSION_SCREENSHOT);
      await mkdir(resolve(path, ".."), { recursive: true });
      await page.screenshot({ path, fullPage: true });
    }
    if (planned.length) {
      const skipped = await page.evaluate((breakId) => chrome.runtime.sendMessage({ type: "skip", id: breakId }), planned[0].id);
      assert.equal(skipped.ok, true);
      assert.equal(skipped.state.breaks.find((b) => b.id === planned[0].id).status, "skipped");
    }

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    if (process.env.EXTENSION_SETTINGS_SCREENSHOT) {
      const path = resolve(process.env.EXTENSION_SETTINGS_SCREENSHOT);
      await mkdir(resolve(path, ".."), { recursive: true });
      await page.screenshot({ path, fullPage: true });
    }
    await page.getByLabel("Calendar source").selectOption("google");
    await page.getByText("Your primary Google calendar only.", { exact: true }).waitFor();
    if (!await worker.evaluate(() => !!chrome.runtime.getManifest().oauth2?.client_id)) {
      assert.equal(await page.getByRole("button", { name: "Connect Google Calendar", exact: true }).isDisabled(), true);
      await page.getByText("Google sign-in is not configured in this build.", { exact: false }).waitFor();
    }
    await page.getByLabel("Calendar source").selectOption("bookings");
    await page.getByLabel("Public Bookings meeting-type link").fill(bookingUrl);
    await page.getByLabel("Movement style").selectOption("challenging");
    await page.getByLabel("Exercise selection").selectOption("random");
    for (const name of ["Bodyweight squats", "Push-ups", "Reverse lunges", "Plank", "Mountain climbers", "Jumping jacks"]) {
      await page.getByRole("checkbox", { name, exact: true }).uncheck();
    }
    await page.getByRole("button", { name: "Save preferences & replan", exact: true }).click();
    await page.getByRole("alert").getByText("Select at least one exercise for your random mix.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").getByRole("button", { name: "Save preferences", exact: true }).isEnabled(), true);
    await page.getByRole("checkbox", { name: "Bodyweight squats", exact: true }).check();
    await page.getByRole("checkbox", { name: "Push-ups", exact: true }).check();
    await page.getByRole("button", { name: "Save preferences & replan", exact: true }).click();
    await page.getByRole("button", { name: "Save preferences & replan", exact: true }).waitFor({ state: "hidden", timeout: 90_000 });
    const randomState = (await get()).state;
    assert.equal(randomState.settings.difficulty, "challenging");
    assert.equal(randomState.settings.selection, "random");
    assert.deepEqual(randomState.settings.randomExerciseIds, ["squats", "pushups"]);
    assert.ok(randomState.breaks.filter((b) => b.status === "planned").every((b) => ["squats", "pushups"].includes(b.exerciseId)));
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    assert.equal(await page.getByLabel("Exercise selection").inputValue(), "random");
    assert.equal(await page.getByRole("checkbox", { name: "Bodyweight squats", exact: true }).isChecked(), true);
    assert.equal(await page.getByRole("checkbox", { name: "Plank", exact: true }).isChecked(), false);
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await page.getByRole("heading", { name: "Your last seven days" }).waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Test desktop notification" }).click();
    await page.getByText(/Test notification sent/).waitFor();

    // Controlled session fixture in this isolated test profile, not real exercise credit.
    const saved = (await get()).state;
    saved.breaks.push({
      id: "fixture-session", date: saved.snapshot.date,
      scheduledAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      duration: 2, exerciseId: "march", status: "active", snoozes: 0,
    });
    await worker.evaluate((state) => chrome.storage.local.set({ exerciseSnacksV1: state }), saved);
    await page.reload();
    await page.getByRole("button", { name: "Complete exercise", exact: true }).click();
    assert.equal((await get()).state.breaks.find((b) => b.id === "fixture-session").status, "completed");
    await page.reload();
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await page.getByText("All-time: 1 completed snacks.", { exact: false }).waitFor();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Enable local reminders and automatic availability refresh").uncheck();
    await page.getByRole("button", { name: "Save preferences & replan" }).click();
    await page.getByText(/Reminders are paused/).waitFor();
    assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).filter((a) => a.name.startsWith("exercise-snacks:")).length, 0);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Delete all local data", exact: true }).click();
    await page.getByRole("button", { name: "Delete everything", exact: true }).click();
    await page.getByRole("button", { name: "Save & plan my day" }).waitFor();
    const reset = await get();
    assert.equal(reset.state.settings, null);
    assert.deepEqual(reset.state.breaks, []);
    assert.equal(reset.state.snapshot, null);
    assert.deepEqual(errors, []);
    console.log(`Verified real extension storage, source setup, ${process.env.BOOKINGS_TEST_URL ? "live anonymous Bookings" : "fixture-driven public Bookings"}, Google setup gating, worker messaging, alarms, notification creation, timer completion, pause, and reset.`);
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
