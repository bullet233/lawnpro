import { useState, useEffect } from 'react';
import { X, CheckCircle, Plus, DollarSign } from 'lucide-react';
import { getSettings } from '../db/settings';

/**
 * EditJobModal
 * Props:
 *   completionPanel — the state object from LiveMap (contains custName, durationSecs, priceEarned, visitId, appliedServices, primaryCustomer)
 *   onSave — async (updatedData) => void  (receives { appliedServices, addOns, priceEarned, note })
 *   onClose — () => void
 */
export default function EditJobModal({ completionPanel, onSave, onClose }) {
  const [baseServices, setBaseServices] = useState([]);
  const [selectedBaseServiceIds, setSelectedBaseServiceIds] = useState(completionPanel.appliedServices || []);
  
  const [availableAddOns, setAvailableAddOns] = useState([]);
  const [selectedAddOns, setSelectedAddOns] = useState([]); // Array of { id, name, price }
  
  const [note, setNote] = useState('');
  
  useEffect(() => {
    // Load settings add-ons
    const settings = getSettings();
    if (settings?.addOnServices) {
      setAvailableAddOns(settings.addOnServices);
    }
    
    // Load customer base services
    if (completionPanel.primaryCustomer?.services) {
      setBaseServices(completionPanel.primaryCustomer.services);
    }
  }, [completionPanel]);
  
  const toggleBaseService = (id) => {
    setSelectedBaseServiceIds(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };
  
  const toggleAddOn = (addon) => {
    setSelectedAddOns(prev => {
      const exists = prev.find(a => a.id === addon.id);
      if (exists) {
        return prev.filter(a => a.id !== addon.id);
      } else {
        return [...prev, { id: addon.id, name: addon.name, price: addon.defaultPrice }];
      }
    });
  };

  const updateAddOnPrice = (id, newPriceStr) => {
    const price = parseFloat(newPriceStr) || 0;
    setSelectedAddOns(prev => 
      prev.map(a => a.id === id ? { ...a, price } : a)
    );
  };

  // Compute total
  const basePrice = baseServices.filter(s => selectedBaseServiceIds.includes(s.id)).reduce((sum, s) => sum + s.price, 0);
  const addOnPrice = selectedAddOns.reduce((sum, a) => sum + a.price, 0);
  const totalEarned = basePrice + addOnPrice;

  const handleSave = () => {
    onSave({
      appliedServices: selectedBaseServiceIds,
      addOns: selectedAddOns,
      priceEarned: totalEarned,
      note: note.trim()
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="animate-slide-up" style={{ width: '100%', maxWidth: '500px', backgroundColor: 'var(--color-bg-main)', borderTopLeftRadius: '16px', borderTopRightRadius: '16px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderBottom: '1px solid var(--color-border)' }}>
          <h2 style={{ fontSize: '1.2rem', margin: 0, fontWeight: 700 }}>Edit Job: {completionPanel.custName}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem', color: 'var(--color-text-muted)' }}>
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1rem', overflowY: 'auto', flex: 1 }}>
          
          {/* Base Services */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.6rem', color: 'var(--color-text-main)' }}>Base Services</h3>
            {baseServices.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>No recurring services defined for this customer.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {baseServices.map(svc => (
                  <div 
                    key={svc.id}
                    onClick={() => toggleBaseService(svc.id)}
                    style={{ 
                      display: 'flex', alignItems: 'center', padding: '0.8rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      border: selectedBaseServiceIds.includes(svc.id) ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                      background: selectedBaseServiceIds.includes(svc.id) ? 'rgba(16,185,129,0.05)' : 'var(--color-bg-card)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <div style={{ width: '20px', height: '20px', borderRadius: '4px', border: '2px solid', borderColor: selectedBaseServiceIds.includes(svc.id) ? 'var(--color-primary)' : 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: selectedBaseServiceIds.includes(svc.id) ? 'var(--color-primary)' : 'transparent' }}>
                        {selectedBaseServiceIds.includes(svc.id) && <CheckCircle size={14} color="white" />}
                      </div>
                      <span style={{ fontWeight: 600 }}>{svc.name}</span>
                    </div>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>${svc.price}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add-On Services */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.6rem', color: 'var(--color-text-main)' }}>Add-On Extras</h3>
            {availableAddOns.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>No add-ons defined. Add some in Settings.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem' }}>
                {availableAddOns.map(addon => {
                  const isSelected = selectedAddOns.some(a => a.id === addon.id);
                  const selectedData = selectedAddOns.find(a => a.id === addon.id);
                  return (
                    <div 
                      key={addon.id}
                      style={{ 
                        display: 'flex', flexDirection: 'column', padding: '0.6rem', borderRadius: 'var(--radius-sm)',
                        border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        background: isSelected ? 'rgba(16,185,129,0.05)' : 'var(--color-bg-card)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div 
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem', cursor: 'pointer' }}
                        onClick={() => toggleAddOn(addon)}
                      >
                        {isSelected ? <CheckCircle size={16} color="var(--color-primary)" /> : <Plus size={16} color="var(--color-text-muted)" />}
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, flex: 1, lineHeight: 1.2 }}>{addon.name}</span>
                      </div>
                      
                      {isSelected ? (
                        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--color-bg-main)', borderRadius: '4px', border: '1px solid var(--color-border)', padding: '2px 4px' }}>
                          <DollarSign size={14} color="var(--color-text-muted)" />
                          <input 
                            type="number" 
                            value={selectedData.price || ''}
                            onChange={(e) => updateAddOnPrice(addon.id, e.target.value)}
                            style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9rem', fontWeight: 600, padding: '2px' }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      ) : (
                        <div onClick={() => toggleAddOn(addon)} style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                          + ${addon.defaultPrice}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Note */}
          <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.4rem', color: 'var(--color-text-main)' }}>Note</h3>
            <textarea
              rows={2}
              className="input-field"
              placeholder="Add a note... (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              style={{ width: '100%', resize: 'none' }}
            />
          </div>

        </div>

        {/* Footer Summary & Save */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-card)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Job Total</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-primary)' }}>${totalEarned.toFixed(2)}</div>
          </div>
          <button className="btn btn-primary" onClick={handleSave} style={{ padding: '0.8rem 1.5rem', fontSize: '1rem' }}>
            Save & Update
          </button>
        </div>

      </div>
    </div>
  );
}
