import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";

test("calendar-free onboarding, real alarm delivery, setup CTA, persistence, pause, and popup widths", {
  timeout: 90_000,
  skip: [0, 6].includes(new Date().getUTCDay()) ? "Live browser scheduling runs on weekdays; deterministic tests cover weekends." : false,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), "exercise-snacks-reminders-"));
  let context;
  try {
    const dist = resolve(process.env.EXTENSION_DIRECTORY ?? "dist");
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, timezoneId: "UTC", viewport: { width: 480, height: 900 },
      args: ["--disable-gpu", `--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    await context.setOffline(true);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/index.html`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Calendar source").selectOption("");
    await page.getByLabel("Time zone", { exact: true }).fill("UTC");
    await page.getByLabel("Workday starts").fill("00:00");
    await page.getByLabel("Workday ends").fill("23:59");
    await page.getByRole("button", { name: "Save & plan my day", exact: true }).click();
    await page.getByRole("button", { name: "Set up calendar", exact: true }).waitFor();
    const get = () => worker.evaluate(async () => (await chrome.storage.local.get("exerciseSnacksV1")).exerciseSnacksV1);
    const saved = await get();
    assert.equal(saved.settings.calendar, null);
    assert.equal(saved.snapshot, null);
    assert.equal(saved.lastError, null);
    const planned = saved.breaks.filter(item => item.status === "planned");
    assert.ok(planned.length > 0);
    assert.ok(planned.every(item => item.scheduleMode === "spaced"));
    await page.getByText("Not a verified free slot. Snooze or skip if you're busy.", { exact: true }).waitFor();
    const first = planned[0];
    await worker.evaluate(async itemId => {
      const state = (await chrome.storage.local.get("exerciseSnacksV1")).exerciseSnacksV1;
      state.breaks.find(item => item.id === itemId).scheduledAt = new Date(Date.now() + 1500).toISOString();
      await chrome.storage.local.set({ exerciseSnacksV1: state });
      await chrome.alarms.create(`exercise-snacks:${itemId}`, { when: Date.now() + 1500 });
    }, first.id);
    await page.waitForFunction(async itemId => {
      const state = (await chrome.storage.local.get("exerciseSnacksV1")).exerciseSnacksV1;
      return state.breaks.find(item => item.id === itemId)?.status === "ready";
    }, first.id, { timeout: 15_000 });
    await page.waitForFunction(itemId => new Promise(resolve => {
      chrome.notifications.getAll(notifications => resolve(!!notifications[`exercise-snacks:${itemId}`]));
    }), first.id, { timeout: 10_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Set up calendar", exact: true }).click();
    assert.equal(await page.getByLabel("Calendar source").inputValue(), "");
    await page.getByRole("button", { name: "Save preferences & replan", exact: true }).click();
    await page.getByRole("button", { name: "Set up calendar", exact: true }).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Set up calendar", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Today", exact: true }).getAttribute("aria-current"), "page");
    const beforeRefresh = (await get()).breaks.filter(item => item.status === "planned");
    await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
    await page.getByRole("button", { name: "Refresh", exact: true }).first().waitFor();
    assert.deepEqual((await get()).breaks.filter(item => item.status === "planned"), beforeRefresh);
    await page.getByRole("button", { name: "Set up calendar", exact: true }).click();
    await page.getByLabel("Enable local reminders (check availability when connected)", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Save preferences & replan", exact: true }).click();
    await page.getByText(/Reminders are paused/).waitFor();
    assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).filter(alarm => alarm.name.startsWith("exercise-snacks:")).length, 0);
    if (process.env.REMINDER_SCREENSHOTS) {
      const demoDate = "2026-10-29";
      await worker.evaluate(async ({ saved, demoDate }) => {
        await chrome.storage.local.set({ exerciseSnacksV1: {
          ...saved, settings: { ...saved.settings, difficulty: "challenging", selection: "random",
            randomExerciseIds: ["squats", "pushups", "reverse-lunges"], workStart: "09:00", workEnd: "17:00" },
          breaks: ["squats", "pushups", "reverse-lunges"].map((exerciseId, index) => ({
            id: `demo-${index}`, date: demoDate, scheduledAt: `${demoDate}T${11 + index * 2}:00:00.000Z`,
            duration: 3, exerciseId, status: "planned", snoozes: 0, scheduleMode: "spaced",
          })),
        } });
      }, { saved, demoDate });
      await page.clock.install({ time: new Date(`${demoDate}T09:00:00Z`) });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Set up calendar", exact: true }).waitFor();
    }
    for (const width of [380, 440, 480]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.body.getBoundingClientRect().width), 480,
        `Popup should request its full 480px width even when opened in a narrower initial viewport (${width}px).`);
    }
    if (process.env.REMINDER_SCREENSHOTS) {
      const folder = resolve(process.env.REMINDER_SCREENSHOTS);
      await mkdir(folder, { recursive: true });
      await page.screenshot({ path: join(folder, "today.png"), fullPage: true });
      const popup = (await readFile(join(folder, "today.png"))).toString("base64");
      const desktop = await context.newPage();
      await desktop.setViewportSize({ width: 1600, height: 1280 });
      await desktop.setContent(`<!doctype html><meta charset="utf-8"><title>Exercise Snacks preview</title>
        <style>
          *{box-sizing:border-box}body{margin:0;color:#162437;background:#f3f2ed;font-family:system-ui,"Segoe UI",sans-serif}
          .browser{min-height:100vh;background:#f3f2ed}.toolbar{height:58px;display:flex;align-items:center;gap:14px;padding:0 24px;background:#fff;border-bottom:1px solid #dce1e6}
          .tab{height:36px;width:210px;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:10px 10px 0 0;background:#f3f2ed;font-size:13px}
          .tab-icon{width:15px;height:15px;border-radius:5px;background:#c8f36b;display:grid;place-items:center;font-size:11px}
          .address{height:36px;max-width:1080px;flex:1;display:flex;align-items:center;padding:0 16px;border:1px solid #dce1e6;border-radius:18px;color:#59697e;background:#f8f8f6;font-size:13px}
          .extension{width:480px;height:calc(100vh - 76px);max-height:1200px;position:absolute;top:66px;right:13%;overflow:hidden;border:1px solid #d9dce0;border-radius:12px;background:#faf8f2;box-shadow:0 14px 34px #16243720}
          .extension img{display:block;width:480px;height:auto}
          .page{position:absolute;inset:58px 0 0;display:grid;place-items:center;background:#e8ecdf}
          .message{margin:-80px 550px 0 0;text-align:left}.message h1{max-width:650px;margin:0;font-size:54px;line-height:1.08;letter-spacing:-2.5px;font-weight:690}
          .message p{margin:18px 0 0;color:#59697e;font-size:19px;line-height:1.55}
          .spark{width:38px;height:38px;margin-bottom:23px;border-radius:12px;background:#c8f36b;display:grid;place-items:center;font-size:22px}
        </style>
        <main class="browser">
          <div class="toolbar"><div class="tab"><span class="tab-icon">✦</span>New tab</div><div class="address">Search or enter web address</div><span>✦</span><span>⋯</span></div>
          <section class="page"><div class="message"><div class="spark">✦</div><h1>Small moves.<br>Room to breathe.</h1><p>A little movement can fit into an ordinary workday.</p></div></section>
          <aside class="extension" aria-label="Exercise Snacks extension"><img alt="Exercise Snacks Today view with evenly spaced reminders, progress, and a calendar setup link" src="data:image/png;base64,${popup}"></aside>
        </main>`);
      await desktop.screenshot({ path: join(folder, "desktop-demo.png") });
      await desktop.close();
      await page.getByRole("button", { name: "Set up calendar", exact: true }).click();
      await page.screenshot({ path: join(folder, "settings.png"), fullPage: true });
    }
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
