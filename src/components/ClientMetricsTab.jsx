import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { buildCustomerMetrics, METRICS_CSV_HEADERS, metricsCsvRow } from '../utils/customerMetrics';

// Stats → Clients: who needs a look (and why), then every customer as a
// sortable row. Numbers are this season's, from utils/customerMetrics.

const AMBER = '#b45309';
const h2 = { fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--color-text-muted)', margin: 0, fontWeight: 700 };
const cell = { padding: '0.8rem 0.7rem', whiteSpace: 'nowrap', textAlign: 'right' };

// Columns: how to read the value (for sorting) and how to show it.
const COLUMNS = [
  { key: 'name', label: 'Customer', get: (m) => m.name.toLowerCase(), text: true },
  { key: 'revenue', label: 'Revenue', get: (m) => m.revenue, show: (m) => `$${m.revenue.toFixed(0)}` },
  { key: 'rateWork', label: '$/hr', get: (m) => m.rateWork, show: (m) => (m.rateWork != null ? `$${m.rateWork.toFixed(0)}` : '—'), under: (m, t) => t > 0 && m.rateWork != null && m.rateWork < t },
  { key: 'rateWithDrive', label: '$/hr + drive', get: (m) => m.rateWithDrive, show: (m) => (m.rateWithDrive != null ? `$${m.rateWithDrive.toFixed(0)}` : '—'), under: (m, t) => t > 0 && m.rateWithDrive != null && m.rateWithDrive < t },
  { key: 'usual', label: 'Usual mow', get: (m) => m.consistency?.usualMins, show: (m) => (m.consistency ? `${Math.round(m.consistency.usualMins)}m` : '—') },
  { key: 'trend', label: 'Trend', get: (m) => m.trend?.deltaMins, show: (m) => (!m.trend ? '—' : m.trend.direction === 'steady' ? 'steady' : `${m.trend.deltaMins > 0 ? '▲' : '▼'} ${Math.abs(m.trend.deltaMins).toFixed(0)}m`), under: (m) => m.trend?.direction === 'slower' },
  { key: 'cadence', label: 'Days between', get: (m) => m.cadence?.avgDays, show: (m) => (m.cadence ? `${m.cadence.avgDays.toFixed(1)} / ${m.plannedDays}` : '—'), under: (m) => m.cadence && m.cadence.avgDays > m.plannedDays * 1.3 },
  { key: 'cuts', label: 'Cuts', get: (m) => m.cutsVsExpected?.missed, show: (m) => (m.cutsVsExpected ? `${m.cutsVsExpected.actual} of ${m.cutsVsExpected.expected}` : '—'), under: (m) => m.cutsVsExpected?.missed >= 2 },
  { key: 'skips', label: 'Skips', get: (m) => m.skipCount, show: (m) => m.skipCount, under: (m) => m.skipStreak >= 2 || m.skipCount >= 3 },
  { key: 'extras', label: 'Extras', get: (m) => m.extrasRate, show: (m) => (m.extrasRate != null ? `${Math.round(m.extrasRate * 100)}%` : '—') },
  { key: 'leaf', label: 'Leaf jobs', get: (m) => m.leaf.jobs + m.leaf.cleanups, show: (m) => (m.leaf.jobs + m.leaf.cleanups > 0 ? `${m.leaf.jobs}${m.leaf.cleanups ? ` + ${m.leaf.cleanups}` : ''}` : '—'), under: (m) => m.leaf.undecided > 0 },
];

