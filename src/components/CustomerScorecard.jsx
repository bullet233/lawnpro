// This season's service scorecard for one customer: money, time, reliability
// and leaves. All numbers come from utils/customerMetrics.

const card = { background: 'var(--color-bg-main)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' };
const title = { fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)', fontWeight: 700, marginBottom: '0.6rem' };
const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', padding: '0.35rem 0', fontSize: '1rem' };
const label = { color: 'var(--color-text-muted)', fontWeight: 600 };
const value = { fontWeight: 700, color: 'var(--color-text-main)', textAlign: 'right' };
const AMBER = '#b45309';

const mins = (n) => `${Math.round(n)} min`;
const dollars = (n, d = 0) => `$${Number(n).toFixed(d)}`;

function Row({ name, children, color }) {
  return (
    <div style={row}>
      <span style={label}>{name}</span>
      <span style={{ ...value, ...(color ? { color } : {}) }}>{children}</span>
    </div>
  );
}

export default function CustomerScorecard({ metrics: m, targetRate = 0 }) {
  if (!m || (m.visits === 0 && m.skipCount === 0)) return null;
  const year = new Date().getFullYear();
  const under = (r) => targetRate > 0 && r != null && r < targetRate;
  const trendText = !m.trend ? 'Needs 5 mows'
    : m.trend.direction === 'steady' ? `Steady · ${mins(m.trend.recentMins)}`
    : `${m.trend.direction === 'slower' ? '▲' : '▼'} ${Math.abs(m.trend.deltaMins).toFixed(0)} min ${m.trend.direction} lately`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {/* Reasons this lawn needs a look */}
      {m.flags.length > 0 && (
        <div style={{ ...card, borderLeft: `4px solid ${AMBER}`, background: 'rgba(245,158,11,0.08)' }}>
          <div style={{ ...title, color: AMBER }}>Needs a look</div>
          {m.flags.map((f) => (
            <div key={f.key} style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-main)', padding: '0.2rem 0' }}>• {f.text}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.8rem' }}>
        {/* Money */}
        <div style={card}>
          <div style={title}>Money · {year}</div>
          <Row name="Season revenue">{dollars(m.revenue, 2)}</Row>
          {m.revenueByService.map((r) => (
            <div key={r.key} style={{ ...row, fontSize: '0.92rem', padding: '0.15rem 0 0.15rem 0.8rem' }}>
              <span style={label}>{r.name}</span>
              <span style={{ ...value, fontWeight: 600 }}>{dollars(r.amount, 2)}</span>
            </div>
          ))}
          {m.rateByKind.map((k) => (
            <Row key={k.kind} name={`${k.label} $/hr`} color={k.kind === 'mow' && under(k.rate) ? AMBER : undefined}>
              {k.rate != null ? dollars(k.rate) : '—'} <span style={{ fontWeight: 500, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>· {k.visits} visit{k.visits === 1 ? '' : 's'}</span>
            </Row>
          ))}
          <Row name="$/hr with drive time" color={under(m.rateWithDrive) ? AMBER : undefined}>{m.rateWithDrive != null ? dollars(m.rateWithDrive) : '—'}</Row>
          <Row name="Visits with extras">{m.extrasRate != null ? `${Math.round(m.extrasRate * 100)}% (${m.extrasVisits} of ${m.visits})` : '—'}</Row>
        </div>

        {/* Time */}
        <div style={card}>
          <div style={title}>Mow time</div>
          {m.consistency ? (
            <>
              <Row name="Usual mow">{mins(m.consistency.usualMins)}</Row>
              <Row name="Shortest – longest">{Math.round(m.consistency.minMins)} – {mins(m.consistency.maxMins)}</Row>
              <Row name="Trend" color={m.trend?.direction === 'slower' ? AMBER : m.trend?.direction === 'faster' ? 'var(--color-primary)' : undefined}>{trendText}</Row>
              <Row name="Vs similar-size lawns" color={m.vsSimilar?.ratio >= 1.4 ? AMBER : undefined}>
                {m.vsSimilar?.ratio ? `${m.vsSimilar.ratio.toFixed(1)}× (${mins(m.vsSimilar.expectedMins)} expected)` : 'Needs a lawn size'}
              </Row>
            </>
          ) : (
            <div style={{ color: 'var(--color-text-muted)' }}>No plain mows this season yet.</div>
          )}
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '0.4rem' }}>Plain mows only — leaf jobs and clean-ups are left out.</div>
        </div>

        {/* Reliability */}
        <div style={card}>
          <div style={title}>Service · {year}</div>
          <Row name="Days between cuts" color={m.cadence && m.cadence.avgDays > m.plannedDays * 1.3 ? AMBER : undefined}>
            {m.cadence ? `${m.cadence.avgDays.toFixed(1)} · planned ${m.plannedDays}` : `— · planned ${m.plannedDays}`}
          </Row>
          <Row name="Cuts vs planned" color={m.cutsVsExpected?.missed >= 2 ? AMBER : undefined}>
            {m.cutsVsExpected ? `${m.cutsVsExpected.actual} of ${m.cutsVsExpected.expected}` : '—'}
          </Row>
          <Row name="Skips" color={m.skipStreak >= 2 || m.skipCount >= 3 ? AMBER : undefined}>
            {m.skipCount}{m.skipStreak >= 2 ? ` · ${m.skipStreak} in a row` : ''}
          </Row>
        </div>

        {/* Leaves */}
        {(m.leaf.jobs > 0 || m.leaf.cleanups > 0) && (
          <div style={{ ...card, borderLeft: `4px solid ${AMBER}` }}>
            <div style={title}>🍂 Leaves · {year}</div>
            <Row name="Leaf jobs">{m.leaf.jobs}</Row>
            {m.leaf.jobs > 0 && <Row name="Avg leaf time">{m.leaf.avgLeafMins != null ? mins(m.leaf.avgLeafMins) : '—'}</Row>}
            {m.leaf.jobs > 0 && <Row name="Charged / suggested">{dollars(m.leaf.charged, 2)} / {dollars(m.leaf.suggested, 2)}</Row>}
            <Row name="Clean-ups">{m.leaf.cleanups}{m.leaf.cleanups > 0 ? ` · ${dollars(m.leaf.cleanupRevenue, 2)}` : ''}</Row>
            {m.leaf.undecided > 0 && <Row name="Still to decide" color={AMBER}>{m.leaf.undecided}</Row>}
          </div>
        )}
      </div>
    </div>
  );
}
