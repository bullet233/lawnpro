import { describe, it, expect } from 'vitest';
import { isMowVisit, isCleanupVisit, computeCleanupSuggestion, isLeafVisit, comparableVisits, leafSummary, leafRollup, findPossibleLeafVisits, isLeafSeasonDate, leafToolsVisible, computeLeafBilling, leafBillingLines } from './leaves';
import { getVisitRevenueBreakdown } from './revenueUtils';

describe('mow visit vs. clean-up', () => {
  const ids = ['s1'];
  it('counts a visit as a mow only when a mowing service was done', () => {
    expect(isMowVisit({ appliedServices: ['s1'] }, ids)).toBe(true);
    expect(isMowVisit({ appliedServices: ['s1', 's4'] }, ids)).toBe(true);
    expect(isMowVisit({ appliedServices: ['s4'] }, ids)).toBe(false);   // Fall Clean-up only
    expect(isMowVisit({ appliedServices: [] }, ids)).toBe(true);        // nothing recorded = mow
    expect(isMowVisit({}, ids)).toBe(true);
  });

  it('never asks whether a Fall Clean-up was a leaf job, or uses it as a mow baseline', () => {
    const NOW = new Date('2026-11-10T18:00:00').getTime();
    const DAY = 86400000;
    const v = (id, mins, daysAgo, appliedServices) => ({
      id, customerId: 1, status: 'completed', durationSecs: mins * 60, division: 'mowing',
      exitTime: NOW - daysAgo * DAY - 3600000, appliedServices,
    });
    const mows = [v(1, 30, 21, ['s1']), v(2, 30, 14, ['s1']), v(3, 30, 7, ['s1'])];
    // a 2-hour clean-up today: not a candidate
    expect(findPossibleLeafVisits([...mows, v(4, 120, 0, ['s4'])], NOW)).toHaveLength(0);
    // and it does not drag the baseline up: a 50-min mow after it is still asked about
    const found = findPossibleLeafVisits([...mows, v(4, 120, 1, ['s4']), v(5, 50, 0, ['s1'])], NOW);
    expect(found).toHaveLength(1);
    expect(found[0].avgSecs).toBe(1800);
  });
});

describe('clean-up (no mow)', () => {
  const ids = ['s1'];
  it('is a mowing-division visit done with a clean-up service and no mow', () => {
    expect(isCleanupVisit({ division: 'mowing', appliedServices: ['s4'] }, ids)).toBe(true);
    expect(isCleanupVisit({ appliedServices: ['s4'] }, ids)).toBe(true);
    // trim-only / edging-only is not a clean-up
    expect(isCleanupVisit({ division: 'mowing', appliedServices: ['s2'] }, ids)).toBe(false);
    expect(isCleanupVisit({ division: 'mowing', appliedServices: ['s2', 's4'] }, ids)).toBe(true);
    // a renamed / custom clean-up template passed in explicitly
    expect(isCleanupVisit({ division: 'mowing', appliedServices: ['x9'] }, ids, ['x9'])).toBe(true);
    expect(isCleanupVisit({ division: 'mowing', appliedServices: ['s1', 's4'] }, ids)).toBe(false);
    expect(isCleanupVisit({ division: 'mowing', appliedServices: [] }, ids)).toBe(false);
    expect(isCleanupVisit({ division: 'fertilizer', appliedServices: ['s3'] }, ids)).toBe(false);
  });

  it('suggests the whole visit at the hourly rate', () => {
    expect(computeCleanupSuggestion(125 * 60, 75)).toEqual({ leafSecs: 7500, leafCharge: 156.25 });
    expect(computeCleanupSuggestion(125 * 60, 0)).toEqual({ leafSecs: 7500, leafCharge: 0 });
  });

  it('is listed for billing with its whole price as the charge', () => {
    const r = leafBillingLines([
      { id: 1, customerId: 7, status: 'completed', durationSecs: 7500, division: 'mowing',
        appliedServices: ['s4'], priceEarned: 150, leafSuggested: 156.25, exitTime: 1000 },
    ]);
    expect(r.visits).toBe(1);
    expect(r.customers[0].visits[0].cleanup).toBe(true);
    expect(r.leafSecs).toBe(7500);
    expect(r.leafCharge).toBe(150);
    expect(r.leafSuggested).toBe(156.25);
    expect(r.undecided).toBe(1);
  });
});

