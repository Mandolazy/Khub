/*
 * Test Sprint Produzione — MS17b: Storico Produzioni, UI + navigazione.
 * Nessun framework: Node puro + assert.
 *
 * Codice REALE: api/chat.js (handler) contro un finto PostgREST in memoria e
 * le funzioni client ESTRATTE da khub_mvp.html: vista Storico, motore MS17a,
 * Produzione Guidata e Sessione operativa (MS12-MS16). Mock ai confini:
 * orologio dello Storico (historyNow), document, toast, localStorage.
 * Fuso Europe/Rome: il periodo usa il giorno LOCALE di completed_at.
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

const CLIENT_SRC = [
  'function escAttr(s)', 'function uid()', 'function formatFinishedTotalLabel(grams)', 'function activeVariants(recipe)', 'function renderAttive()',
  'async function loadProductionSessions()', 'function goToProduzioneGuidata()', 'function setProduzioneGuidataTab(tab)',
  'function renderPendingSessionCard(sess)', 'function renderInProgressSessionCard(sess)', 'function renderProduzioneGuidata()',
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
  'function requestCompleteSession(sessionId)', 'function renderSessionCompletionSection(sess)', 'function renderCompletedSessionCard(sess)',
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
  'function renderHistorySummary(agg)', 'function renderHistoryCard(r)', 'function renderStoricoProduzioni()',
].map(extractFunction).concat([html.match(/var SESSION_NOTE_MAX_LENGTH=\d+;/)[0]]).join('\n');

// "Adesso" per lo Storico: 7 ottobre 2026, 12:00 a Roma.
const NOW = new Date('2026-10-07T10:00:00.000Z');
let seq = 0;
function dbSession(o = {}) {
  seq++;
  return {
    id: o.id || ('ps' + String(seq).padStart(3, '0')), recipe_id: o.recipeId || 'r-tir', source_variant_id: o.variantId || 'v-tir-1',
    status: o.status || 'completed', snapshot_version: 1,
    snapshot: {
      snapshotVersion: 1, recipe: { recipeId: o.recipeId || 'r-tir', recipeName: o.recipeName || 'Tiramisù', variantId: o.variantId || 'v-tir-1', variantName: o.variantName || 'Ricetta Classica' },
      target: { targetPortions: 10, targetGramsPerPortion: 500, targetFinishedTotal: o.target || 5000, baseExpectedFinishedTotal: 2500, scaleFactor: 2, normalizationUnit: 'g' },
      ingredients: [{ itemKey: 'vi1', sourceIngredientId: 'vi1', name: 'Mascarpone', unit: 'g', baseQty: 500, operativeQty: 1000 }],
      steps: [{ stepId: 'st1', order: 0, text: 'Montare', expectedDurationSeconds: 600 }], media: { mediaUrl: null, videoUrl: null },
    },
    target_finished_total: o.target || 5000, created_at: '2026-10-01T06:00:00.000Z',
    started_at: 'startedAt' in o ? o.startedAt : '2026-10-07T07:58:00.000Z',
    completed_at: 'completedAt' in o ? o.completedAt : (o.status && o.status !== 'completed' ? null : '2026-10-07T09:42:00.000Z'),
    actual_yield_qty: o.actual != null ? o.actual : null, actual_yield_unit: o.actual != null ? 'g' : null,
  };
}

function makeClient(handler) {
  const apiCalls = [];
  const clientFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    apiCalls.push(body);
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { ok: status < 400, status, json: async () => out };
  };
  const last = { html: '' };
  const doc = { getElementById: () => null, querySelectorAll: () => [] };
  const S = { view: 'attive', openSessionId: null, productionSessions: [], produzioneGuidataTab: 'pending', startingSessionId: null,
    sessionIngredientState: {}, sessionStepState: {}, sessionNotes: {}, sessionNoteDraft: {}, sessionNoteDictationSessionId: null,
    sessionCompletion: {}, recording: false, recordingTarget: null, recipes: [], recipeStaffCondivisi: {},
    historyFilters: { query: '', preset: 'all', from: '', to: '' }, sessionReturnView: null, productionSessionsLoad: 'idle' };
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const api = new Function('S', 'fetch', 'toast', 'console', 'document', 'window', 'localStorage', 'setInterval', 'clearInterval', '__last', '__now', `
    var _stepTimerInterval=null; var _stepTimerSeenRunning={};
    function ms14Now(){ return Date.now(); }
    function historyNow(){ return new Date(__now.t); }
    function render(){
      __last.html = S.view==='sessione-operativa' ? renderSessioneOperativa()
        : S.view==='produzione-guidata' ? renderProduzioneGuidata()
        : S.view==='storico-produzioni' ? renderStoricoProduzioni()
        : S.view==='attive' ? renderAttive() : '';
      syncStepTimerTicker();
    }
    ${CLIENT_SRC}
    return { render, goToStoricoProduzioni, goToProduzioneGuidata, setProduzioneGuidataTab, apriSessioneOperativa, openHistorySession,
      tornaAlloStoricoProduzioni, onHistoryQueryInput, setHistoryPreset, onHistoryDateInput, resetHistoryFilters, loadProductionSessions,
      toggleSessionIngredient, requestCompleteSession };`)(
    S, clientFetch, () => {}, { error() {} }, doc, {}, storage, () => 1, () => {}, last, { t: NOW.getTime() });
  return { S, api, apiCalls, last };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
  function freshDb(rows) {
    const fake = makeFakeSupabase();
    fake.tables.production_sessions = rows;
    globalThis.fetch = fake.fetch;
    return fake;
  }
  async function openStorico(c) { c.api.goToStoricoProduzioni(); await flush(); }
  const cardIds = (c) => [...c.last.html.matchAll(/class="pg-card ms17-history-card" data-session-id="([^"]*)"/g)].map(m => m[1]);
  // Dataset di riferimento (ora = 07/10/2026 12:00 Roma)
  const dataset = () => [
    dbSession({ id: 'pend', status: 'pending', startedAt: null }),
    dbSession({ id: 'prog', status: 'in_progress' }),
    dbSession({ id: 'today', completedAt: '2026-10-07T09:42:00.000Z', actual: 4720 }), // 07/10 11:42
    dbSession({ id: 'd03', completedAt: '2026-10-03T10:00:00.000Z', target: 3000, actual: 3150, recipeId: 'r-ris', recipeName: 'Risotto', variantName: 'Porcini' }),
    dbSession({ id: 'd01', completedAt: '2026-10-01T10:00:00.000Z', target: 2000 }), // senza resa
    dbSession({ id: 'sep30', completedAt: '2026-09-30T21:59:00.000Z', target: 4000, actual: 3900 }), // 30/09 23:59 Roma
    dbSession({ id: 'old', completedAt: '2026-09-15T10:00:00.000Z', target: 1000 }),
  ];

  console.log('MS17b — Storico Produzioni: UI + navigazione');

  await test('1-2. ingresso provvisorio da Produzione -> vista storico-produzioni, Sessioni caricate', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    c.api.render();
    assert.ok(c.last.html.includes('id="btn-storico-produzioni"') && c.last.html.includes('goToStoricoProduzioni()'));
    assert.ok(c.last.html.includes('goToProduzioneGuidata()'), 'Produzione Guidata ancora presente');
    await openStorico(c);
    assert.strictEqual(c.S.view, 'storico-produzioni');
    assert.ok(c.apiCalls.some(x => x.supabaseAction === 'loadProductionSessions'));
    assert.ok(c.last.html.includes('Storico Produzioni') && c.last.html.includes('placeholder="Cerca una preparazione…"'));
    assert.ok(/storico-produzioni/.test(html.match(/const isProduzione=[^;]*;/)[0]), 'bottom nav: area Produzione attiva');
  });

  await test('3+22. solo completed, ordinate dalla piu\' recente (ordinamento del motore)', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    assert.deepStrictEqual(cardIds(c), ['today', 'd03', 'd01', 'sep30', 'old']);
  });

  await test('4. ricerca: usa il motore (case/accent-insensitive, Scheda e Ricetta)', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    c.api.onHistoryQueryInput('TIRAMISU');
    assert.deepStrictEqual(cardIds(c), ['today', 'd01', 'sep30', 'old']);
    c.api.onHistoryQueryInput('porcini');
    assert.deepStrictEqual(cardIds(c), ['d03'], 'nome della Ricetta usata');
    assert.ok(c.last.html.includes('value="porcini"'));
    assert.ok(!/historyNormalizeText|normalize\('NFD'\)/.test(extractFunction('function renderStoricoProduzioni()') + extractFunction('function renderHistoryCard(r)')), 'nessuna logica di ricerca nel renderer');
  });

  await test('5-8. periodi: Tutte, Oggi, Ultimi 7 giorni, Questo mese (completed_at, giorno locale)', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    c.api.setHistoryPreset('all'); assert.strictEqual(cardIds(c).length, 5);
    c.api.setHistoryPreset('today'); assert.deepStrictEqual(cardIds(c), ['today']);
    c.api.setHistoryPreset('last7'); assert.deepStrictEqual(cardIds(c), ['today', 'd03', 'd01'], '01/10 -> 07/10');
    c.api.setHistoryPreset('month'); assert.deepStrictEqual(cardIds(c), ['today', 'd03', 'd01'], '30/09 23:59 locale resta a settembre');
    assert.ok(c.last.html.includes('data-history-preset="month"'));
    assert.ok(/class="pg-tab pg-tab-active" data-history-preset="month"/.test(c.last.html));
  });

  await test('9-10. Personalizzato: Da/A, estremi inclusivi; solo un estremo = limite aperto', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    c.api.setHistoryPreset('custom');
    assert.ok(c.last.html.includes('id="history-from"') && c.last.html.includes('id="history-to"'));
    assert.strictEqual(cardIds(c).length, 5, 'senza date: nessun limite');
    c.api.onHistoryDateInput('from', '2026-09-30');
    c.api.onHistoryDateInput('to', '2026-10-03');
    assert.deepStrictEqual(cardIds(c), ['d03', 'd01', 'sep30'], 'estremi inclusi');
    c.api.onHistoryDateInput('to', '');
    assert.deepStrictEqual(cardIds(c), ['today', 'd03', 'd01', 'sep30']);
  });

  await test('11. ricerca + periodo = AND', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    c.api.onHistoryQueryInput('tiramisù');
    c.api.setHistoryPreset('month');
    assert.deepStrictEqual(cardIds(c), ['today', 'd01']);
  });

  await test('12-13. riepilogo reattivo ai filtri; confronto solo sull\'insieme confrontabile; copertura', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    c.api.setHistoryPreset('month'); // today(5000→4720) d03(3000→3150) d01(2000, nessuna resa)
    const h = c.last.html;
    assert.ok(h.includes('3 produzioni'));
    assert.ok(h.includes('Resa prevista: <strong>10 kg</strong>'));
    assert.ok(h.includes('Resa effettiva registrata: <strong>7,87 kg</strong>'));
    assert.ok(h.includes('Scostamento sulle 2 produzioni con resa registrata (8 kg previsti → 7,87 kg effettivi)'), 'confronto esplicito sul solo insieme confrontabile');
    assert.ok(h.includes('−130 g · −1,6%'));
    assert.ok(h.includes('Resa effettiva registrata in 2 produzioni su 3'));
    assert.ok(!h.includes('−2,13 kg'), 'mai 10 kg previsti contro 7,87 kg effettivi');
    c.api.setHistoryPreset('today');
    assert.ok(c.last.html.includes('1 produzione') && c.last.html.includes('Resa effettiva registrata in tutte le produzioni'));
    assert.ok(c.last.html.includes('Scostamento: <strong>−280 g · −5,6%</strong>'), 'copertura completa: forma compatta');
  });

  await test('14-15. nessuna resa effettiva: messaggio chiaro, nessuno scostamento (mai 0)', async () => {
    freshDb([dbSession({ id: 'a', target: 2000 }), dbSession({ id: 'b', target: 1000, completedAt: '2026-10-06T10:00:00.000Z' })]);
    const c = makeClient(handler);
    await openStorico(c);
    const h = c.last.html;
    assert.ok(h.includes('Resa effettiva non registrata in nessuna produzione'));
    assert.ok(!h.includes('ms17-summary-deviation') && !h.includes('Scostamento'));
    assert.ok(!/0 g · 0,0%|±0/.test(h));
    assert.strictEqual((h.match(/Effettiva non registrata/g) || []).length, 2, 'card senza scostamento');
    assert.ok(!h.includes('ms17-card-deviation'));
  });

  await test('16-21. card: completata, iniziata, durata, prevista, effettiva + scostamento; nomi escapati', async () => {
    freshDb([dbSession({ id: 'x', recipeName: '<img src=x onerror=alert(1)>Tiramisù', variantName: 'Classica "v2" & co', actual: 4720,
      startedAt: '2026-10-07T07:58:00.000Z', completedAt: '2026-10-07T09:42:00.000Z' })]);
    const c = makeClient(handler);
    await openStorico(c);
    const h = c.last.html;
    assert.ok(h.includes('<span style="color:var(--mid)">Completata</span> 07/10/2026, 11:42'), 'completed_at');
    assert.ok(h.includes('<span style="color:var(--mid)">Iniziata</span> 07/10/2026, 09:58'), 'started_at');
    assert.ok(h.includes('<span style="color:var(--mid)">Durata</span> 1 h 44 min'));
    assert.ok(h.includes('Prevista <strong>5 kg</strong>'));
    assert.ok(h.includes('Effettiva <strong>4,72 kg</strong>'));
    assert.ok(h.includes('· −280 g · −5,6%'));
    assert.ok(!h.includes('<img src=x'), 'nessun HTML iniettato');
    assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;Tiramisù'));
    assert.ok(h.includes('Ricetta: Classica &quot;v2&quot; &amp; co'));
    assert.ok(h.includes("openHistorySession('x')") && h.includes('Apri produzione'));
  });

  await test('23-26. Apri produzione -> Sessione MS16 read-only; Indietro -> Storico con filtri intatti', async () => {
    const fake = freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    c.api.onHistoryQueryInput('tiramisu');
    c.api.setHistoryPreset('custom');
    c.api.onHistoryDateInput('from', '2026-10-01');
    c.api.onHistoryDateInput('to', '2026-10-07');
    const filtri = JSON.stringify(c.S.historyFilters);
    c.api.openHistorySession('today');
    await flush();
    assert.strictEqual(c.S.view, 'sessione-operativa');
    assert.strictEqual(c.S.openSessionId, 'today');
    const h = c.last.html;
    assert.ok(h.includes('pg-badge-completed">Completata'), 'renderer MS16');
    assert.ok(h.includes('ms16-completed-summary') && h.includes('sola lettura'));
    assert.ok(!h.includes('id="session-complete"') && !h.includes('session-note-input'));
    assert.ok(/class="ms12-check"[^>]*disabled/.test(h));
    assert.ok(h.includes('id="session-back-history"') && h.includes('Storico Produzioni'));
    const writes = c.apiCalls.length;
    await c.api.toggleSessionIngredient('today', 'vi1');
    c.api.requestCompleteSession('today');
    assert.strictEqual(c.apiCalls.length, writes, 'nessuna mutazione');
    assert.ok(!fake.calls.some(x => x.method === 'PATCH'));
    c.api.tornaAlloStoricoProduzioni();
    assert.strictEqual(c.S.view, 'storico-produzioni');
    assert.strictEqual(JSON.stringify(c.S.historyFilters), filtri, 'filtri conservati');
    assert.deepStrictEqual(cardIds(c), ['today', 'd01']);
    assert.ok(c.last.html.includes('value="tiramisu"') && c.last.html.includes('value="2026-10-01"'));
  });

  await test('27. empty state: nessuna produzione completata', async () => {
    freshDb([dbSession({ id: 'p', status: 'pending', startedAt: null }), dbSession({ id: 'i', status: 'in_progress' })]);
    const c = makeClient(handler);
    await openStorico(c);
    assert.ok(c.last.html.includes('Non ci sono ancora produzioni completate.'));
    assert.ok(!c.last.html.includes('ms17-summary'));
  });

  await test('28+30. nessun risultato con i filtri -> messaggio + Azzera filtri; reset ripristina tutto', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    c.api.onHistoryQueryInput('lasagna');
    assert.ok(c.last.html.includes('Nessuna produzione trovata con questi filtri.'));
    assert.ok(c.last.html.includes('id="history-reset"'));
    c.api.resetHistoryFilters();
    assert.deepStrictEqual(c.S.historyFilters, { query: '', preset: 'all', from: '', to: '' });
    assert.strictEqual(cardIds(c).length, 5);
  });

  await test('29. periodo non valido: errore del motore mostrato, nessun risultato, reset disponibile', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    c.api.setHistoryPreset('custom');
    c.api.onHistoryDateInput('from', '2026-10-07');
    c.api.onHistoryDateInput('to', '2026-10-01');
    assert.ok(c.last.html.includes('La data di inizio è successiva alla data di fine.'));
    assert.deepStrictEqual(cardIds(c), []);
    assert.ok(c.last.html.includes('id="history-reset"'));
  });

  await test('extra. caricamento in corso / errore di caricamento distinti dallo Storico vuoto', async () => {
    const fake = freshDb(dataset());
    fake.fail('production_sessions:GET');
    const c = makeClient(handler);
    c.api.goToStoricoProduzioni();
    assert.ok(c.last.html.includes('Carico le produzioni'));
    await flush();
    assert.ok(c.last.html.includes('Non riesco a caricare le produzioni') && c.last.html.includes('loadProductionSessions()'));
    assert.ok(!c.last.html.includes('Non ci sono ancora produzioni completate.'));
    fake.heal('production_sessions:GET');
    await c.api.loadProductionSessions();
    assert.strictEqual(cardIds(c).length, 5);
  });

  await test('31-32. Produzione Guidata invariata: tab Completate presente, apertura e ritorno a Produzione Guidata', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    // prima un'apertura dallo Storico, poi da Produzione Guidata: il ritorno non deve "ricordare" lo Storico
    await openStorico(c);
    c.api.openHistorySession('today');
    await flush();
    c.api.goToProduzioneGuidata();
    await flush();
    c.api.setProduzioneGuidataTab('completed');
    assert.ok(c.last.html.includes('Completate') && c.last.html.includes("apriSessioneOperativa('today')"));
    assert.ok(!c.last.html.includes('In arrivo in un prossimo Micro-Step'));
    c.api.apriSessioneOperativa('today');
    await flush();
    assert.strictEqual(c.S.sessionReturnView, null);
    assert.ok(c.last.html.includes("S.produzioneGuidataTab='completed'") && !c.last.html.includes('session-back-history'));
    c.api.setProduzioneGuidataTab('in_progress');
    c.S.view = 'produzione-guidata'; c.api.render();
    assert.ok(c.last.html.includes("apriSessioneOperativa('prog')"));
    c.api.setProduzioneGuidataTab('pending'); c.api.render();
    assert.ok(c.last.html.includes("avviaProduzione('pend')"));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
