import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { type Landmark, type SquatCounter, type SquatFeedback } from "./rep-counter.ts";

type CameraOptions = {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  counter: SquatCounter;
  skeleton: () => boolean;
  onCamera: (on: boolean) => void;
  onFrame: (feedback: SquatFeedback) => void;
  onError: (reason: unknown) => void;
};
const CONNECTIONS = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

export class CameraSession {
  private options: CameraOptions;
  private stopped = false;
  private stream: MediaStream | null = null;
  private pose: PoseLandmarker | null = null;
  private frame = 0;
  private lastFrame = -Infinity;
  private lastVideoTime = -1;

  constructor(options: CameraOptions) { this.options = options; }

  async start(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      });
      if (this.stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => this.fail(new Error("The camera disconnected. Your count is kept; retry or count manually.")), { once: true });
      }
      this.options.video.srcObject = stream;
      this.options.onCamera(true);
      await this.options.video.play();
      if (this.stopped) return;
      const files = await FilesetResolver.forVisionTasks(chrome.runtime.getURL("pose/wasm"));
      if (this.stopped) return;
      const pose = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: chrome.runtime.getURL("pose/pose_landmarker_lite.task"), delegate: "CPU" },
        runningMode: "VIDEO", numPoses: 1, outputSegmentationMasks: false,
        minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5,
      });
      if (this.stopped) { pose.close(); return; }
      this.pose = pose;
      this.frame = requestAnimationFrame((time) => this.tick(time));
    } catch (reason) { this.fail(reason); }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.options.video.srcObject === this.stream) this.options.video.srcObject = null;
    this.stream = null;
    this.pose?.close();
    this.pose = null;
    this.options.canvas.getContext("2d")?.clearRect(0, 0, this.options.canvas.width, this.options.canvas.height);
    this.options.counter.resetTracking();
    this.options.onCamera(false);
  }

  private fail(reason: unknown): void {
    if (this.stopped) return;
    this.stop();
    this.options.onError(reason);
  }

  private tick(time: number): void {
    if (this.stopped || !this.pose) return;
    const { video } = this.options;
    if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime && time - this.lastFrame >= 1000 / 12) {
      this.lastFrame = time;
      this.lastVideoTime = video.currentTime;
      try {
        const result = this.pose.detectForVideo(video, time);
        const landmarks = result.landmarks[0] ?? [];
        this.draw(landmarks);
        const feedback = this.options.counter.update(
          landmarks, result.worldLandmarks[0] ?? [], time, video.videoWidth / video.videoHeight,
        );
        result.close();
        this.options.onFrame(feedback);
      } catch (reason) { this.fail(reason); }
    }
    if (!this.stopped) this.frame = requestAnimationFrame((next) => this.tick(next));
  }

  private draw(landmarks: Landmark[]): void {
    const { video, canvas } = this.options;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The skeleton overlay could not start. Turn off camera counting and use the manual counter.");
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.options.skeleton()) return;
    context.strokeStyle = "#c8f36b";
    context.fillStyle = "#c8f36b";
    context.lineWidth = 4;
    for (const [a, b] of CONNECTIONS) {
      const first = landmarks[a];
      const second = landmarks[b];
      if (!first || !second || first.visibility < .6 || second.visibility < .6) continue;
      context.beginPath();
      context.moveTo(first.x * canvas.width, first.y * canvas.height);
      context.lineTo(second.x * canvas.width, second.y * canvas.height);
      context.stroke();
    }
  }
}

export function cameraError(reason: unknown): string {
  if (reason instanceof DOMException) {
    if (reason.name === "NotAllowedError") return "Camera permission wasn't granted. Allow this extension in your browser and OS camera settings, or count manually.";
    if (reason.name === "NotFoundError") return "No webcam was found. Connect a camera and retry, or count manually.";
    if (reason.name === "NotReadableError") return "The webcam is busy or unavailable. Close other camera apps and retry, or count manually.";
  }
  return `Camera counting stopped: ${reason instanceof Error ? reason.message : String(reason)} Your count is kept. Retry or count manually.`;
}
