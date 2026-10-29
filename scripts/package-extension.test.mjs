import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { packageExtension } from "./package-extension.mjs";

async function fixture(run) {
  const folder = await mkdtemp(join(tmpdir(), "exercise-snacks-package-"));
  const dist = join(folder, "dist");
  const output = join(folder, "exercise-snacks.zip");
  try {
    await mkdir(join(dist, "assets"), { recursive: true });
    await mkdir(join(dist, "pose", "wasm"), { recursive: true });
    for (const [name, content] of Object.entries({
      "manifest.json": JSON.stringify({ manifest_version: 3, version: "0.3.5" }),
      "index.html": "<html></html>", "coach.html": "<html></html>", "background.js": "// fixture",
      "icon128.png": "test-icon", "assets/app.js": "// fixture", "assets/app.css": "body{}",
      "pose/pose_landmarker_lite.task": "test-model", "pose/LICENSE.txt": "test-license", "pose/MODEL_CARD.pdf": "test-card",
      "pose/wasm/vision_wasm_internal.js": "// fixture", "pose/wasm/vision_wasm_internal.wasm": "test-wasm",
      "pose/wasm/vision_wasm_nosimd_internal.js": "// fixture", "pose/wasm/vision_wasm_nosimd_internal.wasm": "test-wasm",
    })) await writeFile(join(dist, name), content);
    await run({ dist, output });
  } finally { await rm(folder, { recursive: true, force: true }); }
}

test("the install ZIP has manifest.json at its root, all built assets, and bundled license notices", async () => {
  await fixture(async ({ dist, output }) => {
    await packageExtension(dist, output);
    const archive = await readFile(output);
    const files = unzipSync(archive);
    assert.deepEqual(Object.keys(files).sort(), [
      "INSTALL.txt", "THIRD_PARTY_NOTICES.txt", "assets/app.css", "assets/app.js",
      "background.js", "coach.html", "icon128.png", "index.html", "manifest.json",
      "pose/LICENSE.txt", "pose/MODEL_CARD.pdf", "pose/pose_landmarker_lite.task",
      "pose/wasm/vision_wasm_internal.js", "pose/wasm/vision_wasm_internal.wasm",
      "pose/wasm/vision_wasm_nosimd_internal.js", "pose/wasm/vision_wasm_nosimd_internal.wasm",
    ]);
    assert.equal(JSON.parse(strFromU8(files["manifest.json"])).version, "0.3.5");
    const notices = strFromU8(files["THIRD_PARTY_NOTICES.txt"]);
    for (const name of ["react ", "react-dom ", "scheduler ", "cldr-core ", "MIT License", "UNICODE LICENSE V3", "@mediapipe/tasks-vision", "Apache License"]) {
      assert.ok(notices.includes(name), `Missing notice: ${name}`);
    }
    assert.match(strFromU8(files["INSTALL.txt"]), /Load unpacked/);
    await packageExtension(dist, output);
    assert.deepEqual(await readFile(output), archive);
  });
});

test("packaging rejects stray source files and incomplete or mismatched builds", async () => {
  await fixture(async ({ dist, output }) => {
    await writeFile(join(dist, "private-settings.json"), "{}");
    await assert.rejects(packageExtension(dist, output), /Unexpected build entry/);
    await rm(join(dist, "private-settings.json"));
    await rm(join(dist, "background.js"));
    await assert.rejects(packageExtension(dist, output), /Missing background.js/);
    await writeFile(join(dist, "background.js"), "");
    await rm(join(dist, "pose", "pose_landmarker_lite.task"));
    await assert.rejects(packageExtension(dist, output), /Missing pose\/pose_landmarker_lite.task/);
    await writeFile(join(dist, "pose", "pose_landmarker_lite.task"), "test-model");
    await writeFile(join(dist, "manifest.json"), JSON.stringify({ manifest_version: 3, version: "0.0.0" }));
    await assert.rejects(packageExtension(dist, output), /match package.json/);
  });
});
