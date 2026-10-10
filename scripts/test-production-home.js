/*
 * Test Sprint Produzione — Home Produzione (H1+H2+H3): In corso, Da iniziare,
 * Ricette attive, accesso allo Storico; Produzione Guidata ritirata.
 * Nessun framework: Node puro + assert.
 *
 * Codice REALE: api/chat.js (handler) contro un finto PostgREST in memoria e
 * le funzioni client ESTRATTE da khub_mvp.html. Mock ai confini: document,
 * toast, localStorage, setTimeout del caricamento Sessioni, orologio Storico.
 * Le impronte (sha256 del codice senza commenti //) verificano che lifecycle,
 * motore/UI dello Storico (MS17) e Calcolo Produzione NON siano cambiati: si
 * aggiornano SOLO con un cambiamento intenzionale di quei comportamenti.
 */
process.env.TZ = 'Europe/Rome';
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

function makeFakeSupabase() {
  const tables = { production_sessions: [], session_ingredient_state: [], session_step_state: [], session_notes: [] };
  const calls = [];
  const fail = new Set();
  const matches = (row, filters) => filters.every(([col, op, val]) => {
    if (op === 'is' && val === 'null') return row[col] == null;
    if (op === 'not' && val === 'is.null') return row[col] != null;
    if (op !== 'eq') throw new Error('filtro non supportato: ' + op);
    return (row[col] == null ? null : String(row[col])) === val;
  });
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)), text: async () => JSON.stringify(data) });
  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    const method = opts.method || 'GET';
    let order = [], limit = null, offset = 0;
    const filters = [];
    for (const [k, raw] of u.searchParams) {
      if (k === 'select') continue;
      if (k === 'order') { order = raw.split(',').map(x => x.split('.')); continue; }
      if (k === 'limit') { limit = parseInt(raw, 10); continue; }
      if (k === 'offset') { offset = parseInt(raw, 10); continue; }
      const dot = raw.indexOf('.');
      filters.push([k, raw.slice(0, dot), raw.slice(dot + 1)]);
    }
    calls.push({ method, table, filters, body: opts.body ? JSON.parse(opts.body) : null });
    if (fail.has(table + ':' + method)) return reply(500, { message: 'boom' });
    const rows = tables[table] = tables[table] || [];
    if (method === 'GET') {
      const sorted = rows.filter(r => matches(r, filters)).sort((a, b) => {
        for (const [c, dir] of order) {
          if (a[c] !== b[c]) { const lt = String(a[c]) < String(b[c]); return (dir === 'desc' ? !lt : lt) ? -1 : 1; }
        }
        return 0;
      });
      return reply(200, sorted.slice(offset, offset + Math.min(limit == null ? Infinity : limit, 1000)));
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(opts.body);
      const out = [];
      rows.forEach((r, i) => { if (matches(r, filters)) { rows[i] = { ...r, ...patch }; out.push(rows[i]); } });
      return reply(200, out);
    }
    return reply(500, { message: 'metodo non atteso: ' + method });
  }
  return { tables, calls, fetch, fail: k => fail.add(k), heal: k => fail.delete(k) };
}
async function loadHandler() {
  return (await import('data:text/javascript;base64,' + Buffer.from(chatSrc).toString('base64'))).default;
}


