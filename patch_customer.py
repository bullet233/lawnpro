import re

with open('src/pages/CustomerDetail.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace the logic block
old_logic = """
          // Last mowed
          const sortedByDate = [...completed].sort((a, b) => b.exitTime - a.exitTime);
          const lastVisit = sortedByDate[0];
          const lastMowedDate = lastVisit ? new Date(lastVisit.exitTime) : null;
          const daysSince = lastMowedDate ? getDaysSince(lastMowedDate.getTime()) : null;
"""
new_logic = """
          // Distinguish visits
          const sortedByDate = [...completed].sort((a, b) => b.exitTime - a.exitTime);
          const globalDefaults = settings?.defaultServices || [];
          const mowingServiceIds = globalDefaults.filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);
          const fertServiceIds = globalDefaults.filter(s => s.category === 'Fertilizer' || s.id === 's3').map(s => s.id);

          const mowVisits = sortedByDate.filter(v => !v.appliedServices || v.appliedServices.length === 0 || v.appliedServices.some(id => mowingServiceIds.includes(id)));
          const fertVisits = sortedByDate.filter(v => v.appliedServices && v.appliedServices.some(id => fertServiceIds.includes(id)));

          const lastMowVisit = mowVisits[0];
          const lastMowedDate = lastMowVisit ? new Date(lastMowVisit.exitTime) : null;
          const daysSinceMow = lastMowedDate ? getDaysSince(lastMowedDate.getTime()) : null;

          const lastFertVisit = fertVisits[0];
          const lastFertDate = lastFertVisit ? new Date(lastFertVisit.exitTime) : null;
          const daysSinceFert = lastFertDate ? getDaysSince(lastFertDate.getTime()) : null;
"""
if old_logic.strip() in content:
    content = content.replace(old_logic.strip(), new_logic.strip())
else:
    print("WARNING: Could not find old_logic")

# 2. Replace the UI block
old_ui = """
                  {/* Last Mowed */}
                  <div style={{ background: 'var(--color-bg-main)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Calendar size={15} color="var(--color-text-muted)" />
                      <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Last Mowed</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                        {lastMowedDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: daysSince <= 7 ? 'var(--color-primary)' : daysSince <= 14 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>
                        {daysSince === 0 ? 'Today' : daysSince === 1 ? 'Yesterday' : `${daysSince} days ago`}
                      </div>
                    </div>
                  </div>
"""

new_ui = """
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
"""

if old_ui.strip() in content:
    content = content.replace(old_ui.strip(), new_ui.strip())
else:
    print("WARNING: Could not find old_ui")

with open('src/pages/CustomerDetail.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
