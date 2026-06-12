import re

with open('src/pages/History.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the leftover edit mode fragment starting with " />" to ")}".
# Find the exact strings.
pattern = r"\s*/>\s*</div>\s*<div style=\{\{ flex: 1, minWidth: '100px' \}\}>[\s\S]*?<X size=\{13\} />\s*</button>\s*</div>\s*</div>\s*\)\}"
content = re.sub(pattern, "", content)

with open('src/pages/History.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("History.jsx fixed.")
