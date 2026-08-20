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

// Do two line segments (p1→p2 and p3→p4) cross? Uses orientation of the four
// point triples. Coordinates are treated as planar (lat/lng); fine at the
// street-block scale of an arrival zone.
const segmentsIntersect = (p1, p2, p3, p4) => {
  const orient = (a, b, c) => {
    const v = (b.lat - a.lat) * (c.lng - a.lng) - (b.lng - a.lng) * (c.lat - a.lat);
    if (v > 1e-12) return 1;
    if (v < -1e-12) return -1;
    return 0;
  };
  const onSeg = (a, b, c) =>
    Math.min(a.lat, b.lat) <= c.lat && c.lat <= Math.max(a.lat, b.lat) &&
    Math.min(a.lng, b.lng) <= c.lng && c.lng <= Math.max(a.lng, b.lng);

  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);

  if (o1 !== o2 && o3 !== o4) return true;
  // Colinear touching cases
  if (o1 === 0 && onSeg(p1, p2, p3)) return true;
  if (o2 === 0 && onSeg(p1, p2, p4)) return true;
  if (o3 === 0 && onSeg(p3, p4, p1)) return true;
  if (o4 === 0 && onSeg(p3, p4, p2)) return true;
  return false;
};

// Fast axis-aligned bounding-box rejection so we only do real work on the
// handful of zones that could plausibly touch.
const boundsOf = (poly) => {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of poly) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
};

const boundsOverlap = (a, b) =>
  a.minLat <= b.maxLat && a.maxLat >= b.minLat &&
  a.minLng <= b.maxLng && a.maxLng >= b.minLng;

// Do two arrival-zone polygons overlap at all? True if their areas intersect —
// covers edge crossings and full containment (one zone entirely inside another).
export const polygonsOverlap = (a, b) => {
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  if (!boundsOverlap(boundsOf(a), boundsOf(b))) return false;

  // Any edge of A crosses any edge of B → the outlines intersect.
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j], b2 = b[(j + 1) % b.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  // No edges cross: one polygon is either fully inside the other or disjoint.
  // A single point-containment test each way distinguishes them.
  if (pointInPolygon(a[0], b)) return true;
  if (pointInPolygon(b[0], a)) return true;
  return false;
};

// Meters from a point to the nearest edge of a polygon (0 on an edge).
// Local equirectangular projection — accurate at arrival-zone scale.
export const metersToPolygonEdge = (point, polygon) => {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const toXY = (p) => ({ x: (p.lng - point.lng) * mPerDegLng, y: (p.lat - point.lat) * mPerDegLat });
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = toXY(polygon[j]);
    const b = toXY(polygon[i]);
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : (-a.x * dx - a.y * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * dx, py = a.y + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < best) best = d;
  }
  return best;
};

// Return the customers whose arrival zone overlaps `fence`, excluding the one
// being edited (selfId). Used to warn before two zones can steal each other's
// GPS timer triggers.
export const findOverlappingCustomers = (fence, customers, selfId = null) => {
  if (!fence || fence.length < 3) return [];
  return customers.filter(c =>
    c.id !== selfId &&
    Array.isArray(c.geofence) &&
    c.geofence.length >= 3 &&
    polygonsOverlap(fence, c.geofence)
  );
};

// Per-division tuning. What separates the divisions is whether "the truck is
// moving" means "the job is over": mowing/fert work happens with the truck
// parked, so driving speed is proof of departure; plowing IS driving, so the
// snow profile disables the speed rule and instead widens the buffer (pushing
// snow across the street is part of the job) and leans on distance + arriving
// at the next stop. Snow is pre-tuned for when that division gets built.
export const DIVISION_PROFILES = {
  mowing:     { enterDebounceMs: 8000, exitDebounceMs: 15000, exitBufferMeters: 20, speedExitMph: 10,   distanceExitMeters: 100, fastExitConfirmMs: 3000 },
  fertilizer: { enterDebounceMs: 8000, exitDebounceMs: 15000, exitBufferMeters: 20, speedExitMph: 10,   distanceExitMeters: 100, fastExitConfirmMs: 3000 },
  snow:       { enterDebounceMs: 8000, exitDebounceMs: 40000, exitBufferMeters: 50, speedExitMph: null, distanceExitMeters: 150, fastExitConfirmMs: 3000 },
};

