# 2026-11-01T22:40:41.459Z  esito: ok
# output: "ok\n  FAIL - P2. motore preservato: LAB, scaling, rese, conversioni, Sessioni, salvataggio e MichelinAI identici a main; cambiano solo le funzioni di presentazione\n    AssertionError [ERR_ASSERTION]: MichelinAI invariato: renderMichelinAIGlobalePlaceholder\n    + actual - expected\n    \n      'function"
python3 - <<'EOF'
p='scripts/test-preview-direzione-3.js'; s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1,(s.count(old),old[:70]); s=s.replace(old,new)
rep("""'function onSchedaCategoryChange(recipeId,val)', 'function exportPDF(recipeId,variantId)'];""",
"""'function onSchedaCategoryChange(recipeId,val)', 'function exportPDF(recipeId,variantId)',
  'function tutteLeBozzeLab()', 'function confrontaUltimaModificaBozze(a,b)', 'function searchResultOnclick(r)', 'function renderSearch(query)', 'function renderConfronto(recipe)',
  'function renderOnboarding()', 'function renderProdRecipe(recipe)', 'function renderLabConversionModal()', 'function renderProfiloPlaceholder()', 'function renderMichelinAIGlobalePlaceholder()'];""")
rep("""  const win = { open: () =>""","""  const win = { addEventListener: () => {}, open: () =>""")
rep("""    body: { classList: {""","""    body: { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; }, classList: {""")
rep("""      renderLabGlobaleD3, d3GruppiLab, d3SetLabOrdine, d3LabOrdine};""","""      renderLabGlobaleD3, d3GruppiLab, d3SetLabOrdine, d3LabOrdine,
      renderSearch, renderConfronto, renderOnboarding, renderProdRecipe, renderLabConversionModal, renderProfiloPlaceholder, renderMichelinAIGlobalePlaceholder, d3NomeUnita, d3StatoRicetta};""")
rep("""    assert.deepStrictEqual(cambiate, ['bindEvents', 'confirmMerge', 'deleteRecipe', 'deleteVariant', 'eliminaBozza', 'exportPDF', 'render', 'renderBottomNav', 'renderLabRecipe', 'renderRicettaMadreV2', 'renderSidebar', 'rendiAttiva'].sort(), 'presentazione + ciclo di vita (attivazione diretta eliminata; eliminazioni e Unisci con esito verificato)');""",
"""    assert.deepStrictEqual(cambiate, ['bindEvents', 'confirmMerge', 'deleteRecipe', 'deleteVariant', 'eliminaBozza', 'exportPDF', 'render', 'renderBottomNav', 'renderLabRecipe', 'renderRicettaMadreV2', 'renderSidebar', 'rendiAttiva',
      // Finalizzazione D3: solo presentazione (ramo S.uiD3) e criterio "Ultima modifica" estratto in una funzione condivisa.
      'renderConfronto', 'renderLabConversionModal', 'renderLabGlobale', 'renderMichelinAIGlobalePlaceholder', 'renderOnboarding', 'renderProdRecipe', 'renderProfiloPlaceholder', 'renderSearch'].sort(), 'presentazione + ciclo di vita (attivazione diretta eliminata; eliminazioni e Unisci con esito verificato)');""")
rep("""    assert.strictEqual((h.match(/d3-btn-primary/g) || []).length, 1, 'un solo pulsante terracotta');""","""    assert.strictEqual((h.match(/d3-btn-primary/g) || []).length, 1, 'un solo pulsante principale');""")

