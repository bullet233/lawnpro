import { getSettings } from '../db/settings';
import { parseLawnSizeToSqFt } from './parseLawnSize';

export { parseLawnSizeToSqFt };

export function calculateTieredMatrix(allVisits, allCustomers) {
  if (!allVisits || !allCustomers || allVisits.length === 0 || allCustomers.length === 0) return null;

  const settings = getSettings();
  const defaultServices = settings.defaultServices || [];
  const mowingServiceIds = defaultServices.filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);

  const buckets = [
    { maxSqft: 2500, label: '0 - 2.5k' },
    { maxSqft: 5000, label: '2.5k - 5k' },
    { maxSqft: 10000, label: '5k - 10k' },
    { maxSqft: 15000, label: '10k - 15k' },
    { maxSqft: 21780, label: '15k - Half Acre' },
    { maxSqft: 30000, label: 'Half Acre - 30k' },
    { maxSqft: 43560, label: '30k - 1 Acre' },
    { maxSqft: Infinity, label: '1 Acre+' }
  ];

  // Initialize bucket stats
  const stats = buckets.map(b => ({ ...b, totalSecs: 0, totalSqFt: 0 }));

  allVisits.forEach(v => {
    if (v.status !== 'completed' || !v.durationSecs || v.durationSecs < 60) return;
    const isMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => mowingServiceIds.includes(id));
    if (!isMow) return;
    
    const cust = allCustomers.find(c => c.id === v.customerId);
    if (!cust) return;
    const sqft = parseLawnSizeToSqFt(cust.lawnSize);
    if (!sqft) return;

    // Normalize duration
    let mins = v.durationSecs / 60;
    
    const obstacles = parseInt(cust.obstacleCount, 10) || 0;
    if (obstacles > 0) mins -= (obstacles * 1.5);
    if (cust.fencedBackyard) mins -= 3;

    if (cust.terrain === 'moderate') mins /= 1.15;
    else if (cust.terrain === 'hilly') mins /= 1.30;

    // If removing this customer's difficulty premium drives the normalized time
    // below a credible minimum, the recorded difficulty is inconsistent with how
    // long the job actually took — skip this visit instead of flooring it to
    // 0.5 min. The old floor fabricated an absurd sqft/min pace that poisoned the
    // bucket and dragged future bids too low on obstacle-heavy lawns.
    if (mins < 1) return;

    // Find which bucket this belongs to
    for (let i = 0; i < stats.length; i++) {
      if (sqft <= stats[i].maxSqft) {
        stats[i].totalSecs += (mins * 60);
        stats[i].totalSqFt += sqft;
        break;
      }
    }
  });

  // Calculate pace (sqft/min) per bucket
  const bucketPace = stats.map(b => {
    if (b.totalSecs === 0) return 0;
    return b.totalSqFt / (b.totalSecs / 60);
  });

  // Fallback logic for empty buckets (borrow from closest non-empty bucket)
  const originalPace = [...bucketPace];
  for (let i = 0; i < bucketPace.length; i++) {
    if (bucketPace[i] === 0) {
      let nearestLeft = 0;
      let nearestRight = 0;
      for (let l = i - 1; l >= 0; l--) { if (originalPace[l] > 0) { nearestLeft = originalPace[l]; break; } }
      for (let r = i + 1; r < originalPace.length; r++) { if (originalPace[r] > 0) { nearestRight = originalPace[r]; break; } }
      
      if (nearestLeft > 0 && nearestRight > 0) {
        bucketPace[i] = (nearestLeft + nearestRight) / 2;
      } else if (nearestLeft > 0) {
        bucketPace[i] = nearestLeft;
      } else if (nearestRight > 0) {
        bucketPace[i] = nearestRight;
      } else {
        bucketPace[i] = 250; // Absolute fallback
      }
    }
  }

  return buckets.map((b, i) => ({ ...b, pace: bucketPace[i], rawHasData: stats[i].totalSecs > 0 }));
}

// Difficulty-normalized (sqft, mins) points for every mow visit — the same
// normalization the bucket model applies (obstacles/fenced/terrain removed so the
// modifiers can be added back on top when quoting). Shared by the trend fitters.
function collectMowPoints(allVisits, allCustomers) {
  const settings = getSettings();
  const mowingServiceIds = (settings.defaultServices || [])
    .filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);
  const custById = new Map(allCustomers.map(c => [c.id, c]));
  const pts = [];
  allVisits.forEach(v => {
    if (v.status !== 'completed' || !v.durationSecs || v.durationSecs < 60) return;
    const isMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => mowingServiceIds.includes(id));
    if (!isMow) return;
    const cust = custById.get(v.customerId);
    if (!cust) return;
    const sqft = parseLawnSizeToSqFt(cust.lawnSize);
    if (!sqft) return;
    let mins = v.durationSecs / 60;
    const obstacles = parseInt(cust.obstacleCount, 10) || 0;
    if (obstacles > 0) mins -= (obstacles * 1.5);
    if (cust.fencedBackyard) mins -= 3;
    if (cust.terrain === 'moderate') mins /= 1.15;
    else if (cust.terrain === 'hilly') mins /= 1.30;
    // Skip non-credible normalized points instead of flooring to 0.5 min — see
    // calculateTieredMatrix above. A fabricated ultra-fast point would bias the
    // fitted power curve toward under-pricing.
    if (mins < 1) return;
    pts.push([sqft, mins]);
  });
  return pts;
}

// ── Trend curve pricing model (beta alternative to tiered buckets) ────────────
// Fits a power curve  time = A * sqft^b  (log-log least squares) across every mow
// visit. With 0 < b < 1 the curve is concave — bigger lawns cost more total time
// but less time per square foot — which is what the real data shows, so it
// extrapolates sanely at both ends (no fake fixed "setup" constant, no per-bucket
// cliffs). In leave-one-out cross-validation on real data this beat the tiered
// buckets and a straight line. Returns null when there's too little data to fit;
// callers fall back to buckets.
export function calculatePowerModel(allVisits, allCustomers) {
  if (!allVisits || !allCustomers || allVisits.length === 0 || allCustomers.length === 0) return null;

  const pts = collectMowPoints(allVisits, allCustomers).filter(([x, y]) => x > 0 && y > 0);
  if (pts.length < 5) return null; // too little data to trust a fit

  const n = pts.length;
  const sx = pts.reduce((s, p) => s + Math.log(p[0]), 0);
  const sy = pts.reduce((s, p) => s + Math.log(p[1]), 0);
  const sxx = pts.reduce((s, p) => s + Math.log(p[0]) ** 2, 0);
  const sxy = pts.reduce((s, p) => s + Math.log(p[0]) * Math.log(p[1]), 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;

  const b = (n * sxy - sx * sy) / denom;
  if (b <= 0) return null; // non-increasing fit — not usable for pricing
  const A = Math.exp((sy - b * sx) / n);

  // R² measured on the real (minutes) scale, not log space, so it's comparable.
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const ssTot = pts.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p[1] - A * Math.pow(p[0], b)) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { A, b, r2, n };
}

// Predicted clean base minutes for a size under the trend curve model.
export function predictTrendMins(model, sqft) {
  if (!model) return 0;
  return Math.max(0.5, model.A * Math.pow(sqft, model.b));
}
