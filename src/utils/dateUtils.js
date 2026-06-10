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
