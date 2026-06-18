import { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { getSettings } from '../db/settings';
import { parseLawnSizeToSqFt, calculateTieredMatrix } from '../utils/matrix';
import { trackApiCall } from '../utils/apiTracker';
import { GOOGLE_MAPS_API_KEY } from '../components/MapProvider';
import { TrendingUp, Calculator, AlertCircle, Fuel, DollarSign, ArrowUp, ArrowDown, Edit2, Save, X, MapPin } from 'lucide-react';
import { Autocomplete } from '@react-google-maps/api';

// Haversine distance helper
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 3958.8; // Radius of the Earth in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in miles
};

// ── Pure SVG Scatter Plot ─────────────────────────────────────────────────────
function ScatterPlot({ data, width = 340, height = 280 }) {
  const pad = { top: 20, right: 20, bottom: 45, left: 50 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const [tooltip, setTooltip] = useState(null);

  if (data.length === 0) return null;

  const maxX = Math.max(...data.map(d => d.sqft)) * 1.1;
  const maxY = Math.max(...data.map(d => d.mins)) * 1.15;
  const minX = 0;
  const minY = 0;

  const scaleX = (v) => pad.left + ((v - minX) / (maxX - minX)) * w;
  const scaleY = (v) => pad.top + h - ((v - minY) / (maxY - minY)) * h;

  // Trend line (simple linear regression)
  const n = data.length;
  const sumX = data.reduce((s, d) => s + d.sqft, 0);
  const sumY = data.reduce((s, d) => s + d.mins, 0);
  const sumXY = data.reduce((s, d) => s + d.sqft * d.mins, 0);
  const sumX2 = data.reduce((s, d) => s + d.sqft * d.sqft, 0);
  // Guard against a zero denominator (fewer than 2 distinct sqft values),
  // which would otherwise produce a NaN slope and a broken trend line.
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const trendX1 = 0;
  const trendX2 = maxX;
  const trendY1 = slope * trendX1 + intercept;
  const trendY2 = slope * trendX2 + intercept;

  // X-axis ticks
  const xTicks = [];
  const xStep = Math.max(1000, Math.ceil(maxX / 12 / 1000) * 1000);
  for (let t = 0; t <= maxX; t += xStep) xTicks.push(t);

  // Y-axis ticks
  const yTicks = [];
  const yStep = Math.max(5, Math.ceil(maxY / 10 / 5) * 5);
  for (let t = 0; t <= maxY; t += yStep) yTicks.push(t);

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: width }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }} onClick={() => setTooltip(null)}>
        {/* Grid lines */}
        {xTicks.map(t => (
          <line key={`gx-${t}`} x1={scaleX(t)} x2={scaleX(t)} y1={pad.top} y2={pad.top + h}
            stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />
        ))}
        {yTicks.map(t => (
          <line key={`gy-${t}`} x1={pad.left} x2={pad.left + w} y1={scaleY(t)} y2={scaleY(t)}
            stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />
        ))}

        {/* Axes */}
        <line x1={pad.left} x2={pad.left + w} y1={pad.top + h} y2={pad.top + h} stroke="var(--color-border)" strokeWidth="1" />
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + h} stroke="var(--color-border)" strokeWidth="1" />

        {/* X-axis labels */}
        {xTicks.map(t => (
          <text key={`xl-${t}`} x={scaleX(t)} y={pad.top + h + 16} textAnchor="middle"
            fill="var(--color-text-muted)" fontSize="10">
            {t >= 1000 ? `${(t / 1000).toFixed(0)}k` : t}
          </text>
        ))}
        <text x={pad.left + w / 2} y={height - 4} textAnchor="middle" fill="var(--color-text-muted)" fontSize="11">
          Square Feet
        </text>

        {/* Y-axis labels */}
        {yTicks.map(t => (
          <text key={`yl-${t}`} x={pad.left - 8} y={scaleY(t) + 3} textAnchor="end"
            fill="var(--color-text-muted)" fontSize="10">
            {t}
          </text>
        ))}
        <text x={14} y={pad.top + h / 2} textAnchor="middle" fill="var(--color-text-muted)" fontSize="11"
          transform={`rotate(-90, 14, ${pad.top + h / 2})`}>
          Minutes
        </text>

        {/* Trend line */}
        {n >= 2 && (
          <line
            x1={scaleX(trendX1)} y1={scaleY(Math.max(0, trendY1))}
            x2={scaleX(trendX2)} y2={scaleY(Math.max(0, trendY2))}
            stroke="var(--color-primary)" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.5"
          />
        )}

        {/* Data dots */}
        {data.map((d, i) => (
          <circle
            key={i}
            cx={scaleX(d.sqft)}
            cy={scaleY(d.mins)}
            r="8"
            fill="var(--color-primary)"
            opacity="0.7"
            stroke="var(--color-bg-card)"
            strokeWidth="1.5"
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              setTooltip(tooltip?.name === d.name ? null : { ...d, x: scaleX(d.sqft), y: scaleY(d.mins) });
            }}
          />
        ))}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: `${(tooltip.x / width) * 100}%`,
          top: `${(tooltip.y / height) * 100 - 12}%`,
          transform: 'translate(-50%, -100%)',
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.5rem 0.7rem',
          fontSize: '0.8rem',
          pointerEvents: 'none',
          zIndex: 10,
          whiteSpace: 'nowrap',
          boxShadow: 'var(--shadow-md)'
        }}>
          <strong style={{ color: 'var(--color-primary)' }}>{tooltip.name}</strong><br />
          {tooltip.sqft.toLocaleString()} sq ft · {tooltip.mins} min avg
        </div>
      )}
    </div>
  );
}

