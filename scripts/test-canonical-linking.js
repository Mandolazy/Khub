/*
 * Test MS-CI3 — collegamento riga ricetta -> Ingrediente Canonico (UX).
 * Nessun framework: Node puro + assert, stesso stile degli altri test.
 *
 * Codice REALE: api/chat.js (handler) contro un finto PostgREST in memoria
 * (Max rows 1000, vincolo unique su canonical_ingredients.name_key, INSERT
 * senza merge -> 409) e le funzioni client ESTRATTE da khub_mvp.html.
 * Flussi coperti: preflight "Manda in Produzione" e cambio unita' n->g.
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
  const failPost = new Set();
  const matches = (row, filters) => filters.every(([col, op, val]) => {
    const v = row[col] == null ? null : String(row[col]);
    if (op === 'eq') return v === val;
    if (op === 'in') return val.includes(v);
    if (op === 'neq') return v !== val;
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
      if (failPost.has(table)) return reply(500, { message: 'boom ' + table });
      const prefer = (opts.headers && opts.headers.Prefer) || '';
      const merge = prefer.includes('merge-duplicates');
      const data = JSON.parse(opts.body);
      const out = [];
      for (const row0 of (Array.isArray(data) ? data : [data])) {
        const row = { ...row0 };
        if (table === 'canonical_ingredients') {
          row.name_key = String(row.name).trim().toLowerCase(); // colonna generata lower(btrim(name))
          if (!row.created_at) row.created_at = new Date().toISOString();
          if (rows.some(r => r.name_key === row.name_key && r.id !== row.id)) return reply(409, { code: '23505', message: 'duplicate name_key' });
        }
        const i = row.id != null ? rows.findIndex(r => r.id === row.id) : -1;
        if (i >= 0) { if (!merge) return reply(409, { code: '23505', message: 'duplicate pk' }); rows[i] = { ...rows[i], ...row }; }
        else rows.push(row);
        out.push(row);
      }
      return reply(201, prefer.includes('return=representation') ? out : null);
    }
    if (method === 'PATCH') {
      if (failPost.has(table + ':PATCH')) return reply(500, { message: 'boom patch ' + table });
      const patch = JSON.parse(opts.body);
      if (table === 'ingredients' && patch.canonical_ingredient_id != null &&
          !(tables.canonical_ingredients || []).some(c => c.id === patch.canonical_ingredient_id)) {
        return reply(409, { code: '23503', message: 'fk violation' });
      }
      const out = [];
      rows.forEach((r, i) => { if (matches(r, filters)) { rows[i] = { ...r, ...patch }; out.push(rows[i]); } });
      const prefer = (opts.headers && opts.headers.Prefer) || '';
      return reply(200, prefer.includes('return=representation') ? out : null);
    }
    if (method === 'DELETE') { tables[table] = rows.filter(r => !matches(r, filters)); return reply(204, null); }
    throw new Error('metodo non supportato: ' + method);
  }
  return { tables, calls, fetch, failPage: (t, o) => { failOn = { table: t, offset: o }; },
    failPost: (t) => failPost.add(t), healPost: (t) => failPost.delete(t) };
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
const VARS = ['SESSION_SCALING_MASS_TO_GRAMS', 'SESSION_SCALING_VOLUME_TO_ML', 'CANONICAL_UNRESOLVED_MSG', 'CANONICAL_LINK_SAVE_MSG']
  .map(v => html.match(new RegExp('var ' + v + '=[^;]+;'))[0]).join('\n');
const CLIENT_SRC = VARS + '\n' + [
  'function R(id)', 'function curLab(recipe)', 'function uid()', 'function cnum(n)', 'function normalizeIngredientName(name)',
  'function conversionFactSourcePriority(sourceType)', 'function isBetterConversionFact(candidate,current)',
  'function buildCanonicalIngredientIndex(rows)', 'function buildCanonicalConversionFacts(conversions,canonicalById)',
  'function resolveKnownCanonicalConversionFact(canonicalId,unit)', 'function resolveKnownConversionFactForIngredient(ing)',
  'function knownUnitWeightForIngredient(ing)', 'function conversionWriteIdentity(ingredientName,canonicalIngredientId)',
  'function rememberConfirmedConversion(conv,canonicalIngredientId)', 'function rememberCanonicalConversionFact(conv,canonicalIngredientId)',
  'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)',
  'function resolveSessionScalingConversionToGrams(unit,conversionFact)', 'function chooseConversionAskUnit(unit)',
  'function resolveKnownProductionConversionFact(normalizedName,unit)',
  'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)',
  'function findMissingProductionConversions(preparedInput)', 'function computeSessionScaling(input)',
  'function buildSessionSnapshotV1(meta,computed)',
  'function buildKnownIngredientIds(ingredientRows)', 'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'function beginRecipeSave(recipeId)', 'async function saveToSupabase(recipe)',
  'function upRec(id,fn)', 'function upLab(id,fn)', 'function rendiAttiva(recipeId)', 'function recalcGramsPerPortion(vv)',
  'async function saveIngredientConversion(ingredientName,fromUnit,toUnit,factor,sourceType,sourceDetail,canonicalIngredientId)',
  'async function confirmMandaInProduzione()', 'async function confirmConversionPreflightStep(rawValue)',
  'async function advanceConversionPreflight(pf)', 'async function linkPreflightIngredient(pf,canonicalId)',
  'function cancelConversionPreflight()', 'function renderConversionPreflightModal()',
  'function findCanonicalByExactName(name)', 'function searchCanonicalIngredients(query)', 'function escapeCanonicalText(v)',
  'function newCanonicalIdentityStep(itemKey,ingName)', 'async function createOrReuseCanonicalIngredient(identity,rawName)',
  'function setIngredientCanonicalLink(recipeId,variantId,ingId,canonicalId)', 'function findIngredientRow(recipeId,variantId,ingId)',
  'function watchRecipeSaves(recipeId)', 'async function patchIngredientCanonicalLink(ingId,variantId,canonicalId)', 'async function persistIngredientCanonicalLink(recipeId,variantId,ingId,canonicalId)',
  'function canonicalIdentityOwner(ctx)', 'function renderCanonicalSearchResults(ctx,query)',
  'function renderCanonicalIdentityStep(ctx,owner,ingName,cancelCall)', 'function onCanonicalIdentitySearch(ctx,val)',
  'function onCanonicalIdentityCreateName(ctx,val)', 'async function selectCanonicalIdentity(ctx,canonicalId)',
  'async function createCanonicalIdentity(ctx,rawName)', 'function skipCanonicalIdentity(ctx)',
  'function onIngUnit(recipeId,ingId,val)', 'function onVarIngUnit(recipeId,varId,ingId,val)',
  'function confirmUnitConversion(pesoMedio)', 'function applyUnitConversionToRow(p,peso)',
  'function openUnitConversionPending(p)', 'async function linkPendingUnitIngredient(p,canonicalId)',
  'function cancelUnitConversion()', 'function renderUnitConversionModal()',
].map(extractFunction).join('\n');

const SEEDS = { uovo: 55 };

function makeClient(handler) {
  async function callApi(body) {
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { status, body: out };
  }
  const apiCalls = [];
  const httpFail = new Set();
  const holdNextSave = []; // promesse: il prossimo 'save' attende la sua prima di arrivare al DB
  const clientFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    apiCalls.push(body.supabaseAction);
    // Errore HTTP del proxy/funzione (es. 500 senza ok:false nel corpo)
    if (httpFail.has(body.supabaseAction)) return { ok: false, status: 500, json: async () => ({}) };
    if (body.supabaseAction === 'save' && holdNextSave.length) await holdNextSave.shift();
    const r = await callApi(body);
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  const created = [], toasts = [];
  const factory = new Function('fetch', 'toast', 'render', 'autosave', 'addHistory', 'confirm', 'createProductionSession', 'SEEDS', 'document', `
    var S={recipes:[],selectedId:null,view:'',families:[],variantFamilies:{},unitWeights:Object.assign({},SEEDS),unitWeightFacts:{},
      productionConversionFacts:{},canonicalIngredientsById:{},canonicalConversionFacts:{},pendingConversionPreflight:null,
      pendingMandaInProduzione:null,pendingUnitConversion:null,productionSessions:[],openSessionId:null};
    var _knownIngredientIdsByVariant={};
    var _recipeSaveTracking={inFlight:{},watchers:{}};
    ${CLIENT_SRC}
    return {S, loadFromSupabase, saveToSupabase, rendiAttiva, buildPreparedInputDaRicettaAttiva, findMissingProductionConversions,
      confirmMandaInProduzione, confirmConversionPreflightStep, renderConversionPreflightModal, cancelConversionPreflight,
      selectCanonicalIdentity, createCanonicalIdentity, skipCanonicalIdentity, onCanonicalIdentitySearch, findCanonicalByExactName,
      searchCanonicalIngredients, onIngUnit, onVarIngUnit, confirmUnitConversion, renderUnitConversionModal, resolveKnownConversionFactForIngredient};
  `);
  const fakeDocument = { getElementById: () => null };
  return { created, toasts, apiCalls, httpFail, holdNextSave, api: factory(clientFetch, (msg) => { toasts.push(msg); }, () => {}, () => {}, () => {}, () => true,
    async (input) => { created.push(input); return { sessionId: 'ps' + created.length }; }, SEEDS, fakeDocument) };
}

const ACQUA = canon('ciAcqua', 'ACQUA');
const UOVO = canon('ciUovo', 'uovo');
const H_ACQUA = conv('hAcqua', 'acqua', 'ml', 1, 'chef_confirmed', '2026-09-01T00:00:00Z'); // fact storica, canonical null
const row = (id, name, qty, unit, canonical_ingredient_id = null, sort_order = 0) =>
  ({ id, variant_id: 'vLab', name, qty, unit, sort_order, canonical_ingredient_id });
const LINK_ERR = 'Errore nel salvataggio del collegamento. Riprova.';

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const flush = () => new Promise(r => setTimeout(r, 0));

  // Ricetta caricata e attivata (variante validata = sorgente del preflight).
  async function ready(opts) {
    const fake = makeFakeSupabase(); seed(fake, opts); globalThis.fetch = fake.fetch;
    const c = makeClient(handler); await c.api.loadFromSupabase();
    c.api.rendiAttiva('r1');
    assert.strictEqual(await c.api.saveToSupabase(c.api.S.recipes[0]), true);
    const vv = c.api.S.recipes[0].validatedVariants[0];
    return { fake, c, api: c.api, vv };
  }
  async function mandaInProduzione(api, vv) {
    api.S.pendingMandaInProduzione = { recipeId: 'r1', variantId: vv.id, portions: '4', gpp: '300', error: null, loading: false };
    await api.confirmMandaInProduzione();
    return api.S.pendingConversionPreflight;
  }
  const dbRow = (fake, name) => fake.tables.ingredients.find(i => i.variant_id === 'vLab' && i.name === name);
  const posts = (fake, table) => fake.calls.filter(x => x.method === 'POST' && x.table === table).length;
  const patches = (fake, table) => fake.calls.filter(x => x.method === 'PATCH' && x.table === table).length;

  console.log('1-2. collegamento automatico solo per nome identico');

  await test('1: " Acqua " + canonico ACQUA -> collegata automaticamente e persistita; poi si chiede solo il valore', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], ingredients: [row('i1', ' Acqua ', 500, 'ml')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    assert.strictEqual(pf.identity, null, 'nessun passo "identifica"');
    assert.strictEqual(pf.missing.length, 1);
    assert.strictEqual(pf.missing[0].canonicalIngredientId, 'ciAcqua');
    assert.strictEqual(dbRow(fake, ' Acqua ').canonical_ingredient_id, 'ciAcqua', 'link persistito');
    assert.strictEqual(c.created.length, 0);
    assert.match(api.renderConversionPreflightModal(), /Quanto pesa 1 ml di  Acqua  \(ACQUA\)\?/);
  });

  await test('1b: nome identico + fact storica "acqua" -> collegata, nessuna domanda, Sessione creata', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], conversions: [H_ACQUA], ingredients: [row('i1', 'ACQUA', 500, 'ml')] });
    // il lookup per nome trova gia' la fact: nessuna conversione mancante -> nessun collegamento serve
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    assert.strictEqual(pf, null);
    assert.strictEqual(c.created.length, 1);
    assert.strictEqual(dbRow(fake, 'ACQUA').canonical_ingredient_id, null, 'mai mostrato/collegato quando non serve');
  });

  await test('2: "acqua per brodo" + ACQUA -> nessun collegamento automatico, passo "identifica"', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const before = posts(fake, 'ingredients');
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    assert.ok(pf.identity, 'passo "identifica" attivo');
    assert.strictEqual(pf.identity.createName, 'acqua per brodo', 'nome nuovo precompilato col nome della riga');
    assert.strictEqual(posts(fake, 'ingredients'), before, 'nessun salvataggio');
    assert.strictEqual(dbRow(fake, 'acqua per brodo').canonical_ingredient_id, null);
    assert.strictEqual(c.created.length, 0);
    const html = api.renderConversionPreflightModal();
    assert.match(html, /Collega a ingrediente esistente/);
    assert.match(html, /Crea e collega/);
    assert.match(html, /Continua senza collegare/);
    assert.match(html, /value="acqua per brodo"/);
    for (const n of ['acqua naturale', 'acqua per marinatura']) assert.strictEqual(api.findCanonicalByExactName(n), null);
    for (const n of ['Acqua', ' acqua ', 'ACQUA']) assert.strictEqual(api.findCanonicalByExactName(n).id, 'ciAcqua');
  });

  await test('2b: ricerca testuale mostra i canonici ma non collega nulla', async () => {
    const { api, fake } = await ready({ canonicals: [ACQUA, canon('ciAZ', 'acqua frizzante'), UOVO], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    api.onCanonicalIdentitySearch('preflight', 'ACQ');
    assert.deepStrictEqual(api.searchCanonicalIngredients('ACQ').map(c => c.id), ['ciAcqua', 'ciAZ']);
    assert.strictEqual(pf.identity.query, 'ACQ');
    assert.strictEqual(dbRow(fake, 'acqua per brodo').canonical_ingredient_id, null);
    assert.strictEqual(api.S.recipes[0].validatedVariants[0].ingredients[0].canonicalIngredientId, null);
  });

  console.log('');
  console.log('3-6. collega a esistente / continua senza collegare');

  await test('3+4+12: collega "acqua per brodo" ad ACQUA -> link persistito, fact storica "acqua" riusata, nessuna domanda, nome invariato', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], conversions: [H_ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const convBefore = JSON.stringify(fake.tables.ingredient_conversions);
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    assert.ok(pf.identity);
    await api.selectCanonicalIdentity('preflight', 'ciAcqua');
    const db = fake.tables.ingredients.find(i => i.variant_id === 'vLab');
    assert.deepStrictEqual([db.name, db.canonical_ingredient_id], ['acqua per brodo', 'ciAcqua'], 'nome invariato, link persistito');
    assert.strictEqual(api.S.pendingConversionPreflight, null, 'nessuna domanda di conversione');
    assert.strictEqual(c.created.length, 1, 'Sessione creata');
    assert.strictEqual(JSON.stringify(fake.tables.ingredient_conversions), convBefore, 'nessuna fact copiata/aggiornata/creata');
    const ing = c.created[0].ingredients[0];
    assert.deepStrictEqual([ing.name, ing.canonicalIngredientId, ing.canonicalIngredientName, ing.conversionFact.id], ['acqua per brodo', 'ciAcqua', 'ACQUA', 'hAcqua']);
    assert.strictEqual(api.S.recipes[0].validatedVariants[0].ingredients[0].name, 'acqua per brodo');
  });

  await test('5+13: link riuscito ma conversione assente -> si chiede il valore, fact su canonico; dopo reload link e fact riusati', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    await api.selectCanonicalIdentity('preflight', 'ciAcqua');
    assert.strictEqual(api.S.pendingConversionPreflight, pf);
    assert.strictEqual(pf.identity, null, 'ora si chiede il valore');
    assert.strictEqual(c.created.length, 0);
    await api.confirmConversionPreflightStep('1');
    const saved = fake.tables.ingredient_conversions;
    assert.strictEqual(saved.length, 1);
    assert.deepStrictEqual([saved[0].ingredient_name, saved[0].canonical_ingredient_id, saved[0].from_unit, saved[0].source_type], ['acqua', 'ciAcqua', 'ml', 'chef_confirmed']);
    assert.strictEqual(c.created.length, 1);
    const c2 = makeClient(handler); await c2.api.loadFromSupabase();
    const vv2 = c2.api.S.recipes[0].validatedVariants[0];
    assert.deepStrictEqual([vv2.ingredients[0].name, vv2.ingredients[0].canonicalIngredientId], ['acqua per brodo', 'ciAcqua'], 'reload: link persistente');
    assert.strictEqual(await mandaInProduzione(c2.api, vv2), null, 'reload: nessuna domanda');
    assert.strictEqual(c2.created.length, 1);
  });

  await test('6: continua senza collegare -> comportamento legacy (domanda per nome riga, fact senza canonical)', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], conversions: [H_ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    api.skipCanonicalIdentity('preflight');
    assert.strictEqual(pf.identity, null);
    assert.match(api.renderConversionPreflightModal(), /Quanto pesa 1 ml di acqua per brodo\?/);
    await api.confirmConversionPreflightStep('1.02');
    const saved = fake.tables.ingredient_conversions.at(-1);
    assert.deepStrictEqual(Object.keys(saved).sort(), ['confirmed_at', 'factor', 'from_unit', 'id', 'ingredient_name', 'source_detail', 'source_type', 'to_unit']);
    assert.strictEqual(saved.ingredient_name, 'acqua per brodo');
    assert.strictEqual(dbRow(fake, 'acqua per brodo').canonical_ingredient_id, null);
    assert.strictEqual(c.created.length, 1);
  });

  console.log('');
  console.log('7-8. crea nuovo / duplicati');

  await test('7: crea "ACQUA" (prefill modificato) -> canonico creato, riga collegata, fact storica "acqua" riusata', async () => {
    const { api, fake, c } = await ready({ canonicals: [], conversions: [H_ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    assert.strictEqual(pf.identity.createName, 'acqua per brodo');
    await api.createCanonicalIdentity('preflight', '  ACQUA ');
    assert.strictEqual(fake.tables.canonical_ingredients.length, 1);
    const ci = fake.tables.canonical_ingredients[0];
    assert.deepStrictEqual([ci.name, ci.name_key], ['ACQUA', 'acqua'], 'nome pulito dagli spazi, name_key generata');
    assert.strictEqual(dbRow(fake, 'acqua per brodo').canonical_ingredient_id, ci.id);
    assert.strictEqual(api.S.canonicalIngredientsById[ci.id].name, 'ACQUA', 'catalogo runtime aggiornato');
    assert.strictEqual(c.created.length, 1, 'nessuna domanda: fact storica esatta del nuovo canonico');
    assert.strictEqual(c.created[0].ingredients[0].conversionFact.id, 'hAcqua');
    assert.strictEqual(fake.tables.ingredient_conversions.length, 1, 'nessuna fact nuova');
  });

  await test('7b: crea con nome vuoto -> errore, nulla creato', async () => {
    const { api, fake } = await ready({ canonicals: [], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    await api.createCanonicalIdentity('preflight', '   ');
    assert.match(pf.error, /nome/);
    assert.strictEqual(posts(fake, 'canonical_ingredients'), 0);
    assert.ok(pf.identity);
  });

  await test('8: " ACQUA " quando ACQUA e\' nel catalogo -> nessun duplicato, nessun INSERT, usa quello esistente', async () => {
    const { api, fake } = await ready({ canonicals: [ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    await api.createCanonicalIdentity('preflight', ' ACQUA ');
    assert.strictEqual(posts(fake, 'canonical_ingredients'), 0);
    assert.strictEqual(fake.tables.canonical_ingredients.length, 1);
    assert.strictEqual(dbRow(fake, 'acqua per brodo').canonical_ingredient_id, 'ciAcqua');
  });

  await test('8b: ACQUA creata altrove dopo il load (conflitto unique name_key) -> rilettura, usa l\'esistente', async () => {
    const { api, fake } = await ready({ canonicals: [], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    fake.tables.canonical_ingredients.push(canon('ciAltro', 'Acqua'));
    await api.createCanonicalIdentity('preflight', ' ACQUA ');
    assert.strictEqual(posts(fake, 'canonical_ingredients'), 1, 'un INSERT, rifiutato');
    assert.deepStrictEqual(fake.tables.canonical_ingredients.map(r => r.id), ['ciAltro'], 'nessun duplicato');
    assert.strictEqual(dbRow(fake, 'acqua per brodo').canonical_ingredient_id, 'ciAltro');
    assert.strictEqual(api.S.canonicalIngredientsById.ciAltro.name, 'Acqua');
  });

  await test('8c: creazione fallita -> errore, nessun link, retry con lo stesso id (idempotente)', async () => {
    const { api, fake, c } = await ready({ canonicals: [], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    fake.failPost('canonical_ingredients');
    await api.createCanonicalIdentity('preflight', 'ACQUA');
    assert.match(pf.error, /creazione dell'ingrediente/);
    assert.strictEqual(pf.loading, false);
    assert.strictEqual(dbRow(fake, 'acqua per brodo').canonical_ingredient_id, null);
    const firstId = pf.identity.createId;
    fake.healPost('canonical_ingredients');
    await api.createCanonicalIdentity('preflight', 'ACQUA');
    assert.deepStrictEqual(fake.tables.canonical_ingredients.map(r => r.id), [firstId], 'stesso id riusato');
    assert.strictEqual(dbRow(fake, 'acqua per brodo').canonical_ingredient_id, firstId);
    assert.strictEqual(c.created.length, 0, 'conversione ancora da chiedere');
    assert.strictEqual(pf.identity, null);
  });

  console.log('');
  console.log('9-10. errori e doppio click');

  await test('9: salvataggio link fallito -> errore sul passo, link annullato in memoria, nessuna Sessione, nessuna fact', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], conversions: [H_ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    fake.failPost('ingredients:PATCH');
    await api.selectCanonicalIdentity('preflight', 'ciAcqua');
    assert.strictEqual(pf.error, LINK_ERR);
    assert.ok(pf.identity, 'resta sul passo "identifica"');
    assert.strictEqual(pf.loading, false);
    assert.strictEqual(api.S.recipes[0].validatedVariants[0].ingredients[0].canonicalIngredientId, null, 'nessun link fantasma');
    assert.strictEqual(c.created.length, 0);
    assert.strictEqual(fake.tables.ingredient_conversions.length, 1);
  });

  await test('9b: auto-link (nome identico) fallito -> passo "identifica" con errore, nessuna Sessione', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], ingredients: [row('i1', 'acqua', 500, 'ml')] });
    fake.failPost('ingredients:PATCH');
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    assert.strictEqual(pf.error, LINK_ERR);
    assert.ok(pf.identity);
    assert.strictEqual(api.S.recipes[0].validatedVariants[0].ingredients[0].canonicalIngredientId, null);
    assert.strictEqual(c.created.length, 0);
    fake.healPost('ingredients:PATCH');
    await api.selectCanonicalIdentity('preflight', 'ciAcqua');
    assert.strictEqual(pf.identity, null, 'retry manuale riuscito');
    assert.strictEqual(dbRow(fake, 'acqua').canonical_ingredient_id, 'ciAcqua');
  });

  await test('9c: canonico non risolvibile scelto -> errore, nessun link', async () => {
    const { api, fake } = await ready({ canonicals: [ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    await api.selectCanonicalIdentity('preflight', 'ciGhost');
    assert.strictEqual(pf.error, 'Ingrediente collegato non trovato nel catalogo. Ricarica la pagina e riprova.');
    assert.strictEqual(dbRow(fake, 'acqua per brodo').canonical_ingredient_id, null);
  });

  await test('10: doppio click su collega / crea / conferma -> un solo link, un solo canonico, una sola fact, una sola Sessione', async () => {
    let { api, fake, c } = await ready({ canonicals: [ACQUA], conversions: [H_ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    await Promise.all([api.selectCanonicalIdentity('preflight', 'ciAcqua'), api.selectCanonicalIdentity('preflight', 'ciAcqua')]);
    assert.strictEqual(patches(fake, 'ingredients'), 1, 'un solo salvataggio del link');
    assert.strictEqual(c.created.length, 1, 'una sola Sessione');

    ({ api, fake, c } = await ready({ canonicals: [], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] }));
    await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    await Promise.all([api.createCanonicalIdentity('preflight', 'ACQUA'), api.createCanonicalIdentity('preflight', 'ACQUA')]);
    assert.strictEqual(fake.tables.canonical_ingredients.length, 1, 'un solo canonico');
    assert.strictEqual(posts(fake, 'canonical_ingredients'), 1);
    await Promise.all([api.confirmConversionPreflightStep('1'), api.confirmConversionPreflightStep('1')]);
    assert.strictEqual(fake.tables.ingredient_conversions.length, 1, 'una sola fact');
    assert.strictEqual(c.created.length, 1, 'una sola Sessione');

    ({ api, fake, c } = await ready({ canonicals: [ACQUA], conversions: [H_ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] }));
    const vv = api.S.recipes[0].validatedVariants[0];
    api.S.pendingMandaInProduzione = { recipeId: 'r1', variantId: vv.id, portions: '4', gpp: '300', error: null, loading: false };
    await Promise.all([api.confirmMandaInProduzione(), api.confirmMandaInProduzione()]);
    assert.ok(api.S.pendingConversionPreflight.identity, 'un solo preflight aperto');
  });

  console.log('');
  console.log('11. n -> g (preflight e cambio unita\')');

  await test('11a: preflight "uova per impasto" (n) -> collega a UOVO -> peso di riferimento del canonico, nessuna domanda', async () => {
    const { api, fake, c } = await ready({ canonicals: [UOVO], ingredients: [row('i1', 'uova per impasto', 3, 'n')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    assert.ok(pf.identity, 'il nome riga non e\' identico: si chiede l\'identita\'');
    await api.selectCanonicalIdentity('preflight', 'ciUovo');
    assert.strictEqual(c.created.length, 1);
    const ing = c.created[0].ingredients[0];
    assert.deepStrictEqual([ing.conversionFact.factor, ing.conversionFact.sourceType], [55, 'reference_data']);
    assert.strictEqual(fake.tables.ingredient_conversions.length, 0);
  });

  await test('11b: preflight n senza peso noto per il canonico -> valore chiesto e salvato sul canonico', async () => {
    const { api, fake, c } = await ready({ canonicals: [canon('ciPesca', 'pesca')], ingredients: [row('i1', 'pesche per decorazione', 4, 'n')] });
    const pf = await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]);
    await api.selectCanonicalIdentity('preflight', 'ciPesca');
    assert.strictEqual(pf.identity, null);
    assert.match(api.renderConversionPreflightModal(), /Quanto pesa 1 pesche per decorazione \(pesca\)\?/);
    await api.confirmConversionPreflightStep('150');
    const saved = fake.tables.ingredient_conversions[0];
    assert.deepStrictEqual([saved.ingredient_name, saved.canonical_ingredient_id, saved.from_unit, saved.factor], ['pesca', 'ciPesca', 'n', 150]);
    assert.strictEqual(c.created.length, 1);
  });

  await test('11c: LAB cambio unita\' n->g -> identifica -> UOVO: peso noto, convertita subito, link persistito, nome invariato', async () => {
    const fake = makeFakeSupabase(); seed(fake, { canonicals: [UOVO], ingredients: [row('ingUova01', 'uova per impasto', 3, 'n')] }); globalThis.fetch = fake.fetch;
    const c = makeClient(handler); await c.api.loadFromSupabase();
    const api = c.api;
    api.onIngUnit('r1', 'ingUova01', 'g');
    const p = api.S.pendingUnitConversion;
    assert.ok(p && p.identity, 'passo "identifica" nel modal peso medio');
    assert.match(api.renderUnitConversionModal(), /Continua senza collegare/);
    await api.selectCanonicalIdentity('unit', 'ciUovo');
    assert.strictEqual(api.S.pendingUnitConversion, null);
    const lab = api.S.recipes[0].labVersions[0].ingredients[0];
    assert.deepStrictEqual([lab.name, lab.unit, lab.qty, lab.canonicalIngredientId], ['uova per impasto', 'g', 165, 'ciUovo']);
    assert.strictEqual(dbRow(fake, 'uova per impasto').canonical_ingredient_id, 'ciUovo');
    assert.strictEqual(fake.tables.ingredient_conversions.length, 0);
  });

  await test('11d: Ricetta attiva cambio unita\' n->g -> crea "PEPE ROSA" -> valore chiesto e salvato sul canonico', async () => {
    const { api, fake, vv } = await ready({ canonicals: [], ingredients: [row('i1', 'pepe rosa in grani', 10, 'n')] });
    const ingId = vv.ingredients[0].id;
    api.onVarIngUnit('r1', vv.id, ingId, 'g');
    await api.createCanonicalIdentity('unit', 'PEPE ROSA');
    const p = api.S.pendingUnitConversion;
    assert.ok(p && !p.identity, 'ora si chiede il peso');
    assert.match(api.renderUnitConversionModal(), /pepe rosa in grani \(PEPE ROSA\)/);
    api.confirmUnitConversion('0.1');
    await flush(); await flush();
    const ci = fake.tables.canonical_ingredients[0];
    const saved = fake.tables.ingredient_conversions[0];
    assert.deepStrictEqual([saved.ingredient_name, saved.canonical_ingredient_id, saved.from_unit], ['pepe rosa', ci.id, 'n']);
    const db = fake.tables.ingredients.find(i => i.id === ingId);
    assert.deepStrictEqual([db.name, db.canonical_ingredient_id], ['pepe rosa in grani', ci.id]);
  });

  await test('11e: cambio unita\' n->g, nome identico al canonico -> collegamento automatico, poi domanda del peso', async () => {
    const fake = makeFakeSupabase(); seed(fake, { canonicals: [canon('ciPepe', 'Pepe')], ingredients: [row('ingPepe01', 'pepe', 10, 'n')] }); globalThis.fetch = fake.fetch;
    const c = makeClient(handler); await c.api.loadFromSupabase();
    c.api.onIngUnit('r1', 'ingPepe01', 'g');
    await flush(); await flush(); await flush();
    const p = c.api.S.pendingUnitConversion;
    assert.ok(p && !p.identity && !p.loading);
    assert.strictEqual(p.canonicalIngredientId, 'ciPepe');
    assert.strictEqual(dbRow(fake, 'pepe').canonical_ingredient_id, 'ciPepe');
  });

  await test('11f: cambio unita\' n->g, continua senza collegare -> legacy invariato', async () => {
    const fake = makeFakeSupabase(); seed(fake, { canonicals: [UOVO], ingredients: [row('i1', 'uova per impasto', 3, 'n')] }); globalThis.fetch = fake.fetch;
    const c = makeClient(handler); await c.api.loadFromSupabase();
    c.api.onIngUnit('r1', 'i1', 'g');
    c.api.skipCanonicalIdentity('unit');
    c.api.confirmUnitConversion('60');
    await flush(); await flush();
    const saved = fake.tables.ingredient_conversions[0];
    assert.deepStrictEqual([saved.ingredient_name, saved.canonical_ingredient_id], ['uova per impasto', undefined]);
    assert.strictEqual(c.api.S.unitWeights['uova per impasto'], 60);
    assert.strictEqual(c.api.S.recipes[0].labVersions[0].ingredients[0].canonicalIngredientId, null);
  });

  console.log('');
  console.log('A-H. persistenza atomica e mirata del collegamento');

  // Fotografia del DB fuori dalla colonna del collegamento.
  const dbExceptLink = (fake) => JSON.stringify({
    ingredients: fake.tables.ingredients.map(({ canonical_ingredient_id, ...rest }) => rest),
    recipes: fake.tables.recipes, variants: fake.tables.variants, l2: fake.tables.l2_items, l3: fake.tables.l3_items });

  async function linkScenario(opts, act) {
    const ctx = await ready(opts);
    const { api, fake, c } = ctx;
    const vv = api.S.recipes[0].validatedVariants[0];
    const pf = await mandaInProduzione(api, vv);
    // modifiche in memoria NON salvate (nessun autosave nel banco di prova)
    api.S.recipes = api.S.recipes.map(r => ({ ...r, name: 'Ramen MODIFICATO', validatedVariants: r.validatedVariants.map(v => ({ ...v,
      ingredients: v.ingredients.map((i, idx) => idx === 1 ? { ...i, qty: 999, name: 'farina MODIFICATA' } : i) })) }));
    const dbBefore = dbExceptLink(fake);
    const linkRowBefore = { ...fake.tables.ingredients.find(i => i.id === vv.ingredients[0].id) };
    const callsBefore = c.apiCalls.length;
    await act(ctx, pf);
    return { ...ctx, pf, vv, dbBefore, linkRowBefore, actionsDuringLink: c.apiCalls.slice(callsBefore) };
  }
  const twoRows = [row('i1', 'acqua per brodo', 500, 'ml'), row('i2', 'farina', 200, 'g', null, 1)];

  await test('A+B+H+F: collega a esistente -> nel DB cambia SOLO canonical_ingredient_id di quella riga; nessun save della ricetta', async () => {
    const r = await linkScenario({ canonicals: [ACQUA], conversions: [H_ACQUA], ingredients: twoRows },
      async ({ api }) => { await api.selectCanonicalIdentity('preflight', 'ciAcqua'); });
    const after = r.fake.tables.ingredients.find(i => i.id === r.vv.ingredients[0].id);
    assert.deepStrictEqual({ ...after, canonical_ingredient_id: null }, { ...r.linkRowBefore, canonical_ingredient_id: null }, 'nome/qty/unit/sort/rese invariati');
    assert.strictEqual(after.canonical_ingredient_id, 'ciAcqua');
    assert.strictEqual(r.dbBefore, dbExceptLink(r.fake), 'nessun altro campo/riga/ricetta toccato');
    assert.strictEqual(r.fake.tables.recipes[0].name, 'Ramen', 'modifica in sospeso NON salvata');
    assert.ok(r.fake.tables.ingredients.every(i => i.name !== 'farina MODIFICATA' && i.qty !== 999));
    assert.ok(!r.actionsDuringLink.includes('save'), 'nessun saveToSupabase durante il collegamento');
    assert.strictEqual(r.actionsDuringLink.filter(a => a === 'linkIngredientCanonical').length, 1);
    assert.strictEqual(patches(r.fake, 'ingredients'), 1);
    assert.strictEqual(r.c.created.length, 1, 'poi Sessione (fact storica riusata)');
  });

  await test('E: collegamento automatico per nome identico -> stesso percorso atomico', async () => {
    const r = await linkScenario({ canonicals: [ACQUA], ingredients: [row('i1', 'Acqua', 500, 'ml'), row('i2', 'farina', 200, 'g', null, 1)] },
      async () => {});
    // l'auto-link e' gia' avvenuto dentro mandaInProduzione: si rilegge l'intera sequenza delle azioni
    assert.strictEqual(r.c.apiCalls.filter(a => a === 'save').length, 1, 'solo il save di preparazione del test, nessuno durante l\'auto-link');
    assert.strictEqual(r.c.apiCalls.filter(a => a === 'linkIngredientCanonical').length, 1);
    assert.strictEqual(patches(r.fake, 'ingredients'), 1);
    assert.strictEqual(r.fake.tables.ingredients.find(i => i.id === r.vv.ingredients[0].id).canonical_ingredient_id, 'ciAcqua');
    assert.strictEqual(r.pf.identity, null);
  });

  await test('G: crea e collega -> canonico creato, poi stesso percorso atomico (nessun save della ricetta)', async () => {
    const r = await linkScenario({ canonicals: [], conversions: [H_ACQUA], ingredients: twoRows },
      async ({ api }) => { await api.createCanonicalIdentity('preflight', 'ACQUA'); });
    assert.deepStrictEqual(r.actionsDuringLink.filter(a => a !== 'saveConversion'), ['createCanonicalIngredient', 'linkIngredientCanonical']);
    assert.strictEqual(r.dbBefore, dbExceptLink(r.fake));
    assert.strictEqual(r.fake.tables.recipes[0].name, 'Ramen');
  });

  await test('C+D: errore HTTP 500 (senza ok:false) sul link -> riconosciuto come errore; niente fact, niente Sessione, memoria coerente', async () => {
    const r = await linkScenario({ canonicals: [ACQUA], conversions: [H_ACQUA], ingredients: twoRows },
      async ({ api, c }) => { c.httpFail.add('linkIngredientCanonical'); await api.selectCanonicalIdentity('preflight', 'ciAcqua'); });
    assert.strictEqual(r.pf.error, LINK_ERR);
    assert.ok(r.pf.identity);
    assert.strictEqual(r.api.S.recipes[0].validatedVariants[0].ingredients[0].canonicalIngredientId, null);
    assert.strictEqual(r.fake.tables.ingredients.find(i => i.id === r.vv.ingredients[0].id).canonical_ingredient_id, null);
    assert.strictEqual(r.fake.tables.ingredient_conversions.length, 1);
    assert.strictEqual(r.c.created.length, 0);
  });

  await test('C2: errore Supabase sul PATCH, riga non salvata (0 righe) e FK violata -> tutti errori, nessun falso successo', async () => {
    let r = await linkScenario({ canonicals: [ACQUA], ingredients: twoRows },
      async ({ api, fake }) => { fake.failPost('ingredients:PATCH'); await api.selectCanonicalIdentity('preflight', 'ciAcqua'); });
    assert.strictEqual(r.pf.error, LINK_ERR);
    r = await linkScenario({ canonicals: [ACQUA], ingredients: twoRows },
      async ({ api, fake }) => { fake.tables.ingredients = fake.tables.ingredients.filter(i => i.name !== 'acqua per brodo'); await api.selectCanonicalIdentity('preflight', 'ciAcqua'); });
    assert.strictEqual(r.pf.error, LINK_ERR, 'riga non (ancora) presente nel DB');
    assert.strictEqual(r.api.S.recipes[0].validatedVariants[0].ingredients[0].canonicalIngredientId, null);
    r = await linkScenario({ canonicals: [ACQUA], ingredients: twoRows },
      async ({ api, fake }) => { fake.tables.canonical_ingredients = []; await api.selectCanonicalIdentity('preflight', 'ciAcqua'); });
    assert.strictEqual(r.pf.error, LINK_ERR, 'FK: canonico non presente nel DB');
    assert.strictEqual(r.c.created.length, 0);
  });

  await test('C3: riga con id non stabile (corto) -> collegamento rifiutato senza alcuna richiesta', async () => {
    const fake = makeFakeSupabase(); seed(fake, { canonicals: [UOVO], ingredients: [row('i1', 'uova per impasto', 3, 'n')] }); globalThis.fetch = fake.fetch;
    const c = makeClient(handler); await c.api.loadFromSupabase();
    c.api.onIngUnit('r1', 'i1', 'g');
    await c.api.selectCanonicalIdentity('unit', 'ciUovo');
    assert.strictEqual(c.api.S.pendingUnitConversion.error, LINK_ERR);
    assert.strictEqual(patches(fake, 'ingredients'), 0);
  });

  console.log('');
  console.log('R. race: save gia\' in volo vs collegamento');

  await test('R: save partito con canonical null atterra DOPO la PATCH -> stato finale DB = canonico; runtime = DB; reload ok', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], conversions: [H_ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const vv = api.S.recipes[0].validatedVariants[0];
    const pf = await mandaInProduzione(api, vv);
    assert.ok(pf.identity);
    // 1. parte un save (payload costruito ora: canonical null), trattenuto prima del DB
    let release; c.holdNextSave.push(new Promise(r => { release = r; }));
    const oldSave = api.saveToSupabase(api.S.recipes[0]);
    await flush();
    // 2-3. collegamento: la PATCH riesce mentre il vecchio save e' ancora in volo
    const linking = api.selectCanonicalIdentity('preflight', 'ciAcqua');
    for (let i = 0; i < 20 && patches(fake, 'ingredients') < 1; i++) await flush();
    assert.strictEqual(patches(fake, 'ingredients'), 1, 'prima PATCH eseguita');
    assert.strictEqual(fake.tables.ingredients.find(i => i.id === vv.ingredients[0].id).canonical_ingredient_id, 'ciAcqua');
    assert.strictEqual(c.created.length, 0, 'nessuna Sessione finche\' il link non e\' confermato');
    // 4. il vecchio save termina dopo e riscrive null...
    release();
    assert.strictEqual(await oldSave, true);
    await linking;
    // ...ma il collegamento lo ha atteso e riaffermato
    assert.strictEqual(patches(fake, 'ingredients'), 2, 'link riaffermato dopo il save in volo');
    // 5. stato finale
    const db = fake.tables.ingredients.find(i => i.id === vv.ingredients[0].id);
    assert.strictEqual(db.canonical_ingredient_id, 'ciAcqua', 'DB');
    assert.strictEqual(api.S.recipes[0].validatedVariants[0].ingredients[0].canonicalIngredientId, 'ciAcqua', 'runtime = DB');
    assert.strictEqual(c.created.length, 1, 'una sola Sessione');
    assert.strictEqual(fake.tables.ingredient_conversions.length, 1, 'nessuna conversione nuova/duplicata');
    const c2 = makeClient(handler); await c2.api.loadFromSupabase();
    assert.strictEqual(c2.api.S.recipes[0].validatedVariants[0].ingredients[0].canonicalIngredientId, 'ciAcqua', 'reload immediato: link presente');
  });

  await test('R2: save partito DURANTE la PATCH (prima dell\'aggiornamento in memoria) -> anche lui atteso, link finale corretto', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const vv = api.S.recipes[0].validatedVariants[0];
    await mandaInProduzione(api, vv);
    let release; c.holdNextSave.push(new Promise(r => { release = r; }));
    const linking = api.selectCanonicalIdentity('preflight', 'ciAcqua');
    const midSave = api.saveToSupabase(api.S.recipes[0]); // parte mentre la PATCH e' in volo: memoria ancora null
    await flush(); await flush();
    release();
    await midSave; await linking;
    assert.strictEqual(fake.tables.ingredients.find(i => i.id === vv.ingredients[0].id).canonical_ingredient_id, 'ciAcqua');
    assert.strictEqual(api.S.recipes[0].validatedVariants[0].ingredients[0].canonicalIngredientId, 'ciAcqua');
    assert.strictEqual(patches(fake, 'ingredients'), 2);
  });

  await test('R3: save partito DOPO il collegamento porta il link (nessuna seconda PATCH necessaria)', async () => {
    const { api, fake } = await ready({ canonicals: [ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const vv = api.S.recipes[0].validatedVariants[0];
    await mandaInProduzione(api, vv);
    await api.selectCanonicalIdentity('preflight', 'ciAcqua');
    assert.strictEqual(patches(fake, 'ingredients'), 1, 'nessun save in volo: una sola PATCH');
    assert.strictEqual(await api.saveToSupabase(api.S.recipes[0]), true);
    assert.strictEqual(fake.tables.ingredients.find(i => i.id === vv.ingredients[0].id).canonical_ingredient_id, 'ciAcqua');
  });

  await test('R4: riaffermazione fallita -> errore, memoria riportata al valore precedente, nessuna Sessione', async () => {
    const { api, fake, c } = await ready({ canonicals: [ACQUA], ingredients: [row('i1', 'acqua per brodo', 500, 'ml')] });
    const vv = api.S.recipes[0].validatedVariants[0];
    const pf = await mandaInProduzione(api, vv);
    let release; c.holdNextSave.push(new Promise(r => { release = r; }));
    const oldSave = api.saveToSupabase(api.S.recipes[0]);
    await flush();
    const linking = api.selectCanonicalIdentity('preflight', 'ciAcqua');
    for (let i = 0; i < 20 && patches(fake, 'ingredients') < 1; i++) await flush();
    fake.failPost('ingredients:PATCH');
    release(); await oldSave; await linking;
    assert.strictEqual(pf.error, LINK_ERR);
    assert.strictEqual(api.S.recipes[0].validatedVariants[0].ingredients[0].canonicalIngredientId, null, 'runtime = DB (null)');
    assert.strictEqual(fake.tables.ingredients.find(i => i.id === vv.ingredients[0].id).canonical_ingredient_id, null);
    assert.strictEqual(c.created.length, 0);
  });

  console.log('');
  console.log('L. nessun cambiamento per chi non ne ha bisogno');

  await test('L1: righe con conversione gia\' nota o in grammi -> nessun passo "identifica", come prima', async () => {
    const { api, c, fake } = await ready({ canonicals: [ACQUA, UOVO], ingredients: [row('i1', 'farina', 200, 'g'), row('i2', 'uova', 2, 'n', null, 1)],
      conversions: [conv('cU', 'uova', 'n', 50, 'chef_confirmed', '2026-09-01T00:00:00Z')] });
    assert.strictEqual(await mandaInProduzione(api, api.S.recipes[0].validatedVariants[0]), null);
    assert.strictEqual(c.created.length, 1);
    assert.strictEqual(patches(fake, 'ingredients'), 0, 'nessun salvataggio di link');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