const crypto = require('crypto');
const CLIENT_SRC = [
  'function escAttr(s)', 'function uid()', 'function formatFinishedTotalLabel(grams)', 'function activeVariants(recipe)', 'function renderAttive()',
  'async function loadProductionSessions()',
  'function renderPendingSessionCard(sess)', 'function renderInProgressSessionCard(sess)',
  'function selectProductionHomeSessions(sessions,section,context)', 'function activeRecipeEntries(recipes)',
  'function rankActiveRecipeEntries(entries,sessions)', 'function filterActiveRecipeEntries(entries,query)',
  'function openProductionHomeSection(section)', 'function closeProductionHomeSection()', 'function onProductionRecipeSearch(value)',
  'function openActiveRecipe(recipeId,variantId)', 'function renderActiveRecipeRow(entry,withShare)',
  'function renderProductionHomeSessionsBlock(section,limit)', 'function renderProductionRecipeSearch()',
  'function renderProductionHomeRecipesBlock()', 'function renderAllActiveRecipes()',
  'async function avviaProduzione(sessionId)', 'function applySessionLifecycleRow(sess,row)', 'function apriSessioneOperativa(sessionId,returnView)',
  'async function loadSessionIngredientState(sessionId)', 'async function toggleSessionIngredient(sessionId,itemKey)',
  'async function loadSessionStepState(sessionId)', 'async function toggleSessionStep(sessionId,itemKey)', 'function formatStepDurationLabel(seconds)',
  'function stepTimerDurationSeconds(value)', 'function stepTimerRemainingSeconds(startedAtIso,durationSeconds,nowMs)',
  'function stepTimerState(startedAtIso,durationSeconds,nowMs)', 'function formatTimerCountdown(seconds)',
  'function openSessionRunningTimers()', 'function syncStepTimerTicker()', 'function tickStepTimers()',
  'function renderSessioneOperativa()',
  'function sessionNoteDraftKey(sessionId)', 'function readSessionNoteDraft(sessionId)', 'function restoreSessionNoteDraft(sessionId)',
  'function sessionNoteDictationBusy(sessionId)', 'function formatSessionNoteTime(iso)', 'function sortSessionNotes(notes)',
  'async function loadSessionNotes(sessionId)', 'async function addSessionNote(sessionId)', 'function renderSessionNotesSection(sess)',
  'function renderSessionStatusBadge(status)', 'function formatSessionDate(iso)', 'function formatSessionDateTime(iso)', 'function formatSessionTime(iso)',
  'function sessionDurationSeconds(startedIso,completedIso)', 'function formatSessionDuration(seconds)', 'function normalizeActualYieldGrams(qty,unit)',
  'function parseActualYieldInput(text,unit)', 'function formatYieldGrams(grams)', 'function sessionCompletionState(sessionId)',
  'function requestCompleteSession(sessionId)', 'function renderSessionCompletionSection(sess)',
  // MS17a (motore, invariato)
  'function historyNormalizeText(value)', 'function historyLocalDayKey(iso)', 'function historyNormalizePeriod(period)',
  'function historyNumberOrNull(v)', 'function buildHistoryRecord(sess)', 'function historyMatchesQuery(record,query)',
  'function historyMatchesPeriod(record,period)', 'function selectHistoryRecords(sessions,filters)',
  'function aggregateHistoryRecords(records)', 'function groupHistoryByPreparation(records)',
  // MS17b
  'function historyPeriodFromFilters(filters,now)', 'function historyErrorMessage(code)', 'function formatHistoryQty(grams)',
  'function formatHistorySigned(grams)', 'function formatHistoryPct(pct)', 'function goToStoricoProduzioni()',
  'function tornaAlloStoricoProduzioni()', 'function openHistorySession(sessionId)', 'function onHistoryQueryInput(value)',
  'function setHistoryPreset(preset)', 'function onHistoryDateInput(field,value)', 'function resetHistoryFilters()',
  'function formatHistoryWhen(iso)', 'function historyVariantAddsInfo(recipeName,variantName)', // MS17b.1
  'function renderHistoryCount(count)', 'function renderHistoryCard(r)', 'function renderStoricoProduzioni()',
  // Home Produzione: ingresso e "Manda in Produzione" solo da Ricetta attiva
  'function syncProductionHomeLoad()', 'function R(id)', 'function canSendToProduction(vv)', 'function findRecipeVariant(recipeId,variantId)',
  'function openMandaInProduzione(recipeId,variantId,target)', 'async function confirmMandaInProduzione()',
  'function goToNewProductionSession(sessionId)', 'function isHighlightedProductionSession(id)', 'function revealProductionHighlight()',
].map(extractFunction).concat([html.match(/var SESSION_NOTE_MAX_LENGTH=\d+;/)[0], html.match(/var PRODUCTION_HOME_LIMIT=\d+;/)[0]]).join('\n');

