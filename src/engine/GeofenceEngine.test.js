import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeofenceEngine, getDistance, pointInPolygon } from './GeofenceEngine';

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

    // Stay inside for 8 seconds total
    time += 4000;
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });
    expect(onEnter).toHaveBeenCalledWith(customer);
    expect(engine.activeGeofenceId).toBe('c1');

    // Stay inside for 10 minutes (600,000 ms)
    time += 600000;
    engine.updateLocation({ lat: 40.006, lng: -73.994, timestamp: time });
    expect(onExit).not.toHaveBeenCalled();

    // Exit the geofence
    time += 1000;
    engine.updateLocation({ lat: 39.0, lng: -75.0, timestamp: time });
    
    // Stay outside for 10 seconds
    time += 10000;
    engine.updateLocation({ lat: 39.0, lng: -75.0, timestamp: time });
    expect(onExit).not.toHaveBeenCalled(); // Debounce is 15s

    // Stay outside for 15 seconds total
    time += 5000;
    engine.updateLocation({ lat: 39.0, lng: -75.0, timestamp: time });
    
    // Should have logged an exit. Duration = 601000ms / 1000 = 601s
    expect(onExit).toHaveBeenCalledWith(customer, 601);
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
    expect(onDriveBy).toHaveBeenCalledWith(customer, 20); // 20s duration
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

    // GPS drifts OUT of geofence for 5 seconds
    engine.updateLocation({ lat: 39.0, lng: -75.0, timestamp: time });
    time += 5000;
    engine.updateLocation({ lat: 39.0, lng: -75.0, timestamp: time });
    
    // GPS bounces BACK IN
    time += 1000;
    engine.updateLocation({ lat: 40.005, lng: -73.995, timestamp: time });

    // Should NOT have exited because it was outside for < 15s
    expect(onExit).not.toHaveBeenCalled();
    expect(engine.activeGeofenceId).toBe('c1');
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
});
