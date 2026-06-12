import re

with open('src/pages/Dashboard.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace quick-log checks
content = content.replace(
    "v.status === 'completed' || v.status === 'quick-log' || v.status === 'skipped'",
    "v.status === 'completed' || v.status === 'skipped'"
)
content = content.replace(
    "v.status === 'completed' || v.status === 'quick-log'",
    "v.status === 'completed'"
)

with open('src/pages/Dashboard.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Dashboard.jsx patched successfully.")
