import { describe, it, expect } from 'vitest';
import { buildDayRoute } from './dayRoute';

const T = (hm) => new Date(`2026-10-15T${hm}:00`).getTime();
let id = 1;
const job = (cust, from, to, drive, price, extra = {}) => ({
  id: id++, customerId: cust, status: 'completed', entryTime: T(from), exitTime: T(to),
  durationSecs: (T(to) - T(from)) / 1000, driveTimeSecs: drive * 60, priceEarned: price, ...extra,
});
const skip = (cust, at) => ({ id: id++, customerId: cust, status: 'skipped', exitTime: T(at), durationSecs: 0, priceEarned: 0 });

// Thursday Oct 15 from the real backup.
const day = [
  job(1, '09:27', '09:36', 19, 38),
  job(2, '09:36', '10:03', 0, 38, { conditions: ['leaves'] }),
  skip(3, '10:03'), skip(4, '10:03'),
  job(5, '10:04', '10:34', 1, 45),
  job(6, '10:41', '10:56', 7, 30),
  job(7, '10:41', '10:56', 0, 30, { note: 'Simultaneous visit with Pat Regert' }),
  job(8, '11:10', '11:21', 7, 35),
  job(9, '11:25', '11:51', 4, 45),
  skip(10, '11:51'),
];

describe('buildDayRoute', () => {
  const r = buildDayRoute(day);

  it('lays the stops out in driving order and merges lawns done together', () => {
    expect(r.stops).toHaveLength(6);
    const together = r.stops[3];
    expect(together.together).toBe(true);
    expect(together.visits.map((v) => v.customerId)).toEqual([6, 7]);
    expect(together.price).toBe(60);
    expect(together.clockSecs).toBe(15 * 60); // counted once
  });

  it('splits the time between stops into drive and unexplained gap', () => {
    expect(r.stops[0].driveSecs).toBe(19 * 60);           // from the shop
    expect(r.stops[1]).toMatchObject({ driveSecs: 0, gapSecs: 0 });
    expect(r.stops[4]).toMatchObject({ driveSecs: 7 * 60, gapSecs: 7 * 60 }); // 14 min between, 7 driving
    expect(r.stops[2].driveSecs).toBe(60);                 // recorded 1 min, 1 min between
  });

  it('never counts more drive than the time between stops', () => {
    const tight = buildDayRoute([job(1, '09:00', '09:20', 0, 40), job(2, '09:22', '09:40', 10, 40)]);
    expect(tight.stops[1]).toMatchObject({ driveSecs: 120, gapSecs: 0 });
  });

  it('places skips after the stop they followed', () => {
    expect(r.skipsAfter.get(1).map((v) => v.customerId)).toEqual([3, 4]);
    expect(r.skipsAfter.get(5).map((v) => v.customerId)).toEqual([10]);
    expect(r.summary.routeEnded).toBe(T('11:51'));
    // a skip stamped a few seconds before the last finish still counts as ending the route
    expect(buildDayRoute([job(1, '09:00', '09:30', 0, 40), skip(2, '09:30')].map((v) => (v.status === 'skipped' ? { ...v, exitTime: v.exitTime - 5000 } : v))).summary.routeEnded).toBe(T('09:30'));
  });

  it('sums up the day', () => {
    expect(r.summary.dayStart).toBe(T('09:08'));
    expect(r.summary.dayEnd).toBe(T('11:51'));
    expect(r.summary.mowSecs).toBe(118 * 60); // clock times: 9+27+30+15+11+26
    expect(r.summary.driveSecs).toBe(38 * 60);
    expect(r.summary.gapSecs).toBe(7 * 60);  // the 7 min before Keil
    expect(r.summary.revenue).toBe(261);
    expect(r.summary.jobs).toBe(7);
  });

  it('handles a day of only skips', () => {
    const s = buildDayRoute([skip(1, '09:00')]);
    expect(s.stops).toHaveLength(0);
    expect(s.summary.dayStart).toBe(null);
    expect(s.skipsAfter.get(-1)).toHaveLength(1);
  });
});
