/*
 * Test MS-CI2 — Canonical Ingredient Identity: dati + lookup (nessuna UI).
 * Nessun framework: Node puro + assert, stesso stile degli altri test.
 *
 * Esegue codice REALE: api/chat.js (handler importato come modulo) contro un
 * finto PostgREST in memoria che applica "Max rows" = 1000, e le funzioni
 * client ESTRATTE da khub_mvp.html (stessa tecnica di
 * test-supabase-load-save-safety.js / test-m2-ui-integration.js).
 *
 * Regole verificate (congelate):
 *  - riga NON collegata: lookup per nome esatto normalizzato, identico a prima;
 *  - riga collegata al canonico C: UNIONE di fact con canonical_ingredient_id
 *    = C e fact storiche (canonical null) con ingredient_name === C.name_key;
 *    MAI il nome descrittivo della riga; nessuna copia/modifica delle fact;
 *  - gerarchia invariata: chef_confirmed > reference_data, poi la piu' recente;
 *  - canonicalIngredientId sopravvive a load -> LAB -> attivazione -> save ->
 *    reload -> input Produzione -> snapshot (additivo, snapshotVersion 1).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAX_ROWS = 1000;
let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); failed++; }
}

// ══════════════════════════════════════════════════════════
// Finto PostgREST (GET order/limit/offset con Max rows, POST upsert, DELETE)
// ══════════════════════════════════════════════════════════
function makeFakeSupabase() {
  const tables = {};
  const calls = [];
  let failOn = null;
  const matches = (row, filters) => filters.every(([col, op, val]) => {
    const v = row[col] == null ? null : String(row[col]);
    if (op === 'eq') return v === val;
    if (op === 'in') return val.includes(v);
    throw new Error('filtro non supportato: ' + op);
  });
  const compare = (a, b, order) => {
    for (const [col, dir] of order) {
      const x = a[col], y = b[col];
      if (x === y) continue;
      const c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y));
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return 0;
  };
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)), text: async () => JSON.stringify(data) });
  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    const method = opts.method || 'GET';
    let order = [], limit = null, offset = 0;
    const filters = [];
    for (const [k, raw] of u.searchParams) {
      if (k === 'select') continue;
      if (k === 'order') { order = raw.split(',').map(s => s.split('.')); continue; }
      if (k === 'limit') { limit = parseInt(raw, 10); continue; }
      if (k === 'offset') { offset = parseInt(raw, 10); continue; }
      const dot = raw.indexOf('.');
      const op = raw.slice(0, dot), val = raw.slice(dot + 1);
      filters.push([k, op, op === 'in' ? val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')) : val]);
    }
    calls.push({ method, table, limit, offset });
    const rows = tables[table] = tables[table] || [];
    if (method === 'GET') {
      if (failOn && failOn.table === table && failOn.offset === offset) return reply(500, { message: 'boom' });
      const sorted = rows.filter(r => matches(r, filters)).sort((a, b) => compare(a, b, order));
      return reply(200, sorted.slice(offset, offset + Math.min(limit == null ? Infinity : limit, MAX_ROWS)));
    }
    if (method === 'POST') {
      const data = JSON.parse(opts.body);
      (Array.isArray(data) ? data : [data]).forEach(row => {
        const i = row.id != null ? rows.findIndex(r => r.id === row.id) : -1;
        if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push({ ...row });
      });
      return reply(201, null);
    }
    if (method === 'DELETE') { tables[table] = rows.filter(r => !matches(r, filters)); return reply(204, null); }
    throw new Error('metodo non supportato: ' + method);
  }
  return { tables, calls, fetch, failPage: (t, o) => { failOn = { table: t, offset: o }; } };
}

// name_key come la colonna generata lower(btrim(name)) della migration 0009
const canon = (id, name, created_at = '2026-10-01T00:00:00Z') => ({ id, name, name_key: name.trim().toLowerCase(), created_at });
const conv = (id, ingredient_name, from_unit, factor, source_type, confirmed_at, canonical_ingredient_id = null) =>
  ({ id, ingredient_name, from_unit, to_unit: 'g', factor: String(factor), source_type, source_detail: null, confirmed_at, canonical_ingredient_id });

function seed(fake, { canonicals = [], conversions = [], ingredients = null } = {}) {
  fake.tables.recipes = [{ id: 'r1', name: 'Ramen', category: 'Salato', created_at: '2026-09-01T00:00:00Z' }];
  fake.tables.variants = [{ id: 'vLab', recipe_id: 'r1', name: 'Ramen', label: 'Bozza 1', status: 'lab', active: false,
    portions_count: 4, grams_per_portion: 300, steps: '["bollire"]', steps_v2: null, created_at: '2026-09-01T00:00:00Z' }];
  fake.tables.ingredients = ingredients || [
    { id: 'ingAcquaBrodo', variant_id: 'vLab', name: 'acqua per brodo', qty: 1000, unit: 'ml', sort_order: 0, canonical_ingredient_id: 'ciAcqua' },
    { id: 'ingFarina', variant_id: 'vLab', name: 'farina', qty: 200, unit: 'g', sort_order: 1, canonical_ingredient_id: null },
  ];
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = [];
  fake.tables.canonical_ingredients = canonicals;
  fake.tables.ingredient_conversions = conversions;
}

// ══════════════════════════════════════════════════════════
// Codice reale
// ══════════════════════════════════════════════════════════
async function loadHandler() {
  const src = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
  return (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;
}
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
function extractFunction(startMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error('marker non trovato: ' + startMarker);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('graffe non bilanciate a partire da: ' + startMarker);
}
const VARS = ['SESSION_SCALING_MASS_TO_GRAMS', 'SESSION_SCALING_VOLUME_TO_ML', 'CANONICAL_UNRESOLVED_MSG']
  .map(v => html.match(new RegExp('var ' + v + '=[^;]+;'))[0]).join('\n');
const CLIENT_SRC = VARS + '\n' + [
  'function R(id)', 'function curLab(recipe)', 'function uid()', 'function cnum(n)', 'function normalizeIngredientName(name)',
  'function conversionFactSourcePriority(sourceType)', 'function isBetterConversionFact(candidate,current)',
  'function buildCanonicalIngredientIndex(rows)', 'function buildCanonicalConversionFacts(conversions,canonicalById)',
  'function resolveKnownCanonicalConversionFact(canonicalId,unit)', 'function resolveKnownConversionFactForIngredient(ing)',
  'function knownUnitWeightForIngredient(ing)', 'function conversionWriteIdentity(ingredientName,canonicalIngredientId)',
  'function rememberConfirmedConversion(conv,canonicalIngredientId)', 'function rememberCanonicalConversionFact(conv,canonicalIngredientId)',
  'function confirmUnitConversion(pesoMedio)',
  'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)',
  'function resolveSessionScalingConversionToGrams(unit,conversionFact)', 'function chooseConversionAskUnit(unit)',
  'function resolveKnownProductionConversionFact(normalizedName,unit)',
  'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)',
  'function findMissingProductionConversions(preparedInput)', 'function computeSessionScaling(input)',
  'function buildSessionSnapshotV1(meta,computed)', 'function formatFinishedTotalLabel(grams)', 'function renderSessioneOperativa()',
  'function buildKnownIngredientIds(ingredientRows)', 'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'async function saveToSupabase(recipe)',
  'function upRec(id,fn)', 'function rendiAttiva(recipeId)',
  'async function saveIngredientConversion(ingredientName,fromUnit,toUnit,factor,sourceType,sourceDetail,canonicalIngredientId)',
  'async function confirmConversionPreflightStep(rawValue)',
].map(extractFunction).join('\n');

// Seed n->g di prova: nel codice reale sono i valori scritti in S.unitWeights (unica tabella reference n->g).
const SEEDS = { uovo: 55 };

function makeClient(handler) {
  async function callApi(body) {
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { status, body: out };
  }
  const clientFetch = async (url, opts) => {
    const r = await callApi(JSON.parse(opts.body));
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  const factory = new Function('fetch', 'toast', 'render', 'autosave', 'addHistory', 'confirm', 'createProductionSession', 'SEEDS', `
    var S={recipes:[],selectedId:null,view:'',families:[],variantFamilies:{},unitWeights:Object.assign({},SEEDS),unitWeightFacts:{},
      productionConversionFacts:{},canonicalIngredientsById:{},canonicalConversionFacts:{},pendingConversionPreflight:null,
      productionSessions:[],openSessionId:null};
    var _knownIngredientIdsByVariant={};
    ${CLIENT_SRC}
    return {S, loadFromSupabase, saveToSupabase, rendiAttiva, buildPreparedInputDaRicettaAttiva, findMissingProductionConversions,
      computeSessionScaling, buildSessionSnapshotV1, renderSessioneOperativa, resolveKnownConversionFactForIngredient,
      resolveKnownProductionConversionFact, knownUnitWeightForIngredient, confirmConversionPreflightStep, confirmUnitConversion, normalizeIngredientName};
  `);
  const created = [], toasts = [];
  return { created, toasts, api: factory(clientFetch, (msg) => { toasts.push(msg); }, () => {}, () => {}, () => {}, () => true,
    async (input) => { created.push(input); return { sessionId: 'ps1' }; }, SEEDS) };
}

const ACQUA = canon('ciAcqua', 'ACQUA');
const linkedRow = (over = {}) => ({ id: 'x1', name: 'acqua per brodo', qty: 1000, unit: 'ml', canonicalIngredientId: 'ciAcqua', ...over });

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  async function loaded(opts) {
    const fake = makeFakeSupabase(); seed(fake, opts); globalThis.fetch = fake.fetch;
    const c = makeClient(handler); await c.api.loadFromSupabase(); return { fake, c, api: c.api };
  }

  console.log('A-C. lookup collegato / non collegato');

  await test('A: "acqua per brodo" NON collegata usa solo il lookup per nome esatto, identico a prima', async () => {
    const { api } = await loaded({ canonicals: [ACQUA], conversions: [
      conv('cAcqua', 'acqua', 'ml', 1, 'chef_confirmed', '2026-09-01T00:00:00Z'),
      conv('cBrodo', 'acqua per brodo', 'ml', 1.5, 'chef_confirmed', '2026-09-02T00:00:00Z')] });
    const row = linkedRow({ canonicalIngredientId: null });
    const f = api.resolveKnownConversionFactForIngredient(row);
    assert.strictEqual(f.id, 'cBrodo');
    assert.strictEqual(f.factor, 1.5);
    assert.deepStrictEqual(f, api.resolveKnownProductionConversionFact('acqua per brodo', 'ml'), 'stesso risultato del lookup per nome di sempre');
    const { api: api2 } = await loaded({ canonicals: [ACQUA], conversions: [conv('cAcqua', 'acqua', 'ml', 1, 'chef_confirmed', '2026-09-01T00:00:00Z')] });
    assert.strictEqual(api2.resolveKnownConversionFactForIngredient(row), null, 'senza fact col suo nome esatto resta mancante (si chiede), come oggi');
  });

  await test('B: "acqua per brodo" -> ACQUA riusa la fact storica "acqua" (canonical null), senza copiarla ne\' modificarla', async () => {
    const { api, fake } = await loaded({ canonicals: [ACQUA], conversions: [conv('cAcqua', 'acqua', 'ml', 1, 'chef_confirmed', '2026-09-01T00:00:00Z')] });
    const before = JSON.stringify(fake.tables.ingredient_conversions);
    const f = api.resolveKnownConversionFactForIngredient(linkedRow());
    assert.deepStrictEqual({ id: f.id, fromUnit: f.fromUnit, toUnit: f.toUnit, factor: f.factor, sourceType: f.sourceType },
      { id: 'cAcqua', fromUnit: 'ml', toUnit: 'g', factor: 1, sourceType: 'chef_confirmed' });
    const vv = api.S.recipes[0].labVersions[0];
    const prepared = api.buildPreparedInputDaRicettaAttiva(api.S.recipes[0], vv, 4, 300);
    assert.deepStrictEqual(api.findMissingProductionConversions(prepared), [], 'nessuna domanda allo chef');
    api.computeSessionScaling(prepared);
    assert.strictEqual(JSON.stringify(fake.tables.ingredient_conversions), before, 'nessuna fact copiata, aggiornata o creata');
  });

  await test('C: collegata ad ACQUA NON usa la fact storica col nome descrittivo "acqua per brodo"', async () => {
    const { api } = await loaded({ canonicals: [ACQUA], conversions: [conv('cBrodo', 'acqua per brodo', 'ml', 1.5, 'chef_confirmed', '2026-09-02T00:00:00Z')] });
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(linkedRow()), null);
    const prepared = api.buildPreparedInputDaRicettaAttiva(api.S.recipes[0], api.S.recipes[0].labVersions[0], 4, 300);
    assert.deepStrictEqual(api.findMissingProductionConversions(prepared).map(m => m.itemKey), ['ingAcquaBrodo']);
  });

  console.log('');
  console.log('D-G. gerarchia, nome canonico esatto, ingredienti distinti');

  await test('D: canonico — chef_confirmed vince su reference_data anche se reference_data e\' piu\' recente', async () => {
    const { api } = await loaded({ canonicals: [ACQUA], conversions: [
      conv('cChef', 'acqua', 'ml', 1, 'chef_confirmed', '2026-09-01T00:00:00Z', 'ciAcqua'),
      conv('cRef', 'acqua', 'ml', 1.2, 'reference_data', '2026-10-02T00:00:00Z', 'ciAcqua')] });
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(linkedRow()).id, 'cChef');
  });

  await test('E: storica esatta + fact canonica -> stessa gerarchia (sorgente, poi data) sull\'unione', async () => {
    let { api } = await loaded({ canonicals: [ACQUA], conversions: [
      conv('hist', 'acqua', 'ml', 1, 'chef_confirmed', '2026-09-01T00:00:00Z'),
      conv('canonNew', 'acqua', 'ml', 0.99, 'chef_confirmed', '2026-10-01T00:00:00Z', 'ciAcqua')] });
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(linkedRow()).id, 'canonNew', 'chef canonica piu\' recente vince');
    ({ api } = await loaded({ canonicals: [ACQUA], conversions: [
      conv('histNew', 'acqua', 'ml', 1, 'chef_confirmed', '2026-10-05T00:00:00Z'),
      conv('canonOld', 'acqua', 'ml', 0.99, 'chef_confirmed', '2026-10-01T00:00:00Z', 'ciAcqua'),
      conv('canonRef', 'acqua', 'ml', 1.1, 'reference_data', '2026-10-09T00:00:00Z', 'ciAcqua')] }));
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(linkedRow()).id, 'histNew', 'chef storica piu\' recente vince; reference_data piu\' recente non scavalca chef');
  });

  await test('F: ACQUA / acqua / " acqua " risolvono tramite name_key (nessun fuzzy)', async () => {
    const { api } = await loaded({ canonicals: [canon('ciAcqua', ' Acqua ')], conversions: [
      conv('cUpper', 'ACQUA ', 'ml', 1, 'chef_confirmed', '2026-09-01T00:00:00Z'),
      conv('cNat', 'acqua naturale', 'cl', 10, 'chef_confirmed', '2026-09-03T00:00:00Z')] });
    assert.strictEqual(api.S.canonicalIngredientsById.ciAcqua.nameKey, 'acqua');
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(linkedRow()).id, 'cUpper');
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(linkedRow({ unit: 'l' })).id, 'cUpper', 'l -> chiesta come ml');
    assert.ok(!Object.keys(api.S.canonicalConversionFacts).some(k => k.includes('|cl|')), '"acqua naturale" non entra in ACQUA');
  });

  await test('G: zucchero != zucchero a velo (canonici distinti, nessuna fact attraversa)', async () => {
    const { api } = await loaded({ canonicals: [canon('ciZ', 'zucchero'), canon('ciZV', 'zucchero a velo')], conversions: [
      conv('cZ', 'zucchero', 'ml', 0.85, 'chef_confirmed', '2026-09-01T00:00:00Z'),
      conv('cZV', 'zucchero a velo', 'ml', 0.56, 'chef_confirmed', '2026-09-01T00:00:00Z')] });
    assert.strictEqual(api.resolveKnownConversionFactForIngredient({ name: 'zucchero semolato', unit: 'ml', canonicalIngredientId: 'ciZ' }).id, 'cZ');
    assert.strictEqual(api.resolveKnownConversionFactForIngredient({ name: 'zucchero a velo per decorare', unit: 'ml', canonicalIngredientId: 'ciZV' }).id, 'cZV');
    const { api: api2 } = await loaded({ canonicals: [canon('ciZ', 'zucchero')], conversions: [conv('cZV', 'zucchero a velo', 'ml', 0.56, 'chef_confirmed', '2026-09-01T00:00:00Z')] });
    assert.strictEqual(api2.resolveKnownConversionFactForIngredient({ name: 'zucchero', unit: 'ml', canonicalIngredientId: 'ciZ' }), null);
    assert.strictEqual(api2.resolveKnownConversionFactForIngredient({ name: 'zucchero a velo', unit: 'ml', canonicalIngredientId: null }).id, 'cZV', 'non collegata: per nome come oggi');
  });

  console.log('');
  console.log('H. n -> g');

  await test('H: riga collegata -> chef canonica > reference canonica > seed del nome canonico > chiedi; mai il nome della riga', async () => {
    const UOVO = canon('ciUovo', 'uovo');
    const row = { name: 'uova per impasto', qty: 3, unit: 'n', canonicalIngredientId: 'ciUovo' };
    let { api } = await loaded({ canonicals: [UOVO], conversions: [conv('cRiga', 'uova per impasto', 'n', 70, 'chef_confirmed', '2026-09-01T00:00:00Z')] });
    let f = api.resolveKnownConversionFactForIngredient(row);
    assert.deepStrictEqual([f.factor, f.sourceType, f.id], [55, 'reference_data', null], 'seed "uovo" come reference_data; ignorata la fact "uova per impasto"');
    assert.strictEqual(api.knownUnitWeightForIngredient(row), 55, 'stesso valore nel cambio unita\' LAB/Ricetta attiva');
    ({ api } = await loaded({ canonicals: [UOVO], conversions: [conv('cRef', 'uovo', 'n', 50, 'reference_data', '2026-09-01T00:00:00Z', 'ciUovo')] }));
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(row).id, 'cRef', 'reference_data persistita del canonico prima del seed');
    ({ api } = await loaded({ canonicals: [UOVO], conversions: [
      conv('cRef', 'uovo', 'n', 50, 'reference_data', '2026-10-01T00:00:00Z', 'ciUovo'),
      conv('cChefHist', 'uovo', 'n', 60, 'chef_confirmed', '2026-09-01T00:00:00Z')] }));
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(row).id, 'cChefHist', 'chef_confirmed (anche storica esatta) prima di reference_data');
    ({ api } = await loaded({ canonicals: [canon('ciPepe', 'pepe')], conversions: [] }));
    assert.strictEqual(api.resolveKnownConversionFactForIngredient({ name: 'pepe', unit: 'n', canonicalIngredientId: 'ciPepe' }), null, 'nessuna conoscenza -> si chiede');
    assert.strictEqual(api.resolveKnownConversionFactForIngredient({ name: 'uovo', unit: 'n', canonicalIngredientId: null }).factor, 55, 'non collegata: S.unitWeights come oggi');
  });

  console.log('');
  console.log('I-J. propagazione e snapshot');

  await test('I: canonical id sopravvive a load -> LAB -> attivazione -> save -> reload -> input Produzione -> snapshot', async () => {
    const { api, fake } = await loaded({ canonicals: [ACQUA], conversions: [conv('cAcqua', 'acqua', 'ml', 1, 'chef_confirmed', '2026-09-01T00:00:00Z')] });
    const lab = api.S.recipes[0].labVersions[0];
    assert.deepStrictEqual(lab.ingredients.map(i => i.canonicalIngredientId), ['ciAcqua', null], 'load LAB');
    api.rendiAttiva('r1');
    const vv = api.S.recipes[0].validatedVariants[0];
    assert.ok(vv.ingredients[0].id !== 'ingAcquaBrodo', 'attivazione rigenera gli id');
    assert.deepStrictEqual(vv.ingredients.map(i => i.canonicalIngredientId), ['ciAcqua', null], 'attivazione (spread)');
    assert.strictEqual(await api.saveToSupabase(api.S.recipes[0]), true);
    const dbRows = fake.tables.ingredients.filter(i => i.variant_id === 'vLab').sort((a, b) => a.sort_order - b.sort_order);
    assert.deepStrictEqual(dbRows.map(i => i.canonical_ingredient_id), ['ciAcqua', null], 'save validated');
    const c2 = makeClient(handler); await c2.api.loadFromSupabase();
    const vv2 = c2.api.S.recipes[0].validatedVariants[0];
    assert.deepStrictEqual(vv2.ingredients.map(i => i.canonicalIngredientId), ['ciAcqua', null], 'reload validated');
    const prepared = c2.api.buildPreparedInputDaRicettaAttiva(c2.api.S.recipes[0], vv2, 4, 300);
    assert.deepStrictEqual(prepared.ingredients.map(i => [i.canonicalIngredientId, i.canonicalIngredientName]), [['ciAcqua', 'ACQUA'], [null, null]], 'input Produzione');
    const snap = c2.api.buildSessionSnapshotV1(prepared, c2.api.computeSessionScaling(prepared));
    assert.strictEqual(snap.snapshotVersion, 1, 'snapshotVersion invariato');
    assert.deepStrictEqual(snap.ingredients.map(i => [i.canonicalIngredientId, i.canonicalIngredientName]), [['ciAcqua', 'ACQUA'], [null, null]], 'snapshot');
    assert.strictEqual(snap.ingredients[0].name, 'acqua per brodo', 'nome originale della riga intatto');
    assert.strictEqual(snap.ingredients[0].conversionFactId, 'cAcqua', 'fact storica usata nello scaling');
  });

  await test('I2: righe nuove da import restano NON collegate anche se il JSON AI contenesse un collegamento', async () => {
    const block = html.slice(html.indexOf('parsed.ingredients=(parsed.ingredients||[]).map('), html.indexOf('S.loadPreview=parsed;'));
    assert.match(block, /\.\.\.i,id:uid\(\),isSubRecipe:false,subRecipeId:null,canonicalIngredientId:null,/);
    assert.match(block, /\.\.\.i,id:uid\(\),canonicalIngredientId:null,/);
  });

  await test('J: snapshot V1 senza campi canonici resta leggibile (Sessione operativa) e input vecchi danno null', async () => {
    const { api } = await loaded({});
    api.S.productionSessions = [{ id: 'old', targetFinishedTotal: 1000, snapshot: { snapshotVersion: 1, recipe: { recipeName: 'Brodo' }, target: {},
      ingredients: [{ itemKey: 'a', name: 'acqua', unit: 'ml', operativeQty: 900 }], steps: [] } }];
    api.S.openSessionId = 'old';
    assert.match(api.renderSessioneOperativa(), /<span>acqua<\/span>/);
    const legacyInput = { ingredients: [{ id: 'a', name: 'farina', qty: 100, unit: 'g' }], steps: [], targetPortions: 1, targetGramsPerPortion: 100 };
    const snap = api.buildSessionSnapshotV1(legacyInput, api.computeSessionScaling(legacyInput));
    assert.deepStrictEqual([snap.ingredients[0].canonicalIngredientId, snap.ingredients[0].canonicalIngredientName], [null, null]);
  });

  console.log('');
  console.log('K. caricamento canonical_ingredients');

  await test('K: >1000 canonici caricati tutti, a pagine', async () => {
    const many = Array.from({ length: 2005 }, (_, i) => canon('c' + String(i).padStart(5, '0'), 'ing ' + i));
    const { api, fake } = await loaded({ canonicals: many });
    assert.strictEqual(Object.keys(api.S.canonicalIngredientsById).length, 2005);
    assert.ok(fake.calls.filter(c => c.method === 'GET' && c.table === 'canonical_ingredients').length >= 3);
  });

  await test('K2: pagina canonica in errore -> load fallita per intero, nessuno stato canonico parziale', async () => {
    const fake = makeFakeSupabase();
    seed(fake, { canonicals: Array.from({ length: 1500 }, (_, i) => canon('c' + String(i).padStart(5, '0'), 'ing ' + i)) });
    fake.failPage('canonical_ingredients', MAX_ROWS);
    globalThis.fetch = fake.fetch;
    const c = makeClient(handler);
    const logError = console.error; console.error = () => {};
    try { await c.api.loadFromSupabase(); } finally { console.error = logError; }
    assert.strictEqual(c.api.S.recipes.length, 0, 'nessuna ricetta caricata');
    assert.deepStrictEqual(c.api.S.canonicalIngredientsById, {}, 'nessun catalogo parziale');
  });

  console.log('');
  console.log('W. scrittura (percorso gia\' raggiungibile: preflight Produzione)');

  await test('W: conferma chef su riga collegata -> fact con canonical_ingredient_id e ingredient_name = nome canonico; poi nessuna domanda', async () => {
    const { api, fake, c } = await loaded({ canonicals: [ACQUA], conversions: [] });
    api.rendiAttiva('r1');
    const vv = api.S.recipes[0].validatedVariants[0];
    let prepared = api.buildPreparedInputDaRicettaAttiva(api.S.recipes[0], vv, 4, 300);
    const missing = api.findMissingProductionConversions(prepared);
    assert.strictEqual(missing.length, 1);
    api.S.pendingConversionPreflight = { recipeId: 'r1', variantId: vv.id, portions: 4, gpp: 300, missing, value: '', error: null, loading: false, finalError: null };
    await api.confirmConversionPreflightStep('1');
    const saved = fake.tables.ingredient_conversions.at(-1);
    assert.deepStrictEqual([saved.ingredient_name, saved.canonical_ingredient_id, saved.from_unit, saved.source_type], ['acqua', 'ciAcqua', 'ml', 'chef_confirmed']);
    assert.strictEqual(c.created.length, 1, 'Sessione creata nello stesso tentativo');
    const c2 = makeClient(handler); await c2.api.loadFromSupabase();
    prepared = c2.api.buildPreparedInputDaRicettaAttiva(c2.api.S.recipes[0], c2.api.S.recipes[0].labVersions[0], 4, 300);
    assert.deepStrictEqual(c2.api.findMissingProductionConversions(prepared), [], 'dopo reload la fact canonica viene riusata');
  });

  await test('W2: conferma chef su riga NON collegata -> payload identico a prima (nessuna colonna canonica)', async () => {
    const { api, fake } = await loaded({ canonicals: [ACQUA], conversions: [], ingredients: [
      { id: 'ingX', variant_id: 'vLab', name: 'Acqua per brodo', qty: 500, unit: 'ml', sort_order: 0, canonical_ingredient_id: null }] });
    api.rendiAttiva('r1');
    const vv = api.S.recipes[0].validatedVariants[0];
    const missing = api.findMissingProductionConversions(api.buildPreparedInputDaRicettaAttiva(api.S.recipes[0], vv, 4, 300));
    api.S.pendingConversionPreflight = { recipeId: 'r1', variantId: vv.id, portions: 4, gpp: 300, missing, value: '', error: null, loading: false, finalError: null };
    await api.confirmConversionPreflightStep('1');
    const saved = fake.tables.ingredient_conversions.at(-1);
    assert.deepStrictEqual(Object.keys(saved).sort(), ['confirmed_at', 'factor', 'from_unit', 'id', 'ingredient_name', 'source_detail', 'source_type', 'to_unit']);
    assert.strictEqual(saved.ingredient_name, 'acqua per brodo');
  });

  console.log('');
  console.log('X. canonical_ingredient_id non risolvibile (A6, dangling)');

  const GHOST_ROWS = [
    { id: 'ingGhost', variant_id: 'vLab', name: 'acqua per brodo', qty: 1000, unit: 'ml', sort_order: 0, canonical_ingredient_id: 'ciGhost' },
    { id: 'ingUova', variant_id: 'vLab', name: 'uovo', qty: 3, unit: 'n', sort_order: 1, canonical_ingredient_id: 'ciGhost' }];

  await test('X1: dangling -> lookup NON degrada al nome della riga (ne\' fact per nome, ne\' seed per nome)', async () => {
    const { api } = await loaded({ canonicals: [ACQUA], ingredients: GHOST_ROWS, conversions: [
      conv('cBrodo', 'acqua per brodo', 'ml', 1.5, 'chef_confirmed', '2026-09-02T00:00:00Z')] });
    const lab = api.S.recipes[0].labVersions[0];
    assert.deepStrictEqual(lab.ingredients.map(i => i.canonicalIngredientId), ['ciGhost', 'ciGhost'], 'il collegamento resta, non diventa "unlinked"');
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(lab.ingredients[0]), null, 'ignorata la fact "acqua per brodo"');
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(lab.ingredients[1]), null, 'ignorato il seed "uovo" del nome riga');
    assert.strictEqual(api.knownUnitWeightForIngredient(lab.ingredients[1]), null);
    const prepared = api.buildPreparedInputDaRicettaAttiva(api.S.recipes[0], lab, 4, 300);
    assert.deepStrictEqual(prepared.ingredients.map(i => [i.canonicalIngredientId, i.canonicalIngredientName]), [['ciGhost', null], ['ciGhost', null]], 'nessuna identita\' inventata');
  });

  await test('X2: dangling nel preflight Produzione -> nessuna conversione salvata, passo bloccato con errore, nessuna Sessione', async () => {
    const { api, fake, c } = await loaded({ canonicals: [ACQUA], ingredients: [GHOST_ROWS[0]], conversions: [] });
    api.rendiAttiva('r1');
    const vv = api.S.recipes[0].validatedVariants[0];
    const missing = api.findMissingProductionConversions(api.buildPreparedInputDaRicettaAttiva(api.S.recipes[0], vv, 4, 300));
    assert.strictEqual(missing.length, 1);
    const pf = { recipeId: 'r1', variantId: vv.id, portions: 4, gpp: 300, missing, value: '', error: null, loading: false, finalError: null };
    api.S.pendingConversionPreflight = pf;
    const convPosts = () => fake.calls.filter(x => x.method === 'POST' && x.table === 'ingredient_conversions').length;
    await api.confirmConversionPreflightStep('1');
    assert.strictEqual(convPosts(), 0, 'nessuna scrittura su ingredient_conversions');
    assert.deepStrictEqual(fake.tables.ingredient_conversions, [], 'nessuna fact sotto "acqua per brodo"');
    assert.strictEqual(pf.error, 'Ingrediente collegato non trovato nel catalogo. Ricarica la pagina e riprova.');
    assert.strictEqual(pf.loading, false);
    assert.strictEqual(pf.missing.length, 1, 'il passo resta attivo');
    assert.strictEqual(c.created.length, 0, 'nessuna Sessione creata');
    assert.deepStrictEqual([api.S.productionConversionFacts, api.S.canonicalConversionFacts], [{}, {}], 'nessuna cache runtime sporcata');
  });

  await test('X3: dangling nel cambio unita\' n->g (LAB) -> nessuna conversione salvata, riga invariata, segnalazione toast', async () => {
    const { api, fake, c } = await loaded({ canonicals: [ACQUA], ingredients: [GHOST_ROWS[1]], conversions: [] });
    const before = JSON.stringify(api.S.recipes);
    const weightsBefore = JSON.stringify(api.S.unitWeights);
    api.S.pendingUnitConversion = { recipeId: 'r1', ingId: 'ingUova', ingName: 'uovo', canonicalIngredientId: 'ciGhost', qty: 3, newUnit: 'g' };
    api.confirmUnitConversion('60');
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(fake.calls.filter(x => x.method === 'POST' && x.table === 'ingredient_conversions').length, 0);
    assert.strictEqual(JSON.stringify(api.S.unitWeights), weightsBefore, 'S.unitWeights["uovo"] NON aggiornato col nome riga');
    assert.strictEqual(JSON.stringify(api.S.recipes), before, 'riga non convertita');
    assert.strictEqual(api.S.pendingUnitConversion, null);
    assert.deepStrictEqual(c.toasts, ['Ingrediente collegato non trovato nel catalogo. Ricarica la pagina e riprova.']);
  });

  console.log('');
  console.log('S. reference data n->g: una sola fonte');

  await test('S1: nessun secondo catalogo di seed nel codice; il seed per il canonico e\' S.unitWeights[name_key]', async () => {
    assert.ok(!/UNIT_WEIGHT_SEEDS/.test(html), 'UNIT_WEIGHT_SEEDS rimosso');
    const { api } = await loaded({ canonicals: [canon('ciUovo', 'Uovo')], conversions: [] });
    const row = { name: 'uova grandi', qty: 2, unit: 'n', canonicalIngredientId: 'ciUovo' };
    assert.deepStrictEqual(api.resolveKnownConversionFactForIngredient(row), api.resolveKnownProductionConversionFact('uovo', 'n'), 'stesso fatto del lookup per nome canonico');
    api.S.unitWeights.uovo = 58; // ipotetica modifica della tabella reference: una sola fonte, si vede subito
    assert.strictEqual(api.resolveKnownConversionFactForIngredient(row).factor, 58);
  });

  await test('S2: conferma runtime su riga NON collegata "uovo" -> la riga collegata a UOVO la vede subito, come dopo reload', async () => {
    const UOVO = canon('ciUovo', 'uovo');
    const ingredients = [
      { id: 'iU', variant_id: 'vLab', name: 'uovo', qty: 2, unit: 'n', sort_order: 0, canonical_ingredient_id: null }];
    const { api, fake } = await loaded({ canonicals: [UOVO], ingredients, conversions: [
      conv('cRef', 'uovo', 'n', 50, 'reference_data', '2026-10-01T00:00:00Z', 'ciUovo')] });
    api.rendiAttiva('r1');
    delete api.S.unitWeights.uovo; // simula "peso non noto" per la riga non collegata, cosi' il preflight lo chiede
    const vv = api.S.recipes[0].validatedVariants[0];
    const missing = api.findMissingProductionConversions(api.buildPreparedInputDaRicettaAttiva(api.S.recipes[0], vv, 4, 300));
    assert.strictEqual(missing.length, 1);
    api.S.pendingConversionPreflight = { recipeId: 'r1', variantId: vv.id, portions: 4, gpp: 300, missing, value: '', error: null, loading: false, finalError: null };
    await api.confirmConversionPreflightStep('62');
    const saved = fake.tables.ingredient_conversions.at(-1);
    assert.deepStrictEqual([saved.ingredient_name, saved.canonical_ingredient_id], ['uovo', undefined], 'riga non collegata: payload come oggi');
    const linked = { name: 'uova per impasto', qty: 2, unit: 'n', canonicalIngredientId: 'ciUovo' };
    const runtime = api.resolveKnownConversionFactForIngredient(linked);
    assert.deepStrictEqual([runtime.factor, runtime.sourceType], [62, 'chef_confirmed'], 'chef_confirmed batte reference_data canonica');
    const c2 = makeClient(handler); await c2.api.loadFromSupabase();
    const reloaded = c2.api.resolveKnownConversionFactForIngredient(linked);
    assert.deepStrictEqual([reloaded.factor, reloaded.sourceType, reloaded.id], [62, 'chef_confirmed', saved.id], 'stesso risultato dopo reload');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