export class GeofenceEngine {
  constructor(config = {}) {
    // Config
    this.enterDebounceMs = config.enterDebounceMs || 8000;
    this.exitDebounceMs = config.exitDebounceMs || 15000;
    this.drivebyThresholdSecs = config.drivebyThresholdSecs || 45;
    // Exit hysteresis: a fix must be this many meters BEYOND the fence edge to
    // count as "left" — parked-device GPS drift hovers just outside the line.
    this.exitBufferMeters = config.exitBufferMeters ?? 20;
    // Fast exits: while beyond the buffer, a fix moving at driving speed (mph,
    // Doppler-derived — a parked drifting device reads ~0) or one clearly far
    // from the fence ends the job after fastExitConfirmMs instead of the full
    // exit debounce. speedExitMph: null disables the speed rule (plowing).
    this.speedExitMph = config.speedExitMph !== undefined ? config.speedExitMph : 10;
    this.distanceExitMeters = config.distanceExitMeters ?? 100;
    this.fastExitConfirmMs = config.fastExitConfirmMs ?? 3000;
    // If the fix stream goes dark longer than this (screen off, GPS loss, all
    // fixes rejected for poor accuracy), debounce clocks restart rather than
    // letting a pre-gap blip count the whole gap as elapsed evidence.
    this.gapResetMs = config.gapResetMs || 30000;

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
    this.lastFixTs = null;      // timestamp of the last ACCEPTED fix (gap guard)

    // Takeover fast-lane state: the last fix that was at the active job, and
    // whether we've seen proof of actually leaving it since (a fix clearly
    // beyond the buffer, or driving speed). With proof, the next route stop
    // takes over on the normal enter debounce instead of exit-level evidence.
    this.lastAtActiveTs = null;
    this.leftActiveEvidence = false;

    this.jobStartTime = null;

    // Context Data
    this.routeStops = [];
    this.allCustomers = [];
    this.routeVisits = [];
    this.dismissedOpportunities = new Set();
    this.servicedTodayIds = new Set();
    this.recentlyServicedIds = new Set();
    
    // Manual Anchor
    this.anchorGeofence = null;
    
    // Timer Status
    this.isJobPaused = false;
  }

  setContext({ routeStops = [], allCustomers = [], routeVisits = [], dismissedOpportunities = new Set(), servicedTodayIds = new Set(), recentlyServicedIds = new Set(), anchorGeofence = null, isJobPaused = false, profile = null }) {
    this.routeStops = routeStops;
    this.allCustomers = allCustomers;
    this.routeVisits = routeVisits;
    this.dismissedOpportunities = dismissedOpportunities;
    this.servicedTodayIds = servicedTodayIds;
    // Customers with a completed division visit today or yesterday on ANY
    // route: their stops never auto-arrive (a lawn done a day early must not
    // re-track and double-bill). Manual Start/Redo still works — the scan
    // always keeps the active customer.
    this.recentlyServicedIds = recentlyServicedIds;
    this.anchorGeofence = anchorGeofence;
    this.isJobPaused = isJobPaused;
    this.applyProfile(profile);
  }

