import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Job-time views for Stats → Clients: the whole-business season curve, and a
// card per client with time by job type and a month-by-month chart.

const AMBER = '#b45309';
const h2 = { fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--color-text-muted)', margin: 0, fontWeight: 700 };
const monthName = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'short' });
};

// ── Season curve: each month vs each lawn's normal ──────────────────────
export function SeasonCurve({ curve }) {
  if (!curve || curve.length < 2) {
    return (
      <div>
        <h2 style={{ ...h2, marginBottom: '1rem' }}>Mow time by month</h2>
        <div style={{ padding: '1rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)' }}>
          Shows once there are two months of plain mows from lawns with 6+ cuts.
        </div>
      </div>
    );
  }
  const max = Math.max(...curve.map((m) => m.pctOfNormal), 110);
  const min = Math.min(...curve.map((m) => m.pctOfNormal), 90);
  const slowest = curve.reduce((a, b) => (b.pctOfNormal > a.pctOfNormal ? b : a));
  const fastest = curve.reduce((a, b) => (b.pctOfNormal < a.pctOfNormal ? b : a));
  // Bars grow up (slower) or down (faster) from the 100% line.
  const span = Math.max(max - 100, 100 - min);
  const half = 70; // px each side of the line
  return (
    <div>
      <h2 style={{ ...h2, marginBottom: '1rem' }}>Mow time by month · all lawns</h2>
      <div style={{ padding: '1rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '0.8rem' }}>
          {monthName(slowest.month)} ran {Math.round(slowest.pctOfNormal - fastest.pctOfNormal)}% longer than {monthName(fastest.month)} for the same lawns.
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'stretch' }}>
          {curve.map((m) => {
            const diff = m.pctOfNormal - 100;
            const h = Math.max(2, (Math.abs(diff) / span) * half);
            const slow = diff > 0;
            return (
              <div key={m.month} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ height: `${half}px`, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
                  {slow && <div style={{ fontSize: '0.85rem', fontWeight: 800, color: AMBER }}>+{Math.round(diff)}%</div>}
                  {slow && <div style={{ width: '100%', maxWidth: '64px', height: `${h}px`, background: AMBER, borderRadius: '6px 6px 0 0' }} />}
                </div>
                <div style={{ width: '100%', borderTop: '2px solid var(--color-text-muted)' }} />
                <div style={{ height: `${half}px`, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {!slow && <div style={{ width: '100%', maxWidth: '64px', height: `${h}px`, background: 'var(--color-primary)', borderRadius: '0 0 6px 6px' }} />}
                  {!slow && <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--color-primary)' }}>{Math.round(diff)}%</div>}
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-text-main)' }}>{monthName(m.month)}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{Math.round(m.avgMins)}m · {m.visits}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.8rem' }}>
          Each month&apos;s plain mows compared with each lawn&apos;s own season average — above the line is slower than normal, below is faster. Under each month: average mow and number of mows. Leaf jobs and clean-ups are left out, and only lawns with 6+ cuts this season count.
        </div>
      </div>
    </div>
  );
}

// ── One client: time by job type + month by month ───────────────────────
function MonthBars({ months }) {
  if (!months || months.length < 2) {
    return <div style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>Needs two months of these jobs for a chart.</div>;
  }
  const max = Math.max(...months.map((m) => m.avgMins));
  const total = months.reduce((s, m) => s + m.avgMins * m.visits, 0) / months.reduce((s, m) => s + m.visits, 0);
  const slowest = months.reduce((a, b) => (b.avgMins > a.avgMins ? b : a));
  const H = 80;
  return (
    <div style={{ position: 'relative' }}>
      {/* dashed line at this lawn's season average */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: `${18 + H - (total / max) * H}px`, borderTop: '2px dashed var(--color-text-muted)', opacity: 0.6 }} title={`Season average ${Math.round(total)} min`} />
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end' }}>
        {months.map((m) => (
          <div key={m.month} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, height: '18px', color: m === slowest ? AMBER : 'var(--color-text-main)' }}>{Math.round(m.avgMins)}m</div>
            <div style={{ height: `${H}px`, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: '44px', height: `${Math.max(3, (m.avgMins / max) * H)}px`, borderRadius: '5px 5px 0 0', background: m === slowest ? AMBER : 'rgba(16,185,129,0.45)' }} />
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-main)' }}>{monthName(m.month)}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{m.visits}×</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>Dashed line: season average {Math.round(total)} min</div>
    </div>
  );
}

export function ClientTimeCard({ m, showName = true }) {
  const navigate = useNavigate();
  const hasLeaf = (m.timeByMonth?.leaf || []).length > 0;
  const [kind, setKind] = useState('mow');
  const months = m.timeByMonth?.[kind] || [];
  const toggle = (k, label) => (
    <button
      onClick={(e) => { e.stopPropagation(); setKind(k); }}
      aria-pressed={kind === k}
      style={{ padding: '0.4rem 0.8rem', minHeight: '38px', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', border: kind === k ? '1px solid var(--color-primary)' : '1px solid var(--color-border)', background: kind === k ? 'rgba(16,185,129,0.12)' : 'var(--color-bg-card)', color: kind === k ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
    >
      {label}
    </button>
  );
  return (
    <div className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {showName ? (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.8rem' }}>
        <button onClick={() => navigate(`/customers/${m.customerId}`)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 800, fontSize: '1.1rem', color: 'var(--color-text-main)', textAlign: 'left' }}>
          {m.name} ›
        </button>
        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{m.visits} visits</span>
      </div>
      ) : (
        <div style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)' }}>Job times · {new Date().getFullYear()}</div>
      )}

      {/* Time by job type */}
      <div>
        {m.timeByKind.map((k) => (
          <div key={k.key} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', padding: '0.3rem 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.95rem' }}>
            <span style={{ fontWeight: 600, color: k.kind === 'leaf' || k.kind === 'cleanup' ? AMBER : 'var(--color-text-main)' }}>{k.label}</span>
            <span style={{ fontWeight: 700, color: 'var(--color-text-main)', textAlign: 'right', whiteSpace: 'nowrap' }}>
              {Math.round(k.usualMins)} min
              <span style={{ fontWeight: 500, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                {k.visits > 1 ? ` · ${Math.round(k.minMins)}–${Math.round(k.maxMins)}` : ''} · {k.visits}×
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Month by month */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)' }}>By month</span>
          {hasLeaf && <div style={{ display: 'flex', gap: '0.3rem' }}>{toggle('mow', 'Mow')}{toggle('leaf', 'Mow + leaves')}</div>}
        </div>
        <MonthBars months={months} />
      </div>
    </div>
  );
}

export function ClientTimeCards({ metrics }) {
  const [search, setSearch] = useState('');
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return metrics
      .filter((m) => m.timeByKind?.length > 0 && (!q || m.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [metrics, search]);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <h2 style={h2}>Job times by client · {new Date().getFullYear()}</h2>
        <input
          type="text" inputMode="search" className="input-field" placeholder="Find a client" aria-label="Find a client"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ minHeight: '44px', fontSize: '1rem', padding: '0.5rem 0.8rem', width: '240px', maxWidth: '100%' }}
        />
      </div>
      {list.length === 0 ? (
        <div style={{ padding: '1rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)' }}>No clients match.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.8rem' }}>
          {list.map((m) => <ClientTimeCard key={m.customerId} m={m} />)}
        </div>
      )}
    </div>
  );
}
