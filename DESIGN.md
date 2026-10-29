# Exercise Snacks design language

This is the canonical visual and interaction guide for the Chrome and Edge extension. The popup is an **Operate** surface: help someone make one quick, comfortable choice during a busy workday. Preserve the product facts and privacy constraints in [PRODUCT.md](PRODUCT.md).

## Design intent

Exercise Snacks is a confident, encouraging movement coach—not a calendar dashboard, fitness leaderboard, or productivity scorecard. Make the next suitable break immediately understandable, give it one clear primary action, and keep alternatives visible without pressure. A skipped break is a valid choice. Movement is always an invitation; never imply that an exercise is medically appropriate for everyone.

The visual language pairs precise workday controls with a lively, compact movement identity. Use the specified navy, paper, electric blue, citrus, and coral palette at full strength. Keep the interface bright and legible in a browser popup; use the navy hero to make the current invitation distinct from surrounding information.

## Color tokens

The source tokens are defined in `src/style.css`. Keep their roles consistent when extending the interface.

| Token | Value | Role |
| --- | --- | --- |
| `--ink` | `#162437` | Primary text and the next-move hero |
| `--paper` | `#FAF8F2` | Main popup canvas |
| `--surface` | `#FFFEFA` | Quiet raised surfaces and form controls |
| `--blue` | `#315CF5` | Primary action, links, keyboard focus, and completed progress segments |
| `--lime` | `#C8F36B` | Brand spark and high-contrast accent on navy |
| `--coral` | `#FF7652` | Small, non-text alert accent |
| `--slate` | `#667487` | Structural/icon accents; avoid for small text on paper |
| `--muted` | `#59697E` | Secondary text on light surfaces |
| `--line` | `#DCE1E6` | Dividers and control boundaries |

Use the dark ink for text over citrus or coral. Use white text on electric blue and light text on navy. `--muted` is the accessible secondary-text color on paper; do not substitute `--slate` for small copy.

## Typography

- Use the platform system stack: `system-ui, "Segoe UI", sans-serif`. Do not load remote fonts.
- Use clear weight and size steps rather than decorative type or all-caps labels as a substitute for hierarchy.
- Keep instructions and supporting copy short enough to scan in a narrow popup; allow natural wrapping.
- Use tabular numerals for times and countdowns.

## Layout and components

- Set the extension popup to a fixed 480 px width so Chrome sizes it correctly when opening the popup. Do not base its width on `100vw`: Chrome can initially report a narrow popup viewport and keep the popup undersized. Keep the 480 px layout readable with normal text wrapping.
- The Today view order is: product identity and reminder state; date and refresh; one next-move or active-session hero; segmented daily momentum; later opportunities; compact availability status and expandable details.
- The navy hero contains the exercise, duration/time, concise instruction, and one electric-blue primary action. Keep alternate actions as text controls, not competing filled buttons.
- The active session keeps the exercise instruction, timer, comfort guidance, completion action, and an explicit end-without-logging option together.
- The empty state is calm and specific. Explain when no further reminders fit the remaining workday; never invent a free interval.
- Without a calendar, keep Today useful with evenly spaced reminders and a quiet text-level **Set up calendar** CTA below the hero. Do not force returning users back through calendar setup. Label fallback reminders **Time-based** and explain they are not verified free slots and may overlap meetings, including when a connected calendar has too few gaps.
- Show upcoming opportunities as compact rows, not a grid of same-sized metric cards.
- Represent progress with simple labeled segments and minutes. Do not introduce streaks, rings, scores, or achievement language.
- Keep availability status visible. Expand details to explain that Bookings availability is not the complete work calendar, show observed windows, and link to the public Bookings page.
- Keep onboarding and Settings form controls native-looking, labeled, and easy to tap. Keep privacy copy close to the setting that enables availability refresh.
- Calendar setup starts with an explicit provider, the user's own public meeting-type link or Google consent, and an IANA time zone. Explain unsupported link types and unconfigured OAuth beside the controls; never show a pretend connection state.
- Use the spark mark as a small brand detail. Avoid decorative gradients, glass effects, or imagery that distracts from choosing a break.

## Interaction and voice

- The main action says what happens: **Let's move**, **Complete exercise**, or the next available time.
- Keep **Different exercise**, **Snooze**, and **Skip** understandable and accessible beside the primary action.
- Higher-intensity strength/cardio is opt-in; gentle remains the default. Put exercise selection in Settings, with labeled checkboxes for the random set. A one-exercise set means a fixed choice; random picks never expand beyond the selected set. Disable **Different exercise** when no alternative is selected.
- For challenging exercises, describe short sets, rest, and modifications. The timer represents the break window, not continuous exertion.
- Snooze moves the break at least 15 minutes later, with a maximum of two snoozes per break. Calendar-based reminders need a verified opening; time-based reminders need only respect work hours and spacing.
- Skipping does not create replacement reminders or count as failure. Use neutral, supportive confirmation.
- Explain disabled actions with nearby timing or settings context.
- **Start early / Start now** is an explicit manual choice on today's planned snack. Keep its planned time visible and explain that no calendar check occurs and the original reminder is replaced. Do not disable this choice just because reminders are paused; calendar-based notifications still require verified availability; explicitly labeled time-based reminders do not.
- Camera Coach is a separate **Operate** page, never a camera inside the toolbar popup. Preserve the same paper/navy/blue/citrus identity, with a large readable rep count, preview, concise tracking cue, visible camera-on/off status, and explicit enable, pause, stop, adjust, save and manual controls. Do not request permission on page load or label an estimated count as verified form.
- Camera loss keeps the current count available for correction/manual continuation. Stop camera tracks immediately at the target, on pause/stop/end, and when hiding or leaving the page. Saving below the target is valid; never pressure someone to go deeper for detection.
- Errors identify the availability problem and offer a retry when possible. Never report success when availability could not be verified.
- Notification copy names the exercise, avoids private calendar or appointment details, and does not use guilt or urgency.

## Accessibility and motion

- Use semantic headings, buttons, forms, and expandable details; retain visible text labels for actions and status.
- Preserve visible keyboard focus with a high-contrast outline and a clear reading order.
- Keep text contrast at or above WCAG AA for normal text. Use coral and slate only in roles that retain sufficient contrast.
- Respect `prefers-reduced-motion`. Keep transitions brief and functional; do not animate urgency or progress.
- Offer gentle seated-friendly options as well as easy standing or walking options. Remind users to choose comfortable movement and stop if something feels uncomfortable.

## Product and privacy constraints

- Calendar-based reminders use explicitly verified personal Bookings or primary Google Calendar availability. The time-based fallback uses only weekday work hours, spacing, and remaining daily budget, and must never be shown as calendar-verified.
- Bookings availability is not a view of the user's complete calendar. Do not imply access to meeting details, Graph, or private calendar data.
- Do not create bookings or request passwords/client secrets. Google consent is optional, uses only the free/busy scope, and must be explicitly initiated. Never store tokens with local preferences/history or expose them to the popup.
- When availability is stale, incomplete, or unavailable, explain the state and discard it. Clearly labeled time-based reminders may continue without interpreting failures as free time.

## Source files

- `src/main.tsx` — popup structure, copy, and interaction states.
- `src/style.css` — design tokens, responsive layout, and component styling.
- `src/coach.tsx`, `src/coach.css` — dedicated optional Camera Coach and manual counter.
- `public/icon128.svg` — editable vector source for the extension toolbar icon.
- `public/icon128.png` — Manifest V3 toolbar icon.
