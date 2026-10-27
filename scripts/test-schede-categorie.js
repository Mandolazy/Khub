/*
 * Test — Schede: ordine alfabetico A-Z e categorie facoltative personalizzabili.
 * Elenco A-Z predefinito (ordine italiano, maiuscole/accenti indifferenti,
 * numeri naturali), vista facoltativa per categoria, categoria libera
 * modificabile dalla Scheda con suggerimenti e persistenza, "Altro" come valore
 * tecnico mai obbligatorio, importazione con categoria libera (AI suggerisce,
 * non impone), Produzione "Mostra tutte" A-Z, un solo accesso al filtro
 * Famiglie. Nessuna modifica automatica delle categorie gia' salvate.
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
  return require('./_khub-test-session').withTestSession((await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default);
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
  'function confrontaNomiIt(a,b)', 'function categoriaVisibile(cat)', 'function categorieUsate()', 'function normalizzaCategoria(raw)', 'function datalistCategorie(id)', 'function onSchedaCategoryChange(recipeId,val)', 'function schedeVista()', 'function setSchedeVista(v)', 'function renderHome()',
  'function historyNormalizeText(value)', 'function activeRecipeEntries(recipes)', 'function filterActiveRecipeEntries(entries,query)', 'function renderProductionRecipeSearch()', 'function renderActiveRecipeRow(entry,withShare)', 'function renderAllActiveRecipes()',
  'async function extractRecipe()', 'function savePreview()', 'function renderPreview()',
  // Importazione della resa dichiarata: dipendenze di estrazione, anteprima e salvataggio.
  'function escAttr(s)', 'function formatQtyDisplay(value)', 'function declaredYieldErrorMessage(error)', 'function importYieldText(t)',
  'function importDeclaredYield(raw,fonte)', 'function importYieldFields(value)', 'function importYieldNote(note,dy)', 'function renderImportYieldFields(dy,prefix,label)',
  // Percentuali dell'anteprima: pesi in grammi con le regole condivise.
  'function computeFormulationWeights(ingredients,resolveFact)', 'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)',
  'function resolveSessionScalingConversionToGrams(unit,conversionFact)', 'function chooseConversionAskUnit(unit)', 'function resolveKnownProductionConversionFact(normalizedName,unit)',
].map(extractFunction).concat([html.match(/var CATEGORIA_TECNICA='Altro';[\s\S]*?var SCHEDE_COLLATOR=[^\n]*/)[0]]).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g), [html.match(/var IMPORT_YIELD_PORTION_ALIASES=\[[^\]]*\];/)[0], 
  html.match(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/)[0], html.match(/var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/)[0],
  html.match(/var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/)[0], html.match(/var LAB_TARGET_PORTIONS_MAX=\d+;/)[0], html.match(/const UNITS = \[[^\]]*\];/)[0], html.match(/const STAFF_ESEMPIO=\[[\s\S]*?\];/)[0],
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
    var S={produzioneHome:{recipeQuery:''},recipeStaffCondivisi:{},selectedFamily:null,schedeVista:null,recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{},pendingFamilies:[],
      loadTab:'testo',loadText:'',loadUrl:'',loadVideoUrl:'',loadImageB64:null,loadImagePreviewUrl:null,loadPreview:null,isLoading:false,view:'load',
      loadDestinazione:'nuova',loadDestinazioneSchedaId:null};
    var _knownIngredientIdsByVariant={}; var _persistedValidatedSig={}; var _saveLocked=false, _saveTimer={};
    function render(){} function autosave(id){log.autosaves=(log.autosaves||[]).concat(id);} function toast(m){log.toasts.push(m);}
    function confirm(){return true;} function addHistory(){} function suggestFamilies(){return [];} async function saveFamilies(){}
    ${SRC}
    ${SAVE_HANDLER}
    return {S, loadFromSupabase, saveToSupabase, extractRecipe, savePreview, renderPreview, clickSavePreview, renderHome, renderAllActiveRecipes, onSchedaCategoryChange,
      setSchedeVista, schedeVista, normalizzaCategoria, categorieUsate, categoriaVisibile, confrontaNomiIt};
  `)(routed, log, document, fn => fn());
  c.log = log; c.dom = dom;
  // Campi dell'anteprima come li vede il gestore: valori letti dall'HTML reso.
  c.fillDomFromPreview = () => {
    const h = c.renderPreview();
    for (const id of ['prev-name', 'prev-portions', 'prev-gpp']) { const m = h.match(new RegExp('id="' + id + '" value="([^"]*)"')); dom[id] = { value: m ? m[1] : '' }; }
    dom['prev-cat'] = { value: (h.match(/id="prev-cat"[^>]*value="([^"]*)"/) || [, ''])[1] };
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

  const crypto = require('crypto');
  const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  // Schede sintetiche: nomi con maiuscole, accenti e numeri; categorie esistenti, personalizzate e il valore tecnico.
  const SCHEDE = [['rA', 'zuppa di farro', 'Primi'], ['rB', 'Àrancini', 'Fritti'], ['rC', 'Babà', 'Dolci'], ['rD', 'torta 10', 'Altro'], ['rE', 'Torta 2', 'Altro'], ['rF', 'éclair', 'dolci']];
  const AZ = ['Àrancini', 'Babà', 'éclair', 'Frolla TEST', 'Torta 2', 'torta 10', 'zuppa di farro'];
  function freshSchede() {
    freshDb();
    SCHEDE.forEach(([id, name, category], k) => fake.tables.recipes.push({ id, name, category, department: 'Cucina', notes: '', media_url: null, video_url: null, created_at: '2026-10-0' + (k + 2) + 'T00:00:00Z' }));
    fake.tables.recipes.forEach(r => { if (!('media_url' in r)) Object.assign(r, { media_url: null, video_url: null }); });
  }
  const nomiRighe = h => [...h.matchAll(/<span class="schede-riga-nome">([^<]*)/g)].map(m => m[1]);
  const recDb = () => clone(fake.tables.recipes).sort((a, b) => a.id < b.id ? -1 : 1);

  console.log('Schede — ordine alfabetico e categorie facoltative');

  await test('C1. elenco A-Z predefinito: ordine italiano, maiuscole e accenti indifferenti, numeri naturali; categoria come etichetta, mai "Altro"', async () => {
    freshSchede();
    const c = makeClient(clientFetch, {}); await c.loadFromSupabase(); c.S.view = 'home';
    assert.strictEqual(c.schedeVista(), 'alfabetica', 'vista predefinita');
    const h = c.renderHome();
    assert.deepStrictEqual(nomiRighe(h), AZ);
    assert.ok(!/schede-cesura/.test(h), 'nessun raggruppamento obbligatorio');
    const etichette = [...h.matchAll(/<span class="schede-riga-cat">([^<]*)/g)].map(m => m[1]);
    assert.deepStrictEqual(etichette, ['Fritti', 'Dolci', 'dolci', 'Dolci', 'Primi'], 'categoria visibile, valore tecnico "Altro" non mostrato');
    const conteggio = h.match(/<div class="schede-count-globale">([^<]*)</)[1];
    assert.ok(/^7 SCHEDE · \d+ RICETT/.test(conteggio), conteggio);
    assert.deepStrictEqual(['b', 'B', 'à', 'A'].sort(c.confrontaNomiIt), ['A', 'à', 'B', 'b'], 'stesse lettere: ordine stabile');
  });

  await test('C2. vista facoltativa per categoria: categorie A-Z, Schede A-Z, stessa categoria con grafie diverse unita, "Altro" in fondo', async () => {
    freshSchede();
    const c = makeClient(clientFetch, {}); await c.loadFromSupabase();
    c.setSchedeVista('categorie');
    const h = c.renderHome();
    const gruppi = [...h.matchAll(/<span class="schede-cesura-nome">([^<]*)/g)].map(m => m[1]);
    assert.deepStrictEqual(gruppi, ['DOLCI', 'FRITTI', 'PRIMI', 'ALTRO']);
    assert.deepStrictEqual(nomiRighe(h), ['Babà', 'éclair', 'Frolla TEST', 'Àrancini', 'zuppa di farro', 'Torta 2', 'torta 10']);
    assert.ok(/^4 CATEGORIE · 7 SCHEDE/.test(h.match(/<div class="schede-count-globale">([^<]*)</)[1]));
    c.setSchedeVista('alfabetica'); assert.deepStrictEqual(nomiRighe(c.renderHome()), AZ);
    c.setSchedeVista('qualsiasi'); assert.strictEqual(c.schedeVista(), 'alfabetica');
  });

  await test('C3. categoria personalizzata dalla Scheda: suggerimenti, grafia esistente riusata, persistenza dopo ricarica; altre Schede invariate', async () => {
    freshSchede();
    const prima = recDb();
    let c = makeClient(clientFetch, {}); await c.loadFromSupabase();
    assert.deepStrictEqual(c.categorieUsate(), ['Dolci', 'Fritti', 'Primi'], 'suggerimenti: categorie gia\' usate, senza doppioni e senza "Altro"');
    c.onSchedaCategoryChange('rA', '  Zuppe   e   vellutate ');
    assert.strictEqual(c.S.recipes.find(r => r.id === 'rA').category, 'Zuppe e vellutate');
    c.onSchedaCategoryChange('rE', 'fritti');
    assert.strictEqual(c.S.recipes.find(r => r.id === 'rE').category, 'Fritti', 'grafia esistente');
    for (const id of ['rA', 'rE']) assert.strictEqual(await c.saveToSupabase(c.S.recipes.find(r => r.id === id)), true);
    const dopo = recDb();
    assert.deepStrictEqual(dopo.map(r => [r.id, r.category]), prima.map(r => [r.id, r.id === 'rA' ? 'Zuppe e vellutate' : r.id === 'rE' ? 'Fritti' : r.category]));
    dopo.forEach((r, k) => { const x = { ...r }, y = { ...prima[k] }; delete x.category; delete y.category; assert.deepStrictEqual(x, y, 'solo la categoria cambia ' + r.id); });
    c = makeClient(clientFetch, {}); await c.loadFromSupabase();
    assert.deepStrictEqual(['rA', 'rE'].map(id => c.S.recipes.find(r => r.id === id).category), ['Zuppe e vellutate', 'Fritti'], 'dopo la ricarica');
    assert.ok(c.categorieUsate().includes('Zuppe e vellutate'));
  });

  await test('C4. "Altro" tecnico mai obbligatorio: campo vuoto non cambia nulla; svuotare una categoria torna al valore tecnico; nomi lunghi limitati', async () => {
    freshSchede();
    const c = makeClient(clientFetch, {}); await c.loadFromSupabase();
    const n = c.normalizzaCategoria;
    assert.deepStrictEqual([n(''), n('   '), n(null), n('altro'), n('ALTRO '), n('primi'), n('Pasticceria   mignon')], ['Altro', 'Altro', 'Altro', 'Altro', 'Altro', 'Primi', 'Pasticceria mignon']);
    assert.strictEqual(n('x'.repeat(60)).length, 40);
    c.log.autosaves = [];
    c.onSchedaCategoryChange('rD', ''); c.onSchedaCategoryChange('rD', 'Altro'); c.onSchedaCategoryChange('rC', 'dolci');
    assert.deepStrictEqual(c.log.autosaves, [], 'nessuna modifica: stesso valore');
    // Scheda con categoria vuota (valore non scritto dall'app): un campo vuoto non la trasforma in "Altro"
    c.S.recipes.find(r => r.id === 'rF').category = '';
    c.onSchedaCategoryChange('rF', ''); c.onSchedaCategoryChange('rF', '  ');
    assert.strictEqual(c.S.recipes.find(r => r.id === 'rF').category, '');
    assert.deepStrictEqual(c.log.autosaves, []);
    c.onSchedaCategoryChange('rB', '');
    assert.strictEqual(c.S.recipes.find(r => r.id === 'rB').category, 'Altro', 'scelta esplicita dello chef');
    assert.deepStrictEqual(c.log.autosaves, ['rB']);
  });

  await test('C5. Schede esistenti invariate: caricare, mostrare e risalvare non cambia nessuna categoria salvata', async () => {
    freshSchede();
    const prima = recDb().map(r => [r.id, r.category]);
    const c = makeClient(clientFetch, {}); await c.loadFromSupabase();
    c.renderHome(); c.setSchedeVista('categorie'); c.renderHome();
    for (const r of c.S.recipes) assert.strictEqual(await c.saveToSupabase(r), true);
    assert.deepStrictEqual(recDb().map(r => [r.id, r.category]), prima, 'anche "dolci" minuscolo e "Altro" restano come sono');
  });

  // Importazione: AI (risposta sintetica) -> anteprima -> eventuale modifica del campo -> "Crea Scheda" -> DB.
  async function importaCat(aiCat, campo) {
    const c = makeClient(clientFetch, { name: 'Bignè IMPORT', ...(aiCat === undefined ? {} : { category: aiCat }), ingredients: ingr, steps: ['Impastare'] });
    await c.loadFromSupabase(); c.S.loadText = 'Ricetta sintetica';
    await c.extractRecipe();
    const h = c.fillDomFromPreview();
    if (campo !== undefined) c.dom['prev-cat'].value = campo;
    const prima = new Set(fake.tables.recipes.map(r => r.id));
    c.clickSavePreview(); await tick();
    const nuova = fake.tables.recipes.find(r => !prima.has(r.id));
    return { c, h, campo: c.dom['prev-cat'].value, categoria: nuova && nuova.category, prompt: c.log.aiRequests[0] && JSON.stringify(c.log.aiRequests[0]) };
  }

  await test('C6. importazione: categoria libera, suggerita dall\'AI ma non imposta; esistenti suggerite; vuota -> "Altro" tecnico', async () => {
    freshSchede();
    let r = await importaCat('Pasticceria mignon');
    assert.deepStrictEqual([r.campo, r.categoria], ['Pasticceria mignon', 'Pasticceria mignon'], 'nuova categoria');
    assert.ok(/<input class="form-input" id="prev-cat" type="text" list="prev-categorie"/.test(r.h) && !/<select class="form-input" id="prev-cat"/.test(r.h), 'campo libero, non piu\' un menu');
    assert.ok(/Categoria \(facoltativa\)/.test(r.h) && /<option value="Dolci">/.test(r.h) && /<option value="Primi">/.test(r.h), 'categorie esistenti suggerite');
    assert.ok(!/Dolci\|Salato\|Basi\|Altro/.test(r.prompt) && /Dolci, Fritti, Primi/.test(r.prompt) && /stringa vuota/.test(r.prompt), 'prompt: suggerisce, non impone');
    freshSchede(); r = await importaCat('dolci'); assert.strictEqual(r.categoria, 'Dolci', 'grafia esistente');
    freshSchede(); r = await importaCat('Dolci', 'Lievitati'); assert.strictEqual(r.categoria, 'Lievitati', 'scelta dello chef');
    for (const ai of [undefined, '', 'Altro', null]) { freshSchede(); r = await importaCat(ai); assert.deepStrictEqual([r.campo, r.categoria], ['', 'Altro'], 'nessuna categoria: ' + ai); }
    freshSchede(); r = await importaCat('Dolci', ''); assert.strictEqual(r.categoria, 'Altro', 'lo chef svuota il campo');
    // savePreview normalizza anche senza passare dal pulsante dell'anteprima
    freshSchede();
    const c = makeClient(clientFetch, { name: 'Diretta IMPORT', category: 'primi', ingredients: ingr, steps: ['Impastare'] });
    await c.loadFromSupabase(); c.S.loadText = 'x'; await c.extractRecipe();
    const prima = new Set(fake.tables.recipes.map(x => x.id));
    c.savePreview(); await tick();
    assert.strictEqual(fake.tables.recipes.find(x => !prima.has(x.id)).category, 'Primi');
  });

  await test('C7. Produzione "Mostra tutte": un unico elenco A-Z, senza raggruppamento per categoria; ricerca invariata', async () => {
    const c = makeClient(clientFetch, {});
    const va = (id, name) => ({ id, name, status: 'approved', active: true, ingredients: [] });
    c.S.recipes = [
      { id: 'r1', name: 'Zuppe', category: 'Primi', validatedVariants: [va('a', 'zuppa rustica'), va('b', 'Brodo')], labVersions: [] },
      { id: 'r2', name: 'Dolci', category: 'Dolci', validatedVariants: [va('c', 'Éclair caffè'), va('d', 'babà al rum'), va('e', 'Torta 10'), va('f', 'torta 2')], labVersions: [] },
      { id: 'r3', name: 'Altro', category: 'Altro', validatedVariants: [va('g', 'Arancino')], labVersions: [] },
    ];
    let h = c.renderAllActiveRecipes();
    assert.deepStrictEqual([...h.matchAll(/<span class="prod-riga-nome">([^<]*)/g)].map(m => m[1]), ['Arancino', 'babà al rum', 'Brodo', 'Éclair caffè', 'torta 2', 'Torta 10', 'zuppa rustica']);
    assert.ok(!/prod-cesura/.test(h) && /7 RICETTE ATTIVE/.test(text(h)));
    c.S.produzioneHome.recipeQuery = 'torta';
    h = c.renderAllActiveRecipes();
    assert.deepStrictEqual([...h.matchAll(/<span class="prod-riga-nome">([^<]*)/g)].map(m => m[1]), ['torta 2', 'Torta 10']);
  });

  await test('C8. Famiglie separate: un solo accesso al filtro; Scheda con campo categoria facoltativo; Nuova Scheda senza categoria scelta', async () => {
    freshSchede();
    const c = makeClient(clientFetch, {}); await c.loadFromSupabase();
    const h = c.renderHome();
    assert.strictEqual((h.match(/id="schede-btn-famiglie"/g) || []).length, 1); assert.ok(!/schede-btn-filtra/.test(h) && !/schede-btn-filtra/.test(html), 'doppione rimosso, anche nel codice');
    assert.ok(/FILTRA PER FAMIGLIA/.test(h));
    const scheda = extractFunction('function renderRicettaMadreV2(recipe)');
    assert.ok(scheda.includes(`onchange="onSchedaCategoryChange('\${recipe.id}',this.value)"`) && scheda.includes("datalistCategorie('si-categorie')") && scheda.includes('placeholder="Nessuna (facoltativa)"'));
    assert.ok(/const r=\{id,name:'Nuova Scheda',category:CATEGORIA_TECNICA,/.test(html) && !/name:'Nuova Scheda',category:'Dolci'/.test(html));
    // Famiglie: dati e filtro invariati (stessi id e stato S.selectedFamily)
    assert.ok(/onclick="S\.selectedFamily='\$\{f\.id\}';S\.showSchedeFamiglie=false;render\(\)"/.test(extractFunction('function renderSchedeFamigliePicker()')));
  });

  await test('C9. MichelinAI, Produzione e Sessioni compatibili: prompt senza categoria vuota o "undefined"; funzioni protette invariate', async () => {
    const pc = extractFunction('async function runPrimoConsulto(recipeId)');
    assert.ok(pc.includes("(categoriaVisibile(recipe.category)?' ('+categoriaVisibile(recipe.category)+')':'')") && !pc.includes("' ('+recipe.category+')'"));
    const chat = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
    assert.ok((chat.match(/categoria: ' \+ \(recipe\.category \|\| 'n\/d'\)/g) || []).length === 2, 'M1/M2 lato server: categoria mancante -> n/d (invariato)');
    const PROTETTE = {
      'async function loadFromSupabase()': '115ba063990470c0', 'async function saveToSupabase(recipe)': 'e3c83f1bdb507136',
      'function renderProdRecipe(recipe)': '8a9ec67ee54bfdd4', 'function costruisciPayloadM2(recipeId, message, classification)': '9850def5ee757a1c',
      'async function runM1(recipeId)': 'c65f22895bf0d242', 'async function createProductionSession(preparedInput)': '185ca85dcee49397',
      'function computeSessionScaling(input)': 'ddfc1febb5010cdc', 'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)': '9df6758db87b12b1',
    };
    for (const [m, h] of Object.entries(PROTETTE)) assert.strictEqual(sha(extractFunction(m)), h, m);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