nuovi = r"""
  // ══ Finalizzazione grafica ══
  const classico = c => { c.S.uiD3 = false; return c; };
  await test('P18. Ricerca globale: stessi risultati e destinazioni della grafica classica; stato effettivo; nessuna emoji', async () => {
    const c = await setup();
    rec(c).validatedVariants.find(v => v.id === 'vaR').status = 'retired';
    const hc = classico(c).renderSearch('V va');
    c.S.uiD3 = true; const hd = c.renderSearch('V va');
    const dest = h => [...h.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
    assert.ok(dest(hc).length > 3);
    assert.deepStrictEqual(dest(hd), dest(hc), 'stessi risultati, stesso ordine, stesse destinazioni');
    const stati = Object.fromEntries(rec(c).validatedVariants.map(v => [v.name, c.d3StatoRicetta(v)]));
    assert.strictEqual(stati['V vaB'], 'attiva'); assert.strictEqual(stati['V vaP'], 'validata'); assert.strictEqual(stati['V vaR'], 'archiviata');
    for (const [nome, st] of Object.entries(stati)) {
      const riga = hd.split('<button class="d3-ricerca-riga').find(x => x.includes('>' + nome + '<'));
      assert.ok(riga && riga.includes('d3-pill-' + st), nome + ': ' + st);
    }
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(hd), 'nessuna emoji');
    assert.ok(!/Ricetta attiva: V vaP/.test(hd), 'mai "Ricetta attiva" per una Validata');
    assert.ok(/Ricetta attiva: V vaP/.test(hc), 'grafica classica invariata');
    assert.ok(/Nessun risultato/.test(c.renderSearch('zzzz')));
  });

  await test('P19. Confronta Ricette e Benvenuto: niente intestazione viola-indaco ne\' emoji; stessi gestori; classico invariato', async () => {
    const c = await setup(); c.S.uiD3 = true;
    const hd = c.renderConfronto(rec(c)), hc = classico(c).renderConfronto(rec(c));
    assert.ok(!/confronto-header/.test(hd) && /d3-h1 d3-serif">Confronta Ricette/.test(hd));
    assert.ok(/confronto-header/.test(hc), 'classico invariato');
    const selettori = h => h.slice(h.indexOf('<div class="confronto-selectors">'));
    assert.strictEqual(selettori(hd), selettori(hc), 'selezione e confronto identici');
    c.S.uiD3 = true; const od = c.renderOnboarding(), oc = classico(c).renderOnboarding();
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(od) && /Ricetta Validata/.test(od) && !/pronta/.test(od));
    assert.ok(/👨‍🍳/.test(oc) && /Ricetta pronta/.test(oc), 'classico invariato');
    const azione = h => h.match(/onclick="(S\.showOnboarding=false[^"]*)"/)[1];
    assert.strictEqual(azione(od), azione(oc), 'stessa azione "Inizia"');
  });

  await test('P20. Ricetta in Produzione e selettore LAB/Produzione: le regole degli stati restano; "Elimina" esplicito e separato', async () => {
    const c = await setup(); c.S.uiD3 = true; c.S.mode = 'produzione';
    c.S.selectedVariantId = 'vaB'; const att = c.renderProdRecipe(rec(c));
    c.S.selectedVariantId = 'vaP'; const val = c.renderProdRecipe(rec(c));
    c.S.selectedVariantId = 'vaR'; const arc = c.renderProdRecipe(rec(c));
    assert.ok(/openMandaInProduzione\('rB','vaB'\)/.test(att), 'Attiva: Manda in Produzione');
    assert.ok(!/openMandaInProduzione/.test(val) && !/openMandaInProduzione/.test(arc), 'Validata e Archiviata: mai in Produzione dal selettore');
    const azioni = att.slice(att.indexOf('header-actions'), att.indexOf('d3-prod-gestione'));
    assert.ok(!/deleteVariant/.test(azioni), 'nessuna eliminazione fra le azioni di produzione');
    assert.ok(/d3-prod-gestione[\s\S]*non riguarda le Sessioni di Produzione[\s\S]*onclick="deleteVariant\('rB','vaB'\)"[^>]*>Elimina questa Ricetta</.test(att), 'stesso gestore, significato esplicito');
    const cl = classico(c); cl.S.selectedVariantId = 'vaB'; const hc = cl.renderProdRecipe(rec(cl));
    assert.ok(/<i class="ti ti-trash"><\/i> Elimina<\/button>/.test(hc) && !/d3-prod-gestione/.test(hc), 'classico invariato');
    const css = html.slice(html.indexOf('/* Selettore LAB / Produzione'), html.indexOf('/* Confronta Ricette */'));
    assert.ok(/lab-active\{background:var\(--d3-amb-lab\)/.test(css) && /prod-active\{background:var\(--d3-amb-produzione\)/.test(css));
  });

  await test('P21. pulsanti principali nel colore dell\'ambiente, contrasto sufficiente; conversione "pezzi → grammi"; segnaposto con navigazione', async () => {
    const c = await setup(); c.S.uiD3 = true;
    for (const [v, m, amb] of [['recipe', 'lab', 'lab'], ['recipe', 'produzione', 'produzione'], ['ricetta-madre-v2', 'lab', 'schede'], ['load', 'lab', 'schede'], ['attive', 'lab', 'produzione'], ['lab-globale', 'lab', 'lab']]) {
      c.S.view = v; c.S.mode = m; assert.strictEqual(c.d3SezioneNav(), amb, v + '/' + m);
      assert.ok(new RegExp('body\\.ui-d3\\[data-d3-amb="' + amb + '"\\]\\{--d3-primario:var\\(--d3-amb-' + amb + '\\);\\}').test(html), amb);
    }
    assert.ok(/document\.body\.setAttribute\('data-d3-amb',d3SezioneNav\(\)\)/.test(html) && /body\.ui-d3 \.d3-btn-primary\{background:var\(--d3-primario\)/.test(html));
    const colori = Object.fromEntries([...html.match(/body\.ui-d3\{--d3-amb-lab:[^}]*\}/)[0].matchAll(/--d3-amb-(lab|schede|produzione):(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]));
    const lum = h => { const c3 = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * c3[0] + 0.7152 * c3[1] + 0.0722 * c3[2]; };
    for (const [k, h] of Object.entries(colori)) assert.ok(1.05 / (lum(h) + 0.05) >= 4.5, k + ' ' + h + ': testo bianco leggibile');
    assert.strictEqual(Object.keys(colori).length, 3);
    c.S.pendingLabConversion = { recipeId: 'rB', labVersionId: 'lvB', ingId: 'x', ingName: 'Uova (impasto)', fromUnit: 'n', toUnit: 'g', askUnit: 'n', value: '55', isReference: false, loading: false, error: null };
    assert.ok(/Da pezzi → grammi: serve un dato/.test(c.renderLabConversionModal()));
    assert.ok(/Da n a g: serve un dato/.test(classico(c).renderLabConversionModal()), 'classico invariato');
    c.S.uiD3 = true;
    assert.ok(/d3-segnaposto/.test(c.renderProfiloPlaceholder()) && /d3-segnaposto/.test(c.renderMichelinAIGlobalePlaceholder()));
    assert.ok(/const hideSidebar=S\.uiD3\?false:/.test(html), 'barra laterale (e barra in basso) anche nei segnaposto');
  });

  await test('P22. coerenza: conteggio Schede della Home come l\'archivio; un solo criterio "Ultima modifica"; un solo gestore "Nuova Scheda"; scorrimento delle schede del LAB', async () => {
    const c = await setup(); c.S.uiD3 = true;
    c.S.recipes.push({ ...clone(rec(c, 'rX')), id: 'rSub', name: 'Sotto-ricetta', parentRecipeId: 'rX' });
    assert.strictEqual(c.d3ConteggiHome().schede, c.S.recipes.filter(r => !r.parentRecipeId).length);
    assert.strictEqual(c.d3ConteggiHome().schede, 2, 'le sotto-ricette non sono Schede dell\'archivio');
    const fn = topLevelFunctions(html);
    assert.ok(/confrontaUltimaModificaBozze/.test(fn.renderLabGlobale) && /confrontaUltimaModificaBozze/.test(fn.d3GruppiLab));
    assert.ok(!/contenutoModificatoIl/.test(fn.d3GruppiLab) && !/contenutoModificatoIl/.test(fn.renderLabGlobale), 'il criterio vive in un solo punto');
    assert.strictEqual((html.match(/makeDefaultLab\(id,'Nuova Scheda'\)/g) || []).length, 1, 'un solo gestore Nuova Scheda');
    assert.ok(/d3AggiornaScorrimento\(\);\}/.test(fn.render) && /\.d3-scorre-dx\{-webkit-mask-image/.test(html));
  });
"""
anchor="  console.log('\\n' + passed + ' passed, ' + failed + ' failed');"
assert s.count(anchor)==1
s=s.replace(anchor,nuovi+"\n"+anchor)
open(p,'w').write(s); print('ok')
EOF
HTTPS_PROXY=http://127.0.0.1:9 node scripts/test-preview-direzione-3.js 2>&1 | grep -E "FAIL|passed|Error" -A4 | head -50