const NOW = new Date('2026-10-07T10:00:00.000Z');
let seq = 0;
function dbSession(o = {}) {
  seq++;
  const status = o.status || 'completed';
  return {
    id: o.id || ('ps' + seq), recipe_id: o.recipeId || 'r-tir', source_variant_id: o.variantId || 'v-tir',
    status, snapshot_version: 1,
    snapshot: {
      snapshotVersion: 1, recipe: { recipeId: o.recipeId || 'r-tir', recipeName: o.recipeName || 'Tiramisù', variantId: o.variantId || 'v-tir', variantName: o.variantName || 'Classico' },
      target: { targetPortions: 10, targetGramsPerPortion: 500, targetFinishedTotal: 5000, baseExpectedFinishedTotal: 2500, scaleFactor: 2, normalizationUnit: 'g' },
      ingredients: [{ itemKey: 'vi1', sourceIngredientId: 'vi1', name: 'Mascarpone', unit: 'g', baseQty: 500, operativeQty: 1000 }],
      steps: [{ stepId: 'st1', order: 0, text: 'Montare', expectedDurationSeconds: 600 }], media: { mediaUrl: null, videoUrl: null },
    },
    target_finished_total: 5000, created_at: o.createdAt || '2026-10-01T06:00:00.000Z',
    started_at: status === 'pending' ? null : (o.startedAt || '2026-10-05T07:00:00.000Z'),
    completed_at: status === 'completed' ? (o.completedAt || '2026-10-06T09:00:00.000Z') : null,
    actual_yield_qty: null, actual_yield_unit: null,
  };
}
// Ricette: 5 attive (2 nella stessa Scheda), 1 validata non attiva, 1 attiva archiviata, 1 solo LAB, 1 sotto-ricetta.
function recipes() {
  const v = (id, name, extra = {}) => ({ id, name, active: true, status: 'validated', ingredients: [], steps: [], ...extra });
  return [
    { id: 'r-tir', name: 'Tiramisù', category: 'Dolci', validatedVariants: [v('v-tir', 'Tiramisù classico'), v('v-tir2', 'Tiramisù senza uova'), v('v-old', 'Tiramisù vecchio', { status: 'retired' })], labVersions: [] },
    { id: 'r-ris', name: 'Risotto', category: 'Primi', validatedVariants: [v('v-ris', 'Risotto ai porcini')], labVersions: [] },
    { id: 'r-bro', name: 'Brodo', category: 'Basi', validatedVariants: [v('v-bro', 'Brodo vegetale')], labVersions: [] },
    { id: 'r-cre', name: 'Crema', category: 'Basi', validatedVariants: [v('v-cre', 'Crema pasticcera'), v('v-pronta', 'Crema leggera', { active: false })], labVersions: [] },
    { id: 'r-lab', name: 'Zuppa sperimentale', category: 'Primi', validatedVariants: [], labVersions: [{ id: 'lv1', name: 'Zuppa sperimentale' }] },
    { id: 'r-sub', name: 'Pan di Spagna base', parentRecipeId: 'r-tir', category: 'Basi', validatedVariants: [v('v-sub', 'Pan di Spagna')], labVersions: [] },
  ];
}
function dataset() {
  return [
    ...[1, 2, 3, 4, 5].map(i => dbSession({ id: 'ip' + i, status: 'in_progress', startedAt: '2026-10-0' + i + 'T07:00:00.000Z' })),
    ...[1, 2, 3, 4].map(i => dbSession({ id: 'pd' + i, status: 'pending', createdAt: '2026-10-0' + i + 'T06:00:00.000Z' })),
    dbSession({ id: 'c1', status: 'completed', variantId: 'v-ris', recipeId: 'r-ris', recipeName: 'Risotto', createdAt: '2026-10-06T06:00:00.000Z' }),
    dbSession({ id: 'c2', status: 'completed', variantId: 'v-bro', recipeId: 'r-bro', recipeName: 'Brodo', createdAt: '2026-10-03T06:00:00.000Z' }),
  ];
}