describe('leaf billing', () => {
  it('bills the minutes over the usual mow at the hourly rate', () => {
    // 56 min job on a 30 min lawn at $75/hr: 26 min = $32.50
    expect(computeLeafBilling(56 * 60, 30 * 60, 75)).toEqual({ leafSecs: 26 * 60, leafCharge: 32.5 });
  });

  it('never bills negative time and rounds to the minute and the cent', () => {
    expect(computeLeafBilling(25 * 60, 30 * 60, 75)).toEqual({ leafSecs: 0, leafCharge: 0 });
    // 10 min 20 s over -> 10 min; 10/60 * 70 = 11.666 -> 11.67
    expect(computeLeafBilling(40 * 60 + 20, 30 * 60, 70)).toEqual({ leafSecs: 600, leafCharge: 11.67 });
  });

  it('records leaf time but no charge when no rate is set', () => {
    expect(computeLeafBilling(56 * 60, 30 * 60, 0)).toEqual({ leafSecs: 26 * 60, leafCharge: 0 });
  });

  it('cannot measure a lawn with no normal mow on record', () => {
    expect(computeLeafBilling(56 * 60, null, 75)).toEqual({ leafSecs: null, leafCharge: 0 });
  });

  it('lists what to bill each customer for a period', () => {
    const OCT = new Date(2026, 9, 1).getTime();
    const NOV = new Date(2026, 10, 1).getTime();
    const lv = (id, customerId, day, leafSecs, leafCharge) => ({
      id, customerId, status: 'completed', durationSecs: 3000, conditions: ['leaves'],
      exitTime: new Date(2026, 9, day, 12).getTime(), leafSecs, leafCharge,
    });
    const r = leafBillingLines([
      lv(1, 7, 3, 1560, 32.5), lv(2, 7, 10, 1200, 25),
      lv(3, 8, 5, null, 0),
      { ...lv(4, 7, 3, 600, 12.5), exitTime: NOV + 1000 },          // next month
      { ...lv(5, 7, 4, 0, 0), conditions: [] },                      // not a leaf job
    ], { from: OCT, to: NOV });
    expect(r.visits).toBe(3);
    expect(r.leafCharge).toBe(57.5);
    expect(r.undecided).toBe(3);   // none carry leafDecided yet
    const seven = r.customers.find((c) => c.customerId === 7);
    expect(seven.leafSecs).toBe(2760);
    expect(seven.visits.map((v) => v.id)).toEqual([1, 2]);
    expect(r.customers.find((c) => c.customerId === 8).unmeasured).toBe(1);
  });

  it('shows the leaf charge as its own revenue line, not mowing', () => {
    const visit = { priceEarned: 77.5, leafCharge: 32.5, appliedServices: ['s1'] };
    expect(getVisitRevenueBreakdown(visit, null, [])).toEqual({ s1: 45, Leaves: 32.5 });
    expect(getVisitRevenueBreakdown({ priceEarned: 45, appliedServices: ['s1'] }, null, [])).toEqual({ s1: 45 });
  });
});

describe('findPossibleLeafVisits', () => {
  const NOW = new Date('2026-10-15T18:00:00').getTime();
  const DAY = 86400000;
  let id = 5000;
  const mow = (customerId, mins, daysAgo, extra = {}) => ({
    id: id++, customerId, status: 'completed', durationSecs: mins * 60,
    exitTime: NOW - daysAgo * DAY - 3600000, division: 'mowing', ...extra,
  });
  const history = [mow(1, 30, 21), mow(1, 30, 14), mow(1, 30, 7)];

  it('asks about a fall mow that ran well over the usual time', () => {
    const long = mow(1, 50, 0);
    const found = findPossibleLeafVisits([...history, long], NOW);
    expect(found).toHaveLength(1);
    expect(found[0].visit.id).toBe(long.id);
    expect(found[0].avgSecs).toBe(1800);
    expect(found[0].extraSecs).toBe(1200);
  });

  it('does not ask about normal times, small overruns, or thin history', () => {
    expect(findPossibleLeafVisits([...history, mow(1, 33, 0)], NOW)).toHaveLength(0);
    // 10-min lawn running 14 min: 40% over but under the 5-minute minimum
    const small = [mow(2, 10, 21), mow(2, 10, 14), mow(2, 10, 7), mow(2, 14, 0)];
    expect(findPossibleLeafVisits(small, NOW)).toHaveLength(0);
    expect(findPossibleLeafVisits([mow(3, 30, 7), mow(3, 60, 0)], NOW)).toHaveLength(0);
  });

  it('does not ask twice, about tagged visits, old visits, or other divisions', () => {
    const all = [
      ...history,
      mow(1, 50, 0, { leafChecked: true }),
      mow(1, 50, 0, { conditions: ['leaves'] }),
      mow(1, 50, 5),
      mow(1, 50, 0, { division: 'fertilizer' }),
    ];
    expect(findPossibleLeafVisits(all, NOW)).toHaveLength(0);
  });

  it('leaf tools show Oct 1 – Dec 1 on Auto, and follow the override', () => {
    const at = (s) => new Date(s).getTime();
    expect(isLeafSeasonDate(at('2026-10-01T00:30:00'))).toBe(true);
    expect(isLeafSeasonDate(at('2026-12-01T23:00:00'))).toBe(true);
    expect(isLeafSeasonDate(at('2026-09-30T23:00:00'))).toBe(false);
    expect(isLeafSeasonDate(at('2026-12-02T00:30:00'))).toBe(false);

    const JULY = at('2026-07-15T12:00:00');
    const NOV = at('2026-11-10T12:00:00');
    expect(leafToolsVisible(JULY, 'auto')).toBe(false);
    expect(leafToolsVisible(NOV, 'auto')).toBe(true);
    expect(leafToolsVisible(NOV, undefined)).toBe(true);
    expect(leafToolsVisible(JULY, 'show')).toBe(true);
    expect(leafToolsVisible(NOV, 'hide')).toBe(false);
  });
});

