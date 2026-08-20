import { describe, it, expect } from 'vitest';
import {
  centroid, haversineMeters, estimateJobMins, orderDayStops,
  dayTotalMins, cheapestInsertIndex, intervalStatus, todayName, isSnoozed,
  eligibleForMode, defaultServicesForMode, isScheduleAnchor,
} from './scheduler';

// A square geofence ~ centered on (lat,lng).
const geo = (lat, lng) => [
  { lat: lat + 0.0005, lng: lng - 0.0005 },
  { lat: lat + 0.0005, lng: lng + 0.0005 },
  { lat: lat - 0.0005, lng: lng + 0.0005 },
  { lat: lat - 0.0005, lng: lng - 0.0005 },
];
const cust = (id, lat, lng, extra = {}) => ({ id, name: 'C' + id, geofence: lat == null ? null : geo(lat, lng), lawnSize: '5000 sq ft', ...extra });
const tiered = [{ maxSqft: 10000, label: 's', pace: 500, rawHasData: true }]; // 500 sqft/min → 5000/500 = 10 min

describe('centroid', () => {
  it('averages polygon vertices', () => {
    const c = centroid(cust(1, 44.78, -88.6));
    expect(c.lat).toBeCloseTo(44.78, 5);
    expect(c.lng).toBeCloseTo(-88.6, 5);
  });
  it('returns null with no geofence', () => {
    expect(centroid(cust(1, null))).toBeNull();
  });
});

describe('haversineMeters', () => {
  it('is zero for a missing point', () => {
    expect(haversineMeters(null, { lat: 1, lng: 1 })).toBe(0);
  });
  it('grows with separation', () => {
    const near = haversineMeters({ lat: 44.78, lng: -88.6 }, { lat: 44.79, lng: -88.6 });
    const far = haversineMeters({ lat: 44.78, lng: -88.6 }, { lat: 44.90, lng: -88.6 });
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(1000); // ~1.1km per 0.01 deg lat
  });
});

describe('estimateJobMins', () => {
  it('uses tiered pace', () => {
    expect(estimateJobMins(cust(1, 44.78, -88.6), tiered)).toBeCloseTo(10, 5);
  });
  it('applies terrain + fence + obstacle modifiers', () => {
    const m = estimateJobMins(cust(1, 44.78, -88.6, { terrain: 'hilly', fencedBackyard: true, obstacleCount: 2 }), tiered);
    // 10 * 1.3 = 13, +3 fence = 16, +3 obstacles = 19
    expect(m).toBeCloseTo(19, 5);
  });
  it('is zero without a matrix or size', () => {
    expect(estimateJobMins(cust(1, 44.78, -88.6), [])).toBe(0);
    expect(estimateJobMins({ id: 1, lawnSize: '' }, tiered)).toBe(0);
  });
});

describe('orderDayStops', () => {
  it('honors an explicit dayOrder', () => {
    const a = cust(1, 44.78, -88.6, { dayOrder: 2 });
    const b = cust(2, 44.79, -88.6, { dayOrder: 0 });
    const c = cust(3, 44.80, -88.6, { dayOrder: 1 });
    expect(orderDayStops([a, b, c]).map((x) => x.id)).toEqual([2, 3, 1]);
  });
  it('nearest-neighbors from the northernmost stop', () => {
    const north = cust(1, 44.90, -88.6);
    const mid = cust(2, 44.85, -88.6);
    const south = cust(3, 44.80, -88.6);
    // Feed unsorted; expect N → mid → S.
    expect(orderDayStops([south, north, mid]).map((x) => x.id)).toEqual([1, 2, 3]);
  });
  it('pushes coordinate-less stops to the end', () => {
    const withPt = cust(1, 44.9, -88.6);
    const noPt = cust(2, null);
    expect(orderDayStops([noPt, withPt]).map((x) => x.id)).toEqual([1, 2]);
  });
});

describe('dayTotalMins', () => {
  it('sums job time plus inter-stop drive', () => {
    const stops = [cust(1, 44.80, -88.6), cust(2, 44.81, -88.6)];
    const total = dayTotalMins(orderDayStops(stops), tiered);
    expect(total).toBeGreaterThan(20); // 2×10 job + some drive
  });
  it('excludes snoozed stops', () => {
    const stops = [cust(1, 44.80, -88.6), cust(2, 44.81, -88.6, { snoozedUntil: Date.now() + 1e9 })];
    const total = dayTotalMins(orderDayStops(stops), tiered);
    expect(total).toBeCloseTo(10, 5); // only the one active job, no drive partner
  });
});

describe('cheapestInsertIndex', () => {
  it('inserts between the two nearest stops, not at the end', () => {
    const ordered = [cust(1, 44.80, -88.6), cust(3, 44.90, -88.6)];
    const mid = cust(2, 44.85, -88.6);
    const idx = cheapestInsertIndex(ordered, mid);
    expect(idx).toBe(1); // lands between stop 1 and stop 3
  });
  it('appends when the stop has no coordinates', () => {
    const ordered = [cust(1, 44.80, -88.6)];
    expect(cheapestInsertIndex(ordered, cust(2, null))).toBe(1);
  });
});

