# Exercise Snacks

A local Chrome/Edge Manifest V3 extension that plans short exercise breaks around
your **Microsoft personal Bookings / Bookings with me** availability. Supply your
own public meeting-type link; no person's calendar identifiers are bundled.
Bookings needs no Azure subscription, Graph consent, client secret, or sign-in.

An optional **Google Calendar** provider supports Gmail users' primary calendar
through read-only OAuth. It requires the Google setup below; the default build
does not include a configured Google OAuth client. This is Calendar access,
not access to Gmail messages.

## Install locally from a ZIP

**No Node.js or build tools are needed.** Chrome/Edge 120 or later is required.

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
4. Open Exercise Snacks. Choose **Microsoft personal Bookings**, paste your
   public meeting-type link, and confirm your IANA time zone (initially your
   browser's zone). Choose your goal, movement level, duration (2, 3, or 5
   minutes), frequency (2 or 3 per day), and weekday work hours.
5. Leave reminders enabled and choose **Save & plan my day**. This explicitly
   enables read-only requests to your selected source.
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
The standard release ZIP is Bookings-only and has no Google identity permission.

Upgrading from the earlier personalized build pauses reminders until you choose
your own calendar source in **Settings** and re-enable them. Exercise history
is preserved. A popup/worker version mismatch now tells you to reload, and
invalid settings identify the specific field (including reversed AM/PM times).

## Screenshots

These screenshots show the Today plan and the calendar/exercise settings using
synthetic demo availability; no personal calendar or account data is displayed.

![Today view showing a suggested exercise, daily progress, later reminders, and availability status](docs/screenshots/today.png)

![Settings view showing provider selection, a demo Bookings link, time zone, exercise choices, and local reminder options](docs/screenshots/settings.png)

## Daily flow

- **Today** shows the current published free windows and up to three exercise
  opportunities, at least an hour apart, inside your chosen work hours.
- Click a reminder to open the app, then **Start**. The persisted timer continues
  if you close the popup. **Complete exercise** becomes available when it ends.
- Use the notification's **Start** button to begin immediately, or **Snooze** to
  move it at least fifteen minutes after its scheduled time to a suitable free
  window. Each break allows two snoozes. Clicking the notification body opens
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
Scheduling is weekday-only. Narrow or busy days can yield fewer than the goal.

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
too short to book a 30-minute meeting. This app schedules only inside explicitly
`AVAILABLE` intervals, subtracts overlapping busy/unknown statuses, and applies
your own work hours. It never infers free time from missing data or treats every
non-bookable time as a meeting.

These are **undocumented Bookings web-app endpoints**, not a supported Graph
API contract. They worked anonymously during implementation but can change or
be restricted. Changed privacy settings, time zones, missing day coverage,
malformed responses, redirects, HTTP errors, or network failures stop availability
use, clear scheduled reminder alarms, and show an error/badge rather than guess.
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
   pause reminders and require an explicit reconnect.

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

Enabled reminders check for a new snapshot on a five-minute heartbeat, refreshing
when the previous snapshot is fifteen minutes old. Notifications,
**Start**, and **Snooze** force a fresh availability request. **Refresh & plan**
also refreshes on demand. A calendar change between refresh and notification can
still occur; this is not a guarantee of real-time availability.

Browser sleep/shutdown may delay alarms. Reminders more than five minutes late
are marked missed, not replayed as a backlog. Only one ready/active break is
allowed to interrupt at a time. Startup restores/rechecks persisted plans and
recreates reminder alarms. Disabled/unconfigured reminders do not fetch.

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

## Develop and verify

Node.js 22.18 or later:

```powershell
npm ci
npm test
npm run build
```

To create the ready-to-install release ZIP:

```powershell
npm run package:extension
```

The output is `release\exercise-snacks.zip`, with `manifest.json` at the archive
root, local install instructions, and the license notices for bundled React,
React DOM, Scheduler, and Unicode CLDR data. Packaging rejects unexpected build
files and does not include source, tests, personal settings, or development tools.
Generated ZIPs are release assets, not committed source files.

The integration test loads the real unpacked extension in an isolated Chromium
profile. By default it uses synthetic public Bookings responses, not anyone's
calendar. It checks calendar-source setup, worker messaging, storage, alarms,
notification creation, saved exercise choices, timer completion, pause, and deletion.
Timer completion uses a controlled test fixture, not real exercise credit.
The test profile is closed and removed afterward.

```powershell
npx playwright install chromium
npm run test:extension
```

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
