import { useRef, useState, useEffect } from 'react';
import { CheckCircle, ClipboardList, Scissors, Droplets, Wind, Sun, Edit2 } from 'lucide-react';
import { formatLiveTimer } from '../../utils/dateUtils';
import { useServiceMode } from '../ServiceProvider';

const CONDITIONS = [
  { id: 'overgrown', label: 'Overgrown', icon: Scissors, color: '#10b981' },
  { id: 'wet', label: 'Wet/Soggy', icon: Droplets, color: '#3b82f6' },
  { id: 'debris', label: 'Lots of Debris', icon: Wind, color: '#f59e0b' },
  { id: 'dry', label: 'Dry/Burnt', icon: Sun, color: '#ef4444' }
];

export default function JobCompletionModal({
  completionPanel,
  autoDismissMs,
  epoch,
  onUserActivity,
  panelNote,
  setPanelNote,
  panelNoteActiveRef,
  completionTimerRef,
  setCompletionPanel,
  setTimeSplit,
  setIsEditJobOpen,
  setActiveEpaJob,
  onQuickLogProducts,
  handleSaveCompletion,
  onSelectionsChange,
  onDismissNeighbors,
  onAddCompanionsToRoute,
}) {
  const panelTouchRef = useRef(null);
  const { activeMode } = useServiceMode();
  const [selectedConditions, setSelectedConditions] = useState([]);
  const [selectedServices, setSelectedServices] = useState([]);
  const [selectedCompanions, setSelectedCompanions] = useState([]);

  useEffect(() => {
    if (completionPanel) {
      setSelectedConditions(completionPanel.conditions || []);
      setSelectedServices(completionPanel.appliedServices || []);
      // Reset neighbor picks too — otherwise a selection left over from a prior
      // stop stays armed and "Yes – Split Time" would log time against a lawn
      // that isn't even in this panel's candidate list.
      setSelectedCompanions([]);
    }
  }, [completionPanel]);

  // Keep the parent's refs in sync so an auto-dismiss flush captures the latest selections.
  useEffect(() => {
    onSelectionsChange?.(selectedConditions, selectedServices);
  }, [selectedConditions, selectedServices, onSelectionsChange]);

  const toggleCondition = (id) => {
    setSelectedConditions(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const toggleService = (id) => {
    setSelectedServices(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  if (!completionPanel) return null;

  const hourlyRate = completionPanel.durationSecs > 0 
    ? (completionPanel.priceEarned / (completionPanel.durationSecs / 3600)) 
    : 0;

  const rateColor = hourlyRate >= 60 ? '#10b981' : hourlyRate < 45 ? '#ef4444' : '#f59e0b';

  const renderPaceComparison = () => {
    if (!completionPanel.historicalAverageSecs) return null;
    const deltaSecs = completionPanel.durationSecs - completionPanel.historicalAverageSecs;
    if (Math.abs(deltaSecs) < 60) return null; // within 1 minute, don't show
    
    const deltaMins = Math.abs(Math.round(deltaSecs / 60));
    const isFaster = deltaSecs < 0;
    
    return (
      <span style={{ fontSize: '0.8rem', color: isFaster ? '#10b981' : '#f59e0b', marginLeft: '0.4rem', fontWeight: 500 }}>
        ({deltaMins}m {isFaster ? 'faster' : 'slower'} than avg)
      </span>
    );
  };

  return (
    <div
      className="completion-panel"
      style={{ position: 'absolute', top: '1rem', left: '1rem', right: '1rem', zIndex: 2000, background: 'var(--color-bg-card)', borderRadius: '1.5rem', border: '1px solid var(--color-border)', boxShadow: '0 12px 40px rgba(0,0,0,0.18)', padding: '0.7rem 1rem 1rem' }}
      onPointerDownCapture={() => onUserActivity?.()}
      onTouchStart={e => { panelTouchRef.current = e.touches[0].clientY; }}
      onTouchEnd={e => {
        if (panelTouchRef.current !== null) {
          const dy = e.changedTouches[0].clientY - panelTouchRef.current;
          if (dy > 80) { handleSaveCompletion({ note: panelNote, conditions: selectedConditions, appliedServices: selectedServices }); }
          panelTouchRef.current = null;
        }
      }}
    >
      {/* Swipe indicator */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.7rem' }}>
        <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: 'var(--color-border)' }} />
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.9rem' }}>
        <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <CheckCircle size={22} color="#fff" />
        </div>
        <div>
          <div style={{ fontSize: '0.68rem', letterSpacing: '1px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-primary)' }}>Completed</div>
          <strong style={{ fontSize: '1.3rem', lineHeight: 1 }}>{completionPanel.custName}</strong>
        </div>
      </div>

      {/* Stat tiles */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ flex: 1, background: 'var(--color-bg-main)', borderRadius: '14px', padding: '0.55rem 0.7rem' }}>
          <div style={{ fontSize: '0.62rem', letterSpacing: '0.5px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Time</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>{formatLiveTimer(completionPanel.durationSecs)}</div>
          {renderPaceComparison()}
        </div>
        <div style={{ flex: 1, background: 'var(--color-bg-main)', borderRadius: '14px', padding: '0.55rem 0.7rem' }}>
          <div style={{ fontSize: '0.62rem', letterSpacing: '0.5px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Pay</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>${completionPanel.priceEarned?.toFixed(2) ?? '0.00'}</div>
        </div>
        <div style={{ flex: 1, background: `${rateColor}1a`, borderRadius: '14px', padding: '0.55rem 0.7rem' }}>
          <div style={{ fontSize: '0.62rem', letterSpacing: '0.5px', fontWeight: 700, color: rateColor, textTransform: 'uppercase' }}>Rate</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: rateColor }}>${hourlyRate.toFixed(0)}/hr</div>
        </div>
      </div>

      {/* Program-step confirmation — the field visit already logged this round,
          so the driver knows no second entry is needed on the Treatments page. */}
      {completionPanel.programStepCompleted && (
        <div style={{ marginBottom: '0.8rem', padding: '0.5rem 0.8rem', borderRadius: 'var(--radius-sm)', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 600 }}>
          🧪 Program step marked done: {completionPanel.programStepCompleted}
        </div>
      )}

      {/* Today's Mix already filed this stop's compliance record. */}
      {completionPanel.complianceLog && (
        <div style={{ marginBottom: '0.8rem', padding: '0.5rem 0.8rem', borderRadius: 'var(--radius-sm)', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 600 }}>
          ✓ EPA log filed from today's mix — tap "EPA log" if this house was different
        </div>
      )}

      {/* No mix was set: two-tap product pick beats the full sheet in the truck. */}
      {activeMode === 'fertilizer' && !completionPanel.complianceLog && onQuickLogProducts && (
        <button
          onClick={() => { if (completionTimerRef.current) clearTimeout(completionTimerRef.current); onQuickLogProducts(completionPanel); }}
          style={{ width: '100%', marginBottom: '0.8rem', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-sm)', background: 'rgba(16,185,129,0.1)', border: '1px dashed rgba(16,185,129,0.5)', fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
        >
          🧪 Tap to log the products applied here (files the EPA record)
        </button>
      )}

      {completionPanel.primaryCustomer?.services && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
          {completionPanel.primaryCustomer.services.filter(s => s.active).map(s => {
            const isSelected = selectedServices.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggleService(s.id)}
                style={{
                  padding: '0.3rem 0.6rem',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: isSelected ? 'rgba(16,185,129,0.15)' : 'transparent',
                  color: isSelected ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  cursor: 'pointer'
                }}
              >
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-text-muted)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isSelected ? 'var(--color-primary)' : 'transparent' }}>
                  {isSelected && <CheckCircle size={8} color="#fff" />}
                </div>
                {s.name}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: completionPanel.primaryCustomer?.propertyNotes ? '0.8rem' : '1rem' }}>
        {CONDITIONS.map(c => {
          const isSelected = selectedConditions.includes(c.id);
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              onClick={() => toggleCondition(c.id)}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                border: `1px solid ${isSelected ? c.color : 'var(--color-border)'}`,
                background: isSelected ? `${c.color}20` : 'var(--color-bg-alt)',
                color: isSelected ? c.color : 'var(--color-text-main)',
                cursor: 'pointer'
              }}
            >
              <Icon size={14} />
              {c.label}
            </button>
          );
        })}
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
      {completionPanel.nearbyCandidates && completionPanel.nearbyCandidates.length > 0 && (
        <div style={{ marginBottom: '0.8rem', padding: '0.7rem', borderRadius: 'var(--radius-sm)', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 600, marginBottom: '0.4rem' }}>
            🌱 Nearby Opportunities Detected
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>
            Did you also service any of these neighboring properties?
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.6rem' }}>
            {completionPanel.nearbyCandidates.map(cand => {
              const isSel = selectedCompanions.some(c => c.id === cand.id);
              const feet = Math.round(cand.dist * 3.28084);
              const lastDays = cand.lastServicedTs
                ? Math.floor((Date.now() - cand.lastServicedTs) / 86400000)
                : null;
              const lastLabel = lastDays == null ? 'Never serviced'
                : lastDays === 0 ? 'Serviced earlier today'
                : lastDays === 1 ? 'Serviced yesterday'
                : `Serviced ${lastDays}d ago`;
              // Estimated visit length (own history or trend curve) and the
              // implied rate — the go/no-go numbers for walking next door.
              const estMins = cand.expectedSecs ? Math.max(1, Math.round(cand.expectedSecs / 60)) : null;
              const estRate = estMins && cand.mowPrice > 0 ? cand.mowPrice / (estMins / 60) : null;
              const dueBadge = cand.dueStatus === 'new' ? { label: 'NEW', color: '#2563eb' }
                : cand.dueStatus === 'overdue' ? { label: cand.daysSince != null ? `${cand.daysSince}D OVERDUE` : 'OVERDUE', color: '#ef4444' }
                : cand.dueStatus === 'due' ? { label: 'DUE', color: '#f59e0b' }
                : null;
              return (
                <div
                  key={cand.id}
                  onClick={() => setSelectedCompanions(isSel
                    ? selectedCompanions.filter(c => c.id !== cand.id)
                    : [...selectedCompanions, cand])}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
                    padding: '0.55rem 0.65rem', borderRadius: '12px',
                    border: `1px solid ${isSel ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: isSel ? 'rgba(16,185,129,0.14)' : 'var(--color-bg-card)'
                  }}
                >
                  <div style={{ width: '20px', height: '20px', borderRadius: '6px', flexShrink: 0, border: `2px solid ${isSel ? 'var(--color-primary)' : 'var(--color-text-muted)'}`, background: isSel ? 'var(--color-primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isSel && <CheckCircle size={12} color="#fff" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cand.name}</span>
                      {dueBadge && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.3px', color: dueBadge.color, background: `${dueBadge.color}1f`, padding: '0.1rem 0.35rem', borderRadius: '6px', flexShrink: 0 }}>{dueBadge.label}</span>
                      )}
                      {cand.onRoute && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.3px', color: '#2563eb', background: 'rgba(37,99,235,0.12)', padding: '0.1rem 0.35rem', borderRadius: '6px', flexShrink: 0 }}>ON ROUTE</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
                      {feet} ft away · {lastLabel}{estMins ? ` · ~${estMins}m` : ''}
                    </div>
                  </div>
                  {cand.mowPrice > 0 && (
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-primary)' }}>${cand.mowPrice.toFixed(0)}</div>
                      {estRate && (
                        <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>≈${estRate.toFixed(0)}/hr</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1, fontSize: '0.85rem', padding: '0.4rem' }}
              onClick={() => { setCompletionPanel(prev => ({ ...prev, nearbyCandidates: [] })); onDismissNeighbors?.(); }}
            >
              No / Dismiss
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 2, fontSize: '0.85rem', padding: '0.4rem', opacity: selectedCompanions.length > 0 ? 1 : 0.5 }}
              disabled={selectedCompanions.length === 0}
              onClick={() => {
                if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
                setTimeSplit({
                  primaryCustomer: completionPanel.primaryCustomer,
                  primaryVisitId: completionPanel.visitId,
                  primaryExitTime: completionPanel.exitTime,
                  primaryExpectedSecs: completionPanel.historicalAverageSecs,
                  primaryVisitCount: completionPanel.historicalVisitCount || 0,
                  primaryPrice: completionPanel.priceEarned,
                  durationSecs: completionPanel.durationSecs,
                  companions: selectedCompanions
                });
              }}
            >
              ⏱️ Yes – Split Time
            </button>
          </div>

          {/* "Split Time" is for work already done; this is for work about to
              happen — put the selected neighbors on today's route so the
              geofence tracks them normally. Hidden for selections that are
              already route stops. */}
          {selectedCompanions.some(c => !c.onRoute) && (
            <button
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.85rem', padding: '0.45rem', border: '1px solid var(--color-primary)', color: 'var(--color-primary)' }}
              onClick={() => {
                const toAdd = selectedCompanions.filter(c => !c.onRoute);
                onAddCompanionsToRoute?.(toAdd);
                setCompletionPanel(prev => ({ ...prev, nearbyCandidates: [] }));
                onDismissNeighbors?.();
              }}
            >
              ➕ Didn't service yet — add {selectedCompanions.filter(c => !c.onRoute).length > 1 ? `all ${selectedCompanions.filter(c => !c.onRoute).length} to route` : 'to route'} & mow next
            </button>
          )}
        </div>
      )}

      {/* Auto-dismiss drain bar — restarts (via epoch key) whenever the countdown is re-armed */}
      {autoDismissMs > 0 && (
        <div style={{ height: '3px', borderRadius: '2px', background: 'var(--color-border)', overflow: 'hidden', marginBottom: '0.45rem' }}>
          <div key={epoch} style={{ height: '100%', background: 'var(--color-primary)', animation: `cpDrain ${autoDismissMs}ms linear forwards` }} />
          <style>{`@keyframes cpDrain { from { width: 100%; } to { width: 0%; } }`}</style>
        </div>
      )}
      <button
        style={{ width: '100%', height: '52px', border: 'none', borderRadius: '16px', background: 'var(--color-text-main)', color: 'var(--color-bg-card)', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', marginBottom: '0.5rem' }}
        onClick={() => handleSaveCompletion({ note: panelNote, conditions: selectedConditions, appliedServices: selectedServices })}
      >
        {panelNote.trim() || selectedConditions.length > 0 ? 'Save details' : 'Done'}
      </button>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          style={{ flex: 1, height: '44px', borderRadius: '14px', background: 'transparent', border: 'none', color: 'var(--color-primary)', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}
          onClick={() => { if (completionTimerRef.current) clearTimeout(completionTimerRef.current); setIsEditJobOpen(true); }}
        >
          <Edit2 size={16} /> Edit details
        </button>
        {/* Any fert-mode visit is a chemical application regardless of how the
            service is named ("Round 3" etc.), so the EPA button always shows there. */}
        {(activeMode === 'fertilizer' || completionPanel.primaryCustomer?.services?.some(s => selectedServices.includes(s.id) && s.name.toLowerCase().match(/(fertilizer|weed|spray|chem)/))) && (
          <button
            style={{ flex: 1, height: '44px', borderRadius: '14px', background: 'transparent', border: 'none', color: 'var(--color-primary)', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}
            onClick={() => { if (completionTimerRef.current) clearTimeout(completionTimerRef.current); setActiveEpaJob({
              id: completionPanel.visitId,
              custName: completionPanel.custName,
              exitTime: completionPanel.exitTime,
              durationSecs: completionPanel.durationSecs,
              custLawnSize: completionPanel.primaryCustomer?.lawnSize,
              phone: completionPanel.primaryCustomer?.phone,
              address: completionPanel.primaryCustomer?.address,
              complianceLog: completionPanel.complianceLog || null,
            }); }}
          >
            <ClipboardList size={16} /> {completionPanel.complianceLog ? 'EPA filed ✓' : 'EPA log'}
          </button>
        )}
        <button
          style={{ flex: 1, height: '44px', borderRadius: '14px', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}
          onClick={() => handleSaveCompletion({ note: panelNote, conditions: selectedConditions, appliedServices: selectedServices })}
        >
          Close
        </button>
      </div>
    </div>
  );
}
