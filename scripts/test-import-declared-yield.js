/*
 * Test — Importazione della resa dichiarata (declared_yield_qty/unit).
 * Fonte -> estrazione (AI simulata) -> anteprima -> conferma dello chef ->
 * salvataggio -> rilettura -> LAB. Resa solo se dichiarata e citata dalla
 * fonte (verificata per testo e link, "da verificare" per foto e video);
 * persone -> porzioni; intervalli mai ridotti a un numero (minimo, massimo,
 * valore manuale o vuoto) e conservati nella nota della nuova bozza; rese
 * indipendenti per le sotto-ricette; Obiettivo di Produzione, ingredienti,
 * firme delle bozze e Ricette Attive invariati.
 *
 * Codice REALE estratto da khub_mvp.html (estrazione, anteprima, gestore del
 * pulsante, salvataggio, caricamento) e api/chat.js reale contro un finto
 * PostgREST con default SQL e trigger. Solo dati sintetici.
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
  // Importazione della resa dichiarata: dipendenze di estrazione, anteprima e salvataggio.
  'function escAttr(s)', 'function formatQtyDisplay(value)', 'function declaredYieldErrorMessage(error)', 'function importYieldText(t)',
  'function importDeclaredYield(raw,fonte)', 'function importYieldFields(value)', 'function importYieldNote(note,dy)', 'function renderImportYieldFields(dy,prefix,label)',
  // Percentuali dell'anteprima: pesi in grammi con le regole condivise.
  'function computeFormulationWeights(ingredients,resolveFact)', 'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)',
  'function resolveSessionScalingConversionToGrams(unit,conversionFact)', 'function chooseConversionAskUnit(unit)', 'function resolveKnownProductionConversionFact(normalizedName,unit)',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g), [html.match(/var IMPORT_YIELD_PORTION_ALIASES=\[[^\]]*\];/)[0], 
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

// Impronte prese da 58fca45 (FIX 2C + R1 in Production): queste funzioni non devono cambiare.
const PROTETTE = {
  "function firmaContenutoBozza(v)": "9426d786f4588837",
  "async function saveToSupabase(recipe)": "e3c83f1bdb507136",
  "async function loadFromSupabase()": "20cca9a5a143d96c",
  "function buildValidatedVariantPayload(recipeId,vv)": "4186aeae0c1330e6",
  "function declaredYieldFromRow(row)": "1a670be06f8aeba4",
  "function copyDeclaredYield(src)": "f990f25c54e140b4",
  "function declaredYieldPayload(v)": "70168f58328a1aaa",
  "function normalizeDeclaredYield(qty,unit)": "3804999344276047",
  "function onLabDeclaredYield(recipeId,field,value)": "7bbbd369b9438f26",
  "async function confirmActiveYieldEdit()": "92f6565ceacf884a",
  "function computeSessionScaling(input)": "ddfc1febb5010cdc",
  "async function createProductionSession(preparedInput)": "185ca85dcee49397",
  "function buildSessionSnapshotV1(meta,computed)": "1fd7615c172e0ce2",
  "function costruisciPayloadM2(recipeId, message, classification)": "9850def5ee757a1c",
  "async function runM1(recipeId)": "c65f22895bf0d242",
  "function importTargetValue(field,value)": "4043252f5e784f70",
  "function validateLabProductionTarget(field,value)": "fefbd04eed656496",
};

const dec = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function makeClient(fetchImpl, aiReply, tab = 'testo') {
  const log = { toasts: [], aiRequests: [] };
  const dom = {};
  const document = { getElementById: id => dom[id] || null, querySelectorAll: () => [], createElement: () => ({ querySelectorAll: () => [] }) };
  const routed = async (u, o) => {
    const body = JSON.parse(o.body);
    if (body.messages) { log.aiRequests.push(body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: typeof aiReply === 'string' ? aiReply : JSON.stringify(aiReply) }] }) }; }
    if (body.fetchUrl) return { ok: true, status: 200, json: async () => ({ html: null }) };
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
    ${extractFunction('function useImportYieldRange(prefix,qty,unit)')}
    ${SAVE_HANDLER}
    return {S, loadFromSupabase, saveToSupabase, extractRecipe, renderPreview, clickSavePreview, useImportYieldRange, firmaContenutoBozza};
  `)(routed, log, document, fn => fn());
  c.log = log; c.dom = dom;
  c.fillDomFromPreview = () => { // ogni campo dell'anteprima come lo vede il gestore
    const h = c.renderPreview();
    for (const m of h.matchAll(/<input[^>]*\sid="([^"]+)"[^>]*\svalue="([^"]*)"/g)) dom[m[1]] = { value: dec(m[2]) };
    dom['prev-cat'] = { value: (h.match(/<option selected>([^<]*)<\/option>/) || [, 'Altro'])[1] };
    return h;
  };
  // Pulsanti "Usa min/max" come nel browser: onclick con i data-attributi del pulsante.
  c.click = (h, cls, prefix) => {
    const re = new RegExp('<button[^>]*class="[^"]*' + cls + '"[^>]*data-qty="([^"]*)" data-unit="([^"]*)" onclick="useImportYieldRange\\(\'' + prefix + '\'');
    const m = h.match(re); assert.ok(m, 'pulsante ' + cls + ' ' + prefix);
    c.useImportYieldRange(prefix, dec(m[1]), dec(m[2]));
  };
  return c;
}
const tick = () => new Promise(r => setTimeout(r, 30));
const sha = s => require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 16);

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase'; process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let saves = [];
  const callApi = async body => { if (body.supabaseAction === 'save') saves.push(clone(body.data)); let st = 200, out; await realHandler({ method: 'POST', body }, { status(c) { st = c; return this; }, json(o) { out = o; return this; } }); return { st, out }; };
  const clientFetch = async (u, o) => { const r = await callApi(JSON.parse(o.body)); return { ok: r.st < 400, status: r.st, json: async () => r.out }; };
  let fake;
  const freshDb = () => { fake = withDbBehaviour((() => { const f = makeFakeSupabase(); seed(f); return f; })()); globalThis.fetch = fake.fetch; saves = []; };
  const ingr = [{ name: 'Farina', qty: 150, unit: 'g' }, { name: 'Uova', qty: 4, unit: 'n' }, { name: 'Latte', qty: 0.25, unit: 'l' }];
  const DY = (qty, unit, source, range = null) => ({ qty, unit, range, source });
  // Importa: fonte sintetica -> estrazione (AI simulata) -> anteprima -> azioni dello chef -> "Crea Scheda" -> DB -> rilettura.
  async function importa(aiReply, { text = 'Ricetta sintetica.', tab = 'testo', actions = c => {}, dest = null } = {}) {
    const c = makeClient(clientFetch, aiReply); await c.loadFromSupabase();
    c.S.loadTab = tab; c.S.loadText = text; c.S.loadUrl = tab === 'link' ? 'https://esempio.test/ricetta' : '';
    if (tab === 'foto') c.S.loadImageB64 = { mediaType: 'image/png', data: 'AAAA' };
    if (tab === 'video') c.S.loadVideoUrl = 'https://video.test/reel';
    if (dest) { c.S.loadDestinazione = 'esistente'; c.S.loadDestinazioneSchedaId = dest; }
    await c.extractRecipe();
    const h = c.fillDomFromPreview();
    const shown = p => [c.dom[p + '-qty'] ? c.dom[p + '-qty'].value : null, c.dom[p + '-unit'] ? c.dom[p + '-unit'].value : null];
    const view = { main: shown('prev-yield'), sr: (c.S.loadPreview.subRecipes || []).map((s, i) => shown('prev-sr-yield-' + i)) };
    const before = new Set(fake.tables.variants.map(v => v.id)), beforeRows = clone(fake.tables.variants);
    actions(c, h);
    c.clickSavePreview(); await tick();
    const nuove = fake.tables.variants.filter(v => !before.has(v.id));
    const byName = n => { const rec = fake.tables.recipes.find(r => r.name === n); return rec && nuove.find(v => v.recipe_id === rec.id); };
    const c2 = makeClient(clientFetch, aiReply); await c2.loadFromSupabase();
    const lab = row => { const rec = c2.S.recipes.find(x => x.id === row.recipe_id); return rec.labVersions.find(v => v.id === row.id); };
    return { c, c2, h, view, nuove, byName, lab, beforeRows, payload: saves.flatMap(s => s.variants || []).filter(v => !before.has(v.id)), ingRows: id => fake.tables.ingredients.filter(i => i.variant_id === id).map(i => [i.name, i.qty, i.unit]) };
  }
  const ai = extra => ({ name: 'Bignè IMPORT', category: 'Dolci', portionsCount: null, gramsPerPortion: null, ingredients: ingr, steps: ['Impastare'], ...extra });
  const quote = h => (h.match(/Dalla fonte: «([^»]*)»/) || [])[1];

  console.log('Importazione della resa dichiarata');

  await test('R1. resa dichiarata nella fonte: anteprima con quantita\', unita\' e citazione; salvataggio e rilettura; Obiettivo e ingredienti invariati', async () => {
    const CASI = [
      ['Pasta frolla. Per 6 persone. Farina 150 g.', DY(6, 'persone', 'Per 6 persone'), ['6', 'porzioni'], [6, 'porzioni']],
      ['Bignè: produce 30 bignè.', DY(30, 'bignè', 'produce 30 bignè'), ['30', 'bignè'], [30, 'bignè']],
      ['Focaccia per 2 teglie.', DY('2', 'teglie', 'per 2 teglie'), ['2', 'teglie'], [2, 'teglie']],
      ['Pane: produce 4 filoni da 500 g.', DY(4, 'filoni', 'produce 4 filoni'), ['4', 'filoni'], [4, 'filoni']],
      ['Crema: circa 1,2 kg di crema.', DY('1,2', 'KG', '1,2 kg di crema'), ['1.2', 'kg'], [1.2, 'kg']],
      ['Serves 6 people.', DY(6, 'servings', 'Serves 6 people'), ['6', 'porzioni'], [6, 'porzioni']],
    ];
    for (const [text, dy, shown, saved] of CASI) {
      freshDb();
      const r = await importa(ai({ declaredYield: dy }), { text });
      assert.deepStrictEqual(r.view.main, shown, text + ' anteprima');
      assert.strictEqual(quote(r.h), dy.source, 'citazione');
      const row = r.nuove[0];
      assert.deepStrictEqual([row.declared_yield_qty, row.declared_yield_unit], saved, text + ' DB');
      assert.deepStrictEqual([r.lab(row).declaredYieldQty, r.lab(row).declaredYieldUnit], saved, text + ' LAB dopo la rilettura');
      assert.deepStrictEqual([row.portions_count, row.grams_per_portion], [0, 0], 'Obiettivo di Produzione non impostato (D1)');
      assert.deepStrictEqual(r.ingRows(row.id), [['Farina', 150, 'g'], ['Uova', 4, 'n'], ['Latte', 0.25, 'l']], 'ingredienti invariati');
      assert.strictEqual(row.note, 'Importata', 'nessuna nota senza intervallo');
    }
  });

  await test('R2. nessuna resa inventata: assente, senza citazione, citazione non presente nella fonte, link senza testo letto', async () => {
    const CASI = [
      ['assente', ai({}), {}], ['null', ai({ declaredYield: null }), {}],
      ['senza citazione', ai({ declaredYield: DY(30, 'bignè', null) }), {}],
      ['dedotta dagli ingredienti', ai({ declaredYield: DY(404, 'g', 'totale circa 404 g') }), { text: 'Farina 150 g, uova 4, latte 250 ml.' }],
      ['link senza testo', ai({ declaredYield: DY(30, 'bignè', 'produce 30 bignè') }), { tab: 'link' }],
    ];
    for (const [nome, reply, opt] of CASI) {
      freshDb();
      const r = await importa(reply, opt);
      assert.deepStrictEqual(r.view.main, ['', ''], nome + ' anteprima vuota');
      assert.ok(!('declared_yield_qty' in r.payload[0]) && !('declared_yield_unit' in r.payload[0]), nome + ': chiavi non inviate');
      assert.deepStrictEqual([r.nuove[0].declared_yield_qty ?? null, r.nuove[0].declared_yield_unit ?? null], [null, null], nome + ' DB');
    }
  });

  await test('R3. foto e video: resa proposta "da verificare"; testo e link verificati non lo sono', async () => {
    for (const tab of ['foto', 'video']) {
      freshDb();
      const r = await importa(ai({ declaredYield: DY(30, 'bignè', 'Produce 30 bignè') }), { tab });
      assert.deepStrictEqual(r.view.main, ['30', 'bignè']);
      assert.ok(r.h.includes('<strong class="import-yield-verify">da verificare</strong>'), tab);
      assert.deepStrictEqual([r.nuove[0].declared_yield_qty, r.nuove[0].declared_yield_unit], [30, 'bignè'], tab + ' confermata al salvataggio');
    }
    freshDb();
    const t = await importa(ai({ declaredYield: DY(30, 'bignè', 'Produce 30 bignè') }), { text: 'Produce 30 bignè.' });
    assert.ok(!t.h.includes('da verificare'));
  });

  await test('R4. intervalli: nessun numero scelto; pulsanti minimo/massimo, valore manuale o vuoto; nota con l\'intervallo originale', async () => {
    const FONTI = [
      ['Per 4–6 persone.', DY(null, 'persone', 'Per 4–6 persone', { min: 4, max: 6 }), '4–6 porzioni', 'porzioni', 4, 6],
      ['Produce 20-24 bignè.', DY(null, 'bignè', 'Produce 20-24 bignè', { min: 20, max: 24 }), '20–24 bignè', 'bignè', 20, 24],
      ['Dosi da 4 a 6 persone.', DY(null, 'persone', 'da 4 a 6 persone', { min: '4', max: '6' }), '4–6 porzioni', 'porzioni', 4, 6],
    ];
    for (const [text, dy, label, unit, min, max] of FONTI) {
      for (const [scelta, act, exp] of [
        ['vuota', () => {}, [null, null]],
        ['minimo', (c, h) => c.click(h, 'import-yield-min', 'prev-yield'), [min, unit]],
        ['massimo', (c, h) => c.click(h, 'import-yield-max', 'prev-yield'), [max, unit]],
        ['manuale', c => { c.dom['prev-yield-qty'].value = '5'; c.dom['prev-yield-unit'].value = unit; }, [5, unit]],
      ]) {
        freshDb();
        const r = await importa(ai({ declaredYield: dy }), { text, actions: act });
        const k = text + ' ' + scelta;
        assert.deepStrictEqual(r.view.main, ['', ''], k + ': nessun numero scelto automaticamente');
        assert.ok(r.h.includes('la fonte indica un intervallo') && r.h.includes('>Usa ' + min + ' ' + unit + '</button>') && r.h.includes('>Usa ' + max + ' ' + unit + '</button>'), k + ' pulsanti');
        const row = r.nuove[0];
        assert.deepStrictEqual([row.declared_yield_qty ?? null, row.declared_yield_unit ?? null], exp, k + ' DB');
        assert.strictEqual(row.note, 'Importata · Resa nella fonte (intervallo): ' + label + ' — «' + dy.source + '»', k + ' nota');
        assert.deepStrictEqual([row.portions_count, row.grams_per_portion], [0, 0], k + ': Obiettivo non toccato');
      }
    }
    for (const bad of [{ min: 6, max: 4 }, { min: 4, max: 4 }, { min: 0, max: 6 }, { min: 'x', max: 6 }]) {
      freshDb();
      const r = await importa(ai({ declaredYield: DY(null, 'persone', 'Per 4-6 persone', bad) }), { text: 'Per 4-6 persone.' });
      assert.ok(!r.h.includes('intervallo') && r.nuove[0].note === 'Importata', JSON.stringify(bad) + ' ignorato');
    }
    freshDb();
    const f = await importa(ai({ declaredYield: DY(null, 'persone', 'Per 4-6 persone', { min: 4, max: 6 }) }), { tab: 'foto' });
    assert.ok(f.nuove[0].note.endsWith(' — da verificare'), 'foto: intervallo da verificare nella nota');
  });

  await test('R5. anteprima: lo chef corregge, conferma o cancella; valori non validi bloccano il salvataggio', async () => {
    const base = ai({ declaredYield: DY(30, 'bignè', 'produce 30 bignè') }), text = 'Bignè: produce 30 bignè.';
    for (const [nome, act, exp] of [['conferma', () => {}, [30, 'bignè']], ['corregge', c => { c.dom['prev-yield-qty'].value = '28'; }, [28, 'bignè']],
      ['cancella', c => { c.dom['prev-yield-qty'].value = ''; c.dom['prev-yield-unit'].value = ''; }, [null, null]]]) {
      freshDb();
      const r = await importa(base, { text, actions: act });
      assert.deepStrictEqual([r.nuove[0].declared_yield_qty ?? null, r.nuove[0].declared_yield_unit ?? null], exp, nome);
    }
    for (const [q, u, msg] of [['0', 'bignè', /maggiore di zero/], ['30', '', /unità della resa/], ['', 'bignè', /quantità della resa/], ['3', 'oz', /non supportata/], ['3', 'x'.repeat(41), /troppo lunga/]]) {
      freshDb();
      const r = await importa(base, { text, actions: c => { c.dom['prev-yield-qty'].value = q; c.dom['prev-yield-unit'].value = u; } });
      assert.strictEqual(r.nuove.length, 0, q + '/' + u + ': nulla salvato');
      assert.ok(msg.test(r.c.log.toasts.join(' ')), 'messaggio ' + msg);
    }
    freshDb();
    const oz = await importa(ai({ declaredYield: DY(16, 'oz', '16 oz') }), { text: 'Makes 16 oz.' });
    assert.deepStrictEqual(oz.view.main, ['16', 'oz'], 'non valida: mostrata per la correzione');
    assert.strictEqual(oz.nuove.length, 0, 'e non salvata finche\' lo chef non corregge');
  });

  await test('R6. sotto-ricette: rese indipendenti (propria, assente, intervallo); errore indicato per nome', async () => {
    const text = 'Bignè: produce 30 bignè. Crema: dosi per 500 g. Glassa: per 20-24 bignè.';
    const reply = ai({ declaredYield: DY(30, 'bignè', 'produce 30 bignè'), subRecipes: [
      { name: 'Crema IMPORT', declaredYield: DY(500, 'g', 'dosi per 500 g'), ingredients: [{ name: 'Latte', qty: 0.5, unit: 'l' }], steps: [] },
      { name: 'Pasta IMPORT', declaredYield: null, ingredients: [{ name: 'Burro', qty: 100, unit: 'g' }], steps: [] },
      { name: 'Glassa IMPORT', declaredYield: DY(null, 'bignè', 'per 20-24 bignè', { min: 20, max: 24 }), ingredients: [{ name: 'Zucchero', qty: 200, unit: 'g' }], steps: [] },
    ] });
    freshDb();
    let r = await importa(reply, { text, actions: (c, h) => { c.click(h, 'import-yield-max', 'prev-sr-yield-2'); c.dom['prev-sr-yield-0-qty'].value = '450'; } });
    assert.deepStrictEqual(r.view.sr, [['500', 'g'], ['', ''], ['', '']]);
    const y = n => { const v = r.byName(n); return [v.declared_yield_qty ?? null, v.declared_yield_unit ?? null, v.note, v.portions_count, v.grams_per_portion]; };
    assert.deepStrictEqual(y('Bignè IMPORT'), [30, 'bignè', 'Importata', 0, 0]);
    assert.deepStrictEqual(y('Crema IMPORT'), [450, 'g', 'Da Bignè IMPORT', 0, 0], 'corretta solo la crema');
    assert.deepStrictEqual(y('Pasta IMPORT'), [null, null, 'Da Bignè IMPORT', 0, 0]);
    assert.deepStrictEqual(y('Glassa IMPORT'), [24, 'bignè', 'Da Bignè IMPORT · Resa nella fonte (intervallo): 20–24 bignè — «per 20-24 bignè»', 0, 0]);
    freshDb();
    r = await importa(reply, { text, actions: c => { c.dom['prev-sr-yield-1-qty'].value = '3'; } });
    assert.strictEqual(r.nuove.length, 0);
    assert.ok(r.c.log.toasts.join(' ').startsWith('Pasta IMPORT: '), 'errore con il nome della sotto-ricetta');
  });

  await test('R7. firme delle bozze: con resa la firma la include dal primo salvataggio; senza resa e\' identica a oggi; nessun aggiornamento spurio', async () => {
    for (const [nome, reply, text, conResa] of [['con resa', ai({ declaredYield: DY(30, 'bignè', 'produce 30 bignè') }), 'produce 30 bignè', true], ['senza resa', ai({}), 'x', false]]) {
      freshDb();
      const r = await importa(reply, { text });
      const row = r.nuove[0], lab = r.lab(row);
      assert.strictEqual(row.contenuto_hash, r.c2.firmaContenutoBozza(lab), nome + ': firma salvata = firma della bozza riletta');
      assert.strictEqual(row.contenuto_hash.includes('resa\u0001'), conResa, nome);
      const { declaredYieldQty, declaredYieldUnit, ...senza } = lab;
      if (!conResa) assert.strictEqual(row.contenuto_hash, r.c2.firmaContenutoBozza(senza), 'identica alla firma di una bozza senza resa');
      const prima = [row.contenuto_hash, row.contenuto_modificato_il];
      for (let k = 0; k < 2; k++) { const c = makeClient(clientFetch, reply); await c.loadFromSupabase(); for (const rec of c.S.recipes) await c.saveToSupabase(rec); }
      assert.deepStrictEqual([row.contenuto_hash, row.contenuto_modificato_il], prima, nome + ': nessun aggiornamento spurio');
    }
  });

  await test('R8. Scheda esistente: solo la nuova bozza riceve resa e nota; Ricette Attive e altre versioni intatte', async () => {
    freshDb();
    const r = await importa(ai({ declaredYield: DY(null, 'persone', 'per 4-6 persone', { min: 4, max: 6 }) }), { text: 'Dosi per 4-6 persone.', dest: 'rT', actions: (c, h) => c.click(h, 'import-yield-min', 'prev-yield') });
    assert.strictEqual(r.nuove.length, 1); assert.strictEqual(r.nuove[0].recipe_id, 'rT');
    assert.deepStrictEqual([r.nuove[0].declared_yield_qty, r.nuove[0].declared_yield_unit], [4, 'porzioni']);
    // Attive, validate e ritirate: identiche in tutto. Bozze esistenti: identiche salvo la prima
    // registrazione della firma mancante (contenuto_hash null), gia' prevista da FIX 2B a ogni
    // salvataggio della Scheda e indipendente dalla resa.
    for (const v of r.beforeRows) {
      const now = fake.tables.variants.find(x => x.id === v.id);
      if (v.status !== 'lab' || v.contenuto_hash != null) { assert.deepStrictEqual(now, v, 'invariata: ' + v.id); continue; }
      const { contenuto_hash: h1, contenuto_modificato_il: d1, ...a } = v, { contenuto_hash: h2, contenuto_modificato_il: d2, ...b } = now;
      assert.deepStrictEqual(b, a, 'bozza invariata: ' + v.id);
    }
    assert.ok(r.beforeRows.some(v => v.status !== 'lab' && v.active === true), 'il seed contiene Ricette Attive');
  });

  await test('R9. codice: istruzioni all\'AI; firma, motore, Sessioni, salvataggio, LAB e MichelinAI invariati', async () => {
    const prompt = extractFunction('async function extractRecipe()').match(/const PROMPT=`([^`]*)`/)[1];
    assert.strictEqual((prompt.match(/"declaredYield":\{"qty":null,"unit":null,"range":null,"source":null\}/g) || []).length, 2, 'ricetta e sotto-ricette');
    assert.ok(prompt.includes('"per 6 persone") in porzioni o grammi per porzione') && prompt.includes('non scegliere un numero') && prompt.includes('senza tradurla'));
    assert.ok(prompt.includes('"portionsCount":null,"gramsPerPortion":null'));
    for (const [m, h] of Object.entries(PROTETTE)) assert.strictEqual(sha(extractFunction(m)), h, 'cambiato: ' + m);
    assert.ok(!/portionsCount|gramsPerPortion/.test(extractFunction('function importDeclaredYield(raw,fonte)')), 'la resa non tocca l\'Obiettivo');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
