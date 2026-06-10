import { useState, useEffect, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { GoogleMap, Marker, Polygon } from '@react-google-maps/api';
import { useMapStatus } from '../components/MapProvider';
import { CheckCircle, Navigation, MapPin, FastForward, CloudRain, ChevronUp, ChevronDown, SkipForward, Sun, CloudSun, Cloud, CloudDrizzle, CloudSnow, CloudLightning, X, Play, Pause, FileText, Map as MapIcon, ClipboardList, AlertTriangle } from 'lucide-react';
import { parseLawnSizeToSqFt } from '../utils/parseLawnSize';
import ComplianceLogModal from '../components/ComplianceLogModal';

function SlideToFinish({ onComplete }) {
  const [progress, setProgress] = useState(0);
  const trackRef = useRef(null);
  
  const handleMove = (clientX) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const p = x / rect.width;
    setProgress(p);
    if (p > 0.95) {
      onComplete();
      setProgress(0);
    }
  };

  const handleTouchMove = (e) => handleMove(e.touches[0].clientX);
  const handleMouseMove = (e) => { if (e.buttons === 1) handleMove(e.clientX); };
  const handleEnd = () => { if (progress < 0.95) setProgress(0); };

  return (
    <div 
      ref={trackRef}
      style={{ position: 'relative', height: '52px', background: '#ffffff', borderRadius: '26px', overflow: 'hidden', touchAction: 'none', border: 'none', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleEnd}
      onMouseMove={handleMouseMove}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: 'rgba(16,185,129,0.1)', transition: progress === 0 ? 'width 0.3s' : 'none' }} />
      <div style={{ position: 'absolute', width: '100%', textAlign: 'center', fontWeight: 800, color: '#10b981', fontSize: '0.95rem', letterSpacing: '1px', userSelect: 'none', pointerEvents: 'none' }}>
        SLIDE TO FINISH JOB
      </div>
      <div 
        style={{ position: 'absolute', left: `calc(${progress * 100}% - ${progress * 44}px - 4px)`, top: '4px', width: '44px', height: '44px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', transition: progress === 0 ? 'left 0.3s' : 'none', cursor: 'grab', zIndex: 2, boxShadow: '0 2px 8px rgba(16,185,129,0.4)' }}
      >
        <FastForward size={22} fill="currentColor" />
      </div>
    </div>
  );
}
import { useNavigate } from 'react-router-dom';
import DayReviewModal from '../components/DayReviewModal';
import AppDialog from '../components/AppDialog';
import TimeSplitModal from '../components/TimeSplitModal';
import EditJobModal from '../components/EditJobModal';
import QuickAddModal from '../components/QuickAddModal';
import { getSettings } from '../db/settings';
import { trackApiCall } from '../utils/apiTracker';

const mapContainerStyle = { width: '100%', height: 'calc(100vh - 8rem)', borderRadius: 'var(--radius-md)' };

// Haversine formula to calculate distance in meters
const getDistance = (lat1, lon1, lat2, lon2) => {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p) / 2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p)) / 2;
  return 12742 * Math.asin(Math.sqrt(a)) * 1000;
};

