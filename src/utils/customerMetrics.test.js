import { describe, it, expect } from 'vitest';
import { computeCustomerMetrics, visitKind, metricsCsvRow, METRICS_CSV_HEADERS } from './customerMetrics';

const NOW = new Date('2026-10-04T18:00:00').getTime();
const DAY = 86400000;
const cust = { id: 1, name: 'Anderson', mowingInterval: 7, services: [{ id: 's1', name: 'Mowing', price: 40 }, { id: 's4', name: 'Fall Clean-up', price: 150 }] };
const opts = { now: NOW, targetRate: 60, mowIds: ['s1'], cleanupIds: ['s4'] };
let nextId = 1;
const visit = (daysAgo, mins, extra = {}) => ({
  id: nextId++, customerId: 1, status: 'completed', division: 'mowing', appliedServices: ['s1'],
  durationSecs: mins * 60, driveTimeSecs: 600, priceEarned: 40, exitTime: NOW - daysAgo * DAY, ...extra,
});
const weekly = (minsList) => minsList.map((m, i) => visit((minsList.length - i) * 7, m));

describe('visitKind', () => {
  it('sorts visits into mow, leaf job, clean-up, fertilizer and other', () => {
    expect(visitKind({ appliedServices: ['s1'] }, ['s1'], ['s4'])).toBe('mow');
    expect(visitKind({ appliedServices: ['s1'], conditions: ['leaves'] }, ['s1'], ['s4'])).toBe('leaf');
    expect(visitKind({ appliedServices: ['s4'], division: 'mowing' }, ['s1'], ['s4'])).toBe('cleanup');
    expect(visitKind({ appliedServices: ['s2'], division: 'mowing' }, ['s1'], ['s4'])).toBe('other');
    expect(visitKind({ appliedServices: ['s3'], division: 'fertilizer' }, ['s1'], ['s4'])).toBe('fertilizer');
  });
});

