import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cache = join(root, ".camera-cache");
const output = join(root, "public", "pose");
const name = "pose_landmarker_lite.task";
const hash = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a";
const url = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/${name}`;
await mkdir(cache, { recursive: true });
await mkdir(join(output, "wasm"), { recursive: true });
let model;
try { model = await readFile(join(cache, name)); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.log("Downloading the pinned MediaPipe model for local, offline camera use...");
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000), redirect: "error" });
  if (!response.ok) throw new Error(`Camera model download failed: HTTP ${response.status}.`);
  model = Buffer.from(await response.arrayBuffer());
}
if (createHash("sha256").update(model).digest("hex") !== hash) {
  throw new Error("Camera model checksum does not match the pinned official model. No build was produced.");
}
await writeFile(join(cache, name), model);
await writeFile(join(output, name), model);
const wasm = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
for (const file of await readdir(wasm)) {
  if (/^vision_wasm_(?:nosimd_)?internal\.(?:js|wasm)$/.test(file)) {
    await copyFile(join(wasm, file), join(output, "wasm", file));
  }
}
for (const file of ["LICENSE.txt", "MODEL_CARD.pdf"]) {
  await copyFile(join(root, "docs", "third-party", file), join(output, file));
}
