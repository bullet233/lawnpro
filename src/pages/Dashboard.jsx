import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Link, useNavigate } from 'react-router-dom';
import DayReviewModal from '../components/DayReviewModal';
import { getBusinessDayStart, getDaysSince } from '../utils/dateUtils';
import { getVisitRevenueBreakdown, calculateServiceTotals } from '../utils/revenueUtils';
import { getSettings, saveSettings } from '../db/settings';
import { mowSeasonState, toMD } from '../utils/mowSeason';
import { serviceDue } from '../utils/dueStatus';
import { findPossibleLeafVisits, leafToolsVisible, isLeafVisit, isCleanupVisit } from '../utils/leaves';
import { setLeafTag } from '../utils/leafBilling';
import { useServiceMode } from '../components/ServiceProvider';
import { classifyTreatment } from '../db/treatments';
import { defaultServicesForMode, isScheduleAnchor, findSuspectVisits } from '../utils/scheduler';
import VisitEditModal from '../components/VisitEditModal';
import AppDialog from '../components/AppDialog';
import { Plus, Sunrise, Sun, Moon, Settings as SettingsIcon, Map as MapIcon, ClipboardList, Thermometer, CloudSun, CloudRain, Cloud, AlertTriangle, TrendingUp, CheckCircle, Droplets, ChevronRight } from 'lucide-react';

const formatDur = (secs) => {
  if (!secs) return '0m';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
};

