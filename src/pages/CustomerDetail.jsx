import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { MapPin, Save, ArrowLeft, Trash2 } from 'lucide-react';
import GeofenceEditor from '../components/GeofenceEditor';
import { Autocomplete } from '@react-google-maps/api';
import AppDialog from '../components/AppDialog';

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  
  const customer = useLiveQuery(() => 
    isNew ? null : db.customers.get(Number(id))
  , [id]);

  const defaultServices = [
    { id: 's1', name: 'Mowing', price: 50, active: true },
    { id: 's2', name: 'Edging/Trimming', price: 15, active: false },
    { id: 's3', name: 'Fertilizer', price: 75, active: false },
    { id: 's4', name: 'Fall Clean-up', price: 150, active: false }
  ];

  const [formData, setFormData] = useState({ name: '', address: '', phone: '', email: '', lawnSize: '', propertyNotes: '' });
  const [geofence, setGeofence] = useState(null);
  const [services, setServices] = useState(defaultServices);
  const [autocomplete, setAutocomplete] = useState(null);
  const [activeTab, setActiveTab] = useState('details');
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    if (customer) {
      setFormData({ 
        name: customer.name || '', 
        address: customer.address || '',
        phone: customer.phone || '',
        email: customer.email || '',
        lawnSize: customer.lawnSize || '',
        propertyNotes: customer.propertyNotes || ''
      });
      setGeofence(customer.geofence || null);
      
      if (customer.services && customer.services.length > 0) {
        setServices(customer.services);
      } else if (customer.price) {
        // Migrate legacy price field
        setServices([
           { id: 's1', name: 'Mowing', price: customer.price, active: true },
           { id: 's2', name: 'Edging/Trimming', price: 15, active: false },
           { id: 's3', name: 'Fertilizer', price: 75, active: false },
           { id: 's4', name: 'Fall Clean-up', price: 150, active: false }
        ]);
      } else {
        setServices(defaultServices);
      }
    }
  }, [customer]);

  const onAutocompleteLoad = (autoC) => {
    setAutocomplete(autoC);
  };

  const onPlaceChanged = () => {
    if (autocomplete !== null) {
      const place = autocomplete.getPlace();
      if (place && place.formatted_address) {
        setFormData(prev => ({ ...prev, address: place.formatted_address }));
      } else if (place && place.name) {
        setFormData(prev => ({ ...prev, address: place.name }));
      }

      // Auto-generate a default geofence from the place's coordinates
      // Only set if the customer doesn't already have a custom geofence drawn
      if (place?.geometry?.location) {
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();

        // A ~75ft x 120ft rectangle (typical residential lot footprint)
        const latOffset = 0.00018; // ~20m north/south
        const lngOffset = 0.00028; // ~25m east/west

        const defaultFence = [
          { lat: lat + latOffset, lng: lng - lngOffset }, // NW
          { lat: lat + latOffset, lng: lng + lngOffset }, // NE
          { lat: lat - latOffset, lng: lng + lngOffset }, // SE
          { lat: lat - latOffset, lng: lng - lngOffset }, // SW
        ];

        // Only auto-set if no custom fence has been drawn yet
        setGeofence(prev => prev && prev.length > 0 ? prev : defaultFence);
      }
    }
  };

  const handleSave = async () => {
    const dataToSave = { 
      ...formData, 
      geofence,
      services 
    };
    if (isNew) {
      await db.customers.add(dataToSave);
    } else {
      await db.customers.update(Number(id), dataToSave);
    }
    navigate('/customers');
  };

  const handleDelete = () => {
    const custName = formData.name || 'this client';
    setDialog({
      type: 'danger',
      title: `Delete ${custName}?`,
      message: 'This will permanently delete the client and ALL their visit history. This cannot be undone.',
      confirmLabel: 'Delete Forever',
      onConfirm: async () => {
        const custId = Number(id);
        await db.visits.where({ customerId: custId }).delete();
        const allRoutes = await db.routes.toArray();
        for (const route of allRoutes) {
          if (route.stops && route.stops.some(s => (typeof s === 'object' ? s.customerId : s) === custId)) {
            const updatedStops = route.stops.filter(s => (typeof s === 'object' ? s.customerId : s) !== custId);
            await db.routes.update(route.id, { stops: updatedStops });
          }
        }
        await db.customers.delete(custId);
        navigate('/customers');
      }
    });
  };

  return (
    <div className="animate-fade-in">
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button className="btn-icon" onClick={() => navigate('/customers')} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
          <ArrowLeft size={24} color="var(--color-text-main)" />
        </button>
        <h1 className="page-title" style={{ marginBottom: 0, flex: 1 }}>{isNew ? 'New Client' : 'Edit Client'}</h1>
        {!isNew && (
          <button
            onClick={handleDelete}
            style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.7rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}
          >
            <Trash2 size={15} /> Delete
          </button>
        )}
      </div>

      <div className="tab-bar">
        <button className={`tab-button ${activeTab === 'details' ? 'active' : ''}`} onClick={() => setActiveTab('details')}>Details</button>
        <button className={`tab-button ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>Services</button>
        <button className={`tab-button ${activeTab === 'location' ? 'active' : ''}`} onClick={() => setActiveTab('location')}>Location</button>
      </div>

      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
        {activeTab === 'details' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="input-group">
              <label className="input-label">Client Name</label>
              <input 
                type="text" 
                className="input-field" 
                value={formData.name} 
                onChange={e => setFormData({ ...formData, name: e.target.value })} 
                placeholder="John Doe"
              />
            </div>
            
            <div className="input-group">
              <label className="input-label">Property Address</label>
              <Autocomplete onLoad={onAutocompleteLoad} onPlaceChanged={onPlaceChanged}>
                <input 
                  type="text" 
                  className="input-field" 
                  value={formData.address} 
                  onChange={e => setFormData({ ...formData, address: e.target.value })} 
                  placeholder="123 Main St"
                  style={{ width: '100%' }}
                />
              </Autocomplete>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="input-group">
                <label className="input-label">Phone Number</label>
                <input 
                  type="tel" 
                  className="input-field" 
                  value={formData.phone} 
                  onChange={e => setFormData({ ...formData, phone: e.target.value })} 
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Email</label>
                <input 
                  type="email" 
                  className="input-field" 
                  value={formData.email} 
                  onChange={e => setFormData({ ...formData, email: e.target.value })} 
                  placeholder="john@example.com"
                />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Lawn Size</label>
              <input 
                type="text" 
                className="input-field" 
                value={formData.lawnSize} 
                onChange={e => setFormData({ ...formData, lawnSize: e.target.value })} 
                placeholder="e.g. 5,000 sq ft or 0.25 acres"
              />
            </div>

            <div className="input-group">
              <label className="input-label">📋 Property Notes</label>
              <textarea
                className="input-field"
                rows={3}
                value={formData.propertyNotes}
                onChange={e => setFormData({ ...formData, propertyNotes: e.target.value })}
                placeholder="Standing info: gate codes, dog, parking, hazards, access notes..."
                style={{ resize: 'vertical' }}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
                Shown on every job completion as a reminder while you're still on-site.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'services' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h4 style={{ margin: 0, color: 'var(--color-text-main)' }}>Services & Pricing</h4>
            </div>
            
            {services.map((svc, i) => (
              <div key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--color-bg-card)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                <input 
                  type="checkbox" 
                  checked={svc.active} 
                  onChange={(e) => {
                    const newSvc = [...services];
                    newSvc[i].active = e.target.checked;
                    setServices(newSvc);
                  }}
                  style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                />
                
                <input 
                  type="text" 
                  className="input-field" 
                  value={svc.name}
                  onChange={(e) => {
                    const newSvc = [...services];
                    newSvc[i].name = e.target.value;
                    setServices(newSvc);
                  }}
                  style={{ flex: 1, padding: '0.5rem' }}
                />
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>$</span>
                  <input 
                    type="number" 
                    className="input-field" 
                    value={svc.price}
                    onChange={(e) => {
                      const newSvc = [...services];
                      newSvc[i].price = Number(e.target.value);
                      setServices(newSvc);
                    }}
                    style={{ width: '80px', padding: '0.5rem' }}
                  />
                </div>
              </div>
            ))}
            
            <button 
              className="btn btn-secondary" 
              onClick={() => {
                setServices([...services, { id: Date.now().toString(), name: 'New Service', price: 0, active: true }]);
              }} 
              style={{ marginTop: '0.5rem', width: '100%' }}
            >
              + Add Custom Service
            </button>
          </div>
        )}

        {activeTab === 'location' && (
          <div className="animate-fade-in">
            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-text-main)' }}>Geofence Boundary</h4>
            {geofence && geofence.length > 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--color-primary)', marginBottom: '1rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.5rem 0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.3)' }}>
                ✅ A default boundary was auto-generated from the address. Drag the corners to fine-tune it.
              </p>
            ) : (
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Draw the property boundary. The auto-timer will start when you enter this area.
              </p>
            )}
            <GeofenceEditor 
              initialPolygon={geofence} 
              address={formData.address}
              onSave={(poly) => setGeofence(poly)} 
            />
          </div>
        )}
      </div>

      <button className="btn btn-primary" onClick={handleSave} style={{ width: '100%', padding: '1rem', fontSize: '1rem' }}>
        <Save size={20} /> Save Client Profile
      </button>
    </div>
  );
}
