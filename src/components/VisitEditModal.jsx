import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Save, X, CheckCircle } from 'lucide-react';

// Formats a Date object to "HH:MM" for input type="time"
const fmtInputTime = (d) => {
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

const VisitEditModal = ({ job, customer, defaultServices, onClose, onSave }) => {
  const [editingServices, setEditingServices] = useState([]);
  const [editingNote, setEditingNote] = useState('');
  const [editingDuration, setEditingDuration] = useState('');
  const [editingDrive, setEditingDrive] = useState('');
  const [editingPrice, setEditingPrice] = useState('');
  const [editingEntryTime, setEditingEntryTime] = useState('');
  const [editingExitTime, setEditingExitTime] = useState('');

  // Resolution logic to include services currently applied to the visit,
  // services active on the customer profile, and default services fallback.
  const [availableServices, setAvailableServices] = useState([]);

  useEffect(() => {
    if (job) {
      setEditingServices(job.appliedServices || []);
      setEditingPrice(job.priceEarned != null ? job.priceEarned.toString() : '0');
      setEditingDuration(Math.floor((job.durationSecs || 0) / 60).toString());
      setEditingDrive(Math.floor((job.driveTimeSecs || 0) / 60).toString());
      setEditingNote(job.note || '');
      setEditingEntryTime(job.entryTime ? fmtInputTime(new Date(job.entryTime)) : '');
      setEditingExitTime(job.exitTime ? fmtInputTime(new Date(job.exitTime)) : '');
    }
  }, [job]);

  useEffect(() => {
    // Build available services for checkboxes
    const customerServices = customer?.services || [];
    const visitAppliedIds = job?.appliedServices || [];
    
    const resolvedServices = [];
    
    // First, add all currently active services from the customer's profile
    customerServices.forEach(s => {
      if (s.active) {
        resolvedServices.push({ ...s, isHistorical: false });
      }
    });

    // Then, make sure we include any services applied to this visit that might be missing or inactive
    visitAppliedIds.forEach(id => {
      if (!resolvedServices.find(s => s.id === id)) {
        // Try to find it in the customer's inactive/deleted services
        const custSvc = customerServices.find(s => s.id === id);
        if (custSvc) {
          resolvedServices.push({ ...custSvc, isHistorical: true });
        } else {
          // Fallback to default services
          const defSvc = defaultServices?.find(s => s.id === id);
          if (defSvc) {
            resolvedServices.push({ ...defSvc, isHistorical: true });
          } else {
            // Absolute fallback: it's a deleted ad-hoc field service
            resolvedServices.push({ id, name: `Deleted Service`, price: 0, isHistorical: true });
          }
        }
      }
    });

    setAvailableServices(resolvedServices);
  }, [customer, job, defaultServices]);

  const handleTimeChange = (type, val) => {
    if (type === 'entry') setEditingEntryTime(val);
    else setEditingExitTime(val);

    const inTime = type === 'entry' ? val : editingEntryTime;
    const outTime = type === 'exit' ? val : editingExitTime;
    if (inTime && outTime) {
      const [hIn, mIn] = inTime.split(':');
      const [hOut, mOut] = outTime.split(':');
      const start = parseInt(hIn) * 60 + parseInt(mIn);
      const end = parseInt(hOut) * 60 + parseInt(mOut);
      if (end >= start) {
        setEditingDuration((end - start).toString());
      }
    }
  };

  const handleSave = async () => {
    let newPrice = parseFloat(editingPrice);
    if (isNaN(newPrice)) newPrice = 0;

    let updatedDurationSecs = job.durationSecs;
    if (editingDuration !== '' && !isNaN(parseInt(editingDuration))) {
      updatedDurationSecs = parseInt(editingDuration) * 60;
    }

    let updatedDriveSecs = job.driveTimeSecs;
    if (editingDrive !== '' && !isNaN(parseInt(editingDrive))) {
      updatedDriveSecs = parseInt(editingDrive) * 60;
    }

    let updatedEntryTime = job.entryTime;
    if (editingEntryTime) {
      const [h, m] = editingEntryTime.split(':');
      const d = job.entryTime ? new Date(job.entryTime) : new Date(job.createdAt || Date.now());
      d.setHours(parseInt(h), parseInt(m), 0);
      updatedEntryTime = d.getTime();
    }

    let updatedExitTime = job.exitTime;
    if (editingExitTime) {
      const [h, m] = editingExitTime.split(':');
      const d = job.exitTime ? new Date(job.exitTime) : new Date(job.createdAt || Date.now());
      d.setHours(parseInt(h), parseInt(m), 0);
      updatedExitTime = d.getTime();
    }

    const updates = {
      priceEarned: newPrice,
      durationSecs: updatedDurationSecs,
      driveTimeSecs: updatedDriveSecs,
      entryTime: updatedEntryTime,
      exitTime: updatedExitTime,
      appliedServices: editingServices,
      note: editingNote || undefined
    };

    await onSave(updates);
  };

  return createPortal(
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ zIndex: 9999 }}>
      <div className="modal-content" style={{ maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text-main)' }}>Edit Visit</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '4px' }}>
            <X size={20} />
          </button>
        </div>
      <div>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '100px' }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Price ($)</label>
            <input type="number" step="0.01" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingPrice} onChange={e => setEditingPrice(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: '100px' }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Start Time</label>
            <input type="time" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingEntryTime} onChange={e => handleTimeChange('entry', e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: '100px' }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>End Time</label>
            <input type="time" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingExitTime} onChange={e => handleTimeChange('exit', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ flex: 1 }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Job Time (mins)</label>
            <input type="number" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingDuration} onChange={e => setEditingDuration(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Drive Time (mins)</label>
            <input type="number" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingDrive} onChange={e => setEditingDrive(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Note</label>
          <textarea
            className="input-field"
            style={{ width: '100%', padding: '0.4rem', minHeight: '3rem', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.82rem' }}
            value={editingNote}
            onChange={e => setEditingNote(e.target.value)}
            placeholder="Add a note…"
          />
        </div>

        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
          Services performed:
        </div>
        {availableServices.length === 0 ? (
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No services found.</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.5rem' }}>
            {availableServices.map(svc => {
              const checked = editingServices.includes(svc.id);
              return (
                <label key={svc.id} style={{ 
                  display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.7rem', 
                  borderRadius: '999px', border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--color-border)'}`, 
                  background: checked ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-card)', 
                  cursor: 'pointer', fontSize: '0.82rem', userSelect: 'none', transition: 'all 0.15s' 
                }}>
                  <input type="checkbox" checked={checked} onChange={e => {
                    const isChecked = e.target.checked;
                    setEditingServices(p => {
                      const next = isChecked ? [...p, svc.id] : p.filter(id => id !== svc.id);
                      const autoPrice = availableServices.filter(s => next.includes(s.id)).reduce((sum, s) => sum + (s.price || 0), 0);
                      setEditingPrice(autoPrice.toString());
                      return next;
                    });
                  }} style={{ display: 'none' }} />
                  {checked && <CheckCircle size={12} color="var(--color-primary)" />}
                  {svc.name} 
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>${svc.price}</span>
                  {svc.isHistorical && !checked && <span style={{ fontSize: '0.65rem', color: '#ef4444', marginLeft: '2px' }}>(Deleted)</span>}
                </label>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" style={{ flex: 1, padding: '0.8rem' }} onClick={onClose}>
            <X size={16} /> Cancel
          </button>
          <button className="btn btn-primary" style={{ flex: 1, padding: '0.8rem' }} onClick={handleSave}>
            <Save size={16} /> Save Changes
          </button>
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
};

export default VisitEditModal;
