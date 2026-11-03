# 2026-11-01T22:42:11.180Z  esito: ok
# output: '9701:    <div class="d3-prod-gestione"><span>Gestione della Ricetta · non rigua\n22 passed, 0 failed'
python3 - <<'EOF'
p='khub_mvp.html'; s=open(p).read()
old="""    ${renderAzioniLabRicetta(recipe,vv)}
    ${S.uiD3?`<div class="d3-prod-gestione">"""
assert s.count(old)==1
s=s.replace(old,"""    ${renderAzioniLabRicetta(recipe,vv)}${S.uiD3?`
    <div class="d3-prod-gestione">""")
open(p,'w').write(s)
p='scripts/test-preview-direzione-3.js'; s=open(p).read()
import re
i=s.index("    { const a1 = c.renderProdRecipe"); j=s.index("\n",i)
s=s[:i]+"    assert.strictEqual(c.renderProdRecipe(rec(c)), cm.renderProdRecipe(rec(cm)), 'Ricetta in Produzione');"+s[j:]
open(p,'w').write(s)
EOF
grep -n "d3-prod-gestione\">" khub_mvp.html | cut -c1-80; HTTPS_PROXY=http://127.0.0.1:9 node scripts/test-preview-direzione-3.js 2>&1 | grep -E "FAIL|passed" -A3
