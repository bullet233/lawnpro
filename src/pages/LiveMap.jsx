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
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { GeofenceEngine } from '../engine/GeofenceEngine';
import { GoogleMap, Marker, Polygon } from '@react-google-maps/api';
import { useMapStatus } from '../components/MapProvider';
import { CheckCircle, Navigation, MapPin, FastForward, CloudRain, ChevronUp, ChevronDown, SkipForward, Sun, CloudSun, Cloud, CloudDrizzle, CloudSnow, CloudLightning, X, Play, Pause, FileText, Map as MapIcon, ClipboardList, AlertTriangle } from 'lucide-react';
import { parseLawnSizeToSqFt } from '../utils/parseLawnSize';
import ComplianceLogModal from '../components/ComplianceLogModal';


import { useNavigate } from 'react-router-dom';
import DayReviewModal from '../components/DayReviewModal';
import AppDialog from '../components/AppDialog';
import TimeSplitModal from '../components/TimeSplitModal';
import EditJobModal from '../components/EditJobModal';
import QuickAddModal from '../components/QuickAddModal';
import { getSettings } from '../db/settings';
import { trackApiCall } from '../utils/apiTracker';

const mapContainerStyle = { width: '100%', height: 'calc(100vh - 6rem)', borderRadius: 'var(--radius-md)' };

// Haversine formula to calculate distance in meters
const getDistance = (lat1, lon1, lat2, lon2) => {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p) / 2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p)) / 2;
  return 12742 * Math.asin(Math.sqrt(a)) * 1000;
};

