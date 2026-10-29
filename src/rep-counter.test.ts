import assert from "node:assert/strict";
import { test } from "node:test";
import { jointAngle, SquatCounter, type Landmark } from "./rep-counter.ts";

function pose(kind: "up" | "down" | "partial", side = 0): Landmark[] {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const down = kind === "down";
  const partial = kind === "partial";
  const set = (index: number, x: number, y: number) => { points[index + side] = { x, y, z: 0, visibility: .95 }; };
  set(11, .5, down ? .35 : partial ? .25 : .1);
  set(23, .5, down ? .65 : partial ? .55 : .4);
  set(25, kind === "up" ? .5 : .7, .65);
  set(27, kind === "up" ? .5 : .7, .9);
  return points;
}

function sequence() {
  const counter = new SquatCounter();
  let time = 0;
  return {
    counter,
    hold(points: Landmark[], frames = 12) {
      let output = counter.update(points, points, time += 100);
      for (let i = 1; i < frames; i++) output = counter.update(points, points, time += 100);
      return output;
    },
    gap() { time += 1000; },
  };
}

test("joint angles reject degenerate geometry and calculate full extension and a right angle", () => {
  const p = (x: number, y: number): Landmark => ({ x, y, z: 0, visibility: 1 });
  assert.equal(jointAngle(p(0, 0), p(0, 1), p(0, 2)), 180);
  assert.equal(jointAngle(p(0, 0), p(0, 1), p(1, 1)), 90);
  assert.ok(Number.isNaN(jointAngle(p(0, 0), p(0, 0), p(1, 1))));
});

test("ten full down/up cycles produce exactly ten reps, not extra counts while standing", () => {
  const s = sequence();
  assert.equal(s.hold(pose("up")).state, "ready-up");
  for (let i = 1; i <= 10; i++) {
    assert.equal(s.hold(pose("down")).state, "down-confirmed");
    assert.equal(s.hold(pose("up")).reps, i);
    assert.equal(s.hold(pose("up")).reps, i);
  }
});

test("starting down, partial squats and one-frame dips never count a rep", () => {
  const s = sequence();
  s.hold(pose("down"));
  assert.equal(s.hold(pose("up")).reps, 0);
  for (let i = 0; i < 10; i++) {
    s.hold(pose("partial"));
    assert.equal(s.hold(pose("up")).reps, 0);
    s.hold(pose("down"), 1);
    assert.equal(s.hold(pose("up")).reps, 0);
  }
});

test("a bent knee without hip descent is rejected", () => {
  const s = sequence();
  s.hold(pose("up"));
  const bent = pose("down");
  bent[11].y -= .25;
  bent[23].y -= .25;
  bent[25].y -= .25;
  bent[27].y -= .25;
  s.hold(bent);
  assert.equal(s.hold(pose("up")).reps, 0);
});

test("occlusion, leaving the frame and long frame gaps require standing again without adding credit", () => {
  for (const issue of ["missing", "low-confidence", "out-of-frame", "gap"]) {
    const s = sequence();
    s.hold(pose("up"));
    s.hold(pose("down"));
    const invalid = pose("down");
    if (issue === "missing") s.hold([]);
    else if (issue === "gap") s.gap();
    else {
      if (issue === "low-confidence") invalid[25].visibility = .2;
      else invalid[27].y = 1.1;
      s.hold(invalid);
    }
    assert.equal(s.hold(pose("up")).reps, 0, issue);
    s.hold(pose("down"));
    assert.equal(s.hold(pose("up")).reps, 1, issue);
  }
});

test("switching body sides or explicitly pausing discards an unfinished rep", () => {
  for (const pause of [false, true]) {
    const s = sequence();
    s.hold(pose("up"));
    s.hold(pose("down"));
    if (pause) s.counter.resetTracking();
    assert.equal(s.hold(pose("up", pause ? 0 : 1)).reps, 0);
  }
});

test("duplicate or backwards timestamps cannot create reps", () => {
  const counter = new SquatCounter();
  for (let i = 0; i < 30; i++) {
    const points = pose(i % 2 ? "down" : "up");
    assert.equal(counter.update(points, points, 100).reps, 0);
    assert.equal(counter.update(pose("up"), pose("up"), 50).reps, 0);
  }
});

test("world-joint angles count a full squat even when image depth misreads a straight leg", () => {
  const counter = new SquatCounter();
  let time = 0;
  const hold = (kind: "up" | "down") => {
    const image = pose(kind);
    image[25].z = -.3;
    const world = pose(kind).map((point) => ({ ...point, x: point.x - .5, y: .5 - point.y }));
    let result = counter.update(image, world, time += 100, 4 / 3);
    for (let i = 1; i < 12; i++) result = counter.update(image, world, time += 100, 4 / 3);
    return result;
  };
  assert.equal(hold("up").state, "ready-up");
  assert.equal(hold("down").state, "down-confirmed");
  assert.equal(hold("up").reps, 1);
});

