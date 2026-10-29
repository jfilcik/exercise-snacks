import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { completedMinutes, DEFAULT_SETTINGS, EXERCISES, exerciseChoices, exerciseOptions, type Action, type AppState, type ExerciseBreak, type Settings } from "./model.ts";
import { message, request } from "./client.ts";
import { snapshotFresh } from "./scheduler.ts";
import { dateInZone, MINUTE, timeLabel } from "./time.ts";
import "./style.css";

function localDefaults(): Settings {
  return { ...DEFAULT_SETTINGS, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [draft, setDraft] = useState<Settings>(localDefaults);
  const [tab, setTab] = useState<"today" | "progress" | "settings">("today");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let disposed = false;
    async function read(initial = false) {
      try {
        const saved = await request({ type: "get" });
        if (disposed) return;
        setState(saved);
        if (initial) {
          setDraft(saved.settings ?? localDefaults());
        }
      } catch (reason) {
        if (!disposed) setError(message(reason));
      }
    }
    void read(true);
    const poll = setInterval(() => { void read(); }, 15_000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { disposed = true; clearInterval(poll); clearInterval(clock); };
  }, []);

  async function act(action: Action) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await request(action);
      setState(saved);
      if (action.type === "settings") setTab("today");
      if (action.type === "test-notification") {
        setNotice("Test notification sent. If you don't see it, check browser and device notification settings.");
      }
      if (action.type === "start") setNotice("Your time. Move in a way that feels comfortable.");
      if (action.type === "start-early") setNotice("Started manually. Your calendar wasn't checked. Move in a way that feels comfortable.");
      if (action.type === "complete") setNotice("Done. A little movement, made for yourself.");
      if (action.type === "skip") setNotice("Skipped. No make-up break—pick up whenever you're ready.");
      if (action.type === "snooze") setNotice("Reminder moved to a later time.");
      if (action.type === "different") setNotice("Here's another way to move.");
      if (action.type === "connect-google") setNotice("Google consent completed. Save preferences to check your primary calendar.");
      if (action.type === "disconnect-google") {
        setNotice("Google's cached authorization is cleared. Saved Google reminders are paused. You can also revoke access in your Google account.");
        setDraft((current) => ({ ...current, enabled: false }));
      }
      if (action.type === "reset") { setDraft(localDefaults()); setConfirmReset(false); }
    } catch (reason) {
      setError(message(reason));
      try { setState(await request({ type: "get" })); }
      catch (readError) { setError(`${message(reason)} ${message(readError)}`); }
    } finally { setBusy(false); }
  }

  const timeZone = state?.settings?.timeZone ?? localDefaults().timeZone;
  const label = (value: string) => timeLabel(value, timeZone);
  const today = dateInZone(now, timeZone);
  const calendar = state?.settings?.calendar;
  const googleConfigured = !!globalThis.chrome?.runtime?.getManifest().oauth2?.client_id;
  const todayBreaks = state?.breaks.filter((item) => item.date === today && item.status !== "cancelled")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)) ?? [];
  const completed = todayBreaks.filter((item) => item.status === "completed");
  const active = state?.breaks.find((item) => item.status === "active");
  const exercise = EXERCISES.find((item) => item.id === active?.exerciseId);
  const nextBreak = todayBreaks.find((item) => ["planned", "ready"].includes(item.status));
  const nextExercise = EXERCISES.find((item) => item.id === nextBreak?.exerciseId);
  const remaining = active?.startedAt
    ? Math.max(0, Math.ceil((Date.parse(active.startedAt) + active.duration * MINUTE - now) / 1000)) : 0;
  const snapshot = state?.snapshot;
  const fresh = !state?.lastError && snapshotFresh(snapshot ?? null, now);
  const spaced = todayBreaks.some((item) => item.scheduleMode === "spaced" && ["planned", "ready"].includes(item.status));
  const onboarding = state !== null && state.settings === null;
  const minutes = completedMinutes(completed);
  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "long", month: "long", day: "numeric",
  }).format(now);

  function run(action: Action) { void act(action); }

  function changeMovement(patch: Partial<Pick<Settings, "goal" | "difficulty">>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      return { ...next, randomExerciseIds: exerciseOptions(next).map((item) => item.id) };
    });
  }

  function canChangeExercise(item: ExerciseBreak) {
    return !!state?.settings && exerciseChoices(state.settings).some((candidate) => candidate.id !== item.exerciseId);
  }

  function startLabel(item: ExerciseBreak) {
    if (Date.parse(item.scheduledAt) > now) return "Start early";
    return "Start now";
  }

  async function openCoach(id: string) {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`coach.html?id=${encodeURIComponent(id)}`) });
    } catch (reason) { setError(message(reason)); }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 40 40" focusable="false">
            <path d="M20 3.5 24.4 15.6 36.5 20l-12.1 4.4L20 36.5l-4.4-12.1L3.5 20l12.1-4.4L20 3.5Z" />
          </svg>
        </div>
        <div className="brand-copy">
          <h1>Exercise Snacks</h1>
          <p>Small moves. Room to breathe.</p>
        </div>
        <span className={`status-pill ${state?.settings?.enabled ? "is-on" : ""}`}>
          <span className="status-dot" aria-hidden="true" />
          {state?.settings?.enabled ? "Reminders on" : "Paused"}
        </span>
      </header>

      {(error || state?.lastError) && (
        <div role="alert" className="error-banner">
          <strong>{!error && spaced ? "Calendar check unavailable." : active && !error ? "Automatic reminders need attention." : "Couldn't finish that action."}</strong>
          <p>{error || state?.lastError}</p>
          {!error && spaced && <p>Time-based reminders continue. They may overlap meetings; snooze or skip whenever you need.</p>}
          <button className="text-button"
            disabled={busy || (!(onboarding || tab === "settings") && !state?.settings?.enabled)}
            onClick={() => run(onboarding || tab === "settings"
              ? { type: "settings", settings: draft } : { type: "refresh" })}>
            {onboarding || tab === "settings" ? "Save preferences" : "Try again"}
          </button>
        </div>
      )}
      {notice && <p role="status" className="notice-banner">{notice}</p>}
      {!state && !error && <p role="status" className="loading-message">Loading your local plan...</p>}

      {state && !onboarding && (
        <nav className="section-nav" aria-label="Extension sections">
          {(["today", "progress", "settings"] as const).map((name) => (
            <button key={name} aria-current={tab === name ? "page" : undefined}
              onClick={() => { setTab(name); if (name === "settings") setDraft(state.settings!); }}>
              {name === "today" ? "Today" : name === "progress" ? "Progress" : "Settings"}
            </button>
          ))}
        </nav>
      )}

      {state && (onboarding || tab === "settings") && (
        <section className="settings-view">
          <div className="view-heading">
            <h2>{onboarding ? "Make room for a little movement." : "Your settings"}</h2>
            <p>{onboarding
              ? "Choose your pace. A calendar is optional."
              : "Shape the pace around your day. Change anything whenever you like."}</p>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); run({ type: "settings", settings: draft }); }}>
            <fieldset disabled={busy}>
              <label>Calendar source
                <select value={draft.calendar?.type ?? ""}
                  onChange={(event) => setDraft({ ...draft, calendar: event.target.value === "google"
                    ? { type: "google" } : event.target.value === "bookings" ? { type: "bookings", url: "" } : null })}>
                  <option value="">No calendar · evenly spaced reminders</option>
                  <option value="bookings">Microsoft personal Bookings</option>
                  <option value="google">Google Calendar / Gmail</option>
                </select>
              </label>
              <p className="field-note">Reminders are spread through your workday. Add a calendar to look for free gaps; if there aren't enough, time-based reminders fill the remaining spots and may overlap meetings.</p>
              {draft.calendar?.type === "bookings" && <>
                <label>Public Bookings meeting-type link
                  <input required type="url" placeholder="https://bookings.cloud.microsoft/bookwithme/..."
                    value={draft.calendar.url}
                    onChange={(event) => setDraft({ ...draft, calendar: { type: "bookings", url: event.target.value } })} />
                </label>
                <p className="field-note">Microsoft 365 personal Bookings / Bookings with me only. Not a shared team booking page. <a
                  href="https://learn.microsoft.com/microsoft-365/bookings/create-new-meeting-type"
                  target="_blank" rel="noreferrer">Create a public meeting type</a>, then copy its link.</p>
              </>}
              {draft.calendar?.type === "google" && <div className="privacy-note">
                <strong>Your primary Google calendar only.</strong>
                <p>Read-only free/busy access, not Gmail messages or event details. Secondary and shared calendars are not checked.</p>
                {!googleConfigured && <p>Google sign-in is not configured in this build. Follow the Google Calendar setup in the README, then rebuild and reload the extension.</p>}
                <div className="button-row">
                  <button type="button" className="secondary-button" disabled={!googleConfigured}
                    onClick={() => run({ type: "connect-google" })}>Connect Google Calendar</button>
                  <button type="button" className="text-button" disabled={!googleConfigured}
                    onClick={() => run({ type: "disconnect-google" })}>Disconnect Google</button>
                </div>
                <p className="field-note">Google sign-in is intended for Chrome. Your account or administrator may restrict consent.</p>
              </div>}
              <label>Time zone
                <input required list="time-zones" value={draft.timeZone}
                  onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })} />
                <datalist id="time-zones">
                  {[...new Set([localDefaults().timeZone, "UTC", "America/New_York", "America/Chicago", "America/Denver",
                    "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"])]
                    .map((zone) => <option key={zone} value={zone} />)}
                </datalist>
              </label>
              <p className="field-note">Work hours, reminder times, and daily totals use this IANA time zone.</p>
              {draft.difficulty !== "challenging" && <label>What would feel useful?
                <select value={draft.goal} onChange={(event) => changeMovement({ goal: event.target.value as Settings["goal"] })}>
                  <option value="energy">More movement in my day</option>
                  <option value="mobility">A gentle posture reset</option>
                </select>
              </label>}
              <div className="form-grid">
                <label>Movement style
                  <select value={draft.difficulty} onChange={(event) => changeMovement({ difficulty: event.target.value as Settings["difficulty"] })}>
                    <option value="gentle">Gentle / seated-friendly</option>
                    <option value="steady">Easy standing / walking</option>
                    <option value="challenging">Challenging / strength & cardio</option>
                  </select>
                </label>
                <label>Break length
                  <select value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) as Settings["duration"] })}>
                    {[2, 3, 5].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                  </select>
                </label>
              </div>
              {draft.difficulty === "challenging" && <p className="field-note">
                Squats, push-ups, lunges, planks, mountain climbers, and jumping jacks. Use short sets with rest; the timer is your break window, not a nonstop workout. Choose a gentler style if needed.
              </p>}
              <label>Exercise selection
                <select value={draft.selection}
                  onChange={(event) => setDraft({ ...draft, selection: event.target.value as Settings["selection"] })}>
                  <option value="suggested">Suggested exercise</option>
                  <option value="random">Pick randomly from my set</option>
                </select>
              </label>
              {draft.selection === "random" && <fieldset className="exercise-pool" aria-describedby="exercise-pool-help">
                <legend>Your exercise set</legend>
                <p id="exercise-pool-help" className="field-note">Choose one to use every time, or several for a random mix. No back-to-back repeats when possible.</p>
                {exerciseOptions(draft).map((item) => <label className="checkbox-field" key={item.id}>
                  <input type="checkbox" checked={draft.randomExerciseIds.includes(item.id)}
                    onChange={(event) => setDraft({ ...draft, randomExerciseIds: event.target.checked
                      ? [...draft.randomExerciseIds, item.id]
                      : draft.randomExerciseIds.filter((id) => id !== item.id) })} />
                  <span>{item.name}</span>
                </label>)}
              </fieldset>}
              <label>Daily intention
                <select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: Number(event.target.value) as Settings["frequency"] })}>
                  <option value="2">2 exercise snacks</option>
                  <option value="3">3 exercise snacks</option>
                </select>
              </label>
              <div className="form-grid">
                <label>Workday starts
                  <input required type="time" value={draft.workStart}
                    onChange={(event) => setDraft({ ...draft, workStart: event.target.value })} />
                </label>
                <label>Workday ends
                  <input required type="time" value={draft.workEnd}
                    onChange={(event) => setDraft({ ...draft, workEnd: event.target.value })} />
                </label>
              </div>
              <p className="field-note">Weekdays only in your chosen time zone.</p>
              <label className="checkbox-field">
                <input type="checkbox" checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
                <span>Enable local reminders (check availability when connected)</span>
              </label>
              <div className="privacy-note">
                <strong>Your calendar. Your device.</strong>
                <p>Bookings uses anonymous read-only requests; Google requires your permission to read availability. Preferences, your calendar-source settings, and exercise history stay in this browser. No Graph access, bookings, or app analytics.</p>
              </div>
              <button className="primary-button save-button" type="submit">
                {busy ? "Saving your plan..." : onboarding ? "Save & plan my day" : "Save preferences & replan"}
              </button>
            </fieldset>
          </form>

          {!onboarding && <div className="settings-tools">
            <h3>Notifications & data</h3>
            <p>Keep Chrome or Edge running, and allow notifications in your browser and device settings.</p>
            <button className="secondary-button" disabled={busy}
              onClick={() => run({ type: "test-notification" })}>Test desktop notification</button>
            {!confirmReset
              ? <button className="text-button danger-button-link" onClick={() => setConfirmReset(true)}>Delete all local data</button>
              : <div className="reset-confirmation">
                <p>Delete your settings, plan, and entire exercise history? This cannot be undone.</p>
                <div className="button-row">
                  <button className="danger-button" disabled={busy} onClick={() => run({ type: "reset" })}>Delete everything</button>
                  <button className="secondary-button" onClick={() => setConfirmReset(false)}>Keep my data</button>
                </div>
              </div>}
          </div>}
        </section>
      )}

      {state && !onboarding && tab === "today" && <>
        <div className="day-toolbar">
          <p>{dayLabel}</p>
          <button className="refresh-button" disabled={busy || !state.settings?.enabled}
            onClick={() => run({ type: "refresh" })}>
            <svg aria-hidden="true" viewBox="0 0 20 20" className="refresh-icon">
              <path d="M16.4 8.2A6.5 6.5 0 0 0 4.8 5.5L3.2 7.1M3.3 3.8v3.5h3.5M3.6 11.8a6.5 6.5 0 0 0 11.6 2.7l1.6-1.6m-.1 3.3v-3.5h-3.5" />
            </svg>{busy ? "Checking" : "Refresh"}
          </button>
        </div>

        {active && exercise ? (
          <section className="move-hero active-hero" aria-label="Active exercise">
            <div className="hero-heading">
              <p className="hero-kicker">YOUR TIME, YOUR PACE</p>
              <span className="hero-spark" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="m12 1.8 2.2 7.9 7.9 2.3-7.9 2.2-2.2 8-2.3-8-7.9-2.2 7.9-2.3L12 1.8Z" /></svg>
              </span>
            </div>
            <h2>{exercise.name}</h2>
            <p className="exercise-instruction">{exercise.instruction}</p>
            <div className="timer-wrap">
              <span className="timer-label">TIME LEFT</span>
              <span className="timer" role="timer" aria-label="Time remaining">
                {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
              </span>
            </div>
            <p className="comfort-note">Choose comfortable movement. Stop if anything feels uncomfortable. The timer continues if you close this window.</p>
            <div className="hero-actions">
              <button className="primary-button" disabled={busy || remaining > 0}
                onClick={() => run({ type: "complete", id: active.id })}>
                {remaining > 0 ? "Take your time" : "Complete exercise"}
              </button>
              {active.exerciseId === "squats" && <button className="hero-text-button" disabled={busy}
                onClick={() => { void openCoach(active.id); }}>Count with camera / manually</button>}
              <button className="hero-text-button" disabled={busy}
                onClick={() => run({ type: "skip", id: active.id })}>End without logging</button>
            </div>
          </section>
        ) : nextBreak && nextExercise ? (
          <section className="move-hero" aria-labelledby="next-move-title">
            <div className="hero-heading">
              <h2 id="next-move-title">Your next move</h2>
              <span className="hero-spark" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="m12 1.8 2.2 7.9 7.9 2.3-7.9 2.2-2.2 8-2.3-8-7.9-2.2 7.9-2.3L12 1.8Z" /></svg>
              </span>
            </div>
            <div className="hero-time">
              <span>{label(nextBreak.scheduledAt)}</span>
              <span aria-hidden="true">·</span>
              <span>{nextBreak.duration} min</span>
              <span aria-hidden="true">·</span>
              <span>{nextBreak.scheduleMode === "spaced" ? "Time-based reminder" : nextBreak.status === "ready" ? "Ready when you are" : "A little space to reset"}</span>
            </div>
            <h3 className="hero-exercise-name">{nextExercise.name}</h3>
            <p className="exercise-instruction">{nextExercise.instruction}</p>
            {nextBreak.scheduleMode === "spaced" && <p className="comfort-note">Not a verified free slot. Snooze or skip if you're busy.</p>}
            <button className="primary-button hero-primary" disabled={busy || !!active}
              onClick={() => run({ type: "start-early", id: nextBreak.id })}>
              {startLabel(nextBreak)}
            </button>
            <p className="comfort-note">No calendar check. Starting now replaces this reminder.</p>
            <div className="hero-alternatives" aria-label="Other choices">
              <button className="hero-text-button" disabled={busy || !canChangeExercise(nextBreak)}
                title={!canChangeExercise(nextBreak) ? "Add another exercise in Settings to switch" : undefined}
                onClick={() => run({ type: "different", id: nextBreak.id })}>Different exercise</button>
              <button className="hero-text-button" disabled={busy || nextBreak.snoozes >= 2 || !state.settings?.enabled}
                onClick={() => run({ type: "snooze", id: nextBreak.id })}>Snooze 15m+</button>
              <button className="hero-text-button" disabled={busy}
                onClick={() => run({ type: "skip", id: nextBreak.id })}>Skip</button>
            </div>
          </section>
        ) : (
          <section className="no-opening" aria-live="polite">
            <span className="rest-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="m12 1.8 2.2 7.9 7.9 2.3-7.9 2.2-2.2 8-2.3-8-7.9-2.2 7.9-2.3L12 1.8Z" /></svg>
            </span>
            <h2>{completed.length > 0 ? "You made a little room today." : "No more reminders planned."}</h2>
            <p>{completed.length > 0
              ? `${completed.length} ${completed.length === 1 ? "snack" : "snacks"} complete. Let the rest of the day unfold.`
              : "There may not be enough workday left to keep reminders comfortably spaced. I'll plan again on the next weekday."}</p>
            <button className="secondary-button" disabled={busy || !state.settings?.enabled}
              onClick={() => run({ type: "refresh" })}>{busy ? "Planning..." : "Refresh plan"}</button>
          </section>
        )}

        {!calendar && <div className="calendar-prompt">
          <p>Reminders are spaced through your workday. A calendar helps find free gaps.</p>
          <button className="text-button" onClick={() => { setDraft(state.settings!); setTab("settings"); }}>Set up calendar</button>
        </div>}

        {!state.settings?.enabled && <p className="paused-note">Reminders are paused. Turn them on in Settings whenever you're ready.</p>}

        <section className="momentum-section" aria-label="Today's progress">
          <div className="momentum-heading">
            <h2>Daily momentum</h2>
            <span>{completed.length} of {state.settings?.frequency} done</span>
          </div>
          <div className="momentum-track" role="img"
            aria-label={`${completed.length} of ${state.settings?.frequency} exercise snacks completed`}>
            {Array.from({ length: state.settings?.frequency ?? 3 }, (_, index) => (
              <span key={index} className={index < completed.length ? "is-complete" : ""} />
            ))}
          </div>
          <p>{minutes > 0
            ? `${minutes} minutes made for you. Every bit counts.`
            : "No streaks. No score. Just a little room when it fits."}</p>
        </section>

        {todayBreaks.filter((item) => item.id !== nextBreak?.id && item.status !== "completed").length > 0 && (
          <section className="later-section">
            <h2>Later today</h2>
            {todayBreaks.filter((item) => item.id !== nextBreak?.id && item.status !== "completed").map((item) => {
              const name = EXERCISES.find((candidate) => candidate.id === item.exerciseId)?.name ?? "Exercise snack";
              const actionable = item.status === "planned" || item.status === "ready";
              return <article className={`later-row ${item.status}`} key={item.id}>
                <div className="later-summary">
                  <span className="later-time">{label(item.scheduledAt)}</span>
                  <span className="later-name">{name}</span>
                  <span className="later-duration">{item.duration} min</span>
                </div>
                {actionable && item.scheduleMode === "spaced" && <p className="field-note">Time-based · not a verified free slot</p>}
                {actionable && <div className="later-actions">
                  <button className="text-button" disabled={busy || !!active}
                    onClick={() => run({ type: "start-early", id: item.id })}>
                    {now < Date.parse(item.scheduledAt) ? "Start early" : "Start now"}
                  </button>
                  <button className="text-button" disabled={busy || !canChangeExercise(item)}
                    title={!canChangeExercise(item) ? "Add another exercise in Settings to switch" : undefined}
                    onClick={() => run({ type: "different", id: item.id })}>Different</button>
                  <button className="text-button" disabled={busy || item.snoozes >= 2 || !state.settings?.enabled}
                    onClick={() => run({ type: "snooze", id: item.id })}>Snooze</button>
                  <button className="text-button" disabled={busy}
                    onClick={() => run({ type: "skip", id: item.id })}>Skip</button>
                </div>}
              </article>;
            })}
          </section>
        )}

        <section className="availability-section">
          <div className="availability-status">
            <span className={`status-pill ${calendar && fresh ? "is-on" : ""}`}>
              <span className="status-dot" aria-hidden="true" />{!calendar ? "No calendar" : fresh ? "Fresh snapshot" : "Refresh needed"}
            </span>
            <span>{!calendar ? "Evenly spaced reminders" : snapshot?.date === today ? `${snapshot.available.length} available windows${spaced ? " · time-based fallback" : ""}` : "Calendar availability"}</span>
            <button className="text-button" disabled={busy || !state.settings?.enabled}
              onClick={() => run({ type: "refresh" })}>Refresh</button>
          </div>
          <details className="availability-details">
            <summary>About your availability</summary>
            <p>{!calendar ? "Your calendar isn't connected. Reminders use only your work hours, not free/busy data. Set up a calendar in Settings whenever you're ready."
              : calendar.type === "google"
              ? "Free/busy from your primary Google Calendar only. Secondary or shared calendars are not checked. No appointments are created."
              : "Published personal Bookings availability, not your complete work calendar. Booking rules may hide otherwise free time. No appointments are created."}</p>
            {snapshot?.date === today && <>
              {snapshot.available.length > 0
                ? <ul className="window-list">{snapshot.available.map((slot) => (
                  <li key={slot.start}>{label(slot.start)} – {label(slot.end)}</li>
                ))}</ul>
                : <p>No verified available windows were returned for today.</p>}
              <p className="field-note">Updated {label(snapshot.fetchedAt)} · {timeZone}. Calendar-based reminders recheck availability. Time-based reminders aren't verified free slots and may overlap meetings.</p>
            </>}
            {calendar?.type === "bookings" && <a href={calendar.url} target="_blank" rel="noreferrer">Open your Bookings page</a>}
            {calendar?.type === "google" && <a href="https://calendar.google.com/" target="_blank" rel="noreferrer">Open Google Calendar</a>}
          </details>
        </section>
      </>}

      {state && !onboarding && tab === "progress" && (
        <section className="progress-view">
          <div className="view-heading">
            <h2>Your last seven days</h2>
            <p>Small things add up, with no streaks or score to keep up with.</p>
          </div>
          <div className="history-list">
            {Array.from({ length: 7 }, (_, index) => {
              const date = new Date(Date.parse(`${today}T12:00:00Z`) - index * 86_400_000).toISOString().slice(0, 10);
              const done = state.breaks.filter((item) => item.date === date && item.status === "completed");
              return <div className="history-row" key={date}>
                <span>{date === today ? "Today" : new Intl.DateTimeFormat("en-US", {
                  timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
                }).format(new Date(`${date}T12:00:00Z`))}</span>
                <span>{done.length} {done.length === 1 ? "snack" : "snacks"}</span>
                <strong>{completedMinutes(done)} min</strong>
              </div>;
            })}
          </div>
          {state.breaks.some((item) => item.status === "completed" && item.reps) && <section className="rep-history">
            <h3>Recent counted sets</h3>
            {state.breaks.filter((item) => item.status === "completed" && item.reps).slice(-7).reverse().map((item) => (
              <p key={item.id}>
                {item.date} · {item.reps!.completedReps}/{item.reps!.targetReps} squats · {item.reps!.countingMode === "camera" ? "Camera-assisted estimate" : "Manual count"}
                {item.reps!.manualAdjustment !== 0 ? ` (${item.reps!.manualAdjustment > 0 ? "+" : ""}${item.reps!.manualAdjustment} adjusted)` : ""}
              </p>
            ))}
          </section>}
          <p className="history-total">All-time: {state.breaks.filter((item) => item.status === "completed").length} completed snacks. History stays in this browser until you delete it.</p>
          <button className="secondary-button" onClick={() => setTab("today")}>Back to today</button>
        </section>
      )}

      <footer className="app-footer">
        <span>Local-first. Read-only availability. No guilt.</span>
        <span>Keep your browser open for reminders · {timeZone}</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
