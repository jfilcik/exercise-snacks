import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";

// PDI Student, "Agachamento.gif", CC BY-SA 4.0. Two visually checked squats.
// https://commons.wikimedia.org/wiki/File:Agachamento.gif
// https://creativecommons.org/licenses/by-sa/4.0/
// The original is cached, not bundled. Tests decode and letterbox its frames.
const fixtureUrl = "https://upload.wikimedia.org/wikipedia/commons/e/ed/Agachamento.gif";
const fixtureHash = "0d305481b1a94b0356f1887814d6813a1bb4acbb2461965602e69d5b08d7a820";
const fixturePath = resolve(".camera-cache", "squats-bodyweight.gif");

async function fixtureBytes() {
  let bytes;
  try { bytes = await readFile(fixturePath); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(fixtureUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Squat test fixture download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(createHash("sha256").update(bytes).digest("hex"), fixtureHash, "Squat fixture checksum changed.");
  await mkdir(resolve(".camera-cache"), { recursive: true });
  await writeFile(fixturePath, bytes);
  return bytes;
}

test("packaged Camera Coach automatically counts both real recorded squats without +1 corrections",
  { timeout: 120_000 }, async () => {
    const bytes = await fixtureBytes();
    const profile = await mkdtemp(join(tmpdir(), "exercise-snacks-real-reps-"));
    let context;
    try {
      const dist = resolve(process.env.EXTENSION_DIRECTORY ?? "dist");
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium", headless: true, viewport: { width: 1120, height: 900 },
        args: ["--disable-gpu", `--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
      });
      await context.setOffline(true);
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      const extensionId = new URL(worker.url()).host;
      const page = await context.newPage();
      const errors = [];
      const external = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
      await page.goto(`chrome-extension://${extensionId}/index.html`);
      await page.getByRole("button", { name: "Save & plan my day", exact: true }).waitFor();
      await worker.evaluate(async () => {
        const now = new Date().toISOString();
        await chrome.storage.local.set({ exerciseSnacksV1: {
          version: 1, snapshot: null, lastError: null,
          settings: {
            calendar: null, timeZone: "UTC", goal: "energy", difficulty: "challenging",
            selection: "random", randomExerciseIds: ["squats"],
            duration: 5, frequency: 3, workStart: "09:00", workEnd: "17:00", enabled: false,
          },
          breaks: [{
            id: "real-squat-fixture", date: now.slice(0, 10), scheduledAt: now, startedAt: now,
            duration: 5, exerciseId: "squats", status: "active", snoozes: 0,
          }],
        } });
      });
      await page.goto(`chrome-extension://${extensionId}/coach.html?id=real-squat-fixture`);
      await page.getByRole("button", { name: "Enable camera counting", exact: true }).waitFor();
      await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        const decoder = new ImageDecoder({ data: bytes, type: "image/gif" });
        await decoder.tracks.ready;
        const frames = [];
        let duration = 0;
        for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
          const { image } = await decoder.decode({ frameIndex: i });
          duration += image.duration / 1000;
          frames.push({ image, until: duration });
        }
        decoder.close();
        const source = document.createElement("canvas");
        source.width = 640;
        source.height = 480;
        const drawing = source.getContext("2d");
        const draw = (image) => {
          drawing.fillStyle = "#202020";
          drawing.fillRect(0, 0, source.width, source.height);
          const scale = Math.min(source.width / image.displayWidth, source.height / image.displayHeight);
          const width = image.displayWidth * scale;
          const height = image.displayHeight * scale;
          drawing.drawImage(image, (source.width - width) / 2, (source.height - height) / 2, width, height);
        };
        draw(frames[0].image);
        let start = null;
        globalThis.__squatInput = { done: false, constraints: null, tracks: [], cues: [] };
        const drawingLoop = setInterval(() => {
          const time = start === null ? 0 : performance.now() - start;
          const frame = frames.find(entry => time < entry.until) ?? frames.at(-1);
          draw(frame.image);
          if (start !== null && time >= duration) globalThis.__squatInput.done = true;
        }, 1000 / 12);
        globalThis.__playSquats = () => { start = performance.now(); };
        globalThis.__disposeSquats = () => {
          clearInterval(drawingLoop);
          for (const { image } of frames) image.close();
        };
        navigator.mediaDevices.getUserMedia = async constraints => {
          globalThis.__squatInput.constraints = constraints;
          const stream = source.captureStream(12);
          globalThis.__squatInput.tracks.push(...stream.getTracks());
          return stream;
        };
        new MutationObserver(() => {
          const cue = document.querySelector(".coach-cue")?.textContent;
          const count = document.querySelector(".coach-count")?.getAttribute("aria-label");
          const key = `${cue} | ${count}`;
          if (globalThis.__squatInput.cues.at(-1) !== key) globalThis.__squatInput.cues.push(key);
        }).observe(document.querySelector(".coach-shell"), { subtree: true, characterData: true, childList: true });
      }, bytes.toString("base64"));
      await page.getByRole("button", { name: "Enable camera counting", exact: true }).click();
      await page.getByText("Ready. Squat to a comfortable depth.", { exact: true }).waitFor({ timeout: 45_000 });
      await page.waitForTimeout(1000);
      await page.locator('[aria-label="0 of 10 reps"]').waitFor();
      await page.evaluate(() => globalThis.__playSquats());
      await page.waitForFunction(() => globalThis.__squatInput.done, null, { timeout: 20_000 });
      await page.waitForTimeout(1000);
      const input = await page.evaluate(() => ({
        ...globalThis.__squatInput, tracks: globalThis.__squatInput.tracks.map(track => track.readyState),
      }));
      console.log("Recorded-squat camera cues:", JSON.stringify(input.cues));
      assert.equal(await page.locator(".coach-count").getAttribute("aria-label"), "2 of 10 reps",
        "The real camera/model/counter path must count both recorded squats without manual correction.");
      assert.equal(input.constraints.audio, false);
      await page.getByRole("button", { name: "Stop counting", exact: true }).click();
      assert.ok(await page.evaluate(() => globalThis.__squatInput.tracks.every(track => track.readyState === "ended")));
      await page.getByRole("button", { name: "Save 2 reps", exact: true }).click();
      await page.getByText("2 of 10 squats saved locally. Camera-assisted estimate.", { exact: true }).waitFor();
      const stored = await worker.evaluate(() => chrome.storage.local.get("exerciseSnacksV1"));
      assert.equal(stored.exerciseSnacksV1.breaks[0].reps.automaticReps, 2);
      assert.equal(stored.exerciseSnacksV1.breaks[0].reps.manualAdjustment, 0);
      assert.deepEqual(external, [], "Recorded-squat camera test must run fully offline.");
      assert.deepEqual(errors, []);
      await page.evaluate(() => globalThis.__disposeSquats());
    } finally {
      if (context) await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
