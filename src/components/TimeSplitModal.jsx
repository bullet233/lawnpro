import { useState, useMemo } from 'react';
import { Clock, CheckCircle, AlertTriangle } from 'lucide-react';

const fmt = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Tappable "usual time" hint — tells the driver what this lawn normally takes so a
// bad-looking default is easy to correct; tapping it fills the minutes input.
function AvgHint({ secs, source, count, onUse }) {
  if (!secs || secs <= 0) return null;
  const mins = Math.max(1, Math.round(secs / 60));
  const label = source === 'estimate'
    ? `📐 est ${mins} min (lawn size)`
    : `📊 avg ${mins} min${count > 0 ? ` · ${count} visit${count === 1 ? '' : 's'}` : ''}`;
  return (
    <button
      onClick={() => onUse(mins)}
      style={{
        border: '1px solid var(--color-border)', background: 'var(--color-bg-card)',
        borderRadius: '999px', padding: '0.15rem 0.55rem', cursor: 'pointer',
        fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap'
      }}
      title="Tap to use this time"
    >
      {label}
    </button>
  );
}

/**
 * TimeSplitModal
 * Props:
 *   primaryName   — string
 *   companions    — array of { id, name, dist }
 *   totalSecs     — number: total tracked seconds from primary job
 *   jobStart      — number: timestamp of when the job started (geofence entry)
 *   onConfirm     — ({ primaryMins, companionsMins, mode }) => void
 *   onClose       — () => void
 */
