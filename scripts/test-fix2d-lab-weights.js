/*
 * Test — FIX 2D: pesi nella fascia verde del LAB e arrotondamento facoltativo.
 * Fascia: peso a crudo e finito teorico in sola lettura, resa dichiarata
 * correggibile (un solo controllo), Obiettivo di Produzione non piu' mostrato
 * ma conservato. Arrotonda quantita': anteprima, conferma, annullamento
 * esatto finche' la bozza non cambia, blocco degli azzeramenti, nessun
 * arrotondamento al salvataggio. Ricette Attive, Sessioni, conversioni e
 * motore di Produzione invariati.
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

// Bignè: 500 g farina + 0,25 kg burro + 150 g zucchero, resa 70% -> 900 g crudi, 630 g finiti.
function seed(fake, { draftYield = [null, null] } = {}) {
  const steps = [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: null }];
  const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null, steps: JSON.stringify(['Impastare']), steps_v2: steps, primo_consulto: null, m1_reading_text: null };
  fake.tables.recipes = [{ id: 'rB', name: 'Bignè TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' }];
  fake.tables.variants = [
    { ...base, id: 'vaB', recipe_id: 'rB', name: 'Classica', label: 'Classica', note: 'attiva', status: 'validated', active: true, portions_count: 30, grams_per_portion: 21, validated_at: '2026-10-01T09:30:17.250Z', origin_variant_id: null, created_at: '2026-10-01T00:00:00Z', declared_yield_qty: '30', declared_yield_unit: 'bignè' },
    { ...base, id: 'lvB', recipe_id: 'rB', name: 'Bozza', label: 'Bozza 1', note: 'bozza', status: 'lab', active: false, portions_count: 12, grams_per_portion: 21, origin_variant_id: 'vaB', created_at: '2026-10-02T00:00:00Z', declared_yield_qty: draftYield[0], declared_yield_unit: draftYield[1] },
  ];
  const ing = (id, vid, name, qty, unit, ord, y) => ({ id, variant_id: vid, name, qty, unit, sort_order: ord, estimated_yield_pct: y, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
  fake.tables.ingredients = ['vaB'].flatMap(vid => [ing('f' + vid, vid, 'Farina', 500, 'g', 0, 70), ing('b' + vid, vid, 'Burro', 0.25, 'kg', 1, 70), ing('z' + vid, vid, 'Zucchero', 150, 'g', 2, 70)]);
  // Bozza con unita' diverse e decimali lunghi: g, kg, ml, l, pezzi, quantita' minima.
  fake.tables.ingredients.push(
    ing('d1', 'lvB', 'Farina', 166.66666666666669, 'g', 0, 70), ing('d2', 'lvB', 'Burro', 0.375, 'kg', 1, 70), ing('d3', 'lvB', 'Latte', 12.5, 'ml', 2, null),
    ing('d4', 'lvB', 'Panna', 1.2345, 'l', 3, null), ing('d5', 'lvB', 'Uova', 4.5, 'n', 4, null), ing('d6', 'lvB', 'Sale', 0.004, 'g', 5, null), ing('d7', 'lvB', 'Zucchero', 150, 'g', 6, 70));
  fake.tables.ingredient_conversions = [{ id: 'k1', ingredient_name: 'latte', from_unit: 'ml', to_unit: 'g', factor: 1.03, source_type: 'chef_confirmed', source_detail: null, confirmed_at: '2026-10-01T00:00:00Z' },
    { id: 'k2', ingredient_name: 'panna', from_unit: 'ml', to_unit: 'g', factor: 1, source_type: 'chef_confirmed', source_detail: null, confirmed_at: '2026-10-01T00:00:00Z' },
    { id: 'k3', ingredient_name: 'uova', from_unit: 'n', to_unit: 'g', factor: 55, source_type: 'chef_confirmed', source_detail: null, confirmed_at: '2026-10-01T00:00:00Z' }];
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = [];
  fake.tables.production_sessions = [{ id: 'ps1', recipe_id: 'rB', source_variant_id: 'vaB', status: 'completed', snapshot: { ingredients: [] } }];
}
const dbVariant = (fake, id) => clone(fake.tables.variants.find(v => v.id === id));
const ingContent = (fake, id) => clone(fake.tables.ingredients.filter(i => i.variant_id === id).sort((a, b) => a.sort_order - b.sort_order)).map(i => [i.name, i.qty, i.unit, i.estimated_yield_pct]);

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
  'function targetFromDb(value)', 'function targetForDb(value)', 'function declaredYieldFromRow(row)', 'function copyDeclaredYield(src)', 'function declaredYieldPayload(v)', 'function declaredYieldState(v)',
  'function declaredYieldInputText(raw)', 'function declaredYieldErrorMessage(error)', 'function onLabDeclaredYield(recipeId,field,value)',
  'function discardLabDeclaredYieldInput(recipeId)', 'function labGrams(x)', 'function labWeightsStima(w)', 'function renderLabFormulationBand(recipe,v,w)', 'function renderLabWeightsPanel(recipe,v,w)', 'function roundQtyDecimals(x,d)', 'function computeLabRounding(ingredients,decimals)', 'function labRoundUndoValido(recipe,v)', 'function openLabRound(recipeId)', 'function setLabRoundDecimals(d)', 'function closeLabRound()', 'function applyLabRound(recipeId)', 'function undoLabRound(recipeId)', 'function labQtyText(x)', 'function renderLabRoundSection(recipe,v)',
  'function validateLabProductionTarget(field,value)', 'function setLabProductionTarget(recipeId,field,rawValue)', 'function onLabTargetPortions(recipeId,val)',
  'function onIngQty(recipeId,ingId,val)',
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)',
  'function isBetterConversionFact(candidate,current)', 'function buildKnownIngredientIds(ingredientRows)',
  'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()',
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g), [
  html.match(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/)[0], html.match(/var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/)[0],
  html.match(/var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/)[0], html.match(/var LAB_TARGET_PORTIONS_MAX=\d+;/)[0],
  html.match(/var LAB_WEIGHT_INVALID_REASONS=\{[^}]*\};/)[0], html.match(/var LAB_ROUND_DECIMALS=\[[^\]]*\];/)[0],
]).join('\n');

function makeClient(fetchImpl, unitWeights = {}) {
  const log = { autosaves: [], renders: 0, toasts: [] };
  const c = new Function('fetch', 'log', 'unitWeights', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:unitWeights,unitWeightFacts:{},productionConversionFacts:{},labYieldInput:{},labRound:null,labRoundUndo:null};
    var _knownIngredientIdsByVariant={};
    var _persistedValidatedSig={};
    function render(){log.renders++;}
    function autosave(id){log.autosaves.push(id);}
    function toast(msg){log.toasts.push(msg);render();}
    ${SRC}
    return {S, loadFromSupabase, saveToSupabase, onLabDeclaredYield, renderLabFormulationBand, renderLabWeightsPanel, computeFormulationWeights, onIngQty, buildValidatedVariantPayload,
      roundQtyDecimals, computeLabRounding, openLabRound, setLabRoundDecimals, closeLabRound, applyLabRound, undoLabRound, renderLabRoundSection, firmaContenutoBozza, getSig: id => _persistedValidatedSig[id]};
  `)(fetchImpl, log, unitWeights);
  c.log = log;
  return c;
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const box = (h, cls) => { const m = h.match(new RegExp('class="' + cls + '"[^>]*>[\\s\\S]*?<div[^>]*>([^<]*)</div>\\s*<div[^>]*>([^<]*)</div>')); return m ? [m[1], m[2]] : null; };

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
  const setup = async (opts) => {
    fake = makeFakeSupabase(); seed(fake, opts); globalThis.fetch = fake.fetch; saves = [];
    const c = makeClient(clientFetch); await c.loadFromSupabase();
    return c;
  };
  const rec = c => c.S.recipes.find(r => r.id === 'rB');
  const lab = c => rec(c).labVersions[0];
  const band = c => c.renderLabFormulationBand(rec(c), lab(c));
  const round = c => c.renderLabRoundSection(rec(c), lab(c));
  const save = c => c.saveToSupabase(rec(c));

  const crypto = require('crypto');
  const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  const qtys = c => lab(c).ingredients.map(i => i.qty);
  const dbQ = () => fake.tables.ingredients.filter(i => i.variant_id === 'lvB').sort((a, b) => a.sort_order - b.sort_order).map(i => i.qty);
  const altriCampi = list => list.map(i => { const x = { ...i }; delete x.qty; return x; });
  const intatti = () => clone({ va: fake.tables.variants.find(v => v.id === 'vaB'), ia: fake.tables.ingredients.filter(i => i.variant_id === 'vaB'), s: fake.tables.production_sessions, k: fake.tables.ingredient_conversions });
  const ORIG = [166.66666666666669, 0.375, 12.5, 1.2345, 4.5, 0.004, 150];

  console.log('FIX 2D — pesi nella fascia verde del LAB e arrotondamento facoltativo');

  await test('D1. fascia verde: peso a crudo e finito in sola lettura, resa dichiarata con un solo controllo; nessun Obiettivo di Produzione nel LAB', async () => {
    const c = await setup({ draftYield: [30, 'bignè'] });
    const h = band(c), p = c.renderLabWeightsPanel(rec(c), lab(c));
    assert.ok(box(h, 'lab-w-raw')[0].startsWith('Peso a crudo totale') && box(h, 'lab-w-finished')[0].startsWith('Peso finito teorico'));
    assert.ok(!/<input[^>]*lab-w-|class="lab-w-raw"[^>]*><input/.test(h), 'pesi non modificabili');
    assert.strictEqual((h.match(/id="lab-yield-qty"/g) || []).length, 1); assert.strictEqual((h.match(/id="lab-yield-unit"/g) || []).length, 1);
    assert.ok(!/lab-yield-qty|lab-yield-unit|lab-w-raw"|lab-w-finished"/.test(p), 'nessun controllo o peso duplicato nel pannello');
    assert.ok(/value="30"/.test(h) && /value="bignè"/.test(h));
    const r = extractFunction('function renderLabRecipe(recipe)');
    assert.ok(r.includes('${renderLabFormulationBand(recipe,v,pesiLab)}') && !r.includes('renderLabProductionTarget(') && !/lab-target-|Porzioni|G\/porzione|Totale finito/.test(r + h));
  });

  await test('D2. modificare un ingrediente ricalcola i pesi; la resa dichiarata non cambia', async () => {
    const c = await setup({ draftYield: [30, 'bignè'] });
    const fmt = x => x.toLocaleString('it-IT', { maximumFractionDigits: 2, useGrouping: false }) + ' g';
    const w0 = c.computeFormulationWeights(lab(c).ingredients);
    assert.strictEqual(w0.status, 'complete');
    assert.deepStrictEqual([box(band(c), 'lab-w-raw')[1], box(band(c), 'lab-w-finished')[1]], [fmt(w0.raw), fmt(w0.finished)]);
    c.onIngQty('rB', 'd7', '250');
    const w1 = c.computeFormulationWeights(lab(c).ingredients);
    assert.ok(Math.abs(w1.raw - w0.raw - 100) < 1e-9 && Math.abs(w1.finished - w0.finished - 70) < 1e-9, '+100 g crudi, +70 g finiti (resa 70%)');
    assert.deepStrictEqual([box(band(c), 'lab-w-raw')[1], box(band(c), 'lab-w-finished')[1]], [fmt(w1.raw), fmt(w1.finished)]);
    assert.deepStrictEqual([lab(c).declaredYieldQty, lab(c).declaredYieldUnit], [30, 'bignè'], 'resa invariata');
  });

  await test('D3. arrotondamento decimale esatto per unita\' diverse (g, kg, ml, l, pezzi)', async () => {
    const c = await setup();
    const r = c.roundQtyDecimals;
    assert.deepStrictEqual([r(1.005, 2), r(2.675, 2), r(1.2345, 3), r(166.66666666666669, 2), r(0.375, 1), r(0.375, 2), r(4.5, 0), r(12.5, 0), r(0.004, 2), r(150, 0), r(1e-7, 3)],
      [1.01, 2.68, 1.235, 166.67, 0.4, 0.38, 5, 13, 0, 150, 0]);
    const res = c.computeLabRounding(lab(c).ingredients, 1);
    assert.deepStrictEqual(res.rows.map(x => [x.unit, x.rounded]), [['g', 166.7], ['kg', 0.4], ['ml', 12.5], ['l', 1.2], ['n', 4.5], ['g', 0], ['g', 150]]);
    assert.deepStrictEqual(res.rows.map(x => x.changed), [true, true, false, true, false, true, false]);
    assert.ok(Object.is(res.rows[2].rounded, 12.5) && Object.is(res.rows[6].rounded, 150), 'valori gia\' arrotondati identici');
    assert.deepStrictEqual([res.zeroed.map(x => x.name), res.ok], [['Sale'], false]);
    assert.deepStrictEqual(c.computeLabRounding([{ id: 'x', name: 'X', qty: 'abc', unit: 'g' }, { id: 'y', name: 'Y', qty: -1, unit: 'g' }, { id: 'z', name: 'Z', qty: 0, unit: 'g' }], 0).changed, 0, 'non numeriche, negative e zero lasciate come sono');
  });

  await test('D4. anteprima: valori originali e arrotondati, nessuna modifica prima della conferma', async () => {
    const c = await setup();
    const prima = clone(lab(c).ingredients), firma = c.firmaContenutoBozza(lab(c));
    assert.ok(round(c).includes('id="lab-round-open"'));
    c.openLabRound('rB'); assert.ok(/disabled/.test(round(c).match(/<button id="lab-round-apply"[^>]*>/)[0]), 'senza scelta non si applica');
    c.setLabRoundDecimals(3);
    const h = round(c);
    assert.ok(text(h).includes('166,66666666666669 g → 166,667 g') && text(h).includes('1,2345 l → 1,235 l'));
    assert.ok(!/disabled/.test(h.match(/<button id="lab-round-apply"[^>]*>/)[0]));
    assert.deepStrictEqual(lab(c).ingredients, prima); assert.strictEqual(c.firmaContenutoBozza(lab(c)), firma);
    assert.deepStrictEqual(c.log.autosaves, [], 'nessun salvataggio durante l\'anteprima');
    c.closeLabRound(); assert.deepStrictEqual(lab(c).ingredients, prima); assert.strictEqual(c.S.labRound, null);
  });

  await test('D5. applicazione: solo le quantita\' cambiano; salvate esatte; annullamento ripristina i valori precedenti anche nel DB', async () => {
    const c = await setup({ draftYield: [30, 'bignè'] });
    const before = intatti(), prima = clone(lab(c).ingredients), labPrima = { ...lab(c) };
    c.openLabRound('rB'); c.setLabRoundDecimals(3); c.applyLabRound('rB');
    assert.deepStrictEqual(qtys(c), [166.667, 0.375, 12.5, 1.235, 4.5, 0.004, 150]);
    assert.deepStrictEqual(altriCampi(lab(c).ingredients), altriCampi(prima), 'nomi, unita\', rese, id, mattoncini invariati');
    for (const k of ['name', 'declaredYieldQty', 'declaredYieldUnit', 'portionsCount', 'gramsPerPortion', 'steps', 'stepsV2']) assert.deepStrictEqual(lab(c)[k], labPrima[k], k);
    assert.deepStrictEqual(c.log.autosaves, ['rB']);
    assert.strictEqual(await save(c), true);
    assert.deepStrictEqual(dbQ(), qtys(c), 'salvate senza ulteriori arrotondamenti');
    assert.ok(round(c).includes('id="lab-round-undo"'));
    c.undoLabRound('rB');
    qtys(c).forEach((q, i) => assert.ok(Object.is(q, prima[i].qty), 'ripristino esatto ' + i));
    assert.strictEqual(await save(c), true);
    dbQ().forEach((q, i) => assert.ok(Object.is(q, ORIG[i]), 'DB ripristinato esatto ' + i));
    assert.deepStrictEqual(intatti(), before, 'Ricetta Attiva, Sessioni e conversioni invariate');
    assert.deepStrictEqual(saves.map(s => s.variants.map(v => v.id)), [['lvB'], ['lvB']]);
    const db = dbVariant(fake, 'lvB'); assert.deepStrictEqual([db.portions_count, db.grams_per_portion, String(db.declared_yield_qty), db.declared_yield_unit], [12, 21, '30', 'bignè'], 'Obiettivo e resa conservati');
  });

  await test('D6. annullamento non piu\' disponibile dopo un\'altra modifica della bozza: nulla viene ripristinato', async () => {
    const c = await setup();
    c.openLabRound('rB'); c.setLabRoundDecimals(1); assert.strictEqual(c.computeLabRounding(lab(c).ingredients, 1).ok, false, 'Sale si azzererebbe');
    c.onIngQty('rB', 'd6', '0.04'); c.setLabRoundDecimals(2); c.applyLabRound('rB');
    const dopo = qtys(c);
    c.onIngQty('rB', 'd7', '151');
    assert.ok(!round(c).includes('lab-round-undo'), 'pulsante non piu\' mostrato');
    c.undoLabRound('rB');
    assert.deepStrictEqual(qtys(c), dopo.map((q, i) => i === 6 ? 151 : q), 'nessun ripristino parziale');
    assert.ok(c.log.toasts.some(t => /non più disponibile/.test(t)));
  });

  await test('D7. azzeramenti bloccati: nessun ingrediente positivo diventa 0', async () => {
    const c = await setup();
    const prima = clone(lab(c).ingredients);
    for (const d of [0, 1, 2]) {
      c.openLabRound('rB'); c.setLabRoundDecimals(d);
      const h = round(c);
      assert.ok(/disabled/.test(h.match(/<button id="lab-round-apply"[^>]*>/)[0]), d + ' decimali: Applica disattivato');
      assert.ok(text(h).includes('Sale') && /diventerebbe 0/.test(text(h)));
      c.applyLabRound('rB');
      assert.deepStrictEqual(lab(c).ingredients, prima, d + ' decimali: nulla cambia');
      c.closeLabRound();
    }
    assert.deepStrictEqual(c.log.autosaves, []);
    c.openLabRound('rB'); c.setLabRoundDecimals(3); c.applyLabRound('rB');
    assert.ok(lab(c).ingredients.every((i, k) => !(prima[k].qty > 0) || i.qty > 0), 'con 3 decimali nessuno a 0');
    assert.strictEqual(lab(c).ingredients[5].qty, 0.004);
  });

  await test('D8. nessun arrotondamento automatico: salvataggio e rilettura conservano i valori completi', async () => {
    const c = await setup();
    for (let k = 0; k < 3; k++) { assert.strictEqual(await save(c), true); }
    dbQ().forEach((q, i) => assert.ok(Object.is(q, ORIG[i]), 'DB ' + i));
    const c2 = makeClient(clientFetch); await c2.loadFromSupabase();
    lab(c2).ingredients.forEach((ing, i) => assert.ok(Object.is(ing.qty, ORIG[i]), 'rilettura ' + i));
    assert.ok(extractFunction('function renderLabRecipe(recipe)').includes('value="${ing.qty}"'), 'il campo quantita\' mostra il valore completo');
  });

  await test('D9. codice: motore di Produzione, salvataggio, firme, MichelinAI e gestori esistenti invariati', async () => {
    const PROTETTE = {
      'function computeSessionScaling(input)': 'ddfc1febb5010cdc', 'async function createProductionSession(preparedInput)': '185ca85dcee49397',
      'function buildValidatedVariantPayload(recipeId,vv)': '4186aeae0c1330e6', 'async function saveToSupabase(recipe)': 'e3c83f1bdb507136',
      'async function loadFromSupabase()': '115ba063990470c0', 'function firmaContenutoBozza(v)': '9426d786f4588837',
      'function computeFormulationWeights(ingredients,resolveFact)': '765b3d8a8edde206', 'function costruisciPayloadM2(recipeId, message, classification)': '9850def5ee757a1c',
      'async function runM1(recipeId)': 'c65f22895bf0d242', 'function onIngQty(recipeId,ingId,val)': 'f70be59577371d4a',
      'function onLabDeclaredYield(recipeId,field,value)': '7bbbd369b9438f26', 'function toggleActiveV2(recipeId,variantId,currentActive)': 'ca8f22881e9ba641',
      'async function confirmValidate()': '84c902e4f4cba6ae', 'function validateLabProductionTarget(field,value)': 'fefbd04eed656496',
      'function computeRecipeWeightSummary(recipe,vv)': 'beac67cc93eee93b', 'function onIngUnit(recipeId,ingId,val)': '9839d1f8237ed53e',
      'function renderProdRecipe(recipe)': '8a9ec67ee54bfdd4', 'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)': '9df6758db87b12b1',
    };
    for (const [m, h] of Object.entries(PROTETTE)) assert.strictEqual(sha(extractFunction(m)), h, m);
    const nuovo = ['function roundQtyDecimals(x,d)', 'function computeLabRounding(ingredients,decimals)', 'function applyLabRound(recipeId)', 'function undoLabRound(recipeId)'].map(extractFunction).join('\n');
    assert.ok(!/fetch\(|saveToSupabase|Production|Session/.test(nuovo), 'nessuna chiamata al server o alla Produzione');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
