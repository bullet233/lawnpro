import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeofenceEngine, DIVISION_PROFILES, getDistance, pointInPolygon, polygonsOverlap, findOverlappingCustomers } from './GeofenceEngine';

describe('Math utilities', () => {
  it('calculates distance between points', () => {
    // Distance from NY to London is ~5570km
    const dist = getDistance(40.7128, -74.0060, 51.5074, -0.1278);
    expect(dist).toBeGreaterThan(5000000);
    expect(dist).toBeLessThan(6000000);
  });

  it('determines if a point is in a polygon', () => {
    const square = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 0 },
      { lat: 10, lng: 10 },
      { lat: 0, lng: 10 }
    ];
    expect(pointInPolygon({ lat: 5, lng: 5 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 15, lng: 15 }, square)).toBe(false);
    expect(pointInPolygon({ lat: 5, lng: -1 }, square)).toBe(false);
  });
});

describe('Geofence overlap detection', () => {
  const square = (minLat, minLng, maxLat, maxLng) => [
    { lat: minLat, lng: minLng },
    { lat: maxLat, lng: minLng },
    { lat: maxLat, lng: maxLng },
    { lat: minLat, lng: maxLng },
  ];

  it('detects two overlapping squares', () => {
    expect(polygonsOverlap(square(0, 0, 10, 10), square(5, 5, 15, 15))).toBe(true);
  });

  it('returns false for disjoint squares', () => {
    expect(polygonsOverlap(square(0, 0, 10, 10), square(20, 20, 30, 30))).toBe(false);
  });

  it('detects full containment (one zone inside another)', () => {
    expect(polygonsOverlap(square(0, 0, 100, 100), square(40, 40, 60, 60))).toBe(true);
  });

  it('detects edge crossing with no contained vertex (plus-sign overlap)', () => {
    const horizontal = square(4, 0, 6, 10);
    const vertical = square(0, 4, 10, 6);
    expect(polygonsOverlap(horizontal, vertical)).toBe(true);
  });

  it('ignores degenerate polygons', () => {
    expect(polygonsOverlap([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], square(0, 0, 10, 10))).toBe(false);
    expect(polygonsOverlap(null, square(0, 0, 10, 10))).toBe(false);
  });

  it('findOverlappingCustomers excludes self and non-overlapping / fenceless clients', () => {
    const fence = square(0, 0, 10, 10);
    const customers = [
      { id: 1, name: 'Self', geofence: fence },
      { id: 2, name: 'Neighbor', geofence: square(5, 5, 15, 15) },
      { id: 3, name: 'Faraway', geofence: square(50, 50, 60, 60) },
      { id: 4, name: 'No zone', geofence: null },
    ];
    const hits = findOverlappingCustomers(fence, customers, 1);
    expect(hits.map(c => c.id)).toEqual([2]);
  });
});

