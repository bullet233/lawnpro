import { useState, useMemo } from 'react';
import { Clock, CheckCircle, AlertTriangle } from 'lucide-react';

const fmt = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * TimeSplitModal
 * Props:
 *   primaryName   — string
 *   companionName — string
 *   totalSecs     — number: total tracked seconds from primary job
 *   jobStart      — number: timestamp of when the job started (geofence entry)
 *   onConfirm     — ({ primaryMins, companionMins, mode }) => void
 *   onClose       — () => void
 */
export default function TimeSplitModal({ primaryName, companionName, totalSecs, jobStart, onConfirm, onClose }) {
  const totalMins = Math.max(1, Math.round(totalSecs / 60));

  const [mode, setMode] = useState('sequential'); // 'sequential' | 'simultaneous'
  const [primaryMins, setPrimaryMins] = useState(Math.ceil(totalMins / 2));
  const [companionMins, setCompanionMins] = useState(Math.floor(totalMins / 2));

  const pm = Math.max(1, Number(primaryMins) || 1);
  const cm = Math.max(1, Number(companionMins) || 1);

  // Live time preview calculation
  const times = useMemo(() => {
    const start = jobStart ?? (Date.now() - totalSecs * 1000);
    if (mode === 'sequential') {
      const primaryEnd = start + pm * 60000;
      return {
        primary:   { entry: start,       exit: primaryEnd },
        companion: { entry: primaryEnd,  exit: start + totalSecs * 1000 }
      };
    } else {
      // Simultaneous: both start together, each has own duration
      return {
        primary:   { entry: start, exit: start + pm * 60000 },
        companion: { entry: start, exit: start + cm * 60000 }
      };
    }
  }, [mode, pm, cm, jobStart, totalSecs]);

  const allocatedMins = pm + cm;
  const balanced = allocatedMins === totalMins;
  const overAllocated = mode === 'sequential' && allocatedMins > totalMins;

  const handleConfirm = () => {
    onConfirm({ primaryMins: pm, companionMins: cm, mode });
    onClose();
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div className="modal-content" style={{ maxWidth: '400px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
          <div style={{ fontSize: '1.8rem', marginBottom: '0.4rem' }}>⏱</div>
          <h3 style={{ margin: '0 0 0.3rem 0' }}>Split Job Time</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Total tracked: <strong>{totalMins} min</strong>
            {jobStart && <span> · Started {fmt(jobStart)}</span>}
          </p>
        </div>

        {/* Mode Toggle */}
        <div style={{ display: 'flex', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', padding: '4px', marginBottom: '1.2rem', gap: '4px' }}>
          {['sequential', 'simultaneous'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1, padding: '0.5rem', border: 'none', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, transition: 'all 0.15s',
                background: mode === m ? 'var(--color-bg-card)' : 'transparent',
                color: mode === m ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                boxShadow: mode === m ? 'var(--shadow-sm)' : 'none'
              }}
            >
              {m === 'sequential' ? '▶ Sequential' : '⇌ Simultaneous'}
            </button>
          ))}
        </div>

        {/* Mode description */}
        <p style={{ margin: '0 0 1rem 0', fontSize: '0.78rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
          {mode === 'sequential'
            ? 'Property A was done first, then Property B.'
            : 'Both properties were worked at the same time.'}
        </p>

        {/* Property Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginBottom: '1rem' }}>
          {[
            { label: primaryName, subtitle: 'Primary job', mins: primaryMins, setMins: setPrimaryMins, times: times.primary, color: 'var(--color-border)' },
            { label: companionName, subtitle: '📍 Nearby property', mins: companionMins, setMins: setCompanionMins, times: times.companion, color: 'rgba(16,185,129,0.4)' }
          ].map(({ label, subtitle, mins, setMins, times: t, color }) => (
            <div key={label} style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: `1px solid ${color}`, padding: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{subtitle}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="number"
                    min="1"
                    value={mins}
                    onChange={e => setMins(e.target.value)}
                    className="input-field"
                    style={{ width: '60px', textAlign: 'center', padding: '0.4rem', fontSize: '1rem', fontWeight: 700 }}
                  />
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>min</span>
                </div>
              </div>
              {/* Live time preview */}
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Clock size={11} />
                {fmt(t.entry)} → {fmt(t.exit)}
              </div>
            </div>
          ))}
        </div>

        {/* Allocation Indicator — sequential only */}
        {mode === 'sequential' && (
          <div style={{
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
        {mode === 'simultaneous' && (pm > totalMins || cm > totalMins) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', fontSize: '0.8rem', color: '#f59e0b' }}>
            <AlertTriangle size={13} /> One property exceeds the tracked total of {totalMins} min
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.8rem' }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleConfirm}>
            <Clock size={16} /> Log Both Properties
          </button>
        </div>
      </div>
    </div>
  );
}
