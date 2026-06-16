import { MapPin } from 'lucide-react';

export default function PendingArrivalAlert({ pendingArrival }) {
  if (!pendingArrival) return null;

  return (
    <div className="card animate-pop-in" style={{ 
      position: 'absolute', top: '5rem', left: '1rem', right: '1rem', zIndex: 100, 
      background: 'rgba(16, 185, 129, 0.95)', color: 'white', border: 'none', 
      boxShadow: '0 8px 24px rgba(16, 185, 129, 0.4)', borderRadius: '1.2rem', 
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' 
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
        <div style={{ background: 'rgba(255,255,255,0.2)', padding: '0.5rem', borderRadius: '50%' }}>
          <MapPin size={24} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, opacity: 0.9, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Arriving At</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{pendingArrival.name}</div>
        </div>
        <div style={{ fontSize: '1.8rem', fontWeight: 800, paddingRight: '0.5rem' }}>
          {pendingArrival.secondsLeft}s
        </div>
      </div>
    </div>
  );
}
