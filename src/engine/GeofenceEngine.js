// Haversine formula to calculate distance in meters
export const getDistance = (lat1, lon1, lat2, lon2) => {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p) / 2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p)) / 2;
  return 12742 * Math.asin(Math.sqrt(a)) * 1000;
};

// Ray-Casting Algorithm for Point in Polygon
// polygon is an array of { lat, lng } objects
export const pointInPolygon = (point, polygon) => {
  const { lat, lng } = point;
  let isInside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;

    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
};

export class GeofenceEngine {
  constructor(config = {}) {
    // Config
    this.enterDebounceMs = config.enterDebounceMs || 8000;
    this.exitDebounceMs = config.exitDebounceMs || 15000;
    this.drivebyThresholdSecs = config.drivebyThresholdSecs || 45;

    // Callbacks
    this.onEnter = config.onEnter || (() => {});
    this.onPendingEnter = config.onPendingEnter || (() => {});
    this.onExit = config.onExit || (() => {});
    this.onDriveBy = config.onDriveBy || (() => {});
    this.onOpportunityFound = config.onOpportunityFound || (() => {});

    // State
    this.activeGeofenceId = null;
    this.activeCustomer = null;
    
    this.potentialEnter = null; // { id, customer, timestamp, lastSeen }
    this.potentialExit = null;  // timestamp of when we first exited

    this.jobStartTime = null;

    // Context Data
    this.routeStops = [];
    this.allCustomers = [];
    this.routeVisits = [];
    this.dismissedOpportunities = new Set();
    
    // Manual Anchor
    this.anchorGeofence = null;
    
    // Timer Status
    this.isJobPaused = false;
  }

  setContext({ routeStops = [], allCustomers = [], routeVisits = [], dismissedOpportunities = new Set(), anchorGeofence = null, isJobPaused = false }) {
    this.routeStops = routeStops;
    this.allCustomers = allCustomers;
    this.routeVisits = routeVisits;
    this.dismissedOpportunities = dismissedOpportunities;
    this.anchorGeofence = anchorGeofence;
    this.isJobPaused = isJobPaused;
  }

  isCustomerCompleted(customerId) {
    return this.routeVisits.some(v => v.customerId === customerId && (v.status === 'completed' || v.status === 'skipped'));
  }

  checkInsideCustomer(loc, customer) {
    // Manual anchor override
    if (this.activeGeofenceId === customer.id && this.anchorGeofence) {
      if (this.anchorGeofence === 'no-gps') return true;
      const d = getDistance(loc.lat, loc.lng, this.anchorGeofence.lat, this.anchorGeofence.lng);
      return d <= 150;
    }

    if (customer.geofence && customer.geofence.length > 0) {
      if (pointInPolygon(loc, customer.geofence)) {
        return true;
      }
      // Fallback: within 15m of center
      const centerLat = customer.geofence.reduce((s, p) => s + p.lat, 0) / customer.geofence.length;
      const centerLng = customer.geofence.reduce((s, p) => s + p.lng, 0) / customer.geofence.length;
      const d = getDistance(loc.lat, loc.lng, centerLat, centerLng);
      return d <= 15;
    }
    return false;
  }

