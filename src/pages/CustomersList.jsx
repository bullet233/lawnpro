import { useState, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Plus, ChevronRight, Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import AppDialog from '../components/AppDialog';

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

  // Build per-customer visit stats
  const visitStats = useMemo(() => {
    if (!allVisits) return {};
    const stats = {};
    for (const v of allVisits) {
      if (v.status === 'skipped') continue;
      if (!stats[v.customerId]) stats[v.customerId] = { count: 0, lastExit: 0 };
      stats[v.customerId].count++;
      if (v.exitTime > stats[v.customerId].lastExit) stats[v.customerId].lastExit = v.exitTime;
    }
    return stats;
  }, [allVisits]);

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

      await db.customers.add({
        name: row.name,
        address: row.address,
        phone: row.phone,
        email: row.email,
        lawnSize: row.lawnSize,
        geofence: geofence || null,
        services: DEFAULT_SERVICES,
      });
      added.push(row.name);
    }

    setImporting(false);
    setImportProgress('');
    setImportResults({ added, skipped });
  };

  return (
    <div className="animate-fade-in">
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
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={() => setImportResults(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.8rem', flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Clients</h1>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Import CSV
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/customers/new')}>
            <Plus size={18} /> New
          </button>
        </div>
      </div>

      {/* CSV Format Hint */}
      <div className="glass-card" style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <Upload size={13} style={{ flexShrink: 0 }} />
        <span>CSV columns: <strong>Name, Address, Phone, Email, Lawn Size</strong> — headers required on row 1.</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {customers?.length === 0 && (
          <div className="glass-card" style={{ textAlign: 'center', padding: '2rem' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>No clients yet. Add one manually or import a CSV above.</p>
          </div>
        )}
        
        {customers?.map(c => {
          const stats = visitStats[c.id];
          return (
            <Link key={c.id} to={`/customers/${c.id}`} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                <div>
                  <h3 style={{ margin: '0 0 0.2rem 0', color: 'var(--color-text-main)', fontSize: '1.1rem' }}>{c.name}</h3>
                  <p style={{ margin: '0 0 0.3rem 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{c.address}</p>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {stats
                      ? <>{stats.count} visit{stats.count !== 1 ? 's' : ''} · Last: {new Date(stats.lastExit).toLocaleDateString()}</>
                      : 'No visits yet'
                    }
                  </p>
                </div>
                <ChevronRight color="var(--color-text-muted)" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
