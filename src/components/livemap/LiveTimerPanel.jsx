import { useState, useEffect } from 'react';
import { X, Play, Pause, FileText, BarChart3, ChevronDown, ChevronUp, Info, Leaf, Sun, CloudSun, Cloud, CloudDrizzle, CloudSnow, CloudLightning, CloudRain } from 'lucide-react';
import { formatLiveTimer } from '../../utils/dateUtils';
import SlideToFinish from '../SlideToFinish';
import CustomerDetailsDropdown from './CustomerDetailsDropdown';
import { useServiceMode } from '../ServiceProvider';
import { comparableVisits, isLeafVisit, isMowVisit } from '../../utils/leaves';
import TodaysMixModal from './TodaysMixModal';
import { getTodaysMix, peekStopMix, setStopMix, clearStopMix } from '../../utils/todaysMix';

// Buttons and the slider use the division colour (green mowing, blue
// fertilizer); paused turns everything red. The timer and the status badge are
// amber while a job runs, red when paused. The card stays white with dark text
// so it reads in the sun.
const THEME = {
  mowing:     { accent: '#047857', tint: '#E1F5EE', ink: '#065f46' },
  fertilizer: { accent: '#1d4ed8', tint: '#E6F1FB', ink: '#0C447C' },
  paused:     { accent: '#b91c1c', tint: '#FCEBEB', ink: '#991b1b' },
};
const AMBER = '#b45309';

