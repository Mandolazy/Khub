/*
 * Test — Anteprima Direzione 3 "Cucina editoriale" (solo presentazione).
 * Codice REALE estratto da khub_mvp.html (blocco Direzione 3 + funzioni di
 * supporto) e api/chat.js contro un finto PostgREST in memoria. Verifica che
 * la grafica classica resti identica a main, che il motore (LAB, scaling,
 * rese, conversioni, Sessioni, salvataggio, MichelinAI) non cambi, e le
 * schermate della Direzione 3: Scheda, Archivio, LAB, Home, navigazione,
 * colori di ambiente, elenco LAB.
 * Solo dati sintetici, nessuna rete, nessun Supabase.
 *
 * Ricostruito dopo la perdita del branch originale: l'infrastruttura e' la
 * stessa di test-post-validation-ux.js; il blocco della Direzione 3 e i test
 * P2, P4, P5, P10, P12-P14 sono ripresi dal testo originale.
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

// PATCH filtrata con Prefer: return=representation (come PostgREST), sopra il finto PostgREST.
function withPatch(fake, hooks) {
  const base = fake.fetch;
  fake.patches = [];
  fake.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') !== 'PATCH') return base(url, opts);
    if (hooks.failPatch) return { ok: false, status: 500, text: async () => 'patch boom', json: async () => ({}) };
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    let select = null; const filters = [];
    for (const [k, raw] of u.searchParams) {
      if (k === 'select') { select = raw.split(','); continue; }
      const dot = raw.indexOf('.'); filters.push([k, raw.slice(0, dot), raw.slice(dot + 1)]);
    }
    const body = JSON.parse(opts.body);
    fake.patches.push({ table, filters: clone(filters), body: clone(body) });
    const rows = (fake.tables[table] || []).filter(r => filters.every(([c, op, v]) => { if (op !== 'eq') throw new Error('op ' + op); return String(r[c]) === v; }));
    rows.forEach(r => Object.assign(r, body));
    const out = rows.map(r => select ? Object.fromEntries(select.map(c => [c, r[c]])) : r);
    return { ok: true, status: 200, json: async () => clone(out), text: async () => JSON.stringify(out) };
  };
  return fake;
}

// Scheda Bignè: Attiva vaB (30 bignè), seconda Attiva vaC, Pronta vaP, ritirata vaR, bozza lvB.
function seed(fake) {
  const steps = [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: null }];
  const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null, steps: JSON.stringify(['Impastare']), steps_v2: steps, primo_consulto: null, m1_reading_text: null, contenuto_hash: null };
  fake.tables.recipes = [
    { id: 'rB', name: 'Bignè TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' },
    { id: 'rX', name: 'Altra TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' },
  ];
  const v = (id, rid, status, active, dq, du, extra = {}) => ({ ...base, id, recipe_id: rid, name: 'V ' + id, label: 'V ' + id, note: 'nota ' + id, status, active, portions_count: 30, grams_per_portion: 21,
    validated_at: status === 'lab' ? null : '2026-10-01T09:30:17.250Z', origin_variant_id: null, created_at: '2026-10-01T00:00:00Z', declared_yield_qty: dq, declared_yield_unit: du, ...extra });
  fake.tables.variants = [
    v('vaB', 'rB', 'validated', true, '30', 'bignè'), v('vaC', 'rB', 'validated', true, null, null), v('vaI', 'rB', 'validated', true, 0, 'pz'),
    v('vaP', 'rB', 'validated', false, 20, 'pz'), v('vaR', 'rB', 'retired', false, 10, 'pz'), v('lvB', 'rB', 'lab', false, 30, 'bignè', { origin_variant_id: 'vaB' }),
    v('vaX', 'rX', 'validated', true, 5, 'pz'),
  ];
  const ing = (id, vid, name, qty, unit, ord, y) => ({ id, variant_id: vid, name, qty, unit, sort_order: ord, estimated_yield_pct: y, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
  fake.tables.ingredients = ['vaB', 'vaC', 'vaI', 'vaP', 'vaR', 'lvB', 'vaX'].flatMap(vid => [ing('f' + vid, vid, 'Farina', 500, 'g', 0, 70), ing('b' + vid, vid, 'Burro', 0.25, 'kg', 1, 70), ing('z' + vid, vid, 'Zucchero', 150, 'g', 2, 70)]);
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = []; fake.tables.ingredient_conversions = [];
  fake.tables.production_sessions = [{ id: 'ps1', recipe_id: 'rB', source_variant_id: 'vaB', status: 'completed', snapshot: { declaredYield: null, ingredients: [{ name: 'Farina', qty: 500 }] }, target_finished_total: 630 }];
}
const dbAll = fake => clone({ v: fake.tables.variants, i: fake.tables.ingredients, s: fake.tables.production_sessions, r: fake.tables.recipes });
const dbRow = (fake, id) => clone(fake.tables.variants.find(v => v.id === id));

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
  'function resolveKnownProductionConversionFact(normalizedName,unit)',
  'function parseLocaleNumber(value)', 'function normalizeDeclaredYield(qty,unit)', 'function classifyYieldUnit(unit)',
  'function computeFormulationWeights(ingredients,resolveFact)', 'function deriveYieldPerUnit(weights,declared)', 'function formatQtyDisplay(value)',
  'function targetFromDb(value)', 'function targetForDb(value)', 'function declaredYieldFromRow(row)', 'function copyDeclaredYield(src)', 'function declaredYieldPayload(v)', 'function declaredYieldState(v)',
  'function declaredYieldInputText(raw)', 'function declaredYieldErrorMessage(error)', 'function labGrams(x)',
  'function findActiveVariant(recipeId,variantId)', 'function declaredYieldLabel(qty,unit)', 'function openActiveYieldEdit(recipeId,variantId)',
  'function onActiveYieldField(field,value)', 'function reviewActiveYieldEdit(qtyRaw,unitRaw)', 'function backActiveYieldEdit()',
  'function cancelActiveYieldEdit()', 'async function confirmActiveYieldEdit()', 'function renderActiveYieldSection(recipe,v)',
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)',
  'function isBetterConversionFact(candidate,current)', 'function buildKnownIngredientIds(ingredientRows)',
  'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()',
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g), [
  html.match(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/)[0], html.match(/var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/)[0],
  html.match(/var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/)[0],
]).join('\n');

// Impronte prese da main 539487b: queste funzioni non devono cambiare.
const PROTETTE = {
  "function computeSessionScaling(input)": "ddfc1febb5010cdc",
  "async function createProductionSession(preparedInput)": "185ca85dcee49397",
  "function buildValidatedVariantPayload(recipeId,vv)": "4186aeae0c1330e6",
  "async function saveToSupabase(recipe)": "55d82322a3c2285f",
  "async function loadFromSupabase()": "0f20790b79f681e3",
  "function firmaContenutoBozza(v)": "9426d786f4588837",
  "function toggleActiveV2(recipeId,variantId,currentActive)": "ca8f22881e9ba641",
  "async function confirmActiveYieldEdit()": "92f6565ceacf884a",
  "function creaBozzaDaSorgente(recipeId,attiva)": "24ff4e49d1353fae",
  "function onRecipeNameChange(recipeId,val)": "b23f74fd6e79d3ac",
};

// Funzioni reali aggiuntive: validazione, attivazione, riapertura, accesso al LAB, rinomina.
const EXTRA = ['function getStructuredSteps(legacySteps,stepsV2)', 'function parseSteps(raw)', 'function addHistory(variantId,event,label)', 'function findDependentsOfVariant(variantId)',
  'function suggestFamilies(recipe, variantName)', 'function idVariantiScheda(recipe)', 'function famigliaAutomaticaScheda(recipe)', 'function famigliaUsataAltrove(familyId,recipeId)', 'async function saveFamilies(variantId, familyIds, newFamilyName)', 'function onValidate()', 'async function confirmValidate()',
  'function toggleActiveV2(recipeId,variantId,currentActive)', 'function prontaRiapribileMotivo(recipe,vv)', 'function correggibileInPagina(recipe,vv)', 'function rendiAttivaPronta(recipeId,variantId)',
  'async function riapriProntaInLab(recipeId,variantId)', 'function bozzaVuota(v)', 'function nuovaBozzaDaRicetta(recipeId,variantId)', 'function creaBozzaDaSorgente(recipeId,attiva)',
  'function renderAzioniLabRicetta(recipe,vv)', 'function apriRinomina(kind,recipeId,variantId)', 'function confermaRinominaScheda(recipeId)',
  'async function confermaRinominaRicetta(recipeId,variantId)', 'function renderRinominaForm(kind,recipeId,variantId,valore)', 'function onRecipeNameChange(recipeId,val)',
  'function renderLabRecipe(recipe)', 'function allVariants(recipe)', 'function findVariantById(variantId)', 'function parseDataItaliana(str)',
  'function labTargetIsSet(value)', 'function targetDisplay(value)', 'function targetSummaryShort(portions,gpp)',
  'function correggibileInPagina(recipe,vv)', 'function programmaFineEvidenzaValidata(variantId)', 'function confrontaNomiIt(a,b)', 'function categoriaVisibile(cat)', 'function categorieUsate()', 'function datalistCategorie(id)', 'function renderRicettaMadreV2(recipe)'];
const defined = n => new RegExp('function ' + n.replace(/^(async )?function /, '').split('(')[0] + '\\(').test(SRC);
const SRC_UX = SRC + '\n' + EXTRA.filter(m => !defined(m)).map(extractFunction).join('\n') + '\n' + html.match(/var CATEGORIA_TECNICA='Altro';[\s\S]*?var SCHEDE_COLLATOR=[^\n]*/)[0]
  + '\n' + html.match(/var EVIDENZA_VALIDATA_MS=\d+;/)[0].replace(/\d+/, '30'); // durata ridotta per il test
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// ══════════════════════════════════════════════════════════
// Anteprima Direzione 3: blocco D3 reale + funzioni di supporto reali.
// ══════════════════════════════════════════════════════════
const D3_START = html.indexOf('// ANTEPRIMA DIREZIONE 3');
const D3_BLOCK = html.slice(html.lastIndexOf('\n', D3_START), html.lastIndexOf('// ═', html.indexOf('\n// INIT', D3_START)));
const D3_EXTRA = ['function renderSidebar()', 'function renderBottomNav()', 'function renderAppHome()', 'function renderLabGlobale()', 'function renderAttive()', 'function schedeVista()', 'function setSchedeVista(v)', 'function normalizzaCategoria(raw)', 'function onSchedaCategoryChange(recipeId,val)', 'function exportPDF(recipeId,variantId)',
  'function tutteLeBozzeLab()', 'function confrontaUltimaModificaBozze(a,b)', 'function searchResultOnclick(r)', 'function renderSearch(query)', 'function renderConfronto(recipe)',
  'function renderOnboarding()', 'function renderProdRecipe(recipe)', 'function renderLabConversionModal()', 'function renderProfiloPlaceholder()', 'function renderMichelinAIGlobalePlaceholder()'];