// Mini sparkline bar chart (pure SVG)
function WeeklyChart({ data }) {
  if (!data || data.length === 0) return null;
  const maxVal = Math.max(...data.map(d => d.revenue), 1);
  const barW = 28;
  const gap = 6;
  const chartH = 60;
  const totalW = data.length * (barW + gap) - gap;

  return (
    <svg viewBox={`0 0 ${totalW} ${chartH + 18}`} style={{ width: '100%', height: 'auto', maxHeight: '90px' }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.revenue / maxVal) * chartH);
        const x = i * (barW + gap);
        const y = chartH - h;
        return (
          <g key={i}>
            <rect
              x={x} y={y} width={barW} height={h}
              rx="3"
              fill={d.isToday ? 'var(--color-primary)' : (d.isFuture ? 'rgba(156,163,175,0.1)' : 'rgba(16,185,129,0.25)')}
            />
            <text
              x={x + barW / 2} y={chartH + 13}
              textAnchor="middle"
              fill={d.isToday ? 'var(--color-text-main)' : 'var(--color-text-muted)'}
              fontSize="10"
              fontWeight={d.isToday ? '700' : '500'}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { activeMode } = useServiceMode();
  const [showDayReview, setShowDayReview] = useState(false);
  const [fixingSuspect, setFixingSuspect] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [weather, setWeather] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const GreetingIcon = hour < 12 ? Sunrise : hour < 18 ? Sun : Moon;

  // Data fetching
  const activeRoute = useLiveQuery(async () => {
    const routes = await db.routes.where('status').anyOf('pending', 'active').toArray();
    const modeRoutes = routes.filter(r => r.division === activeMode);
    if (modeRoutes.length === 0) return null;
    const route = modeRoutes[0];
    
    if (route && route.stops) {
      const custIds = route.stops.map(s => typeof s === 'object' ? s.customerId : s);
      const customers = await db.customers.where('id').anyOf(custIds).toArray();
      route.expandedStops = custIds.map(id => customers.find(c => c.id === id)).filter(Boolean);
    }
    return route || null;
  }, [activeMode]);

  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];

  const todayVisits = useLiveQuery(() => {
    const startOfDay = getBusinessDayStart();
    return db.visits.where('exitTime').aboveOrEqual(startOfDay.getTime()).filter(v => v.status !== 'skipped' && (!v.division || v.division === activeMode)).toArray();
  }, [activeMode]) || [];

  const allVisits = useLiveQuery(() => db.visits.toArray(), []) || [];
  const allTreatments = useLiveQuery(() => db.treatments.toArray(), []) || [];

  // Memoized filtered allVisits to respect activeMode for weekly revenue
  const filteredAllVisits = useMemo(() => {
    return allVisits.filter(v => (!v.division || v.division === activeMode));
  }, [allVisits, activeMode]);

  // Route visits for determining next stop
  const routeVisits = useLiveQuery(async () => {
    if (!activeRoute) return [];
    
    // Find all visits since this route was created, or since today's business day started, whichever is earlier.
    // This ensures if a route spans multiple days, we still count yesterday's completed stops!
    const routeDate = new Date(activeRoute.date).getTime();
    const startOfDay = getBusinessDayStart().getTime();
    const searchTime = Math.min(routeDate, startOfDay);
    
    return db.visits.where('exitTime').aboveOrEqual(searchTime).toArray();
  }, [activeRoute]) || [];

  // Recent visits with notes (from the last 48 hours)
  const recentNotes = useLiveQuery(async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(0, 0, 0, 0);
    const visitsWithNotes = await db.visits.where('exitTime').aboveOrEqual(twoDaysAgo.getTime()).toArray();
    return visitsWithNotes.filter(v => v.note && v.note.trim().length > 0).sort((a, b) => b.exitTime - a.exitTime);
  }, []) || [];

  const pendingLogs = useLiveQuery(async () => {
    const logs = await db.fuelLogs.toArray();
    return logs.filter(l => l.pendingSync === 1);
  }, []) || [];

  useEffect(() => {
    const handleSync = async () => {
      if (!navigator.onLine || isSyncing || pendingLogs.length === 0) return;
      setIsSyncing(true);

      for (const log of pendingLogs) {
        // Fetch visits for this day
        // date format is 'YYYY-MM-DD'
        const parts = log.date.split('-');
        if (parts.length !== 3) continue;
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);

        const start = new Date(year, month, day, 0, 0, 0).getTime();
        const end = new Date(year, month, day, 23, 59, 59, 999).getTime();
        
        const visits = await db.visits
          .where('exitTime').between(start, end)
          .filter(v => v.status !== 'skipped')
          .toArray();

        const sortedVisits = visits.sort((a, b) => a.exitTime - b.exitTime);
        const customers = await db.customers.toArray();
        
        const waypoints = [];
        for (const v of sortedVisits) {
          const cust = customers.find(c => c.id === v.customerId);
          if (cust && cust.geofence && cust.geofence.length > 0) {
            const lat = cust.geofence.reduce((s, p) => s + p.lat, 0) / cust.geofence.length;
            const lng = cust.geofence.reduce((s, p) => s + p.lng, 0) / cust.geofence.length;
            waypoints.push({ lat, lng });
          }
        }

        if (waypoints.length >= 2 && waypoints.length <= 25 && window.google && window.google.maps) {
          const directionsService = new window.google.maps.DirectionsService();
          const origin = waypoints[0];
          const destination = waypoints[waypoints.length - 1];
          const intermediate = waypoints.slice(1, waypoints.length - 1).map(loc => ({ location: loc, stopover: true }));

          try {
            const response = await new Promise((resolve, reject) => {
              directionsService.route({
                origin, destination, waypoints: intermediate,
                optimizeWaypoints: false, travelMode: window.google.maps.TravelMode.DRIVING
              }, (res, status) => {
                if (status === 'OK') resolve(res); else reject(status);
              });
            });
            const totalMeters = response.routes[0].legs.reduce((acc, leg) => acc + leg.distance.value, 0);
            const totalMiles = parseFloat((totalMeters * 0.000621371).toFixed(1));
            
            await db.fuelLogs.update(log.date, { milesDriven: totalMiles, pendingSync: 0 });
          } catch (e) {
            console.error('Offline Sync Failed:', e);
          }
        } else {
          // Can't calculate, just remove pending
          await db.fuelLogs.update(log.date, { pendingSync: 0 });
        }
      }
      setIsSyncing(false);
    };

    window.addEventListener('online', handleSync);
    if (navigator.onLine) {
      handleSync();
    }

    return () => window.removeEventListener('online', handleSync);
  }, [pendingLogs.length, isSyncing]);

  // Fetch weather on mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1`);
          const data = await res.json();
          if (data.current) {
            setWeather({
              temp: Math.round(data.current.temperature_2m),
              wind: Math.round(data.current.wind_speed_10m),
              code: data.current.weather_code,
              high: data.daily?.temperature_2m_max?.[0] ? Math.round(data.daily.temperature_2m_max[0]) : null,
              low: data.daily?.temperature_2m_min?.[0] ? Math.round(data.daily.temperature_2m_min[0]) : null
            });
          }
        } catch (e) { /* silent */ }
      }, () => {}, { enableHighAccuracy: false, timeout: 5000 });
    }
  }, []);

  // Derived stats
  const stats = useMemo(() => {
    const revenue = todayVisits.reduce((sum, v) => sum + (v.priceEarned || 0), 0);
    const duration = todayVisits.reduce((sum, v) => sum + (v.durationSecs || 0), 0);
    const driveTime = todayVisits.reduce((sum, v) => sum + (v.driveTimeSecs || 0), 0);
    
    let firstEntry = null;
    let lastExit = null;

    if (todayVisits.length > 0) {
      firstEntry = Math.min(...todayVisits.map(v => v.entryTime || v.exitTime || Date.now()));
      lastExit = Math.max(...todayVisits.map(v => v.exitTime || v.entryTime || Date.now()));
    }

    const totalShiftSecs = (firstEntry && lastExit) ? Math.floor((lastExit - firstEntry) / 1000) : 0;

    const currentSettings = getSettings();
    const serviceBreakdown = calculateServiceTotals(todayVisits, allCustomers || [], currentSettings?.defaultServices || []);
    return { 
      visits: todayVisits.length, 
      revenue, 
      duration, 
      driveTime,
      totalShiftSecs,
      firstEntry,
      lastExit,
      serviceBreakdown, 
      settings: currentSettings 
    };
  }, [todayVisits, allCustomers]);

  // Current calendar week, MONDAY-anchored — matches History's "This Week" filter
  // so the Home total agrees with it instead of a rolling 7-day window that drags
  // in last week's work. The week always runs Mon→Sun; days later in the week that
  // haven't happened yet render as faded "future" bars.
  const weeklyData = useMemo(() => {
    const days = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const today = getBusinessDayStart();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // step back to Monday

    for (let i = 0; i < 7; i++) {
      const startOfDay = new Date(weekStart);
      startOfDay.setDate(weekStart.getDate() + i);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);
      endOfDay.setMilliseconds(-1);

      const dayRevenue = filteredAllVisits
        .filter(v => v.exitTime >= startOfDay.getTime() && v.exitTime <= endOfDay.getTime() && v.status !== 'skipped')
        .reduce((s, v) => s + (Number(v.priceEarned) || 0), 0);

      days.push({
        label: dayNames[startOfDay.getDay()],
        revenue: dayRevenue,
        isFuture: startOfDay.getTime() > today.getTime(),
        isToday: startOfDay.getTime() === today.getTime()
      });
    }
    return days;
  }, [filteredAllVisits]);

  const weekTotal = weeklyData.reduce((s, d) => s + d.revenue, 0);

  // Next customer on active route
  const nextCustomer = useMemo(() => {
    if (!activeRoute || !activeRoute.expandedStops) return null;
    const completedIds = new Set(routeVisits.filter(v => 
      v.status === 'completed' || v.status === 'skipped'
    ).map(v => v.customerId));
    return activeRoute.expandedStops.find(c => !completedIds.has(c.id)) || null;
  }, [activeRoute, routeVisits]);

  // Due / Overdue customers (>= their specific service interval)
  // Bumped when the season is started or ended from Home, so the lists redo.
  const [seasonTick, setSeasonTick] = useState(0);
  const { mowingDue, season } = useMemo(() => {
    const st = getSettings();
    const season = mowSeasonState(Date.now(), { start: st.mowSeasonStart, end: st.mowSeasonEnd });
    if (allCustomers.length === 0) return { mowingDue: [], fertilizerDue: [], season };
    const mDue = [];
    const fDue = [];
    
    const settings = getSettings();
    const defaultServices = settings.defaultServices || [];
    const mowingServiceIds = defaultServices.filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);
    const fertServiceIds = defaultServices.filter(s => s.category === 'Fertilizer' || s.id === 's3').map(s => s.id);
    
    allCustomers.forEach(cust => {
      if (cust.status === 'inactive') return;
      
      const isMowingCust = !cust.services || cust.services.length === 0 || cust.services.some(s => s.active && mowingServiceIds.includes(s.id));
      const isFertCust = cust.services && cust.services.some(s => s.active && fertServiceIds.includes(s.id));
      
      // Anchors = completed visits + deliberate "skip this cycle" skips, so an
      // on-purpose skip doesn't resurface the client as overdue next week.
      const custVisits = allVisits.filter(v => v.customerId === cust.id && isScheduleAnchor(v));
      
      // Mowing — snoozed lawns stay off (same as the Weekly Scheduler), and
      // nothing is due outside the mowing season.
      if (isMowingCust) {
        // The shared due check (utils/dueStatus) — same answer as every other screen.
        const d = serviceDue(cust, custVisits, { division: 'mowing', season, mowIds: mowingServiceIds });
        const dueStatus = d.status === 'new' ? 'firstCut' : ['overdue', 'dueToday', 'firstCut'].includes(d.status) ? d.status : null;
        if (dueStatus) mDue.push({ ...cust, daysSince: d.daysSince, isNew: d.lastTs == null, dueStatus, intervalDays: d.intervalDays });
      }

      // Fertilizer
      if (isFertCust) {
        const fInterval = cust.fertilizerInterval || 30;
        const fertVisits = custVisits.filter(v => 
          v.division === 'fertilizer' || 
          (!v.division && v.appliedServices && v.appliedServices.some(id => fertServiceIds.includes(id)))
        );
        
        if (fertVisits.length === 0) {
          fDue.push({ ...cust, daysSince: 999, isNew: true, intervalDays: fInterval });
        } else {
          const lastFert = Math.max(...fertVisits.map(v => v.exitTime));
          const daysSince = getDaysSince(lastFert);
          if (daysSince >= fInterval) {
            fDue.push({ ...cust, daysSince, isNew: false, intervalDays: fInterval });
          }
        }
      }
    });

    mDue.sort((a, b) => (b.daysSince - b.intervalDays) - (a.daysSince - a.intervalDays));
    fDue.sort((a, b) => (b.daysSince - b.intervalDays) - (a.daysSince - a.intervalDays));

    return { mowingDue: mDue, fertilizerDue: fDue, season };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seasonTick re-reads the season settings
  }, [allCustomers, allVisits, seasonTick]);

  // Program-based treatments needing attention now (drives fertilizer-mode Dashboard)
  const treatmentAttention = useMemo(() => {
    const year = new Date().getFullYear();
    const now = Date.now();
    return allTreatments
      .filter(t => t.year === year && (t.status === 'scheduled' || t.status === 'due'))
      .map(t => ({ ...t, state: classifyTreatment(t, now) }))
      .filter(t => t.state === 'overdue' || t.state === 'due')
      .map(t => ({ ...t, customer: allCustomers.find(c => c.id === t.customerId) }))
      .filter(t => t.customer)
      .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
  }, [allTreatments, allCustomers]);

  // Stops force-skipped off a route ("Forcibly skipped when ending route") and
  // not serviced since. These are invisible everywhere until their interval
  // ages them into the overdue list — they were supposed to be done the day
  // they were dropped, so surface them immediately. Clears itself once the
  // client is serviced (or snoozed/paused), and fades out after 14 days when
  // the regular overdue list has long since taken over.
  const droppedStops = useMemo(() => {
    if (allCustomers.length === 0 || allVisits.length === 0) return [];
    const now = Date.now();
    const cutoff = now - 14 * 24 * 60 * 60 * 1000;
    const rows = [];
    allCustomers.forEach(c => {
      if (c.status === 'inactive') return;
      if (c.snoozedUntil && c.snoozedUntil > now) return;
      const mine = allVisits.filter(v => v.customerId === c.id && (!v.division || v.division === activeMode));
      // Catch-up skips only: the new catchUp flag, plus legacy force-end notes.
      // Deliberate cycle skips (countsForSchedule) are on schedule, not dropped.
      const skips = mine.filter(v => v.status === 'skipped' && !v.countsForSchedule &&
        (v.catchUp || (v.note || '').includes('Forcibly skipped')));
      if (skips.length === 0) return;
      const lastSkip = Math.max(...skips.map(v => v.exitTime));
      if (lastSkip < cutoff) return;
      // Resolved once serviced OR deliberately cycle-skipped afterwards.
      if (mine.some(v => isScheduleAnchor(v) && v.exitTime > lastSkip)) return;
      rows.push({ ...c, droppedDaysAgo: getDaysSince(lastSkip) });
    });
    rows.sort((a, b) => b.droppedDaysAgo - a.droppedDaysAgo);
    return rows;
  }, [allCustomers, allVisits, activeMode]);

  // Possible mis-counted jobs: completed visits (last 3 days) logged way below
  // the lawn's own average, or under the 2-minute floor — e.g. a slow GPS
  // pass-through that crossed the drive-by threshold, or a timer that ended
  // mid-job. Flag-only: the driver fixes the record or confirms it's right.
  const suspectVisits = useMemo(() => {
    if (allVisits.length === 0 || allCustomers.length === 0) return [];
    return findSuspectVisits(allVisits, activeMode)
      .map(f => ({ ...f, customer: allCustomers.find(c => c.id === f.visit.customerId) }))
      .filter(f => f.customer);
  }, [allVisits, allCustomers, activeMode]);

  const handleSuspectOk = (visitId) => db.visits.update(visitId, { reviewedOk: true });

  // Fall mows that ran long and weren't tagged as leaf jobs (see utils/leaves).
  const possibleLeafVisits = useMemo(() => {
    if (allVisits.length === 0 || allCustomers.length === 0 || !leafToolsVisible()) return [];
    return findPossibleLeafVisits(allVisits)
      .map(f => ({ ...f, customer: allCustomers.find(c => c.id === f.visit.customerId) }))
      .filter(f => f.customer);
  }, [allVisits, allCustomers]);

  // Yes tags the visit and adds its hourly leaf charge; No just stops asking.
  const handleLeafAnswer = (visit, wasLeaves) => wasLeaves
    ? setLeafTag(visit.id, true, { leafChecked: true })
    : db.visits.update(visit.id, { leafChecked: true });

  // A drive-past that got logged as a visit isn't fixable by editing its time:
  // it still counts as a completed, priced visit and keeps the lawn from
  // auto-arriving today and tomorrow. It has to go.
  const handleSuspectDelete = (f) => {
    const mins = Math.max(1, Math.round(f.visit.durationSecs / 60));
    setDialog({
      type: 'danger',
      title: 'Not a real visit?',
      message: `Delete the ${mins}-minute visit to ${f.customer.name}? Its $${(f.visit.priceEarned || 0).toFixed(0)} comes off the books and the lawn goes back to needing service. This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        await db.visits.delete(f.visit.id);
      }
    });
  };

  const handleSuspectSave = async (updates) => {
    if (!fixingSuspect) return;
    // reviewedOk too: an edited-and-saved record is reviewed by definition, so
    // it never re-flags even if the corrected time is still unusually short.
    await db.visits.update(fixingSuspect.visit.id, { ...updates, reviewedOk: true });
    setFixingSuspect(null);
  };

  const handleAddToRoute = async (customer) => {
    const defaultIds = defaultServicesForMode(customer, activeMode).map(s => s.id);

    // Check if they are already in the active route
    if (activeRoute) {
      const isAlreadyInRoute = activeRoute.stops.some(s => {
        const id = typeof s === 'object' ? s.customerId : s;
        return id === customer.id;
      });
      if (isAlreadyInRoute) return; // Ignore if already there

      const updatedStops = [...activeRoute.stops, { customerId: customer.id, plannedServiceIds: defaultIds }];
      await db.routes.update(activeRoute.id, { stops: updatedStops });
    } else {
      // Stamp the division — the Live page only shows routes matching the
      // active mode, so an unstamped route was invisible there until the next
      // app restart backfilled it as mowing.
      await db.routes.add({
        name: "Today's Route",
        date: new Date().toISOString(),
        status: 'active',
        isTemplate: 0,
        division: activeMode,
        stops: [{ customerId: customer.id, plannedServiceIds: defaultIds }]
      });
    }
  };

  // ── Needs mowing: overdue, new and dropped-from-route lawns, each once ──
  // Dropped and overdue used to be two lists with mostly the same people.
  const needsList = useMemo(() => {
    const map = new Map();
    if (activeMode === 'mowing' && !season.inSeason) return [];
    droppedStops.forEach(c => map.set(c.id, { cust: c, droppedDaysAgo: c.droppedDaysAgo }));
    if (activeMode === 'mowing') {
      mowingDue.forEach(c => {
        const row = map.get(c.id) || { cust: c };
        row.isNew = c.isNew;
        row.dueStatus = c.dueStatus;
        row.daysSince = c.isNew ? null : c.daysSince;
        row.intervalDays = c.intervalDays;
        map.set(c.id, row);
      });
    }
    // Dropped, then overdue, due today, first cut of the season, new clients.
    const rank = (r) => (r.droppedDaysAgo != null ? 0 : r.dueStatus === 'overdue' ? 1 : r.dueStatus === 'dueToday' ? 2 : r.isNew ? 4 : 3);
    return [...map.values()].sort((a, b) =>
      rank(a) - rank(b) ||
      (b.droppedDaysAgo ?? 0) - (a.droppedDaysAgo ?? 0) ||
      ((b.daysSince ?? 0) - (b.intervalDays ?? 0)) - ((a.daysSince ?? 0) - (a.intervalDays ?? 0)));
  }, [droppedStops, mowingDue, activeMode, season]);

  const dueCounts = {
    overdue: needsList.filter(r => r.droppedDaysAgo != null || r.dueStatus === 'overdue').length,
    today: needsList.filter(r => r.droppedDaysAgo == null && r.dueStatus === 'dueToday').length,
    first: needsList.filter(r => r.droppedDaysAgo == null && r.dueStatus === 'firstCut').length,
  };
  const seasonDay = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

  // Morning summary: the first time Home opens each day, one card says how the
  // day stands. Shown once per day (marked seen as soon as it shows), and only
  // once the lawns and visits have loaded so it never shows empty numbers.
  const [morning, setMorning] = useState(null);
  const dataReady = allCustomers.length > 0 && allVisits.length > 0;
  useEffect(() => {
    if (!dataReady || morning || activeMode !== 'mowing' || !season.inSeason) return;
    const day = new Date().toDateString();
    let seen = null;
    try { seen = localStorage.getItem('lawnpro_morning_summary_day'); } catch { /* private mode */ }
    if (seen === day) return;
    try { localStorage.setItem('lawnpro_morning_summary_day', day); } catch { /* private mode */ }
    setMorning({
      overdue: needsList.filter(r => r.droppedDaysAgo == null && r.dueStatus === 'overdue').length,
      today: needsList.filter(r => r.droppedDaysAgo == null && r.dueStatus === 'dueToday').length,
      first: needsList.filter(r => r.droppedDaysAgo == null && r.dueStatus === 'firstCut').length,
      droppedYesterday: needsList.filter(r => r.droppedDaysAgo === 1).length,
      droppedEarlier: needsList.filter(r => r.droppedDaysAgo != null && r.droppedDaysAgo > 1).length,
      ids: needsList.map(r => r.cust.id),
    });
  }, [dataReady, morning, activeMode, season.inSeason, needsList]);
  // End the season today / start it today (Settings holds the dates).
  const endSeasonNow = () => setDialog({
    type: 'warning', title: 'End the mowing season?',
    message: 'Nothing will show as due or overdue until the season starts again. You can change the dates any time in Settings.',
    confirmLabel: 'End season',
    // The old end date is kept so an early end can be undone without
    // restarting the season (which would reset every lawn to a first cut).
    onConfirm: () => { saveSettings({ mowSeasonEndBefore: getSettings().mowSeasonEnd, mowSeasonEndedAt: Date.now(), mowSeasonEnd: toMD(Date.now() - 86400000) }); setSeasonTick(t => t + 1); },
  });
  const startSeasonNow = () => { saveSettings({ mowSeasonStart: toMD(Date.now()), mowSeasonEndBefore: null, mowSeasonEndedAt: null }); setSeasonTick(t => t + 1); };
  const endedRecently = (() => { const st = getSettings(); return !!st.mowSeasonEndBefore && st.mowSeasonEndedAt > Date.now() - 30 * 86400000; })();
  const undoEndSeason = () => { const st = getSettings(); saveSettings({ mowSeasonEnd: st.mowSeasonEndBefore, mowSeasonEndBefore: null, mowSeasonEndedAt: null }); setSeasonTick(t => t + 1); };

  const [picked, setPicked] = useState([]);           // lawns ticked for a route
  const [showAllNeeds, setShowAllNeeds] = useState(false);
  const [showAllSuspects, setShowAllSuspects] = useState(false);
  const [showAllLeafAsk, setShowAllLeafAsk] = useState(false);
  const [showAllTreat, setShowAllTreat] = useState(false);
  const togglePick = (id) => setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const isOnRoute = (id) => !!activeRoute && activeRoute.stops.some(s => (typeof s === 'object' ? s.customerId : s) === id);
  // Hand the lawns to Route Builder, which loads them in drive order.
  const planRoute = (ids) => navigate('/routes', { state: { preloadIds: ids } });

  // Leaf / clean-up charges still to decide (this month), for the problems area.
  const leafUndecided = useMemo(() => {
    if (activeMode !== 'mowing') return 0;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return filteredAllVisits.filter(v => v.status === 'completed' && v.exitTime >= monthStart &&
      (isLeafVisit(v) || isCleanupVisit(v)) && !v.leafDecided).length;
  }, [filteredAllVisits, activeMode]);

  // This week's $/hr on job + drive time, next to the week's total.
  const weekRate = useMemo(() => {
    const today = getBusinessDayStart();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const wk = filteredAllVisits.filter(v => v.status === 'completed' && v.exitTime >= weekStart.getTime());
    const secs = wk.reduce((s, v) => s + (v.durationSecs || 0) + (v.driveTimeSecs || 0), 0);
    return secs >= 60 ? weekTotal / (secs / 3600) : null;
  }, [filteredAllVisits, weekTotal]);

  // Notes the driver typed — not the ones the app writes itself on skips and
  // time splits ("Skipped", "Skipped when ending route — Rain", "Simultaneous
  // visit with …").
  const typedNotes = recentNotes.filter(v => {
    const n = (v.note || '').trim();
    if (/^Simultaneous visit with /i.test(n) || /Forcibly skipped/i.test(n)) return false;
    if (v.status === 'skipped' && /^Skipped( when ending route)?( — .*)?$/i.test(n)) return false;
    return true;
  });

  const todayRate = stats.duration + stats.driveTime >= 60 ? stats.revenue / ((stats.duration + stats.driveTime) / 3600) : null;
  const routeProgress = activeRoute?.expandedStops ? {
    done: activeRoute.expandedStops.filter(c => routeVisits.some(v => v.customerId === c.id && (v.status === 'completed' || v.status === 'skipped'))).length,
    total: activeRoute.expandedStops.length,
  } : null;

  // Weather icon helper
  const getWeatherIcon = (code) => {
    if (code === undefined || code === null) return <Thermometer size={16} />;
    if (code <= 1) return <Sun size={16} color="#f59e0b" />;
    if (code <= 3) return <CloudSun size={16} color="#94a3b8" />;
    if (code >= 51) return <CloudRain size={16} color="#3b82f6" />;
    return <Cloud size={16} color="#94a3b8" />;
  };

  const getWeatherLabel = (code) => {
    if (code === undefined || code === null) return '';
    if (code === 0) return 'Clear';
    if (code <= 3) return 'Cloudy';
    if (code >= 61 && code <= 67) return 'Rain';
    if (code >= 51 && code <= 57) return 'Drizzle';
    if (code >= 80) return 'Showers';
    return 'Overcast';
  };

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '2rem' }}>
      {showDayReview && <DayReviewModal onClose={() => setShowDayReview(false)} />}
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />

      {fixingSuspect && (
        <VisitEditModal
          job={fixingSuspect.visit}
          customer={fixingSuspect.customer}
          defaultServices={getSettings().defaultServices}
          onClose={() => setFixingSuspect(null)}
          onSave={handleSuspectSave}
        />
      )}

      {/* Offline Sync Banner */}
      {pendingLogs.length > 0 && (
        <div style={{
          background: 'var(--color-warning)', color: 'white',
          padding: '0.8rem 1rem', borderRadius: 'var(--radius-sm)',
          marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.8rem',
          boxShadow: '0 4px 12px rgba(245,158,11,0.2)'
        }}>
          <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 700, marginBottom: '2px' }}>Offline Sync Pending</div>
            <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
              Waiting for internet connection to calculate mileage for {pendingLogs.length} route{pendingLogs.length !== 1 ? 's' : ''}.
              This will happen automatically when you reconnect.
            </div>
          </div>
        </div>
      )}


      {/* Header */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <GreetingIcon size={32} color="var(--color-primary)" />
          <div>
            <h1 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--color-text-main)', lineHeight: 1.2 }}>{greeting}</h1>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
              {weather && (
                <>
                  <span style={{ color: 'var(--color-border)' }}>|</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', color: 'var(--color-text-main)' }}>
                    {getWeatherIcon(weather.code)}
                    <span style={{ fontWeight: 600 }}>{weather.temp}°F</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <Link to="/settings" className="btn btn-secondary" style={{ padding: '0.5rem', borderRadius: '50%' }}>
          <SettingsIcon size={18} />
        </Link>
      </div>

      {/* Morning summary — first open of the day */}
      {morning && !morning.dismissed && (() => {
        const tiles = [
          ['Overdue', morning.overdue, '#b91c1c'],
          ['Due today', morning.today, '#b45309'],
          ['Dropped yesterday', morning.droppedYesterday, '#b45309'],
          ...(morning.first ? [['First cut', morning.first, 'var(--color-primary)']] : []),
          ...(morning.droppedEarlier ? [['Dropped earlier', morning.droppedEarlier, 'var(--color-text-muted)']] : []),
        ];
        const total = morning.ids.length;
        return (
          <div className="glass-card" style={{ marginBottom: '1.5rem', padding: '1.1rem 1.2rem', border: '2px solid var(--color-primary)', background: 'var(--color-bg-card)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.8rem' }}>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-primary)' }}>Today</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-text-main)' }}>
                  {total > 0 ? `${total} lawn${total === 1 ? '' : 's'} need mowing` : 'Everyone is mowed up'}
                </div>
              </div>
              <button className="btn btn-secondary" onClick={() => setMorning(m => ({ ...m, dismissed: true }))} style={{ padding: '0.6rem 1rem', minHeight: '48px', fontSize: '1rem' }}>Got it</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem' }}>
              {tiles.map(([label, n, color]) => (
                <div key={label} style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.8rem' }}>
                  <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)', fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: n > 0 ? color : 'var(--color-text-muted)' }}>{n}</div>
                </div>
              ))}
            </div>
            {total > 0 && !activeRoute && (
              <button className="btn btn-primary" onClick={() => planRoute(morning.ids)} style={{ marginTop: '0.8rem', padding: '0.7rem 1.2rem', minHeight: '48px', fontSize: '1rem' }}>
                Plan route with all {total}
              </button>
            )}
          </div>
        );
      })()}

      {/* Top card — changes with the moment: route running, finished for the
          day, or nothing planned yet */}
      <div className="glass-card" style={{ marginBottom: '1.5rem', padding: '1.1rem 1.2rem', border: activeRoute ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: activeRoute ? 'rgba(16,185,129,0.05)' : 'var(--color-bg-card)' }}>
        {activeRoute ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-primary)' }}>
                {activeRoute.status === 'pending' ? 'Route ready' : 'Route running'}
              </div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-text-main)' }}>
                {routeProgress ? `${routeProgress.done} of ${routeProgress.total} stops done` : activeRoute.name}
              </div>
              <div style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                {nextCustomer ? `Next: ${nextCustomer.name}` : 'All stops visited'}
                {stats.visits > 0 && ` · today ${stats.visits} job${stats.visits === 1 ? '' : 's'}, $${stats.revenue.toFixed(0)}`}
              </div>
            </div>
            <Link to="/live" className="btn btn-primary" style={{ padding: '0.7rem 1.4rem', minHeight: '48px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}>
              {activeRoute.status === 'pending' ? 'Start' : 'Resume'} <MapIcon size={18} />
            </Link>
          </div>
        ) : stats.visits > 0 ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-text-main)' }}>
                <CheckCircle size={22} color="var(--color-primary)" /> Today
                {stats.firstEntry && (
                  <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                    · {new Date(stats.firstEntry).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–{new Date(stats.lastExit).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <button className="btn btn-secondary" onClick={() => setShowDayReview(true)} style={{ padding: '0.6rem 1.1rem', minHeight: '44px', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                Review day <ClipboardList size={16} />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.6rem' }}>
              {[['Jobs', stats.visits], ['Revenue', `$${stats.revenue.toFixed(0)}`], ['Mowing', formatDur(stats.duration)], ['Driving', formatDur(stats.driveTime)], ['$/hr', todayRate != null ? `$${todayRate.toFixed(0)}` : '—']].map(([label, value]) => (
                <div key={label} style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.8rem' }}>
                  <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)', fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: label === 'Revenue' ? 'var(--color-primary)' : 'var(--color-text-main)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)' }}>No route planned</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-text-main)' }}>
                {activeMode === 'mowing'
                  ? (!season.inSeason ? 'Mowing season is over' : needsList.length > 0 ? `${needsList.length} lawn${needsList.length === 1 ? '' : 's'} need mowing` : 'Everyone is mowed up')
                  : (treatmentAttention.length > 0 ? `${treatmentAttention.length} treatment${treatmentAttention.length === 1 ? '' : 's'} due` : 'No treatments due')}
              </div>
              {activeMode === 'mowing' && (
                <div style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {!season.inSeason
                    ? `Starts again ${seasonDay(season.nextStart)}`
                    : [dueCounts.overdue && `${dueCounts.overdue} overdue`, dueCounts.today && `${dueCounts.today} due today`, dueCounts.first && `${dueCounts.first} waiting on a first cut`].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {needsList.length > 0 && (
                <button className="btn btn-primary" onClick={() => planRoute(needsList.map(r => r.cust.id))} style={{ padding: '0.7rem 1.2rem', minHeight: '48px', fontSize: '1rem' }}>
                  Plan route with all {needsList.length}
                </button>
              )}
              <Link to="/routes" className="btn btn-secondary" style={{ padding: '0.7rem 1.2rem', minHeight: '48px', fontSize: '1rem', display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
                Route Builder
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* ── Things to fix ─────────────────────────────────────────────── */}

      {/* Possible mis-counted jobs and double-logged copies */}
      {suspectVisits.length > 0 && (() => {
        const dupes = suspectVisits.filter(f => f.duplicateOf).length;
        const shown = showAllSuspects ? suspectVisits : suspectVisits.slice(0, 5);
        return (
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={sectionTitle('#b91c1c')}>
              <AlertTriangle size={18} /> Check these job times
              <span style={countBadge('#ef4444')}>{suspectVisits.length}</span>
            </h3>
            <div className="glass-card" style={{ padding: 0, border: '1px solid rgba(239,68,68,0.35)' }}>
              {shown.map(f => {
                const mins = Math.max(1, Math.round(f.visit.durationSecs / 60));
                const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
                const dayWord = f.visit.exitTime >= startOfToday.getTime() ? 'today'
                  : f.visit.exitTime >= startOfToday.getTime() - 86400000 ? 'yesterday'
                  : f.visit.exitTime >= startOfToday.getTime() - 6 * 86400000
                    ? new Date(f.visit.exitTime).toLocaleDateString([], { weekday: 'short' })
                    : new Date(f.visit.exitTime).toLocaleDateString([], { month: 'short', day: 'numeric' });
                const timeStr = new Date(f.visit.exitTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                const why = f.duplicateOf
                  ? `double-logged copy of the ${Math.round(f.duplicateOf.durationSecs / 60)}-min visit`
                  : f.belowAvg ? `usually ~${Math.round(f.avgSecs / 60)} min (${f.priorCount} visits)` : 'under 2 min';
                return (
                  <div key={f.visit.id} style={rowStyle}>
                    <div style={{ minWidth: 0 }}>
                      <div style={rowName}>{f.customer.name}</div>
                      <div style={{ ...rowSub, color: '#b91c1c' }}>Logged {mins} min — {why} · {dayWord} {timeStr} · ${(f.visit.priceEarned || 0).toFixed(0)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {f.duplicateOf ? (
                        <>
                          <button className="btn btn-primary" style={{ ...bigBtn, background: '#b91c1c', borderColor: '#b91c1c' }} onClick={() => handleSuspectDelete(f)} aria-label={`Delete the copy for ${f.customer.name}`}>Delete copy</button>
                          <button className="btn btn-secondary" style={bigBtn} onClick={() => handleSuspectOk(f.visit.id)}>Keep</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-primary" style={bigBtn} onClick={() => setFixingSuspect(f)}>Fix time</button>
                          <button className="btn btn-secondary" style={bigBtn} onClick={() => handleSuspectOk(f.visit.id)}>✓ OK</button>
                          <button className="btn btn-secondary" style={{ ...bigBtn, color: '#b91c1c' }} onClick={() => handleSuspectDelete(f)} aria-label={`Delete this visit to ${f.customer.name}`}>Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {suspectVisits.length > 5 && <ShowAll open={showAllSuspects} onClick={() => setShowAllSuspects(s => !s)} count={suspectVisits.length} />}
            </div>
            <p style={helpText}>
              {dupes > 0 && 'A double-logged copy is the same job saved twice — delete the copy. '}
              {dupes < suspectVisits.length && 'For a short job: Fix time if the timer mis-counted, ✓ OK if it was right, or Delete if you only drove past.'}
            </p>
          </div>
        );
      })()}

      {/* Forgotten leaf tags — fall mows that ran well over the lawn's usual time */}
      {activeMode === 'mowing' && possibleLeafVisits.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={sectionTitle('#b45309')}>
            🍂 Were these leaf jobs?
            <span style={countBadge('#b45309')}>{possibleLeafVisits.length}</span>
          </h3>
          <div className="glass-card" style={{ padding: 0, border: '1px solid rgba(180,83,9,0.35)' }}>
            {(showAllLeafAsk ? possibleLeafVisits : possibleLeafVisits.slice(0, 5)).map(f => {
              const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
              const dayWord = f.visit.exitTime >= startOfToday.getTime() ? 'today'
                : f.visit.exitTime >= startOfToday.getTime() - 86400000 ? 'yesterday'
                : new Date(f.visit.exitTime).toLocaleDateString([], { weekday: 'short' });
              return (
                <div key={f.visit.id} style={rowStyle}>
                  <div style={{ minWidth: 0 }}>
                    <div style={rowName}>{f.customer.name}</div>
                    <div style={{ ...rowSub, color: '#b45309' }}>Took {Math.round(f.visit.durationSecs / 60)} min {dayWord} — usually {Math.round(f.avgSecs / 60)} min</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                    <button className="btn btn-primary" style={{ ...bigBtn, background: '#b45309', borderColor: '#b45309' }} onClick={() => handleLeafAnswer(f.visit, true)}>🍂 Yes, leaves</button>
                    <button className="btn btn-secondary" style={bigBtn} onClick={() => handleLeafAnswer(f.visit, false)}>No</button>
                  </div>
                </div>
              );
            })}
            {possibleLeafVisits.length > 5 && <ShowAll open={showAllLeafAsk} onClick={() => setShowAllLeafAsk(s => !s)} count={possibleLeafVisits.length} />}
          </div>
          <p style={helpText}>These mows ran much longer than usual. Tap Yes if you picked up leaves — the extra time is then counted as leaf time, not as a slow mow.</p>
        </div>
      )}

      {/* Leaf / clean-up charges still open this month */}
      {leafUndecided > 0 && (
        <button className="glass-card" onClick={() => navigate('/analytics', { state: { tab: 'leaves' } })}
          style={{ width: '100%', marginBottom: '1.5rem', padding: '1rem 1.2rem', borderLeft: '4px solid #b45309', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', cursor: 'pointer', textAlign: 'left', fontSize: '1.05rem', fontWeight: 700, color: '#b45309' }}>
          <span>🍂 {leafUndecided} leaf charge{leafUndecided === 1 ? '' : 's'} still to decide this month</span>
          <span style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>Open <ChevronRight size={18} /></span>
        </button>
      )}

      {/* ── Who needs service ─────────────────────────────────────────── */}
      {(activeMode === 'mowing' || needsList.length > 0) && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
            <h3 style={{ ...sectionTitle('var(--color-text-main)'), margin: 0 }}>
              {activeMode === 'mowing' ? '🌾 Needs mowing' : 'Dropped from route'}
              {needsList.length > 0 && <span style={countBadge('#ef4444')}>{needsList.length}</span>}
            </h3>
            {needsList.length > 0 && (
              <button className="btn btn-primary" style={bigBtn} onClick={() => planRoute(picked.length > 0 ? picked : needsList.map(r => r.cust.id))}>
                {picked.length > 0 ? `Plan route with ${picked.length} picked` : `Plan route with all ${needsList.length}`}
              </button>
            )}
          </div>
          {activeMode === 'mowing' && !season.inSeason ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)', fontSize: '1rem' }}>
              Mowing season is over — nothing shows as due until it starts again on {seasonDay(season.nextStart)}.
              <div style={{ marginTop: '0.8rem' }}>
                {endedRecently ? (
                  <button className="btn btn-secondary" style={bigBtn} onClick={undoEndSeason}>Undo — I&apos;m still mowing</button>
                ) : (
                  <button className="btn btn-secondary" style={bigBtn} onClick={startSeasonNow}>Start the season today</button>
                )}
              </div>
            </div>
          ) : needsList.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)', fontSize: '1rem' }}>
              No one needs mowing right now.
            </div>
          ) : (
            <div className="glass-card" style={{ padding: 0 }}>
              {(showAllNeeds ? needsList : needsList.slice(0, 5)).map(r => {
                const on = picked.includes(r.cust.id);
                const late = r.daysSince != null && r.intervalDays != null && r.daysSince > r.intervalDays + 2;
                const tags = [];
                if (r.droppedDaysAgo != null) tags.push({ text: `dropped ${r.droppedDaysAgo === 0 ? 'today' : `${r.droppedDaysAgo}d ago`}`, color: '#b45309' });
                if (r.dueStatus === 'overdue') tags.push({ text: `${r.daysSince - r.intervalDays} day${r.daysSince - r.intervalDays === 1 ? '' : 's'} overdue · cut ${r.daysSince}d ago`, color: late ? '#b91c1c' : '#b45309' });
                if (r.dueStatus === 'dueToday') tags.push({ text: `due today · cut ${r.daysSince}d ago`, color: '#b45309' });
                if (r.dueStatus === 'firstCut' && !r.isNew) tags.push({ text: 'first cut of the season', color: 'var(--color-primary)' });
                if (r.isNew) tags.push({ text: 'new client', color: 'var(--color-primary)' });
                return (
                  <div key={r.cust.id} style={rowStyle}>
                    <button onClick={() => togglePick(r.cust.id)} aria-pressed={on} aria-label={`${on ? 'Untick' : 'Tick'} ${r.cust.name} for the route`}
                      style={{ width: '44px', height: '44px', flexShrink: 0, borderRadius: '10px', cursor: 'pointer', border: `2px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}`, background: on ? 'var(--color-primary)' : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <CheckCircle size={22} />}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={rowName}>{r.cust.name}</div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                        {tags.map(t => (
                          <span key={t.text} style={{ fontSize: '0.85rem', fontWeight: 700, color: t.color, background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', padding: '0.1rem 0.5rem', borderRadius: '999px' }}>{t.text}</span>
                        ))}
                      </div>
                    </div>
                    {isOnRoute(r.cust.id) ? (
                      <span style={{ fontSize: '0.95rem', color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>On route ✓</span>
                    ) : (
                      <button className="btn btn-secondary" style={{ ...bigBtn, display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }} onClick={() => handleAddToRoute(r.cust)}>
                        <Plus size={16} /> Add
                      </button>
                    )}
                  </div>
                );
              })}
              {needsList.length > 5 && <ShowAll open={showAllNeeds} onClick={() => setShowAllNeeds(s => !s)} count={needsList.length} />}
            </div>
          )}
          {needsList.length > 0 && (
            <p style={helpText}>Tick lawns and tap Plan route to open Route Builder with them in drive order, or Add to put one straight on {activeRoute ? 'the current' : "today's"} route.</p>
          )}
          {activeMode === 'mowing' && season.inSeason && (
            <p style={helpText}>
              Mowing season ends {seasonDay(season.seasonEnd)}.{' '}
              <button onClick={endSeasonNow} style={{ background: 'none', border: 'none', padding: '0.4rem 0', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 700, fontSize: 'inherit' }}>Done for the year? End it now</button>
            </p>
          )}
        </div>
      )}

      {/* Fertilizer: program treatments due */}
      {activeMode === 'fertilizer' && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
            <h3 style={{ ...sectionTitle('var(--color-text-main)'), margin: 0 }}>
              🧪 Treatments due
              {treatmentAttention.length > 0 && <span style={countBadge('#ef4444')}>{treatmentAttention.length}</span>}
            </h3>
            <Link to="/treatments" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              Manage <ChevronRight size={16} />
            </Link>
          </div>
          {treatmentAttention.length > 0 ? (
            <div className="glass-card" style={{ padding: 0 }}>
              {(showAllTreat ? treatmentAttention : treatmentAttention.slice(0, 5)).map(t => (
                <Link key={t.id} to="/treatments" style={{ ...rowStyle, textDecoration: 'none' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={rowName}>{t.customer.name}</div>
                    <div style={{ ...rowSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.stepName}</div>
                  </div>
                  <span style={{ flexShrink: 0, marginLeft: '0.6rem', fontSize: '0.85rem', fontWeight: 700, color: t.state === 'overdue' ? '#b91c1c' : '#b45309', background: t.state === 'overdue' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.12)', padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                    {t.state === 'overdue' ? 'Overdue' : 'Due now'}
                  </span>
                </Link>
              ))}
              {treatmentAttention.length > 5 && <ShowAll open={showAllTreat} onClick={() => setShowAllTreat(s => !s)} count={treatmentAttention.length} />}
            </div>
          ) : (
            <Link to="/treatments" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '1.5rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)', textDecoration: 'none', fontSize: '1rem' }}>
              <Droplets size={18} /> No treatments due — tap to manage programs
            </Link>
          )}
        </div>
      )}

      {/* ── This week ─────────────────────────────────────────────────── */}
      <button onClick={() => navigate('/history')} className="glass-card" style={{ width: '100%', marginBottom: '1.5rem', padding: '1rem 1rem 0.6rem', cursor: 'pointer', textAlign: 'left', display: 'block' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', marginBottom: '0.6rem' }}>
          <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-text-main)' }}>This week</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)' }}>${weekTotal.toFixed(0)}</span>
            {weekRate != null && <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>${weekRate.toFixed(0)}/hr</span>}
            <ChevronRight size={18} color="var(--color-text-muted)" />
          </span>
        </div>
        <WeeklyChart data={weeklyData} />
      </button>

      {/* ── Notes you typed in the last two days ──────────────────────── */}
      {typedNotes.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={sectionTitle('var(--color-text-main)')}>
            <ClipboardList size={18} color="#b45309" /> Recent job notes
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {typedNotes.map(visit => {
              const cust = allCustomers.find(c => c.id === visit.customerId);
              return (
                <div key={visit.id} className="glass-card" style={{ padding: '0.9rem 1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', marginBottom: '0.4rem' }}>
                    <div style={rowName}>{cust?.name || 'Unknown client'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>{new Date(visit.exitTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                      <button className="btn btn-secondary" style={{ ...bigBtn, color: 'var(--color-primary)' }} onClick={() => db.visits.update(visit.id, { note: '' })} title="Dismiss note">
                        <CheckCircle size={18} /> Done
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: '1rem', color: 'var(--color-text-main)', fontStyle: 'italic', background: 'var(--color-bg-main)', padding: '0.6rem 0.8rem', borderRadius: '4px', borderLeft: '3px solid #f59e0b' }}>
                    “{visit.note}”
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Shared bits for the Home cards.
const sectionTitle = (color) => ({ margin: '0 0 0.8rem 0', color, fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' });
const countBadge = (bg) => ({ fontSize: '0.8rem', background: bg, color: 'white', padding: '0.15rem 0.55rem', borderRadius: '999px', fontWeight: 700 });
const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.7rem', padding: '0.8rem 1rem', borderBottom: '1px solid var(--color-border)' };
const rowName = { fontWeight: 700, fontSize: '1.05rem', color: 'var(--color-text-main)' };
const rowSub = { fontSize: '0.9rem', marginTop: '0.15rem', color: 'var(--color-text-muted)', fontWeight: 600 };
const bigBtn = { padding: '0.5rem 0.9rem', minHeight: '44px', fontSize: '0.95rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' };
const helpText = { fontSize: '0.88rem', color: 'var(--color-text-muted)', margin: '0.5rem 0.2rem 0' };

function ShowAll({ open, onClick, count }) {
  return (
    <button onClick={onClick} style={{ width: '100%', minHeight: '48px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)' }}>
      {open ? 'Show fewer' : `Show all ${count}`}
    </button>
  );
}
