import { useState, useEffect, useRef, useMemo } from 'react';

import { useGeolocation } from '../hooks/useGeolocation';
import { useWeatherTracker } from '../hooks/useWeatherTracker';
import { useWakeLock } from '../hooks/useWakeLock';
import { useDriveTimer } from '../hooks/useDriveTimer';
import { useJobTimer } from '../hooks/useJobTimer';
import JobCompletionModal from '../components/livemap/JobCompletionModal';
import DrivebyPromptModal from '../components/livemap/DrivebyPromptModal';
import RouteListPanel from '../components/livemap/RouteListPanel';
import LiveTimerPanel from '../components/livemap/LiveTimerPanel';
import PendingArrivalAlert from '../components/livemap/PendingArrivalAlert';
import CustomerDetailsDropdown from '../components/livemap/CustomerDetailsDropdown';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { GeofenceEngine, DIVISION_PROFILES } from '../engine/GeofenceEngine';
import { GoogleMap, Marker, Polygon } from '@react-google-maps/api';
import { useMapStatus } from '../components/MapProvider';
import { Navigation, MapPin, CloudRain, ChevronUp, ChevronDown, SkipForward, Sun, CloudSun, Cloud, CloudDrizzle, CloudSnow, CloudLightning, X, Play, Pause, FileText, Map as MapIcon, ClipboardList, AlertTriangle } from 'lucide-react';
import { parseLawnSizeToSqFt } from '../utils/parseLawnSize';
import ComplianceLogModal from '../components/ComplianceLogModal';


import { useNavigate, useLocation } from 'react-router-dom';
import DayReviewModal from '../components/DayReviewModal';
import AppDialog from '../components/AppDialog';
import TimeSplitModal from '../components/TimeSplitModal';
import EditJobModal from '../components/EditJobModal';
import QuickAddModal from '../components/QuickAddModal';
import { getSettings } from '../db/settings';
import { syncLeafBilling, setLeafCharge, leafHourlyRate } from '../utils/leafBilling';
import { trackApiCall } from '../utils/apiTracker';
import { useServiceMode } from '../components/ServiceProvider';
import { calculatePowerModel, predictTrendMins } from '../utils/matrix';
import { defaultServicesForMode, eligibleForMode, isScheduleAnchor } from '../utils/scheduler';
import { LEAF_CONDITION, isLeafVisit, isMowVisit, isCleanupVisit, mowingServiceIds, comparableVisits, loadLeafJobs, saveLeafJobs, leafToolsVisible } from '../utils/leaves';
import { autoCompleteStepFromVisit, syncTreatmentLogFromVisit, classifyTreatment } from '../db/treatments';
import TodaysMixModal from '../components/livemap/TodaysMixModal';
import { getTodaysMix, setTodaysMix, clearTodaysMix, takeStopMix, clearStopMix, buildLogFromMix, formatLogTimes } from '../utils/todaysMix';
import { saveActiveJob, loadActiveJob, clearActiveJob } from '../utils/activeJobStore';

// Where the map sits with no GPS fix and no route to frame. Constants, so a
// re-render doesn't hand the map a "new" center and undo the route framing.
const NO_FIX_CENTER = { lat: 39.8283, lng: -98.5795 };
const NO_FIX_ZOOM = 4;
const mapContainerStyle = { width: '100%', height: 'calc(100dvh - var(--nav-h))', borderRadius: 'var(--radius-md)' };

// Haversine formula to calculate distance in meters
const getDistance = (lat1, lon1, lat2, lon2) => {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p) / 2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p)) / 2;
  return 12742 * Math.asin(Math.sqrt(a)) * 1000;
};

// Distance (m) to the nearest vertex of a customer's geofence. Better than the
// centroid for adjacency: a big lawn's center can sit past the radius even when
// its edge abuts where the truck is parked.
const distanceToGeofence = (lat, lng, geofence) => {
  let min = Infinity;
  for (const pt of geofence) {
    const d = getDistance(lat, lng, pt.lat, pt.lng);
    if (d < min) min = d;
  }
  return min;
};

