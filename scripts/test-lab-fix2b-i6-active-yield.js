/*
 * Test — LAB FIX 2B / I6: correzione della resa dichiarata di una Ricetta
 * Attiva dal Contenuto della Scheda.
 * Conferma esplicita; azione server dedicata updateDeclaredYield (PATCH di
 * sole 2 colonne, Ricetta identificata da id + recipe_id, solo se attiva);
 * nessuna nuova bozza; ingredienti, passaggi, altre versioni e Sessioni
 * intatti; memoria aggiornata solo dopo l'esito positivo; nessun reinvio da
 * LAB FIX 1/1.1; errori di autorizzazione e di salvataggio mai mostrati come
 * riusciti.
 *
 * Codice REALE estratto da khub_mvp.html; api/chat.js reale contro un finto
 * PostgREST in memoria (con PATCH filtrata). Solo dati sintetici.
 */
const assert = require('assert');
const crypto = require('crypto');
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

// PATCH filtrata con Prefer: return=representation (come PostgREST), sopra il finto PostgREST.
function withPatch(fake, hooks) {
  const base = fake.fetch;
  fake.patches = [];
  fake.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') !== 'PATCH') return base(url, opts);
    if (hooks.failPatch) return { ok: false, status: 500, text: async () => 'patch boom', json: async () => ({}) };
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    let select = null; const filters = [];
    for (const [k, raw] of u.searchParams) {
      if (k === 'select') { select = raw.split(','); continue; }
      const dot = raw.indexOf('.'); filters.push([k, raw.slice(0, dot), raw.slice(dot + 1)]);
    }
    const body = JSON.parse(opts.body);
    fake.patches.push({ table, filters: clone(filters), body: clone(body) });
    const rows = (fake.tables[table] || []).filter(r => filters.every(([c, op, v]) => { if (op !== 'eq') throw new Error('op ' + op); return String(r[c]) === v; }));
    rows.forEach(r => Object.assign(r, body));
    const out = rows.map(r => select ? Object.fromEntries(select.map(c => [c, r[c]])) : r);
    return { ok: true, status: 200, json: async () => clone(out), text: async () => JSON.stringify(out) };
  };
  return fake;
}

