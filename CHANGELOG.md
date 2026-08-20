# LawnPro Changelog

All notable changes to the app. Everything under **Unreleased** is local only —
not yet deployed to the tablet (deploy = `npm run deploy` → gh-pages).

## [1.4.7] - 2026-08-19

### Split-time modal shows each lawn's usual time (2026-08-19)
- Every property card in the nearby time-split modal now shows a tappable
  pill with what that lawn normally takes — "📊 avg 32 min · 7 visits" from
  its own completed visits in the active division, or "📐 est 25 min (lawn
  size)" from the trend curve when it has no history yet. Tapping the pill
  fills that property's minutes input, so when the tracked split looks wrong
  you can see (and one-tap enter) the number that's close to right.

### Early-served clients stay off the next day's route (2026-08-06)
- Loading a day route (Weekly Scheduler "Load route" / Route Builder) now
  leaves off anyone already handled today or yesterday — done early as a
  nearby split/added opportunity, or deliberately cycle-skipped. The loaded
  dialog names them ("Left off: X (serviced yesterday) — add manually to
  re-service"); catch-up skips still load since they still need service.
- Live backstop: a stop with a completed division visit today/yesterday on
  ANY route never auto-arrives (no accidental double-tracked visit on
  hand-built or template routes); the manual Start/Redo button still works
  for deliberate re-services. (85 tests.)

### Fast exits + takeover fast-lane, division profiles (2026-08-06)
- Speed-aware exit: outside the fence at driving speed (10+ mph, Doppler —
  parked drift reads ~0) ends the job after a 3s confirm instead of the full
  15s debounce. Walking speed (pushing a mower across the street) stays slow.
- Distance exit: any fix 100m+ past the fence ends the job after the same
  confirm — the backstop for devices that report no speed.
- Takeover fast-lane: arriving at another route stop takes over in the normal
  8s (not 15s) when there's proof the previous lawn was actually left (street
  fixes beyond the buffer, or driving speed). Drift-steal protection intact:
  no proof = exit-level evidence still required, and never while paused.
- Honest timestamps on both edges: a job now starts at the FIRST fix inside
  the zone (not after the debounce) and ends at the last fix actually at the
  property — the drive between stops and the debounces no longer pad times.
- Per-division tuning profiles (DIVISION_PROFILES): mowing/fert use the speed
  rule (truck parked while working); a future snow division is pre-tuned with
  it OFF plus a 50m buffer / 40s debounce / 150m line, since plowing means
  driving and pushing snow across the street is part of the job.
- Division-eligibility fix: the post-job nearby/split candidates and the live
  opportunity banner no longer pitch fert-only clients during mowing (or
  vice versa) — both now filter by the active division.
- 6 new engine tests (84 total).

## [1.4.6] - 2026-08-06

### Address autocomplete hardening (2026-08-05)
- Rebuilt the AddressAutocomplete wrapper to manage Google's widget directly
  with full teardown (the library component left zombie widgets bound to the
  input on every remount — StrictMode/tab switches stacked duplicate dropdowns
  that could fight over a selection — and leaked dropdown elements in <body>).
- If the Maps script failed to load when the app opened (no signal in the
  truck), the address field silently became a plain input for the whole
  session. It now shows a hint under the field explaining suggestions are
  offline and to close/reopen the app once there's signal.
- Selections now request only the fields the app reads (address, location,
  name) instead of billing for every Place Details field.
- onPlaceChanged callbacks receive the widget instance directly — selection
  can no longer miss because of React render timing.

### Job timer no longer dies mid-job (2026-08-04)
- GPS drift can't end a running job anymore: leaving a lawn now takes 15 seconds
  of evidence (was 5) AND the fix must be 20+ meters beyond the fence edge — a
  parked tablet hovering just outside the line stays "at the job" indefinitely.
- A neighboring zone can no longer steal a running job after 8 seconds of drift:
  takeover now needs the full exit-level evidence (15s), never happens while the
  timer is paused, and drift near a shared/overlapping fence edge stays credited
  to the active job. Interrupted takeover attempts restart their clock from zero
  instead of accumulating across drift bounces.
- Screen-off / GPS-loss gaps can't fire an instant exit on wake: a gap in usable
  fixes (>30s) restarts the debounce clocks instead of counting the whole gap.
- Auto-exit durations now end at the moment the fence was actually left, not
  when the debounce finished — no more +debounce padding on every job.
