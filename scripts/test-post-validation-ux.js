/*
 * Test — UX dopo la validazione e correzioni anagrafiche.
 * Rendi attiva (flusso esistente, nessuna Sessione); Correggi nel LAB di una
 * Ricetta pronta mai attivata: stessa riga e stesso id, nessuna copia,
 * ingredienti, procedimento, resa, tag e dati MichelinAI conservati; nuova
 * validazione senza duplicati; protezioni (Attive, archiviate, usate in
 * Sessioni o come mattoncino); accesso al LAB mai vuoto; rinomina della
 * Scheda e della Ricetta (anche Attiva, con azione server dedicata che
 * aggiorna solo name/label). Sessioni storiche invariate.
 *
 * Codice REALE estratto da khub_mvp.html e api/chat.js contro un finto
 * PostgREST (con PATCH). Solo dati sintetici.
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
  'function suggestFamilies(recipe, variantName)', 'async function saveFamilies(variantId, familyIds, newFamilyName)', 'function onValidate()', 'async function confirmValidate()',
  'function toggleActiveV2(recipeId,variantId,currentActive)', 'function prontaRiapribileMotivo(recipe,vv)', 'function rendiAttivaPronta(recipeId,variantId)',
  'async function riapriProntaInLab(recipeId,variantId)', 'function bozzaVuota(v)', 'function nuovaBozzaDaRicetta(recipeId,variantId)', 'function creaBozzaDaSorgente(recipeId,attiva)',
  'function renderAzioniLabRicetta(recipe,vv)', 'function apriRinomina(kind,recipeId,variantId)', 'function confermaRinominaScheda(recipeId)',
  'async function confermaRinominaRicetta(recipeId,variantId)', 'function renderRinominaForm(kind,recipeId,variantId,valore)', 'function onRecipeNameChange(recipeId,val)',
  'function renderLabRecipe(recipe)'];
const defined = n => new RegExp('function ' + n.replace(/^(async )?function /, '').split('(')[0] + '\\(').test(SRC);
const SRC_UX = SRC + '\n' + EXTRA.filter(m => !defined(m)).map(extractFunction).join('\n');
function makeClient2(fetchImpl, opts = {}) {
  const log = { toasts: [] };
  const dom = {};
  const c = new Function('fetch', 'log', 'document', 'confirm', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},variantHistory:{},unitWeights:{},unitWeightFacts:{},productionConversionFacts:{},labYieldInput:{},activeYieldEdit:null,
      view:'ricetta-madre-v2',mode:'produzione',selectedVariantId:null,pendingFamilies:[],pendingNewFamily:'',showFamilyPicker:false,familyManagerMode:false,justValidated:null,renameEdit:null};
    var _knownIngredientIdsByVariant={}; var _persistedValidatedSig={}; var _saveLocked=false, _saveTimer={};
    function render(){} function autosave(){} function toast(msg){log.toasts.push(msg);}
    ${SRC_UX}
    return {S, loadFromSupabase, saveToSupabase, onValidate, confirmValidate, toggleActiveV2, rendiAttivaPronta, riapriProntaInLab, nuovaBozzaDaRicetta,
      renderAzioniLabRicetta, apriRinomina, confermaRinominaScheda, confermaRinominaRicetta, renderLabRecipe, upLab, prontaRiapribileMotivo, getSig: id => _persistedValidatedSig[id]};
  `)(fetchImpl, log, { getElementById: id => dom[id] || null }, () => opts.confirm !== false);
  c.log = log; c.dom = dom; return c;
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase'; process.env.SUPABASE_ANON_KEY = 'anon';
  const realHandler = await loadHandler();
  let saves = [], calls = [], hooks = {}, fake;
  async function callApi(body) { let status = 200, out; calls.push(body.supabaseAction || body.mode); if (body.supabaseAction === 'save') saves.push(clone(body.data));
    await realHandler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } }); return { status, body: out }; }
  const clientFetch = async (url, o) => { const r = await callApi(JSON.parse(o.body)); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  const api = async body => (await callApi(body)).body;
  // Seed I6 + dati MichelinAI e tag sulla Pronta vaP; Pronta vaQ gia' usata in una Sessione; Scheda rX senza bozze.
  async function setup(opts = {}) {
    hooks = {}; fake = withPatch((() => { const f = makeFakeSupabase(); seed(f); return f; })(), hooks); globalThis.fetch = fake.fetch;
    const vP = fake.tables.variants.find(v => v.id === 'vaP'); Object.assign(vP, { primo_consulto: 'pc vaP', m1_reading_text: 'lettura M1 vaP', intention_initial: 'leggera' });
    fake.tables.variants.push({ ...clone(vP), id: 'vaQ', name: 'V vaQ', label: 'V vaQ', primo_consulto: null, m1_reading_text: null });
    fake.tables.ingredients.push({ id: 'fvaQ', variant_id: 'vaQ', name: 'Farina', qty: 400, unit: 'g', sort_order: 0, estimated_yield_pct: null, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
    fake.tables.production_sessions.push({ id: 'psQ', recipe_id: 'rB', source_variant_id: 'vaQ', status: 'completed', snapshot: { ingredients: [{ name: 'Farina', qty: 400 }] }, target_finished_total: 400 });
    fake.tables.l2_items.push({ id: 'l2P', variant_id: 'vaP', operational_state: 'open', decision_state: 'none', content: { label: 'x', text: 'osservazione' }, evidence: null, provenance_type: 'm1', source_l2_item_id: null, baseline_hash: 'h', baseline_context: {}, created_at: '2026-10-01T00:00:00Z' });
    fake.tables.families = [{ id: 'famT', name: 'Pasticceria' }]; fake.tables.variant_families = [{ variant_id: 'vaP', family_id: 'famT' }];
    saves = []; calls = [];
    const c = makeClient2(clientFetch, opts); await c.loadFromSupabase(); c.S.selectedId = 'rB';
    return c;
  }
  const rec = (c, id = 'rB') => c.S.recipes.find(r => r.id === id);
  const righe = id => fake.tables.variants.filter(v => v.id === id);
  const ingDb = id => fake.tables.ingredients.filter(i => i.variant_id === id).map(i => [i.name, Number(i.qty), i.unit]).sort();
  const tick = () => new Promise(r => setTimeout(r, 20));
  console.log('UX dopo la validazione e correzioni anagrafiche');

  await test('U1. Rendi attiva: flusso di attivazione esistente, nessuna Sessione creata, nessun\'altra Ricetta toccata', async () => {
    const c = await setup(); c.S.justValidated = { recipeId: 'rB', variantId: 'vaP' };
    const sessPrima = clone(fake.tables.production_sessions), altre = clone(fake.tables.variants.filter(v => v.id !== 'vaP'));
    c.rendiAttivaPronta('rB', 'vaP'); await tick();
    assert.strictEqual(righe('vaP')[0].active, true);
    assert.deepStrictEqual(fake.tables.production_sessions, sessPrima, 'nessuna Sessione');
    assert.ok(!calls.includes('startProductionSession'));
    for (const v of altre) { const now = clone(fake.tables.variants.find(x => x.id === v.id)); delete now.contenuto_hash; delete now.contenuto_modificato_il; delete v.contenuto_hash; delete v.contenuto_modificato_il; assert.deepStrictEqual(now, v, v.id); }
    assert.strictEqual(c.S.justValidated, null);
  });

  await test('U2. Correggi nel LAB (Pronta mai attivata): stessa riga e stesso id, nessuna copia; ingredienti, procedimento, resa, tag e MichelinAI conservati', async () => {
    const c = await setup();
    const nRighe = fake.tables.variants.length, ingPrima = ingDb('vaP'), famPrima = clone(fake.tables.variant_families);
    await c.riapriProntaInLab('rB', 'vaP');
    assert.strictEqual(fake.tables.variants.length, nRighe, 'nessuna nuova riga');
    const r = righe('vaP')[0];
    assert.deepStrictEqual([r.status, r.active], ['lab', false]);
    assert.deepStrictEqual([r.primo_consulto, r.m1_reading_text, r.intention_initial], ['pc vaP', 'lettura M1 vaP', 'leggera'], 'dati MichelinAI dal DB, mai azzerati');
    assert.deepStrictEqual([String(r.declared_yield_qty), r.declared_yield_unit], ['20', 'pz']);
    assert.deepStrictEqual(ingDb('vaP'), ingPrima); assert.deepStrictEqual(fake.tables.variant_families, famPrima, 'tag conservati');
    assert.ok(fake.tables.l2_items.some(x => x.id === 'l2P' && x.variant_id === 'vaP'), 'osservazioni L2 conservate');
    const lab = rec(c).labVersions[rec(c).currentLabIdx];
    assert.strictEqual(lab.id, 'vaP'); assert.ok(!rec(c).validatedVariants.some(v => v.id === 'vaP'));
    assert.deepStrictEqual([c.S.view, c.S.mode], ['recipe', 'lab']);
    assert.strictEqual(lab.l2Items.length, 1);
  });

  await test('U3. correzione e nuova validazione: una sola Ricetta, stessa riga, nessun duplicato; tag esistenti riproposti e conservati', async () => {
    const c = await setup();
    const nRighe = fake.tables.variants.length;
    await c.riapriProntaInLab('rB', 'vaP');
    c.upLab('rB', v => ({ ...v, ingredients: v.ingredients.map(i => i.name === 'Farina' ? { ...i, qty: 480 } : i) }));
    c.onValidate();
    assert.deepStrictEqual(c.S.pendingFamilies, ['famT'], 'tag esistenti proposti');
    await c.confirmValidate(); await tick();
    assert.strictEqual(fake.tables.variants.length, nRighe, 'nessun duplicato');
    assert.strictEqual(rec(c).validatedVariants.filter(v => v.id === 'vaP').length, 1);
    assert.ok(!rec(c).labVersions.some(v => v.id === 'vaP'));
    const r = righe('vaP')[0]; assert.deepStrictEqual([r.status, r.active], ['validated', false]);
    assert.deepStrictEqual(ingDb('vaP'), [['Burro', 0.25, 'kg'], ['Farina', 480, 'g'], ['Zucchero', 150, 'g']], 'un solo insieme di ingredienti, corretto');
    assert.ok(fake.tables.variant_families.some(x => x.variant_id === 'vaP' && x.family_id === 'famT'), 'tag conservati');
    assert.deepStrictEqual(c.S.justValidated, { recipeId: 'rB', variantId: 'vaP' }, 'riquadro dopo la validazione');
    assert.strictEqual(r.m1_reading_text, 'lettura M1 vaP');
    // Riaperta e rivalidata senza modifiche: la riga torna validata (la firma
    // precedente non deve far saltare l'invio).
    const c2 = await setup();
    await c2.riapriProntaInLab('rB', 'vaP');
    assert.strictEqual(righe('vaP')[0].status, 'lab', 'riaperta nel DB');
    // resa corretta nel LAB e validata subito, senza salvataggi intermedi
    c2.upLab('rB', v => ({ ...v, declaredYieldQty: 24, declaredYieldUnit: 'pz' }));
    c2.onValidate(); await c2.confirmValidate(); await tick();
    assert.deepStrictEqual([righe('vaP').length, righe('vaP')[0].status, righe('vaP')[0].active], [1, 'validated', false], 'rivalidata');
    assert.deepStrictEqual([String(righe('vaP')[0].declared_yield_qty), righe('vaP')[0].declared_yield_unit], ['24', 'pz'], 'resa corretta nel LAB arriva al DB');
  });

  await test('U4. protezioni: Attiva, archiviata, usata in una Sessione, attivata in questa sessione, usata come mattoncino -> nessuna riapertura', async () => {
    for (const [id, msg] of [['vaB', /attiva/], ['vaR', /archiviata/], ['vaQ', /usata in Produzione/]]) {
      const c = await setup(); const prima = clone(fake.tables.variants);
      await c.riapriProntaInLab('rB', id);
      assert.deepStrictEqual(fake.tables.variants, prima, id + ': nulla cambia'); assert.ok(msg.test(c.log.toasts.join(' ')), id + ' ' + c.log.toasts);
    }
    let c = await setup();
    c.toggleActiveV2('rB', 'vaP', false); c.toggleActiveV2('rB', 'vaP', true); await tick();
    const prima = clone(fake.tables.variants); await c.riapriProntaInLab('rB', 'vaP');
    assert.deepStrictEqual(fake.tables.variants, prima); assert.ok(/già stata attivata/.test(c.log.toasts.join(' ')));
    c = await setup(); rec(c, 'rX').validatedVariants[0].ingredients.push({ id: 'sub', name: 'P', qty: 1, unit: 'n', isSubRecipe: true, subRecipeId: 'vaP' });
    await c.riapriProntaInLab('rB', 'vaP'); assert.ok(/mattoncino/.test(c.log.toasts.join(' ')));
    c = await setup({ confirm: false }); const p2 = clone(fake.tables.variants); await c.riapriProntaInLab('rB', 'vaP');
    assert.deepStrictEqual(fake.tables.variants, p2, 'annullata dallo chef: nulla cambia');
  });

  await test('U5. Vai in LAB mai vuoto o inatteso: Pronta (Rendi attiva, Correggi, bozza nominata); Attiva senza bozze -> nuova bozza dalla Ricetta; LAB senza bozze -> invito', async () => {
    let c = await setup();
    const h = c.renderAzioniLabRicetta(rec(c), rec(c).validatedVariants.find(v => v.id === 'vaP'));
    assert.ok(h.includes('id="btn-rendi-attiva"') && h.includes('id="btn-correggi-lab"') && h.includes('Apri la bozza in LAB: V lvB'));
    const ha = c.renderAzioniLabRicetta(rec(c), rec(c).validatedVariants.find(v => v.id === 'vaB'));
    assert.ok(!ha.includes('btn-rendi-attiva') && !ha.includes('btn-correggi-lab') && ha.includes('Apri la bozza in LAB'));
    // Scheda rX: nessuna bozza nel DB -> bozza vuota automatica: proposta "Nuova bozza da questa Ricetta", riempita sul posto.
    const rx = rec(c, 'rX'); const vuota = rx.labVersions[0];
    const hx = c.renderAzioniLabRicetta(rx, rx.validatedVariants[0]); assert.ok(hx.includes('id="btn-nuova-bozza"'));
    c.nuovaBozzaDaRicetta('rX', 'vaX');
    const lab = rec(c, 'rX').labVersions; assert.strictEqual(lab.length, 1); assert.strictEqual(lab[0].id, vuota.id, 'stessa bozza, nessuna riga orfana');
    assert.deepStrictEqual(lab[0].ingredients.map(i => [i.name, i.qty, i.unit]), [['Farina', 500, 'g'], ['Burro', 0.25, 'kg'], ['Zucchero', 150, 'g']]);
    assert.strictEqual(lab[0].originVariantId, 'vaX'); assert.deepStrictEqual([c.S.view, c.S.mode], ['recipe', 'lab']);
    assert.ok(c.renderLabRecipe({ id: 'rZ', labVersions: [], currentLabIdx: 0 }).includes('Nessuna bozza in LAB per questa Scheda'), 'mai una pagina vuota');
  });

  await test('U6. rinomina di una Ricetta Attiva: azione dedicata, solo nome ed etichetta; nessun salvataggio completo; ingredienti e Sessioni invariati', async () => {
    const c = await setup();
    const prima = clone(fake.tables.variants.find(v => v.id === 'vaB')), ingPrima = clone(fake.tables.ingredients), sessPrima = clone(fake.tables.production_sessions);
    c.apriRinomina('ricetta', 'rB', 'vaB'); c.dom['rename-input'] = { value: '  Bignè   classici ' };
    calls = [];
    await c.confermaRinominaRicetta('rB', 'vaB');
    assert.deepStrictEqual(calls, ['updateVariantName'], 'nessun salvataggio completo');
    const dopo = clone(fake.tables.variants.find(v => v.id === 'vaB'));
    assert.deepStrictEqual([dopo.name, dopo.label], ['Bignè classici', 'Bignè classici']);
    delete dopo.name; delete dopo.label; delete prima.name; delete prima.label; assert.deepStrictEqual(dopo, prima, 'nient\'altro cambia');
    assert.deepStrictEqual(fake.tables.ingredients, ingPrima); assert.deepStrictEqual(fake.tables.production_sessions, sessPrima);
    assert.strictEqual(rec(c).validatedVariants.find(v => v.id === 'vaB').name, 'Bignè classici');
    saves = []; await c.saveToSupabase(rec(c));
    assert.ok(!saves[0].variants.some(v => v.id === 'vaB'), 'firma riallineata: l\'Attiva non viene rimandata');
    // Pronta rinominabile; nome vuoto o troppo lungo rifiutato senza chiamate.
    c.apriRinomina('ricetta', 'rB', 'vaP'); c.dom['rename-input'] = { value: 'Pronta nuova' }; await c.confermaRinominaRicetta('rB', 'vaP');
    assert.strictEqual(righe('vaP')[0].name, 'Pronta nuova');
    for (const v of ['   ', 'x'.repeat(121)]) { calls = []; c.apriRinomina('ricetta', 'rB', 'vaB'); c.dom['rename-input'] = { value: v }; await c.confermaRinominaRicetta('rB', 'vaB');
      assert.deepStrictEqual(calls, []); assert.ok(c.S.renameEdit && c.S.renameEdit.error); }
  });

  await test('U7. azione server updateVariantName: solo Ricette validate della Scheda indicata, solo name/label, input non validi rifiutati', async () => {
    await setup();
    const tutto = clone(fake.tables.variants);
    for (const [body, code] of [[{ recipeId: 'rB', variantId: 'lvB', name: 'X' }, 'not_validated'], [{ recipeId: 'rB', variantId: 'vaR', name: 'X' }, 'not_validated'],
      [{ recipeId: 'rX', variantId: 'vaB', name: 'X' }, 'recipe_mismatch'], [{ recipeId: 'rB', variantId: 'nope', name: 'X' }, 'not_found'],
      [{ recipeId: 'rB', variantId: 'vaB', name: ' ' }, 'invalid'], [{ recipeId: 'rB', variantId: 'vaB', name: 'x'.repeat(121) }, 'invalid'], [{ recipeId: '', variantId: 'vaB', name: 'X' }, 'invalid']]) {
      const out = await api({ supabaseAction: 'updateVariantName', ...body });
      assert.strictEqual(out.code, code, JSON.stringify(body));
    }
    assert.deepStrictEqual(fake.tables.variants, tutto, 'nessuna riga modificata dai rifiuti');
    const ok = await api({ supabaseAction: 'updateVariantName', recipeId: 'rB', variantId: 'vaC', name: 'Nome' });
    assert.ok(ok.ok); assert.deepStrictEqual(Object.keys(fake.patches.at(-1).body).sort(), ['label', 'name']);
  });

  await test('U8. rinomina della Scheda: solo la riga della Scheda; Ricette validate non rimandate', async () => {
    const c = await setup();
    c.apriRinomina('scheda', 'rB'); c.dom['rename-input'] = { value: 'Bignè della casa' }; saves = [];
    c.confermaRinominaScheda('rB'); await tick();
    assert.strictEqual(fake.tables.recipes.find(r => r.id === 'rB').name, 'Bignè della casa');
    assert.ok(saves.length && saves.every(s => !s.variants.some(v => v.status === 'validated' || v.status === 'retired')), 'nessuna Ricetta validata riscritta');
  });

  await test('U9. codice: motore, salvataggio, firme e attivazione invariati', async () => {
    for (const [m, h] of Object.entries(PROTETTE)) assert.strictEqual(sha(extractFunction(m)), h, 'cambiato: ' + m);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
