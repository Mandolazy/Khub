/*
 * Test — LAB FIX 2B / I2: Obiettivo di Produzione nel LAB.
 * Porzioni e G/porzione della bozza sono solo l'obiettivo di Produzione:
 * cambiarli non modifica MAI gli ingredienti (nessuno scaling, nessun
 * arrotondamento, nessuna deriva), i valori non validi vengono rifiutati
 * senza modificare nulla, e salvataggio + rilettura restituiscono le
 * stesse quantita'.
 *
 * Codice REALE: gestori estratti da khub_mvp.html; per salvataggio e
 * rilettura, handler di api/chat.js contro un finto PostgREST in memoria
 * (stessa tecnica di test-lab-protect-active.js). Solo dati sintetici,
 * nessuna rete, nessun Supabase reale.
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
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

// Quantita' "scomode" volute: residui binari, frazioni periodiche, valori
// minimi, interi grandi. Nessuna deve cambiare di un bit.
const QTYS = [500, 0.30000000000000004, 1 / 3, 0.0000001, 123456.789012345, 12.5];

function seed(fake) {
  const steps = [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: null }];
  const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null, steps: JSON.stringify(['Impastare']), steps_v2: steps };
  fake.tables.recipes = [{ id: 'rT', name: 'Frolla TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' }];
  fake.tables.variants = [
    { ...base, id: 'vaT', recipe_id: 'rT', name: 'Classica', label: 'Classica', note: 'attiva', status: 'validated', active: true, portions_count: 10, grams_per_portion: 80, validated_at: '2026-10-01T09:30:17.250Z', origin_variant_id: null, created_at: '2026-10-01T00:00:00Z' },
    { ...base, id: 'lvT', recipe_id: 'rT', name: 'Bozza', label: 'Bozza 1', note: 'bozza', status: 'lab', active: false, portions_count: 10, grams_per_portion: 80, origin_variant_id: 'vaT', created_at: '2026-10-02T00:00:00Z' },
  ];
  const ing = (id, v, name, qty, ord, unit = 'g', y = null) => ({ id, variant_id: v, name, qty, unit, sort_order: ord, estimated_yield_pct: y, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
  fake.tables.ingredients = [
    ing('iA1', 'vaT', 'Farina', 500, 0), ing('iA2', 'vaT', 'Burro', 0.25, 1, 'kg', 70),
    ...QTYS.map((q, k) => ing('iB' + k, 'lvT', 'Ingrediente ' + k, q, k, k === 3 ? 'kg' : 'g', k === 1 ? 70 : null)),
  ];
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = []; fake.tables.ingredient_conversions = [];
}
const dbVariant = (fake, id) => clone(fake.tables.variants.find(v => v.id === id));
const dbIngs = (fake, id) => clone(fake.tables.ingredients.filter(i => i.variant_id === id).sort((a, b) => a.sort_order - b.sort_order));
// Contenuto di un ingrediente senza l'id: il salvataggio esistente della
// bozza rigenera gli id delle righe (comportamento invariato da I2).
const noId = rows => rows.map(({ id, ...rest }) => rest);
const ORDER = ['variant_id', 'name', 'qty', 'unit', 'sort_order', 'estimated_yield_pct', 'measured_yield_pct', 'is_sub_recipe', 'sub_recipe_id'];
const dbContent = (fake, id) => noId(dbIngs(fake, id)).map(r => Object.fromEntries(ORDER.map(k => [k, r[k]])));

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
const TARGET_SRC = [
  'function R(id)', 'function curLab(recipe)', 'function cnum(n)', 'function upRec(id,fn)', 'function upLab(id,fn)',
  'function parseLocaleNumber(value)', 'function formatQtyDisplay(value)',
  'function validateLabProductionTarget(field,value)', 'function setLabProductionTarget(recipeId,field,rawValue)',
  'function onLabTargetPortions(recipeId,val)', 'function onLabTargetGpp(recipeId,val)',
].map(extractFunction).concat([html.match(/var LAB_TARGET_PORTIONS_MAX=\d+;/)[0]]).join('\n');
const CLIENT_SRC = [
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)',
  'function isBetterConversionFact(candidate,current)', 'function buildKnownIngredientIds(ingredientRows)',
  'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()',
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)', 'function escAttr(s)', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  // LAB FIX 2B I4: resa dichiarata (caricamento, salvataggio, copie)
  'function targetFromDb(value)', 'function targetForDb(value)', 'function declaredYieldFromRow(row)', 'function copyDeclaredYield(src)', 'function declaredYieldPayload(v)', 'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).join('\n');

// Client KHUB isolato: gestori reali + load/save reali. render, autosave e
// toast sono sostituiti da registratori (nessun DOM, nessun timer).
function makeClient(fetchImpl) {
  const log = { renders: 0, autosaves: [], toasts: [] };
  const factory = new Function('fetch', 'log', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{}};
    var _knownIngredientIdsByVariant={};
    var _persistedValidatedSig={};
    function render(){log.renders++;}
    function autosave(id){log.autosaves.push(id);}
    function toast(msg,icon){log.toasts.push(msg);render();}
    ${TARGET_SRC}
    ${CLIENT_SRC}
    return {S, loadFromSupabase, saveToSupabase, onLabTargetPortions, onLabTargetGpp, validateLabProductionTarget};
  `);
  const c = factory(fetchImpl, log);
  c.log = log;
  return c;
}

// Stato sintetico in memoria (senza load) per i test dei gestori.
function memClient() {
  const c = makeClient(async () => { throw new Error('nessuna rete nei test in memoria'); });
  const ings = (pfx) => QTYS.map((q, k) => ({ id: pfx + k, name: 'Ingrediente ' + k, qty: q, unit: k === 3 ? 'kg' : 'g', estimatedYieldPct: k === 1 ? 70 : null, measuredYieldPct: null, isSubRecipe: false, subRecipeId: null }));
  c.S.recipes = [{
    id: 'rM', name: 'Crema TEST', category: 'Dolci', currentLabIdx: 1,
    labVersions: [
      { id: 'lv0', label: 'Bozza 1', name: 'Altra bozza', portionsCount: 4, gramsPerPortion: 200, ingredients: ings('x') },
      { id: 'lv1', label: 'Bozza 2', name: 'Bozza corrente', portionsCount: 10, gramsPerPortion: 80, ingredients: ings('y') },
      { id: 'lvNew', label: 'Bozza 3', name: 'Nuova', portionsCount: 1, gramsPerPortion: 0, ingredients: ings('z') },
    ],
    validatedVariants: [{ id: 'vaM', name: 'Classica', status: 'validated', active: true, portionsCount: 10, gramsPerPortion: 80, ingredients: ings('v') }],
  }];
  return c;
}
const rec = c => c.S.recipes[0];
const cur = c => rec(c).labVersions[rec(c).currentLabIdx];

(async () => {
  console.log('LAB FIX 2B — I2: Obiettivo di Produzione nel LAB');

  await test('T1. cambiare Porzioni lascia identiche (bit per bit) tutte le quantita\'', async () => {
    const c = memClient();
    const before = clone(cur(c).ingredients);
    c.onLabTargetPortions('rM', '25');
    assert.strictEqual(cur(c).portionsCount, 25);
    assert.deepStrictEqual(cur(c).ingredients, before);
    cur(c).ingredients.forEach((i, k) => assert.ok(Object.is(i.qty, QTYS[k]), `qty ${k}: ${i.qty}`));
    assert.deepStrictEqual(c.log.autosaves, ['rM'], 'l\'obiettivo cambiato viene salvato');
  });

  await test('T2. cambiare G/porzione lascia identiche tutte le quantita\'; G/porzione a precisione piena', async () => {
    const c = memClient();
    const before = clone(cur(c).ingredients);
    c.onLabTargetGpp('rM', '187,123456789012');
    assert.strictEqual(cur(c).gramsPerPortion, 187.123456789012);
    assert.deepStrictEqual(cur(c).ingredients, before);
    c.onLabTargetGpp('rM', '0.0001');
    assert.strictEqual(cur(c).gramsPerPortion, 0.0001);
    assert.deepStrictEqual(cur(c).ingredients, before);
  });

  await test('T3. caso xN: bozza nuova 1 porzione / 0 g -> G/porzione 200 e Porzioni 30 non moltiplicano gli ingredienti', async () => {
    const c = memClient();
    rec(c).currentLabIdx = 2;
    const before = clone(cur(c).ingredients);
    c.onLabTargetGpp('rM', '200');
    c.onLabTargetPortions('rM', '30');
    assert.strictEqual(cur(c).gramsPerPortion, 200); assert.strictEqual(cur(c).portionsCount, 30);
    assert.deepStrictEqual(cur(c).ingredients, before);
  });

  await test('T4. 1000 cambi successivi di Porzioni e G/porzione: nessuna deriva', async () => {
    const c = memClient();
    const before = clone(cur(c).ingredients);
    for (let k = 0; k < 1000; k++) { c.onLabTargetPortions('rM', String(1 + (k * 7) % 97)); c.onLabTargetGpp('rM', String(0.5 + (k * 13) % 301 / 3)); }
    c.onLabTargetPortions('rM', '10'); c.onLabTargetGpp('rM', '80');
    assert.deepStrictEqual(cur(c).ingredients, before);
    cur(c).ingredients.forEach((i, k) => assert.ok(Object.is(i.qty, QTYS[k])));
  });

  await test('T5. valori non validi rifiutati: nessuna modifica, nessun salvataggio, messaggio esplicito', async () => {
    // LAB FIX 2C (C2): '' e '  ' non sono piu' rifiutati: svuotare il campo = obiettivo non impostato (test C2)
    const badPortions = ['-1', '0', '-0', 'abc', 'Infinity', 'NaN', '2.5', '2,5', '1e3', '2147483648', null, undefined, '1.234,5'];
    const badGpp = ['-5', '0', '0,0', 'abc', 'Infinity', '-Infinity', 'NaN', null, undefined, '1e3', '1.234,5', {}];
    const c = memClient();
    const before = clone(c.S.recipes);
    badPortions.forEach(v => c.onLabTargetPortions('rM', v));
    badGpp.forEach(v => c.onLabTargetGpp('rM', v));
    assert.deepStrictEqual(c.S.recipes, before);
    assert.deepStrictEqual(c.log.autosaves, []);
    assert.strictEqual(c.log.toasts.length, badPortions.length + badGpp.length);
    assert.ok(c.log.toasts.slice(0, badPortions.length).every(t => /Porzioni/.test(t)));
    assert.ok(c.log.toasts.slice(badPortions.length).every(t => /G\/porzione/.test(t)));
    assert.strictEqual(c.log.renders, c.log.toasts.length, 'ridisegno: il campo torna al valore salvato');
  });

  await test('T6. valori validi ammessi: interi per Porzioni, decimali con virgola o punto per G/porzione', async () => {
    const v = (f, x) => makeClient(null).validateLabProductionTarget(f, x);
    assert.deepStrictEqual(v('portions', '12'), { ok: true, value: 12 });
    assert.deepStrictEqual(v('portions', 12), { ok: true, value: 12 });
    assert.deepStrictEqual(v('portions', ' 7 '), { ok: true, value: 7 });
    assert.deepStrictEqual(v('portions', '2147483647'), { ok: true, value: 2147483647 });
    assert.deepStrictEqual(v('gpp', '80,5'), { ok: true, value: 80.5 });
    assert.deepStrictEqual(v('gpp', '0.3'), { ok: true, value: 0.3 });
    assert.strictEqual(v('altro', '5').ok, false);
  });

  await test('T7. solo la bozza corrente cambia: altre bozze e Ricette Attive identiche; stesso valore = nessun salvataggio', async () => {
    const c = memClient();
    const others = clone({ lv0: rec(c).labVersions[0], lvNew: rec(c).labVersions[2], vv: rec(c).validatedVariants });
    c.onLabTargetPortions('rM', '40'); c.onLabTargetGpp('rM', '90');
    assert.deepStrictEqual(clone({ lv0: rec(c).labVersions[0], lvNew: rec(c).labVersions[2], vv: rec(c).validatedVariants }), others);
    const n = c.log.autosaves.length;
    c.onLabTargetPortions('rM', '40'); c.onLabTargetGpp('rM', '90,0');
    assert.strictEqual(c.log.autosaves.length, n);
  });

  await test('T8. input congelati: i gestori non mutano gli oggetti esistenti', async () => {
    const c = memClient();
    deepFreeze(c.S.recipes);
    c.onLabTargetPortions('rM', '3'); c.onLabTargetGpp('rM', '12,5');
    assert.strictEqual(cur(c).portionsCount, 3); assert.strictEqual(cur(c).gramsPerPortion, 12.5);
  });

  await test('T9. vista LAB: sezione "Obiettivo di Produzione", nessuno scaling residuo nel LAB', async () => {
    assert.ok(/id="lab-production-target"[\s\S]{0,400}Obiettivo di Produzione/.test(html));
    assert.ok(html.includes(`onchange="onLabTargetPortions('\${recipe.id}',this.value)"`));
    assert.ok(html.includes(`onchange="onLabTargetGpp('\${recipe.id}',this.value)"`));
    assert.ok(!/scaleLabPortions|scaleLabGpp/.test(html), 'vecchi gestori di scaling rimossi');
    const handlers = ['function validateLabProductionTarget(field,value)', 'function setLabProductionTarget(recipeId,field,rawValue)'].map(extractFunction).join('\n');
    assert.ok(!/ingredients|Math\.round|toFixed|ratio/.test(handlers), 'i gestori non toccano gli ingredienti e non arrotondano');
  });

  // ── Salvataggio e rilettura (api/chat.js reale + finto PostgREST) ──
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  async function callApi(body) {
    let status = 200, out;
    await realHandler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { status, body: out };
  }
  const clientFetch = async (url, opts) => { const r = await callApi(JSON.parse(opts.body)); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  const setup = async () => {
    const fake = makeFakeSupabase(); seed(fake); globalThis.fetch = fake.fetch;
    const client = makeClient(clientFetch);
    await client.loadFromSupabase();
    return { fake, client, recipe: () => client.S.recipes.find(r => r.id === 'rT') };
  };

  await test('T10. Porzioni e G/porzione cambiati, salvataggio e rilettura: quantita\' identiche nel DB e nel client', async () => {
    const { fake, client, recipe } = await setup();
    const dbBefore = dbContent(fake, 'lvT');
    const clientBefore = noId(clone(recipe().labVersions[0].ingredients));
    client.onLabTargetPortions('rT', '24'); client.onLabTargetGpp('rT', '55,75');
    assert.strictEqual(await client.saveToSupabase(recipe()), true);
    assert.deepStrictEqual(dbContent(fake, 'lvT'), dbBefore, 'righe ingredienti identiche nel DB (id a parte)');
    dbIngs(fake, 'lvT').forEach((r, k) => assert.ok(Object.is(r.qty, QTYS[k]), `qty ${k} nel DB: ${r.qty}`));
    const row = dbVariant(fake, 'lvT');
    assert.strictEqual(row.portions_count, 24); assert.strictEqual(row.grams_per_portion, 55.75);
    const c2 = makeClient(clientFetch); await c2.loadFromSupabase();
    const lv = c2.S.recipes.find(r => r.id === 'rT').labVersions[0];
    assert.deepStrictEqual(noId(lv.ingredients), clientBefore);
    lv.ingredients.forEach((i, k) => assert.ok(Object.is(i.qty, QTYS[k]), `qty ${k} riletta: ${i.qty}`));
    assert.strictEqual(lv.portionsCount, 24); assert.strictEqual(lv.gramsPerPortion, 55.75);
  });

  await test('T11. cicli ripetuti modifica -> salvataggio -> rilettura: nessuna modifica involontaria', async () => {
    const { fake } = await setup();
    const dbBefore = dbContent(fake, 'lvT');
    for (let k = 0; k < 5; k++) {
      const c = makeClient(clientFetch); await c.loadFromSupabase();
      c.onLabTargetPortions('rT', String(3 + k)); c.onLabTargetGpp('rT', String(70 + k / 3));
      assert.strictEqual(await c.saveToSupabase(c.S.recipes.find(r => r.id === 'rT')), true);
    }
    assert.deepStrictEqual(dbContent(fake, 'lvT'), dbBefore);
    assert.strictEqual(dbVariant(fake, 'lvT').grams_per_portion, 70 + 4 / 3, 'G/porzione salvato senza arrotondamenti');
  });

  await test('T12. LAB FIX 1/1.1: la Ricetta Attiva non viene reinviata ne\' modificata', async () => {
    const { fake, client, recipe } = await setup();
    const before = { v: dbVariant(fake, 'vaT'), i: dbIngs(fake, 'vaT') };
    const saves = [];
    const spy = makeClient(async (url, opts) => { const b = JSON.parse(opts.body); if (b.supabaseAction === 'save') saves.push(clone(b.data)); return clientFetch(url, opts); });
    await spy.loadFromSupabase();
    spy.onLabTargetPortions('rT', '50'); spy.onLabTargetGpp('rT', '33');
    await spy.saveToSupabase(spy.S.recipes.find(r => r.id === 'rT'));
    assert.deepStrictEqual(saves[0].variants.map(v => v.id), ['lvT']);
    assert.deepStrictEqual({ v: dbVariant(fake, 'vaT'), i: dbIngs(fake, 'vaT') }, before);
  });

  await test('T13. valore non valido: nessun salvataggio parte e il DB resta identico', async () => {
    const { fake, client, recipe } = await setup();
    const before = clone(fake.tables);
    client.onLabTargetPortions('rT', '-3'); client.onLabTargetGpp('rT', 'abc'); client.onLabTargetPortions('rT', '2,5');
    assert.deepStrictEqual(client.log.autosaves, []);
    assert.deepStrictEqual(fake.tables, before);
    assert.strictEqual(recipe().labVersions[0].portionsCount, 10);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
