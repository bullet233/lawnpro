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
    
    mins = Math.max(0.5, mins); // Sanity floor: at least 30 seconds

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
