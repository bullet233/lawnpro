import { useState, useMemo } from 'react';
import { db } from '../db/db';
import { parseLawnSizeToSqFt } from '../utils/matrix';
import { getDaysSince } from '../utils/dateUtils';
import { Clock, AlertTriangle, GripVertical, CalendarClock, Moon } from 'lucide-react';

const DAYS = ['Unassigned', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function WeeklyScheduler({ customers, tieredMatrixData, settings, onLoadDayRoute, allVisits }) {
  const [draggedCustId, setDraggedCustId] = useState(null);
  const [dragOverDay, setDragOverDay] = useState(null);
  const [now] = useState(() => Date.now());

  // Group customers by day
  const columns = useMemo(() => {
    const cols = { Unassigned: [] };
    DAYS.forEach(d => { cols[d] = []; });
    
    (customers || []).forEach(c => {
      if (c.status === 'inactive') return; // Don't schedule inactive clients
      const day = c.preferredDay || 'Unassigned';
      if (cols[day]) {
        cols[day].push(c);
      } else {
        cols.Unassigned.push(c);
      }
    });
    
    return cols;
  }, [customers]);

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
    <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem', alignItems: 'flex-start' }}>
      {DAYS.map(day => {
        const dayCusts = columns[day] || [];
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
              minWidth: '280px',
              maxWidth: '300px',
              flex: '0 0 auto',
              background: isDragOver ? 'var(--color-bg-card)' : 'rgba(255,255,255,0.02)',
              border: `2px dashed ${isDragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '0.5rem',
              display: 'flex',
              flexDirection: 'column',
              transition: 'all 0.2s'
            }}
          >
            {/* Header */}
            <div style={{ 
              padding: '0.8rem', 
              background: isOverbooked ? 'rgba(239,68,68,0.1)' : 'var(--color-bg-main)',
              border: `1px solid ${isOverbooked ? 'rgba(239,68,68,0.3)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-sm)',
              marginBottom: '0.8rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: isOverbooked ? '#ef4444' : 'var(--color-text-main)' }}>
                  {day}
                </h3>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  {dayCusts.length}
                </span>
              </div>
              
              {day !== 'Unassigned' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ 
                    display: 'flex', alignItems: 'center', gap: '0.4rem', 
                    fontSize: '0.85rem', fontWeight: 600,
                    color: isOverbooked ? '#ef4444' : 'var(--color-primary)'
                  }}>
                    {isOverbooked ? <AlertTriangle size={14} /> : <Clock size={14} />}
                    Est. {capacityHours} hrs ({capacityMins}m)
                  </div>
                  {dayCusts.length > 0 && (
                    <button 
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                      onClick={() => onLoadDayRoute(day)}
                    >
                      Load Route
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Cards List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: '100px' }}>
              {dayCusts.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '1rem' }}>
                  Empty
                </div>
              )}
              {dayCusts.map(cust => {
                const isSnoozed = cust.snoozedUntil && cust.snoozedUntil > now;
                
                // Find last mowed
                let lastMowedDays = null;
                if (allVisits) {
                  const custVisits = allVisits.filter(v => v.customerId === cust.id && v.status === 'completed');
                  if (custVisits.length > 0) {
                    custVisits.sort((a, b) => b.exitTime - a.exitTime);
                    lastMowedDays = getDaysSince(custVisits[0].exitTime);
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
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.8rem',
                      cursor: 'grab',
                      boxShadow: 'var(--shadow-sm)',
                      opacity: draggedCustId === cust.id || isSnoozed ? 0.5 : 1,
                      filter: isSnoozed ? 'grayscale(100%)' : 'none',
                      transition: 'all 0.2s'
                    }}
                  >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                    <div style={{ color: 'var(--color-text-muted)', marginTop: '2px', cursor: 'grab' }}>
                      <GripVertical size={16} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>
                          {cust.name}
                        </div>
                        <button 
                          className="btn-icon" 
                          onClick={() => toggleSnooze(cust)}
                          style={{ 
                            background: isSnoozed ? 'var(--color-primary)' : 'var(--color-bg-main)', 
                            color: isSnoozed ? '#fff' : 'var(--color-text-muted)',
                            border: `1px solid ${isSnoozed ? 'var(--color-primary)' : 'var(--color-border)'}`,
                            padding: '4px',
                            cursor: 'pointer'
                          }}
                          title={isSnoozed ? 'Un-snooze' : 'Snooze 1 Week'}
                        >
                          <Moon size={14} />
                        </button>
                      </div>
                      
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
                        {cust.address || 'No Address'}
                      </div>
                      
                      {lastMowedDays !== null && (
                        <div style={{ 
                          fontSize: '0.75rem', 
                          marginTop: '0.4rem', 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '0.3rem',
                          color: lastMowedDays < 5 ? '#f59e0b' : 'var(--color-text-muted)',
                          fontWeight: lastMowedDays < 5 ? 600 : 400
                        }}>
                          <CalendarClock size={12} />
                          {lastMowedDays === 0 ? 'Mowed today' : `Last Cut: ${lastMowedDays} days ago`}
                        </div>
                      )}
                      
                      {/* Mobile Move Dropdown */}
                      <select 
                        style={{
                          marginTop: '0.6rem',
                          width: '100%',
                          padding: '0.3rem',
                          fontSize: '0.8rem',
                          background: 'var(--color-bg-main)',
                          color: 'var(--color-text-main)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)'
                        }}
                        value={day}
                        onChange={(e) => moveCustomer(cust.id, e.target.value)}
                      >
                        {DAYS.map(d => (
                          <option key={d} value={d}>Move to {d}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          </div>
        );
      })}
    </div>
  );
}
