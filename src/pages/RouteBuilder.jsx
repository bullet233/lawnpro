import { useState, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { GoogleMap, Polyline, Marker } from '@react-google-maps/api';
import { useMapStatus } from '../components/MapProvider';
import { Plus, Save, Trash2, ChevronDown, ChevronUp, BookMarked, FolderOpen, GripVertical, Shuffle, Map as MapIcon, Calendar, Route as RouteIcon } from 'lucide-react';
import AppDialog from '../components/AppDialog';
import { trackApiCall } from '../utils/apiTracker';
import WeeklyScheduler from '../components/WeeklyScheduler';
import { calculateTieredMatrix, parseLawnSizeToSqFt } from '../utils/matrix';
import { getSettings } from '../db/settings';
import { useServiceMode } from '../components/ServiceProvider';

const mapContainerStyle = { width: '100%', height: '300px', borderRadius: 'var(--radius-md)', marginTop: '1rem' };

export default function RouteBuilder() {
  const customers   = useLiveQuery(() => db.customers.toArray(), []);
  const templates   = useLiveQuery(() => db.routes.where({ isTemplate: 1 }).toArray(), []);
  const allVisits   = useLiveQuery(() => db.visits.toArray(), []);
  const settings    = getSettings();

  const tieredMatrixData = useMemo(() => calculateTieredMatrix(allVisits, customers), [allVisits, customers]);

  const [activeTab,     setActiveTab]     = useState('build');
  const { activeMode } = useServiceMode();

  const [selectedStops, setSelectedStops] = useState([]);
  const [showMap,       setShowMap]       = useState(false);
  const [routeName,     setRouteName]     = useState('');
  const [dialog,        setDialog]        = useState(null);
  const [dragIndex,     setDragIndex]     = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const touchDragIndex  = useRef(null);
  const stopItemRefs    = useRef([]);
  const { isLoaded, loadError } = useMapStatus();

  const routePath = useMemo(() => {
    if (selectedStops.length < 2) return [];
    return selectedStops.map(stop => {
      const geo = stop.customer.geofence;
      if (geo && geo.length > 0) {
        return { 
          lat: geo.reduce((s, p) => s + p.lat, 0) / geo.length, 
          lng: geo.reduce((s, p) => s + p.lng, 0) / geo.length 
        };
      }
      return null;
    }).filter(Boolean);
  }, [selectedStops]);

  const availableCustomers = useMemo(() => {
    if (!customers) return [];
    return customers.filter(c => !selectedStops.find(s => s.customer.id === c.id));
  }, [customers, selectedStops]);

  // ── Stop management ──────────────────────────────────────────────────────────
  const addStop = (customer) => {
    let defaultIds = [];
    if (customer.services) {
      if (activeMode === 'fertilizer') {
        const fertService = customer.services.find(s => s.active && (s.id === 's3' || (s.name && s.name.toLowerCase().includes('fertil'))));
        if (fertService) defaultIds = [fertService.id];
      } else if (activeMode === 'mowing') {
        const mowService = customer.services.find(s => s.active && (s.id === 's1' || (s.name && s.name.toLowerCase().includes('mow'))));
        if (mowService) defaultIds = [mowService.id];
      }
      
      if (defaultIds.length === 0) {
        defaultIds = customer.services.filter(s => s.active).slice(0, 1).map(s => s.id);
      }
    }
    setSelectedStops(prev => [...prev, { customer, plannedServiceIds: defaultIds, expanded: false }]);
  };

  const removeStop = (index) => setSelectedStops(prev => prev.filter((_, i) => i !== index));

  const clearDriveTimes = (stops) => stops.map(s => ({ ...s, plannedDriveTimeSecs: null, plannedDriveDistanceMeters: null }));

  // ── Drag to reorder (desktop) ─────────────────────────────────────────────
  const handleDragStart = (e, index) => { setDragIndex(index); e.dataTransfer.effectAllowed = 'move'; };
  const handleDragOver  = (e, index) => { e.preventDefault(); setDragOverIndex(index); };
  const handleDrop      = (e, index) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) { setDragIndex(null); setDragOverIndex(null); return; }
    setSelectedStops(prev => {
      const next = [...prev];
      const [removed] = next.splice(dragIndex, 1);
      next.splice(index, 0, removed);
      return clearDriveTimes(next);
    });
    setDragIndex(null); setDragOverIndex(null);
  };
  const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null); };

  // ── Drag to reorder (touch / mobile) ─────────────────────────────────────
  const handleTouchStart = (e, index) => { touchDragIndex.current = index; };
  const handleTouchMove  = (e) => {
    if (touchDragIndex.current === null) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    const overIndex = stopItemRefs.current.findIndex(ref => {
      if (!ref) return false;
      const r = ref.getBoundingClientRect();
      return y >= r.top && y <= r.bottom;
    });
    const from = touchDragIndex.current;
    const to = overIndex;
    if (to !== -1 && from !== to) {
      setSelectedStops(prev => {
        const next = [...prev];
        const [removed] = next.splice(from, 1);
        next.splice(to, 0, removed);
        return clearDriveTimes(next);
      });
      touchDragIndex.current = to;
      setDragOverIndex(to);
    }
  };
  const handleTouchEnd = () => { touchDragIndex.current = null; setDragOverIndex(null); };

  // ── Optimize route order (Google Maps Directions API) ───────────────────────────────
  const handleOptimizeRoute = async () => {
    if (selectedStops.length < 2) return;
    if (selectedStops.length > 25) {
      setDialog({ type: 'danger', title: 'Too Many Stops', message: 'Google Maps limits optimization to 25 stops. Split into two routes or remove some stops.' });
      return;
    }
    const getCenter = (stop) => {
      const geo = stop.customer.geofence;
      if (!geo || geo.length === 0) return null;
      return { lat: geo.reduce((s,p) => s+p.lat, 0)/geo.length, lng: geo.reduce((s,p) => s+p.lng, 0)/geo.length };
    };
    if (selectedStops.some(s => !getCenter(s))) {
      setDialog({ type: 'info', title: 'Cannot Optimize', message: 'Some stops are missing geofence data. Set a geofence on each customer to enable route optimization.' });
      return;
    }
    
    if (!isLoaded || loadError || !window.google || !window.google.maps) {
       setDialog({ type: 'danger', title: 'Offline Mode', message: 'You cannot optimize routes without an internet connection to Google Maps.' });
       return;
    }

    setDialog({ type: 'info', title: 'Optimizing...', message: 'Asking Google Maps for the fastest driving route. Please wait...' });

    let origin = getCenter(selectedStops[0]);
    let destination = getCenter(selectedStops[selectedStops.length - 1]);
    let waypoints = selectedStops.slice(1, selectedStops.length - 1).map(stop => ({
      location: getCenter(stop),
      stopover: true
    }));

    if (settings.businessAddress) {
      try {
        const geocoder = new window.google.maps.Geocoder();
        const results = await new Promise((resolve, reject) => {
          geocoder.geocode({ address: settings.businessAddress }, (res, status) => {
            if (status === 'OK') resolve(res);
            else reject(status);
          });
        });
        const loc = results[0].geometry.location;
        origin = { lat: loc.lat(), lng: loc.lng() };
        destination = { lat: loc.lat(), lng: loc.lng() };
        waypoints = selectedStops.map(stop => ({
          location: getCenter(stop),
          stopover: true
        }));
      } catch (err) {
        console.warn('Failed to geocode business address:', err);
      }
    }

    const directionsService = new window.google.maps.DirectionsService();
    let isResolved = false;
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        setDialog({ type: 'danger', title: 'Optimization Timeout', message: 'Google Maps took too long to respond. Please check your network and try again.' });
      }
    }, 10000);

    directionsService.route({
      origin,
      destination,
      waypoints,
      optimizeWaypoints: true,
      travelMode: window.google.maps.TravelMode.DRIVING
    }, (response, status) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeout);

      if (status === 'OK') {
        const route = response.routes[0];
        const optimizedOrder = route.waypoint_order;
        
        let newStops = [];
        if (settings.businessAddress) {
           optimizedOrder.forEach(idx => {
             newStops.push({ ...selectedStops[idx] });
           });
           for (let i = 0; i < route.legs.length - 1; i++) {
             if (newStops[i]) {
               newStops[i].plannedDriveTimeSecs = route.legs[i].duration.value;
               newStops[i].plannedDriveDistanceMeters = route.legs[i].distance.value;
             }
           }
        } else {
           newStops = [{ ...selectedStops[0] }]; 
           optimizedOrder.forEach(idx => {
             newStops.push({ ...selectedStops[idx + 1] });
           });
           newStops.push({ ...selectedStops[selectedStops.length - 1] }); 
           
           newStops[0].plannedDriveTimeSecs = 0;
           newStops[0].plannedDriveDistanceMeters = 0;
           for (let i = 0; i < route.legs.length; i++) {
              if (newStops[i + 1]) {
                newStops[i + 1].plannedDriveTimeSecs = route.legs[i].duration.value;
                newStops[i + 1].plannedDriveDistanceMeters = route.legs[i].distance.value;
              }
           }
        }
        
        setSelectedStops(newStops);
        
        const totalDriveSecs = route.legs.reduce((acc, leg) => acc + leg.duration.value, 0);
        const totalDriveMeters = route.legs.reduce((acc, leg) => acc + leg.distance.value, 0);
        const totalMins = Math.round(totalDriveSecs / 60);
        const totalMiles = (totalDriveMeters * 0.000621371).toFixed(1);
        
        setDialog({ type: 'success', title: 'Route Optimized!', message: `Google Maps optimized ${newStops.length} stops. Estimated driving: ${totalMins} minutes (${totalMiles} miles).` });
        
      } else {
        setDialog({ type: 'danger', title: 'Optimization Failed', message: `Google Maps could not optimize this route. Error: ${status}` });
      }
    });
  };

  const toggleExpanded = (index) =>
    setSelectedStops(prev => prev.map((s, i) => i === index ? { ...s, expanded: !s.expanded } : s));

  const toggleService = (stopIndex, serviceId) => {
    setSelectedStops(prev => prev.map((s, i) => {
      if (i !== stopIndex) return s;
      const ids = s.plannedServiceIds.includes(serviceId)
        ? s.plannedServiceIds.filter(id => id !== serviceId)
        : [...s.plannedServiceIds, serviceId];
      return { ...s, plannedServiceIds: ids };
    }));
  };

  const performSaveRoute = async () => {
    // Retire only THIS division's open route. The Live page tracks one route
    // per division, so a mowing route and a fertilizer route must coexist —
    // completing across divisions here is what silently erased the other
    // mode's route whenever a new one was saved. Legacy routes with no
    // division stamp are retired too (they'd otherwise linger invisibly).
    const existingActive = (await db.routes.where('status').anyOf('active', 'pending').toArray())
      .filter(r => !r.division || r.division === activeMode);
    for (const r of existingActive) {
      await db.routes.update(r.id, { status: 'completed' });
    }
    const totalMeters = selectedStops.reduce((sum, s) => sum + (s.plannedDriveDistanceMeters || 0), 0);
    const plannedDistanceMiles = totalMeters > 0 ? parseFloat((totalMeters * 0.000621371).toFixed(1)) : null;

    const autoName = routeName.trim() || `${new Date().toLocaleDateString('en-US', { weekday: 'long' })} Route`;
    await db.routes.add({
      name: autoName,
      date: new Date().toISOString(),
      status: 'pending',
      isTemplate: 0,
      division: activeMode,
      plannedDistanceMiles,
      stops: selectedStops.map(s => ({
        customerId: s.customer.id,
        plannedServiceIds: s.plannedServiceIds,
        plannedDriveTimeSecs: s.plannedDriveTimeSecs || null,
        plannedDriveDistanceMeters: s.plannedDriveDistanceMeters || null
      }))
    });
    setDialog({ type: 'success', title: 'Route Saved!', message: `${selectedStops.length} stop${selectedStops.length > 1 ? 's' : ''} saved to your active route.` });
    setSelectedStops([]);
    setRouteName('');
    setShowMap(false);
  };

  const handleSaveRoute = async () => {
    if (selectedStops.length === 0) return;
    // Warn only about the route this save will actually replace — the one in
    // the current division. The other mode's route is left untouched.
    const existingActive = (await db.routes.where('status').anyOf('active', 'pending').toArray())
      .filter(r => !r.division || r.division === activeMode);
    let totalPendingStops = 0;
    
    for (const r of existingActive) {
      if (r.stops) {
        const visits = await db.visits.where({ routeId: r.id }).toArray();
        const completedCustIds = new Set(visits.filter(v => v.status === 'completed' || v.status === 'skipped').map(v => v.customerId));
        const pendingCount = r.stops.filter(s => !completedCustIds.has(s.customerId)).length;
        totalPendingStops += pendingCount;
      }
    }
    
    if (totalPendingStops > 0) {
      setDialog({
        type: 'warning',
        title: 'Replace Active Route?',
        message: `You have an in-progress route with ${totalPendingStops} unfinished stop${totalPendingStops > 1 ? 's' : ''}. Saving this route will mark the current one as completed. Continue?`,
        onConfirm: () => {
          setDialog(null);
          performSaveRoute();
        },
        onCancel: () => setDialog(null)
      });
    } else {
      performSaveRoute();
    }
  };

  const handleSaveTemplate = async () => {
    if (selectedStops.length === 0) return;
    const name = routeName.trim() || `Template ${new Date().toLocaleDateString()}`;
    await db.routes.add({
      name,
      date: new Date().toISOString(),
      isTemplate: 1,
      division: activeMode,
      stops: selectedStops.map(s => ({
        customerId: s.customer.id,
        plannedServiceIds: s.plannedServiceIds
      }))
    });
    setDialog({ type: 'success', title: 'Template Saved!', message: `"${name}" saved. Load it any time to pre-fill this route.` });
  };

  const handleLoadTemplate = async (template) => {
    if (!customers) return;
    const stops = [];
    for (const stop of template.stops) {
      const custId = typeof stop === 'object' ? stop.customerId : stop;
      const plannedIds = typeof stop === 'object' ? (stop.plannedServiceIds || []) : [];
      const customer = customers.find(c => c.id === custId);
      if (customer) stops.push({ customer, plannedServiceIds: plannedIds, expanded: false });
    }
    setSelectedStops(stops);
    setRouteName(template.name || '');
    setShowMap(false);
    setDialog({ type: 'info', title: 'Template Loaded', message: `"${template.name}" — ${stops.length} stop${stops.length !== 1 ? 's' : ''} ready. Edit if needed, then save your active route.` });
  };

  const handleDeleteTemplate = (template) => {
    setDialog({
      type: 'danger',
      title: `Delete "${template.name}"?`,
      message: 'This template will be permanently removed.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        await db.routes.delete(template.id);
        setDialog(null);
      }
    });
  };

  const handleLoadDayRoute = (day) => {
    if (!customers) return;
    const now = Date.now();
    const dayCusts = customers.filter(c => 
      c.status !== 'inactive' && 
      c.preferredDay === day && 
      (!c.snoozedUntil || c.snoozedUntil < now)
    );
    const stops = dayCusts.map(customer => {
      const defaultIds = customer.services
        ? customer.services.filter(s => s.active).slice(0, 1).map(s => s.id)
        : [];
      return { customer, plannedServiceIds: defaultIds, expanded: false };
    });
    setSelectedStops(stops);
    setRouteName(`${day} Route`);
    setActiveTab('build');
    setDialog({ type: 'info', title: `${day} Route Loaded`, message: `${stops.length} stop${stops.length !== 1 ? 's' : ''} added. (Snoozed customers were ignored).` });
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '2rem' }}>
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      <h1 className="page-title">Route Builder</h1>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <button 
          className={`btn ${activeTab === 'build' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('build')}
          style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '0.5rem' }}
        >
          <RouteIcon size={18} /> Daily Route
        </button>
        <button 
          className={`btn ${activeTab === 'weekly' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('weekly')}
          style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '0.5rem' }}
        >
          <Calendar size={18} /> Weekly Scheduler
        </button>
      </div>

      {activeTab === 'weekly' && (
        <WeeklyScheduler 
          customers={customers} 
          tieredMatrixData={tieredMatrixData} 
          settings={settings} 
          onLoadDayRoute={handleLoadDayRoute}
          allVisits={allVisits}
        />
      )}

      {activeTab === 'build' && (
        <div className="route-build-grid" style={{ display: 'grid', gap: '1rem', alignItems: 'start' }}>
          
          {/* COLUMN 1: Templates & Available Clients */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Templates Accordion */}
            {templates && templates.length > 0 && (
              <div className="glass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowTemplates(!showTemplates)}>
                  <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.05rem' }}>
                    <BookMarked size={16} color="var(--color-primary)" /> Saved Templates ({templates.length})
                  </h3>
                  {showTemplates ? <ChevronUp size={18} color="var(--color-text-muted)" /> : <ChevronDown size={18} color="var(--color-text-muted)" />}
                </div>
                
                {showTemplates && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem', borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
                    {templates.map(t => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.6rem 0.8rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{t.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {t.stops?.length ?? 0} stop{t.stops?.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                          onClick={(e) => { e.stopPropagation(); handleLoadTemplate(t); }}
                        >
                          <FolderOpen size={14} /> Load
                        </button>
                        <button
                          className="btn-icon"
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                          onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t); }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Add Clients Panel */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 240px)', minHeight: '400px' }}>
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>Available Clients</h3>
              
              <input
                type="text"
                className="input-field"
                placeholder="Search name or address..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ width: '100%', marginBottom: '0.8rem', borderRadius: 'var(--radius-sm)' }}
              />
              
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingRight: '0.2rem' }}>
                {(() => {
                  const q = searchQuery.toLowerCase().trim();
                  const filtered = q 
                    ? availableCustomers.filter(c => c.name.toLowerCase().includes(q) || (c.address || '').toLowerCase().includes(q))
                    : availableCustomers.filter(c => {
                        if (activeMode === 'mowing') return c.services && c.services.some(s => s.active && (s.id === 's1' || (s.name && s.name.toLowerCase().includes('mow'))));
                        if (activeMode === 'fertilizer') return c.services && c.services.some(s => s.active && (s.id === 's3' || (s.name && s.name.toLowerCase().includes('fertil'))));
                        return true;
                    });
                    
                  if (filtered.length === 0) return <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textAlign: 'center', marginTop: '1rem' }}>{q ? 'No matching clients.' : 'All clients added or none available.'}</p>;
                  
                  return filtered.map(c => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.8rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-main)', transition: 'border-color 0.15s' }}>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.address}</div>
                      </div>
                      <button className="btn-icon" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'none', cursor: 'pointer', borderRadius: '50%', padding: '0.3rem', flexShrink: 0, marginLeft: '0.5rem' }} onClick={() => { addStop(c); setSearchQuery(''); }}>
                        <Plus size={16} strokeWidth={3} />
                      </button>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>

          {/* COLUMN 2: Active Route */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 240px)', minHeight: '400px' }}>
            <input
              type="text"
              placeholder="Route Name (optional)"
              value={routeName}
              onChange={e => setRouteName(e.target.value)}
              style={{ width: '100%', fontSize: '1.15rem', fontWeight: 700, border: 'none', background: 'transparent', borderBottom: '2px solid var(--color-border)', borderRadius: 0, padding: '0.5rem 0', marginBottom: '1rem', color: 'var(--color-text-main)', outline: 'none' }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text-muted)', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{selectedStops.length} Stops</span>
              {selectedStops.length >= 3 && (
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, borderRadius: 'var(--radius-full)' }}
                  onClick={handleOptimizeRoute}
                >
                  <Shuffle size={14} /> Optimize Order
                </button>
              )}
            </div>
            
            <div
              style={{ flex: 1, overflowY: 'auto', paddingRight: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {selectedStops.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: '2rem', padding: '2rem' }}>
                  <RouteIcon size={32} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                  <p style={{ margin: 0, fontWeight: 500 }}>Route is empty.</p>
                  <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Select clients from the left to begin.</p>
                </div>
              )}

              {selectedStops.map((stop, index) => {
                const activeServices = stop.customer.services?.filter(s => s.active) || [];
                const plannedTotal = activeServices
                  .filter(s => stop.plannedServiceIds.includes(s.id))
                  .reduce((sum, s) => sum + s.price, 0);

                return (
                  <div
                    key={stop.customer.id}
                    ref={el => stopItemRefs.current[index] = el}
                    draggable
                    onDragStart={e => handleDragStart(e, index)}
                    onDragOver={e  => handleDragOver(e, index)}
                    onDrop={e      => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    style={{
                      background: 'var(--color-bg-main)',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${dragOverIndex === index ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      borderLeft: `4px solid var(--color-primary)`,
                      boxShadow: 'var(--shadow-sm)',
                      overflow: 'hidden',
                      opacity: dragIndex === index ? 0.5 : 1,
                      transition: 'border-color 0.15s, opacity 0.15s',
                      cursor: 'grab'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem' }}>
                      <div onTouchStart={e => handleTouchStart(e, index)} style={{ color: 'var(--color-text-muted)', cursor: 'grab', padding: '0 4px', touchAction: 'none' }}>
                        <GripVertical size={16} />
                      </div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--color-text-muted)', minWidth: '18px', textAlign: 'center' }}>{index + 1}</div>
                      <div style={{ flex: 1, cursor: 'pointer', overflow: 'hidden' }} onClick={() => toggleExpanded(index)}>
                        <strong style={{ fontSize: '1rem', color: 'var(--color-text-main)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stop.customer.name}</strong>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
                          {stop.plannedServiceIds.length > 0
                            ? <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>${plannedTotal.toFixed(2)}</span>
                            : 'No services'}
                          {stop.plannedServiceIds.length > 0 && ` — ${stop.plannedServiceIds.length} svc`}
                        </div>
                      </div>

                      <button className="btn-icon" onClick={() => toggleExpanded(index)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '4px' }}>
                        {stop.expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>
                      <button className="btn-icon" onClick={() => removeStop(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {stop.expanded && (
                      <div style={{ padding: '0.8rem', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-card)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px' }}>
                          Selected Services:
                        </div>
                        {activeServices.length === 0 && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No active services.</span>
                        )}
                        {activeServices.map(svc => (
                          <label key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                            <input
                              type="checkbox"
                              checked={stop.plannedServiceIds.includes(svc.id)}
                              onChange={() => toggleService(index, svc.id)}
                              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                            />
                            <span style={{ fontWeight: 500 }}>{svc.name}</span>
                            <span style={{ marginLeft: 'auto', color: 'var(--color-primary)', fontWeight: 600 }}>${svc.price.toFixed(2)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Route Summary & Actions */}
            {selectedStops.length > 0 && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {(() => {
                  let totalRev = 0;
                  let totalDriveSecs = 0;
                  let totalMowSecs = 0;
                  let missingDrive = false;
                  
                  let globalPace = 250;
                  if (allVisits.length > 0 && customers.length > 0) {
                    let tSecs = 0;
                    let tSqFt = 0;
                    allVisits.forEach(v => {
                      if (v.status !== 'completed' || !v.durationSecs || v.durationSecs < 60) return;
                      const isMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.includes('s1') || v.appliedServices.some(s => typeof s === 'string' && s.toLowerCase().includes('mow'));
                      if (!isMow) return;
                      const cust = customers.find(c => c.id === v.customerId);
                      if (!cust || !cust.lawnSize) return;
                      const sqft = parseLawnSizeToSqFt(cust.lawnSize);
                      if (sqft) {
                        tSecs += v.durationSecs;
                        tSqFt += sqft;
                      }
                    });
                    if (tSecs > 0) globalPace = Math.max(10, Math.round(tSqFt / (tSecs / 60)));
                  }

                  selectedStops.forEach(s => {
                    const activeServices = s.customer.services?.filter(srv => srv.active) || [];
                    const plannedTotal = activeServices
                      .filter(srv => s.plannedServiceIds.includes(srv.id))
                      .reduce((sum, srv) => sum + (srv.price || 0), 0);
                    totalRev += plannedTotal;

                    if (s.plannedDriveTimeSecs != null) totalDriveSecs += s.plannedDriveTimeSecs;
                    else missingDrive = true;

                    let avgDuration = 900;
                    const isPlannedMow = !s.plannedServiceIds || s.plannedServiceIds.length === 0 || s.plannedServiceIds.some(id => settings?.defaultServices?.find(ds => ds.id === id)?.category === 'Mowing' || id === 's1');

                    const histVisits = allVisits.filter(v => {
                      if (v.customerId !== s.customer.id || v.status !== 'completed' || !v.durationSecs) return false;
                      const isHistMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => settings?.defaultServices?.find(ds => ds.id === id)?.category === 'Mowing' || id === 's1');
                      return isPlannedMow === isHistMow;
                    });

                    if (histVisits.length > 0) {
                       avgDuration = histVisits.reduce((acc, v) => acc + v.durationSecs, 0) / histVisits.length;
                    } else if (s.customer.lawnSize) {
                       const sqft = parseLawnSizeToSqFt(s.customer.lawnSize);
                       if (sqft) {
                         avgDuration = Math.max(isPlannedMow ? 600 : 300, Math.round((sqft / globalPace) * 60));
                       }
                    }
                    totalMowSecs += avgDuration;
                  });

                  const totalTimeMins = Math.round((totalDriveSecs + totalMowSecs) / 60);
                  const hours = Math.floor(totalTimeMins / 60);
                  const mins = totalTimeMins % 60;
                  const timeString = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-bg-main)', padding: '0.8rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Est. Time</div>
                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem', justifyContent: 'center' }}>
                          {timeString} {missingDrive && <span style={{ color: '#f59e0b', fontSize: '0.85rem' }} title="Re-optimize to include drive time">⚠️</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Revenue</div>
                        <div style={{ fontWeight: 800, color: 'var(--color-primary)', fontSize: '1.1rem' }}>${totalRev.toFixed(2)}</div>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ display: 'flex', gap: '0.8rem' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.9rem', fontWeight: 600 }}
                    onClick={handleSaveTemplate}
                  >
                    Save Template
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '1rem', fontWeight: 700 }}
                    onClick={handleSaveRoute}
                  >
                    Save Route
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
