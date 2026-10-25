// ══════════════════════════════════════════════════════════
// KHUB — Accesso privato (Vercel Routing Middleware)
// Primo controllo di accesso: gira prima di file statici e funzioni, su
// ogni deployment (produzione, preview, branch). Il secondo controllo,
// indipendente, e' in api/chat.js: nessuno dei due si fida dell'altro.
//
// - Una sola password (KHUB_ACCESS_PASSWORD), confrontata lato server.
// - Sessione = cookie __Host- HttpOnly/Secure/SameSite=Strict firmato HMAC
//   con KHUB_SESSION_SECRET. Nessuna credenziale arriva mai al browser.
// - Fail-closed: variabili assenti o deboli -> 503, mai accesso libero.
// - Allowlist dei percorsi: anche con sessione valida si serve solo cio'
//   che l'app usa; qualsiasi altro file del repository -> 404.
// - Solo Web API standard (Request/Response/crypto.subtle): compatibile sia
//   con il runtime Edge sia con il runtime Node.js del middleware.
// ══════════════════════════════════════════════════════════

const SESSION_COOKIE = '__Host-khub_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_CLOCK_SKEW_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 16;
const MAX_PASSWORD_INPUT_LENGTH = 1024;

const LOGIN_PATH = '/__khub/login';
const LOGOUT_PATH = '/__khub/logout';

// Unici percorsi serviti a una sessione valida. Deve restare allineata con
// .vercelignore (verificato da scripts/test-security-access.js).
export const ALLOWED_PATHS = Object.freeze([
  '/',
  '/index.html',
  '/khub_mvp.html',
  '/lib/baseline.js',
  '/lib/reconciliation.js',
  '/api/chat',
]);

// Limitazione dei tentativi di login. In memoria, per istanza: e' un freno
// best-effort (Vercel puo' eseguire piu' istanze e riciclarle). Il limite
// globale e' affidato alla regola WAF Rate Limiting su LOGIN_PATH.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS_PER_IP = 5;
const LOGIN_MAX_ATTEMPTS_GLOBAL = 30;
const LOGIN_FAILURE_DELAY_MS = 1000;
const LOGIN_TRACKED_IPS_MAX = 5000;
const loginAttemptsByIp = new Map();
let loginAttemptsGlobal = [];

const enc = new TextEncoder();

function subtle() {
  const c = globalThis.crypto;
  return c && c.subtle ? c.subtle : null;
}

function readConfig() {
  const env = (typeof process !== 'undefined' && process.env) || {};
  const secret = env.KHUB_SESSION_SECRET || '';
  const password = env.KHUB_ACCESS_PASSWORD || '';
  if (!subtle() || secret.length < MIN_SECRET_LENGTH || password.length < MIN_PASSWORD_LENGTH) return null;
  return { secret, password };
}

function b64urlEncode(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function hmacKey(secret) {
  return subtle().importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// Token: "v1.<scadenza unix>.<HMAC-SHA256 base64url>".
export async function createSessionToken(secret, nowSeconds) {
  const exp = Math.floor(nowSeconds) + SESSION_TTL_SECONDS;
  const sig = await subtle().sign('HMAC', await hmacKey(secret), enc.encode('khub-session.v1.' + exp));
  return 'v1.' + exp + '.' + b64urlEncode(sig);
}

export async function verifySessionToken(token, secret, nowSeconds) {
  const m = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(typeof token === 'string' ? token : '');
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp > nowSeconds) || exp > nowSeconds + SESSION_TTL_SECONDS + SESSION_CLOCK_SKEW_SECONDS) return false;
  const sig = b64urlDecode(m[2]);
  if (sig.length !== 32) return false;
  // subtle.verify confronta la firma a tempo costante.
  return subtle().verify('HMAC', await hmacKey(secret), sig, enc.encode('khub-session.v1.' + exp));
}

