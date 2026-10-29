import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CameraSession, cameraError } from "./camera.ts";
import { message, request } from "./client.ts";
import { type Action, type AppState } from "./model.ts";
import { SquatCounter } from "./rep-counter.ts";
import "./style.css";
import "./coach.css";

type Stage = "setup" | "loading" | "counting" | "paused" | "review" | "manual";

function Coach() {
  const id = new URLSearchParams(location.search).get("id");
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<Stage>("setup");
  const [cameraOn, setCameraOn] = useState(false);
  const [target, setTarget] = useState(10);
  const [automatic, setAutomatic] = useState(0);
  const [adjustment, setAdjustment] = useState(0);
  const [cue, setCue] = useState("Stand side-on or at a three-quarter angle, with your whole body in view.");
  const [skeleton, setSkeleton] = useState(true);
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<CameraSession | null>(null);
  const counter = useRef(new SquatCounter());
  const preferences = useRef({ target, adjustment, skeleton });
  preferences.current = { target, adjustment, skeleton };
  const item = state?.breaks.find((entry) => entry.id === id);
  const active = item?.status === "active" && item.exerciseId === "squats";
  const count = automatic + adjustment;

  const stop = useCallback(() => {
    session.current?.stop();
    session.current = null;
  }, []);

  useEffect(() => {
    let disposed = false;
    const read = async () => {
      try {
        const saved = await request({ type: "get" });
        if (!disposed) setState(saved);
      } catch (reason) {
        if (!disposed) { stop(); setStage("paused"); setError(message(reason)); }
      }
    };
    void read();
    const changed = () => { void read(); };
    const hide = () => {
      if (document.hidden && session.current) {
        stop();
        setStage("paused");
        setCue("Camera paused because this tab is hidden. Your count is kept.");
      }
    };
    chrome.storage.onChanged.addListener(changed);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    window.addEventListener("beforeunload", stop);
    return () => {
      disposed = true;
      stop();
      chrome.storage.onChanged.removeListener(changed);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("beforeunload", stop);
    };
  }, [stop]);

  useEffect(() => { if (!active) stop(); }, [active, stop]);

  function enableCamera() {
    if (!active || !video.current || !canvas.current || session.current) return;
    setError("");
    setStage("loading");
    setCue("Allow the camera prompt. Loading the tracker from this extension...");
    const camera = new CameraSession({
      video: video.current, canvas: canvas.current, counter: counter.current,
      skeleton: () => preferences.current.skeleton,
      onCamera: setCameraOn,
      onFrame(feedback) {
        setAutomatic(feedback.reps);
        setStage("counting");
        setCue(feedback.cue);
        if (feedback.reps + preferences.current.adjustment >= preferences.current.target) {
          stop();
          setStage("review");
          setCue("Set finished. Camera off. Check the count before saving.");
        }
      },
      onError(reason) {
        session.current = null;
        setStage("paused");
        setError(cameraError(reason));
      },
    });
    session.current = camera;
    void camera.start();
  }

  function adjust(delta: number) {
    const next = adjustment + delta;
    if (automatic + next < 0 || automatic + next > 1000) return;
    setAdjustment(next);
    preferences.current.adjustment = next;
    if (stage === "setup") {
      setStage("manual");
      setCue("Camera off. Move at your own pace and use +1 / -1 to record your reps.");
    }
    if (automatic + next >= target) {
      stop();
      setStage("review");
      setCue("Set finished. Camera off. Check the count before saving.");
    }
  }

  function manual() {
    stop();
    setStage("manual");
    setCue("Camera off. Move at your own pace and use +1 / -1 to record your reps.");
  }

  async function act(action: Action) {
    stop();
    setBusy(true);
    setError("");
    setStage("review");
    try { setState(await request(action)); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  return <main className="coach-shell">
    <header className="coach-header">
      <a href="./index.html" onClick={stop}>Exercise Snacks</a>
      <span className="status-pill">Experimental · squats only</span>
    </header>
    <div className="coach-title">
      <h1>Squats, at your pace.</h1>
      <p>Optional Camera Coach counts a full down-and-up movement. It doesn't verify form, depth or exercise quality.</p>
    </div>
    {error && <div role="alert" className="error-banner"><p>{error}</p></div>}
    {!state && !error && <p role="status">Loading your local exercise...</p>}
    {state && !active ? <section className="coach-ended">
      <h2>{item?.status === "completed" ? "A little movement, made for you." : "This squat break isn't active."}</h2>
      <p>{item?.reps
        ? `${item.reps.completedReps} of ${item.reps.targetReps} squats saved locally. ${item.reps.countingMode === "camera" ? "Camera-assisted estimate" : "Manual count"}.`
        : "Open Today and start a squat break first. Your normal timer remains available; nothing needs a camera."}</p>
      <p>Camera off. No video or images saved.</p>
      <a className="secondary-button" href="./index.html">Back to today</a>
    </section> : <div className="coach-layout">
      <section className="coach-preview" aria-label="Camera setup and preview">
        <div className="coach-preview-heading">
          <h2>Camera Coach</h2>
          <span className={`status-pill ${cameraOn ? "is-on" : ""}`} role="status">
            <span className="status-dot" aria-hidden="true" />{cameraOn ? "Camera on · on-device only" : "Camera off"}
          </span>
        </div>
        <div className="coach-video-stage" data-stage={stage}>
          <video ref={video} muted playsInline aria-label="Mirrored webcam preview" />
          <canvas ref={canvas} aria-hidden="true" />
          {!cameraOn && <div className="coach-placeholder">
            <svg viewBox="0 0 160 200" aria-hidden="true">
              <path d="M25 35V15h25m60 0h25v20M25 165v20h25m60 0h25v-20" />
              <circle cx="80" cy="48" r="13" />
              <path d="m80 62-2 47m0-31L53 100m25-23 26 23m-26 9-17 42-7 18m24-60 21 41 10 19" />
            </svg>
            <p>{stage === "loading" ? "Waiting for camera permission..." : "Your camera stays off until you choose."}</p>
          </div>}
        </div>
        <p className="coach-cue" role="status" aria-live="polite">{cue}</p>
        <label className="coach-check"><input type="checkbox" checked={skeleton}
          onChange={(event) => setSkeleton(event.target.checked)} />Show body skeleton</label>
        <details className="coach-help">
          <summary>Framing, privacy and limitations</summary>
          <p>Use a well-lit, clear space. Keep your head and feet visible, with a little room around you. Face side-on or at a three-quarter angle. Stand still until the cue says Ready before starting. A visible skeleton alone doesn't mean the counter has found your standing position.</p>
          <p>Counting pauses when the required joints leave view. Stand upright again to resume. Never squat deeper just to satisfy the counter; count manually instead.</p>
          <p>Frames stay in this tab, with no recording, uploads, analytics or cloud inference. Hiding or closing this tab, pausing, stopping or reaching the target stops the camera. Only your count summary is saved when you choose Save.</p>
          <p>Automatic counting is experimental, not medical guidance or certified verification. It hasn't been validated with five people across Windows/Mac webcams. Push-ups and other movements still use the normal timer.</p>
        </details>
      </section>
      <section className="coach-controls" aria-label="Rep counter">
        <label className="coach-target" htmlFor="target-reps">Your squat target
          <select id="target-reps" value={target} disabled={stage !== "setup" || !active}
            onChange={(event) => setTarget(Number(event.target.value))}>
            {[3, 5, 10, 15, 20].map((n) => <option key={n} value={n}>{n} reps</option>)}
          </select>
        </label>
        <div className="coach-count" aria-label={`${count} of ${target} reps`}>
          <span>{count}</span><span className="coach-count-target">/ {target}</span>
        </div>
        <progress max={target} value={Math.min(count, target)} aria-label="Reps toward target" />
        <p className="coach-count-description">{stage === "review" ? "Check and save your count." : "Every comfortable rep is enough."}</p>
        <div className="coach-adjustments">
          <button className="secondary-button" aria-label="Subtract one rep" disabled={!active || count === 0 || busy}
            onClick={() => adjust(-1)}>-1</button>
          <span>Adjust count</span>
          <button className="secondary-button" aria-label="Add one rep" disabled={!active || count >= 1000 || busy}
            onClick={() => adjust(1)}>+1</button>
        </div>
        <div className="coach-primary-actions">
          {(stage === "setup" || stage === "paused" || stage === "manual") &&
            <button className="primary-button" disabled={!active || busy || count >= target} onClick={enableCamera}>
              {stage === "setup" ? "Enable camera counting" : "Resume with camera"}
            </button>}
          {(stage === "loading" || stage === "counting") && <>
            <button className="primary-button" disabled={busy} onClick={() => {
              stop(); setStage("paused"); setCue("Paused. Camera off. Your count is kept.");
            }}>{stage === "loading" ? "Cancel camera setup" : "Pause · camera off"}</button>
            <button className="secondary-button" onClick={() => {
              stop(); setStage("review"); setCue("Camera off. Check your count, then save or adjust.");
            }}>Stop counting</button>
          </>}
          {stage !== "setup" && stage !== "loading" && stage !== "counting" &&
            <button className="primary-button" disabled={!active || busy || count < 1} onClick={() => { void act({
              type: "complete-reps", id: id!, reps: {
                targetReps: target, completedReps: count, automaticReps: automatic,
                manualAdjustment: adjustment, countingMode: automatic > 0 ? "camera" : "manual",
              },
            }); }}>{busy ? "Saving..." : `Save ${count} ${count === 1 ? "rep" : "reps"}`}</button>}
          <button className="text-button" disabled={!active || busy} onClick={manual}>Count manually · no camera</button>
        </div>
        <p className="coach-comfort">Stop if anything feels uncomfortable. Finishing below your target is fine. Your normal break timer is still available in Today.</p>
        <a href="./index.html" onClick={stop}>Use the normal timer</a>
        <button className="text-button coach-skip" disabled={!active || busy} onClick={() => { void act({ type: "skip", id: id! }); }}>
          End without logging
        </button>
      </section>
    </div>}
    <footer className="coach-footer">Local-first. Camera optional. No score to keep up with.</footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Coach />);
