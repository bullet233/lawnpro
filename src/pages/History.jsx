import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { FileText, Download, Clock, Edit2, Save, X, ClipboardList, Trash2, CheckCircle } from 'lucide-react';
import DayReviewModal from '../components/DayReviewModal';
import AppDialog from '../components/AppDialog';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt     = (secs) => { if (!secs) return '—'; const m = Math.floor(secs / 60); const s = secs % 60; return s > 0 ? `${m}m ${s}s` : `${m}m`; };
const fmtTime = (ts)   => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
const fmtMins = (secs) => secs ? (secs / 60).toFixed(1) : '0';

const dayLabel = (dateStr) => {
  const today     = new Date().toLocaleDateString();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();
  if (dateStr === today)     return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};

const STATUS_COLORS = {
  completed:  { border: 'var(--color-primary)',    bg: 'rgba(16,185,129,0.07)' },
  'quick-log': { border: '#f59e0b',                 bg: 'rgba(245,158,11,0.07)'  },
  skipped:    { border: '#ef4444',                  bg: 'rgba(239,68,68,0.05)'   },
};

export default function History() {
  const allVisits    = useLiveQuery(() => db.visits.toArray(),    []) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];

  const [timeFilter,     setTimeFilter]     = useState('all');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [editingJobId,   setEditingJobId]   = useState(null);
  const [editingServices, setEditingServices] = useState([]);
  const [showDayReview,  setShowDayReview]  = useState(false);
  const [dialog,         setDialog]         = useState(null);

  // ── Filter + join ─────────────────────────────────────────────────────────
  const historyLog = useMemo(() => {
    return allVisits.filter(visit => {
      if (customerFilter !== 'all' && visit.customerId !== Number(customerFilter)) return false;
      if (timeFilter !== 'all') {
        const d = new Date(visit.exitTime);
        const now = new Date();
        if (timeFilter === 'today'  && d.toDateString() !== now.toDateString()) return false;
        if (timeFilter === 'week'   && d < new Date(now - 7  * 86400000)) return false;
        if (timeFilter === 'month'  && d < new Date(now - 30 * 86400000)) return false;
      }
      return true;
    }).map(visit => {
      const cust = allCustomers.find(c => c.id === visit.customerId) || {};
      return { ...visit, custName: cust.name || 'Unknown', custObj: cust, priceEarned: visit.priceEarned || 0, appliedServices: visit.appliedServices || [] };
    }).sort((a, b) => b.exitTime - a.exitTime);
  }, [allVisits, allCustomers, timeFilter, customerFilter]);

  // ── Group by day ──────────────────────────────────────────────────────────
  const groupedDays = useMemo(() => {
    const map = {};
    historyLog.forEach(job => {
      const key = new Date(job.exitTime).toLocaleDateString();
      if (!map[key]) map[key] = [];
      map[key].push(job);
    });
    return Object.entries(map); // already sorted desc since historyLog is sorted desc
  }, [historyLog]);

  // ── Summary totals for filter period ─────────────────────────────────────
  const totals = useMemo(() => ({
    visits:   historyLog.filter(j => j.status !== 'skipped').length,
    revenue:  historyLog.reduce((s, j) => s + (j.priceEarned || 0), 0),
    totalSecs: historyLog.reduce((s, j) => s + (j.durationSecs || 0), 0),
  }), [historyLog]);

  // ── Service name lookup ───────────────────────────────────────────────────
  const getServiceNames = (job) => {
    if (!job.appliedServices?.length) return [];
    return job.appliedServices
      .map(sid => job.custObj?.services?.find(s => s.id === sid)?.name)
      .filter(Boolean);
  };

  // ── Edit handlers ─────────────────────────────────────────────────────────
  const handleEditClick = (job) => { setEditingJobId(job.id); setEditingServices(job.appliedServices || []); };

  const handleSaveEdit = async (job) => {
    let newPrice = 0;
    if (job.custObj?.services) {
      newPrice = job.custObj.services.filter(s => editingServices.includes(s.id)).reduce((sum, s) => sum + s.price, 0);
    }
    await db.visits.update(job.id, { appliedServices: editingServices, priceEarned: newPrice });
    setEditingJobId(null);
  };

  // ── Delete handler ────────────────────────────────────────────────────────
  const handleDelete = (job) => {
    setDialog({
      type: 'danger',
      title: 'Delete log entry?',
      message: `Remove the visit to ${job.custName} on ${new Date(job.exitTime).toLocaleDateString()}? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: () => db.visits.delete(job.id)
    });
  };

  // ── CSV Export (improved) ─────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['Date', 'Start Time', 'End Time', 'Duration (min)', 'Customer', 'Status', 'Services', 'Price ($)', 'Weather (°F)'];
    const rows = historyLog.map(job => {
      const date     = new Date(job.exitTime).toLocaleDateString();
      const start    = fmtTime(job.entryTime) || '';
      const end      = fmtTime(job.exitTime)  || '';
      const mins     = fmtMins(job.durationSecs);
      const services = getServiceNames(job).join('; ');
      const temp     = job.weather?.temp ?? '';
      return `"${date}","${start}","${end}",${mins},"${job.custName}","${job.status}","${services}",${job.priceEarned},"${temp}"`;
    });
    const csv  = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `job-history-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="animate-fade-in">
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      {showDayReview && <DayReviewModal onClose={() => setShowDayReview(false)} />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Job History</h1>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowDayReview(true)}>
            <ClipboardList size={16} /> Review Today
          </button>
          <button className="btn btn-secondary" onClick={exportCSV} disabled={historyLog.length === 0}>
            <Download size={18} /> Export CSV
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      {historyLog.length > 0 && (
        <div className="glass-card" style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.2rem', padding: '0.8rem 1.2rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px' }}>Visits</div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{totals.visits}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px' }}>Revenue</div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-primary)' }}>${totals.revenue.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px' }}>Time in Field</div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{fmt(totals.totalSecs)}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.2rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '140px' }}>
          <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Timeframe</label>
          <select className="input-field" style={{ width: '100%', padding: '0.5rem' }} value={timeFilter} onChange={e => setTimeFilter(e.target.value)}>
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">Past 7 Days</option>
            <option value="month">Past 30 Days</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: '140px' }}>
          <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Customer</label>
          <select className="input-field" style={{ width: '100%', padding: '0.5rem' }} value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}>
            <option value="all">All Customers</option>
            {allCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Empty State */}
      {historyLog.length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '3rem' }}>
          <FileText size={48} style={{ opacity: 0.4, marginBottom: '1rem', display: 'inline-block' }} />
          <p style={{ margin: 0 }}>No jobs match this filter.</p>
        </div>
      )}

      {/* Grouped Days */}
      {groupedDays.map(([dateStr, jobs]) => {
        const dayRevenue = jobs.reduce((s, j) => s + (j.priceEarned || 0), 0);
        const dayVisits  = jobs.filter(j => j.status !== 'skipped').length;

        return (
          <div key={dateStr} style={{ marginBottom: '1.5rem' }}>
            {/* Day Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.6rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>
                {dayLabel(dateStr)}
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                {dayVisits} job{dayVisits !== 1 ? 's' : ''} · <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>${dayRevenue.toFixed(2)}</span>
              </span>
            </div>

            {/* Job Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {jobs.map(job => {
                const colors       = STATUS_COLORS[job.status] || STATUS_COLORS.completed;
                const serviceNames = getServiceNames(job);
                const isEditing    = editingJobId === job.id;
                const activeServices = job.custObj?.services?.filter(s => s.active) || [];

                return (
                  <div key={job.id} className="glass-card" style={{ borderLeft: `4px solid ${colors.border}`, background: colors.bg, padding: '0.9rem 1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      {/* Left: Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>{job.custName}</div>

                        {/* Time row */}
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.2rem' }}>
                          <Clock size={11} />
                          {job.entryTime
                            ? `${fmtTime(job.entryTime)} → ${fmtTime(job.exitTime)}`
                            : fmtTime(job.exitTime)
                          }
                          <span style={{ marginLeft: '0.3rem' }}>({fmt(job.durationSecs)})</span>
                        </div>

                        {/* Service chips */}
                        {serviceNames.length > 0 && (
                          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                            {serviceNames.map(name => (
                              <span key={name} style={{ padding: '2px 8px', fontSize: '0.72rem', borderRadius: '999px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--color-primary)', fontWeight: 600 }}>
                                {name}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Status + weather badges */}
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.7rem', padding: '2px 7px', borderRadius: '4px', border: `1px solid ${colors.border}`, color: colors.border, textTransform: 'capitalize', fontWeight: 600 }}>
                            {job.status}
                          </span>
                          {job.weather && (
                            <span style={{ fontSize: '0.7rem', padding: '2px 7px', borderRadius: '4px', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                              {job.weather.temp}°F
                            </span>
                          )}
                        </div>

                        {/* Note */}
                        {job.note && (
                          <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                            📝 "{job.note}"
                          </div>
                        )}
                      </div>

                      {/* Right: Price + actions */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem', marginLeft: '0.8rem', flexShrink: 0 }}>
                        <div style={{ fontWeight: 700, color: job.status === 'skipped' ? 'var(--color-text-muted)' : 'var(--color-primary)', fontSize: '1.15rem' }}>
                          ${job.priceEarned.toFixed(2)}
                        </div>
                        {!isEditing && (
                          <div style={{ display: 'flex', gap: '0.3rem' }}>
                            {job.status !== 'skipped' && (
                              <button title="Edit services" onClick={() => handleEditClick(job)} style={{ padding: '4px 6px', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                                <Edit2 size={12} />
                              </button>
                            )}
                            <button title="Delete entry" onClick={() => handleDelete(job)} style={{ padding: '4px 6px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '4px', color: '#ef4444', cursor: 'pointer' }}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Edit Mode */}
                    {isEditing && (
                      <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                          Services performed:
                        </div>
                        {activeServices.length === 0 ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No active services on this customer's profile.</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.8rem' }}>
                            {activeServices.map(svc => {
                              const checked = editingServices.includes(svc.id);
                              return (
                                <label key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.7rem', borderRadius: '999px', border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--color-border)'}`, background: checked ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-card)', cursor: 'pointer', fontSize: '0.82rem', userSelect: 'none', transition: 'all 0.15s' }}>
                                  <input type="checkbox" checked={checked} onChange={e => {
                                    if (e.target.checked) setEditingServices(p => [...p, svc.id]);
                                    else setEditingServices(p => p.filter(id => id !== svc.id));
                                  }} style={{ display: 'none' }} />
                                  {checked && <CheckCircle size={12} color="var(--color-primary)" />}
                                  {svc.name} <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>${svc.price}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-primary" style={{ flex: 1, padding: '0.4rem', fontSize: '0.82rem' }} onClick={() => handleSaveEdit(job)}>
                            <Save size={13} /> Save
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.82rem' }} onClick={() => setEditingJobId(null)}>
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
