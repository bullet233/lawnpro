import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { TrendingUp, CheckCircle, Clock, DollarSign } from 'lucide-react';

export default function Analytics() {
  const allVisits = useLiveQuery(() => db.visits.toArray(), []) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];

  const validJobs = allVisits.filter(h => h.status !== 'skipped');
  
  const totalRevenue = validJobs.reduce((sum, job) => sum + (job.priceEarned || 0), 0);
  const totalJobs = validJobs.length;
  const totalSeconds = validJobs.reduce((sum, job) => sum + (job.durationSecs || 0), 0);
  const totalHours = totalSeconds / 3600;
  
  const revenuePerHour = totalHours > 0 ? (totalRevenue / totalHours) : 0;

  const profitableClients = allCustomers.map(c => {
    const cJobs = validJobs.filter(j => j.customerId === c.id);
    const totalEarnings = cJobs.reduce((sum, j) => sum + (j.priceEarned || 0), 0);
    const totalSecs = cJobs.reduce((sum, j) => sum + (j.durationSecs || 0), 0);
    const totalHrs = totalSecs / 3600;
    const hrRate = totalHrs > 0 ? (totalEarnings / totalHrs) : 0;
    return { ...c, hrRate, totalEarnings, jobsCount: cJobs.length };
  }).filter(c => c.jobsCount > 0 && c.hrRate > 0).sort((a, b) => b.hrRate - a.hrRate);

  const serviceRevenue = {};
  validJobs.forEach(job => {
    if (job.appliedServices && job.appliedServices.length > 0) {
      const cust = allCustomers.find(c => c.id === job.customerId);
      if (cust && cust.services) {
        job.appliedServices.forEach(svcId => {
          const svc = cust.services.find(s => s.id === svcId);
          if (svc) {
             const sName = svc.name || 'Unknown';
             if (!serviceRevenue[sName]) serviceRevenue[sName] = 0;
             serviceRevenue[sName] += svc.price;
          }
        });
      }
    } else if (job.priceEarned > 0) {
      const sName = 'Base Service / Legacy';
      if (!serviceRevenue[sName]) serviceRevenue[sName] = 0;
      serviceRevenue[sName] += job.priceEarned;
    }
  });

  const topServices = Object.keys(serviceRevenue).map(name => ({
    name, revenue: serviceRevenue[name]
  })).sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">Analytics</h1>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
            <DollarSign size={14} /> Total Revenue
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--color-primary)' }}>
            ${totalRevenue.toFixed(0)}
          </div>
        </div>

        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
            <TrendingUp size={14} /> $/Hour
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: '#f59e0b' }}>
            ${revenuePerHour.toFixed(0)}
          </div>
        </div>

        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
            <CheckCircle size={14} /> Jobs Done
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: '#3b82f6' }}>
            {totalJobs}
          </div>
        </div>

        <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
            <Clock size={14} /> Work Hours
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--color-text-main)' }}>
            {totalHours.toFixed(1)}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        <div className="glass-card">
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-text-main)' }}>Most Profitable Clients ($/Hr)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {profitableClients.slice(0, 10).map((c, i) => (
               <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem 0', borderBottom: '1px solid var(--color-border)' }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                   <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--color-bg-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--color-text-muted)' }}>
                     {i + 1}
                   </div>
                   <div>
                     <div style={{ fontWeight: '600' }}>{c.name}</div>
                     <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{c.jobsCount} visits • ${c.totalEarnings.toFixed(0)} total</div>
                   </div>
                 </div>
                 <div style={{ fontWeight: '700', color: '#f59e0b', fontSize: '1.1rem' }}>
                   ${c.hrRate.toFixed(0)}<span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--color-text-muted)' }}>/hr</span>
                 </div>
               </div>
            ))}
            {profitableClients.length === 0 && (
               <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem 0' }}>Not enough job history to calculate efficiency.</div>
            )}
          </div>
        </div>

        <div className="glass-card">
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-text-main)' }}>Top Services by Revenue</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {topServices.map((s, i) => (
               <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem 0', borderBottom: '1px solid var(--color-border)' }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                   <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--color-bg-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--color-text-muted)' }}>
                     {i + 1}
                   </div>
                   <div style={{ fontWeight: '600', textTransform: 'capitalize' }}>{s.name}</div>
                 </div>
                 <div style={{ fontWeight: '700', color: 'var(--color-primary)', fontSize: '1.1rem' }}>
                   ${s.revenue.toFixed(0)}
                 </div>
               </div>
            ))}
            {topServices.length === 0 && (
               <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem 0' }}>No services logged yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
