/*
 * Test — LAB FIX 2C / C3: visualizzazione degli obiettivi non impostati in
 * Schede, elenchi versioni, stampa, intestazione Produzione e condivisione.
 * 0 = non impostato -> "—" (o assente in stampa, null in condivisione), mai
 * "0"; i valori impostati, compresi gli storici 4/200, invariati. Solo
 * visualizzazione: nessun dato cambia.
 *
 * Codice REALE estratto da khub_mvp.html (renderProdRecipe con il suo impianto
 * di test-recipe-weight-summary.js, renderRicettaMadreV2, exportPDF,
 * shareVariant). Solo dati sintetici, nessuna rete.
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
  'function computeFormulationWeights(ingredients,resolveFact)', 'function computeRecipeWeightSummary(recipe,vv)', 'function parseLocaleNumber(value)', 'function labTargetIsSet(value)', 'function targetDisplay(value)', 'function targetSummaryShort(portions,gpp)', 'function renderProdRecipe(recipe)',
  'function goToNewProductionSession(sessionId)', 'function isHighlightedProductionSession(id)', 'function revealProductionHighlight()',
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


// Combinazioni richieste: 0/0, 0/85,5, 12/0, 12/85,5 e storico 4/200.
const COMBOS = [[0, 0], [0, 85.5], [12, 0], [12, 85.5], [4, 200]];
const ing = (id, name, qty, unit, y) => ({ id, name, qty, unit, estimatedYieldPct: y });
function recipeWith(p, g) {
  const base = { active: true, status: 'validated', validatedAt: '09/10/2026', steps: ['Impastare'], stepsV2: [{ id: 's1', order: 0, text: 'Impastare', expectedDurationSeconds: null }],
    ingredients: [ing('far', 'Farina', 500, 'g', 70), ing('bur', 'Burro', 0.25, 'kg', 70)] };
  return [{ id: 'rT', name: 'Bignè TEST', category: 'Dolci', department: 'Cucina', parentRecipeId: null, labVersions: [],
    validatedVariants: [{ ...base, id: 'vT', name: 'Classica', portionsCount: p, gramsPerPortion: g },
      { ...base, id: 'v2', name: 'Seconda', active: false, portionsCount: p, gramsPerPortion: g }] }];
}

const PROD_SRC = CLIENT_SRC;
const SCHEDA_SRC = [
  'function escAttr(s)', 'function cnum(n)', 'function R(id)', 'function allVariants(recipe)', 'function findVariantById(variantId)', 'function parseDataItaliana(str)',
  'function parseLocaleNumber(value)', 'function labTargetIsSet(value)', 'function targetDisplay(value)', 'function targetSummaryShort(portions,gpp)', 'function targetPrintParts(portions,gpp)',
  'function targetForShare(value)', 'function effectiveYield(ing)', 'function exportPDF(recipeId,variantId)', 'function shareVariant(recipeId,variantId)',
  'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)', 'function resolveSessionScalingConversionToGrams(unit,conversionFact)',
  'function chooseConversionAskUnit(unit)', 'function resolveKnownProductionConversionFact(normalizedName,unit)', 'function normalizeIngredientName(name)',
  'function normalizeDeclaredYield(qty,unit)', 'function classifyYieldUnit(unit)', 'function computeFormulationWeights(ingredients,resolveFact)', 'function deriveYieldPerUnit(weights,declared)',
  'function formatQtyDisplay(value)', 'function declaredYieldState(v)', 'function declaredYieldInputText(raw)', 'function declaredYieldLabel(qty,unit)', 'function labGrams(x)',
  'function renderActiveYieldSection(recipe,v)', 'function renderRicettaMadreV2(recipe)',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g), [
  html.match(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/)[0], html.match(/var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/)[0], html.match(/var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/)[0],
]).join('\n');
function makeSchedaClient(recipes) {
  const cap = { printed: '', shared: null, toasts: [] };
  const S = { recipes, view: 'ricetta-madre-v2', variantFamilies: {}, families: [], rmv2AttivaEspansa: {}, pendingDuplicaSceltaRecipeId: null, activeYieldEdit: null,
    unitWeights: {}, unitWeightFacts: {}, productionConversionFacts: {} };
  const win = { open: () => ({ document: { write: h => { cap.printed += h; }, close() {} }, focus() {}, print() {} }), location: { origin: 'https://khub.test' } };
  const nav = { share: o => { cap.shared = o.url; } };
  const api = new Function('S', 'window', 'navigator', 'toast', 'setTimeout', `${SCHEDA_SRC}; return { renderRicettaMadreV2, exportPDF, shareVariant };`)(S, win, nav, m => cap.toasts.push(m), () => {});
  return { S, api, cap };
}
const vis = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const decodeShare = url => JSON.parse(decodeURIComponent(Buffer.from(url.split('share=')[1], 'base64').toString('binary')));
const EXP = {
  '0/0': { box: ['—', '—', '—'], meta: '— porz · — g/porz', print: '', share: [null, null] },
  '0/85.5': { box: ['—', '85.5', '—'], meta: '— porz · 85.5g/porz', print: ' · 85.5g/porzione', share: [null, 85.5] },
  '12/0': { box: ['12', '—', '—'], meta: '12 porz · — g/porz', print: ' · 12 porzioni', share: [12, null] },
  '12/85.5': { box: ['12', '85.5', '1026 g'], meta: '12 porz · 85.5g/porz', print: ' · 12 porzioni · 85.5g/porzione', share: [12, 85.5] },
  '4/200': { box: ['4', '200', '800 g'], meta: '4 porz · 200g/porz', print: ' · 4 porzioni · 200g/porzione', share: [4, 200] },
};

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  console.log('LAB FIX 2C — C3: obiettivi non impostati fuori dal LAB');

  await test('V1. intestazione Produzione: "—" per i campi assenti; Target dichiarato solo con entrambi; altre versioni con "—"; nessuna scrittura', async () => {
    for (const [p, g] of COMBOS) {
      const key = p + '/' + g, e = EXP[key];
      const c = makeClient(handler);
      c.S.recipes = recipeWith(p, g);
      const before = JSON.stringify(c.S.recipes);
      c.api.render();
      const h = c.last.html;
      const box = cls => { const m = h.match(new RegExp('class="scale-total ' + cls + '">([^<]*)<')); return m ? m[1].trim() : null; };
      assert.deepStrictEqual([box('rw-portions'), box('rw-gpp'), box('rw-declared')], e.box, key);
      assert.ok(vis(h).includes(e.meta), key + ': elenco versioni ' + e.meta);
      assert.ok(!/>\s*0\s*</.test(h.slice(h.indexOf('rw-portions') - 40, h.indexOf('rw-declared') + 80)), key + ': nessuno "0" mostrato');
      assert.strictEqual(JSON.stringify(c.S.recipes), before, key + ': dati invariati');
      assert.deepStrictEqual(c.spy, { upRec: 0, autosave: 0, saveToSupabase: 0 });
      assert.ok(/Peso finito teorico/.test(h));
    }
  });

  await test('V2. Schede (righe delle Ricette attive): "—" per ciascun valore assente, storici 4/200 invariati', async () => {
    for (const [p, g] of COMBOS) {
      const key = p + '/' + g;
      const { S, api } = makeSchedaClient(recipeWith(p, g));
      const before = JSON.stringify(S.recipes);
      const h = api.renderRicettaMadreV2(S.recipes[0]);
      const sub = (h.match(/class="si-riga-sub">([^<]*)</) || [])[1];
      assert.strictEqual(sub, EXP[key].meta + ' · dal 09/10/2026', key);
      assert.strictEqual(JSON.stringify(S.recipes), before, key + ': dati invariati');
    }
  });

  await test('V3. stampa: mai "0 porzioni" o "0 g/porzione"; mostrati solo i valori impostati', async () => {
    for (const [p, g] of COMBOS) {
      const key = p + '/' + g;
      const { S, api, cap } = makeSchedaClient(recipeWith(p, g));
      const before = JSON.stringify(S.recipes);
      api.exportPDF('rT', 'vT');
      const meta = (cap.printed.match(/<div class="meta">([^<]*)<\/div>/) || [])[1];
      assert.strictEqual(meta, 'Validata il 09/10/2026' + EXP[key].print, key);
      assert.ok(!/\b0 porzioni|\b0g\/porzione/.test(cap.printed), key);
      assert.strictEqual(JSON.stringify(S.recipes), before);
    }
  });

  await test('V4. condivisione: null per l\'obiettivo non impostato, valori impostati come sono', async () => {
    for (const [p, g] of COMBOS) {
      const key = p + '/' + g;
      const { S, api, cap } = makeSchedaClient(recipeWith(p, g));
      const before = JSON.stringify(S.recipes);
      api.shareVariant('rT', 'vT');
      const d = decodeShare(cap.shared);
      assert.deepStrictEqual([d.p, d.g], EXP[key].share, key);
      assert.deepStrictEqual([d.n, d.v], ['Bignè TEST', 'Classica']);
      assert.strictEqual(JSON.stringify(S.recipes), before);
    }
  });

  await test('V5. valori storici e formati: "123.456789" e 3/200 mostrati come prima; valori dal DB come stringa', async () => {
    const { S, api } = makeSchedaClient(recipeWith(3, '123.456789'));
    assert.ok(api.renderRicettaMadreV2(S.recipes[0]).includes('3 porz · 123.456789g/porz · dal 09/10/2026'));
    const c = makeClient(handler); c.S.recipes = recipeWith('0', '0'); c.api.render();
    assert.ok(vis(c.last.html).includes('— porz · — g/porz'), 'anche "0" come testo e\' non impostato');
  });

  await test('V6. codice: elenchi versioni del LAB e di Produzione, Schede, stampa e condivisione usano le funzioni di C3', async () => {
    const lab = extractFunction('function renderLabRecipe(recipe)');
    assert.ok(lab.includes('${targetSummaryShort(vv.portionsCount,vv.gramsPerPortion)} · ${vv.validatedAt}'));
    const prod = extractFunction('function renderProdRecipe(recipe)');
    assert.ok(prod.includes('${targetSummaryShort(v2.portionsCount,v2.gramsPerPortion)}'));
    assert.ok(!/\$\{vv?2?\.portionsCount\} porz|\$\{vv?\.gramsPerPortion\}g\/porz/.test(html), 'nessuna visualizzazione grezza rimasta');
    assert.ok(extractFunction('function exportPDF(recipeId,variantId)').includes('targetPrintParts(vv.portionsCount,vv.gramsPerPortion)'));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
