# Agent instructions

Before changing the popup or other user-facing interface, read [DESIGN.md](DESIGN.md) and follow its tokens, hierarchy, interaction language, accessibility requirements, and privacy constraints. Keep product behavior and claims consistent with [PRODUCT.md](PRODUCT.md).

In particular, preserve the local-first model and fail-closed availability handling for both providers. Microsoft personal Bookings is published availability, not a full calendar or Shared Bookings integration. Optional Google OAuth checks only primary-calendar free/busy; never claim it was verified live without account evidence. Do not imply access to Microsoft Graph or event details. Keep skip non-punitive, reminders calm, and exercise guidance comfortable and optional. Update the design guide when an approved UI change establishes a durable visual or interaction rule.
