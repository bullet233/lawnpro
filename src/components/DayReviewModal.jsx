import { useState, useEffect } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle, Save, X } from 'lucide-react';

export default function DayReviewModal({ onClose }) {
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const todayVisits = useLiveQuery(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return db.visits
      .where('exitTime').aboveOrEqual(startOfDay.getTime())
      .filter(v => v.status !== 'skipped')
      .toArray();
  }, []) || [];

  // Local edits: { [visitId]: { appliedServices: [], priceEarned: number } }
  const [edits, setEdits] = useState({});

  useEffect(() => {
    // Seed edits with existing data
    const initial = {};
    todayVisits.forEach(v => {
      initial[v.id] = { appliedServices: v.appliedServices || [], priceEarned: v.priceEarned || 0 };
    });
    setEdits(initial);
  }, [todayVisits.length]);

  const toggleService = (visitId, svc, custServices) => {
    setEdits(prev => {
      const current = prev[visitId] || { appliedServices: [], priceEarned: 0 };
      const isChecked = current.appliedServices.includes(svc.id);
      const newIds = isChecked
        ? current.appliedServices.filter(id => id !== svc.id)
        : [...current.appliedServices, svc.id];
      const newPrice = custServices
        .filter(s => newIds.includes(s.id))
        .reduce((sum, s) => sum + s.price, 0);
      return { ...prev, [visitId]: { appliedServices: newIds, priceEarned: newPrice } };
    });
  };

  const handleSaveAll = async () => {
    for (const [visitIdStr, data] of Object.entries(edits)) {
      await db.visits.update(Number(visitIdStr), {
        appliedServices: data.appliedServices,
        priceEarned: data.priceEarned
      });
    }
    onClose();
  };

  const formatDur = (secs) => {
    if (!secs) return '0m';
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m`;
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '520px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
          <h3 style={{ margin: 0 }}>📋 End of Day Review</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={20} />
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.2rem', marginTop: 0 }}>
          Review and confirm the services performed at each property today.
        </p>

        {todayVisits.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem 0' }}>No completed jobs today.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '55vh', overflowY: 'auto' }}>
          {todayVisits.map(visit => {
            const cust = allCustomers.find(c => c.id === visit.customerId);
            if (!cust) return null;
            const activeServices = cust.services?.filter(s => s.active) || [];
            const edit = edits[visit.id] || { appliedServices: [], priceEarned: 0 };

            return (
              <div key={visit.id} style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', padding: '0.8rem' }}>
                {/* Visit Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{cust.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {new Date(visit.exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ⏱ {formatDur(visit.durationSecs)}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '1.1rem' }}>
                    ${edit.priceEarned.toFixed(2)}
                  </div>
                </div>

                {/* Service Checkboxes */}
                {activeServices.length === 0 ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No active services on profile.</span>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {activeServices.map(svc => {
                      const checked = edit.appliedServices.includes(svc.id);
                      return (
                        <label
                          key={svc.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-full)',
                            border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                            background: checked ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-card)',
                            cursor: 'pointer', fontSize: '0.85rem', userSelect: 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleService(visit.id, svc, activeServices)}
                            style={{ display: 'none' }}
                          />
                          {checked && <CheckCircle size={13} color="var(--color-primary)" />}
                          {svc.name} <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>${svc.price}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleSaveAll}>
          <Save size={18} /> Save All & Close
        </button>
      </div>
    </div>
  );
}
