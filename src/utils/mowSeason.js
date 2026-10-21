// The mowing season: a start and end day each year ('MM-DD', from Settings).
// Outside it nothing is overdue — a lawn last cut in October isn't "150 days
// late" in March. Inside it, a lawn whose last cut was before this season
// started is waiting on its first cut of the season, not overdue.

export const DEFAULT_SEASON_START = '04-15';
export const DEFAULT_SEASON_END = '11-15';

const DAY = 86400000;
const parseMD = (md, fallback) => {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(md || '') || /^(\d{1,2})-(\d{1,2})$/.exec(fallback);
  return { month: Number(m[1]) - 1, day: Number(m[2]) };
};
const at = (year, md) => new Date(year, md.month, md.day).getTime();
export const toMD = (t) => {
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// { inSeason, seasonStart (this season's start, if in season), seasonEnd
//   (end of its last day), nextStart (if out of season), lastEnd }
export function mowSeasonState(now = Date.now(), { start = DEFAULT_SEASON_START, end = DEFAULT_SEASON_END } = {}) {
  const s = parseMD(start, DEFAULT_SEASON_START);
  const e = parseMD(end, DEFAULT_SEASON_END);
  const y = new Date(now).getFullYear();
  const endOf = (year) => at(year, e) + DAY - 1;

  if (at(y, s) <= at(y, e)) {
    // Ordinary season inside one calendar year.
    const startThis = at(y, s);
    const endThis = endOf(y);
    if (now >= startThis && now <= endThis) return { inSeason: true, seasonStart: startThis, seasonEnd: endThis };
    return now < startThis
      ? { inSeason: false, nextStart: startThis, lastEnd: endOf(y - 1) }
      : { inSeason: false, nextStart: at(y + 1, s), lastEnd: endThis };
  }
  // A season that runs over New Year (start later in the year than end).
  if (now >= at(y, s)) return { inSeason: true, seasonStart: at(y, s), seasonEnd: endOf(y + 1) };
  if (now <= endOf(y)) return { inSeason: true, seasonStart: at(y - 1, s), seasonEnd: endOf(y) };
  return { inSeason: false, nextStart: at(y, s), lastEnd: endOf(y) };
}

// The season from the saved settings ({ mowSeasonStart, mowSeasonEnd }).
export const seasonFromSettings = (settings, now = Date.now()) =>
  mowSeasonState(now, { start: settings?.mowSeasonStart, end: settings?.mowSeasonEnd });

// Where a mowing lawn stands: 'firstCut' (nothing yet this season), 'dueToday'
// (exactly on its interval), 'overdue', or null (not due yet).
export function mowDueStatus({ lastCut, intervalDays, daysSince }, season) {
  if (!season?.inSeason) return null;
  if (lastCut == null || lastCut < season.seasonStart) return 'firstCut';
  if (daysSince == null || daysSince < intervalDays) return null;
  return daysSince === intervalDays ? 'dueToday' : 'overdue';
}
