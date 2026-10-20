/*
 * Test — LAB FIX 2C / C2: campi facoltativi dell'Obiettivo di Produzione nel
 * LAB. Porzioni e G/porzione indipendenti; campo vuoto = non impostato (0);
 * compilare, modificare, cancellare ciascun campo; campi vuoti (mai "0");
 * Totale finito solo con entrambi > 0, altrimenti "—"; 0 esplicito, negativi,
 * infiniti, testo rifiutati; Porzioni intere, G/porzione decimale; ingredienti,
 * resa dichiarata, altre bozze e Ricette Attive intatti.
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

function seed(fake) {
  const steps = [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: null }];
  const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null,
    steps: JSON.stringify(['Impastare']), steps_v2: steps, primo_consulto: null, m1_reading_text: null, contenuto_hash: null, contenuto_modificato_il: null };
  fake.tables.recipes = [{ id: 'rT', name: 'Bignè TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' }];
  const v = (id, status, active, p, g, dq = null, du = null) => ({ ...base, id, recipe_id: 'rT', name: 'V ' + id, label: 'V ' + id, note: 'nota ' + id, status, active,
    portions_count: p, grams_per_portion: g, validated_at: status === 'lab' ? null : '2026-10-01T09:30:17.250Z', origin_variant_id: null, created_at: '2026-10-01T00:00:0' + id.length + 'Z', declared_yield_qty: dq, declared_yield_unit: du });
  fake.tables.variants = [v('lvA', 'lab', false, 30, 21, 30, 'bignè'), v('lvB', 'lab', false, 0, 0), v('vaA', 'validated', true, 30, 21, 32, 'bignè'), v('vaZ', 'validated', true, 0, 0)];
  const ing = (n, vid, qty, unit, ord) => ({ id: n + vid, variant_id: vid, name: n, qty, unit, sort_order: ord, estimated_yield_pct: 70, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
  fake.tables.ingredients = ['lvA', 'lvB', 'vaA', 'vaZ'].flatMap(vid => [ing('Farina', vid, 500, 'g', 0), ing('Burro', vid, 0.30000000000000004, 'kg', 1)]);
  fake.tables.l2_items = []; fake.tables.l3_items = []; fake.tables.families = []; fake.tables.variant_families = []; fake.tables.ingredient_conversions = [];
  fake.tables.production_sessions = [{ id: 'ps1', recipe_id: 'rT', source_variant_id: 'vaA', status: 'completed', snapshot: { ingredients: [] }, target_finished_total: 630 }];
}

async function loadHandler() {
  const src = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
  return require('./_khub-test-session').withTestSession((await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default);
}
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
function extractFunction(m) { const s = html.indexOf(m); if (s === -1) throw new Error('marker ' + m); let d = 0; for (let i = html.indexOf('{', s); i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}') { d--; if (!d) return html.slice(s, i + 1); } } }
const SRC = [
  'function R(id)', 'function curLab(recipe)', 'function cnum(n)', 'function upRec(id,fn)', 'function upLab(id,fn)', 'function escAttr(s)', 'function formatQtyDisplay(value)',
  'function parseLocaleNumber(value)', 'function normalizeDeclaredYield(qty,unit)', 'function classifyYieldUnit(unit)',
  'function targetFromDb(value)', 'function targetForDb(value)', 'function declaredYieldFromRow(row)', 'function copyDeclaredYield(src)', 'function declaredYieldPayload(v)',
  'function validateLabProductionTarget(field,value)', 'function labTargetIsSet(value)', 'function labTargetInputValue(value)', 'function setLabProductionTarget(recipeId,field,rawValue)',
  'function onLabTargetPortions(recipeId,val)', 'function onLabTargetGpp(recipeId,val)', 'function renderLabProductionTarget(recipe,v)',
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)', 'function isBetterConversionFact(candidate,current)',
  'function buildKnownIngredientIds(ingredientRows)', 'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)', 'async function loadFromSupabase()',
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)',
  'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)', 'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)',
  'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).concat([
  html.match(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/)[0], html.match(/var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/)[0],
  html.match(/var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/)[0], html.match(/var LAB_TARGET_PORTIONS_MAX=\d+;/)[0],
]).join('\n');
function makeClient(fetchImpl) {
  const log = { autosaves: [], toasts: [], renders: 0 };
  const c = new Function('fetch', 'log', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{}};
    var _knownIngredientIdsByVariant={}; var _persistedValidatedSig={};
    function render(){log.renders++;} function autosave(id){log.autosaves.push(id);} function toast(m){log.toasts.push(m);render();}
    ${SRC}
    return {S, loadFromSupabase, saveToSupabase, onLabTargetPortions, onLabTargetGpp, renderLabProductionTarget, validateLabProductionTarget, buildValidatedVariantPayload, getSig: id => _persistedValidatedSig[id]};
  `)(fetchImpl, log);
  c.log = log; return c;
}
const field = (h, cls) => { const m = h.match(new RegExp('class="scale-input ' + cls + '"[^>]*value="([^"]*)"')); return m ? m[1] : null; };
const total = h => { const m = h.match(/class="scale-total lab-target-total">([^<]*)</); return m ? m[1] : null; };

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase'; process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let saves = [];
  const callApi = async body => { if (body.supabaseAction === 'save') saves.push(clone(body.data)); let st = 200, out; await realHandler({ method: 'POST', body }, { status(c) { st = c; return this; }, json(o) { out = o; return this; } }); return { st, out }; };
  const clientFetch = async (u, o) => { const r = await callApi(JSON.parse(o.body)); return { ok: r.st < 400, status: r.st, json: async () => r.out }; };
  let fake;
  const setup = async () => { fake = withDbBehaviour((() => { const f = makeFakeSupabase(); seed(f); return f; })()); globalThis.fetch = fake.fetch; saves = []; const c = makeClient(clientFetch); await c.loadFromSupabase(); return c; };
  const rec = c => c.S.recipes.find(r => r.id === 'rT');
  const lab = (c, id) => rec(c).labVersions.find(v => v.id === id);
  const focus = (c, id) => { rec(c).currentLabIdx = rec(c).labVersions.findIndex(v => v.id === id); };
  const view = (c, id) => c.renderLabProductionTarget(rec(c), lab(c, id));
  const t = (c, id) => [lab(c, id).portionsCount, lab(c, id).gramsPerPortion];
  const dbRow = id => fake.tables.variants.find(v => v.id === id);
  const ingsDb = id => fake.tables.ingredients.filter(i => i.variant_id === id).sort((a, b) => a.sort_order - b.sort_order).map(i => [i.name, i.qty, i.unit]);

  console.log('LAB FIX 2C — C2: campi facoltativi dell\'Obiettivo di Produzione');

  await test('O1. cancellare Porzioni: 0 in memoria e nel DB, campo vuoto, G/porzione invariato, Totale "—"', async () => {
    const c = await setup(); focus(c, 'lvA');
    c.onLabTargetPortions('rT', '');
    assert.deepStrictEqual(t(c, 'lvA'), [0, 21]);
    const h = view(c, 'lvA');
    assert.deepStrictEqual([field(h, 'lab-target-portions'), field(h, 'lab-target-gpp'), total(h)], ['', '21', '—']);
    await c.saveToSupabase(rec(c));
    assert.deepStrictEqual([dbRow('lvA').portions_count, dbRow('lvA').grams_per_portion], [0, 21]);
  });

  await test('O2. cancellare G/porzione (anche con soli spazi): 0, campo vuoto, Porzioni invariate', async () => {
    const c = await setup(); focus(c, 'lvA');
    c.onLabTargetGpp('rT', '   ');
    assert.deepStrictEqual(t(c, 'lvA'), [30, 0]);
    const h = view(c, 'lvA');
    assert.deepStrictEqual([field(h, 'lab-target-portions'), field(h, 'lab-target-gpp'), total(h)], ['30', '', '—']);
  });

  await test('O3. cancellare entrambi: 0/0, campi vuoti, Totale "—"; salvati come 0 espliciti', async () => {
    const c = await setup(); focus(c, 'lvA');
    c.onLabTargetPortions('rT', ''); c.onLabTargetGpp('rT', '');
    assert.deepStrictEqual(t(c, 'lvA'), [0, 0]);
    const h = view(c, 'lvA');
    assert.deepStrictEqual([field(h, 'lab-target-portions'), field(h, 'lab-target-gpp'), total(h)], ['', '', '—']);
    saves = []; await c.saveToSupabase(rec(c));
    const sent = saves[0].variants.find(v => v.id === 'lvA');
    assert.deepStrictEqual([sent.portions_count, sent.grams_per_portion], [0, 0]);
    assert.deepStrictEqual([dbRow('lvA').portions_count, dbRow('lvA').grams_per_portion], [0, 0]);
  });

  await test('O4. un solo campo compilato (da 0/0): Porzioni 12 -> Totale "—"; poi G/porzione 85,5 -> Totale 1026 g', async () => {
    const c = await setup(); focus(c, 'lvB');
    let h = view(c, 'lvB');
    assert.deepStrictEqual([field(h, 'lab-target-portions'), field(h, 'lab-target-gpp'), total(h)], ['', '', '—'], 'mai "0" mostrato');
    c.onLabTargetPortions('rT', '12');
    h = view(c, 'lvB');
    assert.deepStrictEqual([t(c, 'lvB'), field(h, 'lab-target-portions'), field(h, 'lab-target-gpp'), total(h)], [[12, 0], '12', '', '—']);
    c.onLabTargetGpp('rT', '85,5');
    h = view(c, 'lvB');
    assert.deepStrictEqual([t(c, 'lvB'), total(h)], [[12, 85.5], '1026 g']);
    c.onLabTargetPortions('rT', '');
    assert.deepStrictEqual([t(c, 'lvB'), total(view(c, 'lvB'))], [[0, 85.5], '—']);
  });

  await test('O5. compilare, modificare e cancellare: salvataggio, rilettura e riapertura con campi vuoti; nessuna falsa modifica', async () => {
    const c = await setup(); focus(c, 'lvA');
    c.onLabTargetPortions('rT', '40'); c.onLabTargetGpp('rT', '');
    assert.strictEqual(await c.saveToSupabase(rec(c)), true);
    const hash = dbRow('lvA').contenuto_hash, date = dbRow('lvA').contenuto_modificato_il;
    for (let k = 0; k < 3; k++) { const cc = makeClient(clientFetch); await cc.loadFromSupabase(); assert.strictEqual(await cc.saveToSupabase(rec(cc)), true); }
    const c2 = makeClient(clientFetch); await c2.loadFromSupabase();
    assert.deepStrictEqual(t(c2, 'lvA'), [40, 0]);
    const h = c2.renderLabProductionTarget(rec(c2), lab(c2, 'lvA'));
    assert.deepStrictEqual([field(h, 'lab-target-portions'), field(h, 'lab-target-gpp'), total(h)], ['40', '', '—']);
    assert.deepStrictEqual([dbRow('lvA').contenuto_hash, dbRow('lvA').contenuto_modificato_il], [hash, date], 'riaperture senza modifiche: firma e data invariate');
    const h0 = c2.renderLabProductionTarget(rec(c2), lab(c2, 'lvB'));
    assert.deepStrictEqual([field(h0, 'lab-target-portions'), field(h0, 'lab-target-gpp')], ['', ''], 'bozza 0/0 riaperta con campi vuoti');
  });

  await test('O6. 0 esplicito, negativi, infiniti, testo, porzioni decimali rifiutati senza modifiche ne\' salvataggi', async () => {
    const c = await setup(); focus(c, 'lvA');
    const before = clone(rec(c));
    const badP = ['0', '0,0', '-0', '-3', 'Infinity', '-Infinity', 'NaN', 'abc', '12 porzioni', '2,5', '2.5', '1e3', null, undefined];
    const badG = ['0', '0.0', '-5', 'Infinity', 'NaN', 'abc', '85,5 g', '1e3', null, undefined, {}];
    badP.forEach(x => c.onLabTargetPortions('rT', x)); badG.forEach(x => c.onLabTargetGpp('rT', x));
    assert.deepStrictEqual(clone(rec(c)), before);
    assert.deepStrictEqual(c.log.autosaves, []);
    assert.strictEqual(c.log.toasts.length, badP.length + badG.length);
    assert.ok(c.log.toasts.every(m => /svuota il campo per toglierlo/.test(m)), 'messaggio indica come cancellare');
    assert.deepStrictEqual(c.validateLabProductionTarget('portions', ' 7 '), { ok: true, value: 7 });
    assert.deepStrictEqual(c.validateLabProductionTarget('gpp', '0,35'), { ok: true, value: 0.35 });
    assert.deepStrictEqual(c.validateLabProductionTarget('gpp', ''), { ok: true, value: 0 });
    assert.strictEqual(c.validateLabProductionTarget('altro', '').ok, false);
  });

  await test('O7. ingredienti, resa dichiarata e altre bozze identici; nessun reinvio di Ricette Attive', async () => {
    const c = await setup(); focus(c, 'lvA');
    const ingMem = clone(lab(c, 'lvA').ingredients), other = clone(lab(c, 'lvB'));
    const actBefore = clone(fake.tables.variants.filter(v => v.status !== 'lab'));
    c.onLabTargetPortions('rT', ''); c.onLabTargetGpp('rT', '18,5'); c.onLabTargetGpp('rT', ''); c.onLabTargetPortions('rT', '64');
    assert.deepStrictEqual(lab(c, 'lvA').ingredients, ingMem);
    assert.deepStrictEqual([lab(c, 'lvA').declaredYieldQty, lab(c, 'lvA').declaredYieldUnit], [30, 'bignè']);
    assert.deepStrictEqual(clone(lab(c, 'lvB')), other);
    saves = []; assert.strictEqual(await c.saveToSupabase(rec(c)), true);
    assert.ok(saves[0].variants.every(v => v.status === 'lab'), 'nessuna Attiva nel payload');
    assert.deepStrictEqual(clone(fake.tables.variants.filter(v => v.status !== 'lab')), actBefore);
    assert.deepStrictEqual(ingsDb('lvA'), [['Farina', 500, 'g'], ['Burro', 0.30000000000000004, 'kg']]);
    assert.deepStrictEqual([dbRow('lvA').declared_yield_qty, dbRow('lvA').declared_yield_unit, dbRow('lvA').portions_count, dbRow('lvA').grams_per_portion], [30, 'bignè', 64, 0]);
    for (const id of ['vaA', 'vaZ']) assert.strictEqual(c.buildValidatedVariantPayload('rT', rec(c).validatedVariants.find(v => v.id === id)).sig, c.getSig(id));
    assert.deepStrictEqual(clone(fake.tables.production_sessions)[0].target_finished_total, 630);
  });

  await test('O8. vista: campi di testo (valore non numerico arriva al gestore), stessi gestori di I2, nessuno scaling', async () => {
    const r = extractFunction('function renderLabProductionTarget(recipe,v)');
    assert.ok(r.includes(`onchange="onLabTargetPortions('\${recipe.id}',this.value)"`) && r.includes(`onchange="onLabTargetGpp('\${recipe.id}',this.value)"`));
    assert.ok(!/type="number"/.test(r) && /type="text"/.test(r));
    assert.ok(extractFunction('function renderLabRecipe(recipe)').includes('${renderLabProductionTarget(recipe,v)}'));
    const handlers = ['function validateLabProductionTarget(field,value)', 'function setLabProductionTarget(recipeId,field,rawValue)'].map(extractFunction).join('\n');
    assert.ok(!/ingredients|Math\.round|toFixed|ratio/.test(handlers));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
