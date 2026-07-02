import { CheckCircle, SkipForward, Navigation, ChevronUp, ChevronDown } from 'lucide-react';
import { parseLawnSizeToSqFt } from '../../utils/parseLawnSize';
import { getSettings } from '../../db/settings';

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
}) {
  return (
    <div className="glass-card" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, padding: 0, overflow: 'hidden', borderRadius: '1.5rem 1.5rem 0 0', borderBottom: 'none', boxShadow: '0 -10px 25px rgba(0,0,0,0.08)' }}>

      {/* Progress Bar & Header */}
      {progressInfo && (
        <div style={{ padding: isRouteListOpen ? '0.5rem 1rem' : '0.5rem 1rem 1.5rem 1rem', cursor: 'pointer', background: isRouteListOpen ? 'var(--color-bg-card)' : 'var(--glass-bg)', backdropFilter: isRouteListOpen ? 'none' : 'blur(12px)' }} onClick={() => setIsRouteListOpen(!isRouteListOpen)}>

          {/* Grab Handle */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', paddingTop: '0.5rem' }}>
            <div style={{ width: '40px', height: '5px', borderRadius: '3px', background: 'var(--color-border)' }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <div style={{ display: 'flex', flexDirection: 'column' }}>
                 {activeRoute?.name && (
                   <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                     {activeRoute.name}
                   </span>
                 )}
                 <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Route Progress</span>
                 <strong style={{ fontSize: '1.1rem', color: 'var(--color-text-main)' }}>{progressInfo.completedStops} of {progressInfo.totalStops} Stops Completed</strong>
               </div>
               {isRouteListOpen ? <ChevronDown size={18} color="var(--color-text-muted)" style={{ marginLeft: '0.5rem' }} /> : <ChevronUp size={18} color="var(--color-text-muted)" style={{ marginLeft: '0.5rem' }} />}
             </div>
             <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
               <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{progressInfo.finishString ? 'Est. Finish' : 'Est. Time'}</span>
               <strong style={{ color: 'var(--color-primary)' }}>{progressInfo.finishString || progressInfo.etaString}</strong>
               {progressInfo.finishString && (
                 <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{progressInfo.etaString}</span>
               )}
             </div>
          </div>

          {/* End Route Button */}
          {isRouteListOpen && progressInfo.completedStops < progressInfo.totalStops && (
            <button
              className="btn btn-secondary"
              style={{ width: '100%', marginBottom: '1rem', padding: '0.6rem', color: '#ef4444', borderColor: '#ef4444', background: 'rgba(239,68,68,0.05)' }}
              onClick={(e) => {
                e.stopPropagation();
                onForceEndRoute();
              }}
            >
              Force End Route
            </button>
          )}

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
          <h4 style={{ margin: '0 0 1rem 0', color: 'var(--color-text-main)' }}>Route List</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {activeRoute.expandedStops.map((stop, i) => {
              const status = getStopStatus(stop.id);
              return (
                <div key={stop.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.8rem', padding: '0.6rem', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', opacity: status === 'completed' ? 0.6 : 1 }}>
                  <div style={{ width: '24px', display: 'flex', justifyContent: 'center' }}>
                    {status === 'completed' ? (
                      <CheckCircle size={18} color="var(--color-primary)" />
                    ) : status === 'skipped' ? (
                      <SkipForward size={16} color="var(--color-text-muted)" />
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

                         const histVisits = allVisits.filter(v => {
                           if (v.customerId !== stop.id || v.status !== 'completed' || !v.durationSecs) return false;
                           const isHistMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => defaultServices.find(s => s.id === id)?.category === 'Mowing' || id === 's1');
                           return isPlannedMow === isHistMow;
                         });

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
                  {status === 'pending' && (
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: '0.3rem' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', minHeight: '36px' }}
                        onClick={() => handleSkipStop(stop)}
                        title="Skip Stop"
                      >
                        <SkipForward size={14} />
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', minHeight: '36px' }}
                        onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`, '_blank')}
                        title="Navigate"
                      >
                        <Navigation size={14} />
                      </button>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', minHeight: '36px' }}
                        onClick={() => onStartJob(stop)}
                      >
                        ▶ Start
                      </button>
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
    </div>
  );
}
