import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const fixture = process.env.PRIVATE_CAMERA_FIXTURE ?? "squat-pushup";
if (!/^[a-z0-9-]+$/.test(fixture)) throw new Error("PRIVATE_CAMERA_FIXTURE must be a simple lowercase fixture name.");
for (const name of ["expected.json", "motion.json", "inspection.json"]) {
  try { await access(resolve(".private-camera-fixtures", fixture, name)); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error("Private camera fixture missing. Run prepare-private-camera.mjs with your local MP4, annotate expected.json, and prepare it again.");
  }
}
const source = process.argv[2];
if (source) await access(resolve(source));
const run = spawnSync(process.execPath, [
  "--experimental-strip-types", "--test", "--test-concurrency=1",
  "src/private-camera.test.ts", "scripts/private-camera.test.mjs", "scripts/private-pose-images.test.mjs",
], {
  stdio: "inherit",
  env: { ...process.env, ...(source ? { PRIVATE_CAMERA_SOURCE: resolve(source) } : {}) },
});
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