describe('computeCustomerMetrics', () => {
  it('splits season revenue by service, leaf charges and add-ons', () => {
    const visits = [
      visit(21, 30),
      visit(14, 60, { conditions: ['leaves'], priceEarned: 65, leafCharge: 25, leafDecided: true, leafSecs: 1800, leafSuggested: 30 }),
      visit(7, 90, { appliedServices: ['s4'], priceEarned: 150 }),
      visit(3, 30, { priceEarned: 55, addOns: [{ id: 'a', name: 'Bush trim', price: 15 }] }),
      visit(400, 30), // last year: not this season
    ];
    const m = computeCustomerMetrics(cust, visits, opts);
    expect(m.visits).toBe(4);
    expect(m.revenue).toBe(310);
    const line = (name) => m.revenueByService.find((r) => r.name === name)?.amount;
    expect(line('Mowing')).toBe(120);
    expect(line('Leaf charges')).toBe(25);
    expect(line('Fall Clean-up')).toBe(150);
    expect(line('Add-ons')).toBe(15);
    expect(m.extrasVisits).toBe(2);
    expect(m.extrasRate).toBe(0.5);
  });

  it('rates each kind of work on its own, and the lawn with and without the drive', () => {
    const visits = [visit(21, 30), visit(14, 30), visit(7, 90, { appliedServices: ['s4'], priceEarned: 150 })];
    const m = computeCustomerMetrics(cust, visits, opts);
    expect(m.rateByKind.find((k) => k.kind === 'mow').rate).toBe(80);
    expect(m.rateByKind.find((k) => k.kind === 'cleanup').rate).toBe(100);
    expect(Math.round(m.rateWork)).toBe(92);          // $230 over 2.5 h
    expect(Math.round(m.rateWithDrive)).toBe(77);     // …plus 30 min of driving
  });

  it('spots a lawn that is getting slower, and leaves leaf jobs out of it', () => {
    const steady = computeCustomerMetrics(cust, weekly([30, 31, 29, 30, 31, 30]), opts);
    expect(steady.trend.direction).toBe('steady');
    const slower = computeCustomerMetrics(cust, weekly([30, 30, 30, 38, 40, 42]), opts);
    expect(slower.trend.direction).toBe('slower');
    expect(Math.round(slower.trend.deltaMins)).toBe(10);
    expect(slower.flags.some((f) => f.key === 'slower')).toBe(true);
    // the same long visits tagged as leaf jobs are not a slowdown
    const leafy = weekly([30, 30, 30, 30, 30, 60, 60, 60]).map((v, i) => (i >= 5 ? { ...v, conditions: ['leaves'] } : v));
    expect(computeCustomerMetrics(cust, leafy, opts).trend.direction).toBe('steady');
    // too few mows: no trend at all
    expect(computeCustomerMetrics(cust, weekly([30, 45, 50]), opts).trend).toBe(null);
  });

  it('reports shortest, usual and longest mow', () => {
    const m = computeCustomerMetrics(cust, weekly([20, 30, 30, 32, 50]), opts);
    expect(m.consistency).toMatchObject({ minMins: 20, usualMins: 30, maxMins: 50, count: 5 });
    expect(m.flags.some((f) => f.key === 'swing')).toBe(true);
  });

  it('compares days between cuts with the plan, ignoring a break in service', () => {
    const onPlan = computeCustomerMetrics(cust, weekly([30, 30, 30, 30]), opts);
    expect(onPlan.cadence.avgDays).toBe(7);
    expect(onPlan.cutsVsExpected).toMatchObject({ actual: 4, expected: 4, missed: 0 });
    expect(onPlan.flags.some((f) => f.key === 'cadence' || f.key === 'missed')).toBe(false);

    const late = computeCustomerMetrics(cust, [visit(40, 30), visit(30, 30), visit(20, 30), visit(10, 30)], opts);
    expect(late.cadence.avgDays).toBe(10);
    expect(late.flags.some((f) => f.key === 'cadence')).toBe(true);

    // a 60-day gap is a break, not a cadence
    const broken = computeCustomerMetrics(cust, [visit(81, 30), visit(74, 30), visit(14, 30), visit(7, 30)], opts);
    expect(broken.cadence.avgDays).toBe(7);
    expect(broken.cutsVsExpected.missed).toBeGreaterThanOrEqual(2);
    expect(broken.flags.some((f) => f.key === 'missed')).toBe(true);
  });

  it('counts skips and skips in a row', () => {
    const visits = [visit(28, 30), visit(21, 0, { status: 'skipped' }), visit(14, 30), visit(7, 0, { status: 'skipped' }), visit(1, 0, { status: 'skipped' })];
    const m = computeCustomerMetrics(cust, visits, opts);
    expect(m.skipCount).toBe(3);
    expect(m.skipStreak).toBe(2);
    expect(m.flags.find((f) => f.key === 'skips').text).toMatch(/2 times in a row/);
  });

  it('flags a lawn under target once the drive is counted', () => {
    const far = weekly([30, 30, 30]).map((v) => ({ ...v, priceEarned: 35, driveTimeSecs: 1200 }));
    const m = computeCustomerMetrics(cust, far, opts);
    expect(Math.round(m.rateWork)).toBe(70);
    expect(Math.round(m.rateWithDrive)).toBe(42);
    expect(m.flags.some((f) => f.key === 'rate')).toBe(true);
  });

  it('sums up leaf history and what is still to decide', () => {
    const visits = [
      visit(21, 30),
      visit(14, 60, { conditions: ['leaves'], leafSecs: 1800, leafSuggested: 30, leafCharge: 25, leafDecided: true, priceEarned: 65 }),
      visit(7, 50, { conditions: ['leaves'], leafSecs: 1200, leafSuggested: 20 }),
      visit(2, 90, { appliedServices: ['s4'], priceEarned: 150 }),
    ];
    const m = computeCustomerMetrics(cust, visits, opts);
    expect(m.leaf).toMatchObject({ jobs: 2, cleanups: 1, avgLeafMins: 25, charged: 25, suggested: 50, cleanupRevenue: 150, undecided: 2 });
    expect(m.flags.find((f) => f.key === 'leaf').text).toBe('2 leaf charges to decide');
  });

  it('compares against similar-size lawns when a trend curve is given', () => {
    const big = { ...cust, lawnSize: '10000' };
    const model = { A: 1, b: 0.35 }; // ≈ 25 min for 10,000 sq ft
    const m = computeCustomerMetrics(big, weekly([40, 40, 40]), { ...opts, model });
    expect(m.vsSimilar.ratio).toBeGreaterThan(1.4);
    expect(m.flags.some((f) => f.key === 'similar')).toBe(true);
    const ok = computeCustomerMetrics({ ...big, slowMowExpected: true }, weekly([40, 40, 40]), { ...opts, model });
    expect(ok.flags.some((f) => f.key === 'similar')).toBe(false);
  });

  it('exports one spreadsheet row per customer', () => {
    const m = computeCustomerMetrics({ ...cust, name: 'Smith, "Bud"' }, weekly([30, 30, 30, 30]), opts);
    const row = metricsCsvRow(m);
    expect(row.startsWith('"Smith, ""Bud"""')).toBe(true);
    // 24 columns; the two quoted cells hold the only commas that aren't separators
    expect(METRICS_CSV_HEADERS).toHaveLength(24);
    expect(row.replace(/"(?:[^"]|"")*"/g, 'x').split(',')).toHaveLength(24);
  });
});
