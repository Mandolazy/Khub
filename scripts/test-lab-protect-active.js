/*
 * Test — LAB FIX 1: protezione delle Ricette Attive.
 * Salvare una bozza LAB non deve riscrivere le altre versioni della Scheda
 * (Ricette Attive, Pronte, ritirate): riga variants e ingredienti restano
 * identici, compresi nota, etichetta, validated_at (ora inclusa) e
 * collegamenti ai mattoncini. Una variante validata viene inviata solo
 * quando cambia davvero (Rendi attiva, Valida, ritiro, ...).
 *
 * Codice REALE: handler di api/chat.js contro un finto PostgREST in memoria;
 * loadFromSupabase/saveToSupabase estratti da khub_mvp.html. Nessuna rete.
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


(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let saves = [];
  const handler = async (req, res) => { if (req.body.supabaseAction === 'save') saves.push(clone(req.body.data)); return realHandler(req, res); };
  const setup = async () => {
    const fake = makeFakeSupabase(); seed(fake); globalThis.fetch = fake.fetch; saves = [];
    const client = makeClient(handler);
    await client.loadFromSupabase();
    const recipe = () => client.S.recipes.find(r => r.id === 'rC');
    return { fake, client, recipe };
  };
  const editDraft = (client, fn) => { client.S.recipes = client.S.recipes.map(r => r.id === 'rC' ? { ...r, labVersions: r.labVersions.map(fn) } : r); };

  console.log('LAB FIX 1 — protezione delle Ricette Attive');

  await test('1. salvare una bozza modificata lascia identiche Ricetta Attiva e ritirata (riga variants + ingredienti)', async () => {
    const { fake, client, recipe } = await setup();
    const before = snapshotOthers(fake);
    editDraft(client, v => ({ ...v, portionsCount: 12, ingredients: v.ingredients.map(i => i.name === 'Zucchero' ? { ...i, qty: 120 } : i) }));
    assert.strictEqual(await client.saveToSupabase(recipe()), true);
    assert.deepStrictEqual(snapshotOthers(fake), before);
  });

  await test('1b. il payload del salvataggio LAB contiene solo la bozza (nessuna variante validata o ritirata)', async () => {
    const { client, recipe } = await setup();
    editDraft(client, v => ({ ...v, note: 'nuova nota bozza' }));
    await client.saveToSupabase(recipe());
    assert.deepStrictEqual(saves[0].variants.map(v => v.id), ['lvC']);
    assert.deepStrictEqual([...new Set(saves[0].ingredients.map(i => i.variant_id))], ['lvC']);
  });

  await test('2. mattoncino: letto anche per le validate e mai scollegato', async () => {
    const { fake, client, recipe } = await setup();
    const vv = recipe().validatedVariants.find(v => v.id === 'vaC');
    const brick = vv.ingredients.find(i => i.name === 'Frolla TEST');
    assert.strictEqual(brick.isSubRecipe, true); assert.strictEqual(brick.subRecipeId, 'vaF');
    editDraft(client, v => ({ ...v, name: 'Bozza rinominata' }));
    await client.saveToSupabase(recipe());
    const row = dbIngs(fake, 'vaC').find(i => i.name === 'Frolla TEST');
    assert.strictEqual(row.is_sub_recipe, true); assert.strictEqual(row.sub_recipe_id, 'vaF');
  });

  await test('3. metadati: nota, etichetta, validated_at con ora e millisecondi restano identici anche quando la validata viene inviata', async () => {
    const { fake, client, recipe } = await setup();
    // modifica ESPLICITA della Ricetta Attiva (come un ritiro): ora deve essere inviata
    const r = recipe();
    r.validatedVariants = r.validatedVariants.map(v => v.id === 'vaC' ? { ...v, status: 'retired', active: false } : v);
    await client.saveToSupabase(r);
    assert.ok(saves[0].variants.some(v => v.id === 'vaC'), 'la variante cambiata viene inviata');
    const row = dbVariant(fake, 'vaC');
    assert.strictEqual(row.status, 'retired'); assert.strictEqual(row.active, false);
    assert.strictEqual(row.note, 'nota attiva');
    assert.strictEqual(row.label, 'Etichetta storica');
    assert.strictEqual(row.validated_at, '2026-10-01T09:30:17.250Z');
    assert.strictEqual(dbIngs(fake, 'vaC').find(i => i.name === 'Frolla TEST').sub_recipe_id, 'vaF');
    assert.ok(!saves[0].variants.some(v => v.id === 'vaR'), 'la ritirata invariata non viene inviata');
  });

  await test('4. la bozza salvata viene riaperta con gli stessi valori', async () => {
    const { client, recipe } = await setup();
    editDraft(client, v => ({ ...v, portionsCount: 12, note: 'n2', ingredients: v.ingredients.map(i => i.name === 'Latte' ? { ...i, qty: 480, estimatedYieldPct: 85 } : i) }));
    await client.saveToSupabase(recipe());
    const pick = r => clone({ lab: r.labVersions.map(v => ({ id: v.id, name: v.name, label: v.label, note: v.note, p: v.portionsCount, g: v.gramsPerPortion, steps: v.stepsV2, ings: v.ingredients })), vv: r.validatedVariants });
    const before = pick(recipe());
    const client2 = makeClient(handler); await client2.loadFromSupabase();
    assert.deepStrictEqual(pick(client2.S.recipes.find(r => r.id === 'rC')), before);
  });

  await test('5. una nuova Ricetta Attiva nata nel client (Rendi attiva/Valida) viene inviata con il suo mattoncino; l\'altra Attiva resta identica', async () => {
    const { fake, client, recipe } = await setup();
    const before = snapshotOthers(fake);
    const r = recipe(); const v = r.labVersions[0];
    const nv = { id: v.id, name: v.name, status: 'approved', active: true, validatedAt: '10/10/2026', portionsCount: v.portionsCount, gramsPerPortion: v.gramsPerPortion, portionUnit: 'g',
      ingredients: v.ingredients.map((i, k) => ({ ...i, id: 'vi_new_' + k })), steps: v.steps, stepsV2: v.stepsV2, originVariantId: v.originVariantId, l2Items: [] };
    r.validatedVariants = [...r.validatedVariants, nv]; r.labVersions = [];
    assert.strictEqual(await client.saveToSupabase(r), true);
    assert.deepStrictEqual(saves[0].variants.map(x => x.id), ['lvC']);
    const row = dbVariant(fake, 'lvC');
    assert.strictEqual(row.status, 'validated'); assert.strictEqual(row.active, true); assert.strictEqual(row.label, v.name);
    assert.deepStrictEqual(dbIngs(fake, 'lvC').map(i => i.id), ['vi_new_0', 'vi_new_1', 'vi_new_2'], 'vecchi ingredienti della bozza cancellati');
    assert.strictEqual(dbIngs(fake, 'lvC')[2].is_sub_recipe, true);
    assert.deepStrictEqual(snapshotOthers(fake), before);
  });

  await test('6. salvataggio fallito: la modifica della validata viene ritentata al salvataggio successivo', async () => {
    const { fake, client, recipe } = await setup();
    const r = recipe();
    r.validatedVariants = r.validatedVariants.map(v => v.id === 'vaC' ? { ...v, portionsCount: 20 } : v);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, o) => (o && o.method === 'POST' && String(u).includes('/variants') ? { ok: false, status: 500, json: async () => ({ message: 'boom' }), text: async () => 'boom' } : realFetch(u, o));
    assert.strictEqual(await client.saveToSupabase(r), false);
    globalThis.fetch = realFetch;
    assert.strictEqual(await client.saveToSupabase(r), true);
    assert.ok(saves[1].variants.some(v => v.id === 'vaC'));
    assert.strictEqual(dbVariant(fake, 'vaC').portions_count, 20);
  });

  await test('7. secondo salvataggio senza modifiche alla validata: non viene reinviata', async () => {
    const { client, recipe } = await setup();
    const r = recipe();
    r.validatedVariants = r.validatedVariants.map(v => v.id === 'vaC' ? { ...v, active: false } : v);
    await client.saveToSupabase(r);
    await client.saveToSupabase(r);
    assert.ok(saves[0].variants.some(v => v.id === 'vaC'));
    assert.ok(!saves[1].variants.some(v => v.id === 'vaC'));
  });

  // ── LAB FIX 1.1: dati legacy ──
  console.log('LAB FIX 1.1 — dati legacy (id corti, validated_at assente)');
  const shortIds = f => { f.tables.ingredients.filter(i => i.variant_id === 'vaC').forEach((i, k) => { i.id = 'a' + k + 'x'; }); };      // id di 3 caratteri
  const noValidatedAt = f => { f.tables.variants.find(v => v.id === 'vaC').validated_at = null; };
  const legacyNulls = f => { const v = f.tables.variants.find(v => v.id === 'vaC'); v.portions_count = null; v.grams_per_portion = null; const z = f.tables.ingredients.find(i => i.variant_id === 'vaC' && i.name === 'Zucchero'); z.qty = null; z.unit = null; };
  const setupWith = async (...muts) => {
    const fake = makeFakeSupabase(); seed(fake); muts.forEach(m => m(fake)); globalThis.fetch = fake.fetch; saves = [];
    const client = makeClient(handler); await client.loadFromSupabase();
    return { fake, client, recipe: () => client.S.recipes.find(r => r.id === 'rC') };
  };
  for (const [name, muts] of [['id ingrediente di 3 caratteri', [shortIds]], ['validated_at assente', [noValidatedAt]], ['entrambe le condizioni (+ porzioni, qty e unita\' NULL)', [shortIds, noValidatedAt, legacyNulls]]]) {
    await test('L1-3. ' + name + ': il salvataggio della bozza non rispedisce ne\' altera la Ricetta Attiva', async () => {
      const { fake, client, recipe } = await setupWith(...muts);
      const before = snapshotOthers(fake);
      await new Promise(r => setTimeout(r, 5)); // l'ora corrente cambia tra caricamento e salvataggio
      editDraft(client, v => ({ ...v, note: 'solo bozza', ingredients: v.ingredients.map(i => i.name === 'Zucchero' ? { ...i, qty: 120 } : i) }));
      assert.strictEqual(await client.saveToSupabase(recipe()), true);
      editDraft(client, v => ({ ...v, note: 'solo bozza 2' }));
      assert.strictEqual(await client.saveToSupabase(recipe()), true);
      assert.ok(saves.every(s => s.variants.every(v => v.id === 'lvC')), 'solo la bozza nel payload');
      assert.ok(saves.every(s => s.ingredients.every(i => i.variant_id === 'lvC')));
      assert.deepStrictEqual(snapshotOthers(fake), before);
    });
  }
  await test('L4. tre cicli consecutivi carica -> salva con dati legacy: Ricette Attive identiche, tabelle stabili, nessun invio di versioni validate', async () => {
    const { fake } = await setupWith(shortIds, noValidatedAt, legacyNulls);
    const before = snapshotOthers(fake);
    let afterFirst = null;
    for (let k = 0; k < 3; k++) {
      const c = makeClient(handler); await c.loadFromSupabase(); await new Promise(r => setTimeout(r, 5));
      assert.strictEqual(await c.saveToSupabase(c.S.recipes.find(r => r.id === 'rC')), true);
      if (k === 0) afterFirst = clone({ v: fake.tables.variants, i: fake.tables.ingredients });
    }
    assert.deepStrictEqual(snapshotOthers(fake), before);
    assert.deepStrictEqual(clone({ v: fake.tables.variants, i: fake.tables.ingredients }), afterFirst, 'cicli 2 e 3 non cambiano nulla');
    assert.ok(saves.every(s => s.variants.every(v => v.id === 'lvC')));
  });
  await test('L5. modifica esplicita (Disattiva) di una Ricetta Attiva legacy: id corti conservati, validated_at resta assente', async () => {
    const { fake, client, recipe } = await setupWith(shortIds, noValidatedAt);
    const r = recipe(); r.validatedVariants = r.validatedVariants.map(v => v.id === 'vaC' ? { ...v, active: false } : v);
    assert.strictEqual(await client.saveToSupabase(r), true);
    assert.ok(saves[0].variants.some(v => v.id === 'vaC'));
    assert.strictEqual(dbVariant(fake, 'vaC').active, false);
    assert.strictEqual(dbVariant(fake, 'vaC').validated_at, null);
    assert.deepStrictEqual(dbIngs(fake, 'vaC').map(i => i.id), ['a0x', 'a1x', 'a2x']);
    assert.strictEqual(dbIngs(fake, 'vaC')[2].sub_recipe_id, 'vaF');
  });
  await test('L6. ingrediente senza id: id generato una sola volta e stabile tra salvataggi e riaperture', async () => {
    const { fake, client, recipe } = await setupWith();
    const r = recipe(); r.validatedVariants = r.validatedVariants.map(v => v.id === 'vaC' ? { ...v, ingredients: [...v.ingredients, { name: 'Sale', qty: 1, unit: 'g' }] } : v);
    await client.saveToSupabase(r);
    const id1 = dbIngs(fake, 'vaC').find(i => i.name === 'Sale').id;
    await client.saveToSupabase(r);
    const c2 = makeClient(handler); await c2.loadFromSupabase(); await c2.saveToSupabase(c2.S.recipes.find(x => x.id === 'rC'));
    const rows = dbIngs(fake, 'vaC').filter(i => i.name === 'Sale');
    assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].id, id1);
    assert.ok(!saves[1].variants.some(v => v.id === 'vaC'), 'secondo salvataggio senza modifiche: non rispedita');
  });
  await test('L7. nuova versione validata nata nel client: validated_at calcolato come prima (non NULL)', async () => {
    const { fake, client, recipe } = await setupWith(noValidatedAt);
    const r = recipe(); const v = r.labVersions[0];
    r.validatedVariants = [...r.validatedVariants, { id: v.id, name: v.name, status: 'approved', active: false, validatedAt: '10/10/2026', portionsCount: 10, gramsPerPortion: 80, ingredients: v.ingredients.map((i, k) => ({ ...i, id: 'vi_n' + k })), steps: v.steps, stepsV2: v.stepsV2, l2Items: [] }];
    r.labVersions = [];
    await client.saveToSupabase(r);
    assert.strictEqual(dbVariant(fake, 'lvC').validated_at, new Date('2026-10-10').toISOString());
    assert.strictEqual(dbVariant(fake, 'vaC').validated_at, null);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
