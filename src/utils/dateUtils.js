export const getBusinessDayStart = (dateObj = new Date()) => {
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const getBusinessDateString = (dateObj = new Date()) => {
  return new Date(dateObj).toLocaleDateString();
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
