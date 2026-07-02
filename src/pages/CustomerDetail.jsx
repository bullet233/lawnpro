import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { MapPin, Save, ArrowLeft, Trash2, BarChart3, Clock, DollarSign, Calendar, Hash, Edit2 } from 'lucide-react';
import GeofenceEditor from '../components/GeofenceEditor';
import { Autocomplete } from '@react-google-maps/api';
import AppDialog from '../components/AppDialog';
import VisitEditModal from '../components/VisitEditModal';
import ManualVisitModal from '../components/ManualVisitModal';
import ComplianceLogModal from '../components/ComplianceLogModal';
import LawnMeasureModal from '../components/LawnMeasureModal';
import { enrollCustomer, unenrollCustomer, completeTreatment, skipTreatment, classifyTreatment } from '../db/treatments';
import { toast } from '../utils/toast';
import { getSettings } from '../db/settings';
import { trackApiCall } from '../utils/apiTracker';
import { getDaysSince } from '../utils/dateUtils';
import { getVisitRevenueBreakdown } from '../utils/revenueUtils';

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const [searchParams] = useSearchParams();
  const defaultServiceParam = searchParams.get('service');
  
  const customer = useLiveQuery(() => 
    isNew ? null : db.customers.get(Number(id))
  , [id]);

  const customerVisits = useLiveQuery(() =>
    isNew ? [] : db.visits.where({ customerId: Number(id) }).toArray()
  , [id]) || [];

  const programs = useLiveQuery(() => db.treatmentPrograms.toArray(), []) || [];
  const customerTreatments = useLiveQuery(() =>
    isNew ? [] : db.treatments.where({ customerId: Number(id) }).toArray()
  , [id]) || [];

  const completedFertilizerVisits = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return customerVisits.filter(v => 
      v.status === 'completed' &&
      v.appliedServices && v.appliedServices.includes('s3') &&
      new Date(v.exitTime).getFullYear() === currentYear
    ).sort((a, b) => b.exitTime - a.exitTime);
  }, [customerVisits]);

  const defaultServices = [
    { id: 's1', name: 'Mowing', price: 50, active: true },
    { id: 's2', name: 'Edging/Trimming', price: 15, active: false },
    { id: 's3', name: 'Fertilizer', price: 75, active: false },
    { id: 's4', name: 'Fall Clean-up', price: 150, active: false }
  ];

  const [formData, setFormData] = useState({ name: '', address: '', phone: '', email: '', lawnSize: '', mowableSqFt: '', perimeterFt: '', obstacleCount: '', terrain: 'flat', fencedBackyard: false, propertyNotes: '', serviceInterval: 7, mowingInterval: 7, fertilizerInterval: 30, fertilizerRounds: 6, specialApplications: '' });
  const [geofence, setGeofence] = useState(null);
  const [services, setServices] = useState(() => {
    const globalDefaults = getSettings().defaultServices || defaultServices;
    if (isNew && defaultServiceParam) {
      return globalDefaults.map(s => ({
        ...s,
        active: s.id === defaultServiceParam
      }));
    }
    return globalDefaults;
  });
  const [autocomplete, setAutocomplete] = useState(null);
  const [activeTab, setActiveTab] = useState('details');
  const [dialog, setDialog] = useState(null);
  const [settings, setSettings] = useState(null);
  const [editingJob, setEditingJob] = useState(null);
  const [showManualVisitModal, setShowManualVisitModal] = useState(false);
  const [showMeasure, setShowMeasure] = useState(false);
  const [showAllVisits, setShowAllVisits] = useState(false);
  const [visitSort, setVisitSort] = useState('date-desc'); // {field}-{dir} for the visit log
  const [visitFilter, setVisitFilter] = useState('all'); // service-id filter for the visit log
  const [groupByMonth, setGroupByMonth] = useState(false); // group the visit log under month headers
  const [loggingTreatment, setLoggingTreatment] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const initialDataRef = useRef(null);

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  useEffect(() => {
    if (customer) {
      const fd = { 
        name: customer.name || '', 
        address: customer.address || '',
        phone: customer.phone || '',
        email: customer.email || '',
        lawnSize: customer.lawnSize || '',
        mowableSqFt: customer.mowableSqFt || '',
        perimeterFt: customer.perimeterFt || '',
        obstacleCount: customer.obstacleCount ?? '',
        terrain: customer.terrain || 'flat',
        fencedBackyard: customer.fencedBackyard || false,
        propertyNotes: customer.propertyNotes || '',
        serviceInterval: customer.serviceInterval || 7,
        mowingInterval: customer.mowingInterval || customer.serviceInterval || 7,
        fertilizerInterval: customer.fertilizerInterval || 30,
        fertilizerRounds: customer.fertilizerRounds || 6,
        specialApplications: customer.specialApplications || '',
        excludeFromAnalytics: customer.excludeFromAnalytics || false
      };
      setFormData(fd);
      initialDataRef.current = JSON.stringify(fd);
      setGeofence(customer.geofence || null);
      
      const globalDefaults = getSettings().defaultServices || defaultServices;
      let mergedServices = [];

      if (customer.services && customer.services.length > 0) {
        // Start with global defaults to ensure new services show up, overriding with customer's saved data
        mergedServices = globalDefaults.map(def => {
          const saved = customer.services.find(s => s.id === def.id);
          return saved ? { ...def, ...saved } : def;
        });
        
        // Append any purely custom services the customer has
        customer.services.forEach(saved => {
          if (!mergedServices.find(s => s.id === saved.id)) {
            mergedServices.push(saved);
          }
        });
      } else if (customer.price) {
        // Migrate legacy price field
        mergedServices = globalDefaults.map(def => 
          def.id === 's1' ? { ...def, price: customer.price, active: true } : def
        );
      } else {
        mergedServices = globalDefaults;
      }
      
      setServices(mergedServices);
      setIsDirty(false);
    }
  }, [customer]);

  // Track dirty state
  useEffect(() => {
    if (initialDataRef.current && !isNew) {
      const changed = JSON.stringify(formData) !== initialDataRef.current;
      setIsDirty(changed);
    } else if (isNew) {
      setIsDirty(formData.name.trim().length > 0);
    }
  }, [formData, isNew]);

  // Warn on browser close/refresh with unsaved changes
  useEffect(() => {
    const handler = (e) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Wrap navigate to warn about unsaved changes
  const safeNavigate = useCallback((path) => {
    if (isDirty) {
      setDialog({
        type: 'warning',
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Leave without saving?',
        confirmLabel: 'Leave',
        onConfirm: () => navigate(path)
      });
    } else {
      navigate(path);
    }
  }, [isDirty, navigate]);

  const onAutocompleteLoad = (autoC) => {
    setAutocomplete(autoC);
  };

  const onPlaceChanged = () => {
    if (autocomplete !== null) {
      trackApiCall('autocomplete');
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

        // Always auto-set geofence to the new location when address is updated
        setGeofence(defaultFence);
      }
    }
  };

  const handleSaveEditedJob = async (updatedData) => {
    if (!editingJob) return;
    
    const updateObj = {
      appliedServices: updatedData.appliedServices,
      addOns: updatedData.addOns,
      priceEarned: updatedData.priceEarned,
      durationSecs: updatedData.durationSecs,
      driveTimeSecs: updatedData.driveTimeSecs,
      note: updatedData.note,
      exitTime: updatedData.exitTime,
      entryTime: updatedData.entryTime
    };
    
    await db.visits.update(editingJob.id, updateObj);
    setEditingJob(null);
  };

  const handleSaveManualVisit = async (visitData) => {
    await db.visits.add({
      customerId: Number(id),
      routeId: null,
      status: 'completed',
      ...visitData
    });
    setShowManualVisitModal(false);
  };

  const handleMeasureResult = ({ sqft, perimeterFt }) => {
    setFormData(prev => ({
      ...prev,
      mowableSqFt: sqft,
      perimeterFt: perimeterFt,
      // Use the measured area as the lawn size (it drives the bidding matrix),
      // but don't clobber a manual entry with an empty measurement.
      lawnSize: sqft ? String(sqft) : prev.lawnSize,
    }));
    setShowMeasure(false);
    toast(`Measured ${sqft.toLocaleString()} sq ft · ${perimeterFt.toLocaleString()} ft edging`);
  };

  // ── Treatment program enrollment ─────────────────────────────────────────
  const fertServicePrice = () => {
    const svc = services.find(s => s.active && (s.category === 'Fertilizer' || s.id === 's3'));
    return svc ? Number(svc.price) || 0 : 0;
  };

  const handleEnrollProgram = async () => {
    const program = programs[0];
    if (!program) { toast('No treatment program found.'); return; }
    const n = await enrollCustomer(Number(id), program.id, new Date().getFullYear());
    toast(`Enrolled — ${n} step${n === 1 ? '' : 's'} scheduled.`);
  };

  const handleUnenroll = () => {
    setDialog({
      type: 'confirm',
      title: 'Remove from program?',
      message: 'This unenrolls the client and removes their upcoming (not-yet-completed) scheduled treatments for this year. Completed application history is kept.',
      confirmLabel: 'Unenroll',
      onConfirm: async () => { await unenrollCustomer(Number(id)); toast('Client unenrolled.'); }
    });
  };

  const handleSaveTreatmentLog = async (logData) => {
    if (!loggingTreatment) return;
    await completeTreatment(loggingTreatment.id, {
      complianceLog: logData,
      completedAt: Date.now(),
      price: fertServicePrice()
    });
    setLoggingTreatment(null);
    toast('Application logged.');
  };

  const handleSave = async () => {
    let finalGeofence = geofence;
    
    const initialData = initialDataRef.current ? JSON.parse(initialDataRef.current) : {};
    if (formData.address && formData.address !== initialData.address) {
      if (window.google && window.google.maps) {
        const geocoder = new window.google.maps.Geocoder();
        try {
          const results = await new Promise(resolve => {
            geocoder.geocode({ address: formData.address }, (res, status) => {
              resolve(status === 'OK' ? res : null);
            });
          });
          if (results && results[0]?.geometry?.location) {
            const lat = results[0].geometry.location.lat();
            const lng = results[0].geometry.location.lng();
            const latOffset = 0.00018;
            const lngOffset = 0.00028;
            finalGeofence = [
              { lat: lat + latOffset, lng: lng - lngOffset },
              { lat: lat + latOffset, lng: lng + lngOffset },
              { lat: lat - latOffset, lng: lng + lngOffset },
              { lat: lat - latOffset, lng: lng - lngOffset },
            ];
          }
        } catch (e) {
          console.error("Geocoding failed during save", e);
        }
      }
    }

    const dataToSave = { 
      ...formData, 
      geofence: finalGeofence,
      services 
    };

    const saveToDb = async () => {
      if (isNew) {
        dataToSave.createdAt = Date.now();
        await db.customers.add(dataToSave);
      } else {
        await db.customers.update(Number(id), dataToSave);
      }
    };

    if (isNew) {
      await saveToDb();
      navigate('/customers');
      return;
    }

    const changedServices = [];
    services.forEach(s => {
      const initS = initialData.services?.find(is => is.id === s.id);
      if (initS && initS.price !== s.price) {
        changedServices.push(s);
      }
    });

    if (changedServices.length > 0) {
      setDialog({
        type: 'confirm',
        title: 'Update Past Visits?',
        message: `You updated prices for: ${changedServices.map(s => s.name).join(', ')}. Would you like to retroactively apply these new prices to all past visits to correct your historical revenue charts? (This will NOT modify any EPA compliance logs).`,
        confirmLabel: 'Apply to Past Visits',
        cancelLabel: 'No, Just Save Profile',
        onConfirm: async () => {
          await saveToDb();
          const custId = Number(id);
          const pastVisits = await db.visits.where({ customerId: custId }).toArray();
          for (const v of pastVisits) {
            let newPriceEarned = 0;
            if (v.appliedServices && Array.isArray(v.appliedServices) && v.appliedServices.length > 0) {
              for (const sId of v.appliedServices) {
                const s = services.find(srv => srv.id === sId);
                if (s) {
                  newPriceEarned += s.price;
                }
              }
              // Preserve any add-on revenue so retroactively re-pricing base services
              // doesn't silently erase add-on charges from past visits.
              const addOnTotal = Array.isArray(v.addOns) ? v.addOns.reduce((sum, a) => sum + (a.price || 0), 0) : 0;
              newPriceEarned += addOnTotal;
              if (newPriceEarned > 0 && newPriceEarned !== v.priceEarned) {
                await db.visits.update(v.id, { priceEarned: newPriceEarned });
              }
            }
          }
          navigate('/customers');
        },
        onCancel: async () => {
          await saveToDb();
          navigate('/customers');
        }
      });
    } else {
      await saveToDb();
      navigate('/customers');
    }
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
        <button className="btn-icon" onClick={() => safeNavigate('/customers')} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
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
        {!isNew && <button className={`tab-button ${activeTab === 'stats' ? 'active' : ''}`} onClick={() => setActiveTab('stats')}>Stats</button>}
        <button className={`tab-button ${activeTab === 'location' ? 'active' : ''}`} onClick={() => setActiveTab('location')}>Location</button>
        {services.find(s => s.id === 's3')?.active && (
          <button className={`tab-button ${activeTab === 'fertilizer' ? 'active' : ''}`} onClick={() => setActiveTab('fertilizer')}>🧪 Fertilizer</button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '2rem' }}>
        {activeTab === 'details' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: 'var(--color-text-main)', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>👤 Client Profile</h3>
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
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: 'var(--color-text-main)', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>📞 Contact Info</h3>
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
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: 'var(--color-text-main)', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>🗓️ Service Schedule</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                <label className="input-label">Mowing Interval</label>
                <select 
                  className="input-field" 
                  value={formData.mowingInterval} 
                  onChange={e => setFormData({ ...formData, mowingInterval: Number(e.target.value) })}
                  style={{ width: '100%', padding: '0.55rem' }}
                >
                  <option value={7}>Weekly (7 days)</option>
                  <option value={10}>Every 10 days</option>
                  <option value={14}>Bi-Weekly (14 days)</option>
                  <option value={21}>Every 3 weeks</option>
                  <option value={28}>Monthly</option>
                </select>
              </div>

              <div className="input-group">
                <label className="input-label">Fertilizer Interval</label>
                <select 
                  className="input-field" 
                  value={formData.fertilizerInterval} 
                  onChange={e => setFormData({ ...formData, fertilizerInterval: Number(e.target.value) })}
                  style={{ width: '100%', padding: '0.55rem' }}
                >
                  <option value={21}>Every 3 weeks</option>
                  <option value={28}>Every 4 weeks</option>
                  <option value={35}>Every 5 weeks</option>
                  <option value={42}>Every 6 weeks</option>
                  <option value={60}>Every 2 months</option>
                </select>
              </div>

              <div className="input-group">
                <label className="input-label">Lawn Size</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="input-field"
                    value={formData.lawnSize}
                    onChange={e => setFormData({ ...formData, lawnSize: e.target.value })}
                    placeholder="e.g. 5000 sq ft or 0.25 acres"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowMeasure(true)}
                    disabled={isNew && !formData.address}
                    title={isNew && !formData.address ? 'Enter an address first' : 'Measure on satellite'}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap', padding: '0.55rem 0.7rem' }}
                  >
                    <MapPin size={15} /> Measure
                  </button>
                </div>
                {formData.mowableSqFt ? (
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-primary)', marginTop: '0.3rem', fontWeight: 600 }}>
                    📐 Measured: {Number(formData.mowableSqFt).toLocaleString()} sq ft
                    {formData.perimeterFt ? ` · ${Number(formData.perimeterFt).toLocaleString()} ft edging` : ''}
                  </div>
                ) : null}
              </div>
            </div>
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: 'var(--color-text-main)', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>🏡 Property Details</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                <label className="input-label">🌳 Trimming Obstacles</label>
                <input 
                  type="number" 
                  className="input-field" 
                  value={formData.obstacleCount} 
                  onChange={e => setFormData({ ...formData, obstacleCount: e.target.value === '' ? '' : Number(e.target.value) })} 
                  placeholder="e.g. 8"
                />
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
                  Trees, beds, posts, etc.
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">⛰️ Terrain</label>
                <select 
                  className="input-field" 
                  value={formData.terrain} 
                  onChange={e => setFormData({ ...formData, terrain: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem' }}
                >
                  <option value="flat">Flat</option>
                  <option value="moderate">Moderate Hills</option>
                  <option value="hilly">Hilly / Steep</option>
                </select>
              </div>
            </div>

            <div className="input-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={formData.fencedBackyard} 
                  onChange={e => setFormData({ ...formData, fencedBackyard: e.target.checked })}
                  style={{ width: '18px', height: '18px' }}
                />
                <span className="input-label" style={{ margin: 0 }}>🚧 Fenced Backyard (gate access needed)</span>
              </label>
            </div>

            <div className="input-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={formData.excludeFromAnalytics} 
                  onChange={e => setFormData({ ...formData, excludeFromAnalytics: e.target.checked })}
                  style={{ width: '18px', height: '18px' }}
                />
                <span className="input-label" style={{ margin: 0 }}>🚫 Exclude from Analytics</span>
              </label>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
                Check this if this property has unusual pricing, size, or difficulty that throws off your overall metrics.
              </div>
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
          </div>
        )}

        {activeTab === 'services' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {['Mowing', 'Fertilizer', 'Other'].map(cat => {
              const catServices = services.filter(s => (s.category || 'Other') === cat);
              if (catServices.length === 0) return null;
              
              return (
                <div key={cat} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  <h4 style={{ margin: 0, color: 'var(--color-text-main)', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
                    {cat === 'Mowing' ? '🌾 Mowing & Maintenance' : cat === 'Fertilizer' ? '🧪 Chemical & Fertilizer' : '🔧 Other Services'}
                  </h4>
                  
                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    {catServices.map(svc => (
                      <div key={svc.id} style={{ 
                        display: 'flex', alignItems: 'center', gap: '1rem', 
                        background: svc.active ? 'rgba(16,185,129,0.05)' : 'var(--color-bg-card)', 
                        padding: '0.8rem', borderRadius: 'var(--radius-sm)', 
                        border: svc.active ? '1px solid rgba(16,185,129,0.3)' : '1px solid var(--color-border)',
                        transition: 'all 0.2s ease'
                      }}>
                        <input 
                          type="checkbox" 
                          checked={svc.active} 
                          onChange={(e) => {
                            setServices(prev => prev.map(s => s.id === svc.id ? { ...s, active: e.target.checked } : s));
                          }}
                          style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                        />
                        
                        <div style={{ flex: 1, padding: '0.2rem', fontWeight: 600, color: svc.active ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>
                          {svc.name}
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>$</span>
                          <input 
                            type="number" 
                            className="input-field" 
                            value={svc.price}
                            onChange={(e) => {
                              setServices(prev => prev.map(s => s.id === svc.id ? { ...s, price: Number(e.target.value) } : s));
                            }}
                            style={{ width: '70px', padding: '0.5rem', background: svc.active ? 'var(--color-bg-main)' : 'var(--color-bg-card)' }}
                          />
                        </div>
                        
                        {(!settings?.defaultServices?.some(d => d.id === svc.id)) && (
                          <button 
                            onClick={() => setServices(prev => prev.filter(s => s.id !== svc.id))}
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', padding: '0.4rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            title="Delete old custom service"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'stats' && (() => {
          const completed = customerVisits.filter(v => v.status === 'completed' && v.durationSecs);
          const visitCount = completed.length;
          const totalRevenue = customerVisits.reduce((s, v) => s + (v.priceEarned || 0), 0);
          
          // Distinguish visits
          const sortedByDate = [...completed].sort((a, b) => b.exitTime - a.exitTime);
          const globalDefaults = settings?.defaultServices || [];
          const mowingServiceIds = globalDefaults.filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);
          const fertServiceIds = globalDefaults.filter(s => s.category === 'Fertilizer' || s.id === 's3').map(s => s.id);

          const mowVisits = sortedByDate.filter(v => !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => mowingServiceIds.includes(id)));
          const fertVisits = sortedByDate.filter(v => v.appliedServices && v.appliedServices.some(id => fertServiceIds.includes(id)));

          // Full visit log = completed AND skipped (true history), newest first.
          const isFertVisit = (v) => v.appliedServices && v.appliedServices.some(id => fertServiceIds.includes(id));
          const logVisits = [...customerVisits]
            .filter(v => v.status === 'completed' || v.status === 'skipped')
            .sort((a, b) => (b.exitTime || b.entryTime || 0) - (a.exitTime || a.entryTime || 0));
          // Days since the previous visit OF THE SAME TYPE (mow/fert) — service cadence.
          const gapById = {};
          {
            const lastByType = {};
            [...logVisits].reverse().forEach(v => {
              const t = isFertVisit(v) ? 'fert' : 'mow';
              const prev = lastByType[t];
              if (prev && v.exitTime) gapById[v.id] = Math.round((v.exitTime - prev) / 86400000);
              if (v.exitTime) lastByType[t] = v.exitTime;
            });
          }
          // Service filter — chips auto-built from services this client has actually had.
          // Empty appliedServices => implicit mow (s1), matching the app's convention.
          const svcIdsFor = (v) => (v.appliedServices && v.appliedServices.length) ? v.appliedServices : ['s1'];
          const distinctServiceIds = [];
          logVisits.forEach(v => svcIdsFor(v).forEach(id => { if (!distinctServiceIds.includes(id)) distinctServiceIds.push(id); }));
          const serviceNameFor = (id) => services.find(s => s.id === id)?.name || settings?.defaultServices?.find(s => s.id === id)?.name || id;
          // Guard so switching to a client without the selected service falls back to "all".
          const effectiveFilter = (visitFilter !== 'all' && distinctServiceIds.includes(visitFilter)) ? visitFilter : 'all';
          const filteredLog = effectiveFilter === 'all' ? logVisits : logVisits.filter(v => svcIdsFor(v).includes(effectiveFilter));

          // Display sort (gap chips are computed from chronological order, unaffected).
          const [sortField, sortDir] = visitSort.split('-');
          const visitRate = (v) => { const s = (v.durationSecs || 0) + (v.driveTimeSecs || 0); return s > 0 ? (v.priceEarned || 0) / (s / 3600) : 0; };
          const sortedLog = [...filteredLog].sort((a, b) => {
            const dir = sortDir === 'asc' ? 1 : -1;
            switch (sortField) {
              case 'price': return dir * ((a.priceEarned || 0) - (b.priceEarned || 0));
              case 'time': return dir * ((a.durationSecs || 0) - (b.durationSecs || 0));
              case 'rate': return dir * (visitRate(a) - visitRate(b));
              default: return dir * ((a.exitTime || 0) - (b.exitTime || 0));
            }
          });
          const visitsToShow = showAllVisits ? sortedLog : sortedLog.slice(0, 15);

          // When grouping by month, inject month-header markers between visits so the
          // single existing row map can render both headers and rows (no duplication).
          let displayItems;
          if (groupByMonth) {
            const chrono = [...filteredLog].sort((a, b) => (b.exitTime || 0) - (a.exitTime || 0));
            displayItems = [];
            let curKey = null, curGroup = null;
            chrono.forEach(v => {
              const d = v.exitTime ? new Date(v.exitTime) : null;
              const key = d ? `${d.getFullYear()}-${d.getMonth()}` : 'unknown';
              if (key !== curKey) {
                curKey = key;
                curGroup = { __header: true, key, label: d ? d.toLocaleDateString([], { month: 'long', year: 'numeric' }) : 'Unknown date', count: 0, revenue: 0 };
                displayItems.push(curGroup);
              }
              curGroup.count += 1;
              curGroup.revenue += (v.priceEarned || 0);
              displayItems.push(v);
            });
          } else {
            displayItems = visitsToShow;
          }

          const lastMowVisit = mowVisits[0];
          const lastMowedDate = lastMowVisit ? new Date(lastMowVisit.exitTime) : null;
          const daysSinceMow = lastMowedDate ? getDaysSince(lastMowedDate.getTime()) : null;

          const lastFertVisit = fertVisits[0];
          const lastFertDate = lastFertVisit ? new Date(lastFertVisit.exitTime) : null;
          const daysSinceFert = lastFertDate ? getDaysSince(lastFertDate.getTime()) : null;

          // Avg $/hr
          const totalSecs = completed.reduce((s, v) => s + (v.durationSecs || 0) + (v.driveTimeSecs || 0), 0);
          const avgPerHr = totalSecs > 0 ? (totalRevenue / (totalSecs / 3600)) : 0;

          // Per-service average times
          const serviceTimeMap = {};
          completed.forEach(v => {
            if (!v.appliedServices?.length) return;
            v.appliedServices.forEach(sid => {
              if (!serviceTimeMap[sid]) serviceTimeMap[sid] = { totalSecs: 0, count: 0 };
              // Distribute blade time evenly across applied services for that visit
              serviceTimeMap[sid].totalSecs += (v.durationSecs || 0) / v.appliedServices.length;
              serviceTimeMap[sid].count += 1;
            });
          });

          const serviceAvgs = Object.entries(serviceTimeMap).map(([sid, data]) => {
            const svc = services.find(s => s.id === sid);
            return {
              name: svc?.name || sid,
              avgMins: Math.round((data.totalSecs / data.count) / 60),
              count: data.count
            };
          });

          // Overall avg blade & drive time
          const avgBladeSecs = mowVisits.length > 0 ? mowVisits.reduce((s, v) => s + v.durationSecs, 0) / mowVisits.length : 0;
          const avgDriveSecs = visitCount > 0 ? completed.reduce((s, v) => s + (v.driveTimeSecs || 0), 0) / visitCount : 0;

          let ehrColor = 'var(--color-primary)';
          if (settings && avgPerHr > 0) {
            if (avgPerHr < settings.rateUnderpaidThreshold) ehrColor = '#ef4444';
            else if (avgPerHr < settings.targetHourlyRate) ehrColor = '#f59e0b';
          }

          return (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {visitCount === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--color-text-muted)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
                  <div style={{ fontWeight: 600 }}>No completed visits yet</div>
                  <div style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>Stats will appear after you complete a job for this customer.</div>
                </div>
              ) : (
                <>
                  {/* Summary Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                    <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--color-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.3rem' }}>
                        <Hash size={11} /> Visits
                      </div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{visitCount}</div>
                    </div>

                    <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--color-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.3rem' }}>
                        <DollarSign size={11} /> Total Revenue
                      </div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-primary)' }}>${totalRevenue.toFixed(2)}</div>
                    </div>

                    <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--color-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.4rem' }}>
                        <Clock size={11} /> Avg Times
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-main)' }}>{Math.round(avgBladeSecs / 60)}m</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>cut</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '2px' }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-main)' }}>{Math.round(avgDriveSecs / 60)}m</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>drive</div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--color-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.3rem' }}>
                        <DollarSign size={11} /> Avg $/hr
                      </div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: ehrColor }}>${avgPerHr.toFixed(2)}</div>
                    </div>
                  </div>

                  {/* Last Mowed */}
                  {lastMowedDate && (
                    <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Calendar size={15} color="var(--color-text-muted)" />
                        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Last Mowed</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                          {lastMowedDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: daysSinceMow <= (formData.mowingInterval || 7) ? 'var(--color-primary)' : daysSinceMow <= (formData.mowingInterval || 7) + 3 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>
                          {daysSinceMow === 0 ? 'Today' : daysSinceMow === 1 ? 'Yesterday' : `${daysSinceMow} days ago`}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Last Fertilized */}
                  {lastFertDate && (
                    <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Calendar size={15} color="var(--color-text-muted)" />
                        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Last Fertilized</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                          {lastFertDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: daysSinceFert <= (formData.fertilizerInterval || 30) ? 'var(--color-primary)' : daysSinceFert <= (formData.fertilizerInterval || 30) + 7 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>
                          {daysSinceFert === 0 ? 'Today' : daysSinceFert === 1 ? 'Yesterday' : `${daysSinceFert} days ago`}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Per-Service Avg Times */}
                  {serviceAvgs.length > 0 && (
                    <div className="card">
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>
                        <BarChart3 size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                        Avg Time Per Service
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {serviceAvgs.map(sa => (
                          <div key={sa.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-bg-main)', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{sa.name}</span>
                            <div style={{ textAlign: 'right' }}>
                              <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{sa.avgMins} min</span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>({sa.count} visits)</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Visit History Timeline */}
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        <Clock size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                        Visit Log <span style={{ opacity: 0.6 }}>({filteredLog.length})</span>
                      </div>
                      <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setShowManualVisitModal(true)}>
                        + Log Manual Visit
                      </button>
                    </div>
                    {distinctServiceIds.length > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                        {['all', ...distinctServiceIds].map(id => {
                          const active = effectiveFilter === id;
                          const label = id === 'all' ? 'All' : serviceNameFor(id);
                          return (
                            <button key={id} onClick={() => setVisitFilter(id)}
                              style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', fontWeight: 600, borderRadius: '999px', cursor: 'pointer',
                                border: active ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                background: active ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-main)',
                                color: active ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {filteredLog.length > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.7rem', flexWrap: 'wrap' }}>
                        {!groupByMonth && (
                          <>
                            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Sort</span>
                            <select value={visitSort} onChange={e => setVisitSort(e.target.value)} className="input-field"
                              style={{ padding: '0.3rem 0.5rem', fontSize: '0.78rem', width: 'auto' }}>
                              <option value="date-desc">Newest first</option>
                              <option value="date-asc">Oldest first</option>
                              <option value="price-desc">Highest $</option>
                              <option value="price-asc">Lowest $</option>
                              <option value="time-desc">Longest job</option>
                              <option value="time-asc">Shortest job</option>
                              <option value="rate-desc">Best $/hr</option>
                              <option value="rate-asc">Worst $/hr</option>
                            </select>
                          </>
                        )}
                        <button onClick={() => setGroupByMonth(!groupByMonth)}
                          style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '999px', cursor: 'pointer',
                            border: groupByMonth ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                            background: groupByMonth ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-main)',
                            color: groupByMonth ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                          📅 By month
                        </button>
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: (showAllVisits || groupByMonth) ? '620px' : '340px', overflowY: 'auto' }}>
                      {displayItems.map((item) => {
                        if (item.__header) return (
                          <div key={item.key} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--color-bg-card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.2rem 0.35rem', borderTop: '1px solid var(--color-border)', marginTop: '0.2rem' }}>
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-main)' }}>{item.label}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>{item.count} visit{item.count !== 1 ? 's' : ''} · ${item.revenue.toFixed(0)}</span>
                          </div>
                        );
                        const v = item;
                        const svcNames = (v.appliedServices || []).map(sid => services.find(s => s.id === sid)?.name).filter(Boolean);
                        const isSkipped = v.status === 'skipped';
                        const secs = (v.durationSecs || 0) + (v.driveTimeSecs || 0);
                        const perHr = secs > 0 ? (v.priceEarned || 0) / (secs / 3600) : 0;
                        const gap = gapById[v.id];
                        const interval = isFertVisit(v) ? (formData.fertilizerInterval || 30) : (formData.mowingInterval || 7);
                        const gapColor = gap == null ? null : gap > interval * 1.6 ? '#ef4444' : gap > interval + 2 ? '#f59e0b' : 'var(--color-text-muted)';
                        const hasEpa = !!v.complianceLog;

                        return (
                          <div key={v.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.6rem 0.7rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '0.8rem', opacity: isSkipped ? 0.7 : 1 }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, marginTop: '0.35rem', background: v.status === 'completed' ? 'var(--color-primary)' : '#ef4444' }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span>{v.exitTime ? new Date(v.exitTime).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
                                {gap != null && (
                                  <span style={{ fontSize: '0.65rem', fontWeight: 600, color: gapColor }} title={`${gap} days since previous ${isFertVisit(v) ? 'fertilizer' : 'mow'} visit`}>
                                    +{gap}d
                                  </span>
                                )}
                                {isSkipped ? (
                                  <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)' }}>SKIPPED</span>
                                ) : (
                                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', fontSize: '0.68rem', fontWeight: 600 }} title="Drive Time">
                                      <span style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.8 }}>Drive</span>
                                      <span style={{ color: 'var(--color-text-main)', fontWeight: 700 }}>{Math.round((v.driveTimeSecs || 0) / 60)}m</span>
                                    </span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', fontSize: '0.68rem', fontWeight: 600 }} title="Job Time">
                                      <span style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.8 }}>Job</span>
                                      <span style={{ color: 'var(--color-text-main)', fontWeight: 700 }}>{Math.round((v.durationSecs || 0) / 60)}m</span>
                                    </span>
                                    {perHr > 0 && (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', fontSize: '0.68rem', fontWeight: 700, color: settings && perHr < settings.rateUnderpaidThreshold ? '#ef4444' : settings && perHr < settings.targetHourlyRate ? '#f59e0b' : 'var(--color-primary)' }} title="Effective rate (job + drive)">
                                        ${perHr.toFixed(0)}/hr
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {(svcNames.length > 0 || hasEpa) && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                  {svcNames.length > 0 && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{svcNames.join(', ')}</span>}
                                  {hasEpa && (
                                    <button onClick={() => navigate(`/print-epa/${v.id}`)} title="View / print EPA compliance log"
                                      style={{ fontSize: '0.62rem', fontWeight: 700, color: '#0ea5e9', background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.3)', borderRadius: 'var(--radius-sm)', padding: '0.05rem 0.35rem', cursor: 'pointer', flexShrink: 0 }}>
                                      🧪 EPA log
                                    </button>
                                  )}
                                </div>
                              )}
                              {v.note && v.note.trim() && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-main)', fontStyle: 'italic', marginTop: '0.35rem', background: 'var(--color-bg-card)', borderLeft: '3px solid #f59e0b', padding: '0.35rem 0.5rem', borderRadius: '4px' }}>
                                  “{v.note}”
                                </div>
                              )}
                            </div>
                            <div style={{ fontWeight: 700, color: isSkipped ? 'var(--color-text-muted)' : 'var(--color-primary)', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                              ${(v.priceEarned || 0).toFixed(0)}
                              {v.appliedServices?.length > 1 && (() => {
                                const breakdown = getVisitRevenueBreakdown(v, customer, settings?.defaultServices);
                                if (Object.keys(breakdown).length > 1) {
                                  return (
                                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontWeight: 600, marginTop: '0.1rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.1rem' }}>
                                      {Object.entries(breakdown).map(([sid, amt]) => {
                                        const sName = customer?.services?.find(s => s.id === sid)?.name || settings?.defaultServices?.find(s => s.id === sid)?.name || sid;
                                        return <div key={sid}>{sName}: ${amt.toFixed(0)}</div>;
                                      })}
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.3rem', flexShrink: 0, marginLeft: '0.2rem', color: 'var(--color-text-muted)' }}
                              onClick={() => setEditingJob(v)}
                              title="Edit Visit"
                            >
                              <Edit2 size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {!groupByMonth && filteredLog.length > 15 && (
                      <button className="btn btn-secondary" style={{ width: '100%', marginTop: '0.6rem', padding: '0.4rem', fontSize: '0.8rem' }} onClick={() => setShowAllVisits(!showAllVisits)}>
                        {showAllVisits ? 'Show less' : `Show all ${filteredLog.length} visits`}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {activeTab === 'location' && (
          <div className="animate-fade-in">
            <GeofenceEditor 
              initialPolygon={geofence} 
              onSave={(poly) => setGeofence(poly)} 
              address={formData.address}
            />
          </div>
        )}

        {activeTab === 'fertilizer' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* Treatment Program */}
            {!isNew && (() => {
              const year = new Date().getFullYear();
              const enrolled = !!customer?.treatmentProgramId;
              const yearTreatments = customerTreatments
                .filter(t => t.year === year)
                .map(t => ({
                  ...t,
                  state: t.status === 'completed' ? 'completed'
                    : t.status === 'skipped' ? 'skipped'
                    : classifyTreatment(t, Date.now())
                }))
                .sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
              const done = yearTreatments.filter(t => t.state === 'completed').length;
              const stateMeta = {
                completed: { label: 'Done', color: 'var(--color-primary)' },
                overdue: { label: 'Overdue', color: '#ef4444' },
                due: { label: 'Due Now', color: '#f59e0b' },
                scheduled: { label: 'Scheduled', color: 'var(--color-text-muted)' },
                skipped: { label: 'Skipped', color: 'var(--color-text-muted)' },
              };
              return (
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text-main)' }}>💧 Treatment Program</h3>
                    {enrolled ? (
                      <button onClick={handleUnenroll} style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem' }}>Unenroll</button>
                    ) : (
                      <button className="btn btn-primary" style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }} onClick={handleEnrollProgram}>Enroll</button>
                    )}
                  </div>

                  {!enrolled ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                      Enroll this client in <strong>{programs[0]?.name || 'the treatment program'}</strong> to auto-schedule seasonal applications and track compliance.
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                        {programs.find(p => p.id === customer.treatmentProgramId)?.name || 'Program'} · {done}/{yearTreatments.length} done in {year}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {yearTreatments.map(t => {
                          const sm = stateMeta[t.state] || stateMeta.scheduled;
                          const canLog = t.state === 'due' || t.state === 'overdue' || t.state === 'scheduled';
                          return (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.6rem 0.7rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-main)' }}>{t.stepName}</div>
                                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: sm.color, marginTop: '0.1rem' }}>
                                  {t.state === 'completed' && t.completedAt
                                    ? `Done ${new Date(t.completedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
                                    : sm.label}
                                </div>
                              </div>
                              {t.state === 'completed' ? (
                                <span style={{ color: 'var(--color-primary)', fontWeight: 700, fontSize: '0.8rem' }}>✓</span>
                              ) : t.state === 'skipped' ? (
                                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>—</span>
                              ) : canLog && (
                                <button className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }} onClick={() => setLoggingTreatment(t)}>Log</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* Settings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="input-group">
                <label className="input-label">Target Yearly Rounds</label>
                <input 
                  type="number" 
                  className="input-field" 
                  value={formData.fertilizerRounds} 
                  onChange={e => setFormData({ ...formData, fertilizerRounds: Number(e.target.value) })}
                  style={{ width: '150px' }}
                />
              </div>

              <div className="input-group">
                <label className="input-label">Special Applications / Chemical Notes</label>
                <textarea 
                  className="input-field" 
                  rows={3}
                  value={formData.specialApplications}
                  onChange={e => setFormData({ ...formData, specialApplications: e.target.value })}
                  placeholder="e.g. Grub control in June, Pet-safe only in backyard"
                />
              </div>
            </div>

            {/* Progress Bar */}
            {!isNew && (
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--color-text-main)' }}>Current Year Progress</h3>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                    {completedFertilizerVisits.length} / {formData.fertilizerRounds} Completed
                  </div>
                </div>

                <div style={{ width: '100%', height: '12px', background: 'var(--color-bg-main)', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                  <div style={{ 
                    width: `${Math.min(100, (completedFertilizerVisits.length / formData.fertilizerRounds) * 100)}%`, 
                    height: '100%', 
                    background: 'var(--color-primary)',
                    transition: 'width 0.3s ease'
                  }} />
                </div>

                {completedFertilizerVisits.length > 0 ? (
                  <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {completedFertilizerVisits.map((v, idx) => (
                      <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.6rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)' }}>
                        <span style={{ fontWeight: 600 }}>Round {completedFertilizerVisits.length - idx}</span>
                        <span style={{ color: 'var(--color-text-muted)' }}>{new Date(v.exitTime).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop: '1rem', padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)' }}>
                    No fertilizer applications recorded yet this year.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {activeTab !== 'stats' && (
        <button className="btn btn-primary" onClick={handleSave} style={{ width: '100%', padding: '1rem', fontSize: '1rem' }}>
          <Save size={20} /> {isDirty ? '● Save Client Profile' : 'Save Client Profile'}
        </button>
      )}

      {editingJob && (
        <VisitEditModal
          job={editingJob}
          customer={customer}
          defaultServices={settings?.defaultServices}
          onClose={() => setEditingJob(null)}
          onSave={handleSaveEditedJob}
        />
      )}

      {showManualVisitModal && customer && (
        <ManualVisitModal
          customer={customer}
          onClose={() => setShowManualVisitModal(false)}
          onSave={handleSaveManualVisit}
        />
      )}

      {showMeasure && (
        <LawnMeasureModal
          customer={{ name: formData.name, address: formData.address }}
          onClose={() => setShowMeasure(false)}
          onSave={handleMeasureResult}
        />
      )}

      {loggingTreatment && customer && (
        <ComplianceLogModal
          visit={{ exitTime: Date.now(), phone: customer.phone, address: customer.address }}
          customerName={customer.name}
          customerLawnSize={customer.lawnSize}
          initialLog={null}
          onSave={handleSaveTreatmentLog}
          onClose={() => setLoggingTreatment(null)}
        />
      )}
    </div>
  );
}
