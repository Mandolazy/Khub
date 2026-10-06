/*
 * Test Sprint Produzione — MS15: Note di produzione della Sessione.
 * Nessun framework: Node puro + assert.
 *
 * Codice REALE: api/chat.js (handler) contro un finto PostgREST in memoria
 * (GET con eq/order, INSERT puro con PK -> 409 sui duplicati, created_at
 * assegnato dal "DB") e le funzioni client ESTRATTE da khub_mvp.html,
 * compreso il motore di dettatura condiviso startDictation/stopDictation.
 * Mock ai confini: SpeechRecognition del browser, localStorage, document
 * (la textarea viene ricostruita dall'HTML realmente renderizzato), toast.
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
  const tables = { production_sessions: [], session_notes: [], session_ingredient_state: [], session_step_state: [] };
  const calls = [];
  const fail = new Map(); // 'tabella:METODO' -> 'error' | 'lost' (scrive ma la risposta si perde)
  let dbClock = Date.parse('2026-10-06T08:00:00Z');
  const matches = (row, filters) => filters.every(([col, op, val]) => {
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
    calls.push({ method, table, filters, order, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    const mode = fail.get(table + ':' + method);
    if (mode === 'error') return reply(500, { message: 'boom' });
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
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      if (rows.some(r => r.id === body.id)) return reply(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
      dbClock += 1000;
      const row = { created_at: new Date(dbClock).toISOString(), ...body }; // DEFAULT now() solo se non inviato
      rows.push(row);
      if (mode === 'lost') return reply(502, { message: 'risposta persa' });
      return reply(201, ((opts.headers && opts.headers.Prefer) || '').includes('return=representation') ? [row] : null);
    }
    return reply(500, { message: 'metodo non atteso in MS15: ' + method });
  }
  return { tables, calls, fetch, fail: (k, m) => fail.set(k, m || 'error'), heal: k => fail.delete(k) };
}

async function loadHandler() {
  return (await import('data:text/javascript;base64,' + Buffer.from(chatSrc).toString('base64'))).default;
}

const CLIENT_SRC = [
  'function escAttr(s)', 'function uid()', 'function formatFinishedTotalLabel(grams)', 'function apriSessioneOperativa(sessionId)',
  'async function loadSessionIngredientState(sessionId)', 'function renderSessioneOperativa()',
  'async function loadSessionStepState(sessionId)', 'function formatStepDurationLabel(seconds)',
  'function stepTimerDurationSeconds(value)', 'function stepTimerRemainingSeconds(startedAtIso,durationSeconds,nowMs)',
  'function stepTimerState(startedAtIso,durationSeconds,nowMs)', 'function formatTimerCountdown(seconds)',
  // Motore di dettatura condiviso (reale, invariato per gli altri target)
  'function startDictation(opts)', 'function stopDictation()',
  // MS15
  'function sessionNoteDraftKey(sessionId)', 'function readSessionNoteDraft(sessionId)', 'function writeSessionNoteDraft(sessionId,draft)',
  'function setSessionNoteDraftText(sessionId,text)', 'function restoreSessionNoteDraft(sessionId)', 'function onSessionNoteInput(sessionId,value)',
  'function sessionNoteDictationBusy(sessionId)', 'function formatSessionNoteTime(iso)', 'function sortSessionNotes(notes)',
  'async function loadSessionNotes(sessionId)', 'async function addSessionNote(sessionId)', 'function sessionNoteDictationErrorMessage(code)',
  'function toggleSessionNoteDictation(sessionId)', 'function stopSessionNoteDictationIfLeft()', 'function renderSessionNotesSection(sess)',
  // MS16: la Sessione operativa mostra badge di stato, data produzione e blocco "Fine produzione"
  'function renderSessionStatusBadge(status)', 'function formatSessionDate(iso)', 'function formatSessionDateTime(iso)', 'function formatSessionTime(iso)',
  'function sessionDurationSeconds(startedIso,completedIso)', 'function formatSessionDuration(seconds)', 'function normalizeActualYieldGrams(qty,unit)',
  'function parseActualYieldInput(text,unit)', 'function formatYieldGrams(grams)', 'function sessionCompletionState(sessionId)',
  'function renderSessionCompletionSection(sess)',
].map(extractFunction).concat([html.match(/var SESSION_NOTE_MAX_LENGTH=\d+;/)[0]]).join('\n');

function makeSession(id, status) {
  return {
    id, recipeId: 'r1', sourceVariantId: 'vv1', status, snapshotVersion: 1, targetFinishedTotal: 2000,
    createdAt: '2026-10-01T08:00:00Z', startedAt: '2026-10-01T09:00:00Z', completedAt: null,
    snapshot: {
      snapshotVersion: 1, recipe: { recipeName: 'Risotto', variantName: 'Porcini' },
      target: { targetPortions: 10, targetGramsPerPortion: 200, targetFinishedTotal: 2000, baseExpectedFinishedTotal: 1000, scaleFactor: 2, normalizationUnit: 'g' },
      ingredients: [{ itemKey: 'vi1', sourceIngredientId: 'vi1', name: 'Porcini', unit: 'kg', baseQty: 1, operativeQty: 1.25 }],
      steps: [{ stepId: 'st1', order: 0, text: 'Tostare il riso', expectedDurationSeconds: 120 }],
      media: { mediaUrl: null, videoUrl: null },
    },
  };
}

function makeStorage() {
  const m = new Map();
  return { map: m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

// Finta Web Speech API: il test pilota risultati, errori e fine.
function makeSpeech() {
  const instances = [];
  class FakeSpeechRecognition {
    constructor() { this.started = false; this.stopped = false; instances.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; }
    say(text) { this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] }); }
    fail(code) { this.onerror({ error: code }); }
    end() { this.onend(); }
  }
  return { FakeSpeechRecognition, instances, last: () => instances[instances.length - 1] };
}

const unescapeHtml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function makeClient(handler, sessions, opts = {}) {
  const apiCalls = [], toasts = [];
  const clientFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    apiCalls.push(body);
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { ok: status < 400, status, json: async () => out };
  };
  const storage = opts.storage || makeStorage();
  const speech = makeSpeech();
  const win = opts.noSpeech ? {} : { webkitSpeechRecognition: speech.FakeSpeechRecognition };
  const last = { html: '' };
  const els = {};
  const doc = { getElementById: id => els[id] || null };
  // Dopo ogni render la textarea/anteprima "DOM" riflettono l'HTML realmente renderizzato.
  const syncDom = () => {
    for (const k of Object.keys(els)) delete els[k];
    const m = last.html.match(/<textarea id="session-note-input"[^>]*>([\s\S]*?)<\/textarea>/);
    if (m) els['session-note-input'] = { value: unescapeHtml(m[1]) };
    if (last.html.includes('id="session-note-voice-preview"')) els['session-note-voice-preview'] = { textContent: '' };
  };
  const S = { view: 'app-home', openSessionId: null, productionSessions: sessions, sessionIngredientState: {}, sessionStepState: {},
    sessionNotes: {}, sessionNoteDraft: {}, sessionNoteDictationSessionId: null, recording: false, recordingTarget: null, recipes: [] };
  const api = new Function('S', 'fetch', 'toast', 'console', 'document', 'window', 'localStorage', '__last', '__syncDom', `
    function ms14Now(){ return Date.now(); }
    function render(){ stopSessionNoteDictationIfLeft(); __last.html = S.view==='sessione-operativa' ? renderSessioneOperativa() : ''; __syncDom(); }
    ${CLIENT_SRC}
    return { apriSessioneOperativa, render, addSessionNote, onSessionNoteInput, toggleSessionNoteDictation, loadSessionNotes, formatSessionNoteTime };`)(
    S, clientFetch, (m) => toasts.push(m), { error() {} }, doc, win, storage, last, syncDom);
  const type = (sid, value) => { if (els['session-note-input']) els['session-note-input'].value = value; api.onSessionNoteInput(sid, value); };
  return { S, api, apiCalls, toasts, storage, speech, last, els, type };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const flush = () => new Promise(r => setTimeout(r, 0));
  const call = async (body) => { let out; await handler({ method: 'POST', body }, { status() { return this; }, json(o) { out = o; return this; } }); return out; };

  function freshDb(statuses) {
    const fake = makeFakeSupabase();
    fake.tables.production_sessions = Object.entries(statuses || { ps1: 'in_progress', ps2: 'in_progress' }).map(([id, status]) => ({ id, status }));
    globalThis.fetch = fake.fetch;
    return fake;
  }
  const sessions = (st) => Object.entries(st || { ps1: 'in_progress', ps2: 'in_progress' }).map(([id, status]) => makeSession(id, status));
  async function open(c, sid) { c.S.view = 'sessione-operativa'; c.api.apriSessioneOperativa(sid); for (let i = 0; i < 4; i++) await flush(); }
  const noteWrites = (fake) => fake.calls.filter(x => x.table === 'session_notes' && x.method !== 'GET');
  const textarea = (c) => { const m = c.last.html.match(/<textarea id="session-note-input"[^>]*>([\s\S]*?)<\/textarea>/); return m ? unescapeHtml(m[1]) : null; };
  const KEY = (sid) => 'khub.productionSessionNoteDraft.' + sid;
  const renderedNotes = (c) => [...c.last.html.matchAll(/data-note-id="([^"]*)"/g)].map(m => m[1]);

  console.log('MS15 — Note di produzione');

  await test('1. load: solo le note della Sessione aperta (filtro session_id), nessuna scrittura', async () => {
    const fake = freshDb();
    fake.tables.session_notes = [
      { id: 'n1', session_id: 'ps1', text: 'A1', created_at: '2026-10-06T09:00:00.000Z' },
      { id: 'n2', session_id: 'ps2', text: 'B1', created_at: '2026-10-06T09:05:00.000Z' },
    ];
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const get = fake.calls.find(x => x.table === 'session_notes' && x.method === 'GET');
    assert.deepStrictEqual(get.filters, [['session_id', 'eq', 'ps1']]);
    assert.deepStrictEqual(c.S.sessionNotes.ps1.notes.map(n => n.id), ['n1']);
    assert.strictEqual(c.S.sessionNotes.ps1.status, 'loaded');
    assert.deepStrictEqual(renderedNotes(c), ['n1']);
    assert.strictEqual(noteWrites(fake).length, 0);
    assert.deepStrictEqual(await call({ supabaseAction: 'loadSessionNotes' }), { error: 'loadSessionNotes: sessionId mancante' });
  });

  await test('2. ordinamento newest-first (created_at DESC, id DESC a parita\')', async () => {
    const fake = freshDb();
    fake.tables.session_notes = [
      { id: 'a', session_id: 'ps1', text: 'vecchia', created_at: '2026-10-06T08:00:00.000Z' },
      { id: 'c', session_id: 'ps1', text: 'recente', created_at: '2026-10-06T10:00:00.000Z' },
      { id: 'b', session_id: 'ps1', text: 'media-b', created_at: '2026-10-06T09:00:00.000Z' },
      { id: 'd', session_id: 'ps1', text: 'media-d', created_at: '2026-10-06T09:00:00.000Z' },
    ];
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const get = fake.calls.find(x => x.table === 'session_notes' && x.method === 'GET');
    assert.deepStrictEqual(get.order, [['created_at', 'desc'], ['id', 'desc']]);
    assert.deepStrictEqual(c.S.sessionNotes.ps1.notes.map(n => n.id), ['c', 'd', 'b', 'a']);
    assert.deepStrictEqual(renderedNotes(c), ['c', 'd', 'b', 'a']);
  });

  await test('3. "Aggiungi nota": un solo INSERT puro su session_notes (id, session_id, text trim), senza resolution', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', '  Brodo aggiunto in due volte  ');
    await c.api.addSessionNote('ps1');
    const w = noteWrites(fake);
    assert.strictEqual(w.length, 1);
    assert.strictEqual(w[0].method, 'POST');
    assert.deepStrictEqual(Object.keys(w[0].body).sort(), ['id', 'session_id', 'text']);
    assert.strictEqual(w[0].body.text, 'Brodo aggiunto in due volte');
    assert.strictEqual(w[0].body.session_id, 'ps1');
    assert.ok(!/resolution/.test(w[0].headers.Prefer || ''), 'nessun upsert');
    assert.strictEqual(fake.tables.session_notes.length, 1);
    assert.deepStrictEqual(renderedNotes(c), [w[0].body.id]);
    assert.ok(c.last.html.includes('Brodo aggiunto in due volte'));
  });

  await test('4. timestamp dal DB: il client non invia created_at; il server lo scarta anche se fornito', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'Nota');
    await c.api.addSessionNote('ps1');
    const add = c.apiCalls.find(x => x.supabaseAction === 'addSessionNote');
    assert.ok(!('created_at' in add.note));
    const row = fake.tables.session_notes[0];
    assert.ok(row.created_at, 'assegnato dal DB');
    assert.strictEqual(c.S.sessionNotes.ps1.notes[0].createdAt, row.created_at, 'il client usa il valore del DB');
    const out = await call({ supabaseAction: 'addSessionNote', note: { id: 'nx', session_id: 'ps1', text: 'x', created_at: '1999-01-01T00:00:00Z' } });
    assert.strictEqual(out.ok, true);
    const w = noteWrites(fake).pop();
    assert.ok(!('created_at' in w.body));
    assert.notStrictEqual(fake.tables.session_notes.find(r => r.id === 'nx').created_at, '1999-01-01T00:00:00Z');
    const hhmm = c.api.formatSessionNoteTime(row.created_at);
    assert.match(hhmm, /^\d{2}:\d{2}$/);
    assert.ok(c.last.html.includes(hhmm), 'ora locale HH:MM mostrata');
  });

  await test('5. piu\' note nella stessa Sessione: righe distinte, la piu\' recente prima', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    for (const t of ['prima', 'seconda', 'terza']) { c.type('ps1', t); await c.api.addSessionNote('ps1'); }
    assert.strictEqual(fake.tables.session_notes.length, 3);
    assert.strictEqual(new Set(fake.tables.session_notes.map(r => r.id)).size, 3);
    assert.deepStrictEqual(c.S.sessionNotes.ps1.notes.map(n => n.text), ['terza', 'seconda', 'prima']);
    await open(c, 'ps1'); // rilettura dal DB
    assert.deepStrictEqual(c.S.sessionNotes.ps1.notes.map(n => n.text), ['terza', 'seconda', 'prima']);
  });

  await test('6. append-only: una nuova nota non tocca le righe esistenti', async () => {
    const fake = freshDb();
    fake.tables.session_notes = [{ id: 'old', session_id: 'ps1', text: 'esistente', created_at: '2026-10-06T07:00:00.000Z' }];
    const prima = JSON.stringify(fake.tables.session_notes[0]);
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'nuova');
    await c.api.addSessionNote('ps1');
    assert.strictEqual(JSON.stringify(fake.tables.session_notes[0]), prima);
    assert.strictEqual(fake.tables.session_notes.length, 2);
  });

  await test('7-8. nessun UPDATE / DELETE / upsert / azione generica in tutto il flusso', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'uno'); await c.api.addSessionNote('ps1');
    fake.fail('session_notes:POST', 'lost'); c.type('ps1', 'due'); await c.api.addSessionNote('ps1');
    fake.heal('session_notes:POST'); await c.api.addSessionNote('ps1');
    const methods = new Set(fake.calls.filter(x => x.table === 'session_notes').map(x => x.method));
    assert.deepStrictEqual([...methods].sort(), ['GET', 'POST']);
    assert.ok(!fake.calls.some(x => x.method === 'PATCH' || x.method === 'DELETE'));
    assert.ok(!fake.calls.some(x => /resolution/.test((x.headers && x.headers.Prefer) || '')));
    assert.ok(!c.apiCalls.some(x => x.supabaseAction === 'update' || x.supabaseAction === 'delete'));
  });

  await test('9. nota vuota / soli spazi: nessun salvataggio (client e server)', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', '   \n  ');
    assert.ok(/id="session-note-add" disabled/.test(c.last.html.replace(/\s+/g, ' ')) || (c.api.render(), /id="session-note-add" disabled/.test(c.last.html)));
    await c.api.addSessionNote('ps1');
    assert.ok(!c.apiCalls.some(x => x.supabaseAction === 'addSessionNote'));
    assert.ok(c.toasts.length > 0);
    const out = await call({ supabaseAction: 'addSessionNote', note: { id: 'n', session_id: 'ps1', text: '  \t ' } });
    assert.strictEqual(out.code, 'empty');
    assert.strictEqual(noteWrites(fake).length, 0);
  });

  await test('10. oltre 2000 caratteri: bloccato (client e server), bozza intatta; 2000 esatti ammessi', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const lungo = 'x'.repeat(2001);
    c.type('ps1', lungo);
    await c.api.addSessionNote('ps1');
    assert.ok(!c.apiCalls.some(x => x.supabaseAction === 'addSessionNote'));
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, lungo);
    c.api.render();
    assert.ok(c.last.html.includes('2001/2000'));
    assert.strictEqual((await call({ supabaseAction: 'addSessionNote', note: { id: 'n', session_id: 'ps1', text: lungo } })).code, 'too_long');
    assert.strictEqual(noteWrites(fake).length, 0);
    assert.strictEqual((await call({ supabaseAction: 'addSessionNote', note: { id: 'n2000', session_id: 'ps1', text: 'y'.repeat(2000) } })).ok, true);
    assert.ok(c.last.html.includes('maxlength="2000"'));
  });

  await test('11. server: add rifiutato se la Sessione non e\' in_progress (pending, completed, inesistente)', async () => {
    const fake = freshDb({ ps1: 'pending', ps2: 'completed' });
    assert.strictEqual((await call({ supabaseAction: 'addSessionNote', note: { id: 'a', session_id: 'ps1', text: 'x' } })).code, 'not_in_progress');
    assert.strictEqual((await call({ supabaseAction: 'addSessionNote', note: { id: 'b', session_id: 'ps2', text: 'x' } })).code, 'not_in_progress');
    assert.strictEqual((await call({ supabaseAction: 'addSessionNote', note: { id: 'c', session_id: 'nope', text: 'x' } })).code, 'not_found');
    assert.strictEqual((await call({ supabaseAction: 'addSessionNote', note: { session_id: 'ps1', text: 'x' } })).code, 'invalid');
    assert.strictEqual(noteWrites(fake).length, 0);
    // UI che crede la Sessione in corso ma il DB no: decide il server, bozza conservata
    const c = makeClient(handler, sessions({ ps1: 'in_progress' }));
    await open(c, 'ps1');
    c.type('ps1', 'nota tardiva');
    await c.api.addSessionNote('ps1');
    assert.strictEqual(noteWrites(fake).length, 0);
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'nota tardiva');
    assert.ok(/non e' piu' in corso/.test(c.toasts.pop()));
  });

  await test('12. add consentito con Sessione in_progress', async () => {
    const fake = freshDb();
    const out = await call({ supabaseAction: 'addSessionNote', note: { id: 'ok1', session_id: 'ps1', text: 'Va bene' } });
    assert.strictEqual(out.ok, true);
    assert.deepStrictEqual([out.row.id, out.row.session_id, out.row.text], ['ok1', 'ps1', 'Va bene']);
    assert.ok(out.row.created_at);
    assert.strictEqual(fake.tables.session_notes.length, 1);
  });

  await test('13. completed: note leggibili, nessun input, nessuna scrittura possibile', async () => {
    const fake = freshDb({ ps1: 'completed' });
    fake.tables.session_notes = [{ id: 'n1', session_id: 'ps1', text: 'Nota storica', created_at: '2026-10-06T09:00:00.000Z' }];
    const c = makeClient(handler, sessions({ ps1: 'completed' }));
    await open(c, 'ps1');
    assert.deepStrictEqual(renderedNotes(c), ['n1']);
    assert.ok(c.last.html.includes('Nota storica'));
    assert.ok(c.last.html.includes('sola lettura'));
    assert.strictEqual(textarea(c), null);
    assert.ok(!c.last.html.includes('session-note-add'));
    c.S.sessionNoteDraft.ps1 = { text: 'forzata', pendingId: null, pendingText: null };
    await c.api.addSessionNote('ps1');
    c.api.toggleSessionNoteDictation('ps1');
    assert.strictEqual(c.speech.instances.length, 0);
    assert.ok(!c.apiCalls.some(x => x.supabaseAction === 'addSessionNote'));
    assert.strictEqual(noteWrites(fake).length, 0);
  });

  await test('14. pending: nessun input, nessuna scrittura', async () => {
    const fake = freshDb({ ps1: 'pending' });
    const c = makeClient(handler, sessions({ ps1: 'pending' }));
    await open(c, 'ps1');
    assert.strictEqual(textarea(c), null);
    assert.ok(c.last.html.includes('Nessuna nota'));
    c.S.sessionNoteDraft.ps1 = { text: 'forzata', pendingId: null, pendingText: null };
    await c.api.addSessionNote('ps1');
    assert.ok(!c.apiCalls.some(x => x.supabaseAction === 'addSessionNote'));
    assert.strictEqual(noteWrites(fake).length, 0);
  });

  await test('15. doppio click: una sola richiesta, pulsante e textarea bloccati durante il salvataggio', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'una volta sola');
    const p1 = c.api.addSessionNote('ps1');
    assert.ok(/id="session-note-add" disabled/.test(c.last.html), 'pulsante disabilitato in attesa');
    assert.ok(/id="session-note-input"[^>]*readonly/.test(c.last.html), 'textarea in sola lettura in attesa');
    const p2 = c.api.addSessionNote('ps1');
    await Promise.all([p1, p2]);
    assert.strictEqual(c.apiCalls.filter(x => x.supabaseAction === 'addSessionNote').length, 1);
    assert.strictEqual(fake.tables.session_notes.length, 1);
  });

  await test('16. retry idempotente: risposta persa -> stesso id, nessun duplicato, nessuna modifica', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'Mantecato a fuoco spento');
    fake.fail('session_notes:POST', 'lost'); // la riga arriva al DB ma la risposta si perde
    await c.api.addSessionNote('ps1');
    assert.strictEqual(fake.tables.session_notes.length, 1);
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'Mantecato a fuoco spento', 'bozza conservata');
    const salvata = JSON.stringify(fake.tables.session_notes[0]);
    fake.heal('session_notes:POST');
    await c.api.addSessionNote('ps1');
    const posts = noteWrites(fake);
    assert.strictEqual(posts.length, 2);
    assert.strictEqual(posts[0].body.id, posts[1].body.id, 'stesso id nel retry');
    assert.strictEqual(fake.tables.session_notes.length, 1, 'nessun duplicato');
    assert.strictEqual(JSON.stringify(fake.tables.session_notes[0]), salvata, 'riga non modificata');
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, '');
    assert.deepStrictEqual(renderedNotes(c), [posts[0].body.id]);
    // un id gia' usato con un testo diverso non sovrascrive nulla
    const out = await call({ supabaseAction: 'addSessionNote', note: { id: posts[0].body.id, session_id: 'ps1', text: 'altro' } });
    assert.strictEqual(out.code, 'conflict');
    assert.strictEqual(JSON.stringify(fake.tables.session_notes[0]), salvata);
    // testo cambiato dopo un errore -> nuovo id
    c.type('ps1', 'A'); fake.fail('session_notes:POST'); await c.api.addSessionNote('ps1');
    const idA = c.S.sessionNoteDraft.ps1.pendingId;
    c.type('ps1', 'B'); fake.heal('session_notes:POST'); await c.api.addSessionNote('ps1');
    assert.notStrictEqual(noteWrites(fake).pop().body.id, idA);
  });

  await test('17. salvataggio fallito: bozza intatta (runtime + localStorage), messaggio, nuovo tentativo possibile', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'Non perdermi');
    fake.fail('session_notes:POST');
    await c.api.addSessionNote('ps1');
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'Non perdermi');
    assert.strictEqual(JSON.parse(c.storage.getItem(KEY('ps1'))).text, 'Non perdermi');
    assert.strictEqual(textarea(c), 'Non perdermi');
    assert.ok(/Nota non salvata/.test(c.toasts.pop()));
    assert.strictEqual(c.S.sessionNotes.ps1.saving, false);
    assert.ok(!/id="session-note-add" disabled/.test(c.last.html));
    assert.strictEqual(fake.tables.session_notes.length, 0);
    fake.fail('production_sessions:GET'); // anche un errore prima dell'INSERT
    await c.api.addSessionNote('ps1');
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'Non perdermi');
  });

  await test('18. bozza runtime: digitazione senza render, ripristinata a ogni render', async () => {
    freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const before = c.last.html;
    c.type('ps1', 'Sale <q.b.> & "pepe"');
    assert.strictEqual(c.last.html, before, 'nessun render a ogni tasto');
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'Sale <q.b.> & "pepe"');
    c.api.render();
    assert.strictEqual(textarea(c), 'Sale <q.b.> & "pepe"', 'ripristinata ed escapata');
  });

  await test('19. bozza in localStorage con namespace per Sessione; vuota -> chiave rimossa', async () => {
    freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'bozza');
    assert.strictEqual(JSON.parse(c.storage.getItem(KEY('ps1'))).text, 'bozza');
    assert.ok(KEY('ps1').includes('productionSessionNoteDraft'));
    c.type('ps1', '');
    assert.strictEqual(c.storage.getItem(KEY('ps1')), null);
  });

  await test('20. reload e uscita/rientro: bozza ripristinata, note dal DB', async () => {
    const fake = freshDb();
    fake.tables.session_notes = [{ id: 'n1', session_id: 'ps1', text: 'salvata', created_at: '2026-10-06T09:00:00.000Z' }];
    const storage = makeStorage();
    const c = makeClient(handler, sessions(), { storage });
    await open(c, 'ps1');
    c.type('ps1', 'scritta prima del reload');
    c.S.view = 'produzione-guidata'; c.api.render();
    await open(c, 'ps1');
    assert.strictEqual(textarea(c), 'scritta prima del reload', 'rientro');
    const c2 = makeClient(handler, sessions(), { storage }); // reload: stato runtime perso
    await open(c2, 'ps1');
    assert.strictEqual(textarea(c2), 'scritta prima del reload', 'reload');
    assert.deepStrictEqual(renderedNotes(c2), ['n1']);
    // localStorage non disponibile/corrotto: nessun crash
    const broken = makeStorage(); broken.setItem(KEY('ps1'), '{non json');
    const c3 = makeClient(handler, sessions(), { storage: broken });
    await open(c3, 'ps1');
    assert.strictEqual(textarea(c3), '');
  });

  await test('21. salvataggio riuscito: bozza cancellata da runtime e localStorage', async () => {
    freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'da salvare');
    await c.api.addSessionNote('ps1');
    assert.deepStrictEqual(c.S.sessionNoteDraft.ps1, { text: '', pendingId: null, pendingText: null });
    assert.strictEqual(c.storage.getItem(KEY('ps1')), null);
    assert.strictEqual(textarea(c), '');
    assert.ok(/Nota aggiunta/.test(c.toasts.pop()));
  });

  await test('22-23. dettatura: il testo finisce nella STESSA textarea, modificabile, nessun salvataggio automatico', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.api.toggleSessionNoteDictation('ps1');
    const rec = c.speech.last();
    assert.ok(rec.started);
    assert.ok(!rec.stopped, 'la dettatura resta attiva dopo il render di avvio');
    assert.strictEqual(rec.lang, 'it-IT');
    assert.strictEqual(c.S.recordingTarget, 'session-note');
    assert.ok(c.last.html.includes('id="session-note-voice-preview"'));
    assert.ok(c.last.html.includes('La dettatura utilizza il servizio vocale del browser. KHUB conserva solo il testo della nota.'));
    assert.ok(/id="session-note-add" disabled/.test(c.last.html), 'niente salvataggio durante la dettatura');
    rec.say('aggiunto mezzo litro di brodo');
    c.api.toggleSessionNoteDictation('ps1'); // Stop
    assert.ok(rec.stopped);
    rec.end();
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'aggiunto mezzo litro di brodo');
    assert.strictEqual(JSON.parse(c.storage.getItem(KEY('ps1'))).text, 'aggiunto mezzo litro di brodo');
    assert.strictEqual(textarea(c), 'aggiunto mezzo litro di brodo');
    assert.strictEqual((c.last.html.match(/<textarea/g) || []).length, 1, 'un solo input');
    assert.ok(!c.apiCalls.some(x => x.supabaseAction === 'addSessionNote'), 'nessun autosave');
    assert.strictEqual(noteWrites(fake).length, 0);
    c.type('ps1', 'aggiunto mezzo litro di brodo caldo'); // correzione manuale
    await c.api.addSessionNote('ps1');
    assert.strictEqual(fake.tables.session_notes[0].text, 'aggiunto mezzo litro di brodo caldo');
    assert.deepStrictEqual(Object.keys(noteWrites(fake)[0].body).sort(), ['id', 'session_id', 'text'], 'solo testo, nessuna sorgente/audio');
  });

  await test('24. dettatura AGGIUNGE al testo gia\' scritto (anche non ancora sincronizzato), mai sostituisce', async () => {
    freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'Riso tostato');
    c.els['session-note-input'].value = 'Riso tostato 3 minuti  '; // scritto ma senza evento input
    c.api.toggleSessionNoteDictation('ps1');
    c.speech.last().say('poco brodo');
    c.api.toggleSessionNoteDictation('ps1');
    c.speech.last().end();
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'Riso tostato 3 minuti poco brodo');
  });

  await test('25. SpeechRecognition assente: microfono disabilitato con spiegazione, scrittura e salvataggio funzionano', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions(), { noSpeech: true });
    await open(c, 'ps1');
    assert.ok(c.last.html.includes('Dettatura non disponibile'));
    assert.ok(/id="session-note-mic" disabled/.test(c.last.html));
    c.api.toggleSessionNoteDictation('ps1');
    assert.ok(/non supportata/.test(c.toasts.pop()));
    assert.strictEqual(c.S.recording, false);
    c.type('ps1', 'scritta a mano');
    await c.api.addSessionNote('ps1');
    assert.strictEqual(fake.tables.session_notes.length, 1);
  });

  await test('26. isolamento Sessioni: note e bozze di A non contaminano B; dettatura fermata uscendo, testo in A', async () => {
    const fake = freshDb();
    fake.tables.session_notes = [{ id: 'nb', session_id: 'ps2', text: 'nota di B', created_at: '2026-10-06T09:00:00.000Z' }];
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'bozza di A');
    c.api.toggleSessionNoteDictation('ps1');
    const rec = c.speech.last();
    rec.say('dettato in A');
    await open(c, 'ps2'); // cambio Sessione durante la dettatura
    assert.ok(rec.stopped, 'dettatura fermata');
    assert.strictEqual(c.S.recording, false);
    rec.end();
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'bozza di A dettato in A');
    assert.strictEqual(c.S.sessionNoteDraft.ps2.text, '');
    assert.strictEqual(textarea(c), '');
    assert.deepStrictEqual(renderedNotes(c), ['nb']);
    assert.deepStrictEqual(c.S.sessionNotes.ps1.notes, []);
    assert.strictEqual(c.storage.getItem(KEY('ps2')), null);
    c.type('ps2', 'nota per B');
    await c.api.addSessionNote('ps2');
    assert.deepStrictEqual(fake.tables.session_notes.filter(r => r.session_id === 'ps1'), []);
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'bozza di A dettato in A', 'bozza di A intatta');
  });

  await test('extra: uscita dalla vista durante la dettatura la ferma; il testo resta nella bozza', async () => {
    freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.api.toggleSessionNoteDictation('ps1');
    const rec = c.speech.last();
    rec.say('ultima cosa');
    c.S.view = 'produzione-guidata'; c.api.render();
    assert.ok(rec.stopped);
    rec.end();
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'ultima cosa');
    assert.strictEqual(c.S.recordingTarget, null);
  });

  await test('extra: trascrizione vuota -> nessun inserimento, messaggio; permesso negato -> messaggio comprensibile', async () => {
    freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.type('ps1', 'invariata');
    c.api.toggleSessionNoteDictation('ps1');
    c.api.toggleSessionNoteDictation('ps1');
    c.speech.last().end();
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'invariata');
    assert.ok(/Nessun testo riconosciuto/.test(c.toasts.pop()));
    c.api.toggleSessionNoteDictation('ps1');
    const rec = c.speech.last();
    rec.fail('not-allowed');
    assert.ok(/Permesso del microfono negato/.test(c.toasts[c.toasts.length - 1]));
    rec.end();
    assert.strictEqual(c.S.sessionNoteDraft.ps1.text, 'invariata');
    assert.strictEqual(c.S.recording, false);
  });

  await test('extra: un solo microfono — dettatura nota bloccata se un altro target sta registrando', async () => {
    freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    c.S.recording = true; c.S.recordingTarget = 'm2';
    c.api.toggleSessionNoteDictation('ps1');
    assert.strictEqual(c.speech.instances.length, 0);
    assert.ok(/già un microfono attivo/.test(c.toasts.pop()));
  });

  await test('extra: errore di caricamento note -> stato error + Riprova; Riprova ricarica', async () => {
    const fake = freshDb();
    fake.tables.session_notes = [{ id: 'n1', session_id: 'ps1', text: 'ok', created_at: '2026-10-06T09:00:00.000Z' }];
    fake.fail('session_notes:GET');
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    assert.strictEqual(c.S.sessionNotes.ps1.status, 'error');
    assert.ok(c.last.html.includes('Non riesco a caricare le note.'));
    assert.ok(c.last.html.includes("loadSessionNotes('ps1')"));
    assert.ok(textarea(c) !== null, 'si puo\' comunque scrivere');
    fake.heal('session_notes:GET');
    await c.api.loadSessionNotes('ps1');
    assert.deepStrictEqual(renderedNotes(c), ['n1']);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
