import { describe, it, expect } from 'vitest';
import { estimateJobSecs, routeSecondsLeft, DEFAULT_DRIVE_SECS } from './routeEta';

let id = 1;
const visit = (customerId, mins, extra = {}) => ({ id: id++, customerId, status: 'completed', durationSecs: mins * 60, appliedServices: ['s1'], ...extra });
const cust = (cid, extra = {}) => ({ id: cid, name: `C${cid}`, ...extra });
const opts = { defaultServices: [{ id: 's1', category: 'Mowing' }], globalPace: 250 };

describe('estimateJobSecs', () => {
  it('averages the lawn own visits and ignores sub-minute ones', () => {
    const allVisits = [visit(1, 20), visit(1, 24), { ...visit(1, 0), durationSecs: 1 }, { ...visit(1, 0), durationSecs: 0 }];
    expect(estimateJobSecs({ customer: cust(1), allVisits, ...opts })).toBe(22 * 60);
  });
  it('falls back to lawn size, then 15 minutes', () => {
    expect(estimateJobSecs({ customer: cust(2, { lawnSize: '5000' }), allVisits: [], ...opts })).toBe(20 * 60);
    expect(estimateJobSecs({ customer: cust(3), allVisits: [], ...opts })).toBe(900);
  });
  it('uses leaf visits only for a stop marked as a leaf job', () => {
    const allVisits = [visit(4, 20), visit(4, 20), visit(4, 40, { conditions: ['leaves'] })];
    expect(estimateJobSecs({ customer: cust(4), allVisits, ...opts })).toBe(20 * 60);
    expect(estimateJobSecs({ customer: cust(4), allVisits, ...opts, isLeafJob: true })).toBe(40 * 60);
  });
});

describe('routeSecondsLeft', () => {
  const allVisits = [visit(1, 17), visit(2, 20), visit(3, 13)];
  const stops = [
    { customer: cust(1), status: 'active', plannedDriveSecs: 300 },
    { customer: cust(2), status: 'pending', plannedDriveSecs: 300 },
    { customer: cust(3), status: 'pending', plannedDriveSecs: 300 },
    { customer: cust(9), status: 'completed', plannedDriveSecs: 300 },
  ];
  it('counts the rest of the job in progress', () => {
    // 17 min job, 5 min in: 12 left + (20 + 5) + (13 + 5)
    expect(routeSecondsLeft(stops, { allVisits, ...opts, jobElapsedSecs: 300 })).toBe((12 + 25 + 18) * 60);
  });
  it('never counts a running job below zero', () => {
    expect(routeSecondsLeft(stops, { allVisits, ...opts, jobElapsedSecs: 30 * 60 })).toBe((25 + 18) * 60);
  });
  it('only counts the part of a drive still ahead', () => {
    const driving = stops.map((s) => (s.status === 'active' ? { ...s, status: 'completed' } : s));
    expect(routeSecondsLeft(driving, { allVisits, ...opts, drivingSecs: 120, drivingToId: 2 })).toBe((20 + 3 + 18) * 60);
    expect(routeSecondsLeft(driving, { allVisits, ...opts, drivingSecs: 900, drivingToId: 2 })).toBe((20 + 18) * 60);
  });
  it('uses 5 minutes when a stop has no planned drive', () => {
    expect(routeSecondsLeft([{ customer: cust(2), status: 'pending' }], { allVisits, ...opts })).toBe(20 * 60 + DEFAULT_DRIVE_SECS);
  });
});