- Fixed a unit bug where using Pause during a job blew up the logged duration
  (paused milliseconds were added as seconds on geofence exit / Done).
- Redo works: a skipped stop shows a "Redo" button in the live route list, and
  the engine keeps tracking a manually restarted completed/skipped stop instead
  of force-exiting it ~15s in. A stop that was skipped then redone reads as
  completed. (7 new engine tests; suite now 78.)

### Weekly Scheduler rebuilt (design direction 5b)
- Replaced the horizontal day-column scroller with a mobile-first layout: a
  fixed 7-day rail (stop counts) over an accordion week list (one day open at a
  time). No more sideways scrolling or per-card "Move…" dropdowns.
- Stop rows show drive-order number, name, address, a "Mowed/Treated … · Nd ago"
  line, and a solid LATE (+Nd) / DUE (today) / NEW status block — nothing on
  on-schedule stops (red/amber reserved for status, green for pressable).
- Est. hours per day now include an estimated drive time (haversine between
  geofence centroids), shown in the rail, day headers, and move-sheet chips;
  they turn red past the 8h long-day line.
- Tap a stop → move sheet: 7 day chips each showing that day's projected hours
  *after* the move, a "drops in at stop N of M" landing line (cheapest-insertion
  into that day's drive order), plus Snooze 1 week / Remove.
- Select mode: multi-select within a day (Select all late), sticky tray to move /
  snooze / remove the whole batch at once.
- Every move / snooze / remove shows a 5-second Undo toast.
- Drive order is reorderable by dragging a stop's handle; a new per-customer
  `dayOrder` persists manual order (nearest-neighbor fallback otherwise).
- All wired to real data — division-filtered last-service, program-aware DUE for
  fert clients, the existing tiered-pace duration model, and the existing
  Load-route action. New math is isolated in src/utils/scheduler.js (20 tests).
- Styling: the accent follows the division (green in Mowing, blue in Fertilizer,
  matching the app theme); all body text is black/near-black for sun legibility;
  section backgrounds are white (no green tint); thin separators between stops.

### Route Builder workflow audit fixes (2026-08-04)
- "Load route" from the Weekly Scheduler now mirrors the scheduler exactly:
  same division eligibility (fert mode no longer pulls mowing clients), same
  drive order (manual dayOrder / nearest-neighbor instead of raw DB order),
  and mode-matched default services (fert routes load with the fert service,
  not "first active"). Eligibility logic is shared via
  scheduler.js eligibleForMode (unit-tested).
- Optimize: if geocoding the business address fails, the response is now
  decoded against the pinned-endpoints fallback that was actually requested —
  previously it silently dropped the first and last stops from the list.
- Optimize: stop cap is 25 with a business address, 27 without (first/last
  become Google's fixed origin/destination); the success dialog now says the
  first/last stops stay pinned when no business address is set, and the
  Directions + geocode calls are counted in the API-usage tracker (the tracker
  itself silently ignored 'directions' — Day Review's calls never counted
  either; both now land in the Routing bucket at the same $0.005 price).
- Replacing a route nobody worked marks it 'cancelled' instead of 'completed',
  so abandoned routes can't pass for finished days.
- Weekly Scheduler: drag-reorder now starts from the displayed order (no row
  jump on days with snoozed stops); the move sheet's misleading static
  "drops in at stop N" line (it always described Monday) is replaced with an
  honest explainer — the exact landing still shows in the after-move toast;
  the batch tray disables the day you're already on ("here") like the move
  sheet; the clock refreshes on return-to-tab so TODAY/late math can't go
  stale across midnight.
- Templates: mow/fert badge on each saved template, and loading one from the
  other division warns that saving creates a route in the current mode.

### Live map + Dashboard follow-ups (2026-08-04)
- Live "parked at" opportunity banner: no longer re-offers a lawn already
  serviced (or skipped) today on any route, and when arrival zones overlap it
  picks the customer whose zone center is closest instead of whichever happens
  to be first in the list. (5 new engine tests.)
- New Dashboard "Dropped from route" card: stops force-skipped when a route
  was ended, not serviced since, and newer than 14 days. These were invisible
  until their interval aged them into the overdue list — now they surface the
  next morning with an Add-to-route button. Clears itself once the client is
  serviced, snoozed, or paused.
- Time-split companion pricing is division-aware: an off-route neighbor split
  during a fert day now prices from their fert/spray service, not whatever
  service is listed first. Same shared picker (defaultServicesForMode) now
  drives Route Builder defaults and the Dashboard Add button.
- Dashboard "Add" fix: a route created from the due list got no division
  stamp, so the Live page (which filters by division) couldn't see it until
  the next app restart backfilled it as mowing. Now stamped with the active
  mode, and the pre-selected service matches the division.

### Skip rework — skips now say what they mean (2026-08-04)
- The skip sheet asks the real question: does the lawn still need service?
  Two honest outcomes replace the old buttons (one of which — "Skip for Today
  (Reschedule Tomorrow)" — never actually rescheduled anything):
  - **Still needs service — catch up ASAP**: flagged `catchUp`, so it appears
    in the Dashboard's "Dropped from route" card immediately (single skips
    used to vanish until the client aged into overdue).
  - **Skip this cycle**: flagged `countsForSchedule` — a schedule ANCHOR. The
    due math (Dashboard due list, Weekly Scheduler, nearby-neighbor badges)
    treats it as the last service for timing only, so a deliberately-skipped
    client shows normally due next cycle instead of LATE +7d. Scheduler rows
    read "Skipped Aug 4 · Nd ago" so it never masquerades as a mow. Replaces
    the old Skip & Snooze (which hid the client, then screamed LATE when the
    snooze expired). Anchors never count toward revenue, paces, or the matrix.
- Optional one-tap reason chips (Rain / No growth / Customer request /
  Couldn't access / Ran out of time) saved to the visit note — they show up in
  Recent Job Notes and History.
- Force End Route now opens the same sheet for the remaining stops (choosing
  an outcome is the confirmation; Cancel backs out). No more blanket
  "Forcibly skipped" stamping.
- A driveby resolved as "Skipped" is flagged catch-up too, so it also surfaces
  instead of vanishing.
- 71 tests (isScheduleAnchor + skip semantics covered).

## Deployed — v1.4.5 (2026-08-01)

### Measure tool: easier switching between areas
- Tap another area's shape on the map while editing to jump straight to it
  (current edits auto-commit; still click-through while actively tracing, so
  cutout drawing over a neighbor is unaffected).
- New "Done" button on the green Editing banner — commits and returns to
  overview. A Done on an area that never got a boundary just discards it.
- Changed in lawn-measure-mobile source, synced via sync-to-lawnpro.sh.

## Deployed — v1.4.4 (2026-08-01)

### Measure tool: touch-friendly reshape handles (map no longer pans mid-drag)
- On touch devices, dragging a shape's point used to move the MAP along with
  (or instead of) the point — Google's built-in vertex handles are ~11px and a
  fingertip misses them, so the one-finger pan won the gesture. Touch devices
  now get custom fat handles (44px hit box): big blue-ring dots on each corner,
  fainter midpoint dots that add a new point when dragged, and map panning is
  locked for the length of the drag. Rectangles get 4 corner handles; circles
  get a center handle + a radius handle.
- Double-tap a point to delete it (right-click on desktop, which has no touch
  equivalent). Undo covers slips; shapes keep a 3-point minimum.
- Desktop/mouse editing unchanged (still Google's built-in handles).
- Test hook: `?coarse=1` on the measure tool URL forces the touch handles on a
  mouse desktop.
- Changed in lawn-measure-mobile source, synced via sync-to-lawnpro.sh.

## Deployed — v1.4.3 (2026-08-01)

### Tablet gets the mobile measure layout
- Lawn Measure's mobile/desktop split now keys off `(max-width: 700px),
  (pointer: coarse)` instead of width alone — any touch-first device (the
  tablet included) gets the phone layout (full-screen map, bottom sheet,
  crosshair Drop-point). Mouse desktops keep the side panel. Changed in the
  lawn-measure-mobile source (5 spots: styles.css media block, index.html
  isMobile() + breakpoint listener, app.js ×2) and synced via
  sync-to-lawnpro.sh.

## Deployed — v1.4.2 (2026-08-01)

### Lawn Measure tool rebuilt for phones (mobile rebuild v1.5.0, synced 2026-07-31)
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
- Synced into LawnPro 2026-07-31 (committed 3948b7c) but not deployed until
  now — v1.4.1 shipped first.

## Deployed — v1.4.1 (2026-07-30)

### Route save no longer clobbers the other division
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
