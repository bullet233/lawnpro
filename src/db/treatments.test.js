import { describe, it, expect } from 'vitest';
import { stepDueDate, stepWindow, classifyTreatment, STANDARD_5_STEP } from './treatments';

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
