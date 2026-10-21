import { comparableVisits } from './leaves';
import { parseLawnSizeToSqFt } from './parseLawnSize';

// How long a route has left, and what each stop is expected to take. Shared by
// the route panel's "Est. finish" and its Up next cards so they always agree.

export const DEFAULT_JOB_SECS = 900;   // a lawn with no history and no size
export const DEFAULT_DRIVE_SECS = 300; // a stop with no planned drive time
export const MIN_VISIT_SECS = 60;      // shorter "visits" are drive-pasts or double-logs

// Usual job time for one stop: this lawn's own visits for the planned kind of
// work (leaf visits only when the stop is marked a leaf job), else its size at
// the overall pace, else 15 minutes.
export function estimateJobSecs({ customer, plannedIds = [], allVisits = [], defaultServices = [], globalPace, isLeafJob = false }) {
  const isMowId = (id) => defaultServices.find((s) => s.id === id)?.category === 'Mowing' || id === 's1';
  const isPlannedMow = plannedIds.length === 0 || plannedIds.some(isMowId);
  const hist = comparableVisits(allVisits.filter((v) => {
    if (v.customerId !== customer.id || v.status !== 'completed' || !(v.durationSecs >= MIN_VISIT_SECS)) return false;
    const isHistMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(isMowId);
    return isPlannedMow === isHistMow;
  }), isPlannedMow && isLeafJob);
  if (hist.length > 0) return hist.reduce((s, v) => s + v.durationSecs, 0) / hist.length;
  const sqft = customer.lawnSize ? parseLawnSizeToSqFt(customer.lawnSize) : null;
  if (sqft && globalPace) return Math.max(isPlannedMow ? 600 : 300, Math.round((sqft / globalPace) * 60));
  return DEFAULT_JOB_SECS;
}

// Seconds left on the route:
//   - the job in progress: its usual time minus the time already on the clock
//     (never below zero);
//   - every stop not started: its usual time plus its planned drive;
//   - the stop being driven to: only the part of the drive still ahead.
// stops: [{ customer, status: 'pending'|'active'|'completed'|'skipped', plannedIds, plannedDriveSecs, isLeafJob }]
export function routeSecondsLeft(stops, { allVisits, defaultServices, globalPace, jobElapsedSecs = 0, drivingSecs = 0, drivingToId = null }) {
  let total = 0;
  stops.forEach((st) => {
    if (st.status !== 'pending' && st.status !== 'active') return;
    const job = estimateJobSecs({ customer: st.customer, plannedIds: st.plannedIds, allVisits, defaultServices, globalPace, isLeafJob: st.isLeafJob });
    if (st.status === 'active') { total += Math.max(0, job - jobElapsedSecs); return; }
    const drive = st.plannedDriveSecs ?? DEFAULT_DRIVE_SECS;
    total += job + (st.customer.id === drivingToId ? Math.max(0, drive - drivingSecs) : drive);
  });
  return Math.round(total);
}