describe('GeofenceEngine', () => {
  let engine;
  let onEnter, onPendingEnter, onExit, onDriveBy, onOpportunityFound;
  let customer;

  beforeEach(() => {
    onEnter = vi.fn();
    onPendingEnter = vi.fn();
    onExit = vi.fn();
    onDriveBy = vi.fn();
    onOpportunityFound = vi.fn();

    engine = new GeofenceEngine({
      enterDebounceMs: 8000,
      exitDebounceMs: 15000,
      drivebyThresholdSecs: 45,
      onEnter,
      onPendingEnter,
      onExit,
      onDriveBy,
      onOpportunityFound
    });

    customer = {
      id: 'c1',
      name: 'Test Customer',
      geofence: [
        { lat: 40.000, lng: -74.000 },
        { lat: 40.010, lng: -74.000 },
        { lat: 40.010, lng: -73.990 },
        { lat: 40.000, lng: -73.990 }
      ]
    };

    engine.setContext({ routeStops: [customer] });
  });

  it('handles a normal visit (enter, stay, exit)', () => {
    let time = 100000;
    
    // Outside
    engine.updateLocation({ lat: 39.0, lng: -75.0, timestamp: time });
    expect(onPendingEnter).toHaveBeenCalledWith(null, 0);

    // Enter the geofence (point inside the square)
    time += 1000;
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });
    expect(onPendingEnter).toHaveBeenCalledWith(customer, 8); // 8s left

    // Stay inside for 4 seconds
    time += 4000;
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });
    expect(onPendingEnter).toHaveBeenCalledWith(customer, 4); // 4s left
    expect(onEnter).not.toHaveBeenCalled();

    // Stay inside for 8 seconds total. The job start is backdated to the FIRST
    // fix inside the zone (101000), not the debounce completion.
    time += 4000;
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });
    expect(onEnter).toHaveBeenCalledWith(customer, 101000);
    expect(engine.activeGeofenceId).toBe('c1');

    // Stay inside for 10 minutes (600,000 ms)
    time += 600000;
    engine.updateLocation({ lat: 40.006, lng: -73.994, timestamp: time });
    expect(onExit).not.toHaveBeenCalled();

    // Exit the geofence — a realistic ~55m past the edge (beyond the 20m
    // buffer but under the 100m distance fast-exit), so the slow path rules.
    time += 1000;
    engine.updateLocation({ lat: 39.9995, lng: -73.995, timestamp: time });

    // Stay outside for 10 seconds
    time += 10000;
    engine.updateLocation({ lat: 39.9995, lng: -73.995, timestamp: time });
    expect(onExit).not.toHaveBeenCalled(); // Debounce is 15s

    // Stay outside for 15 seconds total
    time += 5000;
    engine.updateLocation({ lat: 39.9995, lng: -73.995, timestamp: time });

    // Exit logged: 101000 → 710000 = 609s, stamped at the moment the fence
    // was left (710000), not when the debounce finished.
    expect(onExit).toHaveBeenCalledWith(customer, 609, 710000);
    expect(engine.activeGeofenceId).toBe(null);
  });

  it('handles a drive-by (enter, stay short, exit)', () => {
    let time = 100000;

    // Enter
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });
    time += 8000;
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });
    expect(onEnter).toHaveBeenCalled();

    // Stay for only 20 seconds
    time += 20000;

    // Exit
    engine.updateLocation({ lat: 39.0, lng: -75.0, timestamp: time });
    time += 15000; // wait out exit debounce
    engine.updateLocation({ lat: 39.0, lng: -75.0, timestamp: time });

    expect(onExit).not.toHaveBeenCalled();
    // Start backdated to first inside fix (100000), left at 128000 → 28s.
    expect(onDriveBy).toHaveBeenCalledWith(customer, 28, 128000);
  });

  it('debounces GPS drift (bouncing out temporarily)', () => {
    let time = 100000;

    // Enter
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });
    time += 8000;
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });
    expect(onEnter).toHaveBeenCalled();

    // Work for 5 minutes
    time += 300000;

    // GPS drifts ~55m out of the geofence for 5 seconds (a realistic drift
    // hop: beyond the buffer, under the distance fast-exit).
    engine.updateLocation({ lat: 39.9995, lng: -73.995, timestamp: time });
    time += 5000;
    engine.updateLocation({ lat: 39.9995, lng: -73.995, timestamp: time });

    // GPS bounces BACK IN
    time += 1000;
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });

    // Should NOT have exited because it was outside for < 15s
    expect(onExit).not.toHaveBeenCalled();
    expect(engine.activeGeofenceId).toBe('c1');
  });

  it('survives a manually-anchored customer without a geofence overlapping a polygon customer', () => {
    // Started manually at a customer that has no polygon (e.g. quick-added from
    // the field) while parked inside another customer's fence.
    const anchored = { id: 'c2', name: 'No-Fence Customer' };
    engine.setContext({
      routeStops: [customer, anchored],
      anchorGeofence: { lat: 40.005, lng: -73.995 }
    });
    engine.manualStartJob(anchored);
    expect(engine.activeGeofenceId).toBe('c2');

    // Inside c1's polygon AND within the anchor radius — both match.
    expect(() =>
      engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 100000 })
    ).not.toThrow();

    // The manual job stays active; the polygon customer does not steal it.
    expect(engine.activeGeofenceId).toBe('c2');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('ignores poor GPS accuracy', () => {
    let time = 100000;
    // We are inside, but accuracy is bad (50m)
    engine.updateLocation({ lat: 40.005, lng: -73.995, accuracy: 50, timestamp: time });
    expect(onPendingEnter).not.toHaveBeenCalled();

    // We get good accuracy (10m)
    time += 1000;
    engine.updateLocation({ lat: 40.005, lng: -73.995, accuracy: 10, timestamp: time });
    expect(onPendingEnter).toHaveBeenCalledWith(customer, 8);
  });

  // Enter the fence and complete the 8s debounce; returns the (backdated)
  // job-start timestamp — the first fix inside the zone.
  const enterAt = (startTime) => {
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: startTime });
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: startTime + 8000 });
    expect(onEnter).toHaveBeenCalledWith(customer, startTime);
    return startTime;
  };

  it('exit buffer: drift hovering just outside the fence never ends the job', () => {
    let time = enterAt(100000);
    // 39.9999 is ~11m south of the fence edge (lat 40.000) — outside the
    // polygon but inside the 20m exit buffer. Sit there for a full minute.
    for (let i = 0; i < 6; i++) {
      time += 10000;
      engine.updateLocation({ lat: 39.9999, lng: -73.995, timestamp: time });
    }
    expect(onExit).not.toHaveBeenCalled();
    expect(onDriveBy).not.toHaveBeenCalled();
    expect(engine.activeGeofenceId).toBe('c1');
  });

  it('exit buffer: clearly beyond the fence still exits', () => {
    let time = enterAt(100000);
    time += 60000;
    // 39.999 is ~111m south of the fence — well beyond the buffer.
    engine.updateLocation({ lat: 39.999, lng: -73.995, timestamp: time });
    engine.updateLocation({ lat: 39.999, lng: -73.995, timestamp: time + 15000 });
    // Entered at 100000, left at `time` (160000) → 60s job.
    expect(onExit).toHaveBeenCalledWith(customer, 60, time);
  });

  it('gap guard: a fix gap restarts the exit clock instead of exiting on wake', () => {
    let time = enterAt(100000);
    time += 60000;
    // One drift blip outside starts the exit clock…
    engine.updateLocation({ lat: 39.999, lng: -73.995, timestamp: time });
    // …then the stream goes dark for 40s (screen off / GPS loss). The next
    // outside fix must NOT exit — the clock restarts from here.
    engine.updateLocation({ lat: 39.999, lng: -73.995, timestamp: time + 40000 });
    expect(onExit).not.toHaveBeenCalled();
    expect(onDriveBy).not.toHaveBeenCalled();
    // Back inside — no harm done.
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time + 41000 });
    expect(engine.activeGeofenceId).toBe('c1');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('a stop serviced a day early never auto-arrives (manual start still works)', () => {
    engine.setContext({ routeStops: [customer], recentlyServicedIds: new Set(['c1']) });
    // Parked inside the zone well past the enter debounce — no arrival.
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 100000 });
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 110000 });
    expect(onEnter).not.toHaveBeenCalled();
    expect(engine.activeGeofenceId).toBe(null);
    // Deliberate re-service via the Start/Redo button tracks normally.
    engine.manualStartJob(customer, 120000);
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 130000 });
    expect(engine.activeGeofenceId).toBe('c1');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('redo: a manually restarted completed/skipped stop keeps tracking', () => {
    engine.setContext({
      routeStops: [customer],
      routeVisits: [{ customerId: 'c1', status: 'completed' }],
    });
    engine.manualStartJob(customer, 100000);
    // Standing inside the fence for a minute: the old scan filtered completed
    // customers out entirely, so this force-exited ~15s in.
    let time = 100000;
    for (let i = 0; i < 6; i++) {
      time += 10000;
      engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });
    }
    expect(engine.activeGeofenceId).toBe('c1');
    expect(onExit).not.toHaveBeenCalled();
    expect(onDriveBy).not.toHaveBeenCalled();
  });
});