  // Retune thresholds for the active division (see DIVISION_PROFILES).
  applyProfile(p) {
    if (!p) return;
    if (p.enterDebounceMs != null) this.enterDebounceMs = p.enterDebounceMs;
    if (p.exitDebounceMs != null) this.exitDebounceMs = p.exitDebounceMs;
    if (p.exitBufferMeters != null) this.exitBufferMeters = p.exitBufferMeters;
    if ('speedExitMph' in p) this.speedExitMph = p.speedExitMph; // null = rule off
    if (p.distanceExitMeters != null) this.distanceExitMeters = p.distanceExitMeters;
    if (p.fastExitConfirmMs != null) this.fastExitConfirmMs = p.fastExitConfirmMs;
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

  // Is the fix still "at" the active job for exit purposes? True while inside
  // the fence (or anchor radius) OR within exitBufferMeters of the fence edge.
  checkNearActiveCustomer(loc) {
    const customer = this.activeCustomer;
    if (!customer) return false;
    if (this.checkInsideCustomer(loc, customer)) return true;
    const fence = customer.geofence;
    if (this.exitBufferMeters > 0 && fence && fence.length >= 3) {
      return metersToPolygonEdge(loc, fence) <= this.exitBufferMeters;
    }
    return false;
  }

  // Meters past the active job's boundary (fence edge, or the 150m anchor
  // radius for manually anchored jobs). 0 when at/inside the boundary.
  metersBeyondActive(loc) {
    const customer = this.activeCustomer;
    if (!customer) return 0;
    if (this.anchorGeofence && this.activeGeofenceId === customer.id) {
      if (this.anchorGeofence === 'no-gps') return 0;
      const d = getDistance(loc.lat, loc.lng, this.anchorGeofence.lat, this.anchorGeofence.lng);
      return Math.max(0, d - 150);
    }
    const fence = customer.geofence;
    if (!fence || fence.length < 3) return 0;
    if (pointInPolygon(loc, fence)) return 0;
    return metersToPolygonEdge(loc, fence);
  }

  updateLocation({ lat, lng, accuracy, speed = null, timestamp = Date.now() }) {
    // Skip checking if GPS accuracy is very poor (>30m) to prevent phantom geofence bounces
    if (accuracy && accuracy > 30) return;

    // Gap guard: no usable fixes for a while means no evidence either way.
    if (this.lastFixTs !== null && timestamp - this.lastFixTs > this.gapResetMs) {
      this.potentialEnter = null;
      this.potentialExit = null;
    }
    this.lastFixTs = timestamp;

    const loc = { lat, lng };
    let insideCustomers = [];

    // 1. Scan planned route stops first. The active job is scanned even when a
    // visit already exists (a redo of a completed/skipped stop must not get
    // force-exited just because the engine can no longer "see" the customer).
    for (const customer of this.routeStops) {
      if (customer.id !== this.activeGeofenceId &&
          (this.isCustomerCompleted(customer.id) || this.recentlyServicedIds.has(customer.id))) continue;

      if (this.checkInsideCustomer(loc, customer)) {
        insideCustomers.push(customer);
      }
    }

    // 2. Scan all other customers for opportunistic visits. Skip anyone already
    // serviced today on ANY route (matching the post-completion prompt's rule —
    // a lawn knocked out earlier must not re-offer itself on the drive past).
    // When zones overlap, the closest centroid wins instead of array order.
    let foundOpportunity = null;
    let closestOppDist = Infinity;
    for (const customer of this.allCustomers) {
      if (this.routeStops.some(s => s.id === customer.id)) continue;
      if (this.dismissedOpportunities.has(customer.id)) continue;
      if (this.servicedTodayIds.has(customer.id)) continue;

      if (this.checkInsideCustomer(loc, customer)) {
        const fence = customer.geofence || [];
        let d = 0;
        if (fence.length > 0) {
          const centerLat = fence.reduce((s, p) => s + p.lat, 0) / fence.length;
          const centerLng = fence.reduce((s, p) => s + p.lng, 0) / fence.length;
          d = getDistance(loc.lat, loc.lng, centerLat, centerLng);
        }
        if (d < closestOppDist) {
          closestOppDist = d;
          foundOpportunity = customer;
        }
      }
    }
    this.onOpportunityFound(foundOpportunity);

    // 3. Hysteresis: while a job is active, any fix inside-or-near the active
    // fence counts as "at the job" and nothing else may claim it. This kills
    // both drift exits (a few meters over the line) and neighbor steal when
    // working near a shared/overlapping edge — the neighbor only gets a shot
    // once the fix is clearly beyond the active fence plus buffer.
    if (this.activeGeofenceId && this.activeCustomer && this.checkNearActiveCustomer(loc)) {
      insideCustomers = [this.activeCustomer];
      // Settled at the job: remember the moment (honest exit stamps) and clear
      // any leave-proof so a later drift restarts the takeover requirements.
      this.lastAtActiveTs = timestamp;
      this.leftActiveEvidence = false;
    }

    // 3b. Resolve which customer we are officially inside right now
    let insideCustomer = null;
    if (insideCustomers.length === 1) {
      insideCustomer = insideCustomers[0];
    } else if (insideCustomers.length > 1) {
      // Pick the closest if overlapping. A customer without a polygon can only
      // have matched via the manual anchor — explicit intent, so it wins outright.
      let closestDist = Infinity;
      for (const cust of insideCustomers) {
        const fence = cust.geofence || [];
        let d = -1;
        if (fence.length > 0) {
          const centerLat = fence.reduce((s, p) => s + p.lat, 0) / fence.length;
          const centerLng = fence.reduce((s, p) => s + p.lng, 0) / fence.length;
          d = getDistance(loc.lat, loc.lng, centerLat, centerLng);
        }
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

      if (this.activeGeofenceId === insideCustomer.id) {
        // Settled at the active job — kill any half-built takeover so a later
        // drift into a neighbor starts its clock from zero, not from the last
        // interrupted attempt.
        if (this.potentialEnter) {
          this.potentialEnter = null;
          this.onPendingEnter(null, 0);
        }
      } else {
        // Takeover while a job is running never happens while paused: paused
        // means "parked here on purpose", not "gone".
        if (this.activeGeofenceId && this.isJobPaused) {
          if (this.potentialEnter) {
            this.potentialEnter = null;
            this.onPendingEnter(null, 0);
          }
          return;
        }
        // Driving speed while standing in another stop's zone is leave-proof too.
        if (this.activeGeofenceId && this.speedExitMph != null && speed != null && speed >= this.speedExitMph) {
          this.leftActiveEvidence = true;
        }
        // Takeover fast-lane: with proof we actually left the active job (a fix
        // clearly beyond its buffer, or driving speed), the next stop takes over
        // on the normal enter debounce. Without proof — fixes just flip-flopping
        // between two adjacent fences, which is what parked drift looks like —
        // it demands exit-level evidence (the longer of the two debounces).
        const requiredMs = this.activeGeofenceId && !this.leftActiveEvidence
          ? Math.max(this.enterDebounceMs, this.exitDebounceMs)
          : this.enterDebounceMs;

        // We aren't officially inside this one yet.
        if (!this.potentialEnter || this.potentialEnter.id !== insideCustomer.id) {
          // Start the debounce enter timer
          this.potentialEnter = { id: insideCustomer.id, customer: insideCustomer, timestamp, lastSeen: timestamp };
          this.onPendingEnter(insideCustomer, Math.ceil(requiredMs / 1000));
        } else {
          // Update last seen
          this.potentialEnter.lastSeen = timestamp;
          const elapsed = timestamp - this.potentialEnter.timestamp;
          const remaining = Math.max(0, Math.ceil((requiredMs - elapsed) / 1000));
          this.onPendingEnter(insideCustomer, remaining);

          if (elapsed >= requiredMs) {
            // WE HAVE OFFICIALLY ENTERED! The job started when we first hit
            // the zone (potentialEnter), not when the debounce finished.
            const startedAt = this.potentialEnter.timestamp;
            if (this.activeGeofenceId) {
              this.forceExit(timestamp);
            }

            this.activeGeofenceId = insideCustomer.id;
            this.activeCustomer = insideCustomer;
            this.jobStartTime = startedAt;
            this.lastAtActiveTs = timestamp;
            this.leftActiveEvidence = false;
            this.potentialEnter = null;

            this.onEnter(insideCustomer, startedAt);
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
        // Clearly beyond the buffer and inside nobody — proof of leaving,
        // whatever the pause state (drift can't get here: the clamp above
        // owns everything within the buffer).
        this.leftActiveEvidence = true;

        if (this.isJobPaused) {
           this.potentialExit = null; // Do not auto-exit if timer is explicitly paused
        } else {
          // Start or continue the exit debounce timer
          if (!this.potentialExit) {
            this.potentialExit = timestamp;
          } else {
            const elapsed = timestamp - this.potentialExit;
            // Fast exits: a fix at driving speed (parked drift reads ~0 mph)
            // or one far past the fence proves departure — no need to sit out
            // the full debounce. Both still want a short confirm window so a
            // single rogue fix can't end a job.
            const beyond = this.metersBeyondActive(loc);
            const fastEvidence =
              (this.speedExitMph != null && speed != null && speed >= this.speedExitMph) ||
              (this.distanceExitMeters != null && beyond >= this.distanceExitMeters);
            if (elapsed >= this.exitDebounceMs || (fastEvidence && elapsed >= this.fastExitConfirmMs)) {
              // WE HAVE OFFICIALLY EXITED!
              this.forceExit(timestamp);
            }
          }
        }
      }
    }
  }

  forceExit(timestamp = Date.now()) {
    if (!this.activeGeofenceId || !this.jobStartTime) return;

    // We exited when the exit clock started (potentialExit). On a takeover —
    // where being inside the next zone kept clearing that clock — fall back to
    // the last fix actually AT this job, so the drive over and the takeover
    // debounce never count as time on the lawn.
    const exitTime = this.potentialExit ?? this.lastAtActiveTs ?? timestamp;
    const durationSecs = Math.max(0, Math.floor((exitTime - this.jobStartTime) / 1000));

    const exitedCustomer = this.activeCustomer;

    this.activeGeofenceId = null;
    this.activeCustomer = null;
    this.anchorGeofence = null;
    this.jobStartTime = null;
    this.potentialExit = null;
    this.lastAtActiveTs = null;
    this.leftActiveEvidence = false;

    // Callbacks get the moment the fence was actually left (exitTime), so the
    // caller can end the logged duration there instead of "now" — otherwise
    // every auto-exit silently inflates the job by the debounce length.
    if (durationSecs < this.drivebyThresholdSecs) {
      this.onDriveBy(exitedCustomer, durationSecs, exitTime);
    } else {
      this.onExit(exitedCustomer, durationSecs, exitTime);
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
    this.lastAtActiveTs = timestamp;
    this.leftActiveEvidence = false;
    this.potentialEnter = null;
    this.potentialExit = null;
    this.onEnter(customer, timestamp);
  }

  manualExitJob(timestamp = Date.now()) {
    this.potentialExit = timestamp; // Ensure the exit time reflects exactly when they tapped
    this.forceExit(timestamp);
  }
}
