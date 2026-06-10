# LiveMap Workflow Bug Audit

I traced the full daily workflow: Build Route → Start Route → Drive → Enter Geofence → Mow → Exit Geofence → Completion Panel → Next Stop → End of Day.

## Bugs Found

### Bug 1: `driveTimeSecs` ignores the pause button (Medium)
**Where:** `logVisit()` line ~596
**What happens:** When you log a visit, it calculates `driveTimeSecs` by subtracting the previous job's `exitTime` from the current job's `entryTime`. But if you paused the driving timer for a 30-minute lunch, that 30 minutes still gets counted as "drive time" because the calculation uses raw wall-clock timestamps, NOT the paused drive timer.
**Impact:** Your Analytics "Drive Time" per job will be inflated on days you take breaks.
**Fix:** Use `accumulatedDriveTimeRef.current` (which respects the pause) instead of the wall-clock subtraction.

### Bug 2: Driveby auto-dismiss loses the visit (Low)
**Where:** `drivebyPrompt` auto-dismiss timeout, line ~490
**What happens:** When the driveby prompt ("You were at X for only 12 seconds") appears, it auto-dismisses after 15 seconds. But if you don't tap "Skipped" or "Normal Service" in time, the prompt disappears and the visit is NEVER logged. It just vanishes.
**Impact:** You lose a visit record if you're slow to respond to the driveby prompt.
**Fix:** Auto-dismiss should default to logging as "skipped" instead of silently dropping the visit.

### Bug 3: Completion panel auto-dismiss doesn't save the note (Low)
**Where:** Completion panel timer, line ~641
**What happens:** The completion panel auto-dismisses after 12 seconds. If you typed a note but didn't tap "Save Note & Close" in time, the note is lost. The `handleSaveNote` function is never called.
**Impact:** Notes get lost if you're a slow typer.
**Fix:** Already partially handled — if `panelNoteActiveRef` is true (user is typing), it extends by 5 seconds. But if the user finishes typing and then gets distracted, the note still gets lost. Should save the note on auto-dismiss.

### Bug 4: `getStopStatus` uses a stale ref (Low)
**Where:** `getStopStatus()` line 201
**What happens:** It checks `activeGeofenceIdRef.current` (a ref) but the function is called during React render (in JSX). Refs don't trigger re-renders, so the route list pills might show a stale "active" status for a stop even after you've left.
**Impact:** Minor visual glitch — the route list might not update the stop status icon immediately.
**Fix:** This is partially mitigated because `routeVisits` (a live query) does trigger re-renders when a visit is logged.

## Summary
| Bug | Severity | Status |
|-----|----------|--------|
| Drive time ignores pause | Medium | Needs fix |
| Driveby auto-dismiss loses visit | Low | Needs fix |
| Completion panel loses note | Low | Needs fix |
| getStopStatus stale ref | Low | Acceptable |
