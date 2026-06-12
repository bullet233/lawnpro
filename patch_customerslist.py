import re

with open('src/pages/CustomersList.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add amber badge to Card View
card_badge_pattern = r"(\{c\.isOutlier && <span className=\"pill-tag danger\"><AlertTriangle size=\{12\} /> BAD GPS</span>\})"
card_badge_replacement = r"\1\n                        {c.address === 'Added from field' && <span className=\"pill-tag warning\"><AlertTriangle size={12} /> MISSING INFO</span>}"
content = re.sub(card_badge_pattern, card_badge_replacement, content)

# Add amber badge to Table View
table_badge_pattern = r"(\{c\.isOutlier && <AlertTriangle size=\{16\} color=\"#ef4444\" title=\"Bad GPS Pin\" style=\{\{ flexShrink: 0, marginRight: '0\.4rem' \}\} />\})"
table_badge_replacement = r"\1\n                          {c.address === 'Added from field' && <AlertTriangle size={16} color=\"var(--color-accent)\" title=\"Missing Info\" style={{ flexShrink: 0, marginRight: '0.4rem' }} />}"
content = re.sub(table_badge_pattern, table_badge_replacement, content)

with open('src/pages/CustomersList.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("CustomersList.jsx patched successfully.")

with open('src/pages/RouteBuilder.jsx', 'r', encoding='utf-8') as f:
    route_content = f.read()

# Remove quick-log from RouteBuilder.jsx
route_content = route_content.replace(
    "v.status === 'completed' || v.status === 'quick-log'",
    "v.status === 'completed'"
)

with open('src/pages/RouteBuilder.jsx', 'w', encoding='utf-8') as f:
    f.write(route_content)
print("RouteBuilder.jsx patched successfully.")