function makeClient(handler, opts = {}) {
  const apiCalls = [], toasts = [], timers = [];
  const clientFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    apiCalls.push(body);
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { ok: status < 400, status, json: async () => out };
  };
  const last = { html: '' };
  const doc = { getElementById: () => null, querySelectorAll: () => [] };
  const S = { view: 'app-home', openSessionId: null, productionSessions: [], produzioneHome: { recipeQuery: '', expanded: null }, startingSessionId: null,
    sessionIngredientState: {}, sessionStepState: {}, sessionNotes: {}, sessionNoteDraft: {}, sessionNoteDictationSessionId: null,
    sessionCompletion: {}, recording: false, recordingTarget: null, recipes: opts.recipes || recipes(), recipeStaffCondivisi: {},
    historyFilters: { query: '', preset: 'all', from: '', to: '' }, sessionReturnView: null, productionSessionsLoad: 'idle',
    pendingMandaInProduzione: null, selectedId: null, selectedVariantId: null, mode: 'lab' };
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const STAFF_ESEMPIO = [{ id: 'staff-cucina', name: 'Cucina Ristorante' }];
  const api = new Function('S', 'fetch', 'toast', 'console', 'document', 'window', 'localStorage', 'setInterval', 'clearInterval', 'setTimeout', 'STAFF_ESEMPIO', '__last', '__now', `
    var _stepTimerInterval=null; var _stepTimerSeenRunning={}; var _lastViewForProductionLoad=null;
    function ms14Now(){ return Date.now(); }
    function historyNow(){ return new Date(__now.t); }
    function render(){
      __last.html = S.view==='sessione-operativa' ? renderSessioneOperativa()
        : S.view==='storico-produzioni' ? renderStoricoProduzioni()
        : S.view==='attive' ? renderAttive() : '';
      syncStepTimerTicker();
      syncProductionHomeLoad();
    }
    ${CLIENT_SRC}
    return { render, avviaProduzione, apriSessioneOperativa, goToStoricoProduzioni, openHistorySession, tornaAlloStoricoProduzioni,
      openProductionHomeSection, closeProductionHomeSection, onProductionRecipeSearch, openActiveRecipe, loadProductionSessions,
      selectProductionHomeSessions, activeRecipeEntries, rankActiveRecipeEntries, filterActiveRecipeEntries, selectHistoryRecords,
      canSendToProduction, openMandaInProduzione, confirmMandaInProduzione };`)(
    S, clientFetch, (m) => toasts.push(m), { error() {} }, doc, {}, storage, () => 1, () => {}, (fn) => timers.push(fn), STAFF_ESEMPIO, last, { t: NOW.getTime() });
  const runTimers = async () => { while (timers.length) await timers.shift()(); };
  return { S, api, apiCalls, toasts, last, runTimers };
}