describe('zone-steal protection', () => {
  let engine;
  let onEnter, onExit, onDriveBy, onPendingEnter;
  // A: lat 40.000-40.010. B far north. C overlaps A's south edge.
  const custA = { id: 'a', name: 'A', geofence: [
    { lat: 40.000, lng: -74.000 }, { lat: 40.010, lng: -74.000 },
    { lat: 40.010, lng: -73.990 }, { lat: 40.000, lng: -73.990 },
  ] };
  const custB = { id: 'b', name: 'B', geofence: [
    { lat: 40.020, lng: -74.000 }, { lat: 40.030, lng: -74.000 },
    { lat: 40.030, lng: -73.990 }, { lat: 40.020, lng: -73.990 },
  ] };
  const custC = { id: 'c', name: 'C', geofence: [
    { lat: 39.995, lng: -74.000 }, { lat: 40.001, lng: -74.000 },
    { lat: 40.001, lng: -73.990 }, { lat: 39.995, lng: -73.990 },
  ] };

  const makeActive = (extraCtx = {}) => {
    onEnter = vi.fn(); onExit = vi.fn(); onDriveBy = vi.fn(); onPendingEnter = vi.fn();
    engine = new GeofenceEngine({ onEnter, onExit, onDriveBy, onPendingEnter });
    engine.setContext({ routeStops: [custA, custB, custC], ...extraCtx });
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 100000 });
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 108000 });
    expect(engine.activeGeofenceId).toBe('a');
    return 108000;
  };

  it('without leave-proof a neighbor needs exit-level evidence (15s, not 8s)', () => {
    makeActive();
    // Dwell at A for a minute (last seen at A at 160000)…
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 130000 });
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 160000 });
    // …then fixes appear inside B with NO trail of leaving A (no street fixes,
    // no speed) — that's what parked drift looks like, so 8s must not steal.
    engine.updateLocation({ lat: 40.025, lng: -73.995, timestamp: 208000 });
    engine.updateLocation({ lat: 40.025, lng: -73.995, timestamp: 216000 });
    expect(engine.activeGeofenceId).toBe('a');
    engine.updateLocation({ lat: 40.025, lng: -73.995, timestamp: 223000 });
    // Exit-level evidence reached: A closes out, stamped at the last fix that
    // was actually AT A (160000) — the limbo never counts as time on A's lawn.
    expect(engine.activeGeofenceId).toBe('b');
    expect(onExit).toHaveBeenCalledWith(custA, 60, 160000);
    expect(onEnter).toHaveBeenLastCalledWith(custB, 208000);
  });

  it('with leave-proof (street fixes) the next stop takes over in the normal 8s', () => {
    makeActive();
    // Dwell at A (fix gaps under the 30s gap guard).
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 130000 });
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 158000 });
    // In the street: ~43m west of A's fence — beyond the buffer, inside nobody.
    engine.updateLocation({ lat: 40.005, lng: -74.0005, timestamp: 166000 });
    engine.updateLocation({ lat: 40.005, lng: -74.0005, timestamp: 170000 });
    expect(engine.activeGeofenceId).toBe('a'); // exit debounce not done — fine
    // Arrive at B: with the leaving trail, takeover runs at the enter debounce.
    engine.updateLocation({ lat: 40.025, lng: -73.995, timestamp: 172000 });
    engine.updateLocation({ lat: 40.025, lng: -73.995, timestamp: 180000 });
    expect(engine.activeGeofenceId).toBe('b');
    // A stamped at its last at-A fix; B backdated to its first in-zone fix.
    expect(onExit).toHaveBeenCalledWith(custA, 58, 158000);
    expect(onEnter).toHaveBeenLastCalledWith(custB, 172000);
  });

  it('returning to the active job wipes the leave-proof', () => {
    makeActive();
    // Brief street excursion (would grant proof)…
    engine.updateLocation({ lat: 40.005, lng: -74.0005, timestamp: 120000 });
    // …but we come back to A: proof cleared.
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 124000 });
    // Now drift into B for 8s — must NOT take over on the fast lane.
    engine.updateLocation({ lat: 40.025, lng: -73.995, timestamp: 130000 });
    engine.updateLocation({ lat: 40.025, lng: -73.995, timestamp: 138000 });
    expect(engine.activeGeofenceId).toBe('a');
    expect(onExit).not.toHaveBeenCalled();
    expect(onDriveBy).not.toHaveBeenCalled();
  });

  it('never steals while the job timer is paused', () => {
    let time = makeActive({ }) + 100000;
    engine.setContext({ routeStops: [custA, custB, custC], isJobPaused: true });
    for (let i = 0; i < 6; i++) {
      engine.updateLocation({ lat: 40.025, lng: -73.995, timestamp: time + i * 10000 });
    }
    expect(engine.activeGeofenceId).toBe('a');
    expect(onExit).not.toHaveBeenCalled();
    expect(onDriveBy).not.toHaveBeenCalled();
  });

  it('a fix inside an overlapping zone but within the buffer stays with the active job', () => {
    let time = makeActive() + 100000;
    // 39.9999 is strictly inside C's fence, but only ~11m outside A's — the
    // hysteresis clamp keeps the fix credited to A, so C can never steal it.
    for (let i = 0; i < 4; i++) {
      engine.updateLocation({ lat: 39.9999, lng: -73.995, timestamp: time + i * 10000 });
    }
    expect(engine.activeGeofenceId).toBe('a');
    expect(onExit).not.toHaveBeenCalled();
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});

