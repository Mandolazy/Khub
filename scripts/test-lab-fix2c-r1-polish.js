/*
 * Test — LAB FIX 2C-R1: rifinitura pre-rilascio.
 * A) Calcolo rapido: campi vuoti mai toccati = suggerimento neutro; errore
 *    solo dopo un'interazione, sul campo giusto. computeQuickCalc, motore e
 *    avvio delle Sessioni invariati.
 * B) Stampa: percentuali sul peso a crudo e pesi da computeRecipeWeightSummary
 *    (non modificata), mai somme di unita' diverse; distinzione tra confermato,
 *    stimato ("(stima)", nessun numero presentato come certo) e non
 *    calcolabile ("—" con le conversioni mancanti).
 *
 * Codice REALE estratto da khub_mvp.html e api/chat.js contro un finto
 * PostgREST. Solo dati sintetici.
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
  return require('./_khub-test-session').withTestSession((await import('data:text/javascript;base64,' + Buffer.from(chatSrc).toString('base64'))).default);
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
  'async function confirmConversionPreflightStep(rawValue)',
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)', 'function cancelConversionPreflight()',
  // Calcolo rapido
  'function parseQuickCalcNumber(text)', 'function computeQuickCalc(recipe,vv,portionsText,gppText)', 'function formatQuickCalcQty(qty,unit)',
  'function openQuickCalc(recipeId,variantId)', 'function closeQuickCalc()', 'function onQuickCalcInput(field,value)', 'function syncQuickCalcScope()',
  'function openQuickCalcConversions()', 'function sendQuickCalcToProduction()', 'function renderQuickCalcPanel(recipe,vv)',
  'function computeFormulationWeights(ingredients,resolveFact)', 'function computeRecipeWeightSummary(recipe,vv)', 'function parseLocaleNumber(value)', 'function labTargetIsSet(value)', 'function targetDisplay(value)', 'function targetSummaryShort(portions,gpp)', 
  // UX dopo la validazione: azioni verso il LAB nella vista della Ricetta.
  'function curLab(recipe)', 'function bozzaVuota(v)', 'function findDependentsOfVariant(variantId)', 'function prontaRiapribileMotivo(recipe,vv)', 'function correggibileInPagina(recipe,vv)', 'function renderAzioniLabRicetta(recipe,vv)', 'function renderProdRecipe(recipe)',
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


// Stampa: stesse funzioni reali della suite C3 (Schede, stampa, condivisione).
const SCHEDA_SRC = [
  'function escAttr(s)', 'function cnum(n)', 'function R(id)', 'function allVariants(recipe)', 'function findVariantById(variantId)', 'function parseDataItaliana(str)',
  'function parseLocaleNumber(value)', 'function labTargetIsSet(value)', 'function targetDisplay(value)', 'function targetSummaryShort(portions,gpp)', 'function targetPrintParts(portions,gpp)',
  'function targetForShare(value)', 'function effectiveYield(ing)', 'function exportPDF(recipeId,variantId)',
  // FIX 2C-R1: la stampa usa il riepilogo pesi della vista Produzione.
  'function computeRecipeWeightSummary(recipe,vv)', 'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)', 'function findMissingProductionConversions(preparedInput)', 'function getStructuredSteps(legacySteps,stepsV2)', 'function formatQuickCalcQty(qty,unit)', 'function shareVariant(recipeId,variantId)',
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
// Impronte prese dal commit FIX 2C feb5035: queste funzioni non devono cambiare.
const PROTETTE = {
  "function computeQuickCalc(recipe,vv,portionsText,gppText)": "1d5d1bb76a0d72ce",
  "function parseQuickCalcNumber(text)": "e54a2e7162d131c3",
  "function openQuickCalc(recipeId,variantId)": "a20126ad522b5879",
  "function sendQuickCalcToProduction()": "7568a463d6f6d2f4",
  "function openMandaInProduzione(recipeId,variantId,target)": "079b4b667450fa0f",
  "async function confirmMandaInProduzione()": "4d8f576301f9d437",
  "function computeSessionScaling(input)": "ddfc1febb5010cdc",
  "function buildSessionSnapshotV1(meta,computed)": "1fd7615c172e0ce2",
  "async function createProductionSession(preparedInput)": "185ca85dcee49397",
  "function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)": "9df6758db87b12b1",
  "function computeRecipeWeightSummary(recipe,vv)": "beac67cc93eee93b",
  "function computeFormulationWeights(ingredients,resolveFact)": "765b3d8a8edde206",
};

// Formulazione sintetica per la stampa (unita' g, ml, kg, n, tbsp) e conoscenze di conversione.
const I = (id, name, qty, unit, y = null) => ({ id, name, qty, unit, estimatedYieldPct: y });
const CREMA = [I('lat', 'Latte intero', 800, 'ml', 90), I('zuc', 'Zucchero', 0.15, 'kg', 100), I('tuo', 'Tuorli', 4, 'n'), I('ami', 'Amido di mais', 60, 'g'), I('van', 'Vaniglia', 6, 'g')];
const printRecipe = (ings, p = 4, g = 250) => [{ id: 'rP', name: 'Crema STAMPA', category: 'Basi', parentRecipeId: null, labVersions: [],
  validatedVariants: [{ id: 'vP', name: 'Classica', active: true, status: 'validated', validatedAt: '09/10/2026', portionsCount: p, gramsPerPortion: g,
    ingredients: JSON.parse(JSON.stringify(ings)), steps: ['Scaldare', 'Cuocere'], stepsV2: [] }] }];
function stampa(ings, know = {}, p, g) {
  const c = makeSchedaClient(printRecipe(ings, p, g));
  Object.assign(c.S.unitWeights, know.unitWeights || {}); Object.assign(c.S.unitWeightFacts, know.unitWeightFacts || {});
  Object.assign(c.S.productionConversionFacts, know.productionConversionFacts || {});
  const before = JSON.stringify(c.S.recipes);
  c.api.exportPDF('rP', 'vP');
  const h = c.cap.printed;
  return { h, before, after: JSON.stringify(c.S.recipes), pct: [...h.matchAll(/<td class="pdf-pct"[^>]*>([^<]*)<\/td>/g)].map(m => m[1]),
    qty: [...h.matchAll(/<td style="text-align:right;font-family:monospace">([^<]*)<\/td>/g)].map(m => m[1]),
    th: (h.match(/<th style="text-align:right">([^<]*)<\/th><\/tr>/) || [])[1], weights: vis((h.match(/<div class="pdf-weights"[^>]*>[\s\S]*?<\/div>/) || [''])[0]).trim(),
    note: vis((h.match(/<div class="pdf-estimate"[^>]*>[\s\S]*?<\/div>/) || [''])[0]).trim(), meta: (h.match(/<div class="meta">([^<]*)<\/div>/) || [])[1] };
}
const CONFERMATE = { unitWeights: { tuorli: 20 }, unitWeightFacts: { tuorli: { id: 'f1', sourceType: 'chef_confirmed', sourceDetail: null } },
  productionConversionFacts: { 'latte intero|ml|g': { id: 'f2', factor: 1.03, sourceType: 'chef_confirmed', sourceDetail: null } } };
const STIMATE = { unitWeights: { tuorli: 20 }, unitWeightFacts: {}, productionConversionFacts: CONFERMATE.productionConversionFacts };
const qcState = h => ({ hint: h.includes('class="qc-hint"') && h.includes('Inserisci porzioni e grammi per porzione per calcolare.'),
  errP: h.includes('Inserisci un numero di porzioni maggiore di zero.'), errG: h.includes('Inserisci i grammi finiti per porzione (maggiore di zero).'),
  table: h.includes('class="ing-table qc-table"'), send: h.includes('id="qc-send"') });
const sha = s => require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 16);

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  function freshDb() { const fake = makeFakeSupabase(); globalThis.fetch = fake.fetch; return fake; }
  function qc(p, g) { const fake = freshDb(); const c = makeClient(handler); Object.assign(c.S.recipes[0].validatedVariants[0], { portionsCount: p, gramsPerPortion: g }); c.fake = fake; c.prima = JSON.stringify(c.S.recipes); c.api.openQuickCalc('rT', 'vT'); return c; }
  const st = c => qcState(c.last.html);
  console.log('LAB FIX 2C-R1 — Calcolo rapido e stampa');

  await test('A1. apertura con valori mancanti (0/0, 0/250, 4/0): suggerimento neutro in grigio, nessun errore, nessun invio', async () => {
    for (const [p, g] of [[0, 0], [0, 250], [4, 0], [null, null]]) {
      const s = st(qc(p, g));
      assert.deepStrictEqual(s, { hint: true, errP: false, errG: false, table: false, send: false }, p + '/' + g);
    }
    assert.ok(qc(0, 0).last.html.includes('<div class="qc-hint" style="font-size:13px;color:var(--mid)">'), 'grigio, non rosso');
    assert.deepStrictEqual(st(qc(4, 250)), { hint: false, errP: false, errG: false, table: true, send: true }, '4/250 precompilati: calcolo come prima');
  });

  await test('A2. errore solo dopo un\'interazione che lascia il campo non valido o vuoto', async () => {
    const c = qc(0, 0);
    c.api.onQuickCalcInput('portions', 'abc'); assert.deepStrictEqual(st(c), { hint: false, errP: true, errG: false, table: false, send: false }, 'abc');
    c.api.onQuickCalcInput('portions', '4'); assert.deepStrictEqual(st(c), { hint: true, errP: false, errG: false, table: false, send: false }, 'porzioni valide, g/porz mai toccato');
    c.api.onQuickCalcInput('gpp', '0'); assert.deepStrictEqual(st(c), { hint: false, errP: false, errG: true, table: false, send: false }, 'gpp 0');
    c.api.onQuickCalcInput('gpp', ''); assert.deepStrictEqual(st(c), { hint: false, errP: false, errG: true, table: false, send: false }, 'gpp svuotato');
    c.api.onQuickCalcInput('gpp', '250'); assert.deepStrictEqual(st(c), { hint: false, errP: false, errG: false, table: true, send: true }, 'valori validi');
    c.api.onQuickCalcInput('portions', ''); assert.deepStrictEqual(st(c), { hint: false, errP: true, errG: false, table: false, send: false }, 'porzioni svuotate');
  });

  await test('A3. il messaggio indica il campo giusto (g/porzione sbagliato con porzioni ancora vuote; entrambi sbagliati)', async () => {
    let c = qc(0, 0);
    c.api.onQuickCalcInput('gpp', '-3');
    assert.deepStrictEqual(st(c), { hint: false, errP: false, errG: true, table: false, send: false }, 'solo g/porzione');
    c.api.onQuickCalcInput('portions', 'x');
    assert.deepStrictEqual(st(c), { hint: false, errP: true, errG: true, table: false, send: false }, 'entrambi');
    c = qc(4, 0);
    assert.deepStrictEqual(st(c), { hint: true, errP: false, errG: false, table: false, send: false }, '4/— : suggerimento');
    c.api.onQuickCalcInput('gpp', 'abc');
    assert.deepStrictEqual(st(c), { hint: false, errP: false, errG: true, table: false, send: false }, '4/abc');
  });

  await test('A4. Calcolo rapido e avvio Sessione invariati; nessuna scrittura; dati intatti', async () => {
    const c = qc(0, 0);
    c.api.sendQuickCalcToProduction();
    assert.strictEqual(c.S.pendingMandaInProduzione, null, 'nessun invio senza valori validi');
    c.api.onQuickCalcInput('portions', '8'); c.api.onQuickCalcInput('gpp', '300');
    const r = c.api.computeQuickCalc(c.S.recipes[0], c.S.recipes[0].validatedVariants[0], '8', '300').result;
    c.api.sendQuickCalcToProduction(); await c.api.confirmMandaInProduzione();
    const snap = c.fake.tables.production_sessions[0].snapshot;
    assert.deepStrictEqual(snap.ingredients.map(i => i.operativeQty), r.ingredients.map(i => i.operativeQty), 'Sessione = Calcolo rapido');
    assert.strictEqual(JSON.stringify(c.S.recipes), c.prima, 'Ricetta attiva intatta');
    assert.deepStrictEqual(c.spy, { upRec: 0, autosave: 0, saveToSupabase: 0 });
    for (const [m, h] of Object.entries(PROTETTE)) assert.strictEqual(sha(extractFunction(m)), h, 'cambiato: ' + m);
  });

  await test('B1. peso confermato: percentuali sul peso a crudo identiche alla vista Produzione; riga dei pesi; nessuna stima', async () => {
    const s = stampa(CREMA, CONFERMATE);
    assert.deepStrictEqual(s.pct, ['73.6%', '13.4%', '7.1%', '5.4%', '0.5%']);
    assert.strictEqual(s.th, '% crudo');
    assert.ok(/^Peso a crudo: 1\.?120 g · Peso finito teorico: 1\.?037,6 g$/.test(s.weights), s.weights);
    assert.ok(!/stima|\*/.test(s.weights + s.th + s.pct.join('') + s.note));
    // stessi numeri della vista Produzione (computeRecipeWeightSummary, non modificata)
    const c = makeClient(handler); c.S.recipes = printRecipe(CREMA); c.S.selectedId = 'rP'; c.S.selectedVariantId = 'vP'; c.api.render();
    assert.deepStrictEqual([...c.last.html.matchAll(/<td class="ing-pct">([^<]*)<\/td>/g)].map(m => m[1]), s.pct, 'stampa = vista Produzione');
    assert.ok(!s.h.includes('91.9%'), 'nessuna somma di ml, kg, n e g');
  });

  await test('B2. peso stimato: nessun numero presentato come certo (intestazione, ingrediente, riga dei pesi, nota)', async () => {
    const s = stampa(CREMA, STIMATE);
    assert.deepStrictEqual(s.pct, ['73.6%', '13.4%', '7.1% *', '5.4%', '0.5%'], 'ingrediente stimato marcato');
    assert.strictEqual(s.th, '% crudo (stima)', 'tutte le percentuali dichiarate come stima');
    assert.ok(/^Peso a crudo: 1\.?120 g · Peso finito teorico: 1\.?037,6 g \(stima\)$/.test(s.weights), s.weights);
    assert.ok(s.note.includes('* Tuorli (n)') && s.note.includes('pesi di riferimento non confermati') && s.note.includes('tutti i valori dipendono da questa stima'), s.note);
  });

  await test('B3. conversioni mancanti: "—" per le percentuali, conversioni mancanti elencate, nessun peso inventato', async () => {
    for (const [know, nome] of [[{ ...CONFERMATE, productionConversionFacts: {} }, 'Latte intero (ml)'], [{ ...CONFERMATE, unitWeights: {}, unitWeightFacts: {} }, 'Tuorli (n)']]) {
      const s = stampa(CREMA, know);
      assert.deepStrictEqual(s.pct, ['—', '—', '—', '—', '—'], nome);
      assert.strictEqual(s.weights, 'Pesi e percentuali non calcolabili: mancano le conversioni in grammi di ' + nome + '.');
      const corpo = s.h.slice(s.h.indexOf('<table'));
      assert.ok(!/Peso a crudo|Peso finito|\d%/.test(corpo), 'nessun peso o percentuale');
    }
    const t = stampa([I('a', 'Zucchero a velo', 200, 'g'), I('b', 'Acqua', 2, 'tbsp')]);
    assert.deepStrictEqual(t.pct, ['—', '—']); assert.ok(t.weights.includes('Acqua (tbsp)'));
  });

  await test('B4. pesi non disponibili: "—" e nota, nessun valore inventato', async () => {
    const s = stampa([I('a', 'Vino', 100, 'g', 0)]);
    assert.deepStrictEqual(s.pct, ['—']);
    assert.strictEqual(s.weights, 'Pesi e percentuali non disponibili.');
  });

  await test('B5. quantita\' originali, obiettivo e procedimento invariati; dati non modificati', async () => {
    for (const [p, g, meta] of [[4, 250, 'Validata il 09/10/2026 · 4 porzioni · 250g/porzione'], [0, 0, 'Validata il 09/10/2026'], [12, 0, 'Validata il 09/10/2026 · 12 porzioni']]) {
      const s = stampa(CREMA, STIMATE, p, g);
      assert.deepStrictEqual(s.qty, ['800 ml', '0.15 kg', '4 n', '60 g', '6 g']);
      assert.strictEqual(s.meta, meta);
      assert.ok(s.h.includes('<li style="margin-bottom:6px;line-height:1.6">Scaldare</li>'));
      assert.strictEqual(s.after, s.before);
    }
  });

  await test('B6. codice: exportPDF usa computeRecipeWeightSummary (non modificata); nessuna somma di quantita\'; variabile morta eliminata', async () => {
    const f = extractFunction('function exportPDF(recipeId,variantId)');
    assert.ok(f.includes('computeRecipeWeightSummary(recipe,vv)'));
    assert.ok(!/reduce\(|pesoFinitoStimato|effectiveYield|cnum\(/.test(f));
    assert.strictEqual(sha(extractFunction('function computeRecipeWeightSummary(recipe,vv)')), 'beac67cc93eee93b');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
