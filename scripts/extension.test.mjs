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
        globalThis.__calendarRequests = 0;
        globalThis.fetch = async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.protocol === "chrome-extension:" || url.protocol === "data:") return nativeFetch(input, init);
          globalThis.__calendarRequests++;
          if (globalThis.__calendarOffline) throw new Error("Offline fixture: calendar must not be checked for a manual start.");
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
    assert.equal(initial.apiVersion, 5);
    const invalidPreferences = await page.evaluate((settings) =>
      chrome.runtime.sendMessage({ type: "settings", settings: { ...settings, workStart: "17:00", workEnd: "09:00" } }),
    initial.state.settings);
    assert.equal(invalidPreferences.apiVersion, 5);
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
      let requests;
      if (!process.env.BOOKINGS_TEST_URL) {
        requests = await worker.evaluate(async () => {
          globalThis.__calendarOffline = true;
          const stored = await chrome.storage.local.get("exerciseSnacksV1");
          const state = stored.exerciseSnacksV1;
          state.lastError = "Offline; availability cannot be verified.";
          await chrome.storage.local.set({ exerciseSnacksV1: state });
          return globalThis.__calendarRequests;
        });
        await page.reload();
      }
      await page.getByRole("button", { name: "Start early", exact: true }).first().click();
      await page.getByRole("region", { name: "Active exercise" }).waitFor();
      const manualState = (await get()).state;
      const early = manualState.breaks.find((b) => b.id === planned[0].id);
      assert.equal(early.status, "active");
      assert.ok(Date.parse(early.startedAt) < Date.parse(planned[0].scheduledAt));
      if (!process.env.BOOKINGS_TEST_URL) {
        assert.equal(await worker.evaluate(() => globalThis.__calendarRequests), requests, "Manual start must make zero calendar requests.");
        assert.equal(manualState.lastError, null);
        assert.equal(manualState.snapshot, null, "A previously failed calendar snapshot must not be presented as verified.");
        assert.equal(await page.getByRole("alert").count(), 0);
        await worker.evaluate(() => { globalThis.__calendarOffline = false; });
      }
      assert.ok(!(await worker.evaluate(() => chrome.alarms.getAll()))
        .some((alarm) => alarm.name === `exercise-snacks:${early.id}`));
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

    await test("Camera Coach: opt-in real local inference, camera lifecycle, manual corrections and persisted summaries offline",
      { timeout: 180_000 }, async () => {
        const profile = await mkdtemp(join(tmpdir(), "exercise-snacks-camera-"));
        let context;
        try {
          const dist = resolve(process.env.EXTENSION_DIRECTORY ?? "dist");
          context = await chromium.launchPersistentContext(profile, {
            channel: "chromium", headless: true, viewport: { width: 1120, height: 900 },
            args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`,
              "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
          });
          const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
          const id = new URL(worker.url()).host;
          const fixture = () => ({
            version: 1, snapshot: null, lastError: null,
            settings: {
              calendar: { type: "bookings", url: "https://bookings.cloud.microsoft/bookwithme/user/example%40example.invalid/meetingtype/example-type?anonymous" },
              timeZone: "UTC", goal: "energy", difficulty: "challenging",
              selection: "random", randomExerciseIds: ["squats"],
              duration: 5, frequency: 3, workStart: "09:00", workEnd: "17:00", enabled: false,
            },
            breaks: [{
              id: "camera-fixture", date: new Date().toISOString().slice(0, 10),
              scheduledAt: new Date().toISOString(), startedAt: new Date().toISOString(),
              duration: 5, exerciseId: "squats", status: "active", snoozes: 0,
            }],
          });
          await context.setOffline(true);
          const popup = await context.newPage();
          await popup.goto(`chrome-extension://${id}/index.html`);
          await popup.getByRole("button", { name: "Save & plan my day", exact: true }).waitFor();
          await worker.evaluate((state) => chrome.storage.local.set({ exerciseSnacksV1: state }), fixture());
          await popup.reload();
          const [page] = await Promise.all([
            context.waitForEvent("page"),
            popup.getByRole("button", { name: "Count with camera / manually", exact: true }).click(),
          ]);
          await page.waitForURL(`chrome-extension://${id}/coach.html?id=camera-fixture`);
          const errors = [];
          const external = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("request", (request) => { if (/^https?:/.test(request.url())) external.push(request.url()); });
          await page.addInitScript(() => {
            globalThis.__cameraRequests = [];
            globalThis.__cameraTracks = [];
            const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async (constraints) => {
              globalThis.__cameraRequests.push(constraints);
              if (globalThis.__denyCamera) throw new DOMException("Test permission denial", "NotAllowedError");
              if (globalThis.__delayCamera) await new Promise((resolve) => { globalThis.__resolveCamera = resolve; });
              const stream = await getUserMedia(constraints);
              globalThis.__cameraTracks.push(...stream.getTracks());
              return stream;
            };
          });
          await page.goto(`chrome-extension://${id}/coach.html?id=camera-fixture`);
          await page.getByRole("button", { name: "Enable camera counting", exact: true }).waitFor();
          assert.equal(await page.evaluate(() => globalThis.__cameraRequests.length), 0);
          if (process.env.EXTENSION_COACH_SCREENSHOT) {
            const path = resolve(process.env.EXTENSION_COACH_SCREENSHOT);
            await mkdir(resolve(path, ".."), { recursive: true });
            await page.screenshot({ path, fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Camera Coach overflows a narrow window.");
            await page.screenshot({ path: path.replace(/\.png$/, "-mobile.png"), fullPage: true });
            await page.setViewportSize({ width: 1120, height: 900 });
          }
          await page.getByRole("button", { name: "Enable camera counting", exact: true }).click();
          await page.locator('.coach-video-stage[data-stage="counting"]').waitFor({ timeout: 60_000 });
          await page.getByText("Camera on · on-device only", { exact: true }).waitFor();
          assert.equal(await page.evaluate(() => globalThis.__cameraRequests[0].audio), false);
          assert.ok(await page.evaluate(() => globalThis.__cameraTracks.every((track) => track.readyState === "live")));
          await page.getByRole("button", { name: "Add one rep" }).click();
          await page.getByRole("button", { name: "Pause · camera off", exact: true }).click();
          assert.ok(await page.evaluate(() => globalThis.__cameraTracks.every((track) => track.readyState === "ended")));
          await page.locator('[aria-label="1 of 10 reps"]').waitFor();
          await page.getByRole("button", { name: "Resume with camera", exact: true }).click();
          await page.locator('.coach-video-stage[data-stage="counting"]').waitFor({ timeout: 60_000 });
          for (let i = 1; i < 10; i++) await page.getByRole("button", { name: "Add one rep" }).click();
          await page.locator('.coach-video-stage[data-stage="review"]').waitFor();
          assert.ok(await page.evaluate(() => globalThis.__cameraTracks.every((track) => track.readyState === "ended")));
          await page.getByRole("button", { name: "Subtract one rep" }).click();
          await page.getByRole("button", { name: "Save 9 reps", exact: true }).click();
          await page.getByText("9 of 10 squats saved locally. Manual count.", { exact: true }).waitFor();
          const saved = await worker.evaluate(() => chrome.storage.local.get("exerciseSnacksV1"));
          const completed = saved.exerciseSnacksV1.breaks[0];
          assert.equal(completed.status, "completed");
          assert.equal(completed.reps.completedReps, 9);
          assert.equal(completed.reps.manualAdjustment, 9);
          assert.equal(completed.reps.automaticReps, 0);
          assert.ok(completed.reps.elapsedSeconds < 300, "Rep completion must not need the full break timer.");
          assert.deepEqual(Object.keys(completed.reps).sort(),
            ["automaticReps", "completedReps", "countingMode", "elapsedSeconds", "manualAdjustment", "targetReps"]);
          await page.reload();
          await page.getByText("9 of 10 squats saved locally. Manual count.", { exact: true }).waitFor();
          await popup.reload();
          await popup.getByRole("button", { name: "Progress", exact: true }).click();
          await popup.getByText(/9\/10 squats/).waitFor();

          await worker.evaluate((state) => chrome.storage.local.set({ exerciseSnacksV1: state }), fixture());
          await page.reload();
          await page.evaluate(() => { globalThis.__denyCamera = true; });
          await page.getByRole("button", { name: "Enable camera counting", exact: true }).click();
          await page.getByRole("alert").getByText(/Camera permission wasn't granted/).waitFor();
          await page.getByRole("button", { name: "Count manually · no camera", exact: true }).click();
          await page.getByRole("button", { name: "Add one rep" }).click();
          await page.getByRole("button", { name: "Save 1 rep", exact: true }).click();
          await page.getByText("1 of 10 squats saved locally. Manual count.", { exact: true }).waitFor();

          await worker.evaluate((state) => chrome.storage.local.set({ exerciseSnacksV1: state }), fixture());
          await page.reload();
          await page.getByRole("button", { name: "Enable camera counting", exact: true }).click();
          await page.locator('.coach-video-stage[data-stage="counting"]').waitFor({ timeout: 60_000 });
          await page.getByRole("button", { name: "Add one rep" }).click();
          await page.evaluate(() => {
            const track = globalThis.__cameraTracks.find((entry) => entry.kind === "video");
            track.stop();
            track.dispatchEvent(new Event("ended"));
          });
          await page.getByRole("alert").getByText(/camera disconnected/).waitFor();
          await page.locator('[aria-label="1 of 10 reps"]').waitFor();
          assert.ok(await page.evaluate(() => globalThis.__cameraTracks.every((track) => track.readyState === "ended")));
          await page.getByRole("button", { name: "Resume with camera", exact: true }).click();
          await page.locator('.coach-video-stage[data-stage="counting"]').waitFor({ timeout: 60_000 });
          // Exercise the same synchronous cleanup handler used when navigating or closing the page.
          await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
          assert.ok(await page.evaluate(() => globalThis.__cameraTracks.every((track) => track.readyState === "ended")));

          await page.reload();
          await page.evaluate(() => { globalThis.__delayCamera = true; });
          await page.getByRole("button", { name: "Enable camera counting", exact: true }).click();
          await page.waitForFunction(() => !!globalThis.__resolveCamera);
          await page.evaluate(() => {
            Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
            document.dispatchEvent(new Event("visibilitychange"));
            globalThis.__resolveCamera();
          });
          await page.waitForFunction(() => globalThis.__cameraTracks.length > 0 &&
            globalThis.__cameraTracks.every((track) => track.readyState === "ended"));
          await page.locator('.coach-video-stage[data-stage="paused"]').waitFor();
          assert.deepEqual(external, [], "Camera page must load no remote code, models or frames.");
          assert.deepEqual(errors, []);
          console.log("Verified real packaged MediaPipe/WASM inference offline with a fake webcam, no automatic permission request, audio disabled, pause/resume, target stop, correction, denied-camera manual fallback, summary persistence and page cleanup. No human counting-accuracy claim.");
        } finally {
          if (context) await context.close();
          await rm(profile, { recursive: true, force: true });
        }
      });
    await worker.evaluate((state) => chrome.storage.local.set({ exerciseSnacksV1: state }), saved);
    await page.reload();
    await page.getByRole("button", { name: "Complete exercise", exact: true }).click();
    assert.equal((await get()).state.breaks.find((b) => b.id === "fixture-session").status, "completed");
    await page.reload();
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await page.getByText("All-time: 1 completed snacks.", { exact: false }).waitFor();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Enable local reminders (check availability when connected)", { exact: true }).uncheck();
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
