import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, ArrowDown, SkipForward } from 'lucide-react';
import { buildDayRoute, GAP_SHOW_SECS } from '../utils/dayRoute';
import { isLeafVisit, isCleanupVisit } from '../utils/leaves';

// Logs → a day's "Route" view: the stops in the order they were driven, the
// drive to each one, time the drive doesn't explain, and the skips.

const AMBER = '#b45309';
const MOW = '#10b981', DRIVE = '#a8a29e', GAP = '#f59e0b';
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const hm = (secs) => {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

function Link({ children, warn = false, muted = false, first = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginLeft: '1.6rem', padding: first ? '0 0 0.45rem 1.4rem' : '0.45rem 0 0.45rem 1.4rem',
      borderLeft: `2px dashed ${warn ? GAP : 'var(--color-border)'}`, fontSize: '0.92rem', fontWeight: 600,
      color: muted ? 'var(--color-text-muted)' : 'var(--color-text-muted)', opacity: muted ? 0.8 : 1 }}>
      {children}
    </div>
  );
}

export default function DayRouteView({ visits, customers }) {
  const navigate = useNavigate();
  const route = useMemo(() => buildDayRoute(visits), [visits]);
  const nameOf = (id) => customers.find((c) => c.id === id)?.name || 'Unknown';
  const { stops, skipsAfter, summary: s } = route;

  const skipLine = (idx, last = false) => {
    const list = skipsAfter.get(idx);
    if (!list?.length) return null;
    return (
      <Link muted>
        <SkipForward size={16} />
        Skipped: {list.map((v) => nameOf(v.customerId)).join(', ')}
        {last && s.routeEnded ? ` · route ended ${clock(s.routeEnded)}` : ''}
      </Link>
    );
  };

  if (stops.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ padding: '1rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)' }}>No finished jobs this day.</div>
        {skipLine(-1)}
      </div>
    );
  }

  const total = s.mowSecs + s.driveSecs + s.gapSecs || 1;
  const pct = (x) => Math.round((x / total) * 100);
  const tile = (label, value, color) => (
    <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.7rem 0.9rem' }}>
      <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 800, color: color || 'var(--color-text-main)' }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* The day at a glance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '0.7rem' }}>
        {tile('Day', `${clock(s.dayStart)}–${clock(s.dayEnd)}`)}
        {tile('Mowing', hm(s.mowSecs))}
        {tile('Driving', hm(s.driveSecs))}
        {tile('Unaccounted', hm(s.gapSecs), s.gapSecs >= GAP_SHOW_SECS ? AMBER : undefined)}
      </div>
      <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', marginBottom: '0.4rem' }}>
        <div style={{ width: `${pct(s.mowSecs)}%`, background: MOW }} />
        <div style={{ width: `${pct(s.driveSecs)}%`, background: DRIVE }} />
        <div style={{ width: `${pct(s.gapSecs)}%`, background: GAP }} />
      </div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.88rem', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '1rem' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: MOW, marginRight: 5 }} />Mowing {pct(s.mowSecs)}%</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: DRIVE, marginRight: 5 }} />Driving {pct(s.driveSecs)}%</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: GAP, marginRight: 5 }} />Gaps {pct(s.gapSecs)}%</span>
        <span style={{ marginLeft: 'auto', color: 'var(--color-text-main)' }}>
          {s.jobs} job{s.jobs === 1 ? '' : 's'} · ${s.revenue.toFixed(0)}{s.rate != null ? ` · $${Math.round(s.rate)}/hr` : ''}
        </span>
      </div>

      {skipLine(-1)}
      {stops.map((stop, i) => {
        const names = stop.visits.map((v) => nameOf(v.customerId));
        const leaf = stop.visits.some(isLeafVisit);
        const cleanup = stop.visits.some((v) => isCleanupVisit(v));
        const showGap = stop.gapSecs >= GAP_SHOW_SECS;
        return (
          <div key={stop.visits[0].id}>
            {i === 0 ? (
              <Link first><Truck size={16} />Left {clock(s.dayStart)} · {hm(stop.driveSecs)} drive</Link>
            ) : stop.driveSecs < 60 && !showGap ? (
              <Link><ArrowDown size={16} />Next door · no drive</Link>
            ) : (
              <Link warn={showGap}>
                <Truck size={16} />{hm(stop.driveSecs)} drive
                {showGap && <span style={{ fontSize: '0.85rem', fontWeight: 700, color: AMBER, background: 'rgba(245,158,11,0.14)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>+{hm(stop.gapSecs)} unaccounted</span>}
              </Link>
            )}
            <div
              role="button" tabIndex={0}
              onClick={() => navigate(`/customers/${stop.visits[0].customerId}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/customers/${stop.visits[0].customerId}`); }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.8rem 1rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
              <div style={{ width: '5.2rem', flexShrink: 0, fontSize: '0.9rem', color: 'var(--color-text-muted)', fontWeight: 600, lineHeight: 1.3 }}>
                {clock(stop.start)}<br />–{clock(stop.end)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {i + 1}. {names.join(' + ')}
                  {leaf && <span style={{ fontSize: '0.8rem', fontWeight: 700, color: AMBER, background: 'rgba(180,83,9,0.1)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>🍂 Leaves</span>}
                  {cleanup && <span style={{ fontSize: '0.8rem', fontWeight: 700, color: AMBER, background: 'rgba(180,83,9,0.1)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>Clean-up</span>}
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {stop.together ? `Done together · ${hm(stop.clockSecs)}` : `${hm(stop.clockSecs)} on site`}
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--color-text-main)' }}>${stop.price.toFixed(0)}</div>
            </div>
            {skipLine(i, i === stops.length - 1)}
          </div>
        );
      })}
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0.8rem 0.2rem 0' }}>
        Stops in the order you drove them. Unaccounted is time between stops the recorded drive doesn&apos;t cover (shown when 5+ min) — a fuel stop, a break, or a slow drive. Lawns done together count as one stop. Tap a stop to open the client.
      </p>
    </div>
  );
}
