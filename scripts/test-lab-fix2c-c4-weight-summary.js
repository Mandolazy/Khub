/*
 * Test — LAB FIX 2C (C4): riepilogo pesi della formulazione nella vista
 * Produzione indipendente dall'obiettivo salvato, e Calcolo rapido che
 * precompila solo i valori impostati. Solo dati sintetici, in memoria.
 * Nessun framework: Node puro + assert.
 *
 * Codice REALE estratto da khub_mvp.html e api/chat.js contro un finto
 * PostgREST. La versione precedente di computeRecipeWeightSummary (commit
 * C3) e' congelata qui sotto come riferimento della verifica di parita'.
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
  'async function confirmConversionPreflightStep(rawValue)',
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)', 'function formatQtyDisplay(value)', 'function cancelConversionPreflight()',
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

// Versione PRECEDENTE di computeRecipeWeightSummary (commit C3 d23c143), congelata
// verbatim come riferimento della verifica di parita'.
const OLD_SUMMARY_SRC = "function computeRecipeWeightSummary(recipe,vv){\n  var p=parseFloat(vv.portionsCount),g=parseFloat(vv.gramsPerPortion);\n  if(!(isFinite(p)&&p>0&&isFinite(g)&&g>0))return{status:'unavailable'};\n  var input=buildPreparedInputDaRicettaAttiva(recipe,vv,p,g);\n  var missing=findMissingProductionConversions(input);\n  if(missing.length)return{status:'missing_conversions',missing:missing};\n  var r;\n  try{r=computeSessionScaling(input);}catch(e){return{status:'unavailable'};}\n  var byId={};\n  r.ingredients.forEach(function(i){\n    byId[i.sourceIngredientId!=null?i.sourceIngredientId:i.itemKey]={rawGrams:i.rawGrams,finishedGrams:i.finishedGrams,pct:r.baseRawTotal>0?i.rawGrams/r.baseRawTotal*100:0};\n  });\n  return{status:'complete',raw:r.baseRawTotal,finished:r.baseExpectedFinishedTotal,byId:byId};\n}";
const PARITY_SRC = ['function cnum(n)', 'function normalizeIngredientName(name)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)', 'function resolveSessionScalingConversionToGrams(unit,conversionFact)',
  'function chooseConversionAskUnit(unit)', 'function resolveKnownProductionConversionFact(normalizedName,unit)',
  'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)', 'function findMissingProductionConversions(preparedInput)',
  'function computeSessionScaling(input)', 'function computeFormulationWeights(ingredients,resolveFact)',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g)).join('\n');
function summaries(S) {
  const nuovo = new Function('S', PARITY_SRC + '\n' + extractFunction('function computeRecipeWeightSummary(recipe,vv)') + '; return computeRecipeWeightSummary;')(S);
  const vecchio = new Function('S', PARITY_SRC + '\n' + OLD_SUMMARY_SRC + '; return computeRecipeWeightSummary;')(S);
  return { nuovo, vecchio };
}
const facts = () => ({ unitWeights: { tuorli: 20, uova: 55 }, unitWeightFacts: { tuorli: { id: 'f1', sourceType: 'chef_confirmed', sourceDetail: null } },
  productionConversionFacts: { 'latte intero|ml|g': { id: 'f2', factor: 1.03, sourceType: 'chef_confirmed', sourceDetail: null } } });
const I = (id, name, qty, unit, y = null) => ({ id, name, qty, unit, estimatedYieldPct: y });
// Formulazioni sintetiche: complete, stima, conversioni mancanti, casi non disponibili e limite.
const FORMS = {
  crema: [I('a', 'Latte intero', 800, 'ml', 90), I('b', 'Zucchero', 0.15, 'kg', 100), I('c', 'Tuorli', 4, 'n'), I('d', 'Amido di mais', 60, 'g'), I('e', 'Vaniglia', 6, 'g')],
  soloMassa: [I('a', 'Farina', 500, 'g', 70), I('b', 'Burro', 0.25, 'kg', 70)],
  stimaUova: [I('a', 'Farina', 300, 'g'), I('b', 'Uova', 3, 'n', 88)],
  mancaPanna: [I('a', 'Panna', 200, 'ml'), I('b', 'Zucchero', 50, 'g'), I('c', 'Mela', 2, 'n')],
  qtyStringa: [I('a', 'Farina', '250', 'g'), I('b', 'Sale', 'abc', 'g'), I('c', 'Acqua', 0.2, 'l')],
  resaZero: [I('a', 'Vino', 100, 'g', 0), I('b', 'Farina', 100, 'g')],
  tuttoZero: [I('a', 'Vino', 100, 'g', 0)], qtyZero: [I('a', 'Farina', 0, 'g')], vuota: [],
  qtyNeg: [I('a', 'Farina', -5, 'g'), I('b', 'Sale', 5, 'g')], resaNeg: [I('a', 'Farina', 50, 'g', -10)], resaStringa: [I('a', 'Farina', 50, 'g', '90')],
  senzaUnita: [I('a', 'Farina', 50, null)], unitaVuota: [I('a', 'Farina', 50, '')],
  senzaId: [I(null, 'Farina', 50, 'g'), I('b', 'Sale', 5, 'g')], idVuoto: [I('', 'Farina', 50, 'g')],
  idNumerico: [I(1, 'Farina', 50, 'g'), I(2, 'Sale', 5, 'g', 50)], idDuplicato: [I('x', 'Farina', 50, 'g'), I('x', 'Sale', 5, 'g')],
  infinito: [I('a', 'Farina', 'Infinity', 'g')], infinitoResaZero: [I('a', 'Vino', 'Infinity', 'g', 0)],
  overflowCrudo: [I('a', 'Acqua', 1e308, 'g', 1), I('b', 'Acqua 2', 1e308, 'g', 1)], cl: [I('a', 'Rum', 3, 'cl'), I('b', 'Zucchero', 30, 'g')],
  mancaENeg: [I('a', 'Panna', 200, 'ml'), I('b', 'Farina', -5, 'g')], pezziIgnoti: [I('a', 'Limone', 1, 'pz')],
};
const VALID_TARGETS = [[4, 200], [12, 85.5], [1, 0.1], ['4', '200'], [3, 123.456789]];
const NO_TARGETS = [[0, 0], [0, 85.5], [12, 0], [null, null], ['', ''], [undefined, undefined]];
const variant = (ings, p, g) => ({ id: 'v', name: 'V', portionsCount: p, gramsPerPortion: g, ingredients: JSON.parse(JSON.stringify(ings)), steps: [], stepsV2: [] });
const run = (fn, vv) => { try { return fn({ id: 'r', name: 'R', category: 'C' }, vv); } catch (e) { return { throw: e.message }; } };
const sansEstimate = r => { const c = { ...r }; delete c.referenceDataUsed; return c; };

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  function freshDb() { const fake = makeFakeSupabase(); globalThis.fetch = fake.fetch; return fake; }
  const vis = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  console.log('LAB FIX 2C — C4: riepilogo pesi senza obiettivo salvato e Calcolo rapido');

  await test('P1. parita\': con obiettivo valido il nuovo riepilogo e\' identico al precedente (crudo, finito, %, mancanti, non disponibili)', async () => {
    let n = 0;
    for (const [nome, ings] of Object.entries(FORMS)) for (const [p, g] of VALID_TARGETS) {
      const { nuovo, vecchio } = summaries(facts());
      const o = run(vecchio, variant(ings, p, g)), x = run(nuovo, variant(ings, p, g));
      assert.deepStrictEqual(sansEstimate(x), o, nome + ' ' + p + '/' + g);
      if (x.status === 'complete') assert.ok(Array.isArray(x.referenceDataUsed), 'campo stima presente');
      n++;
    }
    assert.strictEqual(n, Object.keys(FORMS).length * VALID_TARGETS.length);
  });

  await test('P2. senza obiettivo (0/0, 0/85,5, 12/0, vuoti): il vecchio dava sempre "unavailable", il nuovo da\' l\'esito che il vecchio dava con un obiettivo', async () => {
    const stati = {};
    for (const [nome, ings] of Object.entries(FORMS)) {
      const { nuovo, vecchio } = summaries(facts());
      const rif = run(vecchio, variant(ings, 4, 200));
      for (const [p, g] of NO_TARGETS) {
        assert.deepStrictEqual(run(vecchio, variant(ings, p, g)), { status: 'unavailable' }, 'vecchio ' + nome);
        assert.deepStrictEqual(sansEstimate(run(nuovo, variant(ings, p, g))), rif, 'nuovo ' + nome + ' ' + p + '/' + g);
      }
      stati[nome] = rif.status;
    }
    // copertura: tutti e tre gli esiti sono esercitati
    assert.deepStrictEqual([...new Set(Object.values(stati))].sort(), ['complete', 'missing_conversions', 'unavailable']);
    const { nuovo } = summaries(facts());
    const c = run(nuovo, variant(FORMS.crema, 0, 0));
    assert.strictEqual(c.raw, 1120); assert.ok(Math.abs(c.finished - 1037.6) < 1e-9);
    assert.deepStrictEqual(run(nuovo, variant(FORMS.mancaPanna, 0, 0)).missing.map(m => [m.ingredientName, m.currentUnit]), [['Panna', 'ml'], ['Mela', 'n']], 'elenco mancanti');
  });

  await test('P3. stima: pesi di riferimento non confermati segnalati; conversioni confermate e massa no; nessuna conversione inventata', async () => {
    const { nuovo } = summaries(facts());
    assert.deepStrictEqual(run(nuovo, variant(FORMS.stimaUova, 0, 0)).referenceDataUsed.map(x => x.name), ['Uova']);
    assert.deepStrictEqual(run(nuovo, variant(FORMS.crema, 0, 0)).referenceDataUsed, []);
    assert.deepStrictEqual(run(nuovo, variant(FORMS.soloMassa, 0, 0)).referenceDataUsed, []);
    const vuoto = summaries({ unitWeights: {}, unitWeightFacts: {}, productionConversionFacts: {} }).nuovo;
    assert.strictEqual(run(vuoto, variant(FORMS.crema, 0, 0)).status, 'missing_conversions', 'senza conoscenze: niente g=ml ne\' pesi inventati');
    assert.deepStrictEqual(run(vuoto, variant(FORMS.crema, 0, 0)).missing.map(m => m.ingredientName), ['Latte intero', 'Tuorli']);
  });

  await test('V1. vista Produzione con obiettivo 0/0: peso finito e % calcolati, Target dichiarato "—", nessuna scrittura', async () => {
    for (const [p, g] of [[0, 0], [0, 250], [4, 0]]) {
      const fake = freshDb();
      const c = makeClient(handler);
      c.S.recipes[0].validatedVariants[0].portionsCount = p;
      c.S.recipes[0].validatedVariants[0].gramsPerPortion = g;
      const prima = JSON.stringify(c.S.recipes);
      c.api.render();
      const h = c.last.html;
      assert.ok(/rw-finished">1\.?037,6 g<\/div>/.test(h), p + '/' + g + ' peso finito');
      assert.ok(h.includes('rw-declared">—<'), 'target dichiarato assente');
      assert.ok(/Peso finito teorico: 1\.?037,6 g · peso a crudo 1\.?120 g/.test(vis(h)));
      assert.deepStrictEqual([...h.matchAll(/<td class="ing-pct">([^<]*)<\/td>/g)].map(m => m[1]), ['73.6%', '13.4%', '7.1%', '5.4%', '0.5%']);
      assert.ok(!h.includes('rw-estimate'), 'conversioni confermate: nessuna stima');
      assert.strictEqual(JSON.stringify(c.S.recipes), prima);
      assert.deepStrictEqual(c.spy, { upRec: 0, autosave: 0, saveToSupabase: 0 });
      assert.strictEqual(fake.calls.length, 0);
    }
  });

  await test('V2. vista: conversioni mancanti elencate anche senza obiettivo; stima mostrata con peso di riferimento non confermato', async () => {
    for (const [opt, nome] of [[{ noMilkFact: true }, 'Latte intero (ml)'], [{ noYolkFact: true }, 'Tuorli (n)']]) {
      freshDb();
      const c = makeClient(handler, opt);
      c.S.recipes[0].validatedVariants[0].portionsCount = 0;
      c.S.recipes[0].validatedVariants[0].gramsPerPortion = 0;
      c.api.render();
      assert.ok(c.last.html.includes('<div class="scale-total rw-finished">incompleto</div>'), nome);
      assert.ok(c.last.html.includes('Peso finito teorico non calcolabile') && c.last.html.includes(nome));
    }
    freshDb();
    const c = makeClient(handler);
    c.S.unitWeightFacts = {}; // tuorli 20 g resta solo come peso di riferimento
    c.S.recipes[0].validatedVariants[0].portionsCount = 0;
    c.api.render();
    const h = c.last.html;
    assert.ok(/rw-finished">1\.?037,6 g <span class="rw-estimate"[^>]*>\(stima\)<\/span><\/div>/.test(h), 'stima in intestazione');
    assert.ok(/1\.?037,6 g<\/strong> <span class="rw-estimate">\(stima\)<\/span>/.test(h), 'stima nel riepilogo');
  });

  await test('Q1. Calcolo rapido: precompila solo i valori impostati, gli altri restano vuoti (0/0, 0/85,5, 12/0, 12/85,5, 4/200)', async () => {
    const EXP = { '0/0': ['', ''], '0/85.5': ['', '85.5'], '12/0': ['12', ''], '12/85.5': ['12', '85.5'], '4/200': ['4', '200'], '"0"/"0"': ['', ''], 'null/null': ['', ''] };
    for (const [p, g, key] of [[0, 0, '0/0'], [0, 85.5, '0/85.5'], [12, 0, '12/0'], [12, 85.5, '12/85.5'], [4, 200, '4/200'], ['0', '0', '"0"/"0"'], [null, null, 'null/null']]) {
      freshDb();
      const c = makeClient(handler);
      Object.assign(c.S.recipes[0].validatedVariants[0], { portionsCount: p, gramsPerPortion: g });
      const prima = JSON.stringify(c.S.recipes);
      c.api.openQuickCalc('rT', 'vT');
      assert.deepStrictEqual([c.S.quickCalc.portions, c.S.quickCalc.gpp], EXP[key], key);
      const h = c.last.html;
      assert.ok(h.includes(`id="quick-calc-portions" type="text" inputmode="decimal" autocomplete="off" value="${EXP[key][0]}"`), key + ' campo porzioni');
      assert.ok(h.includes(`id="quick-calc-gpp" type="text" inputmode="decimal" autocomplete="off" value="${EXP[key][1]}"`), key + ' campo g/porz');
      assert.strictEqual(h.includes('id="qc-send"'), key === '12/85.5' || key === '4/200', key + ' Manda in Produzione solo con valori validi');
      assert.strictEqual(JSON.stringify(c.S.recipes), prima, 'Ricetta attiva intatta');
    }
  });

  await test('Q2. Manda in Produzione invariato: senza valori validi nessuna Sessione; con valori inseriti dallo chef la Sessione parte', async () => {
    let fake = freshDb();
    let c = makeClient(handler);
    Object.assign(c.S.recipes[0].validatedVariants[0], { portionsCount: 0, gramsPerPortion: 0 });
    c.api.openQuickCalc('rT', 'vT');
    c.api.sendQuickCalcToProduction();
    assert.strictEqual(c.S.pendingMandaInProduzione, null, 'campi vuoti: il modale non si apre');
    assert.strictEqual((fake.tables.production_sessions || []).length, 0);
    c.api.onQuickCalcInput('portions', '6');
    c.api.onQuickCalcInput('gpp', '150');
    c.api.sendQuickCalcToProduction();
    assert.deepStrictEqual([c.S.pendingMandaInProduzione.portions, c.S.pendingMandaInProduzione.gpp], ['6', '150']);
    await c.api.confirmMandaInProduzione();
    assert.strictEqual(fake.tables.production_sessions.length, 1);
    assert.strictEqual(fake.tables.production_sessions[0].snapshot.target.targetFinishedTotal, 900);
    assert.deepStrictEqual([c.S.recipes[0].validatedVariants[0].portionsCount, c.S.recipes[0].validatedVariants[0].gramsPerPortion], [0, 0], 'obiettivo salvato intatto');
  });

  await test('C1. codice: riepilogo da computeFormulationWeights, senza motore ne\' obiettivo; motore delle Sessioni e Manda in Produzione invariati', async () => {
    const f = extractFunction('function computeRecipeWeightSummary(recipe,vv)');
    assert.ok(f.includes('computeFormulationWeights(vv.ingredients)'));
    assert.ok(f.includes('findMissingProductionConversions(input)'));
    assert.ok(!/computeSessionScaling|portionsCount|gramsPerPortion/.test(f));
    const sha = s => require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 16);
    const expect = {
      'function computeSessionScaling(input)': 'ddfc1febb5010cdc', 'function computeFormulationWeights(ingredients,resolveFact)': "765b3d8a8edde206",
      'function openMandaInProduzione(recipeId,variantId,target)': "079b4b667450fa0f", 'async function confirmMandaInProduzione()': "4d8f576301f9d437",
      'function computeQuickCalc(recipe,vv,portionsText,gppText)': "1d5d1bb76a0d72ce", 'function sendQuickCalcToProduction()': "7568a463d6f6d2f4",
    };
    for (const [m, h] of Object.entries(expect)) assert.strictEqual(sha(extractFunction(m)), h, 'cambiato: ' + m);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
