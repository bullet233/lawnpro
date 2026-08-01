import { getSettings } from '../db/settings';
import { parseLawnSizeToSqFt } from './parseLawnSize';

// "Today's Mix" — the tank mix loaded for the day. Set once in fert mode;
// every completed fertilizer visit then auto-files its EPA compliance log
// from this mix instead of the driver rebuilding the product list per stop.
// Stored per-device (localStorage) and stamped with the local calendar date
// so yesterday's tank never silently signs today's logs.
const MIX_KEY = 'lawnpro_todays_mix';

export function localDateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getTodaysMix(now = Date.now()) {
  try {
    const raw = localStorage.getItem(MIX_KEY);
    if (!raw) return null;
    const mix = JSON.parse(raw);
    if (mix.date !== localDateKey(now)) return null;
    if (!Array.isArray(mix.products) || mix.products.length === 0) return null;
    return mix;
  } catch {
    return null;
  }
}

export function setTodaysMix(products, mixSite = 'Business Location', now = Date.now()) {
  const mix = { date: localDateKey(now), products, mixSite };
  try {
    localStorage.setItem(MIX_KEY, JSON.stringify(mix));
  } catch (err) {
    console.error('Failed to save today\'s mix', err);
  }
  return mix;
}

export function clearTodaysMix() {
  try {
    localStorage.removeItem(MIX_KEY);
  } catch { /* nothing to clear */ }
}

// Per-lawn override: products picked for the CURRENT stop only (from the live
// job panel or the completion panel). Wins over the day mix, guarded by both
// customer id and date so it can never stamp the wrong lawn's log.
const STOP_MIX_KEY = 'lawnpro_stop_mix';

export function setStopMix(customerId, products, mixSite = 'Business Location', now = Date.now()) {
  const mix = { date: localDateKey(now), customerId, products, mixSite };
  try {
    localStorage.setItem(STOP_MIX_KEY, JSON.stringify(mix));
  } catch (err) {
    console.error('Failed to save stop mix', err);
  }
  return mix;
}

export function peekStopMix(customerId, now = Date.now()) {
  try {
    const raw = localStorage.getItem(STOP_MIX_KEY);
    if (!raw) return null;
    const mix = JSON.parse(raw);
    if (mix.date !== localDateKey(now) || mix.customerId !== customerId) return null;
    if (!Array.isArray(mix.products) || mix.products.length === 0) return null;
    return mix;
  } catch {
    return null;
  }
}

// Consume the stop mix at visit completion. Always clears the slot — a
// mismatched (stale) entry is dropped rather than left to shadow a later stop.
export function takeStopMix(customerId, now = Date.now()) {
  const mix = peekStopMix(customerId, now);
  clearStopMix();
  return mix;
}

export function clearStopMix() {
  try {
    localStorage.removeItem(STOP_MIX_KEY);
  } catch { /* nothing to clear */ }
}

export function formatLogTimes(entryTime, exitTime) {
  return {
    dateOfService: new Date(exitTime).toLocaleDateString(),
    startTime: new Date(entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    endTime: new Date(exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
}

// Builds a full complianceLog (same shape ComplianceLogModal edits) for one
// visit. Products are deep-copied so a per-house edit never mutates the
// shared day mix or a sibling visit's log.
export function buildLogFromMix(mix, { customer, exitTime, durationSecs }, settings = getSettings()) {
  const end = exitTime || Date.now();
  const start = end - (durationSecs || 0) * 1000;

  let areaTreated = '';
  if (customer?.lawnSize) {
    const sqft = parseLawnSizeToSqFt(customer.lawnSize);
    areaTreated = sqft ? `${sqft.toLocaleString()} sq ft` : customer.lawnSize;
  }

  return {
    applicatorName: settings.applicatorName || '',
    licenseNumber: settings.licenseNumber || '',
    businessPhone: settings.businessPhone || '',
    areaTreated,
    mixSite: mix.mixSite || 'Business Location',
    treatmentLocation: 'Turf',
    customerName: customer?.name || '',
    customerPhone: customer?.phone || '',
    customerAddress: customer?.address || '',
    ...formatLogTimes(start, end),
    products: JSON.parse(JSON.stringify(mix.products || [])),
    autoFiledFromMix: true
  };
}
