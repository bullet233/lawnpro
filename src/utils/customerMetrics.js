import { isMowVisit, isLeafVisit, isCleanupVisit, mowingServiceIds, cleanupServiceIds, LEAF_REVENUE_KEY } from './leaves';
import { getVisitRevenueBreakdown } from './revenueUtils';
import { parseLawnSizeToSqFt } from './parseLawnSize';
import { calculatePowerModel, predictTrendMins } from './matrix';

// Per-customer service metrics, worked out from the visits the app already
// records — nothing extra to tap in the field. One customer in, one metrics
// object out; `buildCustomerMetrics` does it for the whole book.
//
// "Season" is the calendar year of `now`. Mowing numbers use PLAIN mows only
// (leaf jobs and clean-ups run long, so they would bend every average).

const DAY = 86400000;
const round2 = (n) => Math.round(n * 100) / 100;
const avg = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : null);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const rate = (revenue, secs) => (secs >= 60 ? revenue / (secs / 3600) : null);
const addOnTotal = (v) => (Array.isArray(v.addOns) ? v.addOns.reduce((s, a) => s + (a.price || 0), 0) : 0);

export const ADDON_REVENUE_KEY = 'Add-ons';

// Thresholds for the "needs a look" flags.
export const TREND_MIN_MOWS = 5;        // 3 recent + at least 2 before them
export const TREND_MIN_MINS = 3;        // a change smaller than this is noise…
export const TREND_MIN_PCT = 0.1;       // …and so is one under 10%
export const CADENCE_SLACK = 1.3;       // 30% longer between visits than planned
export const SWING_PCT = 0.6;           // shortest→longest swing vs the usual mow
export const SLOW_VS_SIMILAR = 1.4;     // same ratio as the slow-lawn flag
export const MIN_VISITS_FOR_RATE = 3;

// What kind of work a visit was, for the per-service rate.
export function visitKind(v, mowIds = mowingServiceIds(), cleanupIds = cleanupServiceIds()) {
  if (v.division === 'fertilizer') return 'fertilizer';
  if (isCleanupVisit(v, mowIds, cleanupIds)) return 'cleanup';
  if (!isMowVisit(v, mowIds)) return 'other';
  return isLeafVisit(v) ? 'leaf' : 'mow';
}
export const KIND_LABELS = { mow: 'Mowing', leaf: 'Mow + leaves', cleanup: 'Clean-up', fertilizer: 'Fertilizer', other: 'Other services' };