test("missing or invalid world joints discard an unfinished rep instead of estimating it from image depth", () => {
  for (const invalid of ["missing", "nonfinite", "degenerate"]) {
    const s = sequence();
    s.hold(pose("up"));
    s.hold(pose("down"));
    const world = invalid === "missing" ? [] : pose("up");
    if (invalid === "nonfinite") world[25].z = NaN;
    if (invalid === "degenerate") world[25] = { ...world[23] };
    assert.equal(s.counter.update(pose("up"), world, 2500).state, "paused", invalid);
    assert.equal(s.hold(pose("up")).reps, 0, invalid);
  }
});

test("framing and confidence failures give distinct recovery cues even if part of the skeleton is visible", () => {
  const counter = new SquatCounter();
  const cropped = pose("up");
  cropped[27].y = 1.005;
  assert.match(counter.update(cropped, cropped, 100).cue, /inside the preview/);
  const uncertain = pose("up");
  uncertain[27].visibility = .4;
  assert.match(counter.update(uncertain, uncertain, 200).cue, /Leg tracking is uncertain/);
  assert.match(counter.update(pose("up"), [], 300).cue, /couldn't estimate your leg position/);
});

test("view-biased standing legs and near-edge visible ankles still complete a squat", () => {
  const counter = new SquatCounter();
  let time = 0;
  const hold = (kind: "up" | "down", ankleOffset = .14) => {
    const image = pose(kind);
    image[27].y = .995;
    const world = pose(kind);
    if (kind === "up") world[27].x += ankleOffset;
    let result = counter.update(image, world, time += 100);
    for (let i = 1; i < 12; i++) result = counter.update(image, world, time += 100);
    return result;
  };
  assert.equal(hold("up", .04).state, "ready-up");
  assert.equal(hold("down").state, "down-confirmed");
  assert.equal(hold("up").reps, 1, "A viewpoint change from about 171 to 151 degrees must not trap the down phase.");
});

test("a brief ankle-confidence flicker freezes tracking without losing a confirmed descent", () => {
  const s = sequence();
  s.hold(pose("up"));
  s.hold(pose("down"));
  const noisy = pose("down");
  noisy[27].visibility = .4;
  assert.equal(s.hold(noisy, 1).state, "paused");
  assert.equal(s.hold(pose("up")).reps, 1);
});

test("floor movement clears a pending squat and cannot establish squat readiness", () => {
  const s = sequence();
  s.hold(pose("up"));
  s.hold(pose("down"));
  const floor = pose("up");
  for (const [index, x] of [[11, .2], [23, .4], [25, .65], [27, .9]]) {
    floor[index] = { x, y: .5, z: 0, visibility: .95 };
  }
  assert.equal(s.hold(floor).state, "paused");
  assert.equal(s.hold(floor).reps, 0);
  assert.equal(s.hold(pose("up")).reps, 0);
});

test("slow descent cannot drag the standing hip baseline down with it", () => {
  const s = sequence();
  s.hold(pose("up"));
  for (let step = 1; step <= 20; step++) {
    const fraction = step / 20;
    const top = pose("up");
    const bottom = pose("down");
    const intermediate = top.map((p, i) => ({
      ...p, x: p.x + (bottom[i].x - p.x) * fraction, y: p.y + (bottom[i].y - p.y) * fraction,
    }));
    s.hold(intermediate, 3);
  }
  assert.equal(s.hold(pose("up")).reps, 1);
});

test("forward lean and a foreshortened torso preserve a squat at different image scales", () => {
  for (const scale of [1, .5]) {
    const counter = new SquatCounter();
    let time = 0;
    const hold = (kind: "up" | "down") => {
      const image = pose(kind);
      const world = pose(kind);
      if (kind === "down") {
        image[11].y = image[23].y - .005;
        world[11] = { ...world[11], y: world[23].y, z: .3 };
      }
      const scaled = image.map(p => ({ ...p, x: (p.x - .5) * scale + .5, y: p.y * scale + .1 }));
      let output = counter.update(scaled, world, time += 100);
      for (let i = 1; i < 12; i++) output = counter.update(scaled, world, time += 100);
      return output;
    };
    assert.equal(hold("up").state, "ready-up");
    assert.equal(hold("down").state, "down-confirmed", `image scale ${scale}`);
    assert.equal(hold("up").reps, 1);
  }
});

test("a horizontal body with bent knees still clears pending squat credit", () => {
  const s = sequence();
  s.hold(pose("up"));
  s.hold(pose("down"));
  const floor = pose("up");
  for (const [index, x] of [[11, .2], [23, .4], [25, .65], [27, .9]]) {
    floor[index] = { x, y: index === 25 ? .7 : .5, z: 0, visibility: .95 };
  }
  assert.equal(s.hold(floor).state, "paused");
  assert.equal(s.hold(pose("up")).reps, 0);
});
