import re

with open('src/pages/Settings.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update lucide-react imports
content = content.replace(
    "import { Settings as SettingsIcon, Save, Download, Upload, Plus, Trash2, Map as MapIcon, Edit2, Check } from 'lucide-react';",
    "import { Settings as SettingsIcon, Save, Download, Upload, Plus, Trash2, Map as MapIcon, Edit2, Check, FileText } from 'lucide-react';"
)

# 2. Add Changelog Tab Button
tab_pattern = r"(<button className=\{`tab-button \$\{activeTab === 'data' \? 'active' : ''\}`\} onClick=\{\(\) => setActiveTab\('data'\)\}>Data</button>)"
content = re.sub(
    tab_pattern,
    r"\1\n        <button className={`tab-button ${activeTab === 'changelog' ? 'active' : ''}`} onClick={() => setActiveTab('changelog')}>Changelog</button>",
    content
)

# 3. Add Changelog Tab Content
changelog_content = """
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
"""

end_of_file_pattern = r"(</div>\s*\)\s*;\s*\})"
content = re.sub(
    end_of_file_pattern,
    changelog_content + r"\1",
    content
)

with open('src/pages/Settings.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Settings.jsx patched successfully.")
