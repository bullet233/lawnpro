import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { syncTreatmentLogFromVisit } from '../db/treatments';
import DayReviewModal from '../components/DayReviewModal';
import VisitEditModal from '../components/VisitEditModal';
import AppDialog from '../components/AppDialog';
import ComplianceLogModal from '../components/ComplianceLogModal';
import { getSettings } from '../db/settings';
import { isCleanupVisit, isLeafVisit, LEAF_REVENUE_KEY } from '../utils/leaves';
import { changeVisitServices } from '../utils/leafBilling';
import { getBusinessDateString, parseLocalDate } from '../utils/dateUtils';
import { calculateServiceTotals, getVisitRevenueBreakdown } from '../utils/revenueUtils';
import { useServiceMode } from '../components/ServiceProvider';
import { toast } from '../utils/toast';
import { Search, X, ChevronDown, ChevronRight } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (secs) => { 
  if (!secs) return '—'; 
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60); 
  const s = secs % 60; 
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`; 
};
// Hours and minutes only — for totals, where seconds are noise.
const fmtHM = (secs) => {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const summaryTile  = { background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.8rem 1rem', textAlign: 'center' };
const summaryLabel = { fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.3rem', fontWeight: 700 };
const summaryValue = { fontWeight: 800, fontSize: '2rem', color: 'var(--color-text-main)', lineHeight: 1.1 };
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

  // Default to the last 7 days, not 'today' — Logs opened first thing in the
  // morning (before any work) would otherwise be empty every day.
  const [timeFilter,     setTimeFilter]     = useState('week');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [serviceFilter,  setServiceFilter]  = useState('all');
  const [editingJob, setEditingJob] = useState(null);
  const [showDayReview,  setShowDayReview]  = useState(false);
  const [dialog,         setDialog]         = useState(null);
  const [activeEpaJob,   setActiveEpaJob]   = useState(null);
  const { activeMode } = useServiceMode();
  const [settings, setSettings] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState('list');
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  // Custom date range state
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate,   setCustomEndDate]   = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [search, setSearch] = useState('');           // customer name / address
  const [collapsedDays, setCollapsedDays] = useState([]); // day keys folded shut

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [timeFilter, customerFilter, statusFilter, serviceFilter, customStartDate, customEndDate, search]);

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
    const needle = search.trim().toLowerCase();
    return allVisits.filter(visit => {
      // Must match global activeMode
      if (visit.division && visit.division !== activeMode) return false;
      
      if (customerFilter !== 'all' && visit.customerId !== Number(customerFilter)) return false;
      if (needle) {
        const cust = allCustomers.find(c => c.id === visit.customerId);
        if (!`${cust?.name || ''} ${cust?.address || ''}`.toLowerCase().includes(needle)) return false;
      }
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
        if (timeFilter === 'week') {
          // Current calendar week (Monday start), local — NOT a rolling 7×24h
          // window. The old version counted back 168h from the current moment,
          // so "This Week" pulled in most of last week and drifted by time-of-day.
          const weekStart = new Date(now);
          weekStart.setHours(0, 0, 0, 0);
          // JS getDay(): 0=Sun..6=Sat. Days since Monday = (getDay()+6)%7.
          weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
          if (d < weekStart) return false;
        }
        if (timeFilter === 'month') {
          // Current calendar month (the 1st, local), not a rolling 30 days.
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          if (d < monthStart) return false;
        }
        if (timeFilter === 'custom') {
          if (customStartDate) {
            const start = parseLocalDate(customStartDate);
            start.setHours(0, 0, 0, 0);
            if (d < start) return false;
          }
          if (customEndDate) {
            const end = parseLocalDate(customEndDate);
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
  }, [allVisits, allCustomers, customerFilter, statusFilter, serviceFilter, timeFilter, customStartDate, customEndDate, activeMode, search]);

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
  const totals = useMemo(() => {
    const revenue = historyLog.reduce((s, j) => s + (j.priceEarned || 0), 0);
    // Average $/hr counts every hour on the clock: job time plus drive time.
    const clockSecs = historyLog.reduce((s, j) => s + (j.durationSecs || 0) + (j.driveTimeSecs || 0), 0);
    return {
      visits:   historyLog.filter(j => j.status !== 'skipped').length,
      revenue,
      totalSecs: historyLog.reduce((s, j) => s + (j.durationSecs || 0), 0),
      rate: clockSecs >= 60 ? revenue / (clockSecs / 3600) : null,
      serviceBreakdown: calculateServiceTotals(historyLog, allCustomers || [], settings?.defaultServices || [])
    };
  }, [historyLog, allCustomers, settings]);

  // ── Empty state: say why it's empty and offer the nearest range with jobs ──
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const showRange = (start, end) => { setCustomStartDate(ymd(start)); setCustomEndDate(ymd(end)); setTimeFilter('custom'); };
  const emptyState = (() => {
    const now = new Date();
    const clearSearch = { label: 'Clear search', primary: true, run: () => setSearch('') };
    const allTime = { label: 'Show all time', run: () => setTimeFilter('all') };
    if (search.trim()) return { title: `No jobs for “${search.trim()}” in this range.`, hint: 'Check the spelling or look further back.', actions: [clearSearch, allTime] };
    if (timeFilter === 'today') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { title: 'No jobs logged yet today.', hint: 'They show up here as soon as you finish one.', actions: [{ label: 'Show yesterday', primary: true, run: () => setTimeFilter('yesterday') }, { label: 'Show this week', run: () => setTimeFilter('week') }] };
    }
    if (timeFilter === 'week') {
      const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) - 7);
      const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
      return { title: 'No jobs logged yet this week.', hint: 'The week starts on Monday.', actions: [{ label: 'Show last week', primary: true, run: () => showRange(mon, sun) }, allTime] };
    }
    if (timeFilter === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { title: 'No jobs logged yet this month.', hint: '', actions: [{ label: 'Show last month', primary: true, run: () => showRange(first, last) }, allTime] };
    }
    return { title: 'No jobs match these filters.', hint: 'Try a wider time range or a different customer.', actions: timeFilter === 'all' ? [] : [allTime] };
  })();

  // ── Service name lookup ───────────────────────────────────────────────────
  const getServiceNames = (job) => {
    if (!job.appliedServices?.length) return [];
    return job.appliedServices
      .map(sid => job.custObj?.services?.find(s => s.id === sid)?.name)
      .filter(Boolean);
  };

  // ── One-tap service change ────────────────────────────────────────────────
  // Services a logged visit can be switched between: the customer's regular
  // ones, whatever is on the visit, and (mowing visits) their clean-up service
  // even when it isn't a regular one.
  const serviceChoicesFor = (job) => {
    const applied = job.appliedServices || [];
    const isMowingVisit = !job.division || job.division === 'mowing';
    return (job.custObj?.services || []).filter(s =>
      s.active || applied.includes(s.id) || (isMowingVisit && /clean|leaf/i.test(s.name || '')));
  };

  const handleToggleService = async (job, svc) => {
    const applied = job.appliedServices || [];
    const next = applied.includes(svc.id) ? applied.filter(id => id !== svc.id) : [...applied, svc.id];
    if (next.length === 0) {
      toast('Pick the other service first — a visit needs at least one.', 'error');
      return;
    }
    const updated = await changeVisitServices(job.id, next);
    if (!updated) return;
    const names = (job.custObj?.services || []).filter(s => next.includes(s.id)).map(s => s.name).join(' + ');
    toast(`${job.custName}: now ${names} · $${(updated.priceEarned || 0).toFixed(2)} (was $${(job.priceEarned || 0).toFixed(2)})`);
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
    // If this visit auto-completed a program step, carry the log onto it too.
    await syncTreatmentLogFromVisit(activeEpaJob.id, logData);
    setActiveEpaJob(null);
    return activeEpaJob.id;
  };

  // ── Delete handler ────────────────────────────────────────────────────────
  const handleDelete = (job) => {
    let dateStr = 'unknown date';
    try {
      if (job.exitTime) dateStr = new Date(job.exitTime).toLocaleDateString();
    } catch { /* keep the 'unknown date' fallback */ }
    
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
          toast('Could not delete the log. Please refresh the app and try again.', 'error');
        }
      }
    });
  };

  // ── CSV Export (Blob-based) ───────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['Date', 'Start Time', 'End Time', 'Job Time (min)', 'Drive Time (min)', 'Customer', 'Status', 'Services', 'Price ($)', 'Leaf Job', 'Leaf Time (min)', 'Leaf Suggested ($)', 'Leaf Charged ($)', 'Weather (°F)', 'Note'];
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
      const cleanup  = isCleanupVisit(job);
      const leafJob  = cleanup || (Array.isArray(job.conditions) && job.conditions.includes('leaves'));
      const leafCol  = cleanup ? 'Clean-up' : leafJob ? 'Yes' : '';
      const charged  = !leafJob || !job.leafDecided ? '' : cleanup ? (job.priceEarned || 0) : (job.leafCharge || 0);
      return `"${date}","${start}","${end}",${bladeMins},${driveMins},"${job.custName}","${job.status}","${services}",${job.priceEarned},"${leafCol}",${leafJob && job.leafSecs != null ? Math.round(job.leafSecs / 60) : ''},${leafJob ? (job.leafSuggested || 0) : ''},${charged},"${temp}","${note}"`;
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
  const pillStyle = (isActive) => ({
    padding: '0.5rem 1rem',
    minHeight: '40px',
    fontSize: '0.9rem',
    fontWeight: 600,
    borderRadius: '999px',
    cursor: 'pointer',
    border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
    background: isActive ? 'rgba(16,185,129,0.12)' : 'var(--color-bg-card)',
    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
    transition: 'all 0.15s',
  });

  // Opening the calendar on a month with nothing in it is a dead end: jump to
  // the latest month that has jobs under the current filters.
  const openCalendar = () => {
    const inMonth = (ts, m) => { const d = new Date(ts); return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth(); };
    if (historyLog.length > 0 && !historyLog.some(j => inMonth(j.exitTime, calendarMonth))) {
      const latest = new Date(Math.max(...historyLog.map(j => j.exitTime || 0)));
      setCalendarMonth(new Date(latest.getFullYear(), latest.getMonth(), 1));
    }
    setViewMode('calendar');
  };

  // One line on a leaf job / clean-up row saying where its billing stands.
  const leafStatusFor = (job) => {
    if (job.status !== 'completed') return null;
    const money = (n) => `$${(n || 0).toFixed(2)}`;
    const hint = job.leafSuggested > 0 ? ` · suggested ${money(job.leafSuggested)}` : '';
    if (isCleanupVisit(job)) {
      return job.leafDecided
        ? { open: false, text: `Clean-up price set: ${money(job.priceEarned)}` }
        : { open: true, text: `Clean-up price: not decided${hint}` };
    }
    if (!isLeafVisit(job)) return null;
    if (!job.leafDecided) return { open: true, text: `🍂 Leaf charge: not decided${hint}` };
    return { open: false, text: job.leafCharge > 0 ? `🍂 +${money(job.leafCharge)} leaves` : '🍂 Leaves: no charge' };
  };

  const handleCalendarDayClick = (dateStr) => {
    setCustomStartDate(dateStr);
    setCustomEndDate(dateStr);
    setTimeFilter('custom');
    setViewMode('list');
  };

  const renderCalendar = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const dayStats = {};
    historyLog.forEach(job => {
      const d = new Date(job.exitTime);
      const k = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
      if (!dayStats[k]) dayStats[k] = { revenue: 0, count: 0, leaf: 0, cleanup: 0 };
      dayStats[k].revenue += job.priceEarned || 0;
      if (job.status !== 'skipped') {
        dayStats[k].count++;
        if (isCleanupVisit(job)) dayStats[k].cleanup++;
        else if (isLeafVisit(job)) dayStats[k].leaf++;
      }
    });

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} style={{ padding: '0.5rem', background: 'transparent' }} />);
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
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, lineHeight: 1.2 }}>{stats.count} job{stats.count !== 1 ? 's' : ''}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-primary)', fontWeight: 800 }}>${stats.revenue.toFixed(0)}</div>
              {(stats.leaf > 0 || stats.cleanup > 0) && (
                <div style={{ fontSize: '0.7rem', color: '#b45309', fontWeight: 700, lineHeight: 1.3 }}>
                  {stats.leaf > 0 && <div>🍂 {stats.leaf} leaf</div>}
                  {stats.cleanup > 0 && <div>{stats.cleanup} clean-up</div>}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <div style={{ padding: '1rem', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem' }} onClick={() => setCalendarMonth(new Date(year, month - 1, 1))}>Prev</button>
          <h2 style={{ fontSize: '1.2rem', margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>{calendarMonth.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem' }} onClick={() => setCalendarMonth(new Date(year, month + 1, 1))}>Next</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontWeight: 700, fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
          {days}
        </div>
      </div>
    );
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
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

      <div className="no-print">
        {/* Sleek Dashboard Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid var(--color-border)', paddingBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h1 className="page-title" style={{ margin: 0, fontSize: '2rem' }}>Logs</h1>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <button 
                onClick={() => setViewMode('list')}
                style={{ padding: '0.5rem 1rem', background: viewMode === 'list' ? 'var(--color-bg-main)' : 'transparent', border: 'none', color: viewMode === 'list' ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.15s' }}
              >
                List
              </button>
              <button 
                onClick={openCalendar}
                style={{ padding: '0.5rem 1rem', background: viewMode === 'calendar' ? 'var(--color-bg-main)' : 'transparent', border: 'none', color: viewMode === 'calendar' ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.15s' }}
              >
                Calendar
              </button>
            </div>
            
            <button className="btn btn-secondary" onClick={() => setShowDayReview(true)} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Review Day
            </button>
            <button className="btn btn-secondary" onClick={() => window.print()} disabled={historyLog.length === 0} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Print PDF
            </button>
            <button className="btn btn-secondary" onClick={exportCSV} disabled={historyLog.length === 0} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Export CSV
            </button>
          </div>
        </div>

        {/* Mobile-First Dashboard Layout */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginTop: '2rem' }}>
          
          {/* FILTERS SECTION */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            {/* Customer search */}
            <div style={{ position: 'relative' }}>
              <Search size={20} color="var(--color-text-muted)" style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                type="text"
                inputMode="search"
                className="input-field"
                placeholder="Search a customer or address"
                aria-label="Search a customer or address"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', minHeight: '48px', fontSize: '1rem', padding: '0.6rem 2.8rem' }}
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label="Clear search" style={{ position: 'absolute', right: '0.4rem', top: '50%', transform: 'translateY(-50%)', width: '40px', height: '40px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={20} />
                </button>
              )}
            </div>

            {/* Horizontal Scrollable Time Filters */}
            <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <button style={{ ...pillStyle(timeFilter === 'today'), whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setTimeFilter('today')}>Today</button>
              <button style={{ ...pillStyle(timeFilter === 'yesterday'), whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setTimeFilter('yesterday')}>Yesterday</button>
              <button style={{ ...pillStyle(timeFilter === 'week'), whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setTimeFilter('week')}>This Week</button>
              <button style={{ ...pillStyle(timeFilter === 'month'), whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setTimeFilter('month')}>This Month</button>
              <button style={{ ...pillStyle(timeFilter === 'all'), whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setTimeFilter('all')}>All Time</button>
              <button style={{ ...pillStyle(timeFilter === 'custom'), whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setTimeFilter('custom')}>Custom</button>
              <button style={{ ...pillStyle(showAdvancedFilters), whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 'auto', background: showAdvancedFilters ? 'var(--color-bg-main)' : 'transparent', border: '1px dashed var(--color-border)' }} onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}>
                {showAdvancedFilters ? 'Hide Filters' : 'More Filters'}
              </button>
            </div>

            {timeFilter === 'custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', background: 'var(--color-bg-card)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                <div>
                  <label className="input-label" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.75rem' }}>Start Date</label>
                  <input type="date" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="input-label" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.75rem' }}>End Date</label>
                  <input type="date" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} />
                </div>
              </div>
            )}

            {/* Collapsible Advanced Filters */}
            {showAdvancedFilters && (
              <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', background: 'var(--color-bg-card)', padding: '1.2rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <div>
                  <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Customer</label>
                  <select className="input-field" style={{ width: '100%', padding: '0.5rem' }} value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}>
                    <option value="all">All Customers</option>
                    {allCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Service</label>
                  <select className="input-field" style={{ width: '100%', padding: '0.5rem' }} value={serviceFilter} onChange={e => setServiceFilter(e.target.value)}>
                    <option value="all">All Services</option>
                    {uniqueServiceNames.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Status</label>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button style={pillStyle(statusFilter === 'all')} onClick={() => setStatusFilter('all')}>All</button>
                    <button style={pillStyle(statusFilter === 'completed')} onClick={() => setStatusFilter('completed')}>Completed</button>
                    <button style={pillStyle(statusFilter === 'skipped')} onClick={() => setStatusFilter('skipped')}>Skipped</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* MAIN CONTENT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            
            {/* Summary Bar */}
            {historyLog.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {/* Four compact tiles, then the revenue split on its own line */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.8rem' }}>
                <div style={summaryTile}>
                  <div style={summaryLabel}>Visits</div>
                  <div style={summaryValue}>{totals.visits}</div>
                </div>
                <div style={{ ...summaryTile, border: '1px solid var(--color-primary)', borderBottom: '4px solid var(--color-primary)' }}>
                  <div style={summaryLabel}>Revenue</div>
                  <div style={{ ...summaryValue, color: 'var(--color-primary)' }}>${totals.revenue.toFixed(2)}</div>
                </div>
                <div style={summaryTile}>
                  <div style={summaryLabel}>Time in Field</div>
                  <div style={summaryValue}>{fmtHM(totals.totalSecs)}</div>
                </div>
                <div style={summaryTile}>
                  <div style={summaryLabel}>Average $/hr</div>
                  <div style={summaryValue}>{totals.rate != null ? `$${totals.rate.toFixed(0)}` : '—'}</div>
                </div>
              </div>
                <div>
                  {Object.entries(totals.serviceBreakdown || {}).filter(([, amt]) => amt >= 0.01).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {Object.entries(totals.serviceBreakdown)
                        .filter(([, amt]) => amt >= 0.01) // hide $0 rows (e.g. inactive/legacy service ids)
                        .sort((a, b) => b[1] - a[1])
                        .map(([sId, amt]) => {
                          // Resolve the display name: default templates, then any customer's
                          // custom service with that id, else a friendly "Other" (never a raw id).
                          const sName = settings?.defaultServices?.find(s => s.id === sId)?.name
                            || (allCustomers || []).flatMap(c => c.services || []).find(s => s.id === sId)?.name
                            || (sId === LEAF_REVENUE_KEY ? 'Leaf charges' : 'Other');
                          return (
                            <div key={sId} style={{ fontSize: '0.95rem', display: 'flex', gap: '0.5rem', padding: '0.4rem 0.8rem', borderRadius: '999px', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)' }}>
                              <span style={{ opacity: 0.8 }}>{sName}</span>
                              <span style={{ fontWeight: 700 }}>${amt.toFixed(2)}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Empty State */}
            {historyLog.length === 0 && viewMode === 'list' && (
              <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '4rem 2rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-text-main)' }}>{emptyState.title}</p>
                <p style={{ fontSize: '1rem', marginTop: '0.5rem' }}>{emptyState.hint}</p>
                <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.2rem' }}>
                  {emptyState.actions.map(a => (
                    <button key={a.label} className={a.primary ? 'btn btn-primary' : 'btn btn-secondary'} style={{ padding: '0.7rem 1.4rem', minHeight: '48px', fontSize: '1rem', fontWeight: 700 }} onClick={a.run}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Calendar View */}
            {viewMode === 'calendar' && renderCalendar()}

            {/* Grouped Days (List View) */}
            {viewMode === 'list' && paginatedDays.map(([dateStr, jobs]) => {
              const dayRevenue = jobs.reduce((s, j) => s + (j.priceEarned || 0), 0);
              const dayVisits  = jobs.filter(j => j.status !== 'skipped').length;
              // Hours on the clock for the day (job + drive) and what that earned per hour.
              const daySecs    = jobs.reduce((s, j) => s + (j.durationSecs || 0) + (j.driveTimeSecs || 0), 0);
              const dayRate    = daySecs >= 60 ? dayRevenue / (daySecs / 3600) : null;
              const collapsed  = collapsedDays.includes(dateStr);

              return (
                <div key={dateStr} style={{ marginBottom: collapsed ? '0.5rem' : '2.5rem' }}>
                  {/* Day header: tap to fold the day away */}
                  <div
                    role="button"
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsedDays(prev => prev.includes(dateStr) ? prev.filter(d => d !== dateStr) : [...prev, dateStr])}
                    style={{
                    cursor: 'pointer',
                    flexWrap: 'wrap',
                    gap: '0.3rem 1rem',
                    position: 'sticky',
                    top: 0, 
                    zIndex: 10, 
                    background: 'var(--color-bg-main)', 
                    paddingTop: '1rem',
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'baseline', 
                    marginBottom: '1rem', 
                    paddingBottom: '0.5rem', 
                    borderBottom: '2px solid var(--color-border)' 
                  }}>
                    <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--color-text-main)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {collapsed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
                      {dayLabel(dateStr)}
                    </span>
                    <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 600, textAlign: 'right' }}>
                      {dayVisits} job{dayVisits !== 1 ? 's' : ''}
                      {daySecs > 0 && <><span style={{ margin: '0 0.5rem' }}>•</span>{fmtHM(daySecs)}</>}
                      <span style={{ margin: '0 0.5rem' }}>•</span><span style={{ color: 'var(--color-primary)' }}>${dayRevenue.toFixed(2)}</span>
                      {dayRate != null && <><span style={{ margin: '0 0.5rem' }}>•</span><span style={{ color: 'var(--color-text-main)', fontWeight: 800 }}>${dayRate.toFixed(0)}/hr</span></>}
                    </span>
                  </div>

                  {/* Job Tickets List */}
                  <div style={{ display: collapsed ? 'none' : 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    {jobs.map(job => {
                      const colors       = STATUS_COLORS[job.status] || STATUS_COLORS.completed;
                      const serviceNames = getServiceNames(job);
                      
                      let priceColor = job.status === 'skipped' ? 'var(--color-text-muted)' : 'var(--color-text-main)';
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
                        <div key={job.id} style={{ 
                          display: 'flex', 
                          flexDirection: 'column',
                          background: 'var(--color-bg-card)', 
                          border: '1px solid var(--color-border)', 
                          borderLeft: `4px solid ${colors.border}`, 
                          padding: '1.2rem', 
                          borderRadius: 'var(--radius-sm)',
                          boxShadow: 'var(--shadow-sm)'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                            
                            {/* Left: Info */}
                            <div style={{ flex: '1 1 300px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.4rem' }}>
                                <span style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--color-text-main)' }}>{job.custName}</span>
                                {/* A skipped stop has no job time to show. */}
                                {job.status !== 'skipped' && (
                                  <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                                    {job.entryTime ? `${fmtTime(job.entryTime)} → ${fmtTime(job.exitTime)}` : fmtTime(job.exitTime)}
                                  </span>
                                )}
                              </div>
                              
                              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                {/* One-tap service chips: switch what this visit was for
                                    (e.g. Mowing → Fall Clean-up) without opening the editor.
                                    Skipped stops just list their services. */}
                                {job.status === 'skipped' || serviceChoicesFor(job).length === 0
                                  ? serviceNames.map(name => (
                                      <span key={name} style={{ padding: '0.3rem 0.8rem', fontSize: '0.9rem', borderRadius: '999px', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontWeight: 600 }}>
                                        {name}
                                      </span>
                                    ))
                                  : serviceChoicesFor(job).map(svc => {
                                      const on = (job.appliedServices || []).includes(svc.id);
                                      return (
                                        <button
                                          key={svc.id}
                                          aria-pressed={on}
                                          title={on ? `${svc.name} — tap to remove` : `Tap to change this visit to include ${svc.name}`}
                                          onClick={() => handleToggleService(job, svc)}
                                          style={{ padding: '0.5rem 1rem', minHeight: '44px', fontSize: '0.95rem', borderRadius: '999px', cursor: 'pointer', fontWeight: 600, border: on ? '1px solid var(--color-primary)' : '1px dashed var(--color-border)', background: on ? 'rgba(16,185,129,0.14)' : 'transparent', color: on ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
                                        >
                                          {on ? '✓ ' : ''}{svc.name}
                                        </button>
                                      );
                                    })}
                                {job.addOns?.map(addon => (
                                  <span key={addon.id} style={{ padding: '0.3rem 0.8rem', fontSize: '0.9rem', borderRadius: '999px', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', fontWeight: 600 }}>
                                    + {addon.name}
                                  </span>
                                ))}
                                {job.weather && (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, marginLeft: '0.4rem' }}>
                                    {job.weather.temp}°F
                                  </span>
                                )}
                              </div>
                              
                              {/* Sleek inline breakdown */}
                              {settings && job.status !== 'skipped' && (
                                <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                  {/* The dollar figures below are time × the target hourly
                                      rate — what the time is worth, not what was charged. */}
                                  <span style={{ flexBasis: '100%', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                                    What the time is worth at your ${settings.targetHourlyRate}/hr target:
                                  </span>

                                  {/* Drive Box */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.6rem', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 800, letterSpacing: '0.5px' }}>Drive</span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', fontWeight: 600 }}>{fmt(job.driveTimeSecs || 0)}</span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>•</span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', fontWeight: 800 }}>${(((job.driveTimeSecs || 0) / 3600) * settings.targetHourlyRate).toFixed(2)}</span>
                                  </div>

                                  {/* Job Box */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.6rem', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 800, letterSpacing: '0.5px' }}>Job</span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', fontWeight: 600 }}>{fmt(job.durationSecs || 0)}</span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>•</span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', fontWeight: 800 }}>${(((job.durationSecs || 0) / 3600) * settings.targetHourlyRate).toFixed(2)}</span>
                                  </div>

                                  {/* Total Box */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.6rem', background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 'var(--radius-sm)' }}>
                                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-primary)', fontWeight: 800, letterSpacing: '0.5px' }}>Total</span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', fontWeight: 600 }}>{fmt((job.driveTimeSecs || 0) + (job.durationSecs || 0))}</span>
                                    <span style={{ fontSize: '0.9rem', color: 'rgba(16,185,129,0.3)' }}>•</span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--color-primary)', fontWeight: 800 }}>${((((job.driveTimeSecs || 0) + (job.durationSecs || 0)) / 3600) * settings.targetHourlyRate).toFixed(2)}</span>
                                  </div>

                                </div>
                              )}

                              {/* Conditions */}
                              {job.conditions && job.conditions.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                                  {job.conditions.map(cond => (
                                    <span key={cond} style={{ padding: '0.2rem 0.5rem', background: 'var(--color-bg-alt)', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-main)', border: '1px solid var(--color-border)', textTransform: 'capitalize' }}>
                                      {cond === 'leaves' ? '🍂 leaves' : cond}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Leaf billing status: what is still open, without going to Stats */}
                              {(() => {
                                const status = leafStatusFor(job);
                                if (!status) return null;
                                return (
                                  <div style={{ display: 'inline-block', marginTop: '0.6rem', padding: '0.35rem 0.7rem', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', fontWeight: 700, color: status.open ? '#b45309' : 'var(--color-primary)', background: status.open ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.1)', border: `1px solid ${status.open ? 'rgba(245,158,11,0.45)' : 'rgba(16,185,129,0.3)'}` }}>
                                    {status.text}
                                  </div>
                                );
                              })()}
                              
                              {/* Note */}
                              {job.note && (
                                <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(245,158,11,0.05)', borderLeft: '2px solid #f59e0b', borderRadius: 'var(--radius-sm)', fontSize: '0.95rem', color: 'var(--color-text-main)', marginTop: '0.8rem' }}>
                                  {job.note}
                                </div>
                              )}
                            </div>

                            {/* Right: Revenue, Status, Actions */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: '120px' }}>
                                  <div style={{ fontWeight: 800, color: priceColor, fontSize: '1.4rem', lineHeight: 1, marginBottom: '0.4rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                    {job.status !== 'skipped' && `$${job.priceEarned.toFixed(2)}`}
                                    {job.appliedServices?.length > 1 && (() => {
                                      const breakdown = getVisitRevenueBreakdown(job, job.custObj, settings?.defaultServices);
                                      if (Object.keys(breakdown).length > 1) {
                                        return (
                                          <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontWeight: 600, marginTop: '0.3rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.1rem', letterSpacing: '0.5px' }}>
                                            {Object.entries(breakdown).map(([sid, amt]) => {
                                              const sName = job.custObj?.services?.find(s => s.id === sid)?.name || settings?.defaultServices?.find(s => s.id === sid)?.name || sid;
                                              return <div key={sid}>{sName}: ${amt.toFixed(0)}</div>;
                                            })}
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                              
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                                {(job.division === 'fertilizer' || serviceNames.some(n => n?.toLowerCase().match(/(fertilizer|weed|spray|chem)/))) && (
                                  <button 
                                    onClick={() => setActiveEpaJob(job)}
                                    style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', background: 'transparent', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', borderRadius: '999px', cursor: 'pointer', fontWeight: 700, textTransform: 'uppercase' }}
                                  >
                                    {job.complianceLog ? 'EPA' : '+ EPA'}
                                  </button>
                                )}
                                <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.7rem', borderRadius: '999px', backgroundColor: colors.bg, color: colors.border, textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.5px' }}>
                                  {job.status}
                                </span>
                              </div>

                              <div style={{ display: 'flex', gap: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {job.status !== 'skipped' && (
                                  <button 
                                    onClick={() => handleEditClick(job)}
                                    style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-main)', cursor: 'pointer', padding: '0.5rem 1rem', minHeight: '40px', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', transition: 'all 0.15s' }}
                                    onMouseOver={e => { e.target.style.background = 'var(--color-bg-main)'; e.target.style.borderColor = 'var(--color-text-muted)'; }}
                                    onMouseOut={e => { e.target.style.background = 'transparent'; e.target.style.borderColor = 'var(--color-border)'; }}
                                  >
                                    Edit
                                  </button>
                                )}
                                <button 
                                  onClick={() => handleDelete(job)}
                                  style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-main)', cursor: 'pointer', padding: '0.5rem 1rem', minHeight: '40px', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', transition: 'all 0.15s' }}
                                  onMouseOver={e => { e.target.style.background = 'rgba(239,68,68,0.1)'; e.target.style.color = '#ef4444'; e.target.style.borderColor = 'rgba(239,68,68,0.3)'; }}
                                  onMouseOut={e => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--color-text-main)'; e.target.style.borderColor = 'var(--color-border)'; }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>

                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Pagination Button */}
            {viewMode === 'list' && hasMore && (
              <div style={{ textAlign: 'center', marginTop: '1rem', marginBottom: '2rem' }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.6rem 2rem', fontSize: '0.85rem', fontWeight: 600 }}
                  onClick={() => setCurrentPage(p => p + 1)}
                >
                  Show More ({totalVisibleJobs} of {historyLog.length})
                </button>
              </div>
            )}
          </div>
        </div>

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

      {/* ── PDF Print Report (Hidden outside of print) ── */}
      <div className="print-only">
        <div className="print-header">
          <h1>Service Report</h1>
          <p>{timeFilter === 'all' ? 'All Time' : new Date().toLocaleDateString()}</p>
        </div>
        
        {Object.values(
          historyLog.reduce((acc, job) => {
            const key = job.customerId ?? `name:${job.custName}`;
            if (!acc[key]) acc[key] = { custName: job.custName, jobs: [] };
            acc[key].jobs.push(job);
            return acc;
          }, {})
        ).sort((a, b) => a.custName.localeCompare(b.custName)).map(({ custName, jobs }, gi) => (
          <div key={jobs[0].customerId ?? `name-${gi}`} className="print-customer-section" style={{ borderBottom: '1px solid #ccc', paddingBottom: '0.8rem', marginBottom: '1rem', pageBreakInside: 'avoid' }}>
            <strong style={{ fontSize: '1.1rem', display: 'block', marginBottom: '0.3rem' }}>{custName}</strong>
            <div style={{ fontSize: '0.95rem', lineHeight: '1.4' }}>
              {jobs.slice().sort((a, b) => a.exitTime - b.exitTime).map(job => {
                const date = new Date(job.exitTime).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
                const svcs = job.status === 'skipped' 
                  ? 'Skipped' 
                  : [getServiceNames(job).join(', '), job.addOns?.map(a => '+' + a.name).join(', ')].filter(Boolean).join(' ');
                
                return (
                  <span key={job.id} style={{ display: 'inline-block', marginRight: '1rem', whiteSpace: 'nowrap', color: job.status === 'skipped' ? '#999' : 'inherit' }}>
                    <strong>{date}:</strong> {svcs}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
