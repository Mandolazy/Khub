/*
 * Test — P0-c: integrita' delle quantita' lungo tutto il percorso.
 * Importazione -> Anteprima -> Scheda -> Salvataggio -> Ricaricamento -> LAB ->
 * Validazione -> Ricetta Attiva -> Produzione.
 *
 * Chromium offline sulla demo locale isolata (pagina e api/chat.js reali,
 * database in memoria con dati sintetici, rete bloccata). Simulate solo la
 * lettura delle pagine (fetchUrl) e l'AI. Nessun Supabase, nessuna AI reale.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    ')); }
}
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const ld = o => `<script type="application/ld+json">${JSON.stringify(o).replace(/<\//g, '<\\/')}</script>`;
const RIGHE = ['500 g di farina', "2 spicchi d'aglio", '1 baccello di vaniglia', 'Sale q.b.', 'Burro', '20–30 g acqua'];
const PAGINA = '<html><head>' + ld({ '@type': 'Recipe', name: 'Pane P0-c', recipeIngredient: RIGHE, recipeInstructions: ['Impastare.', 'Cuocere.'] }) + '</head><body></body></html>';

(async () => {
  if (!chromium) { console.log('Playwright non disponibile'); process.exit(1); }
  const porta = await portaLibera();
  const figlio = spawn(process.execPath, [path.join(ROOT, 'demo/direzione-3/server.js'), String(porta)], { env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logDemo = ''; figlio.stdout.on('data', d => { logDemo += d; }); figlio.stderr.on('data', d => { logDemo += d; });
  const t0 = Date.now();
  while (!/Apri nel browser/.test(logDemo)) { if (Date.now() - t0 > 15000) { console.log(logDemo); throw new Error('demo non avviata'); } await new Promise(r => setTimeout(r, 50)); }
  const ORIGINE = 'http://localhost:' + porta;
  const browser = await chromium.launch(); const context = await browser.newContext();
  let rispostaAI = () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error' } } });
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGINE) return route.abort();
    if (/^\/lib\/[a-z]+\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, u.pathname)) });
    if (u.pathname === '/api/chat') {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* vuoto */ }
      if (body.messages) { const r = rispostaAI(body); return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.json) }); }
      if (body.fetchUrl !== undefined) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, html: PAGINA, finalUrl: body.fetchUrl, status: 200 }) });
    }
    return route.continue();
  });
  await context.addInitScript(() => { try { localStorage.setItem('khub_onboarded', '1'); } catch (e) { /* no */ } });
  const page = await context.newPage();
  const errori = []; page.on('pageerror', e => errori.push(String(e && e.message || e)));
  const avvia = async () => { await page.goto(ORIGINE + '/khub_mvp.html?ui=classic'); await page.waitForFunction(() => typeof S !== 'undefined' && S.recipes.length > 0, null, { timeout: 15000 }); };
  await avvia();
  const ev = (f, a) => page.evaluate(f, a);
  const api = body => ev(async b => { const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; }, body);
  const db = async () => (await api({ supabaseAction: 'load' })).json;
  const righeDb = async vid => (await db()).ingredients.filter(i => i.variant_id === vid).sort((a, b) => a.sort_order - b.sort_order);
  const vista = r => [r.name, Number(r.qty), r.unit, r.qty_kind == null ? null : r.qty_kind, r.qty_min == null ? null : Number(r.qty_min), r.qty_max == null ? null : Number(r.qty_max)];

  console.log('P0-c — persistenza: importazione -> anteprima -> Scheda -> ricaricamento -> LAB');
  let idScheda, idBozza;

  await test('P1. anteprima: unita\' della fonte conservate, q.b., quantita\' da indicare e intervallo riconoscibili; nessuno 0 o "g" inventato', async () => {
    await ev(() => { S.view = 'load'; S.loadTab = 'link'; S.loadUrl = 'https://x.test/pane'; render(); });
    await page.click('#btn-extract'); await page.waitForSelector('#btn-save-preview');
    const campi = await ev(() => [...document.querySelectorAll('input[data-field="qty"]')].map((q, i) => [q.value, document.querySelector('select[data-prev-ing="' + i + '"]').value]));
    assert.deepStrictEqual(campi, [['500', 'g'], ['2', 'spicchio'], ['1', 'baccello'], ['q.b.', ''], ['', ''], ['20-30', 'g']]);
    const note = await ev(() => [...document.querySelectorAll('.preview-ing-originale')].map(n => n.textContent));
    assert.ok(note.some(n => /2 spicchi d'aglio.*conversione in grammi/.test(n)) && note.some(n => /Sale q\.b\..*non conteggiata/.test(n)) && note.some(n => /Burro.*da indicare/.test(n)) && note.some(n => /20–30 g acqua.*Produzione/.test(n)), JSON.stringify(note));
    const banda = await page.textContent('.preview-fonte');
    assert.ok(/5 ingredienti da confermare/.test(banda) && /Nessuna diventa 0 g/.test(banda) && !/salva come 0 g/.test(banda), banda);
  });

  await test('P2. salvataggio: tipo, unita\' originale, intervallo e testo della fonte nel database; 0 solo come segnaposto dei tipi non numerici', async () => {
    await page.click('#btn-save-preview'); await page.waitForFunction(() => S.view === 'ricetta-madre-v2'); await page.waitForTimeout(800);
    idScheda = await ev(() => S.selectedId); idBozza = await ev(id => R(id).labVersions[0].id, idScheda);
    const r = await righeDb(idBozza);
    assert.deepStrictEqual(r.map(vista), [['farina', 500, 'g', 'certa', null, null], ['aglio', 2, 'spicchio', 'certa', null, null], ['vaniglia', 1, 'baccello', 'certa', null, null],
      ['Sale', 0, 'g', 'variabile', null, null], ['Burro', 0, 'g', 'mancante', null, null], ['acqua', 0, 'g', 'intervallo', 20, 30]]);
    assert.deepStrictEqual(r.map(x => x.source_text), RIGHE, 'testo originale conservato');
  });

  await test('P3. ricaricamento e LAB: stessi tipi e valori; campi del LAB come nella fonte; firma della bozza stabile', async () => {
    const firmaPrima = (await db()).variants.find(v => v.id === idBozza).contenuto_hash;
    await avvia();
    const ings = await ev(id => R(id).labVersions[0].ingredients.map(i => [i.name, i.qty, i.unit, i.qtyKind, i.qtyMin, i.qtyMax, i.sourceText]), idScheda);
    assert.deepStrictEqual(ings.map(x => x.slice(0, 6)), [['farina', 500, 'g', 'certa', null, null], ['aglio', 2, 'spicchio', 'certa', null, null], ['vaniglia', 1, 'baccello', 'certa', null, null],
      ['Sale', null, 'g', 'variabile', null, null], ['Burro', null, 'g', 'mancante', null, null], ['acqua', null, 'g', 'intervallo', 20, 30]]);
    assert.deepStrictEqual(ings.map(x => x[6]), RIGHE);
    assert.strictEqual(await ev(id => firmaContenutoBozza(R(id).labVersions[0]), idScheda), firmaPrima, 'firma identica dopo la rilettura');
    await ev(id => { S.view = 'recipe'; S.mode = 'lab'; S.selectedId = id; render(); }, idScheda); await page.waitForTimeout(200);
    const lab = await ev(() => [...document.querySelectorAll('.ing-table tbody tr')].map(tr => { const ins = tr.querySelectorAll('input'); const s = tr.querySelector('select'); return [ins[1] && ins[1].value, s && s.value]; }).filter(x => x[0] != null));
    assert.deepStrictEqual(lab, [['500', 'g'], ['2', 'spicchio'], ['1', 'baccello'], ['q.b.', 'g'], ['', 'g'], ['20-30', 'g']]);
    const testo = await page.textContent('.ing-table');
    assert.ok(/conversione in grammi da confermare/.test(testo) && /esclusa dai pesi/.test(testo) && /quantità da indicare/.test(testo) && /intervallo/.test(testo));
    assert.ok(/non hanno la quantità|non ha la quantità/.test(await page.textContent('body')), 'avviso nel LAB');
  });

  console.log('P0-c — calcoli');
  await test('C1. pesi: certa calcolata; conversione nota; conversione assente; q.b. escluso con indicazione; intervallo e mancante non risolti; mai un totale falsamente completo', async () => {
    const r = await ev(() => {
      S.productionConversionFacts['aglio|spicchio|g'] = { id: 'tf', factor: 5, sourceType: 'chef_confirmed' };
      const I = (name, qty, unit, k, extra) => Object.assign({ id: name, name, qty, unit, estimatedYieldPct: null }, k ? { qtyKind: k } : {}, extra || {});
      const w = l => { const x = computeFormulationWeights(l); return { status: x.status, raw: x.raw, excluded: (x.excluded || []).map(e => e.name), unresolved: (x.unresolved || []).map(e => e.name + ':' + e.kind), missing: (x.missing || []).map(e => e.name) }; };
      const out = {
        certa: w([I('farina', 500, 'g', 'certa')]),
        nota: w([I('farina', 500, 'g', 'certa'), I('aglio', 2, 'spicchio', 'certa')]),
        assente: w([I('farina', 500, 'g', 'certa'), I('vaniglia', 1, 'baccello', 'certa')]),
        qb: w([I('farina', 500, 'g', 'certa'), I('Sale', null, 'g', 'variabile')]),
        intervallo: w([I('farina', 500, 'g', 'certa'), I('acqua', null, 'g', 'intervallo', { qtyMin: 20, qtyMax: 30 })]),
        mancante: w([I('farina', 500, 'g', 'certa'), I('Burro', null, 'g', 'mancante')]),
        precedente: w([I('farina', 500, 'g'), I('Sale', 0, 'g')]),
      };
      delete S.productionConversionFacts['aglio|spicchio|g'];
      return out;
    });
    assert.deepStrictEqual(r.certa, { status: 'complete', raw: 500, excluded: [], unresolved: [], missing: [] });
    assert.deepStrictEqual(r.nota, { status: 'complete', raw: 510, excluded: [], unresolved: [], missing: [] }, '2 spicchi x 5 g (fatto confermato)');
    assert.deepStrictEqual(r.assente.status, 'incomplete'); assert.deepStrictEqual(r.assente.missing, ['vaniglia']);
    assert.deepStrictEqual(r.qb, { status: 'complete', raw: 500, excluded: ['Sale'], unresolved: [], missing: [] }, 'q.b. escluso, non 0 g');
    assert.strictEqual(r.intervallo.status, 'unresolved'); assert.deepStrictEqual(r.intervallo.unresolved, ['acqua:intervallo']);
    assert.strictEqual(r.mancante.status, 'unresolved'); assert.deepStrictEqual(r.mancante.unresolved, ['Burro:mancante']);
    assert.deepStrictEqual(r.precedente, { status: 'complete', raw: 500, excluded: [], unresolved: [], missing: [] }, 'Ricetta precedente: come prima');
  });

  await test('C2. LAB: lo chef indica la quantita\' mancante e cambia il tipo scrivendo nel campo (numero, q.b., intervallo); testo non valido rifiutato', async () => {
    await ev(id => { S.view = 'recipe'; S.mode = 'lab'; S.selectedId = id; render(); }, idScheda);
    const stato = () => ev(id => R(id).labVersions[0].ingredients.map(i => [i.name, i.qty, i.qtyKind, i.qtyMin, i.qtyMax]), idScheda);
    const idIng = await ev(id => R(id).labVersions[0].ingredients.map(i => i.id), idScheda);
    await ev(([id, ing]) => onIngQtyTesto(id, ing, '100'), [idScheda, idIng[4]]);
    await ev(([id, ing]) => onIngQtyTesto(id, ing, 'qb'), [idScheda, idIng[0]]);
    await ev(([id, ing]) => onIngQtyTesto(id, ing, '500'), [idScheda, idIng[0]]);
    await ev(([id, ing]) => onIngQtyTesto(id, ing, '3-4'), [idScheda, idIng[1]]);
    await ev(([id, ing]) => onIngQtyTesto(id, ing, '2'), [idScheda, idIng[1]]);
    await ev(([id, ing]) => onIngQtyTesto(id, ing, 'boh'), [idScheda, idIng[2]]);
    await ev(([id, ing]) => onIngQtyTesto(id, ing, ''), [idScheda, idIng[2]]);
    await ev(([id, ing]) => onIngQtyTesto(id, ing, '1'), [idScheda, idIng[2]]);
    assert.deepStrictEqual((await stato()).slice(0, 5), [['farina', 500, 'certa', null, null], ['aglio', 2, 'certa', null, null], ['vaniglia', 1, 'certa', null, null], ['Sale', null, 'variabile', null, null], ['Burro', 100, 'certa', null, null]]);
    await page.waitForTimeout(2500); // autosave: attesa di 1,5 s dopo l'ultima modifica
    assert.deepStrictEqual((await righeDb(idBozza)).map(vista)[4], ['Burro', 100, 'g', 'certa', null, null], 'salvato');
  });

  console.log('P0-c — validazione, attivazione e controlli del server');
  // Ricetta di prova costruita con lo stesso salvataggio dell'app: una bozza e,
  // dopo la validazione, una Ricetta validata con ingredienti di ogni tipo.
  const ING = (vid, k, name, qty, unit, extra) => Object.assign({ id: vid + '_' + name, variant_id: vid, name, qty, unit, sort_order: 0, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null }, k ? { qty_kind: k } : {}, extra || {});
  const VAR = (id, status, active) => ({ id, recipe_id: 'rP0c', name: 'Ricetta ' + id, label: id, status, active, steps: JSON.stringify(['Impastare.']), steps_v2: [{ id: 's1', order: 0, text: 'Impastare.', expectedDurationSeconds: null }] });
  const salva = (variants, ingredients, extra) => api({ supabaseAction: 'save', data: Object.assign({ recipe: { id: 'rP0c', name: 'Scheda P0-c', category: 'Test', department: 'Cucina' }, variants, ingredients, deletedIngredients: [], l2Items: [], l3Items: [] }, extra || {}) });
  const esito = r => (r.json && r.json.ok === true) ? 'ok' : (r.json && r.json.code);

  await test('V1. quantita\' mancante: validazione ammessa, attivazione rifiutata dal server; risolta la quantita\', attivazione ammessa', async () => {
    assert.strictEqual(esito(await salva([VAR('vM', 'lab', false)], [ING('vM', 'certa', 'farina', 500, 'g'), ING('vM', 'mancante', 'burro', 0, 'g')])), 'ok');
    assert.strictEqual(esito(await salva([VAR('vM', 'validated', false)], [ING('vM', 'certa', 'farina', 500, 'g'), ING('vM', 'mancante', 'burro', 0, 'g')])), 'ok', 'validazione gastronomica');
    const r = await salva([VAR('vM', 'validated', true)], []);
    assert.strictEqual(esito(r), 'quantita_mancante'); assert.ok(/burro/.test(r.json.errors[0]), r.json.errors[0]);
    assert.strictEqual((await db()).variants.find(v => v.id === 'vM').active, false, 'nulla scritto');
  });

  await test('V2. q.b., intervallo e conversione da confermare: attivazione ammessa (nessun blocco)', async () => {
    const ings = [ING('vQ', 'certa', 'farina', 500, 'g'), ING('vQ', 'variabile', 'sale', 0, 'g'), ING('vQ', 'intervallo', 'acqua', 0, 'g', { qty_min: 20, qty_max: 30 }), ING('vQ', 'certa', 'aglio', 2, 'spicchio')];
    assert.strictEqual(esito(await salva([VAR('vQ', 'lab', false)], ings)), 'ok');
    assert.strictEqual(esito(await salva([VAR('vQ', 'validated', false)], ings)), 'ok');
    assert.strictEqual(esito(await salva([VAR('vQ', 'validated', true)], [])), 'ok');
  });

  await test('V3. valori non coerenti rifiutati prima di scrivere: tipo sconosciuto, certa non positiva, segnaposto non nullo, intervallo errato, testo troppo lungo', async () => {
    const casi = [[ING('vX', 'stimata', 'a', 1, 'g'), 'tipo'], [ING('vX', 'certa', 'a', 0, 'g'), 'certa'], [ING('vX', 'variabile', 'a', 5, 'g'), 'segnaposto'],
      [ING('vX', 'intervallo', 'a', 0, 'g', { qty_min: 30, qty_max: 20 }), 'intervallo'], [ING('vX', null, 'a', 1, 'g', { qty_min: 1, qty_max: 2 }), 'minimo senza tipo'],
      [ING('vX', 'certa', 'a', 1, 'g', { source_text: 'x'.repeat(301) }), 'testo']];
    for (const [riga, nome] of casi) {
      const r = await salva([VAR('vX', 'lab', false)], [riga]);
      assert.strictEqual(esito(r), 'quantita_non_valida', nome);
    }
    assert.ok(!(await db()).variants.some(v => v.id === 'vX'), 'nessuna scrittura');
  });

  await test('V4. protezione della formulazione: in una Ricetta validata il tipo di quantita\' non cambia sul posto', async () => {
    const r = await salva([VAR('vQ', 'validated', true)], [ING('vQ', 'mancante', 'sale', 0, 'g')]);
    assert.strictEqual(esito(r), 'formulazione_protetta');
  });

  await test('V5. nessun blocco retroattivo: Ricetta precedente (senza tipo) con quantita\' 0 attivabile come prima', async () => {
    const ings = [ING('vL', null, 'farina', 500, 'g'), ING('vL', null, 'sale', 0, 'g')];
    assert.strictEqual(esito(await salva([VAR('vL', 'lab', false)], ings)), 'ok');
    assert.strictEqual(esito(await salva([VAR('vL', 'validated', false)], ings)), 'ok');
    assert.strictEqual(esito(await salva([VAR('vL', 'validated', true)], [])), 'ok');
  });

  await test('V6. Sessione di Produzione: il server rifiuta uno snapshot con quantita\' da indicare o intervallo senza valore scelto', async () => {
    const sess = (id, ing) => api({ supabaseAction: 'update', table: 'production_sessions', data: { id, recipe_id: 'rP0c', source_variant_id: 'vQ', status: 'pending', snapshot_version: 1,
      snapshot: { ingredients: [{ itemKey: 'a', name: 'farina', unit: 'g', baseQty: 500, operativeQty: 500 }, ing] }, target_finished_total: 1000 } });
    for (const [k, nome] of [['mancante', 'mancante'], ['intervallo', 'intervallo']]) {
      const r = await sess('psX_' + k, { itemKey: 'b', name: 'acqua', unit: 'g', qtyKind: k });
      assert.ok(r.json && r.json.error && /non risolte/.test(r.json.error), nome + ': ' + JSON.stringify(r.json));
    }
  });

  console.log('P0-c — Produzione');
  await test('R1. Manda in Produzione: intervallo da scegliere (fuori intervallo rifiutato); q.b. in Sessione come "q.b."; valore scelto e intervallo nello snapshot', async () => {
    await avvia();
    const vid = 'vQ';
    await ev(v => openMandaInProduzione('rP0c', v, { portions: 10, gpp: 100 }), vid);
    const etichetta = await page.textContent('.manda-intervalli');
    assert.ok(/acqua/.test(etichetta) && /20–30 g/.test(etichetta), etichetta);
    await ev(() => confirmMandaInProduzione()); await page.waitForTimeout(200);
    assert.ok(/Scegli la quantità di «acqua»/.test(await ev(() => S.pendingMandaInProduzione.error)));
    await ev(v => sceltaIntervalloProduzione(v, v + '_acqua', '40'), vid);
    await ev(() => confirmMandaInProduzione()); await page.waitForTimeout(200);
    assert.ok(/Scegli la quantità di «acqua»/.test(await ev(() => S.pendingMandaInProduzione.error)), 'fuori intervallo');
    await ev(v => sceltaIntervalloProduzione(v, v + '_acqua', '25'), vid);
    await ev(() => confirmMandaInProduzione()); await page.waitForTimeout(300);
    // Conversione dello spicchio: richiesta con il sistema esistente.
    const pf = await ev(() => S.pendingConversionPreflight && S.pendingConversionPreflight.missing.map(m => m.ingredientName + ':' + m.currentUnit));
    assert.deepStrictEqual(pf, ['aglio:spicchio'], 'conversione chiesta in Produzione');
    await ev(() => confirmConversionPreflightStep('5')); await page.waitForTimeout(800);
    const sess = ((await api({ supabaseAction: 'loadProductionSessions' })).json.sessions || []).filter(s => s.source_variant_id === vid).pop();
    assert.ok(sess, 'Sessione creata');
    const ingS = sess.snapshot.ingredients.map(i => [i.name, i.qtyKind || null, i.baseQty, i.operativeQty == null ? null : Math.round(i.operativeQty * 100) / 100, i.intervallo || null]);
    assert.deepStrictEqual(ingS.find(x => x[0] === 'sale'), ['sale', 'variabile', null, null, null], 'q.b. senza quantita\'');
    assert.deepStrictEqual(ingS.find(x => x[0] === 'acqua').slice(0, 3).concat([ingS.find(x => x[0] === 'acqua')[4]]), ['acqua', null, 25, { min: 20, max: 30 }], 'valore scelto e intervallo');
    assert.strictEqual(sess.snapshot.ingredients.find(i => i.name === 'aglio').conversionSourceType, 'chef_confirmed');
    await ev(id => goToNewProductionSession(id), sess.id); await page.waitForTimeout(400);
    assert.ok(/sale[\s\S]*q\.b\./.test(await page.textContent('body')), 'Sessione: q.b.');
    assert.deepStrictEqual(errori, []);
  });

  await browser.close(); figlio.kill();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack || e); process.exit(1); });