async function passwordMatches(input, cfg) {
  const key = await hmacKey(cfg.secret);
  const expected = await subtle().sign('HMAC', key, enc.encode('khub-password.v1.' + cfg.password));
  return subtle().verify('HMAC', key, expected, enc.encode('khub-password.v1.' + input));
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function requestHost(request) {
  return request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
}

// Difesa CSRF per le richieste che modificano stato: Origin deve coincidere
// con l'host servito; in assenza di Origin vale solo Sec-Fetch-Site.
function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) {
    try { return new URL(origin).host === requestHost(request); } catch (e) { return false; }
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

function clientIp(request) {
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = request.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'unknown';
}

// Registra il tentativo PRIMA di qualsiasi await: controllo e registrazione
// sono atomici, quindi richieste concorrenti non possono superare il limite.
// Restituisce i secondi di attesa se il tentativo e' bloccato, altrimenti 0.
function registerLoginAttempt(ip, now) {
  const cutoff = now - LOGIN_WINDOW_MS;
  loginAttemptsGlobal = loginAttemptsGlobal.filter(t => t > cutoff);
  const mine = (loginAttemptsByIp.get(ip) || []).filter(t => t > cutoff);
  const blockedUntil = Math.max(
    mine.length >= LOGIN_MAX_ATTEMPTS_PER_IP ? mine[0] + LOGIN_WINDOW_MS : 0,
    loginAttemptsGlobal.length >= LOGIN_MAX_ATTEMPTS_GLOBAL ? loginAttemptsGlobal[0] + LOGIN_WINDOW_MS : 0
  );
  if (blockedUntil > now) {
    loginAttemptsByIp.set(ip, mine);
    return Math.max(1, Math.ceil((blockedUntil - now) / 1000));
  }
  mine.push(now);
  loginAttemptsGlobal.push(now);
  if (loginAttemptsByIp.size >= LOGIN_TRACKED_IPS_MAX && !loginAttemptsByIp.has(ip)) {
    for (const [k, v] of loginAttemptsByIp) if (!v.some(t => t > cutoff)) loginAttemptsByIp.delete(k);
    if (loginAttemptsByIp.size >= LOGIN_TRACKED_IPS_MAX) loginAttemptsByIp.delete(loginAttemptsByIp.keys().next().value);
  }
  loginAttemptsByIp.set(ip, mine);
  return 0;
}

// Solo per i test locali: non e' raggiungibile via HTTP.
export function resetLoginLimiterForTests() {
  loginAttemptsByIp.clear();
  loginAttemptsGlobal = [];
}

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  // Non 'no-referrer': con quella policy Chrome invia "Origin: null" nel POST
  // del form di login, che il controllo same-origin rifiuterebbe.
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function respond(status, body, contentType, extra) {
  const headers = new Headers(BASE_HEADERS);
  if (contentType) headers.set('Content-Type', contentType);
  if (extra) for (const [k, v] of Object.entries(extra)) headers.append(k, v);
  return new Response(body, { status, headers });
}

function json(status, obj, extra) {
  return respond(status, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
}

function loginPage(status, message, extra) {
  const note = message ? '<p class="msg" role="alert">' + message + '</p>' : '';
  const html = '<!doctype html><html lang="it"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
    + '<title>KHUB — Accesso</title><style>'
    + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f4ef;color:#1d1d1b;font:16px/1.4 system-ui,-apple-system,sans-serif}'
    + 'form{width:min(320px,calc(100vw - 32px));display:flex;flex-direction:column;gap:12px}'
    + 'h1{font-size:20px;margin:0 0 4px}input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #b9b5ab}'
    + 'button{background:#1d1d1b;color:#fff;border-color:#1d1d1b;cursor:pointer}.msg{margin:0;color:#a3261b}'
    + '</style></head><body><form method="post" action="' + LOGIN_PATH + '">'
    + '<h1>KHUB</h1>' + note
    + '<input type="text" name="username" value="khub" autocomplete="username" hidden>'
    + '<input type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus maxlength="' + MAX_PASSWORD_INPUT_LENGTH + '">'
    + '<button type="submit">Entra</button></form></body></html>';
  return respond(status, html, 'text/html; charset=utf-8', Object.assign({
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  }, extra || {}));
}

function sessionCookie(token) {
  return SESSION_COOKIE + '=' + token + '; Path=/; Max-Age=' + SESSION_TTL_SECONDS + '; HttpOnly; Secure; SameSite=Strict';
}

function clearedSessionCookie() {
  return SESSION_COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
}

// Equivalente di next() di @vercel/functions: la richiesta prosegue.
function next() {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

function unauthorized(request, pathname) {
  if (pathname === '/api' || pathname.startsWith('/api/') || request.method !== 'GET') {
    return json(401, { error: 'Accesso non autorizzato' });
  }
  return loginPage(401, '');
}

async function handleLogin(request, cfg) {
  if (!isSameOrigin(request)) return json(403, { error: 'Origine non consentita' });
  const retryAfter = registerLoginAttempt(clientIp(request), Date.now());
  if (retryAfter) {
    return loginPage(429, 'Troppi tentativi. Riprova tra qualche minuto.', { 'Retry-After': String(retryAfter) });
  }
  let password = '';
  try {
    const form = await request.formData();
    const v = form.get('password');
    password = typeof v === 'string' ? v : '';
  } catch (e) {
    password = '';
  }
  if (password && password.length <= MAX_PASSWORD_INPUT_LENGTH && await passwordMatches(password, cfg)) {
    loginAttemptsByIp.delete(clientIp(request));
    const token = await createSessionToken(cfg.secret, Date.now() / 1000);
    return respond(303, null, null, { Location: '/', 'Set-Cookie': sessionCookie(token) });
  }
  await new Promise(r => setTimeout(r, LOGIN_FAILURE_DELAY_MS));
  return loginPage(401, 'Password non valida.');
}

export default async function middleware(request) {
  const pathname = new URL(request.url).pathname;
  const cfg = readConfig();
  if (!cfg) return json(503, { error: 'Accesso non configurato' });

  if (pathname === LOGOUT_PATH) {
    return respond(303, null, null, { Location: LOGIN_PATH, 'Set-Cookie': clearedSessionCookie() });
  }

  const authenticated = await verifySessionToken(readCookie(request, SESSION_COOKIE), cfg.secret, Date.now() / 1000);

  if (pathname === LOGIN_PATH) {
    if (request.method === 'POST') return handleLogin(request, cfg);
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    return authenticated ? respond(303, null, null, { Location: '/' }) : loginPage(200, '');
  }

  if (!authenticated) return unauthorized(request, pathname);

  if (!ALLOWED_PATHS.includes(pathname)) return respond(404, 'Not found', 'text/plain; charset=utf-8');

  if (pathname.startsWith('/api/') && !isSameOrigin(request)) {
    return json(403, { error: 'Origine non consentita' });
  }

  return next();
}
