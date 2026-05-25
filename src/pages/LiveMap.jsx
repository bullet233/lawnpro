import { useState, useEffect, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { GoogleMap, Marker, Polygon } from '@react-google-maps/api';
import { CheckCircle, Navigation, MapPin, FastForward, CloudRain, ChevronUp, ChevronDown, SkipForward, Sun, CloudSun, Cloud, CloudDrizzle, CloudSnow, CloudLightning } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DayReviewModal from '../components/DayReviewModal';
import AppDialog from '../components/AppDialog';
import TimeSplitModal from '../components/TimeSplitModal';
import QuickAddModal from '../components/QuickAddModal';

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
  const [weather, setWeather] = useState(null);
  
  const [activeGeofence, setActiveGeofence] = useState(null);
  const [drivebyPrompt, setDrivebyPrompt] = useState(null);
  const [isRouteListOpen, setIsRouteListOpen] = useState(false);
  const [liveDuration, setLiveDuration] = useState(0);
  const [completionPanel, setCompletionPanel] = useState(null);
  const [panelNote, setPanelNote] = useState('');
  const completionTimerRef = useRef(null);
  const [showDayReview, setShowDayReview] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  // { primaryCustomer, primaryVisitId, durationSecs, nearbyCustomer }
  const [timeSplit, setTimeSplit] = useState(null);

  const mapRef = useRef(null);
  const jobStartRef = useRef(null);
  const activeGeofenceIdRef = useRef(null);
  const weatherTimerRef    = useRef(null);
  const panelTouchRef      = useRef(null); // for swipe-to-dismiss

  // Load all data
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const activeRoute = useLiveQuery(async () => {
    const routes = await db.routes.where({ status: 'active' }).toArray();
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
          }
          totalSecondsLeft += avgDuration + 300; // avg time + 5 min drive time
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
  }, [activeRoute, routeVisits, activeGeofenceIdRef.current, allVisits]);

  // 1. Dynamic Map Navigation & Snap Back
  const onMapLoad = (map) => {
    mapRef.current = map;
    map.addListener('dragstart', () => {
      setAutoCenter(false);
      if (snapBackRef.current) clearTimeout(snapBackRef.current);
      snapBackRef.current = setTimeout(() => {
        setAutoCenter(true);
      }, 5000);
    });
  };

  // 2. Real-Time Weather Logging
  const fetchWeather = async (lat, lng) => {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`);
      const data = await res.json();
      if (data.current) {
        setWeather({
          temp: Math.round(data.current.temperature_2m),
          wind: Math.round(data.current.wind_speed_10m),
          code: data.current.weather_code
        });
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
        setCurrentPosition(loc);
        
        const currentSpeedMph = (pos.coords.speed || 0) * 2.237;
        setSpeed(currentSpeedMph);
        
        if (pos.coords.heading && !isNaN(pos.coords.heading)) {
          setHeading(pos.coords.heading);
        }

        // Fetch weather on first lock, then every 10 mins
        if (!weatherTimerRef.current) {
          fetchWeather(loc.lat, loc.lng);
          weatherTimerRef.current = setInterval(() => fetchWeather(loc.lat, loc.lng), 10 * 60 * 1000);
        }


        // Auto Center and Zoom
        if (autoCenter && mapRef.current) {
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

        // Geofence Checking (For Active Route)
        if (activeRoute && window.google?.maps?.geometry?.poly) {
          let insideCustomer = null;
          for (const customer of activeRoute.expandedStops) {
            if (customer.geofence && customer.geofence.length > 0) {
              const poly = new window.google.maps.Polygon({ paths: customer.geofence });
              const pt = new window.google.maps.LatLng(loc.lat, loc.lng);
              if (window.google.maps.geometry.poly.containsLocation(pt, poly)) {
                insideCustomer = customer;
                break;
              }
            }
          }
          
          if (insideCustomer) {
            if (activeGeofenceIdRef.current !== insideCustomer.id) {
              // Just entered a new geofence
              jobStartRef.current = Date.now();
              activeGeofenceIdRef.current = insideCustomer.id;
              setActiveGeofence(insideCustomer);
            }
          } else {
            if (activeGeofenceIdRef.current) {
              // Just exited the geofence
              handleExitGeofence();
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
  }, [activeRoute, autoCenter, allCustomers]);

  // 4. Job Timers & Driveby Detection
  const handleExitGeofence = () => {
    const durationSecs = Math.floor((Date.now() - jobStartRef.current) / 1000);
    const completedCustId = activeGeofenceIdRef.current;
    const completedCust = activeRoute?.expandedStops.find(c => c.id === completedCustId);

    activeGeofenceIdRef.current = null;
    setActiveGeofence(null);

    if (durationSecs < 45 && completedCust) {
      setDrivebyPrompt({ customer: completedCust, duration: durationSecs, entry: jobStartRef.current });
    } else if (completedCust) {
      logVisit(completedCust, durationSecs, jobStartRef.current, 'completed');
    }
  };

  const handleManualDone = () => {
    const durationSecs = Math.floor((Date.now() - jobStartRef.current) / 1000);
    const completedCust = activeGeofence;
    
    activeGeofenceIdRef.current = null;
    setActiveGeofence(null);
    
    logVisit(completedCust, durationSecs, jobStartRef.current, 'completed');
  };

  const logVisit = async (customer, durationSecs, entryTime, status) => {
    let priceEarned = 0;
    let appliedServices = [];

    if (status !== 'skipped') {
      // Try to use the planned services for this stop from the route
      const routeStop = activeRoute?.normalizedStops?.find(s => s.customerId === customer.id);
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

    const visitId = await db.visits.add({
      routeId: activeRoute ? activeRoute.id : null,
      customerId: customer.id,
      status: status,
      durationSecs: durationSecs,
      entryTime: entryTime,
      exitTime: Date.now(),
      weather: weather,
      priceEarned: priceEarned,
      appliedServices: appliedServices,
      note: ''
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

      setPanelNote('');
      setCompletionPanel({ custName: customer.name, durationSecs, priceEarned, weather, visitId, nearbyCandidate, primaryCustomer: customer, exitTime: Date.now() });
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
      completionTimerRef.current = setTimeout(() => setCompletionPanel(null), 12000);
    }

    if (activeRoute && activeRoute.normalizedStops) {
      const stopIds = activeRoute.normalizedStops.map(s => s.customerId);
      if (stopIds.includes(customer.id)) {
        const completedCustIds = new Set(routeVisits.map(v => v.customerId));
        completedCustIds.add(customer.id);
        const allCompleted = stopIds.every(id => completedCustIds.has(id));
        if (allCompleted) {
          await db.routes.update(activeRoute.id, { status: 'completed' });
          navigate('/'); // Redirect to Home Dashboard for the End of Day summary
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

  const handleDrivebyResolution = (status) => {
    logVisit(drivebyPrompt.customer, drivebyPrompt.duration, drivebyPrompt.entry, status);
    setDrivebyPrompt(null);
  };

  const handleSkipStop = (customer) => {
    setDialog({
      type: 'skip',
      title: `Skip ${customer.name}?`,
      message: 'This stop will be logged as skipped in your history.',
      confirmLabel: 'Yes, Skip',
      onConfirm: () => logVisit(customer, 0, Date.now(), 'skipped')
    });
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

  // Live Timer Effect
  useEffect(() => {
    let interval;
    if (activeGeofence && jobStartRef.current) {
      interval = setInterval(() => {
        setLiveDuration(Math.floor((Date.now() - jobStartRef.current) / 1000));
      }, 1000);
    } else {
      setLiveDuration(0);
    }
    return () => clearInterval(interval);
  }, [activeGeofence]);

  const formatLiveTimer = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="animate-fade-in" style={{ position: 'relative' }}>
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      {showDayReview && <DayReviewModal onClose={() => setShowDayReview(false)} />}
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

          <div style={{ display: 'flex', gap: '0.8rem' }}>
            <button className="btn btn-primary" style={{ flex: 1, minHeight: '52px', fontSize: '1rem' }} onClick={handleSaveNote}>
              {panelNote.trim() ? 'Save Note & Close' : 'Done'}
            </button>
            <button className="btn btn-secondary" style={{ minHeight: '52px', padding: '0 1.2rem', fontSize: '1rem' }} onClick={() => { if (completionTimerRef.current) clearTimeout(completionTimerRef.current); setCompletionPanel(null); }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Top Panel: Current or Next Job Info */}
      <div className="glass-card" style={{ position: 'absolute', top: '1rem', left: '1rem', right: '1rem', zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...(activeGeofence ? { background: 'rgba(16, 185, 129, 0.9)', color: 'white' } : {}) }}>
        {activeGeofence ? (
          <>
            <div>
              <strong style={{ fontSize: '1.1rem' }}>Active: {activeGeofence.name}</strong>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, fontFamily: 'monospace', letterSpacing: '1px', marginTop: '2px' }}>{formatLiveTimer(liveDuration)}</div>
            </div>
            <button className="btn" style={{ background: 'white', color: 'var(--color-primary)' }} onClick={handleManualDone}>
              <CheckCircle size={18} /> Done
            </button>
          </>
        ) : (
          activeRoute ? (() => {
            const nextStop = activeRoute.expandedStops.find(s => getStopStatus(s.id) === 'pending');
            if (nextStop) {
              return (
                <>
                  <div>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--color-primary)', fontWeight: 700 }}>Next Stop</div>
                    <strong style={{ fontSize: '1.1rem' }}>{nextStop.name}</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{nextStop.address}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button className="btn btn-secondary" style={{ padding: '0.5rem 0.8rem' }} onClick={() => handleSkipStop(nextStop)} title="Skip this stop">
                      <SkipForward size={16} />
                    </button>
                    <button className="btn btn-primary" style={{ padding: '0.5rem 1rem' }} onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(nextStop.address)}`, '_blank')}>
                      <Navigation size={18} /> Nav
                    </button>
                  </div>
                </>
              );
            } else {
              return (
                <div style={{ width: '100%', textAlign: 'center' }}>
                   <strong>Route Complete! 🎉</strong>
                </div>
              );
            }
          })() : (
            <div style={{ color: 'var(--color-text-muted)', width: '100%', textAlign: 'center' }}>No Active Route. Select one from Routes tab.</div>
          )
        )}
      </div>

      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={currentPosition || { lat: 39.8283, lng: -98.5795 }}
        zoom={currentPosition ? 16 : 4}
        onLoad={onMapLoad}
        options={{ disableDefaultUI: true }}
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
      
      {/* Bottom Panel */}
      <div className="glass-card" style={{ position: 'absolute', bottom: '1rem', left: '1rem', right: '1rem', zIndex: 10, padding: 0, overflow: 'hidden' }}>
        
        {/* Collapsible Route List */}
        {isRouteListOpen && activeRoute && (
          <div style={{ maxHeight: '35vh', overflowY: 'auto', padding: '1rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-main)' }}>
            <h4 style={{ margin: '0 0 1rem 0', color: 'var(--color-text-main)' }}>Route List</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {activeRoute.expandedStops.map((stop, i) => {
                const status = getStopStatus(stop.id);
                return (
                  <div key={stop.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.5rem', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', opacity: status === 'completed' ? 0.6 : 1 }}>
                    <div style={{ width: '24px', display: 'flex', justifyContent: 'center' }}>
                      {status === 'completed' ? (
                        <CheckCircle size={18} color="var(--color-primary)" />
                      ) : status === 'skipped' ? (
                        <SkipForward size={16} color="var(--color-text-muted)" />
                      ) : (
                        <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid var(--color-text-muted)' }} />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: status === 'completed' || status === 'skipped' ? 'var(--color-text-muted)' : 'var(--color-text-main)', textDecoration: status === 'completed' || status === 'skipped' ? 'line-through' : 'none' }}>
                        {i + 1}. {stop.name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{stop.address}</div>
                    </div>
                    {status === 'pending' && (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem', minHeight: '44px', whiteSpace: 'nowrap' }}
                        onClick={() => handleSkipStop(stop)}
                      >
                        <SkipForward size={14} /> Skip
                      </button>
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

        {/* Progress Bar & Header */}
        {progressInfo && (
          <div style={{ padding: '1rem', cursor: 'pointer', background: isRouteListOpen ? 'var(--color-bg-card)' : 'transparent' }} onClick={() => setIsRouteListOpen(!isRouteListOpen)}>
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
      </div>

      {/* Floating Weather Widget */}
      {weather && (() => {
        // WMO Weather Interpretation Codes → icon + label
        const code = weather.code ?? 0;
        let Icon  = CloudRain;  // fallback
        let label = '';

        if (code === 0)                       { Icon = Sun;        label = 'Sunny';       }
        else if (code <= 2)                   { Icon = CloudSun;   label = 'P. Cloudy';   }
        else if (code === 3)                  { Icon = Cloud;      label = 'Overcast';    }
        else if (code <= 49)                  { Icon = Cloud;      label = 'Foggy';       }
        else if (code <= 55)                  { Icon = CloudDrizzle; label = 'Drizzle';   }
        else if (code <= 67)                  { Icon = CloudRain;  label = 'Rain';        }
        else if (code <= 77)                  { Icon = CloudSnow;  label = 'Snow';        }
        else if (code <= 82)                  { Icon = CloudRain;  label = 'Showers';     }
        else if (code <= 86)                  { Icon = CloudSnow;  label = 'Snow Showers';}
        else if (code <= 99)                  { Icon = CloudLightning; label = 'T-Storm'; }

        return (
          <div className="glass-card" style={{ position: 'absolute', top: '11rem', left: '1rem', zIndex: 10, padding: '0.5rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: 'var(--radius-full)' }}>
            <Icon size={16} color="var(--color-primary)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{weather.temp}°F</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: '0.2rem' }}>{label} · {weather.wind} mph</span>
          </div>
        );
      })()}

      {/* Recenter Button if autoCenter is disabled */}
      {!autoCenter && (
        <button 
          className="btn-icon" 
          onClick={() => setAutoCenter(true)}
          style={{ position: 'absolute', top: '5rem', right: '1rem', zIndex: 10, background: 'var(--color-bg-card)', boxShadow: 'var(--shadow-md)', border: 'none', cursor: 'pointer' }}>
          <Navigation size={24} color="var(--color-primary)" />
        </button>
      )}

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
