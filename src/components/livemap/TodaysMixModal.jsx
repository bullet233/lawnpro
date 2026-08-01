import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Trash2, Save } from 'lucide-react';
import { getSettings } from '../../db/settings';

// Product picker over the saved Chemical Inventory. Default text is the
// day-tank flow; title/blurb/saveLabel/clearLabel switch it to per-lawn use.
export default function TodaysMixModal({
  initialMix,
  onSave,
  onClear,
  onClose,
  title = "🧪 Today's Mix",
  blurb = "Tap what's in the tank today. Every fertilizer job you finish will file its EPA log with these products automatically — you only open the sheet when a house is different.",
  saveLabel = 'Set Mix',
  clearLabel = 'Clear mix (back to manual logs)'
}) {
  const inventory = getSettings().chemicalInventory || [];
  const [selectedIds, setSelectedIds] = useState(
    () => new Set((initialMix?.products || []).map(p => p.id))
  );
  const [mixSite, setMixSite] = useState(initialMix?.mixSite || 'Business Location');

  const toggle = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSave = () => {
    const products = inventory
      .filter(c => selectedIds.has(c.id))
      .map(c => ({
        id: c.id,
        productName: c.name,
        epaRegNum: c.epaRegNum || '',
        targetSite: c.targetSite || 'Turf',
        applicationRate: c.applicationRate || '',
        customerNotices: c.customerNotices || (c.customerNotice ? [c.customerNotice] : []),
        category: c.category || 'Other',
        isSpotTreatment: false,
        areaTreated: ''
      }));
    onSave(products, mixSite);
  };

  const byCategory = {};
  inventory.forEach(c => {
    const cat = c.category || 'Other';
    (byCategory[cat] = byCategory[cat] || []).push(c);
  });

  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div className="modal-content animate-fade-in" style={{ maxWidth: '520px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.15rem' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={24} />
          </button>
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0, marginBottom: '1.2rem', lineHeight: 1.4 }}>
          {blurb}
        </p>

        {inventory.length === 0 && (
          <div style={{ padding: '1rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
            No products saved yet. Add them under <strong>Settings → Fertilizer → Chemical Inventory</strong> first.
          </div>
        )}

        {Object.entries(byCategory).map(([cat, chems]) => (
          <div key={cat} style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>{cat}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {chems.map(chem => {
                const on = selectedIds.has(chem.id);
                return (
                  <button
                    key={chem.id}
                    onClick={() => toggle(chem.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.8rem', textAlign: 'left',
                      padding: '0.8rem 1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      border: on ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                      background: on ? 'rgba(16,185,129,0.08)' : 'var(--color-bg-main)'
                    }}
                  >
                    <div style={{
                      width: '26px', height: '26px', borderRadius: '50%', flex: '0 0 auto',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: on ? 'var(--color-primary)' : 'transparent',
                      border: on ? 'none' : '2px solid var(--color-border)', color: '#fff'
                    }}>
                      {on && <Check size={16} />}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>{chem.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        {chem.epaRegNum ? `EPA ${chem.epaRegNum} • ` : ''}{chem.applicationRate || 'no rate saved'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {inventory.length > 0 && (
          <div style={{ marginBottom: '1.2rem' }}>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Mix / Load Site</label>
            <select className="input-field" style={{ width: '100%' }} value={mixSite} onChange={e => setMixSite(e.target.value)}>
              <option>Business Location</option>
              <option>On-Site (Customer Property)</option>
            </select>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '0.8rem' }}
            disabled={selectedIds.size === 0}
            onClick={handleSave}
          >
            <Save size={18} /> {selectedIds.size === 0 ? 'Select at least one product' : `${saveLabel} (${selectedIds.size} product${selectedIds.size > 1 ? 's' : ''})`}
          </button>
          {initialMix && onClear && (
            <button
              className="btn btn-secondary"
              style={{ width: '100%', justifyContent: 'center', color: '#ef4444' }}
              onClick={onClear}
            >
              <Trash2 size={16} /> {clearLabel}
            </button>
          )}
        </div>

      </div>
    </div>,
    document.body
  );
}
