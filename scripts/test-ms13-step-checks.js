/*
 * Test Sprint Produzione — MS13: procedimento guidato con stato "Fatto"
 * persistente per step. Nessun framework: Node puro + assert.
 *
 * Codice REALE: api/chat.js (handler importato come modulo) contro un finto
 * PostgREST in memoria (righe session_step_state con campi timer, PATCH con
 * return=representation), e le funzioni client ESTRATTE da khub_mvp.html.
 * Mock solo ai confini: render/toast.
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
  // MS13: la Sessione operativa carica e mostra anche lo stato degli step
  'async function loadSessionStepState(sessionId)', 'async function toggleSessionStep(sessionId,itemKey)', 'function formatStepDurationLabel(seconds)',
  // MS14: la Sessione operativa mostra anche i timer degli step
  'function ms14Now()', 'function stepTimerDurationSeconds(value)', 'function stepTimerRemainingSeconds(startedAtIso,durationSeconds,nowMs)',
  'function stepTimerState(startedAtIso,durationSeconds,nowMs)', 'function formatTimerCountdown(seconds)',
].map(extractFunction).join('\n');

function makeSession(id, status, stepIds, durations) {
  return {
    id, recipeId: 'r1', sourceVariantId: 'vv1', status, snapshotVersion: 1, targetFinishedTotal: 2000,
    createdAt: '2026-10-01T08:00:00Z', startedAt: '2026-10-01T09:00:00Z', completedAt: null,
    snapshot: {
      snapshotVersion: 1, recipe: { recipeName: 'Risotto', variantName: 'Porcini' },
      target: { targetPortions: 10, targetGramsPerPortion: 200, targetFinishedTotal: 2000, baseExpectedFinishedTotal: 1000, scaleFactor: 2, normalizationUnit: 'g' },
      ingredients: [{ itemKey: 'vi1', sourceIngredientId: 'vi1', name: 'Porcini', unit: 'kg', baseQty: 1, operativeQty: 1.25 }],
      steps: stepIds.map((k, i) => ({ stepId: k, order: i, text: ['Rosolare i funghi a fuoco vivo', 'Aggiungere il brodo e ridurre', 'Regolare di sale e mantecare'][i] || ('Step ' + i),
        expectedDurationSeconds: durations ? durations[i] : [300, 600, null][i] })),
      media: { mediaUrl: null, videoUrl: null },
    },
  };
}

function makeClient(handler, sessions, recipes) {
  const apiCalls = [], toasts = [];
  const clientFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    apiCalls.push(body);
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { ok: status < 400, status, json: async () => out };
  };
  const S = { view: 'app-home', openSessionId: null, productionSessions: sessions, sessionIngredientState: {}, sessionStepState: {}, recipes: recipes || [] };
  const api = new Function('S', 'fetch', 'render', 'toast', 'console', CLIENT_SRC + `
    return { apriSessioneOperativa, loadSessionStepState, toggleSessionStep, toggleSessionIngredient, renderSessioneOperativa, formatStepDurationLabel };`)(
    S, clientFetch, () => {}, (m) => toasts.push(m), { error() {} });
  return { S, api, apiCalls, toasts };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const flush = () => new Promise(r => setTimeout(r, 0));
  const TIMER_AT = '2026-10-01T09:05:00.000Z';

  function freshDb() {
    const fake = makeFakeSupabase();
    const row = (sid, k, checked = false, timer = false) => ({ id: 'pss_' + sid + '_' + k, session_id: sid, item_key: k, checked,
      checked_at: checked ? '2026-10-01T09:30:00.000Z' : null, timer_started_at: timer ? TIMER_AT : null, timer_actual_seconds: timer ? 280 : null });
    fake.tables.session_step_state = [row('ps1', 'st1', false, true), row('ps1', 'st2'), row('ps1', 'st3'), row('ps2', 'st1'), row('ps2', 'st2', true)];
    fake.tables.session_ingredient_state = [{ id: 'pis1', session_id: 'ps1', item_key: 'vi1', checked: false, checked_at: null }];
    globalThis.fetch = fake.fetch;
    return fake;
  }
  const dbRow = (fake, sid, k) => fake.tables.session_step_state.find(r => r.session_id === sid && r.item_key === k);
  const sessions = () => [makeSession('ps1', 'in_progress', ['st1', 'st2', 'st3']), makeSession('ps2', 'in_progress', ['st1', 'st2'])];
  async function open(c, sid) { c.api.apriSessioneOperativa(sid); await flush(); await flush(); }
  const stepWrites = (fake) => fake.calls.filter(x => x.table === 'session_step_state' && x.method !== 'GET');

  console.log('MS13 — procedimento guidato + stato "Fatto" persistente');

  await test('load: stato step letto SOLO per quella session_id, indipendente da ingredienti e snapshot', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const st = c.S.sessionStepState.ps1;
    assert.strictEqual(st.status, 'loaded');
    assert.deepStrictEqual(Object.keys(st.byItemKey).sort(), ['st1', 'st2', 'st3']);
    assert.ok(!c.S.sessionStepState.ps2);
    const get = fake.calls.find(x => x.method === 'GET' && x.table === 'session_step_state');
    assert.deepStrictEqual(get.filters, [['session_id', 'eq', 'ps1']]);
    assert.strictEqual(c.S.sessionIngredientState.ps1.status, 'loaded', 'spunte ingredienti caricate in parallelo, stato separato');
    assert.ok(c.S.productionSessions[0].snapshot.steps.every(s => !('checked' in s)), 'mai checked dentro lo snapshot');
    const html = c.api.renderSessioneOperativa();
    assert.strictEqual((html.match(/class="ms13-step-check"/g) || []).length, 3);
    assert.ok(html.indexOf('1. Rosolare') < html.indexOf('2. Aggiungere') && html.indexOf('2. Aggiungere') < html.indexOf('3. Regolare'), 'ordine dello snapshot');
  });

  await test('false -> true + checked_at; true -> false + checked_at null; campi timer invariati', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const prima = Date.now();
    await c.api.toggleSessionStep('ps1', 'st1');
    let r = dbRow(fake, 'ps1', 'st1');
    assert.strictEqual(r.checked, true);
    assert.ok(r.checked_at && Date.parse(r.checked_at) >= prima - 1000);
    assert.deepStrictEqual([r.timer_started_at, r.timer_actual_seconds], [TIMER_AT, 280], 'timer invariato');
    assert.deepStrictEqual(c.S.sessionStepState.ps1.byItemKey.st1, { checked: true, checkedAt: r.checked_at, timerStartedAt: TIMER_AT }); // MS14: lo stato runtime include anche il timer, invariato
    await c.api.toggleSessionStep('ps1', 'st1');
    r = dbRow(fake, 'ps1', 'st1');
    assert.deepStrictEqual([r.checked, r.checked_at, r.timer_started_at, r.timer_actual_seconds], [false, null, TIMER_AT, 280]);
    assert.deepStrictEqual(Object.keys(stepWrites(fake)[0].body).sort(), ['checked', 'checked_at'], 'campi timer mai inviati');
  });

  await test('PATCH mirata (session_id, item_key), esattamente una riga; nessun INSERT/UPSERT', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.toggleSessionStep('ps1', 'st2');
    const w = stepWrites(fake);
    assert.strictEqual(w.length, 1);
    assert.strictEqual(w[0].method, 'PATCH');
    assert.deepStrictEqual(w[0].filters, [['session_id', 'eq', 'ps1'], ['item_key', 'eq', 'st2']]);
    assert.strictEqual(fake.tables.session_step_state.length, 5, 'nessuna riga creata');
    assert.ok(!fake.calls.some(x => x.method === 'POST'));
    assert.ok(!c.apiCalls.some(b => b.supabaseAction === 'update' || b.supabaseAction === 'save'));
  });

  await test('zero righe -> errore; piu\' righe -> errore; errore HTTP -> errore; mai un falso successo', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    fake.tables.session_step_state = fake.tables.session_step_state.filter(r => !(r.session_id === 'ps1' && r.item_key === 'st3'));
    await c.api.toggleSessionStep('ps1', 'st3');
    assert.deepStrictEqual(c.S.sessionStepState.ps1.byItemKey.st3, { checked: false, checkedAt: null, timerStartedAt: null });
    assert.deepStrictEqual(c.toasts, ['Passaggio non salvato. Riprova.']);
    fake.fail('session_step_state:PATCH');
    await c.api.toggleSessionStep('ps1', 'st2');
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.st2.checked, false);
    assert.strictEqual(c.toasts.length, 2);
    fake.heal('session_step_state:PATCH');
    fake.tables.session_step_state.push({ id: 'dup', session_id: 'ps1', item_key: 'st2', checked: false, checked_at: null, timer_started_at: null, timer_actual_seconds: null });
    let out;
    await handler({ method: 'POST', body: { supabaseAction: 'setSessionStepChecked', sessionId: 'ps1', itemKey: 'st2', checked: true } }, { status() { return this; }, json(o) { out = o; return this; } });
    assert.ok(out.error && !out.ok, 'due righe aggiornate = errore');
  });

  await test('isolamento tra Sessioni con lo stesso item_key', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.toggleSessionStep('ps1', 'st1');
    assert.strictEqual(dbRow(fake, 'ps1', 'st1').checked, true);
    assert.strictEqual(dbRow(fake, 'ps2', 'st1').checked, false);
    assert.strictEqual(dbRow(fake, 'ps2', 'st2').checked, true);
  });

  await test('snapshot e Ricetta invariati; spunte ingredienti (MS12) indipendenti', async () => {
    const fake = freshDb();
    const recipes = [{ id: 'r1', name: 'Risotto', validatedVariants: [{ id: 'vv1', steps: ['x'], stepsV2: [{ id: 'st1', order: 0, text: 'x', expectedDurationSeconds: 300 }] }] }];
    const sess = sessions();
    const c = makeClient(handler, sess, recipes);
    const snapPrima = JSON.stringify(sess.map(s => s.snapshot));
    const ricettePrima = JSON.stringify(recipes);
    await open(c, 'ps1');
    await c.api.toggleSessionStep('ps1', 'st1');
    await c.api.toggleSessionIngredient('ps1', 'vi1');
    assert.strictEqual(JSON.stringify(c.S.productionSessions.map(s => s.snapshot)), snapPrima);
    assert.strictEqual(JSON.stringify(c.S.recipes), ricettePrima);
    assert.strictEqual(fake.tables.session_ingredient_state[0].checked, true);
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.vi1, undefined, 'stati non mescolati');
    assert.strictEqual(c.S.sessionIngredientState.ps1.byItemKey.st1, undefined);
  });

  await test('riga mancante -> "Fatto" disabilitato, mai creata; Sessione senza righe step', async () => {
    const fake = freshDb();
    const c = makeClient(handler, [makeSession('ps1', 'in_progress', ['st1', 'st2', 'st3', 'stNuovo'])]);
    await open(c, 'ps1');
    assert.match(c.api.renderSessioneOperativa(), /title="Stato non disponibile per questo passaggio" disabled/);
    await c.api.toggleSessionStep('ps1', 'stNuovo');
    assert.deepStrictEqual(c.toasts, ['Stato non disponibile per questo passaggio.']);
    assert.strictEqual(stepWrites(fake).length, 0);
    const c2 = makeClient(handler, [makeSession('psVuota', 'in_progress', ['a', 'b'])]);
    await open(c2, 'psVuota');
    const html = c2.api.renderSessioneOperativa();
    assert.strictEqual((html.match(/class="ms13-step-check"[^>]* disabled/g) || []).length, 2);
    assert.match(html, /1\. Rosolare/, 'procedimento leggibile');
  });

  await test('doppio click sullo stesso step -> una sola PATCH; altri step utilizzabili', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const p1 = c.api.toggleSessionStep('ps1', 'st1');
    const html = c.api.renderSessioneOperativa();
    assert.match(html, /ti-loader-2/);
    assert.strictEqual((html.match(/class="ms13-step-check"[^>]* disabled/g) || []).length, 1, 'solo lo step in scrittura e\' bloccato');
    const p2 = c.api.toggleSessionStep('ps1', 'st1');
    const p3 = c.api.toggleSessionStep('ps1', 'st2');
    await Promise.all([p1, p2, p3]);
    assert.strictEqual(stepWrites(fake).filter(w => w.filters[1][2] === 'st1').length, 1);
    assert.deepStrictEqual([dbRow(fake, 'ps1', 'st1').checked, dbRow(fake, 'ps1', 'st2').checked], [true, true]);
  });

  await test('fuori ordine: lo step 3 si segna Fatto con 1 e 2 non fatti, e persiste', async () => {
    const fake = freshDb();
    let c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.toggleSessionStep('ps1', 'st3');
    assert.deepStrictEqual(['st1', 'st2', 'st3'].map(k => dbRow(fake, 'ps1', k).checked), [false, false, true]);
    c = makeClient(handler, sessions());
    await open(c, 'ps1');
    assert.deepStrictEqual(['st1', 'st2', 'st3'].map(k => c.S.sessionStepState.ps1.byItemKey[k].checked), [false, false, true]);
  });

  await test('durata prevista leggibile; assente/zero/non valida mai inventata', async () => {
    freshDb();
    const f = makeClient(handler, []).api.formatStepDurationLabel;
    assert.deepStrictEqual([f(300), f(90), f(3600), f(3700), f(45), f(7200)], ['5 min', '1 min 30 sec', '1 h', '1 h 1 min 40 sec', '45 sec', '2 h']);
    assert.deepStrictEqual([f(null), f(undefined), f(0), f(-5), f(NaN), f('abc'), f(''), f({})], ['', '', '', '', '', '', '', '']);
    const c = makeClient(handler, [makeSession('ps1', 'in_progress', ['st1', 'st2', 'st3'], [300, 0, 'xx'])]);
    await open(c, 'ps1');
    const html = c.api.renderSessioneOperativa();
    assert.strictEqual((html.match(/ti-clock/g) || []).length, 1, 'durata solo dove valida');
    assert.match(html, /ti-clock"><\/i> 5 min/);
    assert.deepStrictEqual(c.S.productionSessions[0].snapshot.steps.map(s => s.expectedDurationSeconds), [300, 0, 'xx'], 'valore originale invariato');
  });

  await test('rientro / reload: "Fatto" e rimozione persistono', async () => {
    const fake = freshDb();
    let c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.toggleSessionStep('ps1', 'st2');
    c.S.view = 'produzione-guidata';
    await open(c, 'ps1');
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.st2.checked, true, 'rientro');
    c = makeClient(handler, sessions());
    await open(c, 'ps1');
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.st2.checked, true, 'reload');
    await c.api.toggleSessionStep('ps1', 'st2');
    c = makeClient(handler, sessions());
    await open(c, 'ps1');
    assert.strictEqual(c.S.sessionStepState.ps1.byItemKey.st2.checked, false);
  });

  await test('lettura fallita -> procedimento leggibile, "Fatto" disabilitato, Riprova', async () => {
    const fake = freshDb();
    fake.fail('session_step_state:GET');
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    assert.strictEqual(c.S.sessionStepState.ps1.status, 'error');
    assert.strictEqual(c.S.sessionIngredientState.ps1.status, 'loaded', 'le spunte ingredienti non ne risentono');
    const html = c.api.renderSessioneOperativa();
    assert.match(html, /Non riesco a caricare lo stato dei passaggi/);
    assert.match(html, /1\. Rosolare i funghi/);
    assert.strictEqual((html.match(/class="ms13-step-check"[^>]* disabled/g) || []).length, 3);
    await c.api.toggleSessionStep('ps1', 'st1');
    assert.strictEqual(stepWrites(fake).length, 0);
    fake.heal('session_step_state:GET');
    await c.api.loadSessionStepState('ps1');
    assert.strictEqual(c.S.sessionStepState.ps1.status, 'loaded');
  });

  await test('Sessione non in corso -> "Fatto" non modificabile', async () => {
    const fake = freshDb();
    const c = makeClient(handler, [makeSession('ps1', 'completed', ['st1'])]);
    await open(c, 'ps1');
    await c.api.toggleSessionStep('ps1', 'st1');
    assert.strictEqual(stepWrites(fake).length, 0);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
