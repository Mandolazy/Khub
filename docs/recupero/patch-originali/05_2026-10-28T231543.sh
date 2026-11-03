# 2026-10-28T23:15:43.959Z  esito: ok
# output: '  FAIL - E10. conferma con elenco delle Ricette cambiato: il server rifiuta senza eliminare nulla; senza elenco confermato rifiuta\n    AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:\n    at /home/user/Khub/scripts/test-stati-ricetta.js:626:72\n    at /home/user/Khub/scripts'
python3 - <<'EOF'
p='scripts/test-stati-ricetta.js'; s=open(p).read()
old="""    const c = await setupSchedaE(); const prima = db();
    await c.deleteVariant('rE', 'vaE1');"""
new="""    const c = await setupSchedaE(() => { fake.tables.ingredients = fake.tables.ingredients.filter(i => i.id !== 'mat-e2'); }); const prima = db();
    await c.deleteVariant('rE', 'vaE1'); // solo il collegamento origin_variant_id (nessun mattoncino)"""
assert old in s; s=s.replace(old,new); open(p,'w').write(s)
EOF
HTTPS_PROXY=http://127.0.0.1:9 node scripts/test-stati-ricetta.js 2>&1 | grep -E "FAIL|Assert|at /|passed" | head -30
