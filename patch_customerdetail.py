import re

with open('src/pages/CustomerDetail.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update lucide-react imports to include Edit2
content = content.replace(
    "import { MapPin, Save, ArrowLeft, Trash2, BarChart3, Clock, DollarSign, Calendar, Hash } from 'lucide-react';",
    "import { MapPin, Save, ArrowLeft, Trash2, BarChart3, Clock, DollarSign, Calendar, Hash, Edit2 } from 'lucide-react';"
)

# 2. Import VisitEditModal
content = content.replace(
    "import AppDialog from '../components/AppDialog';",
    "import AppDialog from '../components/AppDialog';\nimport VisitEditModal from '../components/VisitEditModal';"
)

# 3. Add state for editingJob
state_pattern = r"const \[settings, setSettings\] = useState\(null\);"
content = re.sub(
    state_pattern,
    "const [settings, setSettings] = useState(null);\n  const [editingJob, setEditingJob] = useState(null);",
    content
)

# 4. Modify the Visit rendering to add the Edit button
visit_row_pattern = r"(<div key=\{v\.id\} style=\{\{ display: 'flex', alignItems: 'center', gap: '0\.6rem', padding: '0\.5rem 0\.7rem', background: 'var\(--color-bg-main\)', borderRadius: 'var\(--radius-sm\)', border: '1px solid var\(--color-border\)', fontSize: '0\.8rem' \}\}>[\s\S]*?<div style=\{\{ fontWeight: 700, color: 'var\(--color-primary\)', flexShrink: 0 \}\}>\s*\$\{\(v\.priceEarned \|\| 0\)\.toFixed\(0\)\}\s*</div>)"

new_visit_row = r"""\1
                            <button 
                              className="btn btn-secondary" 
                              style={{ padding: '0.3rem', flexShrink: 0, marginLeft: '0.2rem', color: 'var(--color-text-muted)' }}
                              onClick={() => setEditingJob(v)}
                              title="Edit Visit"
                            >
                              <Edit2 size={14} />
                            </button>"""

content = re.sub(visit_row_pattern, new_visit_row, content)

# 5. Add VisitEditModal rendering at the end of the return statement
app_dialog_pattern = r"(</AppDialog>\s*</div>\s*\)\s*;\s*\})"
new_app_dialog = """</AppDialog>
      
      {editingJob && (
        <VisitEditModal
          job={editingJob}
          customer={customer}
          defaultServices={settings?.defaultServices}
          onClose={() => setEditingJob(null)}
          onSave={async (updates) => {
            await db.visits.update(editingJob.id, updates);
            setEditingJob(null);
          }}
        />
      )}
    </div>
  );
}"""

content = re.sub(app_dialog_pattern, new_app_dialog, content)

with open('src/pages/CustomerDetail.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("CustomerDetail.jsx patched successfully.")
