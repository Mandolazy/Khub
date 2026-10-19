/*
 * Test — LAB FIX 2C / C5: importazione delle ricette senza valori inventati.
 * Porzioni e G/porzione solo se presenti e validi nella fonte (Porzioni intero
 * positivo, G/porzione numero positivo); altrimenti 0 = non impostato, vuoto
 * in anteprima, inviato esplicitamente come 0 (mai i default SQL 4/200).
 * Nessuna somma di ingredienti nelle sotto-ricette; una resa dichiarata
 * ("30 bignè") non diventa mai Porzioni o G/porzione.
 *
 * Percorso completo con codice REALE estratto da khub_mvp.html (estrazione,
 * anteprima, gestore del pulsante, salvataggio, caricamento) e api/chat.js
 * reale contro un finto PostgREST che riproduce i default SQL. Risposte AI
 * sintetiche, solo dati sintetici.
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
  'function validateLabProductionTarget(field,value)', 'function importTargetValue(field,value)', 'function labTargetInputValue(value)',
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)', 'function isBetterConversionFact(candidate,current)',
  'function buildKnownIngredientIds(ingredientRows)', 'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)', 'async function loadFromSupabase()',
  'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)', 'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)',
  'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
  'async function extractRecipe()', 'function savePreview()', 'function renderPreview()',
].map(extractFunction).concat([
  html.match(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/)[0], html.match(/var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/)[0],
  html.match(/var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/)[0], html.match(/var LAB_TARGET_PORTIONS_MAX=\d+;/)[0], html.match(/const UNITS = \[[^\]]*\];/)[0],
]).join('\n');
// Gestore REALE del pulsante "Crea Scheda" dell'anteprima, preso da bindEvents.
function extractSaveHandler() {
  const marker = "if(btnSavePreview)btnSavePreview.addEventListener('click',()=>{";
  const s = html.indexOf(marker); if (s === -1) throw new Error('gestore anteprima non trovato');
  const b = s + marker.length - 1; let d = 0;
  for (let i = b; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}') { d--; if (!d) return 'function clickSavePreview()' + html.slice(b, i + 1); } }
}
const SAVE_HANDLER = extractSaveHandler();

function makeClient(fetchImpl, aiReply) {
  const log = { toasts: [], aiRequests: [] };
  const dom = {};
  const document = { getElementById: id => dom[id] || null, querySelectorAll: () => [], createElement: () => ({ querySelectorAll: () => [] }) };
  const routed = async (u, o) => {
    const body = JSON.parse(o.body);
    if (body.messages) { log.aiRequests.push(body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: typeof aiReply === 'string' ? aiReply : JSON.stringify(aiReply) }] }) }; }
    return fetchImpl(u, o);
  };
  const c = new Function('fetch', 'log', 'document', 'setTimeout', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{},pendingFamilies:[],
      loadTab:'testo',loadText:'',loadUrl:'',loadVideoUrl:'',loadImageB64:null,loadImagePreviewUrl:null,loadPreview:null,isLoading:false,view:'load',
      loadDestinazione:'nuova',loadDestinazioneSchedaId:null};
    var _knownIngredientIdsByVariant={}; var _persistedValidatedSig={}; var _saveLocked=false, _saveTimer={};
    function render(){} function autosave(){} function toast(m){log.toasts.push(m);}
    function confirm(){return true;} function addHistory(){} function suggestFamilies(){return [];} async function saveFamilies(){}
    ${SRC}
    ${SAVE_HANDLER}
    return {S, loadFromSupabase, saveToSupabase, extractRecipe, savePreview, renderPreview, clickSavePreview};
  `)(routed, log, document, fn => fn());
  c.log = log; c.dom = dom;
  // Campi dell'anteprima come li vede il gestore: valori letti dall'HTML reso.
  c.fillDomFromPreview = () => {
    const h = c.renderPreview();
    for (const id of ['prev-name', 'prev-portions', 'prev-gpp']) { const m = h.match(new RegExp('id="' + id + '" value="([^"]*)"')); dom[id] = { value: m ? m[1] : '' }; }
    dom['prev-cat'] = { value: (h.match(/<option selected>([^<]*)<\/option>/) || [, 'Altro'])[1] };
    return h;
  };
  return c;
}
const tick = () => new Promise(r => setTimeout(r, 30));

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase'; process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let saves = [];
  const callApi = async body => { if (body.supabaseAction === 'save') saves.push(clone(body.data)); let st = 200, out; await realHandler({ method: 'POST', body }, { status(c) { st = c; return this; }, json(o) { out = o; return this; } }); return { st, out }; };
  const clientFetch = async (u, o) => { const r = await callApi(JSON.parse(o.body)); return { ok: r.st < 400, status: r.st, json: async () => r.out }; };
  let fake;
  const freshDb = () => { fake = withDbBehaviour((() => { const f = makeFakeSupabase(); seed(f); return f; })()); globalThis.fetch = fake.fetch; saves = []; };
  const ingr = [{ name: 'Farina', qty: 500, unit: 'g' }, { name: 'Burro', qty: 250, unit: 'g' }];
  // Importa: estrazione AI (risposta sintetica) -> anteprima -> eventuali modifiche -> "Crea Scheda" -> DB -> rilettura.
  async function importa(aiReply, edits = {}, dest = null) {
    const c = makeClient(clientFetch, aiReply); await c.loadFromSupabase();
    c.S.loadText = 'Ricetta sintetica di prova';
    if (dest) { c.S.loadDestinazione = 'esistente'; c.S.loadDestinazioneSchedaId = dest; }
    await c.extractRecipe();
    const preview = clone(c.S.loadPreview);
    const h = c.fillDomFromPreview();
    const shown = [c.dom['prev-portions'].value, c.dom['prev-gpp'].value];
    for (const [k, v] of Object.entries(edits)) c.dom[k].value = v;
    const before = new Set(fake.tables.variants.map(v => v.id));
    c.clickSavePreview(); await tick();
    const nuove = fake.tables.variants.filter(v => !before.has(v.id));
    const c2 = makeClient(clientFetch, aiReply); await c2.loadFromSupabase();
    const riletti = nuove.map(r => { const rec = c2.S.recipes.find(x => x.id === r.recipe_id); const lv = rec.labVersions.find(v => v.id === r.id); return [lv.portionsCount, lv.gramsPerPortion]; });
    return { c, c2, preview, html: h, shown, nuove, db: nuove.map(r => [r.portions_count, r.grams_per_portion]), riletti, savedPayload: saves.flatMap(s => s.variants || []).filter(v => !before.has(v.id)) };
  }
  const ai = extra => ({ name: 'Frolla IMPORT', category: 'Dolci', ingredients: ingr, steps: ['Impastare'], ...extra });

  console.log('LAB FIX 2C — C5: importazione senza valori inventati');

  await test('I1. Porzioni e G/porzione presenti nella fonte: anteprima, salvataggio e rilettura con gli stessi valori', async () => {
    for (const [p, g, expP, expG] of [[12, 85.5, 12, 85.5], ['12', '85,5', 12, 85.5], [4, 200, 4, 200]]) {
      freshDb();
      const r = await importa(ai({ portionsCount: p, gramsPerPortion: g }));
      assert.deepStrictEqual(r.shown, [String(expP), String(expG)], p + '/' + g + ' anteprima');
      assert.deepStrictEqual(r.db, [[expP, expG]], 'DB');
      assert.deepStrictEqual(r.riletti, [[expP, expG]], 'rilettura');
    }
  });

  await test('I2. solo Porzioni / solo G/porzione / nessuno: il campo mancante e\' vuoto in anteprima e 0 esplicito nel salvataggio (mai default SQL 4/200)', async () => {
    for (const [extra, shown, exp] of [
      [{ portionsCount: 12, gramsPerPortion: null }, ['12', ''], [12, 0]],
      [{ portionsCount: 12 }, ['12', ''], [12, 0]],
      [{ portionsCount: null, gramsPerPortion: 85.5 }, ['', '85.5'], [0, 85.5]],
      [{ gramsPerPortion: '85,5' }, ['', '85.5'], [0, 85.5]],
      [{ portionsCount: null, gramsPerPortion: null }, ['', ''], [0, 0]],
      [{}, ['', ''], [0, 0]],
    ]) {
      freshDb();
      const r = await importa(ai(extra));
      const k = JSON.stringify(extra);
      assert.deepStrictEqual(r.shown, shown, k + ' anteprima');
      assert.deepStrictEqual(r.db, [exp], k + ' DB');
      assert.deepStrictEqual(r.riletti, [exp], k + ' rilettura');
      assert.ok(r.savedPayload.length === 1 && 'portions_count' in r.savedPayload[0] && 'grams_per_portion' in r.savedPayload[0], 'chiavi sempre inviate');
      assert.deepStrictEqual([r.savedPayload[0].portions_count, r.savedPayload[0].grams_per_portion], exp, 'payload');
      assert.deepStrictEqual(fake.inserted.filter(id => r.nuove.some(n => n.id === id)).length, 1, 'riga nuova');
    }
  });

  await test('I3. valori non validi dalla fonte: Porzioni solo intero positivo, G/porzione solo numero positivo; il resto non impostato', async () => {
    const CASI = [
      [{ portionsCount: 12.5, gramsPerPortion: -3 }, [0, 0]], [{ portionsCount: 0, gramsPerPortion: 0 }, [0, 0]], [{ portionsCount: '4 persone', gramsPerPortion: '200 g' }, [0, 0]],
      [{ portionsCount: 'abc', gramsPerPortion: '' }, [0, 0]], [{ portionsCount: -4, gramsPerPortion: 'Infinity' }, [0, 0]], [{ portionsCount: true, gramsPerPortion: {} }, [0, 0]],
      [{ portionsCount: [12], gramsPerPortion: [85] }, [0, 0]], [{ portionsCount: '12.0', gramsPerPortion: '0,5' }, [12, 0.5]], [{ portionsCount: 1e12, gramsPerPortion: 85.5 }, [0, 85.5]],
    ];
    for (const [extra, exp] of CASI) {
      freshDb();
      const r = await importa(ai(extra));
      const k = JSON.stringify(extra);
      assert.deepStrictEqual([r.preview.portionsCount, r.preview.gramsPerPortion], exp, k + ' anteprima (dati)');
      assert.deepStrictEqual(r.shown, exp.map(x => x ? String(x) : ''), k + ' anteprima (campi)');
      assert.deepStrictEqual(r.db, [exp], k + ' DB');
    }
  });

  await test('I4. fonte con sola resa dichiarata ("30 bignè"): nessun trasferimento in Porzioni o G/porzione; resa dichiarata non toccata', async () => {
    freshDb();
    const r = await importa(ai({ name: 'Bignè IMPORT', yield: '30 bignè', resa: '30 bignè', portionsCount: null, gramsPerPortion: null }));
    assert.deepStrictEqual(r.shown, ['', '']);
    assert.deepStrictEqual(r.db, [[0, 0]]);
    assert.ok(!('declared_yield_qty' in r.savedPayload[0]) && !('declared_yield_unit' in r.savedPayload[0]), 'resa dichiarata: comportamento esistente invariato (non importata)');
    const prompt = r.c.log.aiRequests[0].messages[0].content;
    assert.ok(/SOLO se la fonte li riporta esplicitamente/.test(prompt) && /usa null/.test(prompt) && /30 bignè/.test(prompt), 'istruzioni all\'AI');
  });

  await test('I5. sotto-ricette con unita\' diverse: nessuna somma come G/porzione, nessun 1 porzione inventato', async () => {
    freshDb();
    const r = await importa(ai({ portionsCount: 12, gramsPerPortion: 85.5, subRecipes: [
      { name: 'Crema IMPORT', ingredients: [{ name: 'Latte', qty: 0.5, unit: 'l' }, { name: 'Tuorli', qty: 4, unit: 'n' }, { name: 'Zucchero', qty: 150, unit: 'g' }], steps: ['Cuocere'] },
      { name: 'Glassa IMPORT', ingredients: [{ name: 'Zucchero a velo', qty: 200, unit: 'g' }, { name: 'Acqua', qty: 2, unit: 'tbsp' }], steps: [], portionsCount: 6, gramsPerPortion: '20' },
    ] }));
    const by = name => { const row = r.nuove.find(v => fake.tables.recipes.find(x => x.id === v.recipe_id).name === name); return [row.portions_count, row.grams_per_portion]; };
    assert.strictEqual(r.nuove.length, 3);
    assert.deepStrictEqual(by('Frolla IMPORT'), [12, 85.5]);
    assert.deepStrictEqual(by('Crema IMPORT'), [0, 0], 'niente 154,5 g o 1 porzione');
    assert.deepStrictEqual(by('Glassa IMPORT'), [6, 20], 'valori presenti e validi nella fonte conservati');
    assert.deepStrictEqual(r.riletti.slice().sort(), [[0, 0], [12, 85.5], [6, 20]].sort());
  });

  await test('I6. anteprima modificata dallo chef: vuoto = non impostato; valori non validi bloccano il salvataggio con un messaggio', async () => {
    freshDb();
    let r = await importa(ai({ portionsCount: 12, gramsPerPortion: 85.5 }), { 'prev-portions': '8', 'prev-gpp': '' });
    assert.deepStrictEqual(r.db, [[8, 0]]);
    for (const [edits, msg] of [[{ 'prev-portions': '12.5' }, /Porzioni/], [{ 'prev-portions': '0' }, /Porzioni/], [{ 'prev-gpp': '-1' }, /G\/porzione/], [{ 'prev-gpp': 'abc' }, /G\/porzione/]]) {
      freshDb();
      r = await importa(ai({ portionsCount: 12, gramsPerPortion: 85.5 }), edits);
      assert.strictEqual(r.nuove.length, 0, JSON.stringify(edits) + ': nulla salvato');
      assert.ok(msg.test(r.c.log.toasts.join(' ')), 'messaggio');
      assert.ok(r.c.S.loadPreview, 'anteprima ancora aperta');
    }
  });

  await test('I7. importazione in una Scheda esistente: nuova bozza senza valori inventati; Ricetta attiva e altre versioni intatte', async () => {
    freshDb();
    const prima = clone(fake.tables.variants);
    const r = await importa(ai({}), {}, 'rT');
    assert.deepStrictEqual(r.db, [[0, 0]]);
    assert.strictEqual(r.nuove[0].recipe_id, 'rT');
    for (const v of prima) assert.deepStrictEqual([v.portions_count, v.grams_per_portion, v.status, v.active], (({ portions_count, grams_per_portion, status, active }) => [portions_count, grams_per_portion, status, active])(fake.tables.variants.find(x => x.id === v.id)), v.id);
  });

  await test('I8. codice: nessun 4/200 nei percorsi di importazione e nelle istruzioni all\'AI', async () => {
    const code = ['async function extractRecipe()', 'function savePreview()', 'function renderPreview()'].map(extractFunction).join('\n') + SAVE_HANDLER;
    assert.ok(!/\|\|\s*4\b|\|\|\s*200\b/.test(code), 'nessun valore automatico');
    assert.ok(!/reduce\(/.test(extractFunction('function savePreview()')), 'nessuna somma di ingredienti nel salvataggio');
    const prompt = extractFunction('async function extractRecipe()').match(/const PROMPT=`([^`]*)`/)[1];
    assert.ok(!/"portionsCount":\s*\d|"gramsPerPortion":\s*\d/.test(prompt), 'nessun esempio numerico');
    assert.ok(prompt.includes('"portionsCount":null,"gramsPerPortion":null'));
    // Campi di testo come nel LAB (C2): un valore non numerico arriva al gestore e viene rifiutato, non letto come vuoto.
    const prev = extractFunction('function renderPreview()');
    assert.ok(prev.includes('type="text" inputmode="numeric" autocomplete="off" id="prev-portions"') && prev.includes('type="text" inputmode="decimal" autocomplete="off" id="prev-gpp"'));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
