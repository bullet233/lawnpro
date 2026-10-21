import { CheckCircle, SkipForward, Navigation, ChevronUp, ChevronDown, Clock } from 'lucide-react';
import { getSettings } from '../../db/settings';
import { estimateJobSecs } from '../../utils/routeEta';
import { serviceDue, isLate, lastDoneLabel } from '../../utils/dueStatus';
import { seasonFromSettings } from '../../utils/mowSeason';
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
  // Drive (from the route plan) and usual job time for a stop: this lawn's own
  // history for the planned kind of work, else its size at the overall pace.
  const estimateFor = (stop) => {
    const normalizedStop = activeRoute?.normalizedStops?.find(n => n.customerId === stop.id);
    const estMins = Math.round(estimateJobSecs({
      customer: stop,
      plannedIds: normalizedStop?.plannedServiceIds || [],
      allVisits: allVisits || [],
      defaultServices: getSettings().defaultServices || [],
      globalPace,
      isLeafJob: leafJobIds.includes(stop.id),
    }) / 60);
    const driveMins = normalizedStop?.plannedDriveTimeSecs ? Math.round(normalizedStop.plannedDriveTimeSecs / 60) : null;
    // When it was last done, before today (the shared due check).
    const settings = getSettings();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const due = serviceDue(stop, allVisits || [], { division: activeMode, season: seasonFromSettings(settings), beforeTs: startOfToday.getTime() });
    const lastDone = lastDoneLabel(due, activeMode === 'mowing' ? 'cut' : 'done');
    return { driveMins, estMins, lastDone, lastLate: isLate(due) };
  };
  const lastDoneSpan = (lastDone, lastLate) => (
    <span style={{ color: lastLate ? '#b91c1c' : 'inherit', fontWeight: lastLate ? 700 : 'inherit' }}> · {lastDone}</span>
  );
  const jobRunning = !!activeRoute?.expandedStops?.some((s) => getStopStatus(s.id) === 'active') || jobActive;
  return (
    <div style={{ position: 'absolute', bottom: '0.6rem', left: '0.6rem', right: '0.6rem', zIndex: 10, padding: 0, overflow: 'hidden', borderRadius: '1.25rem', background: '#ffffff', border: '1px solid var(--color-border)', boxShadow: '0 6px 24px rgba(0,0,0,0.12)' }}>

      {/* Header: route, progress, finish time — tap to open the stop list */}
      {progressInfo && (() => {
        const upNext = (activeRoute?.expandedStops || []).filter(s => getStopStatus(s.id) === 'pending').slice(0, 2);
        const numberOf = (id) => (activeRoute?.expandedStops || []).findIndex(s => s.id === id) + 1;
        return (
          <div style={{ padding: '0.8rem 1rem 0.9rem', cursor: 'pointer', background: '#ffffff' }} onClick={() => setIsRouteListOpen(!isRouteListOpen)} role="button" aria-expanded={isRouteListOpen} aria-label="Route list">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                  <strong style={{ fontSize: '1.15rem', color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeRoute?.name ? `${activeRoute.name} · ` : ''}{progressInfo.doneStops ?? progressInfo.completedStops} of {progressInfo.totalStops} done
                    {progressInfo.skippedStops > 0 && <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}> · {progressInfo.skippedStops} skipped</span>}
                  </strong>
                  {isRouteListOpen ? <ChevronDown size={20} color="var(--color-text-muted)" style={{ flexShrink: 0 }} /> : <ChevronUp size={20} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />}
                </div>
                <div style={{ width: '100%', maxWidth: '260px', height: '7px', background: 'var(--color-border)', borderRadius: '4px', overflow: 'hidden', marginTop: '0.45rem' }}>
                  <div style={{ display: 'flex', height: '100%' }}>
                    <div style={{ height: '100%', background: 'var(--color-primary)', width: `${((progressInfo.doneStops ?? progressInfo.completedStops) / progressInfo.totalStops) * 100}%`, transition: 'width 0.5s ease' }} />
                    <div style={{ height: '100%', background: '#9ca3af', width: `${((progressInfo.skippedStops || 0) / progressInfo.totalStops) * 100}%`, transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0 }}>
                <Clock size={22} color="var(--color-primary)" />
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>{progressInfo.finishString ? 'Est. finish' : 'Est. time'}</div>
                  <strong style={{ fontSize: '1.3rem', color: 'var(--color-text-main)', whiteSpace: 'nowrap' }}>{progressInfo.finishString || progressInfo.etaString}</strong>
                </div>
              </div>
            </div>
            {!isRouteListOpen && upNext.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.7rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '1px', color: 'var(--color-text-muted)', flexShrink: 0 }}>UP NEXT</span>
                {upNext.map(s => {
                  const { driveMins, estMins, lastDone, lastLate } = estimateFor(s);
                  return (
                    <div key={s.id} style={{ flex: 1, minWidth: 0, maxWidth: '320px', display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: '14px', padding: '0.55rem 0.7rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                      <span style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', fontWeight: 800, flexShrink: 0 }}>{numberOf(s.id)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {driveMins ? `${driveMins}m drive · ` : ''}~{estMins}m job{lastDoneSpan(lastDone, lastLate)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

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
                         const { driveMins, estMins, lastDone, lastLate } = estimateFor(stop);
                         return (
                           <span style={{ fontWeight: 600, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>
                             {driveMins !== null && driveMins > 0 ? `${driveMins}m drive · ` : ''}~{estMins}m job{lastDoneSpan(lastDone, lastLate)}
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
          </div>
        </div>
      )}
      {/* Ending the route early: below the list (not inside its scroll), so
          it's always in view while the list is open — and still well away
          from the handle and the first stop. */}
      {isRouteListOpen && activeRoute && progressInfo && progressInfo.completedStops < progressInfo.totalStops && (
        <div style={{ padding: '0.6rem 1rem 0.8rem', borderTop: '1px solid var(--color-border)', background: '#ffffff' }}>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', minHeight: '46px', padding: '0.6rem', fontWeight: 700, color: '#b91c1c', borderColor: '#ef4444', background: 'rgba(239,68,68,0.05)' }}
            onClick={onForceEndRoute}
          >
            Force End Route
          </button>
        </div>
      )}
    </div>
  );
}