let nextId = 1;
const visit = (customerId, mins, extra = {}) => ({
  id: nextId++, customerId, status: 'completed', durationSecs: mins * 60,
  exitTime: 1_800_000_000_000, division: 'mowing', priceEarned: 50, ...extra,
});
const leaf = (customerId, mins, extra = {}) => visit(customerId, mins, { conditions: ['leaves'], ...extra });

describe('isLeafVisit', () => {
  it('reads the leaves job condition', () => {
    expect(isLeafVisit(leaf(1, 50))).toBe(true);
    expect(isLeafVisit(visit(1, 30, { conditions: ['wet', 'leaves'] }))).toBe(true);
    expect(isLeafVisit(visit(1, 30))).toBe(false);
    expect(isLeafVisit(visit(1, 30, { conditions: ['wet'] }))).toBe(false);
    expect(isLeafVisit(null)).toBe(false);
  });
});

describe('comparableVisits', () => {
  const mows = [visit(1, 30), visit(1, 32)];
  const leaves = [leaf(1, 55), leaf(1, 60)];

  it('keeps leaf visits out of a plain mow comparison', () => {
    expect(comparableVisits([...mows, ...leaves], false)).toEqual(mows);
  });

  it('compares a leaf job with the other leaf jobs', () => {
    expect(comparableVisits([...mows, ...leaves], true)).toEqual(leaves);
  });

  it('falls back to plain mows for the first leaf job of the season', () => {
    expect(comparableVisits(mows, true)).toEqual(mows);
  });

  it('offers no plain-mow time for a lawn only ever done with leaves', () => {
    expect(comparableVisits(leaves, false)).toEqual([]);
  });
});

describe('leafSummary', () => {
  it('works out leaf time as the extra over the usual mow', () => {
    const s = leafSummary([visit(1, 30), visit(1, 30), leaf(1, 50), leaf(1, 60)]);
    expect(s.mowAvgSecs).toBe(1800);
    expect(s.leafAvgSecs).toBe(3300);
    expect(s.extraSecs).toBe(1500);          // 25 min per leaf visit
    expect(s.totalExtraSecs).toBe(3000);     // across both
    expect(s.leafCount).toBe(2);
    expect(s.leafRevenue).toBe(100);
  });

  it('never reports negative leaf time', () => {
    const s = leafSummary([visit(1, 30), leaf(1, 25)]);
    expect(s.extraSecs).toBe(0);
  });

  it('has no leaf time for a lawn with no plain mow to compare with', () => {
    const s = leafSummary([leaf(1, 50)]);
    expect(s.leafAvgSecs).toBe(3000);
    expect(s.extraSecs).toBeNull();
    expect(s.totalExtraSecs).toBeNull();
  });

  it('ignores skipped and untimed visits', () => {
    const s = leafSummary([visit(1, 30), visit(1, 0), leaf(1, 50, { status: 'skipped' }), leaf(1, 50)]);
    expect(s.mowCount).toBe(1);
    expect(s.leafCount).toBe(1);
  });
});

describe('leafRollup', () => {
  const SEASON = 1_790_000_000_000;

  it('totals leaf time across lawns for the season', () => {
    const r = leafRollup([
      visit(1, 30), leaf(1, 50), leaf(1, 50),   // +20 min x2
      visit(2, 20), leaf(2, 30),                // +10 min
      visit(3, 40),                             // no leaf visits — not a leaf lawn
    ], { since: SEASON });
    expect(r.leafVisits).toBe(3);
    expect(r.totalExtraSecs).toBe(3000);
    expect(r.lawns.map((l) => l.customerId)).toEqual([1, 2]);
    expect(r.unmeasuredLawns).toBe(0);
  });

  it('leaves out last year\'s leaf visits but still uses old mows as the baseline', () => {
    const r = leafRollup([
      visit(1, 30, { exitTime: SEASON - 1000 }),
      leaf(1, 90, { exitTime: SEASON - 1000 }),
      leaf(1, 50),
    ], { since: SEASON });
    expect(r.leafVisits).toBe(1);
    expect(r.totalExtraSecs).toBe(1200);
  });

  it('counts lawns it cannot measure and skips other divisions', () => {
    const r = leafRollup([
      leaf(1, 50),
      visit(2, 10, { division: 'fertilizer', conditions: ['leaves'] }),
    ], { since: SEASON });
    expect(r.leafVisits).toBe(1);
    expect(r.unmeasuredLawns).toBe(1);
    expect(r.totalExtraSecs).toBe(0);
  });
});
