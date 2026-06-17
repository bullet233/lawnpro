import re

with open('src/pages/CustomersList.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. We need getSettings
if 'import { getSettings }' not in content:
    content = content.replace("import { trackApiCall }", "import { getSettings } from '../db/settings';\nimport { trackApiCall }")

# 2. Fix the allVisits useMemo
old_memo = """
  // Compute recent stats from history
  const customerStats = useMemo(() => {
    const stats = {};
    for (const v of allVisits) {
      if (v.status !== 'completed') continue;
      if (!stats[v.customerId]) {
        stats[v.customerId] = { count: 0, revenue: 0, lastExit: 0, firstExit: 99999999999999, lastMow: 0, lastFert: 0 };
      }
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
"""

new_memo = """
  // Compute recent stats from history
  const customerStats = useMemo(() => {
    const stats = {};
    const settings = getSettings();
    const defaultServices = settings.defaultServices || [];
    const mowingServiceIds = defaultServices.filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);
    const fertServiceIds = defaultServices.filter(s => s.category === 'Fertilizer' || s.id === 's3').map(s => s.id);

    for (const v of allVisits) {
      if (v.status !== 'completed') continue;
      if (!stats[v.customerId]) {
        stats[v.customerId] = { count: 0, revenue: 0, lastExit: 0, firstExit: 99999999999999, lastMow: 0, lastFert: 0 };
      }
      const s = stats[v.customerId];
      s.count++;
      s.revenue += (v.priceEarned || 0);
      if (v.exitTime > s.lastExit) s.lastExit = v.exitTime;
      if (v.exitTime < s.firstExit) s.firstExit = v.exitTime;
      
      const isMow = !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => mowingServiceIds.includes(id));
      const isFert = v.appliedServices && v.appliedServices.some(id => fertServiceIds.includes(id));
      
      if (isMow && v.exitTime > s.lastMow) s.lastMow = v.exitTime;
      if (isFert && v.exitTime > s.lastFert) s.lastFert = v.exitTime;
    }
    return stats;
  }, [allVisits]);
"""

if old_memo.strip() in content:
    content = content.replace(old_memo.strip(), new_memo.strip())
else:
    print("WARNING: Could not find old_memo in CustomersList.jsx")

with open('src/pages/CustomersList.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