// Scheda Bignè: Attiva vaB (30 bignè), seconda Attiva vaC, Pronta vaP, ritirata vaR, bozza lvB.
function seed(fake) {
  const steps = [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: null }];
  const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null, steps: JSON.stringify(['Impastare']), steps_v2: steps, primo_consulto: null, m1_reading_text: null, contenuto_hash: null };
  fake.tables.recipes = [
    { id: 'rB', name: 'Bignè TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' },
    { id: 'rX', name: 'Altra TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' },
  ];
  const v = (id, rid, status, active, dq, du, extra = {}) => ({ ...base, id, recipe_id: rid, name: 'V ' + id, label: 'V ' + id, note: 'nota ' + id, status, active, portions_count: 30, grams_per_portion: 21,
    validated_at: status === 'lab' ? null : '2026-10-01T09:30:17.250Z', origin_variant_id: null, created_at: '2026-10-01T00:00:00Z', declared_yield_qty: dq, declared_yield_unit: du, ...extra });
  fake.tables.variants = [
    v('vaB', 'rB', 'validated', true, '30', 'bignè'), v('vaC', 'rB', 'validated', true, null, null), v('vaI', 'rB', 'validated', true, 0, 'pz'),
    v('vaP', 'rB', 'validated', false, 20, 'pz'), v('vaR', 'rB', 'retired', false, 10, 'pz'), v('lvB', 'rB', 'lab', false, 30, 'bignè', { origin_variant_id: 'vaB' }),
    v('vaX', 'rX', 'validated', true, 5, 'pz'),
  ];
  const ing = (id, vid, name, qty, unit, ord, y) => ({ id, variant_id: vid, name, qty, unit, sort_order: ord, estimated_yield_pct: y, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
  fake.tables.ingredients = ['vaB', 'vaC', 'vaI', 'vaP', 'vaR', 'lvB', 'vaX'].flatMap(vid => [ing('f' + vid, vid, 'Farina', 500, 'g', 0, 70), ing('b' + vid, vid, 'Burro', 0.25, 'kg', 1, 70), ing('z' + vid, vid, 'Zucchero', 150, 'g', 2, 70)]);
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = []; fake.tables.ingredient_conversions = [];
  fake.tables.production_sessions = [{ id: 'ps1', recipe_id: 'rB', source_variant_id: 'vaB', status: 'completed', snapshot: { declaredYield: null, ingredients: [{ name: 'Farina', qty: 500 }] }, target_finished_total: 630 }];
}
const dbAll = fake => clone({ v: fake.tables.variants, i: fake.tables.ingredients, s: fake.tables.production_sessions, r: fake.tables.recipes });
const dbRow = (fake, id) => clone(fake.tables.variants.find(v => v.id === id));

async function loadHandler() {
  const src = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  return mod.default;
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
  'function R(id)', 'function curLab(recipe)', 'function cnum(n)', 'function upRec(id,fn)', 'function upLab(id,fn)', 'function escAttr(s)',
  'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)',
  'function resolveSessionScalingConversionToGrams(unit,conversionFact)', 'function chooseConversionAskUnit(unit)',
  'function resolveKnownProductionConversionFact(normalizedName,unit)',
  'function parseLocaleNumber(value)', 'function normalizeDeclaredYield(qty,unit)', 'function classifyYieldUnit(unit)',
  'function computeFormulationWeights(ingredients,resolveFact)', 'function deriveYieldPerUnit(weights,declared)', 'function formatQtyDisplay(value)',
  'function declaredYieldFromRow(row)', 'function copyDeclaredYield(src)', 'function declaredYieldPayload(v)', 'function declaredYieldState(v)',
  'function declaredYieldInputText(raw)', 'function declaredYieldErrorMessage(error)', 'function labGrams(x)',
  'function findActiveVariant(recipeId,variantId)', 'function declaredYieldLabel(qty,unit)', 'function openActiveYieldEdit(recipeId,variantId)',
  'function onActiveYieldField(field,value)', 'function reviewActiveYieldEdit(qtyRaw,unitRaw)', 'function backActiveYieldEdit()',
  'function cancelActiveYieldEdit()', 'async function confirmActiveYieldEdit()', 'function renderActiveYieldSection(recipe,v)',
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)',
  'function isBetterConversionFact(candidate,current)', 'function buildKnownIngredientIds(ingredientRows)',
  'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g), [
  html.match(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/)[0], html.match(/var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/)[0],
  html.match(/var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/)[0],
]).join('\n');

