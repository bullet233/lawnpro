import { useState, useEffect, useRef } from 'react';
import { getSettings, saveSettings } from '../db/settings';
import { db } from '../db/db';
import { Settings as SettingsIcon, Save, Download, Upload, Plus, Trash2, Map as MapIcon, Edit2, Check, FileText } from 'lucide-react';
import AppDialog from '../components/AppDialog';
import { useLiveQuery } from 'dexie-react-hooks';
import { API_PRICES } from '../utils/apiTracker';
import { toast } from '../utils/toast';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [targetRate, setTargetRate] = useState('');
  const [underpaidRate, setUnderpaidRate] = useState('');
  const [minStopFee, setMinStopFee] = useState('');
  const [drivebySecs, setDrivebySecs] = useState('');
  const [costOfGas, setCostOfGas] = useState('');
  const [truckMpg, setTruckMpg] = useState('');
  const [mowerGph, setMowerGph] = useState('1.0');
  const [applicatorName, setApplicatorName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessLogo, setBusinessLogo] = useState('');
  const [chemicalInventory, setChemicalInventory] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [defaultServices, setDefaultServices] = useState([]);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceCategory, setNewServiceCategory] = useState('Other');
  const [addOnServices, setAddOnServices] = useState([]);
  const [newAddOnName, setNewAddOnName] = useState('');
  const [newAddOnPrice, setNewAddOnPrice] = useState('');
  const [newAddOnCategory, setNewAddOnCategory] = useState('Maintenance');
  const [editingAddOnId, setEditingAddOnId] = useState(null);
  const [newChemName, setNewChemName] = useState('');
  const [newChemEpa, setNewChemEpa] = useState('');
  const [newChemTarget, setNewChemTarget] = useState('');
  const [newChemRate, setNewChemRate] = useState('');
  const [newChemNotices, setNewChemNotices] = useState([]);
  const [newChemCategory, setNewChemCategory] = useState('Fertilizer');
  const [activeTab, setActiveTab] = useState('pricing');
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [editingChemId, setEditingChemId] = useState(null);
  const importRef = useRef(null);

  const todayStats = useLiveQuery(() => db.apiStats.get(new Date().toLocaleDateString('en-CA')), []);

  useEffect(() => {
    const s = getSettings();
    setSettings(s);
    setTargetRate(s.targetHourlyRate.toString());
    setUnderpaidRate(s.rateUnderpaidThreshold.toString());
    setMinStopFee((s.minStopFee ?? 30).toString());
    setDrivebySecs((s.drivebyThresholdSecs || 45).toString());
    setCostOfGas((s.costOfGas || 3.50).toString());
    setTruckMpg((s.truckMpg || 7).toString());
    setMowerGph((s.mowerGph || 1.0).toString());
    setApplicatorName(s.applicatorName || '');
    setBusinessName(s.businessName || '');
    setBusinessAddress(s.businessAddress || '');
    setBusinessPhone(s.businessPhone || '');
    setBusinessEmail(s.businessEmail || '');
    setBusinessLogo(s.businessLogo || '');
      const loadedServices = s.defaultServices || [
        { id: 's1', name: 'Mowing', price: 50, active: true },
        { id: 's2', name: 'Edging/Trimming', price: 15, active: false },
        { id: 's3', name: 'Fertilizer', price: 75, active: false },
        { id: 's4', name: 'Fall Clean-up', price: 150, active: false }
      ];
      setDefaultServices(loadedServices.map(svc => {
        if (!svc.category) {
          if (svc.id === 's1' || svc.name.toLowerCase().includes('mow')) return { ...svc, category: 'Mowing' };
          if (svc.id === 's3' || svc.name.toLowerCase().includes('fert')) return { ...svc, category: 'Fertilizer' };
          return { ...svc, category: 'Other' };
        }
        return svc;
      }));
    setLicenseNumber(s.licenseNumber || '');
    setChemicalInventory(s.chemicalInventory || []);
    setAddOnServices(s.addOnServices || []);
  }, []);

  const handleSave = () => {
    const target = parseFloat(targetRate);
    const underpaid = parseFloat(underpaidRate);
    const minFee = parseFloat(minStopFee);
    const driveby = parseInt(drivebySecs, 10);
    const gas = parseFloat(costOfGas);
    const mpg = parseFloat(truckMpg);
    const mower = parseFloat(mowerGph);
    
    if (isNaN(target) || isNaN(underpaid) || isNaN(minFee) || isNaN(driveby) || isNaN(gas) || isNaN(mpg) || isNaN(mower)) {
      setDialog({ type: 'warning', title: 'Invalid Input', message: 'Please enter valid numbers for all fields.' });
      return;
    }

    // Auto-add unsaved default service if present
    let currentServices = [...defaultServices];
    if (newServiceName.trim()) {
      const price = parseFloat(newServicePrice) || 0;
      const cat = newServiceCategory;
      if (editingServiceId) {
        currentServices = currentServices.map(s => s.id === editingServiceId ? { ...s, name: newServiceName.trim(), price, category: cat } : s);
      } else {
        currentServices.push({ id: Date.now().toString(), name: newServiceName.trim(), price, active: false, category: cat });
      }
      setDefaultServices(currentServices);
      setEditingServiceId(null);
      setNewServiceName('');
      setNewServicePrice('');
      setNewServiceCategory('Other');
    }

    // Auto-add unsaved chemical if present
    let currentInventory = [...chemicalInventory];
    if (newChemName.trim()) {
      const chem = {
        id: editingChemId || Date.now().toString(),
        name: newChemName.trim(),
        epaRegNum: newChemEpa.trim(),
        targetSite: newChemTarget.trim(),
        applicationRate: newChemRate.trim(),
        customerNotices: newChemNotices.filter(n => n.trim() !== ''),
        category: newChemCategory || 'Other'
      };
      if (editingChemId) {
        currentInventory = currentInventory.map(c => c.id === editingChemId ? chem : c);
      } else {
        currentInventory.push(chem);
      }
      setChemicalInventory(currentInventory);
      setEditingChemId(null);
      setNewChemName('');
      setNewChemEpa('');
      setNewChemTarget('');
      setNewChemRate('');
      setNewChemNotices([]);
      setNewChemCategory('Fertilizer');
    }

    // Auto-add unsaved add-on if present
    let currentAddOns = [...addOnServices];
    if (newAddOnName.trim()) {
      const price = parseFloat(newAddOnPrice) || 0;
      const cat = newAddOnCategory;
      if (editingAddOnId) {
        currentAddOns = currentAddOns.map(a => a.id === editingAddOnId ? { ...a, name: newAddOnName.trim(), defaultPrice: price, category: cat } : a);
      } else {
        currentAddOns.push({ id: 'ao_' + Date.now(), name: newAddOnName.trim(), defaultPrice: price, category: cat });
      }
      setAddOnServices(currentAddOns);
      setEditingAddOnId(null);
      setNewAddOnName('');
      setNewAddOnPrice('');
      setNewAddOnCategory('Maintenance');
    }

    saveSettings({
      targetHourlyRate: target,
      rateUnderpaidThreshold: underpaid,
      minStopFee: minFee,
      drivebyThresholdSecs: driveby,
      costOfGas: gas,
      truckMpg: mpg,
      mowerGph: mower,
      businessName,
      businessAddress,
      businessPhone,
      businessEmail,
      businessLogo,
      applicatorName,
      licenseNumber,
      defaultServices: currentServices,
      chemicalInventory: currentInventory,
      addOnServices: currentAddOns
    });
    
    toast('Settings saved successfully!');
  };

  // ── Data Export ──────────────────────────────────────────────────────────
  const handleExport = async () => {
    try {
      const customers = await db.customers.toArray();
      const visits = await db.visits.toArray();
      const routes = await db.routes.toArray();
      const settingsData = getSettings();

      const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: settingsData,
        customers,
        visits,
        routes
      };

      const json = JSON.stringify(backup, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lawnpro-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast(`Exported ${customers.length} customers, ${visits.length} visits, and ${routes.length} routes.`);
    } catch (e) {
      setDialog({ type: 'warning', title: 'Export Failed', message: e.message });
    }
  };

  // ── Data Import ──────────────────────────────────────────────────────────
  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Resize via Canvas to keep LocalStorage happy
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const max_dim = 300;
        
        if (width > height) {
          if (width > max_dim) {
            height = Math.round(height * (max_dim / width));
            width = max_dim;
          }
        } else {
          if (height > max_dim) {
            width = Math.round(width * (max_dim / height));
            height = max_dim;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setBusinessLogo(dataUrl);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup.version || !backup.customers || !backup.visits) {
        setDialog({ type: 'warning', title: 'Invalid Backup', message: 'This file does not appear to be a valid LawnPro backup.' });
        return;
      }

      setDialog({
        type: 'warning',
        title: 'Restore Backup?',
        message: `This will REPLACE all current data with:\n\n• ${backup.customers.length} customers\n• ${backup.visits.length} visits\n• ${backup.routes?.length || 0} routes\n\nYour current data will be permanently overwritten. Are you sure?`,
        confirmLabel: 'Restore',
        onConfirm: async () => {
          try {
            // Clear existing data
            await db.customers.clear();
            await db.visits.clear();
            await db.routes.clear();

            // Restore data
            if (backup.customers.length > 0) await db.customers.bulkAdd(backup.customers);
            if (backup.visits.length > 0) await db.visits.bulkAdd(backup.visits);
            if (backup.routes?.length > 0) await db.routes.bulkAdd(backup.routes);

            // Restore settings
            if (backup.settings) {
              saveSettings(backup.settings);
              const s = backup.settings;
              setTargetRate(s.targetHourlyRate?.toString() || '60');
              setUnderpaidRate(s.rateUnderpaidThreshold?.toString() || '45');
              setMinStopFee((s.minStopFee ?? 30).toString());
              setDrivebySecs((s.drivebyThresholdSecs || 45).toString());
              setCostOfGas((s.costOfGas || 3.50).toString());
              setTruckMpg((s.truckMpg || 7).toString());
              setMowerGph((s.mowerGph || 1.0).toString());
              setApplicatorName(s.applicatorName || '');
              setBusinessName(s.businessName || '');
              setBusinessAddress(s.businessAddress || '');
              setBusinessPhone(s.businessPhone || '');
              setBusinessEmail(s.businessEmail || '');
              setBusinessLogo(s.businessLogo || '');
              setLicenseNumber(s.licenseNumber || '');
              if (s.defaultServices) setDefaultServices(s.defaultServices);
              if (s.chemicalInventory) setChemicalInventory(s.chemicalInventory);
              if (s.addOnServices) setAddOnServices(s.addOnServices);
            }

            toast(`Successfully restored ${backup.customers.length} customers, ${backup.visits.length} visits, and ${backup.routes?.length || 0} routes.`);
          } catch (err) {
            setDialog({ type: 'warning', title: 'Restore Failed', message: err.message });
          }
        }
      });
    } catch (_err) {
      setDialog({ type: 'warning', title: 'Invalid File', message: 'Could not parse the backup file. Make sure it\'s a valid JSON file.' });
    }
  };

  // ── Default Service Templates ───────────────────────────────────────────
  const editDefaultService = (svc) => {
    setEditingServiceId(svc.id);
    setNewServiceName(svc.name);
    setNewServicePrice(svc.price.toString());
    setNewServiceCategory(svc.category || 'Other');
  };

  const saveDefaultService = () => {
    if (!newServiceName.trim()) return;
    const price = parseFloat(newServicePrice) || 0;
    const cat = newServiceCategory;
    setDefaultServices(prev => {
      let updated;
      if (editingServiceId) {
        updated = prev.map(s => s.id === editingServiceId ? { ...s, name: newServiceName.trim(), price, category: cat } : s);
      } else {
        updated = [...prev, { id: Date.now().toString(), name: newServiceName.trim(), price, active: false, category: cat }];
      }
      saveSettings({ defaultServices: updated });
      return updated;
    });
    setEditingServiceId(null);
    setNewServiceName('');
    setNewServicePrice('');
    setNewServiceCategory('Other');
  };

  const removeDefaultService = (id) => {
    setDefaultServices(prev => {
      const updated = prev.filter(s => s.id !== id);
      saveSettings({ defaultServices: updated });
      return updated;
    });
  };

  // ── Chemical Inventory ────────────────────────────────────────────────
  const editChemical = (chem) => {
    setEditingChemId(chem.id);
    setNewChemName(chem.name);
    setNewChemEpa(chem.epaRegNum || '');
    setNewChemTarget(chem.targetSite || '');
    setNewChemRate(chem.applicationRate || '');
    setNewChemNotices(chem.customerNotices || (chem.customerNotice ? [chem.customerNotice] : []));
    setNewChemCategory(chem.category || 'Fertilizer');
  };

  const saveChemical = () => {
    if (!newChemName.trim()) return;
    const chem = {
      id: editingChemId || Date.now().toString(),
      name: newChemName.trim(),
      epaRegNum: newChemEpa.trim(),
      targetSite: newChemTarget.trim(),
      applicationRate: newChemRate.trim(),
      customerNotices: newChemNotices.filter(n => n.trim() !== ''),
      category: newChemCategory || 'Other'
    };
    
    setChemicalInventory(prev => {
      let updated;
      if (editingChemId) {
        updated = prev.map(c => c.id === editingChemId ? chem : c);
      } else {
        updated = [...prev, chem];
      }
      saveSettings({ chemicalInventory: updated });
      return updated;
    });
    
    setEditingChemId(null);
    setNewChemName('');
    setNewChemEpa('');
    setNewChemTarget('');
    setNewChemRate('');
    setNewChemNotices([]);
    setNewChemCategory('Fertilizer');
  };

  // ── Add-On Services ───────────────────────────────────────────────────
  const editAddOn = (addon) => {
    setEditingAddOnId(addon.id);
    setNewAddOnName(addon.name);
    setNewAddOnPrice(addon.defaultPrice.toString());
    setNewAddOnCategory(addon.category || 'Maintenance');
  };

  const saveAddOn = () => {
    if (!newAddOnName.trim()) return;
    const price = parseFloat(newAddOnPrice) || 0;
    const cat = newAddOnCategory;
    setAddOnServices(prev => {
      let updated;
      if (editingAddOnId) {
        updated = prev.map(a => a.id === editingAddOnId ? { ...a, name: newAddOnName.trim(), defaultPrice: price, category: cat } : a);
      } else {
        updated = [...prev, { id: 'ao_' + Date.now(), name: newAddOnName.trim(), defaultPrice: price, category: cat }];
      }
      saveSettings({ addOnServices: updated });
      return updated;
    });
    setEditingAddOnId(null);
    setNewAddOnName('');
    setNewAddOnPrice('');
    setNewAddOnCategory('Maintenance');
  };

  const removeAddOn = (id) => {
    setAddOnServices(prev => {
      const updated = prev.filter(a => a.id !== id);
      saveSettings({ addOnServices: updated });
      return updated;
    });
  };

  const removeChemical = (id) => {
    setChemicalInventory(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveSettings({ chemicalInventory: updated });
      return updated;
    });
  };

  if (!settings) return null;

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '5rem' }}>
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <SettingsIcon size={24} color="var(--color-primary)" />
        <h1 className="page-title" style={{ margin: 0 }}>Settings</h1>
        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-main)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--color-border)', marginLeft: 'auto', fontWeight: 600 }}>v1.1.3</span>
      </div>

      <div className="tab-bar">
        <button className={`tab-button ${activeTab === 'pricing' ? 'active' : ''}`} onClick={() => setActiveTab('pricing')}>Pricing</button>
        <button className={`tab-button ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>General</button>
        <button className={`tab-button ${activeTab === 'fertilizer' ? 'active' : ''}`} onClick={() => setActiveTab('fertilizer')}>Fertilizer</button>
        <button className={`tab-button ${activeTab === 'data' ? 'active' : ''}`} onClick={() => setActiveTab('data')}>Data</button>
        <button className={`tab-button ${activeTab === 'changelog' ? 'active' : ''}`} onClick={() => setActiveTab('changelog')}>Changelog</button>
      </div>

      {/* ── DATA TAB ── */}
      {activeTab === 'data' && (
        <>
          {/* API Cost Tracker */}
      <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.2rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <MapIcon size={18} color="var(--color-primary)" /> Google API Cost Tracker
        </h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Estimated costs incurred today by using Maps and Geocoding APIs.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.8rem', marginBottom: '1rem' }}>
          <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Map Loads</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{todayStats?.mapLoads || 0}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}>${((todayStats?.mapLoads || 0) * API_PRICES.mapLoad).toFixed(3)}</div>
          </div>
          <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Geocodes</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{todayStats?.geocodes || 0}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}>${((todayStats?.geocodes || 0) * API_PRICES.geocode).toFixed(3)}</div>
          </div>
          <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Autofill</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{todayStats?.autocomplete || 0}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}>${((todayStats?.autocomplete || 0) * API_PRICES.autocomplete).toFixed(3)}</div>
          </div>
          <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Routing</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{todayStats?.distanceMatrix || 0}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}>${((todayStats?.distanceMatrix || 0) * API_PRICES.distanceMatrix).toFixed(3)}</div>
          </div>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16,185,129,0.1)', padding: '0.8rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(16,185,129,0.3)' }}>
          <span style={{ fontWeight: 600 }}>Today's Total Estimated Cost</span>
          <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-primary)' }}>
            ${(
              (todayStats?.mapLoads || 0) * API_PRICES.mapLoad +
              (todayStats?.geocodes || 0) * API_PRICES.geocode +
              (todayStats?.autocomplete || 0) * API_PRICES.autocomplete +
              (todayStats?.distanceMatrix || 0) * API_PRICES.distanceMatrix
            ).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Data Management */}
      <div className="glass-card" style={{ padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.3rem' }}>Data Management</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginBottom: '1.2rem' }}>
          Export your entire database as a backup file, or restore from a previous backup.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <button className="btn btn-primary" onClick={handleExport} style={{ width: '100%', justifyContent: 'center' }}>
            <Download size={18} /> Export Full Backup (JSON)
          </button>
          
          <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
          <button className="btn btn-secondary" onClick={() => importRef.current?.click()} style={{ width: '100%', justifyContent: 'center' }}>
            <Upload size={18} /> Import / Restore Backup
          </button>
        </div>

        <div style={{ marginTop: '1rem', padding: '0.7rem', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)' }}>
          <p style={{ fontSize: '0.75rem', color: '#ef4444', margin: 0 }}>
            ⚠️ Importing a backup will <strong>replace all current data</strong>. Make sure to export your current data first if you want to keep it.
          </p>
        </div>
      </div>
        </>
      )}

      {/* ── PRICING TAB ── */}
      {activeTab === 'pricing' && (
        <>
          {/* Rate Settings */}
      <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.2rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Fuel & Equipment</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Cost of Gas ($/gal)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }}>$</span>
              <input type="number" step="0.01" className="input-field" style={{ width: '100%', paddingLeft: '1.8rem' }} value={costOfGas} onChange={e => setCostOfGas(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Truck (MPG)</label>
            <input type="number" step="0.1" className="input-field" style={{ width: '100%' }} value={truckMpg} onChange={e => setTruckMpg(e.target.value)} />
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Mower (Gal/Hr)</label>
            <input type="number" step="0.1" className="input-field" style={{ width: '100%' }} value={mowerGph} onChange={e => setMowerGph(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Hourly Rate Thresholds</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
          Configure your target hourly rates. Jobs falling below the Underpaid threshold will be flagged in red in your History logs.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Target Hourly Rate ($/hr)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }}>$</span>
              <input
                type="number"
                className="input-field"
                style={{ width: '100%', paddingLeft: '1.8rem' }}
                value={targetRate}
                onChange={e => setTargetRate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Underpaid Threshold ($/hr)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }}>$</span>
              <input
                type="number"
                className="input-field"
                style={{ width: '100%', paddingLeft: '1.8rem' }}
                value={underpaidRate}
                onChange={e => setUnderpaidRate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Minimum Stop Fee ($)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }}>$</span>
              <input
                type="number"
                className="input-field"
                style={{ width: '100%', paddingLeft: '1.8rem' }}
                value={minStopFee}
                onChange={e => setMinStopFee(e.target.value)}
              />
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', marginTop: '0.4rem' }}>
              The absolute minimum price charged for any stop, regardless of size or time.
            </p>
          </div>
        </div>
      </div>

        {/* Default Service Templates */}
        <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.2rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.3rem' }}>Default Service Templates</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
            These services will be auto-applied when you create a new customer. Changes take effect on the next new customer you add.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
            {defaultServices.map(svc => (
              <div key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.7rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                <span style={{ flex: 1, fontSize: '0.9rem', fontWeight: 600 }}>
                  {svc.name}
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-text-main)', background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px', fontWeight: 500 }}>{svc.category || 'Other'}</span>
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)' }}>${svc.price}</span>
                <div style={{ display: 'flex', gap: '0.2rem' }}>
                  <button 
                    onClick={() => editDefaultService(svc)}
                    style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: '2px' }}
                  >
                    <Edit2 size={14} />
                  </button>
                  <button 
                    onClick={() => removeDefaultService(svc.id)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select
              className="input-field"
              value={newServiceCategory}
              onChange={e => setNewServiceCategory(e.target.value)}
              style={{ flex: '0 0 110px', padding: '0.4rem' }}
            >
              <option value="Mowing">Mowing</option>
              <option value="Fertilizer">Fertilizer</option>
              <option value="Other">Other</option>
            </select>
            <input
              type="text"
              className="input-field"
              placeholder="Service name"
              value={newServiceName}
              onChange={e => setNewServiceName(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              className="input-field"
              placeholder="$"
              value={newServicePrice}
              onChange={e => setNewServicePrice(e.target.value)}
              style={{ width: '60px' }}
            />
            <button className="btn btn-secondary" onClick={saveDefaultService} style={{ padding: '0.4rem 0.6rem' }}>
              {editingServiceId ? <Check size={16} /> : <Plus size={16} />}
            </button>
          </div>
        </div>

        {/* Add-On Services (Extras Menu) */}
        <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.2rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.3rem' }}>Add-On Services</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
            Quick-pick extras shown when completing a job. Use these for additional work performed during a visit (edging, weeding, debris removal, etc.).
          </p>

          {addOnServices.length === 0 && (
            <div style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
              No add-on services defined yet. Add your first one below.
            </div>
          )}

          {addOnServices.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
              {addOnServices.map(addon => (
                <div key={addon.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.7rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                  <span style={{ flex: 1, fontSize: '0.9rem', fontWeight: 600 }}>
                    {addon.name}
                    <span style={{ fontSize: '0.65rem', color: 'var(--color-text-main)', background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px', fontWeight: 500 }}>{addon.category || 'Maintenance'}</span>
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)' }}>${addon.defaultPrice}</span>
                  <div style={{ display: 'flex', gap: '0.2rem' }}>
                    <button 
                      onClick={() => editAddOn(addon)}
                      style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: '2px' }}
                    >
                      <Edit2 size={14} />
                    </button>
                    <button 
                      onClick={() => removeAddOn(addon.id)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select
              className="input-field"
              value={newAddOnCategory}
              onChange={e => setNewAddOnCategory(e.target.value)}
              style={{ flex: '0 0 120px', padding: '0.4rem' }}
            >
              <option value="Maintenance">Maintenance</option>
              <option value="Cleanup">Cleanup</option>
              <option value="Other">Other</option>
            </select>
            <input
              type="text"
              className="input-field"
              placeholder="Add-on name"
              value={newAddOnName}
              onChange={e => setNewAddOnName(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              className="input-field"
              placeholder="$"
              value={newAddOnPrice}
              onChange={e => setNewAddOnPrice(e.target.value)}
              style={{ width: '60px' }}
            />
            <button className="btn btn-secondary" onClick={saveAddOn} style={{ padding: '0.4rem 0.6rem' }}>
              {editingAddOnId ? <Check size={16} /> : <Plus size={16} />}
            </button>
          </div>
        </div>

        <button  
          className="btn btn-primary" 
          style={{ width: '100%', justifyContent: 'center', marginBottom: '1.2rem' }}
          onClick={handleSave}
        >
          <Save size={18} /> Save Pricing Settings
        </button>
        </>
      )}

      {/* ── GENERAL TAB ── */}
      {activeTab === 'general' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
        
        {/* Business Profile */}
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Business Profile</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            This information will be used to automatically generate professional letterheads on your official documents like EPA Logs.
          </p>
          
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8rem' }}>
              <div style={{ width: '100px', height: '100px', borderRadius: '8px', border: '2px dashed var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'var(--color-bg-main)' }}>
                {businessLogo ? (
                  <img src={businessLogo} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>No Logo</span>
                )}
              </div>
              <label className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                <Upload size={14} style={{ marginRight: '0.4rem' }}/> Upload Logo
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
              </label>
              {businessLogo && (
                <button onClick={() => setBusinessLogo('')} className="btn" style={{ padding: '0.4rem', fontSize: '0.75rem', color: '#ef4444', background: 'rgba(239,68,68,0.1)' }}>Remove</button>
              )}
            </div>

            <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Business Name</label>
                <input type="text" className="input-field" style={{ width: '100%' }} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Lawn Pros LLC" />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Address</label>
                <input type="text" className="input-field" style={{ width: '100%' }} value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} placeholder="e.g. 123 Main St, City, ST 12345" />
              </div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 140px' }}>
                  <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Phone</label>
                  <input type="text" className="input-field" style={{ width: '100%' }} value={businessPhone} onChange={e => setBusinessPhone(e.target.value)} placeholder="e.g. (555) 123-4567" />
                </div>
                <div style={{ flex: '1 1 140px' }}>
                  <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Email</label>
                  <input type="text" className="input-field" style={{ width: '100%' }} value={businessEmail} onChange={e => setBusinessEmail(e.target.value)} placeholder="e.g. info@lawnpros.com" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Auto-Tracking Preferences</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Drive-by Timer Threshold (Seconds)</label>
            <input
              type="number"
              className="input-field"
              style={{ width: '100%' }}
              value={drivebySecs}
              onChange={e => setDrivebySecs(e.target.value)}
            />
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', marginTop: '0.4rem' }}>
              If you leave a property's geofence in less than this amount of time, the app will ask if it was a drive-by rather than automatically logging it as a full job.
            </p>
          </div>

        </div>

        <button  
          className="btn btn-primary" 
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={handleSave}
        >
          <Save size={18} /> Save General Settings
        </button>
      </div>
      </div>
      )}

      {/* ── FERTILIZER TAB ── */}
      {activeTab === 'fertilizer' && (
        <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.2rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>EPA Compliance Defaults</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Default Applicator Name</label>
              <input
                type="text"
                className="input-field"
                style={{ width: '100%' }}
                value={applicatorName}
                onChange={e => setApplicatorName(e.target.value)}
                placeholder="e.g. John Doe"
              />
            </div>
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Applicator License Number</label>
              <input
                type="text"
                className="input-field"
                style={{ width: '100%' }}
                value={licenseNumber}
                onChange={e => setLicenseNumber(e.target.value)}
                placeholder="e.g. 123456-CA"
              />
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', marginTop: '0.4rem' }}>
                Auto-fills your name and license on all Official EPA Documents.
              </p>
            </div>
          </div>

          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--color-text-main)' }}>Chemical Inventory</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', marginBottom: '1rem' }}>
            Save your most used products here to instantly auto-fill EPA compliance logs in the field.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
            {chemicalInventory.map(chem => (
              <div key={chem.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '0.6rem 0.8rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-primary)' }}>{chem.name} <span style={{ fontSize: '0.7rem', color: 'var(--color-text-main)', background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px' }}>{chem.category || 'Other'}</span></div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
                    EPA: {chem.epaRegNum || 'N/A'} • Target: {chem.targetSite || 'N/A'} • Rate: {chem.applicationRate || 'N/A'}
                    {chem.customerNotices && chem.customerNotices.length > 0 ? (
                      <div style={{ marginTop: '0.2rem' }}>
                        Instructions:
                        <ul style={{ margin: '0.2rem 0 0 1rem', padding: 0 }}>
                          {chem.customerNotices.map((n, i) => <li key={i}>{n}</li>)}
                        </ul>
                      </div>
                    ) : chem.customerNotice ? (
                      <div style={{ marginTop: '0.2rem' }}>Notice: {chem.customerNotice}</div>
                    ) : null}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.2rem' }}>
                  <button 
                    onClick={() => editChemical(chem)}
                    style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: '4px' }}
                  >
                    <Edit2 size={16} />
                  </button>
                  <button 
                    onClick={() => removeChemical(chem.id)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {chemicalInventory.length === 0 && (
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '0.5rem' }}>No products saved yet.</div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--color-border)', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select className="input-field" value={newChemCategory} onChange={e => setNewChemCategory(e.target.value)} style={{ flex: '0 0 140px' }}>
                <option value="Fertilizer">Fertilizer</option>
                <option value="Weed Control">Weed Control</option>
                <option value="Pre-Emergent">Pre-Emergent</option>
                <option value="Fungicide">Fungicide</option>
                <option value="Insecticide">Insecticide</option>
                <option value="Other">Other</option>
              </select>
              <input type="text" className="input-field" placeholder="Product Name (e.g. Speedzone)" value={newChemName} onChange={e => setNewChemName(e.target.value)} style={{ flex: 1 }} />
              <input type="text" className="input-field" placeholder="EPA Reg #" value={newChemEpa} onChange={e => setNewChemEpa(e.target.value)} style={{ flex: 1 }} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input type="text" className="input-field" placeholder="Target Site (e.g. Turf)" value={newChemTarget} onChange={e => setNewChemTarget(e.target.value)} style={{ flex: 1 }} />
              <input type="text" className="input-field" placeholder="Rate (e.g. 1.5oz / 1000 sqft)" value={newChemRate} onChange={e => setNewChemRate(e.target.value)} style={{ flex: 1 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {newChemNotices.map((notice, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="text" className="input-field" placeholder="Instruction (e.g. Keep off until dry)" value={notice} onChange={e => {
                    const updated = [...newChemNotices];
                    updated[idx] = e.target.value;
                    setNewChemNotices(updated);
                  }} style={{ flex: 1 }} />
                  <button type="button" className="btn btn-secondary" onClick={() => setNewChemNotices(newChemNotices.filter((_, i) => i !== idx))} style={{ padding: '0.4rem 0.6rem', color: 'var(--color-danger)' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setNewChemNotices([...newChemNotices, ''])} style={{ flex: 1, padding: '0.4rem' }}>
                  <Plus size={16} style={{ marginRight: '0.4rem' }} /> Add Instruction
                </button>
                <button type="button" className="btn btn-secondary" onClick={saveChemical} style={{ padding: '0.4rem 0.8rem' }}>
                  {editingChemId ? <Check size={16} /> : <Plus size={16} />}
                </button>
              </div>
            </div>
          </div>

          <button  
            className="btn btn-primary" 
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={handleSave}
          >
            <Save size={18} /> Save Fertilizer Settings
          </button>
        </div>
      )}
    
      {/* ── CHANGELOG TAB ── */}
      {activeTab === 'changelog' && (
        <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.2rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} color="var(--color-primary)" /> Release Notes & Changelog
          </h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--color-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>v1.1.0</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-main)', padding: '2px 8px', borderRadius: '12px' }}>June 2026</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--color-text-main)', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <li><strong>Added global Visit Editing:</strong> You can now seamlessly edit visits right from the Customer Detail page.</li>
                <li><strong>Fixed Field Service Selection Trap:</strong> Edited jobs now properly retrieve custom or deleted services originally logged from the field.</li>
                <li><strong>Missing Info Warning:</strong> Added an amber "MISSING INFO" badge for clients quickly logged from the field with incomplete profiles.</li>
                <li><strong>Cleaned up interface:</strong> Removed the confusing 'quick-log' status entirely.</li>
                <li><strong>Improved live map interface:</strong> Restyled GPS status banner so it no longer obstructs map markers or bottom sheets.</li>
                <li><strong>Increased touch targets:</strong> Enhanced Pause and Done buttons on the route player for easier tapping while in the truck.</li>
              </ul>
            </div>
            
            <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--color-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>v1.0.0</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-main)', padding: '2px 8px', borderRadius: '12px' }}>Initial Release</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--color-text-muted)', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <li>Initial launch of Lawn Route Tracker.</li>
                <li>Dynamic route optimization and field tracking functionality.</li>
                <li>Integrated EPA compliance logs.</li>
                <li>Local-first architecture via Dexie.js for offline functionality.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
</div>
  );
}
