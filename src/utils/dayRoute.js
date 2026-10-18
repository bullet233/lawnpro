// One day's visits laid out in the order they were driven: each stop, the
// drive to it, any time between stops the drive doesn't explain, and the
// skips in between. Used by the Logs page "Route" view.
//
// Lawns done together (a time split — "Simultaneous visit with …") share a
// clock, so they are one stop with their prices added and the time counted
// once.

export const TOGETHER_SECS = 120;      // starts and ends within 2 min → one stop
export const GAP_SHOW_SECS = 300;      // gaps under 5 min aren't called out

const startOf = (v) => v.entryTime || (v.exitTime ? v.exitTime - (v.durationSecs || 0) * 1000 : 0);

export function buildDayRoute(visits) {
  const done = visits.filter((v) => v.status === 'completed' && (v.exitTime || v.entryTime))
    .sort((a, b) => startOf(a) - startOf(b) || a.exitTime - b.exitTime);
  const skipped = visits.filter((v) => v.status === 'skipped')
    .sort((a, b) => (a.exitTime || 0) - (b.exitTime || 0));

  // Group lawns done together.
  const stops = [];
  done.forEach((v) => {
    const s = startOf(v);
    const e = v.exitTime || s;
    const last = stops[stops.length - 1];
    if (last && Math.abs(s - last.start) <= TOGETHER_SECS * 1000 && Math.abs(e - last.end) <= TOGETHER_SECS * 1000) {
      last.visits.push(v);
      last.end = Math.max(last.end, e);
      last.price += v.priceEarned || 0;
      return;
    }
    stops.push({ visits: [v], start: s, end: e, price: v.priceEarned || 0 });
  });

  // The way to each stop: recorded drive, and whatever time it doesn't cover.
  let prevEnd = null;
  stops.forEach((stop) => {
    stop.clockSecs = Math.max(0, Math.round((stop.end - stop.start) / 1000));
    const recordedDrive = Math.max(0, Math.round(stop.visits[0].driveTimeSecs || 0));
    if (prevEnd == null) {
      stop.driveSecs = recordedDrive;
      stop.gapSecs = 0;
    } else {
      const between = Math.max(0, Math.round((stop.start - prevEnd) / 1000));
      stop.driveSecs = Math.min(recordedDrive, between);
      stop.gapSecs = between - stop.driveSecs;
    }
    stop.together = stop.visits.length > 1;
    prevEnd = Math.max(prevEnd ?? 0, stop.end);
  });

  // Skips go after the last stop that finished before them.
  const skipsAfter = new Map(); // stop index (-1 = before the first stop) → visits
  skipped.forEach((v) => {
    let idx = -1;
    stops.forEach((s, i) => { if (s.end <= (v.exitTime || 0) + 60000) idx = i; }); // 1 min slack, same as routeEnded
    if (!skipsAfter.has(idx)) skipsAfter.set(idx, []);
    skipsAfter.get(idx).push(v);
  });

  const mowSecs = stops.reduce((s, x) => s + x.clockSecs, 0);
  const driveSecs = stops.reduce((s, x) => s + x.driveSecs, 0);
  const gapSecs = stops.reduce((s, x) => s + x.gapSecs, 0);
  const revenue = stops.reduce((s, x) => s + x.price, 0);
  const dayStart = stops.length ? stops[0].start - stops[0].driveSecs * 1000 : null;
  const dayEnd = stops.length ? Math.max(...stops.map((s) => s.end)) : null;
  const lastSkip = skipped.length ? skipped[skipped.length - 1].exitTime : null;

  return {
    stops,
    skipsAfter,
    summary: {
      dayStart, dayEnd,
      // Skips stamped at the moment the route was ended can land a few seconds
      // before the last job's finish time.
      routeEnded: lastSkip && dayEnd && lastSkip >= dayEnd - 60000 ? Math.max(lastSkip, dayEnd) : null,
      mowSecs, driveSecs, gapSecs,
      revenue,
      jobs: done.length,
      rate: mowSecs + driveSecs >= 60 ? revenue / ((mowSecs + driveSecs) / 3600) : null,
    },
  };
}
