import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import ts from "typescript";

test("eight private images verify standing, leaning squats and non-squat floor frames with the bundled model",
  { timeout: 60_000 }, async (t) => {
    const fixture = process.env.PRIVATE_CAMERA_FIXTURE ?? "squat-pushup";
    assert.match(fixture, /^[a-z0-9-]+$/);
    const directory = resolve(".private-camera-fixtures", fixture);
    const expected = JSON.parse(await readFile(join(directory, "expected.json"), "utf8"));
    const dist = resolve(process.env.EXTENSION_DIRECTORY ?? "dist");
    const files = new Map([
      ["/", { type: "text/html", body: "<!doctype html><title>Local private pose regression</title>" }],
      ["/vision.mjs", { type: "text/javascript", path: resolve("node_modules/@mediapipe/tasks-vision/vision_bundle.mjs") }],
      ["/counter.mjs", { type: "text/javascript", body: ts.transpileModule(await readFile("src/rep-counter.ts", "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      }).outputText }],
      ["/model.task", { type: "application/octet-stream", path: join(dist, "pose", "pose_landmarker_lite.task") }],
    ]);
    for (const name of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
      files.set(`/wasm/${name}`, { type: name.endsWith(".wasm") ? "application/wasm" : "text/javascript", path: join(dist, "pose", "wasm", name) });
    }
    for (const frame of expected.representatives) {
      assert.match(frame.file, /^[a-z0-9-]+\.jpg$/);
      files.set(`/frames/${frame.file}`, { type: "image/jpeg", path: join(directory, frame.file) });
    }
    const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--disable-gpu"] });
    t.signal.addEventListener("abort", () => { void browser.close(); }, { once: true });
    try {
      const context = await browser.newContext();
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        const file = files.get(url.pathname);
        if (url.origin !== "http://private-pose.test" || !file) return route.abort();
        await route.fulfill({ contentType: file.type, body: file.body ?? await readFile(file.path) });
      });
      const page = await context.newPage();
      await page.goto("http://private-pose.test/", { waitUntil: "domcontentloaded" });
      const results = await page.evaluate(async frames => {
        const { FilesetResolver, PoseLandmarker } = await import("/vision.mjs");
        const { jointAngle, SquatCounter } = await import("/counter.mjs");
        const model = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks("/wasm"), {
          baseOptions: { modelAssetPath: "/model.task", delegate: "CPU" },
          runningMode: "IMAGE", numPoses: 1,
          minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5,
        });
        const output = [];
        try {
          for (const frame of frames) {
            const bitmap = await createImageBitmap(await (await fetch(`/frames/${frame.file}`)).blob());
            try {
              const pose = model.detect(bitmap);
              const image = pose.landmarks[0] ?? [];
              const world = pose.worldLandmarks[0] ?? [];
              const sides = [[11,23,25,27],[12,24,26,28]].map(indices => {
                const [s,h,k,a] = indices.map(i => world[i]);
                return s && h && k && a ? {
                  confidence: Math.min(...indices.map(i => image[i].visibility)),
                  angle: jointAngle(h,k,a),
                  upright: Math.abs(s.y-h.y)/Math.hypot(s.x-h.x,s.y-h.y,s.z-h.z),
                  bodyUpright: Math.abs(s.y-a.y)/Math.hypot(s.x-a.x,s.y-a.y,s.z-a.z),
                } : null;
              }).filter(Boolean).sort((a,b) => b.confidence-a.confidence);
              const counter = new SquatCounter();
              let feedback;
              for (let i = 0; i < 6; i++) feedback = counter.update(image, world, i * 100, bitmap.width / bitmap.height);
              output.push({ file: frame.file, kind: frame.pose, side: sides[0] ?? null, feedback });
              pose.close();
            } finally { bitmap.close(); }
          }
        } finally { model.close(); }
        return output;
      }, expected.representatives);
      assert.equal(results.length, 8);
      for (const result of results) {
        const detail = JSON.stringify(result);
        if (result.kind === "floor") {
          assert.ok(!["ready-up", "down-confirmed"].includes(result.feedback.state), detail);
          assert.equal(result.feedback.reps, 0, detail);
          continue;
        }
        assert.ok(result.side && result.side.confidence >= .6, detail);
        if (result.kind === "standing") assert.ok(result.side.upright >= .8 && result.side.angle >= 140, detail);
        else {
          assert.equal(result.kind, "squat", detail);
          assert.ok(result.side.angle < 135 && result.side.bodyUpright >= .45, detail);
        }
      }
    } finally { await browser.close(); }
  });
