import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { SquatCounter, type Landmark } from "./rep-counter.ts";

type Segment = { name: string; startSeconds: number; endSeconds: number; squats: number };
type Expected = {
  expectedSquats: number; segments: Segment[]; representatives: { file: string; timeSeconds: number }[];
  floorWindowSeconds: [number, number]; initialPartialUntilSeconds?: number;
};
type Motion = {
  sourceSha256: string; width: number; height: number; sampleFps: number; durationSeconds: number;
  samples: { timeMs: number; image: (Landmark | null)[]; world: (Landmark | null)[] }[];
};
const root = resolve(".private-camera-fixtures");
let fixtures: string[] = [];
try { fixtures = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); }
catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
if (fixtures.length === 0) {
  test("private recorded-motion regression", { skip: "Private recording not prepared on this checkout." }, () => {});
}
for (const fixture of fixtures) {
  const directory = resolve(root, fixture);
  let expected: Expected | null = null;
  try { expected = JSON.parse(await readFile(resolve(directory, "expected.json"), "utf8")) as Expected; }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  test(`private recorded-motion regression (${fixture}; deliberately absent from Git/ZIP)`,
    { skip: expected === null ? "Private recording not prepared on this checkout." : false }, async (t) => {
      assert.ok(expected);
      const motion = JSON.parse(await readFile(resolve(directory, "motion.json"), "utf8")) as Motion;
      assert.equal(motion.sampleFps, 12);
      assert.ok(motion.samples.length >= Math.floor((motion.durationSeconds - .1) * motion.sampleFps),
        "Preserve the complete motion sequence, not isolated stills.");
      const replay = (start = 0, end = Infinity) => {
        const counter = new SquatCounter();
        const zero: Landmark = { x: 0, y: 0, z: 0, visibility: 0 };
        return motion.samples.filter(frame => frame.timeMs >= start * 1000 && frame.timeMs < end * 1000)
          .map(frame => ({
            time: frame.timeMs / 1000,
            ...counter.update(frame.image.map(p => p ?? zero), frame.world.map(p => p ?? zero),
              frame.timeMs, motion.width / motion.height),
          }));
      };
      const full = replay();
      assert.equal(full.at(-1)?.reps, expected.expectedSquats);
      if (expected.initialPartialUntilSeconds !== undefined) {
        assert.equal(replay(0, expected.initialPartialUntilSeconds).at(-1)?.reps, 0,
          "Starting at the bottom of a squat is not a complete calibrated repetition.");
      }
      let cumulative = 0;
      for (const segment of expected.segments) {
        cumulative += segment.squats;
        const total = cumulative;
        await t.test(segment.name, () => {
          assert.equal(full.filter(frame => frame.time < segment.endSeconds).at(-1)?.reps, total);
          assert.equal(replay(segment.startSeconds, segment.endSeconds).at(-1)?.reps, segment.squats,
            "The segment must work with a fresh standing calibration as well as within the complete video.");
        });
      }
      await t.test("push-ups cannot establish squat readiness or add squat credit", () => {
        const [start, end] = expected!.floorWindowSeconds;
        const floor = full.filter(frame => frame.time >= start && frame.time < end);
        assert.ok(floor.length >= Math.floor((end - start) * motion.sampleFps) - 1);
        assert.ok(floor.every(frame => frame.state === "paused" && frame.reps === expected?.expectedSquats));
      });
      await t.test("undersampling to 6-12 FPS loses at most one short rep and never adds squat credit", () => {
        for (const fps of [6, 8, 10, 12]) {
          for (const phaseMs of [0, 30, 60]) {
            const counter = new SquatCounter();
            let next = phaseMs;
            let reps = 0;
            for (const frame of motion.samples) {
              if (frame.timeMs < next) continue;
              next += 1000 / fps;
              const zero: Landmark = { x: 0, y: 0, z: 0, visibility: 0 };
              reps = counter.update(frame.image.map(p => p ?? zero), frame.world.map(p => p ?? zero),
                frame.timeMs, motion.width / motion.height).reps;
            }
            assert.ok(reps >= expected!.expectedSquats - 1 && reps <= expected!.expectedSquats,
              `${fps} FPS, ${phaseMs} ms offset: ${reps} reps`);
          }
        }
      });
      await t.test("representative private images match their source and saved checksums", async () => {
        const inspection = JSON.parse(await readFile(resolve(directory, "inspection.json"), "utf8")) as {
          sourceSha256: string; snapshots: { file: string; timeSeconds: number | null; sha256: string }[];
        };
        assert.equal(inspection.sourceSha256, motion.sourceSha256);
        assert.equal(expected?.representatives.length, 8);
        for (const frame of inspection.snapshots) {
          assert.match(frame.file, /^[a-z0-9-]+\.jpg$/);
          const bytes = await readFile(resolve(directory, frame.file));
          assert.equal(createHash("sha256").update(bytes).digest("hex"), frame.sha256, frame.file);
        }
        for (const frame of expected!.representatives) {
          assert.ok(inspection.snapshots.some(image => image.file === frame.file && image.timeSeconds === frame.timeSeconds));
        }
      });
    });
}
