# Exercise Snacks: technical README

For the product overview, research inspiration, screenshots, and quick install,
see the [main README](README.md).

A local Chrome/Edge Manifest V3 extension that spaces short exercise reminders
through your workday, optionally using **Microsoft personal Bookings / Bookings with me** availability. Supply your
own public meeting-type link; no person's calendar identifiers are bundled.
Bookings needs no Azure subscription, Graph consent, client secret, or sign-in.

An optional **Google Calendar** provider supports Gmail users' primary calendar
through read-only OAuth. It requires the Google setup below; the default build
does not include a configured Google OAuth client. This is Calendar access,
not access to Gmail messages.

## Install locally from a ZIP

**No Node.js or build tools are needed.** Chrome/Edge 120 or later is required.

Camera Coach requires **v0.3.0 or later**. Manual starts without calendar checks
require **v0.3.1 or later**. Check the release version before downloading; use the
source-build instructions if that version has not been published yet.
Use **v0.3.2 or later** for the corrected squat-angle calculation.
Use **v0.3.3 or later** for front-view standing recognition, near-edge ankle
tracking, shorter squats, and rejection of floor movements.
Use **v0.3.4 or later** for squats with forward lean and a foreshortened torso.
Use **v0.3.5 or later** for calendar-optional, evenly spaced reminders.

