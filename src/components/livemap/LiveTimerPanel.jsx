import { useState, useEffect } from 'react';
import { X, Play, Pause, FileText, Sun, CloudSun, Cloud, CloudDrizzle, CloudSnow, CloudLightning, CloudRain } from 'lucide-react';
import { formatLiveTimer } from '../../utils/dateUtils';
import SlideToFinish from '../SlideToFinish';
import CustomerDetailsDropdown from './CustomerDetailsDropdown';
import { useServiceMode } from '../ServiceProvider';
import { comparableVisits, isLeafVisit, isMowVisit } from '../../utils/leaves';
import TodaysMixModal from './TodaysMixModal';
import { getTodaysMix, peekStopMix, setStopMix, clearStopMix } from '../../utils/todaysMix';

const HERO = {
  mowing:     { bg: '#047857', soft: '#a7f3d0' },
  fertilizer: { bg: '#1d4ed8', soft: '#bfdbfe' }
};
const PAUSED = { bg: '#b45309', soft: '#fde68a' };

function WeatherIcon({ code, size = 14 }) {
  let Icon = CloudRain;
  if (code === 0) Icon = Sun;
  else if (code <= 2) Icon = CloudSun;
  else if (code === 3 || code <= 49) Icon = Cloud;
  else if (code <= 55) Icon = CloudDrizzle;
  else if (code <= 77 || code <= 86) Icon = CloudSnow;
  else if (code <= 99) Icon = CloudLightning;
  return <Icon size={size} color="rgba(255,255,255,0.9)" />;
}

