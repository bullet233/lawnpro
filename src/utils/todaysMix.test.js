import { describe, it, expect, beforeEach } from 'vitest';
import { getTodaysMix, setTodaysMix, clearTodaysMix, buildLogFromMix, localDateKey, setStopMix, peekStopMix, takeStopMix, clearStopMix } from './todaysMix';

// Node test env has no localStorage — minimal in-memory shim.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

const PRODUCTS = [{
  id: 'chem1',
  productName: 'Battleship III',
  epaRegNum: '228-453-5905',
  targetSite: 'Turf',
  applicationRate: '1.3 oz per 1,000 sqft',
  customerNotices: ['Keep off until dry'],
  category: 'Weed Control'
}];

const SETTINGS = { applicatorName: 'Dylan Jones', licenseNumber: '289304-CA', businessPhone: '555-0100' };

describe('todaysMix', () => {
  beforeEach(() => store.clear());

  it('round-trips a mix set today', () => {
    setTodaysMix(PRODUCTS, 'On-Site (Customer Property)');
    const mix = getTodaysMix();
    expect(mix).not.toBeNull();
    expect(mix.products).toHaveLength(1);
    expect(mix.mixSite).toBe('On-Site (Customer Property)');
  });

  it('expires a mix from a previous day', () => {
    const yesterday = Date.now() - 86400000;
    setTodaysMix(PRODUCTS, 'Business Location', yesterday);
    expect(getTodaysMix()).toBeNull();
  });

  it('treats an empty product list as no mix', () => {
    setTodaysMix([], 'Business Location');
    expect(getTodaysMix()).toBeNull();
  });

  it('returns null after clearing', () => {
    setTodaysMix(PRODUCTS);
    clearTodaysMix();
    expect(getTodaysMix()).toBeNull();
  });

  it('localDateKey is a zero-padded local date', () => {
    expect(localDateKey(new Date(2026, 0, 5).getTime())).toBe('2026-01-05');
  });

  it('buildLogFromMix fills applicator, customer, times, and products', () => {
    const mix = setTodaysMix(PRODUCTS, 'Business Location');
    const exitTime = new Date(2026, 6, 28, 14, 30).getTime();
    const log = buildLogFromMix(mix, {
      customer: { name: 'Preacher', phone: '555-1234', address: '1 Main St', lawnSize: '10000 sqft' },
      exitTime,
      durationSecs: 1800
    }, SETTINGS);
    expect(log.applicatorName).toBe('Dylan Jones');
    expect(log.licenseNumber).toBe('289304-CA');
    expect(log.customerName).toBe('Preacher');
    expect(log.areaTreated).toContain('10,000');
    expect(log.products).toHaveLength(1);
    expect(log.products[0].epaRegNum).toBe('228-453-5905');
    expect(log.autoFiledFromMix).toBe(true);
    expect(log.dateOfService).toBe(new Date(exitTime).toLocaleDateString());
  });

  it('stop mix: peek matches only the same customer, same day', () => {
    setStopMix(42, PRODUCTS);
    expect(peekStopMix(42)).not.toBeNull();
    expect(peekStopMix(99)).toBeNull();
    const yesterday = Date.now() - 86400000;
    setStopMix(42, PRODUCTS, 'Business Location', yesterday);
    expect(peekStopMix(42)).toBeNull();
  });

  it('stop mix: take returns the match and always clears the slot', () => {
    setStopMix(42, PRODUCTS);
    expect(takeStopMix(42)).not.toBeNull();
    expect(peekStopMix(42)).toBeNull();

    // Mismatched (stale) entry is dropped, not left to shadow a later stop.
    setStopMix(42, PRODUCTS);
    expect(takeStopMix(99)).toBeNull();
    expect(peekStopMix(42)).toBeNull();
  });

  it('stop mix: independent of the day mix', () => {
    setTodaysMix(PRODUCTS);
    setStopMix(42, [{ ...PRODUCTS[0], productName: 'Spot Product' }]);
    clearStopMix();
    expect(getTodaysMix()).not.toBeNull();
    expect(peekStopMix(42)).toBeNull();
  });

  it('per-visit logs get independent product copies (no shared mutation)', () => {
    const mix = setTodaysMix(PRODUCTS);
    const a = buildLogFromMix(mix, { customer: { name: 'A' }, exitTime: Date.now(), durationSecs: 600 }, SETTINGS);
    const b = buildLogFromMix(mix, { customer: { name: 'B' }, exitTime: Date.now(), durationSecs: 600 }, SETTINGS);
    a.products[0].applicationRate = 'spot only';
    expect(b.products[0].applicationRate).toBe('1.3 oz per 1,000 sqft');
    expect(mix.products[0].applicationRate).toBe('1.3 oz per 1,000 sqft');
  });
});
