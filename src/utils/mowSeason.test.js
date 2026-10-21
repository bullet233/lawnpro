import { describe, it, expect } from 'vitest';
import { mowSeasonState, mowDueStatus, toMD } from './mowSeason';

const D = (iso) => new Date(`${iso}T12:00:00`).getTime();
const season = { start: '04-15', end: '11-15' };

describe('mowSeasonState', () => {
  it('is in season between the start and the end of the end day', () => {
    expect(mowSeasonState(D('2026-10-20'), season)).toMatchObject({ inSeason: true, seasonStart: new Date(2026, 3, 15).getTime() });
    expect(mowSeasonState(new Date(2026, 10, 15, 23, 0).getTime(), season).inSeason).toBe(true);
  });

  it('is out of season over the winter, with the next start', () => {
    const nov = mowSeasonState(D('2026-11-20'), season);
    expect(nov.inSeason).toBe(false);
    expect(nov.nextStart).toBe(new Date(2027, 3, 15).getTime());
    const march = mowSeasonState(D('2027-03-01'), season);
    expect(march.inSeason).toBe(false);
    expect(march.nextStart).toBe(new Date(2027, 3, 15).getTime());
  });

  it('handles a season that runs over New Year', () => {
    const wrap = { start: '11-01', end: '03-31' };
    expect(mowSeasonState(D('2026-12-10'), wrap).inSeason).toBe(true);
    expect(mowSeasonState(D('2027-02-10'), wrap).seasonStart).toBe(new Date(2026, 10, 1).getTime());
    expect(mowSeasonState(D('2026-07-01'), wrap).inSeason).toBe(false);
  });

  it('falls back to the defaults on a bad setting', () => {
    expect(mowSeasonState(D('2026-10-20'), { start: 'x', end: '' }).inSeason).toBe(true);
    expect(toMD(D('2026-10-20'))).toBe('10-20');
  });
});

describe('mowDueStatus', () => {
  const inSeason = mowSeasonState(D('2026-10-20'), season);
  it('tells due today from overdue from not due', () => {
    expect(mowDueStatus({ lastCut: D('2026-10-13'), intervalDays: 7, daysSince: 7 }, inSeason)).toBe('dueToday');
    expect(mowDueStatus({ lastCut: D('2026-10-10'), intervalDays: 7, daysSince: 10 }, inSeason)).toBe('overdue');
    expect(mowDueStatus({ lastCut: D('2026-10-16'), intervalDays: 7, daysSince: 4 }, inSeason)).toBe(null);
  });
  it('waits on a first cut when nothing was done yet this season', () => {
    expect(mowDueStatus({ lastCut: D('2025-10-30'), intervalDays: 7, daysSince: 355 }, inSeason)).toBe('firstCut');
    expect(mowDueStatus({ lastCut: null, intervalDays: 7, daysSince: null }, inSeason)).toBe('firstCut');
  });
  it('nothing is due out of season', () => {
    expect(mowDueStatus({ lastCut: D('2026-10-30'), intervalDays: 7, daysSince: 40 }, mowSeasonState(D('2026-12-09'), season))).toBe(null);
  });
});
