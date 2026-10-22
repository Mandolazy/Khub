/**
 * Accesso privato — test di accesso non autorizzato.
 *
 * Verifica, senza rete e senza Supabase reale:
 *  - middleware.js (primo controllo): login, cookie HMAC, sessioni,
 *    allowlist dei percorsi, CSRF, limitazione dei tentativi, fail-closed;
 *  - api/chat.js (secondo controllo, indipendente): nessuna azione
 *    (Supabase, fetchUrl, Anthropic) senza sessione valida e same-origin;
 *  - compatibilita' del formato di sessione tra i due controlli;
 *  - .vercelignore: nel deployment entrano solo i file dell'allowlist.
 *
 * Uso: node scripts/test-security-access.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SECRET = 'unit-test-session-secret-0123456789abcdef';
const PASSWORD = 'unit-test-password-0123';
const HOST = 'khub.example';
const ORIGIN = 'https://' + HOST;

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    ')); }
}

function importSource(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

function setEnv(secret, password) {
  if (secret === undefined) delete process.env.KHUB_SESSION_SECRET; else process.env.KHUB_SESSION_SECRET = secret;
  if (password === undefined) delete process.env.KHUB_ACCESS_PASSWORD; else process.env.KHUB_ACCESS_PASSWORD = password;
}

function req(pathname, opts) {
  const o = opts || {};
  const headers = Object.assign({ host: HOST }, o.headers || {});
  if (o.cookie) headers.cookie = o.cookie;
  return new Request(ORIGIN + pathname, { method: o.method || 'GET', headers, body: o.body });
}

function loginReq(password, extraHeaders) {
  return req('/__khub/login', {
    method: 'POST',
    headers: Object.assign({ origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '203.0.113.10' }, extraHeaders || {}),
    body: new URLSearchParams({ username: 'khub', password }).toString(),
  });
}

const isNext = r => r.status === 200 && r.headers.get('x-middleware-next') === '1';

// Risposta finta per l'handler Node.
function fakeRes() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } };
}

(async () => {
  const mw = await importSource('middleware.js');
  const handler = (await importSource('api/chat.js')).default;
  const middleware = mw.default;
  const now = () => Date.now() / 1000;

  // Ogni chiamata in uscita dell'handler (Supabase, Anthropic, fetchUrl) passa
  // da qui: senza autorizzazione non deve partirne nessuna.
  const outbound = [];
  globalThis.fetch = async (url, init) => {
    outbound.push(String(url));
    return { ok: true, status: 200, json: async () => [], text: async () => '' };
  };
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_only_not_a_real_key';

  const validCookie = async (secret) => '__Host-khub_session=' + await mw.createSessionToken(secret || SECRET, now());

  console.log('Accesso privato — middleware.js');

  await test('fail-closed: variabili assenti -> 503 su pagine, API e login', async () => {
    setEnv(undefined, undefined);
    for (const r of [req('/'), req('/khub_mvp.html'), req('/api/chat', { method: 'POST' }), loginReq(PASSWORD)]) {
      assert.strictEqual((await middleware(r)).status, 503);
    }
  });

  await test('fail-closed: segreto o password troppo corti -> 503', async () => {
    setEnv('corto', PASSWORD);
    assert.strictEqual((await middleware(req('/'))).status, 503);
    setEnv(SECRET, 'corta');
    assert.strictEqual((await middleware(req('/'))).status, 503);
  });

  setEnv(SECRET, PASSWORD);

  await test('senza sessione: le pagine mostrano solo il login (401), mai il contenuto', async () => {
    for (const p of ['/', '/index.html', '/khub_mvp.html', '/lib/baseline.js', '/lib/reconciliation.js']) {
      const r = await middleware(req(p));
      assert.strictEqual(r.status, 401, p);
      const body = await r.text();
      assert.match(body, /action="\/__khub\/login"/);
      assert.ok(!body.includes(PASSWORD) && !body.includes(SECRET), 'nessun segreto nella pagina');
      assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
      assert.strictEqual(r.headers.get('cache-control'), 'no-store');
      // 'no-referrer' farebbe inviare a Chrome "Origin: null" nel POST di login (-> 403).
      assert.strictEqual(r.headers.get('referrer-policy'), 'same-origin');
    }
  });

  await test('senza sessione: API e file tecnici -> 401, nessun passaggio', async () => {
    const paths = ['/api/chat', '/api/chat.js', '/api', '/supabase/migrations/0001_persistent_state_layer.sql',
      '/scripts/test-m1.js', '/package.json', '/vercel.json', '/middleware.js', '/.git/config', '/docs/migrations/0011_variants_declared_yield.md'];
    for (const p of paths) {
      for (const method of ['GET', 'POST']) {
        const r = await middleware(req(p, { method, headers: { origin: ORIGIN }, body: method === 'POST' ? '{"supabaseAction":"load"}' : undefined }));
        assert.strictEqual(r.status, 401, method + ' ' + p);
        assert.ok(!isNext(r));
      }
    }
  });

  await test('cookie non validi -> 401 (manomesso, scaduto, futuro, altro segreto, nome errato)', async () => {
    const good = await mw.createSessionToken(SECRET, now());
    const [, exp, sig] = good.split('.');
    const flip = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1);
    const past = await mw.createSessionToken(SECRET, now() - 31 * 24 * 3600);
    const future = await mw.createSessionToken(SECRET, now() + 3600);
    const other = await mw.createSessionToken('another-secret-that-is-long-enough-000', now());
    const cookies = [
      '__Host-khub_session=garbage', '__Host-khub_session=', '__Host-khub_session=v1.' + exp + '.' + flip,
      '__Host-khub_session=v1.' + (Number(exp) + 1) + '.' + sig, '__Host-khub_session=' + past,
      '__Host-khub_session=' + future, '__Host-khub_session=' + other, 'khub_session=' + good,
    ];
    for (const cookie of cookies) {
      assert.strictEqual((await middleware(req('/khub_mvp.html', { cookie }))).status, 401, cookie);
      assert.strictEqual((await middleware(req('/api/chat', { method: 'POST', cookie, headers: { origin: ORIGIN } }))).status, 401, cookie);
    }
  });

  await test('login: password errata -> 401, nessun cookie', async () => {
    mw.resetLoginLimiterForTests();
    const r = await middleware(loginReq('password-sbagliata-123456'));
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.headers.get('set-cookie'), null);
  });

  await test('login: password corretta -> 303 e cookie __Host- HttpOnly/Secure/SameSite=Strict valido', async () => {
    mw.resetLoginLimiterForTests();
    const r = await middleware(loginReq(PASSWORD));
    assert.strictEqual(r.status, 303);
    assert.strictEqual(r.headers.get('location'), '/');
    const sc = r.headers.get('set-cookie');
    assert.match(sc, /^__Host-khub_session=v1\.\d+\.[A-Za-z0-9_-]{43}; /);
    for (const attr of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=2592000']) assert.ok(sc.includes(attr), attr);
    assert.ok(!/Domain=/i.test(sc), 'nessun Domain');
    const cookie = sc.split(';')[0];
    assert.ok(isNext(await middleware(req('/khub_mvp.html', { cookie }))));
  });

  await test('login: password vuota, troppo lunga o con prefisso corretto -> 401', async () => {
    mw.resetLoginLimiterForTests();
    for (const p of ['', PASSWORD + 'x', PASSWORD.slice(0, -1), 'x'.repeat(5000)]) {
      mw.resetLoginLimiterForTests();
      assert.strictEqual((await middleware(loginReq(p))).status, 401, JSON.stringify(p.slice(0, 20)));
    }
  });

  await test('login CSRF: Origin estranea o assente senza Sec-Fetch-Site same-origin -> 403', async () => {
    mw.resetLoginLimiterForTests();
    assert.strictEqual((await middleware(loginReq(PASSWORD, { origin: 'https://evil.example' }))).status, 403);
    const noOrigin = req('/__khub/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' }, body: 'password=' + PASSWORD });
    assert.strictEqual((await middleware(noOrigin)).status, 403);
  });

  await test('limitazione tentativi per IP: al 6deg tentativo 429 anche con password corretta; altro IP non bloccato', async () => {
    mw.resetLoginLimiterForTests();
    // Concorrenti: il controllo e' atomico, quindi la concorrenza non aggira il limite.
    const rs = await Promise.all(Array.from({ length: 6 }, () => middleware(loginReq('sbagliata-0000000000'))));
    const codes = rs.map(r => r.status).sort();
    assert.deepStrictEqual(codes, [401, 401, 401, 401, 401, 429]);
    const blocked = await middleware(loginReq(PASSWORD));
    assert.strictEqual(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.strictEqual(blocked.headers.get('set-cookie'), null);
    const other = await middleware(loginReq(PASSWORD, { 'x-real-ip': '198.51.100.7' }));
    assert.strictEqual(other.status, 303);
  });

  await test('limitazione tentativi globale: oltre 30 tentativi da IP diversi -> 429 per tutti', async () => {
    mw.resetLoginLimiterForTests();
    await Promise.all(Array.from({ length: 30 }, (_, i) => middleware(loginReq('sbagliata-0000000000', { 'x-real-ip': '192.0.2.' + i }))));
    const r = await middleware(loginReq(PASSWORD, { 'x-real-ip': '198.51.100.99' }));
    assert.strictEqual(r.status, 429);
    mw.resetLoginLimiterForTests();
  });

  await test('sessione valida: solo i percorsi dell\'allowlist proseguono, ogni altro file del repository -> 404', async () => {
    const cookie = await validCookie();
    for (const p of mw.ALLOWED_PATHS.filter(p => !p.startsWith('/api/'))) assert.ok(isNext(await middleware(req(p, { cookie }))), p);
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const allowed = new Set(mw.ALLOWED_PATHS);
    for (const f of tracked.concat(['.git/config', '.env', '.env.local', '.vercel/project.json', 'api/chat.js', 'api'])) {
      const p = '/' + f;
      if (allowed.has(p)) continue;
      const r = await middleware(req(p, { cookie }));
      assert.strictEqual(r.status, 404, p);
    }
  });

  await test('sessione valida + API: Origin estranea o assente -> 403; same-origin -> prosegue', async () => {
    const cookie = await validCookie();
    assert.strictEqual((await middleware(req('/api/chat', { method: 'POST', cookie, headers: { origin: 'https://evil.example' } }))).status, 403);
    assert.strictEqual((await middleware(req('/api/chat', { method: 'POST', cookie }))).status, 403);
    assert.ok(isNext(await middleware(req('/api/chat', { method: 'POST', cookie, headers: { origin: ORIGIN } }))));
    assert.ok(isNext(await middleware(req('/api/chat', { method: 'POST', cookie, headers: { 'sec-fetch-site': 'same-origin' } }))));
  });

  await test('logout: cookie cancellato e ritorno al login; login con sessione -> redirect all\'app', async () => {
    const r = await middleware(req('/__khub/logout'));
    assert.strictEqual(r.status, 303);
    assert.strictEqual(r.headers.get('location'), '/__khub/login');
    assert.match(r.headers.get('set-cookie'), /^__Host-khub_session=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Strict$/);
    const cookie = await validCookie();
    const g = await middleware(req('/__khub/login', { cookie }));
    assert.strictEqual(g.status, 303);
    assert.strictEqual(g.headers.get('location'), '/');
    assert.strictEqual((await middleware(req('/__khub/login'))).status, 200);
  });

  console.log('Accesso privato — api/chat.js (secondo controllo)');

  const ATTACK_BODIES = [
    { supabaseAction: 'load' },
    { supabaseAction: 'update', table: 'recipes', data: { id: 'x' } },
    { supabaseAction: 'delete', table: 'recipes', id: 'x' },
    { fetchUrl: 'http://169.254.169.254/' },
    { mode: 'm1' },
    { model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] },
  ];

  async function callHandler(reqObj) {
    const res = fakeRes();
    await handler(reqObj, res);
    return res;
  }

  await test('handler: variabili assenti -> 503 e nessuna chiamata in uscita', async () => {
    setEnv(undefined, undefined);
    outbound.length = 0;
    const res = await callHandler({ method: 'POST', headers: { host: HOST, origin: ORIGIN, cookie: await validCookie() }, body: { supabaseAction: 'load' } });
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(outbound.length, 0);
    setEnv(SECRET, PASSWORD);
  });

  await test('handler: senza sessione -> 401 per ogni azione, nessuna chiamata a Supabase/Anthropic/URL esterni', async () => {
    outbound.length = 0;
    for (const body of ATTACK_BODIES) {
      for (const headers of [undefined, { host: HOST, origin: ORIGIN }]) {
        const res = await callHandler({ method: 'POST', headers, body });
        assert.strictEqual(res.statusCode, 401, JSON.stringify(body));
      }
    }
    assert.strictEqual(outbound.length, 0);
  });

  await test('handler: cookie non validi -> 401, nessuna chiamata in uscita', async () => {
    outbound.length = 0;
    const good = await mw.createSessionToken(SECRET, now());
    const [, exp, sig] = good.split('.');
    const flip = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1);
    const bad = ['garbage', 'v1.' + exp + '.' + flip, await mw.createSessionToken(SECRET, now() - 31 * 24 * 3600),
      await mw.createSessionToken(SECRET, now() + 3600), await mw.createSessionToken('another-secret-that-is-long-enough-000', now())];
    for (const t of bad) {
      const res = await callHandler({ method: 'POST', headers: { host: HOST, origin: ORIGIN, cookie: '__Host-khub_session=' + t }, body: { supabaseAction: 'load' } });
      assert.strictEqual(res.statusCode, 401, t);
    }
    assert.strictEqual(outbound.length, 0);
  });

  await test('handler: sessione valida ma Origin estranea o assente -> 403, nessuna chiamata in uscita', async () => {
    outbound.length = 0;
    const cookie = await validCookie();
    for (const h of [{ origin: 'https://evil.example' }, {}, { 'sec-fetch-site': 'cross-site' }, { origin: 'not a url' }]) {
      const res = await callHandler({ method: 'POST', headers: Object.assign({ host: HOST, cookie }, h), body: { supabaseAction: 'delete', table: 'recipes', id: 'x' } });
      assert.strictEqual(res.statusCode, 403, JSON.stringify(h));
    }
    assert.strictEqual(outbound.length, 0);
  });

  await test('handler: sessione valida same-origin -> l\'azione viene eseguita come prima', async () => {
    outbound.length = 0;
    const cookie = await validCookie();
    const res = await callHandler({ method: 'POST', headers: { host: HOST, origin: ORIGIN, cookie }, body: { supabaseAction: 'load' } });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(outbound.some(u => u.startsWith('https://fake.supabase/rest/v1/recipes')));
    const viaFetchSite = await callHandler({ method: 'POST', headers: { host: HOST, 'sec-fetch-site': 'same-origin', cookie }, body: { supabaseAction: 'load' } });
    assert.strictEqual(viaFetchSite.statusCode, 200);
  });

  await test('handler: GET con sessione valida -> 405 (comportamento esistente invariato)', async () => {
    const res = await callHandler({ method: 'GET', headers: { host: HOST, origin: ORIGIN, cookie: await validCookie() } });
    assert.strictEqual(res.statusCode, 405);
  });

  await test('compatibilita\': un token emesso dal middleware vale per l\'handler e viceversa per i rifiuti', async () => {
    mw.resetLoginLimiterForTests();
    const login = await middleware(loginReq(PASSWORD));
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const res = await callHandler({ method: 'POST', headers: { host: HOST, origin: ORIGIN, cookie }, body: { supabaseAction: 'load' } });
    assert.strictEqual(res.statusCode, 200);
    setEnv('rotated-secret-that-is-long-enough-0000', PASSWORD);
    assert.strictEqual((await middleware(req('/khub_mvp.html', { cookie }))).status, 401, 'rotazione segreto: middleware');
    const res2 = await callHandler({ method: 'POST', headers: { host: HOST, origin: ORIGIN, cookie }, body: { supabaseAction: 'load' } });
    assert.strictEqual(res2.statusCode, 401, 'rotazione segreto: handler');
    setEnv(SECRET, PASSWORD);
  });

  console.log('Asset pubblicati — .vercelignore');

  await test('.vercelignore: nel deployment entrano solo i file dell\'app, nessun file tecnico', async () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const candidates = Array.from(new Set(tracked.concat(['middleware.js', '.vercelignore', 'scripts/test-security-access.js', 'scripts/_khub-test-session.js', '.env', '.env.local'])));
    let ignored = '';
    try {
      ignored = execFileSync('git', ['-c', 'core.excludesFile=' + path.join(ROOT, '.vercelignore'), 'check-ignore', '--no-index', '--stdin'],
        { cwd: ROOT, encoding: 'utf8', input: candidates.join('\n') });
    } catch (e) { ignored = e.stdout || ''; }
    const ignoredSet = new Set(ignored.split('\n').filter(Boolean));
    const uploaded = candidates.filter(f => !ignoredSet.has(f)).sort();
    assert.deepStrictEqual(uploaded, ['api/chat.js', 'index.html', 'khub_mvp.html', 'lib/baseline.js', 'lib/reconciliation.js', 'middleware.js', 'package.json', 'vercel.json']);
    // Tra i file caricati, solo quelli dell'allowlist sono serviti (gli altri -> 404 dal middleware).
    const served = uploaded.filter(f => mw.ALLOWED_PATHS.includes('/' + f));
    assert.deepStrictEqual(served, ['index.html', 'khub_mvp.html', 'lib/baseline.js', 'lib/reconciliation.js']);
  });

  await test('khub_mvp.html carica solo script locali presenti nell\'allowlist', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
    const local = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g)).map(m => m[1]).filter(s => !/^(https?:)?\/\//.test(s));
    assert.ok(local.length > 0);
    for (const s of local) assert.ok(mw.ALLOWED_PATHS.includes('/' + s.replace(/^\//, '')), s);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
