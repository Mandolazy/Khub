/*
 * Test — LAB FIX 2C / C1: protezione dell'obiettivo di Produzione
 * (portions_count, grams_per_portion). 0 = non impostato.
 * Nessun 4/200 inventato al caricamento; valori storici preservati
 * esattamente; nei payload le due chiavi sono sempre presenti (null/undefined
 * -> 0 esplicito, mai i default SQL 4/200); nuove bozze 0/0; aggiungere
 * ingredienti non tocca l'obiettivo; copie e promozioni non inventano nulla;
 * nessuna falsa modifica della firma/data della bozza; Ricette Attive e
 * correzione A protette.
 *
 * Codice REALE estratto da khub_mvp.html; api/chat.js reale contro un finto
 * PostgREST in memoria che riproduce i default SQL (4/200 su INSERT senza le
 * colonne) e il trigger di contenuto_modificato_il. Solo dati sintetici.
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

// Comportamento del DB reale sopra il finto PostgREST: default SQL 4/200 su
// INSERT di una variante senza le colonne; trigger su contenuto_hash.
function withDbBehaviour(fake) {
  const base = fake.fetch; let tick = 0;
  fake.inserted = [];
  fake.fetch = async (url, opts = {}) => {
    const u = new URL(url); const table = u.pathname.replace('/rest/v1/', ''); const method = opts.method || 'GET';
    if (table === 'variants' && method === 'POST') {
      const data = JSON.parse(opts.body); const rows = Array.isArray(data) ? data : [data];
      const before = Object.fromEntries((fake.tables.variants || []).map(v => [v.id, v.contenuto_hash]));
      rows.forEach(r => {
        const exists = (fake.tables.variants || []).some(v => v.id === r.id);
        if (!exists) { fake.inserted.push(r.id); if (!('portions_count' in r)) r.portions_count = 4; if (!('grams_per_portion' in r)) r.grams_per_portion = 200; }
        if (r.portions_count === null || r.grams_per_portion === null) throw new Error('NOT NULL violato su ' + r.id);
      });
      const res = await base(url, { ...opts, body: JSON.stringify(Array.isArray(data) ? rows : rows[0]) });
      fake.tables.variants.forEach(v => { if (v.contenuto_hash !== before[v.id] && 'contenuto_hash' in v) v.contenuto_modificato_il = '2026-10-19T10:00:' + String(++tick).padStart(2, '0') + 'Z'; });
      return res;
    }
    return base(url, opts);
  };
  return fake;
}

// Obiettivi: 0/0, 1/0, 0/200, valori validi, decimale lungo come testo, valori storici "sospetti" 4/200 e 3/200.
const TARGETS = { lvZ: [0, 0], lvU: [1, 0], lvG: [0, 200], lvV: [12, 85.5], lvS: [7, '123.456789'], vaA: [0, 0], vaD: [4, 200], vaR: [3, 200], vaP: [10, 80] };
function seed(fake) {
  const steps = [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: null }];
  const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null,
    steps: JSON.stringify(['Impastare']), steps_v2: steps, primo_consulto: null, m1_reading_text: null, contenuto_hash: null, contenuto_modificato_il: null };
  fake.tables.recipes = [{ id: 'rT', name: 'Frolla TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' }];
  const v = (id, status, active, dq = null, du = null) => ({ ...base, id, recipe_id: 'rT', name: 'V ' + id, label: 'V ' + id, note: 'nota ' + id, status, active,
    portions_count: TARGETS[id][0], grams_per_portion: TARGETS[id][1], validated_at: status === 'lab' ? null : '2026-10-01T09:30:17.250Z',
    origin_variant_id: null, created_at: '2026-10-01T00:00:00Z', declared_yield_qty: dq, declared_yield_unit: du });
  fake.tables.variants = [v('lvZ', 'lab', false, 30, 'pz'), v('lvU', 'lab', false), v('lvG', 'lab', false), v('lvV', 'lab', false), v('lvS', 'lab', false),
    v('vaA', 'validated', true, 32, 'bignè'), v('vaD', 'validated', true), v('vaR', 'retired', false), v('vaP', 'validated', false)];
  const ing = (id, vid, name, qty, unit, ord) => ({ id: id + vid, variant_id: vid, name, qty, unit, sort_order: ord, estimated_yield_pct: 70, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
  fake.tables.ingredients = Object.keys(TARGETS).flatMap(vid => [ing('farina', vid, 'Farina', 500, 'g', 0), ing('burro', vid, 'Burro', 0.30000000000000004, 'kg', 1)]);
  fake.tables.l2_items = []; fake.tables.l3_items = []; fake.tables.families = []; fake.tables.variant_families = []; fake.tables.ingredient_conversions = [];
  fake.tables.production_sessions = [{ id: 'ps1', recipe_id: 'rT', source_variant_id: 'vaA', status: 'completed', snapshot: { ingredients: [] }, target_finished_total: 630 }];
}

async function loadHandler() {
  const src = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
  return (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;
}
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
function extractFunction(m) { const s = html.indexOf(m); if (s === -1) throw new Error('marker ' + m); let d = 0; for (let i = html.indexOf('{', s); i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}') { d--; if (!d) return html.slice(s, i + 1); } } }
const SRC = [
  'function R(id)', 'function curLab(recipe)', 'function cnum(n)', 'function upRec(id,fn)', 'function upLab(id,fn)', 'function activeVariants(recipe)',
  'function parseLocaleNumber(value)', 'function normalizeDeclaredYield(qty,unit)', 'function classifyYieldUnit(unit)',
  'function targetFromDb(value)', 'function targetForDb(value)', 'function declaredYieldFromRow(row)', 'function copyDeclaredYield(src)', 'function declaredYieldPayload(v)',
  'function validateLabProductionTarget(field,value)', 'function setLabProductionTarget(recipeId,field,rawValue)', 'function onLabTargetPortions(recipeId,val)',
  'function addIngredient(recipeId)', 'function creaBozzaDaSorgente(recipeId,attiva)', 'function duplicaVersioneLAB(recipeId)', 'async function creaSchedaDaLab(recipeId)',
  'function rendiAttiva(recipeId)', 'function onValidate()', 'async function confirmValidate()', 'function toggleActiveV2(recipeId,variantId,currentActive)',
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)', 'function isBetterConversionFact(candidate,current)',
  'function buildKnownIngredientIds(ingredientRows)', 'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)', 'async function loadFromSupabase()',
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)', 'function escAttr(s)', 'function formatQtyDisplay(value)',
  'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)', 'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)',
  'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).concat([
  html.match(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/)[0], html.match(/var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/)[0],
  html.match(/var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/)[0], html.match(/var LAB_TARGET_PORTIONS_MAX=\d+;/)[0],
]).join('\n');
function makeClient(fetchImpl) {
  const log = { autosaves: [], toasts: [] };
  const dom = { 'new-ing-qty': { value: '' }, 'new-ing-unit': { value: 'g' }, 'new-ing-name': { value: '' } };
  const c = new Function('fetch', 'log', 'document', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{},pendingFamilies:[],addIngMode:'ingrediente',addIngSelectedMattoncino:null};
    var _knownIngredientIdsByVariant={}; var _persistedValidatedSig={}; var _saveLocked=false, _saveTimer={};
    function render(){} function autosave(id){log.autosaves.push(id);} function toast(m){log.toasts.push(m);}
    function confirm(){return true;} function addHistory(){} function suggestFamilies(){return [];} async function saveFamilies(){} function openLabFamilyPicker(){}
    ${SRC}
    return {S, loadFromSupabase, saveToSupabase, addIngredient, creaBozzaDaSorgente, duplicaVersioneLAB, creaSchedaDaLab, rendiAttiva, onValidate, confirmValidate,
      toggleActiveV2, onLabTargetPortions, buildValidatedVariantPayload, makeDefaultLab, firmaContenutoBozza, getSig: id => _persistedValidatedSig[id]};
  `)(fetchImpl, log, { getElementById: id => dom[id] || null });
  c.log = log; c.dom = dom; return c;
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase'; process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let saves = [];
  const callApi = async body => { if (body.supabaseAction === 'save') saves.push(clone(body.data)); let st = 200, out; await realHandler({ method: 'POST', body }, { status(c) { st = c; return this; }, json(o) { out = o; return this; } }); return { st, out }; };
  const clientFetch = async (u, o) => { const r = await callApi(JSON.parse(o.body)); return { ok: r.st < 400, status: r.st, json: async () => r.out }; };
  let fake;
  const setup = async () => { fake = withDbBehaviour((() => { const f = makeFakeSupabase(); seed(f); return f; })()); globalThis.fetch = fake.fetch; saves = []; const c = makeClient(clientFetch); await c.loadFromSupabase(); return c; };
  const rec = c => c.S.recipes.find(r => r.id === 'rT');
  const ver = (c, id) => rec(c).labVersions.find(v => v.id === id) || rec(c).validatedVariants.find(v => v.id === id);
  const dbT = id => { const r = fake.tables.variants.find(v => v.id === id); return r ? [r.portions_count, r.grams_per_portion] : undefined; };
  const allT = () => Object.fromEntries(fake.tables.variants.map(v => [v.id, [v.portions_count, v.grams_per_portion]]));

  console.log('LAB FIX 2C — C1: protezione dell\'obiettivo di Produzione');

  await test('T1. caricamento: valori del DB identici (0/0, 1/0, 0/200, validi, testo, storici 4/200 e 3/200), mai 4/200 inventati', async () => {
    const c = await setup();
    for (const [id, t] of Object.entries(TARGETS)) assert.deepStrictEqual([ver(c, id).portionsCount, ver(c, id).gramsPerPortion], t, id);
    assert.strictEqual(ver(c, 'lvG').portionSize, 200); assert.strictEqual(ver(c, 'lvZ').portionSize, 0);
  });

  await test('T2. tre cicli carica -> salva senza modifiche: obiettivi, firma e data delle bozze invariati; Attive non reinviate', async () => {
    const c0 = await setup();
    await c0.saveToSupabase(rec(c0)); // primo salvataggio: registra la firma delle bozze
    const t0 = allT();
    const hash0 = Object.fromEntries(fake.tables.variants.map(v => [v.id, [v.contenuto_hash, v.contenuto_modificato_il]]));
    assert.deepStrictEqual(t0, Object.fromEntries(Object.entries(TARGETS)), 'il primo salvataggio non altera nulla');
    for (let k = 0; k < 3; k++) { const c = makeClient(clientFetch); await c.loadFromSupabase(); saves = []; assert.strictEqual(await c.saveToSupabase(rec(c)), true); assert.ok(saves[0].variants.every(v => v.status === 'lab'), 'nessuna Attiva reinviata'); }
    assert.deepStrictEqual(allT(), t0);
    assert.deepStrictEqual(Object.fromEntries(fake.tables.variants.map(v => [v.id, [v.contenuto_hash, v.contenuto_modificato_il]])), hash0, 'firma e data invariate');
  });

  await test('T3. zeri inviati esplicitamente: chiavi sempre presenti nei payload, null/undefined -> 0, mai i default SQL 4/200', async () => {
    const c = await setup();
    c.creaBozzaDaSorgente('rT', null);
    const nuova = rec(c).labVersions[0];
    assert.deepStrictEqual([nuova.portionsCount, nuova.gramsPerPortion, nuova.portionSize], [0, 0, 0], 'nuova bozza 0/0');
    assert.deepStrictEqual([c.makeDefaultLab('rT', 'x').portionsCount, c.makeDefaultLab('rT', 'x').gramsPerPortion], [0, 0]);
    // bozze con campi null/undefined (mai prodotte dai flussi, protezione)
    rec(c).labVersions.push({ ...nuova, id: 'lvNull', portionsCount: null, gramsPerPortion: undefined, ingredients: [] });
    saves = [];
    assert.strictEqual(await c.saveToSupabase(rec(c)), true);
    for (const v of saves[0].variants) { assert.ok('portions_count' in v && 'grams_per_portion' in v, v.id); }
    assert.deepStrictEqual(dbT(nuova.id), [0, 0], 'riga nuova: 0/0 esplicito, non 4/200');
    assert.deepStrictEqual(dbT('lvNull'), [0, 0], 'null/undefined -> 0 esplicito');
    assert.ok(fake.inserted.includes(nuova.id) && fake.inserted.includes('lvNull'));
    const p = c.buildValidatedVariantPayload('rT', { ...ver(c, 'vaA'), portionsCount: undefined, gramsPerPortion: null }).row;
    assert.deepStrictEqual([p.portions_count, p.grams_per_portion], [0, 0]);
    assert.deepStrictEqual([c.buildValidatedVariantPayload('rT', ver(c, 'vaD')).row.portions_count, c.buildValidatedVariantPayload('rT', ver(c, 'vaP')).row.grams_per_portion], [4, 80], 'valori validi e storici inviati come sono');
  });

  await test('T4. aggiungere ingredienti non modifica l\'obiettivo (0/0, 1/0, 1/350, 12/85,5)', async () => {
    const c = await setup();
    for (const id of ['lvZ', 'lvU', 'lvV']) {
      rec(c).currentLabIdx = rec(c).labVersions.findIndex(v => v.id === id);
      const before = [ver(c, id).portionsCount, ver(c, id).gramsPerPortion];
      for (const [n, q, u] of [['Uova', '3', 'n'], ['Latte', '250', 'ml'], ['Zucchero', '0.15', 'kg']]) { c.dom['new-ing-name'].value = n; c.dom['new-ing-qty'].value = q; c.dom['new-ing-unit'].value = u; c.addIngredient('rT'); }
      assert.deepStrictEqual([ver(c, id).portionsCount, ver(c, id).gramsPerPortion], before, id);
      assert.strictEqual(ver(c, id).ingredients.length, 5);
    }
    rec(c).labVersions = rec(c).labVersions.map(v => v.id === 'lvU' ? { ...v, gramsPerPortion: 350 } : v);
    rec(c).currentLabIdx = rec(c).labVersions.findIndex(v => v.id === 'lvU');
    c.dom['new-ing-name'].value = 'Sale'; c.dom['new-ing-qty'].value = '5'; c.addIngredient('rT');
    assert.deepStrictEqual([ver(c, 'lvU').portionsCount, ver(c, 'lvU').gramsPerPortion], [1, 350]);
    assert.strictEqual(await c.saveToSupabase(rec(c)), true);
    assert.deepStrictEqual([dbT('lvZ'), dbT('lvU'), dbT('lvV')], [[0, 0], [1, 350], [12, 85.5]]);
  });

  await test('T5. copie e promozioni: Nuova bozza da Attiva, Duplica, Crea Scheda, Rendi attiva, Valida copiano i valori come sono', async () => {
    const c = await setup();
    c.creaBozzaDaSorgente('rT', ver(c, 'vaA'));
    assert.deepStrictEqual([rec(c).labVersions[0].portionsCount, rec(c).labVersions[0].gramsPerPortion], [0, 0], 'da Attiva 0/0');
    c.creaBozzaDaSorgente('rT', ver(c, 'vaD'));
    assert.deepStrictEqual([rec(c).labVersions[0].portionsCount, rec(c).labVersions[0].gramsPerPortion], [4, 200], 'da Attiva storica 4/200: copiata, non corretta');
    const c2 = await setup();
    rec(c2).currentLabIdx = rec(c2).labVersions.findIndex(v => v.id === 'lvG');
    c2.duplicaVersioneLAB('rT');
    const dup = rec(c2).labVersions.at(-1);
    assert.deepStrictEqual([dup.portionsCount, dup.gramsPerPortion], [0, 200]);
    rec(c2).currentLabIdx = rec(c2).labVersions.findIndex(v => v.id === 'lvU');
    await c2.creaSchedaDaLab('rT');
    const scheda = c2.S.recipes.find(r => r.id !== 'rT');
    assert.deepStrictEqual([scheda.labVersions[0].portionsCount, scheda.labVersions[0].gramsPerPortion], [1, 0]);
    assert.deepStrictEqual(dbT(scheda.labVersions[0].id), [1, 0]);
    rec(c2).currentLabIdx = rec(c2).labVersions.findIndex(v => v.id === 'lvZ');
    c2.rendiAttiva('rT');
    c2.S.selectedId = 'rT'; rec(c2).currentLabIdx = rec(c2).labVersions.findIndex(v => v.id === 'lvS');
    c2.onValidate(); await c2.confirmValidate();
    assert.strictEqual(await c2.saveToSupabase(rec(c2)), true);
    assert.deepStrictEqual([dbT('lvZ'), dbT('lvS'), dbT(dup.id)], [[0, 0], [7, '123.456789'], [0, 200]]);
    assert.deepStrictEqual([fake.tables.variants.find(v => v.id === 'lvZ').status, fake.tables.variants.find(v => v.id === 'lvZ').active], ['validated', true]);
  });

  await test('T6. Ricette Attive: 0/0 e storiche 4/200 preservate anche quando inviate (Disattiva); correzione A intatta', async () => {
    const c = await setup();
    c.toggleActiveV2('rT', 'vaA', true); c.toggleActiveV2('rT', 'vaD', true);
    await new Promise(r => setTimeout(r, 10));
    assert.deepStrictEqual([dbT('vaA'), dbT('vaD'), dbT('vaR'), dbT('vaP')], [[0, 0], [4, 200], [3, 200], [10, 80]]);
    const a = fake.tables.variants.find(v => v.id === 'vaA');
    assert.deepStrictEqual([a.active, a.declared_yield_qty, a.declared_yield_unit], [false, 32, 'bignè']);
    assert.ok(saves.every(s => s.variants.every(v => v.status === 'lab' || !('declared_yield_qty' in v))), 'resa delle Attive mai nel salvataggio completo');
    const c2 = makeClient(clientFetch); await c2.loadFromSupabase();
    for (const id of ['vaA', 'vaD', 'vaR', 'vaP']) assert.strictEqual(c2.buildValidatedVariantPayload('rT', ver(c2, id)).sig, c2.getSig(id), id);
    assert.deepStrictEqual(clone(fake.tables.production_sessions), [{ id: 'ps1', recipe_id: 'rT', source_variant_id: 'vaA', status: 'completed', snapshot: { ingredients: [] }, target_finished_total: 630 }]);
  });

  await test('T7. quantita\' e resa dichiarata invariate in tutti i flussi; obiettivo e resa indipendenti', async () => {
    const c = await setup();
    rec(c).currentLabIdx = rec(c).labVersions.findIndex(v => v.id === 'lvZ');
    c.onLabTargetPortions('rT', '24');
    await c.saveToSupabase(rec(c));
    const z = fake.tables.variants.find(v => v.id === 'lvZ');
    assert.deepStrictEqual([z.portions_count, z.grams_per_portion, z.declared_yield_qty, z.declared_yield_unit], [24, 0, 30, 'pz']);
    for (const vid of Object.keys(TARGETS)) assert.deepStrictEqual(fake.tables.ingredients.filter(i => i.variant_id === vid).map(i => i.qty), [500, 0.30000000000000004], vid);
  });

  await test('T8. codice: nessun 4/200 al caricamento, nuove bozze 0/0, addIngredient non tocca G/porzione, payload con targetForDb', async () => {
    const load = extractFunction('async function loadFromSupabase()');
    assert.ok(!/portions_count\|\|4|grams_per_portion\|\|200/.test(load));
    assert.strictEqual((load.match(/targetFromDb\(/g) || []).length, 6);
    assert.ok(!/gramsPerPortion|portionSize|Math\.round/.test(extractFunction('function addIngredient(recipeId)')));
    assert.ok(extractFunction('async function saveToSupabase(recipe)').includes('portions_count:targetForDb(v.portionsCount),grams_per_portion:targetForDb(v.gramsPerPortion)'));
    assert.ok(extractFunction('function buildValidatedVariantPayload(recipeId,vv)').includes('portions_count:targetForDb(vv.portionsCount),grams_per_portion:targetForDb(vv.gramsPerPortion)'));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
