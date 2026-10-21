import { isScheduleAnchor, isSnoozed } from './scheduler';
import { mowSeasonState } from './mowSeason';
import { getDaysSince } from './dateUtils';

// The one answer to "when was this lawn last done, and is it due?" — used by
// Home, the Clients list, the Weekly Scheduler, the route list and the Live
// nearby prompt, so every screen agrees.
//
// Last done = the latest schedule anchor in the division: a completed visit or
// a deliberate "skip this cycle". Completed "visits" of 1–59 seconds are
// drive-pasts / double-logs and don't count (0 is a hand-logged visit with no
// time, which does). Mowing also follows the mowing season.

export const LATE_AFTER_DAYS = 2; // overdue by more than this reads as late (red)

const isRealAnchor = (v) => isScheduleAnchor(v) &&
  !(v.status === 'completed' && v.durationSecs > 0 && v.durationSecs < 60);

export function visitInDivision(v, division, { mowIds = ['s1'], fertIds = ['s3'] } = {}) {
  if (v.division) return v.division === division;
  const ids = v.appliedServices || [];
  if (division === 'mowing') return ids.length === 0 || ids.some((id) => mowIds.includes(id));
  return ids.some((id) => fertIds.includes(id));
}

export const intervalFor = (customer, division) => (division === 'fertilizer'
  ? (Number(customer.fertilizerInterval) || 30)
  : (Number(customer.mowingInterval) || Number(customer.serviceInterval) || 7));

// status: 'snoozed' | 'offSeason' | 'new' (never done) | 'firstCut' (not done
//         yet this season) | 'overdue' | 'dueToday' | 'ok'
export function serviceDue(customer, visits, {
  division = 'mowing', now = Date.now(), season = null, mowIds, fertIds, beforeTs = Infinity,
} = {}) {
  const mine = (visits || []).filter((v) => v.customerId === customer.id && v.exitTime && v.exitTime < beforeTs &&
    isRealAnchor(v) && visitInDivision(v, division, { mowIds, fertIds }));
  const last = mine.length ? mine.reduce((a, b) => (b.exitTime > a.exitTime ? b : a)) : null;
  const lastTs = last?.exitTime ?? null;
  const daysSince = lastTs ? getDaysSince(lastTs) : null;
  const intervalDays = intervalFor(customer, division);
  const base = { lastTs, daysSince, intervalDays, lastWasSkip: last?.status === 'skipped', overdueDays: 0 };

  if (isSnoozed(customer, now)) return { ...base, status: 'snoozed' };
  if (division === 'mowing') {
    const st = season || mowSeasonState(now);
    if (!st.inSeason) return { ...base, status: 'offSeason' };
    if (lastTs == null) return { ...base, status: 'new' };
    if (lastTs < st.seasonStart) return { ...base, status: 'firstCut' };
  } else if (lastTs == null) {
    return { ...base, status: 'new' };
  }
  if (daysSince > intervalDays) return { ...base, status: 'overdue', overdueDays: daysSince - intervalDays };
  if (daysSince === intervalDays) return { ...base, status: 'dueToday' };
  return { ...base, status: 'ok' };
}

export const isLate = (d) => d.status === 'overdue' && d.overdueDays > LATE_AFTER_DAYS;
export const needsService = (d) => ['overdue', 'dueToday', 'firstCut', 'new'].includes(d.status);

// "cut 8d ago" / "cut today" / "never" — the short label used on stop rows.
export function lastDoneLabel(d, verb = 'cut') {
  if (d.lastTs == null) return 'never done';
  if (d.daysSince === 0) return `${verb} today`;
  if (d.daysSince === 1) return `${verb} yesterday`;
  return `${verb} ${d.daysSince}d ago`;
}
