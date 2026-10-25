/**
 * Chiave Supabase secret — test di sicurezza e compatibilita' (api/chat.js).
 *
 * Verifica, con un Supabase simulato (nessuna rete):
 *  - la chiave arriva SOLO nell'header apikey, mai in Authorization, mai nel
 *    browser (risposte) ne' nei log; SUPABASE_ANON_KEY non e' piu' usata;
 *  - fail-closed: chiave assente/non secret o SUPABASE_URL non valido ->
 *    503 e nessuna chiamata al database; MichelinAI non dipende dal database;
 *  - nessun parametro del client puo' portare una richiesta fuori da
 *    /rest/v1/<tabella nota> (servizi amministrativi Auth/Storage, RPC, altri
 *    host) ne' aggiungere filtri: "fuzz" su ogni campo stringa di ogni azione;
 *  - azioni generiche update/delete: allowlist di tabelle, colonne, valori, id.
 *
 * Uso: node scripts/test-supabase-secret-key.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { withTestSession } = require('./_khub-test-session');

const ROOT = path.join(__dirname, '..');
const chatSrc = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
const SECRET = 'sb_secret_SENTINELLA_9f8e7d6c5b4a';
const SB_URL = 'https://progetto-finto.supabase.co';
const TABLES = ['recipes', 'variants', 'ingredients', 'l2_items', 'l3_items', 'families', 'variant_families',
  'ingredient_conversions', 'm2_turns', 'production_sessions', 'session_ingredient_state', 'session_step_state', 'session_notes'];

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n    ')); }
}

// Supabase e Anthropic simulati: registrano ogni richiesta in uscita.
const calls = [];
let supabaseFails = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
  const json = (status, obj) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (u.startsWith('https://api.anthropic.com/')) return json(200, { content: [{ type: 'text', text: 'ok' }] });
  if (supabaseFails) return { ok: false, status: 500, json: async () => ({}), text: async () => 'errore simulato del database' };
  const q = new URL(u).searchParams;
  const id = (q.get('id') || q.get('session_id') || 'x').replace(/^eq\./, '');
  const method = init.method || 'GET';
  // Letture paginate (offset>0): pagina vuota, cosi' la paginazione termina.
  if (method === 'GET') return json(200, u.includes('/production_sessions') && !(Number(q.get('offset')) > 0) ? [{ id, status: 'in_progress' }] : []);
  if (method === 'PATCH') return json(200, [Object.assign({ id }, JSON.parse(init.body || '{}'))]);
  if (method === 'POST') return json(201, [Object.assign({ id: 'n1', created_at: '2026-10-22T10:00:00Z' }, JSON.parse(init.body || '{}'))]);
  return json(204, null);
};

// Un modello valido per OGNI azione che tocca il database.
const NOW = '2026-10-22T10:00:00.000Z';
const ACTIONS = {
  loadFamilies: {},
  saveFamily: { family: { id: 'f1', name: 'Dolci' } },
  saveVariantFamilies: { variantId: 'v1', familyIds: ['f1', 'f2'] },
  loadConversions: {},
  saveConversion: { conversion: { id: 'c1', ingredient_name: 'uova', from_unit: 'n', to_unit: 'g', factor: 55, source_type: 'chef_confirmed' } },
  loadM2Turns: { variantId: 'v1' },
  saveM2Turn: { turn: { id: 't1', variant_id: 'v1', question: 'Domanda', response: 'Risposta', created_at: NOW } },
  loadProductionSessions: {},
  loadSessionIngredientState: { sessionId: 'ps1' },
  setSessionIngredientChecked: { sessionId: 'ps1', itemKey: 'k1', checked: true },
  loadSessionStepState: { sessionId: 'ps1' },
  setSessionStepChecked: { sessionId: 'ps1', itemKey: 's1', checked: true },
  startProductionSession: { sessionId: 'ps1' },
  completeProductionSession: { sessionId: 'ps1', actualYield: { qty: 2, unit: 'kg' } },
  loadSessionNotes: { sessionId: 'ps1' },
  addSessionNote: { note: { id: 'n1', session_id: 'ps1', text: 'Nota' } },
  startSessionStepTimer: { sessionId: 'ps1', itemKey: 's1' },
  cancelSessionStepTimer: { sessionId: 'ps1', itemKey: 's1', expectedStartedAt: NOW },
  load: {},
  save: { data: { recipe: { id: 'r1', name: 'Torta' }, variants: [{ id: 'v1', recipe_id: 'r1', name: 'Classica' }],
    ingredients: [{ id: 'i1', variant_id: 'v1', name: 'Farina' }], deletedIngredients: [{ id: 'i9', variant_id: 'v1' }],
    l2Items: [{ id: 'l2a', variant_id: 'v1' }], l3Items: [{ id: 'l3a', recipe_id: 'r1' }] } },
  updateDeclaredYield: { variantId: 'v1', recipeId: 'r1', qty: 2, unit: 'kg' },
  update: { table: 'session_step_state', data: [{ id: 'pss1', session_id: 'ps1', item_key: 's1', checked: false, checked_at: null, timer_started_at: null, timer_actual_seconds: null }] },
  delete: { table: 'variants', id: 'v1' },
  updateVariantName: { variantId: 'v1', recipeId: 'r1', name: 'Nuovo nome' },
};

const ATTACKS = ['../../auth/v1/admin/users', '%2e%2e/%2e%2e/storage/v1/bucket', '..%2f..%2fauth/v1/admin/users',
  '/auth/v1/admin/users', 'https://evil.example/x', 'rpc/funzione', 'recipes?select=*', 'x&or=(id.not.is.null)',
  'x#frammento', 'x\r\nHost: evil.example', '..\\..\\auth', 'x&on_conflict=name', 'x;drop'];

function clone(o) { return JSON.parse(JSON.stringify(o)); }
// Tutti i percorsi dei campi stringa di un oggetto annidato.
function stringPaths(o, pre = []) {
  if (typeof o === 'string') return [pre];
  if (o && typeof o === 'object') return Object.keys(o).flatMap(k => stringPaths(o[k], pre.concat(k)));
  return [];
}
function setPath(o, p, v) { let x = o; for (let i = 0; i < p.length - 1; i++) x = x[p[i]]; x[p[p.length - 1]] = v; }
const paramKeys = u => Array.from(new URL(u).searchParams.keys()).sort().join(',');

function assertSafe(c, ctx) {
  const u = new URL(c.url);
  assert.strictEqual(u.origin, SB_URL, ctx + ': host diverso ' + c.url);
  const m = /^\/rest\/v1\/([a-z_0-9]+)$/.exec(u.pathname);
  assert.ok(m && TABLES.includes(m[1]), ctx + ': percorso non ammesso ' + u.pathname);
  const h = Object.fromEntries(Object.entries(c.headers).map(([k, v]) => [k.toLowerCase(), v]));
  assert.strictEqual(h.apikey, SECRET, ctx + ': apikey');
  assert.ok(!('authorization' in h), ctx + ': Authorization presente');
  assert.ok(!('accept-profile' in h) && !('content-profile' in h), ctx + ': cambio di schema');
}

(async () => {
  process.env.SUPABASE_URL = SB_URL;
  process.env.SUPABASE_SECRET_KEY = SECRET;
  const handler = await withTestSession((await import('data:text/javascript;base64,' + Buffer.from(chatSrc).toString('base64'))).default);
  async function call(body) {
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { status, out };
  }

  console.log('Chiave Supabase secret — api/chat.js');

  await test('codice: nessun uso di SUPABASE_ANON_KEY ne\' di Authorization verso Supabase', async () => {
    assert.ok(!/SUPABASE_ANON_KEY/.test(chatSrc));
    assert.ok(!/Authorization:\s*'Bearer '\s*\+\s*SK/.test(chatSrc));
    const dyn = chatSrc.match(/'\/rest\/v1\/'\s*\+\s*[A-Za-z_.]+/g) || [];
    assert.deepStrictEqual(dyn.sort(), ["'/rest/v1/' + path", "'/rest/v1/' + table", "'/rest/v1/' + table"].sort(), 'solo i 3 percorsi dinamici protetti');
  });

  await test('ogni azione: solo /rest/v1/<tabella nota> sull\'host configurato, chiave solo in apikey', async () => {
    for (const [action, extra] of Object.entries(ACTIONS)) {
      calls.length = 0;
      const r = await call(Object.assign({ supabaseAction: action }, clone(extra)));
      assert.ok(r.status === 200, action + ': stato ' + r.status + ' ' + JSON.stringify(r.out));
      assert.ok(calls.length > 0, action + ': nessuna chiamata');
      calls.forEach(c => assertSafe(c, action));
    }
  });

  await test('fuzz: nessun campo del client porta fuori da /rest/v1/<tabella> o aggiunge filtri', async () => {
    let casi = 0;
    for (const [action, extra] of Object.entries(ACTIONS)) {
      calls.length = 0; await call(Object.assign({ supabaseAction: action }, clone(extra)));
      const base = calls.map(c => c.method + ' ' + new URL(c.url).pathname + ' ' + paramKeys(c.url));
      for (const p of stringPaths(extra)) {
        for (const a of ATTACKS) {
          const b = clone(extra); setPath(b, p, a);
          calls.length = 0; casi++;
          const r = await call(Object.assign({ supabaseAction: action }, b));
          assert.ok(r.status !== 500, action + '.' + p.join('.') + '=' + JSON.stringify(a) + ': errore 500');
          calls.forEach(c => assertSafe(c, action + '.' + p.join('.') + '=' + JSON.stringify(a)));
          // Stesse richieste (o un sottoinsieme se rifiutata): nessun filtro o parametro aggiunto.
          const got = calls.map(c => c.method + ' ' + new URL(c.url).pathname + ' ' + paramKeys(c.url));
          got.forEach((g, i) => assert.strictEqual(g, base[i], action + '.' + p.join('.') + '=' + JSON.stringify(a) + ': richiesta alterata'));
        }
      }
    }
    assert.ok(casi > 300, 'casi provati: ' + casi);
  });

  await test('fail-closed: chiave assente, non secret o URL non valido -> 503 e nessuna chiamata', async () => {
    const bad = [
      [undefined, SB_URL], ['', SB_URL], ['eyJhbGciOiJIUzI1NiJ9.legacy.jwt', SB_URL], ['sb_publishable_abcdefgh123', SB_URL],
      [SECRET, undefined], [SECRET, 'http://progetto-finto.supabase.co'], [SECRET, SB_URL + '/rest/v1'], [SECRET, 'https://u:p@progetto-finto.supabase.co'],
      [SECRET, SB_URL + '?x=1'], [SECRET, 'non un url'],
    ];
    for (const [key, url] of bad) {
      if (key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = key;
      if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
      for (const action of Object.keys(ACTIONS)) {
        calls.length = 0;
        const r = await call(Object.assign({ supabaseAction: action }, clone(ACTIONS[action])));
        assert.strictEqual(r.status, 503, action + ' con ' + JSON.stringify([key, url]));
        assert.strictEqual(r.out.code, 'db_config');
        assert.strictEqual(calls.length, 0, action + ': chiamate in uscita');
      }
    }
    process.env.SUPABASE_URL = SB_URL; process.env.SUPABASE_SECRET_KEY = SECRET;
  });

  await test('MichelinAI e import non dipendono dalla chiave del database', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    calls.length = 0;
    const r = await call({ model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'ciao' }] });
    assert.strictEqual(r.status, 200);
    assert.ok(calls.length === 1 && calls[0].url.startsWith('https://api.anthropic.com/'));
    process.env.SUPABASE_SECRET_KEY = SECRET;
  });

  await test('la chiave non compare mai nelle risposte ne\' nei log, anche in caso di errore', async () => {
    const logs = [];
    const orig = { error: console.error, log: console.log, warn: console.warn };
    console.error = console.warn = (...a) => logs.push(a.map(String).join(' '));
    try {
      for (const fail of [false, true]) {
        supabaseFails = fail;
        for (const [action, extra] of Object.entries(ACTIONS)) {
          const r = await call(Object.assign({ supabaseAction: action }, clone(extra)));
          assert.ok(!JSON.stringify(r.out || {}).includes(SECRET), action + ': chiave nella risposta');
        }
      }
    } finally { supabaseFails = false; Object.assign(console, orig); }
    assert.ok(!logs.join('\n').includes(SECRET), 'chiave nei log');
  });

  await test('update: ammessa la creazione reale di una Sessione (righe come nel client)', async () => {
    const snapshot = { snapshotVersion: 1, ingredients: [{ itemKey: 'k1' }], steps: [{ stepId: 's1' }] };
    const ok = [
      ['production_sessions', { id: 'psA', recipe_id: 'r1', source_variant_id: 'v1', status: 'pending', snapshot_version: 1, snapshot,
        target_finished_total: 2000, started_at: null, completed_at: null, actual_yield_qty: null, actual_yield_unit: null }],
      ['session_ingredient_state', [{ id: 'pisA', session_id: 'psA', item_key: 'k1', checked: false, checked_at: null }]],
      ['session_step_state', [{ id: 'pssA', session_id: 'psA', item_key: 's1', checked: false, checked_at: null, timer_started_at: null, timer_actual_seconds: null }]],
    ];
    for (const [table, data] of ok) {
      calls.length = 0;
      const r = await call({ supabaseAction: 'update', table, data });
      assert.deepStrictEqual(r.out, { ok: true }, table);
      assert.strictEqual(calls.length, 1); assertSafe(calls[0], table);
      assert.strictEqual(new URL(calls[0].url).pathname, '/rest/v1/' + table);
      assert.deepStrictEqual(JSON.parse(calls[0].body), data, table + ': corpo invariato');
    }
  });

  await test('update: rifiutati tabelle, colonne, valori e id non ammessi (nessuna chiamata)', async () => {
    const row = { id: 'psA', recipe_id: 'r1', status: 'pending', snapshot_version: 1, snapshot: {}, target_finished_total: 1 };
    const bad = [
      ['recipes', { id: 'r1' }], ['families', { id: 'f1' }], ['canonical_ingredients', { id: 'c1' }], ['../../auth/v1/admin/users', { email: 'x' }],
      ['rpc/x', {}], [['production_sessions'], row], [undefined, row], ['__proto__', row], ['constructor', row],
      ['production_sessions', Object.assign({}, row, { status: 'completed' })],
      ['production_sessions', Object.assign({}, row, { completed_at: NOW })],
      ['production_sessions', Object.assign({}, row, { started_at: NOW })],
      ['production_sessions', Object.assign({}, row, { actual_yield_qty: 5 })],
      ['production_sessions', Object.assign({}, row, { created_at: NOW })],
      ['production_sessions', [row]], ['production_sessions', Object.assign({}, row, { id: '' })],
      ['production_sessions', Object.assign({}, row, { id: 'x'.repeat(201) })], ['production_sessions', null], ['production_sessions', 'testo'],
      ['session_step_state', [{ id: 'a', session_id: 's', item_key: 'k', checked: true }]],
      ['session_step_state', [{ id: 'a', session_id: 's', item_key: 'k', timer_started_at: NOW }]],
      ['session_step_state', [{ id: 'a', session_id: 's', item_key: 'k', timer_actual_seconds: 30 }]],
      ['session_ingredient_state', [{ id: 'a', session_id: 's', item_key: 'k', checked_at: NOW }]],
      ['session_ingredient_state', [{ id: 'a', session_id: 's' }]],
      ['session_ingredient_state', [{ id: 'a', session_id: 's', item_key: 'k', extra: 1 }]],
      ['session_ingredient_state', []], ['session_ingredient_state', Array.from({ length: 1001 }, (_, i) => ({ id: 'a' + i, session_id: 's', item_key: 'k' }))],
    ];
    for (const [table, data] of bad) {
      calls.length = 0;
      const r = await call({ supabaseAction: 'update', table, data });
      assert.strictEqual(r.status, 400, JSON.stringify([table, data]).slice(0, 120));
      assert.strictEqual(calls.length, 0);
    }
  });

  await test('delete: solo recipes/variants/production_sessions, id codificato, Sessioni solo se pending', async () => {
    for (const [table, id] of [['recipes', 'r1'], ['variants', 'v&x=1'], ['production_sessions', 'ps1']]) {
      calls.length = 0;
      const r = await call({ supabaseAction: 'delete', table, id });
      assert.deepStrictEqual(r.out, { ok: true });
      assert.strictEqual(calls.length, 1); assertSafe(calls[0], 'delete');
      const q = new URL(calls[0].url).searchParams;
      assert.strictEqual(calls[0].method, 'DELETE');
      assert.strictEqual(q.get('id'), 'eq.' + id);
      assert.deepStrictEqual(Array.from(q.keys()), table === 'production_sessions' ? ['id', 'status'] : ['id']);
      if (table === 'production_sessions') assert.strictEqual(q.get('status'), 'eq.pending');
    }
    const bad = [['ingredients', 'i1'], ['families', 'f1'], ['session_notes', 'n1'], ['../../auth/v1/admin/users', 'x'], ['recipes', ''],
      ['recipes', 123], ['recipes', ['r1']], ['recipes', 'x'.repeat(201)], [undefined, 'r1']];
    for (const [table, id] of bad) {
      calls.length = 0;
      const r = await call({ supabaseAction: 'delete', table, id });
      assert.strictEqual(r.status, 400, JSON.stringify([table, id]));
      assert.strictEqual(calls.length, 0);
    }
  });

  await test('saveVariantFamilies: variante codificata e parametri verificati', async () => {
    calls.length = 0;
    await call({ supabaseAction: 'saveVariantFamilies', variantId: 'v1&id=not.is.null', familyIds: ['f1'] });
    const del = calls.find(c => c.method === 'DELETE');
    assert.deepStrictEqual(Array.from(new URL(del.url).searchParams.entries()), [['variant_id', 'eq.v1&id=not.is.null']]);
    for (const b of [{ familyIds: ['f1'] }, { variantId: '', familyIds: [] }, { variantId: 'v1', familyIds: 'f1' }, { variantId: 'v1', familyIds: [1] }, { variantId: ['v1'] }]) {
      calls.length = 0;
      const r = await call(Object.assign({ supabaseAction: 'saveVariantFamilies' }, b));
      assert.strictEqual(r.status, 400, JSON.stringify(b)); assert.strictEqual(calls.length, 0);
    }
    calls.length = 0;
    const r = await call({ supabaseAction: 'saveVariantFamilies', variantId: 'v1', familyIds: [] });
    assert.deepStrictEqual(r.out, { ok: true }); assert.strictEqual(calls.length, 1, 'solo la DELETE se non ci sono famiglie');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
