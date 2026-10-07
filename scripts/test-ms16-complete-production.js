/*
 * Test Sprint Produzione — MS16: Completa produzione.
 * Nessun framework: Node puro + assert.
 *
 * Codice REALE: api/chat.js (handler) contro un finto PostgREST in memoria
 * (GET con eq/order/paginazione, PATCH con eq / is.null / not.is.null e
 * return=representation, INSERT puro) e le funzioni client ESTRATTE da
 * khub_mvp.html (avvio, completamento, Sessione operativa, tab Completate,
 * MS12/MS13/MS14/MS15 per il read-only). Mock ai confini: document, toast,
 * setInterval, localStorage.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
console.error = () => {}; // errori attesi (fallimenti simulati): l'esito si legge da ok/FAIL
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

// ══════════════════════════════════════════════════════════
// Finto PostgREST
// ══════════════════════════════════════════════════════════
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
    calls.push({ method, table, filters, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
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
      return reply(200, ((opts.headers && opts.headers.Prefer) || '').includes('return=representation') ? out : null);
    }
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      if (rows.some(r => r.id === body.id)) return reply(409, { code: '23505' });
      const row = { created_at: new Date().toISOString(), ...body };
      rows.push(row);
      return reply(201, [row]);
    }
    return reply(500, { message: 'metodo non atteso: ' + method });
  }
  return { tables, calls, fetch, fail: k => fail.add(k), heal: k => fail.delete(k) };
}

async function loadHandler() {
  return (await import('data:text/javascript;base64,' + Buffer.from(chatSrc).toString('base64'))).default;
}

const CLIENT_SRC = [
  'function escAttr(s)', 'function uid()', 'function formatFinishedTotalLabel(grams)',
  'async function loadProductionSessions()',
  'function renderPendingSessionCard(sess)', 'function renderInProgressSessionCard(sess)',
  // Home Produzione (sostituisce Produzione Guidata)
  'function activeVariants(recipe)', 'function historyNormalizeText(value)',
  'function selectProductionHomeSessions(sessions,section,context)', 'function activeRecipeEntries(recipes)',
  'function rankActiveRecipeEntries(entries,sessions)', 'function filterActiveRecipeEntries(entries,query)',
  'function openProductionHomeSection(section)', 'function closeProductionHomeSection()', 'function onProductionRecipeSearch(value)',
  'function openActiveRecipe(recipeId,variantId)', 'function renderActiveRecipeRow(entry,withShare)',
  'function renderProductionHomeSessionsBlock(section,limit)', 'function renderProductionRecipeSearch()',
  'function renderProductionHomeRecipesBlock()', 'function renderAllActiveRecipes()', 'function renderAttive()',
  'async function avviaProduzione(sessionId)', 'function applySessionLifecycleRow(sess,row)', 'function apriSessioneOperativa(sessionId,returnView)',
  // MS12/MS13/MS14
  'async function loadSessionIngredientState(sessionId)', 'async function toggleSessionIngredient(sessionId,itemKey)',
  'async function loadSessionStepState(sessionId)', 'async function toggleSessionStep(sessionId,itemKey)', 'function formatStepDurationLabel(seconds)',
  'function stepTimerDurationSeconds(value)', 'function stepTimerRemainingSeconds(startedAtIso,durationSeconds,nowMs)',
  'function stepTimerState(startedAtIso,durationSeconds,nowMs)', 'function formatTimerCountdown(seconds)', 'function findSnapshotStep(sess,itemKey)',
  'async function startSessionStepTimer(sessionId,itemKey)', 'async function cancelSessionStepTimer(sessionId,itemKey)',
  'function openSessionRunningTimers()', 'function syncStepTimerTicker()', 'function tickStepTimers()', 'function primeStepTimerSound()', 'function playStepTimerSound()',
  'function renderSessioneOperativa()',
  // MS15
  'function sessionNoteDraftKey(sessionId)', 'function readSessionNoteDraft(sessionId)', 'function writeSessionNoteDraft(sessionId,draft)',
  'function setSessionNoteDraftText(sessionId,text)', 'function restoreSessionNoteDraft(sessionId)', 'function sessionNoteDictationBusy(sessionId)',
  'function formatSessionNoteTime(iso)', 'function sortSessionNotes(notes)', 'async function loadSessionNotes(sessionId)', 'async function addSessionNote(sessionId)',
  'function renderSessionNotesSection(sess)',
  // MS16
  'function renderSessionStatusBadge(status)', 'function formatSessionDate(iso)', 'function formatSessionDateTime(iso)', 'function formatSessionTime(iso)',
  'function sessionDurationSeconds(startedIso,completedIso)', 'function formatSessionDuration(seconds)', 'function normalizeActualYieldGrams(qty,unit)',
  'function parseActualYieldInput(text,unit)', 'function formatYieldGrams(grams)', 'function sessionCompletionState(sessionId)',
  'function onSessionYieldInput(sessionId,field,value)', 'function requestCompleteSession(sessionId)', 'function cancelCompleteSession(sessionId)',
  'async function confirmCompleteSession(sessionId)', 'function renderSessionCompletionSection(sess)',
].map(extractFunction).concat([html.match(/var SESSION_NOTE_MAX_LENGTH=\d+;/)[0], html.match(/var PRODUCTION_HOME_LIMIT=\d+;/)[0]]).join('\n');

const SNAPSHOT = {
  snapshotVersion: 1, recipe: { recipeName: 'Risotto', variantName: 'Porcini' },
  target: { targetPortions: 10, targetGramsPerPortion: 200, targetFinishedTotal: 2000, baseExpectedFinishedTotal: 1000, scaleFactor: 2, normalizationUnit: 'g' },
  ingredients: [{ itemKey: 'vi1', sourceIngredientId: 'vi1', name: 'Porcini', unit: 'kg', baseQty: 1, operativeQty: 1.25 }],
  steps: [
    { stepId: 'st1', order: 0, text: 'Tostare il riso', expectedDurationSeconds: 600 },
    { stepId: 'st2', order: 1, text: 'Mantecare', expectedDurationSeconds: 120 },
  ],
  media: { mediaUrl: null, videoUrl: null },
};
// Riga DB di production_sessions
function dbSession(id, status, extra = {}) {
  return {
    id, recipe_id: 'r1', source_variant_id: 'vv1', status, snapshot_version: 1, snapshot: JSON.parse(JSON.stringify(SNAPSHOT)),
    target_finished_total: 2000, created_at: '2026-10-06T07:00:00.000Z',
    started_at: status === 'pending' ? null : '2026-10-06T08:00:00.000Z',
    completed_at: status === 'completed' ? '2026-10-06T10:15:30.000Z' : null,
    actual_yield_qty: null, actual_yield_unit: null, ...extra,
  };
}

function makeClient(handler) {
  const apiCalls = [], toasts = [];
  const clientFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    apiCalls.push(body);
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { ok: status < 400, status, json: async () => out };
  };
  const last = { html: '' };
  const els = {};
  const doc = { getElementById: id => els[id] || null, querySelectorAll: () => [] };
  const S = { view: 'app-home', openSessionId: null, productionSessions: [], produzioneHome: { recipeQuery: '', expanded: null }, recipeStaffCondivisi: {}, startingSessionId: null,
    sessionIngredientState: {}, sessionStepState: {}, sessionNotes: {}, sessionNoteDraft: {}, sessionNoteDictationSessionId: null,
    sessionCompletion: {}, recording: false, recordingTarget: null, recipes: [] };
  const storage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
  const api = new Function('S', 'fetch', 'toast', 'console', 'document', 'window', 'localStorage', 'setInterval', 'clearInterval', '__last', `
    var _stepTimerInterval=null; var _stepTimerSeenRunning={}; var _stepTimerAudioCtx=null;
    function ms14Now(){ return Date.now(); }
    function render(){
      __last.html = S.view==='sessione-operativa' ? renderSessioneOperativa() : S.view==='attive' ? renderAttive() : '';
      syncStepTimerTicker();
    }
    ${CLIENT_SRC}
    return { render, loadProductionSessions, avviaProduzione, apriSessioneOperativa,
      toggleSessionIngredient, toggleSessionStep, startSessionStepTimer, cancelSessionStepTimer, addSessionNote,
      onSessionYieldInput, requestCompleteSession, cancelCompleteSession, confirmCompleteSession, parseActualYieldInput,
      formatSessionDate, formatSessionDateTime, formatSessionDuration, sessionDurationSeconds };`)(
    S, clientFetch, (m) => toasts.push(m), { error() {} }, doc, {}, storage, () => 1, () => {}, last);
  return { S, api, apiCalls, toasts, last };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
  const call = async (body) => { let out; await handler({ method: 'POST', body }, { status() { return this; }, json(o) { out = o; return this; } }); return out; };

  function freshDb(sessions) {
    const fake = makeFakeSupabase();
    fake.tables.production_sessions = sessions || [dbSession('ps1', 'in_progress')];
    fake.tables.session_ingredient_state = fake.tables.production_sessions.map(s => ({ id: 'pis_' + s.id, session_id: s.id, item_key: 'vi1', checked: false, checked_at: null }));
    fake.tables.session_step_state = [];
    fake.tables.production_sessions.forEach(s => {
      fake.tables.session_step_state.push({ id: 'pss_' + s.id + '_st1', session_id: s.id, item_key: 'st1', checked: true, checked_at: '2026-10-06T08:30:00.000Z', timer_started_at: '2026-10-06T08:31:00.000Z', timer_actual_seconds: 77 });
      fake.tables.session_step_state.push({ id: 'pss_' + s.id + '_st2', session_id: s.id, item_key: 'st2', checked: false, checked_at: null, timer_started_at: null, timer_actual_seconds: null });
    });
    globalThis.fetch = fake.fetch;
    return fake;
  }
  const sessRow = (fake, id) => fake.tables.production_sessions.find(r => r.id === id);
  const stepRow = (fake, sid, k) => fake.tables.session_step_state.find(r => r.session_id === sid && r.item_key === k);
  const near = (iso, ms = 5000) => Math.abs(Date.parse(iso) - Date.now()) < ms;
  async function loadAndOpen(c, sid) { await c.api.loadProductionSessions(); c.api.apriSessioneOperativa(sid); await flush(); }
  async function completeViaUi(c, sid, qtyText, unit) {
    if (qtyText != null) c.api.onSessionYieldInput(sid, 'qty', qtyText);
    if (unit) c.api.onSessionYieldInput(sid, 'unit', unit);
    c.api.requestCompleteSession(sid);
    await c.api.confirmCompleteSession(sid);
    await flush();
  }

  console.log('MS16 — Completa produzione');

  // ── A. Lifecycle ──────────────────────────────────────────
  await test('A1-2. pending -> in_progress: PATCH condizionale status=pending, started_at del server, nessun upsert', async () => {
    const fake = freshDb([dbSession('ps1', 'pending')]);
    const c = makeClient(handler);
    await c.api.loadProductionSessions();
    await c.api.avviaProduzione('ps1');
    await flush();
    const r = sessRow(fake, 'ps1');
    assert.strictEqual(r.status, 'in_progress');
    assert.ok(r.started_at && near(r.started_at), 'started_at = ora del server');
    const call = c.apiCalls.find(x => x.supabaseAction === 'startProductionSession');
    assert.deepStrictEqual(Object.keys(call).sort(), ['sessionId', 'supabaseAction'], 'il client non invia timestamp');
    assert.ok(!c.apiCalls.some(x => x.supabaseAction === 'update'), 'nessuna azione generica');
    const p = fake.calls.find(x => x.table === 'production_sessions' && x.method === 'PATCH');
    assert.deepStrictEqual(p.filters, [['id', 'eq', 'ps1'], ['status', 'eq', 'pending']]);
    assert.deepStrictEqual(Object.keys(p.body).sort(), ['started_at', 'status']);
    assert.ok(!fake.calls.some(x => x.table === 'production_sessions' && x.method === 'POST'));
    assert.strictEqual(c.S.view, 'sessione-operativa');
    assert.strictEqual(c.S.productionSessions[0].startedAt, r.started_at, 'il client usa il valore del server');
  });

  await test('A3-4. scheda stale: in_progress e completed non vengono riavviate ne\' riportate a in_progress', async () => {
    const fake = freshDb([dbSession('ps1', 'pending'), dbSession('ps2', 'pending')]);
    const c = makeClient(handler);
    await c.api.loadProductionSessions(); // la UI vede entrambe pending
    sessRow(fake, 'ps1').status = 'in_progress'; sessRow(fake, 'ps1').started_at = '2026-10-06T08:00:00.000Z';
    Object.assign(sessRow(fake, 'ps2'), { status: 'completed', started_at: '2026-10-06T08:00:00.000Z', completed_at: '2026-10-06T09:00:00.000Z', actual_yield_qty: 1900, actual_yield_unit: 'g' });
    const prima1 = JSON.stringify(sessRow(fake, 'ps1')), prima2 = JSON.stringify(sessRow(fake, 'ps2'));
    await c.api.avviaProduzione('ps1');
    await c.api.avviaProduzione('ps2');
    assert.strictEqual(JSON.stringify(sessRow(fake, 'ps1')), prima1, 'in_progress intatta');
    assert.strictEqual(JSON.stringify(sessRow(fake, 'ps2')), prima2, 'completed intatta');
    assert.strictEqual(c.S.productionSessions.find(s => s.id === 'ps1').status, 'in_progress', 'UI riallineata');
    assert.strictEqual(c.S.productionSessions.find(s => s.id === 'ps2').status, 'completed', 'UI riallineata');
    assert.notStrictEqual(c.S.view, 'sessione-operativa');
    assert.strictEqual((await call({ supabaseAction: 'startProductionSession', sessionId: 'ps2' })).code, 'not_pending');
    assert.strictEqual((await call({ supabaseAction: 'startProductionSession', sessionId: 'nope' })).code, 'not_found');
  });

  await test('A5+A9. in_progress -> completed: PATCH condizionale, completed_at del server, solo campi di lifecycle', async () => {
    const fake = freshDb();
    const snapPrima = JSON.stringify(sessRow(fake, 'ps1').snapshot);
    const out = await call({ supabaseAction: 'completeProductionSession', sessionId: 'ps1', actualYield: null, completed_at: '1999-01-01T00:00:00Z' });
    assert.strictEqual(out.ok, true);
    const r = sessRow(fake, 'ps1');
    assert.strictEqual(r.status, 'completed');
    assert.ok(near(r.completed_at), 'completed_at = ora del server');
    const p = fake.calls.find(x => x.table === 'production_sessions' && x.method === 'PATCH');
    assert.deepStrictEqual(p.filters, [['id', 'eq', 'ps1'], ['status', 'eq', 'in_progress']]);
    assert.deepStrictEqual(Object.keys(p.body).sort(), ['actual_yield_qty', 'actual_yield_unit', 'completed_at', 'status']);
    assert.strictEqual(JSON.stringify(r.snapshot), snapPrima, 'snapshot intatto');
    assert.strictEqual(r.target_finished_total, 2000, 'target intatto');
    assert.strictEqual(r.started_at, '2026-10-06T08:00:00.000Z', 'started_at intatto');
    assert.ok(!fake.calls.some(x => ['recipes', 'variants', 'ingredients', 'ingredient_conversions'].includes(x.table)), 'nessuna scrittura su Ricetta/conversioni');
  });

  await test('A6-8. pending non completabile, completed non ri-completabile, inesistente fallisce', async () => {
    const fake = freshDb([dbSession('pp', 'pending'), dbSession('pc', 'completed', { actual_yield_qty: 1800, actual_yield_unit: 'g' })]);
    const prima = JSON.stringify(fake.tables.production_sessions);
    const a = await call({ supabaseAction: 'completeProductionSession', sessionId: 'pp' });
    assert.strictEqual(a.code, 'not_in_progress');
    const b = await call({ supabaseAction: 'completeProductionSession', sessionId: 'pc', actualYield: { qty: 5, unit: 'kg' } });
    assert.strictEqual(b.code, 'already_completed');
    assert.strictEqual(b.row.completed_at, '2026-10-06T10:15:30.000Z');
    assert.strictEqual((await call({ supabaseAction: 'completeProductionSession', sessionId: 'nope' })).code, 'not_found');
    assert.strictEqual((await call({ supabaseAction: 'completeProductionSession' })).code, 'invalid');
    assert.strictEqual(JSON.stringify(fake.tables.production_sessions), prima, 'nessuna Sessione modificata');
  });

  await test('A. UI: conferma prima della scrittura; Annulla non scrive; doppio submit -> una sola richiesta', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    await loadAndOpen(c, 'ps1');
    assert.ok(c.last.html.includes('Completa produzione'));
    c.api.requestCompleteSession('ps1');
    assert.ok(c.last.html.includes('sola lettura'), 'messaggio di conferma');
    assert.ok(c.last.html.includes('id="session-complete-cancel"') && c.last.html.includes('id="session-complete-confirm"'));
    assert.ok(!c.apiCalls.some(x => x.supabaseAction === 'completeProductionSession'), 'nessuna scrittura prima della conferma');
    c.api.cancelCompleteSession('ps1');
    assert.ok(!c.last.html.includes('id="session-complete-confirm"'));
    assert.strictEqual(sessRow(fake, 'ps1').status, 'in_progress');
    c.api.requestCompleteSession('ps1');
    const p1 = c.api.confirmCompleteSession('ps1');
    assert.ok(/id="session-complete-confirm" disabled/.test(c.last.html), 'bloccato in attesa');
    const p2 = c.api.confirmCompleteSession('ps1');
    await Promise.all([p1, p2]);
    assert.strictEqual(c.apiCalls.filter(x => x.supabaseAction === 'completeProductionSession').length, 1);
    assert.strictEqual(c.S.productionSessions[0].status, 'completed');
  });

  await test('A. UI: errore di rete/server -> la Sessione resta in corso, errore visibile, nuovo tentativo possibile', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    await loadAndOpen(c, 'ps1');
    fake.fail('production_sessions:PATCH');
    await completeViaUi(c, 'ps1', '1950', 'g');
    assert.strictEqual(c.S.productionSessions[0].status, 'in_progress', 'mai completed senza conferma del server');
    assert.ok(c.last.html.includes('Completamento non riuscito'));
    assert.ok(c.last.html.includes('Completa produzione'));
    assert.ok(c.last.html.includes('value="1950"'), 'resa inserita conservata');
    fake.heal('production_sessions:PATCH');
    c.api.requestCompleteSession('ps1');
    await c.api.confirmCompleteSession('ps1');
    assert.strictEqual(sessRow(fake, 'ps1').status, 'completed');
    assert.strictEqual(sessRow(fake, 'ps1').actual_yield_qty, 1950);
  });

  await test('A. UI: richiesta ripetuta (gia\' completata altrove) -> UI riallineata allo stato del server', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    await loadAndOpen(c, 'ps1');
    Object.assign(sessRow(fake, 'ps1'), { status: 'completed', completed_at: '2026-10-06T09:59:00.000Z', actual_yield_qty: 2100, actual_yield_unit: 'g' });
    await completeViaUi(c, 'ps1', '1', 'kg');
    assert.strictEqual(sessRow(fake, 'ps1').actual_yield_qty, 2100, 'nessuna sovrascrittura');
    assert.strictEqual(c.S.productionSessions[0].status, 'completed');
    assert.strictEqual(c.S.productionSessions[0].actualYieldQty, 2100);
    assert.ok(/già completata/.test(c.toasts.join('|')));
  });

  // ── B. Resa finale effettiva ──────────────────────────────
  await test('B10. nessuna resa -> actual_yield_qty/unit null', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    await loadAndOpen(c, 'ps1');
    await completeViaUi(c, 'ps1', '   ', 'kg');
    const r = sessRow(fake, 'ps1');
    assert.strictEqual(r.status, 'completed');
    assert.strictEqual(r.actual_yield_qty, null);
    assert.strictEqual(r.actual_yield_unit, null);
    assert.ok(c.last.html.includes('non registrata'));
  });

  await test('B11-13+18. g valido; kg -> grammi; virgola italiana; unita\' persistita sempre g', async () => {
    for (const [txt, unit, grams] of [['4720', 'g', 4720], ['4,72', 'kg', 4720], ['4.72', 'kg', 4720], ['0,5', 'g', 0.5], ['1950,25', 'g', 1950.25]]) {
      const fake = freshDb();
      const c = makeClient(handler);
      await loadAndOpen(c, 'ps1');
      await completeViaUi(c, 'ps1', txt, unit);
      const r = sessRow(fake, 'ps1');
      assert.strictEqual(r.actual_yield_qty, grams, txt + ' ' + unit);
      assert.strictEqual(r.actual_yield_unit, 'g');
    }
    const out = await call({ supabaseAction: 'completeProductionSession', sessionId: 'ps1', actualYield: { qty: 4.72, unit: 'kg' } });
    assert.ok(out.code === 'already_completed' || out.ok);
    freshDb();
    const k = await call({ supabaseAction: 'completeProductionSession', sessionId: 'ps1', actualYield: { qty: 4.72, unit: 'kg' } });
    assert.deepStrictEqual([k.row.actual_yield_qty, k.row.actual_yield_unit], [4720, 'g'], 'server: 4.72 kg -> 4720 g esatti');
  });

  await test('B14-17. zero, negativo, NaN/stringa, unita\' non ammessa: rifiutati (client e server), nessuna scrittura', async () => {
    const c0 = makeClient(handler);
    for (const [txt, unit] of [['0', 'g'], ['0,0', 'kg'], ['-5', 'g'], ['abc', 'g'], ['4.720,5', 'g'], ['1e3', 'g'], ['NaN', 'kg'], ['12', 'lb']]) {
      assert.strictEqual(c0.api.parseActualYieldInput(txt, unit).ok, false, txt + ' ' + unit);
    }
    const fake = freshDb();
    for (const y of [{ qty: 0, unit: 'g' }, { qty: -5, unit: 'g' }, { qty: NaN, unit: 'g' }, { qty: '4720', unit: 'g' }, { qty: 5, unit: 'lb' }, { qty: 5 }, { qty: Infinity, unit: 'g' }, 'tanto', [1]]) {
      const out = await call({ supabaseAction: 'completeProductionSession', sessionId: 'ps1', actualYield: y });
      assert.strictEqual(out.code, 'invalid_yield', JSON.stringify(y));
    }
    assert.strictEqual(sessRow(fake, 'ps1').status, 'in_progress');
    assert.ok(!fake.calls.some(x => x.method === 'PATCH'));
    const c = makeClient(handler);
    await loadAndOpen(c, 'ps1');
    c.api.onSessionYieldInput('ps1', 'qty', '-3');
    c.api.requestCompleteSession('ps1');
    assert.ok(c.last.html.includes('ms16-yield-error'), 'errore mostrato');
    assert.ok(!c.last.html.includes('id="session-complete-confirm"'), 'nessuna conferma con resa non valida');
    assert.ok(!c.apiCalls.some(x => x.supabaseAction === 'completeProductionSession'));
  });

  // ── C. Read-only server-side ──────────────────────────────
  await test('C19-22. completed: spunta, Fatto, avvio e annullo timer rifiutati dal server, nessuna PATCH', async () => {
    const fake = freshDb([dbSession('ps1', 'completed')]);
    const prima = JSON.stringify([fake.tables.session_ingredient_state, fake.tables.session_step_state]);
    const r1 = await call({ supabaseAction: 'setSessionIngredientChecked', sessionId: 'ps1', itemKey: 'vi1', checked: true });
    const r2 = await call({ supabaseAction: 'setSessionStepChecked', sessionId: 'ps1', itemKey: 'st2', checked: true });
    const r3 = await call({ supabaseAction: 'startSessionStepTimer', sessionId: 'ps1', itemKey: 'st2' });
    const r4 = await call({ supabaseAction: 'cancelSessionStepTimer', sessionId: 'ps1', itemKey: 'st1', expectedStartedAt: '2026-10-06T08:31:00.000Z' });
    for (const r of [r1, r2, r3, r4]) assert.strictEqual(r.code, 'not_in_progress');
    assert.ok(!fake.calls.some(x => x.method === 'PATCH'));
    assert.strictEqual(JSON.stringify([fake.tables.session_ingredient_state, fake.tables.session_step_state]), prima);
    freshDb([dbSession('ps1', 'pending')]);
    assert.strictEqual((await call({ supabaseAction: 'setSessionIngredientChecked', sessionId: 'ps1', itemKey: 'vi1', checked: true })).code, 'not_in_progress', 'anche pending');
    assert.strictEqual((await call({ supabaseAction: 'setSessionStepChecked', sessionId: 'nope', itemKey: 'st1', checked: true })).code, 'not_found');
  });

  await test('C23. in_progress: le stesse azioni funzionano come prima', async () => {
    const fake = freshDb();
    assert.strictEqual((await call({ supabaseAction: 'setSessionIngredientChecked', sessionId: 'ps1', itemKey: 'vi1', checked: true })).ok, true);
    assert.strictEqual((await call({ supabaseAction: 'setSessionStepChecked', sessionId: 'ps1', itemKey: 'st2', checked: true })).ok, true);
    assert.strictEqual((await call({ supabaseAction: 'startSessionStepTimer', sessionId: 'ps1', itemKey: 'st2' })).ok, true);
    assert.strictEqual((await call({ supabaseAction: 'cancelSessionStepTimer', sessionId: 'ps1', itemKey: 'st1', expectedStartedAt: '2026-10-06T08:31:00.000Z' })).ok, true);
    assert.strictEqual(fake.tables.session_ingredient_state[0].checked, true);
    assert.strictEqual(stepRow(fake, 'ps1', 'st2').checked, true);
    assert.ok(stepRow(fake, 'ps1', 'st2').timer_started_at);
    assert.strictEqual(stepRow(fake, 'ps1', 'st1').timer_started_at, null);
  });

  await test('C24. note MS15: in_progress ammessa, completed rifiutata', async () => {
    const fake = freshDb([dbSession('ps1', 'in_progress'), dbSession('ps2', 'completed')]);
    assert.strictEqual((await call({ supabaseAction: 'addSessionNote', note: { id: 'n1', session_id: 'ps1', text: 'ok' } })).ok, true);
    assert.strictEqual((await call({ supabaseAction: 'addSessionNote', note: { id: 'n2', session_id: 'ps2', text: 'no' } })).code, 'not_in_progress');
    await call({ supabaseAction: 'completeProductionSession', sessionId: 'ps1' });
    assert.strictEqual((await call({ supabaseAction: 'addSessionNote', note: { id: 'n3', session_id: 'ps1', text: 'dopo' } })).code, 'not_in_progress');
    assert.deepStrictEqual(fake.tables.session_notes.map(n => n.id), ['n1']);
    assert.strictEqual((await call({ supabaseAction: 'loadSessionNotes', sessionId: 'ps1' })).rows.length, 1, 'note ancora leggibili');
  });

  // ── D. Timer alla chiusura ────────────────────────────────
  await test('D25-27. timer attivi azzerati; timer_actual_seconds e checked intatti; altre Sessioni intatte', async () => {
    const fake = freshDb([dbSession('ps1', 'in_progress'), dbSession('ps2', 'in_progress')]);
    const out = await call({ supabaseAction: 'completeProductionSession', sessionId: 'ps1' });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.timersCleared, true);
    const st1 = stepRow(fake, 'ps1', 'st1');
    assert.strictEqual(st1.timer_started_at, null);
    assert.strictEqual(st1.timer_actual_seconds, 77);
    assert.strictEqual(st1.checked, true);
    assert.strictEqual(st1.checked_at, '2026-10-06T08:30:00.000Z');
    assert.strictEqual(stepRow(fake, 'ps1', 'st2').checked, false, 'nessun Fatto automatico');
    assert.strictEqual(stepRow(fake, 'ps2', 'st1').timer_started_at, '2026-10-06T08:31:00.000Z', 'altra Sessione intatta');
    const tp = fake.calls.filter(x => x.table === 'session_step_state' && x.method === 'PATCH');
    assert.strictEqual(tp.length, 1);
    assert.deepStrictEqual(tp[0].body, { timer_started_at: null });
    assert.deepStrictEqual(tp[0].filters, [['session_id', 'eq', 'ps1'], ['timer_started_at', 'not', 'is.null']]);
  });

  await test('D. errore parziale: pulizia timer fallita -> Sessione comunque completata, pulizia ritentata alla richiesta successiva', async () => {
    const fake = freshDb();
    fake.fail('session_step_state:PATCH');
    const out = await call({ supabaseAction: 'completeProductionSession', sessionId: 'ps1' });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.timersCleared, false);
    assert.strictEqual(sessRow(fake, 'ps1').status, 'completed');
    assert.ok(stepRow(fake, 'ps1', 'st1').timer_started_at);
    fake.heal('session_step_state:PATCH');
    const again = await call({ supabaseAction: 'completeProductionSession', sessionId: 'ps1' });
    assert.strictEqual(again.code, 'already_completed');
    assert.strictEqual(again.timersCleared, true);
    assert.strictEqual(stepRow(fake, 'ps1', 'st1').timer_started_at, null);
  });

  // ── E. UI / dati ──────────────────────────────────────────
  await test('E28-29. loadProductionSessions carica le completate con resa e completed_at', async () => {
    const fake = freshDb([dbSession('ps1', 'in_progress'), dbSession('pc', 'completed', { actual_yield_qty: '4720', actual_yield_unit: 'g' })]);
    const c = makeClient(handler);
    await c.api.loadProductionSessions();
    const get = fake.calls.find(x => x.table === 'production_sessions' && x.method === 'GET');
    assert.ok(get, 'lettura production_sessions');
    const s = c.S.productionSessions.find(x => x.id === 'pc');
    assert.strictEqual(s.status, 'completed');
    assert.strictEqual(s.completedAt, '2026-10-06T10:15:30.000Z');
    assert.strictEqual(s.actualYieldQty, 4720);
    assert.strictEqual(s.actualYieldUnit, 'g');
    assert.ok(/actual_yield_qty,actual_yield_unit/.test(chatSrc.match(/production_sessions\?select=id,recipe_id[^']*/)[0]));
  });

  await test('E30. completate fuori dalla Home Produzione (accesso dallo Storico, MS17b); dalla Sessione completata si torna alla Home', async () => {
    // Produzione Guidata e la sua tab Completate sono state sostituite dalla Home Produzione + Storico.
    freshDb([dbSession('ps1', 'in_progress'), dbSession('pc', 'completed', { actual_yield_qty: 4720, actual_yield_unit: 'g' })]);
    const c = makeClient(handler);
    c.S.view = 'attive';
    await c.api.loadProductionSessions();
    assert.ok(c.last.html.includes("apriSessioneOperativa('ps1')"), 'in corso nella Home');
    assert.ok(!c.last.html.includes("apriSessioneOperativa('pc')") && !c.last.html.includes("avviaProduzione('pc')"), 'completata non in Home');
    assert.ok(c.last.html.includes('goToStoricoProduzioni()'), 'accesso allo Storico');
    assert.ok(!/produzione-guidata|setProduzioneGuidataTab|Completate/.test(c.last.html), 'nessuna Produzione Guidata / tab Completate');
    c.api.apriSessioneOperativa('pc');
    await flush();
    assert.strictEqual(c.S.view, 'sessione-operativa');
    assert.strictEqual(c.S.openSessionId, 'pc');
    assert.ok(c.last.html.includes(`id="session-back-home" onclick="S.view='attive';render()"`), 'si torna alla Home Produzione');
    assert.ok(c.last.html.includes('Produzione del ' + c.api.formatSessionDate('2026-10-06T08:00:00.000Z')));
  });

  await test('E31-32. completata: badge "Completata", nessun controllo operativo, note in sola lettura, tentativi client bloccati', async () => {
    const fake = freshDb([dbSession('pc', 'completed', { actual_yield_qty: 4720, actual_yield_unit: 'g' })]);
    fake.tables.session_notes = [{ id: 'n1', session_id: 'pc', text: 'Nota storica', created_at: '2026-10-06T09:00:00.000Z' }];
    const c = makeClient(handler);
    await loadAndOpen(c, 'pc');
    const h = c.last.html;
    assert.ok(h.includes('pg-badge-completed">Completata'));
    assert.ok(!h.includes('pg-badge-in-progress'), 'mai piu\' "In corso" fisso');
    assert.ok(!/class="ms12-check"[^>]*aria-checked="(true|false)"[^>]*title="[^"]*"\s*onclick/.test(h) || /class="ms12-check"[^>]*disabled/.test(h), 'spunte disabilitate');
    assert.ok(/class="ms12-check"[^>]*disabled/.test(h));
    assert.ok(/class="ms13-step-check"[^>]*disabled/.test(h));
    assert.ok(!h.includes('ms14-timer-start') && !h.includes('ms14-timer-cancel') && !h.includes('ms14-timer-reset'), 'nessun controllo timer');
    assert.ok(!h.includes('session-note-input') && h.includes('Nota storica') && h.includes('sola lettura'));
    assert.ok(!h.includes('id="session-complete"') && !h.includes('session-yield-qty'), 'nessun input di completamento');
    assert.ok(h.includes('Resa finale effettiva:</span> ' + (4720).toLocaleString('it-IT') + ' g'));
    assert.ok(h.includes('Completata il:</span> ' + c.api.formatSessionDateTime('2026-10-06T10:15:30.000Z')));
    await c.api.toggleSessionIngredient('pc', 'vi1');
    await c.api.toggleSessionStep('pc', 'st2');
    await c.api.startSessionStepTimer('pc', 'st2');
    await c.api.addSessionNote('pc');
    c.api.requestCompleteSession('pc');
    assert.ok(!c.apiCalls.some(x => /^set|^start|^cancel|^add|^complete/.test(x.supabaseAction)), 'nessuna richiesta di mutazione');
  });

  await test('E33-34. data produzione da started_at; durata derivata (completed_at - started_at), mai persistita', async () => {
    const fake = freshDb([dbSession('pc', 'completed')]);
    const c = makeClient(handler);
    await loadAndOpen(c, 'pc');
    const d = c.api.formatSessionDate('2026-10-06T08:00:00.000Z');
    assert.ok(c.last.html.includes('Produzione del ' + d), 'intestazione');
    assert.ok(c.last.html.includes('Data produzione:</span> ' + d), 'blocco Fine produzione');
    assert.strictEqual(c.api.sessionDurationSeconds('2026-10-06T08:00:00.000Z', '2026-10-06T10:15:30.000Z'), 8130);
    assert.ok(c.last.html.includes('Durata totale:</span> 2 h 15 min'));
    assert.strictEqual(c.api.formatSessionDuration(45 * 60), '45 min');
    assert.strictEqual(c.api.formatSessionDuration(30), 'meno di 1 min');
    assert.strictEqual(c.api.sessionDurationSeconds('2026-10-06T10:00:00Z', '2026-10-06T09:00:00Z'), null, 'negativa -> non mostrata');
    assert.strictEqual(c.api.sessionDurationSeconds(null, '2026-10-06T09:00:00Z'), null);
    // durata mai inviata al server
    const fake2 = freshDb();
    const c2 = makeClient(handler);
    await loadAndOpen(c2, 'ps1');
    assert.ok(c2.last.html.includes('Data produzione:</span> ' + d), 'mostrata anche in corso');
    await completeViaUi(c2, 'ps1', '2', 'kg');
    const p = fake2.calls.find(x => x.table === 'production_sessions' && x.method === 'PATCH');
    assert.ok(!Object.keys(p.body).some(k => /duration|timer_actual/.test(k)));
    assert.ok(!fake2.calls.some(x => x.method === 'PATCH' && x.body && 'timer_actual_seconds' in x.body));
  });

  await test('E. dopo il completamento via UI: stato completed solo dopo il server, read-only immediato, timer riletti', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    await loadAndOpen(c, 'ps1');
    assert.ok(c.last.html.includes('pg-badge-in-progress'));
    assert.ok(c.last.html.includes('ms14-timer'), 'timer visibile in corso');
    await completeViaUi(c, 'ps1', '4,72', 'kg');
    const s = c.S.productionSessions[0];
    assert.strictEqual(s.status, 'completed');
    assert.strictEqual(s.completedAt, sessRow(fake, 'ps1').completed_at);
    assert.strictEqual(s.actualYieldQty, 4720);
    assert.ok(c.last.html.includes('pg-badge-completed'));
    assert.ok(!c.last.html.includes('ms14-timer'));
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.st1.timerStartedAt, null, 'stato timer riletto dal DB');
    assert.ok(/Produzione completata/.test(c.toasts.join('|')));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
