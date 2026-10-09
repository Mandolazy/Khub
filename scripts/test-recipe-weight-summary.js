/*
 * Test — Pesi della Ricetta attiva e Calcolo rapido sulla fixture sintetica
 * "Crema pasticcera TEST 01" (solo in memoria: mai nell'archivio reale).
 * Nessun framework: Node puro + assert.
 *
 * Codice REALE estratto da khub_mvp.html (motore delle Sessioni, riepilogo
 * pesi, vista Ricetta, Calcolo rapido, Manda in Produzione,
 * createProductionSession) e api/chat.js contro un finto PostgREST.
 *
 * Valori attesi (dati di prodotto):
 *   latte 800 ml x 1,03 g/ml = 824 g crudi, resa 90% -> 741,6 g finiti
 *   zucchero 0,150 kg = 150 g; tuorli 4 n x 20 g = 80 g; amido 60 g; vaniglia 6 g
 *   crudo totale 1.120 g; finito teorico 1.037,6 g; target dichiarato 4 x 250 = 1.000 g
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
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g)).join('\n');


function fixtureRecipes(opts = {}) {
  const ing = (id, name, qty, unit, y) => ({ id, name, qty, unit, estimatedYieldPct: y });
  return [{
    id: 'rT', name: 'Crema pasticcera TEST 01', category: 'Basi', parentRecipeId: null, labVersions: [],
    validatedVariants: [{ id: 'vT', name: 'Crema pasticcera TEST 01', active: true, status: 'validated', portionsCount: 4, gramsPerPortion: 250, validatedAt: '09/10/2026',
      ingredients: [ing('lat', 'Latte intero', 800, 'ml', 90), ing('zuc', 'Zucchero', 0.150, 'kg', 100), ing('tuo', 'Tuorli', 4, 'n', 100), ing('ami', 'Amido di mais', 60, 'g', 100), ing('van', 'Vaniglia', 6, 'g', 100)],
      steps: ['Scaldare il latte', 'Unire e cuocere'], stepsV2: [{ id: 's1', order: 0, text: 'Scaldare il latte', expectedDurationSeconds: null }, { id: 's2', order: 1, text: 'Unire e cuocere', expectedDurationSeconds: 600 }] }],
  }];
}

function makeClient(handler, opts = {}) {
  const apiCalls = [], spy = { upRec: 0, autosave: 0, saveToSupabase: 0 };
  const clientFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    apiCalls.push(body);
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { ok: status < 400, status, json: async () => out };
  };
  const last = { html: '' };
  const S = { view: 'recipe', mode: 'produzione', selectedId: 'rT', selectedVariantId: 'vT', recipes: fixtureRecipes(), quickCalc: null,
    pendingMandaInProduzione: null, pendingConversionPreflight: null, variantFamilies: {}, families: [],
    unitWeights: opts.noYolkFact ? {} : { tuorli: 20 }, unitWeightFacts: opts.noYolkFact ? {} : { tuorli: { id: 'icT', sourceType: 'chef_confirmed', sourceDetail: null } },
    productionConversionFacts: opts.noMilkFact ? {} : { 'latte intero|ml|g': { id: 'icL', factor: 1.03, sourceType: 'chef_confirmed', sourceDetail: null } } };
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
    return { render, openQuickCalc, onQuickCalcInput, sendQuickCalcToProduction, confirmMandaInProduzione, computeQuickCalc,
      computeSessionScaling, buildPreparedInputDaRicettaAttiva, computeRecipeWeightSummary };`)(
    S, clientFetch, () => {}, { error() {} }, { getElementById: () => null }, last, spy);
  const rv = () => [S.recipes[0], S.recipes[0].validatedVariants[0]];
  return { S, api, apiCalls, last, spy, rv };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  function freshDb() { const fake = makeFakeSupabase(); globalThis.fetch = fake.fetch; return fake; }
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || '') + ': atteso ' + b + ', ottenuto ' + a);
  const vis = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  console.log('Pesi Ricetta attiva + Calcolo rapido — fixture Crema pasticcera TEST 01');

  await test('1-5. motore: pesi a crudo e finiti per ingrediente (g, kg, ml e n con conversione confermata, resa 90%)', async () => {
    freshDb();
    const c = makeClient(handler);
    const [r, v] = c.rv();
    const o = c.api.computeSessionScaling(c.api.buildPreparedInputDaRicettaAttiva(r, v, 4, 250));
    const by = Object.fromEntries(o.ingredients.map(i => [i.itemKey, i]));
    near(by.lat.rawGrams, 824, 'latte crudo'); near(by.lat.finishedGrams, 741.6, 'latte finito');
    near(by.zuc.rawGrams, 150, 'zucchero (kg)'); near(by.tuo.rawGrams, 80, 'tuorli (n)'); near(by.ami.rawGrams, 60); near(by.van.rawGrams, 6);
    near(o.baseRawTotal, 1120, 'crudo totale');
    near(o.baseExpectedFinishedTotal, 1037.6, 'finito teorico totale');
    assert.strictEqual(o.targetFinishedTotal, 1000, 'target dichiarato distinto');
  });

  await test('Calcolo rapido: 4x250, 8x250, 4x300 -> fattore = target / 1037,6; ogni ingrediente scalato nell\'unita\' originale', async () => {
    freshDb();
    const c = makeClient(handler);
    const [r, v] = c.rv();
    for (const [p, g] of [[4, 250], [8, 250], [4, 300]]) {
      const q = c.api.computeQuickCalc(r, v, String(p), String(g)).result;
      near(q.scaleFactor, (p * g) / 1037.6, p + 'x' + g);
      for (const i of q.ingredients) {
        const src = v.ingredients.find(x => x.id === i.itemKey);
        assert.strictEqual(i.unit, src.unit, 'unita\' originale');
        near(i.operativeQty, src.qty * q.scaleFactor, i.name);
      }
    }
  });

  await test('Calcolo rapido e Sessione con lo stesso target: quantita\' identiche (3 target); snapshot senza dati diagnostici', async () => {
    for (const [p, g] of [[4, 250], [8, 250], [4, 300]]) {
      const fake = freshDb();
      const c = makeClient(handler);
      const [r, v] = c.rv();
      const q = c.api.computeQuickCalc(r, v, String(p), String(g)).result;
      c.api.openQuickCalc('rT', 'vT');
      c.api.onQuickCalcInput('portions', String(p));
      c.api.onQuickCalcInput('gpp', String(g));
      c.api.sendQuickCalcToProduction();
      await c.api.confirmMandaInProduzione();
      const snap = fake.tables.production_sessions[0].snapshot;
      assert.deepStrictEqual(snap.ingredients.map(i => [i.itemKey, i.unit, i.operativeQty]), q.ingredients.map(i => [i.itemKey, i.unit, i.operativeQty]), p + 'x' + g);
      near(snap.target.baseExpectedFinishedTotal, 1037.6);
      assert.deepStrictEqual(Object.keys(snap.ingredients[0]).sort(), ['baseQty', 'conversionFactId', 'conversionFactorToBase', 'conversionOrigin', 'conversionSourceType', 'estimatedYieldPct', 'isSubRecipe', 'itemKey', 'name', 'operativeQty', 'sourceIngredientId', 'subRecipeId', 'unit'], 'snapshot invariato');
      assert.ok(!('baseRawTotal' in snap.target));
      assert.deepStrictEqual(c.spy, { upRec: 0, autosave: 0, saveToSupabase: 0 });
    }
  });

  await test('6. vista Ricetta attiva: peso finito teorico 1.037,6 g, crudo 1.120 g, target dichiarato 1.000 g distinto, % sul crudo', async () => {
    freshDb();
    const c = makeClient(handler);
    c.api.render();
    const h = c.last.html, t = vis(h);
    assert.ok(h.includes('<div class="scale-total rw-finished">1037,6 g</div>') || h.includes('<div class="scale-total rw-finished">1.037,6 g</div>'));
    assert.ok(/rw-declared">1\.?000 g</.test(h), 'target dichiarato');
    assert.ok(/Peso finito teorico: 1\.?037,6 g · peso a crudo 1\.?120 g/.test(t));
    assert.ok(h.includes('% crudo'));
    const pct = [...h.matchAll(/<td class="ing-pct">([^<]*)<\/td>/g)].map(m => m[1]);
    assert.deepStrictEqual(pct, ['73.6%', '13.4%', '7.1%', '5.4%', '0.5%'], '824/150/80/60/6 su 1120');
    const s = c.api.computeRecipeWeightSummary(...c.rv());
    near(s.finished, c.api.computeSessionScaling(c.api.buildPreparedInputDaRicettaAttiva(...c.rv(), 4, 250)).baseExpectedFinishedTotal, 'coerenza con il motore');
    near(Object.values(s.byId).reduce((a, x) => a + x.pct, 0), 100, 'denominatore = crudo totale');
    assert.ok(!/882|scostamento|differenza/i.test(t), 'nessuna vecchia somma, nessun indicatore di scostamento');
  });

  await test('4. conversioni mancanti (ml o pezzi): niente totale ne\' percentuali "precisi", elenco esplicito', async () => {
    for (const [opt, nome] of [[{ noMilkFact: true }, 'Latte intero (ml)'], [{ noYolkFact: true }, 'Tuorli (n)']]) {
      freshDb();
      const c = makeClient(handler, opt);
      c.api.render();
      const h = c.last.html;
      assert.ok(h.includes('<div class="scale-total rw-finished">incompleto</div>'), nome);
      assert.ok(h.includes('Peso finito teorico non calcolabile') && h.includes(nome));
      assert.deepStrictEqual([...h.matchAll(/<td class="ing-pct">([^<]*)<\/td>/g)].map(m => m[1]), ['—', '—', '—', '—', '—']);
      assert.ok(!/\d+(,\d)? g<\/strong>/.test(h.slice(h.indexOf('rw-summary'))), 'nessun totale');
    }
  });

  await test('7. nessuna scrittura sulla Ricetta attiva (vista + riepilogo + Calcolo rapido)', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    const prima = JSON.stringify(c.S.recipes);
    c.api.render();
    c.api.openQuickCalc('rT', 'vT');
    c.api.onQuickCalcInput('portions', '8');
    c.api.onQuickCalcInput('gpp', '300');
    assert.strictEqual(JSON.stringify(c.S.recipes), prima);
    assert.deepStrictEqual(c.spy, { upRec: 0, autosave: 0, saveToSupabase: 0 });
    assert.strictEqual(fake.calls.filter(x => x.method !== 'GET').length, 0);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
