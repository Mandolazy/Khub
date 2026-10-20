/*
 * Test — Conversioni condivise per nomi equivalenti.
 * Gruppi approvati: uovo (uovo, uova, uovo intero, uova intere), tuorlo
 * (tuorlo, tuorli), albume (albume, albumi); calibri distinti; nessuna regola
 * generica singolare/plurale. Una conferma vale per tutto il gruppo in LAB,
 * pesi della formulazione e nuove Sessioni; conferme storiche discordanti =
 * conflitto esplicito (nessuna conversione, nessun peso di riferimento);
 * la risoluzione salva una conferma di gruppo (source_detail =
 * "equivalenze:<gruppo>") che dopo la ricarica prevale sulle conferme dei
 * singoli nomi. Nomi fuori dai gruppi: caricamento identico a main.
 * Ricette Attive, Sessioni storiche e righe esistenti non modificate.
 *
 * Codice REALE estratto da khub_mvp.html e api/chat.js contro un finto
 * PostgREST. Solo dati sintetici.
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
const withinUlps = (a, b) => Math.abs(a - b) <= 4 * Number.EPSILON * Math.abs(b);

function seed(fake) {
  const steps = [{ id: 'st1', order: 0, text: 'Impastare', expectedDurationSeconds: null }];
  const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null, steps: JSON.stringify(['Impastare']), steps_v2: steps };
  fake.tables.recipes = [{ id: 'rT', name: 'Crema TEST', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' }];
  fake.tables.variants = [
    { ...base, id: 'vaT', recipe_id: 'rT', name: 'Classica', label: 'Classica', note: 'attiva', status: 'validated', active: true, portions_count: 10, grams_per_portion: 80, validated_at: '2026-10-01T09:30:17.250Z', origin_variant_id: null, created_at: '2026-10-01T00:00:00Z' },
    { ...base, id: 'lvT', recipe_id: 'rT', name: 'Bozza', label: 'Bozza 1', note: 'bozza', status: 'lab', active: false, portions_count: 10, grams_per_portion: 80, origin_variant_id: 'vaT', created_at: '2026-10-02T00:00:00Z' },
  ];
  const ing = (id, v, name, qty, unit, ord) => ({ id, variant_id: v, name, qty, unit, sort_order: ord, estimated_yield_pct: null, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
  fake.tables.ingredients = [
    ing('iA1', 'vaT', 'Uova', 3, 'n', 0), ing('iA2', 'vaT', 'Latte', 250, 'ml', 1),
    ing('iU', 'lvT', 'Uova', 3, 'n', 0), ing('iF', 'lvT', 'Uova fresche', 7, 'n', 1), ing('iL', 'lvT', 'Latte', 250, 'ml', 2),
    ing('iP', 'lvT', 'Panna', 200, 'ml', 3), ing('iZ', 'lvT', 'Zucchero', 2, 'tbsp', 4), ing('iV', 'lvT', 'Lievito', 3, 'g', 5),
    ing('iS', 'lvT', 'Sale', 1, 'tsp', 6), ing('iT', 'lvT', 'Tuorli', 4, 'n', 7),
  ];
  // Fact gia' confermate (DB) + un peso di riferimento salvato come reference_data
  fake.tables.ingredient_conversions = [
    { id: 'icF', ingredient_name: 'uova fresche', from_unit: 'n', to_unit: 'g', factor: 55.37, source_type: 'chef_confirmed', source_detail: null, confirmed_at: '2026-10-01T10:00:00Z' },
    { id: 'icL', ingredient_name: 'latte', from_unit: 'ml', to_unit: 'g', factor: 1.03, source_type: 'chef_confirmed', source_detail: null, confirmed_at: '2026-10-01T10:00:00Z' },
    { id: 'icT', ingredient_name: 'tuorli', from_unit: 'n', to_unit: 'g', factor: 18, source_type: 'reference_data', source_detail: 'tabella', confirmed_at: '2026-10-01T10:00:00Z' },
  ];
  fake.tables.l2_items = []; fake.tables.l3_items = [];
  fake.tables.families = []; fake.tables.variant_families = [];
}
const dbVariant = (fake, id) => clone(fake.tables.variants.find(v => v.id === id));
const dbIngs = (fake, id) => clone(fake.tables.ingredients.filter(i => i.variant_id === id).sort((a, b) => a.sort_order - b.sort_order));

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
  'function resolveKnownProductionConversionFact(normalizedName,unit)', 'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)',
  'function computeSessionScaling(input)', 'function findMissingProductionConversions(preparedInput)',
  'function parseLocaleNumber(value)', 'function ingredientGramsPerUnit(unit,ingredientName,resolver)',
  'function convertIngredientQty(qty,fromUnit,toUnit,ingredientName,resolveFact)', 'async function saveIngredientConversion(ingredientName,fromUnit,toUnit,factor,sourceType,sourceDetail)',
  'function onIngQty(recipeId,ingId,val)', 'function labUnitAnchorKey(recipeId,labVersionId,ingId)',
  'function resolveConfirmedLabConversionFact(normalizedName,unit)', 'function referenceConversionProposal(normalizedName,unit)',
  'function computeLabUnitConversion(ing,toUnit,anchor,resolveFact)', 'function onIngUnit(recipeId,ingId,val)',
  'async function confirmLabConversion(rawValue)',
  // Conversioni per nomi equivalenti: funzioni di supporto.
  'function conversionNameGroup(normalizedName)', 'function conversionNameAliases(normalizedName)', 'function conversionNameGroupMarker(normalizedName)', 'function conversionConflictKey(normalizedName,fromUnit,toUnit)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)', 'function formatQtyDisplay(value)', 'function cancelLabConversion()',
  'function labConversionQuestion(p)', 'function renderLabConversionModal()',
  // load / save reali
  'function uid()', 'function normalizeIngredientName(name)', 'function conversionFactSourcePriority(sourceType)',
  'function isBetterConversionFact(candidate,current)', 'function buildKnownIngredientIds(ingredientRows)',
  'function computeIngredientDeletions(knownByVariant,currentByVariant)',
  'function updateKnownIngredientIds(knownByVariant,currentByVariant,deleted)', 'function firmaContenutoBozza(v)',
  'async function loadFromSupabase()', 'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)',
  // LAB FIX 2B I4: resa dichiarata (caricamento, salvataggio, copie)
  'function targetFromDb(value)', 'function targetForDb(value)', 'function declaredYieldFromRow(row)', 'function copyDeclaredYield(src)', 'function declaredYieldPayload(v)', 'function stepsV2ToLegacyArray(stepsV2)', 'function makeDefaultLab(recipeId,name)', 'function buildValidatedVariantPayload(recipeId,vv)', 'async function saveToSupabase(recipe)',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g), [html.match(/const UNITS = \[[^\]]*\];/)[0]]).join('\n');

// Impronte prese da main e5d4da5: queste funzioni condivise non devono cambiare.
const PROTETTE = {
  "function normalizeIngredientName(name)": "e5a8589eb276024e",
  "function resolveKnownProductionConversionFact(normalizedName,unit)": "5b0be8c06a5e4919",
  "function isBetterConversionFact(candidate,current)": "b4fc3d53124be838",
  "function computeFormulationWeights(ingredients,resolveFact)": "765b3d8a8edde206",
  "function computeSessionScaling(input)": "ddfc1febb5010cdc",
  "function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)": "9df6758db87b12b1",
  "function findMissingProductionConversions(preparedInput)": "ad0ecd9f8e506dce",
  "async function saveIngredientConversion(ingredientName,fromUnit,toUnit,factor,sourceType,sourceDetail)": "e3916db5353173da",
  "async function createProductionSession(preparedInput)": "185ca85dcee49397",
  "function buildSessionSnapshotV1(meta,computed)": "1fd7615c172e0ce2",
  "async function saveToSupabase(recipe)": "e3c83f1bdb507136",
};

// Funzioni reali: harness di I3 (caricamento, LAB, conversioni) + Produzione (Manda in Produzione, preflight, Sessione).
const PROD = ['function canSendToProduction(vv)', 'function findRecipeVariant(recipeId,variantId)', 'function openMandaInProduzione(recipeId,variantId,target)',
  'function onMandaInProduzioneField(field,val)', 'async function confirmMandaInProduzione()', 'function buildSessionSnapshotV1(meta,computed)',
  'async function _supabaseUpsertRow(table,data)', 'async function _supabaseDeleteRow(table,id)', 'async function createProductionSession(preparedInput)',
  'async function confirmConversionPreflightStep(rawValue)', 'function cancelConversionPreflight()', 'function renderConversionPreflightModal()',
  'function goToNewProductionSession(sessionId)', 'function isHighlightedProductionSession(id)', 'function revealProductionHighlight()',
  'function computeFormulationWeights(ingredients,resolveFact)', 'function formatQtyDisplay(value)', 'function selectConversionFacts(conversions)', 'function conversionConflictNote(key)'];
const SRC_ALL = SRC + '\n' + PROD.filter(m => !SRC.includes(m.replace(/^async /, ''))).map(extractFunction).join('\n');
// Pesi di riferimento predefiniti dell'app per i gruppi (stessi valori di S.unitWeights in khub_mvp.html).
const SEED = { uovo: 55, uova: 55, 'uovo intero': 55, tuorlo: 18, tuorli: 18, albume: 37, albumi: 37, mela: 180, mele: 180 };
function makeClient2(fetchImpl) {
  const log = { toasts: [] };
  const c = new Function('fetch', 'log', 'document', 'SEED', `
    var S={recipes:[],selectedId:null,families:[],variantFamilies:{},unitWeights:JSON.parse(JSON.stringify(SEED)),unitWeightFacts:{},productionConversionFacts:{},
      pendingLabConversion:null,labUnitAnchors:{},view:'recipe',mode:'produzione',selectedVariantId:null,quickCalc:null,pendingMandaInProduzione:null,
      pendingConversionPreflight:null,productionSessions:[],highlightedProductionSessionId:null};
    var _knownIngredientIdsByVariant={}; var _persistedValidatedSig={};
    function render(){} function autosave(){} function toast(m){log.toasts.push(m);}
    ${SRC_ALL}
    return {S, loadFromSupabase, onIngUnit, confirmLabConversion, cancelLabConversion, renderLabConversionModal, computeFormulationWeights,
      openMandaInProduzione, onMandaInProduzioneField, confirmMandaInProduzione, confirmConversionPreflightStep, cancelConversionPreflight,
      renderConversionPreflightModal, selectConversionFacts};
  `)(fetchImpl, log, { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }, SEED);
  c.log = log; return c;
}
const sha = s => require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 16);
const CV = (id, name, factor, date, type = 'chef_confirmed', detail = null, from = 'n') => ({ id, ingredient_name: name, from_unit: from, to_unit: 'g', factor, source_type: type, source_detail: detail, confirmed_at: date + 'T10:00:00Z' });

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase'; process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const clientFetch = async (u, o) => { let st = 200, out; await handler({ method: 'POST', body: JSON.parse(o.body) }, { status(c) { st = c; return this; }, json(x) { out = x; return this; } }); return { ok: st < 400, status: st, json: async () => out }; };
  let fake;
  const HIST = { id: 'psH', recipe_id: 'rG', source_variant_id: 'vaU', status: 'completed', snapshot: { ingredients: [{ name: 'Uova', conversionFactorToBase: 55, conversionSourceType: 'reference_data' }] }, target_finished_total: 500 };
  function freshDb(conversions) {
    fake = makeFakeSupabase(); globalThis.fetch = fake.fetch;
    const base = { portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null, steps: JSON.stringify(['Montare']), steps_v2: [{ id: 's1', order: 0, text: 'Montare', expectedDurationSeconds: null }], origin_variant_id: null, created_at: '2026-10-01T00:00:00Z', declared_yield_qty: null, declared_yield_unit: null };
    fake.tables.recipes = [{ id: 'rG', name: 'Uova SINT', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' }];
    const v = (id, status, active) => ({ ...base, id, recipe_id: 'rG', name: 'V ' + id, label: 'V ' + id, note: '', status, active, portions_count: 0, grams_per_portion: 0, validated_at: status === 'lab' ? null : '2026-10-01T09:00:00Z' });
    fake.tables.variants = [v('vaU', 'validated', true), v('vaI', 'validated', true), v('lvG', 'lab', false)];
    const ing = (id, vid, name, qty, unit, o) => ({ id, variant_id: vid, name, qty, unit, sort_order: o, estimated_yield_pct: null, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null });
    fake.tables.ingredients = [ing('u1', 'vaU', 'Uova', 3, 'n', 0), ing('u2', 'vaU', 'Farina', 200, 'g', 1), ing('i1', 'vaI', 'Uova intere', 2, 'n', 0), ing('i2', 'vaI', 'Farina', 100, 'g', 1),
      ...['Uovo', 'Uova', 'UOVA', 'Uova intere', 'Uovo intero', 'Uova grandi', 'Tuorli', 'Tuorlo', 'Albumi', 'Uova fresche', 'Mela'].map((n, k) => ing('g' + k, 'lvG', n, 2, 'n', k))];
    fake.tables.ingredient_conversions = clone(conversions);
    ['l2_items', 'l3_items', 'families', 'variant_families'].forEach(k => fake.tables[k] = []);
    fake.tables.production_sessions = [clone(HIST)];
  }
  async function client() { const c = makeClient2(clientFetch); await c.loadFromSupabase(); c.lab = () => c.S.recipes[0].labVersions[0]; return c; }
  // LAB: unita' n -> g di un ingrediente della bozza; riporta richiesta o conversione e annulla (nessun dato toccato).
  const prova = (c, name) => { const i = c.lab().ingredients.find(x => x.name === name); const prima = JSON.stringify(c.lab().ingredients); c.onIngUnit('rG', i.id, 'g');
    const p = c.S.pendingLabConversion; const after = c.lab().ingredients.find(x => x.id === i.id);
    const r = p ? { chiede: true, proposta: p.value, html: c.renderLabConversionModal() } : { chiede: false, g: after.qty };
    if (p) c.cancelLabConversion(); else { /* ripristina in memoria per le prove successive */ c.S.recipes[0].labVersions[0] = { ...c.lab(), ingredients: JSON.parse(prima) }; }
    return r; };
  async function manda(c, vid, portions = '1', gpp = '100') { c.openMandaInProduzione('rG', vid); c.onMandaInProduzioneField('portions', portions); c.onMandaInProduzioneField('gpp', gpp); await c.confirmMandaInProduzione(); return c.S.pendingConversionPreflight; }
  const nuoveSessioni = () => fake.tables.production_sessions.filter(s => s.id !== 'psH');
  const uovaSessione = s => s.snapshot.ingredients.filter(i => /uov/i.test(i.name)).map(i => [i.name, i.conversionFactorToBase, i.conversionSourceType]);
  console.log('Conversioni condivise per nomi equivalenti');

  await test('G1. una sola conferma (Uovo = 60): riusata per Uova, UOVA, Uova intere, Uovo intero in LAB, pesi e nuove Sessioni', async () => {
    freshDb([CV('c1', 'uovo', 60, '2026-10-01')]);
    const c = await client();
    for (const n of ['Uovo', 'Uova', 'UOVA', 'Uova intere', 'Uovo intero']) assert.deepStrictEqual(prova(c, n), { chiede: false, g: 120 }, n);
    const w = c.computeFormulationWeights(c.lab().ingredients.filter(i => ['Uovo', 'Uova', 'UOVA', 'Uova intere', 'Uovo intero'].includes(i.name)));
    assert.strictEqual(w.status, 'complete'); assert.deepStrictEqual(w.referenceDataUsed, [], 'nessuna stima per le uova');
    assert.strictEqual(w.raw, 5 * 120);
    for (const vid of ['vaU', 'vaI']) assert.strictEqual(await manda(c, vid), null, vid + ': nessuna richiesta');
    assert.deepStrictEqual(nuoveSessioni().map(uovaSessione), [[['Uova', 60, 'chef_confirmed']], [['Uova intere', 60, 'chef_confirmed']]], 'stesso valore nelle Sessioni');
  });

  await test('G2. calibri e nomi fuori dai gruppi: comportamento precedente (Uova grandi chiede, Uova fresche e Mela invariati)', async () => {
    freshDb([CV('c1', 'uovo', 60, '2026-10-01'), CV('c2', 'uova fresche', 55.37, '2026-10-01')]);
    const c = await client();
    const g = prova(c, 'Uova grandi'); assert.strictEqual(g.chiede, true); assert.strictEqual(g.proposta, '', 'nessun valore del gruppo uovo');
    assert.deepStrictEqual(prova(c, 'Uova fresche'), { chiede: false, g: 110.74 });
    const m = prova(c, 'Mela'); assert.deepStrictEqual([m.chiede, m.proposta], [true, '180'], 'peso di riferimento proposto come prima');
    const t = prova(c, 'Tuorli'); assert.deepStrictEqual([t.chiede, t.proposta], [true, '18'], 'tuorli separati dalle uova');
  });

  await test('G3. conferme storiche discordanti (Uovo = 60, Uova = 55): conflitto esplicito, nessuna conversione ne\' stima, nessuna Sessione', async () => {
    freshDb([CV('c1', 'uovo', 60, '2026-10-01'), CV('c2', 'uova', 55, '2026-10-05')]);
    const c = await client();
    assert.deepStrictEqual(c.S.conversionConflicts['uovo|n|g'].map(x => [x.name, x.factor]).sort(), [['uova', 55], ['uovo', 60]]);
    for (const n of ['uovo', 'uova', 'uovo intero', 'uova intere']) assert.ok(!(n in c.S.unitWeights), n + ': nessun peso (nemmeno di riferimento)');
    for (const n of ['Uovo', 'Uova', 'Uova intere']) { const r = prova(c, n); assert.strictEqual(r.chiede, true); assert.strictEqual(r.proposta, '', n + ': nessun valore precompilato');
      assert.ok(r.html.includes('Conferme precedenti discordanti per ingredienti equivalenti: ') && /uovo 60 g/.test(r.html) && /uova 55 g/.test(r.html), 'riga sul conflitto'); }
    const w = c.computeFormulationWeights(c.lab().ingredients.filter(i => ['Uovo', 'Farina'].includes(i.name)).concat([{ id: 'f', name: 'Farina', qty: 100, unit: 'g' }]));
    assert.strictEqual(w.status, 'incomplete', 'pesi non calcolabili');
    const pf = await manda(c, 'vaU');
    assert.ok(pf && pf.missing.some(m => m.ingredientName === 'Uova'), 'Produzione chiede');
    assert.ok(c.renderConversionPreflightModal().includes('Conferme precedenti discordanti'), 'riga sul conflitto in Produzione');
    assert.strictEqual(nuoveSessioni().length, 0, 'nessuna Sessione con un valore implicito');
  });

  await test('G4. risoluzione nel LAB: nuova conferma di gruppo (marcatore), valida subito per tutti i nomi; righe storiche intatte; ricarica', async () => {
    const storiche = [CV('c1', 'uovo', 60, '2026-10-01'), CV('c2', 'uova', 55, '2026-10-05')];
    freshDb(storiche);
    let c = await client();
    const i = c.lab().ingredients.find(x => x.name === 'Uova'); c.onIngUnit('rG', i.id, 'g'); await c.confirmLabConversion('58');
    const nuova = fake.tables.ingredient_conversions.filter(r => !['c1', 'c2'].includes(r.id));
    assert.deepStrictEqual(nuova.map(r => [r.ingredient_name, r.from_unit, r.to_unit, r.factor, r.source_type, r.source_detail]), [['uova', 'n', 'g', 58, 'chef_confirmed', 'equivalenze:uovo']]);
    assert.deepStrictEqual(fake.tables.ingredient_conversions.filter(r => ['c1', 'c2'].includes(r.id)), storiche, 'righe storiche intatte');
    assert.ok(!c.S.conversionConflicts['uovo|n|g'], 'conflitto chiuso');
    assert.deepStrictEqual(prova(c, 'Uovo'), { chiede: false, g: 116 }, 'subito valida per Uovo');
    // Ricarica, poi una vecchia conferma di un singolo nome piu' recente (es. da un client non aggiornato): la conferma di gruppo resta prioritaria.
    fake.tables.ingredient_conversions.push(CV('c9', 'uovo', 70, '2026-12-01'));
    c = await client();
    assert.ok(!c.S.conversionConflicts['uovo|n|g']);
    for (const n of ['Uovo', 'Uova', 'UOVA', 'Uova intere']) assert.deepStrictEqual(prova(c, n), { chiede: false, g: 116 }, n);
    assert.strictEqual(await manda(c, 'vaI'), null);
    assert.deepStrictEqual(uovaSessione(nuoveSessioni()[0]), [['Uova intere', 58, 'chef_confirmed']]);
  });

  await test('G5. risoluzione in Produzione (controllo conversioni): conferma di gruppo, Sessione con il valore scelto, ricarica coerente', async () => {
    freshDb([CV('c1', 'uovo', 60, '2026-10-01'), CV('c2', 'uova', 55, '2026-10-05')]);
    let c = await client();
    await manda(c, 'vaU');
    await c.confirmConversionPreflightStep('57');
    const nuova = fake.tables.ingredient_conversions.filter(r => !['c1', 'c2'].includes(r.id));
    assert.deepStrictEqual(nuova.map(r => [r.ingredient_name, r.factor, r.source_detail]), [['uova', 57, 'equivalenze:uovo']]);
    assert.deepStrictEqual(nuoveSessioni().map(uovaSessione), [[['Uova', 57, 'chef_confirmed']]]);
    c = await client();
    assert.deepStrictEqual(prova(c, 'Uovo intero'), { chiede: false, g: 114 });
    const w = c.computeFormulationWeights([{ id: 'a', name: 'Uova intere', qty: 2, unit: 'n' }]);
    assert.strictEqual(w.raw, 114);
  });

  await test('G6. pesi di riferimento discordanti nel gruppo: nessun riferimento, nessun conflitto da risolvere; gruppi tuorlo e albume separati', async () => {
    freshDb([CV('r1', 'uovo', 55, '2026-10-01', 'reference_data'), CV('r2', 'uova', 50, '2026-10-02', 'reference_data'), CV('t1', 'tuorli', 20, '2026-10-03'), CV('a1', 'albume', 35, '2026-10-03')]);
    const c = await client();
    const r = prova(c, 'Uova'); assert.deepStrictEqual([r.chiede, r.proposta], [true, '']); assert.ok(!r.html.includes('discordanti'));
    assert.deepStrictEqual(prova(c, 'Tuorlo'), { chiede: false, g: 40 }); assert.deepStrictEqual(prova(c, 'Albumi'), { chiede: false, g: 70 });
  });

  await test('G7. nomi fuori dai gruppi: caricamento identico a main e5d4da5 (stesse cache, stesso vincitore)', async () => {
    const rows = [CV('x1', 'uova fresche', 55.37, '2026-10-01'), CV('x2', 'uova fresche', 56, '2026-10-03'), CV('x3', 'mela', 170, '2026-10-02', 'reference_data'),
      CV('x4', 'latte', 1.03, '2026-10-01', 'chef_confirmed', null, 'ml'), CV('x5', 'latte', 1.02, '2026-09-01', 'chef_confirmed', null, 'ml'), CV('x6', 'pesca', 150, '2026-10-01', 'chef_confirmed', 'nota')];
    const oldHtml = require('child_process').execSync('git show e5d4da5:khub_mvp.html', { cwd: ROOT, maxBuffer: 64e6 }).toString();
    const ex = (h, m) => { const s = h.indexOf(m); let d = 0; for (let i = h.indexOf('{', s); ; i++) { if (h[i] === '{') d++; else if (h[i] === '}') { d--; if (!d) return h.slice(s, i + 1); } } };
    freshDb(rows);
    const nuovo = await client();
    const oldSrc = SRC_ALL.replace(extractFunction('async function loadFromSupabase()'), ex(oldHtml, 'async function loadFromSupabase()'));
    const vecchio = new Function('fetch', 'document', 'SEED', `var S={recipes:[],families:[],variantFamilies:{},unitWeights:JSON.parse(JSON.stringify(SEED)),unitWeightFacts:{},productionConversionFacts:{}};var _knownIngredientIdsByVariant={};var _persistedValidatedSig={};function render(){}function toast(){}function autosave(){}${oldSrc};return{S,loadFromSupabase};`)(clientFetch, {}, SEED);
    await vecchio.loadFromSupabase();
    assert.deepStrictEqual([nuovo.S.unitWeights, nuovo.S.unitWeightFacts, nuovo.S.productionConversionFacts], [vecchio.S.unitWeights, vecchio.S.unitWeightFacts, vecchio.S.productionConversionFacts]);
    assert.deepStrictEqual(nuovo.S.conversionConflicts, {});
  });

  await test('G8. Ricette Attive, Sessioni storiche e conversioni esistenti non modificate; funzioni condivise invariate', async () => {
    freshDb([CV('c1', 'uovo', 60, '2026-10-01'), CV('c2', 'uova', 55, '2026-10-05')]);
    const variantiPrima = clone(fake.tables.variants), ingPrima = clone(fake.tables.ingredients);
    const c = await client();
    await manda(c, 'vaU'); await c.confirmConversionPreflightStep('57');
    const i = c.lab().ingredients.find(x => x.name === 'Tuorli'); c.onIngUnit('rG', i.id, 'g'); await c.confirmLabConversion('19');
    assert.deepStrictEqual(fake.tables.production_sessions.find(s => s.id === 'psH'), HIST, 'Sessione storica invariata');
    for (const v of variantiPrima.filter(x => x.status !== 'lab')) assert.deepStrictEqual(fake.tables.variants.find(x => x.id === v.id), v, 'Attiva invariata: ' + v.id);
    assert.deepStrictEqual(fake.tables.ingredients.filter(x => x.variant_id !== 'lvG'), ingPrima.filter(x => x.variant_id !== 'lvG'), 'ingredienti delle Attive invariati');
    assert.deepStrictEqual(fake.tables.ingredient_conversions.filter(r => ['c1', 'c2'].includes(r.id)).map(r => r.factor), [60, 55]);
    for (const [m, h] of Object.entries(PROTETTE)) assert.strictEqual(sha(extractFunction(m)), h, 'cambiato: ' + m);
  });

  await test('G9. confini dei gruppi: calibro con conferma propria resta distinto (nessun conflitto); nessuna regola generica (Mela non vale per Mele)', async () => {
    freshDb([CV('c1', 'uovo', 60, '2026-10-01'), CV('c2', 'uova grandi', 65, '2026-10-05')]);
    let c = await client();
    assert.deepStrictEqual(c.S.conversionConflicts, {}, 'calibro non in conflitto con il gruppo');
    assert.deepStrictEqual(prova(c, 'Uova grandi'), { chiede: false, g: 130 });
    assert.deepStrictEqual(prova(c, 'Uova'), { chiede: false, g: 120 });
    const i = c.lab().ingredients.find(x => x.name === 'Mela'); c.onIngUnit('rG', i.id, 'g'); await c.confirmLabConversion('175');
    const r = fake.tables.ingredient_conversions.find(x => x.ingredient_name === 'mela');
    assert.deepStrictEqual([r.factor, r.source_detail], [175, null], 'nessun marcatore fuori dai gruppi');
    assert.strictEqual(c.S.unitWeights.mele, 180, 'Mele resta al proprio peso di riferimento');
    c = await client();
    assert.deepStrictEqual([c.S.unitWeights.mela, c.S.unitWeights.mele], [175, 180]);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
