import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Link, useNavigate } from 'react-router-dom';
import { Map as MapIcon, Route as RouteIcon, ClipboardList, TrendingUp, Sun, Moon, Sunrise } from 'lucide-react';
import DayReviewModal from '../components/DayReviewModal';

const formatDur = (secs) => {
  if (!secs) return '0m';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [showDayReview, setShowDayReview] = useState(false);

  // Time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const GreetingIcon = hour < 12 ? Sunrise : hour < 18 ? Sun : Moon;

  // Data fetching
  const activeRoute = useLiveQuery(() => db.routes.where({ status: 'active' }).first());
  const todayVisits = useLiveQuery(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return db.visits.where('exitTime').aboveOrEqual(startOfDay.getTime()).filter(v => v.status !== 'skipped').toArray();
  }, []) || [];

  // Derived stats
  const stats = useMemo(() => {
    const revenue = todayVisits.reduce((sum, v) => sum + (v.priceEarned || 0), 0);
    const duration = todayVisits.reduce((sum, v) => sum + (v.durationSecs || 0), 0);
    return { visits: todayVisits.length, revenue, duration };
  }, [todayVisits]);

  const stopsRemaining = activeRoute 
    ? activeRoute.stops.length - (activeRoute.expandedStops ? activeRoute.expandedStops.filter(s => s.status !== 'pending').length : 0) // rough estimate, accurate calculation needs visit cross-referencing but simple length logic works for now. Wait, stops are managed by LiveMap. Just checking if active route exists is enough, stops length is an approximation if we don't calculate completed ones.
    : 0;

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '2rem' }}>
      {showDayReview && <DayReviewModal onClose={() => setShowDayReview(false)} />}
      
      {/* Header */}
      <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
        <GreetingIcon size={32} color="var(--color-primary)" />
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', color: 'var(--color-text-main)' }}>{greeting}</h1>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Contextual Action Hero */}
      <div className="glass-card" style={{ marginBottom: '1.5rem', border: '1px solid var(--color-primary)', background: 'rgba(16,185,129,0.05)' }}>
        {activeRoute ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <h2 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-text-main)' }}>Route in Progress</h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
              You have an active route running.
            </p>
            <Link to="/live" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 2rem', fontSize: '1.1rem', textDecoration: 'none' }}>
              <MapIcon size={20} /> Resume Route
            </Link>
          </div>
        ) : stats.visits > 0 ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <h2 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-text-main)' }}>Route Complete</h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
              Great job today. Don't forget to review your logs.
            </p>
            <button className="btn btn-primary" onClick={() => setShowDayReview(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 2rem', fontSize: '1.1rem' }}>
              <ClipboardList size={20} /> Review Day
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <h2 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-text-main)' }}>No Route Planned</h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
              You don't have an active route for today.
            </p>
            <Link to="/routes" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 2rem', fontSize: '1.1rem', textDecoration: 'none' }}>
              <RouteIcon size={20} /> Build Route
            </Link>
          </div>
        )}
      </div>

      {/* Mini-Stats */}
      <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-text-main)', fontSize: '1.1rem' }}>Today's Overview</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="glass-card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.3rem' }}>Revenue</div>
          <div style={{ fontWeight: 700, fontSize: '1.6rem', color: 'var(--color-primary)' }}>${stats.revenue.toFixed(2)}</div>
        </div>
        <div className="glass-card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.3rem' }}>Visits</div>
          <div style={{ fontWeight: 700, fontSize: '1.6rem', color: 'var(--color-text-main)' }}>{stats.visits}</div>
        </div>
        <div className="glass-card" style={{ padding: '1rem', gridColumn: '1 / -1' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            Time in Field
          </div>
          <div style={{ fontWeight: 700, fontSize: '1.4rem', color: 'var(--color-text-main)' }}>{formatDur(stats.duration)}</div>
        </div>
      </div>
      
      {/* Quick Links */}
      <div style={{ marginTop: '2rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-text-main)', fontSize: '1.1rem' }}>Quick Actions</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <Link to="/history" className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '1rem', textDecoration: 'none', color: 'inherit' }}>
            <ClipboardList size={20} color="var(--color-primary)" />
            <strong style={{ flex: 1 }}>View Logs & Export CSV</strong>
          </Link>
          <Link to="/analytics" className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '1rem', textDecoration: 'none', color: 'inherit' }}>
            <TrendingUp size={20} color="var(--color-primary)" />
            <strong style={{ flex: 1 }}>View Statistics</strong>
          </Link>
        </div>
      </div>

    </div>
  );
}
