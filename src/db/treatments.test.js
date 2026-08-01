import { describe, it, expect } from 'vitest';
import {
  stepDueDate, stepWindow, classifyTreatment, STANDARD_5_STEP,
  pickStepForApplication, EARLY_APPLY_SLACK_MS,
} from './treatments';

describe('treatment scheduling helpers', () => {
  const step = { id: 's', order: 1, name: 'x', category: 'Fertilizer', startMonth: 3, endMonth: 4 };

  it('stepDueDate is the first day of the start month', () => {
    const d = new Date(stepDueDate(step, 2026));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // March = index 2
    expect(d.getDate()).toBe(1);
  });

  it('stepWindow spans start of startMonth to last instant of endMonth', () => {
    const { start, end } = stepWindow(step, 2026);
    const s = new Date(start);
    const e = new Date(end);
    expect(s.getMonth()).toBe(2);   // March 1
    expect(s.getDate()).toBe(1);
    expect(e.getMonth()).toBe(3);   // April 30
    expect(e.getDate()).toBe(30);
    expect(end).toBeGreaterThan(start);
  });

  it('single-month window (startMonth === endMonth) covers that whole month', () => {
    const may = { ...step, startMonth: 5, endMonth: 5 };
    const { start, end } = stepWindow(may, 2026);
    expect(new Date(start).getDate()).toBe(1);
    expect(new Date(end).getMonth()).toBe(4); // still May
    expect(new Date(end).getDate()).toBe(31);
  });

  it('classifyTreatment distinguishes scheduled / due / overdue', () => {
    const { start, end } = stepWindow(step, 2026);
    const t = { status: 'scheduled', dueWindowStart: start, dueWindowEnd: end };
    expect(classifyTreatment(t, start - 86400000)).toBe('scheduled'); // before window
    expect(classifyTreatment(t, start + 86400000)).toBe('due');       // inside window
    expect(classifyTreatment(t, end + 86400000)).toBe('overdue');     // after window
  });

  it('classifyTreatment preserves terminal states', () => {
    expect(classifyTreatment({ status: 'completed' }, Date.now())).toBe('completed');
    expect(classifyTreatment({ status: 'skipped' }, Date.now())).toBe('skipped');
  });

  it('standard program has 5 ordered, valid steps', () => {
    expect(STANDARD_5_STEP.steps).toHaveLength(5);
    STANDARD_5_STEP.steps.forEach((s, i) => {
      expect(s.order).toBe(i + 1);
      expect(s.startMonth).toBeGreaterThanOrEqual(1);
      expect(s.endMonth).toBeLessThanOrEqual(12);
      expect(s.endMonth).toBeGreaterThanOrEqual(s.startMonth);
    });
  });
});

describe('pickStepForApplication (visit → program-step bridge)', () => {
  const DAY = 86400000;
  const mk = (id, startOffsetDays, status = 'scheduled') => ({
    id,
    status,
    dueDate: 1_000_000 * DAY + startOffsetDays * DAY,
    dueWindowStart: 1_000_000 * DAY + startOffsetDays * DAY,
    dueWindowEnd: 1_000_000 * DAY + (startOffsetDays + 30) * DAY,
  });
  const asOf = 1_000_000 * DAY; // "today" relative to the offsets above

  it('picks the earliest open step whose window has started', () => {
    const steps = [mk('later', -5), mk('earliest', -40), mk('future', 60)];
    expect(pickStepForApplication(steps, asOf)?.id).toBe('earliest');
  });

  it('ignores completed and skipped steps', () => {
    const steps = [mk('done', -40, 'completed'), mk('skip', -20, 'skipped'), mk('open', -5)];
    expect(pickStepForApplication(steps, asOf)?.id).toBe('open');
  });

  it('allows an application slightly ahead of the window (early slack)', () => {
    const withinSlack = mk('soon', 10); // starts in 10 days, slack is 14
    expect(pickStepForApplication([withinSlack], asOf)?.id).toBe('soon');
    const beyondSlack = mk('far', EARLY_APPLY_SLACK_MS / DAY + 1);
    expect(pickStepForApplication([beyondSlack], asOf)).toBeNull();
  });

  it('returns null when nothing is open (all done or all future)', () => {
    expect(pickStepForApplication([], asOf)).toBeNull();
    expect(pickStepForApplication([mk('done', -10, 'completed'), mk('future', 90)], asOf)).toBeNull();
  });

  it('ignores ad-hoc treatments with no window', () => {
    const adHoc = { id: 'adhoc', status: 'scheduled', dueDate: asOf, dueWindowStart: null, dueWindowEnd: null };
    expect(pickStepForApplication([adHoc, mk('real', -3)], asOf)?.id).toBe('real');
  });
});
