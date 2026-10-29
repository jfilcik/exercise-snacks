import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";

const inspect = process.argv.includes("--inspect");
const source = process.argv.slice(2).find(arg => arg !== "--inspect");
if (!source) throw new Error("Provide the local recording path. Use --inspect for a contact sheet before motion analysis.");
const input = resolve(source);
const fixture = process.env.PRIVATE_CAMERA_FIXTURE ?? "squat-pushup";
if (!/^[a-z0-9-]+$/.test(fixture)) throw new Error("PRIVATE_CAMERA_FIXTURE must be a simple lowercase fixture name.");
const output = resolve(".private-camera-fixtures", fixture);
const sourceInfo = await stat(input);
const hash = createHash("sha256");
for await (const chunk of createReadStream(input)) hash.update(chunk);
const sourceSha256 = hash.digest("hex");
await mkdir(output, { recursive: true });
for (const name of ["motion.json", "inspection.json"]) {
  try {
    const saved = JSON.parse(await readFile(resolve(output, name), "utf8"));
    if (saved.sourceSha256 !== sourceSha256) throw new Error("This fixture belongs to a different recording. Select a new PRIVATE_CAMERA_FIXTURE instead of overwriting it.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
let annotations;
try { annotations = JSON.parse(await readFile(resolve(output, "expected.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const files = new Map([
  ["/", { type: "text/html", body: "<!doctype html><meta charset=utf-8><title>Private local motion test</title>" }],
  ["/counter.mjs", { type: "text/javascript", body: ts.transpileModule(await readFile("src/rep-counter.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText }],
  ["/vision.mjs", { type: "text/javascript", path: resolve("node_modules/@mediapipe/tasks-vision/vision_bundle.mjs") }],
  ["/model.task", { type: "application/octet-stream", path: resolve("public/pose/pose_landmarker_lite.task") }],
]);
for (const name of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  files.set(`/wasm/${name}`, {
    type: name.endsWith(".wasm") ? "application/wasm" : "text/javascript",
    path: resolve("public/pose/wasm", name),
  });
}
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const context = await browser.newContext();
  // All requests are fulfilled from local files or aborted; no server or external upload.
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://private-motion.test") return route.abort();
    if (url.pathname === "/recording.mp4") {
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = Math.min(range?.[2] ? Number(range[2]) : start + 2 * 1024 * 1024 - 1, sourceInfo.size - 1);
      if (start > end) return route.fulfill({ status: 416, headers: { "content-range": `bytes */${sourceInfo.size}` } });
      const file = await open(input, "r");
      try {
        const body = Buffer.alloc(end - start + 1);
        const { bytesRead } = await file.read(body, 0, body.length, start);
        await route.fulfill({
          status: 206, contentType: "video/mp4", body: body.subarray(0, bytesRead),
          headers: { "accept-ranges": "bytes", "content-range": `bytes ${start}-${start + bytesRead - 1}/${sourceInfo.size}`, "cache-control": "no-store" },
        });
      } finally { await file.close(); }
      return;
    }
    const file = files.get(url.pathname);
    if (!file) return route.abort();
    await route.fulfill({ contentType: file.type, body: file.body ?? await readFile(file.path) });
  });
  const page = await context.newPage();
  page.on("console", message => { if (message.text().startsWith("MOTION")) console.log(message.text()); });
  await page.goto("http://private-motion.test/");
  const result = await page.evaluate(async ({ inspect, annotations }) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error("Cannot decode the supplied MP4."));
      video.src = "/recording.mp4";
    });
    const seek = async time => {
      let timeout;
      try {
        await new Promise((resolve, reject) => {
          video.onseeked = resolve;
          timeout = setTimeout(() => reject(new Error(`Seek timed out at ${time.toFixed(2)} seconds.`)), 10000);
          video.currentTime = Math.min(time + .001, video.duration - .01);
        });
      } finally { clearTimeout(timeout); }
    };
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = Math.round(640 * video.videoHeight / video.videoWidth);
    const draw = canvas.getContext("2d");
    const snapshots = [];
    const representatives = annotations?.representatives ?? Array.from({ length: 16 }, (_, i) => ({
      file: `sample-${String(i).padStart(2, "0")}.jpg`, timeSeconds: i * (video.duration - .1) / 15,
    }));
    for (const entry of representatives) {
      await seek(entry.timeSeconds);
      draw.drawImage(video, 0, 0, canvas.width, canvas.height);
      snapshots.push({ ...entry, image: canvas.toDataURL("image/jpeg", .85) });
    }
    if (annotations?.squatReviewSeconds) {
      const sheet = document.createElement("canvas");
      sheet.width = 640;
      sheet.height = Math.ceil(annotations.squatReviewSeconds.length / 2) * 200;
      const grid = sheet.getContext("2d");
      grid.fillStyle = "#202020";
      grid.fillRect(0, 0, sheet.width, sheet.height);
      for (const [i, time] of annotations.squatReviewSeconds.entries()) {
        await seek(time);
        const x = (i % 2) * 320;
        const y = Math.floor(i / 2) * 200;
        grid.drawImage(video, x, y, 320, 180);
        grid.fillStyle = "#ffffff";
        grid.font = "14px sans-serif";
        grid.fillText(`${i + 1}: ${time.toFixed(2)}s`, x + 8, y + 195);
      }
      snapshots.push({ file: "squat-review.jpg", timeSeconds: null, image: sheet.toDataURL("image/jpeg", .85) });
    }
    console.log("MOTION metadata", JSON.stringify({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }));
    const samples = [];
    const changes = [];
    if (!inspect) {
      const { FilesetResolver, PoseLandmarker } = await import("/vision.mjs");
      const { SquatCounter, jointAngle } = await import("/counter.mjs");
      const model = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks("/wasm"), {
        baseOptions: { modelAssetPath: "/model.task", delegate: "CPU" },
        runningMode: "VIDEO", numPoses: 1,
        minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5,
      });
      const counter = new SquatCounter();
      const body = new Set([11, 12, 23, 24, 25, 26, 27, 28]);
      let previous = "";
      try {
        for (let i = 0; i / 12 < video.duration - .04; i++) {
          const time = i / 12;
          await seek(time);
          draw.drawImage(video, 0, 0, canvas.width, canvas.height);
          const result = model.detectForVideo(canvas, time * 1000 + 1);
          const image = result.landmarks[0] ?? [];
          const world = result.worldLandmarks[0] ?? [];
          const feedback = counter.update(image, world, time * 1000 + 1, canvas.width / canvas.height);
          const sides = [[11,23,25,27],[12,24,26,28]].map(indices => {
            const [s,h,k,a] = indices.map(index => world[index]);
            return s && h && k && a ? {
              visibility: Math.min(...indices.map(index => image[index].visibility)),
              angle: jointAngle(h,k,a),
              torsoUpright: Math.abs(s.y-h.y)/Math.hypot(s.x-h.x,s.y-h.y,s.z-h.z),
            } : null;
          });
          samples.push({
            timeMs: time * 1000 + 1,
            image: Array.from({ length: 29 }, (_, j) => body.has(j) ? image[j] ?? null : null),
            world: Array.from({ length: 29 }, (_, j) => body.has(j) ? world[j] ?? null : null),
            sides, baseline: feedback,
          });
          const key = `${feedback.state}:${feedback.reps}:${feedback.cue}`;
          if (key !== previous) { changes.push({ time, ...feedback }); previous = key; }
          result.close();
          if (i % 120 === 0) console.log("MOTION progress", time, feedback.state, feedback.reps);
        }
      } finally { model.close(); }
    }
    return {
      durationSeconds: video.duration, width: canvas.width, height: canvas.height,
      originalWidth: video.videoWidth, originalHeight: video.videoHeight, sampleFps: 12,
      snapshots, samples, changes,
    };
  }, { inspect, annotations });
  const { snapshots, ...data } = result;
  const imageManifest = [];
  for (const entry of snapshots) {
    if (!/^[a-z0-9-]+\.jpg$/.test(entry.file)) throw new Error("Representative images must use simple JPEG filenames.");
    const bytes = Buffer.from(entry.image.split(",")[1], "base64");
    await writeFile(resolve(output, entry.file), bytes);
    imageManifest.push({ file: entry.file, timeSeconds: entry.timeSeconds, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const manifest = {
    version: 1, sourceSha256, ...data,
    snapshots: imageManifest,
  };
  await writeFile(resolve(output, inspect ? "inspection.json" : "motion.json"), JSON.stringify(manifest));
  console.log(JSON.stringify({ durationSeconds: data.durationSeconds, samples: data.samples.length, changes: data.changes }, null, 2));
  console.log("Private fixture saved under the ignored .private-camera-fixtures directory. No media or pose data was uploaded.");
} finally {
  await browser.close();
}