describe('intervalStatus', () => {
  it('flags late with the day excess', () => {
    expect(intervalStatus(12, 7)).toEqual({ kind: 'late', excess: 5 });
  });
  it('flags due exactly at the interval', () => {
    expect(intervalStatus(7, 7)).toEqual({ kind: 'due', excess: 0 });
  });
  it('is ok before the interval', () => {
    expect(intervalStatus(3, 7).kind).toBe('ok');
  });
  it('is new when never serviced', () => {
    expect(intervalStatus(null, 7).kind).toBe('new');
  });
});

describe('eligibleForMode', () => {
  const svc = (name, active = true) => ({ id: name, name, active, price: 0 });
  it('inactive customers are never eligible', () => {
    expect(eligibleForMode({ status: 'inactive', services: [svc('Mowing')] }, 'mowing')).toBe(false);
  });
  it('fertilizer requires an active fert-family service', () => {
    expect(eligibleForMode({ services: [svc('Fertilizer & Weed')] }, 'fertilizer')).toBe(true);
    expect(eligibleForMode({ services: [svc('Spray Program')] }, 'fertilizer')).toBe(true);
    expect(eligibleForMode({ services: [svc('Mowing')] }, 'fertilizer')).toBe(false);
    expect(eligibleForMode({ services: [svc('Fertilizer', false)] }, 'fertilizer')).toBe(false);
    expect(eligibleForMode({}, 'fertilizer')).toBe(false);
  });
  it('mowing accepts mow-family services and defaults service-less customers in', () => {
    expect(eligibleForMode({ services: [svc('Mowing')] }, 'mowing')).toBe(true);
    expect(eligibleForMode({ services: [] }, 'mowing')).toBe(true);
    expect(eligibleForMode({}, 'mowing')).toBe(true);
    expect(eligibleForMode({ services: [svc('Fertilizer')] }, 'mowing')).toBe(false);
  });
  it('tolerates services with no name', () => {
    expect(eligibleForMode({ services: [{ id: 'x', active: true }] }, 'fertilizer')).toBe(false);
  });
});

describe('defaultServicesForMode', () => {
  const svc = (id, name, active = true, price = 40) => ({ id, name, active, price });
  it('picks the fert-family service in fertilizer mode even when listed after mowing', () => {
    const c = { services: [svc('s1', 'Mowing'), svc('x', 'Fertilizer & Weed', true, 75)] };
    expect(defaultServicesForMode(c, 'fertilizer').map((s) => s.id)).toEqual(['x']);
  });
  it('picks the mow-family service in mowing mode', () => {
    const c = { services: [svc('x', 'Spray Program'), svc('y', 'Grass cutting')] };
    expect(defaultServicesForMode(c, 'mowing').map((s) => s.id)).toEqual(['y']);
  });
  it('falls back to the first active service when no family match', () => {
    const c = { services: [svc('a', 'Snow plowing', false), svc('b', 'Gutter cleaning')] };
    expect(defaultServicesForMode(c, 'fertilizer').map((s) => s.id)).toEqual(['b']);
  });
  it('legacy ids s1/s3 match without name hints', () => {
    const c = { services: [svc('s3', 'Program A'), svc('s1', 'Weekly service')] };
    expect(defaultServicesForMode(c, 'fertilizer').map((s) => s.id)).toEqual(['s3']);
    expect(defaultServicesForMode(c, 'mowing').map((s) => s.id)).toEqual(['s1']);
  });
  it('returns empty for no active services', () => {
    expect(defaultServicesForMode({ services: [svc('a', 'Mowing', false)] }, 'mowing')).toEqual([]);
    expect(defaultServicesForMode({}, 'mowing')).toEqual([]);
  });
});

describe('isScheduleAnchor', () => {
  it('completed visits always anchor', () => {
    expect(isScheduleAnchor({ status: 'completed' })).toBe(true);
  });
  it('deliberate cycle skips anchor', () => {
    expect(isScheduleAnchor({ status: 'skipped', countsForSchedule: true })).toBe(true);
  });
  it('plain / catch-up / force-end skips never anchor', () => {
    expect(isScheduleAnchor({ status: 'skipped' })).toBe(false);
    expect(isScheduleAnchor({ status: 'skipped', catchUp: true })).toBe(false);
    expect(isScheduleAnchor({ status: 'skipped', note: 'Forcibly skipped when ending route' })).toBe(false);
  });
});

describe('helpers', () => {
  it('todayName maps Sunday correctly', () => {
    // 2026-08-02 is a Sunday.
    expect(todayName(new Date(2026, 7, 2, 12).getTime())).toBe('Sunday');
    // 2026-08-03 is a Monday.
    expect(todayName(new Date(2026, 7, 3, 12).getTime())).toBe('Monday');
  });
  it('isSnoozed respects the timestamp', () => {
    expect(isSnoozed({ snoozedUntil: Date.now() + 1e6 })).toBe(true);
    expect(isSnoozed({ snoozedUntil: Date.now() - 1e6 })).toBe(false);
    expect(isSnoozed({})).toBe(false);
  });
});