export default function LiveTimerPanel({
  activeGeofence,
  timerState,
  liveDuration,
  weather,
  liveNote,
  setShowLiveNoteModal,
  setDialog,
  togglePause,
  handleManualDone,
  onCancelJob,
  allVisits,
  globalPace,
  isLeafJob = false,
  onToggleLeafJob,
}) {
  const { activeMode } = useServiceMode();
  // Per-lawn product pick: set while still on the property so even a geofence
  // auto-exit files the right EPA log for THIS lawn (overrides the day mix).
  const [stopMix, setStopMixState] = useState(() => activeGeofence ? peekStopMix(activeGeofence.id) : null);
  const [showStopMixModal, setShowStopMixModal] = useState(false);
  const custId = activeGeofence?.id;
  useEffect(() => { setStopMixState(custId != null ? peekStopMix(custId) : null); }, [custId]);
  if (!activeGeofence) return null;

  const isPaused = timerState === 'paused';
  const theme = isPaused ? PAUSED : (HERO[activeMode] || HERO.mowing);

  // Pace cue: compare the running clock to this customer's average duration.
  // A job marked as a leaf job is compared with this lawn's leaf visits once
  // it has any (against a normal mow time it would always read "over").
  let paceCue = null;
  const leafJob = activeMode === 'mowing' && isLeafJob;
  if (allVisits) {
    const compared = comparableVisits(
      allVisits.filter(v => v.customerId === activeGeofence.id && v.status === 'completed' && v.durationSecs >= 60 &&
        (activeMode !== 'mowing' || isMowVisit(v))), // a Fall Clean-up is not this lawn's usual mow
      leafJob
    );
    const durs = compared.map(v => v.durationSecs);
    if (durs.length > 0) {
      const avg = durs.reduce((a, b) => a + b, 0) / durs.length;
      const avgMin = Math.round(avg / 60);
      const over = liveDuration > avg + 60;
      const label = leafJob && isLeafVisit(compared[0]) ? 'leaf avg' : leafJob ? 'mow avg' : 'avg';
      // Neutral "avg ~Xm" until the clock actually passes the average — being
      // "ahead" 30 seconds into a job is noise, not information.
      paceCue = over
        ? { text: `over ~${avgMin}m ${label}`, color: PAUSED.soft }
        : { text: `${label} ~${avgMin}m`, color: 'rgba(255,255,255,0.75)' };
    }
  }

  const handleCancel = () => {
    setDialog({
      type: 'warning',
      title: 'Discard Active Job?',
      message: 'Are you sure you want to cancel this job? This will reset the timer and discard any unsaved work.',
      onConfirm: () => { onCancelJob(); setDialog(null); },
      onCancel: () => setDialog(null)
    });
  };

  return (
    <div className="animate-fade-in" style={{
      padding: '1rem 1rem 1.1rem',
      background: theme.bg,
      borderRadius: '1.5rem',
      color: 'white',
      border: 'none',
      boxShadow: `0 10px 32px ${theme.bg}59`,
      transition: 'background 0.3s ease'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.7rem', letterSpacing: '1.2px', fontWeight: 800, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase' }}>
            {activeMode} · Now
          </div>
          <strong style={{ fontSize: '1.4rem', display: 'block', lineHeight: 1.1 }}>{activeGeofence.name}</strong>
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)' }}>{activeGeofence.address}</div>
          {weather && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.35rem', color: 'rgba(255,255,255,0.9)', fontSize: '0.8rem', fontWeight: 600 }}>
              <WeatherIcon code={weather.code ?? 0} />
              <span>{weather.temp}°F · {weather.wind} mph</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.1rem', flexShrink: 0 }}>
          <button onClick={() => setShowLiveNoteModal(true)} aria-label="Add note"
            style={{ background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: '999px', color: '#fff', cursor: 'pointer', padding: '0.5rem 0.9rem', minHeight: '40px', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <FileText size={18} /> Note
          </button>
        </div>
      </div>

      {liveNote && (
        <div style={{ fontSize: '0.8rem', color: '#fff', marginTop: '0.5rem', fontWeight: 500, display: 'flex', alignItems: 'flex-start', gap: '0.35rem', background: 'rgba(255,255,255,0.15)', padding: '0.45rem 0.6rem', borderRadius: 'var(--radius-sm)' }}>
          <FileText size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
          <span style={{ fontStyle: 'italic' }}>{liveNote}</span>
        </div>
      )}

      {/* Compact timer bar — status + pace on the left, time + pause on the right */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', background: 'rgba(0,0,0,0.18)', borderRadius: 'var(--radius-md)', padding: '0.6rem 0.9rem', margin: '0.9rem 0' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', letterSpacing: '1px', fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: isPaused ? PAUSED.soft : theme.soft, display: 'inline-block' }} />
            {isPaused ? 'TIMER PAUSED' : leafJob ? 'JOB RUNNING · 🍂 LEAVES' : 'JOB RUNNING'}
          </div>
          {paceCue && <div style={{ fontSize: '0.75rem', color: paceCue.color, fontWeight: 700, marginTop: '2px' }}>{paceCue.text}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
          <button onClick={togglePause} aria-label={isPaused ? 'Resume timer' : 'Pause timer'}
            style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'rgba(255,255,255,0.25)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {isPaused ? <Play size={18} fill="white" /> : <Pause size={18} fill="white" />}
          </button>
          <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: 'white' }}>
            {formatLiveTimer(liveDuration)}
          </div>
        </div>
      </div>

      {/* Leaf job toggle (mowing): one tap any time during the job. The whole
          job is then logged as a leaf visit, kept out of normal mow times. */}
      {activeMode === 'mowing' && onToggleLeafJob && (
        <button
          onClick={onToggleLeafJob}
          aria-pressed={isLeafJob}
          style={{
            width: '100%', minHeight: '46px', marginBottom: '0.9rem', padding: '0.6rem 0.9rem', cursor: 'pointer',
            borderRadius: 'var(--radius-md)', textAlign: 'left', fontSize: '0.9rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            border: isLeafJob ? '2px solid #fff' : '1px dashed rgba(255,255,255,0.6)',
            background: isLeafJob ? '#fff' : 'rgba(255,255,255,0.12)',
            color: isLeafJob ? '#b45309' : '#fff'
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>🍂</span>
          {isLeafJob
            ? <span>Leaf job ✓ <span style={{ fontWeight: 500 }}>— tap to undo</span></span>
            : <span>Picking up leaves? <span style={{ fontWeight: 500 }}>Tap to mark as a leaf job</span></span>}
        </button>
      )}

      {/* Per-lawn products (fert mode): what will file on exit — this lawn's
          own pick, else the day mix, else a manual log. */}
      {activeMode === 'fertilizer' && (() => {
        const dayMix = getTodaysMix();
        return (
          <button
            onClick={() => setShowStopMixModal(true)}
            style={{
              width: '100%', marginBottom: '0.9rem', padding: '0.6rem 0.9rem', cursor: 'pointer',
              borderRadius: 'var(--radius-md)', border: 'none', textAlign: 'left',
              background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.8rem', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}
          >
            <span>🧪</span>
            {stopMix
              ? <span>This lawn: {stopMix.products.map(p => p.productName).join(' + ')} ✓</span>
              : dayMix
                ? <span>Will log day mix — tap if this lawn is different</span>
                : <span>Pick this lawn's products (EPA log files on exit)</span>}
          </button>
        );
      })()}

      {showStopMixModal && (
        <TodaysMixModal
          title="🧪 This Lawn's Products"
          blurb={`What are you applying at ${activeGeofence.name}? The EPA log for this stop files with these products when you finish — overriding the day mix for this lawn only.`}
          saveLabel="Set for this lawn"
          clearLabel="Remove — use day mix / manual"
          initialMix={stopMix || getTodaysMix()}
          onSave={(products, mixSite) => {
            setStopMixState(setStopMix(activeGeofence.id, products, mixSite));
            setShowStopMixModal(false);
          }}
          onClear={() => {
            clearStopMix();
            setStopMixState(null);
            setShowStopMixModal(false);
          }}
          onClose={() => setShowStopMixModal(false)}
        />
      )}

      <CustomerDetailsDropdown customer={activeGeofence} allVisits={allVisits} globalPace={globalPace} darkTheme={false} isLeafJob={leafJob} />

      <div style={{ marginTop: '0.9rem' }}>
        <SlideToFinish onComplete={handleManualDone} />
      </div>

      {/* Cancel lives down here on its own, well away from Note and Pause. */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.5rem' }}>
        <button onClick={handleCancel} aria-label="Cancel job"
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', padding: '0.5rem 1rem', minHeight: '40px', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <X size={15} /> Cancel job (don't save)
        </button>
      </div>
    </div>
  );
}