// ── Pure SVG Line Chart ───────────────────────────────────────────────────────
function LineChart({ data, averagePace = 0, width = 340, height = 250 }) {
  const pad = { top: 20, right: 20, bottom: 45, left: 50 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  if (data.length === 0) return null;

  const minX = data[0].date.getTime();
  const maxX = data[data.length - 1].date.getTime();
  const xSpan = maxX === minX ? 86400000 : (maxX - minX); // 1 day fallback

  const maxY = Math.max(...data.map(d => d.pace), averagePace) * 1.15;
  const minY = 0;

  const scaleX = (v) => pad.left + ((v - minX) / xSpan) * w;
  const scaleY = (v) => pad.top + h - ((v - minY) / (maxY - minY)) * h;

  // Smoothing: 3-point moving average
  const smoothedData = data.map((d, i) => {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(data.length - 1, i + 1); j++) {
      sum += data[j].pace;
      count++;
    }
    return { ...d, smoothedPace: sum / count };
  });

  const rawPoints = data.map(d => `${scaleX(d.date.getTime())},${scaleY(d.pace)}`).join(' ');
  const smoothedPoints = smoothedData.map(d => `${scaleX(d.date.getTime())},${scaleY(d.smoothedPace)}`).join(' ');
  const fillPoints = `${scaleX(smoothedData[0].date.getTime())},${scaleY(minY)} ${smoothedPoints} ${scaleX(smoothedData[smoothedData.length-1].date.getTime())},${scaleY(minY)}`;

  // X ticks: Evenly spaced to avoid overlap
  const xTicks = [];
  if (maxX > minX) {
     xTicks.push(minX);
     if (maxX - minX > 86400000) {
        xTicks.push(minX + (maxX - minX) / 2);
     }
     xTicks.push(maxX);
  } else {
     xTicks.push(minX);
  }

  const yTicks = [];
  const yStep = Math.max(50, Math.ceil(maxY / 5 / 50) * 50);
  for (let t = 0; t <= maxY; t += yStep) yTicks.push(t);

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: width }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
        {/* Grid lines */}
        {yTicks.map(t => (
          <line key={`gy-${t}`} x1={pad.left} x2={pad.left + w} y1={scaleY(t)} y2={scaleY(t)}
            stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />
        ))}

        {/* Baseline (Historical Average) */}
        {averagePace > 0 && (
           <line x1={pad.left} x2={pad.left + w} y1={scaleY(averagePace)} y2={scaleY(averagePace)} 
              stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4,4" opacity="0.6" />
        )}
        {averagePace > 0 && (
           <text x={pad.left + w - 5} y={scaleY(averagePace) - 5} textAnchor="end" fill="#ef4444" fontSize="9" opacity="0.8">Target Pace</text>
        )}

        {/* Axes */}
        <line x1={pad.left} x2={pad.left + w} y1={pad.top + h} y2={pad.top + h} stroke="var(--color-border)" strokeWidth="1" />
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + h} stroke="var(--color-border)" strokeWidth="1" />

        {/* Raw Points faint background line */}
        <polyline points={rawPoints} fill="none" stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="2,2" opacity="0.4" />

        {/* Smoothed Line */}
        <polyline points={smoothedPoints} fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinejoin="round" />

        {/* Raw Data points (Faint) */}
        {data.map((d, i) => (
           <circle key={`pt-${i}`} cx={scaleX(d.date.getTime())} cy={scaleY(d.pace)} r="3" fill="var(--color-text-muted)" opacity="0.4" />
        ))}

        {/* Smoothed Data points (Bold) */}
        {smoothedData.map((d, i) => (
           <circle key={`spt-${i}`} cx={scaleX(d.date.getTime())} cy={scaleY(d.smoothedPace)} r="4" fill="var(--color-primary)" />
        ))}

        {/* Y Axis labels */}
        {yTicks.map(t => (
          <text key={`yl-${t}`} x={pad.left - 8} y={scaleY(t) + 3} textAnchor="end" fill="var(--color-text-muted)" fontSize="10">{t}</text>
        ))}
        <text x={14} y={pad.top + h / 2} textAnchor="middle" fill="var(--color-text-muted)" fontSize="11" transform={`rotate(-90, 14, ${pad.top + h / 2})`}>
          Sq Ft / Min
        </text>

        {/* X Axis labels */}
        {xTicks.map((t, i) => {
           const align = i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle";
           return (
             <text key={`xl-${i}`} x={scaleX(t)} y={pad.top + h + 16} textAnchor={align} fill="var(--color-text-muted)" fontSize="10">
                {new Date(t).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
             </text>
           )
        })}
      </svg>
    </div>
  );
}

