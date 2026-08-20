// Weekly Scheduler math — pure, node-testable helpers shared by the scheduler UI.
//
// Everything here is derived from data the app already stores: customer geofences
// (a polygon whose centroid is the stop's point), the tiered pace matrix, and the
// same job-duration modifiers the rest of the app uses. Drive time is a LOCAL
// estimate (haversine between centroids × a road factor ÷ an assumed speed) — the
// real Google Directions time only exists after an online optimize, so the
// scheduler can't use it for instant, offline "hours after this move" math.

import { parseLawnSizeToSqFt } from './matrix';

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_LETTERS = { Monday: 'M', Tuesday: 'T', Wednesday: 'W', Thursday: 'T', Friday: 'F', Saturday: 'S', Sunday: 'S' };

// Local drive-time estimate tuning. Lawn routes are stop-to-stop suburban driving.
const AVG_SPEED_MPS = 11.18;   // ~25 mph
const ROAD_FACTOR = 1.3;       // straight-line → real road distance fudge
export const LONG_DAY_MINS = 480; // 8h — the "long day" threshold (spec default)

// JS Date.getDay() (0=Sun) → our Monday-first day name.
export function todayName(now = Date.now()) {
  return DAY_NAMES[(new Date(now).getDay() + 6) % 7];
}

// Centroid of a customer's geofence polygon, or null if it has no coordinates.
export function centroid(cust) {
  const geo = cust && cust.geofence;
  if (!geo || !geo.length) return null;
  let lat = 0, lng = 0;
  for (const p of geo) { lat += p.lat; lng += p.lng; }
  return { lat: lat / geo.length, lng: lng / geo.length };
}

// Haversine distance in meters between two {lat,lng} points (0 if either missing).
export function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Estimated drive minutes between two stops (0 if either lacks coordinates).
export function driveMinsBetween(a, b) {
  const meters = haversineMeters(centroid(a), centroid(b));
  if (!meters) return 0;
  return (meters * ROAD_FACTOR) / AVG_SPEED_MPS / 60;
}

// Per-customer job minutes — mirrors the app's existing duration model
// (tiered pace + terrain/obstacle/fence modifiers) so scheduler hours match
// the numbers shown elsewhere.
export function estimateJobMins(cust, tiered) {
  if (!tiered || !tiered.length) return 0;
  const sqft = parseLawnSizeToSqFt(cust.lawnSize);
  if (!sqft) return 0;
  const bucket = tiered.find((b) => sqft <= b.maxSqft) || tiered[tiered.length - 1];
  if (!bucket || !bucket.pace) return 0;
  let mins = sqft / bucket.pace;
  const obstacles = parseInt(cust.obstacleCount, 10) || 0;
  if (cust.terrain === 'moderate') mins *= 1.15;
  else if (cust.terrain === 'hilly') mins *= 1.3;
  if (cust.fencedBackyard) mins += 3;
  if (obstacles > 0) mins += obstacles * 1.5;
  return mins;
}

export function isSnoozed(cust, now = Date.now()) {
  return !!(cust.snoozedUntil && cust.snoozedUntil > now);
}

// A visit that anchors the service schedule: a real completed service, or a
// deliberate "skip this cycle" skip (countsForSchedule). Anchors drive the
// days-since/due math ONLY — never revenue, paces, or the bidding matrix.
// Plain skips (catch-up, force-end, driveby) never anchor.
export function isScheduleAnchor(v) {
  return v.status === 'completed' || (v.status === 'skipped' && v.countsForSchedule === true);
}

// Whether a customer belongs to a division's schedule. Shared by the Weekly
// Scheduler (day lists) and the Route Builder's Load-route action so the route
// that loads is exactly the list the scheduler showed. Mowing is the default
// division: customers with no services at all still count as mowable.
export function eligibleForMode(c, mode) {
  if (!c || c.status === 'inactive') return false;
  if (mode === 'fertilizer') {
    return !!(c.services && c.services.some((s) => {
      const n = (s.name || '').toLowerCase();
      return (n.includes('fert') || n.includes('spray') || n.includes('weed') || n.includes('chem')) && s.active;
    }));
  }
  return !c.services || c.services.length === 0 || c.services.some((s) => {
    const n = (s.name || '').toLowerCase();
    return (n.includes('mow') || n.includes('cut') || n.includes('yard')) && s.active;
  });
}

