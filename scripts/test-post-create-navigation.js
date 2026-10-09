/*
 * Test — navigazione dopo "Manda in Produzione": Home Produzione -> Da
 * iniziare con la Sessione appena creata evidenziata e visibile.
 * Nessun framework: Node puro + assert.
 *
 * Codice REALE estratto da khub_mvp.html (Calcolo rapido, modale e conferma,
 * preflight conversioni, createProductionSession, Home Produzione, avvio) e
 * api/chat.js contro un finto PostgREST in memoria (paginazione, PATCH).
 * Mock ai confini: document (getElementById + scrollIntoView), toast.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
console.error = () => {};
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
const chatSrc = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); failed++; }
}
function extractFunction(startMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error('marker non trovato: ' + startMarker);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('graffe non bilanciate: ' + startMarker);
}

// Finto PostgREST: GET con eq, POST insert/upsert (merge-duplicates), DELETE per id.
function makeFakeSupabase() {
  const tables = {};
  const calls = [];
  const fail = new Set();
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)), text: async () => JSON.stringify(data) });
  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    const method = opts.method || 'GET';
    const filters = [];
    for (const [k, raw] of u.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      const dot = raw.indexOf('.'); filters.push([k, raw.slice(0, dot), raw.slice(dot + 1)]);
    }
    calls.push({ method, table, body: opts.body ? JSON.parse(opts.body) : null });
    const rows = tables[table] = tables[table] || [];
    const match = (r) => filters.every(([c, op, v]) => op === 'eq' && String(r[c]) === v);
    if (fail.has(table + ':' + method)) return reply(500, { message: 'boom' });
    if (method === 'GET') { const lim = parseInt(u.searchParams.get('limit') || '1000', 10), off = parseInt(u.searchParams.get('offset') || '0', 10); return reply(200, rows.filter(match).slice(off, off + lim)); }
    if (method === 'PATCH') { const patch = JSON.parse(opts.body); const out = []; rows.forEach((r, i) => { if (match(r)) { rows[i] = { ...r, ...patch }; out.push(rows[i]); } }); return reply(200, out); }
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      for (const row of Array.isArray(body) ? body : [body]) {
        const i = rows.findIndex(r => r.id === row.id);
        if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push({ ...row });
      }
      return reply(201, null);
    }
    if (method === 'DELETE') { tables[table] = rows.filter(r => !match(r)); return reply(204, null); }
    return reply(500, { message: 'metodo non atteso: ' + method });
  }
  return { tables, calls, fetch, fail: k => fail.add(k), heal: k => fail.delete(k) };
}
async function loadHandler() {
  return (await import('data:text/javascript;base64,' + Buffer.from(chatSrc).toString('base64'))).default;
}

const CLIENT_SRC = [
  'function escAttr(s)', 'function uid()', 'function cnum(n)', 'function normalizeIngredientName(name)', 'function R(id)',
  'function activeVariants(recipe)', 'function effectiveYield(ing)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function sessionScalingUnitFamily(unit)', 'function resolveSessionScalingConversionToGrams(unit,conversionFact)',
  'function chooseConversionAskUnit(unit)', 'function resolveKnownProductionConversionFact(normalizedName,unit)',
  'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)',
  'function findMissingProductionConversions(preparedInput)', 'function computeSessionScaling(input)', 'function buildSessionSnapshotV1(meta,computed)',
  'async function _supabaseUpsertRow(table,data)', 'async function _supabaseDeleteRow(table,id)', 'async function createProductionSession(preparedInput)',
  'function canSendToProduction(vv)', 'function findRecipeVariant(recipeId,variantId)',
  'function openMandaInProduzione(recipeId,variantId,target)', 'function onMandaInProduzioneField(field,val)', 'async function confirmMandaInProduzione()',
  'function renderMandaInProduzioneModal()',
  'async function saveIngredientConversion(ingredientName,fromUnit,toUnit,factor,sourceType,sourceDetail)',
  'async function confirmConversionPreflightStep(rawValue)', 'function cancelConversionPreflight()',
  // Calcolo rapido
  'function parseQuickCalcNumber(text)', 'function computeQuickCalc(recipe,vv,portionsText,gppText)', 'function formatQuickCalcQty(qty,unit)',
  'function openQuickCalc(recipeId,variantId)', 'function closeQuickCalc()', 'function onQuickCalcInput(field,value)', 'function syncQuickCalcScope()',
  'function openQuickCalcConversions()', 'function sendQuickCalcToProduction()', 'function renderQuickCalcPanel(recipe,vv)',
  'function computeRecipeWeightSummary(recipe,vv)', 'function renderProdRecipe(recipe)',
  'async function loadProductionSessions()', 'function formatFinishedTotalLabel(grams)', 'function historyNormalizeText(value)',
  'function renderPendingSessionCard(sess)', 'function renderInProgressSessionCard(sess)', 'function selectProductionHomeSessions(sessions,section,context)',
  'function activeRecipeEntries(recipes)', 'function rankActiveRecipeEntries(entries,sessions)', 'function filterActiveRecipeEntries(entries,query)',
  'function renderActiveRecipeRow(entry,withShare)', 'function renderProductionHomeSessionsBlock(section,limit)', 'function renderProductionRecipeSearch()',
  'function renderProductionHomeRecipesBlock()', 'function renderAllActiveRecipes()', 'function renderAttive()', 'function openProductionHomeSection(section)',
  'function closeProductionHomeSection()', 'function syncProductionHomeLoad()', 'async function avviaProduzione(sessionId)', 'function applySessionLifecycleRow(sess,row)',
  'function apriSessioneOperativa(sessionId,returnView)',
  'function goToNewProductionSession(sessionId)', 'function isHighlightedProductionSession(id)', 'function revealProductionHighlight()',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g)).concat([html.match(/var PRODUCTION_HOME_LIMIT=\d+;/)[0]]).join('\n');


function recipes() {
  const ing = (id, name, qty, unit, y) => ({ id, name, qty, unit, estimatedYieldPct: y == null ? null : y });
  return [{ id: 'r1', name: 'Torta', category: 'Dolci', parentRecipeId: null, labVersions: [], validatedVariants: [
    { id: 'v1', name: 'Torta classica', active: true, status: 'validated', portionsCount: 4, gramsPerPortion: 250, validatedAt: '01/10/2026',
      ingredients: [ing('i1', 'Farina', 500, 'g'), ing('i2', 'Latte', 300, 'ml')], steps: ['Impastare'], stepsV2: [{ id: 's1', order: 0, text: 'Impastare', expectedDurationSeconds: null }] }] }];
}
const old = (id, d) => ({ id, recipe_id: 'rX', source_variant_id: 'vX', status: 'pending', snapshot_version: 1,
  snapshot: { recipe: { recipeName: 'Vecchia ' + id, variantName: 'x' }, target: { targetPortions: 1, targetGramsPerPortion: 1 }, ingredients: [{ itemKey: 'a', name: 'a', unit: 'g', baseQty: 1, operativeQty: 1 }], steps: [] },
  target_finished_total: 1, created_at: d, started_at: null, completed_at: null, actual_yield_qty: null, actual_yield_unit: null });

function makeClient(handler, opts = {}) {
  const apiCalls = [], toasts = [], scrolls = [];
  const clientFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    apiCalls.push(body);
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { ok: status < 400, status, json: async () => out };
  };
  const last = { html: '' };
  // document: un id esiste se e' presente nell'HTML renderizzato; lo scroll viene registrato.
  const doc = { getElementById: (id) => last.html.includes('id="' + id + '"') ? { id, scrollIntoView: (o) => scrolls.push({ id, o }) } : null, querySelectorAll: () => [] };
  const S = { view: 'recipe', mode: 'produzione', selectedId: 'r1', selectedVariantId: 'v1', recipes: recipes(), quickCalc: null,
    pendingMandaInProduzione: null, pendingConversionPreflight: null, variantFamilies: {}, families: [],
    unitWeights: {}, unitWeightFacts: {}, productionConversionFacts: opts.noMilkFact ? {} : { 'latte|ml|g': { id: 'icL', factor: 1.03, sourceType: 'chef_confirmed', sourceDetail: null } },
    productionSessions: [], productionSessionsLoad: 'idle', produzioneHome: { recipeQuery: '', expanded: null, highlight: null }, recipeStaffCondivisi: {},
    startingSessionId: null, openSessionId: null, sessionIngredientState: {}, sessionStepState: {}, sessionNotes: {}, sessionNoteDraft: {} };
  const timers = [];
  const api = new Function('S', 'fetch', 'toast', 'console', 'document', '__last', 'STAFF_ESEMPIO', 'setTimeout', `
    var _lastViewForProductionLoad=null;
    function upRec(){} function autosave(){} function saveToSupabase(){}
    function restoreSessionNoteDraft(){} function loadSessionIngredientState(){} function loadSessionStepState(){} function loadSessionNotes(){}
    function render(){
      syncQuickCalcScope();
      var r=S.recipes.find(function(x){return x.id===S.selectedId;});
      __last.html = S.view==='attive' ? renderAttive()
        : S.view==='sessione-operativa' ? '<div id="operativa">'+S.openSessionId+'</div>'
        : ((S.view==='recipe'&&S.mode==='produzione'&&r ? renderProdRecipe(r) : '') + renderMandaInProduzioneModal());
      syncProductionHomeLoad();
      revealProductionHighlight();
    }
    ${CLIENT_SRC}
    return { render, openQuickCalc, onQuickCalcInput, sendQuickCalcToProduction, openMandaInProduzione, onMandaInProduzioneField,
      confirmMandaInProduzione, confirmConversionPreflightStep, closeProductionHomeSection, avviaProduzione };`)(
    S, clientFetch, (m) => toasts.push(m), { error() {} }, doc, last, [], (fn) => timers.push(fn));
  const settle = async () => { for (let k = 0; k < 5; k++) { while (timers.length) await timers.shift()(); for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); } };
  return { S, api, apiCalls, toasts, last, scrolls, settle };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  // Il DB assegna created_at (DEFAULT now()): la nuova Sessione e' la piu' recente.
  function freshDb(nOld) {
    const fake = makeFakeSupabase();
    fake.tables.production_sessions = Array.from({ length: nOld }, (_, i) => old('o' + (i + 1), '2026-10-0' + (i + 1) + 'T08:00:00Z'));
    const f = fake.fetch;
    fake.fetch = async (url, opts = {}) => {
      const r = await f(url, opts);
      if ((opts.method || 'GET') === 'POST' && url.includes('/production_sessions')) (fake.tables.production_sessions || []).forEach(x => { if (!x.created_at) x.created_at = '2026-10-09T10:00:00Z'; });
      return r;
    };
    globalThis.fetch = fake.fetch;
    return fake;
  }
  const newRows = (fake) => (fake.tables.production_sessions || []).filter(r => !/^o\d/.test(r.id));
  const pendingIds = (h) => [...h.matchAll(/id="ph-session-([^"]*)"/g)].map(m => m[1]);
  function assertHighlighted(c, fake, nOld, label) {
    const rows = newRows(fake);
    assert.strictEqual(rows.length, 1, label + ': una sola Sessione creata');
    const id = rows[0].id;
    assert.strictEqual(rows[0].status, 'pending');
    assert.strictEqual(c.S.view, 'attive', label + ': Home Produzione');
    const h = c.last.html;
    if (nOld >= 3) {
      assert.strictEqual(c.S.produzioneHome.expanded, 'pending', label + ': elenco completo Da iniziare');
      assert.ok(h.includes('<div class="prod-title">Da iniziare</div>'));
    } else {
      assert.strictEqual(c.S.produzioneHome.expanded, null, label + ': resta nella Home (rientra nelle prime 3)');
    }
    const ids = pendingIds(h);
    assert.ok(ids.includes(id), label + ': nuova Sessione visibile');
    assert.strictEqual(ids[ids.length - 1], id, label + ': ultima (ordinamento cronologico invariato)');
    assert.ok(new RegExp('class="pg-card ph-new" id="ph-session-' + id + '"').test(h), label + ': evidenziata');
    assert.strictEqual((h.match(/ph-new"/g) || []).length, 1, 'una sola card evidenziata');
    assert.ok(h.includes('Appena creata'));
    assert.deepStrictEqual(c.scrolls.map(s => s.id), ['ph-session-' + id], label + ': portata nell\'area visibile');
    assert.ok(h.includes("avviaProduzione('" + id + "')"), 'avviabile dalla card');
    return id;
  }

  console.log('Navigazione dopo Manda in Produzione');

  await test('1+4+5. Calcolo rapido con 4 Sessioni pending precedenti: Da iniziare completo, nuova ultima, evidenziata e visibile', async () => {
    const fake = freshDb(4);
    const c = makeClient(handler);
    c.api.openQuickCalc('r1', 'v1');
    c.api.onQuickCalcInput('portions', '73');
    c.api.onQuickCalcInput('gpp', '150');
    c.api.sendQuickCalcToProduction();
    await c.api.confirmMandaInProduzione();
    await c.settle();
    assertHighlighted(c, fake, 4, 'Calcolo rapido');
    assert.strictEqual(newRows(fake)[0].target_finished_total, 10950, 'target temporaneo usato');
    assert.strictEqual(c.S.quickCalc, null, 'target temporaneo scartato uscendo dalla Ricetta');
    assert.ok(c.toasts.includes('Produzione creata'));
  });

  await test('2. Manda in Produzione diretto: stessa navigazione ed evidenziazione', async () => {
    const fake = freshDb(4);
    const c = makeClient(handler);
    c.api.openMandaInProduzione('r1', 'v1');
    c.api.onMandaInProduzioneField('portions', '10');
    c.api.onMandaInProduzioneField('gpp', '120');
    await c.api.confirmMandaInProduzione();
    await c.settle();
    assertHighlighted(c, fake, 4, 'diretto');
  });

  await test('3. percorso con preflight conversioni: navigazione solo dopo la creazione', async () => {
    const fake = freshDb(4);
    const c = makeClient(handler, { noMilkFact: true });
    c.api.openMandaInProduzione('r1', 'v1');
    c.api.onMandaInProduzioneField('portions', '4');
    c.api.onMandaInProduzioneField('gpp', '250');
    await c.api.confirmMandaInProduzione();
    assert.ok(c.S.pendingConversionPreflight, 'preflight aperto');
    assert.strictEqual(c.S.view, 'recipe', 'nessuna navigazione prima della creazione');
    assert.strictEqual(newRows(fake).length, 0);
    await c.api.confirmConversionPreflightStep('1.03');
    await c.settle();
    assertHighlighted(c, fake, 4, 'preflight');
  });

  await test('5b. con meno di 3 pending: evidenziata direttamente nella Home, senza espandere', async () => {
    const fake = freshDb(1);
    const c = makeClient(handler);
    c.api.openMandaInProduzione('r1', 'v1');
    c.api.onMandaInProduzioneField('portions', '2');
    c.api.onMandaInProduzioneField('gpp', '100');
    await c.api.confirmMandaInProduzione();
    await c.settle();
    assertHighlighted(c, fake, 1, 'Home');
    assert.ok(c.last.html.includes('data-ph-section="pending"'));
  });

  await test('6. apertura della Sessione evidenziata: Avvia la porta in corso e la apre; evidenziazione azzerata', async () => {
    const fake = freshDb(4);
    const c = makeClient(handler);
    c.api.openMandaInProduzione('r1', 'v1');
    c.api.onMandaInProduzioneField('portions', '10');
    c.api.onMandaInProduzioneField('gpp', '120');
    await c.api.confirmMandaInProduzione();
    await c.settle();
    const id = newRows(fake)[0].id;
    await c.api.avviaProduzione(id);
    await c.settle();
    assert.strictEqual(c.S.view, 'sessione-operativa');
    assert.strictEqual(c.S.openSessionId, id);
    assert.strictEqual(newRows(fake)[0].status, 'in_progress');
    assert.strictEqual(c.S.produzioneHome.highlight, null, 'evidenziazione azzerata uscendo dalla Home');
  });

  await test('7. errore di salvataggio: nessuna navigazione, nessuna evidenziazione, errore nel modale', async () => {
    const fake = freshDb(4);
    fake.fail('production_sessions:POST');
    const c = makeClient(handler);
    c.api.openQuickCalc('r1', 'v1');
    c.api.sendQuickCalcToProduction();
    await c.api.confirmMandaInProduzione();
    await c.settle();
    assert.strictEqual(c.S.view, 'recipe');
    assert.strictEqual(c.S.produzioneHome.highlight, null);
    assert.ok(c.S.pendingMandaInProduzione && c.S.pendingMandaInProduzione.error, 'errore mostrato nel modale');
    assert.strictEqual(newRows(fake).length, 0);
    assert.ok(!c.toasts.includes('Produzione creata'));
  });

  await test('8. nessuna duplicazione (doppia conferma); chiudendo "Mostra tutte" non si riapre; scorrimento una sola volta', async () => {
    const fake = freshDb(4);
    const c = makeClient(handler);
    c.api.openMandaInProduzione('r1', 'v1');
    c.api.onMandaInProduzioneField('portions', '10');
    c.api.onMandaInProduzioneField('gpp', '120');
    await Promise.all([c.api.confirmMandaInProduzione(), c.api.confirmMandaInProduzione()]);
    await c.settle();
    assert.strictEqual(newRows(fake).length, 1, 'una sola Sessione');
    c.api.closeProductionHomeSection();
    assert.strictEqual(c.S.produzioneHome.expanded, null);
    assert.ok(c.last.html.includes('data-ph-section="pending"'));
    assert.strictEqual(c.scrolls.length, 1);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
