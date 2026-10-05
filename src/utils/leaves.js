import { getSettings } from '../db/settings';

// Fall leaf pickup happens in the same pass as the mow — one job, one clock —
// so there is no separate leaf time to record. Instead the visit is tagged
// (a job condition, like Overgrown or Wet), kept out of every plain-mowing
// number, and its leaf time is worked out afterwards as "how much longer than
// this lawn's usual mow".
//
// Not every lawn on a route has leaves down, so nothing is tagged by default:
// the driver marks a job as a leaf job before it (route list), during it (live
// timer) or after it (job-complete card, Home "Leaves?" check, Edit Visit).

// ── Mow visit vs. anything else ──────────────────────────────────────────
// An end-of-season Fall Clean-up (or any visit logged without a mowing
// service) is not a mow: it has nothing to do with the lawn's usual mow time
// and must not be averaged into it. A visit with no services recorded counts
// as a mow (older data, and the app's default).
export function mowingServiceIds() {
  const ids = (getSettings().defaultServices || [])
    .filter((s) => s.category === 'Mowing').map((s) => s.id);
  return ids.includes('s1') ? ids : [...ids, 's1'];
}

export function isMowVisit(v, ids = mowingServiceIds()) {
  if (!v?.appliedServices || v.appliedServices.length === 0) return true;
  return v.appliedServices.some((id) => ids.includes(id));
}

// The clean-up services: Fall Clean-up ('s4') and any service template named
// like one ("…clean…", "…leaf…"). Other non-mowing services (edging, trimming)
// are NOT clean-ups — a trim-only visit is just a flat-price visit.
export function cleanupServiceIds() {
  const ids = (getSettings().defaultServices || [])
    .filter((s) => /clean|leaf/i.test(s.name || '')).map((s) => s.id);
  return ids.includes('s4') ? ids : [...ids, 's4'];
}

// A clean-up: a mowing-division visit done with a clean-up service and no
// mowing (Fall Clean-up picked in place of Mowing). The whole visit is leaf
// work, so its hourly suggestion is the whole visit × the leaf rate — offered
// as an alternative to the service's flat price, never applied automatically.
export function isCleanupVisit(v, ids = mowingServiceIds(), cleanupIds = cleanupServiceIds()) {
  return !!v && (!v.division || v.division === 'mowing') &&
    Array.isArray(v.appliedServices) && !isMowVisit(v, ids) &&
    v.appliedServices.some((id) => cleanupIds.includes(id));
}

export function computeCleanupSuggestion(durationSecs, hourlyRate) {
  const mins = Math.max(0, Math.round((durationSecs || 0) / 60));
  const rate = Number(hourlyRate) > 0 ? Number(hourlyRate) : 0;
  return { leafSecs: mins * 60, leafCharge: Math.round((mins / 60) * rate * 100) / 100 };
}

export const LEAF_CONDITION = 'leaves';

export const isLeafVisit = (v) =>
  Array.isArray(v?.conditions) && v.conditions.includes(LEAF_CONDITION);

// ── Leaf billing ─────────────────────────────────────────────────────────
// The hourly leaf rate gives a SUGGESTED charge, on top of the mow price; the
// driver decides what is actually charged (see utils/leafBilling). The leaf
// time for a visit is how long it ran over that lawn's usual plain mow,
// rounded to the minute. With no plain mow on record there is nothing to
// measure against: leafSecs comes back null and the suggestion is $0.
export const LEAF_REVENUE_KEY = 'Leaves'; // line name in revenue breakdowns

export function computeLeafBilling(durationSecs, usualMowSecs, hourlyRate) {
  if (!usualMowSecs || !durationSecs) return { leafSecs: null, leafCharge: 0 };
  const leafMins = Math.max(0, Math.round((durationSecs - usualMowSecs) / 60));
  const rate = Number(hourlyRate) > 0 ? Number(hourlyRate) : 0;
  return { leafSecs: leafMins * 60, leafCharge: Math.round((leafMins / 60) * rate * 100) / 100 };
}

