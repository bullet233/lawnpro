import re

with open('src/pages/CustomersList.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the incorrect escaped quotes
content = content.replace(r'className=\"pill-tag warning\"', 'className="pill-tag warning"')
content = content.replace(r'color=\"var(--color-accent)\"', 'color="var(--color-accent)"')
content = content.replace(r'title=\"Missing Info\"', 'title="Missing Info"')

with open('src/pages/CustomersList.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("CustomersList.jsx quotes fixed.")
