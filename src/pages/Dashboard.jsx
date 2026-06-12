import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Link, useNavigate } from 'react-router-dom';
import DayReviewModal from '../components/DayReviewModal';
import { getBusinessDayStart, getDaysSince } from '../utils/dateUtils';
import { getSettings } from '../db/settings';
import { Plus, Sunrise, Sun, Moon, Settings as SettingsIcon, Map as MapIcon, Route as RouteIcon, ClipboardList, Thermometer, CloudSun, CloudRain, Cloud, Users, AlertTriangle, TrendingUp, CheckCircle } from 'lucide-react';

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
        const isToday = i === data.length - 1;
        return (
          <g key={i}>
            <rect
              x={x} y={y} width={barW} height={h}
              rx="3"
              fill={isToday ? 'var(--color-primary)' : 'rgba(16,185,129,0.25)'}
            />
            <text
              x={x + barW / 2} y={chartH + 13}
              textAnchor="middle"
              fill="var(--color-text-muted)"
              fontSize="9"
              fontWeight={isToday ? '700' : '400'}
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
  const [showDayReview, setShowDayReview] = useState(false);
  const [weather, setWeather] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dashboardTab, setDashboardTab] = useState('mowing');

  // Time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const GreetingIcon = hour < 12 ? Sunrise : hour < 18 ? Sun : Moon;

  // Data fetching
  const activeRoute = useLiveQuery(async () => {
    const routes = await db.routes.where('status').anyOf('pending', 'active').toArray();
    if (routes.length === 0) return null;
    const route = routes[0];
    
    if (route && route.stops) {
      const custIds = route.stops.map(s => typeof s === 'object' ? s.customerId : s);
      const customers = await db.customers.where('id').anyOf(custIds).toArray();
      route.expandedStops = custIds.map(id => customers.find(c => c.id === id)).filter(Boolean);
    }
    return route || null;
  });

  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];

  const todayVisits = useLiveQuery(() => {
    const startOfDay = getBusinessDayStart();
    return db.visits.where('exitTime').aboveOrEqual(startOfDay.getTime()).filter(v => v.status !== 'skipped').toArray();
  }, []) || [];

  const allVisits = useLiveQuery(() => db.visits.toArray(), []) || [];

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
    return { visits: todayVisits.length, revenue, duration };
  }, [todayVisits]);

  // Weekly earnings data (last 7 days)
  const weeklyData = useMemo(() => {
    const days = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i--) {
      const startOfDay = getBusinessDayStart();
      startOfDay.setDate(startOfDay.getDate() - i);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);
      endOfDay.setMilliseconds(-1);
      
      const dayRevenue = allVisits
        .filter(v => v.exitTime >= startOfDay.getTime() && v.exitTime <= endOfDay.getTime() && v.status !== 'skipped')
        .reduce((s, v) => s + (v.priceEarned || 0), 0);
      days.push({ label: dayNames[startOfDay.getDay()], revenue: dayRevenue });
    }
    return days;
  }, [allVisits]);

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
  const { mowingDue, fertilizerDue } = useMemo(() => {
    if (allCustomers.length === 0) return { mowingDue: [], fertilizerDue: [] };
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
      
      const custVisits = allVisits.filter(v => v.customerId === cust.id && (v.status === 'completed'));
      
      // Mowing
      if (isMowingCust) {
        const mInterval = cust.mowingInterval || cust.serviceInterval || 7;
        const mowVisits = custVisits.filter(v => !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => mowingServiceIds.includes(id)));
        
        if (mowVisits.length === 0) {
          mDue.push({ ...cust, daysSince: 999, isNew: true, intervalDays: mInterval });
        } else {
          const lastMow = Math.max(...mowVisits.map(v => v.exitTime));
          const daysSince = getDaysSince(lastMow);
          if (daysSince >= mInterval) {
            mDue.push({ ...cust, daysSince, isNew: false, intervalDays: mInterval });
          }
        }
      }

      // Fertilizer
      if (isFertCust) {
        const fInterval = cust.fertilizerInterval || 30;
        const fertVisits = custVisits.filter(v => v.appliedServices && v.appliedServices.some(id => fertServiceIds.includes(id)));
        
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

    return { mowingDue: mDue, fertilizerDue: fDue };
  }, [allCustomers, allVisits]);

  const activeDueList = dashboardTab === 'mowing' ? mowingDue : fertilizerDue;
  const overdueCount = dashboardTab === 'mowing' ? mowingDue.filter(c => !c.isNew).length : fertilizerDue.filter(c => !c.isNew).length;

  const handleAddToRoute = async (customer) => {
    const defaultIds = customer.services?.filter(s => s.active).slice(0, 1).map(s => s.id) || [];
    
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
      await db.routes.add({
        name: "Today's Route",
        date: new Date().toISOString(),
        status: 'active',
        isTemplate: 0,
        stops: [{ customerId: customer.id, plannedServiceIds: defaultIds }]
      });
    }
  };

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

      {/* Contextual Action Bar */}
      <div className="glass-card" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.8rem 1rem', border: activeRoute ? '1px solid var(--color-primary)' : '1px solid var(--color-border)', background: activeRoute ? 'rgba(16,185,129,0.05)' : 'var(--color-bg-card)' }}>
        {activeRoute ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-primary)', boxShadow: '0 0 8px var(--color-primary)' }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text-main)' }}>
                  {activeRoute.status === 'pending' ? 'Route Pending' : 'Route Active'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {activeRoute.status === 'pending' ? 'Ready to begin' : (nextCustomer ? `Next: ${nextCustomer.name}` : 'All stops visited')}
                </div>
              </div>
            </div>
            <Link to="/live" className="btn btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem', textDecoration: 'none' }}>
              {activeRoute.status === 'pending' ? 'Start' : 'Resume'} <MapIcon size={14} />
            </Link>
          </>
        ) : stats.visits > 0 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <CheckCircle size={16} color="var(--color-primary)" />
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text-main)' }}>Route Complete</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Great job today!</div>
              </div>
            </div>
            <button className="btn btn-secondary" onClick={() => setShowDayReview(true)} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              Review <ClipboardList size={14} />
            </button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <RouteIcon size={16} color="var(--color-text-muted)" />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text-main)' }}>No Route Planned</div>
              </div>
            </div>
            <Link to="/routes" className="btn btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem', textDecoration: 'none' }}>
              Build Route
            </Link>
          </>
        )}
      </div>

      {/* Mini-Stats Row */}
      <h3 style={{ margin: '0 0 0.8rem 0', color: 'var(--color-text-main)', fontSize: '1rem', fontWeight: 600 }}>Today's Overview</h3>
      <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.2rem' }}>Revenue</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-primary)' }}>${stats.revenue.toFixed(0)}</div>
        </div>
        <div style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.5rem' }} />
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.2rem' }}>Visits</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-text-main)' }}>{stats.visits}</div>
        </div>
        <div style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.5rem' }} />
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.2rem' }}>Time</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-text-main)' }}>{formatDur(stats.duration)}</div>
        </div>
        <div style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.5rem' }} />
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.2rem' }}>
            <Users size={10} /> Clients
          </div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-text-main)' }}>
            {allCustomers.length}
            {overdueCount > 0 && (
              <div style={{ fontSize: '0.6rem', color: '#ef4444', fontWeight: 600, marginTop: '2px' }}>
                {overdueCount} overdue
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Needs Attention / Due This Week */}
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          <button 
            onClick={() => setDashboardTab('mowing')}
            style={{ 
              background: 'transparent', border: 'none', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', padding: '0.4rem 0.8rem', position: 'relative',
              color: dashboardTab === 'mowing' ? 'var(--color-primary)' : 'var(--color-text-muted)'
            }}
          >
            🌾 Mowing
            {mowingDue.length > 0 && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', background: '#ef4444', color: 'white', padding: '0.1rem 0.4rem', borderRadius: '10px' }}>{mowingDue.length}</span>}
            {dashboardTab === 'mowing' && <div style={{ position: 'absolute', bottom: '-0.5rem', left: 0, right: 0, height: '3px', background: 'var(--color-primary)', borderRadius: '3px' }} />}
          </button>
          
          <button 
            onClick={() => setDashboardTab('fertilizer')}
            style={{ 
              background: 'transparent', border: 'none', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', padding: '0.4rem 0.8rem', position: 'relative',
              color: dashboardTab === 'fertilizer' ? 'var(--color-primary)' : 'var(--color-text-muted)'
            }}
          >
            🧪 Fertilizer
            {fertilizerDue.length > 0 && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', background: '#ef4444', color: 'white', padding: '0.1rem 0.4rem', borderRadius: '10px' }}>{fertilizerDue.length}</span>}
            {dashboardTab === 'fertilizer' && <div style={{ position: 'absolute', bottom: '-0.5rem', left: 0, right: 0, height: '3px', background: 'var(--color-primary)', borderRadius: '3px' }} />}
          </button>
        </div>

        {activeDueList.length > 0 ? (
          <div className="glass-card" style={{ padding: '0', maxHeight: '280px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {activeDueList.map(cust => {
                const isInActiveRoute = activeRoute && activeRoute.stops.some(s => {
                  const id = typeof s === 'object' ? s.customerId : s;
                  return id === cust.id;
                });
                
                return (
                  <div key={cust.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.8rem', borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text-main)' }}>{cust.name}</div>
                      <div style={{ fontSize: '0.75rem', marginTop: '0.1rem', color: cust.isNew ? 'var(--color-primary)' : (cust.daysSince > cust.intervalDays + 2 ? '#ef4444' : '#f59e0b'), fontWeight: 500 }}>
                        {cust.isNew ? '✨ New Client' : `⏳ ${cust.daysSince} days ago`}
                      </div>
                    </div>
                    {isInActiveRoute ? (
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>Added ✓</span>
                    ) : (
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem', background: 'transparent', border: '1px solid var(--color-border)' }}
                        onClick={() => handleAddToRoute(cust)}
                      >
                        <Plus size={12} /> Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)' }}>
            No one is currently due for {dashboardTab}.
          </div>
        )}
      </div>

      {/* Recent Notes Alert */}
      {recentNotes.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-text-main)', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <ClipboardList size={18} color="#f59e0b" /> Recent Job Notes
          </h3>
          <div className="glass-card" style={{ padding: '0.5rem', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {recentNotes.map((visit, i) => {
                const cust = allCustomers.find(c => c.id === visit.customerId);
                return (
                  <div key={i} style={{ padding: '0.8rem', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text-main)' }}>{cust?.name || 'Unknown Client'}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          {new Date(visit.exitTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </div>
                        <button 
                          style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                          onClick={() => db.visits.update(visit.id, { note: '' })}
                          title="Dismiss Note"
                        >
                          <CheckCircle size={16} />
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-main)', fontStyle: 'italic', background: 'var(--color-bg-main)', padding: '0.6rem', borderRadius: '4px', borderLeft: '3px solid #f59e0b' }}>
                      "{visit.note}"
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Weekly Earnings */}
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
          <h3 style={{ margin: 0, color: 'var(--color-text-main)', fontSize: '1.1rem' }}>This Week</h3>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-primary)' }}>${weekTotal.toFixed(2)}</span>
        </div>
        <div className="glass-card" style={{ padding: '1rem 0.8rem 0.5rem' }}>
          <WeeklyChart data={weeklyData} />
        </div>
      </div>
      


    </div>
  );
}