export default function LiveMap() {
  const navigate = useNavigate();

  const { position, positionRef, speed, heading, poorGps, accuracy } = useGeolocation();
  const { weather, weatherRef } = useWeatherTracker(positionRef);
  
  const { 
    isDrivingPaused, drivingDuration, togglePause: toggleDrivePause, 
    pauseTimer: pauseDriveTimer, resetTimer: resetDriveTimer, getFinalDriveTimeSecs,
    isDrivingPausedRef, accumulatedDriveTimeRef, lastDriveResumeTimeRef 
  } = useDriveTimer();

  const {
    timerState, liveDuration, startTimer, pauseTimer, resumeTimer, toggleTimer, resetTimer: resetJobTimer,
    getFinalDurationSecs, jobStartRef, accumulatedTimeRef, lastResumeTimeRef, timerStateRef
  } = useJobTimer();



  const currentPosition = position; // backwards compatibility alias
  const latestLocRef = positionRef; // backwards compatibility alias
        const [autoCenter, setAutoCenter] = useState(true);
  const autoCenterRef = useRef(true);
  const [mapTypeId, setMapTypeId] = useState('roadmap');
    const [activeEpaJob, setActiveEpaJob] = useState(null);
  const { isLoaded, loadError } = useMapStatus();
  
  const [activeGeofence, setActiveGeofence] = useState(null);
  const [drivebyPrompt, setDrivebyPrompt] = useState(null);
  const [isRouteListOpen, setIsRouteListOpen] = useState(false);
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
    const [gpsError, setGpsError] = useState(false);

  const mapRef = useRef(null);
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

  useEffect(() => { panelNoteRef.current = panelNote; }, [panelNote]);

  
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
    const visit = routeVisits.find(v => v.customerId === customerId && (v.status === 'completed' || v.status === 'skipped'));
    if (visit) return visit.status === 'skipped' ? 'skipped' : 'completed';
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

          // Find historical visits for this customer to calculate average time
          const histVisits = allVisits.filter(v => {
            if (v.customerId !== s.id || v.status !== 'completed' || !v.durationSecs) return false;
            const isHistMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => defaultServices.find(ds => ds.id === id)?.category === 'Mowing' || id === 's1');
            return isPlannedMow === isHistMow;
          });

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
  }, [activeRoute, routeVisits, activeGeofence?.id, allVisits, allCustomers, globalPace]);

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

  // 4. Job Timers & Driveby Detection
  
  // --- GEOFENCE TRACKING ENGINE ---
  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new GeofenceEngine({
      enterDebounceMs: 8000,
      exitDebounceMs: 15000,
      drivebyThresholdSecs: getSettings().drivebyThresholdSecs || 45,
      onEnter: (customer) => {
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        startTimer();
        capturedDriveTimeSecsRef.current = getFinalDriveTimeSecs();
        pauseDriveTimer();
        activeGeofenceIdRef.current = customer.id;
        setActiveGeofence(customer);
        setPendingArrival(null);
      },
      onPendingEnter: (customer, remainingSecs) => {
        if (!customer) {
          setPendingArrival(null);
        } else {
          setPendingArrival({ name: customer.name, secondsLeft: remainingSecs });
        }
      },
      onExit: (customer, durationSecs) => {
        // The engine calls this, but we can just use our existing handleExitGeofence
        handleExitGeofence();
      },
      onDriveBy: (customer, durationSecs) => {
        // In our current setup, handleExitGeofence handles driveby detection internally.
        // We just call it.
        handleExitGeofence();
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
        allCustomers: allCustomers || [],
        routeVisits: routeVisits || [],
        dismissedOpportunities: dismissedOpportunitiesRef.current,
        anchorGeofence: anchorGeofenceRef.current,
        isJobPaused: timerState === 'paused'
      });
    }
  }, [activeRoute, allCustomers, routeVisits, timerState]);

  // Feed position to engine
  useEffect(() => {
    if (!activeRoute || !position) return;
    engineRef.current.updateLocation({
      lat: position.lat,
      lng: position.lng,
      accuracy: accuracy,
      timestamp: Date.now()
    });
  }, [position, activeRoute, accuracy]);

  const handleExitGeofence = () => {
    // Use timerStateRef (not timerState) to avoid stale closure from watchPosition
    const finalDuration = Math.floor(
      accumulatedTimeRef.current + 
      (timerStateRef.current === 'running' && lastResumeTimeRef.current ? (Date.now() - lastResumeTimeRef.current) / 1000 : 0)
    );
    const entryTime = jobStartRef.current;
    const completedCustId = activeGeofenceIdRef.current;
    const completedCust = allCustomersRef.current.find(c => c.id === completedCustId);

    activeGeofenceIdRef.current = null;
    setActiveGeofence(null);
    anchorGeofenceRef.current = null;
    resetJobTimer();
    potentialEnterRef.current = null;
    potentialExitRef.current = null;
    
    const threshold = getSettings().drivebyThresholdSecs || 45;

    if (finalDuration < threshold && completedCust) {
      setDrivebyPrompt({ customer: completedCust, duration: finalDuration, entry: entryTime, driveTime: capturedDriveTimeSecsRef.current });
    } else if (completedCust) {
      logVisit(completedCust, finalDuration, entryTime, 'completed', liveNoteRef.current, capturedDriveTimeSecsRef.current);
      setLiveNote('');
    }
  };

  const handleSaveEpaLog = async (logData) => {
    if (!activeEpaJob) return;
    await db.visits.update(activeEpaJob.id, { complianceLog: logData });
    setActiveEpaJob(null);
  };

  const finishActiveRoute = async () => {
    if (!activeRoute) return;
    await db.routes.update(activeRoute.id, { status: 'completed' });
    resetDriveTimer(false);
    setShowDayReview(true);
  };

  const handleManualDone = () => {
    const finalDuration = Math.floor(
      accumulatedTimeRef.current + 
      (timerStateRef.current === 'running' && lastResumeTimeRef.current ? (Date.now() - lastResumeTimeRef.current) / 1000 : 0)
    );
    const entryTime = jobStartRef.current;
    const completedCust = activeGeofence;
    
    activeGeofenceIdRef.current = null;
    setActiveGeofence(null);
    anchorGeofenceRef.current = null;
    resetJobTimer();
    potentialEnterRef.current = null;
    potentialExitRef.current = null;
    
    if (engineRef.current) {
      engineRef.current.activeGeofenceId = null;
      engineRef.current.activeCustomer = null;
      engineRef.current.jobStartTime = null;
    }
    
    logVisit(completedCust, finalDuration, entryTime, 'completed', liveNote, capturedDriveTimeSecsRef.current);
    setLiveNote('');
  };

  const logVisit = async (customer, durationSecs, entryTime, status, note = '', overrideDriveTimeSecs = null) => {
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
    let driveTimeSecs = overrideDriveTimeSecs !== null ? overrideDriveTimeSecs : Math.floor(
      isDrivingPausedRef.current
        ? accumulatedDriveTimeRef.current
        : accumulatedDriveTimeRef.current + (Date.now() - lastDriveResumeTimeRef.current) / 1000
    );

    // Check if there are any stops left on the current route
    const hasMoreStops = route && route.normalizedStops ? route.normalizedStops.some(s => {
      const alreadyVisited = routeVisitsRef.current.some(v => v.customerId === s.customerId && (v.status === 'completed'));
      return !alreadyVisited && s.customerId !== customer.id;
    }) : false;

    // Reset drive timer
    resetDriveTimer(hasMoreStops);

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
      completionTimerRef.current = setTimeout(async () => {
        if (panelNoteActiveRef.current) {
          // Retry in 5 seconds if user is actively typing
          completionTimerRef.current = setTimeout(async () => {
            // Save note on final auto-dismiss so typed text is never lost
            const currentNote = (panelNoteRef.current || '').trim();
            if (currentNote && visitId) {
              await db.visits.update(visitId, { note: currentNote });
            }
            setCompletionPanel(null);
          }, 5000);
        } else {
          // Save note on auto-dismiss so typed text is never lost
          const currentNote = (panelNoteRef.current || '').trim();
          if (currentNote && visitId) {
            await db.visits.update(visitId, { note: currentNote });
          }
          setCompletionPanel(null);
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
    logVisit(drivebyPrompt.customer, drivebyPrompt.duration, drivebyPrompt.entry, status, '', drivebyPrompt.driveTime);
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

      
      <JobCompletionModal 
        completionPanel={completionPanel}
        panelNote={panelNote}
        setPanelNote={setPanelNote}
        panelNoteActiveRef={panelNoteActiveRef}
        completionTimerRef={completionTimerRef}
        setCompletionPanel={setCompletionPanel}
        setTimeSplit={setTimeSplit}
        setIsEditJobOpen={setIsEditJobOpen}
        setActiveEpaJob={setActiveEpaJob}
        handleSaveNote={handleSaveNote}
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
        {gpsError && (
          <div style={{ background: '#ef4444', color: 'white', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center', padding: '10px', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(239,68,68,0.4)', marginBottom: '0.8rem' }}>
            <AlertTriangle size={18} /> Location unavailable — check permissions in your phone settings.
          </div>
        )}
        {poorGps && !gpsError && (
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
            onCancelJob={() => {
              activeGeofenceIdRef.current = null;
              setActiveGeofence(null);
              anchorGeofenceRef.current = null;
              resetJobTimer();
              setLiveNote('');
              
              if (engineRef.current) {
                engineRef.current.activeGeofenceId = null;
                engineRef.current.activeCustomer = null;
                engineRef.current.jobStartTime = null;
              }
            }}
          />
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
                     resetDriveTimer(true);
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
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <div style={{ 
                        background: isDrivingPaused ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', 
                        border: `1px solid ${isDrivingPaused ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`,
                        borderRadius: 'var(--radius-full)', 
                        padding: '0.2rem 0.6rem', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '0.4rem',
                        marginBottom: '0.4rem'
                      }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isDrivingPaused ? 'var(--color-warning)' : 'var(--color-primary)' }} />
                        <span style={{ fontSize: '1.1rem', fontWeight: 800, fontFamily: 'monospace', color: isDrivingPaused ? 'var(--color-warning)' : 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}>
                          {formatLiveTimer(drivingDuration)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'flex-end', marginTop: '0.2rem' }}>
                        {isDrivingPaused && drivingDuration === 0 ? (
                          <button 
                            className="btn btn-primary"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, borderRadius: '4px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              resetDriveTimer(true);
                            }}
                          >
                            <Play size={12} fill="currentColor" style={{ marginRight: '4px' }}/> START DRIVING
                          </button>
                        ) : (
                          <button 
                            className="btn"
                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', borderRadius: 'var(--radius-md)', background: isDrivingPaused ? 'var(--color-primary)' : 'var(--color-bg-card)', color: isDrivingPaused ? '#fff' : 'var(--color-text-main)', border: `1px solid ${isDrivingPaused ? 'var(--color-primary)' : 'var(--color-border)'}`, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDrivePause();
                            }}
                          >
                            {isDrivingPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                            {isDrivingPaused ? 'RESUME' : 'PAUSE'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.6rem' }}>
                    <button className="btn btn-primary" style={{ flex: 2, padding: '0.6rem', fontSize: '0.95rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem' }} onClick={() => {
                      anchorGeofenceRef.current = currentPosition ? { lat: currentPosition.lat, lng: currentPosition.lng } : 'no-gps';
                      dismissedOpportunitiesRef.current.clear();
                      if (engineRef.current) {
                        engineRef.current.manualStartJob(nextStop);
                      }
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
          anchorGeofenceRef.current = position ? { lat: position.lat, lng: position.lng } : 'no-gps';
          setIsRouteListOpen(false);
          
          if (engineRef.current) {
            engineRef.current.manualStartJob(stop);
          }
        }}
        onForceEndRoute={() => {
          setDialog({
            type: 'warning',
            title: 'End Active Route?',
            message: 'Are you sure you want to forcibly end this route? Incomplete jobs will be skipped.',
            onConfirm: () => {
              finishActiveRoute();
              setDialog(null);
            },
            onCancel: () => setDialog(null)
          });
        }}
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
