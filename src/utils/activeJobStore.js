// The running job, saved to localStorage so an app reload (Android discarding
// the app, a refresh, a crash) picks it back up instead of losing it and
// re-arriving from zero. `heartbeat` is rewritten every few seconds while the
// job runs: it is the last moment the app was known to be alive at the job.

const KEY = 'lawnpro_active_job';
export const ACTIVE_JOB_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// Pure so it can be tested without a browser.
export function isRestorable(saved, now = Date.now()) {
  return !!(
    saved &&
    saved.v === 1 &&
    saved.customerId != null &&
    typeof saved.jobStart === 'number' &&
    typeof saved.heartbeat === 'number' &&
    (saved.timerState === 'running' || saved.timerState === 'paused') &&
    now - saved.heartbeat <= ACTIVE_JOB_MAX_AGE_MS
  );
}

export function saveActiveJob(job, now = Date.now()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ...job, heartbeat: now }));
  } catch { /* storage full / unavailable — tracking still works in memory */ }
}

// Returns the saved job if it can be restored; anything else is cleared.
export function loadActiveJob(now = Date.now()) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (isRestorable(saved, now)) return saved;
  } catch { /* corrupt entry — drop it below */ }
  clearActiveJob();
  return null;
}

export function clearActiveJob() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
