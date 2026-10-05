import { describe, it, expect } from 'vitest';
import { isRestorable, ACTIVE_JOB_MAX_AGE_MS } from './activeJobStore';

describe('isRestorable', () => {
  const NOW = 1_800_000_000_000;
  const job = (extra = {}) => ({
    v: 1, customerId: 7, jobStart: NOW - 1_200_000, timerState: 'running', heartbeat: NOW - 5_000, ...extra,
  });

  it('accepts a running or paused job with a recent heartbeat', () => {
    expect(isRestorable(job(), NOW)).toBe(true);
    expect(isRestorable(job({ timerState: 'paused' }), NOW)).toBe(true);
  });

  it('rejects nothing, junk, and other versions', () => {
    expect(isRestorable(null, NOW)).toBe(false);
    expect(isRestorable({}, NOW)).toBe(false);
    expect(isRestorable(job({ v: 2 }), NOW)).toBe(false);
    expect(isRestorable(job({ customerId: null }), NOW)).toBe(false);
    expect(isRestorable(job({ jobStart: undefined }), NOW)).toBe(false);
    expect(isRestorable(job({ timerState: 'idle' }), NOW)).toBe(false);
  });

  it('rejects a job the app has not been alive at for over 12 hours', () => {
    expect(isRestorable(job({ heartbeat: NOW - ACTIVE_JOB_MAX_AGE_MS + 1000 }), NOW)).toBe(true);
    expect(isRestorable(job({ heartbeat: NOW - ACTIVE_JOB_MAX_AGE_MS - 1000 }), NOW)).toBe(false);
  });
});
