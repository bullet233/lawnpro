import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { FileText, Download, Clock, Edit2, Save, X, ClipboardList, Trash2, CheckCircle, Calendar, List } from 'lucide-react';
import DayReviewModal from '../components/DayReviewModal';
import VisitEditModal from '../components/VisitEditModal';
import AppDialog from '../components/AppDialog';
import ComplianceLogModal from '../components/ComplianceLogModal';
import { getSettings } from '../db/settings';
import { getBusinessDateString, getBusinessDayStart } from '../utils/dateUtils';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (secs) => { 
  if (!secs) return '—'; 
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60); 
  const s = secs % 60; 
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`; 
};
const fmtTime = (ts)   => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
const fmtMins = (secs) => secs ? (secs / 60).toFixed(1) : '0';

const dayLabel = (dateStr) => {
  const today     = getBusinessDateString(new Date());
  const yesterday = getBusinessDateString(new Date(Date.now() - 86400000));
  if (dateStr === today)     return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};

const STATUS_COLORS = {
  completed:  { border: 'var(--color-primary)',    bg: 'rgba(16,185,129,0.07)' },
  skipped:    { border: '#ef4444',                  bg: 'rgba(239,68,68,0.05)'   },
};

// ── Pagination constant ─────────────────────────────────────────────────────
const PAGE_SIZE = 20;

export default function History() {
  const allVisits    = useLiveQuery(() => db.visits.toArray(),    []) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];

  const [timeFilter,     setTimeFilter]     = useState('today');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [serviceFilter,  setServiceFilter]  = useState('all');
  const [editingJob, setEditingJob] = useState(null);
  const [showDayReview,  setShowDayReview]  = useState(false);
  const [dialog,         setDialog]         = useState(null);
  const [activeEpaJob,   setActiveEpaJob]   = useState(null);
  const [settings, setSettings] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState('list');
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  // Custom date range state
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate,   setCustomEndDate]   = useState('');

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [timeFilter, customerFilter, statusFilter, serviceFilter, customStartDate, customEndDate]);

  // ── Get all unique services applied ───────────────────────────────────────
  const uniqueServiceNames = useMemo(() => {
    const names = new Set();
    allVisits.forEach(job => {
      if (job.appliedServices) {
        const cust = allCustomers.find(c => c.id === job.customerId);
        if (cust && cust.services) {
          job.appliedServices.forEach(sid => {
            const svc = cust.services.find(s => s.id === sid);
            if (svc && svc.name) names.add(svc.name);
          });
        }
      }
    });
    return Array.from(names).sort();
  }, [allVisits, allCustomers]);

  // ── Filter + join ─────────────────────────────────────────────────────────
  const historyLog = useMemo(() => {
    return allVisits.filter(visit => {
      if (customerFilter !== 'all' && visit.customerId !== Number(customerFilter)) return false;
      if (statusFilter !== 'all' && visit.status !== statusFilter) return false;
      if (serviceFilter !== 'all') {
        const cust = allCustomers.find(c => c.id === visit.customerId);
        if (!cust) return false;
        const sNames = (visit.appliedServices || []).map(sid => cust.services?.find(s => s.id === sid)?.name);
        if (!sNames.includes(serviceFilter)) return false;
      }
      if (timeFilter !== 'all') {
        const d = new Date(visit.exitTime);
        const now = new Date();
        if (timeFilter === 'today'  && d.toDateString() !== now.toDateString()) return false;
        if (timeFilter === 'yesterday') {
          const y = new Date(now);
          y.setDate(y.getDate() - 1);
          if (d.toDateString() !== y.toDateString()) return false;
        }
        if (timeFilter === 'week'   && d < new Date(now - 7  * 86400000)) return false;
        if (timeFilter === 'month'  && d < new Date(now - 30 * 86400000)) return false;
        if (timeFilter === 'custom') {
          if (customStartDate) {
            const start = new Date(customStartDate);
            start.setHours(0, 0, 0, 0);
            if (d < start) return false;
          }
          if (customEndDate) {
            const end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999);
            if (d > end) return false;
          }
        }
      }
      return true;
    }).map(visit => {
      const cust = allCustomers.find(c => c.id === visit.customerId) || {};
      return { ...visit, custName: cust.name || 'Unknown', custObj: cust, priceEarned: visit.priceEarned || 0, appliedServices: visit.appliedServices || [] };
    }).sort((a, b) => b.exitTime - a.exitTime);
  }, [allVisits, allCustomers, timeFilter, customerFilter, statusFilter, serviceFilter, customStartDate, customEndDate]);

  // ── Group by day ──────────────────────────────────────────────────────────
  const groupedDays = useMemo(() => {
    const map = {};
    historyLog.forEach(job => {
      const key = getBusinessDateString(new Date(job.exitTime));
      if (!map[key]) map[key] = [];
      map[key].push(job);
    });
    return Object.entries(map); // already sorted desc since historyLog is sorted desc
  }, [historyLog]);

  // ── Paginated grouped days ────────────────────────────────────────────────
  const { paginatedDays, totalVisibleJobs, hasMore } = useMemo(() => {
    const maxJobs = currentPage * PAGE_SIZE;
    let count = 0;
    const result = [];
    for (const [dateStr, jobs] of groupedDays) {
      if (count >= maxJobs) break;
      const remaining = maxJobs - count;
      if (jobs.length <= remaining) {
        result.push([dateStr, jobs]);
        count += jobs.length;
      } else {
        result.push([dateStr, jobs.slice(0, remaining)]);
        count += remaining;
      }
    }
    return {
      paginatedDays: result,
      totalVisibleJobs: count,
      hasMore: count < historyLog.length,
    };
  }, [groupedDays, currentPage, historyLog.length]);

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
  const handleEditClick = (job) => { 
    setEditingJob(job);
  };

  const handleSaveEdit = async (updates) => {
    if (!editingJob) return;
    await db.visits.update(editingJob.id, updates);
    setEditingJob(null);
  };

  const handleSaveEpaLog = async (logData) => {
    if (!activeEpaJob) return;
    await db.visits.update(activeEpaJob.id, { complianceLog: logData });
    setActiveEpaJob(null);
  };

  // ── Delete handler ────────────────────────────────────────────────────────
  const handleDelete = (job) => {
    let dateStr = 'unknown date';
    try {
      if (job.exitTime) dateStr = new Date(job.exitTime).toLocaleDateString();
    } catch(e) {}
    
    setDialog({
      type: 'danger',
      title: 'Delete log entry?',
      message: `Remove the visit to ${job.custName} on ${dateStr}? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await db.visits.delete(Number(job.id));
          setDialog(null);
        } catch (error) {
          console.error('Failed to delete visit:', error);
          alert('Could not delete the log. Please refresh the app and try again.');
        }
      }
    });
  };

  // ── CSV Export (Blob-based) ───────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['Date', 'Start Time', 'End Time', 'Job Time (min)', 'Drive Time (min)', 'Customer', 'Status', 'Services', 'Price ($)', 'Weather (°F)', 'Note'];
    const rows = historyLog.map(job => {
      const date     = new Date(job.exitTime).toLocaleDateString();
      const start    = fmtTime(job.entryTime) || '';
      const end      = fmtTime(job.exitTime)  || '';
      const bladeMins= fmtMins(job.durationSecs);
      const driveMins= fmtMins(job.driveTimeSecs || 0);
      const baseServices = getServiceNames(job).join('; ');
      const addOnServices = job.addOns?.map(a => '+' + a.name).join('; ') || '';
      const services = [baseServices, addOnServices].filter(Boolean).join(' | ');
      const temp     = job.weather?.temp ?? '';
      const note     = (job.note || '').replace(/"/g, '""');
      return `"${date}","${start}","${end}",${bladeMins},${driveMins},"${job.custName}","${job.status}","${services}",${job.priceEarned},"${temp}","${note}"`;
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `job-history-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── Status filter pill style helper ───────────────────────────────────────
  const statusPillStyle = (value) => ({
    padding: '0.3rem 0.7rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    borderRadius: '999px',
    cursor: 'pointer',
    border: statusFilter === value ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
    background: statusFilter === value ? 'rgba(16,185,129,0.12)' : 'var(--color-bg-card)',
    color: statusFilter === value ? 'var(--color-primary)' : 'var(--color-text-muted)',
    transition: 'all 0.15s',
  });

  const timePillStyle = (value) => ({
    padding: '0.3rem 0.7rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    borderRadius: '999px',
    cursor: 'pointer',
    border: timeFilter === value ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
    background: timeFilter === value ? 'rgba(16,185,129,0.12)' : 'var(--color-bg-card)',
    color: timeFilter === value ? 'var(--color-primary)' : 'var(--color-text-muted)',
    transition: 'all 0.15s',
  });

  const handleCalendarDayClick = (dateStr) => {
    setCustomStartDate(dateStr);
    setCustomEndDate(dateStr);
    setTimeFilter('custom');
    setViewMode('list');
  };

  const renderCalendar = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    
    // First day of month
    const firstDay = new Date(year, month, 1).getDay();
    // Days in month
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Map job revenue by date string YYYY-MM-DD
    const dayStats = {};
    historyLog.forEach(job => {
      // Create local date string safely
      const d = new Date(job.exitTime);
      const k = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
      if (!dayStats[k]) dayStats[k] = { revenue: 0, count: 0 };
      dayStats[k].revenue += job.priceEarned || 0;
      if (job.status !== 'skipped') dayStats[k].count++;
    });

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} style={{ padding: '0.5rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)' }} />);
    }
    
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${(month+1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
      const stats = dayStats[dateStr];
      const isToday = new Date().toDateString() === new Date(year, month, d).toDateString();

      days.push(
        <div 
          key={d} 
          onClick={() => handleCalendarDayClick(dateStr)}
          style={{ 
            padding: '0.5rem', 
            minHeight: '80px',
            background: 'var(--color-bg-card)', 
            border: isToday ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            transition: 'all 0.15s'
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: isToday ? 'var(--color-primary)' : 'var(--color-text-main)', marginBottom: 'auto' }}>
            {d}
          </div>
          {stats && stats.count > 0 && (
            <div style={{ marginTop: '0.4rem', background: 'rgba(16,185,129,0.1)', padding: '0.2rem', borderRadius: '4px' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontWeight: 600, lineHeight: 1.2 }}>{stats.count} jobs</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 800 }}>${stats.revenue.toFixed(0)}</div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="glass-card" style={{ padding: '1rem', marginTop: '1rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem' }} onClick={() => setCalendarMonth(new Date(year, month - 1, 1))}>Prev</button>
          <h2 style={{ fontSize: '1.2rem', margin: 0 }}>{calendarMonth.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem' }} onClick={() => setCalendarMonth(new Date(year, month + 1, 1))}>Next</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontWeight: 700, fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
          {days}
        </div>
      </div>
    );
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto' }}>
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      {showDayReview && <DayReviewModal onClose={() => setShowDayReview(false)} />}
      {activeEpaJob && (
        <ComplianceLogModal 
          visit={activeEpaJob}
          customerName={activeEpaJob.custName}
          customerLawnSize={activeEpaJob.custObj?.lawnSize}
          initialLog={activeEpaJob.complianceLog}
          onSave={handleSaveEpaLog}
          onClose={() => setActiveEpaJob(null)}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Job History</h1>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button className="btn btn-secondary" onClick={() => setViewMode(v => v === 'list' ? 'calendar' : 'list')} style={{ padding: '0.4rem 0.6rem' }}>
            {viewMode === 'list' ? <Calendar size={18} /> : <List size={18} />}
          </button>
          <button className="btn btn-secondary" onClick={() => setShowDayReview(true)} style={{ padding: '0.4rem 0.8rem' }}>
            <ClipboardList size={16} /> Review
          </button>
          <button className="btn btn-secondary" onClick={exportCSV} disabled={historyLog.length === 0} style={{ padding: '0.4rem 0.8rem' }}>
            <Download size={16} /> CSV
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      {historyLog.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.3rem', fontWeight: 700 }}>Total Visits</div>
            <div style={{ fontWeight: 800, fontSize: '1.6rem', color: 'var(--color-text-main)', lineHeight: 1 }}>{totals.visits}</div>
          </div>
          <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderBottom: '3px solid var(--color-primary)' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.3rem', fontWeight: 700 }}>Total Revenue</div>
            <div style={{ fontWeight: 800, fontSize: '1.6rem', color: 'var(--color-primary)', lineHeight: 1 }}>${totals.revenue.toFixed(2)}</div>
          </div>
          <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.3rem', fontWeight: 700 }}>Time in Field</div>
            <div style={{ fontWeight: 800, fontSize: '1.6rem', color: 'var(--color-text-main)', lineHeight: 1 }}>{fmt(totals.totalSecs)}</div>
          </div>
        </div>
      )}

      {/* Time Filters */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.2rem', flexWrap: 'wrap' }}>
        <button style={timePillStyle('today')} onClick={() => setTimeFilter('today')}>Today</button>
        <button style={timePillStyle('yesterday')} onClick={() => setTimeFilter('yesterday')}>Yesterday</button>
        <button style={timePillStyle('week')} onClick={() => setTimeFilter('week')}>This Week</button>
        <button style={timePillStyle('month')} onClick={() => setTimeFilter('month')}>This Month</button>
        <button style={timePillStyle('all')} onClick={() => setTimeFilter('all')}>All Time</button>
        <button style={timePillStyle('custom')} onClick={() => setTimeFilter('custom')}>Custom</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '140px' }}>
          <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Customer</label>
          <select className="input-field" style={{ width: '100%', padding: '0.5rem' }} value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}>
            <option value="all">All Customers</option>
            {allCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: '140px' }}>
          <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Service</label>
          <select className="input-field" style={{ width: '100%', padding: '0.5rem' }} value={serviceFilter} onChange={e => setServiceFilter(e.target.value)}>
            <option value="all">All Services</option>
            {uniqueServiceNames.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      </div>

      {/* Custom Date Range */}
      {timeFilter === 'custom' && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '140px' }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Start Date</label>
            <input
              type="date"
              className="input-field"
              style={{ width: '100%', padding: '0.5rem' }}
              value={customStartDate}
              onChange={e => setCustomStartDate(e.target.value)}
            />
          </div>
          <div style={{ flex: 1, minWidth: '140px' }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>End Date</label>
            <input
              type="date"
              className="input-field"
              style={{ width: '100%', padding: '0.5rem' }}
              value={customEndDate}
              onChange={e => setCustomEndDate(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Status Filter Pills */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.2rem', flexWrap: 'wrap' }}>
        <button style={statusPillStyle('all')} onClick={() => setStatusFilter('all')}>All</button>
        <button style={statusPillStyle('completed')} onClick={() => setStatusFilter('completed')}>Completed</button>
        <button style={statusPillStyle('skipped')} onClick={() => setStatusFilter('skipped')}>Skipped</button>
      </div>

      {/* Empty State */}
      {historyLog.length === 0 && viewMode === 'list' && (
        <div className="glass-card" style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '3rem' }}>
          <FileText size={48} style={{ opacity: 0.4, marginBottom: '1rem', display: 'inline-block' }} />
          <p style={{ margin: 0 }}>No jobs match this filter.</p>
        </div>
      )}

      {/* Calendar View */}
      {viewMode === 'calendar' && renderCalendar()}

      {/* Grouped Days (paginated) */}
      {viewMode === 'list' && paginatedDays.map(([dateStr, jobs]) => {
        const dayRevenue = jobs.reduce((s, j) => s + (j.priceEarned || 0), 0);
        const dayVisits  = jobs.filter(j => j.status !== 'skipped').length;

        return (
          <div key={dateStr} style={{ marginBottom: '1.5rem' }}>
            {/* Day Header */}
            <div style={{ 
              position: 'sticky', 
              top: 0, 
              zIndex: 10, 
              background: 'var(--glass-bg)', 
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              paddingTop: '1rem',
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'baseline', 
              marginBottom: '0.6rem', 
              paddingBottom: '0.4rem', 
              borderBottom: '1px solid var(--color-border)' 
            }}>
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
                const isEditing    = false; // Handled by VisitEditModal now
                const activeServices = job.custObj?.services?.filter(s => s.active) || [];

                return (
                  <div key={job.id} className="glass-card" style={{ borderLeft: `4px solid ${colors.border}`, background: 'var(--color-bg-card)', padding: '1.2rem', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.8rem' }}>
                      {/* Left: Info */}
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--color-text-main)' }}>{job.custName}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.3rem' }}>
                          <Clock size={14} />
                          <span style={{ fontWeight: 600 }}>{new Date(job.exitTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span> • 
                          {job.entryTime
                            ? `${fmtTime(job.entryTime)} → ${fmtTime(job.exitTime)}`
                            : fmtTime(job.exitTime)
                          }
                        </div>
                      </div>

                      {/* Right: Price + Status */}
                      <div style={{ textAlign: 'right' }}>
                        {(() => {
                          let priceColor = job.status === 'skipped' ? 'var(--color-text-muted)' : 'var(--color-primary)';
                          if (job.status !== 'skipped' && settings) {
                            const totalMinutes = ((job.durationSecs || 0) + (job.driveTimeSecs || 0)) / 60;
                            if (totalMinutes > 0) {
                              const targetCharge = (totalMinutes / 60) * settings.targetHourlyRate;
                              if (job.priceEarned < targetCharge) {
                                const underpaidTarget = (totalMinutes / 60) * settings.rateUnderpaidThreshold;
                                priceColor = (job.priceEarned < underpaidTarget) ? '#ef4444' : '#f59e0b';
                              }
                            }
                          }
                          return (
                            <div style={{ fontWeight: 800, color: priceColor, fontSize: '1.3rem' }}>
                              ${job.priceEarned.toFixed(2)}
                            </div>
                          );
                        })()}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                          <span style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: '999px', backgroundColor: colors.bg, color: colors.border, textTransform: 'capitalize', fontWeight: 700 }}>
                            {job.status}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Services & Weather */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                      {serviceNames.map(name => (
                        <span key={name} style={{ padding: '4px 12px', fontSize: '0.8rem', borderRadius: '999px', background: 'rgba(16,185,129,0.1)', color: 'var(--color-primary)', fontWeight: 600 }}>
                          {name}
                        </span>
                      ))}
                      {job.addOns?.map(addon => (
                        <span key={addon.id} style={{ padding: '4px 12px', fontSize: '0.8rem', borderRadius: '999px', background: 'rgba(59,130,246,0.1)', color: '#3b82f6', fontWeight: 600 }}>
                          + {addon.name}
                        </span>
                      ))}
                      {job.weather && (
                        <span style={{ fontSize: '0.8rem', padding: '4px 12px', borderRadius: '999px', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                          {job.weather.temp}°F
                        </span>
                      )}
                      {serviceNames.some(n => n?.toLowerCase().match(/(fertilizer|weed|spray|chem)/)) && (
                        <button 
                          onClick={() => setActiveEpaJob(job)}
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'none', borderRadius: '999px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          <ClipboardList size={14} />
                          {job.complianceLog ? 'View EPA Log' : 'Add EPA Log'}
                        </button>
                      )}
                    </div>

                    {/* Note */}
                    {job.note && (
                      <div style={{ padding: '0.8rem 1rem', background: 'rgba(245,158,11,0.05)', borderLeft: '3px solid #f59e0b', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', color: 'var(--color-text-main)', marginBottom: '1rem' }}>
                        {job.note}
                      </div>
                    )}

                    {/* Bottom Row: Breakdown & Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid var(--color-border)', paddingTop: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                      
                      {/* Time & Target Breakdown */}
                      {settings && job.status !== 'skipped' ? (
                        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--color-text-main)', background: 'var(--color-bg-main)', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>Drive</span>
                            <span style={{ fontWeight: 600, marginTop: '2px' }}>{fmt(job.driveTimeSecs || 0)}</span>
                            <span style={{ color: 'var(--color-text-muted)', marginTop: '2px' }}>${(((job.driveTimeSecs || 0) / 3600) * settings.targetHourlyRate).toFixed(2)}</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>Job</span>
                            <span style={{ fontWeight: 600, marginTop: '2px' }}>{fmt(job.durationSecs || 0)}</span>
                            <span style={{ color: 'var(--color-text-muted)', marginTop: '2px' }}>${(((job.durationSecs || 0) / 3600) * settings.targetHourlyRate).toFixed(2)}</span>
                          </div>
                          <div style={{ width: '1px', background: 'var(--color-border)', margin: '0.2rem 0' }} />
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>Total</span>
                            <span style={{ fontWeight: 800, color: 'var(--color-text-main)', marginTop: '2px' }}>{fmt((job.driveTimeSecs || 0) + (job.durationSecs || 0))}</span>
                            <span style={{ fontWeight: 800, color: 'var(--color-text-main)', marginTop: '2px' }}>${((((job.driveTimeSecs || 0) + (job.durationSecs || 0)) / 3600) * settings.targetHourlyRate).toFixed(2)}</span>
                          </div>
                        </div>
                      ) : <div />} {/* Empty div to maintain flex space-between if no breakdown */}

                      {/* Actions */}
                      {!isEditing && (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          {job.status !== 'skipped' && (
                            <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => handleEditClick(job)}>
                              <Edit2 size={14} /> Edit
                            </button>
                          )}
                          <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }} onClick={() => handleDelete(job)}>
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Show More Pagination Button */}
      {viewMode === 'list' && hasMore && (
        <div style={{ textAlign: 'center', marginTop: '1rem', marginBottom: '1.5rem' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.6rem 2rem', fontSize: '0.85rem', fontWeight: 600 }}
            onClick={() => setCurrentPage(p => p + 1)}
          >
            Show More ({totalVisibleJobs} of {historyLog.length})
          </button>
        </div>
      )}

      {editingJob && (
        <VisitEditModal
          job={editingJob}
          customer={allCustomers.find(c => c.id === editingJob.customerId)}
          defaultServices={settings?.defaultServices}
          onClose={() => setEditingJob(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}