export default function ClientMetricsTab({ customers, visits, settings }) {
  const navigate = useNavigate();
  const [sort, setSort] = useState({ key: 'revenue', dir: 'desc' });
  const targetRate = settings?.targetHourlyRate || 0;

  const metrics = useMemo(
    () => buildCustomerMetrics(customers, visits, { targetRate, defaultServices: settings?.defaultServices || [] }),
    [customers, visits, targetRate, settings]
  );

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[0];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...metrics].sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      // Customers with no value for this column always sink to the bottom.
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return col.text ? dir * String(x).localeCompare(String(y)) : dir * (x - y);
    });
  }, [metrics, sort]);

  const needsLook = useMemo(
    () => metrics.filter((m) => m.flags.length > 0).sort((a, b) => b.flags.length - a.flags.length || b.revenue - a.revenue),
    [metrics]
  );

  const sortBy = (key) => setSort((s) => (s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  const exportCsv = () => {
    const csv = [METRICS_CSV_HEADERS.join(','), ...sorted.map(metricsCsvRow)].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `customer-metrics-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (metrics.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', marginTop: '1rem' }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: '1.1rem' }}>No visits this season yet</p>
        <p style={{ marginTop: '0.4rem' }}>Customer numbers appear here once jobs are logged.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginTop: '1rem' }}>
      {/* Needs a look */}
      <div>
        <h2 style={{ ...h2, marginBottom: '1rem' }}>Needs a look ({needsLook.length})</h2>
        {needsLook.length === 0 ? (
          <div style={{ padding: '1rem', borderRadius: 'var(--radius-md)', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--color-primary)', fontWeight: 700 }}>
            Nothing stands out — every customer is on plan this season.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {needsLook.map((m) => (
              <div key={m.customerId} role="button" tabIndex={0} className="glass-card"
                onClick={() => navigate(`/customers/${m.customerId}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/customers/${m.customerId}`); }}
                style={{ padding: '0.9rem 1rem', borderLeft: `4px solid ${AMBER}`, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-text-main)' }}>{m.name}</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>${m.revenue.toFixed(0)} this season</div>
                </div>
                {m.flags.map((f) => (
                  <div key={f.key} style={{ fontSize: '0.98rem', fontWeight: 600, color: AMBER, marginTop: '0.25rem' }}>• {f.text}</div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Every customer */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <h2 style={h2}>All customers · {new Date().getFullYear()} season</h2>
          <button className="btn btn-secondary" onClick={exportCsv} style={{ padding: '0.55rem 1rem', minHeight: '44px', fontSize: '0.9rem', fontWeight: 700 }}>Export CSV</button>
        </div>
        <div style={{ overflowX: 'auto', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.98rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <th key={c.key} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      style={{ padding: 0, textAlign: c.text ? 'left' : 'right', position: c.text ? 'sticky' : 'static', left: 0, background: 'var(--color-bg-main)' }}>
                      <button onClick={() => sortBy(c.key)}
                        style={{ width: '100%', minHeight: '48px', padding: '0.6rem 0.7rem', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '0.82rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: active ? 'var(--color-primary)' : 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: c.text ? 'flex-start' : 'flex-end' }}>
                        {c.label}
                        {active && (sort.dir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr key={m.customerId} onClick={() => navigate(`/customers/${m.customerId}`)} style={{ borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}>
                  {COLUMNS.map((c) => (c.text ? (
                    <td key={c.key} style={{ ...cell, textAlign: 'left', fontWeight: 700, position: 'sticky', left: 0, background: 'var(--color-bg-card)', color: 'var(--color-text-main)' }}>
                      {m.flags.length > 0 && <span title={m.flags.map((f) => f.text).join('; ')} style={{ color: AMBER, marginRight: '0.35rem' }}>●</span>}
                      {m.name}
                    </td>
                  ) : (
                    <td key={c.key} style={{ ...cell, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: c.under?.(m, targetRate) ? AMBER : 'var(--color-text-main)' }}>
                      {c.show(m)}
                    </td>
                  )))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0.6rem 0.2rem 0' }}>
          Tap a column to sort, tap a row to open the customer. Amber means it is off plan{targetRate > 0 ? ` or under your $${targetRate}/hr target` : ''}. $/hr is job time only; "+ drive" adds the drive to the stop. Usual mow and Trend use plain mows (no leaf jobs or clean-ups). Days between shows actual / planned. Leaf jobs shows leaf jobs + clean-ups.
        </p>
      </div>
    </div>
  );
}