// Leaf jobs for billing, per customer: each visit with its stored leaf time,
// suggested charge and what was actually charged, plus totals and how many
// are still undecided. `from`/`to` are timestamps (to is exclusive).
export function leafBillingLines(allVisits, { from = 0, to = Infinity } = {}) {
  // Clean-ups are listed too (cleanup: true). Their "charge" is the visit's
  // whole price — the flat service price until an hourly amount is chosen.
  const byCust = new Map();
  const ids = mowingServiceIds();
  (allVisits || []).forEach((v) => {
    if (v.status !== 'completed') return;
    const cleanup = isCleanupVisit(v, ids);
    if (!cleanup && !isLeafVisit(v)) return;
    if (v.exitTime < from || v.exitTime >= to) return;
    if (!byCust.has(v.customerId)) byCust.set(v.customerId, []);
    byCust.get(v.customerId).push(cleanup
      ? { ...v, cleanup: true, leafSecs: v.leafSecs ?? v.durationSecs, leafCharge: v.priceEarned || 0 }
      : v);
  });
  const customers = [];
  byCust.forEach((visits, customerId) => {
    visits.sort((a, b) => a.exitTime - b.exitTime);
    customers.push({
      customerId,
      visits,
      leafSecs: visits.reduce((s, v) => s + (v.leafSecs || 0), 0),
      leafCharge: Math.round(visits.reduce((s, v) => s + (v.leafCharge || 0), 0) * 100) / 100,
      leafSuggested: Math.round(visits.reduce((s, v) => s + (v.leafSuggested || 0), 0) * 100) / 100,
      undecided: visits.filter((v) => !v.leafDecided).length,
      unmeasured: visits.filter((v) => v.leafSecs == null).length,
    });
  });
  return {
    customers,
    leafSecs: customers.reduce((s, c) => s + c.leafSecs, 0),
    leafCharge: Math.round(customers.reduce((s, c) => s + c.leafCharge, 0) * 100) / 100,
    leafSuggested: Math.round(customers.reduce((s, c) => s + c.leafSuggested, 0) * 100) / 100,
    undecided: customers.reduce((s, c) => s + c.undecided, 0),
    visits: customers.reduce((s, c) => s + c.visits.length, 0),
  };
}

// ── Today's leaf jobs ────────────────────────────────────────────────────
// Lawns marked "leaf job" before or during the job, held until the visit is
// logged. Saved so an app reload mid-route keeps them; a new day starts empty.
const LEAF_JOBS_KEY = 'lawnpro_leaf_jobs';
const dayKey = (now) => new Date(now).toLocaleDateString('en-CA');

export function loadLeafJobs(now = Date.now()) {
  try {
    const saved = JSON.parse(localStorage.getItem(LEAF_JOBS_KEY) || 'null');
    if (saved && saved.day === dayKey(now) && Array.isArray(saved.ids)) return saved.ids;
  } catch { /* corrupt or unavailable — start empty */ }
  return [];
}

export function saveLeafJobs(ids, now = Date.now()) {
  try {
    localStorage.setItem(LEAF_JOBS_KEY, JSON.stringify({ day: dayKey(now), ids }));
  } catch { /* storage unavailable — the tag still works until reload */ }
}

// ── "Was this a leaf job?" ───────────────────────────────────────────────
// Mows that ran well over the lawn's usual time during leaf season and were
// not tagged — most likely a leaf job the driver forgot to mark. Flag-only:
// Home asks, the driver answers Yes (tag it) or No (leafChecked, never asked
// again). Home only shows the question while leafToolsVisible() — outside
// fall a long mow is just a long mow.
export const LEAF_ASK_RATIO = 1.3;          // 30%+ over the usual mow…
export const LEAF_ASK_MIN_EXTRA_SECS = 300; // …and at least 5 minutes over
export const LEAF_ASK_MIN_HISTORY = 3;
export const LEAF_ASK_WINDOW_DAYS = 2;      // today + 2 prior days

// Oct 1 – Dec 1: when leaves are down around here.
export function isLeafSeasonDate(ts) {
  const d = new Date(ts);
  const m = d.getMonth();
  return m === 9 || m === 10 || (m === 11 && d.getDate() === 1);
}

// Whether the leaf tools (the 🍂 buttons on the route list, Next Job card,
// live timer and job-complete card, and Home's "Were these leaf jobs?" check)
// are on screen. Settings → General → Leaf buttons: 'auto' follows the dates
// above, 'show' / 'hide' force it. This only shows or hides the tools — it
// never tags a visit. Edit Visit can always tag, whatever this says.
export function leafToolsVisible(now = Date.now(), mode = getSettings().leafButtons) {
  if (mode === 'show') return true;
  if (mode === 'hide') return false;
  return isLeafSeasonDate(now);
}

