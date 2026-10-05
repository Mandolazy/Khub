/*
 * Test Sprint Produzione — MS12: spunte ingredienti persistenti nella
 * Sessione operativa. Nessun framework: Node puro + assert.
 *
 * Codice REALE: api/chat.js (handler importato come modulo) contro un finto
 * PostgREST in memoria (vincolo unico (session_id,item_key) di 0008, PATCH
 * con return=representation), e le funzioni client ESTRATTE da
 * khub_mvp.html. Mock solo ai confini: render/toast.
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
  const tables = { session_ingredient_state: [], production_sessions: [] };
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
].map(extractFunction).join('\n');

function makeSession(id, status, itemKeys) {
  return {
    id, recipeId: 'r1', sourceVariantId: 'vv1', status, snapshotVersion: 1, targetFinishedTotal: 2000,
    createdAt: '2026-10-01T08:00:00Z', startedAt: '2026-10-01T09:00:00Z', completedAt: null,
    snapshot: {
      snapshotVersion: 1, recipe: { recipeName: 'Risotto', variantName: 'Porcini' },
      target: { targetPortions: 10, targetGramsPerPortion: 200, targetFinishedTotal: 2000, baseExpectedFinishedTotal: 1000, scaleFactor: 2, normalizationUnit: 'g' },
      ingredients: itemKeys.map((k, i) => ({ itemKey: k, sourceIngredientId: k, name: ['Porcini', 'Brodo vegetale', 'Olio EVO'][i] || ('Ing ' + i), unit: ['kg', 'ml', 'g'][i] || 'g', baseQty: 1, operativeQty: [1.25, 750, 120][i] || 1 })),
      steps: [{ stepId: 'st1', order: 0, text: 'Tostare il riso', expectedDurationSeconds: 120 }],
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
    return { apriSessioneOperativa, loadSessionIngredientState, toggleSessionIngredient, renderSessioneOperativa };`)(
    S, clientFetch, () => {}, (m) => toasts.push(m), { error() {} });
  return { S, api, apiCalls, toasts };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const flush = () => new Promise(r => setTimeout(r, 0));

  function freshDb() {
    const fake = makeFakeSupabase();
    const row = (sid, k, checked = false) => ({ id: 'pis_' + sid + '_' + k, session_id: sid, item_key: k, checked, checked_at: checked ? '2026-10-01T09:30:00.000Z' : null });
    fake.tables.session_ingredient_state = [row('ps1', 'vi1'), row('ps1', 'vi2'), row('ps1', 'vi3'), row('ps2', 'vi1'), row('ps2', 'vi2', true)];
    globalThis.fetch = fake.fetch;
    return fake;
  }
  const dbRow = (fake, sid, k) => fake.tables.session_ingredient_state.find(r => r.session_id === sid && r.item_key === k);
  async function open(c, sid) { c.api.apriSessioneOperativa(sid); await flush(); await flush(); }
  const sessions = () => [makeSession('ps1', 'in_progress', ['vi1', 'vi2', 'vi3']), makeSession('ps2', 'in_progress', ['vi1', 'vi2'])];

  console.log('MS12 — spunte ingredienti persistenti');

  await test('A: apertura Sessione -> stato letto SOLO per quella session_id, separato dallo snapshot', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const st = c.S.sessionIngredientState.ps1;
    assert.strictEqual(st.status, 'loaded');
    assert.deepStrictEqual(Object.keys(st.byItemKey).sort(), ['vi1', 'vi2', 'vi3']);
    assert.ok(!c.S.sessionIngredientState.ps2, 'nessuna lettura di altre Sessioni');
    const get = fake.calls.find(x => x.method === 'GET');
    assert.deepStrictEqual(get.filters, [['session_id', 'eq', 'ps1']]);
    assert.ok(c.S.productionSessions[0].snapshot.ingredients.every(i => !('checked' in i)), 'mai checked dentro lo snapshot');
    const html = c.api.renderSessioneOperativa();
    assert.strictEqual((html.match(/class="ms12-check" role="checkbox"/g) || []).length, 3);
    assert.match(html, /Porcini[\s\S]*1\.25 kg/);
  });

  await test('B: false -> true, checked_at valorizzato dal server; C: true -> false, checked_at = null', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const prima = Date.now();
    await c.api.toggleSessionIngredient('ps1', 'vi1');
    let r = dbRow(fake, 'ps1', 'vi1');
    assert.strictEqual(r.checked, true);
    assert.ok(r.checked_at && Date.parse(r.checked_at) >= prima - 1000, 'checked_at = adesso');
    assert.deepStrictEqual(c.S.sessionIngredientState.ps1.byItemKey.vi1, { checked: true, checkedAt: r.checked_at });
    assert.match(c.api.renderSessioneOperativa(), /aria-checked="true"/);
    await c.api.toggleSessionIngredient('ps1', 'vi1');
    r = dbRow(fake, 'ps1', 'vi1');
    assert.deepStrictEqual([r.checked, r.checked_at], [false, null]);
    assert.deepStrictEqual(c.S.sessionIngredientState.ps1.byItemKey.vi1, { checked: false, checkedAt: null });
  });

  await test('D+F: PATCH mirata su (session_id, item_key), solo checked/checked_at, nessun INSERT/UPSERT', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.toggleSessionIngredient('ps1', 'vi2');
    const writes = fake.calls.filter(x => x.method !== 'GET');
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].method, 'PATCH');
    assert.deepStrictEqual(writes[0].filters, [['session_id', 'eq', 'ps1'], ['item_key', 'eq', 'vi2']]);
    assert.deepStrictEqual(Object.keys(writes[0].body).sort(), ['checked', 'checked_at']);
    assert.strictEqual(fake.tables.session_ingredient_state.length, 5, 'nessuna riga creata');
    assert.ok(!c.apiCalls.some(b => b.supabaseAction === 'update' || b.supabaseAction === 'save'), 'nessun upsert generico');
  });

  await test('E: zero righe aggiornate -> errore, nessun falso successo, stato precedente', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    fake.tables.session_ingredient_state = fake.tables.session_ingredient_state.filter(r => !(r.session_id === 'ps1' && r.item_key === 'vi3'));
    await c.api.toggleSessionIngredient('ps1', 'vi3');
    assert.deepStrictEqual(c.S.sessionIngredientState.ps1.byItemKey.vi3, { checked: false, checkedAt: null });
    assert.deepStrictEqual(c.toasts, ['Spunta non salvata. Riprova.']);
    assert.strictEqual(fake.tables.session_ingredient_state.filter(r => r.session_id === 'ps1').length, 2, 'riga non ricreata');
    // errore HTTP del server: stessa gestione
    fake.fail('session_ingredient_state:PATCH');
    await c.api.toggleSessionIngredient('ps1', 'vi1');
    assert.strictEqual(c.S.sessionIngredientState.ps1.byItemKey.vi1.checked, false);
    assert.strictEqual(c.toasts.length, 2);
    // piu' di una riga -> errore (difensivo: il vincolo unico lo impedisce nel DB reale)
    fake.heal('session_ingredient_state:PATCH');
    fake.tables.session_ingredient_state.push({ id: 'dup', session_id: 'ps1', item_key: 'vi1', checked: false, checked_at: null });
    let out;
    await handler({ method: 'POST', body: { supabaseAction: 'setSessionIngredientChecked', sessionId: 'ps1', itemKey: 'vi1', checked: true } }, { status() { return this; }, json(o) { out = o; return this; } });
    assert.ok(out.error && !out.ok, 'due righe aggiornate = errore');
  });

  await test('G: isolamento — la spunta di una Sessione non tocca l\'altra con lo stesso item_key', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.toggleSessionIngredient('ps1', 'vi1');
    assert.strictEqual(dbRow(fake, 'ps1', 'vi1').checked, true);
    assert.strictEqual(dbRow(fake, 'ps2', 'vi1').checked, false);
    assert.strictEqual(dbRow(fake, 'ps2', 'vi2').checked, true);
  });

  await test('H+I: snapshot e Ricetta sorgente invariati', async () => {
    freshDb();
    const recipes = [{ id: 'r1', name: 'Risotto', validatedVariants: [{ id: 'vv1', ingredients: [{ id: 'vi1', name: 'Porcini', qty: 500, unit: 'g' }] }] }];
    const sess = sessions();
    const c = makeClient(handler, sess, recipes);
    const snapPrima = JSON.stringify(sess.map(s => s.snapshot));
    const ricettePrima = JSON.stringify(recipes);
    await open(c, 'ps1');
    await c.api.toggleSessionIngredient('ps1', 'vi1');
    await c.api.toggleSessionIngredient('ps1', 'vi2');
    assert.strictEqual(JSON.stringify(c.S.productionSessions.map(s => s.snapshot)), snapPrima);
    assert.strictEqual(JSON.stringify(c.S.recipes), ricettePrima);
    assert.ok(!c.apiCalls.some(b => /production_sessions|recipes|ingredients/.test(JSON.stringify(b.table || ''))), 'nessuna scrittura su Sessione/Ricette');
  });

  await test('J: riga di stato mancante -> spunta non utilizzabile, mai creata', async () => {
    const fake = freshDb();
    const c = makeClient(handler, [makeSession('ps1', 'in_progress', ['vi1', 'vi2', 'vi3', 'viNuovo'])]);
    await open(c, 'ps1');
    const html = c.api.renderSessioneOperativa();
    assert.match(html, /title="Spunta non disponibile per questo ingrediente" disabled/);
    await c.api.toggleSessionIngredient('ps1', 'viNuovo');
    assert.deepStrictEqual(c.toasts, ['Spunta non disponibile per questo ingrediente.']);
    assert.strictEqual(fake.calls.filter(x => x.method !== 'GET').length, 0);
    // Sessione senza alcuna riga di stato: tutte non utilizzabili, nessun crash
    const c2 = makeClient(handler, [makeSession('psVuota', 'in_progress', ['a', 'b'])]);
    await open(c2, 'psVuota');
    assert.strictEqual(c2.S.sessionIngredientState.psVuota.status, 'loaded');
    assert.strictEqual((c2.api.renderSessioneOperativa().match(/class="ms12-check"[^>]* disabled/g) || []).length, 2);
  });

  await test('K: doppio click / scrittura concorrente sulla stessa riga -> una sola PATCH', async () => {
    const fake = freshDb();
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    const p1 = c.api.toggleSessionIngredient('ps1', 'vi1');
    assert.match(c.api.renderSessioneOperativa(), /ti-loader-2/, 'riga bloccata durante la scrittura');
    const p2 = c.api.toggleSessionIngredient('ps1', 'vi1');
    await Promise.all([p1, p2]);
    assert.strictEqual(fake.calls.filter(x => x.method === 'PATCH').length, 1);
    assert.strictEqual(dbRow(fake, 'ps1', 'vi1').checked, true, 'nessun doppio toggle');
    // righe diverse restano indipendenti
    await Promise.all([c.api.toggleSessionIngredient('ps1', 'vi2'), c.api.toggleSessionIngredient('ps1', 'vi3')]);
    assert.deepStrictEqual([dbRow(fake, 'ps1', 'vi2').checked, dbRow(fake, 'ps1', 'vi3').checked], [true, true]);
  });

  await test('Rientro / reload: lo stato viene riletto dal DB (spunta e rimozione)', async () => {
    const fake = freshDb();
    let c = makeClient(handler, sessions());
    await open(c, 'ps1');
    await c.api.toggleSessionIngredient('ps1', 'vi1');
    c.S.view = 'produzione-guidata';
    await open(c, 'ps1'); // esci e rientra
    assert.strictEqual(c.S.sessionIngredientState.ps1.byItemKey.vi1.checked, true);
    c = makeClient(handler, sessions()); // reload del browser
    await open(c, 'ps1');
    assert.strictEqual(c.S.sessionIngredientState.ps1.byItemKey.vi1.checked, true);
    await c.api.toggleSessionIngredient('ps1', 'vi1');
    c = makeClient(handler, sessions());
    await open(c, 'ps1');
    assert.strictEqual(c.S.sessionIngredientState.ps1.byItemKey.vi1.checked, false);
  });

  await test('Lettura fallita -> avviso con Riprova, spunte non utilizzabili, nessuna scrittura', async () => {
    const fake = freshDb();
    fake.fail('session_ingredient_state:GET');
    const c = makeClient(handler, sessions());
    await open(c, 'ps1');
    assert.strictEqual(c.S.sessionIngredientState.ps1.status, 'error');
    const html = c.api.renderSessioneOperativa();
    assert.match(html, /Non riesco a caricare le spunte/);
    assert.strictEqual((html.match(/class="ms12-check"[^>]* disabled/g) || []).length, 3);
    await c.api.toggleSessionIngredient('ps1', 'vi1');
    assert.strictEqual(fake.calls.filter(x => x.method === 'PATCH').length, 0);
    fake.heal('session_ingredient_state:GET');
    await c.api.loadSessionIngredientState('ps1');
    assert.strictEqual(c.S.sessionIngredientState.ps1.status, 'loaded');
  });

  await test('Sessione non in corso -> nessuna spunta modificabile', async () => {
    const fake = freshDb();
    const c = makeClient(handler, [makeSession('ps1', 'completed', ['vi1'])]);
    await open(c, 'ps1');
    await c.api.toggleSessionIngredient('ps1', 'vi1');
    assert.strictEqual(fake.calls.filter(x => x.method === 'PATCH').length, 0);
    assert.match(c.api.renderSessioneOperativa(), / disabled/);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
