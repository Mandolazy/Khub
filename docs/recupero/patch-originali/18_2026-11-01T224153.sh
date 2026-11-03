# 2026-11-01T22:41:53.853Z  esito: ok
# output: "ok\ntest-preview-direzione-3:   FAIL - P10. uniformazione: con l'anteprima spenta Home, LAB, Produzione e navigazione identiche a main 21 passed, 1 failed \ntest-fix2d-lab-weights: 10 passed, 0 failed \ntest-schede-categorie: 9 passed, 0 failed \ntest-start-home: 3 passed, 0 failed"
python3 - <<'EOF'
import re
p='scripts/test-preview-direzione-3.js'; s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1,(s.count(old),old[:70]); s=s.replace(old,new)
rep("""    for (const n of ['renderSidebar', 'renderBottomNav', 'renderAppHome', 'renderLabGlobale', 'renderAttive', 'renderActiveRecipeRow']) SRC_MAIN = SRC_MAIN.replace(topLevelFunctions(SRC_D3)[n], fm[n]);""",
"""    for (const n of ['renderSidebar', 'renderBottomNav', 'renderAppHome', 'renderLabGlobale', 'renderAttive', 'renderActiveRecipeRow',
      'renderProdRecipe', 'renderSearch', 'renderConfronto', 'renderOnboarding', 'renderLabConversionModal', 'renderProfiloPlaceholder', 'renderMichelinAIGlobalePlaceholder']) SRC_MAIN = SRC_MAIN.replace(topLevelFunctions(SRC_D3)[n], fm[n]);""")
rep("""    assert.strictEqual(c.renderAttive(), cm.renderAttive(), 'Produzione');
""","""    assert.strictEqual(c.renderAttive(), cm.renderAttive(), 'Produzione');
    // Finalizzazione: ogni funzione toccata, con l'anteprima spenta, produce lo stesso HTML di main.
    for (const k of [c, cm]) Object.assign(k.S, { mode: 'produzione', selectedVariantId: 'vaB', confrontoA: 'vaB', confrontoB: 'vaP',
      pendingLabConversion: { recipeId: 'rB', labVersionId: 'lvB', ingId: 'x', ingName: 'Uova (impasto)', fromUnit: 'n', toUnit: 'g', askUnit: 'n', value: '55', isReference: false, loading: false, error: 'Errore' } });
    assert.strictEqual(c.renderProdRecipe(rec(c)), cm.renderProdRecipe(rec(cm)), 'Ricetta in Produzione');
    assert.strictEqual(c.renderSearch('V va'), cm.renderSearch('V va'), 'Ricerca');
    assert.strictEqual(c.renderConfronto(rec(c)), cm.renderConfronto(rec(cm)), 'Confronta Ricette');
    for (const n of ['renderOnboarding', 'renderLabConversionModal', 'renderProfiloPlaceholder', 'renderMichelinAIGlobalePlaceholder']) assert.strictEqual(c[n](), cm[n](), n);
""")
open(p,'w').write(s)
for p in ['scripts/test-fix2d-lab-weights.js','scripts/test-schede-categorie.js']:
    s=open(p).read()
    old="'function renderProdRecipe(recipe)': '8a9ec67ee54bfdd4',"
    assert s.count(old)==1
    s=s.replace(old,"// Finalizzazione D3: solo il ramo S.uiD3 di \"Elimina\" (classico identico a main, test-preview-direzione-3 P10).\n      'function renderProdRecipe(recipe)': '5f2531985a632050',")
    open(p,'w').write(s)
p='scripts/test-start-home.js'; s=open(p).read()
old="""    const markup = new Function(extractFunction('function renderOnboarding()') + '\\nreturn renderOnboarding();')();"""
assert s.count(old)==1
s=s.replace(old,"""    const markup = new Function('S', extractFunction('function renderOnboarding()') + '\\nreturn renderOnboarding();')({ uiD3: false });""")
open(p,'w').write(s)
print('ok')
EOF
for t in test-preview-direzione-3 test-fix2d-lab-weights test-schede-categorie test-start-home; do echo "$t: $(HTTPS_PROXY=http://127.0.0.1:9 node scripts/$t.js 2>&1 | grep -E 'FAIL|passed' | tr '\n' ' ')"; done
