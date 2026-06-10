import { useState, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Plus, ChevronRight, Upload, CheckCircle, AlertTriangle, Search, ArrowUpDown, Save, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import AppDialog from '../components/AppDialog';
import { trackApiCall } from '../utils/apiTracker';
import { getDaysSince } from '../utils/dateUtils';

// Avatar Helper Component
function Avatar({ name }) {
  const initials = (name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = (name || '').charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return (
    <div style={{
      width: '44px', height: '44px', borderRadius: '50%',
      background: `hsl(${hue}, 60%, 90%)`, color: `hsl(${hue}, 70%, 30%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: '1.1rem', flexShrink: 0,
      border: `1px solid hsl(${hue}, 60%, 80%)`,
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
    }}>
      {initials}
    </div>
  );
}

const DEFAULT_SERVICES = [
  { id: 's1', name: 'Mowing', price: 50, active: true },
  { id: 's2', name: 'Edging/Trimming', price: 15, active: false },
  { id: 's3', name: 'Fertilizer', price: 75, active: false },
  { id: 's4', name: 'Fall Clean-up', price: 150, active: false }
];

const geocodeAddress = (address) => {
  return new Promise((resolve) => {
    if (!window.google?.maps) return resolve(null);
    const geocoder = new window.google.maps.Geocoder();
    trackApiCall('geocode');
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results[0]?.geometry?.location) {
        const lat = results[0].geometry.location.lat();
        const lng = results[0].geometry.location.lng();
        const latOffset = 0.00018;
        const lngOffset = 0.00028;
        resolve([
          { lat: lat + latOffset, lng: lng - lngOffset },
          { lat: lat + latOffset, lng: lng + lngOffset },
          { lat: lat - latOffset, lng: lng + lngOffset },
          { lat: lat - latOffset, lng: lng - lngOffset },
        ]);
      } else {
        resolve(null);
      }
    });
  });
};

const parseCSV = (text) => {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  return lines.slice(1).map(line => {
    const cols = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    const get = (key) => cols[headers.indexOf(key)] || '';
    return {
      name: get('name'),
      address: get('address'),
      phone: get('phone'),
      email: get('email'),
      lawnSize: get('lawnsize') || get('lawn') || get('lawnarea') || '',
    };
  }).filter(r => r.name && r.address);
};

export default function CustomersList() {
  const navigate = useNavigate();
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const allVisits  = useLiveQuery(() => db.visits.toArray(), []);
  const fileRef = useRef(null);

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importResults, setImportResults] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name'); // name | lastVisit | revenue | overdue
  const [showInactive, setShowInactive] = useState(false);
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'
  const [pendingEdits, setPendingEdits] = useState({}); // Local state for table edits

  // Build per-customer visit stats
  const visitStats = useMemo(() => {
    if (!allVisits) return {};
    const stats = {};
    for (const v of allVisits) {
      if (v.status === 'skipped') continue;
      if (!stats[v.customerId]) stats[v.customerId] = { count: 0, lastExit: 0, lastMow: 0, lastFert: 0, firstExit: Infinity, revenue: 0 };
      const s = stats[v.customerId];
      s.count++;
      s.revenue += (v.priceEarned || 0);
      if (v.exitTime > s.lastExit) s.lastExit = v.exitTime;
      if (v.exitTime < s.firstExit) s.firstExit = v.exitTime;
      
      const isMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.includes('s1') || v.appliedServices.some(sv => typeof sv === 'string' && sv.toLowerCase().includes('mow'));
      const isFert = v.appliedServices && v.appliedServices.includes('s3');
      
      if (isMow && v.exitTime > s.lastMow) s.lastMow = v.exitTime;
      if (isFert && v.exitTime > s.lastFert) s.lastFert = v.exitTime;
    }
    return stats;
  }, [allVisits]);

  // Find outliers (>50 miles from average)
  const outlierCustomers = useMemo(() => {
    if (!customers || customers.length < 3) return new Set();
    const centers = customers
      .filter(c => c.geofence && c.geofence.length > 0)
      .map(c => {
        const lat = c.geofence.reduce((s, p) => s + p.lat, 0) / c.geofence.length;
        const lng = c.geofence.reduce((s, p) => s + p.lng, 0) / c.geofence.length;
        return { id: c.id, lat, lng };
      });
      
    if (centers.length < 3) return new Set();
    const avgLat = centers.reduce((s, c) => s + c.lat, 0) / centers.length;
    const avgLng = centers.reduce((s, c) => s + c.lng, 0) / centers.length;

    const outliers = new Set();
    const R = 3958.8; // miles
    const d2r = Math.PI / 180;
    
    centers.forEach(c => {
      const dLat = (c.lat - avgLat) * d2r;
      const dLng = (c.lng - avgLng) * d2r;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(avgLat * d2r) * Math.cos(c.lat * d2r) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      if (dist > 50) outliers.add(c.id);
    });
    return outliers;
  }, [customers]);

  // Filter, sort, and compute overdue
  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    let list = customers.map(c => {
      const stats = visitStats[c.id];
      const now = Date.now();
      
      const isMowCust = !c.services || c.services.find(s => s.id === 's1')?.active;
      const isFertCust = c.services && c.services.find(s => s.id === 's3')?.active;
      
      let overdueLevel = 0;
      let maxOverdueDays = -999;
      let primaryDaysSince = null; // for display

      if (isMowCust) {
        const mInt = c.mowingInterval || c.serviceInterval || 7;
        const daysSinceMow = stats?.lastMow ? getDaysSince(stats.lastMow) : null;
        if (daysSinceMow !== null) {
          if (daysSinceMow > mInt + 3) overdueLevel = Math.max(overdueLevel, 2);
          else if (daysSinceMow >= mInt) overdueLevel = Math.max(overdueLevel, 1);
          maxOverdueDays = Math.max(maxOverdueDays, daysSinceMow - mInt);
          primaryDaysSince = daysSinceMow;
        }
      }
      if (isFertCust) {
        const fInt = c.fertilizerInterval || 30;
        const daysSinceFert = stats?.lastFert ? getDaysSince(stats.lastFert) : null;
        if (daysSinceFert !== null) {
          if (daysSinceFert > fInt + 7) overdueLevel = Math.max(overdueLevel, 2);
          else if (daysSinceFert >= fInt) overdueLevel = Math.max(overdueLevel, 1);
          maxOverdueDays = Math.max(maxOverdueDays, daysSinceFert - fInt);
          if (primaryDaysSince === null) primaryDaysSince = daysSinceFert;
        }
      }
      if (!isMowCust && !isFertCust) {
        const mInt = c.serviceInterval || 7;
        const daysSince = stats?.lastExit ? getDaysSince(stats.lastExit) : null;
        if (daysSince !== null) {
          if (daysSince > mInt + 7) overdueLevel = 2;
          else if (daysSince >= mInt) overdueLevel = 1;
          maxOverdueDays = daysSince - mInt;
          primaryDaysSince = daysSince;
        }
      }

      return { ...c, stats, daysSince: primaryDaysSince, overdueLevel, maxOverdueDays, intervalDays: c.mowingInterval || c.serviceInterval || 7, isOutlier: outlierCustomers.has(c.id) };
    });

    // Filter by active/inactive
    if (!showInactive) {
      list = list.filter(c => c.status !== 'inactive');
    }

    // Search filter
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      list = list.filter(c => 
        c.name.toLowerCase().includes(q) || 
        (c.address || '').toLowerCase().includes(q)
      );
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'lastVisit') return (b.stats?.lastExit || 0) - (a.stats?.lastExit || 0);
      if (sortBy === 'revenue') return (b.stats?.revenue || 0) - (a.stats?.revenue || 0);
      if (sortBy === 'overdue') return (b.maxOverdueDays || 0) - (a.maxOverdueDays || 0);
      return 0;
    });

    // Bubble outliers to the very top regardless of sort
    list.sort((a, b) => {
      if (a.isOutlier && !b.isOutlier) return -1;
      if (!a.isOutlier && b.isOutlier) return 1;
      return 0;
    });

    return list;
  }, [customers, visitStats, searchQuery, sortBy, showInactive, outlierCustomers]);

  const handleToggleStatus = async (e, custId, currentStatus) => {
    e.preventDefault();
    e.stopPropagation();
    const newStatus = currentStatus === 'inactive' ? 'active' : 'inactive';
    await db.customers.update(custId, { status: newStatus });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    setImporting(true);
    setImportProgress('Reading file...');

    const text = await file.text();
    const rows = parseCSV(text);

    if (rows.length === 0) {
      setDialog({ type: 'warning', title: 'Invalid CSV', message: 'No valid rows found. Make sure your CSV has Name and Address columns as headers on row 1.' });
      setImporting(false);
      return;
    }

    const existing = await db.customers.toArray();
    const added = [];
    const skipped = [];
    const warnings = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setImportProgress(`Geocoding ${i + 1} of ${rows.length}: ${row.name}...`);

      const isDupe = existing.some(c =>
        c.name?.toLowerCase().trim() === row.name.toLowerCase().trim() &&
        c.address?.toLowerCase().trim() === row.address.toLowerCase().trim()
      );

      if (isDupe) {
        skipped.push(row.name);
        continue;
      }

      const geofence = await geocodeAddress(row.address);
      
      if (!geofence) warnings.push(`${row.name}: Address not found on map`);
      if (!row.lawnSize) warnings.push(`${row.name}: Missing lawn size`);

      await db.customers.add({
        name: row.name,
        address: row.address,
        phone: row.phone,
        email: row.email,
        lawnSize: row.lawnSize,
        geofence: geofence || null,
        services: DEFAULT_SERVICES,
        createdAt: Date.now(),
      });
      added.push(row.name);
    }

    setImporting(false);
    setImportProgress('');
    setImportResults({ added, skipped, warnings });
  };

  const inactiveCount = customers?.filter(c => c.status === 'inactive').length || 0;

  return (
    <div className="animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '2rem' }}>
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      {/* Import Loading Overlay */}
      {importing && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
            <h3 style={{ margin: '0 0 0.5rem 0' }}>Importing Customers...</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{importProgress}</p>
          </div>
        </div>
      )}

      {/* Import Results Modal */}
      {importResults && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ margin: '0 0 1.5rem 0' }}>Import Complete</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary)' }}>
                <CheckCircle size={20} />
                <strong>{importResults.added.length} customer{importResults.added.length !== 1 ? 's' : ''} added successfully</strong>
              </div>
              {importResults.skipped.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b', marginBottom: '0.5rem' }}>
                    <AlertTriangle size={20} />
                    <strong>{importResults.skipped.length} skipped — already exist</strong>
                  </div>
                  <div style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', padding: '0.8rem', maxHeight: '140px', overflowY: 'auto', border: '1px solid var(--color-border)' }}>
                    {importResults.skipped.map((name, i) => (
                      <div key={i} style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', padding: '2px 0' }}>• {name}</div>
                    ))}
                  </div>
                </div>
              )}
              {importResults.warnings && importResults.warnings.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#d97706', marginBottom: '0.5rem' }}>
                    <AlertTriangle size={20} />
                    <strong>{importResults.warnings.length} warning{importResults.warnings.length !== 1 ? 's' : ''} (added anyway)</strong>
                  </div>
                  <div style={{ background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', padding: '0.8rem', maxHeight: '140px', overflowY: 'auto', border: '1px solid var(--color-border)' }}>
                    {importResults.warnings.map((msg, i) => (
                      <div key={i} style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', padding: '2px 0' }}>• {msg}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={() => setImportResults(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.8rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>Clients</h1>
          {viewMode === 'table' && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {Object.keys(pendingEdits).length > 0 && (
                <button className="btn btn-secondary" onClick={() => setPendingEdits({})} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                  Discard
                </button>
              )}
              <button 
                className="btn btn-primary" 
                disabled={Object.keys(pendingEdits).length === 0}
                style={{ 
                  padding: '0.4rem 0.8rem', fontSize: '0.85rem', 
                  opacity: Object.keys(pendingEdits).length === 0 ? 0.5 : 1,
                  background: Object.keys(pendingEdits).length > 0 ? 'var(--color-primary)' : 'var(--color-border)',
                  color: Object.keys(pendingEdits).length > 0 ? '#fff' : 'var(--color-text-muted)'
                }}
                onClick={async () => {
                  const btn = document.activeElement;
                  if (btn) btn.blur(); // dismiss keyboard on mobile

                  for (const [custIdStr, edits] of Object.entries(pendingEdits)) {
                    const custIdNum = Number(custIdStr);
                    const c = customers.find(c => c.id === custIdNum);
                    if (!c) continue;
                    
                    const updates = {};
                    if (edits.name !== undefined) updates.name = edits.name;
                    if (edits.address !== undefined) updates.address = edits.address;
                    if (edits.lawnSize !== undefined) updates.lawnSize = edits.lawnSize;
                    
                    if (edits.price !== undefined) {
                      const newServices = [...(c.services || DEFAULT_SERVICES)];
                      const idx = newServices.findIndex(s => s.id === 's1');
                      if (idx >= 0) newServices[idx].price = Number(edits.price);
                      else newServices.push({ id: 's1', name: 'Mowing', price: Number(edits.price), active: true });
                      updates.services = newServices;
                    }
                    
                    await db.customers.update(custIdNum, updates);
                    if (edits.address !== undefined) {
                       const geo = await geocodeAddress(edits.address);
                       if (geo) await db.customers.update(custIdNum, { geofence: geo });
                    }
                  }
                  setPendingEdits({});
                }}
              >
                <Save size={14} style={{ marginRight: '4px' }} /> 
                {Object.keys(pendingEdits).length > 0 ? `Save ${Object.keys(pendingEdits).length}` : 'Save'}
              </button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button className="btn btn-secondary" onClick={() => setViewMode(viewMode === 'cards' ? 'table' : 'cards')}>
            {viewMode === 'cards' ? 'Table View' : 'Card View'}
          </button>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> CSV
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/customers/new')}>
            <Plus size={18} /> New
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ position: 'relative', marginBottom: '1rem' }}>
        <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
        <input
          type="text"
          className="input-field"
          placeholder="Search by name or address..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ width: '100%', paddingLeft: '2.8rem', paddingRight: '1rem', fontSize: '1rem', height: '3rem' }}
        />
      </div>

      {/* Sort + Filter Controls */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {['name', 'lastVisit', 'revenue', 'overdue'].map(s => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            style={{
              padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 600,
              borderRadius: '999px', cursor: 'pointer', transition: 'all 0.15s',
              border: sortBy === s ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
              background: sortBy === s ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-main)',
              color: sortBy === s ? 'var(--color-primary)' : 'var(--color-text-main)'
            }}
          >
            {s === 'name' && 'A-Z'}
            {s === 'lastVisit' && 'Recent'}
            {s === 'revenue' && 'Revenue'}
            {s === 'overdue' && 'Overdue'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {inactiveCount > 0 && (
          <button
            onClick={() => setShowInactive(!showInactive)}
            style={{
              padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 600,
              borderRadius: '999px', cursor: 'pointer',
              border: showInactive ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
              background: showInactive ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-main)',
              color: showInactive ? 'var(--color-primary)' : 'var(--color-text-muted)'
            }}
          >
            {showInactive ? `Showing ${inactiveCount} inactive` : `${inactiveCount} hidden`}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '2rem' }}>
        {filteredCustomers.length === 0 && (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(16,185,129,0.05)', color: 'var(--color-primary)', marginBottom: '1.5rem', border: '1px solid rgba(16,185,129,0.1)' }}>
              <Users size={32} />
            </div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--color-text-main)' }}>
              {searchQuery ? 'No clients found' : 'Your roster is empty'}
            </h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem', maxWidth: '320px', margin: '0 auto 1.5rem', lineHeight: 1.6 }}>
              {searchQuery ? 'Try adjusting your search terms or filters.' : 'Add your first customer manually or import a CSV roster to get started building your route.'}
            </p>
            {!searchQuery && (
              <button className="btn btn-primary" onClick={() => navigate('/customers/new')}>
                <Plus size={18} /> Add Customer
              </button>
            )}
          </div>
        )}
        
        {viewMode === 'cards' ? (
          filteredCustomers.map(c => {
            const isInactive = c.status === 'inactive';
            let borderColor = 'var(--color-border)';
            let overduePill = null;
            if (c.overdueLevel === 2) {
              borderColor = 'rgba(239,68,68,0.5)';
              overduePill = <span className="pill-tag danger">🔴 {c.daysSince}d overdue</span>;
            } else if (c.overdueLevel === 1) {
              borderColor = 'rgba(245,158,11,0.4)';
              overduePill = <span className="pill-tag warning">🟡 {c.daysSince}d ago</span>;
            }

            return (
              <Link key={c.id} to={`/customers/${c.id}`} style={{ textDecoration: 'none' }}>
                <div className="card" style={{ 
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                  borderLeft: `4px solid ${borderColor}`,
                  opacity: isInactive ? 0.6 : 1,
                  padding: '1.2rem',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: 0, paddingRight: '1rem' }}>
                    <Avatar name={c.name} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                        <h3 style={{ margin: 0, color: 'var(--color-text-main)', fontSize: '1.15rem', fontWeight: 800 }}>{c.name}</h3>
                        {isInactive && <span className="pill-tag neutral">INACTIVE</span>}
                        {overduePill}
                        {c.isOutlier && <span className="pill-tag danger"><AlertTriangle size={12} /> BAD GPS</span>}
                      </div>
                      <p style={{ margin: '0 0 0.5rem 0', color: 'var(--color-text-muted)', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.address}</p>
                      
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {c.stats && c.stats.count > 0 ? (
                          <>
                            <span className="pill-tag neutral">{c.stats.count} visit{c.stats.count !== 1 ? 's' : ''}</span>
                            <span className="pill-tag success">${c.stats.revenue.toFixed(0)} earned</span>
                            <span className="pill-tag neutral">Last: {new Date(c.stats.lastExit).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                          </>
                        ) : (
                          <span className="pill-tag neutral">No visits yet</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                    <button
                      onClick={(e) => handleToggleStatus(e, c.id, c.status)}
                      className={`btn ${isInactive ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 600, zIndex: 2 }}
                    >
                      {isInactive ? 'Activate' : 'Pause'}
                    </button>
                    <ChevronRight size={20} color="var(--color-text-muted)" />
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <div style={{ background: 'var(--color-bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflowX: 'auto', boxShadow: 'var(--shadow-sm)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-main)', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '0.8rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Name</th>
                  <th style={{ padding: '0.8rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Address</th>
                  <th style={{ padding: '0.8rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Lawn Size (sqft)</th>
                  <th style={{ padding: '0.8rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Mowing Price</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map(c => {
                  const mowService = c.services?.find(s => s.id === 's1');
                  const dbPrice = mowService?.price || 0;
                  
                  const pending = pendingEdits[c.id] || {};
                  const currentName = pending.name !== undefined ? pending.name : c.name;
                  const currentAddress = pending.address !== undefined ? pending.address : c.address;
                  const currentLawnSize = pending.lawnSize !== undefined ? pending.lawnSize : c.lawnSize;
                  const currentPrice = pending.price !== undefined ? pending.price : dbPrice;

                  const handleEdit = (field, val) => {
                    setPendingEdits(prev => ({
                      ...prev,
                      [c.id]: {
                        ...(prev[c.id] || {}),
                        [field]: val
                      }
                    }));
                  };

                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)', background: c.isOutlier ? 'rgba(239,68,68,0.05)' : pendingEdits[c.id] ? 'rgba(16,185,129,0.05)' : 'transparent' }}>
                      <td style={{ padding: '0.4rem', borderRight: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input 
                            value={currentName ?? ''} 
                            onChange={e => handleEdit('name', e.target.value)}
                            style={{ width: '100%', padding: '0.4rem', border: 'none', background: 'transparent', fontWeight: 600, color: 'var(--color-text-main)' }}
                          />
                          {c.isOutlier && <AlertTriangle size={16} color="#ef4444" title="Bad GPS Pin" style={{ flexShrink: 0, marginRight: '0.4rem' }} />}
                        </div>
                      </td>
                      <td style={{ padding: '0.4rem', borderRight: '1px solid var(--color-border)', background: !currentAddress ? 'rgba(239,68,68,0.1)' : 'transparent' }}>
                        <input 
                          value={currentAddress ?? ''} 
                          placeholder="Missing Address"
                          onChange={e => handleEdit('address', e.target.value)}
                          style={{ width: '100%', padding: '0.4rem', border: 'none', background: 'transparent', color: 'var(--color-text-main)' }}
                        />
                      </td>
                      <td style={{ padding: '0.4rem', borderRight: '1px solid var(--color-border)', background: !currentLawnSize ? 'rgba(245,158,11,0.1)' : 'transparent' }}>
                        <input 
                          value={currentLawnSize ?? ''} 
                          placeholder="e.g. 5000"
                          onChange={e => handleEdit('lawnSize', e.target.value)}
                          style={{ width: '100%', padding: '0.4rem', border: 'none', background: 'transparent', color: 'var(--color-text-main)' }}
                        />
                      </td>
                      <td style={{ padding: '0.4rem', background: currentPrice === 0 || currentPrice === '' ? 'rgba(245,158,11,0.1)' : 'transparent' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ color: 'var(--color-text-muted)', paddingLeft: '0.4rem', fontWeight: 600 }}>$</span>
                          <input 
                            type="number"
                            value={currentPrice ?? ''} 
                            onChange={e => handleEdit('price', e.target.value)}
                            style={{ width: '100%', padding: '0.4rem', border: 'none', background: 'transparent', color: 'var(--color-text-main)', fontWeight: 600 }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