export function findPossibleLeafVisits(allVisits, now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const windowStart = d.getTime() - LEAF_ASK_WINDOW_DAYS * 86400000;
  const ids = mowingServiceIds();
  // Mows only — a Fall Clean-up is neither a leaf-job candidate nor a baseline.
  const isMowing = (v) => (!v.division || v.division === 'mowing') && isMowVisit(v, ids);
  const done = (allVisits || []).filter((v) => v.status === 'completed' && v.durationSecs > 0 && isMowing(v));
  return done
    .filter((v) => v.exitTime >= windowStart && !isLeafVisit(v) && !v.leafChecked)
    .map((v) => {
      const prior = done.filter((o) => o.customerId === v.customerId && o.id !== v.id && !isLeafVisit(o));
      if (prior.length < LEAF_ASK_MIN_HISTORY) return null;
      const avg = Math.round(prior.reduce((s, o) => s + o.durationSecs, 0) / prior.length);
      const extraSecs = v.durationSecs - avg;
      if (v.durationSecs < LEAF_ASK_RATIO * avg || extraSecs < LEAF_ASK_MIN_EXTRA_SECS) return null;
      return { visit: v, avgSecs: avg, extraSecs, priorCount: prior.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.visit.exitTime - a.visit.exitTime);
}

// The visits worth comparing a job against. A leaf job compares with the
// lawn's other leaf jobs once it has any; until then — and for every plain
// mow — only plain mows count. A lawn with nothing but leaf visits has no
// honest plain-mow time, so that comes back empty (callers fall back to the
// size-based estimate).
export function comparableVisits(visits, wantLeaf) {
  const list = visits || [];
  if (wantLeaf) {
    const leaf = list.filter(isLeafVisit);
    if (leaf.length > 0) return leaf;
  }
  return list.filter((v) => !isLeafVisit(v));
}

const timed = (v) => v.status === 'completed' && v.durationSecs > 0;
const avgSecs = (list) =>
  list.length > 0 ? Math.round(list.reduce((s, v) => s + v.durationSecs, 0) / list.length) : null;

// One lawn's leaf numbers. `visits` = that lawn's visits in the mowing
// division. extraSecs is the leaf time per visit: leaf average minus plain-mow
// average (null until the lawn has a plain mow to compare with; never below 0).
export function leafSummary(visits) {
  const done = (visits || []).filter(timed);
  const leaf = done.filter(isLeafVisit);
  const mow = done.filter((v) => !isLeafVisit(v));
  const leafAvgSecs = avgSecs(leaf);
  const mowAvgSecs = avgSecs(mow);
  const extraSecs = leafAvgSecs != null && mowAvgSecs != null
    ? Math.max(0, leafAvgSecs - mowAvgSecs)
    : null;
  return {
    leafCount: leaf.length,
    leafAvgSecs,
    mowCount: mow.length,
    mowAvgSecs,
    extraSecs,
    totalExtraSecs: extraSecs != null ? extraSecs * leaf.length : null,
    leafRevenue: leaf.reduce((s, v) => s + (v.priceEarned || 0), 0),
    leafSecs: leaf.reduce((s, v) => s + v.durationSecs, 0),
  };
}

// Every lawn's leaf numbers since `since` (leaf visits only — the plain-mow
// baseline always uses the lawn's whole history). Mowing division only.
export function leafRollup(allVisits, { since = 0 } = {}) {
  const byCust = new Map();
  const ids = mowingServiceIds();
  (allVisits || []).forEach((v) => {
    if (v.division && v.division !== 'mowing') return;
    if (!timed(v) || !isMowVisit(v, ids)) return;
    if (isLeafVisit(v) && v.exitTime < since) return;
    if (!byCust.has(v.customerId)) byCust.set(v.customerId, []);
    byCust.get(v.customerId).push(v);
  });
  const lawns = [];
  byCust.forEach((visits, customerId) => {
    const s = leafSummary(visits);
    if (s.leafCount > 0) lawns.push({ customerId, ...s });
  });
  const measured = lawns.filter((l) => l.extraSecs != null);
  return {
    lawns: lawns.sort((a, b) => (b.totalExtraSecs || 0) - (a.totalExtraSecs || 0)),
    leafVisits: lawns.reduce((s, l) => s + l.leafCount, 0),
    leafSecs: lawns.reduce((s, l) => s + l.leafSecs, 0),
    leafRevenue: lawns.reduce((s, l) => s + l.leafRevenue, 0),
    totalExtraSecs: measured.reduce((s, l) => s + l.totalExtraSecs, 0),
    measuredVisits: measured.reduce((s, l) => s + l.leafCount, 0),
    unmeasuredLawns: lawns.length - measured.length,
  };
}
