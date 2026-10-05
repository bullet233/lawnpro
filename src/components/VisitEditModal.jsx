import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Save, X, CheckCircle } from 'lucide-react';
import { LEAF_CONDITION, computeLeafBilling, computeCleanupSuggestion, isCleanupVisit } from '../utils/leaves';
import { leafHourlyRate, usualMowSecs, syncLeafBilling } from '../utils/leafBilling';

// Formats a Date object to "HH:MM" for input type="time"
const fmtInputTime = (d) => {
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

const fmtInputDate = (d) => {
  if (!d) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const CONDITIONS = [
  // Leaves keeps the visit out of the lawn's plain mowing times (utils/leaves).
  { id: 'leaves', label: '🍂 Leaf job' },
  { id: 'overgrown', label: 'Overgrown' },
  { id: 'wet', label: 'Wet/Soggy' },
  { id: 'debris', label: 'Lots of Debris' },
  { id: 'dry', label: 'Dry/Burnt' }
];

const VisitEditModal = ({ job, customer, defaultServices, onClose, onSave }) => {
  const [editingServices, setEditingServices] = useState([]);
  const [editingConditions, setEditingConditions] = useState([]);
  const [editingNote, setEditingNote] = useState('');
  const [editingDuration, setEditingDuration] = useState('');
  const [editingDrive, setEditingDrive] = useState('');
  const [editingPrice, setEditingPrice] = useState('');
  const [editingDate, setEditingDate] = useState('');
  const [editingEntryTime, setEditingEntryTime] = useState('');
  const [editingExitTime, setEditingExitTime] = useState('');

  // Leaf job billing. Leaf time = minutes over this lawn's usual mow (filled
  // in automatically, can be typed over). Leaf time × the hourly leaf rate is
  // only a SUGGESTION; the Leaf charge box is what is actually charged, and
  // it is part of the Price. Blank = not decided yet.
  const [editingLeafMins, setEditingLeafMins] = useState('');
  const [editingLeafCharge, setEditingLeafCharge] = useState('');
  const [leafMinsTyped, setLeafMinsTyped] = useState(false);
  const [usualMow, setUsualMow] = useState(null);
  const leafRate = leafHourlyRate();
  // A clean-up (a non-mowing service, no mow) is priced on its own: flat
  // service price, or the whole visit at the hourly rate as a suggestion. It
  // can't also be a leaf job.
  const isCleanup = isCleanupVisit({ division: job?.division, appliedServices: editingServices });
  const isLeafJob = !isCleanup && editingConditions.includes(LEAF_CONDITION);
  const round2 = (n) => Math.round(n * 100) / 100;
  const cleanupSuggested = isCleanup
    ? computeCleanupSuggestion((parseInt(editingDuration) || 0) * 60, leafRate).leafCharge
    : 0;
  const leafSuggested = editingLeafMins === '' ? 0 : round2(((parseInt(editingLeafMins) || 0) / 60) * leafRate);

  useEffect(() => {
    if (!job) return;
    const wasLeafJob = Array.isArray(job.conditions) && job.conditions.includes(LEAF_CONDITION);
    setEditingLeafMins(wasLeafJob && job.leafSecs != null ? String(Math.round(job.leafSecs / 60)) : '');
    setEditingLeafCharge(job.leafDecided ? String(job.leafCharge || 0) : '');
    setLeafMinsTyped(false);
    let alive = true;
    usualMowSecs(job.customerId, job.id).then((secs) => { if (alive) setUsualMow(secs); });
    return () => { alive = false; };
  }, [job]);

  // Change the leaf charge ('' = undecided) and swap it inside the total price.
  const setLeafCharge = (text) => {
    const old = parseFloat(editingLeafCharge) || 0;
    const next = Math.max(0, parseFloat(text) || 0);
    setEditingLeafCharge(text);
    setEditingPrice((p) => String(round2(Math.max(0, (parseFloat(p) || 0) - old + next))));
  };

  const autoFillLeafMins = (durationMinsStr) => {
    const b = computeLeafBilling((parseInt(durationMinsStr) || 0) * 60, usualMow, leafRate);
    setEditingLeafMins(b.leafSecs == null ? '' : String(b.leafSecs / 60));
  };

  const changeDuration = (val) => {
    setEditingDuration(val);
    if (isLeafJob && !leafMinsTyped) autoFillLeafMins(val);
  };

  // Resolution logic to include services currently applied to the visit,
  // services active on the customer profile, and default services fallback.
  const [availableServices, setAvailableServices] = useState([]);

  useEffect(() => {
    if (job) {
      setEditingServices(job.appliedServices || []);
      setEditingConditions(job.conditions || []);
      setEditingPrice(job.priceEarned != null ? job.priceEarned.toString() : '0');
      setEditingDuration(Math.floor((job.durationSecs || 0) / 60).toString());
      setEditingDrive(Math.floor((job.driveTimeSecs || 0) / 60).toString());
      setEditingNote(job.note || '');
      setEditingDate(job.exitTime ? fmtInputDate(new Date(job.exitTime)) : '');
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
    // …plus their clean-up service even when it isn't a regular one, so a
    // mowing-division visit can be switched to a Fall Clean-up here.
    const isMowingVisit = !job?.division || job.division === 'mowing';
    customerServices.forEach(s => {
      if (s.active || (isMowingVisit && /clean|leaf/i.test(s.name || ''))) {
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
        changeDuration((end - start).toString());
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
    if (editingDate || editingEntryTime) {
      const d = job.entryTime ? new Date(job.entryTime) : new Date(job.createdAt || Date.now());
      if (editingDate) {
        const [y, mo, da] = editingDate.split('-');
        d.setFullYear(parseInt(y), parseInt(mo) - 1, parseInt(da));
      }
      if (editingEntryTime) {
        const [h, m] = editingEntryTime.split(':');
        d.setHours(parseInt(h), parseInt(m), 0);
      }
      updatedEntryTime = d.getTime();
    }

    let updatedExitTime = job.exitTime;
    if (editingDate || editingExitTime) {
      const d = job.exitTime ? new Date(job.exitTime) : new Date(job.createdAt || Date.now());
      if (editingDate) {
        const [y, mo, da] = editingDate.split('-');
        d.setFullYear(parseInt(y), parseInt(mo) - 1, parseInt(da));
      }
      if (editingExitTime) {
        const [h, m] = editingExitTime.split(':');
        d.setHours(parseInt(h), parseInt(m), 0);
      }
      updatedExitTime = d.getTime();
    }

    const updates = {
      priceEarned: newPrice, // total, leaf charge included
      durationSecs: updatedDurationSecs,
      driveTimeSecs: updatedDriveSecs,
      entryTime: updatedEntryTime,
      exitTime: updatedExitTime,
      appliedServices: editingServices,
      conditions: isCleanup ? editingConditions.filter(c => c !== LEAF_CONDITION) : editingConditions,
      note: editingNote || undefined
    };

    // Leaf job: store the leaf time, the suggestion, and what was charged
    // (already inside the price above). A blank charge = not decided yet.
    const leafCharge = isLeafJob ? Math.max(0, parseFloat(editingLeafCharge) || 0) : 0;
    updates.leafCharge = leafCharge;
    // (A clean-up's price was set right here in the editor, so it counts as decided.)
    updates.leafDecided = isCleanup || (isLeafJob && editingLeafCharge !== '');
    updates.leafSecs = !isLeafJob ? 0 : editingLeafMins === '' ? null : (parseInt(editingLeafMins) || 0) * 60;
    updates.leafSuggested = isLeafJob ? leafSuggested : 0;
    updates.cleanupFlatPrice = undefined; // the price was set by hand here
    updates.leafSecsManual = isLeafJob && (leafMinsTyped || !!job.leafSecsManual);

    // Construct new service details breakdown (services only — the leaf
    // charge is its own line, added by getVisitRevenueBreakdown)
    newPrice = round2(Math.max(0, newPrice - leafCharge));
    const serviceDetails = {};
    if (editingServices.length === 1) {
      serviceDetails[editingServices[0]] = newPrice;
    } else if (editingServices.length > 1) {
      // Try to match exact prices, otherwise dump all in first service
      let sum = 0;
      const temp = {};
      editingServices.forEach(sId => {
        const s = customer?.services?.find(x => x.id === sId) || defaultServices?.find(x => x.id === sId);
        if (s) {
          temp[sId] = s.price;
          sum += s.price;
        }
      });
      if (sum === newPrice && sum > 0) {
        Object.assign(serviceDetails, temp);
      } else {
        serviceDetails[editingServices[0]] = newPrice;
      }
    }
    updates.revenueBreakdown = serviceDetails;

    await onSave(updates);
    // Tagging / untagging / re-timing this visit shifts the lawn's usual mow,
    // so refresh the leaf time and suggestion on its leaf jobs.
    if (job?.id != null) await syncLeafBilling(job.id);
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
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ flex: 1 }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Date</label>
            <input type="date" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingDate} onChange={e => setEditingDate(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: '80px' }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Price ($)</label>
            <input type="number" step="0.01" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingPrice} onChange={e => setEditingPrice(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ flex: 1 }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Start Time</label>
            <input type="time" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingEntryTime} onChange={e => handleTimeChange('entry', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>End Time</label>
            <input type="time" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingExitTime} onChange={e => handleTimeChange('exit', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ flex: 1 }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Job Time (mins)</label>
            <input type="number" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingDuration} onChange={e => changeDuration(e.target.value)} />
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
                      const autoPrice = availableServices.filter(s => next.includes(s.id)).reduce((sum, s) => sum + (s.price || 0), 0)
                        + (isLeafJob ? (parseFloat(editingLeafCharge) || 0) : 0);
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

        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem', marginTop: '1rem' }}>
          Conditions:
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {CONDITIONS.filter(c => c.id !== LEAF_CONDITION || !isCleanup).map(c => {
            const checked = editingConditions.includes(c.id);
            return (
              <label key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.7rem',
                borderRadius: '999px', border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: checked ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-card)',
                cursor: 'pointer', fontSize: '0.82rem', userSelect: 'none', transition: 'all 0.15s'
              }}>
                <input type="checkbox" checked={checked} onChange={e => {
                  const isChecked = e.target.checked;
                  setEditingConditions(p => isChecked ? [...p, c.id] : p.filter(id => id !== c.id));
                  if (c.id === LEAF_CONDITION) {
                    setLeafMinsTyped(false);
                    if (isChecked) autoFillLeafMins(editingDuration);
                    else { setEditingLeafMins(''); setLeafCharge(''); }
                  }
                }} style={{ display: 'none' }} />
                {checked && <CheckCircle size={12} color="var(--color-primary)" />}
                {c.label}
              </label>
            );
          })}
        </div>

        {isCleanup && (
          <div style={{ marginTop: '-0.7rem', marginBottom: '1.5rem', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(180,83,9,0.35)', borderLeft: '4px solid #b45309', background: 'rgba(180,83,9,0.06)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#b45309', textTransform: 'uppercase', marginBottom: '0.4rem' }}>🍂 Clean-up, no mow</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-main)' }}>
                {leafRate > 0
                  ? `By the hour: ${parseInt(editingDuration) || 0} min × $${leafRate}/hr = $${cleanupSuggested.toFixed(2)}`
                  : 'No hourly leaf rate set'}
              </span>
              {cleanupSuggested > 0 && (
                <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }} onClick={() => setEditingPrice(String(cleanupSuggested))}>
                  Use suggested
                </button>
              )}
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0', lineHeight: 1.45 }}>
              The Price above is what this clean-up is charged — the flat service price unless you change it. The hourly figure is only a suggestion. This visit is not counted in the lawn's mowing times.
            </p>
          </div>
        )}

        {isLeafJob && (
          <div style={{ marginTop: '-0.7rem', marginBottom: '1.5rem', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(180,83,9,0.35)', borderLeft: '4px solid #b45309', background: 'rgba(180,83,9,0.06)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#b45309', textTransform: 'uppercase', marginBottom: '0.5rem' }}>🍂 Leaf billing</div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ flex: 1 }}>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Leaf time (mins)</label>
                <input type="number" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingLeafMins}
                  onChange={e => { setEditingLeafMins(e.target.value); setLeafMinsTyped(true); }} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem' }}>Leaf charge ($)</label>
                <input type="number" step="0.01" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingLeafCharge}
                  placeholder="not decided"
                  onChange={e => setLeafCharge(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-main)' }}>
                {leafRate > 0 ? `Suggested: $${leafSuggested.toFixed(2)}` : 'No hourly leaf rate set'}
              </span>
              {leafSuggested > 0 && (
                <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }} onClick={() => setLeafCharge(String(leafSuggested))}>
                  Use suggested
                </button>
              )}
              <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }} onClick={() => setLeafCharge('0')}>
                No charge
              </button>
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0', lineHeight: 1.45 }}>
              {usualMow
                ? `Leaf time is the job time over this lawn's usual ${Math.round(usualMow / 60)} min mow.`
                : 'No normal mow on record for this lawn, so enter the leaf time yourself.'}
              {leafRate > 0 ? ` The suggestion is that time at $${leafRate}/hr.` : ' Set an hourly leaf rate in Settings to get a suggestion.'} You
              decide the charge — whatever you enter is added to the Price above. Leave it blank to decide later.
            </p>
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