export default function LiveMap() {
  const navigate = useNavigate();
  const [currentPosition, setCurrentPosition] = useState(null);
  const [heading, setHeading] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [autoCenter, setAutoCenter] = useState(true);
  const autoCenterRef = useRef(true);
  const [mapTypeId, setMapTypeId] = useState('roadmap');
  const [weather, setWeather] = useState(null);
  const [activeEpaJob, setActiveEpaJob] = useState(null);
  const { isLoaded, loadError } = useMapStatus();
  
  const [activeGeofence, setActiveGeofence] = useState(null);
  const [drivebyPrompt, setDrivebyPrompt] = useState(null);
  const [isRouteListOpen, setIsRouteListOpen] = useState(false);
  const [liveDuration, setLiveDuration] = useState(0);
  const [drivingDuration, setDrivingDuration] = useState(0);
  const [isDrivingPaused, setIsDrivingPaused] = useState(true);
  const [timerState, setTimerState] = useState('idle'); // 'idle', 'running', 'paused'
  const timerStateRef = useRef('idle');
  const accumulatedTimeRef = useRef(0);
  const lastResumeTimeRef = useRef(null);
  const isDrivingPausedRef = useRef(true);
  const accumulatedDriveTimeRef = useRef(0);
  const lastDriveResumeTimeRef = useRef(Date.now());
  const potentialEnterRef = useRef(null);
  const potentialExitRef = useRef(null);
  const [completionPanel, setCompletionPanel] = useState(null);
  const [panelNote, setPanelNote] = useState('');
  const [liveNote, setLiveNote] = useState('');
  const liveNoteRef = useRef('');
  const [showLiveNoteModal, setShowLiveNoteModal] = useState(false);
  const [pendingArrival, setPendingArrival] = useState(null); // { name, secondsLeft }
  const completionTimerRef = useRef(null);
  const [showDayReview, setShowDayReview] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  // { primaryCustomer, primaryVisitId, durationSecs, nearbyCustomer }
  const [timeSplit, setTimeSplit] = useState(null);
  const [isEditJobOpen, setIsEditJobOpen] = useState(false);
  const [nearbyOpportunity, setNearbyOpportunity] = useState(null);
  const [skipPrompt, setSkipPrompt] = useState(null);
  const [poorGps, setPoorGps] = useState(false);

  const mapRef = useRef(null);
  const dismissedOpportunitiesRef = useRef(new Set());
  const jobStartRef = useRef(null);
  const activeGeofenceIdRef = useRef(null);
  const weatherTimerRef    = useRef(null);
  const panelTouchRef      = useRef(null); // for swipe-to-dismiss
  const routeVisitsRef     = useRef([]);
  const drivebyTimerRef    = useRef(null);
  const snapBackRef        = useRef(null);
  const activeRouteRef     = useRef(null);
  const allCustomersRef    = useRef([]);
  const panelNoteActiveRef = useRef(false);
  const polygonCacheRef    = useRef({});  // Cache Google Maps Polygon objects by customer ID
  const wakeLockRef         = useRef(null);  // Screen Wake Lock to keep GPS alive
  const weatherRef          = useRef(null); // Ref to hold latest weather for closures
  const anchorGeofenceRef   = useRef(null); // Temporary anchor for manual starts
  const latestLocRef        = useRef(null);
  const poorGpsRef          = useRef(false);

  const saveDriveTimerState = (isPaused, accumulated) => {
    localStorage.setItem('drive_timer_state', JSON.stringify({
      accumulated: accumulated,
      lastResume: lastDriveResumeTimeRef.current,
      isPaused: isPaused,
      savedAt: Date.now()
    }));
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem('drive_timer_state');
      if (stored) {
        const { accumulated, lastResume, isPaused, savedAt } = JSON.parse(stored);
        
        // Prevent runaway timers: if it's been >12 hours since last save, auto-pause it
        const isStale = savedAt && (Date.now() - savedAt > 12 * 60 * 60 * 1000);

        if (!isPaused && !isStale && lastResume && savedAt) {
          accumulatedDriveTimeRef.current = accumulated + (Date.now() - savedAt) / 1000;
          lastDriveResumeTimeRef.current = Date.now();
          isDrivingPausedRef.current = false;
          setIsDrivingPaused(false);
        } else {
          accumulatedDriveTimeRef.current = accumulated || 0;
          isDrivingPausedRef.current = true;
          setIsDrivingPaused(true);
          if (!isPaused && isStale) saveDriveTimerState(true, accumulated || 0);
        }
      }
    } catch (e) {
      console.error('Failed to load drive timer state', e);
    }
  }, []);

  // Load all data
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const activeRoute = useLiveQuery(async () => {
    const routes = await db.routes.where('status').anyOf('pending', 'active').toArray();
    if (routes.length === 0) return null;
    const route = routes[0];

    // Migration shim: support old plain-ID stops AND new { customerId, plannedServiceIds } stops
    const normalizedStops = route.stops.map(s =>
      typeof s === 'object' ? s : { customerId: s, plannedServiceIds: [] }
    );

    const customerPromises = normalizedStops.map(s => db.customers.get(s.customerId));
    const customers = await Promise.all(customerPromises);

    const expandedStops = normalizedStops.map((s, i) => ({
      ...customers[i],
      plannedServiceIds: s.plannedServiceIds || []
    })).filter(c => c?.id);

    return { ...route, normalizedStops, expandedStops };
  }, []);

  const routeVisits = useLiveQuery(() => {
    if (!activeRoute) return [];
    return db.visits.where({ routeId: activeRoute.id }).toArray();
  }, [activeRoute?.id]) || [];

  useEffect(() => {
    routeVisitsRef.current = routeVisits;
  }, [routeVisits]);

  useEffect(() => {
    activeRouteRef.current = activeRoute;
  }, [activeRoute]);

  useEffect(() => {
    timerStateRef.current = timerState;
  }, [timerState]);

  useEffect(() => {
    liveNoteRef.current = liveNote;
  }, [liveNote]);

  // ── Wake Lock: Keep screen on during active route ─────────────────────
  useEffect(() => {
    const acquireWakeLock = async () => {
      if ('wakeLock' in navigator && activeRoute) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        } catch (e) { /* user denied or not supported */ }
      }
    };

    const releaseWakeLock = () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };

    // Re-acquire on visibility change (phone unlocked after lock screen)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && activeRoute) {
        acquireWakeLock();
      }
    };

    if (activeRoute) {
      acquireWakeLock();
      document.addEventListener('visibilitychange', handleVisibility);
    } else {
      releaseWakeLock();
    }

    return () => {
      releaseWakeLock();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeRoute]);

  useEffect(() => {
    allCustomersRef.current = allCustomers;
  }, [allCustomers]);

  const allVisits = useLiveQuery(() => db.visits.toArray(), []) || [];

  // Helper to get status of a stop
  const getStopStatus = (customerId) => {
    if (activeGeofenceIdRef.current === customerId) return 'active';
    const visit = routeVisits.find(v => v.customerId === customerId && (v.status === 'completed' || v.status === 'quick-log' || v.status === 'skipped'));
    if (visit) return 'completed';
    return 'pending';
  };

  const getStatusColors = (status) => {
    if (status === 'completed') return { fill: '#10b981', stroke: '#059669' }; // Emerald Green
    if (status === 'active') return { fill: '#f59e0b', stroke: '#d97706' }; // Amber Orange
    return { fill: '#ef4444', stroke: '#b91c1c' }; // Red for pending
  };

  const globalPace = useMemo(() => {
    if (allVisits.length === 0 || allCustomers.length === 0) return 250;
    let totalSecs = 0;
    let totalSqFt = 0;
    allVisits.forEach(v => {
      if (v.status !== 'completed' || !v.durationSecs || v.durationSecs < 60) return;
      const isMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.includes('s1') || v.appliedServices.some(s => typeof s === 'string' && s.toLowerCase().includes('mow'));
      if (!isMow) return;
      const cust = allCustomers.find(c => c.id === v.customerId);
      if (!cust) return;
      const sqft = parseLawnSizeToSqFt(cust.lawnSize);
      if (!sqft) return;
      totalSecs += v.durationSecs;
      totalSqFt += sqft;
    });
    return totalSecs === 0 ? 250 : Math.max(10, Math.round(totalSqFt / (totalSecs / 60)));
  }, [allVisits, allCustomers]);

  const progressInfo = useMemo(() => {
    if (!activeRoute || !activeRoute.expandedStops || activeRoute.expandedStops.length === 0) return null;
    const completedStops = activeRoute.expandedStops.filter(s => getStopStatus(s.id) === 'completed').length;
    const totalStops = activeRoute.expandedStops.length;
    
    let totalSecondsLeft = 0;
    
    activeRoute.expandedStops.forEach(s => {
       if (getStopStatus(s.id) === 'pending') {
          // Find historical visits for this customer to calculate average time
          const histVisits = allVisits.filter(v => v.customerId === s.id && v.status === 'completed' && v.durationSecs);
          let avgDuration = 900; // Default 15 mins
          if (histVisits.length > 0) {
             const sum = histVisits.reduce((acc, v) => acc + v.durationSecs, 0);
             avgDuration = sum / histVisits.length;
          } else {
             const cust = allCustomers.find(c => c.id === s.id);
             if (cust && cust.lawnSize) {
                const sqft = parseLawnSizeToSqFt(cust.lawnSize);
                if (sqft) avgDuration = Math.max(600, Math.round((sqft / globalPace) * 60));
             }
          }
          
          // Use planned Google Maps drive time if available, otherwise default to 5 minutes (300s)
          // Look up this stop in activeRoute.normalizedStops to find plannedDriveTimeSecs
          const normalizedStop = activeRoute.normalizedStops.find(n => n.customerId === s.id);
          const driveTime = (normalizedStop && normalizedStop.plannedDriveTimeSecs !== undefined && normalizedStop.plannedDriveTimeSecs !== null) ? normalizedStop.plannedDriveTimeSecs : 300;
          
          totalSecondsLeft += avgDuration + driveTime; 
       }
    });

    const minutesLeft = Math.round(totalSecondsLeft / 60);
    
    let etaString = '';
    if (minutesLeft > 0) {
      if (minutesLeft > 60) {
        etaString = `${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m remaining`;
      } else {
        etaString = `${minutesLeft}m remaining`;
      }
    } else if (totalStops - completedStops === 0) {
      etaString = 'Finished';
    }

    return { completedStops, totalStops, etaString };
  }, [activeRoute, routeVisits, activeGeofenceIdRef.current, allVisits, allCustomers, globalPace]);

  // Reuse the top-level getDistance (Haversine) — alias for clarity
  const getDistanceFromLatLonInMeters = getDistance;

  // Auto-Detect Next Job based on current location
  const nextStop = useMemo(() => {
    if (!activeRoute || !activeRoute.expandedStops) return null;
    const pendingStops = activeRoute.expandedStops.filter(s => getStopStatus(s.id) === 'pending');
    if (pendingStops.length === 0) return null;
    
    const plannedNext = pendingStops[0];
    
    if (!currentPosition || !allCustomers) return plannedNext;

    // Calculate distances to all pending stops
    const stopsWithDist = pendingStops.map(s => {
      const cust = allCustomers.find(c => c.id === s.id);
      let dist = Infinity;
      if (cust && cust.geofence && cust.geofence.length > 0) {
        const centerLat = cust.geofence.reduce((sum, pt) => sum + pt.lat, 0) / cust.geofence.length;
        const centerLng = cust.geofence.reduce((sum, pt) => sum + pt.lng, 0) / cust.geofence.length;
        dist = getDistanceFromLatLonInMeters(currentPosition.lat, currentPosition.lng, centerLat, centerLng);
      }
      return { ...s, dist };
    });

    const plannedDist = stopsWithDist[0].dist;
    
    // Find the absolute closest stop
    let closestStop = stopsWithDist[0];
    for (let i = 1; i < stopsWithDist.length; i++) {
      if (stopsWithDist[i].dist < closestStop.dist) {
        closestStop = stopsWithDist[i];
      }
    }

    // Auto-detect override logic:
    // If the closest stop is NOT the planned next stop, AND we are significantly closer to it
    // (e.g. closest is < 500m away, OR closest is less than half the distance to the planned stop)
    if (closestStop.id !== plannedNext.id && plannedDist !== Infinity && closestStop.dist !== Infinity) {
       if (closestStop.dist < 500 || closestStop.dist < (plannedDist * 0.5)) {
           return closestStop; // Override!
       }
    }

    return plannedNext;
  }, [activeRoute, routeVisits, activeGeofenceIdRef.current, currentPosition, allCustomers]);

  // 1. Dynamic Map Navigation & Snap Back
  const onMapLoad = (map) => {
    mapRef.current = map;
    map.addListener('dragstart', () => {
      setAutoCenter(false);
      autoCenterRef.current = false;
      if (snapBackRef.current) clearTimeout(snapBackRef.current);
      snapBackRef.current = setTimeout(() => {
        setAutoCenter(true);
        autoCenterRef.current = true;
      }, 5000);
    });
  };

  // 2. Real-Time Weather Logging
  const fetchWeather = async (lat, lng) => {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`);
      const data = await res.json();
      if (data.current) {
        const newWeather = {
          temp: Math.round(data.current.temperature_2m),
          wind: Math.round(data.current.wind_speed_10m),
          code: data.current.weather_code
        };
        setWeather(newWeather);
        weatherRef.current = newWeather;
      }
    } catch (e) {
      console.log('Weather fetch failed', e);
    }
  };

  // 3. Main Geolocation Tracking
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const gpsAccuracy = pos.coords.accuracy || 999; // meters
        setCurrentPosition(loc);
        
        const currentSpeedMph = (pos.coords.speed || 0) * 2.237;
        setSpeed(currentSpeedMph);
        
        if (pos.coords.heading && !isNaN(pos.coords.heading)) {
          setHeading(pos.coords.heading);
        }

        latestLocRef.current = loc;

        // Fetch weather on first lock, then every 10 mins using the LATEST location
        if (!weatherTimerRef.current) {
          fetchWeather(loc.lat, loc.lng);
          weatherTimerRef.current = setInterval(() => {
            if (latestLocRef.current) fetchWeather(latestLocRef.current.lat, latestLocRef.current.lng);
          }, 10 * 60 * 1000);
        }

        // Auto Center and Zoom (uses ref to avoid restarting watchPosition)
        if (autoCenterRef.current && mapRef.current) {
          mapRef.current.panTo(loc);
          if (pos.coords.heading && !isNaN(pos.coords.heading)) {
            mapRef.current.setHeading(pos.coords.heading);
          }
          
          let targetZoom = 18;
          if (currentSpeedMph > 45) targetZoom = 15;
          else if (currentSpeedMph > 25) targetZoom = 16;
          else if (currentSpeedMph > 5) targetZoom = 17;
          
          if (Math.abs(mapRef.current.getZoom() - targetZoom) >= 1) {
            mapRef.current.setZoom(targetZoom);
          }
        }

        // Skip geofence checks entirely when GPS accuracy is poor (> 30 meters)
        // This prevents phantom enter/exit triggers from bad satellite lock
        if (gpsAccuracy > 30) {
          if (!poorGpsRef.current) {
            setPoorGps(true);
            poorGpsRef.current = true;
          }
          return;
        } else {
          if (poorGpsRef.current) {
            setPoorGps(false);
            poorGpsRef.current = false;
          }
        }

        // Geofence Checking (For Active Route)
        // Skip auto-entry scanning when driving is paused (e.g. lunch break).
        // The user can always manually start a job via the START JOB button.
        const route = activeRouteRef.current;
        if (route && route.status === 'active' && !isDrivingPausedRef.current && window.google?.maps?.geometry?.poly) {
          let insideCustomers = [];
          for (const customer of route.expandedStops) {
            // Ignore already completed jobs so we don't re-trigger them if we drive by again
            const isCompleted = routeVisitsRef.current.some(v => 
               v.customerId === customer.id && 
               (v.status === 'completed' || v.status === 'quick-log' || v.status === 'skipped')
            );
            if (isCompleted) continue;

            let isInside = false;

            if (activeGeofenceIdRef.current === customer.id && anchorGeofenceRef.current) {
              // Manual anchor override
              if (anchorGeofenceRef.current === 'no-gps') {
                isInside = true;
              } else {
                const d = getDistance(loc.lat, loc.lng, anchorGeofenceRef.current.lat, anchorGeofenceRef.current.lng);
                if (d <= 150) isInside = true;
              }
            } else if (customer.geofence && customer.geofence.length > 0) {
              // Normal polygon geofence
              if (!polygonCacheRef.current[customer.id]) {
                polygonCacheRef.current[customer.id] = new window.google.maps.Polygon({ paths: customer.geofence });
              }
              const poly = polygonCacheRef.current[customer.id];
              const pt = new window.google.maps.LatLng(loc.lat, loc.lng);
              
              if (window.google.maps.geometry.poly.containsLocation(pt, poly)) {
                isInside = true;
              } else {
                // Fallback: if GPS is bouncing, check if we are within 25m of the property center
                const centerLat = customer.geofence.reduce((s, p) => s + p.lat, 0) / customer.geofence.length;
                const centerLng = customer.geofence.reduce((s, p) => s + p.lng, 0) / customer.geofence.length;
                const d = getDistance(loc.lat, loc.lng, centerLat, centerLng);
                if (d <= 25) {
                  isInside = true;
                }
              }
            }

            if (isInside) {
              insideCustomers.push(customer);
            }
          }

          // Geofence Checking (For Unplanned Opportunities)
          let foundOpportunity = null;
          for (const customer of allCustomersRef.current) {
            // Ignore if already on route
            if (route.expandedStops.some(s => s.id === customer.id)) continue;
            // Ignore if user manually dismissed this session
            if (dismissedOpportunitiesRef.current.has(customer.id)) continue;
            // Note: we don't query db for today's visits synchronously here. If they visited today, 
            // they would likely be on the route anyway, or they can just dismiss it.
            
            let isInside = false;
            if (customer.geofence && customer.geofence.length > 0) {
              if (!polygonCacheRef.current[customer.id]) {
                polygonCacheRef.current[customer.id] = new window.google.maps.Polygon({ paths: customer.geofence });
              }
              const poly = polygonCacheRef.current[customer.id];
              const pt = new window.google.maps.LatLng(loc.lat, loc.lng);
              
              if (window.google.maps.geometry.poly.containsLocation(pt, poly)) {
                isInside = true;
              } else {
                const centerLat = customer.geofence.reduce((s, p) => s + p.lat, 0) / customer.geofence.length;
                const centerLng = customer.geofence.reduce((s, p) => s + p.lng, 0) / customer.geofence.length;
                const d = getDistance(loc.lat, loc.lng, centerLat, centerLng);
                if (d <= 25) isInside = true;
              }
            }
            if (isInside) {
              foundOpportunity = customer;
              break;
            }
          }
          setNearbyOpportunity(foundOpportunity);
          
          let insideCustomer = null;
          if (insideCustomers.length === 1) {
            insideCustomer = insideCustomers[0];
          } else if (insideCustomers.length > 1) {
            // If overlapping geofences, pick the one we are physically closest to
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
          
          if (insideCustomer) {
            // We are inside a geofence. Clear any potential exit timers.
            potentialExitRef.current = null;
            
            if (activeGeofenceIdRef.current !== insideCustomer.id) {
              // We are not YET officially inside this new geofence according to state.
              if (!potentialEnterRef.current || potentialEnterRef.current.id !== insideCustomer.id) {
                // Start the debounce timer (first detection)
                potentialEnterRef.current = { id: insideCustomer.id, timestamp: Date.now(), lastSeen: Date.now() };
                setPendingArrival({ name: insideCustomer.name, secondsLeft: 8 });
              } else {
                // Update last seen time (we are still inside)
                potentialEnterRef.current.lastSeen = Date.now();
                const elapsed = Date.now() - potentialEnterRef.current.timestamp;
                const remaining = Math.max(0, Math.ceil((8000 - elapsed) / 1000));
                setPendingArrival({ name: insideCustomer.name, secondsLeft: remaining });
                
                if (elapsed >= 8000) {
                  // We have been inside for ~8 seconds! Trigger enter.
                  if (activeGeofenceIdRef.current) {
                    handleExitGeofence();
                  }
                  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
                  jobStartRef.current = Date.now();
                  accumulatedTimeRef.current = 0;
                  lastResumeTimeRef.current = Date.now();
                  setTimerState('running');
                  activeGeofenceIdRef.current = insideCustomer.id;
                  setActiveGeofence(insideCustomer);
                  potentialEnterRef.current = null;
                  setPendingArrival(null);
                  dismissedOpportunitiesRef.current.clear();
                }
              }
            }
          } else {
            // We are NOT inside any geofence.
            // Only reset the enter timer if we have been outside for more than 5 seconds (GPS grace period)
            if (potentialEnterRef.current) {
              if (Date.now() - potentialEnterRef.current.lastSeen > 5000) {
                potentialEnterRef.current = null; // Truly left, reset
                setPendingArrival(null);
              }
              // Otherwise keep the timer running — just a GPS bounce
            } else {
              setPendingArrival(null);
            }
            
            if (activeGeofenceIdRef.current) {
              // If the timer is paused, the user is clearly still working (water break, etc.)
              // Do NOT trigger an exit — they need to manually resume or finish.
              if (timerStateRef.current === 'paused') {
                potentialExitRef.current = null; // Reset any pending exit
              } else {
                // We just exited an active geofence. Start the 15-second debounce timer.
                if (!potentialExitRef.current) {
                  potentialExitRef.current = Date.now();
                } else if (Date.now() - potentialExitRef.current >= 15000) {
                  // We have been outside for 15 contiguous seconds! Trigger exit.
                  handleExitGeofence();
                  potentialExitRef.current = null;
                }
              }
            }
          }
        }
      },
      (err) => console.error(err),
      { enableHighAccuracy: true }
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (weatherTimerRef.current) clearInterval(weatherTimerRef.current);
    };
  }, []); // Empty deps — runs once on mount, uses refs for all mutable state

  useEffect(() => {
    if (drivebyPrompt) {
      if (drivebyTimerRef.current) clearTimeout(drivebyTimerRef.current);
      drivebyTimerRef.current = setTimeout(() => {
        setDrivebyPrompt(null);
      }, 15000); // Auto dismiss after 15 seconds
    } else {
      if (drivebyTimerRef.current) clearTimeout(drivebyTimerRef.current);
    }
    return () => {
      if (drivebyTimerRef.current) clearTimeout(drivebyTimerRef.current);
    };
  }, [drivebyPrompt]);

  // 4. Job Timers & Driveby Detection
  const handleExitGeofence = () => {
    // Use timerStateRef (not timerState) to avoid stale closure from watchPosition
    const finalDuration = Math.floor(
      accumulatedTimeRef.current + 
      (timerStateRef.current === 'running' && lastResumeTimeRef.current ? (Date.now() - lastResumeTimeRef.current) / 1000 : 0)
    );
    const completedCustId = activeGeofenceIdRef.current;
    const completedCust = allCustomersRef.current.find(c => c.id === completedCustId);

    activeGeofenceIdRef.current = null;
    setActiveGeofence(null);
    anchorGeofenceRef.current = null;
    setTimerState('idle');
    potentialEnterRef.current = null;
    potentialExitRef.current = null;
    accumulatedDriveTimeRef.current = 0;
    lastDriveResumeTimeRef.current = Date.now();
    setIsDrivingPaused(false);
    isDrivingPausedRef.current = false;

    const threshold = getSettings().drivebyThresholdSecs || 45;

    if (finalDuration < threshold && completedCust) {
      setDrivebyPrompt({ customer: completedCust, duration: finalDuration, entry: jobStartRef.current });
    } else if (completedCust) {
      logVisit(completedCust, finalDuration, jobStartRef.current, 'completed', liveNoteRef.current);
      setLiveNote('');
    }
  };

  const handleSaveEpaLog = async (logData) => {
    if (!activeEpaJob) return;
    await db.visits.update(activeEpaJob.id, { complianceLog: logData });
    setActiveEpaJob(null);
  };

  const handleManualDone = () => {
    const finalDuration = Math.floor(
      accumulatedTimeRef.current + 
      (timerStateRef.current === 'running' && lastResumeTimeRef.current ? (Date.now() - lastResumeTimeRef.current) / 1000 : 0)
    );
    const completedCust = activeGeofence;
    
    activeGeofenceIdRef.current = null;
    setActiveGeofence(null);
    anchorGeofenceRef.current = null;
    setTimerState('idle');
    potentialEnterRef.current = null;
    potentialExitRef.current = null;
    accumulatedDriveTimeRef.current = 0;
    lastDriveResumeTimeRef.current = Date.now();
    setIsDrivingPaused(false);
    isDrivingPausedRef.current = false;
    
    logVisit(completedCust, finalDuration, jobStartRef.current, 'completed', liveNote);
    setLiveNote('');
  };

  const logVisit = async (customer, durationSecs, entryTime, status, note = '') => {
    accumulatedDriveTimeRef.current = 0;
    lastDriveResumeTimeRef.current = Date.now();
    setIsDrivingPaused(false);
    isDrivingPausedRef.current = false;
    const route = activeRouteRef.current;
    let priceEarned = 0;
    let appliedServices = [];

    if (status !== 'skipped') {
      // Try to use the planned services for this stop from the route
      const routeStop = route?.normalizedStops?.find(s => s.customerId === customer.id);
      const plannedIds = routeStop?.plannedServiceIds || [];

      if (plannedIds.length > 0 && customer.services) {
        // Use planned services
        const planned = customer.services.filter(s => plannedIds.includes(s.id));
        appliedServices = planned.map(s => s.id);
        priceEarned = planned.reduce((sum, s) => sum + s.price, 0);
      } else if (customer.services) {
        // Fallback: first active service
        const base = customer.services.find(s => s.active);
        if (base) { appliedServices = [base.id]; priceEarned = base.price; }
      } else if (customer.price) {
        priceEarned = customer.price;
      }
    }

    // Calculate Drive Time — use the accumulated drive timer (respects pause for lunch etc.)
    // If the drive timer was running, capture the final value; otherwise use accumulated
    let driveTimeSecs = Math.floor(
      isDrivingPausedRef.current
        ? accumulatedDriveTimeRef.current
        : accumulatedDriveTimeRef.current + (Date.now() - lastDriveResumeTimeRef.current) / 1000
    );

    // Check if there are any stops left on the current route
    const hasMoreStops = route && route.normalizedStops ? route.normalizedStops.some(s => {
      const alreadyVisited = routeVisitsRef.current.some(v => v.customerId === s.customerId && (v.status === 'completed' || v.status === 'quick-log'));
      return !alreadyVisited && s.customerId !== customer.id;
    }) : false;

    // Reset drive timer
    accumulatedDriveTimeRef.current = 0;
    lastDriveResumeTimeRef.current = Date.now();
    setDrivingDuration(0);

    if (hasMoreStops) {
      // AUTO-START for the next job
      isDrivingPausedRef.current = false;
      setIsDrivingPaused(false);
      saveDriveTimerState(false, 0);
    } else {
      // Route complete or manual job: PAUSE the drive timer
      isDrivingPausedRef.current = true;
      setIsDrivingPaused(true);
      saveDriveTimerState(true, 0);
    }
    // Sanity: if drive timer wasn't active (e.g. manual start, skip), fall back to wall-clock
    if (driveTimeSecs <= 0) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayVisits = await db.visits
        .where('exitTime')
        .aboveOrEqual(startOfDay.getTime())
        .toArray();
      const validVisits = todayVisits.filter(v => v.status === 'completed' || v.status === 'skipped');
      if (validVisits.length > 0) {
        validVisits.sort((a, b) => b.exitTime - a.exitTime);
        const lastVisit = validVisits[0];
        driveTimeSecs = Math.max(0, Math.floor((entryTime - lastVisit.exitTime) / 1000));
      }
    }

    const visitId = await db.visits.add({
      routeId: route ? route.id : null,
      customerId: customer.id,
      status: status || 'completed',
      durationSecs: durationSecs || 0,
      driveTimeSecs: driveTimeSecs || 0,
      entryTime: entryTime || Date.now(),
      exitTime: Date.now(),
      weather: weatherRef.current || null,
      priceEarned: priceEarned || 0,
      appliedServices: appliedServices || [],
      note: note || ''
    });

    // Show completion panel only for completed jobs
    if (status === 'completed') {
      // Detect nearby customers (within 150m) that haven't been visited yet
      let nearbyCandidate = null;
      if (currentPosition) {
        const alreadyVisitedIds = new Set(
          (await db.visits.where({ routeId: activeRoute?.id ?? null }).toArray()).map(v => v.customerId)
        );
        alreadyVisitedIds.add(customer.id);

        const nearby = allCustomers
          .filter(c => c.id !== customer.id && !alreadyVisitedIds.has(c.id))
          .map(c => {
            if (!c.geofence || c.geofence.length === 0) return null;
            const centerLat = c.geofence.reduce((s, p) => s + p.lat, 0) / c.geofence.length;
            const centerLng = c.geofence.reduce((s, p) => s + p.lng, 0) / c.geofence.length;
            const dist = getDistance(currentPosition.lat, currentPosition.lng, centerLat, centerLng);
            return { ...c, dist };
          })
          .filter(c => c && c.dist <= 150)
          .sort((a, b) => a.dist - b.dist);

        if (nearby.length > 0) nearbyCandidate = nearby[0];
      }

      setPanelNote(note || '');
      setCompletionPanel({ 
        custName: customer.name, 
        durationSecs, 
        priceEarned, 
        weather, 
        visitId, 
        nearbyCandidate, 
        primaryCustomer: customer, 
        exitTime: Date.now(),
        appliedServices
      });
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
      completionTimerRef.current = setTimeout(() => {
        if (!panelNoteActiveRef.current) {
          setCompletionPanel(null);
        } else {
          // Retry in 5 seconds if user is typing
          completionTimerRef.current = setTimeout(() => setCompletionPanel(null), 5000);
        }
      }, 12000);
    }

    if (route && route.normalizedStops) {
      const stopIds = route.normalizedStops.map(s => s.customerId);
      if (stopIds.includes(customer.id)) {
        // Fetch fresh visits directly from DB to avoid stale closure state
        const currentVisits = await db.visits.where({ routeId: route.id }).toArray();
        const completedCustIds = new Set(currentVisits.map(v => v.customerId));
        completedCustIds.add(customer.id);
        
        const allCompleted = stopIds.every(id => completedCustIds.has(id));
        if (allCompleted) {
          await db.routes.update(route.id, { status: 'completed' });
          // We no longer automatically redirect to '/' here, so the user can see their
          // final 'Job Complete' panel and add any notes before manually navigating away.
        }
      }
    }
  };

  const handleSaveNote = async () => {
    if (completionPanel?.visitId && panelNote.trim()) {
      await db.visits.update(completionPanel.visitId, { note: panelNote.trim() });
    }
    if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    setCompletionPanel(null);
  };

  const handleSaveEditedJob = async (updatedData) => {
    if (!completionPanel?.visitId) return;
    
    // updatedData contains { appliedServices, addOns, priceEarned, note }
    const updateObj = {
      appliedServices: updatedData.appliedServices,
      addOns: updatedData.addOns,
      priceEarned: updatedData.priceEarned
    };
    if (updatedData.note) {
      updateObj.note = updatedData.note;
    }
    
    await db.visits.update(completionPanel.visitId, updateObj);
    
    // Update the completion panel state to reflect the new total and note (if we want to keep it open)
    setCompletionPanel(prev => ({
      ...prev,
      priceEarned: updatedData.priceEarned,
      appliedServices: updatedData.appliedServices,
      addOns: updatedData.addOns
    }));
    
    if (updatedData.note) setPanelNote(updatedData.note);
    setIsEditJobOpen(false);
  };

  const handleDrivebyResolution = (status) => {
    logVisit(drivebyPrompt.customer, drivebyPrompt.duration, drivebyPrompt.entry, status);
    setDrivebyPrompt(null);
  };

  const handleAddOpportunity = async (customer) => {
    await handleAddUnplannedStop(customer);
    setNearbyOpportunity(null);
  };

  const handleDismissOpportunity = (customerId) => {
    dismissedOpportunitiesRef.current.add(customerId);
    setNearbyOpportunity(null);
  };

  const handleSkipStop = (customer) => {
    setSkipPrompt({ type: 'single', customer });
  };

  const executeSkip = async (mode) => {
    if (!skipPrompt) return;
    const isEndRoute = skipPrompt.type === 'end_route';
    const targets = isEndRoute ? skipPrompt.customers : [skipPrompt.customer];

    for (const cust of targets) {
      await logVisit(cust, 0, Date.now(), 'skipped');
      if (mode === 'snooze') {
        const interval = cust.mowingInterval || cust.serviceInterval || 7;
        const snoozedUntil = Date.now() + (interval * 24 * 60 * 60 * 1000);
        await db.customers.update(cust.id, { snoozedUntil });
      }
    }
    setSkipPrompt(null);
  };


  const handleTimeSplitConfirm = async ({ primaryMins, companionMins, mode }) => {
    if (!timeSplit) return;
    const { primaryVisitId, nearbyCustomer, primaryCustomer, primaryExitTime, durationSecs } = timeSplit;

    const originalExitTime = primaryExitTime ?? Date.now();
    const jobStart = originalExitTime - (durationSecs * 1000);

    let primaryEntryTime, primaryExitUpdated, companionEntryTime, companionExitTime;

    if (mode === 'simultaneous') {
      // Both properties run in parallel from the same start time
      primaryEntryTime  = jobStart;
      primaryExitUpdated  = jobStart + (primaryMins * 60 * 1000);
      companionEntryTime  = jobStart;
      companionExitTime   = jobStart + (companionMins * 60 * 1000);
    } else {
      // Sequential: Property A first, then Property B
      primaryEntryTime  = jobStart;
      primaryExitUpdated  = jobStart + (primaryMins * 60 * 1000);
      companionEntryTime  = primaryExitUpdated;
      companionExitTime   = originalExitTime;
    }

    // Update primary visit with corrected duration and times
    await db.visits.update(primaryVisitId, {
      durationSecs: primaryMins * 60,
      entryTime: primaryEntryTime,
      exitTime: primaryExitUpdated
    });

    // Build companion services from route plan or fallback to first active
    let companionPrice = 0;
    let companionServices = [];
    if (nearbyCustomer.services) {
      const routeStop = activeRoute?.normalizedStops?.find(s => s.customerId === nearbyCustomer.id);
      const plannedIds = routeStop?.plannedServiceIds || [];
      const services = plannedIds.length > 0
        ? nearbyCustomer.services.filter(s => plannedIds.includes(s.id))
        : nearbyCustomer.services.filter(s => s.active).slice(0, 1);
      companionServices = services.map(s => s.id);
      companionPrice = services.reduce((sum, s) => sum + s.price, 0);
    }

    await db.visits.add({
      routeId: activeRoute?.id ?? null,
      customerId: nearbyCustomer.id,
      status: 'completed',
      durationSecs: companionMins * 60,
      driveTimeSecs: 0,
      entryTime: companionEntryTime,
      exitTime: companionExitTime,
      weather,
      priceEarned: companionPrice,
      appliedServices: companionServices,
      note: `${mode === 'simultaneous' ? 'Simultaneous' : 'Split'} visit with ${primaryCustomer?.name ?? 'adjacent property'}`
    });

    setTimeSplit(null);
    setCompletionPanel(null);
  };

  const handleAddUnplannedStop = async (customer) => {
    if (!activeRoute) {
      await db.routes.add({
        name: 'Ad-hoc Route',
        status: 'active',
        isTemplate: 0,
        stops: [{ customerId: customer.id, plannedServiceIds: [] }],
        createdAt: Date.now()
      });
    } else {
      const newStops = [...activeRoute.stops, { customerId: customer.id, plannedServiceIds: [] }];
      await db.routes.update(activeRoute.id, { stops: newStops });
    }
    setShowQuickAdd(false);
  };

  const getArrowIcon = () => ({
    path: 'M 0,-12 L 6,8 L 0,4 L -6,8 Z',
    scale: 2,
    fillColor: '#3b82f6',
    fillOpacity: 1,
    strokeColor: '#fff',
    strokeWeight: 2,
    rotation: heading,
    anchor: window.google ? new window.google.maps.Point(0, 0) : null
  });

  const togglePause = () => {
    if (timerState === 'running') {
      accumulatedTimeRef.current += (Date.now() - lastResumeTimeRef.current) / 1000;
      setTimerState('paused');
    } else if (timerState === 'paused') {
      lastResumeTimeRef.current = Date.now();
      setTimerState('running');
    }
  };

  // Live Timer Effect
  useEffect(() => {
    let interval;
    if (activeGeofence) {
      interval = setInterval(() => {
        if (timerState === 'running' && lastResumeTimeRef.current) {
          setLiveDuration(Math.floor(accumulatedTimeRef.current + (Date.now() - lastResumeTimeRef.current) / 1000));
        } else if (timerState === 'paused') {
          setLiveDuration(Math.floor(accumulatedTimeRef.current));
        }
      }, 1000);
    } else if (activeRoute) {
      interval = setInterval(() => {
        if (!isDrivingPausedRef.current && lastDriveResumeTimeRef.current) {
          setDrivingDuration(Math.floor(accumulatedDriveTimeRef.current + (Date.now() - lastDriveResumeTimeRef.current) / 1000));
        } else {
          setDrivingDuration(Math.floor(accumulatedDriveTimeRef.current));
        }
      }, 1000);
    } else {
      setLiveDuration(0);
      setDrivingDuration(0);
      accumulatedDriveTimeRef.current = 0;
    }
    return () => clearInterval(interval);
  }, [activeGeofence, timerState, activeRoute]);

  const formatLiveTimer = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    if (h > 0) return `${h}:${m}:${s}`;
    return `${m}:${s}`;
  };

  return (
    <div className="animate-fade-in" style={{ position: 'relative' }}>
      {poorGps && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, background: '#ef4444', color: 'white', fontSize: '0.8rem', fontWeight: 600, textAlign: 'center', padding: '6px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', boxShadow: '0 2px 10px rgba(239,68,68,0.4)' }}>
          <AlertTriangle size={16} /> Poor GPS Signal — Auto-routing paused
        </div>
      )}
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      {showDayReview && <DayReviewModal onClose={() => setShowDayReview(false)} />}
      {showLiveNoteModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ marginTop: 0 }}>Add Note</h3>
            <textarea
              className="input-field"
              value={liveNote}
              onChange={(e) => setLiveNote(e.target.value)}
              placeholder="Add job note..."
              style={{ width: '100%', height: '80px', marginBottom: '1rem' }}
            />
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowLiveNoteModal(false)}>Save</button>
          </div>
        </div>
      )}
      {timeSplit && (
        <TimeSplitModal
          primaryName={timeSplit.primaryCustomer?.name}
          companionName={timeSplit.nearbyCustomer?.name}
          totalSecs={timeSplit.durationSecs}
          jobStart={timeSplit.primaryExitTime ? timeSplit.primaryExitTime - timeSplit.durationSecs * 1000 : null}
          onConfirm={handleTimeSplitConfirm}
          onClose={() => setTimeSplit(null)}
        />
      )}
      
      {/* Skip Options Modal */}
      {skipPrompt && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <h3 style={{ marginTop: 0 }}>
              {skipPrompt.type === 'single' ? `Skip ${skipPrompt.customer.name}?` : 'End Route Early?'}
            </h3>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              {skipPrompt.type === 'single'
                ? 'Would you like to just skip for today, or also snooze this customer until their next scheduled service?'
                : `You are skipping ${skipPrompt.customers.length} remaining stops. Would you like to reschedule them for tomorrow or skip their entire cycle?`}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <button 
                className="btn btn-primary" 
                style={{ width: '100%', justifyContent: 'center', padding: '0.8rem' }}
                onClick={() => executeSkip('today')}
              >
                Skip for Today (Reschedule Tomorrow)
              </button>
              <button 
                className="btn btn-secondary" 
                style={{ width: '100%', justifyContent: 'center', padding: '0.8rem', color: '#f59e0b', borderColor: '#f59e0b' }}
                onClick={() => executeSkip('snooze')}
              >
                Skip & Snooze (Until Next Service)
              </button>
              <button 
                className="btn" 
                style={{ width: '100%', justifyContent: 'center', padding: '0.8rem', marginTop: '0.5rem' }}
                onClick={() => setSkipPrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Driveby Prompt Modal */}
      {drivebyPrompt && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ marginTop: 0 }}>Short Visit Detected</h3>
            <p>You were at <strong>{drivebyPrompt.customer.name}</strong> for only {drivebyPrompt.duration} seconds.</p>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => handleDrivebyResolution('skipped')}>
                <FastForward size={18} /> Skipped
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleDrivebyResolution('completed')}>
                <CheckCircle size={18} /> Normal Service
              </button>
            </div>
          </div>
        </div>
      )}

      {completionPanel && (
        <div
          className="completion-panel glass-card"
          style={{ position: 'absolute', top: '1rem', left: '1rem', right: '1rem', zIndex: 20, border: '1px solid var(--color-primary)' }}
          onTouchStart={e => { panelTouchRef.current = e.touches[0].clientY; }}
          onTouchEnd={e => {
            if (panelTouchRef.current !== null) {
              const dy = e.changedTouches[0].clientY - panelTouchRef.current;
              if (dy > 80) { if (completionTimerRef.current) clearTimeout(completionTimerRef.current); setCompletionPanel(null); }
              panelTouchRef.current = null;
            }
          }}
        >
          {/* Swipe indicator */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.6rem' }}>
            <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: 'var(--color-border)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem' }}>
            <CheckCircle size={20} color="var(--color-primary)" />
            <strong style={{ fontSize: '1.05rem' }}>{completionPanel.custName} — Completed</strong>
          </div>
          <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: completionPanel.primaryCustomer?.propertyNotes ? '0.8rem' : '1rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.8rem' }}>
            <span>⏱ {formatLiveTimer(completionPanel.durationSecs)}</span>
            <span>💰 ${completionPanel.priceEarned?.toFixed(2) ?? '0.00'}</span>
            {completionPanel.weather && <span>🌡 {completionPanel.weather.temp}°F</span>}
          </div>
          {completionPanel.primaryCustomer?.propertyNotes && (
            <div style={{ marginBottom: '0.8rem', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-sm)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', fontSize: '0.82rem', color: '#b45309', lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700, display: 'block', marginBottom: '0.2rem' }}>📋 Property Note</span>
              {completionPanel.primaryCustomer.propertyNotes}
            </div>
          )}
          <textarea
            rows={2}
            className="input-field"
            placeholder="📝 Add a note... (optional)"
            value={panelNote}
            onChange={e => setPanelNote(e.target.value)}
            onFocus={() => { panelNoteActiveRef.current = true; }}
            onBlur={() => { panelNoteActiveRef.current = false; }}
            style={{ width: '100%', resize: 'none', fontSize: '0.9rem', marginBottom: '0.8rem' }}
          />

          {/* Nearby Companion Prompt */}
          {completionPanel.nearbyCandidate && (
            <div style={{ marginBottom: '0.8rem', padding: '0.7rem', borderRadius: 'var(--radius-sm)', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 600, marginBottom: '0.4rem' }}>
                📍 Nearby: {completionPanel.nearbyCandidate.name} ({Math.round(completionPanel.nearbyCandidate.dist)}m away)
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>
                Did you also mow this property?
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1, fontSize: '0.85rem', padding: '0.4rem' }}
                  onClick={() => setCompletionPanel(prev => ({ ...prev, nearbyCandidate: null }))}
                >
                  No
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 2, fontSize: '0.85rem', padding: '0.4rem' }}
                  onClick={() => {
                    if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
                    setTimeSplit({
                      primaryCustomer: completionPanel.primaryCustomer,
                      primaryVisitId: completionPanel.visitId,
                      primaryExitTime: completionPanel.exitTime,
                      durationSecs: completionPanel.durationSecs,
                      nearbyCustomer: completionPanel.nearbyCandidate
                    });
                  }}
                >
                  ⏱ Yes — Split Time
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
            <button 
              className="btn btn-secondary" 
              style={{ flex: '1 1 100%', minHeight: '52px', fontSize: '1rem', background: 'var(--color-bg-main)', border: '2px solid var(--color-primary)', color: 'var(--color-primary)' }} 
              onClick={() => {
                if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
                setIsEditJobOpen(true);
              }}
            >
              ✏️ Edit Job & Extras
            </button>
            <button className="btn btn-primary" style={{ flex: 1, minHeight: '52px', fontSize: '1rem' }} onClick={handleSaveNote}>
              {panelNote.trim() ? 'Save Note' : 'Done'}
            </button>
            {completionPanel.primaryCustomer?.services?.some(s => completionPanel.appliedServices?.includes(s.id) && s.name.toLowerCase().match(/(fertilizer|weed|spray|chem)/)) && (
              <button 
                className="btn btn-secondary" 
                style={{ flex: 1, minHeight: '52px', fontSize: '0.9rem', color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }} 
                onClick={() => setActiveEpaJob({ id: completionPanel.visitId, custName: completionPanel.custName, exitTime: completionPanel.exitTime })}
              >
                <ClipboardList size={18} /> EPA Log
              </button>
            )}
            <button className="btn btn-secondary" style={{ minHeight: '52px', padding: '0 1.2rem', fontSize: '1rem' }} onClick={() => { if (completionTimerRef.current) clearTimeout(completionTimerRef.current); setCompletionPanel(null); }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {activeEpaJob && (
        <ComplianceLogModal 
          visit={activeEpaJob}
          customerName={activeEpaJob.custName}
          customerLawnSize={completionPanel?.primaryCustomer?.lawnSize}
          initialLog={null}
          onSave={handleSaveEpaLog}
          onClose={() => setActiveEpaJob(null)}
        />
      )}

      {isEditJobOpen && completionPanel && (
        <EditJobModal 
          completionPanel={completionPanel}
          onSave={handleSaveEditedJob}
          onClose={() => setIsEditJobOpen(false)}
        />
      )}

      {/* Top Panel: Current or Next Job Info */}
      <div style={{ position: 'absolute', top: '0.8rem', left: '0.8rem', right: '0.8rem', zIndex: 10 }}>
        {activeGeofence ? (
          <div className="animate-fade-in" style={{ 
            padding: '1rem', 
            background: timerState === 'running' ? 'rgba(16,185,129,0.95)' : 'rgba(245,158,11,0.95)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRadius: '1.2rem',
            color: 'white',
            border: 'none', 
            boxShadow: timerState === 'running' ? '0 10px 40px rgba(16,185,129,0.4)' : '0 10px 40px rgba(245,158,11,0.4)',
            transition: 'all 0.3s ease'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.8rem' }}>
              <div>
                <strong style={{ fontSize: '1.2rem', display: 'block', lineHeight: 1.2, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>{activeGeofence.name}</strong>
                <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)', marginTop: '2px' }}>{activeGeofence.address}</div>
                {weather && (() => {
                  const code = weather.code ?? 0;
                  let Icon = CloudRain;
                  if (code === 0) Icon = Sun;
                  else if (code <= 2) Icon = CloudSun;
                  else if (code === 3 || code <= 49) Icon = Cloud;
                  else if (code <= 55) Icon = CloudDrizzle;
                  else if (code <= 77 || code <= 86) Icon = CloudSnow;
                  else if (code <= 99) Icon = CloudLightning;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.4rem', color: 'white', fontSize: '0.8rem', fontWeight: 600 }}>
                      <Icon size={14} color="rgba(255,255,255,0.9)" />
                      <span>{weather.temp}°F · {weather.wind} mph</span>
                    </div>
                  );
                })()}
                {liveNote && (
                  <div style={{ fontSize: '0.8rem', color: '#fcd34d', marginTop: '0.4rem', fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: '0.3rem' }}>
                    <FileText size={14} style={{ marginTop: '2px' }} />
                    <span style={{ fontStyle: 'italic' }}>{liveNote}</span>
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', display: 'flex', gap: '0.2rem' }}>
                <button 
                  onClick={() => setShowLiveNoteModal(true)}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '0.4rem', marginTop: '-0.4rem' }}
                  title="Add Note"
                >
                  <FileText size={20} />
                </button>
                <button 
                  onClick={() => {
                    activeGeofenceIdRef.current = null;
                    setActiveGeofence(null);
                    anchorGeofenceRef.current = null;
                    setTimerState('idle');
                    setLiveNote('');
                  }}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '0.2rem', marginTop: '-0.2rem' }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            <div style={{ textAlign: 'center', marginBottom: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.15)', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'rgba(255,255,255,0.9)' }}>
                {timerState === 'paused' ? 'TIMER PAUSED' : 'JOB RUNNING'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: 'white', textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                  {formatLiveTimer(liveDuration)}
                </div>
                <button 
                  onClick={togglePause}
                  style={{ border: 'none', color: 'white', cursor: 'pointer', padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'rgba(255,255,255,0.25)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                  title={timerState === 'paused' ? 'Resume Timer' : 'Pause Timer'}
                >
                  {timerState === 'paused' ? <Play size={18} fill="white" /> : <Pause size={18} fill="white" />}
                </button>
              </div>
            </div>

            <SlideToFinish onComplete={handleManualDone} />
          </div>
        ) : (
          activeRoute ? (() => {
            if (activeRoute.status === 'pending') {
              return (
                <div className="card animate-fade-in" style={{ padding: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                  <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-primary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>Pending Route</div>
                    <strong style={{ fontSize: '1.4rem', display: 'block', color: 'var(--color-text-main)', marginTop: '0.3rem' }}>{activeRoute.name || 'Unnamed Route'}</strong>
                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>{activeRoute.expandedStops.length} Stops</div>
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%', padding: '1rem', fontSize: '1.1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', borderRadius: 'var(--radius-md)' }} onClick={async () => {
                     await db.routes.update(activeRoute.id, { status: 'active' });
                     
                     // Tie the driving timer explicitly to this Start Route action!
                     accumulatedDriveTimeRef.current = 0;
                     lastDriveResumeTimeRef.current = Date.now();
                     isDrivingPausedRef.current = false;
                     setIsDrivingPaused(false);
                     saveDriveTimerState(false, 0);
                  }}>
                    <Play fill="currentColor" size={20} /> START ROUTE
                  </button>
                </div>
              );
            }

            if (nextStop) {
              return (
                <div className="card animate-fade-in" style={{ padding: '0.8rem', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                  {pendingArrival && (
                    <div style={{ marginBottom: '0.6rem', padding: '0.5rem 0.8rem', borderRadius: 'var(--radius-sm)', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-primary)' }}>📍 Arriving at {pendingArrival.name}...</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--color-primary)' }}>{pendingArrival.secondsLeft}s</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.8rem' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>Next Job</div>
                      <strong style={{ fontSize: '1.2rem', display: 'block', color: 'var(--color-text-main)', lineHeight: 1.2 }}>{nextStop.name}</strong>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>{nextStop.address}</div>
                      {weather && (() => {
                        const code = weather.code ?? 0;
                        let Icon = CloudRain;
                        if (code === 0) Icon = Sun;
                        else if (code <= 2) Icon = CloudSun;
                        else if (code === 3 || code <= 49) Icon = Cloud;
                        else if (code <= 55) Icon = CloudDrizzle;
                        else if (code <= 77 || code <= 86) Icon = CloudSnow;
                        else if (code <= 99) Icon = CloudLightning;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
                            <Icon size={14} color="var(--color-primary)" />
                            <span>{weather.temp}°F · {weather.wind} mph</span>
                          </div>
                        );
                      })()}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace', color: isDrivingPaused ? 'var(--color-warning)' : 'var(--color-primary)', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
                        {formatLiveTimer(drivingDuration)}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'flex-end', marginTop: '0.2rem' }}>
                        {isDrivingPaused && drivingDuration === 0 ? (
                          <button 
                            className="btn btn-primary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, borderRadius: '4px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              lastDriveResumeTimeRef.current = Date.now();
                              isDrivingPausedRef.current = false;
                              setIsDrivingPaused(false);
                              saveDriveTimerState(false, accumulatedDriveTimeRef.current);
                            }}
                          >
                            <Play size={12} fill="currentColor" style={{ marginRight: '4px' }}/> START DRIVING
                          </button>
                        ) : (
                          <>
                            <div style={{ fontSize: '0.75rem', color: isDrivingPaused ? 'var(--color-warning)' : 'var(--color-primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              {isDrivingPaused ? 'PAUSED' : 'DRIVING'}
                            </div>
                            <button 
                              className="btn"
                              style={{ padding: '0.1rem 0.3rem', fontSize: '0.65rem', background: isDrivingPaused ? 'var(--color-primary)' : 'var(--color-bg-card)', color: isDrivingPaused ? '#fff' : 'var(--color-text-main)', border: `1px solid ${isDrivingPaused ? 'var(--color-primary)' : 'var(--color-border)'}` }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isDrivingPausedRef.current) {
                                  // Resume
                                  lastDriveResumeTimeRef.current = Date.now();
                                  isDrivingPausedRef.current = false;
                                  setIsDrivingPaused(false);
                                  saveDriveTimerState(false, accumulatedDriveTimeRef.current);
                                } else {
                                  // Pause
                                  accumulatedDriveTimeRef.current += (Date.now() - lastDriveResumeTimeRef.current) / 1000;
                                  isDrivingPausedRef.current = true;
                                  setIsDrivingPaused(true);
                                  saveDriveTimerState(true, accumulatedDriveTimeRef.current);
                                }
                              }}
                            >
                              {isDrivingPaused ? '▶' : '||'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.6rem' }}>
                    <button className="btn btn-primary" style={{ flex: 2, padding: '0.6rem', fontSize: '0.95rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
                      jobStartRef.current = Date.now();
                      accumulatedTimeRef.current = 0;
                      lastResumeTimeRef.current = Date.now();
                      setTimerState('running');
                      activeGeofenceIdRef.current = nextStop.id;
                      anchorGeofenceRef.current = currentPosition ? { lat: currentPosition.lat, lng: currentPosition.lng } : 'no-gps';
                      setActiveGeofence(nextStop);
                      potentialEnterRef.current = null;
                      potentialExitRef.current = null;
                      dismissedOpportunitiesRef.current.clear();
                    }}>
                      <Play fill="currentColor" size={16} /> START JOB
                    </button>
                    <button className="btn btn-secondary" style={{ flex: 1, padding: '0.6rem', fontSize: '0.9rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem' }} onClick={() => handleSkipStop(nextStop)}>
                      <SkipForward size={14} /> SKIP
                    </button>
                  </div>
                </div>
              );
            } else {
              return (
                <div className="card animate-fade-in" style={{ textAlign: 'center', padding: '1rem' }}>
                   <strong>Route Complete! 🎉</strong>
                </div>
              );
            }
          })() : (
            <div className="card" style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '1rem' }}>No Active Route. Select one from Routes tab.</div>
          )
        )}

        {/* Nearby Opportunity Banner */}
        {nearbyOpportunity && !activeGeofence && (
          <div className="card animate-fade-in" style={{ marginTop: '0.8rem', padding: '0.8rem', background: 'rgba(59, 130, 246, 0.95)', color: 'white', border: 'none', boxShadow: '0 8px 24px rgba(59, 130, 246, 0.4)', borderRadius: '1.2rem', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
              <MapIcon size={18} />
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Nearby Opportunity</div>
            </div>
            <div style={{ fontSize: '0.85rem', marginBottom: '0.8rem', opacity: 0.9 }}>
              You are parked at <strong>{nearbyOpportunity.name}'s</strong> property. They are not on today's route.
            </div>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button className="btn btn-primary" style={{ flex: 2, background: 'white', color: 'rgba(59, 130, 246, 1)', border: 'none', padding: '0.5rem', fontSize: '0.85rem' }} onClick={() => handleAddOpportunity(nearbyOpportunity)}>
                Add to Route & Start
              </button>
              <button className="btn btn-secondary" style={{ flex: 1, background: 'rgba(255, 255, 255, 0.2)', color: 'white', border: 'none', padding: '0.5rem', fontSize: '0.85rem' }} onClick={() => handleDismissOpportunity(nearbyOpportunity.id)}>
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {isLoaded && !loadError ? (
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={currentPosition || { lat: 39.8283, lng: -98.5795 }}
          zoom={currentPosition ? 16 : 4}
          onLoad={(map) => {
            onMapLoad(map);
            trackApiCall('mapLoad');
          }}
          options={{ disableDefaultUI: true, mapTypeId: mapTypeId }}
        >
          {currentPosition && window.google && (
            <Marker position={currentPosition} icon={getArrowIcon()} zIndex={1000} />
          )}

          {/* Render Route Stops */}
          {activeRoute?.expandedStops.map((stop, i) => {
            const status = getStopStatus(stop.id);
            const colors = getStatusColors(status);
            
            return (
              <div key={stop.id}>
                <Marker 
                  position={stop.geofence ? stop.geofence[0] : undefined} 
                  label={{ text: `${i + 1}`, color: 'white' }} 
                  title={stop.name} 
                  icon={{
                    path: window.google.maps.SymbolPath.CIRCLE,
                    scale: 12,
                    fillColor: colors.stroke,
                    fillOpacity: 1,
                    strokeWeight: 0
                  }}
                />
                {stop.geofence && (
                  <Polygon 
                    paths={stop.geofence} 
                    options={{ 
                      fillColor: colors.fill, 
                      fillOpacity: status === 'active' ? 0.5 : 0.2, 
                      strokeColor: colors.stroke, 
                      strokeWeight: status === 'active' ? 3 : 2 
                    }} 
                  />
                )}
              </div>
            );
          })}

          {/* Render Non-Route Clients (Grey Geofences) */}
          {allCustomers
            .filter(c => !activeRoute?.expandedStops?.some(s => s.id === c.id))
            .map(c => (
              <div key={`non-route-${c.id}`}>
                {c.geofence && (
                  <Polygon
                    paths={c.geofence}
                    options={{
                      fillColor: '#6b7280',
                      fillOpacity: 0.25,
                      strokeColor: '#6b7280',
                      strokeWeight: 2,
                      clickable: true
                    }}
                    onClick={async () => {
                      const visits = await db.visits.where({ customerId: c.id }).toArray();
                      const completed = visits.filter(v => v.status === 'completed' || v.status === 'quick-log');
                      let message = `Do you want to add ${c.name} to the current route?\n\nLast cut: Never`;
                      if (completed.length > 0) {
                        completed.sort((a, b) => b.exitTime - a.exitTime);
                        const daysAgo = Math.floor((Date.now() - completed[0].exitTime) / (1000 * 60 * 60 * 24));
                        message = `Do you want to add ${c.name} to the current route?\n\nLast cut: ${daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`}`;
                      }
                      
                      setDialog({
                        type: 'info',
                        title: 'Add to Route?',
                        message,
                        confirmLabel: 'Add Stop',
                        onConfirm: () => handleAddUnplannedStop(c)
                      });
                    }}
                  />
                )}
              </div>
            ))}
        </GoogleMap>
      ) : (
        <div style={{ ...mapContainerStyle, background: '#e5e7eb', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
          <MapIcon size={48} style={{ opacity: 0.5, marginBottom: '1rem' }} />
          <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>Map Unavailable Offline</div>
          <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', maxWidth: '80%', textAlign: 'center' }}>
            Your GPS timers and job tracking will continue to work perfectly.
          </div>
        </div>
      )}
      
      {/* Bottom Panel (Native-style Bottom Sheet) */}
      <div className="glass-card" style={{ position: 'absolute', bottom: '4.5rem', left: 0, right: 0, zIndex: 10, padding: 0, overflow: 'hidden', borderRadius: '1.5rem 1.5rem 0 0', borderBottom: 'none', boxShadow: '0 -10px 25px rgba(0,0,0,0.08)' }}>
        
        {/* Progress Bar & Header */}
        {progressInfo && (
          <div style={{ padding: isRouteListOpen ? '0.5rem 1rem' : '0.5rem 1rem 1.5rem 1rem', cursor: 'pointer', background: isRouteListOpen ? 'var(--color-bg-card)' : 'var(--glass-bg)', backdropFilter: isRouteListOpen ? 'none' : 'blur(12px)' }} onClick={() => setIsRouteListOpen(!isRouteListOpen)}>
            
            {/* Grab Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', paddingTop: '0.5rem' }}>
              <div style={{ width: '40px', height: '5px', borderRadius: '3px', background: 'var(--color-border)' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                 <div style={{ display: 'flex', flexDirection: 'column' }}>
                   {activeRoute?.name && (
                     <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                       {activeRoute.name}
                     </span>
                   )}
                   <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Progress</span>
                   <strong>Stop {progressInfo.completedStops + (activeGeofence ? 1 : 0)} of {progressInfo.totalStops}</strong>
                 </div>
                 {isRouteListOpen ? <ChevronDown size={18} color="var(--color-text-muted)" style={{ marginLeft: '0.5rem' }} /> : <ChevronUp size={18} color="var(--color-text-muted)" style={{ marginLeft: '0.5rem' }} />}
               </div>
               <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                 <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Est. Time</span>
                 <strong style={{ color: 'var(--color-primary)' }}>{progressInfo.etaString}</strong>
               </div>
            </div>

            {/* End Route Button */}
            {isRouteListOpen && progressInfo.completedStops < progressInfo.totalStops && (
              <button 
                className="btn btn-secondary" 
                style={{ width: '100%', marginBottom: '1rem', padding: '0.6rem', color: '#ef4444', borderColor: '#ef4444', background: 'rgba(239,68,68,0.05)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  const pendingStops = activeRoute.expandedStops.filter(s => getStopStatus(s.id) === 'pending');
                  setSkipPrompt({ type: 'end_route', customers: pendingStops });
                }}
              >
                Force End Route
              </button>
            )}

            {/* Actual Visual Progress Bar */}
            <div style={{ width: '100%', height: '8px', background: 'var(--color-border)', borderRadius: '4px', overflow: 'hidden' }}>
              <div 
                style={{ 
                  height: '100%', 
                  background: 'var(--color-primary)', 
                  width: `${(progressInfo.completedStops / progressInfo.totalStops) * 100}%`,
                  transition: 'width 0.5s ease'
                }} 
              />
            </div>
          </div>
        )}

        {/* Collapsible Route List */}
        {isRouteListOpen && activeRoute && (
          <div style={{ maxHeight: '45vh', overflowY: 'auto', padding: '1rem', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-main)' }}>
            <h4 style={{ margin: '0 0 1rem 0', color: 'var(--color-text-main)' }}>Route List</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {activeRoute.expandedStops.map((stop, i) => {
                const status = getStopStatus(stop.id);
                return (
                  <div key={stop.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.8rem', padding: '0.6rem', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', opacity: status === 'completed' ? 0.6 : 1 }}>
                    <div style={{ width: '24px', display: 'flex', justifyContent: 'center' }}>
                      {status === 'completed' ? (
                        <CheckCircle size={18} color="var(--color-primary)" />
                      ) : status === 'skipped' ? (
                        <SkipForward size={16} color="var(--color-text-muted)" />
                      ) : (
                        <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid var(--color-text-muted)' }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: '150px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: status === 'completed' || status === 'skipped' ? 'var(--color-text-muted)' : 'var(--color-text-main)', textDecoration: status === 'completed' || status === 'skipped' ? 'line-through' : 'none' }}>
                        {i + 1}. {stop.name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem' }}>
                        <span>{stop.address}</span>
                        {status === 'pending' && (() => {
                           let estMins = 15;
                           const histVisits = allVisits.filter(v => v.customerId === stop.id && v.status === 'completed' && v.durationSecs);
                           if (histVisits.length > 0) {
                             estMins = Math.round((histVisits.reduce((acc, v) => acc + v.durationSecs, 0) / histVisits.length) / 60);
                           } else if (stop.lawnSize) {
                             const sqft = parseLawnSizeToSqFt(stop.lawnSize);
                             if (sqft) estMins = Math.max(10, Math.round(sqft / globalPace));
                           }
                           const normalizedStop = activeRoute.normalizedStops?.find(n => n.customerId === stop.id);
                           const driveMins = normalizedStop?.plannedDriveTimeSecs ? Math.round(normalizedStop.plannedDriveTimeSecs / 60) : null;
                           return (
                             <span style={{ fontWeight: 600, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>
                               {driveMins !== null && driveMins > 0 ? `${driveMins}m drive · ` : ''}~{estMins}m job
                             </span>
                           );
                        })()}
                      </div>
                    </div>
                    {status === 'pending' && (
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: '0.3rem' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', minHeight: '36px' }}
                          onClick={() => handleSkipStop(stop)}
                          title="Skip Stop"
                        >
                          <SkipForward size={14} />
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', minHeight: '36px' }}
                          onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`, '_blank')}
                          title="Navigate"
                        >
                          <Navigation size={14} />
                        </button>
                        <button
                          className="btn btn-primary"
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', minHeight: '36px' }}
                          onClick={() => {
                            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
                            jobStartRef.current = Date.now();
                            accumulatedTimeRef.current = 0;
                            lastResumeTimeRef.current = Date.now();
                            setTimerState('running');
                            activeGeofenceIdRef.current = stop.id;
                            anchorGeofenceRef.current = currentPosition ? { lat: currentPosition.lat, lng: currentPosition.lng } : 'no-gps';
                            setActiveGeofence(stop);
                            dismissedOpportunitiesRef.current.clear();
                            setIsRouteListOpen(false);
                            potentialEnterRef.current = null;
                            potentialExitRef.current = null;
                          }}
                        >
                          ▶ Start
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                className="btn btn-secondary"
                style={{ marginTop: '0.5rem', padding: '0.6rem', borderStyle: 'dashed' }}
                onClick={() => setShowQuickAdd(true)}
              >
                + Add Unplanned Stop
              </button>
            </div>
          </div>
        )}
      </div>



      {/* Recenter Button if autoCenter is disabled */}
      {!autoCenter && (
        <button 
          className="btn-icon animate-fade-in" 
          onClick={() => { setAutoCenter(true); autoCenterRef.current = true; }}
          style={{ position: 'absolute', top: '19.5rem', right: '1rem', zIndex: 10, background: 'var(--color-bg-card)', boxShadow: 'var(--shadow-md)', border: 'none', cursor: 'pointer' }}>
          <Navigation size={24} color="var(--color-primary)" />
        </button>
      )}

      {/* Map Type Toggle */}
      <button 
        className="btn-icon animate-fade-in" 
        onClick={() => setMapTypeId(prev => prev === 'roadmap' ? 'satellite' : 'roadmap')}
        style={{ position: 'absolute', top: '16rem', right: '1rem', zIndex: 10, background: 'var(--color-bg-card)', boxShadow: 'var(--shadow-md)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', fontWeight: 600, fontSize: '0.75rem', color: 'var(--color-text-main)' }}>
        {mapTypeId === 'roadmap' ? 'SAT' : 'MAP'}
      </button>

      {showQuickAdd && (
        <QuickAddModal 
          allCustomers={allCustomers} 
          currentPosition={currentPosition} 
          onAdd={handleAddUnplannedStop} 
          onClose={() => setShowQuickAdd(false)} 
        />
      )}
    </div>
  );
}