function WeatherIcon({ code, size = 14 }) {
  let Icon = CloudRain;
  if (code === 0) Icon = Sun;
  else if (code <= 2) Icon = CloudSun;
  else if (code === 3 || code <= 49) Icon = Cloud;
  else if (code <= 55) Icon = CloudDrizzle;
  else if (code <= 77 || code <= 86) Icon = CloudSnow;
  else if (code <= 99) Icon = CloudLightning;
  return <Icon size={size} />;
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
  detailsOpen,
  onToggleDetails,
}) {
  const { activeMode } = useServiceMode();
  // Per-lawn product pick: set while still on the property so even a geofence
  // auto-exit files the right EPA log for THIS lawn (overrides the day mix).
  const [stopMix, setStopMixState] = useState(() => activeGeofence ? peekStopMix(activeGeofence.id) : null);
  const [showStopMixModal, setShowStopMixModal] = useState(false);
  const [ownDetails, setOwnDetails] = useState(false);
  const custId = activeGeofence?.id;
  useEffect(() => { setStopMixState(custId != null ? peekStopMix(custId) : null); }, [custId]);
  if (!activeGeofence) return null;

  const showDetails = detailsOpen ?? ownDetails;
  const toggleDetails = onToggleDetails || (() => setOwnDetails(v => !v));

  const isPaused = timerState === 'paused';
  const theme = isPaused ? THEME.paused : (THEME[activeMode] || THEME.mowing);
  const status = isPaused
    ? { ink: THEME.paused.ink, tint: THEME.paused.tint, clock: '#b91c1c' }
    : { ink: '#854F0B', tint: '#FAEEDA', clock: '#b45309' };

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
      // Neutral "avg ~X min" until the clock actually passes the average — being
      // "ahead" 30 seconds into a job is noise, not information.
      paceCue = over
        ? { text: `over ~${avgMin} min ${label}`, color: AMBER }
        : { text: `${label} ~${avgMin} min`, color: 'var(--color-text-muted)' };
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

  const sideBtn = { display: 'flex', alignItems: 'center', gap: '0.35rem', minHeight: '44px', padding: '0.5rem 0.85rem', borderRadius: '12px', cursor: 'pointer', fontSize: '0.92rem', fontWeight: 700, border: '1px solid var(--color-border)', background: 'var(--color-bg-main)', color: 'var(--color-text-main)', whiteSpace: 'nowrap' };

  return (
    <div className="animate-fade-in" style={{
      padding: '0.9rem 1rem 0.6rem',
      background: '#ffffff',
      borderRadius: '1.25rem',
      color: 'var(--color-text-main)',
      border: '1px solid var(--color-border)',
      boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
    }}>
      {/* Who and the clock */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.8rem' }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: '0.72rem', letterSpacing: '1px', fontWeight: 800, textTransform: 'uppercase', color: status.ink, background: status.tint, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
            {isPaused ? 'Paused' : `${activeMode} · now`}{leafJob ? ' · leaves' : ''}
          </span>
          <button onClick={toggleDetails} aria-expanded={showDetails} aria-label={`${activeGeofence.name} — ${showDetails ? 'hide' : 'show'} job details`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'none', border: 'none', padding: 0, marginTop: '0.3rem', cursor: 'pointer', color: 'var(--color-text-main)', textAlign: 'left' }}>
            <strong style={{ fontSize: '1.6rem', lineHeight: 1.1 }}>{activeGeofence.name}</strong>
            {showDetails ? <ChevronUp size={20} color="var(--color-text-muted)" /> : <ChevronDown size={20} color="var(--color-text-muted)" />}
          </button>
          <div style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>{activeGeofence.address}</div>
          {weather && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.2rem', color: 'var(--color-text-muted)', fontSize: '0.82rem', fontWeight: 600 }}>
              <WeatherIcon code={weather.code ?? 0} />
              <span>{weather.temp}°F · {weather.wind} mph</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexShrink: 0 }}>
          <div style={{ fontSize: '2.2rem', fontWeight: 800, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: status.clock }}>
            {formatLiveTimer(liveDuration)}
          </div>
          <button onClick={togglePause} aria-label={isPaused ? 'Resume timer' : 'Pause timer'}
            style={{ width: '60px', height: '60px', borderRadius: '50%', background: theme.accent, border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {isPaused ? <Play size={26} fill="white" /> : <Pause size={26} fill="white" />}
          </button>
        </div>
      </div>

      {/* Status + quick buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', margin: '0.8rem 0', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)' }}>
          <BarChart3 size={20} />
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontSize: '0.72rem', letterSpacing: '1px', fontWeight: 800 }}>{isPaused ? 'TIMER PAUSED' : 'JOB RUNNING'}</div>
            {paceCue && <div style={{ fontSize: '0.9rem', fontWeight: 700, color: paceCue.color }}>{paceCue.text}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button onClick={() => setShowLiveNoteModal(true)} aria-label="Add note" style={sideBtn}>
            <FileText size={17} /> Note
          </button>
          {activeMode === 'mowing' && onToggleLeafJob && (
            <button onClick={onToggleLeafJob} aria-pressed={isLeafJob} title={isLeafJob ? 'Leaf job — tap to undo' : 'Mark as a leaf job'}
              style={{ ...sideBtn, ...(isLeafJob ? { background: 'rgba(180,83,9,0.12)', border: `2px solid ${AMBER}`, color: AMBER } : {}) }}>
              <Leaf size={17} color={isLeafJob ? AMBER : '#3B6D11'} /> {isLeafJob ? 'Leaf job ✓' : 'Leaf job'}
            </button>
          )}
        </div>
      </div>

      {liveNote && (
        <div style={{ fontSize: '0.92rem', marginBottom: '0.7rem', display: 'flex', alignItems: 'flex-start', gap: '0.4rem', background: 'var(--color-bg-main)', padding: '0.5rem 0.7rem', borderRadius: '10px' }}>
          <FileText size={15} style={{ marginTop: '2px', flexShrink: 0, color: 'var(--color-text-muted)' }} />
          <span style={{ fontStyle: 'italic' }}>{liveNote}</span>
        </div>
      )}

      {/* Per-lawn products (fert mode): what will file on exit — this lawn's
          own pick, else the day mix, else a manual log. */}
      {activeMode === 'fertilizer' && (() => {
        const dayMix = getTodaysMix();
        return (
          <button
            onClick={() => setShowStopMixModal(true)}
            style={{
              width: '100%', marginBottom: '0.7rem', padding: '0.6rem 0.9rem', minHeight: '44px', cursor: 'pointer',
              borderRadius: '12px', border: '1px solid var(--color-border)', textAlign: 'left',
              background: THEME.fertilizer.tint, color: THEME.fertilizer.ink, fontSize: '0.88rem', fontWeight: 700,
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

      {/* Job details — opened from the name or the Details button */}
      {showDetails && (
        <CustomerDetailsDropdown customer={activeGeofence} allVisits={allVisits} globalPace={globalPace} isLeafJob={leafJob}
          open onToggle={toggleDetails} showToggle={false} />
      )}

      <SlideToFinish onComplete={handleManualDone} accent={theme.accent} tint={theme.tint} ink={theme.ink} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', marginTop: '0.6rem' }}>
        <button onClick={toggleDetails} aria-expanded={showDetails}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem 0.2rem', minHeight: '44px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Info size={16} /> {showDetails ? 'Hide details' : 'Details'}
        </button>
        {/* Cancel lives down here on its own, well away from Note and Pause. */}
        <button onClick={handleCancel} aria-label="Cancel job"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem 0.2rem', minHeight: '44px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <X size={15} /> Cancel job (don't save)
        </button>
      </div>
    </div>
  );
}
