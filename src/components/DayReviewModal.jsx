import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle, Save, X, Truck, Fuel, ClipboardList } from 'lucide-react';
import { getSettings } from '../db/settings';
import { trackApiCall } from '../utils/apiTracker';
import { getBusinessDayStart } from '../utils/dateUtils';
import ComplianceLogModal from './ComplianceLogModal';

export default function DayReviewModal({ onClose }) {
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const todayVisits = useLiveQuery(() => {
    const startOfDay = getBusinessDayStart();
    return db.visits
      .where('exitTime').aboveOrEqual(startOfDay.getTime())
      .filter(v => v.status !== 'skipped')
      .toArray();
  }, []) || [];

  // Local edits: { [visitId]: { appliedServices: [], priceEarned: number } }
  const [edits, setEdits] = useState({});
  const [activeEpaVisitId, setActiveEpaVisitId] = useState(null);
  const [truckMiles, setTruckMiles] = useState('');
  const [milesCalculated, setMilesCalculated] = useState(false);
  const [isCalculatingMiles, setIsCalculatingMiles] = useState(false);

  const todayRoute = useLiveQuery(async () => {
    const today = new Date().toLocaleDateString('en-CA');
    const routes = await db.routes.where('date').startsWith(today).toArray();
    if (routes.length === 0) return null;
    return routes[routes.length - 1];
  }, []);

  useEffect(() => {
    const calculateActualMiles = async () => {
      if (milesCalculated) return;
      if (todayVisits.length === 0 || allCustomers.length === 0) {
        if (todayRoute && todayRoute.plannedDistanceMiles && !milesCalculated) {
          setTruckMiles(todayRoute.plannedDistanceMiles.toString());
          setMilesCalculated(true);
        }
        return;
      }

      const sortedVisits = [...todayVisits].sort((a, b) => a.exitTime - b.exitTime);
      const waypoints = [];
      for (const v of sortedVisits) {
        const cust = allCustomers.find(c => c.id === v.customerId);
        if (cust && cust.geofence && cust.geofence.length > 0) {
          const lat = cust.geofence.reduce((s, p) => s + p.lat, 0) / cust.geofence.length;
          const lng = cust.geofence.reduce((s, p) => s + p.lng, 0) / cust.geofence.length;
          waypoints.push({ lat, lng });
        }
      }

      if (waypoints.length >= 2 && waypoints.length <= 25 && window.google && window.google.maps) {
        setIsCalculatingMiles(true);
        const directionsService = new window.google.maps.DirectionsService();
        const origin = waypoints[0];
        const destination = waypoints[waypoints.length - 1];
        const intermediate = waypoints.slice(1, waypoints.length - 1).map(loc => ({ location: loc, stopover: true }));

        try {
          trackApiCall('directions');
          directionsService.route({
            origin,
            destination,
            waypoints: intermediate,
            optimizeWaypoints: false,
            travelMode: window.google.maps.TravelMode.DRIVING
          }, (response, status) => {
            if (status === 'OK') {
              const route = response.routes[0];
              const totalMeters = route.legs.reduce((acc, leg) => acc + leg.distance.value, 0);
              const totalMiles = (totalMeters * 0.000621371).toFixed(1);
              setTruckMiles(totalMiles);
            } else {
               if (todayRoute && todayRoute.plannedDistanceMiles) {
                 setTruckMiles(todayRoute.plannedDistanceMiles.toString());
               }
            }
            setIsCalculatingMiles(false);
            setMilesCalculated(true);
          });
        } catch (e) {
          if (todayRoute && todayRoute.plannedDistanceMiles) setTruckMiles(todayRoute.plannedDistanceMiles.toString());
          setIsCalculatingMiles(false);
          setMilesCalculated(true);
        }
      } else {
        if (todayRoute && todayRoute.plannedDistanceMiles && !milesCalculated) {
          setTruckMiles(todayRoute.plannedDistanceMiles.toString());
          setMilesCalculated(true);
        }
      }
    };

    calculateActualMiles();
  }, [todayVisits, allCustomers, todayRoute, milesCalculated]);

  useEffect(() => {
    // Seed edits with existing data
    const initial = {};
    todayVisits.forEach(v => {
      initial[v.id] = {
        appliedServices: v.appliedServices || [],
        priceEarned: v.priceEarned || 0,
        addOns: v.addOns || [],
        complianceLog: v.complianceLog || null
      };
    });
    setEdits(initial);
  }, [todayVisits.length]);

  const toggleService = (visitId, svc, custServices) => {
    setEdits(prev => {
      const current = prev[visitId] || { appliedServices: [], priceEarned: 0 };
      const isChecked = current.appliedServices.includes(svc.id);
      const newIds = isChecked
        ? current.appliedServices.filter(id => id !== svc.id)
        : [...current.appliedServices, svc.id];
      // Keep any add-on revenue when recomputing the base-service total so toggling
      // a service doesn't erase add-on charges from the visit.
      const addOnTotal = Array.isArray(current.addOns) ? current.addOns.reduce((sum, a) => sum + (a.price || 0), 0) : 0;
      const newPrice = custServices
        .filter(s => newIds.includes(s.id))
        .reduce((sum, s) => sum + s.price, 0) + addOnTotal;
      return { ...prev, [visitId]: { ...current, appliedServices: newIds, priceEarned: newPrice } };
    });
  };

  const initEpaLog = (visitId) => {
    setEdits(prev => {
      const current = prev[visitId];
      if (current.complianceLog) return prev; // already exists
      const settings = getSettings();
      return {
        ...prev,
        [visitId]: {
          ...current,
          complianceLog: {
            applicatorName: settings.applicatorName || '',
            targetSite: 'Turf',
            productName: '',
            epaRegNum: '',
            amountApplied: '',
            areaTreated: '',
            mixSite: 'Business Location'
          }
        }
      };
    });
    setActiveEpaVisitId(visitId);
  };

  const handleSaveEpaLog = (visitId, logData) => {
    setEdits(prev => {
      const current = prev[visitId];
      return {
        ...prev,
        [visitId]: { ...current, complianceLog: logData }
      };
    });
    setActiveEpaVisitId(null);
  };

  const copyNotice = (visit, edit) => {
    const log = edit.complianceLog || {};
    const text = `Post-Application Notice\nDate: ${new Date(visit.exitTime).toLocaleDateString()}\nApplicator: ${log.applicatorName || 'Technician'}\nProduct: ${log.productName || 'N/A'} (EPA Reg #${log.epaRegNum || 'N/A'})\nTarget: ${log.targetSite || 'Turf'}\n\nPlease keep children and pets off the treated area until dry (approx 2-3 hours).`;
    navigator.clipboard.writeText(text);
    alert('Notice copied to clipboard!');
  };

  const handleSaveAll = async () => {
    for (const [visitIdStr, data] of Object.entries(edits)) {
      await db.visits.update(Number(visitIdStr), {
        appliedServices: data.appliedServices,
        priceEarned: data.priceEarned,
        complianceLog: data.complianceLog
      });
    }

    // Save fuel log
    const miles = parseFloat(truckMiles);
    const settings = getSettings();
    const totalSecs = todayVisits.reduce((sum, v) => sum + (v.durationSecs || 0), 0);
    const mowerHours = totalSecs / 3600;
    const todayDate = new Date().toLocaleDateString('en-CA');

    if (!isNaN(miles)) {
      await db.fuelLogs.put({
        date: todayDate,
        milesDriven: miles,
        mowerHours: mowerHours,
        costOfGas: settings.costOfGas || 3.50,
        truckMpg: settings.truckMpg || 7,
        mowerGph: settings.mowerGph || 1.0,
        pendingSync: 0
      });
    } else {
      await db.fuelLogs.put({
        date: todayDate,
        milesDriven: 0,
        mowerHours: mowerHours,
        costOfGas: settings.costOfGas || 3.50,
        truckMpg: settings.truckMpg || 7,
        mowerGph: settings.mowerGph || 1.0,
        pendingSync: 1
      });
    }

    onClose();
  };

  const formatDur = (secs) => {
    if (!secs) return '0m';
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m`;
  };

  return createPortal(
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '520px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
          <h3 style={{ margin: 0 }}>📋 End of Day Review</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={20} />
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.2rem', marginTop: 0 }}>
          Review and confirm the services performed at each property today.
        </p>

        {todayVisits.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem 0' }}>No completed jobs today.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '45vh', overflowY: 'auto' }}>
          {todayVisits.map(visit => {
            const cust = allCustomers.find(c => c.id === visit.customerId);
            if (!cust) return null;
            const activeServices = cust.services?.filter(s => s.active) || [];
            const edit = edits[visit.id] || { appliedServices: [], priceEarned: 0 };

            return (
              <div key={visit.id} style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', padding: '0.8rem' }}>
                {/* Visit Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{cust.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {new Date(visit.exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ⏱ {formatDur(visit.durationSecs)}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '1.1rem' }}>
                    ${edit.priceEarned.toFixed(2)}
                  </div>
                </div>

                {/* Service Checkboxes */}
                {activeServices.length === 0 ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No active services on profile.</span>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {activeServices.map(svc => {
                      const checked = edit.appliedServices.includes(svc.id);
                      return (
                        <label
                          key={svc.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-full)',
                            border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                            background: checked ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-card)',
                            cursor: 'pointer', fontSize: '0.85rem', userSelect: 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleService(visit.id, svc, activeServices)}
                            style={{ display: 'none' }}
                          />
                          {checked && <CheckCircle size={13} color="var(--color-primary)" />}
                          {svc.name} <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>${svc.price}</span>
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* EPA Compliance Log Section */}
                {activeServices.some(s => edit.appliedServices.includes(s.id) && s.name.toLowerCase().match(/(fertilizer|weed|spray|chem)/)) && (
                  <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', color: edit.complianceLog?.productName ? 'var(--color-primary)' : 'var(--color-text-main)' }}>
                        {edit.complianceLog?.productName ? <CheckCircle size={14} /> : '⚠️'} EPA Application Log
                      </div>
                      <button 
                        onClick={() => initEpaLog(visit.id)}
                        style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'none', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                      >
                        <ClipboardList size={14} />
                        {edit.complianceLog ? 'Edit Log' : 'Fill Log'}
                      </button>
                    </div>

                    {activeEpaVisitId === visit.id && (
                      <ComplianceLogModal 
                        visit={visit}
                        customerName={cust.name}
                        customerLawnSize={cust.lawnSize}
                        initialLog={edit.complianceLog}
                        onSave={(logData) => handleSaveEpaLog(visit.id, logData)}
                        onClose={() => setActiveEpaVisitId(null)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {todayVisits.length > 0 && (
          <div style={{ marginTop: '1.2rem', padding: '1rem', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <Truck size={16} color="var(--color-primary)" />
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Daily Mileage (for fuel cost)</div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="number"
                step="0.1"
                className="input-field"
                placeholder="Miles"
                value={truckMiles}
                onChange={e => setTruckMiles(e.target.value)}
                style={{ width: '100px' }}
                disabled={isCalculatingMiles}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>miles</span>
              {isCalculatingMiles && (
                <span style={{ fontSize: '0.8rem', color: 'var(--color-primary)', marginLeft: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <div className="spinner" style={{ width: '12px', height: '12px', border: '2px solid var(--color-primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  Calculating true distance...
                </span>
              )}
            </div>
          </div>
        )}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleSaveAll}>
          <Save size={18} /> Save All & Close
        </button>
      </div>
    </div>,
    document.body
  );
}