1. Open the [latest release](https://github.com/jfilcik/exercise-snacks/releases/latest)
   and download the **`exercise-snacks.zip`** asset. Do not choose GitHub's
   automatically generated **Source code (zip)**; that contains unbuilt source.
   If the repository is private, sign in with a GitHub account that has access.
2. Extract the ZIP into a permanent folder, such as
   `C:\Apps\ExerciseSnacks`. Do not load the ZIP itself or delete/move the
   extracted folder afterward.
3. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**,
   choose **Load unpacked**, and select the extracted folder that directly
   contains `manifest.json`. Pin Exercise Snacks to your toolbar.
4. Open Exercise Snacks. Keep **No calendar** for evenly spaced reminders, or choose
   **Microsoft personal Bookings** and paste your public meeting-type link.
   Confirm your IANA time zone (initially your browser's zone).
   Choose your goal, movement level, duration (2, 3, or 5
   minutes), frequency (2 or 3 per day), and weekday work hours.
5. Leave reminders enabled and choose **Save & plan my day**. This explicitly
   enables reminders and, if configured, read-only requests to your selected source.
6. In **Settings**, use **Test desktop notification**. Allow notifications in your
   browser and OS settings; Do Not Disturb/Focus Assist may hide them.

Keep the browser running for reminders. The popup does not need to remain open.
There is no hosted backend, so this is not a standalone desktop app.

### Update an existing installation

Download and extract the new release into the **same permanent folder**,
replacing its files, then click **Reload** on Exercise Snacks at the browser's
extensions page. Do not remove/reinstall the extension if you want to keep its
preferences and history. Reopening the popup alone may leave an older background
worker running.

### Build from source instead

With Node.js 22.18+ installed, download/extract GitHub's source ZIP or clone this
repository. In that folder, run:

```powershell
npm ci
npm run build
```

Then follow the installation steps above, selecting the generated `dist`
folder at **Load unpacked**. `dist` is not tracked in the source repository.
For Google OAuth, follow the Google setup section below before building.
The standard ZIP supports calendar-free reminders and Bookings, and has no Google identity permission.

No personal calendar is bundled. A saved install without a calendar can use
time-based reminders; an explicitly paused install stays paused. Exercise history
is preserved. A popup/worker version mismatch tells you to reload, and
invalid settings identify the specific field (including reversed AM/PM times).

## Screenshots

These screenshots show the calendar-free Today plan and exercise settings using
synthetic demo reminders; no personal calendar or account data is displayed.
`desktop-demo.png` is a composed browser-window illustration around the real,
synthetic Today screenshot; the background browser page is not part of the app.

![Exercise Snacks Today in a clean, full-screen browser context](docs/screenshots/desktop-demo.png)

![Settings view showing optional calendar selection, time zone, exercise choices, and local reminder options](docs/screenshots/settings.png)

Camera Coach opens in its own tab. This is the camera-off setup screen, not an
image of a person or evidence of counting accuracy.

![Camera Coach setup with an optional camera, squat target, rep counter, adjustments, and a manual alternative](docs/screenshots/camera-coach.png)

## Daily flow

- **Today** shows up to three exercise reminders, at least an hour apart, inside
  your chosen work hours. Verified calendar gaps are preferred. Without a calendar,
  when it cannot be checked, or when there are too few gaps, the remaining reminders
  are spread across the remaining workday and labeled **Time-based**. These are
  not verified free slots and may overlap meetings. Calendar failures remain visible;
  failed or missing responses are never interpreted as free/busy data.
- Click a reminder to open the app, then **Start now**. The persisted timer continues
  if you close the popup. **Complete exercise** becomes available when it ends.
- Want to move now? Choose **Start early** (or **Start now** once due) on one of
  today's planned snacks. This is a manual choice: **no calendar request or
  free/busy check**, even if availability is busy, stale, missing or offline.
  Work hours and the reminder toggle do not block an existing planned snack.
  It moves that same snack to now and removes its original alarm, without
  creating extra credit. Finish or end an active exercise before starting another.
  Nearby pending reminders are removed and replanned, using a fresh snapshot when
  available and time-based reminders otherwise, to preserve one-hour spacing.
  A previous calendar error is cleared for the manual start and its snapshot
  discarded; any time-based reminders are still explicitly distinguished from
  calendar-based reminders.
- Use the notification's **Start** button to begin immediately, or **Snooze** to
  move it at least fifteen minutes after its scheduled time. Calendar-based snacks
  need a verified gap; time-based snacks need only fit the workday and spacing.
  Each break allows two snoozes. Clicking the notification body opens
  the app, where you can also choose Start, Snooze, or **Skip**.
- **Skip** dismisses a break without logging exercise or adding a replacement.
- **Progress** shows seven days of completed snacks/minutes and an all-time
  completion count. History survives browser restarts.
- Disable reminders in **Settings** to cancel upcoming alarms. An active exercise
  can still be completed. **Delete all local data** has a confirmation step and
  removes preferences, availability, and all history.

All displayed times, work hours, calendar-day boundaries, and daily totals use
your selected IANA time zone, including daylight-saving changes. Bookings'
Windows zones are mapped using Unicode CLDR data, not a fixed UTC offset.
Scheduling is weekday-only. Short remaining workdays can yield fewer than the goal.
Skipped, missed, active, and completed snacks still consume the daily budget.
Refreshing does not repeatedly move existing time-based reminders.

## Exercise options

In **Settings → Movement style**, choose gentle/seated-friendly movement, easy
standing/walking, or the opt-in **Challenging / strength & cardio** set:
bodyweight squats, push-ups, reverse lunges, planks, mountain climbers, and
jumping jacks. Gentle remains the default. Challenging uses its own strength
and cardio set rather than the gentle energy/mobility goal.

Choose **Exercise selection → Pick randomly from my set**, then check the
exercises you want included. Select one to use it every time, or several for a
random mix. Picks are made when planning and saved with each break, so opening
the popup or refreshing availability does not reshuffle an existing snack.
**Different exercise** stays within your set and avoids the current choice.

Challenging instructions use short sets and rests; the 2–5 minute timer is the
break window, not a requirement for continuous exercise. Use the suggested
modifications, choose comfortable movement, and stop if anything feels
uncomfortable.

## Camera Coach: optional squat counts

**Experimental, squats only.** Automatic counts are estimates, not certified
proof that you exercised or used correct form. Push-ups and other movements
continue to use the normal timer. Camera Coach is off by default and is never
required to complete a snack.

1. In Settings, choose the challenging movement style and include **Bodyweight
   squats** in your exercise set.
2. Start a squat snack, including with **Start early**, then choose
   **Count with camera / manually** in the active exercise.
3. In the dedicated Camera Coach tab, pick a comfortable rep target. Choose
   **Enable camera counting** and allow the browser's camera prompt, or choose
   **Count manually · no camera**. Opening the page alone does not request access.
4. Use good lighting and a clear space. Keep your whole body, including head and
   feet, in view, side-on or at a three-quarter angle. Stand still first. The
   mirrored preview and optional body skeleton help with framing. Wait until the
   cue says **Ready** before starting; a visible skeleton alone is not readiness.
5. A stable down-and-up squat adds a rep. A brief tracking flicker freezes the
   count; sustained tracking loss discards the unfinished rep. Stand upright
   again to resume. Floor movements pause squat counting. Never squat deeper
   just to trigger the detector. Choose manual counting whenever it suits you.
6. **Pause**, **Stop counting**, or reaching your target turns the camera off.
   Hiding/closing the tab also stops it. If access fails or a webcam disconnects,
   your count remains in the open page; retry or switch to manual counting.
7. Correct estimates with **+1 / -1**, then **Save**. You can finish below your
   target without waiting for the normal break timer. **Progress** shows counted
   sets, target, actual count, counting mode and adjustments.

Only the summary is stored locally: exercise, target, count, automatic estimate,
manual adjustment, counting mode, completion time, and elapsed break time capped
at the planned break window. Setup/rest/pauses are part of that window, not a
claim of continuous exertion. Saving a counted set replaces the same snack's
timer completion; it does not add a second snack. Unsaved counts remain only
in the open tab, so save before leaving. **Use the normal timer** and
**End without logging** are always available.

Frames, images, face information and landmark sequences are **never recorded,
persisted or uploaded**. Audio is disabled. MediaPipe JavaScript, the model and
WASM are bundled inside the extension; inference works without a network
connection after installation. Camera Coach's own content policy also prevents
external connections. Calendar refresh still needs the normal network access.
The browser/OS may block camera access; the manual counter needs no permission.

The counter uses confidence/framing checks, time-based smoothed knee angles from
MediaPipe's metric 3D world joints (not normalized image depth), an upright-torso
check, and calibrated image-space hip descent/return. Standing estimates vary by
viewpoint, so a fixed 160-degree knee angle is not required. Standing needs
200 ms of stability; descent needs 150 ms with separate entry/exit thresholds
so a continuous squat does not require holding the bottom position. Visible
ankles near the image edge are accepted, but offscreen joints are not.
Floor detection uses the shoulder-to-ankle body axis, not torso lean alone.
Once calibrated, the standing torso size remains the scale reference throughout
a rep; a temporarily foreshortened torso does not discard it.
Tracking uncertainty freezes counting for up to 250 ms, then resets calibration;
missing/invalid world geometry, floor movement, explicit pauses and long frame
gaps reset immediately. A cooldown prevents duplicate reps. These are engineering
heuristics, not universal movement or fitness standards. Inference is throttled
to at most 12 FPS on the CPU; actual speed depends on your device. It runs in the
visible page rather than the background worker or popup.
Short repetitions can still be missed when frames are dropped or inference is
slow. Check the estimate and use the manual corrections when needed.

The design follows the general hysteresis and body-size normalization principles
in Google's Apache-2.0 [repetition counter](https://github.com/googlesamples/mlkit/blob/master/android/vision-quickstart/app/src/main/java/com/google/mlkit/vision/demo/java/posedetector/classification/RepetitionCounter.java)
and [pose embedding](https://github.com/googlesamples/mlkit/blob/master/android/vision-quickstart/app/src/main/java/com/google/mlkit/vision/demo/java/posedetector/classification/PoseEmbedding.java)
samples. Google's counter uses classifier-confidence entry/exit thresholds
(6 and 4), not universal joint-angle thresholds; its full classifier needs
representative training data. [LearnOpenCV's squat-analysis example](https://github.com/spmallick/learnopencv/tree/master/AI-Fitness-Trainer-Using-MediaPipe-Analyzing-Squats)
is another reference for a threshold/state-machine approach, but assumes a
side view and uses different angle definitions. These are references, not
drop-in dependencies: no code or datasets from them are bundled here.

### Test Camera Coach locally

Run `npm run dev:camera`, then open
`http://localhost:5175/camera-preview.html?id=camera-preview-squat` in Chrome/Edge.
This development-only page starts a synthetic active squat without a calendar
or extension installation. It runs the same camera and counter code, requests
camera access only after **Enable camera counting**, and keeps test summaries
only in memory. Reloading resets the test. It is not included in the extension
build or ZIP. If an embedded browser cannot grant camera permission, open the URL
in your normal Chrome/Edge window.

Run `npm run test:camera` for the recorded-motion regression. It feeds a
checksum-verified, real two-squat recording through the **built extension's**
640x480 camera-input stream, bundled model/WASM, counter, UI, and summary storage,
with no manual rep additions. The browser test runs offline, never opens your
webcam or calendar, and requires exactly **2 automatic reps** with no correction.
The first run downloads the fixture into the ignored `.camera-cache` directory.
The fixture is PDI Student's [Agachamento.gif](https://commons.wikimedia.org/wiki/File:Agachamento.gif),
licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/);
tests decode and letterbox its frames. The original recording is not bundled
with the extension.

#### Private recording regression

Explicitly prepared private fixtures run automatically with `npm test` on
this checkout. It replays the full body-joint time series, checks the annotated
front/side and shorter-squat segments, tests lower effective frame rates, and
requires zero squat credit for floor transitions and push-ups. Each fixture's
eight representative JPEGs and review contact sheet have timestamp/checksum checks.
The explicit private camera command also runs those eight images through the
bundled model and verifies standing, leaning squats, and non-squat floor frames;
cropped or untracked floor images must not establish squat readiness.
Still images alone do not prove temporal counting, so the dense motion trace is
preserved alongside them.
Full-rate replay requires the exact annotated count. Deliberately undersampled
traces allow at most one missed short rep and no extra credit; this is not a
claim of exact detection on slower devices.

Private fixtures live only in `.private-camera-fixtures`, which is Git-ignored,
blocked by the development server, and excluded from builds and install ZIPs.
This explicit offline test preparation is separate from the production camera,
which never saves frames or motion traces. No original MP4 is copied into the
project. On other checkouts without this private fixture, `npm test` reports
an explicit skip rather than claiming that recording passed.

To recheck the prepared fixture through the built extension's actual camera,
model, counter, UI, and summary storage, run:

```powershell
npm run test:camera:private -- "C:\path\to\your-recording.mp4"
```

The test verifies the original recording's checksum, supplies its video frames
instead of opening a webcam, runs offline, and requires exact automatic counts
at each annotated segment boundary with no manual corrections. Omitting the
MP4 runs the private motion/image tests and explicitly skips the camera-stream
test. The explicit private command fails if the prepared fixture is missing.

Use a separate fixture directory for a second recording instead of overwriting
the first. Set `$env:PRIVATE_CAMERA_FIXTURE = "alternate-squats"` before either
the preparation or private-test command to select it; the default is
`squat-pushup`. Default unit tests discover all prepared private fixture folders.
Keep fixture names generic and do not put people's names in tracked tests.

To prepare another user-authorized recording, run
`node scripts/prepare-private-camera.mjs --inspect "C:\path\to\recording.mp4"`
to review local frames. Create the private `expected.json` with visually reviewed
`expectedSquats`, `segments` (`name`, `startSeconds`, `endSeconds`, `squats`),
`floorWindowSeconds` (a fully horizontal floor-exercise interval),
eight `representatives` (`file`, `timeSeconds`, `pose`: `standing`, `squat` or `floor`), and optional
`squatReviewSeconds`. Rerun inspection to save those representative images,
then run the same preparation command without `--inspect` to infer the complete
12 FPS body-pose trace. Never derive expected rep counts from the detector's
output, commit private media, or use recordings without permission.

**Real-person accuracy and performance targets are not validated.** The planned
five-person Windows/Mac webcam evaluation, ±1 rep per ten clear reps, startup
under five seconds, and feedback-latency targets have not been demonstrated.
Automatic push-up counts and form-quality feedback are not included.
Passing a recorded-motion regression is not a substitute for that evaluation.

## Microsoft 365 Enterprise: set up personal Bookings

This integration is specifically for **Microsoft personal Bookings**, also called
**Bookings with me**, not Shared Bookings/team booking pages or arbitrary Outlook
calendar links.

Your assigned Microsoft 365/Office 365 license must include Bookings, and your
administrator must allow the feature and publishing a public meeting type.
Microsoft's [Bookings overview and eligible plans](https://learn.microsoft.com/microsoft-365/bookings/bookings-overview)
include Enterprise E1, E3, and E5 offerings; an Azure subscription by itself does
not provide this capability. Follow your organization's publishing and
data-access policies.

1. Open [Microsoft Bookings](https://book.ms), or open the Bookings app in
   Outlook/Teams and choose your **Personal booking page**.
2. [Create or edit a meeting type](https://learn.microsoft.com/microsoft-365/bookings/create-new-meeting-type).
   Set it to **Public**, choose the appropriate schedule/availability, and save.
3. Use the meeting type's menu to **Copy link**. The supported form is
   `https://bookings.cloud.microsoft/bookwithme/user/<mailbox>/meetingtype/<id>`.
   The equivalent `outlook.office.com/bookwithme/...` form is normalized.
   Copy the specific meeting-type link, not the general landing page.
4. Verify that link is available to an anonymous guest in a signed-out window.
   Private, single-use, or sign-in-required types are not supported. Do not
   weaken a required workplace restriction to make the extension work.
5. Paste it into the extension's **Public Bookings meeting-type link** field,
   choose your time zone and work hours, and save.

See Microsoft's [Personal Bookings FAQ](https://learn.microsoft.com/microsoft-365/bookings/personal-bookings-faq)
for the distinction from Shared Bookings, licensing, public/private types,
and organizational controls.

### How the Bookings source works

The adapter validates the supplied link, resolves its domain using Microsoft's
public tenant-discovery metadata, reads public business/service metadata,
and makes the read-only `getStaffAvailability` request used by the anonymous
personal Bookings web app. Mailbox/tenant/meeting-type/service IDs come from your
link or these responses. The staff marker is a shared personal-Bookings protocol
constant, not a person's identifier.

Requests use `credentials: "omit"`, no tokens, and explicit host permissions for
`bookings.cloud.microsoft` and `login.microsoftonline.com`. The latter retrieves
public discovery metadata; it does not sign you in. The extension never submits
bookings, accesses Graph, retrieves event subjects/attendees, or uses signed-in
Outlook credentials.

**Published availability is not a complete calendar.** Booking policies can hide
otherwise free time. The underlying published intervals can also include gaps
too short to book a 30-minute meeting. Calendar-based reminders use only explicitly
`AVAILABLE` intervals, subtract overlapping busy/unknown statuses, and apply
your own work hours. It never infers free time from missing data or treats every
non-bookable time as a meeting.

These are **undocumented Bookings web-app endpoints**, not a supported Graph
API contract. They worked anonymously during implementation but can change or
be restricted. Changed privacy settings, time zones, missing day coverage,
malformed responses, redirects, HTTP errors, or network failures stop availability
use and show an error/badge rather than guess. Future time-based reminders can
continue without asserting calendar availability.
You can change your source link in Settings. Support for every tenant and
meeting-type configuration has not been demonstrated; unsupported responses fail
explicitly. This adapter does not bypass tenant policy.

## Google Calendar setup (optional, Chrome)

**Status:** the provider, connection controls, and error handling are implemented
and tested with fixtures. A live Google account sign-in/free-busy call has **not**
been verified in this workspace because no OAuth client or account consent was
provided. The default build disables Connect rather than pretending it is ready.

Google Calendar requires its own OAuth consent; Microsoft Bookings does not.
Only the selected Chrome profile account's **primary calendar** is queried.
Secondary/shared calendars, Gmail messages, event titles, attendees, and event
descriptions are not read. Google sign-in is intended for Chrome; it has not
been verified in Edge.

1. In [Google Cloud Console](https://console.cloud.google.com/), select or create
   a project and enable the **Google Calendar API**.
2. Configure the Google Auth Platform consent screen/audience. For a personal
   Gmail account, use an external audience and add your account as a test user
   while the app is in testing. Request only
   `https://www.googleapis.com/auth/calendar.freebusy`.
3. Choose a stable extension identity **before** creating its OAuth client:
   for one local install, load `dist` and copy its ID from `chrome://extensions`.
   For distribution, follow Chrome's
   [OAuth tutorial and stable extension-ID guidance](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth):
   use the extension's public key from the Chrome Developer Dashboard.
   A public key is not a client secret; do not supply a private key.
4. Create an OAuth client of type **Chrome Extension**, with that exact
   extension ID as its application ID. No client secret is needed or accepted.
5. Build with the client ID. If using the dashboard's stable public key, supply
   its base64 DER value too:

   ```powershell
   $env:GOOGLE_OAUTH_CLIENT_ID = "YOUR_CHROME_EXTENSION_CLIENT_ID"
   # Optional: the extension's public key, never a private key.
   $env:GOOGLE_EXTENSION_PUBLIC_KEY = "YOUR_BASE64_EXTENSION_PUBLIC_KEY"
   npm run build
   ```

   Replace the placeholders with real configuration. Omit the public-key
   environment variable if retaining your current unpacked extension ID.
   Changing an extension key changes its identity and isolates its local data.
6. Reload the extension. Select **Google Calendar / Gmail**, click
   **Connect Google Calendar**, complete Google's consent, then save preferences.
   Background checks never launch interactive sign-in; authorization failures
   stop calendar-based planning, surface an error, and require an explicit reconnect.
   Clearly labeled time-based reminders can continue.

The configured build adds only `identity`, the Google API host permission, and
the free/busy OAuth scope. Normal builds add none of these. Access tokens stay
transient in the background worker and Chrome's identity cache; the app never
puts them in its local settings/history or sends them to the popup.

**Disconnect Google** clears the extension's identity token cache and pauses
saved Google reminders; it does not claim to revoke the server-side consent.
You can remove that grant in your [Google account connections](https://myaccount.google.com/connections).
Deleting local app data also clears the token cache. Google testing mode and
public distribution may impose user, verification, or token-lifetime limits;
managed-account administrators may block consent. Do not work around them.

References: [Calendar authorization and scopes](https://developers.google.com/workspace/calendar/api/auth),
[freeBusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query),
and [Chrome identity API](https://developer.chrome.com/docs/extensions/reference/api/identity).

## Refresh and reliability

Enabled reminders recheck plans on a five-minute heartbeat. When a calendar is
configured, they check for a new snapshot, refreshing
when the previous snapshot is fifteen minutes old. Notifications,
notification-button **Start**, and **Snooze** force a fresh availability request.
The popup's **Start early / Start now** are explicit manual overrides and never
fetch availability. **Refresh** also refreshes on demand. A calendar change between refresh and notification can
still occur; this is not a guarantee of real-time availability.

Browser sleep/shutdown may delay alarms. Reminders more than five minutes late
are marked missed, not replayed as a backlog. Only one ready/active break is
allowed to interrupt at a time. Startup restores/rechecks persisted plans and
recreates reminder alarms. Disabled reminders do not fetch or notify. Calendar-free
reminders do not make calendar requests or manufacture availability snapshots.

## Privacy and permissions

Preferences, normalized availability for the latest day, and exercise history
are stored only in this extension's `chrome.storage.local`, not Chrome Sync.
Your chosen source URL/type and time zone are local preferences too. Bookings
requests go to Microsoft's public services; optional Google requests go to
Google's Calendar API. The application is local-first, not offline. There is no
app analytics, third-party application backend, bundled personal calendar, or
client secret. Do not share a browser-profile/storage export as source code.

Default permissions: `storage`, `alarms`, `notifications`, and the two Microsoft
hosts above. Google-configured builds additionally use `identity` and
`https://www.googleapis.com/*`.
There is no `activeTab`, `scripting`, general browsing-history permission, or
content script. There is no Microsoft Graph experiment or registration harness
in the repository or release.
Camera access uses the browser's explicit `getUserMedia` prompt from the
visible Coach tab, with `audio: false`; no camera is acquired in the popup or
service worker. MV3 CSP permits only packaged scripts and WebAssembly, not
remote code or JavaScript `unsafe-eval`.

## Develop and verify

Node.js 22.18 or later:

```powershell
npm ci
npm test
npm run build
```

The first build downloads Google's fixed-version Pose Landmarker lite model
(about 5.5 MB), verifies its pinned SHA-256 and caches it in `.camera-cache`.
Subsequent builds reuse that verified cache. `public\pose` is generated from
the cache and the pinned `@mediapipe/tasks-vision` WASM package. A failed
download/checksum stops the build; the installed extension never downloads a
model. Model/runtime redistribution uses Apache 2.0; the original license and
model card are retained in `docs\third-party` and included in the ZIP.

To create the ready-to-install release ZIP:

```powershell
npm run package:extension
```

The output is `release\exercise-snacks.zip`, with `manifest.json` at the archive
root, local install instructions, and the license notices for bundled React,
React DOM, Scheduler, Unicode CLDR data, and MediaPipe/model assets. The ZIP also
contains the dedicated Coach page and all required local WASM/model files.
Packaging rejects unexpected build
files and does not include source, tests, personal settings, or development tools.
Generated ZIPs are release assets, not committed source files.

The integration test loads the real unpacked extension in an isolated Chromium
profile. By default it uses synthetic public Bookings responses, not anyone's
calendar. It checks calendar-source setup, worker messaging, storage, alarms,
notification creation, saved exercise choices, timer completion, pause, and deletion.
Timer completion uses a controlled test fixture, not real exercise credit.
It also runs the real bundled pose model offline against a synthetic webcam,
checks explicit opt-in, disabled audio, pause/resume, target stop, correction,
permission-denied manual fallback, summary persistence, and cleanup. Synthetic
movement sequences test full/partial/noisy reps and tracking loss. These checks
do not establish human rep-counting accuracy.
The test profile is closed and removed afterward.

```powershell
npx playwright install chromium
npm run test:extension
```

For the focused calendar-free onboarding, real alarm/notification, setup CTA,
refresh stability, pause, and popup-width regression, run `npm run test:reminders`.
It uses an offline isolated extension profile and never opens a webcam.
Set `$env:REMINDER_SCREENSHOTS = "docs\screenshots"` to regenerate Today and
Settings screenshots with synthetic demo data after those checks.

For an explicit anonymous, read-only smoke test of your public meeting-type link:

```powershell
$env:BOOKINGS_TEST_URL = "YOUR_PUBLIC_PERSONAL_BOOKINGS_MEETING_TYPE_URL"
$env:BOOKINGS_TEST_TIME_ZONE = "America/New_York" # replace as appropriate
npm run test:extension
Remove-Item Env:\BOOKINGS_TEST_URL, Env:\BOOKINGS_TEST_TIME_ZONE
```

No appointments are created. Google provider tests use synthetic API/token
fixtures and must not be presented as proof of live OAuth/account access.

OS toast visibility must still be checked in the user's own browser/OS session.
