import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { parseLawnSizeToSqFt } from '../utils/matrix';
import { getDaysSince } from '../utils/dateUtils';
import { classifyTreatment } from '../db/treatments';
import { ChevronDown, Moon } from 'lucide-react';
import { useServiceMode } from './ServiceProvider';

const DAYS = ['Unassigned', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function WeeklyScheduler({ customers, tieredMatrixData, settings, onLoadDayRoute, allVisits }) {
  const [draggedCustId, setDraggedCustId] = useState(null);
  const [dragOverDay, setDragOverDay] = useState(null);
  const [now] = useState(() => Date.now());
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const { activeMode } = useServiceMode();

  // Program treatments, so enrolled fert clients are flagged by their step
  // windows (matching the Treatments page) instead of the 30-day interval.
  const allTreatments = useLiveQuery(
    () => (activeMode === 'fertilizer' ? db.treatments.toArray() : Promise.resolve([])),
    [activeMode]
  ) || [];

  // Group customers by day
  const columns = useMemo(() => {
    const cols = { Unassigned: [] };
    DAYS.forEach(d => { cols[d] = []; });

    (customers || []).forEach(c => {
      if (c.status === 'inactive') return; // Don't schedule inactive clients

      // Filter customers based on the active global mode
      let hasActiveService;
      if (activeMode === 'fertilizer') {
        hasActiveService = c.services && c.services.some(s => {
          const n = s.name.toLowerCase();
          return (n.includes('fert') || n.includes('spray') || n.includes('weed') || n.includes('chem')) && s.active;
        });
      } else {
        hasActiveService = !c.services || c.services.length === 0 || c.services.some(s => {
          const n = s.name.toLowerCase();
          return (n.includes('mow') || n.includes('cut') || n.includes('yard')) && s.active;
        });
      }
      
      if (!hasActiveService) return;

      const day = c.preferredDay || 'Unassigned';
      if (cols[day]) {
        cols[day].push(c);
      } else {
        cols.Unassigned.push(c);
      }
    });

    // Snoozed clients sink to the bottom of each day so active work stays on top
    Object.keys(cols).forEach(d => {
      cols[d].sort((a, b) => {
        const aS = a.snoozedUntil && a.snoozedUntil > now ? 1 : 0;
        const bS = b.snoozedUntil && b.snoozedUntil > now ? 1 : 0;
        return aS - bS;
      });
    });

    return cols;
  }, [customers, activeMode, now]);

  const calculateDayCapacity = (dayCustomers) => {
    if (!tieredMatrixData || tieredMatrixData.length === 0) return 0;
    
    let totalMins = 0;
    
    dayCustomers.forEach(cust => {
      if (cust.snoozedUntil && cust.snoozedUntil > now) return; // Exclude snoozed from capacity
      
      const sqft = parseLawnSizeToSqFt(cust.lawnSize);
      if (!sqft) return;
      
      const bucket = tieredMatrixData.find(b => sqft <= b.maxSqft) || tieredMatrixData[tieredMatrixData.length - 1];
      let mins = sqft / bucket.pace;
      
      const obstacles = parseInt(cust.obstacleCount, 10) || 0;
      if (cust.terrain === 'moderate') mins *= 1.15;
      else if (cust.terrain === 'hilly') mins *= 1.3;
      if (cust.fencedBackyard) mins += 3;
      if (obstacles > 0) mins += (obstacles * 1.5);

      
      totalMins += mins;
    });
    
    return Math.round(totalMins);
  };

  const moveCustomer = async (customerId, newDay) => {
    const finalDay = newDay === 'Unassigned' ? '' : newDay;
    await db.customers.update(customerId, { preferredDay: finalDay });
    setDraggedCustId(null);
    setDragOverDay(null);
    setOpenDropdownId(null);
  };

  const toggleSnooze = async (cust) => {
    const currentTime = Date.now();
    const isSnoozed = cust.snoozedUntil && cust.snoozedUntil > currentTime;
    if (isSnoozed) {
      await db.customers.update(cust.id, { snoozedUntil: null });
    } else {
      // Snooze for 6 days (518400000 ms)
      await db.customers.update(cust.id, { snoozedUntil: currentTime + 518400000 });
    }
  };

  const handleDragStart = (e, custId) => {
    setDraggedCustId(custId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', custId.toString());
  };

  const handleDragOver = (e, day) => {
    e.preventDefault();
    if (dragOverDay !== day) {
      setDragOverDay(day);
    }
  };

  const handleDrop = (e, day) => {
    e.preventDefault();
    const droppedId = e.dataTransfer.getData('text/plain') || draggedCustId;
    if (droppedId && day) {
      moveCustomer(Number(droppedId), day);
    }
    setDraggedCustId(null);
    setDragOverDay(null);
  };

  const handleDragEnd = () => {
    setDraggedCustId(null);
    setDragOverDay(null);
  };

  return (
    <div style={{ display: 'flex', gap: '1.5rem', overflowX: 'auto', paddingBottom: '1rem', alignItems: 'flex-start', minHeight: 'calc(100vh - 150px)' }}>
      {DAYS.map(day => {
        const dayCusts = columns[day] || [];
        const snoozedCount = dayCusts.filter(c => c.snoozedUntil && c.snoozedUntil > now).length;
        const capacityMins = calculateDayCapacity(dayCusts);
        const capacityHours = (capacityMins / 60).toFixed(1);
        const isOverbooked = capacityMins > 480; // 8 hours
        const isDragOver = dragOverDay === day;

        return (
          <div 
            key={day}
            onDragOver={(e) => handleDragOver(e, day)}
            onDrop={(e) => handleDrop(e, day)}
            style={{
              minWidth: '300px',
              maxWidth: '320px',
              flex: '0 0 auto',
              background: isDragOver ? 'var(--color-bg-card)' : 'var(--color-bg-main)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              flexDirection: 'column',
              transition: 'background 0.2s',
              padding: '0.8rem'
            }}
          >
            {/* Minimalist Header */}
            <div style={{ 
              padding: '0 0 0.8rem 0', 
              borderBottom: '2px solid var(--color-border)',
              marginBottom: '1rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: isOverbooked ? '#ef4444' : 'var(--color-text-main)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {day}
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {snoozedCount > 0 && (
                    <span title="Snoozed clients" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#b45309', background: 'rgba(245,158,11,0.15)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-full)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <Moon size={11} /> {snoozedCount}
                    </span>
                  )}
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)', background: 'var(--color-bg-main)', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)' }}>
                    {dayCusts.length}
                  </span>
                </div>
              </div>
              
              {day !== 'Unassigned' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ 
                    fontSize: '0.8rem', fontWeight: 600,
                    color: isOverbooked ? '#ef4444' : 'var(--color-text-muted)'
                  }}>
                    Est. Route Time: {capacityHours}h
                  </div>
                  {dayCusts.length > 0 && (
                    <button 
                      className="btn btn-secondary"
                      style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: 'var(--radius-full)' }}
                      onClick={() => onLoadDayRoute(day)}
                    >
                      Load Route
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Cards List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', minHeight: '150px' }}>
              {dayCusts.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '2rem', opacity: 0.5 }}>
                  No clients
                </div>
              )}
              {dayCusts.map(cust => {
                const isSnoozed = cust.snoozedUntil && cust.snoozedUntil > now;
                
                // Find last service
                let lastServiceDays = null;
                let lastServiceDate = null;
                let isOverdue = false;
                  if (allVisits) {
                    const custVisits = allVisits.filter(v => {
                      if (v.customerId !== cust.id || v.status !== 'completed') return false;
                      
                      // Explicit division check if available
                      if (v.division) return v.division === activeMode;
                      
                      // Fallback for older visits before division was added
                      const svcIds = v.appliedServices || [];
                      const defaultServices = settings?.defaultServices || [];
                      if (activeMode === 'mowing') {
                        const mowIds = defaultServices.filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);
                        return svcIds.length === 0 || svcIds.some(id => mowIds.includes(id));
                      } else {
                        const fertIds = defaultServices.filter(s => s.category === 'Fertilizer' || s.id === 's3').map(s => s.id);
                        return svcIds.some(id => fertIds.includes(id));
                      }
                    });
                  if (custVisits.length > 0) {
                    custVisits.sort((a, b) => b.exitTime - a.exitTime);
                    lastServiceDate = custVisits[0].exitTime;
                    lastServiceDays = getDaysSince(custVisits[0].exitTime);
                  }
                  
                  // Overdue logic: program-enrolled fert clients go by their
                  // step windows (5 rounds/season, matching the Treatments
                  // page), not the fixed interval — otherwise the scheduler
                  // nags about clients no round is actually open for.
                  if (activeMode === 'fertilizer' && cust.treatmentProgramId) {
                    const states = allTreatments
                      .filter(t => t.customerId === cust.id && (t.status === 'scheduled' || t.status === 'due'))
                      .map(t => classifyTreatment(t, now));
                    isOverdue = states.includes('overdue') || states.includes('due');
                  } else {
                    const svcInterval = activeMode === 'fertilizer' ? (cust.fertilizerInterval || 30) : (cust.mowingInterval || cust.serviceInterval || 7);
                    if (lastServiceDays !== null && lastServiceDays >= svcInterval) {
                      isOverdue = true;
                    }
                  }
                }

                return (
                  <div
                    key={cust.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, cust.id)}
                    onDragEnd={handleDragEnd}
                    style={{
                      background: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      borderLeft: `3px solid ${isSnoozed ? 'var(--color-warning)' : (isOverdue ? '#ef4444' : 'var(--color-primary)')}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.8rem 1rem',
                      cursor: 'grab',
                      boxShadow: 'var(--shadow-sm)',
                      opacity: draggedCustId === cust.id ? 0.5 : (isSnoozed ? 0.8 : 1),
                      filter: 'none',
                      transition: 'all 0.15s',
                      position: 'relative'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>
                          {cust.name}
                        </div>
                        <button 
                          onClick={() => toggleSnooze(cust)}
                          style={{ 
                            background: isSnoozed ? 'var(--color-primary)' : 'transparent', 
                            color: isSnoozed ? '#fff' : 'var(--color-text-muted)',
                            border: `1px solid ${isSnoozed ? 'var(--color-primary)' : 'var(--color-border)'}`,
                            padding: '0.15rem 0.4rem',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            borderRadius: 'var(--radius-full)',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                          }}
                        >
                          {isSnoozed ? 'Wake' : 'Snooze'}
                        </button>
                      </div>

                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
                        {cust.address || 'No Address'}
                      </div>

                      {lastServiceDays === null ? (
                        <div style={{
                          fontSize: '0.75rem',
                          marginTop: '0.5rem',
                          color: '#f59e0b',
                          fontWeight: 600
                        }}>
                          Never serviced
                        </div>
                      ) : (
                        <div style={{
                          fontSize: '0.75rem',
                          marginTop: '0.5rem',
                          color: isOverdue ? '#ef4444' : 'var(--color-text-muted)',
                          fontWeight: isOverdue ? 700 : 400
                        }}>
                          {lastServiceDays === 0
                            ? 'Serviced today'
                            : `${new Date(lastServiceDate).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${lastServiceDays}d ago`}
                        </div>
                      )}

                      {isSnoozed && (
                        <div style={{ fontSize: '0.75rem', marginTop: '0.4rem', color: '#b45309', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Moon size={12} /> Snoozed until {new Date(cust.snoozedUntil).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </div>
                      )}
                      
                      {/* Mobile Move Dropdown (Sleek) */}
                      <div style={{ marginTop: '0.8rem', position: 'relative' }}>
                        <button 
                          className="btn btn-secondary" 
                          style={{ width: '100%', fontSize: '0.75rem', padding: '0.3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                          onClick={() => setOpenDropdownId(openDropdownId === cust.id ? null : cust.id)}
                        >
                          Move... <ChevronDown size={14} />
                        </button>
                        {openDropdownId === cust.id && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-md)', zIndex: 10, marginTop: '0.2rem', padding: '0.2rem', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                            {DAYS.filter(d => d !== day).map(d => (
                              <button 
                                key={d} 
                                onClick={() => moveCustomer(cust.id, d)}
                                style={{ background: 'transparent', border: 'none', padding: '0.4rem', textAlign: 'left', fontSize: '0.8rem', cursor: 'pointer', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-main)' }}
                                onMouseOver={(e) => e.currentTarget.style.background = 'var(--color-bg-main)'}
                                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