export function computeCustomerMetrics(customer, visits, {
  now = Date.now(),
  targetRate = 0,
  defaultServices = [],
  model = null,                    // trend curve from calculatePowerModel (optional)
  mowIds = mowingServiceIds(),
  cleanupIds = cleanupServiceIds(),
} = {}) {
  const seasonStart = new Date(new Date(now).getFullYear(), 0, 1).getTime();
  const mine = visits.filter((v) => v.customerId === customer.id && (v.exitTime || v.entryTime));
  const when = (v) => v.exitTime || v.entryTime;
  const season = mine.filter((v) => when(v) >= seasonStart && when(v) <= now).sort((a, b) => when(a) - when(b));
  const done = season.filter((v) => v.status === 'completed');

  // 1 ── Season revenue, split by service ────────────────────────────────
  const byKey = {};
  done.forEach((v) => {
    const extras = Math.min(addOnTotal(v), v.priceEarned || 0);
    const split = getVisitRevenueBreakdown({ ...v, priceEarned: Math.max(0, (v.priceEarned || 0) - extras) }, customer, defaultServices);
    Object.entries(split).forEach(([k, amt]) => { byKey[k] = (byKey[k] || 0) + amt; });
    if (extras > 0) byKey[ADDON_REVENUE_KEY] = (byKey[ADDON_REVENUE_KEY] || 0) + extras;
  });
  const nameFor = (k) => (k === LEAF_REVENUE_KEY ? 'Leaf charges' : k === ADDON_REVENUE_KEY ? 'Add-ons'
    : customer.services?.find((s) => s.id === k)?.name || defaultServices.find((s) => s.id === k)?.name || 'Other');
  const revenueByService = Object.entries(byKey)
    .filter(([, amt]) => amt >= 0.01)
    .map(([key, amount]) => ({ key, name: nameFor(key), amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);
  const revenue = round2(done.reduce((s, v) => s + (v.priceEarned || 0), 0));

  // 2 ── $/hr per kind of work (job time only) ───────────────────────────
  const kinds = {};
  done.forEach((v) => {
    if (!v.durationSecs || v.durationSecs < 60) return;
    const k = visitKind(v, mowIds, cleanupIds);
    if (!kinds[k]) kinds[k] = { kind: k, label: KIND_LABELS[k], visits: 0, revenue: 0, secs: 0 };
    kinds[k].visits += 1;
    kinds[k].revenue += v.priceEarned || 0;
    kinds[k].secs += v.durationSecs;
  });
  const rateByKind = Object.values(kinds)
    .map((k) => ({ ...k, revenue: round2(k.revenue), rate: rate(k.revenue, k.secs) }))
    .sort((a, b) => b.visits - a.visits);

  // 3 ── $/hr with and without the drive ─────────────────────────────────
  const timed = done.filter((v) => v.durationSecs >= 60);
  const timedRevenue = timed.reduce((s, v) => s + (v.priceEarned || 0), 0);
  const workSecs = timed.reduce((s, v) => s + v.durationSecs, 0);
  const driveSecs = timed.reduce((s, v) => s + (v.driveTimeSecs || 0), 0);
  const rateWork = rate(timedRevenue, workSecs);
  const rateWithDrive = rate(timedRevenue, workSecs + driveSecs);

  // 4 ── Extras: visits billed for anything beyond the base service ───────
  const hasExtras = (v) => addOnTotal(v) > 0 || v.leafCharge > 0 || (v.appliedServices || []).length > 1;
  const extrasVisits = done.filter(hasExtras).length;
  const extrasRate = done.length ? extrasVisits / done.length : null;

  // Plain mows, oldest first — the base for time numbers.
  const mows = done.filter((v) => v.durationSecs >= 60 && visitKind(v, mowIds, cleanupIds) === 'mow');
  const mowMins = mows.map((v) => v.durationSecs / 60);

  // 5 ── Trend: the last 3 mows against the ones before them ─────────────
  let trend = null;
  if (mowMins.length >= TREND_MIN_MOWS) {
    const recent = avg(mowMins.slice(-3));
    const earlier = avg(mowMins.slice(0, -3));
    const deltaMins = recent - earlier;
    const real = Math.abs(deltaMins) >= TREND_MIN_MINS && Math.abs(deltaMins) >= earlier * TREND_MIN_PCT;
    trend = { recentMins: recent, earlierMins: earlier, deltaMins, direction: !real ? 'steady' : deltaMins > 0 ? 'slower' : 'faster' };
  }

  // 6 ── Consistency: shortest, usual, longest ───────────────────────────
  const consistency = mowMins.length
    ? { minMins: Math.min(...mowMins), usualMins: median(mowMins), maxMins: Math.max(...mowMins), count: mowMins.length }
    : null;
  if (consistency) consistency.swingPct = consistency.usualMins > 0 ? (consistency.maxMins - consistency.minMins) / consistency.usualMins : 0;

  // 7 ── Against similar-size lawns (difficulty removed, like the slow flag)
  let vsSimilar = null;
  const sqft = parseLawnSizeToSqFt(customer.lawnSize);
  if (model && sqft && mowMins.length) {
    const obstacles = parseInt(customer.obstacleCount, 10) || 0;
    const normalized = mowMins.map((m) => {
      let n = m - obstacles * 1.5 - (customer.fencedBackyard ? 3 : 0);
      if (customer.terrain === 'moderate') n /= 1.15;
      else if (customer.terrain === 'hilly') n /= 1.3;
      return Math.max(0.5, n);
    });
    const actualMins = avg(normalized);
    const expectedMins = predictTrendMins(model, sqft);
    vsSimilar = { actualMins, expectedMins, ratio: expectedMins > 0 ? actualMins / expectedMins : null, sqft };
  }

  // 8 ── Days between mowing visits vs the plan ──────────────────────────
  // Every visit that cut the grass counts (leaf jobs too). A gap over three
  // planned intervals is a break in service, not a cadence, and is left out.
  const plannedDays = Number(customer.mowingInterval) || Number(customer.serviceInterval) || 7;
  const cuts = done.filter((v) => ['mow', 'leaf'].includes(visitKind(v, mowIds, cleanupIds)));
  const gaps = [];
  for (let i = 1; i < cuts.length; i++) {
    const g = (when(cuts[i]) - when(cuts[i - 1])) / DAY;
    if (g >= 0.5 && g <= plannedDays * 3) gaps.push(g);
  }
  const cadence = gaps.length ? { avgDays: avg(gaps), plannedDays, gaps: gaps.length } : null;

  // 9 ── Skips ───────────────────────────────────────────────────────────
  const skipCount = season.filter((v) => v.status === 'skipped').length;
  let skipStreak = 0;
  for (let i = season.length - 1; i >= 0 && season[i].status === 'skipped'; i--) skipStreak += 1;

  // 10 ── Cuts this season vs what the plan would have given ─────────────
  let cutsVsExpected = null;
  if (cuts.length >= 2) {
    const span = (when(cuts[cuts.length - 1]) - when(cuts[0])) / DAY;
    const expected = Math.round(span / plannedDays) + 1;
    cutsVsExpected = { actual: cuts.length, expected, missed: Math.max(0, expected - cuts.length) };
  }

  // 12 ── Leaf history ───────────────────────────────────────────────────
  const leafJobs = done.filter((v) => visitKind(v, mowIds, cleanupIds) === 'leaf');
  const cleanups = done.filter((v) => visitKind(v, mowIds, cleanupIds) === 'cleanup');
  const leafMinsKnown = leafJobs.filter((v) => v.leafSecs != null).map((v) => v.leafSecs / 60);
  const leaf = {
    jobs: leafJobs.length,
    cleanups: cleanups.length,
    avgLeafMins: avg(leafMinsKnown),
    charged: round2(leafJobs.reduce((s, v) => s + (v.leafCharge || 0), 0)),
    suggested: round2(leafJobs.reduce((s, v) => s + (v.leafSuggested || 0), 0)),
    cleanupRevenue: round2(cleanups.reduce((s, v) => s + (v.priceEarned || 0), 0)),
    undecided: [...leafJobs, ...cleanups].filter((v) => !v.leafDecided).length,
  };

  // ── Flags: the reasons this customer needs a look ──────────────────────
  const flags = [];
  const money = (n) => `$${Math.round(n)}`;
  if (trend?.direction === 'slower') {
    flags.push({ key: 'slower', text: `Getting slower: ${Math.round(trend.recentMins)} min lately vs ${Math.round(trend.earlierMins)} min before` });
  }
  if (targetRate > 0 && rateWithDrive != null && timed.length >= MIN_VISITS_FOR_RATE && rateWithDrive < targetRate) {
    flags.push({ key: 'rate', text: `${money(rateWithDrive)}/hr with drive time — under your ${money(targetRate)}/hr target` });
  }
  if (skipStreak >= 2) flags.push({ key: 'skips', text: `Skipped ${skipStreak} times in a row` });
  else if (skipCount >= 3) flags.push({ key: 'skips', text: `${skipCount} skips this season` });
  if (cadence && cadence.gaps >= 2 && cadence.avgDays > plannedDays * CADENCE_SLACK) {
    flags.push({ key: 'cadence', text: `Cut every ${cadence.avgDays.toFixed(1)} days — planned every ${plannedDays}` });
  }
  if (cutsVsExpected && cutsVsExpected.missed >= 2) {
    flags.push({ key: 'missed', text: `${cutsVsExpected.actual} cuts this season — ${cutsVsExpected.expected} planned` });
  }
  if (consistency && consistency.count >= TREND_MIN_MOWS && consistency.swingPct > SWING_PCT) {
    flags.push({ key: 'swing', text: `Time swings from ${Math.round(consistency.minMins)} to ${Math.round(consistency.maxMins)} min` });
  }
  if (vsSimilar?.ratio >= SLOW_VS_SIMILAR && mowMins.length >= MIN_VISITS_FOR_RATE && !customer.slowMowExpected) {
    flags.push({ key: 'similar', text: `${vsSimilar.ratio.toFixed(1)}× the time of similar-size lawns` });
  }
  if (leaf.undecided > 0) {
    flags.push({ key: 'leaf', text: `${leaf.undecided} leaf charge${leaf.undecided === 1 ? '' : 's'} to decide` });
  }

  return {
    customerId: customer.id, name: customer.name || 'Unknown',
    visits: done.length, revenue, revenueByService, rateByKind,
    rateWork, rateWithDrive, extrasVisits, extrasRate,
    trend, consistency, vsSimilar, cadence, plannedDays,
    skipCount, skipStreak, cutsVsExpected, leaf, flags,
  };
}

// Metrics for every customer with at least one visit this season, plus the
// shared trend curve the "similar lawns" comparison needs.
export function buildCustomerMetrics(customers, visits, { now = Date.now(), targetRate = 0, defaultServices = [] } = {}) {
  const model = calculatePowerModel(visits, customers);
  const mowIds = mowingServiceIds();
  const cleanupIds = cleanupServiceIds();
  const byCustomer = new Map();
  visits.forEach((v) => {
    if (!byCustomer.has(v.customerId)) byCustomer.set(v.customerId, []);
    byCustomer.get(v.customerId).push(v);
  });
  return customers
    .filter((c) => byCustomer.has(c.id))
    .map((c) => computeCustomerMetrics(c, byCustomer.get(c.id), { now, targetRate, defaultServices, model, mowIds, cleanupIds }))
    .filter((m) => m.visits > 0 || m.skipCount > 0);
}

// One row per customer for a spreadsheet.
export const METRICS_CSV_HEADERS = [
  'Customer', 'Visits', 'Season Revenue', '$/hr (job time)', '$/hr (with drive)', 'Extras %',
  'Usual Mow Min', 'Shortest Min', 'Longest Min', 'Trend', 'Trend Min', 'Vs Similar Lawns',
  'Days Between Cuts', 'Planned Days', 'Cuts', 'Cuts Planned', 'Skips', 'Skips In A Row',
  'Leaf Jobs', 'Clean-ups', 'Avg Leaf Min', 'Leaf Charged', 'Leaf Suggested', 'Needs A Look',
];
export function metricsCsvRow(m) {
  const n = (v, d = 0) => (v == null ? '' : Number(v).toFixed(d));
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return [
    q(m.name), m.visits, n(m.revenue, 2), n(m.rateWork), n(m.rateWithDrive),
    m.extrasRate == null ? '' : Math.round(m.extrasRate * 100),
    n(m.consistency?.usualMins), n(m.consistency?.minMins), n(m.consistency?.maxMins),
    m.trend?.direction || '', m.trend ? n(m.trend.deltaMins, 1) : '', m.vsSimilar?.ratio ? n(m.vsSimilar.ratio, 2) : '',
    n(m.cadence?.avgDays, 1), m.plannedDays, m.cutsVsExpected?.actual ?? '', m.cutsVsExpected?.expected ?? '',
    m.skipCount, m.skipStreak,
    m.leaf.jobs, m.leaf.cleanups, n(m.leaf.avgLeafMins), n(m.leaf.charged, 2), n(m.leaf.suggested, 2),
    q(m.flags.map((f) => f.text).join('; ')),
  ].join(',');
}
