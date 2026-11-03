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
  "async function saveToSupabase(recipe)": "e3c83f1bdb507136",
  "async function loadFromSupabase()": "115ba063990470c0",
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
const EXTRA_STATI = ['function retireVariant(recipeId,variantId)', 'function rendiAttiva(recipeId)', 'function bozzaVuota(v)'];
const SRC_STATI = SRC_UX + '\n' + EXTRA_STATI.filter(m => !defined(m) && !SRC_UX.includes(m)).map(extractFunction).join('\n');
function makeClientStati(fetchImpl) {
  const log = { toasts: [] };
  const c = new Function('fetch', 'log', 'document', 'confirm', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},variantHistory:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{},labYieldInput:{},activeYieldEdit:null,
      view:'ricetta-madre-v2',mode:'produzione',selectedVariantId:null,pendingFamilies:[],pendingNewFamily:'',showFamilyPicker:false,familyManagerMode:false,justValidated:null,renameEdit:null,rmv2AttivaEspansa:{},pendingDuplicaSceltaRecipeId:null,confirmDeleteId:null};
    var _knownIngredientIdsByVariant={}; var _persistedValidatedSig={}; var _saveLocked=false, _saveTimer={};
    function render(){} function autosave(){} function toast(msg){log.toasts.push(msg);}
    ${SRC_STATI}
    return {S, loadFromSupabase, saveToSupabase, onValidate, confirmValidate, toggleActiveV2, rendiAttivaPronta, riapriProntaInLab, retireVariant, rendiAttiva,
      creaBozzaDaSorgente, upLab, upRec, R, curLab};
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
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack); process.exit(1); });
