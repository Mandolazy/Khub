/*
 * Test — LAB FIX 2B / I5: interfaccia della resa dichiarata e pesi nel LAB.
 * Resa dichiarata modificabile (quantita' + unita', anche personalizzate),
 * distinta dall'Obiettivo di Produzione; i quattro pesi della formulazione
 * dalle funzioni pure di I1 (conversioni + rese, mai somme di unita'
 * diverse, stato incompleto se mancano conversioni); visualizzazione con al
 * massimo 2 decimali; salvataggio, rilettura e riapertura senza perdite;
 * Ricette Attive non reinviate.
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
    { ...base, id: 'lvB', recipe_id: 'rB', name: 'Bozza', label: 'Bozza 1', note: 'bozza', status: 'lab', active: false, portions_count: 1, grams_per_portion: 0, origin_variant_id: 'vaB', created_at: '2026-10-02T00:00:00Z', declared_yield_qty: draftYield[0], declared_yield_unit: draftYield[1] },
  ];
  const ing = (id, vid, name, qty, unit, ord, y) => ({ id, variant_id: vid, name, qty, unit, sort_order: ord, estimated_yield_pct: y, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
  fake.tables.ingredients = ['vaB', 'lvB'].flatMap(vid => [ing('f' + vid, vid, 'Farina', 500, 'g', 0, 70), ing('b' + vid, vid, 'Burro', 0.25, 'kg', 1, 70), ing('z' + vid, vid, 'Zucchero', 150, 'g', 2, 70)]);
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = []; fake.tables.ingredient_conversions = [];
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
  'function declaredYieldFromRow(row)', 'function copyDeclaredYield(src)', 'function declaredYieldPayload(v)', 'function declaredYieldState(v)',
  'function declaredYieldInputText(raw)', 'function declaredYieldErrorMessage(error)', 'function onLabDeclaredYield(recipeId,field,value)',
  'function discardLabDeclaredYieldInput(recipeId)', 'function labGrams(x)', 'function renderLabWeightsPanel(recipe,v,w)',
  'function validateLabProductionTarget(field,value)', 'function setLabProductionTarget(recipeId,field,rawValue)', 'function onLabTargetPortions(recipeId,val)',
  'function onIngQty(recipeId,ingId,val)',
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)',
  'function isBetterConversionFact(candidate,current)', 'function buildKnownIngredientIds(ingredientRows)',
  'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g), [
  html.match(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/)[0], html.match(/var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/)[0],
  html.match(/var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/)[0], html.match(/var LAB_TARGET_PORTIONS_MAX=\d+;/)[0],
  html.match(/var LAB_WEIGHT_INVALID_REASONS=\{[^}]*\};/)[0],
]).join('\n');

function makeClient(fetchImpl, unitWeights = {}) {
  const log = { autosaves: [], renders: 0, toasts: [] };
  const c = new Function('fetch', 'log', 'unitWeights', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:unitWeights,unitWeightFacts:{},productionConversionFacts:{},labYieldInput:{}};
    var _knownIngredientIdsByVariant={};
    var _persistedValidatedSig={};
    function render(){log.renders++;}
    function autosave(id){log.autosaves.push(id);}
    function toast(msg){log.toasts.push(msg);render();}
    ${SRC}
    return {S, loadFromSupabase, saveToSupabase, onLabDeclaredYield, discardLabDeclaredYieldInput, renderLabWeightsPanel, computeFormulationWeights,
      onLabTargetPortions, onIngQty, buildValidatedVariantPayload, getSig: id => _persistedValidatedSig[id]};
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
  const panel = c => c.renderLabWeightsPanel(rec(c), lab(c));
  const save = c => c.saveToSupabase(rec(c));

  console.log('LAB FIX 2B — I5: resa dichiarata e pesi nel LAB');

  await test('U1. formulazione 900 g crudi / 630 g finiti; senza resa i valori per unita\' non vengono inventati', async () => {
    const c = await setup();
    const h = panel(c);
    assert.deepStrictEqual(box(h, 'lab-w-raw'), ['Peso a crudo totale', '900 g']);
    assert.deepStrictEqual(box(h, 'lab-w-finished'), ['Peso finito teorico', '630 g']);
    assert.deepStrictEqual(box(h, 'lab-w-raw-unit'), ['Crudo per unità di resa', '—']);
    assert.ok(/Indica la resa per calcolare i pesi per unità/.test(text(h)));
  });

  await test('U2. resa 30 bignè: 30 g crudi e 21 g finiti per bignè; salvata subito, ingredienti invariati', async () => {
    const c = await setup();
    const ingBefore = clone(lab(c).ingredients);
    c.onLabDeclaredYield('rB', 'qty', '30');
    assert.ok(c.S.labYieldInput[lab(c).id], 'quantita\' senza unita\': non ancora salvata');
    assert.ok(/Inserisci l'unità della resa/.test(text(panel(c))));
    assert.deepStrictEqual(c.log.autosaves, []);
    c.onLabDeclaredYield('rB', 'unit', 'bignè');
    assert.deepStrictEqual([lab(c).declaredYieldQty, lab(c).declaredYieldUnit], [30, 'bignè']);
    assert.deepStrictEqual(c.log.autosaves, ['rB'], 'la modifica della resa avvia il salvataggio');
    const h = panel(c);
    assert.deepStrictEqual(box(h, 'lab-w-raw-unit'), ['Crudo per bignè', '30 g']);
    assert.deepStrictEqual(box(h, 'lab-w-finished-unit'), ['Finito per bignè', '21 g']);
    assert.deepStrictEqual(lab(c).ingredients, ingBefore);
  });

  await test('U3. correzione a 32 bignè: 28,125 / 19,6875 g calcolati, mostrati 28,13 g e 19,69 g; totali e ingredienti invariati', async () => {
    const c = await setup({ draftYield: [30, 'bignè'] });
    const ingBefore = clone(lab(c).ingredients);
    c.onLabDeclaredYield('rB', 'qty', '32');
    const w = c.computeFormulationWeights(lab(c).ingredients);
    assert.strictEqual(w.raw / 32, 28.125); assert.strictEqual(w.finished / 32, 19.6875);
    const h = panel(c);
    assert.deepStrictEqual(box(h, 'lab-w-raw-unit'), ['Crudo per bignè', '28,13 g']);
    assert.deepStrictEqual(box(h, 'lab-w-finished-unit'), ['Finito per bignè', '19,69 g']);
    assert.deepStrictEqual([box(h, 'lab-w-raw')[1], box(h, 'lab-w-finished')[1]], ['900 g', '630 g']);
    assert.deepStrictEqual(lab(c).ingredients, ingBefore);
    assert.strictEqual(await save(c), true);
    assert.deepStrictEqual([dbVariant(fake, 'lvB').declared_yield_qty, dbVariant(fake, 'lvB').declared_yield_unit], [32, 'bignè']);
    assert.deepStrictEqual(ingContent(fake, 'lvB'), [['Farina', 500, 'g', 70], ['Burro', 0.25, 'kg', 70], ['Zucchero', 150, 'g', 70]]);
  });

  await test('U4. unita\' personalizzate (vasetti, filoni, teglia 30x40) come scritte, nessun peso dedotto dal testo', async () => {
    const c = await setup();
    for (const [q, u, perUnit] of [['12', 'vasetti', '52,5 g'], ['3', 'filoni', '210 g'], ['2', '  teglia   30x40 ', '315 g']]) {
      c.onLabDeclaredYield('rB', 'qty', q); c.onLabDeclaredYield('rB', 'unit', u);
      assert.strictEqual(lab(c).declaredYieldUnit, u.replace(/\s+/g, ' ').trim());
      assert.strictEqual(box(panel(c), 'lab-w-finished-unit')[1], perUnit, u);
    }
    c.onLabDeclaredYield('rB', 'qty', '4'); c.onLabDeclaredYield('rB', 'unit', 'vaschette da 500 g');
    assert.strictEqual(box(panel(c), 'lab-w-finished-unit')[1], '157,5 g', 'nessun 500 g dedotto: diviso per 4 pezzi');
    c.onLabDeclaredYield('rB', 'qty', '0,6'); c.onLabDeclaredYield('rB', 'unit', 'Kg.');
    assert.deepStrictEqual([lab(c).declaredYieldQty, lab(c).declaredYieldUnit], [0.6, 'kg']);
    assert.ok(/Resa in peso: 600 g dichiarati; differenza dal finito teorico -30 g/.test(text(panel(c))));
  });

  await test('U5. resa non valida: segnalata, non salvata, nessuna correzione; Ripristina torna al valore salvato', async () => {
    const c = await setup({ draftYield: [30, 'bignè'] });
    for (const [f, v, msg] of [['qty', '0', /maggiore di zero/], ['qty', 'abc', /maggiore di zero/], ['qty', '-2', /maggiore di zero/], ['unit', 'oz', /Unità non supportata/], ['unit', 'x'.repeat(41), /troppo lunga/]]) {
      c.onLabDeclaredYield('rB', f, v);
      assert.ok(msg.test(text(panel(c))), v);
      c.discardLabDeclaredYieldInput('rB');
    }
    assert.deepStrictEqual([lab(c).declaredYieldQty, lab(c).declaredYieldUnit], [30, 'bignè']);
    assert.deepStrictEqual(c.log.autosaves, []);
    c.onLabDeclaredYield('rB', 'qty', '0');
    assert.ok(panel(c).includes('value="0"'), 'il campo mostra quanto inserito');
    c.discardLabDeclaredYieldInput('rB');
    assert.ok(panel(c).includes('value="30"'));
  });

  await test('U6. resa storica non valida: mostrata com\'e\' con avviso, mai corretta; vuotare i campi = resa non dichiarata', async () => {
    const c = await setup({ draftYield: [0, 'pz'] });
    const h = panel(c);
    assert.ok(/La resa salvata non è valida/.test(text(h)));
    assert.ok(h.includes('value="0"') && h.includes('value="pz"'));
    assert.deepStrictEqual(box(h, 'lab-w-raw-unit')[1], '—');
    assert.strictEqual(await save(c), true);
    assert.deepStrictEqual([dbVariant(fake, 'lvB').declared_yield_qty, dbVariant(fake, 'lvB').declared_yield_unit], [0, 'pz'], 'non corretta');
    c.onLabDeclaredYield('rB', 'qty', ''); c.onLabDeclaredYield('rB', 'unit', '');
    assert.deepStrictEqual([lab(c).declaredYieldQty, lab(c).declaredYieldUnit], [null, null]);
  });

  await test('U7. conversione mancante: stato incompleto, nessun totale; peso di riferimento segnalato; mai somme di unita\' diverse', async () => {
    const c = await setup({ draftYield: [30, 'bignè'] });
    lab(c).ingredients.push({ id: 'p1', name: 'Panna', qty: 200, unit: 'ml', estimatedYieldPct: null });
    let h = panel(c);
    assert.deepStrictEqual([box(h, 'lab-w-raw')[1], box(h, 'lab-w-finished')[1], box(h, 'lab-w-raw-unit')[1]], ['—', '—', '—']);
    assert.ok(/manca la conversione in grammi per Panna \(ml\)/.test(text(h)));
    lab(c).ingredients.pop();
    const c2 = makeClient(clientFetch, { uova: 55 }); await c2.loadFromSupabase();
    lab(c2).ingredients.push({ id: 'u1', name: 'Uova', qty: 2, unit: 'n', estimatedYieldPct: null });
    h = c2.renderLabWeightsPanel(rec(c2), lab(c2));
    assert.deepStrictEqual(box(h, 'lab-w-raw'), ['Peso a crudo totale (stima)', '1010 g'], '900 + 2 x 55 (kg convertiti, non sommati come g)');
    assert.deepStrictEqual(box(h, 'lab-w-finished'), ['Peso finito teorico (stima)', '740 g']);
    assert.deepStrictEqual(box(h, 'lab-w-finished-unit'), ['Finito per bignè (stima)', '24,67 g']);
    assert.ok(/Stima: usa pesi medi non confermati per Uova\./.test(text(h)));
    // con pesi tutti confermati (o solo g/kg) nessuna indicazione di stima
    const hOk = panel(c);
    assert.ok(!/stima/i.test(text(hOk)), 'nessuna stima senza pesi di riferimento');
    // stato incompleto: nessuna stima mostrata sui valori assenti
    lab(c2).ingredients.push({ id: 'p2', name: 'Panna', qty: 1, unit: 'ml', estimatedYieldPct: null });
    assert.ok(!/stima/i.test(text(c2.renderLabWeightsPanel(rec(c2), lab(c2)))));
  });

  await test('U8. quantita\' positive molto piccole mai mostrate come zero', async () => {
    const c = await setup();
    lab(c).ingredients = [{ id: 's1', name: 'Zafferano', qty: 0.002, unit: 'g', estimatedYieldPct: null }];
    c.onLabDeclaredYield('rB', 'qty', '1000'); c.onLabDeclaredYield('rB', 'unit', 'pz');
    const h = panel(c);
    assert.deepStrictEqual([box(h, 'lab-w-raw')[1], box(h, 'lab-w-raw-unit')[1]], ['0,002 g', '0,000002 g']);
  });

  await test('U9. salvataggio, rilettura e riapertura: valori identici; il campo non perde precisione aprendo e salvando', async () => {
    const c = await setup({ draftYield: ['0.333333333333333333', 'teglie'] });
    assert.ok(panel(c).includes('value="0.333333333333333333"'), 'il campo mostra il valore completo');
    c.onLabDeclaredYield('rB', 'qty', '0.333333333333333333');
    c.onLabDeclaredYield('rB', 'unit', 'teglie');
    assert.deepStrictEqual(c.log.autosaves, [], 'riconfermare lo stesso valore non salva');
    c.onLabDeclaredYield('rB', 'unit', 'teglie grandi');
    assert.deepStrictEqual([lab(c).declaredYieldQty, lab(c).declaredYieldUnit], ['0.333333333333333333', 'teglie grandi'], 'quantita\' non toccata: valore grezzo');
    assert.strictEqual(await save(c), true);
    assert.deepStrictEqual([dbVariant(fake, 'lvB').declared_yield_qty, dbVariant(fake, 'lvB').declared_yield_unit], ['0.333333333333333333', 'teglie grandi']);
    for (let k = 0; k < 3; k++) { const cc = makeClient(clientFetch); await cc.loadFromSupabase(); assert.strictEqual(await cc.saveToSupabase(rec(cc)), true); }
    const c2 = makeClient(clientFetch); await c2.loadFromSupabase();
    assert.deepStrictEqual([lab(c2).declaredYieldQty, lab(c2).declaredYieldUnit], ['0.333333333333333333', 'teglie grandi']);
    assert.ok(c2.renderLabWeightsPanel(rec(c2), lab(c2)).includes('value="0.333333333333333333"'));
    assert.deepStrictEqual(ingContent(fake, 'lvB'), [['Farina', 500, 'g', 70], ['Burro', 0.25, 'kg', 70], ['Zucchero', 150, 'g', 70]]);
  });

  await test('U10. resa e Obiettivo di Produzione indipendenti; Ricetta Attiva e Sessioni intatte, nessun reinvio', async () => {
    const c = await setup();
    const before = { v: dbVariant(fake, 'vaB'), i: ingContent(fake, 'vaB'), s: clone(fake.tables.production_sessions) };
    c.onLabDeclaredYield('rB', 'qty', '32'); c.onLabDeclaredYield('rB', 'unit', 'bignè');
    c.onLabTargetPortions('rB', '50');
    // grams_per_portion 0 viene riletto 200 (valore predefinito del caricamento, FIX 2C): invariato da I5
    assert.deepStrictEqual([lab(c).declaredYieldQty, lab(c).portionsCount, lab(c).gramsPerPortion], [32, 50, 200]);
    assert.strictEqual(await save(c), true);
    assert.deepStrictEqual(saves[0].variants.map(v => v.id), ['lvB']);
    assert.deepStrictEqual({ v: dbVariant(fake, 'vaB'), i: ingContent(fake, 'vaB'), s: clone(fake.tables.production_sessions) }, before);
    const att = rec(c).validatedVariants[0];
    assert.strictEqual(c.buildValidatedVariantPayload('rB', att).sig, c.getSig('vaB'));
    assert.deepStrictEqual(box(panel(c), 'lab-w-finished')[1], '630 g', 'il finito teorico non e\' l\'obiettivo (50 x 200)');
  });

  await test('U11. il salvataggio parte anche se contenuto_hash non include la resa', async () => {
    const c = await setup({ draftYield: [30, 'bignè'] });
    const hashBefore = (() => { const s = new Function('v', extractFunction('function firmaContenutoBozza(v)') + ';return firmaContenutoBozza(v);'); return s(lab(c)); })();
    c.onLabDeclaredYield('rB', 'qty', '32');
    const hashAfter = new Function('v', extractFunction('function firmaContenutoBozza(v)') + ';return firmaContenutoBozza(v);')(lab(c));
    assert.strictEqual(hashAfter, hashBefore, 'contenuto_hash invariato (non include la resa)');
    assert.deepStrictEqual(c.log.autosaves, ['rB']);
    assert.strictEqual(await save(c), true);
    assert.strictEqual(dbVariant(fake, 'lvB').declared_yield_qty, 32);
  });

  await test('U12. vista LAB: pannello al posto della vecchia "Stima peso finito", % ingredienti dai grammi, nessuna somma di unita\' diverse', async () => {
    const lab = extractFunction('function renderLabRecipe(recipe)');
    assert.ok(lab.includes('${renderLabWeightsPanel(recipe,v,pesiLab)}'));
    assert.ok(!/Stima peso finito/.test(lab));
    assert.ok(!/reduce\(\(s,i\)=>s\+cnum\(i\.qty\)/.test(lab), 'nessuna somma diretta delle quantita\'');
    assert.ok(lab.includes("pesiLab.byId[ing.id].rawGrams/pesiLab.raw*100"));
    assert.ok(/id="lab-production-target"/.test(lab), 'Obiettivo di Produzione separato e invariato');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
