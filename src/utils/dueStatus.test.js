import { describe, it, expect } from 'vitest';
import { serviceDue, isLate, needsService, lastDoneLabel } from './dueStatus';
import { mowSeasonState } from './mowSeason';

const DAY = 86400000;
const NOW = new Date('2026-10-20T12:00:00').getTime();
const season = mowSeasonState(NOW, { start: '04-15', end: '11-15' });
const cust = { id: 1, mowingInterval: 7 };
const v = (daysAgo, extra = {}) => ({ customerId: 1, status: 'completed', durationSecs: 1200, division: 'mowing', appliedServices: ['s1'], exitTime: NOW - daysAgo * DAY, ...extra });
const due = (visits, opts = {}) => serviceDue(cust, visits, { now: NOW, season, ...opts });

describe('serviceDue', () => {
  it('tells ok, due today and overdue apart', () => {
    expect(due([v(3)]).status).toBe('ok');
    expect(due([v(7)]).status).toBe('dueToday');
    const late = due([v(10)]);
    expect(late).toMatchObject({ status: 'overdue', overdueDays: 3, daysSince: 10 });
    expect(isLate(late)).toBe(true);
    expect(isLate(due([v(9)]))).toBe(false);
  });

  it('counts a cycle skip as done, not a catch-up skip or a 1-second visit', () => {
    expect(due([v(10), v(2, { status: 'skipped', countsForSchedule: true })]).status).toBe('ok');
    expect(due([v(10), v(2, { status: 'skipped', catchUp: true })]).status).toBe('overdue');
    expect(due([v(10), v(2, { durationSecs: 1 })]).daysSince).toBe(10);
    expect(due([v(10), v(2, { durationSecs: 0 })]).daysSince).toBe(2); // hand-logged, no time
  });

  it('keeps divisions apart', () => {
    expect(due([v(2, { division: 'fertilizer', appliedServices: ['s3'] }), v(10)]).daysSince).toBe(10);
    const fert = serviceDue({ id: 1, fertilizerInterval: 30 }, [v(31, { division: 'fertilizer', appliedServices: ['s3'] })], { division: 'fertilizer', now: NOW });
    expect(fert).toMatchObject({ status: 'overdue', intervalDays: 30 });
  });

  it('follows the mowing season, snoozes and new clients', () => {
    expect(due([v(400)]).status).toBe('firstCut');
    expect(due([]).status).toBe('new');
    expect(serviceDue(cust, [v(40)], { now: NOW + 40 * DAY, season: mowSeasonState(NOW + 40 * DAY, { start: '04-15', end: '11-15' }) }).status).toBe('offSeason');
    expect(serviceDue({ ...cust, snoozedUntil: NOW + DAY }, [v(10)], { now: NOW, season }).status).toBe('snoozed');
    expect(needsService(due([v(10)]))).toBe(true);
    expect(needsService(due([v(3)]))).toBe(false);
  });

  it('can ignore today (for a nearby prompt mid-route)', () => {
    expect(due([v(10), v(0)], { beforeTs: NOW - 12 * 3600000 }).daysSince).toBe(10);
  });

  it('labels the last time done', () => {
    expect(lastDoneLabel(due([v(8)]))).toBe('cut 8d ago');
    expect(lastDoneLabel(due([v(0)]))).toBe('cut today');
    expect(lastDoneLabel(due([v(1)]))).toBe('cut yesterday');
    expect(lastDoneLabel(due([]))).toBe('never done');
  });
});
