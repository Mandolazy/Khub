# 2026-10-28T23:16:47.148Z  esito: ok
# output: "10 passed, 0 failed\n279:    return {S, loadFromSupabase, saveToSupabase, renderLabRecipe, renderRicettaMadreV2, renderHomeD3, renderSchedaD3, renderDatiTecniciD3, renderD3Esporta,\n342:  await test('P2. motore preservato: LAB, scaling, rese, conversioni, Sessioni, salvataggio e MichelinAI identici a "
python3 - <<'EOF'
p='scripts/test-supabase-secret-key.js'; s=open(p).read()
old="      const r = await call({ supabaseAction: 'delete', table, id });\n      assert.strictEqual(r.out.ok, true"
new="      const r = await call(Object.assign({ supabaseAction: 'delete', table, id }, table === 'recipes' ? { ricetteAttese: [] } : {}));\n      assert.strictEqual(r.out.ok, true"
assert old in s; s=s.replace(old,new); open(p,'w').write(s)
EOF
HTTPS_PROXY=http://127.0.0.1:9 node scripts/test-supabase-secret-key.js 2>&1 | grep -E -A3 'FAIL|passed'; grep -n "renderSchedaD3\|P2\." scripts/test-preview-direzione-3.js | head -5
