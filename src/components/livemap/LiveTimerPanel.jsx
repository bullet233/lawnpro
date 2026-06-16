import { X, Play, Pause, FileText, Sun, CloudSun, Cloud, CloudDrizzle, CloudSnow, CloudLightning, CloudRain } from 'lucide-react';
import { formatLiveTimer } from '../../utils/dateUtils';
import SlideToFinish from '../SlideToFinish';

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
}) {
  if (!activeGeofence) return null;

  return (
    <div className="animate-fade-in" style={{
      padding: '1rem',
      background: timerState === 'running' ? 'rgba(16,185,129,0.95)' : 'rgba(245,158,11,0.95)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderRadius: '1.2rem',
      color: 'white',
      border: 'none',
      boxShadow: timerState === 'running' ? '0 10px 40px rgba(16,185,129,0.4)' : '0 10px 40px rgba(245,158,11,0.4)',
      transition: 'all 0.3s ease'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.8rem' }}>
        <div>
          <strong style={{ fontSize: '1.2rem', display: 'block', lineHeight: 1.2, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>{activeGeofence.name}</strong>
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)', marginTop: '2px' }}>{activeGeofence.address}</div>
          {weather && (() => {
            const code = weather.code ?? 0;
            let Icon = CloudRain;
            if (code === 0) Icon = Sun;
            else if (code <= 2) Icon = CloudSun;
            else if (code === 3 || code <= 49) Icon = Cloud;
            else if (code <= 55) Icon = CloudDrizzle;
            else if (code <= 77 || code <= 86) Icon = CloudSnow;
            else if (code <= 99) Icon = CloudLightning;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.4rem', color: 'white', fontSize: '0.8rem', fontWeight: 600 }}>
                <Icon size={14} color="rgba(255,255,255,0.9)" />
                <span>{weather.temp}°F · {weather.wind} mph</span>
              </div>
            );
          })()}
          {liveNote && (
            <div style={{ fontSize: '0.8rem', color: '#fcd34d', marginTop: '0.4rem', fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: '0.3rem' }}>
              <FileText size={14} style={{ marginTop: '2px' }} />
              <span style={{ fontStyle: 'italic' }}>{liveNote}</span>
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', display: 'flex', gap: '0.2rem' }}>
          <button
            onClick={() => setShowLiveNoteModal(true)}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '0.4rem', marginTop: '-0.4rem' }}
            title="Add Note"
          >
            <FileText size={20} />
          </button>
          <button
            onClick={() => {
              setDialog({
                type: 'warning',
                title: 'Discard Active Job?',
                message: 'Are you sure you want to cancel this job? This will reset the timer and discard any unsaved work.',
                onConfirm: () => {
                  onCancelJob();
                  setDialog(null);
                },
                onCancel: () => setDialog(null)
              });
            }}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '0.2rem', marginTop: '-0.2rem' }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.15)', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'rgba(255,255,255,0.9)' }}>
          {timerState === 'paused' ? 'TIMER PAUSED' : 'JOB RUNNING'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: 'white', textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
            {formatLiveTimer(liveDuration)}
          </div>
          <button
            onClick={togglePause}
            style={{ border: 'none', color: 'white', cursor: 'pointer', padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'rgba(255,255,255,0.25)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
            title={timerState === 'paused' ? 'Resume Timer' : 'Pause Timer'}
          >
            {timerState === 'paused' ? <Play size={18} fill="white" /> : <Pause size={18} fill="white" />}
          </button>
        </div>
      </div>

      <SlideToFinish onComplete={handleManualDone} />
    </div>
  );
}