export default function TimeSplitModal({ primaryName, primaryExpectedSecs, primaryVisitCount, primaryPrice, companions, totalSecs, jobStart, onConfirm, onClose }) {
  const totalMins = Math.max(1, Math.round(totalSecs / 60));
  const numProps = 1 + (companions ? companions.length : 0);

  // Sequential default: divide the tracked total in proportion to each lawn's
  // expected time (own history, else the trend-curve estimate) instead of an even
  // split — so a big lawn paired with a small one starts at, say, 20/10 not 15/15.
  // Falls back to an even split when no expectation data is available.
  const proportional = useMemo(() => {
    const weights = [Math.max(0, primaryExpectedSecs || 0), ...(companions || []).map(c => Math.max(0, c.expectedSecs || 0))];
    const sumW = weights.reduce((s, x) => s + x, 0);
    if (sumW <= 0) {
      const even = Math.max(1, Math.floor(totalMins / numProps));
      return { primary: Math.max(1, totalMins - even * (numProps - 1)), comps: (companions || []).map(() => even) };
    }
    const rounded = weights.map(w => Math.max(1, Math.round((w / sumW) * totalMins)));
    const drift = totalMins - rounded.reduce((s, x) => s + x, 0);
    rounded[0] = Math.max(1, rounded[0] + drift); // absorb rounding onto the primary
    return { primary: rounded[0], comps: rounded.slice(1) };
  }, []);

  const [mode, setMode] = useState('sequential'); // 'sequential' | 'simultaneous'

  const [primaryMins, setPrimaryMins] = useState(proportional.primary);
  const [companionsMins, setCompanionsMins] = useState(() =>
    (companions || []).map((c, i) => ({ id: c.id, mins: proportional.comps[i] }))
  );

  const [fallbackStart] = useState(() => Date.now() - totalSecs * 1000);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    if (newMode === 'simultaneous') {
      setPrimaryMins(totalMins);
      setCompanionsMins(companions.map(c => ({ id: c.id, mins: totalMins })));
    } else {
      setPrimaryMins(proportional.primary);
      setCompanionsMins(companions.map((c, i) => ({ id: c.id, mins: proportional.comps[i] })));
    }
  };

  const updateCompMins = (id, newMins) => {
    setCompanionsMins(prev => prev.map(c => c.id === id ? { ...c, mins: newMins } : c));
  };

  const pm = Math.max(1, Number(primaryMins) || 1);

  // Live time preview calculation
  const times = useMemo(() => {
    const start = jobStart ?? fallbackStart;
    const res = { primary: null, companions: {} };

    if (mode === 'sequential') {
      const primaryEnd = start + pm * 60000;
      res.primary = { entry: start, exit: primaryEnd };
      
      let curr = primaryEnd;
      for (const comp of companionsMins) {
        const cMins = Math.max(1, Number(comp.mins) || 1);
        res.companions[comp.id] = { entry: curr, exit: curr + cMins * 60000 };
        curr += cMins * 60000;
      }
    } else {
      // Simultaneous: both start together, each has own duration
      res.primary = { entry: start, exit: start + pm * 60000 };
      for (const comp of companionsMins) {
        const cMins = Math.max(1, Number(comp.mins) || 1);
        res.companions[comp.id] = { entry: start, exit: start + cMins * 60000 };
      }
    }
    return res;
  }, [mode, pm, companionsMins, jobStart, totalSecs]);

  const totalCompMins = companionsMins.reduce((s, c) => s + Math.max(1, Number(c.mins) || 1), 0);
  const allocatedMins = pm + totalCompMins;
  
  const balanced = allocatedMins === totalMins;
  const overAllocated = mode === 'sequential' && allocatedMins > totalMins;

  const handleConfirm = () => {
    // Clamp companion minutes the same way the primary is clamped — a blanked-out
    // input must not log a 0-minute (entry == exit) visit that pollutes the curve.
    const cleanComps = companionsMins.map(c => ({ id: c.id, mins: Math.max(1, Number(c.mins) || 1) }));
    onConfirm({ primaryMins: pm, companionsMins: cleanComps, mode });
    onClose();
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div className="modal-content" style={{ maxWidth: '400px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.2rem', flexShrink: 0 }}>
          <div style={{ fontSize: '1.8rem', marginBottom: '0.4rem' }}>⏱️</div>
          <h3 style={{ margin: '0 0 0.3rem 0' }}>Split Job Time</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Total tracked: <strong>{totalMins} min</strong>
            {jobStart && <span> • Started {fmt(jobStart)}</span>}
          </p>
        </div>

        {/* Mode Toggle */}
        <div style={{ display: 'flex', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', padding: '4px', marginBottom: '1.2rem', gap: '4px', flexShrink: 0 }}>
          {['sequential', 'simultaneous'].map(m => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              style={{
                flex: 1, padding: '0.5rem', border: 'none', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, transition: 'all 0.15s',
                background: mode === m ? 'var(--color-bg-card)' : 'transparent',
                color: mode === m ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                boxShadow: mode === m ? 'var(--shadow-sm)' : 'none'
              }}
            >
              {m === 'sequential' ? '➖ Sequential' : '➕ Simultaneous'}
            </button>
          ))}
        </div>

        {/* Mode description */}
        <p style={{ margin: '0 0 1rem 0', fontSize: '0.78rem', color: 'var(--color-text-muted)', textAlign: 'center', flexShrink: 0 }}>
          {mode === 'sequential'
            ? 'Properties were done back-to-back.'
            : 'Properties were worked at the exact same time.'}
        </p>

        {/* Property Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginBottom: '1rem', overflowY: 'auto', paddingRight: '4px' }}>
          {/* Primary Input */}
          <div style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: `1px solid var(--color-border)`, padding: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{primaryName}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Primary job</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input
                  type="number"
                  min="1"
                  value={primaryMins}
                  onChange={e => setPrimaryMins(e.target.value)}
                  className="input-field"
                  style={{ width: '60px', textAlign: 'center', padding: '0.4rem', fontSize: '1rem', fontWeight: 700 }}
                />
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>min</span>
              </div>
            </div>
            {/* Live time preview + usual-time hint */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Clock size={11} />
                {fmt(times.primary.entry)} → {fmt(times.primary.exit)}
              </div>
              <AvgHint secs={primaryExpectedSecs} source="history" count={primaryVisitCount || 0} onUse={setPrimaryMins} />
            </div>
          </div>

          {/* Companions Inputs */}
          {companions.map(comp => {
            const compState = companionsMins.find(c => c.id === comp.id);
            const t = times.companions[comp.id];
            return (
              <div key={comp.id} style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: `1px solid rgba(16,185,129,0.4)`, padding: '0.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{comp.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>🌱 Nearby property</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <input
                      type="number"
                      min="1"
                      value={compState?.mins || 1}
                      onChange={e => updateCompMins(comp.id, e.target.value)}
                      className="input-field"
                      style={{ width: '60px', textAlign: 'center', padding: '0.4rem', fontSize: '1rem', fontWeight: 700 }}
                    />
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>min</span>
                  </div>
                </div>
                {/* Live time preview + usual-time hint */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                  {t && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Clock size={11} />
                      {fmt(t.entry)} → {fmt(t.exit)}
                    </div>
                  )}
                  <AvgHint secs={comp.expectedSecs} source={comp.expectedSource} count={comp.visitCount || 0} onUse={(mins) => updateCompMins(comp.id, mins)} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Allocation Indicator — sequential only */}
        {mode === 'sequential' && (
          <div style={{
            flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            padding: '0.5rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem',
            background: balanced ? 'rgba(16,185,129,0.1)' : overAllocated ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
            border: `1px solid ${balanced ? 'rgba(16,185,129,0.4)' : overAllocated ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)'}`,
            fontSize: '0.8rem', fontWeight: 600,
            color: balanced ? 'var(--color-primary)' : overAllocated ? '#ef4444' : '#f59e0b'
          }}>
            {balanced
              ? <><CheckCircle size={13} /> Allocated: {allocatedMins} / {totalMins} min</>
              : overAllocated
              ? <><AlertTriangle size={13} /> Over by {allocatedMins - totalMins} min</>
              : <><AlertTriangle size={13} /> {totalMins - allocatedMins} min unaccounted</>
            }
          </div>
        )}

        {/* Simultaneous soft warning if either exceeds total */}
        {mode === 'simultaneous' && (pm > totalMins || companionsMins.some(c => c.mins > totalMins)) && (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', fontSize: '0.8rem', color: '#f59e0b' }}>
            <AlertTriangle size={13} /> One property exceeds the tracked total of {totalMins} min
          </div>
        )}

        {/* Cluster economics — the combined $/hr is the number that says whether
            pairing these lawns into one stop was actually worth it. */}
        {(() => {
          const totalPrice = (primaryPrice || 0) + (companions || []).reduce((s, c) => s + (c.mowPrice || 0), 0);
          if (totalPrice <= 0) return null;
          const combinedRate = totalPrice / (totalMins / 60);
          const rateColor = combinedRate >= 60 ? 'var(--color-primary)' : combinedRate < 45 ? '#ef4444' : '#f59e0b';
          return (
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.55rem 0.8rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                ${totalPrice.toFixed(0)} across {numProps} · {totalMins} min
              </span>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, color: rateColor }}>${combinedRate.toFixed(0)}/hr</span>
            </div>
          );
        })()}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.8rem', flexShrink: 0 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </button>
          {/* Over-allocating in sequential mode would log more minutes than were
              actually tracked — companion exit times would land in the future and
              fabricate fast-pace data. Block it; the red "Over by X min" banner
              above explains what to trim. */}
          <button
            className="btn btn-primary"
            style={{ flex: 2, opacity: overAllocated ? 0.5 : 1 }}
            disabled={overAllocated}
            onClick={handleConfirm}
          >
            <Clock size={16} /> Log All {numProps} Properties
          </button>
        </div>
      </div>
    </div>
  );
}
