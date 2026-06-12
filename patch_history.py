import re

with open('src/pages/History.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Import VisitEditModal
content = content.replace(
    "import DayReviewModal from '../components/DayReviewModal';",
    "import DayReviewModal from '../components/DayReviewModal';\nimport VisitEditModal from '../components/VisitEditModal';"
)

# 2. Remove quick-log from STATUS_COLORS
content = re.sub(
    r"\s*'quick-log':\s*\{\s*border:\s*'#f59e0b',\s*bg:\s*'rgba\(245,158,11,0\.07\)'\s*\},",
    "",
    content
)

# 3. Replace state variables for editing
state_pattern = r"const \[editingJobId,\s*setEditingJobId\]\s*=\s*useState\(null\);[\s\S]*?const \[editingExitTime,\s*setEditingExitTime\]\s*=\s*useState\(''\);"
content = re.sub(
    state_pattern,
    "const [editingJob, setEditingJob] = useState(null);",
    content
)

# 4. Replace handleTimeChange, handleEditClick, handleSaveEdit
handlers_pattern = r"// ── Edit handlers ─────────────────────────────────────────────────────────[\s\S]*?setEditingJobId\(null\);\s*\};"
new_handlers = """// ── Edit handlers ─────────────────────────────────────────────────────────
  const handleEditClick = (job) => { 
    setEditingJob(job);
  };

  const handleSaveEdit = async (updates) => {
    if (!editingJob) return;
    await db.visits.update(editingJob.id, updates);
    setEditingJob(null);
  };"""
content = re.sub(handlers_pattern, new_handlers, content)

# 5. Remove quick-log status pill
content = re.sub(
    r"\s*<button style=\{statusPillStyle\('quick-log'\)\} onClick=\{.*?\}\>Quick Log</button>",
    "",
    content
)

# 6. Replace isEditing check
content = content.replace(
    "const isEditing    = editingJobId === job.id;",
    "const isEditing    = false; // Handled by VisitEditModal now"
)

# 7. Remove Edit Mode form
edit_mode_pattern = r"\{\/\*\s*Edit Mode\s*\*\/\}\s*\{isEditing && \([\s\S]*?\)\s*\}"
content = re.sub(edit_mode_pattern, "", content)

# 8. Add VisitEditModal rendering at the end of the return statement
# Find the closing tag of AppDialog or DayReviewModal
app_dialog_pattern = r"(</AppDialog>\s*</div>\s*\)\s*;\s*\})"
new_app_dialog = """</AppDialog>

      {editingJob && (
        <VisitEditModal
          job={editingJob}
          customer={customers.find(c => c.id === editingJob.customerId)}
          defaultServices={settings?.defaultServices}
          onClose={() => setEditingJob(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}"""
content = re.sub(app_dialog_pattern, new_app_dialog, content)

# Write back
with open('src/pages/History.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("History.jsx patched successfully.")
