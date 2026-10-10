/*
 * Test — LAB FIX 2A: compatibilita' del codice ATTUALE con le colonne
 * variants.declared_yield_qty / declared_yield_unit (migrazione 0011).
 * Il codice di oggi non le conosce: deve continuare a funzionare quando le
 * colonne esistono (NULL o gia' valorizzate), senza leggerle in memoria,
 * senza riscriverle e senza alterare i dati legacy.
 *
 * Codice REALE: handler di api/chat.js contro un finto PostgREST in memoria
 * con semantica di upsert merge-duplicates (aggiorna solo le colonne del
 * payload, come PostgREST); loadFromSupabase/saveToSupabase estratti da
 * khub_mvp.html. Nessuna rete, nessun Supabase reale.
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
function seed(fake) {
  const steps = [{ id: 'st1', order: 0, text: 'Scaldare il latte', expectedDurationSeconds: 300 }, { id: 'st2', order: 1, text: 'Montare', expectedDurationSeconds: null }];
  const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null };
  fake.tables.recipes = [{ id: 'rC', name: 'Crema TEST', category: 'Dolci', department: 'Cucina', notes: 'appunti', created_at: '2026-10-01T00:00:00Z' }];
  fake.tables.variants = [
    { ...base, id: 'vaC', recipe_id: 'rC', name: 'Classica', label: 'Etichetta storica', note: 'nota attiva', status: 'validated', active: true, portions_count: 10, grams_per_portion: 80, steps: JSON.stringify(['Scaldare il latte', 'Montare']), steps_v2: steps, validated_at: '2026-10-01T09:30:17.250Z', origin_variant_id: 'vaOLD', intention_initial: 'più cremosa', created_at: '2026-10-01T00:00:00Z' },
    { ...base, id: 'vaR', recipe_id: 'rC', name: 'Vecchia', label: 'Vecchia', note: 'ritirata', status: 'retired', active: false, portions_count: 8, grams_per_portion: 90, steps: '[]', steps_v2: [], validated_at: '2026-08-01T18:45:00.000Z', origin_variant_id: null, created_at: '2026-08-01T00:00:00Z' },
    { ...base, id: 'lvC', recipe_id: 'rC', name: 'Bozza crema', label: 'Bozza 1', note: 'nota bozza', status: 'lab', active: false, portions_count: 10, grams_per_portion: 80, steps: JSON.stringify(['Scaldare il latte', 'Montare']), steps_v2: steps, origin_variant_id: 'vaC', created_at: '2026-10-02T00:00:00Z' },
  ];
  const ing = (id, v, name, qty, ord, y = null, sub = null) => ({ id, variant_id: v, name, qty, unit: 'g', sort_order: ord, estimated_yield_pct: y, measured_yield_pct: null, is_sub_recipe: !!sub, sub_recipe_id: sub });
  fake.tables.ingredients = [
    ing('ingA1', 'vaC', 'Latte', 500, 0, 90), ing('ingA2', 'vaC', 'Zucchero', 150, 1), ing('ingA3', 'vaC', 'Frolla TEST', 200, 2, null, 'vaF'),
    ing('ingR1', 'vaR', 'Latte', 600, 0),
    ing('ingB1', 'lvC', 'Latte', 500, 0, 90), ing('ingB2', 'lvC', 'Zucchero', 150, 1), ing('ingB3', 'lvC', 'Frolla TEST', 200, 2, null, 'vaF'),
  ];
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = []; fake.tables.ingredient_conversions = [];
}
const dbVariant = (fake, id) => clone(fake.tables.variants.find(v => v.id === id));
const dbIngs = (fake, id) => clone(fake.tables.ingredients.filter(i => i.variant_id === id).sort((a, b) => a.sort_order - b.sort_order));
const snapshotOthers = fake => ({ vaC: dbVariant(fake, 'vaC'), vaR: dbVariant(fake, 'vaR'), iC: dbIngs(fake, 'vaC'), iR: dbIngs(fake, 'vaR') });

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
const CLIENT_SRC = [
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)',
  'function isBetterConversionFact(candidate,current)', 'function buildKnownIngredientIds(ingredientRows)',
  'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).join('\n');

// Client KHUB isolato: fetch('/api/chat') -> handler reale -> fake Supabase.
// `interceptLoad` permette di simulare una load incompleta (vecchio server).
function makeClient(handler, interceptLoad) {
  async function callApi(body) {
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { status, body: out };
  }
  const clientFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    let r = await callApi(body);
    if (body.supabaseAction === 'load' && interceptLoad) r = { status: r.status, body: interceptLoad(r.body) };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  const factory = new Function('fetch', 'toast', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{}};
    var _knownIngredientIdsByVariant={};
    var _persistedValidatedSig={};
    ${CLIENT_SRC}
    return {S, loadFromSupabase, saveToSupabase};
  `);
  return factory(clientFetch, () => {});
}



// Stato del DB DOPO la migrazione 0011 (e, per alcune righe, dopo un futuro
// FIX 2B che abbia gia' scritto una resa dichiarata).
const withDeclaredYield = f => f.tables.variants.forEach(v => {
  const vals = { vaC: [10, 'porzioni'], vaR: [null, null], lvC: [30, 'pz'] }[v.id];
  v.declared_yield_qty = vals ? vals[0] : null; v.declared_yield_unit = vals ? vals[1] : null;
});
const yieldCols = f => clone(f.tables.variants.map(v => [v.id, v.declared_yield_qty, v.declared_yield_unit]).sort());
const legacy = f => clone(f.tables.variants.map(({ declared_yield_qty, declared_yield_unit, contenuto_hash, primo_consulto, m1_reading_text, ...r }) => r).sort((a, b) => a.id < b.id ? -1 : 1));

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let saves = [];
  const handler = async (req, res) => { if (req.body.supabaseAction === 'save') saves.push(clone(req.body.data)); return realHandler(req, res); };
  const setup = async (...muts) => {
    const fake = makeFakeSupabase(); seed(fake); muts.forEach(m => m(fake)); globalThis.fetch = fake.fetch; saves = [];
    const client = makeClient(handler); await client.loadFromSupabase();
    return { fake, client, recipe: () => client.S.recipes.find(r => r.id === 'rC') };
  };
  const editDraft = (client, fn) => { client.S.recipes = client.S.recipes.map(r => r.id === 'rC' ? { ...r, labVersions: r.labVersions.map(fn) } : r); };

  console.log('LAB FIX 2A — codice attuale con le colonne declared_yield_* presenti');

  await test('1. la load produce lo stesso stato in memoria con e senza le nuove colonne', async () => {
    const a = await setup(); const b = await setup(withDeclaredYield);
    const strip = r => JSON.parse(JSON.stringify(r, (k, v) => (k === 'id' && typeof v === 'string' && v.startsWith('lv_') ? '<gen>' : v)));
    assert.deepStrictEqual(strip(b.client.S.recipes), strip(a.client.S.recipes));
    assert.ok(!JSON.stringify(b.client.S.recipes).includes('declared_yield'), 'nessun campo nuovo in memoria');
  });

  await test('2. salvare una bozza: resa dichiarata intatta su bozza, Ricetta Attiva e ritirata; nessuna colonna nuova nel payload', async () => {
    const { fake, client, recipe } = await setup(withDeclaredYield);
    const y0 = yieldCols(fake);
    editDraft(client, v => ({ ...v, portionsCount: 12, ingredients: v.ingredients.map(i => i.name === 'Zucchero' ? { ...i, qty: 120 } : i) }));
    assert.strictEqual(await client.saveToSupabase(recipe()), true);
    assert.deepStrictEqual(yieldCols(fake), y0);
    assert.ok(!JSON.stringify(saves).includes('declared_yield'));
    assert.strictEqual(dbVariant(fake, 'lvC').portions_count, 12, 'la modifica legacy viene salvata come prima');
  });

  await test('3. operazione esplicita su una Ricetta Attiva (Disattiva): resa dichiarata intatta', async () => {
    const { fake, client, recipe } = await setup(withDeclaredYield);
    const y0 = yieldCols(fake);
    const r = recipe(); r.validatedVariants = r.validatedVariants.map(v => v.id === 'vaC' ? { ...v, active: false } : v);
    assert.strictEqual(await client.saveToSupabase(r), true);
    assert.ok(saves[0].variants.some(v => v.id === 'vaC'));
    assert.strictEqual(dbVariant(fake, 'vaC').active, false);
    assert.deepStrictEqual(yieldCols(fake), y0);
  });

  await test('4. promozione (stesso variant.id, come Rendi attiva): la riga conserva la resa dichiarata della bozza', async () => {
    const { fake, client, recipe } = await setup(withDeclaredYield);
    const r = recipe(); const v = r.labVersions[0];
    r.validatedVariants = [...r.validatedVariants, { id: v.id, name: v.name, status: 'approved', active: true, validatedAt: '10/10/2026', portionsCount: v.portionsCount, gramsPerPortion: v.gramsPerPortion, portionUnit: 'g',
      ingredients: v.ingredients.map((i, k) => ({ ...i, id: 'vi_new_' + k })), steps: v.steps, stepsV2: v.stepsV2, originVariantId: v.originVariantId, l2Items: [] }];
    r.labVersions = [];
    assert.strictEqual(await client.saveToSupabase(r), true);
    const row = dbVariant(fake, 'lvC');
    assert.strictEqual(row.status, 'validated'); assert.strictEqual(row.declared_yield_qty, 30); assert.strictEqual(row.declared_yield_unit, 'pz');
  });

  await test('5. tre cicli carica -> salva: colonne legacy e nuove invariate; Ricette Attive non reinviate (FIX 1)', async () => {
    const { fake } = await setup(withDeclaredYield);
    const y0 = yieldCols(fake); const l0 = snapshotOthers(fake);
    for (let k = 0; k < 3; k++) { const c = makeClient(handler); await c.loadFromSupabase(); assert.strictEqual(await c.saveToSupabase(c.S.recipes.find(r => r.id === 'rC')), true); }
    assert.deepStrictEqual(yieldCols(fake), y0);
    assert.deepStrictEqual(snapshotOthers(fake), l0);
    assert.ok(saves.every(s => s.variants.every(v => v.id === 'lvC')));
  });

  await test('6. colonne presenti ma tutte NULL (stato subito dopo la migrazione): salvataggi identici a prima', async () => {
    const nulls = f => f.tables.variants.forEach(v => { v.declared_yield_qty = null; v.declared_yield_unit = null; });
    const a = await setup(); const b = await setup(nulls);
    for (const x of [a, b]) { globalThis.fetch = x.fake.fetch; editDraft(x.client, v => ({ ...v, note: 'n' })); await x.client.saveToSupabase(x.recipe()); }
    const la = legacy(a.fake), lb = legacy(b.fake); const d = []; la.forEach((r, k) => Object.keys({ ...r, ...lb[k] }).forEach(c => { if (JSON.stringify(r[c]) !== JSON.stringify(lb[k][c])) d.push(r.id + '.' + c + ': ' + JSON.stringify(r[c]) + ' vs ' + JSON.stringify(lb[k][c])); }));
    assert.deepStrictEqual(d, [], d.join(' / '));
    assert.ok(b.fake.tables.variants.every(v => v.declared_yield_qty === null && v.declared_yield_unit === null));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
