/*
 * Test — LAB FIX 2B / I4: persistenza della resa dichiarata
 * (variants.declared_yield_qty / declared_yield_unit).
 * Caricamento e salvataggio del valore GREZZO del DB, riscritto identico
 * (nessuna normalizzazione o correzione di dati storici non validi);
 * conservazione in Nuova bozza, Duplica, Crea Scheda, Valida, Rendi attiva;
 * stato assente / valido / non valido; nessun reinvio delle Ricette Attive;
 * quantita' degli ingredienti e Sessioni invariate; DB senza colonne gestito.
 *
 * Codice REALE estratto da khub_mvp.html; api/chat.js reale contro un finto
 * PostgREST in memoria. Solo dati sintetici, nessuna rete, nessun Supabase.
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
// Finto PostgREST in memoria (solo cio' che api/chat.js usa davvero)
// ══════════════════════════════════════════════════════════
function makeFakeSupabase() {
  const tables = {};
  const calls = [];
  let failOn = null; // {table, offset}: risponde 500 a quella pagina
  let failDeletes = 0; // quante DELETE successive rispondono 500

  function matches(row, filters) {
    return filters.every(([col, op, val]) => {
      const v = row[col] == null ? null : String(row[col]);
      if (op === 'eq') return v === val;
      if (op === 'neq') return v !== val;
      if (op === 'in') return val.includes(v);
      throw new Error('filtro non supportato: ' + op);
    });
  }
  function compare(a, b, order) {
    for (const [col, dir] of order) {
      const x = a[col], y = b[col];
      if (x === y) continue;
      const c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y));
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return 0;
  }
  function reply(status, data) {
    return { ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)), text: async () => JSON.stringify(data) };
  }

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
      if (k === 'and') { // and=(col.op.val,...) — usato dal vecchio orphan-delete
        raw.replace(/^\(|\)$/g, '').split(',').forEach(c => { const [col, op, ...v] = c.split('.'); filters.push([col, op, v.join('.')]); });
        continue;
      }
      const dot = raw.indexOf('.');
      const op = raw.slice(0, dot), val = raw.slice(dot + 1);
      filters.push([k, op, op === 'in' ? val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')) : val]);
    }
    calls.push({ method, table, limit, offset, filters });
    const rows = tables[table] = tables[table] || [];

    if (method === 'GET') {
      if (failOn && failOn.table === table && failOn.offset === offset) return reply(500, { message: 'boom' });
      const sorted = rows.filter(r => matches(r, filters)).sort((a, b) => compare(a, b, order));
      const cap = Math.min(limit == null ? Infinity : limit, MAX_ROWS); // Max rows: troncamento silenzioso
      return reply(200, sorted.slice(offset, offset + cap));
    }
    if (method === 'POST') {
      const data = JSON.parse(opts.body);
      (Array.isArray(data) ? data : [data]).forEach(row => {
        const i = row.id != null ? rows.findIndex(r => r.id === row.id) : -1;
        if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push({ ...row });
      });
      return reply(201, null);
    }
    if (method === 'DELETE') {
      if (failDeletes > 0) { failDeletes--; return reply(500, { message: 'delete boom' }); }
      if (!filters.length) throw new Error('DELETE senza filtri: rifiutata dal fake');
      tables[table] = rows.filter(r => !matches(r, filters));
      return reply(204, null);
    }
    throw new Error('metodo non supportato: ' + method);
  }

  return { tables, calls, fetch, failPage: (t, o) => { failOn = { table: t, offset: o }; }, failNextDeletes: n => { failDeletes = n; } };
}


const clone = x => JSON.parse(JSON.stringify(x));

// Formati volutamente diversi, come possono arrivare da PostgREST: numero,
// stringa numerica, decimale lungo; unita' personalizzate; dati storici non
// validi (da NON correggere); resa assente.
const YIELDS = {
  vaT: ['30', 'pz'],                       // Attiva: quantita' come stringa
  vaR: [null, null],                       // ritirata: assente
  vaP: [0, 'pz'],                          // pronta: NON valida (zero)
  lvT: [2.5, 'teglia 30x40'],              // bozza: unita' personalizzata
  lvK: ['0.333333333333333333', 'KG.'],    // bozza: decimale lungo, unita' scritta a mano
  lvX: [12, null],                         // bozza: NON valida (unita' mancante)
  lvN: [null, null],                       // bozza: assente
};
function seed(fake, withColumns = true) {
  const steps = [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: null }];
  const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null, steps: JSON.stringify(['Impastare']), steps_v2: steps };
  fake.tables.recipes = [
    { id: 'rT', name: 'Frolla TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' },
    { id: 'rK', name: 'Crema TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' },
  ];
  const v = (id, recipe, status, active, extra = {}) => ({ ...base, id, recipe_id: recipe, name: 'V ' + id, label: 'V ' + id, note: 'nota ' + id, status, active,
    portions_count: 10, grams_per_portion: 80, validated_at: status === 'lab' ? null : '2026-10-01T09:30:17.250Z', origin_variant_id: null, created_at: '2026-10-01T00:00:00Z', ...extra });
  fake.tables.variants = [
    v('vaT', 'rT', 'validated', true), v('vaR', 'rT', 'retired', false), v('vaP', 'rT', 'validated', false),
    v('lvT', 'rT', 'lab', false, { origin_variant_id: 'vaT' }),
    v('lvK', 'rK', 'lab', false), v('lvX', 'rK', 'lab', false), v('lvN', 'rK', 'lab', false),
  ];
  if (withColumns) fake.tables.variants.forEach(r => { r.declared_yield_qty = YIELDS[r.id][0]; r.declared_yield_unit = YIELDS[r.id][1]; });
  const ing = (id, vid, name, qty, unit, ord, y = null) => ({ id, variant_id: vid, name, qty, unit, sort_order: ord, estimated_yield_pct: y, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
  fake.tables.ingredients = [];
  ['vaT', 'vaR', 'vaP', 'lvT', 'lvK', 'lvX', 'lvN'].forEach((vid, k) => {
    fake.tables.ingredients.push(ing('i1' + vid, vid, 'Farina', 500 + k, 'g', 0, 70), ing('i2' + vid, vid, 'Burro', 0.30000000000000004, 'kg', 1), ing('i3' + vid, vid, 'Uova', 3, 'n', 2));
  });
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = []; fake.tables.ingredient_conversions = [];
  fake.tables.production_sessions = [{ id: 'ps1', recipe_id: 'rT', source_variant_id: 'vaT', status: 'completed', snapshot: { ingredients: [{ name: 'Farina', qty: 500 }] }, target_finished_total: 800 }];
}
const dbVariant = (fake, id) => clone(fake.tables.variants.find(v => v.id === id));
const dbYield = (fake, id) => { const r = fake.tables.variants.find(v => v.id === id); return r ? [r.declared_yield_qty, r.declared_yield_unit] : undefined; };
const ingContent = (fake, id) => clone(fake.tables.ingredients.filter(i => i.variant_id === id).sort((a, b) => a.sort_order - b.sort_order)).map(({ id: _i, variant_id, ...r }) => r);

async function loadHandler() {
  const src = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  return require('./_khub-test-session').withTestSession(mod.default);
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
const SRC = [
  'function R(id)', 'function curLab(recipe)', 'function cnum(n)', 'function upRec(id,fn)', 'function upLab(id,fn)', 'function activeVariants(recipe)',
  'function parseLocaleNumber(value)', 'function normalizeDeclaredYield(qty,unit)', 'function classifyYieldUnit(unit)',
  'function targetFromDb(value)', 'function targetForDb(value)', 'function declaredYieldFromRow(row)', 'function copyDeclaredYield(src)', 'function declaredYieldPayload(v)', 'function declaredYieldState(v)',
  'function validateLabProductionTarget(field,value)', 'function setLabProductionTarget(recipeId,field,rawValue)', 'function onLabTargetPortions(recipeId,val)',
  'function creaBozzaDaSorgente(recipeId,attiva)', 'function duplicaVersioneLAB(recipeId)', 'async function creaSchedaDaLab(recipeId)',
  'function rendiAttiva(recipeId)', 'function onValidate()', 'async function confirmValidate()',
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)',
  'function isBetterConversionFact(candidate,current)', 'function buildKnownIngredientIds(ingredientRows)',
  'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()',
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)', 'function escAttr(s)', 'function formatQtyDisplay(value)', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).concat([
  html.match(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/)[0], html.match(/var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/)[0],
  html.match(/var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/)[0], html.match(/var LAB_TARGET_PORTIONS_MAX=\d+;/)[0],
]).join('\n');

function makeClient(fetchImpl) {
  const log = { autosaves: [], toasts: [] };
  const c = new Function('fetch', 'log', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{},pendingFamilies:[]};
    var _knownIngredientIdsByVariant={};
    var _persistedValidatedSig={};
    var _saveLocked=false, _saveTimer={};
    function render(){}
    function autosave(id){log.autosaves.push(id);}
    function toast(msg){log.toasts.push(msg);}
    function confirm(){return true;}
    function addHistory(){}
    function suggestFamilies(){return [];}
    async function saveFamilies(){}
    function openLabFamilyPicker(){}
    ${SRC}
    return {S, loadFromSupabase, saveToSupabase, buildValidatedVariantPayload, declaredYieldState, creaBozzaDaSorgente, duplicaVersioneLAB,
      creaSchedaDaLab, rendiAttiva, onValidate, confirmValidate, onLabTargetPortions, getSig: id => _persistedValidatedSig[id]};
  `)(fetchImpl, log);
  c.log = log;
  return c;
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let saves = [];
  async function callApi(body) {
    let status = 200, out;
    if (body.supabaseAction === 'save') saves.push(clone(body.data));
    await realHandler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { status, body: out };
  }
  const clientFetch = async (url, opts) => { const r = await callApi(JSON.parse(opts.body)); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  let fake;
  const setup = async (withColumns = true) => {
    fake = makeFakeSupabase(); seed(fake, withColumns); globalThis.fetch = fake.fetch; saves = [];
    const client = makeClient(clientFetch); await client.loadFromSupabase();
    return client;
  };
  const rec = (c, id) => c.S.recipes.find(r => r.id === id);
  const lab = (c, rid, vid) => rec(c, rid).labVersions.find(v => v.id === vid);
  const val = (c, vid) => rec(c, 'rT').validatedVariants.find(v => v.id === vid);
  const memYield = v => [v.declaredYieldQty, v.declaredYieldUnit];
  // Tutte le colonne, tranne tre colonne delle bozze che il salvataggio
  // esistente scrive sempre (derivate o di altre funzioni) e che il seed
  // sintetico non contiene: contenuto_hash, primo_consulto, m1_reading_text.
  const allDb = () => clone({ v: fake.tables.variants.map(({ contenuto_hash, primo_consulto, m1_reading_text, ...r }) => r), i: fake.tables.ingredients.map(({ id, ...r }) => r).sort((a, b) => (a.variant_id + a.sort_order).localeCompare(b.variant_id + b.sort_order)), s: fake.tables.production_sessions });

  console.log('LAB FIX 2B — I4: persistenza della resa dichiarata');

  await test('Y1. caricamento: valori grezzi identici al DB (formato compreso); unita\' personalizzate come scritte', async () => {
    const c = await setup();
    for (const [rid, vid] of [['rT', 'lvT'], ['rK', 'lvK'], ['rK', 'lvX'], ['rK', 'lvN']]) assert.deepStrictEqual(memYield(lab(c, rid, vid)), YIELDS[vid], vid);
    for (const vid of ['vaT', 'vaR', 'vaP']) assert.deepStrictEqual(memYield(val(c, vid)), YIELDS[vid], vid);
    assert.strictEqual(typeof val(c, 'vaT').declaredYieldQty, 'string', 'nessuna conversione di formato in memoria');
  });

  await test('Y2. stato: assente, valido (anche unita\' personalizzate), non valido; il dato salvato non viene corretto', async () => {
    const c = await setup();
    const st = v => c.declaredYieldState(v);
    assert.deepStrictEqual(st(val(c, 'vaT')), { status: 'valid', value: { qty: 30, unit: 'pz' } });
    assert.deepStrictEqual(st(lab(c, 'rT', 'lvT')), { status: 'valid', value: { qty: 2.5, unit: 'teglia 30x40' } });
    assert.deepStrictEqual(st(lab(c, 'rK', 'lvK')), { status: 'valid', value: { qty: 0.3333333333333333, unit: 'kg' } });
    assert.deepStrictEqual(st(lab(c, 'rK', 'lvN')), { status: 'absent' });
    assert.deepStrictEqual(st(val(c, 'vaR')), { status: 'absent' });
    assert.deepStrictEqual(st(val(c, 'vaP')), { status: 'invalid', error: 'invalid_qty', raw: { qty: 0, unit: 'pz' } });
    assert.deepStrictEqual(st(lab(c, 'rK', 'lvX')), { status: 'invalid', error: 'missing_unit', raw: { qty: 12, unit: null } });
    assert.deepStrictEqual(memYield(lab(c, 'rK', 'lvK')), ['0.333333333333333333', 'KG.'], 'la lettura non riscrive il dato');
    assert.deepStrictEqual(st({ declaredYieldQty: 10, declaredYieldUnit: 'oz' }), { status: 'invalid', error: 'unsupported_unit', raw: { qty: 10, unit: 'oz' } });
  });

  await test('Y3. salvataggio senza modifiche: DB identico in ogni colonna, anche i dati non validi e il decimale lungo', async () => {
    const c = await setup();
    const before = allDb();
    for (const rid of ['rT', 'rK']) assert.strictEqual(await c.saveToSupabase(rec(c, rid)), true);
    assert.deepStrictEqual(allDb(), before);
    const sent = saves.flatMap(s => s.variants).map(v => [v.id, v.declared_yield_qty, v.declared_yield_unit]).sort((x, y) => x[0].localeCompare(y[0]));
    assert.deepStrictEqual(sent, [['lvK', '0.333333333333333333', 'KG.'], ['lvN', null, null], ['lvT', 2.5, 'teglia 30x40'], ['lvX', 12, null]]);
  });

  await test('Y4. tre cicli consecutivi carica -> salva: nessuna variazione, Ricette Attive mai reinviate', async () => {
    await setup();
    const before = allDb();
    for (let k = 0; k < 3; k++) {
      const c = makeClient(clientFetch); await c.loadFromSupabase();
      for (const rid of ['rT', 'rK']) assert.strictEqual(await c.saveToSupabase(rec(c, rid)), true);
    }
    assert.deepStrictEqual(allDb(), before);
    assert.ok(saves.every(s => s.variants.every(v => v.id.startsWith('lv'))), 'nessuna versione validata nei payload');
  });

  await test('Y5. firma delle Ricette Attive stabile: formati diversi (stringa, zero, null) non causano reinvii', async () => {
    const c = await setup();
    for (const vid of ['vaT', 'vaR', 'vaP']) assert.strictEqual(c.buildValidatedVariantPayload('rT', val(c, vid)).sig, c.getSig(vid), vid);
    const row = c.buildValidatedVariantPayload('rT', val(c, 'vaT')).row;
    // Correzione A: la resa di una versione validata gia' nel DB non entra nel salvataggio completo
    assert.ok(!('declared_yield_qty' in row) && !('declared_yield_unit' in row), 'resa mai riscritta dal salvataggio completo');
  });

  await test('Y6. obiettivo di Produzione indipendente: cambiare Porzioni non tocca la resa dichiarata (ne\' il contrario)', async () => {
    const c = await setup();
    rec(c, 'rT').currentLabIdx = 0;
    c.onLabTargetPortions('rT', '24');
    assert.strictEqual(lab(c, 'rT', 'lvT').portionsCount, 24);
    assert.deepStrictEqual(memYield(lab(c, 'rT', 'lvT')), [2.5, 'teglia 30x40']);
    await c.saveToSupabase(rec(c, 'rT'));
    assert.deepStrictEqual(dbYield(fake, 'lvT'), [2.5, 'teglia 30x40']);
    assert.strictEqual(dbVariant(fake, 'lvT').portions_count, 24);
  });

  await test('Y7. Duplica bozza e Nuova bozza da Ricetta attiva: resa copiata identica (anche non valida); da zero: assente', async () => {
    const c = await setup();
    rec(c, 'rT').currentLabIdx = 0;
    c.duplicaVersioneLAB('rT');
    const dup = rec(c, 'rT').labVersions.at(-1);
    assert.deepStrictEqual(memYield(dup), [2.5, 'teglia 30x40']);
    assert.deepStrictEqual(dup.ingredients.map(i => [i.name, i.qty, i.unit]), lab(c, 'rT', 'lvT').ingredients.map(i => [i.name, i.qty, i.unit]));
    c.creaBozzaDaSorgente('rT', val(c, 'vaT'));
    const fromActive = rec(c, 'rT').labVersions[0];
    assert.deepStrictEqual(memYield(fromActive), ['30', 'pz']);
    assert.deepStrictEqual(fromActive.ingredients.map(i => i.qty), val(c, 'vaT').ingredients.map(i => i.qty));
    c.creaBozzaDaSorgente('rT', val(c, 'vaP'));
    assert.deepStrictEqual(memYield(rec(c, 'rT').labVersions[0]), [0, 'pz'], 'dato non valido copiato com\'e\', non corretto');
    c.creaBozzaDaSorgente('rT', null);
    const scratch = rec(c, 'rT').labVersions[0];
    assert.ok(!('declaredYieldQty' in scratch), 'bozza da zero: resa assente');
    assert.strictEqual(await c.saveToSupabase(rec(c, 'rT')), true);
    const r = fake.tables.variants.find(v => v.id === scratch.id);
    assert.deepStrictEqual([r.declared_yield_qty, r.declared_yield_unit], [undefined, undefined], 'nessuna colonna inviata: NULL nel DB reale');
  });

  await test('Y8. Crea Scheda dalla bozza: la nuova Scheda eredita la resa; salvata e riletta identica', async () => {
    const c = await setup();
    rec(c, 'rK').currentLabIdx = rec(c, 'rK').labVersions.findIndex(v => v.id === 'lvK');
    await c.creaSchedaDaLab('rK');
    const nuova = c.S.recipes.find(r => r.id !== 'rT' && r.id !== 'rK');
    assert.deepStrictEqual(memYield(nuova.labVersions[0]), ['0.333333333333333333', 'KG.']);
    assert.deepStrictEqual(dbYield(fake, nuova.labVersions[0].id), ['0.333333333333333333', 'KG.']);
    const c2 = makeClient(clientFetch); await c2.loadFromSupabase();
    assert.deepStrictEqual(memYield(c2.S.recipes.find(r => r.id === nuova.id).labVersions[0]), ['0.333333333333333333', 'KG.']);
  });

  await test('Y9. Rendi attiva: stesso id, resa conservata nel DB; le altre Ricette Attive non vengono reinviate', async () => {
    const c = await setup();
    rec(c, 'rT').currentLabIdx = 0;
    const qtyBefore = lab(c, 'rT', 'lvT').ingredients.map(i => [i.name, i.qty, i.unit]);
    const vaTBefore = { v: dbVariant(fake, 'vaT'), i: ingContent(fake, 'vaT') };
    c.rendiAttiva('rT');
    const nv = val(c, 'lvT');
    assert.deepStrictEqual(memYield(nv), [2.5, 'teglia 30x40']);
    assert.strictEqual(await c.saveToSupabase(rec(c, 'rT')), true);
    assert.deepStrictEqual(saves[0].variants.map(v => v.id), ['lvT']);
    const row = dbVariant(fake, 'lvT');
    assert.deepStrictEqual([row.status, row.active, row.declared_yield_qty, row.declared_yield_unit], ['validated', true, 2.5, 'teglia 30x40']);
    assert.deepStrictEqual(ingContent(fake, 'lvT').map(i => [i.name, i.qty, i.unit]), qtyBefore);
    assert.deepStrictEqual({ v: dbVariant(fake, 'vaT'), i: ingContent(fake, 'vaT') }, vaTBefore);
    const c2 = makeClient(clientFetch); await c2.loadFromSupabase();
    assert.deepStrictEqual(memYield(val(c2, 'lvT')), [2.5, 'teglia 30x40']);
    assert.strictEqual(c2.buildValidatedVariantPayload('rT', val(c2, 'lvT')).sig, c2.getSig('lvT'), 'riletta: nessun reinvio successivo');
  });

  await test('Y10. Valida (onValidate + confirmValidate reali): resa conservata, anche non valida, senza correzioni', async () => {
    const c = await setup();
    c.S.selectedId = 'rK';
    rec(c, 'rK').currentLabIdx = rec(c, 'rK').labVersions.findIndex(v => v.id === 'lvX');
    c.onValidate();
    assert.deepStrictEqual(memYield(c.S.pendingValidatedVariant), [12, null]);
    await c.confirmValidate();
    const row = dbVariant(fake, 'lvX');
    assert.deepStrictEqual([row.status, row.declared_yield_qty, row.declared_yield_unit], ['validated', 12, null]);
    assert.deepStrictEqual(ingContent(fake, 'lvX').map(i => [i.name, i.qty]), [['Farina', 505], ['Burro', 0.30000000000000004], ['Uova', 3]]);
  });

  await test('Y11. DB senza colonne (0011 non applicata): nulla in memoria, nulla nel payload, copie senza campi', async () => {
    const c = await setup(false);
    assert.ok(!JSON.stringify(c.S.recipes).includes('declaredYield'));
    rec(c, 'rT').currentLabIdx = 0;
    c.duplicaVersioneLAB('rT'); c.creaBozzaDaSorgente('rK', null);
    c.rendiAttiva('rT');
    for (const rid of ['rT', 'rK']) assert.strictEqual(await c.saveToSupabase(rec(c, rid)), true);
    assert.ok(!JSON.stringify(saves).includes('declared_yield'));
    assert.deepStrictEqual(c.declaredYieldState(val(c, 'vaT')), { status: 'absent' });
  });

  await test('Y13. correzione A: dopo la promozione la resa viaggia una sola volta; i salvataggi successivi dell\'Attiva non la riscrivono', async () => {
    const c = await setup();
    rec(c, 'rT').currentLabIdx = 0;
    c.rendiAttiva('rT');
    assert.strictEqual(await c.saveToSupabase(rec(c, 'rT')), true);
    assert.deepStrictEqual(saves[0].variants.filter(v => v.id === 'lvT').map(v => [v.declared_yield_qty, v.declared_yield_unit]), [[2.5, 'teglia 30x40']], 'promozione: resa inviata');
    // altra modifica dell'Attiva nata in sessione (es. disattivazione): la resa non viene piu' inviata
    rec(c, 'rT').validatedVariants = rec(c, 'rT').validatedVariants.map(v => v.id === 'lvT' ? { ...v, active: false } : v);
    saves = [];
    assert.strictEqual(await c.saveToSupabase(rec(c, 'rT')), true);
    const sent = saves[0].variants.find(v => v.id === 'lvT');
    assert.ok(sent && !('declared_yield_qty' in sent), 'seconda scrittura senza resa');
    assert.deepStrictEqual([dbVariant(fake, 'lvT').active, dbVariant(fake, 'lvT').declared_yield_qty, dbVariant(fake, 'lvT').declared_yield_unit], [false, 2.5, 'teglia 30x40'], 'resa conservata nel DB');
  });

  await test('Y12. Sessioni di Produzione e dati non validi mai toccati da tutti i flussi', async () => {
    const c = await setup();
    const sessions = clone(fake.tables.production_sessions);
    rec(c, 'rT').currentLabIdx = 0;
    c.duplicaVersioneLAB('rT'); c.rendiAttiva('rT');
    for (const rid of ['rT', 'rK']) await c.saveToSupabase(rec(c, rid));
    assert.deepStrictEqual(fake.tables.production_sessions, sessions);
    assert.deepStrictEqual(dbYield(fake, 'vaP'), [0, 'pz']);
    assert.deepStrictEqual(dbYield(fake, 'lvX'), [12, null]);
    assert.ok(!html.slice(html.indexOf('async function createProductionSession'), html.indexOf('async function createProductionSession') + 4000).includes('declaredYield'), 'snapshot delle Sessioni invariato');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
