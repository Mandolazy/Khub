# 2026-11-01T22:40:58.560Z  esito: ok
# output: '22 passed, 0 failed'
python3 - <<'EOF'
p='scripts/test-preview-direzione-3.js'; s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1,(s.count(old),old[:70]); s=s.replace(old,new)
rep("""const hideSidebar=S.uiD3?(S.view==='profilo'||S.view==='michelinai-globale'):(S.view""","""const hideSidebar=S.uiD3?false:(S.view""")
rep("""    const michelin = Object.keys(a).filter(n => /michelin|m1|m2|primoConsulto/i.test(n));""","""    // Il segnaposto "MichelinAI" e' solo una card di testo (presentazione), non il motore.
    const michelin = Object.keys(a).filter(n => /michelin|m1|m2|primoConsulto/i.test(n) && n !== 'renderMichelinAIGlobalePlaceholder');""")
rep("""    assert.ok(!/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u.test(hd), 'nessuna emoji');""","""    assert.ok(!/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{26FF}]|\\u{1F3F7}/u.test(hd), 'nessuna emoji (i simboli delle pillole di stato, es. ✓, restano)');""")
rep("""    assert.ok(!/contenutoModificatoIl/.test(fn.d3GruppiLab) && !/contenutoModificatoIl/.test(fn.renderLabGlobale), 'il criterio vive in un solo punto');""","""    assert.ok(!/new Date\\(tb\\)-new Date\\(ta\\)/.test(fn.d3GruppiLab + fn.renderLabGlobale) && /new Date\\(tb\\)-new Date\\(ta\\)/.test(fn.confrontaUltimaModificaBozze), 'il criterio vive in un solo punto');""")
open(p,'w').write(s)
EOF
HTTPS_PROXY=http://127.0.0.1:9 node scripts/test-preview-direzione-3.js 2>&1 | grep -E "FAIL|passed|Error" -A4 | head -30