describe('fast exits (speed / distance / division profiles)', () => {
  let engine, onEnter, onExit, onDriveBy;
  const customer = { id: 'c1', name: 'C1', geofence: [
    { lat: 40.000, lng: -74.000 }, { lat: 40.010, lng: -74.000 },
    { lat: 40.010, lng: -73.990 }, { lat: 40.000, lng: -73.990 },
  ] };

  // Enter at 100000 and dwell for a minute; last at-A fix lands at 160000.
  const enterAndDwell = (profile = null) => {
    onEnter = vi.fn(); onExit = vi.fn(); onDriveBy = vi.fn();
    engine = new GeofenceEngine({ onEnter, onExit, onDriveBy });
    engine.setContext({ routeStops: [customer], profile });
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 100000 });
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 108000 });
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 130000 });
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: 160000 });
    expect(engine.activeGeofenceId).toBe('c1');
  };

  it('driving speed ends the job in seconds, not the full debounce', () => {
    enterAndDwell();
    // ~55m outside (under the 100m distance rule) but at 15 mph — that's a
    // truck pulling away, not parked drift.
    engine.updateLocation({ lat: 39.9995, lng: -73.995, speed: 15, timestamp: 170000 });
    engine.updateLocation({ lat: 39.9995, lng: -73.995, speed: 15, timestamp: 173000 });
    // Exited after the 3s confirm, stamped at the moment we left (170000).
    expect(onExit).toHaveBeenCalledWith(customer, 70, 170000);
  });

  it('walking speed does not fast-exit', () => {
    enterAndDwell();
    // Pushing a mower across the street reads ~3 mph — stays on the slow path.
    engine.updateLocation({ lat: 39.9995, lng: -73.995, speed: 3, timestamp: 170000 });
    engine.updateLocation({ lat: 39.9995, lng: -73.995, speed: 3, timestamp: 173000 });
    engine.updateLocation({ lat: 39.9995, lng: -73.995, speed: 3, timestamp: 180000 });
    expect(onExit).not.toHaveBeenCalled();
    expect(onDriveBy).not.toHaveBeenCalled();
    expect(engine.activeGeofenceId).toBe('c1');
  });

  it('clearly far past the fence ends the job without speed data', () => {
    enterAndDwell();
    // ~222m out — some devices report no speed; distance alone is proof.
    engine.updateLocation({ lat: 39.998, lng: -73.995, timestamp: 170000 });
    engine.updateLocation({ lat: 39.998, lng: -73.995, timestamp: 173000 });
    expect(onExit).toHaveBeenCalledWith(customer, 70, 170000);
  });

  it('snow profile: speed rule off, fat buffer, long debounce', () => {
    enterAndDwell(DIVISION_PROFILES.snow);
    // ~111m out at 20 mph: plowing means driving, so speed proves nothing;
    // 111m is under snow's 150m line; only the 40s debounce can end it.
    engine.updateLocation({ lat: 39.999, lng: -73.995, speed: 20, timestamp: 170000 });
    engine.updateLocation({ lat: 39.999, lng: -73.995, speed: 20, timestamp: 175000 });
    engine.updateLocation({ lat: 39.999, lng: -73.995, speed: 20, timestamp: 195000 });
    expect(onExit).not.toHaveBeenCalled();
    expect(engine.activeGeofenceId).toBe('c1');
    engine.updateLocation({ lat: 39.999, lng: -73.995, speed: 20, timestamp: 210000 });
    expect(onExit).toHaveBeenCalledWith(customer, 70, 170000);
  });
});