// Chiusura delle dipendenze: funzioni di primo livello di khub_mvp.html
// richiamate dal codice estratto (tranne quelle simulate dal client).
const SIMULATE = new Set(['render', 'autosave', 'toast', 'openLabRound', 'closeLabRound']);
function withDependencies(src) {
  const all = {}; let m; const re = /^(async )?function ([A-Za-z0-9_$]+)\(/gm;
  while ((m = re.exec(html))) if (!(m[2] in all)) all[m[2]] = m[0].replace(/\($/, '(') + html.slice(m.index + m[0].length, html.indexOf(')', m.index) + 1);
  const presenti = n => new RegExp('function ' + n.replace(/\$/g, '\\$') + '\\(').test(src);
  // Costanti di primo livello (es. UNITS): dichiarazione completa fino al ';' esterno.
  const costanti = {}; const rc = /^(?:const|var|let) ([A-Za-z0-9_$]+)\s*=/gm;
  while ((m = rc.exec(html))) if (m[1] !== 'S' && !(m[1] in costanti)) {
    let d = 0, i = m.index, q = null;
    for (; i < html.length; i++) { const ch = html[i]; if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; } if (ch === "'" || ch === '"' || ch === '`') q = ch; else if ('{[('.includes(ch)) d++; else if ('}])'.includes(ch)) d--; else if (ch === ';' && d === 0) break; }
    costanti[m[1]] = html.slice(m.index, i + 1).replace(/^(const|let) /, 'var ');
  }
  const dichiarata = n => new RegExp('(^|[\\s;])(var|const|let) ' + n.replace(/\$/g, '\\$') + '\\s*=', 'm').test(src);
  for (let giro = 0; giro < 50; giro++) {
    const mancanti = Object.keys(all).filter(n => !SIMULATE.has(n) && !presenti(n) && new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\(').test(src));
    const cm = Object.keys(costanti).filter(n => !dichiarata(n) && !presenti(n) && new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b').test(src));
    if (!mancanti.length && !cm.length) return src;
    src += '\n' + mancanti.map(n => extractFunction(all[n])).join('\n') + '\n' + cm.map(n => costanti[n]).join('\n');
  }
  throw new Error('dipendenze non chiuse');
}
// Stato iniziale reale dell'app (le chiavi usate dal LAB, es. labSectionsOpen).
const REAL_S = extractFunction('const S = {').replace(/^const S = /, '');
const SRC_D3 = withDependencies(SRC_UX + '\n' + D3_EXTRA.filter(m => !defined(m)).map(extractFunction).join('\n') + '\n' + D3_BLOCK);

function makeClientD3(fetchImpl, opts = {}, src = SRC_D3) {
  const log = { toasts: [], renders: 0, opened: [], listeners: {} };
  const storage = Object.assign({}, opts.storage || {});
  const bodyClasses = new Set();
  const doc = {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (t, f) => { (log.listeners[t] = log.listeners[t] || []).push(f); },
    body: { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; }, classList: { add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c), toggle: (c, on) => on ? bodyClasses.add(c) : bodyClasses.delete(c), contains: c => bodyClasses.has(c) } },
  };
  const win = { addEventListener: () => {}, open: () => { const w = { html: '', document: { write: h => { w.html += h; }, close: () => {} }, focus: () => {}, print: () => {} }; log.opened.push(w); return w; } };
  const c = new Function('fetch', 'log', 'document', 'confirm', 'localStorage', 'location', 'window', `
    var S=Object.assign(${REAL_S},{recipes:[],selectedId:null,families:[],variantFamilies:{},variantHistory:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{},labYieldInput:{},activeYieldEdit:null,
      view:'ricetta-madre-v2',mode:'produzione',selectedVariantId:null,pendingFamilies:[],pendingNewFamily:'',showFamilyPicker:false,familyManagerMode:false,justValidated:null,renameEdit:null,rmv2AttivaEspansa:{},pendingDuplicaSceltaRecipeId:null,confirmDeleteId:null,labRound:null});
    var _knownIngredientIdsByVariant={}; var _persistedValidatedSig={}; var _saveLocked=false, _saveTimer={};
    function render(){log.renders++;} function autosave(){} function toast(msg){log.toasts.push(msg);}
    function openLabRound(id){S.labRound={recipeId:id};} function closeLabRound(){S.labRound=null;}
    ${src}
    ${opts.autosaveReale ? AUTOSAVE_REALE + '\nfunction showSaveIndicator(){log.indicatore=(log.indicatore||0)+1;}' : ''}
    return {S, loadFromSupabase, saveToSupabase, renderLabRecipe, renderRicettaMadreV2, renderHomeD3, renderSchedaD3, renderDatiTecniciD3, renderD3Esporta,
      initUiD3, setUiD3, d3ToggleArrotonda, d3SetLabTab, d3SchedeFiltrate, d3SetQuery, exportPDF, nuovaScheda, R,
      renderSidebar, renderBottomNav, renderAppHome, renderAppHomeD3, renderLabGlobale, renderAttive, d3SezioneNav, d3ConteggiHome,
      renderLabGlobaleD3, d3GruppiLab, d3SetLabOrdine, d3LabOrdine,
      renderSearch, renderConfronto, renderOnboarding, renderProdRecipe, renderLabConversionModal, renderProfiloPlaceholder, renderMichelinAIGlobalePlaceholder, d3NomeUnita, d3StatoRicetta,
      // Gestore inline di un attributo on* come lo esegue il browser: codice dell'attributo, this = elemento.
      eseguiInline: function (codice, el) { return (function () { return eval(codice); }).call(el); }};
  `)(fetchImpl, log, doc, () => opts.confirm !== false, { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    { search: opts.search || '' }, win);
  c.log = log; c.storage = storage; c.bodyClasses = bodyClasses; return c;
}
const makeClientD3Src = (fetchImpl, src) => makeClientD3(fetchImpl, {}, src);
// Salvataggio automatico reale dell'app (timer di 1500 ms, poi saveToSupabase).
const AUTOSAVE_REALE = extractFunction('function autosave(id)');
// Testo di un attributo HTML come lo legge il browser (solo le entita' usate qui).
const attributo = (h, sel, nome) => {
  const tag = (h.match(new RegExp('<' + sel + '[^>]*>')) || [])[0];
  if (!tag) throw new Error('elemento non trovato: ' + sel);
  const m = tag.match(new RegExp('\\s' + nome + '="([^"]*)"'));
  if (!m) throw new Error('attributo non trovato: ' + nome);
  return m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
};

// Codice di main prima dell'anteprima (e683f77): confronto delle funzioni.
const BASE = 'e683f77';
let baseHtml = null;
try { baseHtml = require('child_process').execSync('git show ' + BASE + ':khub_mvp.html', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { baseHtml = null; }
function topLevelFunctions(src) {
  const out = {};
  const re = /^(async )?function ([A-Za-z0-9_$]+)\(/gm; let m;
  while ((m = re.exec(src))) {
    const start = m.index; const b = src.indexOf('{', start); let d = 0, i = b;
    for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) break; } }
    out[m[2]] = src.slice(start, i + 1);
  }
  return out;
}
const text = h => String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
// Client con alcune funzioni sostituite dalla versione di main (confronto della grafica classica).
function clientMain(fetchImpl, nomi) {
  const fm = topLevelFunctions(baseHtml), fd = topLevelFunctions(SRC_D3);
  let src = SRC_D3; for (const n of nomi) src = src.replace(fd[n], fm[n]);
  return makeClientD3Src(fetchImpl, src);
}

// Funzioni di khub_mvp.html che cambiano rispetto a main in questa fase.

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase'; process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let saves = [], fake;
  let chiamate = 0;
  async function callApi(body) { chiamate++; let status = 200, out; if (body.supabaseAction === 'save') saves.push(clone(body.data));
    await realHandler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } }); return { status, body: out }; }
  const clientFetch = async (url, o) => { const r = await callApi(JSON.parse(o.body)); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  async function setup(opts = {}) {
    fake = withPatch((() => { const f = makeFakeSupabase(); seed(f); return f; })(), {}); globalThis.fetch = fake.fetch;
    saves = [];
    const c = makeClientD3(clientFetch, opts); await c.loadFromSupabase(); c.S.selectedId = 'rB';
    return c;
  }
  const rec = (c, id = 'rB') => c.S.recipes.find(r => r.id === id);
  const labOf = c => { const r = rec(c); r.currentLabIdx = r.labVersions.findIndex(v => v.id === 'lvB'); return r; };
  console.log('Anteprima Direzione 3 (solo presentazione)');

  await test('P1. grafica classica invariata: LAB e Scheda classici (?ui=classic) identici a main', async () => {
    assert.ok(baseHtml, 'storia git con ' + BASE + ' necessaria');
    const c = await setup(); const cm = clientMain(clientFetch, ['renderLabRecipe', 'renderRicettaMadreV2']);
    cm.S.recipes = clone(c.S.recipes); cm.S.selectedId = 'rB';
    for (const k of [c, cm]) { k.S.mode = 'lab'; k.S.view = 'recipe'; labOf(k); }
    assert.strictEqual(c.renderLabRecipe(rec(c)), cm.renderLabRecipe(rec(cm)), 'LAB classico');
    for (const k of [c, cm]) k.S.view = 'ricetta-madre-v2';
    assert.strictEqual(c.renderRicettaMadreV2(rec(c)), cm.renderRicettaMadreV2(rec(cm)), 'Scheda classica');
    const k = await setup({ search: '?ui=classic' }); k.initUiD3();
    assert.ok(k.S.uiD3 === false && !k.bodyClasses.has('ui-d3'), 'grafica classica con ?ui=classic');
    k.S.mode = 'lab'; k.S.view = 'recipe'; labOf(k);
    assert.strictEqual(k.renderLabRecipe(rec(k)), cm.renderLabRecipe(rec(cm)), 'LAB classico con ?ui=classic identico a main');
  });

  await test('P2. motore preservato: LAB, scaling, rese, conversioni, Sessioni, salvataggio e MichelinAI identici a main; cambiano solo le funzioni di presentazione', async () => {
    assert.ok(baseHtml, 'storia git con ' + BASE + ' necessaria');
    const a = topLevelFunctions(baseHtml), b = topLevelFunctions(html);
    const cambiate = Object.keys(a).filter(n => n in b && a[n] !== b[n]).sort();
    const rimosse = Object.keys(a).filter(n => !(n in b));
    assert.deepStrictEqual(cambiate, ['bindEvents', 'confirmMerge', 'deleteRecipe', 'deleteVariant', 'eliminaBozza', 'exportPDF', 'render', 'renderBottomNav', 'renderLabRecipe', 'renderRicettaMadreV2', 'renderSidebar', 'rendiAttiva',
      // Finalizzazione D3: solo presentazione (ramo S.uiD3) e criterio "Ultima modifica" estratto in una funzione condivisa.
      'renderConfronto', 'renderLabConversionModal', 'renderLabGlobale', 'renderMichelinAIGlobalePlaceholder', 'renderOnboarding', 'renderProdRecipe', 'renderProfiloPlaceholder', 'renderSearch',
      // Finalizzazione: errori di persistenza visibili (HTTP non 2xx, {ok:false}, risposte non valide); test E1-E9.
      'loadFromSupabase', 'saveToSupabase'].sort(), 'presentazione + ciclo di vita (attivazione diretta eliminata; eliminazioni e Unisci con esito verificato) + errori di persistenza visibili');
    assert.deepStrictEqual(rimosse, [], 'nessuna funzione rimossa');
    for (const n of ['computeFormulationWeights', 'deriveYieldPerUnit', 'computeLabRounding', 'applyLabRound', 'undoLabRound', 'computeSessionScaling', 'createProductionSession', 'buildValidatedVariantPayload', 'onValidate', 'confirmValidate', 'rendiAttivaPronta', 'riapriProntaInLab', 'onLabDeclaredYield', 'onIngQty', 'onStepText'])
      assert.ok(n in b && a[n] === b[n], 'invariata: ' + n);
    // Il segnaposto "MichelinAI" e' solo una card di testo (presentazione), non il motore.
    const michelin = Object.keys(a).filter(n => /michelin|m1|m2|primoConsulto/i.test(n) && n !== 'renderMichelinAIGlobalePlaceholder');
    assert.ok(michelin.length > 5);
    michelin.forEach(n => assert.strictEqual(b[n], a[n], 'MichelinAI invariato: ' + n));
    for (const [m, h] of Object.entries(PROTETTE)) assert.strictEqual(sha(extractFunction(m)), h, 'cambiato: ' + m);
    const git = require('child_process').execSync('git diff --name-only ' + BASE + ' -- middleware.js vercel.json .vercelignore', { cwd: ROOT, encoding: 'utf8' }).trim();
    assert.strictEqual(git, '', 'autenticazione e configurazione invariate');
    // api/chat.js: accesso e chiave restano identici a main.
    const apiMain = require('child_process').execSync('git show ' + BASE + ':api/chat.js', { cwd: ROOT, encoding: 'utf8' });
    const apiOra = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
    for (const f of ['function khubAccessDenied(req)', 'function supabaseConfig()', 'function genericUpdateProblem(table, data)']) {
      const pezzo = src => { const a = src.indexOf(f); return src.slice(a, src.indexOf('\n}\n', a)); };
      assert.ok(apiMain.includes(f) && pezzo(apiOra) === pezzo(apiMain), 'invariata: ' + f);
    }
  });

  await test('P3. LAB Direzione 3: "Valida" unica azione di stato; nessun "Rendi attiva" ne\' rendiAttiva(); stessi campi e gestori', async () => {
    const c = await setup(); c.S.uiD3 = true; c.S.mode = 'lab'; c.S.view = 'recipe';
    const h = c.renderLabRecipe(labOf(c));
    assert.ok(/✓ Valida/.test(h) && /id="btn-show-validate"/.test(h), 'Valida con lo stesso id del flusso esistente');
    assert.ok(!/Rendi attiva/.test(text(h)) && !/rendiAttiva\(/.test(h), 'nessuna attivazione dal LAB');
    for (const id of ['lab-yield-qty', 'lab-yield-unit']) assert.ok(h.includes('id="' + id + '"'), 'stesso campo: ' + id);
    assert.ok(/onLabDeclaredYield\('rB','qty',this\.value\)/.test(h) && /onLabDeclaredYield\('rB','unit',this\.value\)/.test(h), 'stesso gestore della resa');
    assert.deepStrictEqual(saves, [], 'disegnare non salva');
  });

  await test('P4. Scheda Direzione 3: sezioni per stato, un solo pulsante terracotta, azioni coerenti', async () => {
    const c = await setup(); c.S.uiD3 = true;
    const h = c.renderSchedaD3(rec(c)), t = text(h);
    assert.ok(/Attive\s*3/.test(t) && /Validate\s*1/.test(t) && /In LAB\s*1/.test(t), t.slice(0, 400));
    assert.strictEqual((h.match(/d3-btn-primary/g) || []).length, 1, 'un solo pulsante principale');
    assert.ok(/rendiAttivaPronta\('rB','vaP'\)/.test(h) && /riapriProntaInLab\('rB','vaP'\)/.test(h), 'Validata: Rendi attiva e Torna in LAB (flussi esistenti)');
    assert.ok(!/rendiAttivaPronta\('rB','vaB'\)/.test(h), 'mai su una Attiva');
    assert.ok(/V vaR/.test(t) && /Archiviate/.test(t), 'archiviate raccolte a parte');
  });

  await test('P5. Archivio: A-Z italiano, raggruppamento per categoria, ricerca; "Nuova Scheda" usa la creazione esistente', async () => {
    const c = await setup(); c.S.uiD3 = true; c.S.view = 'home';
    c.S.recipes.push({ ...clone(rec(c, 'rX')), id: 'rA', name: 'àrancini TEST', category: 'Antipasti' }, { ...clone(rec(c, 'rX')), id: 'rZ', name: 'zuppa 10 TEST', category: 'Altro' }, { ...clone(rec(c, 'rX')), id: 'rZ2', name: 'Zuppa 9 TEST', category: 'Altro' });
    assert.deepStrictEqual(c.d3SchedeFiltrate().map(r => r.name), ['Altra TEST', 'àrancini TEST', 'Bignè TEST', 'Zuppa 9 TEST', 'zuppa 10 TEST']);
    c.d3SetQuery('bign'); assert.deepStrictEqual(c.d3SchedeFiltrate().map(r => r.id), ['rB']); c.d3SetQuery('');
    c.storage.khub_schede_vista = 'categorie';
    const t = text(c.renderHomeD3());
    assert.ok(t.indexOf('Antipasti') < t.indexOf('Dolci') && t.indexOf('Dolci') < t.indexOf('Senza categoria'), 'categorie A-Z, "Senza categoria" in fondo');
    assert.ok(!/Gestisci categorie/.test(t));
    assert.ok(/function nuovaScheda\(\)/.test(html) && /btnNew\.addEventListener\('click',nuovaScheda\)/.test(html), 'stesso flusso di creazione');
  });

  await test('P6. Dati tecnici ed Esporta: funzioni future dichiarate PREVISTO, nessun campo che salva', async () => {
    const c = await setup(); c.S.uiD3 = true;
    const d = c.renderDatiTecniciD3();
    assert.ok((d.match(/Previsto/g) || []).length >= 3 && !/<input|<textarea|<select|onchange|oninput/.test(d), 'solo descrizioni, nessun campo');
    c.S.d3Esporta = { recipeId: 'rB', variantId: 'vaB' };
    const e = c.renderD3Esporta();
    assert.ok(/PDF ricetta/.test(e) && /Previsto/.test(e) && /disabled/.test(e) && /d3Esporta\(\)/.test(e), 'un solo formato attivo: il PDF di sempre');
    assert.deepStrictEqual(saves, []);
  });

  await test('P7. PDF: Ricette Attive e Validate identiche a main; bozza del LAB esportabile con le stesse quantita\', segnata come bozza; nessun effetto collaterale', async () => {
    assert.ok(baseHtml, 'storia git con ' + BASE + ' necessaria');
    const c = await setup(); const cm = clientMain(clientFetch, ['exportPDF']); cm.S.recipes = clone(c.S.recipes);
    for (const vid of ['vaB', 'vaP']) {
      c.exportPDF('rB', vid); cm.exportPDF('rB', vid);
      assert.strictEqual(c.log.opened.at(-1).html, cm.log.opened.at(-1).html, 'PDF identico a main: ' + vid);
    }
    const prima = c.log.opened.length;
    c.exportPDF('rB', 'lvB');
    assert.strictEqual(c.log.opened.length, prima + 1, 'bozza esportabile');
    const pdf = c.log.opened.at(-1).html;
    assert.ok(/Farina/.test(pdf) && /500/.test(pdf) && /bozza/i.test(pdf), 'stesse quantita\', segnata come bozza');
    assert.deepStrictEqual(saves, [], 'nessun salvataggio');
  });

  await test('P8. scelta della grafica: Direzione 3 predefinita; ?ui=classic / ?ui=d3 / interruttore; preferenza solo nel browser', async () => {
    let c = await setup({ search: '?ui=d3' }); c.initUiD3();
    assert.strictEqual(c.S.uiD3, true); assert.strictEqual(c.storage.khub_ui, 'd3');
    c = await setup({ search: '?ui=classic', storage: { khub_ui: 'd3' } }); c.initUiD3();
    assert.strictEqual(c.S.uiD3, false); assert.strictEqual(c.storage.khub_ui, 'classic');
    c = await setup({ storage: { khub_ui: 'd3' } }); c.initUiD3(); assert.strictEqual(c.S.uiD3, true, 'preferenza ricordata');
    c.setUiD3(false); assert.deepStrictEqual([c.S.uiD3, c.storage.khub_ui], [false, 'classic']);
    c = await setup(); c.initUiD3(); assert.strictEqual(c.S.uiD3, true, 'senza preferenza: Direzione 3 predefinita');
    assert.strictEqual(c.storage.khub_ui, undefined, 'la predefinita non scrive preferenze');
    c = await setup({ search: '?ui=classic' }); c.initUiD3(); assert.deepStrictEqual([c.S.uiD3, c.storage.khub_ui], [false, 'classic'], '?ui=classic');
    c = await setup({ storage: { khub_ui: 'classic' } }); c.initUiD3(); assert.strictEqual(c.S.uiD3, false, 'classica ricordata senza parametro');
    c = await setup({ search: '?ui=d3', storage: { khub_ui: 'classic' } }); c.initUiD3(); assert.deepStrictEqual([c.S.uiD3, c.storage.khub_ui], [true, 'd3'], 'ritorno con ?ui=d3');
    c = await setup({ search: '?ui=altro', storage: { khub_ui: 'classic' } }); c.initUiD3(); assert.deepStrictEqual([c.S.uiD3, c.storage.khub_ui], [false, 'classic'], 'valore sconosciuto ignorato');
    c = await setup({ search: '?ui=altro' }); c.initUiD3(); assert.strictEqual(c.S.uiD3, true, 'valore sconosciuto: predefinita');
    c.setUiD3(true); assert.strictEqual(c.storage.khub_ui, 'd3', 'interruttore verso la Direzione 3');
    // Interruttore e nota del LAB: testi coerenti con la Direzione 3 predefinita.
    c.S.uiD3 = true; assert.ok(/passa alla grafica classica/.test(c.renderSidebar()));
    c.S.uiD3 = false; assert.ok(/Passa alla Direzione 3/.test(c.renderSidebar()) && !/anteprima/i.test(text(c.renderSidebar())));
    assert.ok(!/khub_ui/.test(fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8')), 'nessun dato sul server');
  });

  await test('P9. Arrotonda quantita\' dalla Direzione 3: apre il pannello esistente, nessun calcolo nuovo', async () => {
    const c = await setup(); c.S.uiD3 = true; c.S.mode = 'lab'; c.S.view = 'recipe'; labOf(c);
    c.d3ToggleArrotonda('rB', true);
    assert.deepStrictEqual([c.S.labRound && c.S.labRound.recipeId, c.S.d3LabTab], ['rB', 'ingredienti'], 'pannello esistente aperto');
    c.d3ToggleArrotonda('rB', false); assert.strictEqual(c.S.labRound, null);
    assert.ok(!/computeLabRounding|applyLabRound/.test(D3_BLOCK), 'nessun calcolo nella Direzione 3');
    assert.deepStrictEqual(saves, []);
  });

  await test('P10. uniformazione: con l\'anteprima spenta Home, LAB, Produzione e navigazione identiche a main', async () => {
    assert.ok(baseHtml, 'storia git con ' + BASE + ' necessaria');
    const c = await setup();
    const fm = topLevelFunctions(baseHtml);
    let SRC_MAIN = SRC_D3;
    for (const n of ['renderSidebar', 'renderBottomNav', 'renderAppHome', 'renderLabGlobale', 'renderAttive', 'renderActiveRecipeRow',
      'renderProdRecipe', 'renderSearch', 'renderConfronto', 'renderOnboarding', 'renderLabConversionModal', 'renderProfiloPlaceholder', 'renderMichelinAIGlobalePlaceholder']) SRC_MAIN = SRC_MAIN.replace(topLevelFunctions(SRC_D3)[n], fm[n]);
    const cm = makeClientD3Src(clientFetch, SRC_MAIN); cm.S.recipes = clone(c.S.recipes); cm.S.productionSessions = []; c.S.productionSessions = [];
    const senzaInterruttore = h => h.replace(/\s*<button class="d3-sb-toggle"[\s\S]*?<\/button>/, '');
    for (const [view, mode] of [['app-home', 'lab'], ['home', 'lab'], ['lab-globale', 'lab'], ['recipe', 'lab'], ['recipe', 'produzione'], ['attive', 'lab'], ['sessione-operativa', 'lab'], ['storico-produzioni', 'lab']]) {
      for (const k of [c, cm]) Object.assign(k.S, { view, mode });
      assert.strictEqual(c.renderBottomNav(), cm.renderBottomNav(), 'barra in basso ' + view + '/' + mode);
      assert.strictEqual(senzaInterruttore(c.renderSidebar()), senzaInterruttore(cm.renderSidebar()), 'barra laterale ' + view + '/' + mode);
    }
    assert.strictEqual(c.renderAppHome(), cm.renderAppHome(), 'Home');
    assert.strictEqual(c.renderLabGlobale(), cm.renderLabGlobale(), 'elenco LAB');
    c.S.view = cm.S.view = 'attive'; c.S.produzioneHome = cm.S.produzioneHome = { recipeQuery: '', expanded: null };
    assert.strictEqual(c.renderAttive(), cm.renderAttive(), 'Produzione');
    // Finalizzazione: ogni funzione toccata, con l'anteprima spenta, produce lo stesso HTML di main.
    for (const k of [c, cm]) Object.assign(k.S, { mode: 'produzione', selectedVariantId: 'vaB', confrontoA: 'vaB', confrontoB: 'vaP',
      pendingLabConversion: { recipeId: 'rB', labVersionId: 'lvB', ingId: 'x', ingName: 'Uova (impasto)', fromUnit: 'n', toUnit: 'g', askUnit: 'n', value: '55', isReference: false, loading: false, error: 'Errore' } });
    assert.strictEqual(c.renderProdRecipe(rec(c)), cm.renderProdRecipe(rec(cm)), 'Ricetta in Produzione');
    assert.strictEqual(c.renderSearch('V va'), cm.renderSearch('V va'), 'Ricerca');
    assert.strictEqual(c.renderConfronto(rec(c)), cm.renderConfronto(rec(cm)), 'Confronta Ricette');
    for (const n of ['renderOnboarding', 'renderLabConversionModal', 'renderProfiloPlaceholder', 'renderMichelinAIGlobalePlaceholder']) assert.strictEqual(c[n](), cm[n](), n);
    const classico = "const hideSidebar=S.uiD3?false:(S.view==='attive'||S.view==='profilo'||S.view==='load'||S.view==='preview'||S.view==='michelinai-globale'||S.view==='app-home'||S.view==='lab-globale');";
    assert.ok(html.includes(classico) && fm.render.includes("const hideSidebar=S.view==='attive'||S.view==='profilo'||S.view==='load'||S.view==='preview'||S.view==='michelinai-globale'||S.view==='app-home'||S.view==='lab-globale';"), 'regola classica della barra laterale invariata');
    assert.ok(html.includes("shellEl.classList.toggle('app-home-active',S.view==='app-home'&&!S.uiD3)"), 'Home classica a schermo intero invariata');
  });

  await test('P11. navigazione Direzione 3: la sezione evidenziata e\' quella in cui si lavora', async () => {
    const c = await setup(); c.S.uiD3 = true;
    for (const [view, mode, sez] of [['recipe', 'lab', 'lab'], ['recipe', 'produzione', 'produzione'], ['lab-globale', 'lab', 'lab'], ['attive', 'lab', 'produzione'], ['sessione-operativa', 'lab', 'produzione'], ['storico-produzioni', 'lab', 'produzione'],
      ['home', 'lab', 'schede'], ['ricetta-madre-v2', 'produzione', 'schede'], ['load', 'lab', 'schede'], ['confronto', 'lab', 'schede'], ['app-home', 'lab', 'nessuna']]) {
      Object.assign(c.S, { view, mode });
      assert.strictEqual(c.d3SezioneNav(), sez, view + '/' + mode);
      const attivi = [...c.renderSidebar().matchAll(/class="load-btn active" id="sb-(\w+)"/g)].map(m => m[1]);
      assert.deepStrictEqual(attivi, sez === 'nessuna' ? [] : [{ lab: 'lab', schede: 'ricette', produzione: 'produzione' }[sez]], 'voce evidenziata ' + view);
    }
    c.S.uiD3 = false; assert.strictEqual(c.d3SezioneNav(), null, 'grafica classica: regola di sempre');
  });

  await test('P12. Home Direzione 3: tre accessi con i conteggi esistenti, azioni esistenti, nessun id duplicato con la barra laterale', async () => {
    const c = await setup(); c.S.uiD3 = true;
    const h = c.renderAppHomeD3(), t = text(h);
    const k = c.d3ConteggiHome();
    const bozze = c.S.recipes.filter(r => !r.parentRecipeId).reduce((n, r) => n + (r.labVersions || []).length, 0);
    assert.deepStrictEqual(k, { attive: 4, schede: 2, bozze, schedeLab: c.S.recipes.filter(r => !r.parentRecipeId && (r.labVersions || []).length).length });
    assert.ok(/4 Ricette attive/.test(t) && /2 Schede/.test(t) && new RegExp(bozze + ' bozz').test(t), t);
    for (const id of ['apphome-produzione', 'apphome-schede', 'apphome-lab', 'apphome-impostazioni']) assert.ok(h.includes('id="' + id + '"'), id + ': stesso gestore di oggi');
    assert.ok(!/id="btn-new-recipe"|id="btn-load-view"/.test(h), 'nessun id della barra laterale ripetuto');
    assert.ok(/onclick="nuovaScheda\(\)"/.test(h) && /onclick="S\.view='load';render\(\)"/.test(h), 'Nuova Scheda e Carica Scheda: funzioni esistenti');
    assert.ok(/btnLoad\.addEventListener\('click',\(\)=>\{S\.view='load';render\(\);\}\)/.test(html), 'stessa azione del pulsante della barra laterale');
    assert.ok(!/ultime bozze/i.test(t) && !/statistic/i.test(t));
  });

  await test('P13. stili della Direzione 3 nel foglio di stile dell\'app, mai nel modello del PDF', async () => {
    const foglio = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.ok(foglio.includes('Direzione 3 — uniformazione') && foglio.includes('.d3-home-grid'));
    const pdf = topLevelFunctions(html).exportPDF;
    assert.ok(!/ui-d3|d3-/.test(pdf.replace("Anteprima Direzione 3", '')), 'il PDF non contiene stili D3');
  });

  await test('P14. nessuno stile nuovo tocca la grafica classica: ogni regola dell\'uniformazione vale solo con body.ui-d3 o su classi d3-', async () => {
    const a = html.indexOf('/* ══ Direzione 3 — uniformazione'), b = html.indexOf('</style>', a);
    const blocco = html.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '');
    const selettori = [];
    const scorri = txt => { for (const m of txt.matchAll(/([^{}]+)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) { const sel = m[1].trim(); if (sel.startsWith('@media')) scorri(m[2]); else selettori.push(...splitSel(sel)); } };
    const splitSel = sel => { const out = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
    scorri(blocco);
    assert.ok(selettori.length > 80, 'regole trovate: ' + selettori.length);
    const fuori = selettori.filter(x => !/^body\.ui-d3($|[\s.:#\[])/.test(x) && !/^\.d3-/.test(x));
    assert.deepStrictEqual(fuori, []);
  });

  await test('P15. ordine LAB -> Schede -> Produzione in Home, barra laterale e barra in basso (Direzione 3); grafica classica nell\'ordine di sempre', async () => {
    const c = await setup(); c.S.view = 'home';
    const ordine = (h, re) => [...h.matchAll(re)].map(m => m[1]);
    const sb = /id="sb-(lab|ricette|produzione)"/g, bn = /id="bnav-(lab|ricette|produzione)"/g, ho = /id="apphome-(lab|schede|produzione)"/g;
    assert.deepStrictEqual(ordine(c.renderSidebar(), sb), ['produzione', 'ricette', 'lab'], 'classica: barra laterale invariata');
    assert.deepStrictEqual(ordine(c.renderBottomNav(), bn), ['produzione', 'ricette', 'lab'], 'classica: barra in basso invariata');
    c.S.uiD3 = true;
    assert.deepStrictEqual(ordine(c.renderSidebar(), sb), ['lab', 'ricette', 'produzione']);
    assert.deepStrictEqual(ordine(c.renderBottomNav(), bn), ['lab', 'ricette', 'produzione']);
    const h = c.renderAppHomeD3();
    assert.deepStrictEqual(ordine(h, ho), ['lab', 'schede', 'produzione']);
    assert.ok(/d3-amb-lab" id="apphome-lab"/.test(h) && /d3-amb-schede" id="apphome-schede"/.test(h) && /d3-amb-produzione" id="apphome-produzione"/.test(h), 'colori di ambiente');
    assert.ok((h.match(/<svg /g) || []).length === 3, 'icone nel codice, nessun carattere esterno');
    const foglio = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.ok(/--d3-amb-lab:#24533F/.test(foglio) && /--d3-amb-schede:#94661C/.test(foglio) && /--d3-amb-produzione:#B4501C/.test(foglio), 'LAB verde, Schede ocra, Produzione terracotta');
    assert.ok(!/d3-amb-/.test(c.renderSchedaD3(rec(c))), 'i colori di ambiente non entrano negli stati delle Ricette');
  });

  await test('P16. elenco LAB: "Ultima modifica" (predefinito, stesso criterio dell\'elenco classico) e A-Z; gruppi per Scheda; nessuna data inventata', async () => {
    const c = await setup(); c.S.uiD3 = true; c.S.view = 'lab-globale';
    const rB = rec(c), rX = rec(c, 'rX');
    rX.labVersions = [{ ...clone(rB.labVersions[0]), id: 'lvX1', label: 'Zeta', contenutoModificatoIl: '2026-10-20T10:00:00Z' }, { ...clone(rB.labVersions[0]), id: 'lvX2', label: 'Alfa', contenutoModificatoIl: null }];
    rB.labVersions[0].contenutoModificatoIl = '2026-10-10T10:00:00Z';
    rB.labVersions.push({ ...clone(rB.labVersions[0]), id: 'lvB2', label: 'Beta', contenutoModificatoIl: '2026-10-25T10:00:00Z' });
    assert.strictEqual(c.d3LabOrdine(), 'modifica', 'predefinito: Ultima modifica');
    const ids = g => g.gruppi.flatMap(x => x.bozze.map(b => b.id));
    const mod = c.d3GruppiLab('modifica');
    assert.deepStrictEqual(mod.gruppi.map(g => g.recipeId), ['rB', 'rX'], 'gruppo nella posizione della sua bozza piu\' recente');
    assert.deepStrictEqual(ids(mod), ['lvB2', 'lvB', 'lvX1', 'lvX2'], 'senza data in fondo');
    const classico = [...c.renderLabGlobale().matchAll(/apriBozzaDalLabGlobale\('\w+','(\w+)'\)/g)].map(m => m[1]);
    assert.deepStrictEqual(classico, ids(mod), 'stesso criterio dell\'elenco classico');
    assert.deepStrictEqual(ids(c.d3GruppiLab('alfabetico')), ['lvX2', 'lvX1', 'lvB2', 'lvB'], 'A-Z: Schede e bozze in ordine italiano');
    c.d3SetLabOrdine('alfabetico'); assert.deepStrictEqual([c.d3LabOrdine(), c.storage.khub_lab_ordine], ['alfabetico', 'alfabetico'], 'scelta ricordata nel browser');
    const h = c.renderLabGlobaleD3();
    assert.ok(/non tracciata/.test(h) && /aria-pressed="true" onclick="d3SetLabOrdine\('alfabetico'\)"/.test(h) && /apriBozzaDalLabGlobale\('rX','lvX2'\)/.test(h), 'stessa apertura della bozza');
    assert.deepStrictEqual(saves, []);
  });

  await test('P17. LAB Direzione 3: "Resa prevista" facoltativa, nessun esempio "bignè", quantita\' a crudo; stessi campi e calcoli; grafica classica invariata', async () => {
    const c = await setup(); c.S.uiD3 = true; c.S.mode = 'lab'; c.S.view = 'recipe';
    const h = c.renderLabRecipe(labOf(c)), t = text(h);
    assert.ok(/Resa prevista facoltativa/.test(t) && !/Resa dichiarata/.test(t), 'Resa prevista (facoltativa)');
    assert.ok(!/placeholder="[^"]*bign/i.test(h) && !/<option value="bignè">/.test(h), 'nessun esempio "bignè"');
    assert.ok(/Quantità a crudo/.test(h), 'quantita\' a crudo');
    assert.ok(/calcolato dagli ingredienti/.test(t), 'peso a crudo spiegato');
    c.S.uiD3 = false; const hc = c.renderLabRecipe(labOf(c));
    assert.ok(/<th>Quantità<\/th>/.test(hc) && !/Quantità a crudo/.test(hc), 'classica invariata (vedi anche P1)');
    assert.deepStrictEqual(saves, []);
  });


  // ══ Finalizzazione grafica ══
  const classico = c => { c.S.uiD3 = false; return c; };
  await test('P18. Ricerca globale: stessi risultati e destinazioni della grafica classica; stato effettivo; nessuna emoji', async () => {
    const c = await setup();
    rec(c).validatedVariants.find(v => v.id === 'vaR').status = 'retired';
    const hc = classico(c).renderSearch('V va');
    c.S.uiD3 = true; const hd = c.renderSearch('V va');
    const dest = h => [...h.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
    assert.ok(dest(hc).length > 3);
    assert.deepStrictEqual(dest(hd), dest(hc), 'stessi risultati, stesso ordine, stesse destinazioni');
    const stati = Object.fromEntries(rec(c).validatedVariants.map(v => [v.name, c.d3StatoRicetta(v)]));
    assert.strictEqual(stati['V vaB'], 'attiva'); assert.strictEqual(stati['V vaP'], 'validata'); assert.strictEqual(stati['V vaR'], 'archiviata');
    for (const [nome, st] of Object.entries(stati)) {
      const riga = hd.split('<button class="d3-ricerca-riga').find(x => x.includes('>' + nome + '<'));
      assert.ok(riga && riga.includes('d3-pill-' + st), nome + ': ' + st);
    }
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]|\u{1F3F7}/u.test(hd), 'nessuna emoji (i simboli delle pillole di stato, es. ✓, restano)');
    assert.ok(!/Ricetta attiva: V vaP/.test(hd), 'mai "Ricetta attiva" per una Validata');
    assert.ok(/Ricetta attiva: V vaP/.test(hc), 'grafica classica invariata');
    assert.ok(/Nessun risultato/.test(c.renderSearch('zzzz')));
  });

  await test('P19. Confronta Ricette e Benvenuto: niente intestazione viola-indaco ne\' emoji; stessi gestori; classico invariato', async () => {
    const c = await setup(); c.S.uiD3 = true;
    const hd = c.renderConfronto(rec(c)), hc = classico(c).renderConfronto(rec(c));
    assert.ok(!/confronto-header/.test(hd) && /d3-h1 d3-serif">Confronta Ricette/.test(hd));
    assert.ok(/confronto-header/.test(hc), 'classico invariato');
    const selettori = h => h.slice(h.indexOf('<div class="confronto-selectors">'));
    assert.strictEqual(selettori(hd), selettori(hc), 'selezione e confronto identici');
    c.S.uiD3 = true; const od = c.renderOnboarding(), oc = classico(c).renderOnboarding();
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(od) && /Ricetta Validata/.test(od) && !/pronta/.test(od));
    assert.ok(/👨‍🍳/.test(oc) && /Ricetta pronta/.test(oc), 'classico invariato');
    const azione = h => h.match(/onclick="(S\.showOnboarding=false[^"]*)"/)[1];
    assert.strictEqual(azione(od), azione(oc), 'stessa azione "Inizia"');
  });

  await test('P20. Ricetta in Produzione e selettore LAB/Produzione: le regole degli stati restano; "Elimina" esplicito e separato', async () => {
    const c = await setup(); c.S.uiD3 = true; c.S.mode = 'produzione';
    c.S.selectedVariantId = 'vaB'; const att = c.renderProdRecipe(rec(c));
    c.S.selectedVariantId = 'vaP'; const val = c.renderProdRecipe(rec(c));
    c.S.selectedVariantId = 'vaR'; const arc = c.renderProdRecipe(rec(c));
    assert.ok(/openMandaInProduzione\('rB','vaB'\)/.test(att), 'Attiva: Manda in Produzione');
    assert.ok(!/openMandaInProduzione/.test(val) && !/openMandaInProduzione/.test(arc), 'Validata e Archiviata: mai in Produzione dal selettore');
    const azioni = att.slice(att.indexOf('header-actions'), att.indexOf('d3-prod-gestione'));
    assert.ok(!/deleteVariant/.test(azioni), 'nessuna eliminazione fra le azioni di produzione');
    assert.ok(/d3-prod-gestione[\s\S]*non riguarda le Sessioni di Produzione[\s\S]*onclick="deleteVariant\('rB','vaB'\)"[^>]*>Elimina questa Ricetta</.test(att), 'stesso gestore, significato esplicito');
    const cl = classico(c); cl.S.selectedVariantId = 'vaB'; const hc = cl.renderProdRecipe(rec(cl));
    assert.ok(/<i class="ti ti-trash"><\/i> Elimina<\/button>/.test(hc) && !/d3-prod-gestione/.test(hc), 'classico invariato');
    const css = html.slice(html.indexOf('/* Selettore LAB / Produzione'), html.indexOf('/* Confronta Ricette */'));
    assert.ok(/lab-active\{background:var\(--d3-amb-lab\)/.test(css) && /prod-active\{background:var\(--d3-amb-produzione\)/.test(css));
  });

  await test('P21. pulsanti principali nel colore dell\'ambiente, contrasto sufficiente; conversione "pezzi → grammi"; segnaposto con navigazione', async () => {
    const c = await setup(); c.S.uiD3 = true;
    for (const [v, m, amb] of [['recipe', 'lab', 'lab'], ['recipe', 'produzione', 'produzione'], ['ricetta-madre-v2', 'lab', 'schede'], ['load', 'lab', 'schede'], ['attive', 'lab', 'produzione'], ['lab-globale', 'lab', 'lab']]) {
      c.S.view = v; c.S.mode = m; assert.strictEqual(c.d3SezioneNav(), amb, v + '/' + m);
      assert.ok(new RegExp('body\\.ui-d3\\[data-d3-amb="' + amb + '"\\]\\{--d3-primario:var\\(--d3-amb-' + amb + '\\);\\}').test(html), amb);
    }
    assert.ok(/document\.body\.setAttribute\('data-d3-amb',d3SezioneNav\(\)\)/.test(html) && /body\.ui-d3 \.d3-btn-primary\{background:var\(--d3-primario\)/.test(html));
    const colori = Object.fromEntries([...html.match(/body\.ui-d3\{--d3-amb-lab:[^}]*\}/)[0].matchAll(/--d3-amb-(lab|schede|produzione):(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]));
    const lum = h => { const c3 = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * c3[0] + 0.7152 * c3[1] + 0.0722 * c3[2]; };
    for (const [k, h] of Object.entries(colori)) assert.ok(1.05 / (lum(h) + 0.05) >= 4.5, k + ' ' + h + ': testo bianco leggibile');
    assert.strictEqual(Object.keys(colori).length, 3);
    c.S.pendingLabConversion = { recipeId: 'rB', labVersionId: 'lvB', ingId: 'x', ingName: 'Uova (impasto)', fromUnit: 'n', toUnit: 'g', askUnit: 'n', value: '55', isReference: false, loading: false, error: null };
    assert.ok(/Da pezzi → grammi: serve un dato/.test(c.renderLabConversionModal()));
    assert.ok(/Da n a g: serve un dato/.test(classico(c).renderLabConversionModal()), 'classico invariato');
    c.S.uiD3 = true;
    assert.ok(/d3-segnaposto/.test(c.renderProfiloPlaceholder()) && /d3-segnaposto/.test(c.renderMichelinAIGlobalePlaceholder()));
    assert.ok(/const hideSidebar=S\.uiD3\?false:/.test(html), 'barra laterale (e barra in basso) anche nei segnaposto');
  });

  await test('P22. coerenza: conteggio Schede della Home come l\'archivio; un solo criterio "Ultima modifica"; un solo gestore "Nuova Scheda"; scorrimento delle schede del LAB', async () => {
    const c = await setup(); c.S.uiD3 = true;
    c.S.recipes.push({ ...clone(rec(c, 'rX')), id: 'rSub', name: 'Sotto-ricetta', parentRecipeId: 'rX' });
    assert.strictEqual(c.d3ConteggiHome().schede, c.S.recipes.filter(r => !r.parentRecipeId).length);
    assert.strictEqual(c.d3ConteggiHome().schede, 2, 'le sotto-ricette non sono Schede dell\'archivio');
    const fn = topLevelFunctions(html);
    assert.ok(/confrontaUltimaModificaBozze/.test(fn.renderLabGlobale) && /confrontaUltimaModificaBozze/.test(fn.d3GruppiLab));
    assert.ok(!/new Date\(tb\)-new Date\(ta\)/.test(fn.d3GruppiLab + fn.renderLabGlobale) && /new Date\(tb\)-new Date\(ta\)/.test(fn.confrontaUltimaModificaBozze), 'il criterio vive in un solo punto');
    assert.strictEqual((html.match(/makeDefaultLab\(id,'Nuova Scheda'\)/g) || []).length, 1, 'un solo gestore Nuova Scheda');
    assert.ok(/d3AggiornaScorrimento\(\);\}/.test(fn.render) && /\.d3-scorre-dx\{-webkit-mask-image/.test(html));
  });

  await test('P23. nome della Ricetta nel titolo del LAB (Direzione 3): il gestore reale aggiorna lo stato, il salvataggio automatico lo scrive e sopravvive a un nuovo caricamento', async () => {
    const c = await setup({ autosaveReale: true }); c.S.uiD3 = true;
    c.nuovaScheda(); await new Promise(r => setTimeout(r, 50)); // salvataggio iniziale della creazione
    const id = c.S.selectedId, r0 = rec(c, id);
    assert.ok(id && r0 && c.S.view === 'recipe' && c.S.mode === 'lab', 'Nuova Scheda aperta nel LAB');
    const h = c.renderLabRecipe(r0);
    const codice = attributo(h, 'textarea class="d3-titolo-input', 'onchange');
    assert.ok(codice.includes('onLabDraftNameChange('), 'il titolo usa il gestore esistente');
    // Il codice dell'attributo e' JavaScript valido (prima: espressione regolare spezzata da un a capo).
    assert.doesNotThrow(() => new Function(codice), 'gestore onchange non valido: ' + JSON.stringify(codice));
    const salvatiPrima = saves.length;
    c.eseguiInline(codice, { value: 'Crema di prova\n  al limone' }); // a capo incollato -> uno spazio
    const v = rec(c, id).labVersions[0];
    assert.deepStrictEqual([v.name, v.label], ['Crema di prova al limone', 'Crema di prova al limone'], 'stato aggiornato');
    assert.strictEqual(saves.length, salvatiPrima, 'nessun salvataggio prima del ritardo del salvataggio automatico');
    await new Promise(r => setTimeout(r, 1800)); // ritardo reale di autosave (1500 ms) + scrittura
    const ultimo = saves[saves.length - 1];
    assert.ok(saves.length > salvatiPrima && ultimo.recipe.id === id, 'salvataggio automatico eseguito');
    assert.strictEqual(ultimo.variants.find(x => x.id === v.id).name, 'Crema di prova al limone', 'nome nel salvataggio');
    assert.strictEqual(fake.tables.variants.find(x => x.id === v.id).name, 'Crema di prova al limone', 'nome nel database');
    // Nuovo caricamento (come aggiornare la pagina): stesso database, client nuovo.
    const c2 = makeClientD3(clientFetch); await c2.loadFromSupabase(); c2.S.uiD3 = true;
    const r2 = rec(c2, id);
    assert.ok(r2, 'Scheda presente dopo il ricaricamento');
    assert.strictEqual(r2.labVersions[0].name, 'Crema di prova al limone', 'nome presente dopo il ricaricamento');
    assert.ok(c2.renderLabRecipe(r2).includes('>Crema di prova al limone</textarea>'), 'titolo mostrato dopo il ricaricamento');
    // Titolo vuoto: ignorato come nella grafica classica (nessun nome cancellato).
    c2.eseguiInline(attributo(c2.renderLabRecipe(r2), 'textarea class="d3-titolo-input', 'onchange'), { value: '  \n ' });
    assert.strictEqual(rec(c2, id).labVersions[0].name, 'Crema di prova al limone', 'titolo vuoto ignorato');
  });

  await test('P24. stesso comportamento funzionale nelle due grafiche: predefinita (Direzione 3) e ?ui=classic -> nome della bozza, salvataggio automatico, ricaricamento, stesso pulsante Valida', async () => {
    for (const [modo, search, sel] of [['Direzione 3 (predefinita)', '', 'textarea class="d3-titolo-input'], ['classica', '?ui=classic', 'input\\s+class="recipe-name"']]) {
      const c = await setup({ search, autosaveReale: true }); c.initUiD3();
      assert.strictEqual(c.S.uiD3, !search, modo + ': grafica attesa');
      c.S.mode = 'lab'; c.S.view = 'recipe'; const r = labOf(c), lab = r.labVersions[r.currentLabIdx];
      const h = c.renderLabRecipe(r);
      assert.strictEqual(/d3-titolo-input/.test(h), !search, modo + ': markup della grafica');
      assert.ok(/id="btn-show-validate"/.test(h), modo + ': stesso pulsante Valida');
      const codice = attributo(h.replace(/\n\s*/g, ' '), sel, 'onchange');
      assert.ok(codice.startsWith("onLabDraftNameChange('rB',"), modo + ': stesso gestore del nome');
      c.eseguiInline(codice, { value: 'Nome ' + modo });
      assert.strictEqual(rec(c).labVersions[r.currentLabIdx].name, 'Nome ' + modo, modo + ': stato');
      await new Promise(x => setTimeout(x, 1800));
      assert.strictEqual(fake.tables.variants.find(v => v.id === lab.id).name, 'Nome ' + modo, modo + ': salvato automaticamente');
      const c2 = makeClientD3(clientFetch, { search }); c2.initUiD3(); await c2.loadFromSupabase();
      assert.strictEqual(c2.S.uiD3, !search, modo + ': grafica dopo il ricaricamento');
      assert.strictEqual(rec(c2).labVersions.find(v => v.id === lab.id).name, 'Nome ' + modo, modo + ': nome dopo il ricaricamento');
    }
  });

  await test('P25. colori degli ambienti (solo Direzione 3): schede della Home a colore pieno senza sfumature, testi a contrasto AA, colori gia\' definiti, stati invariati, grafica classica non toccata', async () => {
    const token = n => (html.match(new RegExp('--' + n + ':(#[0-9A-Fa-f]{6});')) || [])[1];
    const amb = { lab: token('d3-amb-lab'), schede: token('d3-amb-schede'), produzione: token('d3-amb-produzione') };
    assert.deepStrictEqual(amb, { lab: '#24533F', schede: '#94661C', produzione: '#B4501C' }, 'stessi colori gia\' assegnati agli ambienti');
    const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const contrasto = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const [k, c] of Object.entries(amb)) assert.ok(contrasto(c, '#FFFFFF') >= 4.5, k + ': bianco sul colore pieno ' + contrasto(c, '#FFFFFF').toFixed(2));
    for (const [k, c] of Object.entries(amb)) assert.ok(contrasto(c, token('d3-bg')) >= 3, k + ': titolo grande sullo sfondo ' + contrasto(c, token('d3-bg')).toFixed(2));
    // Regole del blocco: tutte limitate alla Direzione 3, nessuna sfumatura, nessun colore nuovo.
    const blocco = html.slice(html.indexOf("/* Uniformita' cromatica degli ambienti"), html.indexOf('body.ui-d3 .d3-bozza.attiva{'));
    const regole = blocco.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(r => r.trim()).filter(Boolean);
    const selettori = sel => { const out = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } return out.concat(cur); };
    assert.ok(regole.length >= 10 && regole.every(r => selettori(r.split('{')[0]).every(sel => /^body\.ui-d3/.test(sel.trim()))), 'ogni regola vale solo con body.ui-d3');
    assert.ok(!/gradient|rgba|opacity/i.test(blocco.replace(/\/\*[\s\S]*?\*\//g, '')), 'nessuna sfumatura o trasparenza');
    assert.deepStrictEqual([...new Set((blocco.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9A-Fa-f]{3,6}\b/g) || []))], ['#fff'], 'solo i colori degli ambienti (variabili) e il bianco');
    assert.ok(/\.d3-home-card\[class\*="d3-amb-"\]\{background:var\(--amb\)/.test(blocco), 'Home: sfondo pieno del colore dell\'ambiente');
    assert.ok(/:focus-visible\{outline:3px solid/.test(blocco), 'Home: fuoco da tastiera visibile sul colore pieno');
    // Colori semantici invariati: stato Attiva, bozza In LAB, avvisi ed eliminazione non citati nel blocco.
    assert.ok(!/d3-pill|d3-band|d3-verde|toast|danger|elimina|errore|avviso/i.test(blocco), 'nessun colore di stato, avviso o eliminazione toccato');
    // Markup invariato: la Home D3 usa le stesse classi; la grafica classica non ha classi d3-amb.
    const c = await setup(); c.S.uiD3 = true;
    const h = c.renderAppHomeD3();
    for (const k of ['lab', 'schede', 'produzione']) assert.ok(h.includes('d3-home-card d3-amb-' + k), 'scheda Home: ' + k);
    c.S.uiD3 = false; assert.ok(!/d3-amb-/.test(c.renderAppHome()), 'Home classica senza classi della Direzione 3');
  });

  await test('P26. fascia dell\'ambiente nell\'intestazione (Direzione 3): colore pieno, icona SVG gia\' presente e nome; nessuna altezza in piu\'; Home e grafica classica neutre; icona sempre visibile su mobile', async () => {
    // Elemento: creato una sola volta accanto al logo, con le tre voci e le icone di D3_ICONE_AMBIENTE.
    const icone = new Function(html.match(/var D3_ICONE_AMBIENTE=\(function\(\)\{[\s\S]*?\n\}\)\(\);/)[0] + '\nreturn D3_ICONE_AMBIENTE;')();
    const creati = []; let inserito = null;
    const doc = { getElementById: id => (id === 'khub-logo' ? { insertAdjacentElement: (pos, el) => { inserito = [pos, el]; } } : (id === 'd3-amb-testa' ? inserito && inserito[1] : null)),
      createElement: tag => { const el = { tag }; creati.push(el); return el; } };
    const inserisci = new Function('document', 'D3_ICONE_AMBIENTE', extractFunction('function d3InserisciTestaAmbiente()') + '\nreturn d3InserisciTestaAmbiente;')(doc, icone);
    inserisci(); inserisci();
    assert.strictEqual(creati.length, 1, 'inserita una sola volta');
    const [pos, el] = inserito;
    assert.deepStrictEqual([pos, el.id, el.className], ['afterend', 'd3-amb-testa', 'd3-amb-testa'], 'accanto al logo, nell\'intestazione esistente');
    for (const [amb, ic, nome] of [['lab', 'ti-flask', 'LAB'], ['schede', 'ti-book-2', 'Schede'], ['produzione', 'ti-tools-kitchen-2', 'Produzione']])
      assert.ok(el.innerHTML.includes('data-amb="' + amb + '"><span class="d3-amb-testa-icona" aria-hidden="true">' + icone[ic] + '</span><span class="d3-amb-testa-nome">' + nome + '</span>'), 'voce ' + amb + ' con l\'icona SVG gia\' presente');
    assert.ok(/initUiD3\.ascolto=true;\s*d3InserisciTestaAmbiente\(\);/.test(html), 'inserita all\'avvio, una volta');
    // CSS: nascosta di base (anche nella grafica classica); a colore pieno solo dentro un ambiente della Direzione 3.
    assert.ok(/\n\.d3-amb-testa\{display:none;\}/.test(html), 'nascosta di base');
    const blocco = html.slice(html.indexOf("/* Fascia dell'ambiente"), html.indexOf("/* Dentro l'ambiente: titolo di pagina"));
    const AMB = 'body.ui-d3:is([data-d3-amb="lab"],[data-d3-amb="schede"],[data-d3-amb="produzione"])';
    assert.ok(blocco.includes(AMB + ' .topbar{background:var(--d3-primario);border-bottom-color:var(--d3-primario);}'), 'intestazione a colore pieno dell\'ambiente');
    assert.ok(blocco.includes(AMB + ' .d3-amb-testa{display:flex;'), 'fascia visibile solo dentro un ambiente (Home: data-d3-amb="nessuna", neutra)');
    assert.ok(!/height|padding:|position|z-index/.test(blocco.replace(/\/\*[\s\S]*?\*\//g, '').replace(/min-height:30px|padding-left:16px|line-height:1;|width:24px;height:24px;/g, '')), 'nessuna altezza, spaziatura o livello nuovi per l\'intestazione');
    assert.ok(!/save-indicator/.test(blocco), 'indicatore "Salvato" invariato (pillola chiara)');
    assert.ok(blocco.includes(AMB + ' .mode-switcher{background:#fff;border-color:#fff;}'), 'selettore LAB/Produzione su fondo chiaro');
    const mobile = html.slice(html.lastIndexOf('@media(max-width:768px){'), html.indexOf('</style>', html.lastIndexOf('@media(max-width:768px){')));
    assert.ok(/:has\(#mode-switcher\[style\*="flex"\]\) \.d3-amb-testa-nome\{display:none;\}/.test(mobile) && !/d3-amb-testa-icona\{display:none/.test(html), 'su mobile al massimo si nasconde il nome, mai l\'icona');
    assert.ok(!/gradient|rgba|opacity/.test(blocco), 'colore pieno, nessuna sfumatura');
    // Le regole di P25 restano valide (stesso blocco, nuovi selettori limitati a body.ui-d3).
  });

  // ── Errori di persistenza: mai un successo silenzioso, stato locale intatto ──
  const risposta = (status, corpo) => () => ({ ok: status >= 200 && status < 300, status, json: async () => (corpo === undefined ? JSON.parse('non json') : clone(corpo)) });
  const GUASTI = [
    ['401', risposta(401, { error: 'Accesso non autorizzato' }), /sessione scaduta, accedi di nuovo/],
    ['403', risposta(403, { error: 'Origine non consentita' }), /richiesta non consentita/],
    ['500', risposta(500, { error: 'Proxy error', details: 'x' }), /errore del server \(500\)/],
    ['503 db_config', risposta(503, { error: 'Database non configurato', code: 'db_config' }), /database non configurato/],
    ['503 generico', risposta(503, {}), /servizio non disponibile/],
    ['ok:false', risposta(200, { ok: false, errors: ['recipes: PGRST204'] }), /il database ha rifiutato i dati/],
    ['200 senza ok', risposta(200, {}), /risposta non valida dal server/],
    ['200 non JSON', risposta(200, undefined), /risposta non valida dal server/],
    ['rete', () => { throw new TypeError('fetch failed'); }, /connessione assente o interrotta/],
  ];
  // Client con un fetch che si puo' guastare per una sola azione.
  async function setupGuastabile() {
    const g = { azione: null, fn: null };
    const f = async (url, o) => { const b = JSON.parse(o.body); if (g.fn && b.supabaseAction === g.azione) return g.fn(b); return clientFetch(url, o); };
    fake = withPatch((() => { const x = makeFakeSupabase(); seed(x); return x; })(), {}); globalThis.fetch = fake.fetch; saves = [];
    const c = makeClientD3(f); await c.loadFromSupabase(); c.S.selectedId = 'rB'; c.g = g; return c;
  }

  await test('E1. salvataggio: 401, 403, 500, 503, ok:false, risposte non valide e rete -> false, messaggio comprensibile, stato locale e database intatti', async () => {
    for (const [nome, guasto, motivo] of GUASTI) {
      const c = await setupGuastabile(); const r = labOf(c);
      const lab = r.labVersions[r.currentLabIdx]; lab.name = 'Bozza modificata ' + nome; lab.ingredients = lab.ingredients.slice(1); // rinomina + ingrediente tolto
      const statoPrima = clone(c.S.recipes), dbPrima = clone(fake.tables);
      c.g.azione = 'save'; c.g.fn = guasto;
      assert.strictEqual(await c.saveToSupabase(r), false, nome + ': fallimento riconosciuto');
      const msg = c.log.toasts.join(' | ');
      assert.ok(/Salvataggio non riuscito: /.test(msg) && motivo.test(msg) && /restano in questa pagina ma non sono salvate/.test(msg), nome + ': ' + msg);
      assert.deepStrictEqual(c.S.recipes, statoPrima, nome + ': stato locale non toccato');
      assert.deepStrictEqual(fake.tables, dbPrima, nome + ': database invariato');
      // Il prossimo salvataggio riuscito reinvia tutto, compresa l'eliminazione dell'ingrediente.
      c.g.fn = null; c.log.toasts.length = 0;
      assert.strictEqual(await c.saveToSupabase(r), true, nome + ': nuovo tentativo riuscito');
      assert.deepStrictEqual(c.log.toasts, [], nome + ': nessun messaggio di errore al successo');
      assert.strictEqual(fake.tables.variants.find(v => v.id === lab.id).name, 'Bozza modificata ' + nome, nome + ': nome salvato al nuovo tentativo');
      // (per nome: gli id sintetici di 4 caratteri vengono rigenerati da saveToSupabase, come sempre)
      assert.deepStrictEqual(fake.tables.ingredients.filter(i => i.variant_id === lab.id).map(i => i.name).sort(), lab.ingredients.map(i => i.name).sort(), nome + ': eliminazione applicata al nuovo tentativo');
    }
  });

  await test('E2. salvataggio con il server reale senza chiave valida: 503 db_config mostrato, nulla perso', async () => {
    const c = await setupGuastabile(); const r = labOf(c); r.labVersions[r.currentLabIdx].name = 'Non salvata';
    const chiave = process.env.SUPABASE_SECRET_KEY; const statoPrima = clone(c.S.recipes), dbPrima = clone(fake.tables);
    process.env.SUPABASE_SECRET_KEY = 'sb_publishable_non_valida_qui';
    try { assert.strictEqual(await c.saveToSupabase(r), false); } finally { process.env.SUPABASE_SECRET_KEY = chiave; }
    assert.ok(/database non configurato/.test(c.log.toasts.join(' ')), c.log.toasts.join(' | '));
    assert.deepStrictEqual([c.S.recipes, fake.tables], [statoPrima, dbPrima]);
  });

  await test('E3. caricamento: 401, 403, 500, 503, risposte non valide e rete -> false, messaggio, Schede in memoria non svuotate ne\' sostituite', async () => {
    for (const [nome, guasto, motivo] of GUASTI.filter(x => x[0] !== 'ok:false')) {
      const c = await setupGuastabile(); labOf(c).labVersions[0].name = 'Modifica locale non salvata';
      const statoPrima = clone(c.S.recipes); c.g.azione = 'load'; c.g.fn = guasto;
      assert.strictEqual(await c.loadFromSupabase(), false, nome);
      const msg = c.log.toasts.join(' | ');
      assert.ok(/Caricamento delle Schede non riuscito: /.test(msg) && motivo.test(msg), nome + ': ' + msg);
      assert.deepStrictEqual(c.S.recipes, statoPrima, nome + ': stato in memoria intatto');
    }
    // Primo caricamento fallito: nessuna Scheda inventata, messaggio visibile; poi caricamento riuscito.
    const g = { fn: risposta(503, { code: 'db_config' }) };
    const c = makeClientD3(async (u, o) => (g.fn ? g.fn() : clientFetch(u, o)));
    assert.strictEqual(await c.loadFromSupabase(), false);
    assert.deepStrictEqual(c.S.recipes, []); assert.ok(/database non configurato/.test(c.log.toasts.join(' ')));
    g.fn = null; c.log.toasts.length = 0;
    assert.strictEqual(await c.loadFromSupabase(), true); assert.ok(c.S.recipes.length > 0); assert.deepStrictEqual(c.log.toasts, []);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack); process.exit(1); });