function makeClient(fetchImpl) {
  const log = { autosaves: [], renders: 0, toasts: [] };
  const c = new Function('fetch', 'log', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{},labYieldInput:{},activeYieldEdit:null};
    var _knownIngredientIdsByVariant={};
    var _persistedValidatedSig={};
    function render(){log.renders++;}
    function autosave(id){log.autosaves.push(id);}
    function toast(msg){log.toasts.push(msg);render();}
    ${SRC}
    return {S, loadFromSupabase, saveToSupabase, openActiveYieldEdit, onActiveYieldField, reviewActiveYieldEdit, backActiveYieldEdit, cancelActiveYieldEdit,
      confirmActiveYieldEdit, renderActiveYieldSection, buildValidatedVariantPayload, getSig: id => _persistedValidatedSig[id]};
  `)(fetchImpl, log);
  c.log = log;
  return c;
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let saves = [], calls = [], hooks = {};
  async function callApi(body) {
    let status = 200, out;
    calls.push(body.supabaseAction);
    if (body.supabaseAction === 'save') saves.push(clone(body.data));
    if (hooks.networkDown && body.supabaseAction === 'updateDeclaredYield') throw new Error('rete assente');
    await realHandler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { status, body: out };
  }
  const clientFetch = async (url, opts) => { const r = await callApi(JSON.parse(opts.body)); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  const api = async body => (await callApi(body)).body;
  let fake;
  const setup = async () => {
    hooks = {}; fake = withPatch((() => { const f = makeFakeSupabase(); seed(f); return f; })(), hooks); globalThis.fetch = fake.fetch;
    saves = []; calls = [];
    const c = makeClient(clientFetch); await c.loadFromSupabase();
    return c;
  };
  const rec = (c, id = 'rB') => c.S.recipes.find(r => r.id === id);
  const vv = (c, id, rid = 'rB') => rec(c, rid).validatedVariants.find(v => v.id === id);
  const section = (c, id) => c.renderActiveYieldSection(rec(c), vv(c, id));
  const correct = async (c, id, q, u) => { c.openActiveYieldEdit('rB', id); c.reviewActiveYieldEdit(q, u); await c.confirmActiveYieldEdit(); };

  console.log('LAB FIX 2B — I6: correzione della resa sulle Ricette Attive');

  await test('A1. da 30 a 32 bignè: solo le 2 colonne della resa cambiano; ingredienti, totali e tutto il resto invariati; pesi per unita\' aggiornati', async () => {
    const c = await setup();
    const before = dbAll(fake);
    let h = text(section(c, 'vaB'));
    assert.ok(h.includes('30 bignè') && h.includes('Crudo totale 900 g · finito teorico 630 g · per bignè: 30 g crudi, 21 g finiti'), h);
    await correct(c, 'vaB', '32', 'bignè');
    const after = dbAll(fake);
    const row = after.v.find(v => v.id === 'vaB'), row0 = before.v.find(v => v.id === 'vaB');
    assert.deepStrictEqual({ ...row, declared_yield_qty: null, declared_yield_unit: null }, { ...row0, declared_yield_qty: null, declared_yield_unit: null }, 'nessun\'altra colonna');
    assert.deepStrictEqual([row.declared_yield_qty, row.declared_yield_unit], [32, 'bignè']);
    assert.deepStrictEqual(after.v.filter(v => v.id !== 'vaB'), before.v.filter(v => v.id !== 'vaB'), 'altre versioni identiche');
    assert.deepStrictEqual(after.i, before.i, 'ingredienti identici');
    assert.deepStrictEqual(after.s, before.s, 'Sessioni storiche identiche');
    assert.deepStrictEqual(after.r, before.r);
    assert.deepStrictEqual([vv(c, 'vaB').declaredYieldQty, vv(c, 'vaB').declaredYieldUnit], [32, 'bignè'], 'memoria aggiornata');
    h = text(section(c, 'vaB'));
    assert.ok(h.includes('32 bignè') && h.includes('Crudo totale 900 g · finito teorico 630 g · per bignè: 28,13 g crudi, 19,69 g finiti'), h);
    assert.ok(c.log.toasts.some(t => t === 'Resa corretta: 32 bignè'));
    assert.deepStrictEqual(c.log.autosaves, [], 'nessun salvataggio completo avviato');
    assert.deepStrictEqual(calls.filter(a => a !== 'load' && a !== 'loadFamilies' && a !== 'loadConversions'), ['updateDeclaredYield']);
  });

  await test('A2. conferma esplicita: prima di "Conferma correzione" nessuna richiesta; Indietro e Annulla non cambiano nulla', async () => {
    const c = await setup();
    const before = dbAll(fake); calls = [];
    c.openActiveYieldEdit('rB', 'vaB');
    assert.ok(/value="30"/.test(section(c, 'vaB')) && /value="bignè"/.test(section(c, 'vaB')));
    c.reviewActiveYieldEdit('32', 'bignè');
    const conf = text(section(c, 'vaB'));
    assert.ok(conf.includes('Correggere la resa da 30 bignè a 32 bignè ?') && conf.includes('ingredienti, quantità e procedimento restano invariati'), conf);
    assert.deepStrictEqual(calls, []);
    c.backActiveYieldEdit();
    assert.strictEqual(c.S.activeYieldEdit.step, 'edit');
    c.cancelActiveYieldEdit();
    assert.strictEqual(c.S.activeYieldEdit, null);
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(dbAll(fake), before);
    assert.deepStrictEqual([vv(c, 'vaB').declaredYieldQty, vv(c, 'vaB').declaredYieldUnit], ['30', 'bignè']);
  });

  await test('A3. unita\' personalizzate come scritte (spazi compattati); unita\' di misura in forma standard', async () => {
    const c = await setup();
    await correct(c, 'vaB', '4', '  vaschette   da 500 g ');
    assert.deepStrictEqual([dbRow(fake, 'vaB').declared_yield_qty, dbRow(fake, 'vaB').declared_yield_unit], [4, 'vaschette da 500 g']);
    assert.ok(text(section(c, 'vaB')).includes('per vaschette da 500 g: 225 g crudi, 157,5 g finiti'), 'nessun peso dedotto dal testo');
    await correct(c, 'vaB', '2', 'teglia 30x40');
    assert.strictEqual(dbRow(fake, 'vaB').declared_yield_unit, 'teglia 30x40');
    await correct(c, 'vaB', '0,6', 'Kg.');
    assert.deepStrictEqual([dbRow(fake, 'vaB').declared_yield_qty, dbRow(fake, 'vaB').declared_yield_unit], [0.6, 'kg']);
  });

  await test('A4. resa assente o storica non valida: mostrata com\'e\', correggibile; valori non validi rifiutati senza richieste', async () => {
    const c = await setup();
    assert.ok(text(section(c, 'vaC')).startsWith('Resa dichiarata non dichiarata'));
    assert.ok(text(section(c, 'vaI')).includes('non valida (0 pz)'));
    calls = [];
    c.openActiveYieldEdit('rB', 'vaI');
    for (const [q, u, msg] of [['0', 'pz', /maggiore di zero/], ['abc', 'pz', /maggiore di zero/], ['5', '', /Inserisci l'unità/], ['5', 'oz', /non supportata/], ['', '', /Inserisci quantità e unità/], ['5', 'x'.repeat(41), /troppo lunga/]]) {
      c.reviewActiveYieldEdit(q, u);
      assert.ok(msg.test(text(section(c, 'vaI'))), q + '/' + u);
      assert.strictEqual(c.S.activeYieldEdit.step, 'edit');
    }
    assert.deepStrictEqual(calls, [], 'nessuna richiesta per valori non validi');
    assert.deepStrictEqual([dbRow(fake, 'vaI').declared_yield_qty, dbRow(fake, 'vaI').declared_yield_unit], [0, 'pz'], 'dato storico non corretto da solo');
    c.cancelActiveYieldEdit();
    c.openActiveYieldEdit('rB', 'vaB'); c.reviewActiveYieldEdit('30', 'bignè');
    assert.ok(/uguale a quella attuale/.test(text(section(c, 'vaB'))), 'stessa resa: nessuna correzione');
    c.cancelActiveYieldEdit();
    await correct(c, 'vaI', '12', 'pz');
    assert.deepStrictEqual([dbRow(fake, 'vaI').declared_yield_qty, dbRow(fake, 'vaI').declared_yield_unit], [12, 'pz']);
    await correct(c, 'vaC', '24', 'bignè');
    assert.deepStrictEqual([dbRow(fake, 'vaC').declared_yield_qty, dbRow(fake, 'vaC').declared_yield_unit], [24, 'bignè']);
  });

  await test('A5. nessuna nuova versione LAB, nessuna bozza modificata', async () => {
    const c = await setup();
    const labBefore = clone(rec(c).labVersions);
    await correct(c, 'vaB', '32', 'bignè');
    assert.deepStrictEqual(rec(c).labVersions, labBefore);
    assert.strictEqual(fake.tables.variants.filter(v => v.status === 'lab').length, 1);
    assert.deepStrictEqual([dbRow(fake, 'lvB').declared_yield_qty, dbRow(fake, 'lvB').declared_yield_unit], [30, 'bignè']);
  });

  await test('A6. autorizzazione e identificazione: Pronta, ritirata, Scheda sbagliata, id inesistente e dati non validi rifiutati; DB intatto', async () => {
    await setup();
    const before = dbAll(fake);
    const call = b => api({ supabaseAction: 'updateDeclaredYield', recipeId: 'rB', qty: 32, unit: 'bignè', ...b });
    assert.strictEqual((await call({ variantId: 'vaP' })).code, 'not_active', 'Pronta (non attiva)');
    assert.strictEqual((await call({ variantId: 'vaR' })).code, 'not_active', 'ritirata');
    assert.strictEqual((await call({ variantId: 'lvB' })).code, 'not_active', 'bozza');
    assert.strictEqual((await call({ variantId: 'vaX' })).code, 'recipe_mismatch', 'Ricetta di un\'altra Scheda');
    assert.strictEqual((await call({ variantId: 'nope' })).code, 'not_found');
    for (const bad of [{ variantId: '' }, { variantId: 'vaB', recipeId: '' }, { variantId: 'vaB', qty: '32' }, { variantId: 'vaB', qty: 0 }, { variantId: 'vaB', qty: -1 }, { variantId: 'vaB', qty: Infinity },
      { variantId: 'vaB', qty: null }, { variantId: 'vaB', unit: '' }, { variantId: 'vaB', unit: '  ' }, { variantId: 'vaB', unit: 'OZ.' }, { variantId: 'vaB', unit: 'x'.repeat(41) }, { variantId: 'vaB', unit: 5 }]) {
      const r = await call(bad);
      assert.strictEqual(r.code, 'invalid', JSON.stringify(bad));
    }
    assert.deepStrictEqual(dbAll(fake), before);
  });

  await test('A7. PATCH mirata: filtri id + recipe_id + status=validated + active=true, corpo con SOLE 2 colonne', async () => {
    const c = await setup();
    await correct(c, 'vaB', '32', 'bignè');
    assert.strictEqual(fake.patches.length, 1);
    const p = fake.patches[0];
    assert.strictEqual(p.table, 'variants');
    assert.deepStrictEqual(p.filters, [['id', 'eq', 'vaB'], ['recipe_id', 'eq', 'rB'], ['status', 'eq', 'validated'], ['active', 'eq', 'true']]);
    assert.deepStrictEqual(Object.keys(p.body).sort(), ['declared_yield_qty', 'declared_yield_unit']);
  });

  await test('A8. errori di salvataggio, rete e stato cambiato nel frattempo: mai mostrati come riusciti, memoria invariata', async () => {
    const c = await setup();
    hooks.failPatch = true;
    await correct(c, 'vaB', '32', 'bignè');
    assert.ok(/Errore nel salvataggio: la resa non è stata modificata/.test(text(section(c, 'vaB'))));
    assert.strictEqual(vv(c, 'vaB').declaredYieldQty, '30');
    assert.ok(!c.log.toasts.some(t => /Resa corretta/.test(t)));
    hooks.failPatch = false; hooks.networkDown = true;
    await c.confirmActiveYieldEdit();
    assert.ok(/Errore nel salvataggio/.test(text(section(c, 'vaB'))));
    hooks.networkDown = false;
    fake.tables.variants.find(v => v.id === 'vaB').active = false; // disattivata da un altro dispositivo
    await c.confirmActiveYieldEdit();
    assert.ok(/non è più attiva: la correzione non è stata salvata/.test(text(section(c, 'vaB'))));
    assert.deepStrictEqual([dbRow(fake, 'vaB').declared_yield_qty, vv(c, 'vaB').declaredYieldQty], ['30', '30']);
    assert.ok(!c.log.toasts.some(t => /Resa corretta/.test(t)));
    fake.tables.variants.find(v => v.id === 'vaB').active = true;
    await c.confirmActiveYieldEdit();
    assert.strictEqual(dbRow(fake, 'vaB').declared_yield_qty, 32, 'riprovando riesce');
  });

  await test('A9. LAB FIX 1/1.1: dopo la correzione nessun reinvio di Ricette Attive; rilettura coerente', async () => {
    const c = await setup();
    await correct(c, 'vaB', '32', 'bignè');
    const before = dbAll(fake);
    saves = [];
    assert.strictEqual(await c.saveToSupabase(rec(c)), true);
    assert.deepStrictEqual(saves[0].variants.map(v => v.id), ['lvB'], 'solo la bozza');
    assert.deepStrictEqual(dbAll(fake).v.filter(v => v.status !== 'lab'), before.v.filter(v => v.status !== 'lab'));
    for (const id of ['vaB', 'vaC', 'vaI', 'vaP', 'vaR']) assert.strictEqual(c.buildValidatedVariantPayload('rB', vv(c, id)).sig, c.getSig(id), id);
    const c2 = makeClient(clientFetch); await c2.loadFromSupabase();
    assert.deepStrictEqual([vv(c2, 'vaB').declaredYieldQty, vv(c2, 'vaB').declaredYieldUnit], [32, 'bignè']);
    assert.strictEqual(c2.buildValidatedVariantPayload('rB', vv(c2, 'vaB')).sig, c2.getSig('vaB'));
  });

  await test('A10. una modifica in sospeso dell\'Attiva non viene nascosta: il salvataggio successivo la invia comunque', async () => {
    const c = await setup();
    // modifica in memoria non ancora salvata (es. un salvataggio precedente fallito)
    rec(c).validatedVariants = rec(c).validatedVariants.map(v => v.id === 'vaB' ? { ...v, active: false } : v);
    rec(c).validatedVariants = rec(c).validatedVariants.map(v => v.id === 'vaB' ? { ...v, active: true, note: 'x' } : v);
    const sigBefore = c.getSig('vaB');
    rec(c).validatedVariants = rec(c).validatedVariants.map(v => v.id === 'vaB' ? { ...v, persistedNote: 'nota cambiata' } : v);
    await correct(c, 'vaB', '32', 'bignè');
    assert.strictEqual(c.getSig('vaB'), sigBefore, 'firma non riallineata: la modifica in sospeso resta da inviare');
    saves = [];
    await c.saveToSupabase(rec(c));
    const sent = saves[0].variants.find(v => v.id === 'vaB');
    assert.ok(sent, 'la versione con la modifica in sospeso viene inviata');
    assert.deepStrictEqual([sent.note, sent.declared_yield_qty, sent.declared_yield_unit], ['nota cambiata', 32, 'bignè'], 'con la resa gia\' corretta, mai quella vecchia');
    assert.deepStrictEqual([dbRow(fake, 'vaB').note, dbRow(fake, 'vaB').declared_yield_qty], ['nota cambiata', 32]);
  });

  await test('A11. vista: "Correggi resa" solo nel Contenuto delle Ricette Attive; Produzione, MichelinAI e motore invariati', async () => {
    const madre = extractFunction('function renderRicettaMadreV2(recipe)');
    assert.ok(madre.includes('${renderContenutoVariante(v)}${renderActiveYieldSection(recipe,v)}'));
    assert.strictEqual((madre.match(/renderActiveYieldSection/g) || []).length, 1, 'solo nella sezione Attive');
    const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
    const expect = {
      'function computeSessionScaling(input)': 'ddfc1febb5010cdc', 'function resolveKnownProductionConversionFact(normalizedName,unit)': '5b0be8c06a5e4919',
      'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)': '9df6758db87b12b1',
      'function computeRecipeWeightSummary(recipe,vv)': '180343ceee9590a5', 'async function confirmConversionPreflightStep(rawValue)': 'e2aae961c47a7615',
    };
    for (const [m, h] of Object.entries(expect)) assert.strictEqual(sha(extractFunction(m)), h, 'cambiato: ' + m);
    const chat = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
    const action = chat.slice(chat.indexOf("if (body.supabaseAction === 'updateDeclaredYield')"), chat.indexOf("if (body.supabaseAction === 'update') {"));
    assert.ok(!/ingredients|steps|production_sessions|sbPost/.test(action.replace(/\/\/.*$/gm, '')), 'l\'azione non tocca altro');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
