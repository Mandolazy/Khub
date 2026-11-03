# 2026-10-28T23:16:19.307Z  esito: ok
# output: '29 passed, 0 failed'
python3 - <<'EOF'
p='scripts/test-stati-ricetta.js'; s=open(p).read()
old="""    c.creaBozzaDaSorgente('rE', null); c.S.confirmDeleteId = 'rE'; console.log('DBG', idsScheda('rE'), c.ricetteDellaScheda(c.R('rE'))); await c.deleteRecipe('rE');"""
new="""    c.upRec('rE', r => ({ ...r, labVersions: r.labVersions.concat([{ ...clone(r.labVersions[0]), id: 'lvLocale' }]) }));
    assert.ok(!esiste('lvLocale')); c.S.confirmDeleteId = 'rE'; await c.deleteRecipe('rE');"""
assert old in s; s=s.replace(old,new); open(p,'w').write(s)
EOF
HTTPS_PROXY=http://127.0.0.1:9 node scripts/test-stati-ricetta.js 2>&1 | grep -E -A3 "FAIL|passed"
