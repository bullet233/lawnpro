# LawnPro Changelog

All notable changes to the app. Everything under **Unreleased** is local only —
not yet deployed to the tablet (deploy = `npm run deploy` → gh-pages).

## [Unreleased]

### 2026-07-31 — v1.5.0: Lawn Measure tool rebuilt for phones
- The embedded measure tool (public/lawn-measure/) is now mobile-first:
  full-screen map with a 3-stop bottom sheet (peek w/ live total → half →
  full), "+ Measure" FAB (long-press picks rectangle/circle), floating
  Undo/Finish/Cancel bar while tracing, and a crosshair placement mode
  (pan the map under a fixed reticle, "Drop point" lands dead-center —
  no more finger-covered corners). Preference persists per device.
- Phone declutter: native confirm()/prompt() replaced with 6-second
  undo-toasts and in-app sheets (Android webviews suppress the native ones);
  search collapses to an icon; Export/Import/Clear moved into Settings;
  category picker and FAB choosers are bottom sheets; Google's Map/Satellite
  and zoom buttons removed on phones (Settings toggle + pinch cover them).
- Desktop layout unchanged; measuring engine (worker.js) untouched.
- vite.config: service worker no longer hijacks the lawn-measure iframe —
  navigateFallbackDenylist keeps the SPA fallback from serving the React
  app into it (the tool's own index.html loads instead).

### 2026-07-30 — v1.4.1: route save no longer clobbers the other division
- Saving a route only retires the CURRENT division's pending/active route
  (plus legacy undivisioned ones). Previously it completed every open route
  across both divisions, so saving a mowing route silently erased the pending
  fertilizer route (and vice versa) — reported from the field 2026-07-30.
- The "Replace Active Route?" warning also counts only the current division.
- Live map: the active-route query now refreshes on the mow↔fert switch
  (missing dependency) instead of waiting for the next DB write.

## Deployed — v1.4.0 (2026-07-28)

### 2026-07-28 — Fertilizer workflow: EPA logging that files itself

**Today's Mix (day tank)**
- New banner on the Live map in fertilizer mode: set the day's tank mix once
  (tap-to-pick from the Chemical Inventory). Every completed fert visit then
  auto-files its EPA compliance log — products, customer, address, lawn size,
  start/end times, applicator info.
- Mix expires at midnight so yesterday's tank never signs today's logs.

**Per-lawn products**
- "This lawn's products" button on the live job panel: pick products for the
  current stop only, while still on the property. Overrides the day mix for
  that lawn; guarded by customer + date so it can never stamp the wrong lawn.
- Completion panel quick-pick when nothing was set: "Tap to log the products
  applied here" — two taps instead of the full sheet.

**EPA sheet opens on exit**
- Every fert-mode completion (geofence pull-away or manual Done) now pops the
  EPA sheet automatically, prefilled from the mix (or blank products if no mix),
  so it can be reviewed/corrected right at the truck.
- The completion panel's auto-dismiss countdown holds while the sheet is open.

**Drive-off protection**
- The open sheet's draft is persisted if the next stop's sheet replaces it —
  half-typed edits are never silently lost.
- New amber banner: "N stops today are missing EPA logs — tap to fill." Counts
  every completed fert visit today with no compliance record; tap → prefilled
  sheet for the oldest → save → next, until the banner clears.

**Fertilizer-side overhaul (the two systems now talk)**
- Field fert visits auto-complete the matching Treatment Program step (14-day
  early-apply grace), carrying price/time/weather/EPA log onto the treatment.
  Completion panel confirms: "Program step marked done: …".
- "Log Application" on the Treatments page / customer profile now creates a
  real completed fertilizer visit, so program revenue finally shows in History
  and the money screens.
- Completed treatments are viewable and reprintable: "Completed in YEAR"
  section on Treatments, View Log / Add Log buttons on profile program steps,
  and the official PDF sheet prints for program logs (was print-epa/undefined).
- Due logic unified: weekly scheduler and nearby-neighbor badges use program
  windows for enrolled clients (matching the Treatments page); interval
  fallback only for unenrolled.
- EPA log button now shows for every fert-mode completion and every
  fert-division History row (was keyed to service names).
- Fixed latent bug: the Live map never rendered the EPA modal — the completion
  panel's EPA button had done nothing since day one.

**Tests:** 34 passing (step-picker, day/stop mix, log building).

### 2026-07-28 — Dashboard week fix
- Home page weekly card was a rolling 7-day window; now the real Monday-start
  calendar week with future days faded. Home = History = Today.

### 2026-07-27/28 — Post-completion "Nearby Opportunities" overhaul
- Neighbor prompt + pace comparison now fire on automatic geofence exit (were
  dead due to stale first-render state; only worked on manual "I'm Done").
- Visits stamped with the current mode's division even after a mid-day
  mow↔fert switch.
- Neighbor candidates exclude paused/snoozed clients and anyone already
  serviced today on any route; rows show due badges (NEW / DUE / Nd OVERDUE),
  expected time, and implied $/hr.
- New "Didn't service yet — add to route & mow next" button appends selected
  neighbors to today's route (creates an Ad-hoc Route if none active).
- Time-split fixes: route now closes properly when its last stop finishes via
  a split; sequential splits can't over-allocate time and fabricate paces.

### 2026-07-27 — Audit fixes (real backup data)
- Division double-count: 14 legacy visits with no division were counted in
  BOTH mowing and fertilizer totals (mowing inflated +$560). Migration is now
  restore-safe and backfills on every startup.
- Backup/restore now includes treatments (EPA records), treatment programs,
  and fuel logs — restoring an old backup no longer silently wipes them
  (backup format v2, backward-compatible).
- History custom date range no longer shifts a day back (UTC parse bug).
- "This Week"/"This Month" filters are real calendar periods (Monday-start
  week), not rolling windows.
- Dashboard overdue badge no longer folds never-serviced clients into the
  overdue count (separate "+N new" badge).
- Customer profile visit header shows "(N completed · M skipped)" so it
  reconciles with the # Visits metric.
- Bidding matrix: difficulty normalization discards (not floors) jobs that
  normalize under 1 minute, so no more fabricated ultra-fast paces.
- Customer profile "Avg $/hr" is now work-time-only, matching the leaderboard;
  the with-drive figure remains as a labeled helper line.

## Earlier baseline (pre-v1.4.0, deployed 2026-07-06)
Mow/fert division switcher, routes + geofence auto-tracking, treatment
programs, bidding matrix, backup/restore v1.
