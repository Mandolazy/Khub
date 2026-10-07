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
  'function renderHistorySummary(agg)', 'function renderHistoryCard(r)', 'function renderStoricoProduzioni()',
].map(extractFunction).concat([html.match(/var SESSION_NOTE_MAX_LENGTH=\d+;/)[0], html.match(/var PRODUCTION_HOME_LIMIT=\d+;/)[0]]).join('\n');

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
  const S = { view: 'attive', openSessionId: null, productionSessions: [], produzioneHome: { recipeQuery: '', expanded: null }, startingSessionId: null,
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
        : S.view==='storico-produzioni' ? renderStoricoProduzioni()
        : S.view==='attive' ? renderAttive() : '';
      syncStepTimerTicker();
    }
    ${CLIENT_SRC}
    return { render, goToStoricoProduzioni, apriSessioneOperativa, openHistorySession, avviaProduzione,
      tornaAlloStoricoProduzioni, onHistoryQueryInput, setHistoryPreset, onHistoryDateInput, resetHistoryFilters, loadProductionSessions,
      toggleSessionIngredient, requestCompleteSession, selectHistoryRecords, aggregateHistoryRecords, historyPeriodFromFilters,
      formatHistoryQty, formatHistorySigned, formatHistoryPct };`)(
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
  // Testo visibile (tag rimossi, spazi compattati): asserzioni indipendenti dal markup (MS17b.1).
  const vis = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
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
    assert.ok(!c.last.html.includes('goToProduzioneGuidata') && !c.last.html.includes('Produzione Guidata'), 'Produzione Guidata ritirata: lo Storico si apre dalla Home Produzione');
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
    const t = vis(c.last.html);
    assert.ok(t.includes('3 produzioni'));
    assert.ok(t.includes('Previsto 10 kg'));
    assert.ok(t.includes('Effettivo* 7,87 kg'));
    assert.ok(t.includes('Scostamento* −130 g −1,6% su 8 kg previsti confrontabili'), 'confronto sul solo insieme confrontabile, dichiarato');
    assert.ok(t.includes('* Resa effettiva registrata in 2 produzioni su 3. Lo scostamento considera solo le produzioni con resa registrata.'));
    assert.ok(!t.includes('−2,13 kg'), 'mai 10 kg previsti contro 7,87 kg effettivi');
    c.api.setHistoryPreset('today');
    const t2 = vis(c.last.html);
    assert.ok(t2.includes('1 produzione') && t2.includes('Resa effettiva registrata in tutte le produzioni.'));
    assert.ok(t2.includes('Scostamento −280 g −5,6%') && !t2.includes('*'), 'copertura completa: nessun asterisco');
  });

  await test('14-15. nessuna resa effettiva: messaggio chiaro, nessuno scostamento (mai 0)', async () => {
    freshDb([dbSession({ id: 'a', target: 2000 }), dbSession({ id: 'b', target: 1000, completedAt: '2026-10-06T10:00:00.000Z' })]);
    const c = makeClient(handler);
    await openStorico(c);
    const h = c.last.html, t = vis(h);
    assert.ok(t.includes('Effettivo Non disponibile') && t.includes('Scostamento —'));
    assert.ok(t.includes('Nessuna resa effettiva registrata: scostamento non calcolabile.'));
    assert.ok(!h.includes('ms17-summary-deviation'));
    assert.ok(!/0 g · 0,0%|±0| 0 g /.test(t));
    assert.strictEqual((t.match(/Effettiva Non registrata/g) || []).length, 2, 'card senza scostamento');
    assert.ok(!h.includes('ms17-card-deviation'));
  });

  await test('16-21. card: completata, iniziata, durata, prevista, effettiva + scostamento; nomi escapati', async () => {
    freshDb([dbSession({ id: 'x', recipeName: '<img src=x onerror=alert(1)>Tiramisù', variantName: 'Classica "v2" & co', actual: 4720,
      startedAt: '2026-10-07T07:58:00.000Z', completedAt: '2026-10-07T09:42:00.000Z' })]);
    const c = makeClient(handler);
    await openStorico(c);
    const h = c.last.html, t = vis(h);
    assert.ok(t.includes('Completata 7 ott · 11:42'), 'completed_at');
    assert.ok(t.includes('Iniziata 7 ott · 09:58'), 'started_at');
    assert.ok(t.includes('Durata 1 h 44 min'));
    assert.ok(t.includes('Prevista 5 kg → Effettiva 4,72 kg'));
    assert.ok(t.includes('Scostamento −280 g · −5,6%'));
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

  await test('31-32. Home Produzione (sostituisce Produzione Guidata): Sessione aperta dalla Home torna alla Home, dallo Storico allo Storico', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    // prima un'apertura dallo Storico, poi dalla Home: il ritorno non deve "ricordare" lo Storico
    await openStorico(c);
    c.api.openHistorySession('today');
    await flush();
    assert.ok(c.last.html.includes('id="session-back-history"'));
    c.S.view = 'attive'; c.api.render();
    assert.ok(c.last.html.includes("apriSessioneOperativa('prog')"), 'in corso nella Home');
    assert.ok(c.last.html.includes("avviaProduzione('pend')"), 'da iniziare nella Home');
    assert.ok(!c.last.html.includes("apriSessioneOperativa('today')"), 'le completate restano nello Storico');
    c.api.apriSessioneOperativa('prog');
    await flush();
    assert.strictEqual(c.S.sessionReturnView, null);
    assert.ok(c.last.html.includes(`id="session-back-home" onclick="S.view='attive';render()"`) && !c.last.html.includes('session-back-history'));
  });

  // ── MS17b.1: rifinitura UI (solo presentazione) ──────────────
  await test('MS17b.1-1/2. riga "Ricetta:" nascosta se equivalente al nome (maiuscole/spazi), mostrata se diversa', async () => {
    freshDb([
      dbSession({ id: 'same', recipeName: 'Mistrà fatto in casa', variantName: '  mistrà   FATTO in casa ' }),
      dbSession({ id: 'diff', recipeName: 'Crema al mascarpone e caffè', variantName: 'crema caffè e mascarpone con panna vegetale', completedAt: '2026-10-06T10:00:00.000Z' }),
      dbSession({ id: 'none', recipeName: 'Brodo', variantName: '   ', completedAt: '2026-10-05T10:00:00.000Z' }),
    ]);
    const c = makeClient(handler);
    await openStorico(c);
    const card = (id) => { const i = c.last.html.indexOf('data-session-id="' + id + '"'); return c.last.html.slice(i, c.last.html.indexOf('openHistorySession', i)); };
    assert.ok(!card('same').includes('Ricetta:'));
    assert.ok(vis(card('diff')).includes('Ricetta: crema caffè e mascarpone con panna vegetale'));
    assert.ok(!card('none').includes('Ricetta:'));
  });

  await test('MS17b.1-3/4. resa effettiva mancante: card "Non registrata" senza scostamento; riepilogo "Non disponibile" e "—"', async () => {
    freshDb([dbSession({ id: 'n', target: 10000 })]);
    const c = makeClient(handler);
    await openStorico(c);
    const t = vis(c.last.html);
    assert.ok(t.includes('Prevista 10 kg → Effettiva Non registrata'));
    assert.ok(!c.last.html.includes('ms17-card-deviation'));
    assert.ok(t.includes('Previsto 10 kg') && t.includes('Effettivo Non disponibile') && t.includes('Scostamento —'));
  });

  await test('MS17b.1-5/6. aggregati invariati rispetto al motore MS17a; copertura parziale dichiarata', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    c.api.setHistoryPreset('month');
    const recs = c.api.selectHistoryRecords(c.S.productionSessions, { query: '', period: c.api.historyPeriodFromFilters(c.S.historyFilters, NOW) }).records;
    const a = c.api.aggregateHistoryRecords(recs);
    const t = vis(c.last.html);
    assert.ok(t.includes('Previsto ' + c.api.formatHistoryQty(a.totalExpected)));
    assert.ok(t.includes('Effettivo* ' + c.api.formatHistoryQty(a.totalActual)));
    assert.ok(t.includes('Scostamento* ' + c.api.formatHistorySigned(a.aggregateDeviation) + ' ' + c.api.formatHistoryPct(a.aggregateDeviationPct)));
    assert.ok(t.includes('su ' + c.api.formatHistoryQty(a.totalExpectedComparable) + ' previsti confrontabili'));
    assert.strictEqual(a.aggregateDeviation, a.totalActualComparable - a.totalExpectedComparable, 'scostamento sul solo insieme confrontabile');
    assert.ok(t.includes('Resa effettiva registrata in ' + a.coverage.withActual + ' produzioni su ' + a.coverage.total));
  });

  await test('MS17b.1-7/8/9. completed_at in evidenza, started_at e durata (anche anomala) sempre presenti; anno se diverso', async () => {
    freshDb([
      dbSession({ id: 'long', startedAt: '2026-09-19T13:27:00.000Z', completedAt: '2026-10-07T15:01:00.000Z' }),
      dbSession({ id: 'y25', startedAt: '2025-12-30T09:00:00.000Z', completedAt: '2025-12-30T10:30:00.000Z' }),
    ]);
    const c = makeClient(handler);
    await openStorico(c);
    const t = vis(c.last.html);
    assert.ok(c.last.html.includes('<div class="ms17-card-when">7 ott · 17:01</div>'), 'completed_at come dato principale');
    assert.ok(t.includes('Iniziata 19 set · 15:27 · Durata 433 h 34 min'), 'durata reale, non corretta');
    assert.ok(t.includes('30 dic 2025 · 11:30') && t.includes('Iniziata 30 dic 2025 · 10:00'));
  });

  await test('MS17b.1-10/11/12. CTA, ritorno e filtri invariati', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    c.api.onHistoryQueryInput('tiramisu');
    assert.ok(c.last.html.includes(`class="btn btn-outline btn-sm ms17-open" onclick="openHistorySession('today')"`));
    c.api.openHistorySession('today');
    await flush();
    assert.strictEqual(c.S.view, 'sessione-operativa');
    c.api.tornaAlloStoricoProduzioni();
    assert.strictEqual(c.S.view, 'storico-produzioni');
    assert.strictEqual(c.S.historyFilters.query, 'tiramisu');
    assert.deepStrictEqual(cardIds(c), ['today', 'd01', 'sep30', 'old']);
  });

  await test('MS17b.1-13. responsive: indicatori e card si impilano sotto 640px, testi lunghi vanno a capo', async () => {
    const css = html.match(/\/\* MS17b\.1[\s\S]*?@media \(max-width:640px\)\{([\s\S]*?)\n\}/);
    assert.ok(css, 'blocco CSS MS17b.1 con media query');
    assert.ok(/\.ms17-kpis\{grid-template-columns:1fr;/.test(css[1]));
    assert.ok(/\.ms17-card-grid\{grid-template-columns:1fr;/.test(css[1]));
    assert.ok(/\.ms17-card-name\{[^}]*overflow-wrap:anywhere/.test(css[0]) && /\.ms17-kpi-value\{[^}]*overflow-wrap:anywhere/.test(css[0]));
  });


  await test('MS17b.1 correzioni: nessun badge di stato nelle card, etichetta "Completata" su completed_at; "← Produzione" ben visibile', async () => {
    freshDb(dataset());
    const c = makeClient(handler);
    await openStorico(c);
    const h = c.last.html;
    const cards = h.slice(h.indexOf('ms17-history-card'));
    assert.ok(!cards.includes('pg-badge'), 'nessun badge nelle card');
    assert.ok(cards.includes('<div class="ms17-label">Completata</div>'), 'etichetta associata a completed_at');
    assert.ok(h.includes(`<button class="btn btn-outline btn-sm ms17-back" onclick="S.view='attive';render()"><i class="ti ti-arrow-left"></i> Produzione</button>`), 'stessa destinazione, stile visibile');
    assert.ok(!/btn-ghost[^"]*"[^>]*onclick="S\.view='attive'/.test(extractFunction('function renderStoricoProduzioni()')), 'pulsante indietro senza stile bianco su fondo chiaro');
    assert.ok(/\.ms17-back\{[^}]*color:var\(--dpop-inchiostro-testo\)/.test(html));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
