import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";

const source = process.env.PRIVATE_CAMERA_SOURCE;
const fixture = process.env.PRIVATE_CAMERA_FIXTURE ?? "squat-pushup";
assert.match(fixture, /^[a-z0-9-]+$/);
test(`private MP4 through the packaged camera/model/UI (${fixture}): exact squats, no floor credit or manual additions`,
  { timeout: 240_000, skip: source ? false : "Pass the original local MP4 to test:camera:private for the complete camera/model/UI test." }, async (t) => {
    const metadata = JSON.parse(await readFile(resolve(".private-camera-fixtures", fixture, "motion.json"), "utf8"));
    const expected = JSON.parse(await readFile(resolve(".private-camera-fixtures", fixture, "expected.json"), "utf8"));
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(source)) hash.update(chunk);
    assert.equal(hash.digest("hex"), metadata.sourceSha256, "The original recording must match the annotated private fixture.");
    const profile = await mkdtemp(join(tmpdir(), "exercise-snacks-private-camera-"));
    let context;
    try {
      const dist = resolve(process.env.EXTENSION_DIRECTORY ?? "dist");
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium", headless: true, viewport: { width: 1120, height: 900 },
        args: ["--disable-gpu", `--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
      });
      t.signal.addEventListener("abort", () => { void context.close(); }, { once: true });

      await context.setOffline(true);
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      const id = new URL(worker.url()).host;
      const external = [];
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
      await page.goto(`chrome-extension://${id}/index.html`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Save & plan my day", exact: true }).waitFor();
      await worker.evaluate(async () => {
        const now = new Date().toISOString();
        await chrome.storage.local.set({ exerciseSnacksV1: {
          version: 1, snapshot: null, lastError: null,
          settings: { calendar: null, timeZone: "UTC", goal: "energy", difficulty: "challenging",
            selection: "random", randomExerciseIds: ["squats"], duration: 5, frequency: 3,
            workStart: "09:00", workEnd: "17:00", enabled: false },
          breaks: [{ id: "private-motion", date: now.slice(0, 10), scheduledAt: now, startedAt: now,
            duration: 5, exerciseId: "squats", status: "active", snoozes: 0 }],
        } });
      });
      await page.goto(`chrome-extension://${id}/coach.html?id=private-motion`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Enable camera counting", exact: true }).waitFor();
      await page.locator("#target-reps").selectOption("20");
      // Transfer bounded chunks directly over local browser automation, never HTTP.
      await page.evaluate(() => { globalThis.__privateMotionChunks = []; });
      for await (const chunk of createReadStream(source, { highWaterMark: 2 * 1024 * 1024 })) {
        await page.evaluate(data => {
          globalThis.__privateMotionChunks.push(Uint8Array.from(atob(data), character => character.charCodeAt(0)));
        }, chunk.toString("base64"));
      }
      await page.evaluate(async () => {
        const video = document.createElement("video");
        video.muted = true;
        const blob = new Blob(globalThis.__privateMotionChunks, { type: "video/mp4" });
        const url = URL.createObjectURL(blob);
        delete globalThis.__privateMotionChunks;
        await new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = () => reject(new Error("Cannot decode private test recording."));
          video.src = url;
        });
        if (!video.videoWidth) throw new Error(`Recording decoded without video: ${JSON.stringify({
          size: blob.size, type: blob.type, duration: video.duration, width: video.videoWidth, height: video.videoHeight,
          mp4Support: video.canPlayType('video/mp4; codecs="avc1.42E01E"'),
        })}`);
        await new Promise(resolve => {
          video.onseeked = resolve;
          video.currentTime = .001;
        });
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = Math.round(640 * video.videoHeight / video.videoWidth);
        const drawing = canvas.getContext("2d");
        const firstFrame = await createImageBitmap(video);
        drawing.drawImage(firstFrame, 0, 0, canvas.width, canvas.height);
        let framePending = false;
        const timer = setInterval(async () => {
          if (framePending) return;
          framePending = true;
          const frame = video.currentTime <= .001 ? firstFrame : await createImageBitmap(video);
          drawing.drawImage(frame, 0, 0, canvas.width, canvas.height);
          if (frame !== firstFrame) frame.close();
          for (const track of globalThis.__privateMotion.tracks) track.requestFrame();
          framePending = false;
        }, 1000 / 12);
        globalThis.__privateMotion = { video, tracks: [], constraints: null };
        new MutationObserver(() => {
          const cue = document.querySelector(".coach-cue")?.textContent;
          const count = document.querySelector(".coach-count")?.getAttribute("aria-label");
          const key = `${cue}:${count}`;
          if (globalThis.__privateMotion.cue !== key) {
            globalThis.__privateMotion.cue = key;
            console.log("Private camera cue:", JSON.stringify({ time: +video.currentTime.toFixed(2), count, cue }));
          }
        }).observe(document.querySelector(".coach-shell"), { subtree: true, childList: true, characterData: true });
        globalThis.__playPrivateMotion = () => video.play();
        globalThis.__disposePrivateMotion = () => { clearInterval(timer); video.pause(); firstFrame.close(); URL.revokeObjectURL(url); };
        navigator.mediaDevices.getUserMedia = async constraints => {
          globalThis.__privateMotion.constraints = constraints;
          const stream = canvas.captureStream(0);
          globalThis.__privateMotion.tracks.push(...stream.getTracks());
          return stream;
        };
      });
      page.on("console", message => { if (message.text().startsWith("Private camera cue:")) console.log(message.text()); });
      await page.getByRole("button", { name: "Enable camera counting", exact: true }).click();
      try {
        await page.waitForFunction(() => {
          const cue = document.querySelector(".coach-cue")?.textContent ?? "";
          return cue.startsWith("Stand upright and still") || cue === "Ready. Squat to a comfortable depth.";
        }, null, { timeout: 15_000 });
      } catch (error) {
        throw new Error(`Camera/model never started: ${JSON.stringify(await page.evaluate(() => ({
          cue: document.querySelector(".coach-cue")?.textContent,
          alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent),
          sourceReady: globalThis.__privateMotion.video.readyState,
          sourceTime: globalThis.__privateMotion.video.currentTime,
          constraints: globalThis.__privateMotion.constraints,
          tracks: globalThis.__privateMotion.tracks.map(track => ({ state: track.readyState, settings: track.getSettings() })),
          preview: [...document.querySelectorAll("video")].map(video => ({ width: video.videoWidth, height: video.videoHeight, time: video.currentTime })),
        })))}`, { cause: error });
      }
      await page.evaluate(() => globalThis.__playPrivateMotion());
      let cumulative = 0;
      for (const segment of expected.segments.filter(segment => segment.squats > 0)) {
        cumulative += segment.squats;
        await page.waitForFunction(time => globalThis.__privateMotion.video.currentTime >= time,
          segment.endSeconds, { timeout: 20_000 });
        assert.equal(await page.locator(".coach-count").getAttribute("aria-label"), `${cumulative} of 20 reps`, segment.name);
      }
      await page.waitForFunction(() => globalThis.__privateMotion.video.ended, null, { timeout: 60_000 });
      await page.waitForTimeout(1000);
      assert.equal(await page.locator(".coach-count").getAttribute("aria-label"), `${expected.expectedSquats} of 20 reps`);
      assert.equal(await page.evaluate(() => globalThis.__privateMotion.constraints.audio), false);
      await page.getByRole("button", { name: "Stop counting", exact: true }).click();
      assert.ok(await page.evaluate(() => globalThis.__privateMotion.tracks.every(track => track.readyState === "ended")));
      await page.getByRole("button", { name: `Save ${expected.expectedSquats} reps`, exact: true }).click();
      await page.getByText(`${expected.expectedSquats} of 20 squats saved locally. Camera-assisted estimate.`, { exact: true }).waitFor();
      const stored = await worker.evaluate(() => chrome.storage.local.get("exerciseSnacksV1"));
      assert.equal(stored.exerciseSnacksV1.breaks[0].reps.automaticReps, expected.expectedSquats);
      assert.equal(stored.exerciseSnacksV1.breaks[0].reps.manualAdjustment, 0);
      assert.deepEqual(external, [], "The extension must never request the recording or any external server.");
      assert.deepEqual(errors, []);
      await page.evaluate(() => globalThis.__disposePrivateMotion());
      t.diagnostic(`Confirmed ${expected.expectedSquats} automatic squats and the saved summary without manual additions or external requests.`);
    } finally {
      if (context) await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
