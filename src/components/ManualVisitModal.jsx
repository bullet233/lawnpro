import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Save, X, Clock, Calendar } from 'lucide-react';
import { useServiceMode } from './ServiceProvider';
import { getSettings } from '../db/settings';

const fmtInputDate = (d) => {
  if (!d) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

export default function ManualVisitModal({ customer, onClose, onSave }) {
  const { activeMode } = useServiceMode();
  
  const [date, setDate] = useState(fmtInputDate(new Date()));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [selectedServices, setSelectedServices] = useState([]);
  const [availableServices, setAvailableServices] = useState([]);

  useEffect(() => {
    // Load services logic
    const globalDefaults = getSettings().defaultServices || [];
    const custServices = customer.services || [];
    
    // Merge
    const merged = globalDefaults.map(gd => {
      const cs = custServices.find(s => s.id === gd.id);
      return cs ? { ...gd, ...cs } : gd;
    });
    
    // Filter by active mode logic
    const filtered = merged.filter(s => {
      if (activeMode === 'mowing') return s.category === 'Mowing' || s.id === 's1' || s.id === 's2' || s.id === 's4';
      if (activeMode === 'fertilizer') return s.category === 'Fertilizer' || s.id === 's3';
      return true;
    });
    
    setAvailableServices(filtered);
    
    // Auto-select active ones
    setSelectedServices(filtered.filter(s => s.active).map(s => s.id));
  }, [customer, activeMode]);

  const toggleService = (id) => {
    setSelectedServices(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  // Calculate duration
  let durationMins = 0;
  if (startTime && endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let sMins = sh * 60 + sm;
    let eMins = eh * 60 + em;
    if (eMins < sMins) eMins += 24 * 60; // crossed midnight
    durationMins = Math.max(0, eMins - sMins);
  }

  const handleSave = () => {
    if (!date || !startTime || !endTime) return;
    
    // Build timestamps
    const [yy, mm, dd] = date.split('-').map(Number);
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    
    const entryDate = new Date(yy, mm - 1, dd, sh, sm);
    let exitDate = new Date(yy, mm - 1, dd, eh, em);
    if (exitDate < entryDate) {
      exitDate.setDate(exitDate.getDate() + 1);
    }
    
    // Calculate price
    let price = 0;
    selectedServices.forEach(id => {
      const s = availableServices.find(x => x.id === id);
      if (s && s.price) price += Number(s.price);
    });

    onSave({
      entryTime: entryDate.getTime(),
      exitTime: exitDate.getTime(),
      durationSecs: Math.floor((exitDate.getTime() - entryDate.getTime()) / 1000),
      appliedServices: selectedServices,
      priceEarned: price,
      division: activeMode
    });
  };

  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Log Manual Visit</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.2rem' }}>
          Logging manual visit for <strong>{customer.name}</strong> in {activeMode} mode.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', marginBottom: '1.5rem' }}>
          <div className="input-group">
            <label className="input-label"><Calendar size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }}/> Date</label>
            <input type="date" className="input-field" value={date} onChange={e => setDate(e.target.value)} />
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div className="input-group" style={{ flex: 1 }}>
              <label className="input-label">Start Time</label>
              <input type="time" className="input-field" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="input-group" style={{ flex: 1 }}>
              <label className="input-label">End Time</label>
              <input type="time" className="input-field" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
          
          <div style={{ background: 'var(--color-bg-alt)', padding: '0.6rem', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}><Clock size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }}/> Computed Duration</span>
            <span style={{ fontWeight: 800, color: 'var(--color-primary)' }}>{durationMins} minutes</span>
          </div>

          {availableServices.length > 0 && (
            <div className="input-group">
              <label className="input-label">Services Provided</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {availableServices.map(s => {
                  const isSel = selectedServices.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleService(s.id)}
                      style={{
                        padding: '0.4rem 0.8rem', borderRadius: 'var(--radius-full)', fontSize: '0.8rem', fontWeight: 600,
                        border: `1px solid ${isSel ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        background: isSel ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-main)',
                        color: isSel ? 'var(--color-primary)' : 'var(--color-text-muted)', cursor: 'pointer'
                      }}
                    >
                      {s.name} (${s.price})
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.8rem' }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }} onClick={handleSave} disabled={!date || !startTime || !endTime}>
            <Save size={16} /> Save Visit
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