function extractFrom(text, marker) {
  const start = text.indexOf(marker);
  if (start === -1) throw new Error('marker non trovato: ' + marker);
  const b = text.indexOf('{', start); let d = 0;
  for (let i = b; i < text.length; i++) { if (text[i] === '{') d++; else if (text[i] === '}') { d--; if (!d) return text.slice(start, i + 1); } }
}
const strip = (x) => x.replace(/(^|[\s;{}(])\/\/[^\n]*/g, '$1');
const sha = (x) => crypto.createHash('sha256').update(strip(x)).digest('hex').slice(0, 16);

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
  function freshDb(rows) { const fake = makeFakeSupabase(); fake.tables.production_sessions = rows; globalThis.fetch = fake.fetch; return fake; }
  // Ingresso nella Home come da barra/sidebar/Home app: S.view='attive' + render (+ caricamento automatico).
  async function enterHome(c) { c.S.view = 'attive'; c.api.render(); await c.runTimers(); await flush(); }
  const section = (h, key) => { const i = h.indexOf('data-ph-section="' + key + '"'); if (i < 0) return ''; const j = h.indexOf('<section', i + 1); return h.slice(i, j < 0 ? h.length : j); };
  const count = (h, re) => (h.match(re) || []).length;

  console.log('Home Produzione — H1+H2+H3');

  await test('1-3. Home Produzione: titolo, ordine In corso -> Da iniziare -> Ricette attive, Sessioni caricate all\'ingresso', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await enterHome(c);
    const h = c.last.html;
    assert.ok(h.includes('<div class="prod-title">Produzione</div>'));
    assert.ok(c.apiCalls.some(x => x.supabaseAction === 'loadProductionSessions'), 'Sessioni caricate entrando');
    const a = h.indexOf('data-ph-section="in_progress"'), b = h.indexOf('data-ph-section="pending"'), r = h.indexOf('data-ph-section="recipes"');
    assert.ok(a > 0 && a < b && b < r, 'ordine delle sezioni');
    assert.ok(h.indexOf('id="btn-storico-produzioni"') > 0, 'accesso Storico presente');
    assert.ok(!/<canvas|<svg|kpi/i.test(h), 'nessun grafico/KPI');
  });

  await test('4-7. In corso: solo in_progress, max 3 (ordine di avvio), "Mostra tutte" con >3, Continua apre la Sessione', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await enterHome(c);
    const s = section(c.last.html, 'in_progress');
    assert.deepStrictEqual([...s.matchAll(/apriSessioneOperativa\('([^']*)'\)">Continua/g)].map(m => m[1]), ['ip1', 'ip2', 'ip3']);
    assert.ok(!/pd\d|c\d'/.test(s.replace(/data-ph[^"]*"[^"]*"/g, '')), 'nessuna pending/completed');
    assert.ok(s.includes('data-ph-more="in_progress"') && s.includes('Mostra tutte (5)'));
    c.api.openProductionHomeSection('in_progress');
    assert.ok(c.last.html.includes('<div class="prod-title">In corso</div>'));
    assert.strictEqual(count(c.last.html, />Continua/g), 5, 'vista completa: tutte');
    assert.ok(c.last.html.includes('id="ph-back-home"'));
    c.api.closeProductionHomeSection();
    assert.ok(c.last.html.includes('data-ph-section="recipes"'), 'ritorno alla Home');
    c.api.apriSessioneOperativa('ip2');
    await flush();
    assert.strictEqual(c.S.view, 'sessione-operativa');
    assert.strictEqual(c.S.openSessionId, 'ip2');
    assert.ok(c.last.html.includes('pg-badge-in-progress'), 'Sessione operativa esistente');
  });

  await test('6/10. "Mostra tutte" assente con 3 o meno Sessioni', async () => {
    freshDb([dbSession({ id: 'a', status: 'in_progress' }), dbSession({ id: 'b', status: 'pending' })]);
    const c = makeClient(handler);
    await enterHome(c);
    assert.ok(!c.last.html.includes('data-ph-more="in_progress"') && !c.last.html.includes('data-ph-more="pending"'));
  });

  await test('8-11. Da iniziare: solo pending, max 3 (piu\' vecchie prima), "Mostra tutte" con >3, Avvia usa avviaProduzione', async () => {
    const fake = freshDb(dataset());
    const c = makeClient(handler);
    await enterHome(c);
    const s = section(c.last.html, 'pending');
    assert.deepStrictEqual([...s.matchAll(/avviaProduzione\('([^']*)'\)">Avvia</g)].map(m => m[1]), ['pd1', 'pd2', 'pd3']);
    assert.ok(!s.includes("apriSessioneOperativa("), 'nessuna in corso');
    assert.ok(s.includes('Mostra tutte (4)'));
    await c.api.avviaProduzione('pd1');
    await flush();
    assert.ok(c.apiCalls.some(x => x.supabaseAction === 'startProductionSession' && x.sessionId === 'pd1'), 'flusso esistente');
    assert.strictEqual(fake.tables.production_sessions.find(r => r.id === 'pd1').status, 'in_progress');
    assert.strictEqual(c.S.view, 'sessione-operativa');
    assert.strictEqual(c.S.openSessionId, 'pd1');
  });

  await test('19-21. completed mai in In corso / Da iniziare; restano nello Storico', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await enterHome(c);
    for (const id of ['c1', 'c2']) assert.ok(!c.last.html.includes("'" + id + "'"), id + ' non in Home');
    for (const k of ['in_progress', 'pending']) { c.api.openProductionHomeSection(k); assert.ok(!/'c[12]'/.test(c.last.html)); c.api.closeProductionHomeSection(); }
    assert.deepStrictEqual(c.api.selectHistoryRecords(c.S.productionSessions, {}).records.map(r => r.sessionId).sort(), ['c1', 'c2']);
  });

  await test('12-15. Ricette attive: max 3 (piu\' recenti in Sessione prima), ricerca su tutte le attive, mai LAB/non attive, Mostra tutte', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await enterHome(c);
    let s = section(c.last.html, 'recipes');
    // ultima Sessione: v-ris 06/10, v-tir 04/10 (pd4), v-bro 03/10; le altre attive in ordine alfabetico
    assert.deepStrictEqual([...s.matchAll(/data-variant-id="([^"]*)"/g)].map(m => m[1]), ['v-ris', 'v-tir', 'v-bro']);
    assert.ok(s.includes('placeholder="Cerca una ricetta…"'));
    assert.ok(s.includes('Mostra tutte (5)'));
    assert.ok(!s.includes('Condividi con lo staff'), 'condivisione fittizia non nella Home');
    c.api.onProductionRecipeSearch('PASTICCERA');
    s = section(c.last.html, 'recipes');
    assert.deepStrictEqual([...s.matchAll(/data-variant-id="([^"]*)"/g)].map(m => m[1]), ['v-cre'], 'trovata anche se non tra le 3');
    for (const q of ['crema leggera', 'zuppa', 'vecchio', 'pan di spagna']) {
      c.api.onProductionRecipeSearch(q);
      assert.ok(section(c.last.html, 'recipes').includes('Nessuna Ricetta attiva trovata.'), q + ': non attiva/LAB/archiviata/sotto-ricetta esclusa');
    }
    c.api.onProductionRecipeSearch('tiramisu');
    assert.deepStrictEqual([...section(c.last.html, 'recipes').matchAll(/data-variant-id="([^"]*)"/g)].map(m => m[1]).sort(), ['v-tir', 'v-tir2']);
    c.api.onProductionRecipeSearch('');
    c.api.openProductionHomeSection('recipes');
    const h = c.last.html;
    assert.ok(h.includes('<div class="prod-title">Ricette attive</div>') && h.includes('5 RICETTE ATTIVE'));
    assert.strictEqual(count(h, /class="prod-riga ph-recipe-row"/g), 5);
    assert.ok(h.includes('Condividi con lo staff'), 'elenco completo invariato (condivisione fittizia mantenuta solo qui)');
    assert.ok(!/v-pronta|v-old|v-sub|r-lab/.test(h));
    c.api.openActiveRecipe('r-cre', 'v-cre');
    assert.deepStrictEqual([c.S.view, c.S.mode, c.S.selectedId, c.S.selectedVariantId], ['recipe', 'produzione', 'r-cre', 'v-cre']);
    assert.ok(c.S.recipes.every(r => r.validatedVariants.every(v => typeof v.active === 'boolean')), 'la ricerca non modifica dati');
  });

  await test('16-17. Storico dalla Home; Storico -> Produzione riporta alla Home (ricaricata, sezioni chiuse)', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await enterHome(c);
    assert.ok(c.last.html.includes('onclick="goToStoricoProduzioni()"'));
    c.api.openProductionHomeSection('recipes');
    c.api.goToStoricoProduzioni();
    await flush();
    assert.strictEqual(c.S.view, 'storico-produzioni');
    assert.ok(c.last.html.includes(`onclick="S.view='attive';render()"`), 'ritorno Storico -> Produzione');
    const loads = c.apiCalls.filter(x => x.supabaseAction === 'loadProductionSessions').length;
    await enterHome(c);
    assert.ok(c.last.html.includes('data-ph-section="in_progress"'), 'Home principale, non la vista espansa');
    assert.strictEqual(c.apiCalls.filter(x => x.supabaseAction === 'loadProductionSessions').length, loads + 1, 'Sessioni ricaricate');
  });

  await test('22-23. Sessione aperta dalla Home torna alla Home (anche dalla vista "Mostra tutte"); dallo Storico torna allo Storico', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await enterHome(c);
    c.api.openProductionHomeSection('in_progress');
    c.api.apriSessioneOperativa('ip5');
    await flush();
    assert.ok(c.last.html.includes(`id="session-back-home" onclick="S.view='attive';render()"`) && c.last.html.includes('Produzione</button>'));
    await enterHome(c);
    assert.ok(c.last.html.includes('<div class="prod-title">In corso</div>'), 'si torna dove si era (Mostra tutte)');
    c.api.goToStoricoProduzioni();
    await flush();
    c.api.openHistorySession('c1');
    await flush();
    assert.ok(c.last.html.includes('id="session-back-history"') && !c.last.html.includes('session-back-home'));
    c.api.tornaAlloStoricoProduzioni();
    assert.strictEqual(c.S.view, 'storico-produzioni');
  });

  await test('18. Produzione Guidata non e\' piu\' una destinazione: nessun pulsante, funzioni ritirate, vecchio stato -> Home', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await enterHome(c);
    assert.ok(!/Produzione Guidata|produzione-guidata|setProduzioneGuidataTab/.test(c.last.html));
    for (const f of ['function goToProduzioneGuidata', 'function setProduzioneGuidataTab', 'function renderProduzioneGuidata', 'function renderCompletedSessionCard']) assert.ok(!html.includes(f), f + ' rimossa');
    assert.ok(!/onclick="[^"]*produzione-guidata/.test(html), 'nessun link verso Produzione Guidata');
    const renderSrc = extractFrom(html, 'function render(){');
    assert.ok(/S\.view==='produzione-guidata'\)\{S\.view='attive';mainContent=renderAttive\(\);\}/.test(renderSrc), 'stato di cronologia vecchio -> Home');
    c.api.apriSessioneOperativa('ip1');
    await flush();
    assert.ok(!c.last.html.includes('Produzione Guidata'));
  });

  await test('24-26. empty state: nessuna in corso, nessuna da iniziare, nessuna Ricetta attiva (sezioni sempre visibili)', async () => {
    freshDb([]);
    const c = makeClient(handler, { recipes: [{ id: 'r-lab', name: 'Zuppa', category: 'Primi', validatedVariants: [{ id: 'vp', name: 'Zuppa', active: false, status: 'validated', ingredients: [] }], labVersions: [] }] });
    await enterHome(c);
    const h = c.last.html;
    assert.ok(section(h, 'in_progress').includes('Nessuna produzione in corso.'));
    assert.ok(section(h, 'pending').includes('Nessuna produzione da iniziare.'));
    assert.ok(section(h, 'recipes').includes('Nessuna Ricetta attiva disponibile.'));
    assert.ok(!h.includes('Mostra tutte'));
  });

  await test('extra. caricamento in corso / errore di caricamento delle Sessioni distinti dalla Home vuota', async () => {
    const fake = freshDb(dataset());
    fake.fail('production_sessions:GET');
    const c = makeClient(handler);
    c.S.view = 'attive'; c.api.render();
    assert.ok(section(c.last.html, 'in_progress').includes('Carico le produzioni'));
    await c.runTimers(); await flush();
    assert.ok(section(c.last.html, 'in_progress').includes('Non riesco a caricare le produzioni'));
    assert.ok(!c.last.html.includes('Nessuna produzione in corso.'));
  });

  await test('27-28. Manda in Produzione solo da Ricetta attiva (pulsante, apertura e conferma)', async () => {
    freshDb([]);
    const c = makeClient(handler);
    const R0 = c.S.recipes;
    assert.strictEqual(c.api.canSendToProduction(R0[0].validatedVariants[0]), true, 'attiva');
    assert.strictEqual(c.api.canSendToProduction(R0[3].validatedVariants[1]), false, 'validata non attiva');
    assert.strictEqual(c.api.canSendToProduction(R0[0].validatedVariants[2]), false, 'archiviata');
    assert.strictEqual(c.api.canSendToProduction(null), false);
    const prod = extractFrom(html, 'function renderProdRecipe(recipe)');
    assert.ok(prod.includes("${canSendToProduction(vv)?`<button") && prod.includes('Manda in Produzione'), 'pulsante condizionato alla Ricetta attiva');
    assert.ok(!/\$\{vv\.status!=='retired'\?`<button[^`]*Manda in Produzione/.test(prod), 'vecchia condizione rimossa');
    c.api.openMandaInProduzione('r-cre', 'v-pronta');
    assert.strictEqual(c.S.pendingMandaInProduzione, null);
    assert.ok(/Solo una Ricetta attiva/.test(c.toasts.pop()));
    c.api.openMandaInProduzione('r-cre', 'v-cre');
    assert.deepStrictEqual([c.S.pendingMandaInProduzione.recipeId, c.S.pendingMandaInProduzione.variantId], ['r-cre', 'v-cre']);
    c.S.recipes[3].validatedVariants[0].active = false; // disattivata mentre il modale e' aperto
    c.S.pendingMandaInProduzione.portions = '10'; c.S.pendingMandaInProduzione.gpp = '100';
    await c.api.confirmMandaInProduzione();
    assert.ok(/non è più attiva/.test(c.S.pendingMandaInProduzione.error));
    assert.ok(!c.apiCalls.some(x => x.supabaseAction === 'update'), 'nessuna Sessione creata');
  });

  await test('29-31. invariati: lifecycle Sessione, motore e UI dello Storico (MS17), Calcolo Produzione', async () => {
    const chat = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
    const expect = {
      // lifecycle
      'async function avviaProduzione(sessionId)': '289b627e3fe12939', 'function applySessionLifecycleRow(sess,row)': 'b5f2167035235c30',
      'async function confirmCompleteSession(sessionId)': 'fda1bf292e333dd7', 'function requestCompleteSession(sessionId)': '0973c32405197f51',
      'async function createProductionSession(preparedInput)': '35f7ad233df205aa', 'function apriSessioneOperativa(sessionId,returnView)': '3628cbe92ed6d26b',
      // MS17 (motore + UI Storico)
      'function historyNormalizeText(value)': '67ffc5b991c11c92', 'function historyLocalDayKey(iso)': '9b3a7276766a7e49',
      'function historyNormalizePeriod(period)': 'e54809c9f229dbd9', 'function historyNumberOrNull(v)': '87d2134911e0b5b0',
      'function buildHistoryRecord(sess)': '618865987cac2168', 'function historyMatchesQuery(record,query)': '779fba1d40f8f3e0',
      'function historyMatchesPeriod(record,period)': 'ab0399db9b230a23', 'function selectHistoryRecords(sessions,filters)': '67360bfe5b7174bf',
      'function aggregateHistoryRecords(records)': '35bcb68933bb2812', 'function groupHistoryByPreparation(records)': 'cbf3a262b9abd594',
      // FIX 4: riepilogo aggregato rimosso dallo Storico (solo conteggio)
      'function renderStoricoProduzioni()': '4fea137f75ac1d5c', 'function renderHistoryCount(count)': '0ba29da4e8144370',
      'function renderHistoryCard(r)': '63d9a2ad82f2b6ff', 'function historyPeriodFromFilters(filters,now)': '212600a2326fe511',
      // Calcolo Produzione
      'function onVarPortions(recipeId,varId,val)': 'e9611d9a3b9b0279', 'function onVarGpp(recipeId,varId,val)': 'aca83356c53d81e0',
      'function onVarIngQty(recipeId,varId,ingId,val)': '774fc1fd5dcbf680', 'function onVarIngUnit(recipeId,varId,ingId,val)': '641e20b3cd61f9bb',
      'function computeScaleFactor(': '4185aa43ad6073d4', 'function effectiveYield(': '69bd0b9bd8305d41',
    };
    for (const [m, h] of Object.entries(expect)) assert.strictEqual(sha(extractFrom(html, m)), h, 'cambiato: ' + m);
    // renderProdRecipe e' stata sostituita INTENZIONALMENTE dal Calcolo rapido non distruttivo
    // (vedi scripts/test-quick-calc.js): la vista non collega piu' alcun gestore che modifica la Ricetta.
    const prod = extractFrom(html, 'function renderProdRecipe(recipe)');
    assert.ok(!/onVarPortions|onVarGpp|onVarIngQty|onVarIngUnit/.test(prod), 'nessun gestore che modifica la Ricetta nella vista');
    assert.ok(prod.includes("${canSendToProduction(vv)?`<button") && prod.includes('Manda in Produzione'));
    const blk = chat.slice(chat.indexOf("if (body.supabaseAction === 'startProductionSession')"), chat.indexOf('// Sprint Produzione — MS15: Note di produzione della Sessione'));
    assert.strictEqual(sha(blk), '62c3e4596d2fc9e1', 'azioni server di lifecycle invariate');
  });

  await test('32. selezione Sessioni della Home centralizzata (nessun filtro di status nei renderer; context riservato)', async () => {
    for (const f of ['function renderAttive()', 'function renderProductionHomeSessionsBlock(section,limit)', 'function renderProductionHomeRecipesBlock()', 'function renderAllActiveRecipes()']) {
      assert.ok(!/\.status\s*===|status==='/.test(extractFrom(html, f)), f + ': nessun filtro status');
    }
    assert.ok(extractFrom(html, 'function renderProductionHomeSessionsBlock(section,limit)').includes('selectProductionHomeSessions(sessions,section)'));
    freshDb([]);
    const c = makeClient(handler);
    const ss = [{ id: 'a', status: 'in_progress', startedAt: '2026-10-02T00:00:00Z' }, { id: 'b', status: 'in_progress', startedAt: '2026-10-01T00:00:00Z' },
      { id: 'p', status: 'pending', createdAt: '2026-10-01T00:00:00Z' }, { id: 'x', status: 'completed' }];
    assert.deepStrictEqual(c.api.selectProductionHomeSessions(ss, 'in_progress', { user: 'futuro' }).map(s => s.id), ['b', 'a']);
    assert.deepStrictEqual(c.api.selectProductionHomeSessions(ss, 'pending').map(s => s.id), ['p']);
    assert.deepStrictEqual(c.api.selectProductionHomeSessions(ss, 'completed'), [], 'le completate non sono una sezione della Home');
  });

  await test('extra. nomi escapati nelle card della Home', async () => {
    freshDb([dbSession({ id: 'x', status: 'in_progress', recipeName: '<img src=x onerror=alert(1)>' })]);
    const c = makeClient(handler);
    await enterHome(c);
    assert.ok(!c.last.html.includes('<img src=x') && c.last.html.includes('&lt;img src=x'));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
