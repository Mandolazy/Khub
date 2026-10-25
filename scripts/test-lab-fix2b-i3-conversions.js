/*
 * Test — LAB FIX 2B / I3: conversioni reversibili nel LAB.
 * Il cambio unita' di un ingrediente converte sempre la quantita' (mai la
 * sola etichetta), senza arrotondamenti e senza fattori generici: equivalenze
 * metriche esatte oppure fattori dell'ingrediente confermati dallo chef. Un
 * fattore mancante viene chiesto, salvato e riusato in entrambi i versi; i
 * pesi di riferimento sono solo proposti. Nessuna deriva: si riparte dal
 * valore originale. Motore di Produzione invariato.
 *
 * Codice REALE estratto da khub_mvp.html; api/chat.js reale contro un finto
 * PostgREST in memoria (stessa tecnica di test-lab-protect-active.js). Solo
 * dati sintetici, nessuna rete, nessun Supabase reale.
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
const withinUlps = (a, b) => Math.abs(a - b) <= 4 * Number.EPSILON * Math.abs(b);

function seed(fake) {
  const steps = [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: null }];
  const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null, steps: JSON.stringify(['Impastare']), steps_v2: steps };
  fake.tables.recipes = [{ id: 'rT', name: 'Crema TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' }];
  fake.tables.variants = [
    { ...base, id: 'vaT', recipe_id: 'rT', name: 'Classica', label: 'Classica', note: 'attiva', status: 'validated', active: true, portions_count: 10, grams_per_portion: 80, validated_at: '2026-10-01T09:30:17.250Z', origin_variant_id: null, created_at: '2026-10-01T00:00:00Z' },
    { ...base, id: 'lvT', recipe_id: 'rT', name: 'Bozza', label: 'Bozza 1', note: 'bozza', status: 'lab', active: false, portions_count: 10, grams_per_portion: 80, origin_variant_id: 'vaT', created_at: '2026-10-02T00:00:00Z' },
  ];
  const ing = (id, v, name, qty, unit, ord) => ({ id, variant_id: v, name, qty, unit, sort_order: ord, estimated_yield_pct: null, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
  fake.tables.ingredients = [
    ing('iA1', 'vaT', 'Uova', 3, 'n', 0), ing('iA2', 'vaT', 'Latte', 250, 'ml', 1),
    ing('iU', 'lvT', 'Uova', 3, 'n', 0), ing('iF', 'lvT', 'Uova fresche', 7, 'n', 1), ing('iL', 'lvT', 'Latte', 250, 'ml', 2),
    ing('iP', 'lvT', 'Panna', 200, 'ml', 3), ing('iZ', 'lvT', 'Zucchero', 2, 'tbsp', 4), ing('iV', 'lvT', 'Lievito', 3, 'g', 5),
    ing('iS', 'lvT', 'Sale', 1, 'tsp', 6), ing('iT', 'lvT', 'Tuorli', 4, 'n', 7),
  ];
  // Fact gia' confermate (DB) + un peso di riferimento salvato come reference_data
  fake.tables.ingredient_conversions = [
    { id: 'icF', ingredient_name: 'uova fresche', from_unit: 'n', to_unit: 'g', factor: 55.37, source_type: 'chef_confirmed', source_detail: null, confirmed_at: '2026-10-01T10:00:00Z' },
    { id: 'icL', ingredient_name: 'latte', from_unit: 'ml', to_unit: 'g', factor: 1.03, source_type: 'chef_confirmed', source_detail: null, confirmed_at: '2026-10-01T10:00:00Z' },
    { id: 'icT', ingredient_name: 'tuorli', from_unit: 'n', to_unit: 'g', factor: 18, source_type: 'reference_data', source_detail: 'tabella', confirmed_at: '2026-10-01T10:00:00Z' },
  ];
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = [];
}
const dbVariant = (fake, id) => clone(fake.tables.variants.find(v => v.id === id));
const dbIngs = (fake, id) => clone(fake.tables.ingredients.filter(i => i.variant_id === id).sort((a, b) => a.sort_order - b.sort_order));

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
  'function R(id)', 'function curLab(recipe)', 'function cnum(n)', 'function upRec(id,fn)', 'function upLab(id,fn)', 'function escAttr(s)',
  'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)',
  'function resolveSessionScalingConversionToGrams(unit,conversionFact)', 'function chooseConversionAskUnit(unit)',
  'function resolveKnownProductionConversionFact(normalizedName,unit)', 'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)',
  'function computeSessionScaling(input)', 'function findMissingProductionConversions(preparedInput)',
  'function parseLocaleNumber(value)', 'function ingredientGramsPerUnit(unit,ingredientName,resolver)',
  'function convertIngredientQty(qty,fromUnit,toUnit,ingredientName,resolveFact)', 'async function saveIngredientConversion(ingredientName,fromUnit,toUnit,factor,sourceType,sourceDetail)',
  'function onIngQty(recipeId,ingId,val)', 'function labUnitAnchorKey(recipeId,labVersionId,ingId)',
  'function resolveConfirmedLabConversionFact(normalizedName,unit)', 'function referenceConversionProposal(normalizedName,unit)',
  'function computeLabUnitConversion(ing,toUnit,anchor,resolveFact)', 'function onIngUnit(recipeId,ingId,val)',
  'async function confirmLabConversion(rawValue)',
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)', 'function formatQtyDisplay(value)', 'function cancelLabConversion()',
  'function labConversionQuestion(p)', 'function renderLabConversionModal()',
  // load / save reali
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)',
  'function isBetterConversionFact(candidate,current)', 'function buildKnownIngredientIds(ingredientRows)',
  'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  // LAB FIX 2B I4: resa dichiarata (caricamento, salvataggio, copie)
  'function targetFromDb(value)', 'function targetForDb(value)', 'function declaredYieldFromRow(row)', 'function copyDeclaredYield(src)', 'function declaredYieldPayload(v)', 'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g), [html.match(/const UNITS = \[[^\]]*\];/)[0]]).join('\n');

function makeClient(fetchImpl) {
  const log = { renders: 0, autosaves: [], toasts: [] };
  const c = new Function('fetch', 'log', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},
      unitWeights:{'uova':55,'tuorli':18},unitWeightFacts:{},productionConversionFacts:{},
      pendingLabConversion:null,labUnitAnchors:{}};
    var _knownIngredientIdsByVariant={};
    var _persistedValidatedSig={};
    function render(){log.renders++;}
    function autosave(id){log.autosaves.push(id);}
    function toast(msg,icon){log.toasts.push(msg);render();}
    ${SRC}
    return {S, loadFromSupabase, saveToSupabase, onIngUnit, onIngQty, confirmLabConversion, cancelLabConversion, renderLabConversionModal,
      resolveKnownProductionConversionFact, computeLabUnitConversion};
  `)(fetchImpl, log);
  c.log = log;
  return c;
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let convPosts = 0, failConvPosts = false;
  async function callApi(body) {
    let status = 200, out;
    if (body.supabaseAction === 'saveConversion') { convPosts++; if (failConvPosts) return { status: 500, body: { error: 'boom' } }; }
    await realHandler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { status, body: out };
  }
  const clientFetch = async (url, opts) => { const r = await callApi(JSON.parse(opts.body)); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  let fake;
  const setup = async () => {
    fake = makeFakeSupabase(); seed(fake); globalThis.fetch = fake.fetch; convPosts = 0; failConvPosts = false;
    const client = makeClient(clientFetch);
    await client.loadFromSupabase();
    return client;
  };
  const lab = c => c.S.recipes.find(r => r.id === 'rT').labVersions[0];
  const ingOf = (c, name) => lab(c).ingredients.find(i => i.name === name);
  const unit = async (c, name, to) => c.onIngUnit('rT', ingOf(c, name).id, to);

  console.log('LAB FIX 2B — I3: conversioni reversibili nel LAB');

  await test('T1. 3 uova <-> 165 g con 55 g per uovo: il peso di riferimento e\' solo proposto, poi confermato, salvato e riusato al ritorno', async () => {
    const c = await setup();
    await unit(c, 'Uova', 'g');
    const p = c.S.pendingLabConversion;
    assert.ok(p, 'richiesta di conferma'); assert.strictEqual(p.askUnit, 'n');
    assert.strictEqual(p.value, '55'); assert.strictEqual(p.isReference, true);
    assert.deepStrictEqual([ingOf(c, 'Uova').qty, ingOf(c, 'Uova').unit], [3, 'n'], 'nulla cambia prima della conferma');
    assert.ok(/Valore di riferimento indicativo/.test(c.renderLabConversionModal()));
    assert.ok(c.renderLabConversionModal().includes('Questo valore medio sarà utilizzato anche nelle altre ricette che contengono lo stesso ingrediente.'), 'avviso di condivisione tra ricette');
    await c.confirmLabConversion('55');
    assert.deepStrictEqual([ingOf(c, 'Uova').qty, ingOf(c, 'Uova').unit], [165, 'g']);
    const row = fake.tables.ingredient_conversions.find(r => r.ingredient_name === 'uova');
    assert.deepStrictEqual([row.from_unit, row.to_unit, row.factor, row.source_type], ['n', 'g', 55, 'chef_confirmed']);
    await unit(c, 'Uova', 'n');
    assert.strictEqual(c.S.pendingLabConversion, null, 'il verso inverso non chiede di nuovo');
    assert.deepStrictEqual([ingOf(c, 'Uova').qty, ingOf(c, 'Uova').unit], [3, 'n']);
    assert.strictEqual(convPosts, 1);
  });

  await test('T2. 7 uova <-> grammi con 55,37 g per uovo (fact confermata): nessuna richiesta, ritorno esatto', async () => {
    const c = await setup();
    await unit(c, 'Uova fresche', 'g');
    assert.strictEqual(c.S.pendingLabConversion, null);
    assert.strictEqual(ingOf(c, 'Uova fresche').qty, 7 * 55.37);
    await unit(c, 'Uova fresche', 'kg');
    assert.strictEqual(ingOf(c, 'Uova fresche').qty, 7 * 55.37 / 1000);
    await unit(c, 'Uova fresche', 'n');
    assert.ok(Object.is(ingOf(c, 'Uova fresche').qty, 7), 'ritorno esatto al valore originale');
    assert.strictEqual(convPosts, 0);
  });

  await test('T3. conversione mancante: richiesta di conferma; annullare non cambia nulla; mai la sola etichetta', async () => {
    const c = await setup();
    const before = clone(lab(c).ingredients);
    await unit(c, 'Panna', 'g');
    assert.deepStrictEqual({ ask: c.S.pendingLabConversion.askUnit, v: c.S.pendingLabConversion.value, ref: c.S.pendingLabConversion.isReference }, { ask: 'ml', v: '', ref: false });
    c.cancelLabConversion();
    assert.strictEqual(c.S.pendingLabConversion, null);
    assert.deepStrictEqual(lab(c).ingredients, before);
    assert.strictEqual(convPosts, 0);
    assert.deepStrictEqual(c.log.autosaves, []);
  });

  await test('T4. fattore non valido rifiutato senza salvare; errore di salvataggio: nessuna conversione', async () => {
    const c = await setup();
    const before = clone(lab(c).ingredients);
    await unit(c, 'Panna', 'g');
    for (const bad of ['0', '-1', 'abc', '', 'Infinity']) {
      await c.confirmLabConversion(bad);
      assert.ok(/peso valido/.test(c.S.pendingLabConversion.error), bad);
    }
    assert.strictEqual(convPosts, 0);
    failConvPosts = true;
    await c.confirmLabConversion('1,01');
    assert.ok(/Errore nel salvataggio/.test(c.S.pendingLabConversion.error));
    assert.deepStrictEqual(lab(c).ingredients, before);
    assert.strictEqual(c.resolveKnownProductionConversionFact('panna', 'ml'), null);
  });

  await test('T5. latte ml <-> g solo con il fattore noto (1,03); panna dopo conferma (1,01) riusata anche per l', async () => {
    const c = await setup();
    await unit(c, 'Latte', 'g');
    assert.strictEqual(c.S.pendingLabConversion, null);
    assert.strictEqual(ingOf(c, 'Latte').qty, 250 * 1.03);
    await unit(c, 'Latte', 'l');
    assert.strictEqual(ingOf(c, 'Latte').qty, 0.25);
    await unit(c, 'Latte', 'ml');
    assert.ok(Object.is(ingOf(c, 'Latte').qty, 250));
    await unit(c, 'Panna', 'g');
    await c.confirmLabConversion('1,01');
    assert.strictEqual(ingOf(c, 'Panna').qty, 200 * 1.01);
    await unit(c, 'Panna', 'l');
    assert.strictEqual(c.S.pendingLabConversion, null, 'l usa il fattore ml confermato');
    assert.ok(withinUlps(ingOf(c, 'Panna').qty, 0.2));
  });

  await test('T6. cucchiai <-> grammi senza valori generici: fattore chiesto (mai 15 o 5), poi riusato', async () => {
    const c = await setup();
    await unit(c, 'Zucchero', 'g');
    assert.strictEqual(c.S.pendingLabConversion.askUnit, 'tbsp');
    assert.strictEqual(c.S.pendingLabConversion.value, '', 'nessuna proposta generica');
    assert.ok(/cucchiaio \(tbsp\)/.test(c.renderLabConversionModal()));
    assert.ok(c.renderLabConversionModal().includes('Questo valore medio sarà utilizzato anche nelle altre ricette che contengono lo stesso ingrediente.'), 'avviso anche senza proposta di riferimento');
    assert.deepStrictEqual([ingOf(c, 'Zucchero').qty, ingOf(c, 'Zucchero').unit], [2, 'tbsp'], 'mai 30 g (15 g generici)');
    await c.confirmLabConversion('12,5');
    assert.deepStrictEqual([ingOf(c, 'Zucchero').qty, ingOf(c, 'Zucchero').unit], [25, 'g']);
    await unit(c, 'Zucchero', 'tbsp');
    assert.deepStrictEqual([ingOf(c, 'Zucchero').qty, ingOf(c, 'Zucchero').unit], [2, 'tbsp']);
    // cucchiaino -> ml: servono entrambi i fattori, chiesti uno alla volta
    await unit(c, 'Sale', 'ml');
    assert.strictEqual(c.S.pendingLabConversion.askUnit, 'tsp');
    await c.confirmLabConversion('6');
    assert.strictEqual(c.S.pendingLabConversion.askUnit, 'ml');
    await c.confirmLabConversion('1,2');
    assert.deepStrictEqual([ingOf(c, 'Sale').qty, ingOf(c, 'Sale').unit], [6 / 1.2, 'ml']);
  });

  await test('T7. 3 g <-> kg senza perdita e senza fattori', async () => {
    const c = await setup();
    await unit(c, 'Lievito', 'kg');
    assert.strictEqual(ingOf(c, 'Lievito').qty, 0.003);
    await unit(c, 'Lievito', 'g');
    assert.ok(Object.is(ingOf(c, 'Lievito').qty, 3));
    assert.strictEqual(convPosts, 0);
  });

  await test('T8. 1000 conversioni ripetute: nessuna deriva (valore originale preservato)', async () => {
    const c = await setup();
    for (let k = 0; k < 250; k++) { await unit(c, 'Uova fresche', 'g'); await unit(c, 'Uova fresche', 'kg'); await unit(c, 'Uova fresche', 'g'); await unit(c, 'Uova fresche', 'n'); }
    assert.ok(Object.is(ingOf(c, 'Uova fresche').qty, 7));
    for (let k = 0; k < 500; k++) { await unit(c, 'Latte', 'g'); await unit(c, 'Latte', 'ml'); }
    assert.ok(Object.is(ingOf(c, 'Latte').qty, 250));
    // senza ancora (es. dopo una rilettura) lo scarto resta entro 4 ulp
    let q = 7;
    const conv = c.computeLabUnitConversion;
    for (let k = 0; k < 1000; k++) { q = conv({ name: 'Uova fresche', qty: conv({ name: 'Uova fresche', qty: q, unit: 'n' }, 'g', null).qty, unit: 'g' }, 'n', null).qty; }
    assert.ok(withinUlps(q, 7), String(q));
  });

  await test('T9. una modifica manuale della quantita\' diventa il nuovo valore originale', async () => {
    const c = await setup();
    await unit(c, 'Uova fresche', 'g');
    c.onIngQty('rT', ingOf(c, 'Uova fresche').id, '400');
    await unit(c, 'Uova fresche', 'n');
    assert.strictEqual(ingOf(c, 'Uova fresche').qty, 400 / 55.37);
    await unit(c, 'Uova fresche', 'g');
    assert.ok(Object.is(ingOf(c, 'Uova fresche').qty, 400));
  });

  await test('T10. peso di riferimento salvato come reference_data: proposto, mai applicato senza conferma', async () => {
    const c = await setup();
    await unit(c, 'Tuorli', 'g');
    assert.deepStrictEqual({ v: c.S.pendingLabConversion.value, ref: c.S.pendingLabConversion.isReference }, { v: '18', ref: true });
    assert.deepStrictEqual([ingOf(c, 'Tuorli').qty, ingOf(c, 'Tuorli').unit], [4, 'n']);
    await c.confirmLabConversion('17,5');
    assert.deepStrictEqual([ingOf(c, 'Tuorli').qty, ingOf(c, 'Tuorli').unit], [70, 'g']);
    assert.strictEqual(c.resolveKnownProductionConversionFact('tuorli', 'n').sourceType, 'chef_confirmed', 'il dato confermato vale anche per Produzione');
  });

  await test('T11. unita\' sconosciuta o quantita\' negativa: rifiuto senza modifiche', async () => {
    const c = await setup();
    const before = clone(lab(c).ingredients);
    await unit(c, 'Lievito', 'cup');
    lab(c).ingredients.find(i => i.name === 'Lievito').qty = -1;
    await unit(c, 'Lievito', 'kg');
    lab(c).ingredients.find(i => i.name === 'Lievito').qty = 3;
    assert.deepStrictEqual(lab(c).ingredients, before);
    assert.strictEqual(c.log.toasts.length, 2);
    assert.deepStrictEqual(c.log.autosaves, []);
  });

  await test('T12. salvataggio e rilettura: quantita\' a precisione piena, fattori riusati dopo la rilettura, Ricetta Attiva intatta', async () => {
    const c = await setup();
    const activeBefore = { v: dbVariant(fake, 'vaT'), i: dbIngs(fake, 'vaT') };
    await unit(c, 'Uova', 'g'); await c.confirmLabConversion('55');
    await unit(c, 'Uova fresche', 'g'); await unit(c, 'Latte', 'g'); await unit(c, 'Lievito', 'kg');
    await unit(c, 'Zucchero', 'g'); await c.confirmLabConversion('12,5');
    const expected = lab(c).ingredients.map(i => [i.name, i.qty, i.unit]);
    assert.strictEqual(await c.saveToSupabase(c.S.recipes.find(r => r.id === 'rT')), true);
    const rows = dbIngs(fake, 'lvT').map(i => [i.name, i.qty, i.unit]);
    assert.deepStrictEqual(rows, expected);
    assert.deepStrictEqual(rows.find(r => r[0] === 'Uova fresche'), ['Uova fresche', 7 * 55.37, 'g'], 'nessun arrotondamento salvato');
    assert.deepStrictEqual({ v: dbVariant(fake, 'vaT'), i: dbIngs(fake, 'vaT') }, activeBefore);
    const c2 = makeClient(clientFetch); await c2.loadFromSupabase();
    assert.deepStrictEqual(lab(c2).ingredients.map(i => [i.name, i.qty, i.unit]), expected);
    for (const [n, u] of [['Uova', 'n'], ['Uova fresche', 'n'], ['Latte', 'ml'], ['Zucchero', 'tbsp'], ['Lievito', 'g']]) {
      await unit(c2, n, u);
      assert.strictEqual(c2.S.pendingLabConversion, null, n + ': fattore riusato dopo la rilettura');
    }
    assert.deepStrictEqual(lab(c2).ingredients.filter(i => ['Uova', 'Zucchero', 'Lievito'].includes(i.name)).map(i => i.qty), [3, 2, 3]);
    assert.ok(withinUlps(ingOf(c2, 'Uova fresche').qty, 7) && withinUlps(ingOf(c2, 'Latte').qty, 250));
  });

  await test('T13. motore di Produzione e flussi condivisi invariati (impronte identiche a main d6afca7)', async () => {
    const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
    const expect = {
      'function sessionScalingUnitFamily(unit)': '2df3b3a7184b7e88', 'function sessionScalingGenericFamilyTable(family)': '61079e89f7ddc6d6',
      'function resolveSessionScalingConversionToGrams(unit,conversionFact)': '91673d43a7c3bd35', 'function computeSessionScaling(input)': 'ddfc1febb5010cdc',
      'function chooseConversionAskUnit(unit)': 'ed754d663dbc6ebf', 'function resolveKnownProductionConversionFact(normalizedName,unit)': '5b0be8c06a5e4919',
      'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)': '9df6758db87b12b1',
      'function findMissingProductionConversions(preparedInput)': 'ad0ecd9f8e506dce', 'async function confirmConversionPreflightStep(rawValue)': '680244a1d503acb7',
      // LAB FIX 2C (C4): computeRecipeWeightSummary usa di proposito computeFormulationWeights
      // (pesi senza obiettivo salvato); la parita' con la versione precedente e' verificata
      // in test-lab-fix2c-c4-weight-summary.js. Impronta aggiornata solo per questa funzione.
      'function computeRecipeWeightSummary(recipe,vv)': 'beac67cc93eee93b',
      'async function saveIngredientConversion(ingredientName,fromUnit,toUnit,factor,sourceType,sourceDetail)': 'e3916db5353173da',
      'function onVarIngUnit(recipeId,varId,ingId,val)': 'bd2537533a1563d7',
      // Conversioni per nomi equivalenti (approvato): loadFromSupabase usa selectConversionFacts e
      // confirmConversionPreflightStep salva il marcatore di gruppo; impronte aggiornate solo per queste due funzioni.
      'async function loadFromSupabase()': '978ff5e7d1c09e7b', 'async function saveToSupabase(recipe)': '42a1765ea7f27644',
    };
    // LAB FIX 2B I4 aggiunge a load/save SOLO righe della resa dichiarata:
    // tolte quelle righe, le due funzioni sono identiche a main.
    // LAB FIX 2C (C1) modifica di proposito caricamento e salvataggio (obiettivo di
    // Produzione senza 4/200): applicando l'inverso ESATTO di quelle modifiche le
    // due funzioni tornano identiche a main, quindi C1 non ha cambiato altro.
    const undoC1 = code => code
      .split('\n').filter(l => !/LAB FIX 2C \(C1\): obiettivo di Produzione letto dal DB|mai sostituito con 4\/200; 0 = non impostato\./.test(l)).join('\n')
      .replace('portionsCount:targetFromDb(v.portions_count),', 'portionsCount:v.portions_count||4,')
      .replace('gramsPerPortion:targetFromDb(v.grams_per_portion), //', 'gramsPerPortion:v.grams_per_portion||200, //')
      .replace('portionSize:targetFromDb(v.grams_per_portion),      //', 'portionSize:v.grams_per_portion||200,      //')
      .replace('portionsCount:targetFromDb(v.portions_count),', 'portionsCount:v.portions_count||4,')
      .replace('gramsPerPortion:targetFromDb(v.grams_per_portion), //', 'gramsPerPortion:v.grams_per_portion||200, //')
      .replace('portionSize:targetFromDb(v.grams_per_portion),      //', 'portionSize:v.grams_per_portion||200,      //')
      .replace('portions_count:targetForDb(v.portionsCount),grams_per_portion:targetForDb(v.gramsPerPortion),', 'portions_count:v.portionsCount,grams_per_portion:v.gramsPerPortion,');
    const withoutI4 = (m, code) => /loadFromSupabase|saveToSupabase/.test(m) ? undoC1(code).split('\n').filter(l => !/declaredYield/.test(l)).join('\n') : code;
    for (const [m, h] of Object.entries(expect)) assert.strictEqual(sha(withoutI4(m, extractFunction(m))), h, 'cambiato: ' + m);
  });

  await test('T14. vista LAB: il menu delle unita\' usa onIngUnit; nessun fattore generico o arrotondamento nel nuovo codice', async () => {
    assert.ok(html.includes(`onchange="onIngUnit('\${recipe.id}','\${ing.id}',this.value)"`));
    const code = ['function computeLabUnitConversion(ing,toUnit,anchor,resolveFact)', 'function onIngUnit(recipeId,ingId,val)', 'async function confirmLabConversion(rawValue)',
      'function resolveConfirmedLabConversionFact(normalizedName,unit)', 'function referenceConversionProposal(normalizedName,unit)'].map(extractFunction).join('\n');
    assert.ok(!/Math\.round|toFixed|toPrecision|convertQty|sameGroup|UNIT_TO_BASE/.test(code));
    assert.ok(html.includes('renderUnitConversionModal()+renderLabConversionModal()+'));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
