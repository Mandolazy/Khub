/*
 * Test — Importazione: percentuali dell'anteprima.
 * Quote del peso a crudo dopo le conversioni, calcolate con
 * computeFormulationWeights (non modificata), mai sommando quantita' in unita'
 * diverse; al massimo un decimale. Pesi di riferimento non confermati =
 * percentuali stimate; conversioni mancanti = "—" con l'elenco; dati non
 * validi = "—". Nomi protetti nelle note; dati e salvataggio invariati; resa
 * dichiarata dell'anteprima ancora funzionante. Dopo una modifica di quantita'
 * o unita' le percentuali diventano "—" con un unico messaggio (solo visivo).
 *
 * Codice REALE estratto da khub_mvp.html e api/chat.js contro un finto
 * PostgREST. Solo dati sintetici.
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
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)',
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
  const KNOW = { unitWeights: { uova: 55, tuorli: 20 }, unitWeightFacts: { tuorli: { id: 'fT', sourceType: 'chef_confirmed', sourceDetail: null } },
    productionConversionFacts: { 'latte intero|ml|g': { id: 'fL', factor: 1.03, sourceType: 'chef_confirmed', sourceDetail: null } } };
  const I = (name, qty, unit) => ({ name, qty, unit });
  // Anteprima reale: estrazione con risposta AI sintetica e conversioni caricate come all'avvio dell'app.
  async function anteprima(ingredients, extra = {}) {
    freshDb();
    const c = makeClient(clientFetch, { name: 'Prova PESI', category: 'Dolci', portionsCount: null, gramsPerPortion: null, ingredients, steps: ['Mescolare'], ...extra });
    await c.loadFromSupabase(); Object.assign(c.S, clone(KNOW));
    c.S.loadTab = 'testo'; c.S.loadText = extra.text || 'Testo sintetico.';
    await c.extractRecipe();
    const prima = JSON.stringify(c.S.loadPreview);
    const h = c.renderPreview();
    assert.strictEqual(JSON.stringify(c.S.loadPreview), prima, 'il disegno dell\'anteprima non modifica i dati');
    return { c, h, cells: [...h.matchAll(/<span class="preview-ing-pct"[^>]*>([^<]*)<\/span>/g)].map(m => m[1]),
      note: (h.match(/<div class="preview-weights-note"[^>]*>([\s\S]*?)<\/div>/) || [, null])[1] };
  }
  console.log('Importazione — percentuali dell\'anteprima');

  await test('P1. peso a crudo dopo le conversioni, al massimo un decimale senza zeri superflui; mai somme di unita\' diverse', async () => {
    const CASI = [
      ['massa (g, kg)', [I('Farina', 500, 'g'), I('Burro', 0.3, 'kg')], ['62.5%', '37.5%'], ['100%', '0%']],
      ['pezzi con peso confermato', [I('Farina', 150, 'g'), I('Tuorli', 4, 'n')], ['65.2%', '34.8%'], ['97%', '3%']],
      ['volume con conversione', [I('Zucchero', 150, 'g'), I('Latte intero', 800, 'ml')], ['15.4%', '84.6%'], ['16%', '84%']],
      ['interi', [I('Farina', 100, 'g'), I('Zucchero', 0.1, 'kg')], ['50%', '50%'], ['100%', '0%']],
    ];
    for (const [nome, ings, exp, vecchie] of CASI) {
      const r = await anteprima(ings);
      assert.deepStrictEqual(r.cells, exp, nome);
      assert.strictEqual(r.note, null, nome + ': nessuna nota');
      assert.notDeepStrictEqual(r.cells, vecchie, nome + ': non sono piu\' le percentuali per unita\' miste');
    }
  });

  await test('P2. pesi di riferimento non confermati: ingrediente marcato e percentuali dichiarate stimate', async () => {
    const r = await anteprima([I('Farina', 150, 'g'), I('Uova', 4, 'n')]);
    assert.deepStrictEqual(r.cells, ['40.5%', '59.5% *']);
    assert.strictEqual(r.note, 'Percentuali stimate: pesi di riferimento non confermati per * Uova (n).');
  });

  await test('P3. conversioni mancanti: "—" e conversioni elencate; nessun numero', async () => {
    for (const [ings, nota] of [[[I('Zucchero', 150, 'g'), I('Panna', 200, 'ml')], 'Panna (ml)'], [[I('Zucchero a velo', 200, 'g'), I('Acqua', 2, 'tbsp')], 'Acqua (tbsp)'],
      [[I('Latte', 500, 'ml'), I('Limone', 1, 'n')], 'Latte (ml), Limone (n)']]) {
      const r = await anteprima(ings);
      assert.ok(r.cells.every(x => x === '—'), JSON.stringify(r.cells));
      assert.strictEqual(r.note, 'Percentuali non calcolabili: mancano le conversioni in grammi di ' + nota + '.');
    }
  });

  await test('P4. dati non validi o peso nullo: nessuna percentuale inventata', async () => {
    for (const ings of [[I('Farina', -5, 'g'), I('Sale', 5, 'g')], [I('Farina', 0, 'g'), I('Sale', 0, 'g')]]) {
      const r = await anteprima(ings);
      assert.ok(r.cells.every(x => x === '—'), JSON.stringify(ings));
      assert.strictEqual(r.note, 'Percentuali non disponibili.');
    }
    const vuota = await anteprima([]);
    assert.deepStrictEqual([vuota.cells, vuota.note], [[], null], 'nessun ingrediente: nessuna nota');
  });

  await test('P5. nomi protetti nelle note', async () => {
    let r = await anteprima([I('Zucchero', 150, 'g'), I('<img src=x onerror=alert(1)>', 200, 'ml')]);
    assert.ok(r.note.includes('&lt;img src=x onerror=alert(1)&gt; (ml)') && !r.note.includes('<img'), r.note);
    r = await anteprima([I('Farina', 150, 'g'), I('Uova', 4, 'n')]);
    assert.ok(!/<(?!\/?strong)/.test(r.note));
  });

  await test('P6. stessi valori di computeFormulationWeights; funzione condivisa non modificata; nessuna somma nel codice', async () => {
    const ings = [I('Farina', 333, 'g'), I('Tuorli', 3, 'n'), I('Latte intero', 0.4, 'l'), I('Burro', 0.125, 'kg')];
    const r = await anteprima(ings);
    const cfw = new Function('S', ['function cnum(n)', 'function normalizeIngredientName(name)', 'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)',
      'function resolveSessionScalingConversionToGrams(unit,conversionFact)', 'function chooseConversionAskUnit(unit)', 'function resolveKnownProductionConversionFact(normalizedName,unit)',
      'function computeFormulationWeights(ingredients,resolveFact)'].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g)).join('\n') + ';return computeFormulationWeights;')(clone(KNOW));
    const w = cfw(ings.map((x, i) => ({ ...x, id: 'k' + i })));
    assert.deepStrictEqual(r.cells, ings.map((x, i) => String(Math.round(w.byId['k' + i].rawGrams / w.raw * 1000) / 10) + '%'));
    assert.strictEqual(sha(extractFunction('function computeFormulationWeights(ingredients,resolveFact)')), '765b3d8a8edde206', 'computeFormulationWeights invariata');
    const prev = extractFunction('function renderPreview()');
    assert.ok(prev.includes('computeFormulationWeights(p.ingredients)') && !/reduce\(/.test(prev.slice(0, prev.indexOf('const destinazioneEsistente'))), 'nessuna somma di quantita\'');
  });

  await test('P7. salvataggio invariato: ingredienti con la stessa precisione; resa dichiarata dell\'anteprima ancora funzionante', async () => {
    freshDb();
    const c = makeClient(clientFetch, { name: 'Prova PESI', category: 'Dolci', portionsCount: null, gramsPerPortion: null,
      declaredYield: { qty: null, unit: 'persone', range: { min: 4, max: 6 }, source: 'per 4-6 persone' },
      ingredients: [I('Farina', 333.33, 'g'), I('Burro', 0.125, 'kg'), I('Uova', 3, 'n')], steps: ['Mescolare'] });
    await c.loadFromSupabase(); Object.assign(c.S, clone(KNOW)); c.S.loadTab = 'testo'; c.S.loadText = 'Dosi per 4-6 persone.';
    await c.extractRecipe();
    const h = c.fillDomFromPreview();
    assert.ok(h.includes('Percentuali stimate') && h.includes('Usa 4 porzioni'), 'percentuali e resa nella stessa anteprima');
    c.click(h, 'import-yield-max', 'prev-yield');
    const before = new Set(fake.tables.variants.map(v => v.id));
    c.clickSavePreview(); await new Promise(r => setTimeout(r, 30));
    const row = fake.tables.variants.find(v => !before.has(v.id));
    assert.deepStrictEqual([row.declared_yield_qty, row.declared_yield_unit, row.portions_count, row.grams_per_portion], [6, 'porzioni', 0, 0]);
    assert.ok(row.note.startsWith('Importata · Resa nella fonte (intervallo): 4–6 porzioni'));
    assert.deepStrictEqual(fake.tables.ingredients.filter(i => i.variant_id === row.id).map(i => [i.name, Number(i.qty), i.unit]), [['Farina', 333.33, 'g'], ['Burro', 0.125, 'kg'], ['Uova', 3, 'n']]);
  });

  // Pagina simulata ricavata dall'HTML reale dell'anteprima: celle %, nota, righe degli ingredienti.
  function paginaDa(h) {
    const cells = [...h.matchAll(/<span class="preview-ing-pct"[^>]*>([^<]*)<\/span>/g)].map(m => ({ textContent: m[1] }));
    const m = h.match(/<div class="preview-weights-note"[^>]*>([\s\S]*?)<\/div>/);
    const box = { note: m ? { textContent: m[1] } : null, inserts: 0, cells };
    const rows = [...h.matchAll(/<div class="preview-ing-row">/g)].map(() => ({ insertAdjacentHTML: (pos, html) => {
      assert.strictEqual(pos, 'afterend'); box.inserts++; box.note = { textContent: html.replace(/<[^>]*>/g, '') }; } }));
    box.querySelectorAll = sel => sel === '.preview-ing-pct' ? cells : sel === '.preview-ing-row' ? rows : [];
    box.querySelector = sel => sel === '.preview-weights-note' ? box.note : null;
    const campo = { closest: sel => sel === '.card' ? box : null };
    return { box, campo };
  }
  // Funzione reale, eseguita con render e S che falliscono se toccati.
  const segna = new Function('render', 'S', 'document', extractFunction('function segnaPercentualiObsolete(el)') + html.match(/var PREVIEW_PCT_OBSOLETE_MSG='[^']*';/)[0] + ';return segnaPercentualiObsolete;')(
    () => { throw new Error('render chiamato'); }, new Proxy({}, { get() { throw new Error('S letto'); }, set() { throw new Error('S scritto'); } }), null);
  const MSG = 'Ingredienti modificati: le percentuali saranno ricalcolate dopo il salvataggio';

  await test('P8. modifica di quantita\' o unita\': tutte le percentuali "—" e un solo messaggio, anche dopo piu\' modifiche', async () => {
    const r = await anteprima([I('Farina', 500, 'g'), I('Burro', 0.3, 'kg')]);
    const { box, campo } = paginaDa(r.h);
    assert.deepStrictEqual(box.cells.map(c => c.textContent), ['62.5%', '37.5%']);
    assert.strictEqual(box.note, null, 'nessuna nota all\'apertura');
    for (let k = 0; k < 4; k++) segna(campo);
    assert.deepStrictEqual(box.cells.map(c => c.textContent), ['—', '—']);
    assert.strictEqual(box.note.textContent, MSG);
    assert.strictEqual(box.inserts, 1, 'messaggio creato una sola volta');
  });

  await test('P9. nota precedente (stima o conversioni mancanti) sostituita dal messaggio; asterischi rimossi', async () => {
    for (const [ings, prima] of [[[I('Farina', 150, 'g'), I('Uova', 4, 'n')], /^Percentuali stimate/], [[I('Zucchero', 150, 'g'), I('Panna', 200, 'ml')], /^Percentuali non calcolabili/]]) {
      const r = await anteprima(ings);
      const { box, campo } = paginaDa(r.h);
      assert.ok(prima.test(box.note.textContent));
      segna(campo); segna(campo);
      assert.ok(box.cells.every(c => c.textContent === '—'));
      assert.strictEqual(box.note.textContent, MSG);
      assert.strictEqual(box.inserts, 0, 'nessuna nota in piu\'');
    }
  });

  await test('P10. solo aggiornamento visivo: nessun render, nessuna lettura o scrittura dello stato; gestori sui campi degli ingredienti', async () => {
    const r = await anteprima([I('Farina', 150, 'g'), I('Uova', 4, 'n')]);
    const prima = JSON.stringify(r.c.S.loadPreview);
    segna(paginaDa(r.h).campo); // render e S sono trappole: fallirebbe se toccati
    assert.strictEqual(JSON.stringify(r.c.S.loadPreview), prima);
    const be = extractFunction('function bindEvents()');
    const blk = be.slice(be.indexOf("document.querySelectorAll('[data-prev-ing]').forEach(el=>{\n    el.addEventListener('input'"), be.indexOf("const btnBackLoad"));
    assert.ok(blk.includes("el.addEventListener('input',()=>segnaPercentualiObsolete(el));") && blk.includes("el.addEventListener('change',()=>segnaPercentualiObsolete(el));"));
    assert.ok(!/render\(|S\.|fetch\(|save/.test(blk), 'il gestore non ridisegna, non scrive, non salva');
    const f = extractFunction('function segnaPercentualiObsolete(el)');
    assert.ok(!/render\(|S\.|fetch\(|computeFormulationWeights/.test(f), 'nessun ricalcolo, nessuno stato');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
