/*
 * Test — load paginata e save non distruttivo (bug Macarons: ingredienti
 * oltre la 1000ª riga persi alla load e poi cancellati dal save).
 * Nessun framework: Node puro + assert, stesso stile degli altri test.
 *
 * Esegue codice REALE, non copie:
 *  - api/chat.js viene importato come modulo e il suo handler gira contro
 *    un finto PostgREST in memoria che applica davvero il limite "Max rows"
 *    (1000 righe per richiesta, come Supabase di default);
 *  - loadFromSupabase/saveToSupabase e i loro helper vengono ESTRATTI da
 *    khub_mvp.html ed eseguiti (new Function, stessa tecnica di
 *    test-m2-ui-integration.js), con fetch('/api/chat') instradata
 *    sull'handler reale.
 *
 * Dataset: 161 varianti x 7 ingredienti + una variante "Macarons" da 9 —
 * il cumulativo per sort_order supera 1000 a sort_order 6, esattamente come
 * nel database reale in cui e' stato osservato il bug.
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

const MACARONS = ['albumi', 'farina di mandorle extra fine', 'zucchero a velo', 'zucchero semolato',
  'colorante alimentare in polvere', 'cioccolato fondente 70%', 'panna liquida fresca',
  'cioccolato bianco', 'panna da cucina a lunga conservazione'];

function seed(fake) {
  fake.tables.recipes = [{ id: 'rMAC', name: 'Macarons', category: 'Dolci', created_at: '2026-09-01T00:00:00Z' }];
  fake.tables.variants = [{ id: 'vMAC', recipe_id: 'rMAC', name: 'Macarons', status: 'validated', active: true,
    portions_count: 4, grams_per_portion: 200, steps: '[]', steps_v2: [], created_at: '2026-09-01T00:00:00Z' }];
  const ing = [];
  for (let v = 0; v < 161; v++) {
    for (let k = 0; k < 7; k++) ing.push({ id: 'fill_' + v + '_' + k, variant_id: 'vF' + v, name: 'ing ' + k, qty: 10, unit: 'g', sort_order: k });
  }
  MACARONS.forEach((name, k) => ing.push({ id: 'mac_ing_' + k, variant_id: 'vMAC', name, qty: 100, unit: k === 4 ? 'tbsp' : 'g', sort_order: k }));
  fake.tables.ingredients = ing;
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = []; fake.tables.ingredient_conversions = [];
}
const macRowsInDb = fake => fake.tables.ingredients.filter(i => i.variant_id === 'vMAC').sort((a, b) => a.sort_order - b.sort_order);

// ══════════════════════════════════════════════════════════
// Codice reale: handler di api/chat.js + funzioni client di khub_mvp.html
// ══════════════════════════════════════════════════════════
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

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const withFake = () => { const fake = makeFakeSupabase(); seed(fake); globalThis.fetch = fake.fetch; return fake; };

  console.log('A/B. load paginata (dataset > 1000 ingredienti)');

  await test('sanity: il fake tronca davvero a 1000 righe una lettura non paginata', async () => {
    const fake = withFake();
    const r = await fake.fetch('https://fake.supabase/rest/v1/ingredients?select=*&order=sort_order.asc');
    assert.strictEqual((await r.json()).length, MAX_ROWS);
    assert.ok(fake.tables.ingredients.length > MAX_ROWS);
  });

  await test('A: la load restituisce TUTTI gli ingredienti (>1000), leggendo a pagine', async () => {
    const fake = withFake();
    let loaded;
    await handler({ method: 'POST', body: { supabaseAction: 'load' } }, { status() { return this; }, json(o) { loaded = o; return this; } });
    assert.strictEqual(loaded.ingredients.length, fake.tables.ingredients.length);
    assert.strictEqual(new Set(loaded.ingredients.map(i => i.id)).size, fake.tables.ingredients.length, 'nessun duplicato tra pagine');
    const pages = fake.calls.filter(c => c.method === 'GET' && c.table === 'ingredients');
    assert.ok(pages.length >= 2, 'attese piu\' pagine, trovate ' + pages.length);
  });

  await test('B: la variante Macarons (9 ingredienti, 7°-9° oltre la prima pagina) torna completa nel client', async () => {
    withFake();
    const client = makeClient(handler);
    await client.loadFromSupabase();
    const vv = client.S.recipes.find(r => r.id === 'rMAC').validatedVariants.find(v => v.id === 'vMAC');
    assert.deepStrictEqual(vv.ingredients.map(i => i.name), MACARONS);
  });

  await test('B2: se una pagina fallisce la load fallisce per intero (mai uno stato parziale nel client)', async () => {
    const fake = withFake();
    fake.failPage('ingredients', MAX_ROWS);
    const client = makeClient(handler);
    const logError = console.error;
    console.error = () => {}; // l'handler logga l'errore atteso
    try { await client.loadFromSupabase(); } finally { console.error = logError; }
    assert.strictEqual(client.S.recipes.length, 0, 'il client non deve ricevere ricette con ingredienti troncati');
  });

  await test('B3: le altre collezioni globali sono lette paginate (variants, l2/l3, conversioni, sessioni, famiglie)', async () => {
    const fake = withFake();
    fake.tables.ingredient_conversions = Array.from({ length: 1205 }, (_, i) => ({ id: 'c' + i, ingredient_name: 'x', from_unit: 'n', to_unit: 'g', factor: 1, source_type: 'chef_confirmed', confirmed_at: '2026-01-01T00:00:00Z' }));
    fake.tables.production_sessions = Array.from({ length: 1003 }, (_, i) => ({ id: 's' + i, status: 'pending', snapshot: {}, created_at: '2026-01-01T00:00:00Z' }));
    fake.tables.variant_families = Array.from({ length: 1001 }, (_, i) => ({ variant_id: 'v' + i, family_id: 'f' }));
    const call = async body => { let o; await handler({ method: 'POST', body }, { status() { return this; }, json(x) { o = x; return this; } }); return o; };
    assert.strictEqual((await call({ supabaseAction: 'loadConversions' })).conversions.length, 1205);
    assert.strictEqual((await call({ supabaseAction: 'loadProductionSessions' })).sessions.length, 1003);
    assert.strictEqual((await call({ supabaseAction: 'loadFamilies' })).variantFamilies.length, 1001);
    const loadTables = new Set(fake.calls.filter(c => c.method === 'GET' && c.limit === MAX_ROWS).map(c => c.table));
    ['ingredient_conversions', 'production_sessions', 'families', 'variant_families'].forEach(t => assert.ok(loadTables.has(t), t + ' non paginata'));
    await call({ supabaseAction: 'load' });
    const all = new Set(fake.calls.filter(c => c.method === 'GET' && c.limit === MAX_ROWS).map(c => c.table));
    ['recipes', 'variants', 'ingredients', 'l2_items', 'l3_items'].forEach(t => assert.ok(all.has(t), t + ' non paginata'));
  });

  console.log('');
  console.log('C. load incompleta + save: nessuna cancellazione di ingredienti mai ricevuti');

  await test('C: load troncata (vecchio comportamento, 6 di 9) + modifica + save -> nel DB restano TUTTI e 9', async () => {
    const fake = withFake();
    // Simula esattamente la vecchia load: un'unica lettura ordinata per sort_order, troncata a 1000.
    const truncate = data => ({ ...data, ingredients: data.ingredients.slice().sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)).slice(0, MAX_ROWS) });
    const client = makeClient(handler, truncate);
    await client.loadFromSupabase();
    const recipe = client.S.recipes.find(r => r.id === 'rMAC');
    const vv = recipe.validatedVariants.find(v => v.id === 'vMAC');
    assert.strictEqual(vv.ingredients.length, 6, 'precondizione: il client deve aver ricevuto solo 6 ingredienti');
    vv.portionsCount = 8; // una modifica qualsiasi -> autosave -> saveToSupabase
    assert.strictEqual(await client.saveToSupabase(recipe), true);
    assert.deepStrictEqual(macRowsInDb(fake).map(i => i.name), MACARONS);
  });

  await test('C2: un save senza deletedIngredients (es. client vecchio in cache) non cancella mai nulla', async () => {
    const fake = withFake();
    const six = macRowsInDb(fake).slice(0, 6);
    let out;
    await handler({ method: 'POST', body: { supabaseAction: 'save', data: {
      recipe: fake.tables.recipes[0], variants: [fake.tables.variants[0]], ingredients: six, l2Items: [], l3Items: [] } } },
    { status() { return this; }, json(o) { out = o; return this; } });
    assert.deepStrictEqual(out, { ok: true });
    assert.strictEqual(macRowsInDb(fake).length, 9);
    assert.ok(!fake.calls.some(c => c.method === 'DELETE' && c.table === 'ingredients'));
  });

  await test('C3: una cancellazione dichiarata per un\'altra variante non tocca le righe di questa', async () => {
    const fake = withFake();
    await handler({ method: 'POST', body: { supabaseAction: 'save', data: {
      recipe: fake.tables.recipes[0], variants: [], ingredients: [],
      deletedIngredients: [{ id: 'mac_ing_6', variant_id: 'vALTRA' }], l2Items: [], l3Items: [] } } },
    { status() { return this; }, json() { return this; } });
    assert.strictEqual(macRowsInDb(fake).length, 9);
  });

  console.log('');
  console.log('D. cancellazione intenzionale');

  await test('D: rimuovere "panna liquida fresca" dal client e salvare la cancella dal DB, il resto resta', async () => {
    const fake = withFake();
    const client = makeClient(handler);
    await client.loadFromSupabase();
    const recipe = client.S.recipes.find(r => r.id === 'rMAC');
    const vv = recipe.validatedVariants.find(v => v.id === 'vMAC');
    vv.ingredients = vv.ingredients.filter(i => i.name !== 'panna liquida fresca'); // come delIngredient
    assert.strictEqual(await client.saveToSupabase(recipe), true);
    assert.deepStrictEqual(macRowsInDb(fake).map(i => i.name), MACARONS.filter(n => n !== 'panna liquida fresca'));
    assert.strictEqual(fake.tables.ingredients.length, 161 * 7 + 8, 'nessuna altra variante toccata');
  });

  await test('D2: rimuovere TUTTI gli ingredienti di una variante li cancella (prima non veniva persistito)', async () => {
    const fake = withFake();
    const client = makeClient(handler);
    await client.loadFromSupabase();
    const recipe = client.S.recipes.find(r => r.id === 'rMAC');
    recipe.validatedVariants.find(v => v.id === 'vMAC').ingredients = [];
    assert.strictEqual(await client.saveToSupabase(recipe), true);
    assert.strictEqual(macRowsInDb(fake).length, 0);
  });

  await test('D3: id rigenerati (come in validazione/attivazione) -> nessun duplicato, vecchi id cancellati', async () => {
    const fake = withFake();
    const client = makeClient(handler);
    await client.loadFromSupabase();
    const recipe = client.S.recipes.find(r => r.id === 'rMAC');
    const vv = recipe.validatedVariants.find(v => v.id === 'vMAC');
    vv.ingredients = vv.ingredients.map((i, k) => ({ ...i, id: 'vi_new_' + k }));
    assert.strictEqual(await client.saveToSupabase(recipe), true);
    const rows = macRowsInDb(fake);
    assert.deepStrictEqual(rows.map(i => i.name), MACARONS);
    assert.ok(rows.every(i => i.id.startsWith('vi_new_')));
  });

  await test('D4: un ingrediente aggiunto e poi rimosso in due save successivi viene cancellato', async () => {
    const fake = withFake();
    const client = makeClient(handler);
    await client.loadFromSupabase();
    const recipe = client.S.recipes.find(r => r.id === 'rMAC');
    const vv = recipe.validatedVariants.find(v => v.id === 'vMAC');
    vv.ingredients = [...vv.ingredients, { id: 'idNuovo12345', name: 'sale', qty: 1, unit: 'g' }];
    assert.strictEqual(await client.saveToSupabase(recipe), true);
    assert.strictEqual(macRowsInDb(fake).length, 10);
    vv.ingredients = vv.ingredients.filter(i => i.id !== 'idNuovo12345');
    assert.strictEqual(await client.saveToSupabase(recipe), true);
    assert.deepStrictEqual(macRowsInDb(fake).map(i => i.name), MACARONS);
  });

  await test('D5: una cancellazione fallita non viene "dimenticata": il save successivo la ritenta', async () => {
    const fake = withFake();
    const client = makeClient(handler);
    await client.loadFromSupabase();
    const recipe = client.S.recipes.find(r => r.id === 'rMAC');
    const vv = recipe.validatedVariants.find(v => v.id === 'vMAC');
    vv.ingredients = vv.ingredients.filter(i => i.name !== 'panna liquida fresca');
    fake.failNextDeletes(1);
    const logError = console.error;
    console.error = () => {};
    let primo;
    try { primo = await client.saveToSupabase(recipe); } finally { console.error = logError; }
    assert.strictEqual(primo, false, 'il primo save deve risultare fallito');
    assert.strictEqual(macRowsInDb(fake).length, 9, 'la DELETE fallita non ha cancellato nulla');
    assert.strictEqual(await client.saveToSupabase(recipe), true);
    assert.deepStrictEqual(macRowsInDb(fake).map(i => i.name), MACARONS.filter(n => n !== 'panna liquida fresca'));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
