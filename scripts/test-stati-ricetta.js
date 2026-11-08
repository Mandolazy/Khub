/*
 * Test — Stati delle Ricette (percorso approvato):
 * IN LAB -> Valida -> VALIDATA -> Rendi attiva -> ATTIVA -> Produzione.
 * Controllo lato server sull'azione 'save' (transizione fra stato salvato e
 * stato richiesto) e sulla creazione delle Sessioni: attivazione diretta
 * rifiutata, aggiornamenti legittimi delle Attive ammessi, formulazione delle
 * validate protetta, riapertura solo dove le regole la consentono,
 * archiviazione e disattivazione, piu' Attive nella stessa Scheda, snapshot
 * delle Sessioni mai riscritti, importazioni e dati storici compatibili.
 *
 * Codice REALE estratto da khub_mvp.html e api/chat.js contro un finto
 * PostgREST in memoria. Solo dati sintetici, nessuna rete, nessun Supabase.
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

// ══════════════════════════════════════════════════════════
// Client reale con le funzioni di stato (validazione, attivazione,
// archiviazione, riapertura, importazione) e rendiAttiva neutralizzata.
// ══════════════════════════════════════════════════════════
const EXTRA_STATI = ['function retireVariant(recipeId,variantId)', 'function rendiAttiva(recipeId)', 'function bozzaVuota(v)',
  'async function eliminaSulServer(table,id,extra)', 'async function deleteVariant(recipeId,variantId)', 'async function deleteRecipe(id)', 'async function eliminaBozza(recipeId,variantId)', 'async function confirmMerge()',
  'function ricetteDellaScheda(recipe)', 'function testoEliminaScheda(recipe)'];
const SRC_STATI = SRC_UX + '\n' + EXTRA_STATI.filter(m => !defined(m) && !SRC_UX.includes(m)).map(extractFunction).join('\n');
function makeClientStati(fetchImpl) {
  const log = { toasts: [] };
  const c = new Function('fetch', 'log', 'document', 'confirm', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},variantHistory:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{},labYieldInput:{},activeYieldEdit:null,
      view:'ricetta-madre-v2',mode:'produzione',selectedVariantId:null,pendingFamilies:[],pendingNewFamily:'',showFamilyPicker:false,familyManagerMode:false,justValidated:null,renameEdit:null,rmv2AttivaEspansa:{},pendingDuplicaSceltaRecipeId:null,confirmDeleteId:null};
    var _knownIngredientIdsByVariant={}; var _persistedValidatedSig={}; var _saveLocked=false, _saveTimer={};
    function render(){} function autosave(){} function toast(msg){log.toasts.push(msg);} function alert(msg){log.toasts.push('ALERT '+msg);}
    ${SRC_STATI}
    return {S, loadFromSupabase, saveToSupabase, onValidate, confirmValidate, toggleActiveV2, rendiAttivaPronta, riapriProntaInLab, retireVariant, rendiAttiva,
      creaBozzaDaSorgente, upLab, upRec, R, curLab, deleteVariant, deleteRecipe, eliminaBozza, confirmMerge, ricetteDellaScheda, testoEliminaScheda};
  `)(fetchImpl, log, { getElementById: () => null }, () => true);
  c.log = log; return c;
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase'; process.env.SUPABASE_ANON_KEY = 'anon';
  const chatSrc = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(chatSrc).toString('base64'));
  const realHandler = await require('./_khub-test-session').withTestSession(mod.default);
  let fake, saves = [];
  async function callApi(body) { let status = 200, out; if (body.supabaseAction === 'save') saves.push(clone(body.data));
    await realHandler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } }); return { status, body: out }; }
  const clientFetch = async (url, o) => { const r = await callApi(JSON.parse(o.body)); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  async function setup() {
    fake = withPatch((() => { const f = makeFakeSupabase(); seed(f); return f; })(), {}); globalThis.fetch = fake.fetch; saves = [];
    // Pronta vaQ gia' usata in una Sessione (come nella suite UX).
    const vP = fake.tables.variants.find(v => v.id === 'vaP');
    fake.tables.variants.push({ ...clone(vP), id: 'vaQ', name: 'V vaQ', label: 'V vaQ' });
    fake.tables.ingredients.push({ id: 'fvaQ', variant_id: 'vaQ', name: 'Farina', qty: 400, unit: 'g', sort_order: 0, estimated_yield_pct: null, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
    fake.tables.production_sessions.push({ id: 'psQ', recipe_id: 'rB', source_variant_id: 'vaQ', status: 'completed', snapshot: { ingredients: [{ name: 'Farina', qty: 400 }] }, target_finished_total: 400 });
    const c = makeClientStati(clientFetch); await c.loadFromSupabase(); c.S.selectedId = 'rB';
    return c;
  }
  const riga = id => fake.tables.variants.find(v => v.id === id);
  const stato = id => { const v = riga(id); return v ? [v.status, v.active] : null; };
  const db = () => clone({ v: fake.tables.variants, i: fake.tables.ingredients, s: fake.tables.production_sessions, r: fake.tables.recipes });
  const ingDb = id => fake.tables.ingredients.filter(i => i.variant_id === id).sort((a, b) => a.sort_order - b.sort_order).map(i => [i.name, Number(i.qty), i.unit]);
  const salva = data => callApi({ supabaseAction: 'save', data }).then(r => r.body);
  const rigaPayload = (id, extra) => ({ ...clone(riga(id)), ...extra });
  const vv = (c, id, rid = 'rB') => c.R(rid).validatedVariants.find(v => v.id === id);
  console.log('Stati delle Ricette: IN LAB -> Valida -> VALIDATA -> Rendi attiva -> ATTIVA -> Produzione');

  await test('T1. percorso approvato: Valida (stesso id, non Attiva) e poi Rendi attiva dalla Scheda; nessuna Sessione creata', async () => {
    const c = await setup(); const sess = clone(fake.tables.production_sessions);
    c.R('rB').currentLabIdx = c.R('rB').labVersions.findIndex(v => v.id === 'lvB');
    c.onValidate(); await c.confirmValidate();
    assert.deepStrictEqual(stato('lvB'), ['validated', false], 'Validata, non ancora Attiva');
    c.rendiAttivaPronta('rB', 'lvB'); assert.strictEqual(await c.saveToSupabase(c.R('rB')), true);
    assert.deepStrictEqual(stato('lvB'), ['validated', true]);
    assert.deepStrictEqual(fake.tables.production_sessions, sess, 'Rendi attiva non avvia Sessioni');
  });

  await test('T2. attivazione diretta di una bozza rifiutata dal server; rendiAttiva() non modifica nulla', async () => {
    const c = await setup(); const prima = db();
    c.R('rB').currentLabIdx = c.R('rB').labVersions.findIndex(v => v.id === 'lvB');
    c.rendiAttiva('rB');
    assert.ok(c.R('rB').labVersions.some(v => v.id === 'lvB') && !vv(c, 'lvB'), 'nessuna Ricetta creata in memoria');
    assert.ok(/prima Valida, poi «Rendi attiva»/.test(c.log.toasts.join(' ')));
    for (const [row, code] of [[rigaPayload('lvB', { status: 'validated', active: true }), 'attivazione_diretta'], [rigaPayload('lvB', { active: true }), 'bozza_attiva'],
      [rigaPayload('lvB', { id: 'lvNuova', active: true }), 'attivazione_diretta'], [rigaPayload('vaP', { id: 'vaNuova', active: true }), 'attivazione_diretta']]) {
      const r = await salva({ recipe: clone(fake.tables.recipes[0]), variants: [row], ingredients: [], deletedIngredients: [] });
      assert.deepStrictEqual([r.ok, r.code], [false, code], row.id);
    }
    assert.deepStrictEqual(db(), prima, 'nessuna scrittura');
  });

  await test('T3. aggiornamenti legittimi delle Attive ammessi; piu\' Attive nella stessa Scheda; disattivazione e riattivazione', async () => {
    const c = await setup();
    Object.assign(vv(c, 'vaB'), { portionsCount: 40, gramsPerPortion: 25 });
    assert.strictEqual(await c.saveToSupabase(c.R('rB')), true, 'obiettivo di una Attiva');
    assert.deepStrictEqual([riga('vaB').portions_count, riga('vaB').grams_per_portion, riga('vaB').active], [40, 25, true]);
    c.toggleActiveV2('rB', 'vaC', true); assert.strictEqual(await c.saveToSupabase(c.R('rB')), true);
    assert.deepStrictEqual(stato('vaC'), ['validated', false], 'disattivata');
    c.toggleActiveV2('rB', 'vaC', false); assert.strictEqual(await c.saveToSupabase(c.R('rB')), true);
    assert.deepStrictEqual(['vaB', 'vaC', 'vaI'].map(stato), [['validated', true], ['validated', true], ['validated', true]], 'piu\' Attive nella stessa Scheda');
    assert.deepStrictEqual(ingDb('vaB').length, 3, 'formulazione intatta');
  });

  await test('T4. formulazione delle validate protetta: ingredienti, ordine, eliminazioni e procedimento si correggono nel LAB', async () => {
    for (const [nome, cambia, attesa] of [
      ['ingrediente modificato', v => { v.ingredients[0].qty = 999; }, /ingrediente modificato/],
      ['ingrediente nuovo', v => { v.ingredients.push({ id: 'nuovo-ing', name: 'Sale', qty: 1, unit: 'g' }); }, /ingrediente nuovo/],
      ['ordine', v => { v.ingredients.reverse(); }, /ordine degli ingredienti/],
      ['eliminato', v => { v.ingredients.pop(); }, /non eliminabili/],
      ['procedimento', v => { v.stepsV2 = [{ id: 'st1', order: 0, text: 'Cuocere', expectedDurationSeconds: null }]; v.steps = ['Cuocere']; }, /procedimento di una Ricetta validata/]]) {
      const c = await setup(); const prima = db();
      cambia(vv(c, 'vaB'));
      assert.strictEqual(await c.saveToSupabase(c.R('rB')), false, nome);
      assert.deepStrictEqual(db(), prima, nome + ': nulla scritto');
      assert.ok(c.log.toasts.length > 0, nome + ': messaggio');
      void attesa;
    }
    const r = await salva({ recipe: clone(fake.tables.recipes[0]), variants: [rigaPayload('vaB')], ingredients: [{ id: 'fvaB', variant_id: 'vaB', name: 'Farina', qty: 1, unit: 'g', sort_order: 0 }], deletedIngredients: [] });
    assert.deepStrictEqual([r.ok, r.code, /ingrediente modificato/.test(r.errors[0])], [false, 'formulazione_protetta', true]);
  });

  await test('T5. riapertura nel LAB: Validata mai usata si\'; Attiva, usata in Produzione o come mattoncino no', async () => {
    const c = await setup();
    await c.riapriProntaInLab('rB', 'vaP');
    assert.deepStrictEqual(stato('vaP'), ['lab', false], 'Validata mai usata: torna bozza con lo stesso id');
    fake.tables.ingredients.push({ id: 'mat-p', variant_id: 'vaX', name: 'Crema', qty: 1, unit: 'g', sort_order: 9, is_sub_recipe: true, sub_recipe_id: 'vaC', estimated_yield_pct: null, measured_yield_pct: null });
    riga('vaC').active = false;
    for (const [id, code] of [['vaB', 'attiva_protetta'], ['vaQ', 'usata_in_produzione'], ['vaC', 'usata_come_mattoncino']]) {
      const prima = db();
      const r = await salva({ recipe: clone(fake.tables.recipes[0]), variants: [rigaPayload(id, { status: 'lab', active: false })], ingredients: [], deletedIngredients: [] });
      assert.deepStrictEqual([r.ok, r.code], [false, code], id);
      assert.deepStrictEqual(db(), prima, id + ': nulla scritto');
    }
  });

  await test('T6. archiviazione: una Validata o Attiva si archivia; una Ricetta archiviata non cambia stato e non diventa Attiva', async () => {
    const c = await setup();
    c.retireVariant('rB', 'vaC'); assert.strictEqual(await c.saveToSupabase(c.R('rB')), true);
    assert.deepStrictEqual(stato('vaC'), ['retired', false]);
    for (const [extra, code] of [[{ status: 'validated' }, 'transizione_non_consentita'], [{ status: 'lab' }, 'transizione_non_consentita'], [{ status: 'retired', active: true }, 'archiviata_attiva']]) {
      const r = await salva({ recipe: clone(fake.tables.recipes[0]), variants: [rigaPayload('vaR', extra)], ingredients: [], deletedIngredients: [] });
      assert.deepStrictEqual([r.ok, r.code], [false, code], JSON.stringify(extra));
    }
    assert.deepStrictEqual(stato('vaR'), ['retired', false]);
  });

  await test('T7. Sessioni: solo da una Ricetta Attiva, mai riscritte; stati solo una volta e solo per una Sessione da avviare', async () => {
    await setup();
    const up = (table, data) => callApi({ supabaseAction: 'update', table, data }).then(r => r.body);
    const ses = (id, src) => ({ id, recipe_id: 'rB', source_variant_id: src, status: 'pending', snapshot_version: 1, snapshot: { ingredients: [] }, target_finished_total: 100 });
    for (const src of ['vaP', 'lvB', 'vaR', 'nessuna']) assert.ok(/solo una Ricetta Attiva/.test((await up('production_sessions', ses('psN' + src, src))).error || ''), src);
    assert.deepStrictEqual(await up('production_sessions', ses('psOk', 'vaB')), { ok: true });
    const snap = clone(fake.tables.production_sessions.find(s => s.id === 'psOk'));
    assert.ok(/gia' esistente/.test((await up('production_sessions', { ...ses('psOk', 'vaB'), target_finished_total: 1 })).error), 'mai riscritta');
    assert.deepStrictEqual(fake.tables.production_sessions.find(s => s.id === 'psOk'), snap);
    const st = { id: 'pisOk', session_id: 'psOk', item_key: 'k1', checked: false, checked_at: null };
    assert.deepStrictEqual(await up('session_ingredient_state', [st]), { ok: true });
    assert.ok(/gia' esistenti/.test((await up('session_ingredient_state', [st])).error), 'stati una sola volta');
    assert.ok(/Sessione da avviare/.test((await up('session_ingredient_state', [{ ...st, id: 'pis1', session_id: 'ps1' }])).error), 'Sessione completata');
  });

  await test('T8. fail-closed: se lo stato salvato non si legge, nessuna scrittura', async () => {
    const c = await setup(); const prima = db();
    fake.failPage('variants', 0);
    Object.assign(vv(c, 'vaB'), { portionsCount: 41 });
    assert.strictEqual(await c.saveToSupabase(c.R('rB')), false);
    assert.deepStrictEqual(db(), prima);
  });

  await test('T9. importazioni e dati storici compatibili: nuove Schede con bozze, Ricette storiche risalvate senza rifiuti', async () => {
    const c = await setup();
    c.creaBozzaDaSorgente('rX', null);
    assert.strictEqual(await c.saveToSupabase(c.R('rX')), true, 'nuova bozza');
    riga('vaP').steps_v2 = null; riga('vaP').steps = JSON.stringify(['Impastare']); // riga storica senza steps_v2
    const c2 = makeClientStati(clientFetch); await c2.loadFromSupabase();
    Object.assign(vv(c2, 'vaP'), { portionsCount: 12 });
    assert.strictEqual(await c2.saveToSupabase(c2.R('rB')), true, 'Ricetta storica: stesso procedimento, nessun falso rifiuto');
    assert.strictEqual(riga('vaP').portions_count, 12);
  });

  await test('T10. cambio di Scheda (Unisci) ammesso con stato e formulazione invariati; spostamento + attivazione di una bozza rifiutato', async () => {
    await setup();
    const f0 = ingDb('vaP');
    const r1 = await salva({ recipe: clone(fake.tables.recipes[1]), variants: [rigaPayload('vaP', { recipe_id: 'rX' })], ingredients: [], deletedIngredients: [] });
    assert.deepStrictEqual(r1, { ok: true });
    assert.deepStrictEqual([riga('vaP').recipe_id, ...stato('vaP'), ingDb('vaP')], ['rX', 'validated', false, f0]);
    const r2 = await salva({ recipe: clone(fake.tables.recipes[1]), variants: [rigaPayload('lvB', { recipe_id: 'rX', status: 'validated', active: true })], ingredients: [], deletedIngredients: [] });
    assert.deepStrictEqual([r2.ok, r2.code], [false, 'attivazione_diretta']);
  });
  // Vincoli come nel database reale: variants.recipe_id CASCADE, ingredients.sub_recipe_id
  // SET NULL; RESTRICT (controllato a fine istruzione, tutto o niente) su
  // variants.origin_variant_id, l2_items.variant_id, l3_items.recipe_id.
  const restrict409 = () => ({ ok: false, status: 409, json: async () => ({ code: '23503' }), text: async () => 'violates foreign key constraint (restrict)' });
  await test('T11. durate dei passaggi protette: modificarle su una Validata o una Attiva e\' rifiutato dal server; nella bozza si modificano', async () => {
    for (const [id, da, a] of [['vaP', null, 300], ['vaB', null, 300], ['vaB', 300, 600], ['vaB', 300, null]]) {
      const c = await setup();
      // durata gia' salvata (da) sul primo passaggio, poi richiesta di modificarla (a)
      if (da != null) { riga(id).steps_v2 = [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: da }]; }
      const c2 = makeClientStati(clientFetch); await c2.loadFromSupabase(); void c;
      const prima = db();
      const v = vv(c2, id);
      v.stepsV2 = v.stepsV2.map((st, i) => i === 0 ? { ...st, expectedDurationSeconds: a } : st);
      assert.strictEqual(await c2.saveToSupabase(c2.R('rB')), false, id + ': ' + da + ' -> ' + a);
      assert.deepStrictEqual(db(), prima, id + ': nulla scritto');
      const r = await salva({ recipe: clone(fake.tables.recipes[0]), variants: [rigaPayload(id, { steps_v2: [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: a }] })], ingredients: [], deletedIngredients: [] });
      assert.deepStrictEqual([r.ok, r.code, /procedimento di una Ricetta validata/.test(r.errors[0])], [false, 'formulazione_protetta', true], 'API diretta: ' + id);
    }
    const c = await setup();
    assert.strictEqual(await c.saveToSupabase(c.R('rB')), true, 'durate invariate: salvataggio ammesso');
    c.R('rB').currentLabIdx = c.R('rB').labVersions.findIndex(v => v.id === 'lvB');
    c.upLab('rB', v => ({ ...v, stepsV2: [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: 420 }] }));
    assert.strictEqual(await c.saveToSupabase(c.R('rB')), true, 'bozza in LAB: durata modificabile');
    assert.strictEqual(riga('lvB').steps_v2[0].expectedDurationSeconds, 420);
  });

  await test('T12. una bozza IN LAB non passa ad Archiviata (anche via API); si archivia solo da Validata o Attiva; nessun comando lo propone', async () => {
    const c = await setup(); const prima = db();
    for (const [row, msg] of [[rigaPayload('lvB', { status: 'retired', active: false }), /bozza in LAB non si archivia/], [rigaPayload('lvB', { id: 'lvNuovaArch', status: 'retired', active: false }), /non nasce archiviata/]]) {
      const r = await salva({ recipe: clone(fake.tables.recipes[0]), variants: [row], ingredients: [], deletedIngredients: [] });
      assert.deepStrictEqual([r.ok, r.code, msg.test(r.errors[0])], [false, 'transizione_non_consentita', true], row.id);
    }
    assert.deepStrictEqual(db(), prima, 'nulla scritto');
    c.retireVariant('rB', 'lvB');
    assert.ok(c.R('rB').labVersions.some(v => v.id === 'lvB') && !c.log.toasts.includes('Ricetta archiviata'), 'retireVariant non agisce su una bozza');
    // percorso ammesso: IN LAB -> Validata -> archiviata
    c.R('rB').currentLabIdx = c.R('rB').labVersions.findIndex(v => v.id === 'lvB');
    c.onValidate(); await c.confirmValidate();
    c.retireVariant('rB', 'lvB'); assert.strictEqual(await c.saveToSupabase(c.R('rB')), true);
    assert.deepStrictEqual(stato('lvB'), ['retired', false]);
    const h = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
    const rami = h.slice(h.indexOf("}else if(stato==='lab'){"), h.indexOf("}else if(stato==='lab'){") + 1500);
    assert.ok(!/retireVariant/.test(rami.slice(0, rami.indexOf('}else'))), 'il menu di una bozza non propone Archivia');
    assert.ok(/const vv=recipe\.validatedVariants\.find\(v=>v\.id===variantId\);/.test(h.slice(h.indexOf('function retireVariant('), h.indexOf('function retireVariant(') + 200)), 'retireVariant solo su Ricette validate');
  });

  function conCascade() {
    const base = fake.fetch;
    fake.fetch = async (url, opts = {}) => {
      const u = new URL(url); const method = opts.method || 'GET';
      const t = fake.tables; t.l2_items = t.l2_items || []; t.l3_items = t.l3_items || [];
      // Funzione elimina_scheda_se_vuota (docs/proposte): stessa logica, in un solo passo.
      if (method === 'POST' && u.pathname.endsWith('/rpc/elimina_scheda_se_vuota')) {
        fake.rpcChiamate = (fake.rpcChiamate || 0) + 1;
        if (fake.rpc === 'assente') return { ok: false, status: 404, json: async () => ({ code: 'PGRST202' }), text: async () => '{"code":"PGRST202","message":"Could not find the function"}' };
        if (fake.rpc === 'errore') return { ok: false, status: 500, json: async () => ({ code: '55P03' }), text: async () => '{"code":"55P03","message":"lock timeout"}' };
        if (fake.rpc === 'rete') throw new TypeError('fetch failed');
        if (fake.primaDellaRpc) fake.primaDellaRpc();
        const id = JSON.parse(opts.body).p_recipe_id;
        let esito;
        if (!t.recipes.some(r => r.id === id)) esito = 'assente';
        else if (t.variants.some(v => v.recipe_id === id)) esito = 'non_vuota';
        else if (t.l3_items.some(x => x.recipe_id === id)) esito = 'osservazioni_michelinai';
        else if (t.recipes.some(r => r.parent_recipe_id === id) || (t.ingredients || []).some(i => i.group_recipe_id === id)) esito = 'collegata';
        else { fake.daRpc = true; await fake.fetch(u.origin + '/rest/v1/recipes?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: {} }); fake.daRpc = false; esito = 'eliminata'; }
        return { ok: true, status: 200, json: async () => esito, text: async () => JSON.stringify(esito) };
      }
      if (method === 'DELETE' && u.pathname.endsWith('/recipes')) {
        const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
        if (!fake.daRpc) fake.deleteSchedeDirette = (fake.deleteSchedeDirette || 0) + 1; // Elimina Scheda (cascata voluta)
        const vids = fake.tables.variants.filter(v => v.recipe_id === id).map(v => v.id);
        if (t.l3_items.some(x => x.recipe_id === id) || t.l2_items.some(x => vids.includes(x.variant_id))
          || t.variants.some(v => !vids.includes(v.id) && vids.includes(v.origin_variant_id))) return restrict409();
        fake.cascate = (fake.cascate || 0) + vids.length; // Ricette cancellate a cascata con la Scheda
        fake.tables.variants = fake.tables.variants.filter(v => v.recipe_id !== id);
        fake.tables.ingredients = fake.tables.ingredients.filter(i => !vids.includes(i.variant_id))
          .map(i => (i.is_sub_recipe && vids.includes(i.sub_recipe_id) ? { ...i, sub_recipe_id: null } : i));
      }
      if (method === 'DELETE' && u.pathname.endsWith('/variants')) {
        const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
        if (t.l2_items.some(x => x.variant_id === id) || t.variants.some(v => v.id !== id && v.origin_variant_id === id)) return restrict409();
        fake.tables.ingredients = fake.tables.ingredients.filter(i => i.variant_id !== id).map(i => (i.is_sub_recipe && i.sub_recipe_id === id ? { ...i, sub_recipe_id: null } : i));
      }
      return base(url, opts);
    };
    globalThis.fetch = fake.fetch;
  }
  async function setupEliminazioni() {
    const c = await setup(); conCascade();
    // vaM: Validata usata come mattoncino da vaX (altra Scheda); vaS: citata solo nello snapshot di una Sessione;
    // lvP: bozza IN LAB con una Sessione pending storica; lvZ: bozza mai usata; rD: Scheda con sole bozze mai usate.
    const vP = riga('vaP');
    fake.tables.variants.push({ ...clone(vP), id: 'vaM', name: 'V vaM', label: 'V vaM' }, { ...clone(vP), id: 'vaS', name: 'V vaS', label: 'V vaS' },
      { ...clone(vP), id: 'vaU', name: 'V vaU', label: 'V vaU' },
      { ...clone(riga('lvB')), id: 'lvP', name: 'Bozza P', label: 'Bozza P' }, { ...clone(riga('lvB')), id: 'lvZ', name: 'Bozza Z', label: 'Bozza Z' },
      { ...clone(riga('lvB')), id: 'lvD1', recipe_id: 'rD', name: 'Bozza D1', label: 'Bozza D1' });
    fake.tables.recipes.push({ id: 'rD', name: 'Scheda di prova', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' });
    fake.tables.ingredients.push({ id: 'mat-x', variant_id: 'vaX', name: 'Crema', qty: 100, unit: 'g', sort_order: 5, is_sub_recipe: true, sub_recipe_id: 'vaM', estimated_yield_pct: null, measured_yield_pct: null },
      { id: 'ing-d1', variant_id: 'lvD1', name: 'Farina', qty: 10, unit: 'g', sort_order: 0, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null });
    fake.tables.production_sessions.push(
      { id: 'psP', recipe_id: 'rB', source_variant_id: 'lvP', status: 'pending', snapshot: { ingredients: [{ name: 'Farina', qty: 1 }] }, target_finished_total: 1 },
      { id: 'psS', recipe_id: 'rX', source_variant_id: 'vaX', status: 'completed', snapshot: { ingredients: [{ name: 'Glassa', qty: 1, isSubRecipe: true, subRecipeId: 'vaS' }] }, target_finished_total: 1 });
    const c2 = makeClientStati(clientFetch); await c2.loadFromSupabase(); c2.S.selectedId = 'rB';
    void c; return c2;
  }
  const esiste = id => fake.tables.variants.some(v => v.id === id);
  const inMemoria = (c, id) => c.S.recipes.some(r => r.validatedVariants.concat(r.labVersions).some(v => v.id === id));
  const idsScheda = rid => fake.tables.variants.filter(v => v.recipe_id === rid).map(v => v.id);
  const schedaInMemoria = (c, rid) => c.S.recipes.some(r => r.id === rid);
  const del = (table, id, extra) => callApi(Object.assign({ supabaseAction: 'delete', table, id }, extra || {})).then(r => r.body);

  await test('E1. Ricetta usata come mattoncino: eliminazione rifiutata dal server e dall\'interfaccia; il collegamento resta', async () => {
    const c = await setupEliminazioni(); const prima = db();
    assert.deepStrictEqual(await del('variants', 'vaM'), { ok: false, code: 'usata_come_mattoncino', error: 'la Ricetta e\' usata come mattoncino in un\'altra Ricetta: si puo\' archiviare, non eliminare' });
    await c.deleteVariant('rB', 'vaM');
    assert.ok(inMemoria(c, 'vaM') && esiste('vaM')); assert.deepStrictEqual(db(), prima, 'nessun SET NULL, nessuna cancellazione');
    assert.ok(c.log.toasts.join(' ').includes('mattoncino'));
    c.retireVariant('rB', 'vaM'); assert.strictEqual(await c.saveToSupabase(c.R('rB')), true);
    assert.deepStrictEqual([stato('vaM'), fake.tables.ingredients.find(i => i.id === 'mat-x').sub_recipe_id], [['retired', false], 'vaM'], 'archiviata: il mattoncino resta collegato');
  });

  await test('E2. Ricette usate in Produzione (origine o mattoncino nello snapshot), anche bozze IN LAB con Sessioni storiche: non eliminabili', async () => {
    const c = await setupEliminazioni(); const prima = db();
    for (const id of ['vaB', 'vaQ', 'vaS', 'lvP']) assert.strictEqual((await del('variants', id)).code, 'usata_in_produzione', id);
    await c.deleteVariant('rB', 'vaQ'); await c.eliminaBozza('rB', 'lvP');
    assert.ok(['vaQ', 'lvP'].every(id => inMemoria(c, id) && esiste(id)));
    assert.deepStrictEqual(db(), prima, 'Sessioni e snapshot intatti');
    assert.strictEqual(c.log.toasts.filter(t => /Produzione: puoi archiviarla/.test(t)).length, 2);
  });

  await test('E3. bozze mai usate: eliminabili (anche mai salvate); Ricetta senza dipendenze eliminabile', async () => {
    const c = await setupEliminazioni();
    await c.eliminaBozza('rB', 'lvZ'); assert.ok(!esiste('lvZ') && !inMemoria(c, 'lvZ'));
    c.creaBozzaDaSorgente('rB', null); const locale = c.R('rB').labVersions.at(-1).id;
    assert.ok(!esiste(locale)); await c.eliminaBozza('rB', locale); assert.ok(!inMemoria(c, locale), 'mai salvata: eliminata senza errori');
    await c.deleteVariant('rB', 'vaU'); assert.ok(!esiste('vaU') && !inMemoria(c, 'vaU'));
  });

  await test('E4. rifiuto del database (es. riga ancora collegata): l\'API risponde ok:false e l\'interfaccia non elimina nulla', async () => {
    const c = await setupEliminazioni();
    const base = fake.fetch;
    globalThis.fetch = async (u, o) => ((o && o.method === 'DELETE') ? { ok: false, status: 409, json: async () => ({ code: '23503' }), text: async () => 'violates foreign key constraint' } : base(u, o));
    const r = await del('variants', 'vaU');
    await c.deleteVariant('rB', 'vaU');
    globalThis.fetch = base;
    assert.deepStrictEqual([r.ok, r.code, r.status], [false, 'db', 409]);
    assert.ok(esiste('vaU') && inMemoria(c, 'vaU')); assert.ok(/database ha rifiutato/.test(c.log.toasts.join(' ')));
  });

  await test('E5. Schede: rifiutata se contiene Ricette protette (nessuna cascata); eliminabile se contiene solo bozze mai usate', async () => {
    const c = await setupEliminazioni(); const prima = db();
    assert.ok(['usata_come_mattoncino', 'usata_in_produzione'].includes((await del('recipes', 'rB', { ricetteAttese: idsScheda('rB') })).code), 'rB: mattoncino vaM e Ricette usate in Produzione');
    assert.strictEqual((await del('recipes', 'rX', { ricetteAttese: idsScheda('rX') })).code, 'usata_in_produzione', 'vaX origine di una Sessione');
    await c.deleteRecipe('rB'); assert.ok(c.S.recipes.some(r => r.id === 'rB')); assert.deepStrictEqual(db(), prima, 'nessuna Ricetta cancellata a cascata');
    await c.deleteRecipe('rD'); assert.ok(!c.S.recipes.some(r => r.id === 'rD') && !esiste('lvD1') && !fake.tables.recipes.some(r => r.id === 'rD'));
    assert.strictEqual((await del('recipes', 'rB', { soloSeVuota: true })).code, 'scheda_non_vuota');
  });

  await test('E6. fail-closed: se le dipendenze non si possono verificare, nessuna eliminazione', async () => {
    await setupEliminazioni(); const prima = db(); const base = fake.fetch;
    globalThis.fetch = async (u, o) => (String(u).includes('/production_sessions') && (!o || !o.method || o.method === 'GET') ? { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' } : base(u, o));
    const r = await del('variants', 'lvZ'); globalThis.fetch = base;
    assert.deepStrictEqual([r.ok, r.code], [false, 'controllo_non_eseguibile']); assert.deepStrictEqual(db(), prima);
  });


  // Scheda rE di prova, senza Sessioni ne' mattoncini esterni: Validata vaE1,
  // bozza lvE2 nata da vaE1 (origin_variant_id) che usa vaE1 come mattoncino.
  async function setupSchedaE(extra) {
    const c = await setupEliminazioni();
    fake.tables.recipes.push({ id: 'rE', name: 'Scheda E', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' });
    fake.tables.variants.push({ ...clone(riga('vaP')), id: 'vaE1', recipe_id: 'rE', name: 'E1', label: 'E1' },
      { ...clone(riga('lvB')), id: 'lvE2', recipe_id: 'rE', name: 'E2', label: 'E2', origin_variant_id: 'vaE1' });
    fake.tables.ingredients.push({ id: 'ing-e1', variant_id: 'vaE1', name: 'Latte', qty: 50, unit: 'g', sort_order: 0, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null },
      { id: 'mat-e2', variant_id: 'lvE2', name: 'E1', qty: 20, unit: 'g', sort_order: 0, is_sub_recipe: true, sub_recipe_id: 'vaE1', estimated_yield_pct: null, measured_yield_pct: null });
    if (extra) extra();
    const c2 = makeClientStati(clientFetch); await c2.loadFromSupabase(); c2.S.selectedId = 'rE'; c2.S.confirmDeleteId = 'rE'; void c;
    return c2;
  }
  const l2 = (id, vid) => ({ id, variant_id: vid, operational_state: 'open', decision_state: 'none', content: { label: 'x', text: 'osservazione' }, evidence: null, provenance_type: 'm1', source_l2_item_id: null, baseline_hash: 'h', baseline_context: {}, created_at: '2026-10-01T00:00:00Z' });

  await test('E7. Elimina Scheda: due Ricette della stessa Scheda collegate come mattoncino (e bozza con origin_variant_id) si eliminano insieme', async () => {
    const c = await setupSchedaE(); const sess = clone(fake.tables.production_sessions);
    assert.strictEqual(c.testoEliminaScheda(c.R('rE')), 'Eliminare la Scheda «Scheda E» e le sue 2 Ricette? L\'azione è irreversibile.');
    await c.deleteRecipe('rE');
    assert.ok(!fake.tables.recipes.some(r => r.id === 'rE') && !esiste('vaE1') && !esiste('lvE2'), 'Scheda e Ricette eliminate a cascata');
    assert.deepStrictEqual([fake.rpcChiamate || 0, fake.deleteSchedeDirette], [0, 1], 'Elimina Scheda invariata: DELETE con cascata, nessuna funzione');
    assert.ok(!fake.tables.ingredients.some(i => ['ing-e1', 'mat-e2'].includes(i.id)));
    assert.ok(!schedaInMemoria(c, 'rE') && c.log.toasts.includes('Scheda eliminata') && !c.log.toasts.some(t => t.startsWith('ALERT')));
    assert.deepStrictEqual(fake.tables.production_sessions, sess);
    assert.strictEqual(fake.tables.ingredients.find(i => i.id === 'mat-x').sub_recipe_id, 'vaM', 'mattoncini di altre Schede intatti');
  });

  await test('E8. Validata con bozza nata da lei (origin_variant_id): eliminare solo la Validata e\' rifiutato dal database, nulla cambia; la Scheda intera si elimina', async () => {
    const c = await setupSchedaE(() => { fake.tables.ingredients = fake.tables.ingredients.filter(i => i.id !== 'mat-e2'); }); const prima = db();
    await c.deleteVariant('rE', 'vaE1'); // solo il collegamento origin_variant_id (nessun mattoncino)
    assert.deepStrictEqual(db(), prima, 'nessuna eliminazione, nessun SET NULL');
    assert.ok(inMemoria(c, 'vaE1') && /database ha rifiutato/.test(c.log.toasts.join(' ')), 'interfaccia invariata, messaggio chiaro');
    c.S.confirmDeleteId = 'rE'; await c.deleteRecipe('rE');
    assert.ok(!esiste('vaE1') && !esiste('lvE2') && !schedaInMemoria(c, 'rE'));
  });

  await test('E9. osservazioni MichelinAI: Scheda con L2 o L3 non eliminata (nessuna cancellazione delle osservazioni), messaggio comprensibile', async () => {
    for (const [nome, extra] of [['L2', () => fake.tables.l2_items.push(l2('l2E', 'lvE2'))],
      ['L3', () => { fake.tables.l2_items.push(l2('l2Xo', 'vaX')); fake.tables.l3_items.push({ id: 'l3E', recipe_id: 'rE', distilled_content: {}, origin_l2_item_id: 'l2Xo', created_at: '2026-10-01T00:00:00Z' }); }]]) {
      const c = await setupSchedaE(extra); const prima = db(); const l2l3 = clone([fake.tables.l2_items, fake.tables.l3_items]);
      const r = await del('recipes', 'rE', { ricetteAttese: ['vaE1', 'lvE2'] });
      assert.deepStrictEqual([r.ok, r.code], [false, 'osservazioni_michelinai'], nome);
      await c.deleteRecipe('rE');
      assert.deepStrictEqual(db(), prima, nome + ': nulla eliminato');
      assert.deepStrictEqual([fake.tables.l2_items, fake.tables.l3_items], l2l3, nome + ': osservazioni intatte');
      assert.ok(schedaInMemoria(c, 'rE') && c.S.confirmDeleteId === null, nome + ': Scheda ancora visibile, conferma chiusa');
      assert.ok(c.log.toasts.some(t => /non eliminata: ha osservazioni di MichelinAI/.test(t)), nome + ': ' + c.log.toasts.join(' | '));
    }
    const c = await setupSchedaE(() => fake.tables.l2_items.push(l2('l2E', 'lvE2')));
    await c.eliminaBozza('rE', 'lvE2');
    assert.ok(esiste('lvE2') && inMemoria(c, 'lvE2') && fake.tables.l2_items.some(x => x.id === 'l2E'), 'bozza con L2: non eliminata');
    assert.ok(/osservazioni di MichelinAI/.test(c.log.toasts.join(' ')));
  });

  await test('E10. conferma con elenco delle Ricette cambiato: il server rifiuta senza eliminare nulla; senza elenco confermato rifiuta', async () => {
    const c = await setupSchedaE();
    fake.tables.variants.push({ ...clone(riga('lvB')), id: 'lvE9', recipe_id: 'rE', name: 'E9 (da un\'altra finestra)', label: 'E9', origin_variant_id: null });
    const prima = db();
    await c.deleteRecipe('rE');
    assert.deepStrictEqual(db(), prima, 'nessuna eliminazione');
    assert.ok(c.log.toasts.some(t => /non eliminata: la Scheda è cambiata/.test(t)));
    assert.ok(inMemoria(c, 'lvE9'), 'interfaccia ricaricata: la nuova Ricetta e\' visibile');
    assert.strictEqual(c.testoEliminaScheda(c.R('rE')), 'Eliminare la Scheda «Scheda E» e le sue 3 Ricette? L\'azione è irreversibile.');
    assert.deepStrictEqual([(await del('recipes', 'rE')).code, (await del('recipes', 'rE', { ricetteAttese: 'vaE1' })).code], ['conferma_mancante', 'conferma_mancante']);
    assert.deepStrictEqual((await del('recipes', 'rE', { ricetteAttese: ['vaE1', 'lvE2'] })).code, 'scheda_cambiata');
    assert.deepStrictEqual(db(), prima);
    // Una bozza confermata ma mai salvata (solo in memoria) non blocca: nel database non c'e' nulla di non confermato.
    c.upRec('rE', r => ({ ...r, labVersions: r.labVersions.concat([{ ...clone(r.labVersions[0]), id: 'lvLocale' }]) }));
    assert.ok(!esiste('lvLocale')); c.S.confirmDeleteId = 'rE'; await c.deleteRecipe('rE');
    assert.ok(!fake.tables.recipes.some(r => r.id === 'rE') && !esiste('lvE9') && !schedaInMemoria(c, 'rE'), c.log.toasts.join(' | '));
  });

  await test('E11. eliminazione fallita (rete, database, controllo): nessun aggiornamento ingannevole dell\'interfaccia', async () => {
    const casi = [['rete', null, /controlla la connessione/],
      ['database', (u, o, base) => ((o && o.method === 'DELETE') ? restrict409() : base(u, o)), /database ha rifiutato/],
      ['controllo', (u, o, base) => (String(u).includes('/l3_items') ? { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' } : base(u, o)), /verificare le dipendenze/]];
    for (const [nome, guasto, msg] of casi) {
      let c = await setupSchedaE(); const prima = db(); const base = fake.fetch;
      if (guasto) globalThis.fetch = async (u, o) => guasto(u, o, base);
      else { const offline = makeClientStati(async () => { throw new Error('offline'); }); offline.S.recipes = clone(c.S.recipes); offline.S.confirmDeleteId = 'rE'; c = offline; }
      await c.deleteRecipe('rE'); globalThis.fetch = base;
      assert.deepStrictEqual(db(), prima, nome + ': nulla eliminato');
      assert.ok(schedaInMemoria(c, 'rE') && c.S.confirmDeleteId === null, nome + ': Scheda ancora visibile, conferma chiusa');
      assert.ok(!c.log.toasts.includes('Scheda eliminata') && c.log.toasts.some(t => msg.test(t)), nome + ': ' + c.log.toasts.join(' | '));
    }
  });

  // Scheda assorbita rX: vaX Attiva (origine di una Sessione) + Validata, Attiva e bozza aggiunte.
  async function setupUnione() {
    const c = await setupEliminazioni();
    const vP = riga('vaP');
    fake.tables.variants.push({ ...clone(vP), id: 'vaY1', recipe_id: 'rX', name: 'Y1', label: 'Y1' }, { ...clone(vP), id: 'vaY2', recipe_id: 'rX', name: 'Y2', label: 'Y2', active: true },
      { ...clone(riga('lvB')), id: 'lvY3', recipe_id: 'rX', name: 'Y3', label: 'Y3' });
    ['vaY1', 'vaY2', 'lvY3'].forEach((v, k) => fake.tables.ingredients.push({ id: 'ing-' + v, variant_id: v, name: 'Burro', qty: 100 + k, unit: 'g', sort_order: 0, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null }));
    const c2 = makeClientStati(clientFetch); await c2.loadFromSupabase(); c2.S.selectedId = 'rB';
    void c; return c2;
  }
  const trasferite = ['vaX', 'vaY1', 'vaY2', 'lvY3'];
  const firma = () => trasferite.map(id => { const v = riga(id); return [id, v.status, v.active, v.name, ingDb(id)]; });
  const unisci = async c => { Object.assign(c.S, { mergeSourceRecipeId: 'rB', mergeTargetIds: ['rX'], mergeNotesChoices: {} }); await c.confirmMerge(); };

  await test('M1. Unisci: Ricette Validate, Attive e bozze trasferite con stesso id, stato, formulazione e storico; Scheda vuota eliminata; Sessioni intatte', async () => {
    const c = await setupUnione(); const f0 = firma(); const sess = clone(fake.tables.production_sessions); const nV = fake.tables.variants.length;
    await unisci(c);
    assert.deepStrictEqual(trasferite.map(id => riga(id) && riga(id).recipe_id), ['rB', 'rB', 'rB', 'rB']);
    assert.deepStrictEqual(firma(), f0, 'stato, nome e ingredienti invariati');
    assert.strictEqual(fake.tables.variants.length, nV, 'nessuna Ricetta persa o duplicata');
    assert.ok(!fake.tables.recipes.some(r => r.id === 'rX'), 'Scheda assorbita eliminata solo da vuota');
    assert.deepStrictEqual([fake.rpcChiamate, fake.deleteSchedeDirette || 0], [1, 0], 'eliminata dalla funzione transazionale, mai con una DELETE diretta');
    assert.deepStrictEqual(fake.tables.production_sessions, sess);
    assert.strictEqual(fake.tables.ingredients.find(i => i.id === 'mat-x').sub_recipe_id, 'vaM', 'collegamenti dei mattoncini intatti');
    assert.ok(/Schede unite/.test(c.log.toasts.join(' ')));
    assert.strictEqual(fake.cascate || 0, 0, 'nessuna Ricetta cancellata a cascata');
  });

  await test('M2. Unisci con salvataggio fallito a meta\': nessuna Scheda eliminata, nessuna Ricetta persa, stato reale ricaricato', async () => {
    const c = await setupUnione(); const nV = fake.tables.variants.length; const base = fake.fetch;
    globalThis.fetch = async (u, o) => ((o && o.method === 'POST' && String(u).includes('/variants') && String(o.body).includes('"vaY2"')) ? { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' } : base(u, o));
    await unisci(c); globalThis.fetch = base;
    assert.ok(fake.tables.recipes.some(r => r.id === 'rX'), 'Scheda di origine non eliminata');
    assert.strictEqual(fake.tables.variants.length, nV); assert.ok(trasferite.every(esiste));
    assert.ok(c.S.recipes.some(r => r.id === 'rX'), 'interfaccia ricaricata dal database');
    assert.ok(/nessuna Ricetta è andata persa/.test(c.log.toasts.join(' ')));
  });

  await test('M3. Unisci con errore della funzione nel database (es. blocco scaduto): Ricette trasferite, Scheda vuota conservata, nessuna DELETE alternativa', async () => {
    const c = await setupUnione(); fake.rpc = 'errore';
    await unisci(c);
    assert.deepStrictEqual(trasferite.map(id => riga(id).recipe_id), ['rB', 'rB', 'rB', 'rB']);
    assert.ok(fake.tables.recipes.some(r => r.id === 'rX'), 'Scheda conservata');
    assert.strictEqual(fake.deleteSchedeDirette || 0, 0, 'nessuna DELETE alternativa');
    assert.ok(/non eliminata\/e: l'eliminazione sicura non è riuscita: la Scheda è stata conservata/.test(c.log.toasts.join(' ')), c.log.toasts.join(' | '));
  });

  await test('M6. Unisci con funzione elimina_scheda_se_vuota non installata o rete assente: Schede di origine conservate, messaggio chiaro', async () => {
    for (const [guasto, msg] of [['assente', /non è ancora installata nel database: la Scheda è stata conservata/], ['rete', /eliminazione sicura non è riuscita/]]) {
      const c = await setupUnione(); fake.rpc = guasto; const nV = fake.tables.variants.length;
      await unisci(c);
      assert.ok(fake.tables.recipes.some(r => r.id === 'rX'), guasto + ': Scheda conservata');
      assert.strictEqual(fake.deleteSchedeDirette || 0, 0, guasto + ': nessuna DELETE alternativa');
      assert.strictEqual(fake.tables.variants.length, nV, guasto + ': nessuna Ricetta persa');
      assert.deepStrictEqual(trasferite.map(id => riga(id).recipe_id), ['rB', 'rB', 'rB', 'rB']);
      assert.ok(msg.test(c.log.toasts.join(' ')), guasto + ': ' + c.log.toasts.join(' | '));
      assert.ok(c.S.recipes.some(r => r.id === 'rX'), guasto + ': stato reale ricaricato');
    }
  });

  await test('M7. Unisci: Ricetta tornata nella Scheda di origine prima dell\'eliminazione (altra finestra) -> la funzione non la elimina; Scheda con osservazioni L3 conservata', async () => {
    let c = await setupUnione();
    fake.primaDellaRpc = () => { fake.primaDellaRpc = null; fake.tables.variants.push({ ...clone(riga('lvB')), id: 'lvTardi', recipe_id: 'rX', name: 'Tardiva', label: 'Tardiva', origin_variant_id: null }); };
    await unisci(c);
    assert.ok(esiste('lvTardi') && riga('lvTardi').recipe_id === 'rX' && fake.tables.recipes.some(r => r.id === 'rX'), 'Ricetta e Scheda intatte');
    assert.strictEqual(fake.cascate || 0, 0, 'nessuna cancellazione a cascata');
    assert.ok(/contiene ancora delle Ricette/.test(c.log.toasts.join(' ')));
    c = await setupUnione();
    fake.tables.l2_items.push({ id: 'l2Xo', variant_id: 'vaX', operational_state: 'open', decision_state: 'none', content: {}, evidence: null, provenance_type: 'm1', source_l2_item_id: null, baseline_hash: 'h', baseline_context: {}, created_at: '2026-10-01T00:00:00Z' });
    fake.tables.l3_items.push({ id: 'l3X', recipe_id: 'rX', distilled_content: {}, origin_l2_item_id: 'l2Xo', created_at: '2026-10-01T00:00:00Z' });
    await unisci(c);
    assert.ok(fake.tables.recipes.some(r => r.id === 'rX') && fake.tables.l3_items.some(x => x.id === 'l3X'), 'Scheda e osservazioni conservate');
    assert.ok(/osservazioni di MichelinAI/.test(c.log.toasts.join(' ')));
    assert.deepStrictEqual(trasferite.map(id => riga(id).recipe_id), ['rB', 'rB', 'rB', 'rB']);
  });

  await test('M8. Unisci: Scheda di origine ancora indicata da altre righe (parent_recipe_id, group_recipe_id) -> conservata, riferimenti intatti, messaggio chiaro', async () => {
    for (const [nome, extra, verifica] of [
      ['parent_recipe_id', () => fake.tables.recipes.push({ id: 'rFiglia', name: 'Figlia', category: 'Base', parent_recipe_id: 'rX' }),
        () => fake.tables.recipes.find(r => r.id === 'rFiglia').parent_recipe_id],
      ['group_recipe_id', () => fake.tables.ingredients.push({ id: 'ing-gr', variant_id: 'vaAltro', name: 'Gruppo', qty: 1, unit: 'g', sort_order: 9, is_sub_recipe: false, sub_recipe_id: null, group_recipe_id: 'rX' }),
        () => fake.tables.ingredients.find(i => i.id === 'ing-gr').group_recipe_id]]) {
      const c = await setupUnione(); extra(); const nV = fake.tables.variants.length;
      await unisci(c);
      assert.ok(fake.tables.recipes.some(r => r.id === 'rX'), nome + ': Scheda conservata');
      assert.strictEqual(verifica(), 'rX', nome + ': riferimento non scollegato');
      assert.strictEqual(fake.deleteSchedeDirette || 0, 0, nome + ': nessuna DELETE alternativa');
      assert.strictEqual(fake.tables.variants.length, nV, nome + ': nessuna Ricetta persa');
      assert.deepStrictEqual(trasferite.map(id => riga(id).recipe_id), ['rB', 'rB', 'rB', 'rB']);
      assert.ok(/ancora indicata da altri dati/.test(c.log.toasts.join(' ')), nome + ': ' + c.log.toasts.join(' | '));
    }
  });

  await test('M4. con il CASCADE reale, eliminare prima la Scheda (vecchio ordine) e\' impossibile: soloSeVuota la rifiuta finche\' contiene Ricette', async () => {
    await setupUnione(); const prima = db();
    assert.strictEqual((await del('recipes', 'rX', { soloSeVuota: true })).code, 'scheda_non_vuota');
    assert.deepStrictEqual(db(), prima, 'nessuna Ricetta cancellata a cascata');
  });


  await test('M5. Unisci una Scheda di Ricette non protette (bozza e Validata mai usate): la Scheda si elimina solo dopo il trasferimento, mai a cascata', async () => {
    const c = await setupEliminazioni();
    fake.tables.variants.push({ ...clone(riga('vaP')), id: 'vaD2', recipe_id: 'rD', name: 'D2', label: 'D2' });
    fake.tables.ingredients.push({ id: 'ing-d2', variant_id: 'vaD2', name: 'Latte', qty: 50, unit: 'g', sort_order: 0, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null });
    fake.tables.l2_items.push({ id: 'l2D2', variant_id: 'vaD2', operational_state: 'open', decision_state: 'none', content: { label: 'x', text: 'osservazione' }, evidence: null, provenance_type: 'm1', source_l2_item_id: null, baseline_hash: 'h', baseline_context: {}, created_at: '2026-10-01T00:00:00Z' });
    const c2 = makeClientStati(clientFetch); await c2.loadFromSupabase(); c2.S.selectedId = 'rB'; void c;
    const ing0 = [ingDb('lvD1'), ingDb('vaD2')];
    Object.assign(c2.S, { mergeSourceRecipeId: 'rB', mergeTargetIds: ['rD'], mergeNotesChoices: {} }); await c2.confirmMerge();
    assert.strictEqual(fake.cascate || 0, 0, 'nessuna Ricetta cancellata a cascata');
    assert.deepStrictEqual([riga('lvD1').recipe_id, riga('vaD2').recipe_id, stato('vaD2')], ['rB', 'rB', ['validated', false]]);
    assert.deepStrictEqual([ingDb('lvD1'), ingDb('vaD2')], ing0);
    assert.ok(!fake.tables.recipes.some(r => r.id === 'rD') && fake.tables.l2_items.some(x => x.id === 'l2D2'), 'Scheda vuota eliminata; osservazioni conservate');
  });

  await test('R1. nessuna regressione: archiviazione, riapertura nel LAB e Sessioni storiche come prima', async () => {
    const c = await setupEliminazioni();
    await c.riapriProntaInLab('rB', 'vaU'); assert.deepStrictEqual(stato('vaU'), ['lab', false]);
    c.retireVariant('rB', 'vaC'); assert.strictEqual(await c.saveToSupabase(c.R('rB')), true); assert.deepStrictEqual(stato('vaC'), ['retired', false]);
    const r = await callApi({ supabaseAction: 'startProductionSession', sessionId: 'psP' });
    assert.ok(r.body && !r.body.error, 'Sessione pending storica di una bozza IN LAB: avviabile come prima ' + JSON.stringify(r.body));
    assert.strictEqual(fake.tables.production_sessions.find(s => s.id === 'psP').status, 'in_progress');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack); process.exit(1); });
