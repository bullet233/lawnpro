export const getBusinessDayStart = (dateObj = new Date()) => {
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const getBusinessDateString = (dateObj = new Date()) => {
  return new Date(dateObj).toLocaleDateString();
};

// Parse a "YYYY-MM-DD" string (from <input type="date"> or the calendar) as a
// LOCAL calendar date. `new Date("2026-07-27")` parses as UTC midnight, which in
// any UTC-negative timezone lands on the previous local day — the classic
// off-by-one. Splitting the parts and using the (y, m, d) constructor keeps it local.
export const parseLocalDate = (str) => {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

export const getDaysSince = (timestamp) => {
  if (!timestamp) return null;
  const today = getBusinessDayStart();
  const past = getBusinessDayStart(new Date(timestamp));
  return Math.round((today - past) / 86400000);
};

export const formatLiveTimer = (secs) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  if (h > 0) return h + ':' + m + ':' + s;
  return m + ':' + s;
};
