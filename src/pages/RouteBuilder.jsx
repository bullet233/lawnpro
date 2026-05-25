import { useState, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { GoogleMap, DirectionsService, DirectionsRenderer } from '@react-google-maps/api';
import { Plus, Save, Trash2, ChevronDown, ChevronUp, BookMarked, FolderOpen, GripVertical, Shuffle } from 'lucide-react';
import AppDialog from '../components/AppDialog';

const mapContainerStyle = { width: '100%', height: '300px', borderRadius: 'var(--radius-md)', marginTop: '1rem' };

const getDist = (a, b) => {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
};

export default function RouteBuilder() {
  const customers   = useLiveQuery(() => db.customers.toArray(), []);
  const templates   = useLiveQuery(() => db.routes.where({ isTemplate: 1 }).toArray(), []);

  const [selectedStops, setSelectedStops] = useState([]);
  const [directions,    setDirections]    = useState(null);
  const [routeName,     setRouteName]     = useState('');
  const [dialog,        setDialog]        = useState(null);
  const [dragIndex,     setDragIndex]     = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const touchDragIndex  = useRef(null);
  const stopItemRefs    = useRef([]);

  const availableCustomers = useMemo(() => {
    if (!customers) return [];
    return customers.filter(c => !selectedStops.find(s => s.customer.id === c.id));
  }, [customers, selectedStops]);

  // ── Stop management ──────────────────────────────────────────────────────────
  const addStop = (customer) => {
    const defaultIds = customer.services
      ? customer.services.filter(s => s.active).slice(0, 1).map(s => s.id)
      : [];
    setSelectedStops(prev => [...prev, { customer, plannedServiceIds: defaultIds, expanded: false }]);
  };

  const removeStop = (index) => setSelectedStops(prev => prev.filter((_, i) => i !== index));

  const moveStop = (index, direction) => {
    setSelectedStops(prev => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[index + direction];
      next[index + direction] = temp;
      return next;
    });
  };

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
      return next;
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
    if (overIndex !== -1 && overIndex !== touchDragIndex.current) {
      setSelectedStops(prev => {
        const next = [...prev];
        const [removed] = next.splice(touchDragIndex.current, 1);
        next.splice(overIndex, 0, removed);
        return next;
      });
      touchDragIndex.current = overIndex;
      setDragOverIndex(overIndex);
    }
  };
  const handleTouchEnd = () => { touchDragIndex.current = null; setDragOverIndex(null); };

  // ── Optimize route order (nearest-neighbor) ───────────────────────────────
  const handleOptimizeRoute = () => {
    if (selectedStops.length < 3) return;
    const getCenter = (stop) => {
      const geo = stop.customer.geofence;
      if (!geo || geo.length === 0) return null;
      return { lat: geo.reduce((s,p) => s+p.lat, 0)/geo.length, lng: geo.reduce((s,p) => s+p.lng, 0)/geo.length };
    };
    if (selectedStops.some(s => !getCenter(s))) {
      setDialog({ type: 'info', title: 'Cannot Optimize', message: 'Some stops are missing geofence data. Set a geofence on each customer to enable route optimization.' });
      return;
    }
    const remaining = [...selectedStops];
    const optimized = [remaining.splice(0, 1)[0]];
    while (remaining.length > 0) {
      const lastCoords = getCenter(optimized[optimized.length - 1]);
      let nearestIdx = 0, nearestDist = Infinity;
      remaining.forEach((stop, i) => {
        const d = getDist(lastCoords, getCenter(stop));
        if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
      });
      optimized.push(remaining.splice(nearestIdx, 1)[0]);
    }
    setSelectedStops(optimized);
    setDirections(null);
    setDialog({ type: 'success', title: 'Route Optimized!', message: `${optimized.length} stops sorted by nearest-neighbor proximity.` });
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

  // ── Directions ───────────────────────────────────────────────────────────────
  const directionsCallback = (response) => {
    if (response !== null && response.status === 'OK') setDirections(response);
  };

  // ── Save active route ────────────────────────────────────────────────────────
  const handleSaveRoute = async () => {
    if (selectedStops.length === 0) return;
    await db.routes.add({
      name: routeName.trim() || null,
      date: new Date().toISOString(),
      status: 'active',
      isTemplate: 0,
      stops: selectedStops.map(s => ({
        customerId: s.customer.id,
        plannedServiceIds: s.plannedServiceIds
      }))
    });
    setDialog({ type: 'success', title: 'Route Saved!', message: `${selectedStops.length} stop${selectedStops.length > 1 ? 's' : ''} saved to your active route.` });
    setSelectedStops([]);
    setRouteName('');
    setDirections(null);
  };

  // ── Save as template ─────────────────────────────────────────────────────────
  const handleSaveTemplate = async () => {
    if (selectedStops.length === 0) return;
    const name = routeName.trim() || `Template ${new Date().toLocaleDateString()}`;
    await db.routes.add({
      name,
      date: new Date().toISOString(),
      isTemplate: 1,
      stops: selectedStops.map(s => ({
        customerId: s.customer.id,
        plannedServiceIds: s.plannedServiceIds
      }))
    });
    setDialog({ type: 'success', title: 'Template Saved!', message: `"${name}" saved. Load it any time to pre-fill this route.` });
  };

  // ── Load a template ───────────────────────────────────────────────────────────
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
    setDirections(null);
    setDialog({ type: 'info', title: 'Template Loaded', message: `"${template.name}" — ${stops.length} stop${stops.length !== 1 ? 's' : ''} ready. Edit if needed, then save your active route.` });
  };

  // ── Delete a template ─────────────────────────────────────────────────────────
  const handleDeleteTemplate = (template) => {
    setDialog({
      type: 'danger',
      title: `Delete "${template.name}"?`,
      message: 'This template will be permanently removed.',
      confirmLabel: 'Delete',
      onConfirm: () => db.routes.delete(template.id)
    });
  };

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '2rem' }}>
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      <h1 className="page-title">Route Builder</h1>

      {/* ── Templates ── */}
      {templates && templates.length > 0 && (
        <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <BookMarked size={18} color="var(--color-primary)" /> Saved Templates
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
                  onClick={() => handleLoadTemplate(t)}
                >
                  <FolderOpen size={14} /> Load
                </button>
                <button
                  className="btn-icon"
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                  onClick={() => handleDeleteTemplate(t)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Route Name ── */}
      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
          Route Name <span style={{ fontWeight: 400, color: 'var(--color-text-muted' }}>(optional)</span>
        </label>
        <input
          type="text"
          className="input-field"
          placeholder="e.g. Monday Westside, Friday Neighborhood Loop"
          value={routeName}
          onChange={e => setRouteName(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      {/* ── Available Customers ── */}
      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem 0' }}>Add Clients</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
          {availableCustomers.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>All clients added or none available.</p>}
          {availableCustomers.map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
              <div>
                <strong>{c.name}</strong> <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{c.address}</span>
              </div>
              <button className="btn-icon" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'none', cursor: 'pointer' }} onClick={() => addStop(c)}>
                <Plus size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Route Stops ── */}
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>
            {routeName.trim() ? `"${routeName.trim()}"` : "Today's Route"}
          </h3>
          {selectedStops.length >= 3 && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              onClick={handleOptimizeRoute}
            >
              <Shuffle size={14} /> Optimize Order
            </button>
          )}
        </div>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {selectedStops.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No stops added yet.</p>}

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
                onTouchStart={e => handleTouchStart(e, index)}
                style={{
                  background: 'var(--color-bg-main)',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${dragOverIndex === index ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  overflow: 'hidden',
                  opacity: dragIndex === index ? 0.5 : 1,
                  transition: 'border-color 0.15s, opacity 0.15s',
                  cursor: 'grab'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.8rem' }}>
                  {/* Grip Handle */}
                  <div style={{ color: 'var(--color-text-muted)', cursor: 'grab', padding: '0 4px', touchAction: 'none' }}>
                    <GripVertical size={18} />
                  </div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)', minWidth: '18px' }}>{index + 1}</div>
                  <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => toggleExpanded(index)}>
                    <strong style={{ fontSize: '0.95rem' }}>{index + 1}. {stop.customer.name}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {stop.plannedServiceIds.length > 0
                        ? `${stop.plannedServiceIds.length} service${stop.plannedServiceIds.length > 1 ? 's' : ''} — $${plannedTotal}`
                        : 'No services selected'}
                    </div>
                  </div>

                  <button onClick={() => toggleExpanded(index)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                    {stop.expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <button className="btn-icon" onClick={() => removeStop(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                    <Trash2 size={16} />
                  </button>
                </div>

                {stop.expanded && (
                  <div style={{ padding: '0.8rem', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-card)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>
                      Services for today's visit:
                    </div>
                    {activeServices.length === 0 && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No active services on this client's profile.</span>
                    )}
                    {activeServices.map(svc => (
                      <label key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input
                          type="checkbox"
                          checked={stop.plannedServiceIds.includes(svc.id)}
                          onChange={() => toggleService(index, svc.id)}
                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        <span>{svc.name}</span>
                        <span style={{ marginLeft: 'auto', color: 'var(--color-primary)', fontWeight: 600 }}>${svc.price}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Route Preview Map */}
        {selectedStops.length > 1 && (
          <div style={{ marginTop: '1rem' }}>
            <GoogleMap mapContainerStyle={mapContainerStyle} center={{ lat: 39.8283, lng: -98.5795 }} zoom={4}>
              <DirectionsService
                options={{
                  origin: selectedStops[0].customer.address,
                  destination: selectedStops[selectedStops.length - 1].customer.address,
                  waypoints: selectedStops.slice(1, -1).map(s => ({ location: s.customer.address, stopover: true })),
                  travelMode: 'DRIVING'
                }}
                callback={directionsCallback}
              />
              {directions && <DirectionsRenderer options={{ directions }} />}
            </GoogleMap>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '0.8rem', marginTop: '1.5rem' }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
            onClick={handleSaveTemplate}
            disabled={selectedStops.length === 0}
          >
            <BookMarked size={16} /> Save as Template
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
            onClick={handleSaveRoute}
            disabled={selectedStops.length === 0}
          >
            <Save size={18} /> Save Active Route
          </button>
        </div>
      </div>
    </div>
  );
}