export default function LiveMap() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeMode } = useServiceMode();

  // LiveMap stays mounted on every route to preserve job/timer state, so only
  // run the GPS watch when it's actually useful: the Live view is showing, or a
  // route is currently running (so background auto-tracking survives a tab
  // switch mid-workday). Otherwise the radio stays off — no battery drain / error
  // spam while browsing Stats or Clients at home.
  const isLiveView = location.pathname === '/live';
  const hasRunningRoute = useLiveQuery(async () => {
    const running = await db.routes.where('status').equals('active').toArray();
    return running.length > 0;
  }, []) || false;
  const {
    timerState, liveDuration, startTimer, restoreTimer, pauseTimer, resumeTimer, toggleTimer, resetTimer: resetJobTimer,
    getFinalDurationSecs, jobStartRef, accumulatedTimeRef, lastResumeTimeRef, timerStateRef
  } = useJobTimer();

  // A job in progress keeps the GPS on too — on a route that was never
  // "started", leaving the Live tab used to cut the feed out from under it.
  const trackingEnabled = isLiveView || hasRunningRoute || timerState !== 'idle';

  const { position, positionRef, heading, poorGps, fix, gpsStatus } = useGeolocation(trackingEnabled);
  const { weather, weatherRef } = useWeatherTracker(positionRef);

  const {
    isDrivingPaused, drivingDuration, togglePause: toggleDrivePause,
    pauseTimer: pauseDriveTimer, resumeTimer: resumeDriveTimer, resetTimer: resetDriveTimer, getFinalDriveTimeSecs,
    isDrivingPausedRef, accumulatedDriveTimeRef, lastDriveResumeTimeRef
  } = useDriveTimer();



  const currentPosition = position; // backwards compatibility alias
  const latestLocRef = positionRef; // backwards compatibility alias
        const [autoCenter, setAutoCenter] = useState(true);
  const autoCenterRef = useRef(true);
  const [mapTypeId, setMapTypeId] = useState('roadmap');
    const [activeEpaJob, setActiveEpaJob] = useState(null);
  // Day tank mix: state drives the banner UI; logVisit runs from once-bound
  // geofence callbacks so it re-reads localStorage via getTodaysMix() directly.
  const [todaysMix, setTodaysMixState] = useState(() => getTodaysMix());
  const [showMixModal, setShowMixModal] = useState(false);
  // Quick per-stop product pick from the completion panel (no mix was set):
  // snapshot of the visit so it survives the panel auto-dismissing underneath.
  const [quickLogJob, setQuickLogJob] = useState(null);
  // Drive-off protection: logVisit runs from once-bound geofence callbacks, so
  // it needs refs to see the currently-open EPA sheet and its live draft.
  const activeEpaJobRef = useRef(null);
  useEffect(() => { activeEpaJobRef.current = activeEpaJob; }, [activeEpaJob]);
  const epaDraftRef = useRef(null);
  const { isLoaded, loadError } = useMapStatus();
  
  const [activeGeofence, setActiveGeofence] = useState(null);
  const [drivebyPrompt, setDrivebyPrompt] = useState(null);
  const [isRouteListOpen, setIsRouteListOpen] = useState(false);
                      const potentialEnterRef = useRef(null);
  const potentialExitRef = useRef(null);
  const [completionPanel, setCompletionPanel] = useState(null);
  const [completionEpoch, setCompletionEpoch] = useState(0); // restarts the panel's drain bar
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
  const [skipReason, setSkipReason] = useState(null);
  // Job is paused but the truck has clearly left the lawn (forgotten Pause).
  const [pausedAway, setPausedAway] = useState(false);

  const mapRef = useRef(null);
  // The job that just ended: { customerId, entry, exitAt, durationSecs,
  // driveTime, visitId }. If the engine reports the same stop resuming (the
  // exit was premature), the timer and the logged visit pick up from here.
  const lastExitRef = useRef(null);
  // Set while a resumed job runs ({ visitId, customerId }): its completion
  // UPDATES that visit instead of logging a second one for the same lawn.
  const resumeVisitIdRef = useRef(null);
  const restoreTriedRef = useRef(false);
  const dismissedOpportunitiesRef = useRef(new Set());
    const activeGeofenceIdRef = useRef(null);
    const panelTouchRef      = useRef(null); // for swipe-to-dismiss
  const routeVisitsRef     = useRef([]);
  const drivebyTimerRef    = useRef(null);
  const snapBackRef        = useRef(null);
  const activeRouteRef     = useRef(null);
  const allCustomersRef    = useRef([]);
  const panelNoteActiveRef = useRef(false);
  const polygonCacheRef    = useRef({});  // Cache Google Maps Polygon objects by customer ID
  const wakeLockRef         = useRef(null);  // Screen Wake Lock to keep GPS alive

  const anchorGeofenceRef   = useRef(null); // Temporary anchor for manual starts

  const poorGpsRef          = useRef(false);
  const capturedDriveTimeSecsRef = useRef(0);
  const panelNoteRef        = useRef('');
  const panelConditionsRef  = useRef([]); // mirrors JobCompletionModal selections so the auto-dismiss timer can flush them
  const panelServicesRef    = useRef([]);
  // The leaf charge picked on the completion card (null amount = undecided).
  // Carries the visit id so a late flush can never bill another visit.
  const panelLeafChargeRef  = useRef({ visitId: null, amount: null });

  // Lawns marked as a leaf job before or during the job (route list, next-job
  // card, live timer). Held until that lawn's visit is logged, which is then
  // recorded as a leaf visit. The ref is what logVisit reads — it runs from
  // the engine's once-bound callbacks.
  const [leafJobIds, setLeafJobIds] = useState(() => loadLeafJobs());
  const leafJobIdsRef = useRef(leafJobIds);
  const setLeafJob = (customerId, on) => {
    const without = leafJobIdsRef.current.filter(id => id !== customerId);
    const next = on ? [...without, customerId] : without;
    leafJobIdsRef.current = next;
    saveLeafJobs(next);
    setLeafJobIds(next);
  };
  const toggleLeafJob = (customerId) => setLeafJob(customerId, !leafJobIdsRef.current.includes(customerId));
  // The 🍂 buttons are only on screen in leaf season (Settings → Leaf buttons).
  const showLeafTools = activeMode === 'mowing' && leafToolsVisible();

  useEffect(() => { panelNoteRef.current = panelNote; }, [panelNote]);
  // Mirror the panel so armCompletionTimer can see unresolved neighbor prompts.
  const completionPanelRef = useRef(null);
  useEffect(() => { completionPanelRef.current = completionPanel; }, [completionPanel]);
  // Mirror the division switch. logVisit can be invoked through the GeofenceEngine's
  // callbacks, which are bound once on first render — reading `activeMode` from that
  // stale closure logged auto-exit visits under whatever mode the app booted in.
  const activeModeRef = useRef(activeMode);
  useEffect(() => { activeModeRef.current = activeMode; }, [activeMode]);

  
  // Load all data
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];

  // Fert stops completed today with no compliance record — the driver closed
  // or drove past the sheet. Recounts live as each one gets filled.
  const missingEpaToday = useLiveQuery(async () => {
    if (activeMode !== 'fertilizer') return [];
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todays = await db.visits.where('exitTime').aboveOrEqual(startOfDay.getTime()).toArray();
    return todays
      .filter(v => v.status === 'completed' && v.division === 'fertilizer' && !v.complianceLog)
      .sort((a, b) => a.exitTime - b.exitTime);
  }, [activeMode]) || [];
  // Everyone serviced (or skipped) today on ANY route/division — the live
  // opportunity banner must not re-offer a lawn already knocked out today.
  // Live query so it recounts the moment a visit is logged.
  const servicedTodayIds = useLiveQuery(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todays = await db.visits.where('exitTime').aboveOrEqual(startOfDay.getTime()).toArray();
    return new Set(
      todays.filter(v => v.status === 'completed' || v.status === 'skipped').map(v => v.customerId)
    );
  }, []) || new Set();

  // Completed division visits today or yesterday, any route — a stop done a
  // day early (nearby split, added opportunity) must not auto-arrive again
  // when it shows up on the next day's route. Manual Start still works.
  const recentlyServicedIds = useLiveQuery(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const cutoff = startOfDay.getTime() - 86400000;
    const recent = await db.visits.where('exitTime').aboveOrEqual(cutoff).toArray();
    return new Set(
      recent
        .filter(v => v.status === 'completed' && (!v.division || v.division === activeMode))
        .map(v => v.customerId)
    );
  }, [activeMode]) || new Set();

  const activeRoute = useLiveQuery(async () => {
    const routes = await db.routes.where('status').anyOf('pending', 'active').toArray();
    // Filter active routes by the global division
    const modeRoutes = routes.filter(r => r.division === activeMode);
    if (modeRoutes.length === 0) return null;
    const route = modeRoutes[0];

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
    // activeMode is read inside the query, so it must be a dep — with [] the
    // mow↔fert switch kept showing the previous mode's route until some other
    // DB write happened to re-trigger the live query.
  }, [activeMode]);

  useWakeLock(activeRoute?.status === 'active');

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

  // Reset dismissed opportunities when switching to a different route so
  // dismissals don't accumulate permanently across routes.
  useEffect(() => {
    dismissedOpportunitiesRef.current.clear();
  }, [activeRoute?.id]);

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
    // Completed beats skipped: a stop that was skipped and then redone must
    // read as done, whichever visit the query happens to return first.
    const mine = routeVisits.filter(v => v.customerId === customerId);
    if (mine.some(v => v.status === 'completed')) return 'completed';
    if (mine.some(v => v.status === 'skipped')) return 'skipped';
    return 'pending';
  };

  const getStatusColors = (status) => {
    if (status === 'completed') return { fill: '#10b981', stroke: '#059669' }; // Emerald Green
    if (status === 'skipped') return { fill: '#9ca3af', stroke: '#6b7280' }; // Gray
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
    const completedStops = activeRoute.expandedStops.filter(s => getStopStatus(s.id) === 'completed' || getStopStatus(s.id) === 'skipped').length;
    const totalStops = activeRoute.expandedStops.length;
    
    let totalSecondsLeft = 0;
    
    activeRoute.expandedStops.forEach(s => {
       if (getStopStatus(s.id) === 'pending') {
          const normalizedStop = activeRoute.normalizedStops?.find(n => n.customerId === s.id);
          const plannedIds = normalizedStop?.plannedServiceIds || [];
          
          const settings = getSettings();
          const defaultServices = settings.defaultServices || [];
          const isPlannedMow = plannedIds.length === 0 || plannedIds.some(id => defaultServices.find(ds => ds.id === id)?.category === 'Mowing' || id === 's1');

          // Find historical visits for this customer to calculate average time.
          // A stop marked as a leaf job is timed from its leaf visits; for
          // everything else leaf visits stay out of the mow estimate.
          const histVisits = comparableVisits(allVisits.filter(v => {
            if (v.customerId !== s.id || v.status !== 'completed' || !v.durationSecs) return false;
            const isHistMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => defaultServices.find(ds => ds.id === id)?.category === 'Mowing' || id === 's1');
            return isPlannedMow === isHistMow;
          }), isPlannedMow && leafJobIds.includes(s.id));

          let avgDuration = 900; // Default 15 mins
          if (histVisits.length > 0) {
             const sum = histVisits.reduce((acc, v) => acc + v.durationSecs, 0);
             avgDuration = sum / histVisits.length;
          } else {
             const cust = allCustomers.find(c => c.id === s.id);
             if (cust && cust.lawnSize) {
                const sqft = parseLawnSizeToSqFt(cust.lawnSize);
                if (sqft) avgDuration = Math.max(isPlannedMow ? 600 : 300, Math.round((sqft / globalPace) * 60));
             }
          }
          
          // Use planned Google Maps drive time if available, otherwise default to 5 minutes (300s)
          // Look up this stop in activeRoute.normalizedStops to find plannedDriveTimeSecs
          const driveTime = (normalizedStop && normalizedStop.plannedDriveTimeSecs !== undefined && normalizedStop.plannedDriveTimeSecs !== null) ? normalizedStop.plannedDriveTimeSecs : 300;
          
          totalSecondsLeft += avgDuration + driveTime; 
       }
    });

    const minutesLeft = Math.round(totalSecondsLeft / 60);
    
    let etaString = '';
    let finishString = '';
    if (minutesLeft > 0) {
      if (minutesLeft > 60) {
        etaString = `${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m left`;
      } else {
        etaString = `${minutesLeft}m left`;
      }
      // A clock time is what you actually plan the day around.
      finishString = `~${new Date(Date.now() + minutesLeft * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } else if (totalStops - completedStops === 0) {
      etaString = 'Finished';
    }

    return { completedStops, totalStops, etaString, finishString };
  }, [activeRoute, routeVisits, activeGeofence?.id, allVisits, allCustomers, globalPace, leafJobIds]);

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
  }, [activeRoute, routeVisits, activeGeofence?.id, currentPosition, allCustomers]);

  // 1. Dynamic Map Navigation & Snap Back
  const onMapLoad = (map) => {
    mapRef.current = map;
    setMapReady(true);
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

  // No GPS fix (location off, or still waiting): frame today's stops instead
  // of leaving the map on the whole country. Once per route; a real fix takes
  // over through the map's center prop.
  const [mapReady, setMapReady] = useState(false);
  const fittedRouteRef = useRef(null);
  const routeFitKey = activeRoute?.id ?? null;
  const hasPosition = !!currentPosition;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || hasPosition || !window.google || routeFitKey == null) return;
    if (fittedRouteRef.current === routeFitKey) return;
    const points = (activeRoute?.expandedStops || []).flatMap((s) => (Array.isArray(s.geofence) ? s.geofence : []));
    if (points.length === 0) return;
    const bounds = new window.google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    fittedRouteRef.current = routeFitKey;
    // Padding keeps the stops clear of the top card and the route panel.
    map.fitBounds(bounds, { top: 230, bottom: 150, left: 50, right: 50 });
  }, [mapReady, hasPosition, routeFitKey, activeRoute]);

  // 4. Job Timers & Driveby Detection

  // --- GEOFENCE TRACKING ENGINE ---
  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new GeofenceEngine({
      enterDebounceMs: 8000,
      // 15s + a 20m fence buffer: parked-tablet GPS drift must sit clearly
      // beyond the zone for a sustained stretch before a job auto-ends.
      exitDebounceMs: 15000,
      exitBufferMeters: 20,
      drivebyThresholdSecs: getSettings().drivebyThresholdSecs || 45,
      onEnter: (customer, startedAt, info) => {
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        const prev = lastExitRef.current;
        if (info?.resumed && prev && prev.customerId === customer.id) {
          // The earlier exit was premature (GPS drift / a speed glitch) and
          // the truck never left: carry on with the SAME job. The gap counts
          // as work, and the visit already logged gets updated at the real
          // end instead of a second one being added.
          if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
          completionPanelRef.current = null;
          setCompletionPanel(null);
          setTimeSplit(null);
          setDrivebyPrompt(null);
          resumeVisitIdRef.current = prev.visitId != null ? { visitId: prev.visitId, customerId: customer.id } : null;
          restoreTimer({
            jobStart: prev.entry,
            accumulatedMs: (prev.durationSecs || 0) * 1000,
            lastResume: prev.exitAt,
            state: 'running'
          });
          capturedDriveTimeSecsRef.current = prev.driveTime || 0;
          pauseDriveTimer();
        } else {
          // startedAt is backdated to the first fix inside the zone, so the
          // timer counts from actual arrival, not from the end of the debounce
          // — and the drive clock stops at that same moment.
          const start = (info?.resumed ? info.reenteredAt : startedAt) || Date.now();
          resumeVisitIdRef.current = null;
          startTimer(start);
          capturedDriveTimeSecsRef.current = getFinalDriveTimeSecs(start);
          pauseDriveTimer(start);
        }
        lastExitRef.current = null;
        activeGeofenceIdRef.current = customer.id;
        setActiveGeofence(customer);
        setPendingArrival(null);
      },
      onPausedAway: (away) => setPausedAway(away),
      onPendingEnter: (customer, remainingSecs) => {
        if (!customer) {
          setPendingArrival(null);
        } else {
          setPendingArrival({ name: customer.name, secondsLeft: remainingSecs });
        }
      },
      onExit: (customer, durationSecs, exitedAt) => {
        // The engine calls this, but we can just use our existing handleExitGeofence
        handleExitGeofence(exitedAt);
      },
      onDriveBy: (customer, durationSecs, exitedAt) => {
        // In our current setup, handleExitGeofence handles driveby detection internally.
        // We just call it.
        handleExitGeofence(exitedAt);
      },
      onOpportunityFound: (customer) => {
        if (customer) {
          setNearbyOpportunity(customer);
        } else {
          setNearbyOpportunity(null);
        }
      }
    });
  }

  // Update engine context
  useEffect(() => {
    if (engineRef.current && activeRoute) {
      engineRef.current.setContext({
        routeStops: activeRoute.expandedStops || [],
        // The opportunity banner only pitches clients in the active division —
        // a fert-only neighbor is not a mowing opportunity.
        allCustomers: (allCustomers || []).filter(c => eligibleForMode(c, activeMode)),
        routeVisits: routeVisits || [],
        dismissedOpportunities: dismissedOpportunitiesRef.current,
        servicedTodayIds,
        recentlyServicedIds,
        anchorGeofence: anchorGeofenceRef.current,
        isJobPaused: timerState === 'paused',
        // Division-tuned thresholds — mowing/fert use the speed fast-exit
        // (parked while working), a future snow division won't (see engine).
        profile: DIVISION_PROFILES[activeMode] || DIVISION_PROFILES.mowing
      });
    } else if (engineRef.current) {
      // No route (the last stop just completed it) but a job may still be
      // running — keep its pause state current.
      engineRef.current.isJobPaused = timerState === 'paused';
    }
  }, [activeRoute, allCustomers, routeVisits, timerState, servicedTodayIds, recentlyServicedIds, activeMode]);

  // Feed the engine exactly once per real GPS fix, stamped when it arrived.
  // (This used to key off position + route state with a fresh Date.now(), so a
  // route record changing replayed the last position as if it were a new fix.)
  // Feeding continues without an active route while a job is still running or
  // its resume window is open — finishing the last stop completes the route.
  useEffect(() => {
    if (!fix) return;
    const eng = engineRef.current;
    const jobLive = eng.activeGeofenceId != null || eng.hasOpenResumeWindow(fix.ts);
    if (!activeRouteRef.current && !jobLive) return;
    eng.updateLocation({
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      speed: fix.speedMph, // mph, null when the device reports none
      timestamp: fix.ts
    });
  }, [fix]);

  // ── Running job survives an app reload ────────────────────────────────
  // The job timer and the engine's "at this lawn" state used to live only in
  // memory: if Android discarded the app or the page refreshed mid-job, the
  // job was gone and re-arrived from zero a few seconds later.
  const persistActiveJob = () => {
    const customerId = activeGeofenceIdRef.current;
    if (customerId == null || timerStateRef.current === 'idle' || jobStartRef.current == null) return;
    saveActiveJob({
      customerId,
      jobStart: jobStartRef.current,
      accumulatedMs: accumulatedTimeRef.current,
      lastResume: lastResumeTimeRef.current,
      timerState: timerStateRef.current,
      anchor: anchorGeofenceRef.current,
      capturedDriveSecs: capturedDriveTimeSecsRef.current,
      liveNote: liveNoteRef.current,
      resumeVisit: resumeVisitIdRef.current
    });
  };

  // Save on every change that matters, then heartbeat every 10s so the saved
  // copy also records the last moment the app was alive at the job.
  useEffect(() => {
    if (!activeGeofence || timerState === 'idle') return;
    persistActiveJob();
    const id = setInterval(persistActiveJob, 10000);
    return () => clearInterval(id);
  }, [activeGeofence?.id, timerState, liveNote]);

  // Restore once, after the route query has answered (undefined = loading).
  useEffect(() => {
    if (restoreTriedRef.current || activeRoute === undefined) return;
    restoreTriedRef.current = true;
    const saved = loadActiveJob();
    if (!saved || activeGeofenceIdRef.current != null) return;
    (async () => {
      const cust = (activeRoute?.expandedStops || []).find(c => c.id === saved.customerId)
        || await db.customers.get(saved.customerId);
      if (!cust || activeGeofenceIdRef.current != null) { clearActiveJob(); return; }

      anchorGeofenceRef.current = saved.anchor ?? null;
      capturedDriveTimeSecsRef.current = saved.capturedDriveSecs || 0;
      resumeVisitIdRef.current = saved.resumeVisit ?? null;
      restoreTimer({
        jobStart: saved.jobStart,
        accumulatedMs: saved.accumulatedMs || 0,
        lastResume: saved.lastResume ?? saved.jobStart,
        state: saved.timerState
      });
      activeGeofenceIdRef.current = cust.id;
      setActiveGeofence(cust);
      if (saved.liveNote) setLiveNote(saved.liveNote);
      // If the truck turns out to be gone, the engine ends the job at the
      // heartbeat (last time the app was alive at it), not at "now".
      engineRef.current.restoreJob({
        customer: cust,
        startTime: saved.jobStart,
        lastAliveTs: saved.heartbeat,
        anchor: saved.anchor ?? null
      });
      engineRef.current.isJobPaused = saved.timerState === 'paused';
    })();
  }, [activeRoute]);

  const handleExitGeofence = (exitedAt = null) => {
    // Use timerStateRef (not timerState) to avoid stale closure from watchPosition.
    // Duration ends when the fence was actually left (exitedAt, from the engine),
    // not when the debounce finished. accumulatedTimeRef is in MILLISECONDS —
    // it must be divided down, or one tap of Pause blows the logged time up.
    const end = exitedAt || Date.now();
    const finalDuration = Math.floor(
      accumulatedTimeRef.current / 1000 +
      (timerStateRef.current === 'running' && lastResumeTimeRef.current ? Math.max(0, end - lastResumeTimeRef.current) / 1000 : 0)
    );
    const entryTime = jobStartRef.current;
    const completedCustId = activeGeofenceIdRef.current;
    const completedCust = allCustomersRef.current.find(c => c.id === completedCustId);
    const driveTime = capturedDriveTimeSecsRef.current;

    activeGeofenceIdRef.current = null;
    setActiveGeofence(null);
    anchorGeofenceRef.current = null;
    resetJobTimer();
    clearActiveJob();
    potentialEnterRef.current = null;
    potentialExitRef.current = null;

    // Remember this exit: if the engine reports the same stop resuming, the
    // job continues from here. logVisit fills in visitId once it exists.
    const exitRecord = completedCust ? {
      customerId: completedCust.id,
      entry: entryTime,
      exitAt: end,
      durationSecs: finalDuration,
      driveTime,
      visitId: resumeVisitIdRef.current?.visitId ?? null
    } : null;
    lastExitRef.current = exitRecord;

    const threshold = getSettings().drivebyThresholdSecs || 45;

    if (finalDuration < threshold && completedCust) {
      // Carry the live note into the prompt and clear it now — otherwise the note
      // is dropped for this visit AND leaks onto the next completed job.
      setDrivebyPrompt({ customer: completedCust, duration: finalDuration, entry: entryTime, exitAt: end, driveTime, note: liveNoteRef.current });
      setLiveNote('');
      resumeVisitIdRef.current = null;
      // The truck never really stopped, so the drive clock keeps counting —
      // it used to sit paused until the prompt was answered, which shorted
      // the next stop's drive time.
      resumeDriveTimer();
    } else if (completedCust) {
      logVisit(completedCust, finalDuration, entryTime, 'completed', liveNoteRef.current, driveTime, {}, { exitAt: end, exitRecord });
      setLiveNote('');
    }
  };

  // Closing the EPA sheet (saved or not) releases the completion panel's
  // held countdown — armCompletionTimer's own neighbor-guard still applies.
  const closeEpaModal = () => {
    setActiveEpaJob(null);
    epaDraftRef.current = null; // X = discard edits; the filed log (if any) stands
    const cp = completionPanelRef.current;
    if (cp?.visitId != null) armCompletionTimer(cp.visitId);
  };

  const handleSaveEpaLog = async (logData) => {
    if (!activeEpaJob) return;
    await db.visits.update(activeEpaJob.id, { complianceLog: logData });
    // If this visit auto-completed a program step, carry the log onto it too.
    await syncTreatmentLogFromVisit(activeEpaJob.id, logData);
    // Keep the still-open completion panel's copy current so reopening the
    // review shows the edit, not the stale auto-filed log.
    setCompletionPanel(prev =>
      prev && prev.visitId === activeEpaJob.id ? { ...prev, complianceLog: logData } : prev
    );
    const savedId = activeEpaJob.id;
    closeEpaModal();
    return savedId;
  };

  // Close out the route itself — visits for any skipped stops are logged by
  // executeSkip (with the driver's chosen skip semantics) before this runs.
  const finalizeRouteEnd = async () => {
    const route = activeRouteRef.current;
    if (!route) return;
    await db.routes.update(route.id, { status: 'completed' });
    resetDriveTimer(false);
    setShowDayReview(true);
  };

  const handleForceEndRoute = async () => {
    if (!activeRoute) return;
    const completedVisits = await db.visits.where({ routeId: activeRoute.id }).toArray();
    const completedIds = new Set(completedVisits.map(v => v.customerId));
    const uncompleted = (activeRoute.normalizedStops || [])
      .filter(s => !completedIds.has(s.customerId))
      .map(s => allCustomers.find(c => c.id === s.customerId))
      .filter(Boolean);

    if (uncompleted.length === 0) {
      await finalizeRouteEnd();
      return;
    }
    // The skip sheet doubles as the confirmation — choosing an outcome for the
    // remaining stops IS the "yes, end it" (Cancel backs out entirely).
    setSkipReason(null);
    setSkipPrompt({ type: 'end_route', customers: uncompleted });
  };

  // Start / Redo tapped by hand. The anchor (where the tap happened) is handed
  // to the engine and mirrored into the ref AFTER the call: if another job was
  // still running, closing it out clears both, which used to leave the new job
  // with no anchor at all.
  const startJobManually = (stop) => {
    if (!engineRef.current) return;
    const pos = positionRef.current;
    const anchor = pos ? { lat: pos.lat, lng: pos.lng } : 'no-gps';
    engineRef.current.manualStartJob(stop, Date.now(), anchor);
    anchorGeofenceRef.current = anchor;
  };

  const handleManualDone = () => {
    // accumulatedTimeRef is in MILLISECONDS — same unit fix as handleExitGeofence.
    const finalDuration = Math.floor(
      accumulatedTimeRef.current / 1000 +
      (timerStateRef.current === 'running' && lastResumeTimeRef.current ? (Date.now() - lastResumeTimeRef.current) / 1000 : 0)
    );
    const entryTime = jobStartRef.current;
    const completedCust = activeGeofence;

    activeGeofenceIdRef.current = null;
    setActiveGeofence(null);
    anchorGeofenceRef.current = null;
    resetJobTimer();
    clearActiveJob();
    lastExitRef.current = null; // a tapped Done is final — nothing to resume
    potentialEnterRef.current = null;
    potentialExitRef.current = null;

    // Full engine reset, and no auto-arrival here again until the truck has
    // left (the visit lands in the DB a beat later; without this the stop
    // flashed "Arriving…" in between).
    if (engineRef.current) engineRef.current.finishActiveJob();

    logVisit(completedCust, finalDuration, entryTime, 'completed', liveNote, capturedDriveTimeSecsRef.current);
    setLiveNote('');
  };

  // opts (control flags, never stored on the visit):
  //   exitAt           — when the lawn was actually left; stamped as exitTime
  //   exitRecord       — lastExitRef entry to fill with the new visit's id
  //   keepDriveTimer   — don't reset the drive clock (a short-visit prompt
  //                      answered later, while already driving or on a job)
  //   noDriveFallback  — keep a 0 drive time instead of guessing from the clock
  const logVisit = async (customer, durationSecs, entryTime, status, note = '', overrideDriveTimeSecs = null, extra = {}, opts = {}) => {
    const route = activeRouteRef.current;
    let priceEarned = 0;
    let appliedServices = [];
    const exitStamp = opts.exitAt || Date.now();
    // A resumed job updates the visit its first (premature) exit logged.
    // Claimed synchronously, and only by that same customer's completion — a
    // skip or short-visit answer for another stop must not consume it.
    let resumeId = null;
    const pendingResume = resumeVisitIdRef.current;
    if (status === 'completed' && pendingResume && pendingResume.customerId === customer.id) {
      resumeId = pendingResume.visitId;
      resumeVisitIdRef.current = null;
    }

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
    let driveTimeSecs = overrideDriveTimeSecs !== null ? overrideDriveTimeSecs : Math.floor(
      isDrivingPausedRef.current
        ? accumulatedDriveTimeRef.current
        : accumulatedDriveTimeRef.current + (Date.now() - lastDriveResumeTimeRef.current) / 1000
    );

    // Check if there are any stops left on the current route
    const hasMoreStops = route && route.normalizedStops ? route.normalizedStops.some(s => {
      const alreadyVisited = routeVisitsRef.current.some(v => v.customerId === s.customerId && (v.status === 'completed' || v.status === 'skipped'));
      return !alreadyVisited && s.customerId !== customer.id;
    }) : false;

    // Reset drive timer — the next leg starts when this lawn was actually left
    // (exitStamp), not when the exit debounce finished. This must stay ahead
    // of the first await: on a takeover the next stop's onEnter reads the
    // drive clock in the same tick.
    if (!opts.keepDriveTimer) resetDriveTimer(hasMoreStops, exitStamp);

    // Sanity: if drive timer wasn't active (e.g. manual start, skip), fall back to wall-clock
    if (driveTimeSecs <= 0 && !opts.noDriveFallback) {
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

    // Resumed job: the visit already exists (logged at the premature exit).
    // Stretch it to the real end and keep whatever was set on it since —
    // services, price, EPA log, program step — instead of adding a duplicate.
    let resumedVisit = null;
    if (resumeId != null) {
      resumedVisit = await db.visits.get(resumeId);
      if (!resumedVisit) resumeId = null; // deleted in the meantime — log fresh
    }

    // Leaf job: leaves come up in the same pass as the mow, so the whole job
    // is one clock. If the driver marked this lawn (before or during the job)
    // the visit is tagged — it stays out of the plain mowing numbers and is
    // compared with other leaf visits. Still changeable on the completion card.
    const markedLeafJob = leafJobIdsRef.current.includes(customer.id);
    // (Only a mow can be a leaf job — a planned clean-up is its own service.)
    let visitConditions = status === 'completed' && activeModeRef.current === 'mowing' && markedLeafJob && isMowVisit({ appliedServices })
      ? [LEAF_CONDITION]
      : [];
    // The mark is used up once the stop is logged (completed or skipped).
    if (markedLeafJob) setLeafJob(customer.id, false);

    let visitId;
    if (resumedVisit) {
      visitId = resumeId;
      await db.visits.update(resumeId, {
        durationSecs: durationSecs || 0,
        exitTime: exitStamp,
        ...(note ? { note } : {})
      });
      priceEarned = resumedVisit.priceEarned ?? priceEarned;
      appliedServices = resumedVisit.appliedServices ?? appliedServices;
      visitConditions = resumedVisit.conditions ?? visitConditions;
    } else {
      visitId = await db.visits.add({
        routeId: route ? route.id : null,
        customerId: customer.id,
        status: status || 'completed',
        durationSecs: durationSecs || 0,
        driveTimeSecs: driveTimeSecs || 0,
        entryTime: entryTime || Date.now(),
        // When the lawn was actually left — not when this record was written
        // (which trails by the exit debounce, or by minutes when a short-visit
        // prompt is answered late).
        exitTime: exitStamp,
        weather: weatherRef.current || null,
        priceEarned: priceEarned || 0,
        appliedServices: appliedServices || [],
        note: note || '',
        division: activeModeRef.current,
        ...(visitConditions.length > 0 ? { conditions: visitConditions } : {}),
        // Skip semantics: { catchUp: true } = still needs service (Dropped card),
        // { countsForSchedule: true } = deliberate cycle skip (anchors the clock).
        ...extra
      });
    }
    if (opts.exitRecord) opts.exitRecord.visitId = visitId;

    // Leaf job: record its leaf time and the suggested hourly charge. Nothing
    // is added to the price until the driver decides (completion card, or
    // later from Analytics → Leaf Billing). servicePrice is the price without
    // any leaf charge; a resumed job may already carry a decided one.
    const priorLeafCharge = resumedVisit?.leafDecided ? (resumedVisit.leafCharge || 0) : null;
    const servicePrice = Math.max(0, priceEarned - (priorLeafCharge || 0));
    // (A clean-up planned on the stop gets its whole-visit suggestion the same way.)
    if (status === 'completed' && (visitConditions.includes(LEAF_CONDITION) ||
        isCleanupVisit({ division: activeModeRef.current, appliedServices }))) {
      await syncLeafBilling(visitId);
    }

    // Show completion panel only for completed jobs
    if (status === 'completed') {
      // Detect nearby customers (within 150m) that haven't been visited yet.
      // IMPORTANT: this runs from the GeofenceEngine's once-bound callbacks on
      // auto-exit, so everything here must read refs — the old code read
      // `currentPosition`/`allCustomers`/`activeMode` from the first-render
      // closure, where position is still null, so the neighbor prompt (and the
      // pace comparison) silently never fired unless the driver tapped Done.
      let nearbyCandidates = [];
      let historicalAverageSecs = null;
      let historicalVisitCount = 0;
      // Both baselines go to the panel so ticking / unticking Leaves there
      // switches the comparison without another DB read.
      let usualMow;
      let usualLeaf;
      const leafTagged = visitConditions.includes(LEAF_CONDITION);
      const mode = activeModeRef.current;
      const freshCustomers = allCustomersRef.current;
      const pos = positionRef.current;

      // Field-applied fertilizer completes the matching program step (if the
      // client is enrolled), so the Treatments page doesn't ask for a second
      // manual log and then flag the round overdue forever.
      let programStepCompleted = null;
      let allTreatments = [];
      let autoLog = null;
      if (mode === 'fertilizer' && resumedVisit) {
        // Already filed and already counted toward the program at the first
        // exit — re-running either would overwrite an edited log and tick off
        // the NEXT program step.
        autoLog = resumedVisit.complianceLog || null;
        allTreatments = await db.treatments.toArray();
      } else if (mode === 'fertilizer') {
        // Auto-file the EPA compliance log: this lawn's own product pick (set
        // from the live panel) wins over the day tank mix. takeStopMix also
        // clears the slot so it can never bleed onto the next stop.
        const mix = takeStopMix(customer.id) || getTodaysMix();
        if (mix) {
          autoLog = buildLogFromMix(mix, { customer, exitTime: exitStamp, durationSecs });
          await db.visits.update(visitId, { complianceLog: autoLog });
        }
        const step = await autoCompleteStepFromVisit(customer.id, {
          id: visitId,
          exitTime: exitStamp,
          priceEarned,
          durationSecs,
          weather: weatherRef.current || null,
          complianceLog: autoLog,
        });
        if (step) programStepCompleted = step.stepName;
        // Loaded once here so the neighbor badges below can use program windows.
        allTreatments = await db.treatments.toArray();
      }

      {
        const allDbVisits = await db.visits.toArray();

        const mowIds = mowingServiceIds();
        const thisIsMow = isMowVisit({ appliedServices }, mowIds);
        // Calculate historical average for this specific mode (no GPS needed)
        const priorVisits = allDbVisits.filter(v =>
          v.customerId === customer.id &&
          v.status === 'completed' &&
          v.durationSecs > 0 &&
          v.id !== visitId &&
          (!v.division || v.division === mode) &&
          // mows against mows, clean-ups against clean-ups
          isMowVisit(v, mowIds) === thisIsMow
        );

        const usualFrom = (wantLeaf) => {
          const list = comparableVisits(priorVisits, wantLeaf);
          if (list.length === 0) return null;
          return {
            secs: Math.round(list.reduce((acc, v) => acc + v.durationSecs, 0) / list.length),
            count: list.length,
            fromLeafVisits: isLeafVisit(list[0]),
          };
        };
        usualMow = usualFrom(false);
        usualLeaf = usualFrom(true);
        const usual = leafTagged ? usualLeaf : usualMow;
        if (usual) {
          historicalAverageSecs = usual.secs;
          historicalVisitCount = usual.count;
        }

        if (pos) {
        // Trend curve fit once, used to estimate time for neighbors with no history.
        const trendModel = calculatePowerModel(allDbVisits, freshCustomers);

        // Exclude anyone already serviced today on ANY route (not just this one),
        // so a neighbor knocked out earlier on a different/ad-hoc route won't re-prompt.
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const servicedTodayIds = new Set(
          allDbVisits
            .filter(v => (v.status === 'completed' || v.status === 'skipped') && v.exitTime >= startOfToday.getTime())
            .map(v => v.customerId)
        );
        servicedTodayIds.add(customer.id);

        const routeStopIds = new Set(
          (route?.normalizedStops || route?.stops || []).map(s => s.customerId)
        );

        const nearby = freshCustomers
          // Paused (inactive) and snoozed clients asked not to be serviced right
          // now — don't pitch them as opportunities. And only clients in the
          // active division: a fert-only neighbor is not a mow split candidate.
          .filter(c => c.id !== customer.id && !servicedTodayIds.has(c.id) &&
            c.status !== 'inactive' && !(c.snoozedUntil && c.snoozedUntil > Date.now()) &&
            eligibleForMode(c, mode))
          .map(c => {
            if (!c.geofence || c.geofence.length === 0) return null;
            const dist = distanceToGeofence(pos.lat, pos.lng, c.geofence);
            if (dist > 150) return null;

            // Expected time: this lawn's own average in this mode, else the trend
            // curve from its sqft — drives the smart split-time defaults.
            const own = comparableVisits(allDbVisits.filter(v =>
              v.customerId === c.id && v.status === 'completed' && v.durationSecs > 0 &&
              (!v.division || v.division === mode) && isMowVisit(v, mowIds) === thisIsMow
            ), leafTagged);
            let expectedSecs = null;
            let expectedSource = null; // 'history' | 'estimate' — shown in the split modal
            if (own.length > 0) {
              expectedSecs = Math.round(own.reduce((s, v) => s + v.durationSecs, 0) / own.length);
              expectedSource = 'history';
            } else {
              const sqft = parseLawnSizeToSqFt(c.lawnSize);
              if (sqft && trendModel) {
                expectedSecs = Math.round(predictTrendMins(trendModel, sqft) * 60);
                expectedSource = 'estimate';
              }
            }
            const visitCount = own.length;

            // Price that would be logged: planned services on the route, else first active.
            let mowPrice = 0;
            if (c.services) {
              const routeStop = route?.normalizedStops?.find(s => s.customerId === c.id);
              const plannedIds = routeStop?.plannedServiceIds || [];
              const svc = plannedIds.length > 0
                ? c.services.filter(s => plannedIds.includes(s.id))
                : c.services.filter(s => s.active).slice(0, 1);
              mowPrice = svc.reduce((sum, s) => sum + (s.price || 0), 0);
            }

            // Last schedule anchor before today (completed service OR a
            // deliberate cycle-skip) — keeps the badge honest for clients
            // skipped on purpose, matching Dashboard/scheduler due math.
            const past = allDbVisits.filter(v =>
              v.customerId === c.id && isScheduleAnchor(v) && v.exitTime < startOfToday.getTime()
            );
            const lastServicedTs = past.length > 0 ? Math.max(...past.map(v => v.exitTime)) : null;

            // Due status so the prompt says whether the neighbor is actually
            // worth walking over to, not just that they're close. Program-
            // enrolled fert clients go by their step windows (matching the
            // Treatments page); everyone else uses the Dashboard interval rules.
            const intervalDays = mode === 'fertilizer'
              ? (c.fertilizerInterval || 30)
              : (c.mowingInterval || c.serviceInterval || 7);
            const daysSince = lastServicedTs ? Math.floor((Date.now() - lastServicedTs) / 86400000) : null;
            let dueStatus;
            if (mode === 'fertilizer' && c.treatmentProgramId) {
              const states = allTreatments
                .filter(t => t.customerId === c.id && (t.status === 'scheduled' || t.status === 'due'))
                .map(t => classifyTreatment(t));
              dueStatus = states.includes('overdue') ? 'overdue'
                : states.includes('due') ? 'due'
                : null;
            } else {
              dueStatus = daysSince === null ? 'new'
                : daysSince > intervalDays + 2 ? 'overdue'
                : daysSince >= intervalDays ? 'due'
                : null;
            }

            return { ...c, dist, expectedSecs, expectedSource, visitCount, mowPrice, lastServicedTs, dueStatus, daysSince, intervalDays, onRoute: routeStopIds.has(c.id) };
          })
          .filter(Boolean)
          .sort((a, b) => a.dist - b.dist);

        if (nearby.length > 0) nearbyCandidates = nearby.slice(0, 5); // Limit to top 5
        }
      }

      setPanelNote(note || '');
      // Seed the selection refs to match the panel's initial state so an
      // auto-dismiss before the user touches anything is a no-op.
      panelConditionsRef.current = visitConditions;
      panelServicesRef.current = appliedServices || [];
      panelLeafChargeRef.current = { visitId, amount: priorLeafCharge };
      const newPanel = {
        custName: customer.name,
        durationSecs,
        priceEarned,
        weather: weatherRef.current || null,
        visitId,
        nearbyCandidates,
        historicalAverageSecs,
        historicalVisitCount,
        usualMow,
        usualLeaf,
        conditions: visitConditions,
        servicePrice,
        leafRate: leafHourlyRate(),
        leafCharge: priorLeafCharge, // null = not decided yet
        primaryCustomer: customer,
        exitTime: exitStamp,
        appliedServices,
        programStepCompleted,
        complianceLog: autoLog
      };
      // Sync the ref immediately. The useEffect that mirrors completionPanel runs
      // a tick late, so without this armCompletionTimer's neighbor-guard would read
      // the PREVIOUS job's panel — leaving this panel's timer unarmed (stuck bar).
      completionPanelRef.current = newPanel;
      setCompletionPanel(newPanel);
      // Hold the auto-dismiss while the neighbor prompt needs an answer; it arms
      // once the driver dismisses or resolves it.
      if (mode === 'fertilizer') {
        // Driver drove off with the previous stop's sheet still open — persist
        // its draft before this stop's sheet replaces it, so half-typed edits
        // (or a no-mix sheet with products picked) aren't silently dropped.
        // An untouched no-mix sheet (no products) stays unlogged on purpose;
        // the missing-logs banner below the mix bar catches those.
        const prevSheet = activeEpaJobRef.current;
        const prevDraft = epaDraftRef.current;
        if (prevSheet && prevSheet.id != null && prevSheet.id !== visitId &&
            prevDraft && (prevDraft.products?.length > 0 || prevSheet.complianceLog)) {
          await db.visits.update(prevSheet.id, { complianceLog: prevDraft });
          await syncTreatmentLogFromVisit(prevSheet.id, prevDraft);
        }
        epaDraftRef.current = null;
        // Pop the EPA sheet right on exit so the driver sees what auto-filed
        // (or fills it when no mix was set) and can correct it at the truck.
        // The panel's countdown stays held until the sheet closes.
        setActiveEpaJob({
          id: visitId,
          custName: customer.name,
          exitTime: exitStamp,
          durationSecs,
          custLawnSize: customer.lawnSize,
          phone: customer.phone,
          address: customer.address,
          complianceLog: autoLog
        });
      } else if (nearbyCandidates.length === 0) {
        armCompletionTimer(visitId);
      }
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

  // Persist whatever the user has entered/selected on the completion panel.
  // Used by both the explicit "Done" button and the auto-dismiss timer.
  // How long the completion panel lingers before cleaning itself up.
  const COMPLETION_AUTO_DISMISS_MS = 20000;

  // (Re)arm the completion panel's self-cleanup countdown. Re-called on any
  // interaction inside the panel so it never vanishes mid-tap; the drain bar in
  // JobCompletionModal restarts via the epoch bump.
  const armCompletionTimer = (visitId, { force = false } = {}) => {
    // Don't auto-dismiss while a neighbor prompt is waiting for an answer — the
    // panel is asking a question, so it shouldn't race the driver. The prompt's
    // "No / Dismiss" button re-arms with force:true once resolved.
    if (!force && completionPanelRef.current?.nearbyCandidates?.length > 0) {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
      return;
    }
    if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    setCompletionEpoch(e => e + 1);
    completionTimerRef.current = setTimeout(async () => {
      if (panelNoteActiveRef.current) {
        // Retry in 5 seconds if user is actively typing
        completionTimerRef.current = setTimeout(async () => {
          // Flush note + conditions/services on final auto-dismiss so nothing is lost
          await flushCompletionDetails(visitId);
          setCompletionPanel(null);
        }, 5000);
      } else {
        // Flush note + conditions/services on auto-dismiss so nothing is lost
        await flushCompletionDetails(visitId);
        setCompletionPanel(null);
      }
    }, COMPLETION_AUTO_DISMISS_MS);
  };

  const flushCompletionDetails = async (visitId, details) => {
    if (!visitId) return;
    const note = (details?.note ?? panelNoteRef.current ?? '').trim();
    const appliedServices = details?.appliedServices ?? panelServicesRef.current;
    const conditions = details?.conditions ?? panelConditionsRef.current;

    const updateObj = {};
    if (note) updateObj.note = note;
    if (appliedServices) {
      updateObj.appliedServices = appliedServices;
      // Services changed on the card (e.g. Fall Clean-up picked in place of
      // Mowing): the visit is saved as that, at that service's price. Add-ons
      // and a decided leaf charge ride on top as before.
      const visit = await db.visits.get(visitId);
      const before = visit?.appliedServices || [];
      const changed = before.length !== appliedServices.length || appliedServices.some(id => !before.includes(id));
      if (visit && changed) {
        const cust = allCustomersRef.current?.find(c => c.id === visit.customerId);
        const services = (cust?.services || []).filter(s => appliedServices.includes(s.id));
        const addOns = Array.isArray(visit.addOns) ? visit.addOns.reduce((sum, a) => sum + (a.price || 0), 0) : 0;
        updateObj.priceEarned = Math.round((services.reduce((sum, s) => sum + (s.price || 0), 0) + addOns + (visit.leafCharge || 0)) * 100) / 100;
        updateObj.revenueBreakdown = undefined; // rebuilt from the new services
        updateObj.cleanupFlatPrice = undefined; // and any remembered clean-up flat price is stale
        updateObj.leafDecided = false;
      }
    }
    // Written even when empty: unticking the pre-set Leaves tag has to stick.
    if (conditions) updateObj.conditions = conditions;

    if (Object.keys(updateObj).length > 0) {
      await db.visits.update(visitId, updateObj);
    }
    // The Leaf job chip may have been ticked or unticked — refresh the leaf
    // time and suggestion, then apply the charge if the driver picked one.
    const synced = await syncLeafBilling(visitId);
    const picked = details?.leafCharge !== undefined
      ? details.leafCharge
      : (panelLeafChargeRef.current.visitId === visitId ? panelLeafChargeRef.current.amount : null);
    if (synced && (isLeafVisit(synced) || isCleanupVisit(synced)) && picked != null) await setLeafCharge(visitId, picked);
  };

  const handleSaveCompletion = async (details) => {
    if (!completionPanel?.visitId) return;
    await flushCompletionDetails(completionPanel.visitId, details);
    if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    setCompletionPanel(null);
  };

  const handleSaveEditedJob = async (updatedData) => {
    if (!completionPanel?.visitId) return;
    
    // updatedData contains { appliedServices, addOns, priceEarned, note }.
    // Its price is services + add-ons; a leaf job's hourly leaf charge rides
    // on top and must not be wiped by an edit.
    const current = await db.visits.get(completionPanel.visitId);
    const leafCharge = current?.leafCharge || 0;
    const updateObj = {
      appliedServices: updatedData.appliedServices,
      addOns: updatedData.addOns,
      priceEarned: Math.round((updatedData.priceEarned + leafCharge) * 100) / 100
    };
    if (updatedData.note) {
      updateObj.note = updatedData.note;
    }
    
    await db.visits.update(completionPanel.visitId, updateObj);
    
    // Update the completion panel state to reflect the new total and note (if we want to keep it open)
    setCompletionPanel(prev => ({
      ...prev,
      priceEarned: updateObj.priceEarned,
      servicePrice: updatedData.priceEarned,
      appliedServices: updatedData.appliedServices,
      addOns: updatedData.addOns
    }));
    
    if (updatedData.note) setPanelNote(updatedData.note);
    setIsEditJobOpen(false);
  };

  // status: 'completed' | 'skipped' | 'ignore'.
  // 'ignore' = just driving past — log nothing, the stop stays pending and
  // will arrive normally later. (The prompt used to offer only Skipped or
  // Normal Service, so a pass-by had to be recorded as one or the other.)
  const handleDrivebyResolution = (status) => {
    const p = drivebyPrompt;
    setDrivebyPrompt(null);
    if (!p || status === 'ignore') return;

    // The driver has ruled on this stop — it is no longer a job that could
    // "resume" (that would log a second visit on top of this answer).
    if (lastExitRef.current?.customerId === p.customer.id) lastExitRef.current = null;
    if (engineRef.current?.resumable?.id === p.customer.id) engineRef.current.resumable = null;

    // The drive clock kept running after the short visit. If it was a real
    // visit, the leg that led to it belongs to that visit — take it back out
    // so the next stop isn't charged for it too.
    const legSecs = status === 'completed' ? (p.driveTime || 0) : 0;
    if (legSecs > 0) {
      accumulatedDriveTimeRef.current = Math.max(0, accumulatedDriveTimeRef.current - legSecs);
      if (activeGeofenceIdRef.current != null) {
        capturedDriveTimeSecsRef.current = Math.max(0, capturedDriveTimeSecsRef.current - legSecs);
      }
    }

    // A driveby resolved as "Skipped" means the lawn didn't get serviced —
    // flag it catch-up so it surfaces on the Dashboard instead of vanishing.
    logVisit(p.customer, p.duration, p.entry, status, p.note || '', legSecs,
      status === 'skipped' ? { catchUp: true } : {},
      { exitAt: p.exitAt, keepDriveTimer: true, noDriveFallback: true });
  };

  // An unanswered short-visit prompt closes itself as "just passing" — the
  // driver is driving, and nothing should be logged without a choice.
  useEffect(() => {
    if (!drivebyPrompt) return;
    const t = setTimeout(() => setDrivebyPrompt(cur => (cur === drivebyPrompt ? null : cur)), 60000);
    return () => clearTimeout(t);
  }, [drivebyPrompt]);

  const handleAddOpportunity = async (customer) => {
    await handleAddUnplannedStop(customer);
    setNearbyOpportunity(null);
  };

  const handleDismissOpportunity = (customerId) => {
    dismissedOpportunitiesRef.current.add(customerId);
    setNearbyOpportunity(null);
  };

  const handleSkipStop = (customer) => {
    setSkipReason(null);
    setSkipPrompt({ type: 'single', customer });
  };

  // Two skip outcomes, both honest:
  //  'catchup' — the lawn still needs service; the visit is flagged catchUp so
  //              the Dashboard's "Dropped from route" card surfaces it tomorrow.
  //  'cycle'   — deliberate skip (no growth / customer request); flagged
  //              countsForSchedule so the due math treats it as the schedule
  //              anchor and the client shows normally due next cycle, not LATE.
  const executeSkip = async (mode) => {
    if (!skipPrompt) return;
    const isEndRoute = skipPrompt.type === 'end_route';
    const targets = isEndRoute ? skipPrompt.customers : [skipPrompt.customer];
    const baseNote = isEndRoute ? 'Skipped when ending route' : 'Skipped';
    const note = skipReason ? `${baseNote} — ${skipReason}` : baseNote;
    const extra = mode === 'cycle' ? { countsForSchedule: true } : { catchUp: true };

    for (const cust of targets) {
      await logVisit(cust, 0, Date.now(), 'skipped', note, null, extra);
    }
    setSkipPrompt(null);
    setSkipReason(null);
    if (isEndRoute) await finalizeRouteEnd();
  };


  const handleTimeSplitConfirm = async ({ primaryMins, companionsMins, mode }) => {
    if (!timeSplit) return;
    const { primaryVisitId, companions, primaryCustomer, primaryExitTime, durationSecs } = timeSplit;

    const originalExitTime = primaryExitTime ?? Date.now();
    const jobStart = originalExitTime - (durationSecs * 1000);

    // Primary
    const primaryEntryTime = jobStart;
    const primaryExitUpdated = jobStart + (primaryMins * 60 * 1000);

    // Update primary visit with corrected duration and times
    await db.visits.update(primaryVisitId, {
      durationSecs: primaryMins * 60,
      entryTime: primaryEntryTime,
      exitTime: primaryExitUpdated
    });

    // Preserve any note / conditions / service selections the driver made in the
    // completion panel before choosing to split — otherwise they were silently lost.
    // (flush also re-settles a leaf job's hourly charge for the corrected time)
    await flushCompletionDetails(primaryVisitId);

    const dayMix = activeMode === 'fertilizer' ? getTodaysMix() : null;

    // The primary's auto-filed EPA log was stamped with the pre-split times;
    // re-stamp it (and the linked treatment) with the corrected window.
    const primaryVisit = await db.visits.get(primaryVisitId);
    if (primaryVisit?.complianceLog?.autoFiledFromMix) {
      const restamped = {
        ...primaryVisit.complianceLog,
        ...formatLogTimes(primaryEntryTime, primaryExitUpdated)
      };
      await db.visits.update(primaryVisitId, { complianceLog: restamped });
      await syncTreatmentLogFromVisit(primaryVisitId, restamped);
    }

    let currentSeqTime = primaryExitUpdated;

    for (const compData of companionsMins) {
      const compCust = companions.find(c => c.id === compData.id);
      if (!compCust) continue;

      let compEntry, compExit;
      if (mode === 'simultaneous') {
        compEntry = jobStart;
        compExit = jobStart + (compData.mins * 60 * 1000);
      } else {
        compEntry = currentSeqTime;
        compExit = currentSeqTime + (compData.mins * 60 * 1000);
        currentSeqTime = compExit;
      }

      // Build companion services from the route plan; off-route neighbors fall
      // back to the division-matched service (a split during a fert day prices
      // from the fert service, not whatever service happens to be listed first).
      let companionPrice = 0;
      let companionServices = [];
      if (compCust.services) {
        const routeStop = activeRoute?.normalizedStops?.find(s => s.customerId === compCust.id);
        const plannedIds = routeStop?.plannedServiceIds || [];
        const services = plannedIds.length > 0
          ? compCust.services.filter(s => plannedIds.includes(s.id))
          : defaultServicesForMode(compCust, activeMode);
        companionServices = services.map(s => s.id);
        companionPrice = services.reduce((sum, s) => sum + (s.price || 0), 0);
      }

      const compLog = dayMix
        ? buildLogFromMix(dayMix, { customer: compCust, exitTime: compExit, durationSecs: compData.mins * 60 })
        : null;

      const compVisitId = await db.visits.add({
        routeId: activeRoute?.id ?? null,
        customerId: compCust.id,
        status: 'completed',
        durationSecs: compData.mins * 60,
        driveTimeSecs: 0,
        entryTime: compEntry,
        exitTime: compExit,
        weather,
        priceEarned: companionPrice,
        appliedServices: companionServices,
        division: activeMode,
        // Neighbors done in the same leaf pass are leaf visits too.
        ...(isLeafVisit(primaryVisit) ? { conditions: [LEAF_CONDITION] } : {}),
        complianceLog: compLog,
        note: `${mode === 'simultaneous' ? 'Simultaneous' : 'Split'} visit with ${primaryCustomer?.name ?? 'adjacent property'}`
      });

      if (isLeafVisit(primaryVisit)) await syncLeafBilling(compVisitId);

      // Same bridge as logVisit: a split-off fertilizer application also
      // completes the companion's open program step.
      if (activeMode === 'fertilizer') {
        await autoCompleteStepFromVisit(compCust.id, {
          id: compVisitId,
          exitTime: compExit,
          priceEarned: companionPrice,
          durationSecs: compData.mins * 60,
          weather,
          complianceLog: compLog
        });
      }
    }

    // A companion may have been the last uncovered stop on the route — logVisit's
    // "all stops done" check ran before these visits existed, so re-check here.
    // Without this the route stays active forever and every stop finished via a
    // split forces a manual "Force End Route" later.
    const route = activeRouteRef.current;
    if (route && route.normalizedStops && route.status !== 'completed') {
      const currentVisits = await db.visits.where({ routeId: route.id }).toArray();
      const doneIds = new Set(currentVisits.map(v => v.customerId));
      const allCompleted = route.normalizedStops.every(s => doneIds.has(s.customerId));
      if (allCompleted) {
        await db.routes.update(route.id, { status: 'completed' });
      }
    }

    setTimeSplit(null);
    setCompletionPanel(null);
  };

  const handleAddUnplannedStop = async (customer) => {
    if (!activeRoute) {
      await db.routes.add({
        name: 'Ad-hoc Route',
        status: 'active',
        isTemplate: 0,
        division: activeMode,
        stops: [{ customerId: customer.id, plannedServiceIds: [] }],
        createdAt: Date.now()
      });
    } else {
      const newStops = [...activeRoute.stops, { customerId: customer.id, plannedServiceIds: [] }];
      await db.routes.update(activeRoute.id, { stops: newStops });
    }
    setShowQuickAdd(false);
  };

  // "Mow next" from the completion panel's neighbor prompt: append the selected
  // neighbors to today's route in ONE update (looping handleAddUnplannedStop
  // would re-read a stale stops array and drop all but the last add). The
  // geofence engine then tracks them like any planned stop.
  const handleAddCompanionsToRoute = async (companions) => {
    const route = activeRouteRef.current;
    const existingIds = new Set((route?.normalizedStops || []).map(s => s.customerId));
    const toAdd = (companions || []).filter(c => !existingIds.has(c.id));
    if (toAdd.length === 0) return;
    const newStopObjs = toAdd.map(c => ({ customerId: c.id, plannedServiceIds: [] }));
    if (!route) {
      await db.routes.add({
        name: 'Ad-hoc Route',
        status: 'active',
        isTemplate: 0,
        division: activeModeRef.current,
        stops: newStopObjs,
        createdAt: Date.now()
      });
    } else {
      await db.routes.update(route.id, { stops: [...route.stops, ...newStopObjs] });
    }
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

  const togglePause = toggleTimer;



  const formatLiveTimer = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    if (h > 0) return `${h}:${m}:${s}`;
    return `${m}:${s}`;
  };

  return (
    <div className="animate-fade-in" style={{ position: 'relative' }}>

      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      {showDayReview && <DayReviewModal onClose={() => setShowDayReview(false)} />}
      {/* EPA log for the just-completed visit. The completion panel's button has
          set activeEpaJob since day one, but this modal was never rendered here —
          the field EPA flow silently did nothing. */}
      {activeEpaJob && (
        <ComplianceLogModal
          visit={activeEpaJob}
          customerName={activeEpaJob.custName}
          customerLawnSize={activeEpaJob.custLawnSize}
          initialLog={activeEpaJob.complianceLog || null}
          onSave={handleSaveEpaLog}
          onClose={closeEpaModal}
          draftRef={epaDraftRef}
        />
      )}
      {quickLogJob && (
        <TodaysMixModal
          title="🧪 Products Applied Here"
          blurb={`What did you apply at ${quickLogJob.customer?.name || 'this stop'}? This files the EPA log for this stop only.`}
          saveLabel="File EPA log"
          onSave={async (products, mixSite) => {
            const log = buildLogFromMix({ products, mixSite }, {
              customer: quickLogJob.customer,
              exitTime: quickLogJob.exitTime,
              durationSecs: quickLogJob.durationSecs
            });
            await db.visits.update(quickLogJob.visitId, { complianceLog: log });
            await syncTreatmentLogFromVisit(quickLogJob.visitId, log);
            setCompletionPanel(prev =>
              prev && prev.visitId === quickLogJob.visitId ? { ...prev, complianceLog: log } : prev
            );
            setQuickLogJob(null);
            armCompletionTimer(quickLogJob.visitId);
          }}
          onClose={() => {
            setQuickLogJob(null);
            armCompletionTimer(quickLogJob.visitId);
          }}
        />
      )}
      {showMixModal && (
        <TodaysMixModal
          initialMix={todaysMix}
          onSave={(products, mixSite) => {
            setTodaysMixState(setTodaysMix(products, mixSite));
            setShowMixModal(false);
          }}
          onClear={() => {
            clearTodaysMix();
            setTodaysMixState(null);
            setShowMixModal(false);
          }}
          onClose={() => setShowMixModal(false)}
        />
      )}
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
          primaryExpectedSecs={timeSplit.primaryExpectedSecs}
          primaryVisitCount={timeSplit.primaryVisitCount}
          primaryPrice={timeSplit.primaryPrice}
          companions={timeSplit.companions}
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
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
              {skipPrompt.type === 'single'
                ? 'Does this lawn still need service, or is it fine until the next cycle?'
                : `${skipPrompt.customers.length} stop${skipPrompt.customers.length !== 1 ? 's' : ''} remain${skipPrompt.customers.length === 1 ? 's' : ''} unfinished. What should happen to them?`}
            </p>

            {/* Optional reason — saved to the visit note */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.2rem' }}>
              {['Rain', 'No growth', 'Customer request', "Couldn't access", 'Ran out of time'].map(r => (
                <button
                  key={r}
                  onClick={() => setSkipReason(prev => prev === r ? null : r)}
                  style={{
                    fontSize: '0.78rem', fontWeight: 600, padding: '0.35rem 0.7rem', borderRadius: '999px', cursor: 'pointer',
                    border: `1px solid ${skipReason === r ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: skipReason === r ? 'var(--color-primary-light)' : 'transparent',
                    color: skipReason === r ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '0.8rem', flexDirection: 'column', gap: '0.1rem' }}
                onClick={() => executeSkip('catchup')}
              >
                <span>Still needs service — catch up ASAP</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 500, opacity: 0.85 }}>Shows on Home until it gets done</span>
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: '100%', justifyContent: 'center', padding: '0.8rem', color: '#b45309', borderColor: '#f59e0b', flexDirection: 'column', gap: '0.1rem' }}
                onClick={() => executeSkip('cycle')}
              >
                <span>Skip this cycle</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 500, opacity: 0.85 }}>Back on the normal schedule — won't show late</span>
              </button>
              <button
                className="btn"
                style={{ width: '100%', justifyContent: 'center', padding: '0.8rem', marginTop: '0.5rem' }}
                onClick={() => { setSkipPrompt(null); setSkipReason(null); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Driveby Prompt Modal */}
      <DrivebyPromptModal drivebyPrompt={drivebyPrompt} handleDrivebyResolution={handleDrivebyResolution} />

      
      <JobCompletionModal
        completionPanel={completionPanel}
        autoDismissMs={completionPanel?.nearbyCandidates?.length > 0 ? 0 : COMPLETION_AUTO_DISMISS_MS}
        epoch={completionEpoch}
        onUserActivity={() => { if (completionPanel?.visitId) armCompletionTimer(completionPanel.visitId); }}
        onDismissNeighbors={() => { if (completionPanel?.visitId) armCompletionTimer(completionPanel.visitId, { force: true }); }}
        onAddCompanionsToRoute={handleAddCompanionsToRoute}
        panelNote={panelNote}
        setPanelNote={setPanelNote}
        panelNoteActiveRef={panelNoteActiveRef}
        completionTimerRef={completionTimerRef}
        setCompletionPanel={setCompletionPanel}
        setTimeSplit={setTimeSplit}
        setIsEditJobOpen={setIsEditJobOpen}
        setActiveEpaJob={setActiveEpaJob}
        onQuickLogProducts={(cp) => setQuickLogJob({
          visitId: cp.visitId,
          customer: cp.primaryCustomer,
          exitTime: cp.exitTime,
          durationSecs: cp.durationSecs
        })}
        handleSaveCompletion={handleSaveCompletion}
        onSelectionsChange={(conditions, appliedServices, leafCharge, forVisitId) => {
          panelConditionsRef.current = conditions;
          panelServicesRef.current = appliedServices;
          panelLeafChargeRef.current = { visitId: forVisitId, amount: leafCharge };
        }}
      />

      {isEditJobOpen && completionPanel && (
        <EditJobModal 
          completionPanel={completionPanel}
          onSave={handleSaveEditedJob}
          onClose={() => setIsEditJobOpen(false)}
        />
      )}

      {/* Top Panel: Current or Next Job Info */}
      <div style={{ position: 'absolute', top: '0.8rem', left: '0.8rem', right: '0.8rem', zIndex: 100 }}>
        {/* Day tank mix — set once in the morning, every completed fert visit
            auto-files its EPA log from it. Expires at midnight (local). */}
        {activeMode === 'fertilizer' && (
          <button
            onClick={() => setShowMixModal(true)}
            style={{
              width: '100%', marginBottom: '0.8rem', padding: '10px 14px', cursor: 'pointer',
              borderRadius: 'var(--radius-md)', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              border: todaysMix ? '1px solid rgba(16,185,129,0.5)' : '1px dashed var(--color-border)',
              background: todaysMix ? 'rgba(16,185,129,0.12)' : 'var(--color-bg-card)',
              color: todaysMix ? 'var(--color-primary)' : 'var(--color-text-muted)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
            }}
          >
            <span>🧪</span>
            {todaysMix ? (
              <span>
                Today's Mix: {todaysMix.products.map(p => p.productName).join(' + ')} — EPA logs auto-file
              </span>
            ) : (
              <span>No mix set — EPA logs are manual. Tap to set today's mix.</span>
            )}
          </button>
        )}
        {/* Forgotten sheets: fert stops completed today with no EPA record.
            Tapping opens the sheet for the oldest one; the count live-updates
            as each gets saved, so working through them is tap → save → next. */}
        {activeMode === 'fertilizer' && missingEpaToday.length > 0 && !activeEpaJob && (
          <button
            onClick={() => {
              const v = missingEpaToday[0];
              const cust = allCustomers.find(c => c.id === v.customerId);
              setActiveEpaJob({
                id: v.id,
                custName: cust?.name || 'Unknown customer',
                exitTime: v.exitTime,
                durationSecs: v.durationSecs,
                custLawnSize: cust?.lawnSize,
                phone: cust?.phone,
                address: cust?.address,
                complianceLog: v.complianceLog || null
              });
            }}
            style={{
              width: '100%', marginBottom: '0.8rem', padding: '10px 14px', cursor: 'pointer',
              borderRadius: 'var(--radius-md)', textAlign: 'left', fontSize: '0.85rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              border: '1px solid rgba(245,158,11,0.6)', background: '#fffbeb', color: '#b45309',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
            }}
          >
            <AlertTriangle size={16} />
            {missingEpaToday.length === 1
              ? '1 stop today is missing its EPA log — tap to fill it now'
              : `${missingEpaToday.length} stops today are missing EPA logs — tap to fill them`}
          </button>
        )}
        {/* GPS health. These used to be wired to a flag nothing ever set, so a
            dead location feed — and with it all auto-tracking — was silent. */}
        {gpsStatus === 'denied' && (
          <div style={{ background: '#ef4444', color: 'white', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center', padding: '10px', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(239,68,68,0.4)', marginBottom: '0.8rem' }}>
            <AlertTriangle size={18} /> Location is off for this app — jobs won't auto-track. Turn it on in the tablet's settings.
          </div>
        )}
        {gpsStatus === 'silent' && (activeRoute || activeGeofence) && (
          <div style={{ background: '#ef4444', color: 'white', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center', padding: '10px', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(239,68,68,0.4)', marginBottom: '0.8rem' }}>
            <AlertTriangle size={18} /> No GPS updates for 30+ seconds — auto-tracking is on hold until the signal returns.
          </div>
        )}
        {pausedAway && activeGeofence && (
          <div style={{ background: '#fffbeb', color: '#b45309', border: '1px solid rgba(245,158,11,0.6)', fontSize: '0.85rem', fontWeight: 700, textAlign: 'center', padding: '10px', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '0.8rem' }}>
            <Pause size={18} /> Still paused at {activeGeofence.name} — you've left the lawn. Tap Resume, or Done to log it.
          </div>
        )}
        {poorGps && gpsStatus === 'ok' && (
          <div style={{ background: '#ef4444', color: 'white', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center', padding: '10px', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(239,68,68,0.4)', marginBottom: '0.8rem' }}>
            <AlertTriangle size={18} /> Poor GPS Signal — Auto-routing paused
          </div>
        )}
        {activeGeofence ? (
          <LiveTimerPanel 
            activeGeofence={activeGeofence}
            timerState={timerState}
            liveDuration={liveDuration}
            weather={weather}
            liveNote={liveNote}
            setShowLiveNoteModal={setShowLiveNoteModal}
            setDialog={setDialog}
            togglePause={togglePause}
            handleManualDone={handleManualDone}
            allVisits={allVisits}
            globalPace={globalPace}
            isLeafJob={leafJobIds.includes(activeGeofence.id)}
            onToggleLeafJob={showLeafTools || leafJobIds.includes(activeGeofence.id) ? () => toggleLeafJob(activeGeofence.id) : undefined}
            onCancelJob={() => {
              activeGeofenceIdRef.current = null;
              setActiveGeofence(null);
              anchorGeofenceRef.current = null;
              resetJobTimer();
              clearActiveJob();
              lastExitRef.current = null;
              resumeVisitIdRef.current = null;
              setLiveNote('');
              // A product pick made for the discarded job must not file later.
              clearStopMix();
              // The truck is back to "driving" — the clock was paused on arrival.
              resumeDriveTimer();

              // Full engine reset, and no re-arrival at this stop until the
              // truck has left its zone (cancelling while still parked there
              // used to restart the job 8 seconds later).
              if (engineRef.current) engineRef.current.finishActiveJob();
            }}
          />
        ) : (
          activeRoute ? (() => {
            if (activeRoute.status === 'pending') {
              return (
                <div className="card animate-fade-in" style={{ padding: '1.3rem 1rem 1.1rem', borderRadius: '1.5rem', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                  <div style={{ textAlign: 'center', marginBottom: '1.1rem' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-primary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1.2px' }}>Pending route</div>
                    <strong style={{ fontSize: '1.5rem', display: 'block', color: 'var(--color-text-main)', marginTop: '0.3rem' }}>{activeRoute.name || 'Unnamed Route'}</strong>
                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>{activeRoute.expandedStops.length} stops</div>
                  </div>
                  <button style={{ width: '100%', height: '56px', border: 'none', borderRadius: '16px', background: 'var(--color-primary)', color: '#fff', fontSize: '1.1rem', fontWeight: 700, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={async () => {
                     await db.routes.update(activeRoute.id, { status: 'active' });

                     // Tie the driving timer explicitly to this Start Route action!
                     resetDriveTimer(true);
                  }}>
                    <Play fill="currentColor" size={20} /> Start route
                  </button>
                </div>
              );
            }

            if (nextStop) {
              const wcode = weather?.code ?? 0;
              let WIcon = CloudRain;
              if (wcode === 0) WIcon = Sun;
              else if (wcode <= 2) WIcon = CloudSun;
              else if (wcode === 3 || wcode <= 49) WIcon = Cloud;
              else if (wcode <= 55) WIcon = CloudDrizzle;
              else if (wcode <= 77 || wcode <= 86) WIcon = CloudSnow;
              else if (wcode <= 99) WIcon = CloudLightning;
              const driveColor = isDrivingPaused ? 'var(--color-warning)' : 'var(--color-primary)';
              return (
                <div className="card animate-fade-in" style={{ padding: '0.9rem 1rem 1rem', borderRadius: '1.5rem', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                  {pendingArrival && (
                    <div style={{ marginBottom: '0.7rem', padding: '0.5rem 0.8rem', borderRadius: 'var(--radius-sm)', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-primary)' }}>Arriving at {pendingArrival.name}…</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--color-primary)' }}>{pendingArrival.secondsLeft}s</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-primary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1.2px' }}>Next job</div>
                      <strong style={{ fontSize: '1.4rem', display: 'block', color: 'var(--color-text-main)', lineHeight: 1.1 }}>{nextStop.name}</strong>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{nextStop.address}</div>
                      {weather && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
                          <WIcon size={14} color="var(--color-primary)" />
                          <span>{weather.temp}°F · {weather.wind} mph</span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                      {isDrivingPaused && drivingDuration === 0 ? (
                        <button
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', fontWeight: 700, borderRadius: '12px', background: 'var(--color-primary)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); resetDriveTimer(true); }}
                        >
                          <Play size={12} fill="currentColor" /> START DRIVING
                        </button>
                      ) : (
                        <>
                          <button
                            aria-label={isDrivingPaused ? 'Resume driving' : 'Pause driving'}
                            style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--color-bg-main)', color: driveColor, border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                            onClick={(e) => { e.stopPropagation(); toggleDrivePause(); }}
                          >
                            {isDrivingPaused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
                          </button>
                          <div style={{ background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', padding: '0.25rem 0.7rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: driveColor }} />
                            <span style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'monospace', color: driveColor, fontVariantNumeric: 'tabular-nums' }}>
                              {formatLiveTimer(drivingDuration)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem' }}>
                    <button style={{ flex: 2, height: '54px', border: 'none', borderRadius: '16px', background: 'var(--color-primary)', color: '#fff', fontSize: '1rem', fontWeight: 700, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }} onClick={() => {
                      dismissedOpportunitiesRef.current.clear();
                      startJobManually(nextStop);
                    }}>
                      <Play fill="currentColor" size={18} /> Start job
                    </button>
                    <button style={{ flex: 1, height: '54px', borderRadius: '16px', background: 'var(--color-bg-main)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', fontSize: '0.9rem', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }} onClick={() => handleSkipStop(nextStop)}>
                      <SkipForward size={16} /> Skip
                    </button>
                  </div>

                  {/* Leaf job toggle — mark it before you start, from the truck */}
                  {(showLeafTools || leafJobIds.includes(nextStop.id)) && (() => {
                    const on = leafJobIds.includes(nextStop.id);
                    return (
                      <button
                        aria-pressed={on}
                        onClick={() => toggleLeafJob(nextStop.id)}
                        style={{ width: '100%', minHeight: '46px', marginTop: '0.6rem', padding: '0.5rem 0.8rem', borderRadius: '14px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem', border: on ? '2px solid #b45309' : '1px dashed var(--color-border)', background: on ? 'rgba(180,83,9,0.12)' : 'var(--color-bg-main)', color: on ? '#b45309' : 'var(--color-text-muted)' }}
                      >
                        {on ? '🍂 Leaf job — tap to undo' : '🍂 Picking up leaves here? Tap to mark as a leaf job'}
                      </button>
                    );
                  })()}

                  <div style={{ marginTop: '0.5rem' }}>
                    <CustomerDetailsDropdown customer={nextStop} allVisits={allVisits} globalPace={globalPace} darkTheme={true} isLeafJob={leafJobIds.includes(nextStop.id)} />
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
          center={currentPosition || NO_FIX_CENTER}
          zoom={currentPosition ? 16 : NO_FIX_ZOOM}
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
                      const completed = visits.filter(v => v.status === 'completed');
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
      
      <RouteListPanel 
        activeRoute={activeRoute}
        allVisits={allVisits}
        getStopStatus={getStopStatus}
        handleSkipStop={handleSkipStop}
        isRouteListOpen={isRouteListOpen}
        setIsRouteListOpen={setIsRouteListOpen}
        progressInfo={progressInfo}
        onAddUnplanned={() => setShowQuickAdd(true)}
        onStartJob={(stop) => {
          setIsRouteListOpen(false);
          startJobManually(stop);
        }}
        onForceEndRoute={handleForceEndRoute}
        jobActive={!!activeGeofence}
        leafJobIds={leafJobIds}
        onToggleLeafJob={showLeafTools ? toggleLeafJob : undefined}
      />

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
