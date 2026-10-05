/*
 * Test Sprint Produzione — MS14: timer persistenti degli step.
 * Nessun framework: Node puro + assert.
 *
 * Codice REALE: api/chat.js (handler) contro un finto PostgREST in memoria
 * (filtri eq/is.null, PATCH con return=representation) e le funzioni client
 * ESTRATTE da khub_mvp.html. Mock ai confini: orologio (ms14Now),
 * setInterval/clearInterval, document.querySelectorAll (letto dall'HTML
 * realmente renderizzato), AudioContext, toast.
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
  const tables = { session_ingredient_state: [], session_step_state: [], production_sessions: [] };
  const calls = [];
  const fail = new Set();
  const matches = (row, filters) => filters.every(([col, op, val]) => {
    if (op === 'is' && val === 'null') return row[col] == null;
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
        for (const [c] of order) { if (a[c] !== b[c]) return String(a[c]) < String(b[c]) ? -1 : 1; }
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
    if (method === 'POST') return reply(500, { message: 'INSERT/UPSERT non atteso in MS12' });
    throw new Error('metodo non supportato: ' + method);
  }
  return { tables, calls, fetch, fail: k => fail.add(k), heal: k => fail.delete(k) };
}

async function loadHandler() {
  return (await import('data:text/javascript;base64,' + Buffer.from(chatSrc).toString('base64'))).default;
}

const CLIENT_SRC = [
  'function escAttr(s)', 'function formatFinishedTotalLabel(grams)', 'function apriSessioneOperativa(sessionId)',
  'async function loadSessionIngredientState(sessionId)', 'async function toggleSessionIngredient(sessionId,itemKey)',
  'function renderSessioneOperativa()',
  'async function loadSessionStepState(sessionId)', 'async function toggleSessionStep(sessionId,itemKey)', 'function formatStepDurationLabel(seconds)',
  'function stepTimerDurationSeconds(value)', 'function stepTimerRemainingSeconds(startedAtIso,durationSeconds,nowMs)',
  'function stepTimerState(startedAtIso,durationSeconds,nowMs)', 'function formatTimerCountdown(seconds)', 'function findSnapshotStep(sess,itemKey)',
  'async function startSessionStepTimer(sessionId,itemKey)', 'async function cancelSessionStepTimer(sessionId,itemKey)',
  'function openSessionRunningTimers()', 'function syncStepTimerTicker()', 'function tickStepTimers()',
  'function primeStepTimerSound()', 'function playStepTimerSound()',
].map(extractFunction).join('\n');

function makeSession(id, status, stepIds, durations) {
  return {
    id, recipeId: 'r1', sourceVariantId: 'vv1', status, snapshotVersion: 1, targetFinishedTotal: 2000,
    createdAt: '2026-10-01T08:00:00Z', startedAt: '2026-10-01T09:00:00Z', completedAt: null,
    snapshot: {
      snapshotVersion: 1, recipe: { recipeName: 'Risotto', variantName: 'Porcini' },
      target: { targetPortions: 10, targetGramsPerPortion: 200, targetFinishedTotal: 2000, baseExpectedFinishedTotal: 1000, scaleFactor: 2, normalizationUnit: 'g' },
      ingredients: [{ itemKey: 'vi1', sourceIngredientId: 'vi1', name: 'Porcini', unit: 'kg', baseQty: 1, operativeQty: 1.25 }],
      steps: stepIds.map((k, i) => ({ stepId: k, order: i, text: 'Passaggio ' + (i + 1), expectedDurationSeconds: durations ? durations[i] : [600, 300, 120][i] })),
      media: { mediaUrl: null, videoUrl: null },
    },
  };
}

// Client con orologio, interval, DOM e audio controllabili.
function makeClient(handler, sessions, opts = {}) {
  const apiCalls = [], toasts = [];
  const clientFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    apiCalls.push(body);
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { ok: status < 400, status, json: async () => out };
  };
  const clock = { now: opts.now || Date.now() };
  const intervals = []; // {id, fn, ms, active}
  const fakeSetInterval = (fn, ms) => { const it = { id: intervals.length + 1, fn, ms, active: true }; intervals.push(it); return it.id; };
  const fakeClearInterval = (id) => { const it = intervals.find(x => x.id === id); if (it) it.active = false; };
  const last = { html: '' }, counters = { renders: 0, beeps: 0 };
  const textUpdates = [];
  const doc = {
    querySelectorAll(sel) {
      if (sel !== '[data-ms14-timer]') return [];
      const out = [];
      const re = /<span data-ms14-timer data-session-id="([^"]*)" data-item-key="([^"]*)" data-started-at="([^"]*)" data-duration="([^"]*)">/g;
      let m;
      while ((m = re.exec(last.html))) {
        const attrs = { 'data-session-id': m[1], 'data-item-key': m[2], 'data-started-at': m[3], 'data-duration': m[4] };
        out.push({ getAttribute: (a) => attrs[a], set textContent(v) { textUpdates.push({ item: attrs['data-item-key'], text: v }); } });
      }
      return out;
    },
  };
  class FakeAC {
    constructor() { this.state = opts.audioState || 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { this.state = 'running'; }
    createOscillator() { counters.beeps++; return { type: '', frequency: {}, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  const win = opts.noAudio ? {} : { AudioContext: FakeAC };
  const S = { view: 'app-home', openSessionId: null, productionSessions: sessions, sessionIngredientState: {}, sessionStepState: {}, recipes: [] };
  const api = new Function('S', 'fetch', 'toast', 'console', 'document', 'window', 'setInterval', 'clearInterval', '__clock', '__last', '__counters', `
    var _stepTimerInterval=null; var _stepTimerSeenRunning={}; var _stepTimerAudioCtx=null;
    function ms14Now(){ return __clock.now; }
    function render(){ __counters.renders++; __last.html = S.view==='sessione-operativa' ? renderSessioneOperativa() : ''; syncStepTimerTicker(); }
    ${CLIENT_SRC}
    return { apriSessioneOperativa, loadSessionStepState, toggleSessionStep, renderSessioneOperativa, render,
      startSessionStepTimer, cancelSessionStepTimer, tickStepTimers, stepTimerRemainingSeconds, stepTimerState, formatTimerCountdown,
      intervalId: () => _stepTimerInterval };`)(
    S, clientFetch, (m) => toasts.push(m), { error() {} }, doc, win, fakeSetInterval, fakeClearInterval, clock, last, counters);
  return { S, api, apiCalls, toasts, clock, intervals, last, counters, textUpdates,
    activeIntervals: () => intervals.filter(i => i.active),
    tick: () => intervals.filter(i => i.active).forEach(i => i.fn()) };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const flush = () => new Promise(r => setTimeout(r, 0));

  function freshDb() {
    const fake = makeFakeSupabase();
    const row = (sid, k, extra = {}) => ({ id: 'pss_' + sid + '_' + k, session_id: sid, item_key: k, checked: false, checked_at: null,
      timer_started_at: null, timer_actual_seconds: 77, ...extra });
    fake.tables.session_step_state = [row('ps1', 'st1'), row('ps1', 'st2'), row('ps1', 'st3'), row('ps2', 'st1')];
    fake.tables.session_ingredient_state = [{ id: 'pis1', session_id: 'ps1', item_key: 'vi1', checked: false, checked_at: null }];
    globalThis.fetch = fake.fetch;
    return fake;
  }
  const dbRow = (fake, sid, k) => fake.tables.session_step_state.find(r => r.session_id === sid && r.item_key === k);
  const sessions = () => [makeSession('ps1', 'in_progress', ['st1', 'st2', 'st3']), makeSession('ps2', 'in_progress', ['st1'])];
  async function open(c, sid) { c.S.view = 'sessione-operativa'; c.api.apriSessioneOperativa(sid); await flush(); await flush(); c.api.render(); }
  const timerWrites = (fake) => fake.calls.filter(x => x.table === 'session_step_state' && x.method === 'PATCH' && 'timer_started_at' in (x.body || {}));
  const startedMs = (fake, sid, k) => Date.parse(dbRow(fake, sid, k).timer_started_at);

  console.log('MS14 — timer persistenti degli step');

  await test('start: timestamp server-side, PATCH mirata con is.null, solo timer_started_at, nessun INSERT/UPSERT', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const prima = Date.now();
    await c.api.startSessionStepTimer('ps1', 'st1');
    const r = dbRow(fake, 'ps1', 'st1');
    assert.ok(r.timer_started_at && Date.parse(r.timer_started_at) >= prima - 1000, 'ora del server');
    const w = timerWrites(fake);
    assert.strictEqual(w.length, 1);
    assert.deepStrictEqual(Object.keys(w[0].body), ['timer_started_at']);
    assert.deepStrictEqual(w[0].filters, [['session_id', 'eq', 'ps1'], ['item_key', 'eq', 'st1'], ['timer_started_at', 'is', 'null']]);
    assert.ok(!fake.calls.some(x => x.method === 'POST'));
    assert.ok(!c.apiCalls.some(b => b.supabaseAction === 'update' || b.supabaseAction === 'save'));
    assert.strictEqual(fake.tables.session_step_state.length, 4, 'nessuna riga creata');
    assert.deepStrictEqual([r.checked, r.checked_at, r.timer_actual_seconds], [false, null, 77], 'altri campi intatti');
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.st1.timerStartedAt, r.timer_started_at);
    assert.ok(!c.apiCalls.some(b => 'timerStartedAt' in b || 'timer_started_at' in b), 'il client non manda mai un orario');
  });

  await test('doppio start rifiutato (gia\' avviato altrove); doppio click -> una sola PATCH', async () => {
    const fake = freshDb();
    let c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await Promise.all([c.api.startSessionStepTimer('ps1', 'st1'), c.api.startSessionStepTimer('ps1', 'st1')]);
    assert.strictEqual(timerWrites(fake).length, 1);
    const primo = dbRow(fake, 'ps1', 'st1').timer_started_at;
    await c.api.startSessionStepTimer('ps1', 'st1'); // gia' avviato: nessuna richiesta
    assert.strictEqual(timerWrites(fake).length, 1);
    // altro dispositivo con stato vecchio (non avviato): il server rifiuta, nessun riavvio silenzioso
    c = makeClient(handler, sessions());
    await open(c, 'ps1');
    dbRow(fake, 'ps1', 'st2').timer_started_at = '2026-10-05T10:00:00.000Z';
    await c.api.startSessionStepTimer('ps1', 'st2');
    assert.strictEqual(dbRow(fake, 'ps1', 'st2').timer_started_at, '2026-10-05T10:00:00.000Z');
    assert.deepStrictEqual(c.toasts, ['Timer non avviato. Riprova.']);
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.st2.timerStartedAt, null, 'stato precedente invariato');
    assert.strictEqual(dbRow(fake, 'ps1', 'st1').timer_started_at, primo);
  });

  await test('cancel/reset: solo timer_started_at -> null con filtro sull\'avvio atteso; checked e timer_actual_seconds intatti', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.toggleSessionStep('ps1', 'st1'); // Fatto
    await c.api.startSessionStepTimer('ps1', 'st1');
    const started = dbRow(fake, 'ps1', 'st1').timer_started_at;
    const checkedAt = dbRow(fake, 'ps1', 'st1').checked_at;
    await c.api.cancelSessionStepTimer('ps1', 'st1');
    const r = dbRow(fake, 'ps1', 'st1');
    assert.deepStrictEqual([r.timer_started_at, r.checked, r.checked_at, r.timer_actual_seconds], [null, true, checkedAt, 77]);
    const w = timerWrites(fake).at(-1);
    assert.deepStrictEqual(w.body, { timer_started_at: null });
    assert.deepStrictEqual(w.filters, [['session_id', 'eq', 'ps1'], ['item_key', 'eq', 'st1'], ['timer_started_at', 'eq', started]]);
    assert.deepStrictEqual(c.S.sessionStepState.ps1.byItemKey.st1, { checked: true, checkedAt, timerStartedAt: null });
  });

  await test('cancel concorrente: timer riavviato altrove nel frattempo -> non azzerato, errore visibile', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.startSessionStepTimer('ps1', 'st1');
    dbRow(fake, 'ps1', 'st1').timer_started_at = '2026-10-05T11:11:11.000Z'; // azzerato e riavviato da un altro dispositivo
    await c.api.cancelSessionStepTimer('ps1', 'st1');
    assert.strictEqual(dbRow(fake, 'ps1', 'st1').timer_started_at, '2026-10-05T11:11:11.000Z');
    assert.deepStrictEqual(c.toasts, ['Timer non azzerato. Riprova.']);
    assert.ok(c.S.sessionStepState.ps1.byItemKey.st1.timerStartedAt, 'stato precedente invariato');
    // piu' righe -> errore anche lato server
    fake.tables.session_step_state.push({ ...dbRow(fake, 'ps1', 'st3'), id: 'dup' });
    let out;
    await handler({ method: 'POST', body: { supabaseAction: 'startSessionStepTimer', sessionId: 'ps1', itemKey: 'st3' } }, { status() { return this; }, json(o) { out = o; return this; } });
    assert.ok(out.error && !out.ok);
  });

  await test('stati derivati: non avviato / in corso (mai negativo) / scaduto; countdown derivato, mai persistito', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    assert.match(c.last.html, /Avvia timer/);
    await c.api.startSessionStepTimer('ps1', 'st1');
    const t0 = startedMs(fake, 'ps1', 'st1');
    c.clock.now = t0 + 85 * 1000; c.api.render();
    assert.match(c.last.html, /data-item-key="st1"[^>]*>08:35</, 'rimanente = 600 - 85');
    assert.match(c.last.html, /Annulla timer/);
    c.clock.now = t0 + 600 * 1000; c.api.render();
    assert.match(c.last.html, /Tempo terminato/);
    assert.match(c.last.html, /Azzera timer/);
    c.clock.now = t0 + 5000 * 1000; c.api.render();
    assert.doesNotMatch(c.last.html, /-\d/, 'nessun numero negativo');
    assert.strictEqual(c.api.stepTimerRemainingSeconds(new Date(t0).toISOString(), 600, t0 + 9e9), 0);
    assert.deepStrictEqual([c.api.formatTimerCountdown(514), c.api.formatTimerCountdown(3725), c.api.formatTimerCountdown(-3)], ['08:34', '1:02:05', '00:00']);
    assert.strictEqual(timerWrites(fake).length, 1, 'nessuna scrittura per il countdown');
    assert.ok(!('remaining' in dbRow(fake, 'ps1', 'st1')));
    assert.deepStrictEqual(c.S.productionSessions[0].snapshot.steps.map(s => s.expectedDurationSeconds), [600, 300, 120], 'durata snapshot invariata');
  });

  await test('interval: uno solo, aggiorna tutti i countdown, ricalcola dall\'ora corrente, nessuna PATCH periodica, fermato a fine timer e uscendo', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    assert.strictEqual(c.activeIntervals().length, 0, 'nessun interval senza timer in corso');
    await c.api.startSessionStepTimer('ps1', 'st1');
    await c.api.startSessionStepTimer('ps1', 'st3');
    assert.strictEqual(c.activeIntervals().length, 1, 'un solo interval per tutti i timer');
    const t1 = startedMs(fake, 'ps1', 'st1');
    const writes = fake.calls.length;
    // tick "in ritardo" (browser sospeso): il valore si ricalcola dall'ora, non dal numero di tick
    c.clock.now = t1 + 100 * 1000; c.tick();
    const upd = c.textUpdates.filter(u => u.item === 'st1').at(-1);
    assert.strictEqual(upd.text, '08:20');
    assert.ok(c.textUpdates.some(u => u.item === 'st3'), 'aggiornati entrambi');
    const rendersPrima = c.counters.renders;
    c.clock.now = t1 + 101 * 1000; c.tick();
    assert.strictEqual(c.counters.renders, rendersPrima, 'nessun render completo per un semplice aggiornamento');
    assert.strictEqual(fake.calls.length, writes, 'nessuna scrittura/lettura DB dal tick');
    c.S.view = 'produzione-guidata'; c.api.render();
    assert.strictEqual(c.activeIntervals().length, 0, 'interval fermato uscendo dalla vista');
    await open(c, 'ps1');
    assert.strictEqual(c.activeIntervals().length, 1, 'riattivato al rientro');
    c.clock.now = t1 + 10000 * 1000; c.tick();
    assert.strictEqual(c.activeIntervals().length, 0, 'fermato quando nessun timer e\' piu\' in corso');
  });

  await test('rientro e reload durante il timer: continua dal tempo corretto (A, B)', async () => {
    const fake = freshDb();
    let c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.startSessionStepTimer('ps1', 'st2');
    const t0 = startedMs(fake, 'ps1', 'st2');
    c.S.view = 'produzione-guidata'; c.api.render();
    c.clock.now = t0 + 60 * 1000;
    await open(c, 'ps1');
    assert.match(c.last.html, /data-item-key="st2"[^>]*>04:00</, 'rientro: 300 - 60');
    c = makeClient(handler, sessions(), { now: t0 + 200 * 1000 }); // reload
    await open(c, 'ps1');
    assert.match(c.last.html, /data-item-key="st2"[^>]*>01:40</, 'reload: non riparte da 05:00');
  });

  await test('scadenza durante l\'assenza (C) -> "Tempo terminato" al rientro, nessun suono postumo, Fatto intatto', async () => {
    const fake = freshDb();
    let c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.startSessionStepTimer('ps1', 'st3');
    const t0 = startedMs(fake, 'ps1', 'st3');
    c = makeClient(handler, sessions(), { now: t0 + 3600 * 1000 });
    await open(c, 'ps1');
    assert.match(c.last.html, /Tempo terminato/);
    assert.strictEqual(c.counters.beeps, 0);
    assert.strictEqual(dbRow(fake, 'ps1', 'st3').checked, false, 'mai Fatto automatico');
    assert.strictEqual(c.activeIntervals().length, 0);
  });

  await test('annulla + reload (D); azzera scaduto + reload (E); riavvio dalla durata prevista', async () => {
    const fake = freshDb();
    let c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.startSessionStepTimer('ps1', 'st1');
    await c.api.cancelSessionStepTimer('ps1', 'st1');
    c = makeClient(handler, sessions());
    await open(c, 'ps1');
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.st1.timerStartedAt, null);
    assert.match(c.last.html, /ms14-timer-start/);
    await c.api.startSessionStepTimer('ps1', 'st2');
    const t2 = startedMs(fake, 'ps1', 'st2');
    c.clock.now = t2 + 400 * 1000; c.api.render();
    assert.match(c.last.html, /ms14-timer-reset/);
    await c.api.cancelSessionStepTimer('ps1', 'st2'); // Azzera
    c = makeClient(handler, sessions(), { now: t2 + 500 * 1000 });
    await open(c, 'ps1');
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.st2.timerStartedAt, null);
    await c.api.startSessionStepTimer('ps1', 'st2');
    const t3 = startedMs(fake, 'ps1', 'st2');
    c.clock.now = t3; c.api.render();
    assert.match(c.last.html, /data-item-key="st2"[^>]*>05:00</, 'riparte dalla durata prevista');
  });

  await test('timer multipli indipendenti: annullare/scadere uno non tocca l\'altro; Fatto non tocca i timer', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.startSessionStepTimer('ps1', 'st1');
    await c.api.startSessionStepTimer('ps1', 'st3');
    const s3 = dbRow(fake, 'ps1', 'st3').timer_started_at;
    await c.api.cancelSessionStepTimer('ps1', 'st1');
    assert.strictEqual(dbRow(fake, 'ps1', 'st3').timer_started_at, s3, 'annullare st1 non tocca st3');
    await c.api.startSessionStepTimer('ps1', 'st1');
    const t3 = Date.parse(s3);
    c.clock.now = t3 + 121 * 1000; c.api.render(); // st3 (120 s) scaduto, st1 (600 s) in corso
    assert.strictEqual(c.api.stepTimerState(s3, 120, c.clock.now), 'expired');
    assert.match(c.last.html, /data-item-key="st1"/, 'st1 ancora in corso');
    await c.api.toggleSessionStep('ps1', 'st1'); // Fatto su st1
    assert.ok(dbRow(fake, 'ps1', 'st1').timer_started_at, 'Fatto non modifica il timer');
    assert.ok(c.S.sessionStepState.ps1.byItemKey.st1.timerStartedAt, 'Fatto non sovrascrive il timer in memoria');
    assert.strictEqual(dbRow(fake, 'ps2', 'st1').timer_started_at, null, 'altra Sessione intatta');
  });

  await test('timer indipendente da Fatto: avvio/azzera su step gia\' Fatto non cambia checked/checked_at', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.toggleSessionStep('ps1', 'st2');
    const ca = dbRow(fake, 'ps1', 'st2').checked_at;
    await c.api.startSessionStepTimer('ps1', 'st2');
    await c.api.cancelSessionStepTimer('ps1', 'st2');
    assert.deepStrictEqual([dbRow(fake, 'ps1', 'st2').checked, dbRow(fake, 'ps1', 'st2').checked_at], [true, ca]);
    assert.deepStrictEqual([c.S.sessionStepState.ps1.byItemKey.st2.checked, c.S.sessionStepState.ps1.byItemKey.st2.checkedAt], [true, ca]);
  });

  await test('riga mancante, durata non valida, Sessione non in corso -> nessun timer, nessuna scrittura', async () => {
    const fake = freshDb();
    let c = makeClient(handler, [makeSession('ps1', 'in_progress', ['st1', 'st2', 'st3', 'stNuovo'], [600, 0, 'x', 300])]);
    await open(c, 'ps1');
    assert.strictEqual((c.last.html.match(/ms14-timer-start/g) || []).length, 1, 'solo st1 ha durata valida e riga presente');
    await c.api.startSessionStepTimer('ps1', 'st2');
    await c.api.startSessionStepTimer('ps1', 'st3');
    await c.api.startSessionStepTimer('ps1', 'stNuovo');
    assert.strictEqual(timerWrites(fake).length, 0);
    assert.strictEqual(fake.tables.session_step_state.length, 4, 'riga mancante mai creata');
    c = makeClient(handler, [makeSession('ps1', 'completed', ['st1'])]);
    await open(c, 'ps1');
    await c.api.startSessionStepTimer('ps1', 'st1');
    assert.strictEqual(timerWrites(fake).length, 0);
    assert.doesNotMatch(c.last.html, /Avvia timer/);
  });

  await test('errore server -> stato precedente, avviso; altri step utilizzabili durante una scrittura', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    fake.fail('session_step_state:PATCH');
    await c.api.startSessionStepTimer('ps1', 'st1');
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.st1.timerStartedAt, null);
    assert.deepStrictEqual(c.toasts, ['Timer non avviato. Riprova.']);
    fake.heal('session_step_state:PATCH');
    const p = c.api.startSessionStepTimer('ps1', 'st1');
    c.api.render();
    assert.match(c.last.html, /ms14-timer-start" disabled/, 'step in scrittura bloccato');
    await Promise.all([p, c.api.startSessionStepTimer('ps1', 'st2')]);
    assert.ok(dbRow(fake, 'ps1', 'st1').timer_started_at && dbRow(fake, 'ps1', 'st2').timer_started_at);
  });

  await test('suono best-effort: solo alla scadenza vista in pagina, una volta; senza AudioContext nessun errore', async () => {
    const fake = freshDb();
    let c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.startSessionStepTimer('ps1', 'st3');
    const t0 = startedMs(fake, 'ps1', 'st3');
    c.clock.now = t0 + 60 * 1000; c.tick();
    assert.strictEqual(c.counters.beeps, 0);
    c.clock.now = t0 + 121 * 1000; c.tick();
    assert.ok(c.counters.beeps > 0, 'suona alla scadenza');
    const b = c.counters.beeps;
    c.api.render(); c.tick();
    assert.strictEqual(c.counters.beeps, b, 'una sola volta');
    assert.match(c.last.html, /Tempo terminato/);
    c = makeClient(handler, sessions(), { noAudio: true });
    await open(c, 'ps1');
    await c.api.startSessionStepTimer('ps1', 'st1');
    c.clock.now = startedMs(fake, 'ps1', 'st1') + 601 * 1000; c.tick();
    assert.match(c.last.html, /Tempo terminato/, 'stato visivo garantito anche senza audio');
  });

  await test('snapshot e Ricette invariati; spunte ingredienti intatte', async () => {
    const fake = freshDb();
    const sess = sessions();
    const c = makeClient(handler, sess);
    const prima = JSON.stringify(sess.map(s => s.snapshot));
    await open(c, 'ps1');
    await c.api.startSessionStepTimer('ps1', 'st1');
    await c.api.cancelSessionStepTimer('ps1', 'st1');
    assert.strictEqual(JSON.stringify(c.S.productionSessions.map(s => s.snapshot)), prima);
    assert.deepStrictEqual(c.S.recipes, []);
    assert.strictEqual(fake.tables.session_ingredient_state[0].checked, false);
    assert.ok(!fake.calls.some(x => x.method !== 'GET' && x.table !== 'session_step_state'));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
