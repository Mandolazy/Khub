# 2026-10-28T23:15:53.127Z
grep -n "test('E10" scripts/test-stati-ricetta.js; sed -i 's/split(.\\n.).slice(0, 4)/split("\\n").slice(0, 8)/' scripts/test-stati-ricetta.js; HTTPS_PROXY=http://127.0.0.1:9 node scripts/test-stati-ricetta.js 2>&1 | grep -A9 "FAIL"; git diff --stat scripts/test-stati-ricetta.js
