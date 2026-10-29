# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Assumption awaiting confirmation: the primary user is an individual desk-based worker who wants short movement breaks during the workday.

## Product Purpose

Exercise Snacks is a local-first browser extension that helps a person make room for brief movement during the workday. It spaces reminders through the workday and optionally uses the user's public personal Bookings availability or Google Calendar free/busy to prefer free gaps, and keeps preferences and exercise history in the browser. Success means a person can quickly start, snooze, skip, and complete a comfortable exercise break. Bookings works without calendar sign-in; Google requires configured OAuth and explicit consent.

## Positioning

The extension combines read-only availability with local scheduling, reminders, and progress tracking. It does not require Microsoft Graph access. Bookings is published availability, not a full work calendar; Google checks only the primary calendar.

## Operating Context

The app is a Chrome or Edge extension used during a workday. The user opens the popup to review today's next movement opportunity, manage preferences, or view recent progress. Reminders use browser notifications and require the browser to be running with browser and operating-system notifications enabled.

## Capabilities and Constraints

- Uses the configured public Microsoft personal Bookings meeting-type link, not a bundled personal integration or Shared Bookings page. It does not access appointment details, create bookings, or infer availability from missing or incomplete data.
- Optionally reads primary Google Calendar free/busy with a narrow read-only OAuth scope. Google requires build-time client configuration and explicit sign-in; it has not been verified against a live Google account here.
- Uses the Bookings web service anonymously. Its endpoints are undocumented and may change.
- Stores preferences, plans, and exercise history locally in the browser; it does not use a cloud backend or analytics.
- Schedules on weekdays within the configured workday and chosen IANA time zone, including day boundaries and DST.
- Microsoft Graph access and application-registration experiments are not part of this app or repository.
- Calendar-based reminders require verified availability. When no calendar is configured, checks fail, or there are insufficient gaps, remaining reminders are evenly spaced through the remaining workday and explicitly labeled time-based, not verified free slots. They may overlap meetings. Calendar failures remain visible; providers never invent availability.
- Offers an opt-in challenging bodyweight strength/cardio style alongside gentle and easy movement. Users can choose a random set or select a single exercise; planned choices persist locally.
- Allows starting today's planned snack manually without calendar requests, free/busy checks, work-hour restrictions or depending on the reminder toggle. It consumes that same snack and removes its reminder; finished/old-day snacks cannot be reopened, and another active session still blocks starting. Nearby reminders are removed and replanned from fresh availability when available and time-based reminders otherwise, preserving spacing and the daily budget.
- Offers an experimental, optional Camera Coach for squat counts in a dedicated tab. MediaPipe/WASM/model assets are packaged locally; audio is off, and no camera frames or landmark sequences are uploaded or saved. Manual counting/correction and normal timer completion remain available.
- Stops the camera when pausing, stopping, hiding/closing the tab, ending the session, or reaching the rep target. Only a summary is saved after explicit confirmation. Counts estimate repetitions; they do not verify exercise quality. Five-person Windows/Mac accuracy/performance validation remains outstanding.

## Brand Commitments

The product is named Exercise Snacks. Its voice is confident, encouraging, and non-shaming. It treats movement as an invitation, not an obligation; skipping is a valid choice and is never framed as failure.

## Evidence on Hand

- A working local Manifest V3 extension with Bookings availability capture, scheduling, reminders, exercise interactions, onboarding, and local history.
- Automated unit tests and a Chromium extension integration test for core scheduling, availability, notification, and interaction behavior.
- No Graph integration or evidence of access to the user's work calendar.

## Product Principles

- Keep the core experience useful without cloud services, calendar credentials, or corporate Graph consent.
- Use only explicit Bookings availability or a complete Google primary-calendar free/busy response; do not guess when data is missing.
- Make starting, snoozing, skipping, and completing a break straightforward.
- Keep personal preferences and progress on the user's device.
- Treat comfort and user choice as more important than a completion target.

## Accessibility & Inclusion

Offer gentle, seated-friendly movement options alongside easy standing or walking options. Challenging exercises are opt-in and include short sets, rests, and modifications. Use semantic controls, visible keyboard focus, sufficient text contrast, and respect reduced-motion preferences. Avoid treating any exercise as mandatory or universally suitable.
