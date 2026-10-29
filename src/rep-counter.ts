export type Landmark = { x: number; y: number; z: number; visibility: number };
export type SquatState = "not-ready" | "ready-up" | "down-confirmed" | "paused";
export type SquatFeedback = { state: SquatState; reps: number; cue: string };
const SIDES = [[11, 23, 25, 27], [12, 24, 26, 28]] as const;
const DWELL_MS = 200;
const DOWN_DWELL_MS = 150;
const TRACKING_GRACE_MS = 250;

export function jointAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const ab = [a.x - b.x, a.y - b.y, a.z - b.z];
  const cb = [c.x - b.x, c.y - b.y, c.z - b.z];
  const denominator = Math.hypot(...ab) * Math.hypot(...cb);
  if (denominator < 1e-8) return NaN;
  return Math.acos(Math.max(-1, Math.min(1, ab.reduce((sum, n, i) => sum + n * cb[i], 0) / denominator))) * 180 / Math.PI;
}

export class SquatCounter {
  private state: SquatState = "not-ready";
  private reps = 0;
  private lastTime = -Infinity;
  private candidate: "up" | "down" | null = null;
  private candidateSince = 0;
  private lastRep = -Infinity;
  private side = -1;
  private smoothed: { angle: number; hip: number } | null = null;
  private standingHip: number | null = null;
  private standingTorso = 0;
  private lastTrackedTime = -Infinity;

  resetTracking(): void {
    this.state = "paused";
    this.candidate = null;
    this.smoothed = null;
    this.standingHip = null;
    this.standingTorso = 0;
    this.side = -1;
    this.lastTrackedTime = -Infinity;
  }

  update(landmarks: Landmark[], worldLandmarks: Landmark[], now: number, aspectRatio = 1): SquatFeedback {
    if (!Number.isFinite(now) || now <= this.lastTime) return this.feedback();
    if (Number.isFinite(this.lastTime) && now - this.lastTime > 500) this.resetTracking();
    this.lastTime = now;
    const visible = (p: Landmark | undefined): p is Landmark => !!p && p.visibility >= .6 &&
      [p.x, p.y, p.z, p.visibility].every(Number.isFinite) &&
      p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    const scores = SIDES.map((indices) => indices.every((i) => visible(landmarks[i]))
      ? Math.min(...indices.map((i) => landmarks[i].visibility)) : -1);
    // Keep the same side for the whole repetition; a side switch requires standing again.
    const side = scores[0] < 0 && scores[1] < 0 ? -1
      : this.side >= 0 && scores[this.side] >= 0 ? this.side : scores[0] >= scores[1] ? 0 : 1;
    if (side < 0 || (this.side >= 0 && scores[this.side] < 0 && now - this.lastTrackedTime <= TRACKING_GRACE_MS)) {
      const confident = SIDES.some((indices) => indices.every((i) => landmarks[i]?.visibility >= .6));
      const cue = confident
        ? "Move farther back. Keep your shoulder, hip, knee and ankle inside the preview."
        : "Leg tracking is uncertain. Turn side-on in good light and keep your whole body in view.";
      this.candidate = null;
      if (now - this.lastTrackedTime > TRACKING_GRACE_MS) this.resetTracking();
      return { state: "paused", reps: this.reps, cue };
    }
    if (this.side >= 0 && this.side !== side) this.resetTracking();
    this.side = side;
    const [shoulder, hip] = SIDES[side].map((i) => landmarks[i]);
    const joints = SIDES[side].map((i) => worldLandmarks[i]);
    if (!joints.every((p) => p && [p.x, p.y, p.z].every(Number.isFinite))) {
      this.resetTracking();
      return { ...this.feedback(), cue: "The tracker couldn't estimate your leg position. Stand side-on in good light, or count manually." };
    }
    // World joints share metric 3D units; normalized image depth can misread straight legs.
    const angle = jointAngle(joints[1], joints[2], joints[3]);
    const torso = Math.hypot((shoulder.x - hip.x) * aspectRatio, shoulder.y - hip.y);
    if (!Number.isFinite(angle) || !Number.isFinite(aspectRatio) || aspectRatio <= 0 ||
      (this.standingHip === null && torso < .05)) {
      this.resetTracking();
      return this.feedback();
    }
    const upright = Math.abs(joints[0].y - joints[1].y) /
      Math.hypot(joints[0].x - joints[1].x, joints[0].y - joints[1].y, joints[0].z - joints[1].z);
    // A squat can include a forward torso lean without putting the whole body on the floor.
    const bodyUpright = Math.abs(joints[0].y - joints[3].y) /
      Math.hypot(joints[0].x - joints[3].x, joints[0].y - joints[3].y, joints[0].z - joints[3].z);
    if (!Number.isFinite(upright) || !Number.isFinite(bodyUpright) || bodyUpright < .45) {
      this.resetTracking();
      return { ...this.feedback(), cue: "Squat counting is paused for floor movement. Stand upright to start squats." };
    }
    const alpha = 1 - Math.pow(.5, (now - this.lastTrackedTime) / (1000 / 12));
    this.lastTrackedTime = now;
    this.smoothed = this.smoothed ? {
      angle: this.smoothed.angle + alpha * (angle - this.smoothed.angle),
      hip: this.smoothed.hip + alpha * (hip.y - this.smoothed.hip),
    } : { angle, hip: hip.y };
    // View-dependent 3D estimates can read a standing leg at 140-155 degrees.
    // Upright torso and return to calibrated hip height also guard the up pose.
    const up = this.smoothed.angle >= 140 && upright >= .8 &&
      (this.standingHip === null || this.smoothed.hip - this.standingHip <= .15 * this.standingTorso);
    // Keep an established down candidate briefly as the person starts to rise.
    const down = this.smoothed.angle <= (this.candidate === "down" ? 125 : 110) && this.standingHip !== null &&
      this.smoothed.hip - this.standingHip >= .15 * this.standingTorso;
    const candidate = up ? "up" : down ? "down" : null;
    if (candidate !== this.candidate) {
      this.candidate = candidate;
      this.candidateSince = now;
    }
    if (candidate && now - this.candidateSince >= (candidate === "down" ? DOWN_DWELL_MS : DWELL_MS)) {
      if (candidate === "up") {
        if (this.state === "down-confirmed" && now - this.lastRep >= 700) {
          this.reps++;
          this.lastRep = now;
        }
        // A slow descent must not drag the standing baseline down with it.
        if (this.state !== "ready-up" || this.standingHip === null || this.smoothed.hip < this.standingHip) {
          this.standingHip = this.smoothed.hip;
          this.standingTorso = torso;
        }
        this.state = "ready-up";
      } else if (this.state === "ready-up") {
        this.state = "down-confirmed";
      }
    }
    return this.feedback();
  }

  private feedback(): SquatFeedback {
    const cue = this.state === "ready-up" ? "Ready. Squat to a comfortable depth."
      : this.state === "down-confirmed" ? "Return to standing when comfortable."
      : this.state === "paused" ? "Tracking paused. Keep your shoulder, hip, knee and ankle visible, then stand upright again."
      : "Stand upright and still to find your starting position. If you already are, turn side-on or count manually.";
    return { state: this.state, reps: this.reps, cue };
  }
}
