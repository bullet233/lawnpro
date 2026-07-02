import { useState, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Plus, ChevronRight, Upload, CheckCircle, AlertTriangle, Search, ArrowUpDown, Save, Users, Download, ExternalLink } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import AppDialog from '../components/AppDialog';
import { trackApiCall } from '../utils/apiTracker';
import { getDaysSince } from '../utils/dateUtils';
import { parseLawnSizeToSqFt } from '../utils/parseLawnSize';
import { getSettings } from '../db/settings';
import { classifyTreatment } from '../db/treatments';
import { useServiceMode } from '../components/ServiceProvider';

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Geocode an address into a small rectangular geofence. Retries with exponential
// backoff on OVER_QUERY_LIMIT so bulk imports don't silently lose later rows to throttling.
const geocodeAddress = (address, attempt = 0) => {
  return new Promise((resolve) => {
    if (!window.google?.maps) return resolve(null);
    const geocoder = new window.google.maps.Geocoder();
    trackApiCall('geocode');
    geocoder.geocode({ address }, async (results, status) => {
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
      } else if (status === 'OVER_QUERY_LIMIT' && attempt < 4) {
        // Back off (0.5s, 1s, 2s, 4s) and retry rather than dropping the address.
        await sleep(500 * Math.pow(2, attempt));
        resolve(await geocodeAddress(address, attempt + 1));
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
      fertilizer: get('fertilizer') || get('fert') || get('fertilizing') || '',
      mowing: get('mowing') || get('mow') || '',
    };
  });
};

export default function CustomersList() {
  const navigate = useNavigate();
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const allVisits  = useLiveQuery(() => db.visits.toArray(), []);
  const allTreatments = useLiveQuery(() => db.treatments.toArray(), []) || [];
  const fileRef = useRef(null);

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importResults, setImportResults] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name'); // name | lastVisit | revenue | overdue
  const [showInactive, setShowInactive] = useState(false);
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const { activeMode } = useServiceMode();
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'
  const [pendingEdits, setPendingEdits] = useState({}); // Local state for table edits
  const [tableSort, setTableSort] = useState({ col: 'name', dir: 'asc' }); // table-view column sort

  // Build per-customer visit stats
  const visitStats = useMemo(() => {
    if (!allVisits) return {};
    const stats = {};

    for (const v of allVisits) {
      if (v.status === 'skipped') continue;
      // Filter out visits that don't match the current division
      if (v.division && v.division !== activeMode) continue;
      
      if (!stats[v.customerId]) stats[v.customerId] = { count: 0, lastExit: 0, firstExit: Infinity, revenue: 0 };
      const s = stats[v.customerId];
      s.count++;
      s.revenue += (v.priceEarned || 0);
      if (v.exitTime > s.lastExit) s.lastExit = v.exitTime;
      if (v.exitTime < s.firstExit) s.firstExit = v.exitTime;
    }
    return stats;
  }, [allVisits, activeMode]);

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
    const now = Date.now();
    const settings = getSettings();
    const defaultServices = settings.defaultServices || [];
    const mowIds = defaultServices.filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);
    const fertIds = defaultServices.filter(s => s.category === 'Fertilizer' || s.id === 's3').map(s => s.id);
    // Category/id-based service matching (robust to oddly-named services), consistent
    // with the Dashboard and Analytics rather than fragile name-substring matching.
    const isMowingClient = (c) => (c.services || []).some(s => s.active && (s.category === 'Mowing' || s.id === 's1' || mowIds.includes(s.id)));
    const isFertClient = (c) => (c.services || []).some(s => s.active && (s.category === 'Fertilizer' || s.id === 's3' || fertIds.includes(s.id)));

    // For enrolled clients, the fertilizer-mode "overdue" comes from the treatment
    // program (so this page agrees with the Treatments page), not the naive interval.
    const treatStateByCust = {};
    if (activeMode === 'fertilizer') {
      allTreatments.forEach(t => {
        if (t.status !== 'scheduled' && t.status !== 'due') return;
        const st = classifyTreatment(t, now);
        if (st !== 'due' && st !== 'overdue') return;
        const cur = treatStateByCust[t.customerId];
        treatStateByCust[t.customerId] = st === 'overdue' ? 'overdue' : (cur === 'overdue' ? 'overdue' : 'due');
      });
    }

    let list = customers.map(c => {
      const stats = visitStats[c.id];

      let overdueLevel = 0; // 0=fine, 1=warning, 2=danger
      let maxOverdueDays = -999;
      let primaryDaysSince = null; // for display
      let dueText = null;

      // visitStats is already scoped to the active division, so lastExit is the
      // last visit in the current mode.
      const daysSinceVisit = stats?.lastExit ? getDaysSince(stats.lastExit) : null;
      if (activeMode === 'mowing') {
        const mInt = c.mowingInterval || c.serviceInterval || 7;
        if (daysSinceVisit !== null) {
          if (daysSinceVisit > mInt + 3) overdueLevel = 2;
          else if (daysSinceVisit >= mInt) overdueLevel = 1;
          maxOverdueDays = daysSinceVisit - mInt;
          primaryDaysSince = daysSinceVisit;
          if (overdueLevel === 2) dueText = `${daysSinceVisit}d overdue`;
          else if (overdueLevel === 1) dueText = `${daysSinceVisit}d ago`;
        }
      } else if (activeMode === 'fertilizer') {
        if (c.treatmentProgramId) {
          const st = treatStateByCust[c.id];
          if (st === 'overdue') { overdueLevel = 2; maxOverdueDays = 999; dueText = 'Treatment overdue'; }
          else if (st === 'due') { overdueLevel = 1; maxOverdueDays = 1; dueText = 'Treatment due'; }
        } else {
          const fInt = c.fertilizerInterval || 30;
          if (daysSinceVisit !== null) {
            if (daysSinceVisit > fInt + 7) overdueLevel = 2;
            else if (daysSinceVisit >= fInt) overdueLevel = 1;
            maxOverdueDays = daysSinceVisit - fInt;
            primaryDaysSince = daysSinceVisit;
            if (overdueLevel === 2) dueText = `${daysSinceVisit}d overdue`;
            else if (overdueLevel === 1) dueText = `${daysSinceVisit}d ago`;
          }
        }
      }

      const isOutlier = outlierCustomers.has(c.id);
      const missingAddress = !c.address || c.address === 'Added from field';
      const missingLawn = !c.lawnSize;
      const needsAttention = isOutlier || missingAddress || missingLawn;

      return { ...c, stats, daysSince: primaryDaysSince, overdueLevel, maxOverdueDays, dueText,
        intervalDays: c.mowingInterval || c.serviceInterval || 7, isOutlier, needsAttention };
    });

    // Filter by active/inactive
    if (!showInactive) {
      list = list.filter(c => c.status !== 'inactive');
    }

    // Filter by Service Type (category-based)
    list = list.filter(activeMode === 'fertilizer' ? isFertClient : isMowingClient);

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
  }, [customers, visitStats, searchQuery, sortBy, showInactive, activeMode, outlierCustomers, allTreatments]);

  // "Needs Attention" = missing address / missing lawn size / bad GPS. Counted from
  // the mode-filtered list, then optionally used to narrow what's shown.
  const attentionCount = filteredCustomers.filter(c => c.needsAttention).length;
  const displayed = needsAttentionOnly ? filteredCustomers.filter(c => c.needsAttention) : filteredCustomers;

  // Table view: independent click-to-sort on columns (leaves the card sort untouched).
  const priceOfCust = (c) => {
    const mow = c.services?.find(s => s.id === 's1')?.price ?? c.price ?? 0;
    const fert = c.services?.find(s => s.id === 's3')?.price ?? 0;
    return activeMode === 'fertilizer' ? fert : mow;
  };
  const tableRows = useMemo(() => {
    const rows = [...displayed];
    const dir = tableSort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      switch (tableSort.col) {
        case 'phone': return dir * (a.phone || '').localeCompare(b.phone || '');
        case 'size': return dir * ((parseLawnSizeToSqFt(a.lawnSize) || 0) - (parseLawnSizeToSqFt(b.lawnSize) || 0));
        case 'price': return dir * (priceOfCust(a) - priceOfCust(b));
        case 'last': return dir * ((a.stats?.lastExit || 0) - (b.stats?.lastExit || 0));
        default: return dir * (a.name || '').localeCompare(b.name || '');
      }
    });
    return rows;
  }, [displayed, tableSort, activeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTableSort = (col) => {
    setTableSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  };
  // Enter jumps to the same column in the next row (spreadsheet-style entry).
  const focusNextRow = (e, rowIndex, col) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = document.querySelector(`[data-cell="${rowIndex + 1}-${col}"]`);
      if (next) next.focus();
    }
  };

  const handleToggleStatus = async (e, custId, currentStatus) => {
    e.preventDefault();
    e.stopPropagation();
    const newStatus = currentStatus === 'inactive' ? 'active' : 'inactive';
    await db.customers.update(custId, { status: newStatus });
  };

  const handleToggleFertilizer = async (e, c) => {
    e.preventDefault();
    e.stopPropagation();
    const newServices = JSON.parse(JSON.stringify(c.services || DEFAULT_SERVICES));
    const fertIdx = newServices.findIndex(s => s.id === 's3');
    
    if (fertIdx >= 0) {
      newServices[fertIdx].active = !newServices[fertIdx].active;
    } else {
      newServices.push({ id: 's3', name: 'Fertilizer', price: 75, active: true });
    }
    
    await db.customers.update(c.id, { services: newServices });
  };

  const handleToggleMowing = async (e, c) => {
    e.preventDefault();
    e.stopPropagation();
    const newServices = JSON.parse(JSON.stringify(c.services || DEFAULT_SERVICES));
    const idx = newServices.findIndex(s => s.id === 's1');
    if (idx >= 0) newServices[idx].active = !newServices[idx].active;
    else newServices.push({ id: 's1', name: 'Mowing', price: 50, active: true });
    await db.customers.update(c.id, { services: newServices });
  };

  const handleDownloadTemplate = () => {
    const header = "Name,Address,Phone,Email,LawnSize,Mowing,Fertilizer\n";
    const example = "John Doe,123 Main St Austin TX,555-0199,john@example.com,5000,no,yes\n";
    const blob = new Blob([header + example], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Customer_Import_Template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
      
      if (!row.name || !row.address) {
        warnings.push(`Row ${i+2}: Missing Name or Address (Skipped)`);
        continue;
      }

      setImportProgress(`Geocoding ${i + 1} of ${rows.length}: ${row.name}...`);

      const isDupe = existing.some(c =>
        c.address?.toLowerCase().trim() === row.address.toLowerCase().trim()
      );

      if (isDupe) {
        skipped.push(row.name);
        continue;
      }

      const geofence = await geocodeAddress(row.address);
      // Throttle between geocode calls to stay under the Geocoder's rate limit.
      await sleep(150);

      if (!geofence) warnings.push(`${row.name}: Address not found on map`);
      if (!row.lawnSize) warnings.push(`${row.name}: Missing lawn size`);

      const isFertilizer = row.fertilizer && ['yes', 'y', 'true', 'on', '1'].includes(row.fertilizer.toLowerCase());
      
      // Mowing is active by default unless explicitly turned off in the CSV
      let isMowing = true;
      if (row.mowing && ['no', 'n', 'false', 'off', '0'].includes(row.mowing.toLowerCase())) {
        isMowing = false;
      } else if (row.mowing && ['yes', 'y', 'true', 'on', '1'].includes(row.mowing.toLowerCase())) {
        isMowing = true;
      }

      const rowServices = DEFAULT_SERVICES.map(s => {
        if (s.id === 's1') return { ...s, active: isMowing };
        if (s.id === 's3' && isFertilizer) return { ...s, active: true };
        return s;
      });

      await db.customers.add({
        name: row.name,
        address: row.address,
        phone: row.phone,
        email: row.email,
        lawnSize: row.lawnSize,
        geofence: geofence || null,
        services: rowServices,
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
                    
                    if (edits.price !== undefined || edits.fertPrice !== undefined) {
                      const newServices = JSON.parse(JSON.stringify(c.services || DEFAULT_SERVICES));
                      
                      if (edits.price !== undefined) {
                        const idx = newServices.findIndex(s => s.id === 's1');
                        if (idx >= 0) newServices[idx].price = Number(edits.price);
                        else newServices.push({ id: 's1', name: 'Mowing', price: Number(edits.price), active: true });
                      }
                      
                      if (edits.fertPrice !== undefined) {
                        const fertIdx = newServices.findIndex(s => s.id === 's3');
                        if (fertIdx >= 0) newServices[fertIdx].price = Number(edits.fertPrice);
                        else newServices.push({ id: 's3', name: 'Fertilizer', price: Number(edits.fertPrice), active: true });
                      }
                      
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
          <button className="btn btn-secondary" onClick={handleDownloadTemplate} title="Download CSV Template">
            <Download size={16} /> Template
          </button>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Import
          </button>
          <button className="btn btn-primary" onClick={() => navigate(activeMode === 'fertilizer' ? '/customers/new?service=s3' : '/customers/new')}>
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
        {(attentionCount > 0 || needsAttentionOnly) && (
          <button
            onClick={() => setNeedsAttentionOnly(!needsAttentionOnly)}
            style={{
              padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 600,
              borderRadius: '999px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
              border: needsAttentionOnly ? '1px solid #f59e0b' : '1px solid var(--color-border)',
              background: needsAttentionOnly ? 'rgba(245,158,11,0.12)' : 'var(--color-bg-main)',
              color: needsAttentionOnly ? '#b45309' : 'var(--color-text-muted)'
            }}
          >
            <AlertTriangle size={13} /> {needsAttentionOnly ? 'Needs attention' : `${attentionCount} need attention`}
          </button>
        )}
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
        {displayed.length === 0 && (
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
              <button className="btn btn-primary" onClick={() => navigate(activeMode === 'fertilizer' ? '/customers/new?service=s3' : '/customers/new')}>
                <Plus size={18} /> Add Customer
              </button>
            )}
          </div>
        )}
        
        {viewMode === 'cards' ? (
          displayed.map(c => {
            const isInactive = c.status === 'inactive';
            let borderColor = 'var(--color-border)';
            let overduePill = null;
            if (c.overdueLevel === 2) {
              borderColor = 'rgba(239,68,68,0.5)';
              overduePill = <span className="pill-tag danger">🔴 {c.dueText}</span>;
            } else if (c.overdueLevel === 1) {
              borderColor = 'rgba(245,158,11,0.4)';
              overduePill = <span className="pill-tag warning">🟡 {c.dueText}</span>;
            }

            return (
              <Link key={c.id} to={`/customers/${c.id}`} style={{ textDecoration: 'none' }}>
                <div className="card" style={{ 
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                  borderLeft: `4px solid ${borderColor}`,
                  opacity: isInactive ? 0.6 : 1,
                  padding: '0.8rem 1rem',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flex: 1, minWidth: 0, paddingRight: '0.5rem' }}>
                    <Avatar name={c.name} />
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem', overflowX: 'auto', scrollbarWidth: 'none', whiteSpace: 'nowrap' }}>
                        <h3 style={{ margin: 0, color: 'var(--color-text-main)', fontSize: '1.05rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</h3>
                        {isInactive && <span className="pill-tag neutral" style={{ flexShrink: 0 }}>INACTIVE</span>}
                        {overduePill && <span style={{ flexShrink: 0 }}>{overduePill}</span>}
                        {c.isOutlier && <span className="pill-tag danger" style={{ flexShrink: 0 }}><AlertTriangle size={12} /> BAD GPS</span>}
                        {(!c.address || c.address === 'Added from field') && <span className="pill-tag warning" style={{ flexShrink: 0 }}><AlertTriangle size={12} /> MISSING ADDRESS</span>}
                        {!c.lawnSize && <span className="pill-tag warning" style={{ flexShrink: 0 }}><AlertTriangle size={12} /> MISSING LAWN SIZE</span>}
                      </div>
                      <p style={{ margin: '0 0 0.4rem 0', color: 'var(--color-text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.address}</p>
                      
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', paddingBottom: '2px' }}>
                        {c.mowableSqFt ? (
                          <span className="pill-tag success" style={{ whiteSpace: 'nowrap', flexShrink: 0 }} title={`Measured on satellite${c.perimeterFt ? ` · ${Number(c.perimeterFt).toLocaleString()} ft edging` : ''}`}>📐 Measured</span>
                        ) : null}
                        {c.stats && c.stats.count > 0 ? (
                          <>
                            <span className="pill-tag neutral" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{c.stats.count} visit{c.stats.count !== 1 ? 's' : ''}</span>
                            <span className="pill-tag success" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>${c.stats.revenue.toFixed(0)} earned</span>
                            <span className="pill-tag neutral" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>Last: {new Date(c.stats.lastExit).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                          </>
                        ) : (
                          <span className="pill-tag neutral">No visits yet</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                    <button
                      onClick={(e) => handleToggleFertilizer(e, c)}
                      className="btn"
                      style={{ 
                        padding: '0.4rem 0.8rem', fontSize: '0.75rem', fontWeight: 700, zIndex: 2,
                        background: c.services?.find(s => s.id === 's3')?.active ? 'rgba(16,185,129,0.1)' : 'transparent',
                        color: c.services?.find(s => s.id === 's3')?.active ? 'var(--color-primary)' : 'var(--color-text-muted)',
                        border: c.services?.find(s => s.id === 's3')?.active ? '1px solid var(--color-primary)' : '1px solid var(--color-border)'
                      }}
                    >
                      FERT
                    </button>
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
        ) : (() => {
          const thBase = { padding: '0.7rem 0.8rem', fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 3, background: 'var(--color-bg-main)', borderBottom: '1px solid var(--color-border)' };
          const arrow = (col) => tableSort.col === col ? (tableSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
          // Plain function (not a component) so headers don't remount on every edit.
          const sortTh = (label, col, sticky) => (
            <th key={col} onClick={() => handleTableSort(col)}
              style={{ ...thBase, cursor: 'pointer', userSelect: 'none', ...(sticky ? { left: 0, zIndex: 4 } : {}) }}>
              {label}{arrow(col)}
            </th>
          );
          return (
          <div style={{ background: 'var(--color-bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflowX: 'auto', boxShadow: 'var(--shadow-sm)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '860px' }}>
              <thead>
                <tr>
                  {sortTh('Name', 'name', true)}
                  {sortTh('Phone', 'phone')}
                  <th style={thBase}>Address</th>
                  {sortTh('Lawn Size (sqft)', 'size')}
                  {sortTh(activeMode === 'fertilizer' ? 'Fert Price' : 'Mowing Price', 'price')}
                  <th style={{ ...thBase, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((c, i) => {
                  const isMowMode = activeMode === 'mowing';
                  const targetDbPrice = priceOfCust(c);
                  const pending = pendingEdits[c.id] || {};
                  const currentName = pending.name !== undefined ? pending.name : c.name;
                  const currentPhone = pending.phone !== undefined ? pending.phone : c.phone;
                  const currentAddress = pending.address !== undefined ? pending.address : c.address;
                  const currentLawnSize = pending.lawnSize !== undefined ? pending.lawnSize : c.lawnSize;
                  const currentPrice = pending[isMowMode ? 'price' : 'fertPrice'] !== undefined ? pending[isMowMode ? 'price' : 'fertPrice'] : targetDbPrice;
                  const edited = !!pendingEdits[c.id];
                  const isInactive = c.status === 'inactive';
                  const fertActive = c.services?.find(s => s.id === 's3')?.active;
                  const mowActive = c.services?.find(s => s.id === 's1')?.active;
                  // Mode-aware toggle: adds/removes the client from the OTHER division.
                  const otherLabel = isMowMode ? 'Fert' : 'Mow';
                  const otherActive = isMowMode ? fertActive : mowActive;
                  const toggleOther = isMowMode ? handleToggleFertilizer : handleToggleMowing;
                  const statusColor = c.overdueLevel === 2 ? '#ef4444' : c.overdueLevel === 1 ? '#f59e0b' : null;
                  const nameBorder = edited ? 'var(--color-primary)' : c.isOutlier ? '#ef4444' : 'transparent';

                  const handleEdit = (field, val) => {
                    setPendingEdits(prev => ({ ...prev, [c.id]: { ...(prev[c.id] || {}), [field]: val } }));
                  };
                  const cellInput = { width: '100%', padding: '0.4rem', border: 'none', background: 'transparent', color: 'var(--color-text-main)' };

                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)', background: edited ? 'rgba(16,185,129,0.06)' : c.isOutlier ? 'rgba(239,68,68,0.05)' : 'transparent', opacity: isInactive ? 0.55 : 1 }}>
                      {/* Name (sticky) */}
                      <td style={{ padding: '0.4rem', borderRight: '1px solid var(--color-border)', borderLeft: `3px solid ${nameBorder}`, position: 'sticky', left: 0, zIndex: 1, background: 'var(--color-bg-card)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {statusColor && <span title={c.dueText || ''} style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColor, flexShrink: 0 }} />}
                          <input value={currentName ?? ''} data-cell={`${i}-name`} onKeyDown={e => focusNextRow(e, i, 'name')}
                            onChange={e => handleEdit('name', e.target.value)}
                            style={{ ...cellInput, fontWeight: 600 }} />
                          {c.isOutlier && <AlertTriangle size={15} color="#ef4444" title="Bad GPS Pin" style={{ flexShrink: 0 }} />}
                          <button onClick={() => navigate(`/customers/${c.id}`)} title="Open customer profile"
                            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0.2rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                            <ExternalLink size={14} />
                          </button>
                        </div>
                      </td>
                      {/* Phone */}
                      <td style={{ padding: '0.4rem', borderRight: '1px solid var(--color-border)' }}>
                        <input value={currentPhone ?? ''} placeholder="—" data-cell={`${i}-phone`} onKeyDown={e => focusNextRow(e, i, 'phone')}
                          onChange={e => handleEdit('phone', e.target.value)} style={cellInput} />
                      </td>
                      {/* Address */}
                      <td style={{ padding: '0.4rem', borderRight: '1px solid var(--color-border)', background: !currentAddress ? 'rgba(239,68,68,0.1)' : 'transparent' }}>
                        <input value={currentAddress ?? ''} placeholder="Missing Address" data-cell={`${i}-address`} onKeyDown={e => focusNextRow(e, i, 'address')}
                          onChange={e => handleEdit('address', e.target.value)} style={cellInput} />
                      </td>
                      {/* Lawn Size + measured marker */}
                      <td style={{ padding: '0.4rem', borderRight: '1px solid var(--color-border)', background: !currentLawnSize ? 'rgba(245,158,11,0.1)' : 'transparent' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <input value={currentLawnSize ?? ''} placeholder="e.g. 5000" data-cell={`${i}-size`} onKeyDown={e => focusNextRow(e, i, 'size')}
                            onChange={e => handleEdit('lawnSize', e.target.value)} style={cellInput} />
                          {c.mowableSqFt ? <span title={`Measured on satellite${c.perimeterFt ? ` · ${Number(c.perimeterFt).toLocaleString()} ft edging` : ''}`} style={{ flexShrink: 0, fontSize: '0.9rem' }}>📐</span> : null}
                        </div>
                      </td>
                      {/* Price */}
                      <td style={{ padding: '0.4rem', borderRight: '1px solid var(--color-border)', background: (currentPrice === 0 || currentPrice === '') ? 'rgba(245,158,11,0.1)' : 'transparent' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ color: 'var(--color-text-muted)', paddingLeft: '0.4rem', fontWeight: 600 }}>$</span>
                          <input type="number" value={currentPrice ?? ''} data-cell={`${i}-price`} onKeyDown={e => focusNextRow(e, i, 'price')}
                            onChange={e => handleEdit(isMowMode ? 'price' : 'fertPrice', e.target.value)} style={{ ...cellInput, fontWeight: 600 }} />
                        </div>
                      </td>
                      {/* Actions */}
                      <td style={{ padding: '0.4rem 0.6rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.4rem' }}>
                          <button onClick={(e) => toggleOther(e, c)} title={`Add to ${isMowMode ? 'fertilizer' : 'mowing'} division`}
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.68rem', fontWeight: 700, borderRadius: 'var(--radius-sm)', cursor: 'pointer', whiteSpace: 'nowrap',
                              background: otherActive ? 'rgba(16,185,129,0.1)' : 'transparent',
                              color: otherActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                              border: `1px solid ${otherActive ? 'var(--color-primary)' : 'var(--color-border)'}` }}>
                            {otherActive ? otherLabel : `+ ${otherLabel}`}
                          </button>
                          <button onClick={(e) => handleToggleStatus(e, c.id, c.status)} title={isInactive ? 'Activate' : 'Pause'}
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.68rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)' }}>
                            {isInactive ? 'On' : 'Pause'}
                          </button>
                          <button onClick={() => navigate(`/customers/${c.id}`)} title="Open profile"
                            style={{ display: 'flex', alignItems: 'center', padding: '0.2rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                            <ChevronRight size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
