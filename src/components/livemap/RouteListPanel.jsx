import { CheckCircle, SkipForward, Navigation, ChevronUp, ChevronDown } from 'lucide-react';
import { parseLawnSizeToSqFt } from '../../utils/parseLawnSize';
import { getSettings } from '../../db/settings';
import { comparableVisits } from '../../utils/leaves';
import { useServiceMode } from '../ServiceProvider';

export default function RouteListPanel({
  activeRoute,
  allVisits,
  globalPace,
  getStopStatus,
  progressInfo,
  isRouteListOpen,
  setIsRouteListOpen,
  handleSkipStop,
  onForceEndRoute,
  onStartJob,
  onAddUnplanned,
  leafJobIds = [],
  onToggleLeafJob,
  jobActive = false, // a job is running (possibly at a lawn that isn't on this route)
}) {
  const { activeMode } = useServiceMode();
  const jobRunning = !!activeRoute?.expandedStops?.some((s) => getStopStatus(s.id) === 'active') || jobActive;
  return (
    <div className="glass-card" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, padding: 0, overflow: 'hidden', borderRadius: '1.5rem 1.5rem 0 0', borderBottom: 'none', boxShadow: '0 -10px 25px rgba(0,0,0,0.08)' }}>

      {/* Progress Bar & Header */}
      {progressInfo && (
        <div style={{ padding: isRouteListOpen ? '0.5rem 1rem' : '0.5rem 1rem 1.5rem 1rem', cursor: 'pointer', background: isRouteListOpen ? 'var(--color-bg-card)' : 'var(--glass-bg)', backdropFilter: isRouteListOpen ? 'none' : 'blur(12px)' }} onClick={() => setIsRouteListOpen(!isRouteListOpen)}>

          {/* Grab Handle */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', paddingTop: '0.5rem' }}>
            <div style={{ width: '40px', height: '5px', borderRadius: '3px', background: 'var(--color-border)' }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', marginBottom: '0.8rem' }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
               {/* One line: route name · how far along */}
               <strong style={{ fontSize: '1.15rem', color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                 {activeRoute?.name ? `${activeRoute.name} · ` : ''}{progressInfo.completedStops} of {progressInfo.totalStops} done
               </strong>
               {isRouteListOpen ? <ChevronDown size={20} color="var(--color-text-muted)" style={{ flexShrink: 0 }} /> : <ChevronUp size={20} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />}
             </div>
             <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
               <strong style={{ fontSize: '1.5rem', lineHeight: 1.1, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>{progressInfo.finishString || progressInfo.etaString}</strong>
               <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                 {progressInfo.finishString ? `finish · ${progressInfo.etaString}` : 'est. time'}
               </span>
             </div>
          </div>

          {/* Actual Visual Progress Bar */}
          <div style={{ width: '100%', height: '5px', background: 'var(--color-border)', borderRadius: '3px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                background: 'var(--color-primary)',
                width: `${(progressInfo.completedStops / progressInfo.totalStops) * 100}%`,
                transition: 'width 0.5s ease'
              }}
            />
          </div>
        </div>
      )}

      {/* Collapsible Route List */}
      {isRouteListOpen && activeRoute && (
        <div style={{ maxHeight: '45vh', overflowY: 'auto', padding: '1rem', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-main)' }}>
          <h4 style={{ margin: '0 0 0.3rem 0', color: 'var(--color-text-main)' }}>Route List</h4>
          {activeMode === 'mowing' && onToggleLeafJob ? (
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              Tap <strong>🍂 Leaves</strong> on any lawn where you'll pick up leaves. Its time is then kept separate from your normal mow times.
            </p>
          ) : <div style={{ height: '0.7rem' }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {activeRoute.expandedStops.map((stop, i) => {
              const status = getStopStatus(stop.id);
              const isActive = status === 'active';
              return (
                <div key={stop.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.8rem', padding: '0.6rem', background: isActive ? 'rgba(245,158,11,0.1)' : 'var(--color-bg-card)', borderRadius: 'var(--radius-sm)', border: isActive ? '2px solid #d97706' : '1px solid var(--color-border)', opacity: status === 'completed' ? 0.6 : 1 }}>
                  <div style={{ width: '24px', display: 'flex', justifyContent: 'center' }}>
                    {status === 'completed' ? (
                      <CheckCircle size={18} color="var(--color-primary)" />
                    ) : status === 'skipped' ? (
                      <SkipForward size={16} color="var(--color-text-muted)" />
                    ) : isActive ? (
                      <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#d97706' }} />
                    ) : (
                      <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid var(--color-text-muted)' }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: '150px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: status === 'completed' || status === 'skipped' ? 'var(--color-text-muted)' : 'var(--color-text-main)', textDecoration: status === 'completed' || status === 'skipped' ? 'line-through' : 'none' }}>
                      {i + 1}. {stop.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem' }}>
                      <span>{stop.address}</span>
                      {status === 'pending' && (() => {
                         let estMins = 15;
                         const normalizedStop = activeRoute.normalizedStops?.find(n => n.customerId === stop.id);
                         const plannedIds = normalizedStop?.plannedServiceIds || [];
                         
                         const settings = getSettings();
                         const defaultServices = settings.defaultServices || [];
                         const isPlannedMow = plannedIds.length === 0 || plannedIds.some(id => defaultServices.find(s => s.id === id)?.category === 'Mowing' || id === 's1');

                         const histVisits = comparableVisits(allVisits.filter(v => {
                           if (v.customerId !== stop.id || v.status !== 'completed' || !v.durationSecs) return false;
                           const isHistMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => defaultServices.find(s => s.id === id)?.category === 'Mowing' || id === 's1');
                           return isPlannedMow === isHistMow;
                         }), isPlannedMow && leafJobIds.includes(stop.id));

                         if (histVisits.length > 0) {
                           estMins = Math.round((histVisits.reduce((acc, v) => acc + v.durationSecs, 0) / histVisits.length) / 60);
                         } else if (stop.lawnSize) {
                           const sqft = parseLawnSizeToSqFt(stop.lawnSize);
                           if (sqft) estMins = Math.max(isPlannedMow ? 10 : 5, Math.round(sqft / globalPace));
                         }
                         const driveMins = normalizedStop?.plannedDriveTimeSecs ? Math.round(normalizedStop.plannedDriveTimeSecs / 60) : null;
                         return (
                           <span style={{ fontWeight: 600, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>
                             {driveMins !== null && driveMins > 0 ? `${driveMins}m drive · ` : ''}~{estMins}m job
                           </span>
                         );
                      })()}
                    </div>
                  </div>
                  {isActive && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.5px', color: '#b45309', background: 'rgba(245,158,11,0.2)', padding: '0.35rem 0.7rem', borderRadius: '999px', whiteSpace: 'nowrap' }}>
                      {activeMode === 'mowing' ? 'MOWING NOW' : 'WORKING NOW'}{leafJobIds.includes(stop.id) && activeMode === 'mowing' ? ' · 🍂 LEAVES' : ''}
                    </span>
                  )}
                  {(status === 'pending' || status === 'skipped') && (
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: '0.3rem' }}>
                      {activeMode === 'mowing' && onToggleLeafJob && (() => {
                        const on = leafJobIds.includes(stop.id);
                        return (
                          <button
                            className="btn btn-secondary"
                            aria-pressed={on}
                            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', minHeight: '44px', fontWeight: 700, ...(on ? { background: 'rgba(180,83,9,0.12)', border: '2px solid #b45309', color: '#b45309' } : {}) }}
                            onClick={() => onToggleLeafJob(stop.id)}
                            title={on ? 'Marked as a leaf job — tap to undo' : 'Mark as a leaf job'}
                          >
                            🍂 {on ? 'Leaf job ✓' : 'Leaves'}
                          </button>
                        );
                      })()}
                      {status === 'pending' && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', minHeight: '44px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                          onClick={() => handleSkipStop(stop)}
                          title="Skip Stop"
                        >
                          <SkipForward size={16} /> Skip
                        </button>
                      )}
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', minHeight: '44px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                        onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`, '_blank')}
                        title="Navigate"
                      >
                        <Navigation size={16} /> Drive
                      </button>
                      {/* One job at a time: no Start on other stops while a job is running. */}
                      {!jobRunning && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem', minHeight: '44px' }}
                          onClick={() => onStartJob(stop)}
                        >
                          ▶ {status === 'skipped' ? 'Redo' : 'Start'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              className="btn btn-secondary"
              style={{ marginTop: '0.5rem', padding: '0.6rem', borderStyle: 'dashed' }}
              onClick={onAddUnplanned}
            >
              + Add Unplanned Stop
            </button>
            {/* Ending the route early sits at the very bottom, away from the
                handle and the first stop, so it isn't hit by accident. */}
            {progressInfo && progressInfo.completedStops < progressInfo.totalStops && (
              <button
                className="btn btn-secondary"
                style={{ marginTop: '1.5rem', padding: '0.6rem', color: '#ef4444', borderColor: '#ef4444', background: 'rgba(239,68,68,0.05)' }}
                onClick={onForceEndRoute}
              >
                Force End Route
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
