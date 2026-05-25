import { useState, useMemo } from 'react';
import { db } from '../db/db';
import { Search, UserPlus, MapPin, X } from 'lucide-react';

// Generates a ~100x100ft square geofence around a coordinate
const generateGeofence = (lat, lng) => {
  const offsetLat = 0.000137; // ~50ft in lat
  const offsetLng = 0.000170; // ~50ft in lng (approx for mid latitudes)
  return [
    { lat: lat + offsetLat, lng: lng - offsetLng }, // NW
    { lat: lat + offsetLat, lng: lng + offsetLng }, // NE
    { lat: lat - offsetLat, lng: lng + offsetLng }, // SE
    { lat: lat - offsetLat, lng: lng - offsetLng }  // SW
  ];
};

export default function QuickAddModal({ onClose, onAdd, allCustomers, currentPosition }) {
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [serviceName, setServiceName] = useState('Mowing');
  const [servicePrice, setServicePrice] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const lower = search.toLowerCase();
    return allCustomers.filter(c => 
      c.name.toLowerCase().includes(lower) || 
      (c.address && c.address.toLowerCase().includes(lower))
    );
  }, [allCustomers, search]);

  const handleCreateNew = async () => {
    if (!newName.trim() || !currentPosition) return;
    
    const newCustomer = {
      name: newName.trim(),
      address: 'Added from field', // Will need manual update later if needed
      phone: '',
      email: '',
      propertyNotes: '',
      geofence: generateGeofence(currentPosition.lat, currentPosition.lng),
      services: [
        { id: crypto.randomUUID(), name: serviceName.trim() || 'Mowing', price: Number(servicePrice) || 0, active: true },
      ],
      createdAt: Date.now()
    };

    const id = await db.customers.add(newCustomer);
    onAdd({ ...newCustomer, id });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', background: 'rgba(0,0,0,0.5)' }}>
      <div className="glass-card animate-slide-up" style={{ width: '100%', maxHeight: '80vh', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, display: 'flex', flexDirection: 'column', padding: 0 }}>
        
        {/* Header */}
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Add Unplanned Stop</h3>
          <button className="btn-icon" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {isCreating ? (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ background: 'rgba(16,185,129,0.1)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '0.5rem', alignItems: 'flex-start', border: '1px solid rgba(16,185,129,0.3)' }}>
              <MapPin size={18} color="var(--color-primary)" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div style={{ fontSize: '0.85rem', color: 'var(--color-primary)' }}>
                <strong>Using Current GPS Location</strong><br/>
                A 100x100ft geofence will be automatically drawn around your current position.
              </div>
            </div>

            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Client Name</label>
              <input 
                type="text" 
                className="input-field" 
                placeholder="e.g. John Doe"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                autoFocus
                style={{ width: '100%' }}
              />
            </div>
            
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ flex: 2 }}>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Service Performed</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. Mowing"
                  value={serviceName}
                  onChange={e => setServiceName(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Price ($)</label>
                <input 
                  type="number" 
                  className="input-field" 
                  placeholder="40"
                  value={servicePrice}
                  onChange={e => setServicePrice(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.8rem', marginTop: '0.5rem' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIsCreating(false)}>Cancel</button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 1 }} 
                disabled={!newName.trim() || !servicePrice.trim() || !currentPosition} 
                onClick={handleCreateNew}
              >
                Save & Add
              </button>
            </div>
          </div>
        ) : (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
            
            <div style={{ position: 'relative' }}>
              <Search size={18} color="var(--color-text-muted)" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
              <input 
                type="text" 
                className="input-field" 
                placeholder="Search existing clients..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', paddingLeft: '2.2rem' }}
                autoFocus
              />
            </div>

            {search.trim() && filtered.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600 }}>Existing Clients</div>
                {filtered.map(c => (
                  <button 
                    key={c.id} 
                    className="glass-card" 
                    style={{ textAlign: 'left', padding: '0.8rem', border: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
                    onClick={() => onAdd(c)}
                  >
                    <strong style={{ fontSize: '0.95rem', color: 'var(--color-text-main)' }}>{c.name}</strong>
                    {c.address && <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{c.address}</span>}
                  </button>
                ))}
              </div>
            )}

            {search.trim() && filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--color-text-muted)' }}>
                No clients found matching "{search}".
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
              <button 
                className="btn btn-primary" 
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.8rem' }}
                onClick={() => setIsCreating(true)}
              >
                <UserPlus size={18} /> Create New Client Here
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
