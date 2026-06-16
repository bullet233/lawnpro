import { useRef } from 'react';
import { CheckCircle, ClipboardList } from 'lucide-react';
import { formatLiveTimer } from '../../utils/dateUtils';

export default function JobCompletionModal({
  completionPanel,
  panelNote,
  setPanelNote,
  panelNoteActiveRef,
  completionTimerRef,
  setCompletionPanel,
  setTimeSplit,
  setIsEditJobOpen,
  setActiveEpaJob,
  handleSaveNote,
}) {
  const panelTouchRef = useRef(null);

  if (!completionPanel) return null;

  return (
    <div
      className="completion-panel glass-card"
      style={{ position: 'absolute', top: '1rem', left: '1rem', right: '1rem', zIndex: 2000, border: '1px solid var(--color-primary)' }}
      onTouchStart={e => { panelTouchRef.current = e.touches[0].clientY; }}
      onTouchEnd={e => {
        if (panelTouchRef.current !== null) {
          const dy = e.changedTouches[0].clientY - panelTouchRef.current;
          if (dy > 80) { if (completionTimerRef.current) clearTimeout(completionTimerRef.current); setCompletionPanel(null); }
          panelTouchRef.current = null;
        }
      }}
    >
      {/* Swipe indicator */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.6rem' }}>
        <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: 'var(--color-border)' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem' }}>
        <CheckCircle size={20} color="var(--color-primary)" />
        <strong style={{ fontSize: '1.05rem' }}>{completionPanel.custName} — Completed</strong>
      </div>
      <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: completionPanel.primaryCustomer?.propertyNotes ? '0.8rem' : '1rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.8rem' }}>
        <span>⏱ {formatLiveTimer(completionPanel.durationSecs)}</span>
        <span>💰 ${completionPanel.priceEarned?.toFixed(2) ?? '0.00'}</span>
        {completionPanel.weather && <span>🌡 {completionPanel.weather.temp}°F</span>}
      </div>
      {completionPanel.primaryCustomer?.propertyNotes && (
        <div style={{ marginBottom: '0.8rem', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-sm)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', fontSize: '0.82rem', color: '#b45309', lineHeight: 1.5 }}>
          <span style={{ fontWeight: 700, display: 'block', marginBottom: '0.2rem' }}>📋 Property Note</span>
          {completionPanel.primaryCustomer.propertyNotes}
        </div>
      )}
      <textarea
        rows={2}
        className="input-field"
        placeholder="📝 Add a note... (optional)"
        value={panelNote}
        onChange={e => setPanelNote(e.target.value)}
        onFocus={() => { panelNoteActiveRef.current = true; }}
        onBlur={() => { panelNoteActiveRef.current = false; }}
        style={{ width: '100%', resize: 'none', fontSize: '0.9rem', marginBottom: '0.8rem' }}
      />

      {/* Nearby Companion Prompt */}
      {completionPanel.nearbyCandidate && (
        <div style={{ marginBottom: '0.8rem', padding: '0.7rem', borderRadius: 'var(--radius-sm)', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 600, marginBottom: '0.4rem' }}>
            📍 Nearby: {completionPanel.nearbyCandidate.name} ({Math.round(completionPanel.nearbyCandidate.dist)}m away)
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>
            Did you also mow this property?
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1, fontSize: '0.85rem', padding: '0.4rem' }}
              onClick={() => setCompletionPanel(prev => ({ ...prev, nearbyCandidate: null }))}
            >
              No
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 2, fontSize: '0.85rem', padding: '0.4rem' }}
              onClick={() => {
                if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
                setTimeSplit({
                  primaryCustomer: completionPanel.primaryCustomer,
                  primaryVisitId: completionPanel.visitId,
                  primaryExitTime: completionPanel.exitTime,
                  durationSecs: completionPanel.durationSecs,
                  nearbyCustomer: completionPanel.nearbyCandidate
                });
              }}
            >
              ⏱ Yes — Split Time
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
        <button
          className="btn btn-secondary"
          style={{ flex: '1 1 100%', minHeight: '52px', fontSize: '1rem', background: 'var(--color-bg-main)', border: '2px solid var(--color-primary)', color: 'var(--color-primary)' }}
          onClick={() => {
            if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
            setIsEditJobOpen(true);
          }}
        >
          ✏️ Edit Job & Extras
        </button>
        <button className="btn btn-primary" style={{ flex: 1, minHeight: '52px', fontSize: '1rem' }} onClick={handleSaveNote}>
          {panelNote.trim() ? 'Save Note' : 'Done'}
        </button>
        {completionPanel.primaryCustomer?.services?.some(s => completionPanel.appliedServices?.includes(s.id) && s.name.toLowerCase().match(/(fertilizer|weed|spray|chem)/)) && (
          <button
            className="btn btn-secondary"
            style={{ flex: 1, minHeight: '52px', fontSize: '0.9rem', color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}
            onClick={() => setActiveEpaJob({ id: completionPanel.visitId, custName: completionPanel.custName, exitTime: completionPanel.exitTime })}
          >
            <ClipboardList size={18} /> EPA Log
          </button>
        )}
        <button className="btn btn-secondary" style={{ minHeight: '52px', padding: '0 1.2rem', fontSize: '1rem' }} onClick={() => { if (completionTimerRef.current) clearTimeout(completionTimerRef.current); setCompletionPanel(null); }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