function BucketHistoryModal({ bucket, minSqft, allVisits, allCustomers, onClose, width }) {
  const data = useMemo(() => {
    const custMap = new Map();
    allCustomers.forEach(c => {
       const sqft = parseLawnSizeToSqFt(c.lawnSize);
       if (sqft > minSqft && sqft <= bucket.maxSqft) {
          custMap.set(c.id, sqft);
       }
    });

    const bucketVisits = allVisits.filter(v => 
       v.status === 'completed' && 
       v.durationSecs >= 60 && 
       custMap.has(v.customerId)
    );

    bucketVisits.sort((a, b) => a.exitTime - b.exitTime);

    return bucketVisits.map(v => {
       const sqft = custMap.get(v.customerId);
       const pace = Math.round(sqft / (v.durationSecs / 60));
       return { date: new Date(v.exitTime), pace };
    });
  }, [bucket, minSqft, allVisits, allCustomers]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', padding: '1rem' }} onClick={onClose}>
       <div className="glass-card animate-scale-up" style={{ width: '100%', maxWidth: '500px', padding: '1.5rem', position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button className="btn-icon" onClick={onClose} style={{ position: 'absolute', top: '10px', right: '10px' }}><X size={20} /></button>
          
          <h3 style={{ margin: '0 0 0.5rem 0' }}>{bucket.label} History</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
             Pace history for lawns between {minSqft.toLocaleString()} and {bucket.maxSqft === Infinity ? 'Infinity' : bucket.maxSqft.toLocaleString()} sq ft.
          </p>

          {data.length > 0 ? (
             <div style={{ display: 'flex', justifyContent: 'center' }}>
               <LineChart data={data} averagePace={bucket.pace} width={width > 500 ? 450 : width - 60} height={260} />
             </div>
          ) : (
             <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No historical visits found for this size bucket.
             </div>
          )}
       </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Analytics() {
  const allVisitsRaw = useLiveQuery(() => db.visits.toArray(), []) || [];
  const allCustomersRaw = useLiveQuery(() => db.customers.toArray(), []) || [];
  
  const { allVisits, allCustomers } = useMemo(() => {
    const custs = allCustomersRaw.filter(c => !c.excludeFromAnalytics);
    const validIds = new Set(custs.map(c => c.id));
    const visits = allVisitsRaw.filter(v => validIds.has(v.customerId));
    return { allCustomers: custs, allVisits: visits };
  }, [allVisitsRaw, allCustomersRaw]);
  const allFuelLogs = useLiveQuery(() => db.fuelLogs.toArray(), []) || [];
  const [activeTab, setActiveTab] = useState('overview'); // overview, bidding, expenses
  const [settings, setSettings] = useState(null);
  const [targetSqFt, setTargetSqFt] = useState('');
  const [targetAddress, setTargetAddress] = useState('');
  const [targetObstacles, setTargetObstacles] = useState('');
  const [targetTerrain, setTargetTerrain] = useState('flat');
  const [targetFenced, setTargetFenced] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [bidResult, setBidResult] = useState(null);
  const [autocomplete, setAutocomplete] = useState(null);
  const [selectedBucket, setSelectedBucket] = useState(null);
  const containerRef = useRef(null);
  const [chartWidth, setChartWidth] = useState(340);
  
  const [editingFuelLogDate, setEditingFuelLogDate] = useState(null);
  const [editingFuelMiles, setEditingFuelMiles] = useState('');
  const [editingFuelGasCost, setEditingFuelGasCost] = useState('');

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const w = entries[0].contentRect.width - 32; // minus padding
        setChartWidth(Math.max(250, w));
      }
    });
    
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 1. Prepare data for scatter plot
  const scatterData = useMemo(() => {
    if (allVisits.length === 0 || allCustomers.length === 0) return [];

    const settings = getSettings();
    const defaultServices = settings.defaultServices || [];
    const mowingServiceIds = defaultServices.filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);

    const customerAverages = {};
    allVisits.forEach(v => {
      if (v.status !== 'completed' || !v.durationSecs) return;
      
      const isMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => mowingServiceIds.includes(id));
      if (!isMow) return;

      if (!customerAverages[v.customerId]) {
        customerAverages[v.customerId] = { totalSecs: 0, count: 0 };
      }
      customerAverages[v.customerId].totalSecs += v.durationSecs;
      customerAverages[v.customerId].count += 1;
    });

    const dataPoints = [];
    allCustomers.forEach(cust => {
      const avg = customerAverages[cust.id];
      if (!avg) return;
      const sqft = parseLawnSizeToSqFt(cust.lawnSize);
      if (!sqft) return;
      const avgMins = Math.round((avg.totalSecs / avg.count) / 60);
      dataPoints.push({ 
        name: cust.name, sqft, mins: avgMins, 
        obstacles: cust.obstacleCount || 0, 
        terrain: cust.terrain || 'flat',
        fenced: cust.fencedBackyard || false 
      });
    });

    return dataPoints.sort((a, b) => a.sqft - b.sqft);
  }, [allVisits, allCustomers]);

  // 1.5 Calculate Pace Metrics (Sq Ft / Min)
  const paceMetrics = useMemo(() => {
    if (allVisits.length === 0 || allCustomers.length === 0) return null;

    const settings = getSettings();
    const defaultServices = settings.defaultServices || [];
    const mowingServiceIds = defaultServices.filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);

    const getPaceForVisits = (visits) => {
      let totalSecs = 0;
      let totalSqFt = 0;
      visits.forEach(v => {
        if (v.status !== 'completed' || !v.durationSecs || v.durationSecs < 60) return;
        const isMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => mowingServiceIds.includes(id));
        if (!isMow) return;
        const cust = allCustomers.find(c => c.id === v.customerId);
        if (!cust) return;
        const sqft = parseLawnSizeToSqFt(cust.lawnSize);
        if (!sqft) return;
        totalSecs += v.durationSecs;
        totalSqFt += sqft;
      });
      if (totalSecs === 0) return 0;
      return Math.round(totalSqFt / (totalSecs / 60)); // sq ft per min
    };

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000;

    const allTimePace = getPaceForVisits(allVisits);
    const recentPace = getPaceForVisits(allVisits.filter(v => v.exitTime >= thirtyDaysAgo));
    const previousPace = getPaceForVisits(allVisits.filter(v => v.exitTime >= sixtyDaysAgo && v.exitTime < thirtyDaysAgo));

    return { allTimePace, recentPace, previousPace };
  }, [allVisits, allCustomers]);

  // 1.6 Tiered Matrix Math (Beta)
  const tieredMatrixData = useMemo(() => calculateTieredMatrix(allVisits, allCustomers), [allVisits, allCustomers]);

  const targetSizes = [...Array(44).keys()].map(i => (i + 1) * 1000); // 1k to 44k

  const groupedBuckets = useMemo(() => {
    if (!tieredMatrixData) return [];
    const groups = [];
    let currentLabel = null;
    let currentGroup = null;
    const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316'];

    targetSizes.forEach(sqft => {
      const bucket = tieredMatrixData.find(b => sqft <= b.maxSqft) || tieredMatrixData[tieredMatrixData.length - 1];
      if (bucket.label !== currentLabel) {
         currentLabel = bucket.label;
         const color = colors[groups.length % colors.length];
         const bucketIndex = tieredMatrixData.findIndex(b => b.label === bucket.label);
         const minSqft = bucketIndex > 0 ? tieredMatrixData[bucketIndex - 1].maxSqft : 0;
         currentGroup = { bucket, label: bucket.label, pace: bucket.pace, rawHasData: bucket.rawHasData, minSqft, color, rows: [] };
         groups.push(currentGroup);
      }
      currentGroup.rows.push(sqft);
    });
    return groups;
  }, [tieredMatrixData]);

  // Autocomplete Handlers
  const onAutocompleteLoad = (autoC) => {
    setAutocomplete(autoC);
  };

  const onPlaceChanged = () => {
    if (autocomplete !== null) {
      trackApiCall('autocomplete');
      const place = autocomplete.getPlace();
      if (place.formatted_address) {
        setTargetAddress(place.formatted_address);
      } else if (place.name) {
        setTargetAddress(place.name);
      }
    }
  };

  // 2. Calculator Logic (Matrix Powered)
  const handleCalculateBid = async () => {
    if (!settings || !tieredMatrixData) return;

    const parsedTarget = parseLawnSizeToSqFt(targetSqFt);
    if (!parsedTarget) {
      alert("Please enter a valid size (e.g. 5000 or 0.25 acres)");
      return;
    }

    setIsCalculating(true);

    try {
      // Find the right bucket
      const bucket = tieredMatrixData.find(b => parsedTarget <= b.maxSqft) || tieredMatrixData[tieredMatrixData.length - 1];
      let baseMins = parsedTarget / bucket.pace;

      const obstacles = parseInt(targetObstacles, 10) || 0;
      let difficultyMins = 0;
      
      // Apply Difficulty Modifiers
      if (targetTerrain === 'moderate') difficultyMins += (baseMins * 0.15);
      else if (targetTerrain === 'hilly') difficultyMins += (baseMins * 0.3);
      
      if (targetFenced) difficultyMins += 3;
      if (obstacles > 0) difficultyMins += (obstacles * 1.5);
      


      let driveMins = 0;
      const parts = [`Uses ${bucket.label} bucket (${Math.round(bucket.pace)} sqft/m).`];
      if (obstacles > 0) parts.push(`+${Math.round(obstacles * 1.5)} min for obstacles.`);
      if (targetTerrain !== 'flat') parts.push(`+${targetTerrain === 'moderate' ? '15%' : '30%'} terrain penalty.`);
      if (targetFenced) parts.push(`+3 min fenced yard penalty.`);
      // Removed setup buffer push

      // --- Drive Time Logic ---
      if (targetAddress && window.google && window.google.maps) {
        const geocodeAsync = (address) => new Promise((resolve, reject) => {
          new window.google.maps.Geocoder().geocode({ address }, (results, status) => {
            if (status === 'OK') resolve({ results });
            else reject(new Error('Geocode failed: ' + status));
          });
        });

        const distanceMatrixAsync = (origins, destinations) => new Promise((resolve, reject) => {
          new window.google.maps.DistanceMatrixService().getDistanceMatrix({
            origins,
            destinations,
            travelMode: 'DRIVING'
          }, (response, status) => {
            if (status === 'OK') resolve(response);
            else reject(new Error('Distance Matrix failed: ' + status));
          });
        });

        try {
          // 1. Geocode target address
          const geoRes = await geocodeAsync(targetAddress);
          trackApiCall('geocode');

          if (geoRes.results && geoRes.results.length > 0) {
            const loc = geoRes.results[0].geometry.location;
            const targetLoc = { lat: loc.lat(), lng: loc.lng() };

            // 2. Find closest customer using Haversine
            let closestCustomer = null;
            let minDistance = Infinity;

            allCustomers.forEach(c => {
              if (c.status === 'inactive' || !c.geofence || c.geofence.length === 0) return;
              const cLat = c.geofence[0].lat;
              const cLng = c.geofence[0].lng;
              const dist = haversineDistance(targetLoc.lat, targetLoc.lng, cLat, cLng);
              if (dist < minDistance) {
                minDistance = dist;
                closestCustomer = { ...c, lat: cLat, lng: cLng };
              }
            });

            // 3. Get exact drive time via Distance Matrix
            if (closestCustomer) {
              const dmData = await distanceMatrixAsync(
                [{ lat: closestCustomer.lat, lng: closestCustomer.lng }],
                [{ lat: targetLoc.lat, lng: targetLoc.lng }]
              );
              trackApiCall('distanceMatrix');

              if (dmData.rows && dmData.rows.length > 0 && dmData.rows[0].elements[0].status === 'OK') {
                const durationSecs = dmData.rows[0].elements[0].duration.value;
                driveMins = Math.round(durationSecs / 60);
                
                parts.push(`📍 Nearest client: ${closestCustomer.name} (+${driveMins} min drive).`);
              } else {
                parts.push(`📍 Nearest client: ${closestCustomer.name} (Drive time failed).`);
              }
            } else {
              parts.push('📍 No active geofenced clients found for drive time.');
            }
          } else {
            parts.push('📍 Could not find address.');
          }
        } catch (err) {
          console.error("Maps API Error", err);
          parts.push('📍 Maps API Error: ' + err.message);
        }
      } else if (targetAddress) {
        parts.push('📍 Google Maps API not loaded yet.');
      }

      const perMin = (settings.targetHourlyRate || 60) / 60;
      const basePrice = baseMins * perMin;
      const diffPrice = difficultyMins * perMin;
      const drivePrice = driveMins * perMin;

      const totalPredictedMins = baseMins + difficultyMins + driveMins;
      const rawPrice = totalPredictedMins * perMin;
      const minFee = settings.minStopFee ?? 30;
      const finalPrice = Math.max(minFee, rawPrice); // Settings floor

      // Find Comparable Customers
      const comps = allCustomers
        .map(c => {
          if (c.status === 'inactive') return null; // Only compare against active customers
          const sqft = parseLawnSizeToSqFt(c.lawnSize);
          if (!sqft) return null;
          return { ...c, sqft };
        })
        .filter(c => c !== null)
        .sort((a, b) => Math.abs(a.sqft - parsedTarget) - Math.abs(b.sqft - parsedTarget))
        .slice(0, 3);

      setBidResult({
        targetPrice: finalPrice.toFixed(2),
        isFloor: finalPrice === minFee && rawPrice < minFee,
        basePrice: basePrice.toFixed(2),
        diffPrice: diffPrice.toFixed(2),
        drivePrice: drivePrice.toFixed(2),
        predictedMins: Math.round(totalPredictedMins),
        confidence: parts.join(' '),
        sqft: parsedTarget,
        comps
      });
    } catch (e) {
      console.error(e);
      alert('Error calculating bid: ' + e.message);
    } finally {
      setIsCalculating(false);
    }
  };

  // 3. Per-Customer $/Hour Profitability
  const profitabilityData = useMemo(() => {
    if (allVisits.length === 0 || allCustomers.length === 0) return [];

    const customerStats = {};
    allVisits.forEach(v => {
      if (v.status !== 'completed' || !v.durationSecs || v.durationSecs < 60) return;
      if (!v.priceEarned || v.priceEarned <= 0) return;
      if (!customerStats[v.customerId]) {
        customerStats[v.customerId] = { totalSecs: 0, totalDriveSecs: 0, totalPrice: 0, count: 0 };
      }
      customerStats[v.customerId].totalSecs += v.durationSecs;
      customerStats[v.customerId].totalDriveSecs += (v.driveTimeSecs || 0);
      customerStats[v.customerId].totalPrice += v.priceEarned;
      customerStats[v.customerId].count += 1;
    });

    const results = [];
    Object.entries(customerStats).forEach(([custId, stats]) => {
      if (stats.count < 1) return;
      const cust = allCustomers.find(c => c.id === Number(custId));
      if (!cust) return;
      const avgMins = Math.round((stats.totalSecs / stats.count) / 60);
      const avgDriveMins = Math.round((stats.totalDriveSecs / stats.count) / 60);
      const avgPrice = stats.totalPrice / stats.count;
      const hourlyRate = (avgPrice / (stats.totalSecs / stats.count)) * 3600;
      results.push({
        id: cust.id,
        name: cust.name,
        hourlyRate: Math.round(hourlyRate),
        avgMins,
        avgDriveMins,
        avgPrice: avgPrice.toFixed(2),
        visitCount: stats.count
      });
    });

    return results.sort((a, b) => b.hourlyRate - a.hourlyRate);
  }, [allVisits, allCustomers]);

  const targetRate = settings?.targetHourlyRate || 0;

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <TrendingUp size={24} color="var(--color-primary)" />
        <h1 className="page-title" style={{ margin: 0 }}>Analytics & Bidding</h1>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
        {['overview', 'bidding', 'expenses'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '999px',
              border: 'none',
              background: activeTab === tab ? 'var(--color-primary)' : 'var(--color-bg-card)',
              color: activeTab === tab ? '#fff' : 'var(--color-text-main)',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxShadow: activeTab === tab ? 'var(--shadow-md)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginTop: '1rem' }}>
            
            {/* Efficiency & Pace Box */}
            <div>
              <h2 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--color-text-muted)', marginBottom: '1rem', marginTop: 0, fontWeight: 700 }}>Efficiency & True Pace</h2>
              
              {paceMetrics && paceMetrics.allTimePace > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
                    
                    <div style={{ padding: '1rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '0.5rem', fontWeight: 700 }}>
                        All-Time
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-text-main)', lineHeight: 1 }}>
                          {paceMetrics.allTimePace}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>sqft/m</span>
                      </div>
                    </div>

                    <div style={{ padding: '1rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-primary)', borderBottom: '4px solid var(--color-primary)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-primary)', letterSpacing: '0.5px', marginBottom: '0.5rem', fontWeight: 800 }}>
                        Last 30 Days
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-text-main)', lineHeight: 1 }}>
                          {paceMetrics.recentPace > 0 ? paceMetrics.recentPace : '-'}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>sqft/m</span>
                      </div>
                    </div>

                  </div>

                  {paceMetrics.recentPace > 0 && paceMetrics.previousPace > 0 && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                      {paceMetrics.recentPace > paceMetrics.previousPace ? (
                        <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}><ArrowUp size={14} /> Faster than prev 30 days</span>
                      ) : (
                        <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}><ArrowDown size={14} /> Slower than prev 30 days</span>
                      )}
                      <span style={{ opacity: 0.5 }}>•</span>
                      <span>{paceMetrics.previousPace} sqft/m prev</span>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)' }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>No Pace Data</p>
                  <p style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>Complete jobs with recorded times to see metrics.</p>
                </div>
              )}
            </div>

            {/* Scatter Plot Chart (Moved from Bidding) */}
            <div ref={containerRef}>
              <h2 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--color-text-muted)', marginBottom: '1rem', marginTop: 0, fontWeight: 700 }}>Historical Efficiency</h2>
              <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '1.2rem' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem', marginTop: 0 }}>
                  Each dot is a customer. Tap a dot to see who it is. The dashed line is your trend.
                </p>
                {scatterData.length > 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <ScatterPlot data={scatterData} width={chartWidth} height={280} />
                  </div>
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>Not enough data</p>
                    <p style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>Complete jobs for customers with known lawn sizes.</p>
                  </div>
                )}
              </div>
            </div>

          {/* Client Profitability Leaderboard */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--color-text-muted)', margin: 0, fontWeight: 700 }}>Client Leaderboard</h2>
              {targetRate > 0 && <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>Target: ${targetRate}/hr</span>}
            </div>

            {profitabilityData.length > 0 ? (
              (() => {
                const topPerformers = profitabilityData.filter(c => targetRate === 0 || c.hourlyRate >= targetRate);
                const needsAttention = profitabilityData.filter(c => targetRate > 0 && c.hourlyRate < targetRate);
                
                const renderClient = (client) => {
                  const isAboveTarget = targetRate > 0 && client.hourlyRate >= targetRate;
                  const pctOfTarget = targetRate > 0 ? Math.round((client.hourlyRate / targetRate) * 100) : null;
                  
                  let rateColor = 'var(--color-text-main)';
                  if (targetRate > 0) {
                    if (client.hourlyRate >= targetRate * 1.15) rateColor = '#10b981';
                    else if (client.hourlyRate >= targetRate) rateColor = 'var(--color-text-main)';
                    else if (client.hourlyRate >= targetRate * 0.8) rateColor = '#f59e0b';
                    else rateColor = '#ef4444';
                  }

                  return (
                    <div key={client.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem 0', borderBottom: '1px solid var(--color-border)', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: 1, paddingRight: '1rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {client.name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, marginTop: '2px' }}>
                          ~{client.avgMins}m • ${client.avgPrice}/visit
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: rateColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                          ${client.hourlyRate}
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '2px' }}>/hr</span>
                        </div>
                        {pctOfTarget !== null && (
                          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: isAboveTarget ? '#10b981' : '#ef4444', marginTop: '4px' }}>
                            {pctOfTarget}% of target
                          </div>
                        )}
                      </div>
                    </div>
                  );
                };

                return (
                  <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0 1.2rem' }}>
                    {topPerformers.length > 0 && (
                      <div style={{ paddingBottom: '0.5rem' }}>
                        {needsAttention.length > 0 && <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: '#10b981', paddingTop: '1.2rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--color-border)' }}>Meeting Target</div>}
                        {topPerformers.map(renderClient)}
                      </div>
                    )}
                    
                    {needsAttention.length > 0 && (
                      <div style={{ paddingBottom: '0.5rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: '#ef4444', paddingTop: '1.2rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--color-border)' }}>Needs Attention</div>
                        {needsAttention.map(renderClient)}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)' }}>
                <p style={{ margin: 0, fontWeight: 600 }}>No Profitability Data</p>
                <p style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>Complete jobs with prices to build your leaderboard.</p>
              </div>
            )}
          </div>

        </div>
      )}

      {/* EXPENSES TAB */}
      {activeTab === 'expenses' && (
        <>
          {/* Fuel Costs Card */}
          <div className="glass-card" style={{ padding: '1.2rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Fuel size={18} color="var(--color-primary)" />
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Estimated Fuel Costs</h2>
        </div>
        
        {allFuelLogs.length > 0 ? (
          (() => {
            let totalMiles = 0;
            let truckCost = 0;
            let mowerCost = 0;
            allFuelLogs.forEach(log => {
              totalMiles += log.milesDriven || 0;
              truckCost += ((log.milesDriven || 0) / (log.truckMpg || settings.truckMpg || 7)) * (log.costOfGas || settings.costOfGas || 3.50);
              mowerCost += (log.mowerHours || 0) * (log.mowerGph || settings.mowerGph || 1) * (log.costOfGas || settings.costOfGas || 3.50);
            });
            
            return (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1rem' }}>
                  <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Truck ({totalMiles.toFixed(1)} mi)</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>${truckCost.toFixed(2)}</div>
                  </div>
                  <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Mower</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>${mowerCost.toFixed(2)}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(239,68,68,0.1)', padding: '0.8rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.3)', marginBottom: '1rem' }}>
                  <span style={{ fontWeight: 600 }}>Total Fuel Expense</span>
                  <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ef4444' }}>
                    ${(truckCost + mowerCost).toFixed(2)}
                  </span>
                </div>

                {/* Per-Day Breakdown */}
                <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
                  <h3 style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', marginBottom: '0.8rem', marginTop: 0 }}>Daily Breakdown</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
                    {[...allFuelLogs].sort((a, b) => new Date(b.date) - new Date(a.date)).map(log => {
                      const tCost = ((log.milesDriven || 0) / (log.truckMpg || settings.truckMpg || 7)) * (log.costOfGas || settings.costOfGas || 3.50);
                      const mCostDaily = (log.mowerHours || 0) * (log.mowerGph || settings.mowerGph || 1) * (log.costOfGas || settings.costOfGas || 3.50);
                      
                      const isEditing = editingFuelLogDate === log.date;

                      return (
                        <div key={log.date} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.8rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Edit {new Date(log.date + 'T12:00:00').toLocaleDateString()}</div>
                              <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                                <div style={{ flex: 1 }}>
                                  <label className="input-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>Miles Driven</label>
                                  <input type="number" step="0.1" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingFuelMiles} onChange={e => setEditingFuelMiles(e.target.value)} />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <label className="input-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>Gas Price ($)</label>
                                  <input type="number" step="0.01" className="input-field" style={{ width: '100%', padding: '0.4rem' }} value={editingFuelGasCost} onChange={e => setEditingFuelGasCost(e.target.value)} />
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                                <button className="btn btn-primary" style={{ flex: 1, padding: '0.4rem', fontSize: '0.82rem' }} onClick={async () => {
                                  await db.fuelLogs.update(log.date, { milesDriven: parseFloat(editingFuelMiles) || 0, costOfGas: parseFloat(editingFuelGasCost) || 3.50, pendingSync: 0 });
                                  setEditingFuelLogDate(null);
                                }}>
                                  <Save size={14} /> Save
                                </button>
                                <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem' }} onClick={() => setEditingFuelLogDate(null)}>
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  {new Date(log.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                  {log.pendingSync === 1 && <span style={{ fontSize: '0.65rem', background: '#f59e0b', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>Pending GPS</span>}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                                  Truck ({(log.milesDriven || 0).toFixed(1)} mi): ${tCost.toFixed(2)} · Mower: ${mCostDaily.toFixed(2)}
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div style={{ fontWeight: 700, color: '#ef4444', fontSize: '0.95rem' }}>
                                  ${(tCost + mCostDaily).toFixed(2)}
                                </div>
                                <button className="btn-icon" style={{ color: 'var(--color-text-muted)', padding: '4px' }} onClick={() => { setEditingFuelLogDate(log.date); setEditingFuelMiles(log.milesDriven || ''); setEditingFuelGasCost(log.costOfGas || 3.50); }}>
                                  <Edit2 size={16} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
            No fuel logs yet. Complete a route and log your mileage at the end of the day to see estimated fuel costs here.
          </p>
        )}
      </div>
        </>
      )}

      {/* BIDDING TAB */}
      {activeTab === 'bidding' && (
        <>
          {/* Calculator Card */}
          <div className="glass-card" style={{ padding: '1.2rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem' }}>
              <Calculator size={18} color="var(--color-primary)" />
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Smart Quote Calculator</h2>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.2rem' }}>
              Instant quotes powered by your historical Matrix math (${settings?.targetHourlyRate || 0}/hr).
            </p>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                className="input-field"
                placeholder="Lawn size (e.g. 8500 or 1/4 acre)"
                value={targetSqFt}
                onChange={e => setTargetSqFt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCalculateBid()}
                style={{ flex: '1 1 150px' }}
              />
              <div style={{ position: 'relative', flex: '1.5 1 200px' }}>
                <MapPin size={16} color="var(--color-text-muted)" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />
                <Autocomplete onLoad={onAutocompleteLoad} onPlaceChanged={onPlaceChanged}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Address (for nearest client drive time)"
                    value={targetAddress}
                    onChange={e => setTargetAddress(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCalculateBid()}
                    style={{ width: '100%', paddingLeft: '2.2rem' }}
                  />
                </Autocomplete>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
              <input
                type="number"
                className="input-field"
                placeholder="Obstacles"
                value={targetObstacles}
                onChange={e => setTargetObstacles(e.target.value)}
                style={{ width: '100px', flexGrow: 1 }}
              />
              <select
                className="input-field"
                value={targetTerrain}
                onChange={e => setTargetTerrain(e.target.value)}
                style={{ flex: '1 1 120px', padding: '0.5rem' }}
              >
                <option value="flat">Flat</option>
                <option value="moderate">Moderate Hills</option>
                <option value="hilly">Hilly / Steep</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', cursor: 'pointer', flexGrow: 1 }}>
                <input 
                  type="checkbox" 
                  checked={targetFenced} 
                  onChange={e => setTargetFenced(e.target.checked)}
                  style={{ width: '16px', height: '16px' }}
                />
                Fenced
              </label>
              <button className="btn btn-primary" onClick={handleCalculateBid} disabled={isCalculating} style={{ flex: '1 1 100%' }}>
                {isCalculating ? 'Loading...' : 'Quote'}
              </button>
            </div>

            {bidResult && !bidResult.error && (
              <div className="animate-fade-in" style={{ marginTop: '1.2rem', padding: '1rem', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(16,185,129,0.3)' }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Target Bid for {bidResult.sqft.toLocaleString()} sq ft
                    </div>
                    <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.2rem' }}>
                      ${bidResult.targetPrice}
                    </div>
                    {bidResult.isFloor && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>* Minimum stop fee applied</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Est. Time</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--color-text-main)' }}>{bidResult.predictedMins} min</div>
                  </div>
                </div>

                {/* Receipt Breakdown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Base Cut & Setup</span>
                    <span style={{ fontWeight: 600 }}>${bidResult.basePrice}</span>
                  </div>
                  {parseFloat(bidResult.diffPrice) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>Difficulty Modifiers</span>
                      <span style={{ fontWeight: 600, color: '#f59e0b' }}>+${bidResult.diffPrice}</span>
                    </div>
                  )}
                  {parseFloat(bidResult.drivePrice) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>Drive Time Cost</span>
                      <span style={{ fontWeight: 600, color: '#ef4444' }}>+${bidResult.drivePrice}</span>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'flex-start', gap: '0.4rem', background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)' }}>
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} /> 
                  <span style={{ lineHeight: 1.4 }}>{bidResult.confidence}</span>
                </div>
                
                {bidResult.comps && bidResult.comps.length > 0 && (
                  <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(16,185,129,0.3)' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '0.5rem' }}>
                      Similar Active Customers:
                    </div>
                    {bidResult.comps.map(comp => {
                      const compRate = comp.price || (comp.services && comp.services.find(s => s.id === 's1' || (s.name && s.name.toLowerCase().includes('mow')))?.price) || 0;
                      return (
                        <div key={comp.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                          <div>
                            <span style={{ fontWeight: 500 }}>{comp.name}</span>
                            <span style={{ color: 'var(--color-text-muted)', marginLeft: '0.4rem' }}>({comp.sqft.toLocaleString()} sq ft)</span>
                          </div>
                          <div style={{ fontWeight: 600 }}>
                            ${parseFloat(compRate).toFixed(2)}/cut
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Smart Bidding Matrix Card */}
          <div className="glass-card" style={{ padding: '1.2rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <TrendingUp size={18} color="var(--color-primary)" />
                <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Smart Bidding Matrix</h2>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600, background: 'var(--color-bg-main)', padding: '0.3rem 0.6rem', borderRadius: 'var(--radius-sm)' }}>
                Avg Pace: <span style={{ color: 'var(--color-primary)' }}>{paceMetrics ? paceMetrics.allTimePace : 0}</span> <span style={{fontSize: '0.75rem'}}>sqft/m</span>
              </div>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.2rem', marginTop: 0 }}>
              Prices are calculated dynamically based on your historical speed across different lawn size tiers.
            </p>
            
            {tieredMatrixData ? (
              <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', maxHeight: '450px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--color-bg-main)' }}>
                    <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                      <th style={{ padding: '0.6rem 0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Sq Ft</th>
                      <th style={{ padding: '0.6rem 0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Est. Time</th>
                      <th style={{ padding: '0.6rem 0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedBuckets.map((group) => (
                      <Fragment key={group.label}>
                        {/* Category Header */}
                        <tr 
                          style={{ background: 'var(--color-bg-main)', cursor: 'pointer' }} 
                          onClick={() => setSelectedBucket({ bucket: group.bucket, minSqft: group.minSqft })} 
                          className="hover-highlight"
                        >
                          <td colSpan="3" style={{ padding: '0.8rem', borderBottom: `2px solid ${group.color}40`, borderTop: '2px solid var(--color-border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: group.color }}></div>
                              <span style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>{group.label}</span>
                              <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                ({Math.round(group.pace)} sqft/m){!group.rawHasData && '*'}
                              </span>
                            </div>
                          </td>
                        </tr>
                        
                        {/* Rows */}
                        {group.rows.map(sqft => {
                          let mins = sqft / group.pace;

                          const rawPrice = (mins / 60) * (settings?.targetHourlyRate || 60);
                          const minFee = settings?.minStopFee ?? 30;
                          const price = Math.max(minFee, rawPrice); // Settings floor
                          
                          return (
                            <tr key={sqft} style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-card)' }}>
                              <td style={{ padding: '0.6rem 0.8rem', fontWeight: 600, borderLeft: `4px solid ${group.color}` }}>{sqft.toLocaleString()}</td>
                              <td style={{ padding: '0.6rem 0.8rem' }}>{Math.round(mins)} min</td>
                              <td style={{ padding: '0.6rem 0.8rem', fontWeight: 700, color: 'var(--color-primary)' }}>${price.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: '0.6rem 0.8rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-main)', position: 'sticky', bottom: 0, borderTop: '1px solid var(--color-border)' }}>
                  * Denotes estimated pace borrowed from nearest bucket. Minimum stop fee: ${settings?.minStopFee ?? 30}. Tap a category header to view history graph.
                </div>
              </div>
            ) : (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Not enough data.</p>
            )}
          </div>


        </>
      )}

      {/* Render Bucket History Modal */}
      {selectedBucket && (
        <BucketHistoryModal 
          bucket={selectedBucket.bucket} 
          minSqft={selectedBucket.minSqft}
          allVisits={allVisits}
          allCustomers={allCustomers}
          width={chartWidth}
          onClose={() => setSelectedBucket(null)} 
        />
      )}
    </div>
  );
}