  updateLocation({ lat, lng, accuracy, timestamp = Date.now() }) {
    // Skip checking if GPS accuracy is very poor (>30m) to prevent phantom geofence bounces
    if (accuracy && accuracy > 30) return;

    const loc = { lat, lng };
    let insideCustomers = [];

    // 1. Scan planned route stops first
    for (const customer of this.routeStops) {
      if (this.isCustomerCompleted(customer.id)) continue;
      
      if (this.checkInsideCustomer(loc, customer)) {
        insideCustomers.push(customer);
      }
    }

    // 2. Scan all other customers for opportunistic visits
    let foundOpportunity = null;
    for (const customer of this.allCustomers) {
      if (this.routeStops.some(s => s.id === customer.id)) continue;
      if (this.dismissedOpportunities.has(customer.id)) continue;
      
      if (this.checkInsideCustomer(loc, customer)) {
        foundOpportunity = customer;
        break; // Just pick the first one we find
      }
    }
    this.onOpportunityFound(foundOpportunity);

    // 3. Resolve which customer we are officially inside right now
    let insideCustomer = null;
    if (insideCustomers.length === 1) {
      insideCustomer = insideCustomers[0];
    } else if (insideCustomers.length > 1) {
      // Pick the closest if overlapping
      let closestDist = Infinity;
      for (const cust of insideCustomers) {
        const centerLat = cust.geofence.reduce((s, p) => s + p.lat, 0) / cust.geofence.length;
        const centerLng = cust.geofence.reduce((s, p) => s + p.lng, 0) / cust.geofence.length;
        const d = getDistance(loc.lat, loc.lng, centerLat, centerLng);
        if (d < closestDist) {
          closestDist = d;
          insideCustomer = cust;
        }
      }
    }

    // 4. State Machine Logic
    if (insideCustomer) {
      // We are physically inside a geofence
      this.potentialExit = null; // Clear any pending exit

      if (this.activeGeofenceId !== insideCustomer.id) {
        // We aren't officially inside this one yet.
        if (!this.potentialEnter || this.potentialEnter.id !== insideCustomer.id) {
          // Start the debounce enter timer
          this.potentialEnter = { id: insideCustomer.id, customer: insideCustomer, timestamp, lastSeen: timestamp };
          this.onPendingEnter(insideCustomer, Math.ceil(this.enterDebounceMs / 1000));
        } else {
          // Update last seen
          this.potentialEnter.lastSeen = timestamp;
          const elapsed = timestamp - this.potentialEnter.timestamp;
          const remaining = Math.max(0, Math.ceil((this.enterDebounceMs - elapsed) / 1000));
          this.onPendingEnter(insideCustomer, remaining);

          if (elapsed >= this.enterDebounceMs) {
            // WE HAVE OFFICIALLY ENTERED!
            if (this.activeGeofenceId) {
              this.forceExit(timestamp);
            }

            this.activeGeofenceId = insideCustomer.id;
            this.activeCustomer = insideCustomer;
            this.jobStartTime = timestamp;
            this.potentialEnter = null;

            this.onEnter(insideCustomer);
          }
        }
      }
    } else {
      // We are NOT inside any geofence
      if (this.potentialEnter) {
        if (timestamp - this.potentialEnter.lastSeen > 5000) {
          this.potentialEnter = null;
          this.onPendingEnter(null, 0); // clear UI
        }
      } else {
        this.onPendingEnter(null, 0);
      }

      if (this.activeGeofenceId) {
        if (this.isJobPaused) {
           this.potentialExit = null; // Do not auto-exit if timer is explicitly paused
        } else {
          // Start or continue the exit debounce timer
          if (!this.potentialExit) {
            this.potentialExit = timestamp;
          } else if (timestamp - this.potentialExit >= this.exitDebounceMs) {
            // WE HAVE OFFICIALLY EXITED!
            this.forceExit(timestamp);
          }
        }
      }
    }
  }

  forceExit(timestamp = Date.now()) {
    if (!this.activeGeofenceId || !this.jobStartTime) return;
    
    // We exited at the moment the potentialExit began, so we calculate duration up to that point,
    // or if forced manually, up to now.
    const exitTime = this.potentialExit ? this.potentialExit : timestamp;
    const durationSecs = Math.max(0, Math.floor((exitTime - this.jobStartTime) / 1000));

    const exitedCustomer = this.activeCustomer;

    this.activeGeofenceId = null;
    this.activeCustomer = null;
    this.anchorGeofence = null;
    this.jobStartTime = null;
    this.potentialExit = null;

    if (durationSecs < this.drivebyThresholdSecs) {
      this.onDriveBy(exitedCustomer, durationSecs);
    } else {
      this.onExit(exitedCustomer, durationSecs);
    }
  }

  // To be called when user taps "Done" or "Start Job"
  manualStartJob(customer, timestamp = Date.now()) {
    if (this.activeGeofenceId) {
      this.forceExit(timestamp);
    }
    this.activeGeofenceId = customer.id;
    this.activeCustomer = customer;
    this.jobStartTime = timestamp;
    this.potentialEnter = null;
    this.potentialExit = null;
    this.onEnter(customer);
  }

  manualExitJob(timestamp = Date.now()) {
    this.potentialExit = timestamp; // Ensure the exit time reflects exactly when they tapped
    this.forceExit(timestamp);
  }
}
