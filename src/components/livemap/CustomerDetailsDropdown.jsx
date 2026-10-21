import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, ClipboardList, User } from 'lucide-react';
import { getDaysSince } from '../../utils/dateUtils';
import { getSettings } from '../../db/settings';
import { parseLawnSizeToSqFt } from '../../utils/parseLawnSize';
import { comparableVisits, isMowVisit, isLeafVisit } from '../../utils/leaves';
import { useServiceMode } from '../ServiceProvider';

// Does a service belong to the currently active division? Mirrors the
// name/id heuristics used in CustomersList / WeeklyScheduler.
function serviceMatchesMode(svc, mode) {
  const n = (svc.name || '').toLowerCase();
  if (mode === 'fertilizer') {
    return svc.id === 's3' || n.includes('fert') || n.includes('spray') || n.includes('weed') || n.includes('chem');
  }
  return svc.id === 's1' || n.includes('mow') || n.includes('cut') || n.includes('yard');
}

const avgMins = (visits) => (visits.length ? Math.round(visits.reduce((s, v) => s + v.durationSecs, 0) / visits.length / 60) : null);

// The job's details: what's scheduled, the last visit, usual times, how often,
// and the property notes. Controlled (open / onToggle) when the Live page
// needs to keep it and the route list from being open together; otherwise it
// keeps its own open state and shows a "Details" toggle.
export default function CustomerDetailsDropdown({ customer, allVisits, globalPace, open, onToggle, showToggle = true }) {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const toggle = onToggle || (() => setOwnOpen(v => !v));
  const navigate = useNavigate();
  const { activeMode } = useServiceMode();

  const info = useMemo(() => {
    if (!customer) return null;
    const settings = getSettings();
    const defaultServices = settings?.defaultServices || [];
    const mine = (allVisits || []).filter(v => v.customerId === customer.id && v.status === 'completed' &&
      (!v.division || v.division === activeMode)).sort((a, b) => b.exitTime - a.exitTime);
    const timed = mine.filter(v => v.durationSecs >= 60 && (activeMode !== 'mowing' || isMowVisit(v)));

    // Usual time — like with like: plain mows, and leaf jobs on their own.
    let usual = avgMins(comparableVisits(timed, false));
    const usualLeaf = activeMode === 'mowing' && timed.some(isLeafVisit) ? avgMins(comparableVisits(timed, true)) : null;
    let usualFromSize = false;
    if (usual == null && customer.lawnSize && globalPace) {
      const sqft = parseLawnSizeToSqFt(customer.lawnSize);
      if (sqft) { usual = Math.max(5, Math.round(sqft / globalPace)); usualFromSize = true; }
    }

    const last = mine[0] || null;
    const days = last ? getDaysSince(last.exitTime) : null;
    const daysStr = days == null ? 'never' : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;

    // Scheduled service(s) + price — only the active division's.
    const activeServices = customer.services?.filter(s => s.active) || [];
    let scheduled = activeServices.filter(s => serviceMatchesMode(s, activeMode));
    if (scheduled.length === 0) scheduled = activeServices;
    const scheduledStr = scheduled.map(s => s.name || defaultServices.find(d => d.id === s.id)?.name || 'Service').join(', ') || 'Service';
    const price = scheduled.reduce((sum, s) => sum + (Number(s.price) || 0), 0);

    const every = activeMode === 'fertilizer'
      ? (customer.fertilizerInterval || 30)
      : (customer.mowingInterval || customer.serviceInterval || 7);

    return {
      scheduledStr, price, last, daysStr, usual, usualLeaf, usualFromSize, every,
      // Property notes live in propertyNotes (the client page's field);
      // `notes` is an older name some records may still carry.
      notes: (customer.propertyNotes || customer.notes || '').trim(),
    };
  }, [customer, allVisits, globalPace, activeMode]);

  if (!customer || !info) return null;

  const tile = (label, value, sub, subColor) => (
    <div style={{ background: 'var(--color-bg-main)', borderRadius: '10px', padding: '0.55rem 0.7rem', minWidth: 0 }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>{label}</div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-main)', lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.78rem', color: subColor || 'var(--color-text-muted)', fontWeight: 600 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {isOpen && (
        <div className="animate-fade-in" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.7rem', marginBottom: '0.6rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            {tile('Scheduled', `${info.scheduledStr} · $${info.price.toFixed(0)}`)}
            {tile('Last visit',
              info.last ? `${new Date(info.last.exitTime).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${Math.round((info.last.durationSecs || 0) / 60)} min` : 'None yet',
              info.last && isLeafVisit(info.last) ? 'leaf job' : null, '#b45309')}
            {tile('Usual time',
              info.usual != null ? `~${info.usual} min${info.usualFromSize ? ' (by size)' : ''}` : 'No data yet',
              info.usualLeaf != null ? `~${info.usualLeaf} min with leaves` : null)}
            {tile('Every', `${info.every} days`, info.last ? `last ${info.daysStr}` : null)}
          </div>
          <div style={{ marginTop: '0.5rem', borderRadius: '10px', padding: '0.55rem 0.7rem', fontSize: '0.9rem', display: 'flex', gap: '0.45rem', alignItems: 'flex-start',
            background: info.notes ? 'rgba(245,158,11,0.12)' : 'var(--color-bg-main)', color: info.notes ? '#92400e' : 'var(--color-text-muted)' }}>
            <ClipboardList size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{info.notes ? info.notes : 'No property notes saved — add them on the client page.'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem' }}>
            <button onClick={() => navigate(`/customers/${customer.id}`)}
              style={{ background: 'none', border: 'none', padding: '0.5rem 0', minHeight: '40px', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <User size={15} /> Open client page ›
            </button>
            {showToggle && (
              <button onClick={toggle} style={{ background: 'none', border: 'none', padding: '0.5rem 0', minHeight: '40px', cursor: 'pointer', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                Hide details <ChevronUp size={15} />
              </button>
            )}
          </div>
        </div>
      )}
      {!isOpen && showToggle && (
        <button onClick={(e) => { e.stopPropagation(); toggle(); }} aria-label="Show job details"
          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', padding: '0.4rem 0', minHeight: '40px', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          Details <ChevronDown size={15} />
        </button>
      )}
    </div>
  );
}