// The service(s) to pre-select for a division: the active service matching the
// division's family first, else the customer's first active service. Returns
// service OBJECTS (callers map to ids or sum prices). Shared by the Route
// Builder, the Dashboard's add-to-route, and time-split companion pricing so a
// fert-mode visit never gets stamped with the mowing service by default.
export function defaultServicesForMode(customer, mode) {
  const svcs = (customer?.services || []).filter((s) => s.active);
  if (!svcs.length) return [];
  const isFert = (s) => {
    const n = (s.name || '').toLowerCase();
    return s.id === 's3' || n.includes('fert') || n.includes('spray') || n.includes('weed') || n.includes('chem');
  };
  const isMow = (s) => {
    const n = (s.name || '').toLowerCase();
    return s.id === 's1' || n.includes('mow') || n.includes('cut') || n.includes('yard');
  };
  const match = svcs.find(mode === 'fertilizer' ? isFert : isMow);
  return match ? [match] : [svcs[0]];
}

// Drive order for a day's stops. Manual order (a numeric `dayOrder` on every
// stop) wins; otherwise a nearest-neighbor walk from the northernmost stop.
// Stops with no coordinates fall to the end, name-sorted, so they stay visible.
export function orderDayStops(custs) {
  const list = custs.slice();
  if (list.length && list.every((c) => Number.isFinite(c.dayOrder))) {
    return list.sort((a, b) => a.dayOrder - b.dayOrder);
  }
  const withPt = list.filter((c) => centroid(c));
  const without = list.filter((c) => !centroid(c))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (!withPt.length) return without;

  const remaining = withPt.slice();
  // Deterministic start: northernmost (highest latitude).
  remaining.sort((a, b) => centroid(b).lat - centroid(a).lat);
  const ordered = [remaining.shift()];
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    let bestI = 0, bestD = Infinity;
    remaining.forEach((c, i) => {
      const d = haversineMeters(centroid(last), centroid(c));
      if (d < bestD) { bestD = d; bestI = i; }
    });
    ordered.push(remaining.splice(bestI, 1)[0]);
  }
  return ordered.concat(without);
}

// Total minutes for a day = job time for every active (non-snoozed) stop plus
// estimated drive between them in visiting order. Snoozed stops are excluded.
export function dayTotalMins(orderedStops, tiered, now = Date.now()) {
  const active = orderedStops.filter((c) => !isSnoozed(c, now));
  let mins = 0;
  active.forEach((c, i) => {
    mins += estimateJobMins(c, tiered);
    if (i > 0) mins += driveMinsBetween(active[i - 1], c);
  });
  return mins;
}

// Where a stop should drop into an existing ordered day: the insertion index
// (0..n) that adds the least drive distance. Appends when coordinates are absent.
export function cheapestInsertIndex(orderedStops, cust) {
  const pt = centroid(cust);
  if (!pt || !orderedStops.length) return orderedStops.length;
  const withPt = orderedStops.filter((c) => centroid(c));
  if (!withPt.length) return orderedStops.length;
  let bestI = 0, bestCost = Infinity;
  for (let i = 0; i <= withPt.length; i++) {
    const prev = i > 0 ? centroid(withPt[i - 1]) : null;
    const next = i < withPt.length ? centroid(withPt[i]) : null;
    const add = haversineMeters(prev, pt) + haversineMeters(pt, next) - haversineMeters(prev, next);
    if (add < bestCost) { bestCost = add; bestI = i; }
  }
  // Map the index within coordinate-bearing stops back to the full list.
  if (bestI >= withPt.length) return orderedStops.length;
  const anchor = withPt[bestI];
  return orderedStops.findIndex((c) => c.id === anchor.id);
}

// Interval-based status for a stop (fert-program clients override this with
// their treatment-window state in the component). Returns:
//   { kind: 'late'|'due'|'ok'|'new', excess }  — excess = days past interval.
export function intervalStatus(lastDays, interval) {
  if (lastDays == null) return { kind: 'new', excess: 0 };
  if (lastDays > interval) return { kind: 'late', excess: lastDays - interval };
  if (lastDays === interval) return { kind: 'due', excess: 0 };
  return { kind: 'ok', excess: 0 };
}
