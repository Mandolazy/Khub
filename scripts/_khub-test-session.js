/**
 * Helper SOLO per i test locali: avvolge l'handler di api/chat.js in modo
 * che ogni chiamata porti una sessione valida e same-origin, come fa il
 * browser dopo il login. Il token e' generato da createSessionToken di
 * middleware.js: cosi' ogni suite verifica anche che middleware e API
 * accettino lo stesso formato di sessione.
 *
 * Imposta valori di test per KHUB_SESSION_SECRET / KHUB_ACCESS_PASSWORD solo
 * se assenti nell'ambiente del processo di test. Non e' mai caricato in
 * produzione (scripts/ e' escluso da .vercelignore).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEST_SECRET = 'test-only-khub-session-secret-not-for-production';
const TEST_PASSWORD = 'test-only-khub-password';
const TEST_HOST = 'khub.test';

let middlewarePromise = null;
function loadMiddleware() {
  if (!middlewarePromise) {
    const src = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
    middlewarePromise = import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  }
  return middlewarePromise;
}

// Chiave Supabase finta nel formato secret: le suite usano un fetch simulato,
// nessuna chiamata reale.
const TEST_SUPABASE_SECRET_KEY = 'sb_secret_test_only_not_a_real_key';

function ensureTestEnv() {
  if (!process.env.KHUB_SESSION_SECRET) process.env.KHUB_SESSION_SECRET = TEST_SECRET;
  if (!process.env.KHUB_ACCESS_PASSWORD) process.env.KHUB_ACCESS_PASSWORD = TEST_PASSWORD;
  if (!process.env.SUPABASE_SECRET_KEY) process.env.SUPABASE_SECRET_KEY = TEST_SUPABASE_SECRET_KEY;
}

async function testSessionCookie() {
  ensureTestEnv();
  const mw = await loadMiddleware();
  const token = await mw.createSessionToken(process.env.KHUB_SESSION_SECRET, Date.now() / 1000);
  return '__Host-khub_session=' + token;
}

// Asincrona: il cookie viene generato una volta, durante il caricamento
// dell'handler, cosi' le chiamate non aggiungono tick di attesa rispetto
// all'handler originale (alcune suite attendono con setTimeout(0)).
async function withTestSession(handler) {
  const cookie = await testSessionCookie();
  return async function (req, res) {
    const headers = Object.assign({ host: TEST_HOST, origin: 'https://' + TEST_HOST }, req && req.headers, { cookie });
    return handler(Object.assign({}, req, { headers }), res);
  };
}

module.exports = { withTestSession, testSessionCookie, loadMiddleware, TEST_HOST };
