/*
 * Test — Calcolo rapido non distruttivo (Ricetta attiva).
 * Nessun framework: Node puro + assert.
 *
 * Codice REALE estratto da khub_mvp.html: vista Ricetta (renderProdRecipe),
 * Calcolo rapido, motore delle Sessioni (buildPreparedInputDaRicettaAttiva,
 * computeSessionScaling), preflight conversioni, modale e conferma di
 * "Manda in Produzione", createProductionSession; api/chat.js (handler) contro
 * un finto PostgREST in memoria. upRec/autosave/saveToSupabase sono SPIE: il
 * Calcolo rapido non deve mai chiamarle.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
console.error = () => {};
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
const chatSrc = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); failed++; }
}
function extractFunction(startMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error('marker non trovato: ' + startMarker);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('graffe non bilanciate: ' + startMarker);
}

// Finto PostgREST: GET con eq, POST insert/upsert (merge-duplicates), DELETE per id.
function makeFakeSupabase() {
  const tables = {};
  const calls = [];
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)), text: async () => JSON.stringify(data) });
  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    const method = opts.method || 'GET';
    const filters = [];
    for (const [k, raw] of u.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      const dot = raw.indexOf('.'); filters.push([k, raw.slice(0, dot), raw.slice(dot + 1)]);
    }
    calls.push({ method, table, body: opts.body ? JSON.parse(opts.body) : null });
    const rows = tables[table] = tables[table] || [];
    const match = (r) => filters.every(([c, op, v]) => op === 'eq' && String(r[c]) === v);
    if (method === 'GET') return reply(200, rows.filter(match));
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      for (const row of Array.isArray(body) ? body : [body]) {
        const i = rows.findIndex(r => r.id === row.id);
        if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push({ ...row });
      }
      return reply(201, null);
    }
    if (method === 'DELETE') { tables[table] = rows.filter(r => !match(r)); return reply(204, null); }
    return reply(500, { message: 'metodo non atteso: ' + method });
  }
  return { tables, calls, fetch };
}
async function loadHandler() {
  return (await import('data:text/javascript;base64,' + Buffer.from(chatSrc).toString('base64'))).default;
}

const CLIENT_SRC = [
  'function escAttr(s)', 'function uid()', 'function cnum(n)', 'function normalizeIngredientName(name)', 'function R(id)',
  'function activeVariants(recipe)', 'function effectiveYield(ing)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function sessionScalingUnitFamily(unit)', 'function resolveSessionScalingConversionToGrams(unit,conversionFact)',
  'function chooseConversionAskUnit(unit)', 'function resolveKnownProductionConversionFact(normalizedName,unit)',
  'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)',
  'function findMissingProductionConversions(preparedInput)', 'function computeSessionScaling(input)', 'function buildSessionSnapshotV1(meta,computed)',
  'async function _supabaseUpsertRow(table,data)', 'async function _supabaseDeleteRow(table,id)', 'async function createProductionSession(preparedInput)',
  'function canSendToProduction(vv)', 'function findRecipeVariant(recipeId,variantId)',
  'function openMandaInProduzione(recipeId,variantId,target)', 'function onMandaInProduzioneField(field,val)', 'async function confirmMandaInProduzione()',
  'function renderMandaInProduzioneModal()',
  'async function saveIngredientConversion(ingredientName,fromUnit,toUnit,factor,sourceType,sourceDetail)',
  'async function confirmConversionPreflightStep(rawValue)', 'function cancelConversionPreflight()',
  // Calcolo rapido
  'function parseQuickCalcNumber(text)', 'function computeQuickCalc(recipe,vv,portionsText,gppText)', 'function formatQuickCalcQty(qty,unit)',
  'function openQuickCalc(recipeId,variantId)', 'function closeQuickCalc()', 'function onQuickCalcInput(field,value)', 'function syncQuickCalcScope()',
  'function openQuickCalcConversions()', 'function sendQuickCalcToProduction()', 'function renderQuickCalcPanel(recipe,vv)',
  'function computeRecipeWeightSummary(recipe,vv)', 'function renderProdRecipe(recipe)',
  'function goToNewProductionSession(sessionId)', 'function isHighlightedProductionSession(id)', 'function revealProductionHighlight()',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g)).join('\n');

// Ricetta attiva di riferimento: 4 porzioni x 250 g; unita' miste e una resa.
function recipes() {
  const ing = (id, name, qty, unit, y) => ({ id, name, qty, unit, estimatedYieldPct: y == null ? null : y });
  return [{
    id: 'r1', name: 'Torta di mele', category: 'Dolci', parentRecipeId: null, labVersions: [],
    validatedVariants: [
      { id: 'v1', name: 'Torta classica', active: true, status: 'validated', portionsCount: 4, gramsPerPortion: 250, validatedAt: '01/10/2026',
        ingredients: [ing('i1', 'Farina', 500, 'g'), ing('i2', 'Zucchero', 0.2, 'kg'), ing('i3', 'Latte', 300, 'ml'), ing('i4', 'Uova', 2, 'n'), ing('i5', 'Burro', 100, 'g', 80)],
        steps: ['Impastare', 'Cuocere'], stepsV2: [{ id: 'stA', order: 0, text: 'Impastare', expectedDurationSeconds: null }, { id: 'stB', order: 1, text: 'Cuocere', expectedDurationSeconds: 2400 }] },
      { id: 'v2', name: 'Torta leggera', active: false, status: 'validated', portionsCount: 4, gramsPerPortion: 200, validatedAt: '02/10/2026',
        ingredients: [ing('j1', 'Farina', 400, 'g')], steps: [], stepsV2: [] },
    ],
  }];
}

function makeClient(handler, opts = {}) {
  const apiCalls = [], toasts = [], spy = { upRec: 0, autosave: 0, saveToSupabase: 0 };
  const clientFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    apiCalls.push(body);
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { ok: status < 400, status, json: async () => out };
  };
  const last = { html: '' };
  const doc = { getElementById: () => null };
  const S = { view: 'recipe', mode: 'produzione', selectedId: 'r1', selectedVariantId: 'v1', recipes: recipes(), quickCalc: null,
    pendingMandaInProduzione: null, pendingConversionPreflight: null, variantFamilies: {}, families: [],
    unitWeights: { uova: 55 }, unitWeightFacts: { uova: { id: 'icU', sourceType: 'chef_confirmed', sourceDetail: null } },
    productionConversionFacts: opts.noMilkFact ? {} : { 'latte|ml|g': { id: 'icL', factor: 1.03, sourceType: 'chef_confirmed', sourceDetail: null } } };
  const api = new Function('S', 'fetch', 'toast', 'console', 'document', '__last', '__spy', `
    function upRec(){ __spy.upRec++; }
    function autosave(){ __spy.autosave++; }
    function saveToSupabase(){ __spy.saveToSupabase++; }
    function render(){
      syncQuickCalcScope();
      var r = S.recipes.find(function(x){return x.id===S.selectedId;});
      __last.html = (S.view==='recipe'&&S.mode==='produzione'&&r ? renderProdRecipe(r) : '') + renderMandaInProduzioneModal();
    }
    ${CLIENT_SRC}
    return { render, openQuickCalc, closeQuickCalc, onQuickCalcInput, openQuickCalcConversions, sendQuickCalcToProduction,
      openMandaInProduzione, onMandaInProduzioneField, confirmMandaInProduzione, confirmConversionPreflightStep, computeQuickCalc,
      computeSessionScaling, buildPreparedInputDaRicettaAttiva, renderMandaInProduzioneModal };`)(
    S, clientFetch, (m) => toasts.push(m), { error() {} }, doc, last, spy);
  return { S, api, apiCalls, toasts, last, spy };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  function freshDb() { const fake = makeFakeSupabase(); globalThis.fetch = fake.fetch; return fake; }
  const qtys = (h) => Object.fromEntries([...h.matchAll(/data-qc-item="([^"]*)"><td class="ing-name">[\s\S]*?<\/td><td class="qc-qty">([^<]*)<\/td>/g)].map(m => [m[1], m[2]]));
  const recipeWrites = (fake, c) => fake.calls.filter(x => x.method !== 'GET' && ['recipes', 'variants', 'ingredients'].includes(x.table)).length
    + c.apiCalls.filter(x => x.supabaseAction === 'save' || (x.supabaseAction === 'update' && ['recipes', 'variants', 'ingredients'].includes(x.table))).length;
  // Riferimento indipendente: stesso motore delle Sessioni sui dati salvati.
  const expected = (c, p, g) => c.api.computeSessionScaling(c.api.buildPreparedInputDaRicettaAttiva(c.S.recipes[0], c.S.recipes[0].validatedVariants[0], p, g));

  console.log('Calcolo rapido — non distruttivo');

  await test('accesso: "Calcolo rapido" e "Manda in Produzione" distinti, solo per la Ricetta attiva; vista base in sola lettura', async () => {
    freshDb();
    const c = makeClient(handler);
    c.api.render();
    const h = c.last.html;
    assert.ok(h.includes('id="btn-quick-calc"') && h.includes("openQuickCalc('r1','v1')"));
    assert.ok(h.includes("openMandaInProduzione('r1','v1')"), 'Manda in Produzione diretto presente');
    assert.ok(!/ing-qty-input|unit-select|onVarPortions|onVarGpp|onVarIngQty|onVarIngUnit|class="scale-input"/.test(h), 'nessun campo che modifica la Ricetta');
    assert.ok(!h.includes('id="quick-calc"'), 'calcolatore chiuso finche\' non lo si apre');
    c.S.selectedVariantId = 'v2'; c.api.render();
    assert.ok(!c.last.html.includes('btn-quick-calc') && !c.last.html.includes('openMandaInProduzione'), 'variante non attiva: nessuna azione');
    c.api.openQuickCalc('r1', 'v2');
    assert.strictEqual(c.S.quickCalc, null);
  });

  await test('apertura: parte dai valori salvati (4 x 250); quantita\' = motore delle Sessioni', async () => {
    freshDb();
    const c = makeClient(handler);
    c.api.openQuickCalc('r1', 'v1');
    assert.deepStrictEqual(c.S.quickCalc, { recipeId: 'r1', variantId: 'v1', portions: '4', gpp: '250' });
    const h = c.last.html;
    assert.ok(h.includes('id="quick-calc"') && h.includes('value="4"') && h.includes('value="250"'));
    assert.ok(h.includes('Prodotto finito: <strong>1000 g</strong>') || h.includes('Prodotto finito: <strong>1.000 g</strong>'));
    const r = c.api.computeQuickCalc(c.S.recipes[0], c.S.recipes[0].validatedVariants[0], '4', '250').result;
    assert.deepStrictEqual(r, expected(c, 4, 250));
  });

  await test('porzioni e g/porzione aggiornano le quantita\'; la Ricetta attiva resta identica in memoria e su Supabase', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    const prima = JSON.stringify(c.S.recipes);
    c.api.openQuickCalc('r1', 'v1');
    const q0 = qtys(c.last.html);
    c.api.onQuickCalcInput('portions', '73');
    const q1 = qtys(c.last.html);
    assert.notDeepStrictEqual(q1, q0, 'cambiano con le porzioni');
    c.api.onQuickCalcInput('gpp', '150');
    const q2 = qtys(c.last.html);
    assert.notDeepStrictEqual(q2, q1, 'cambiano con i g/porzione');
    const ex = expected(c, 73, 150);
    assert.ok(c.last.html.includes('(73 porz. × 150 g)'));
    assert.strictEqual(ex.targetFinishedTotal, 10950);
    for (const i of ex.ingredients) assert.strictEqual(q2[i.itemKey], Number(i.operativeQty).toLocaleString('it-IT', { maximumFractionDigits: i.unit === 'kg' || i.unit === 'l' ? 3 : (Math.abs(i.operativeQty) < 10 ? 2 : 1) }), i.name);
    assert.strictEqual(JSON.stringify(c.S.recipes), prima, 'Ricetta attiva invariata in memoria');
    assert.deepStrictEqual(c.spy, { upRec: 0, autosave: 0, saveToSupabase: 0 }, 'nessun upRec/autosave/saveToSupabase');
    assert.strictEqual(recipeWrites(fake, c), 0, 'nessuna scrittura su Supabase');
  });

  await test('nessun arrotondamento progressivo: 73 -> 3 -> 73 da\' esattamente gli stessi valori', async () => {
    freshDb();
    const c = makeClient(handler);
    c.api.openQuickCalc('r1', 'v1');
    const vv = c.S.recipes[0].validatedVariants[0];
    const a = c.api.computeQuickCalc(c.S.recipes[0], vv, '73', '150').result;
    for (const p of ['3', '1,5', '999', '73']) c.api.onQuickCalcInput('portions', p);
    c.api.onQuickCalcInput('gpp', '150');
    const b = c.api.computeQuickCalc(c.S.recipes[0], vv, c.S.quickCalc.portions, c.S.quickCalc.gpp).result;
    assert.deepStrictEqual(b, a);
    assert.deepStrictEqual(vv.ingredients.map(i => i.qty), [500, 0.2, 300, 2, 100], 'quantita\' di riferimento intatte');
  });

  await test('uscita: Chiudi, cambio vista o variante scartano il target; riapertura dai dati originali', async () => {
    freshDb();
    const c = makeClient(handler);
    c.api.openQuickCalc('r1', 'v1');
    c.api.onQuickCalcInput('portions', '73');
    c.api.closeQuickCalc();
    assert.strictEqual(c.S.quickCalc, null);
    assert.ok(!c.last.html.includes('id="quick-calc"'));
    c.api.openQuickCalc('r1', 'v1');
    assert.strictEqual(c.S.quickCalc.portions, '4', 'riparte dai valori salvati');
    c.api.onQuickCalcInput('gpp', '999');
    c.S.view = 'attive'; c.api.render();
    assert.strictEqual(c.S.quickCalc, null, 'uscendo dalla Ricetta il target viene scartato');
    c.S.view = 'recipe'; c.api.openQuickCalc('r1', 'v1');
    c.S.mode = 'lab'; c.api.render();
    assert.strictEqual(c.S.quickCalc, null, 'passando al LAB viene scartato');
    c.S.mode = 'produzione'; c.api.openQuickCalc('r1', 'v1');
    c.S.selectedVariantId = 'v2'; c.api.render();
    assert.strictEqual(c.S.quickCalc, null, 'cambiando variante viene scartato');
  });

  await test('Manda in Produzione dal calcolatore: modale esistente precompilato (73 x 150); Sessione coerente; Ricetta invariata', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    const prima = JSON.stringify(c.S.recipes);
    c.api.openQuickCalc('r1', 'v1');
    c.api.onQuickCalcInput('portions', '73');
    c.api.onQuickCalcInput('gpp', '150');
    const calc = c.api.computeQuickCalc(c.S.recipes[0], c.S.recipes[0].validatedVariants[0], '73', '150').result;
    c.api.sendQuickCalcToProduction();
    assert.deepStrictEqual([c.S.pendingMandaInProduzione.portions, c.S.pendingMandaInProduzione.gpp], ['73', '150']);
    assert.ok(c.last.html.includes('value="73"') && c.last.html.includes('value="150"'), 'modale precompilato');
    assert.strictEqual(fake.calls.filter(x => x.table === 'production_sessions').length, 0, 'il calcolatore non crea Sessioni da solo');
    await c.api.confirmMandaInProduzione();
    const sess = fake.tables.production_sessions;
    assert.strictEqual(sess.length, 1, 'Sessione creata solo dalla conferma');
    const snap = sess[0].snapshot;
    assert.deepStrictEqual([snap.target.targetPortions, snap.target.targetGramsPerPortion, sess[0].target_finished_total], [73, 150, 10950]);
    assert.deepStrictEqual(snap.ingredients.map(i => [i.itemKey, i.operativeQty]), calc.ingredients.map(i => [i.itemKey, i.operativeQty]), 'stesse quantita\' del Calcolo rapido');
    assert.deepStrictEqual(snap.ingredients.map(i => i.baseQty), [500, 0.2, 300, 2, 100], 'dalla formulazione originale');
    assert.strictEqual(JSON.stringify(c.S.recipes), prima);
    assert.deepStrictEqual(c.spy, { upRec: 0, autosave: 0, saveToSupabase: 0 });
    assert.strictEqual(recipeWrites(fake, c), 0);
  });

  await test('Manda in Produzione diretto (senza calcolatore): modale vuoto, Sessione col target digitato', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    c.api.openMandaInProduzione('r1', 'v1');
    assert.deepStrictEqual([c.S.pendingMandaInProduzione.portions, c.S.pendingMandaInProduzione.gpp], ['', '']);
    c.api.onMandaInProduzioneField('portions', '10');
    c.api.onMandaInProduzioneField('gpp', '120');
    await c.api.confirmMandaInProduzione();
    assert.strictEqual(fake.tables.production_sessions.length, 1);
    assert.strictEqual(fake.tables.production_sessions[0].target_finished_total, 1200);
    assert.strictEqual(c.S.quickCalc, null);
  });

  await test('rese e conversioni: resa per ingrediente rispettata, ml mai trattati come g, kg convertiti', async () => {
    freshDb();
    const c = makeClient(handler);
    const r = c.api.computeQuickCalc(c.S.recipes[0], c.S.recipes[0].validatedVariants[0], '4', '250').result;
    // base finita: farina 500 + zucchero 0,2 kg = 200 g + latte 300 ml x 1,03 + uova 2 x 55 + burro 100 x 80%
    const base = 500 + 200 + 300 * 1.03 + 2 * 55 + 100 * 0.8;
    assert.ok(Math.abs(r.baseExpectedFinishedTotal - base) < 1e-9);
    assert.ok(Math.abs(r.scaleFactor - 1000 / base) < 1e-12);
    const burro = r.ingredients.find(i => i.itemKey === 'i5');
    assert.strictEqual(burro.estimatedYieldPct, 80);
    assert.strictEqual(r.ingredients.find(i => i.itemKey === 'i2').unit, 'kg', 'quantita\' nell\'unita\' originale');
    const c2 = makeClient(handler, { noMilkFact: true });
    const m = c2.api.computeQuickCalc(c2.S.recipes[0], c2.S.recipes[0].validatedVariants[0], '4', '250');
    assert.strictEqual(m.error, 'missing_conversions', 'senza fatto ml->g il latte NON viene equiparato ai grammi');
    assert.deepStrictEqual(m.missing.map(x => [x.ingredientName, x.currentUnit]), [['Latte', 'ml']]);
  });

  await test('conversione mancante: richiesta con il preflight esistente, salva SOLO il fatto, nessuna Sessione, poi calcola', async () => {
    const fake = freshDb();
    const c = makeClient(handler, { noMilkFact: true });
    const prima = JSON.stringify(c.S.recipes);
    c.api.openQuickCalc('r1', 'v1');
    assert.ok(c.last.html.includes('Latte (ml)') && c.last.html.includes('id="qc-conversions"'));
    assert.ok(!c.last.html.includes('id="qc-send"'), 'niente invio senza calcolo completo');
    c.api.openQuickCalcConversions();
    assert.strictEqual(c.S.pendingConversionPreflight.purpose, 'quickcalc');
    await c.api.confirmConversionPreflightStep('1,03'.replace(',', '.'));
    const saved = c.apiCalls.filter(x => x.supabaseAction === 'saveConversion');
    assert.strictEqual(saved.length, 1);
    assert.deepStrictEqual([saved[0].conversion.ingredient_name, saved[0].conversion.from_unit, saved[0].conversion.to_unit, saved[0].conversion.factor, saved[0].conversion.source_type], ['latte', 'ml', 'g', 1.03, 'chef_confirmed']);
    assert.ok(c.S.productionConversionFacts['latte|ml|g'], 'fatto disponibile subito');
    assert.strictEqual(c.S.pendingConversionPreflight, null);
    assert.strictEqual((fake.tables.production_sessions || []).length, 0, 'nessuna Sessione creata');
    c.api.render();
    assert.ok(c.last.html.includes('data-qc-item="i3"') && c.last.html.includes('id="qc-send"'), 'calcolo completo dopo la conferma');
    assert.strictEqual(JSON.stringify(c.S.recipes), prima, 'formulazione non toccata');
    assert.deepStrictEqual(c.spy, { upRec: 0, autosave: 0, saveToSupabase: 0 });
  });

  await test('target non valido: messaggio, nessun invio; virgola decimale accettata', async () => {
    freshDb();
    const c = makeClient(handler);
    c.api.openQuickCalc('r1', 'v1');
    for (const v of ['0', '-3', 'abc', '']) {
      c.api.onQuickCalcInput('portions', v);
      assert.ok(c.last.html.includes('Inserisci un numero di porzioni') && !c.last.html.includes('id="qc-send"'), JSON.stringify(v));
    }
    c.api.onQuickCalcInput('portions', '2,5');
    assert.ok(c.last.html.includes('(2,5 porz. × 250 g)'));
    c.api.onQuickCalcInput('gpp', '0');
    assert.ok(c.last.html.includes('Inserisci i grammi finiti per porzione'));
  });

  await test('una sola tabella ingredienti: originale a calcolo chiuso, ricalcolata a calcolo aperto, originale invariata alla chiusura', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    const prima = JSON.stringify(c.S.recipes);
    const tables = (h) => (h.match(/<table class="ing-table/g) || []).length;
    c.api.render();
    let h = c.last.html;
    assert.strictEqual(tables(h), 1, 'chiuso: una tabella');
    assert.ok(h.includes('rw-ingredients') && h.includes('% crudo') && !h.includes('qc-table'), 'chiuso: tabella originale con intestazione');
    assert.ok(h.includes('rw-summary') && h.includes('rw-finished'), 'riepiloghi conservati');
    assert.ok(h.includes('id="btn-quick-calc"') && h.includes("openMandaInProduzione('r1','v1')"));
    c.api.openQuickCalc('r1', 'v1');
    c.api.onQuickCalcInput('portions', '8');
    h = c.last.html;
    assert.strictEqual(tables(h), 1, 'aperto: una tabella');
    assert.ok(h.includes('qc-table') && !h.includes('rw-ingredients') && !h.includes('% crudo'), 'aperto: solo la tabella ricalcolata, intestazione originale nascosta');
    assert.ok(h.includes('temporanee, non salvate') && h.includes('Temporaneo: la Ricetta attiva non viene modificata'));
    assert.ok(h.includes('id="quick-calc-portions"') && h.includes('id="quick-calc-gpp"') && h.includes('id="qc-send"') && h.includes('id="qc-close"'));
    assert.ok(!/<input[^>]*(ing-qty|onVar)/.test(h), 'nessun altro campo modificabile');
    const ex = c.api.computeSessionScaling(c.api.buildPreparedInputDaRicettaAttiva(c.S.recipes[0], c.S.recipes[0].validatedVariants[0], 8, 250));
    const farina = ex.ingredients.find(i => i.itemKey === 'i1').operativeQty;
    assert.ok(h.includes('<td class="qc-qty">' + Number(farina).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '</td>'), 'quantita\' aggiornate');
    c.api.sendQuickCalcToProduction();
    assert.deepStrictEqual([c.S.pendingMandaInProduzione.portions, c.S.pendingMandaInProduzione.gpp], ['8', '250'], 'modale precompilato');
    c.S.pendingMandaInProduzione = null;
    c.api.closeQuickCalc();
    h = c.last.html;
    assert.strictEqual(c.S.quickCalc, null);
    assert.strictEqual(tables(h), 1);
    assert.ok(h.includes('rw-ingredients') && !h.includes('qc-table'), 'chiusura: ricompare la tabella originale');
    assert.deepStrictEqual([...h.matchAll(/<td class="ing-qty-ro">([^<]*)<\/td>/g)].map(m => m[1]), ['500', '0.2', '300', '2', '100'], 'formulazione originale');
    assert.strictEqual(JSON.stringify(c.S.recipes), prima);
    assert.deepStrictEqual(c.spy, { upRec: 0, autosave: 0, saveToSupabase: 0 });
    assert.strictEqual(recipeWrites(fake, c), 0);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