describe('live opportunity scan', () => {
  // Square arrival zone centered on (lat, lng); `half` = half-width in degrees.
  const zone = (lat, lng, half = 0.001) => [
    { lat: lat + half, lng: lng - half },
    { lat: lat + half, lng: lng + half },
    { lat: lat - half, lng: lng + half },
    { lat: lat - half, lng: lng - half },
  ];
  const cust = (id, lat, lng, half) => ({ id, name: 'C' + id, geofence: zone(lat, lng, half) });
  const loc = { lat: 44.78, lng: -88.6, accuracy: 5, timestamp: 100000 };

  function makeEngine(ctx) {
    const found = [];
    const eng = new GeofenceEngine({ onOpportunityFound: (c) => found.push(c ? c.id : null) });
    eng.setContext(ctx);
    return { eng, found };
  }

  it('offers a customer whose zone contains the location', () => {
    const { eng, found } = makeEngine({ allCustomers: [cust(1, 44.78, -88.6)] });
    eng.updateLocation(loc);
    expect(found.at(-1)).toBe(1);
  });

  it('skips anyone already serviced today', () => {
    const { eng, found } = makeEngine({
      allCustomers: [cust(1, 44.78, -88.6)],
      servicedTodayIds: new Set([1]),
    });
    eng.updateLocation(loc);
    expect(found.at(-1)).toBeNull();
  });

  it('skips dismissed and on-route customers', () => {
    const a = cust(1, 44.78, -88.6);
    const b = cust(2, 44.78, -88.6);
    const { eng, found } = makeEngine({
      allCustomers: [a, b],
      routeStops: [a],
      dismissedOpportunities: new Set([2]),
    });
    eng.updateLocation(loc);
    expect(found.at(-1)).toBeNull();
  });

  it('picks the closest zone when two overlap, regardless of array order', () => {
    // A big zone whose centroid sits ~55m away still contains the location;
    // the small zone centered right on it must win despite being listed second.
    const far = cust(1, 44.7805, -88.6, 0.002);
    const near = cust(2, 44.78, -88.6, 0.0005);
    const { eng, found } = makeEngine({ allCustomers: [far, near] });
    eng.updateLocation(loc);
    expect(found.at(-1)).toBe(2);
  });

  it('clears the banner when nothing matches', () => {
    const { eng, found } = makeEngine({ allCustomers: [cust(1, 44.9, -88.6)] });
    eng.updateLocation(loc);
    expect(found.at(-1)).toBeNull();
  });
});
