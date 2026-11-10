#!/usr/bin/env node
/*
 * KHUB — server di TEST P0-c.1: pagina reale (khub_mvp.html) e server reale
 * (api/chat.js) collegati a un PostgREST LOCALE (127.0.0.1) sopra un
 * PostgreSQL locale e temporaneo. Mai Supabase.
 *
 * Uso (dal test):  node scripts/_p0c-postgrest-server.js <porta> <url-postgrest> [file api/chat.js]
 *   <url-postgrest> deve essere http://127.0.0.1:<porta>: ogni altra
 *   destinazione e' rifiutata. Il terzo argomento (facoltativo) permette di
 *   eseguire una versione precedente di api/chat.js per il confronto prima/dopo.
 *
 * Isolamento: credenziali tolte dall'ambiente; l'indirizzo "Supabase" e' su
 * un dominio .invalid e viene riscritto verso PostgREST locale; ogni altra
 * fetch del server e' bloccata; ascolto solo su 127.0.0.1.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const DA_TOGLIERE = /SUPABASE|ANTHROPIC|KHUB|VERCEL|DATABASE|POSTGRES|PG(HOST|USER|PASSWORD|DATABASE|PORT)|OPENAI|API_KEY|SECRET|TOKEN/i;
Object.keys(process.env).filter(k => DA_TOGLIERE.test(k)).forEach(k => { delete process.env[k]; });
const SUPABASE_FINTO = 'https://supabase-p0c-locale.invalid';
process.env.SUPABASE_URL = SUPABASE_FINTO;
process.env.SUPABASE_SECRET_KEY = 'sb_secret_p0c_locale_non_valida';
process.env.KHUB_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.KHUB_ACCESS_PASSWORD = crypto.randomBytes(16).toString('hex');

const PORTA = Number(process.argv[2]);
const REST = String(process.argv[3] || '');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(REST)) { console.error('PostgREST deve essere su http://127.0.0.1:<porta>'); process.exit(1); }
const ROOT = path.join(__dirname, '..');
const CHAT = process.argv[4] ? path.resolve(process.argv[4]) : path.join(ROOT, 'api', 'chat.js');

const fetchOriginale = globalThis.fetch;
const registro = []; // richieste verso PostgREST: metodo, tabella, esito
const fetchLocale = async function (url, opts) {
  const u = String(url && url.url ? url.url : url);
  if (!u.startsWith(SUPABASE_FINTO + '/rest/v1/')) {
    const msg = 'Rete esterna disabilitata nel server di test: ' + u.split('?')[0];
    return { ok: false, status: 503, json: async () => ({ error: msg }), text: async () => msg };
  }
  const o = Object.assign({}, opts || {});
  const h = Object.assign({}, o.headers || {});
  Object.keys(h).forEach(k => { if (/^(apikey|authorization)$/i.test(k)) delete h[k]; }); // PostgREST locale: ruolo anonimo
  o.headers = h;
  const r = await fetchOriginale(REST + u.slice(SUPABASE_FINTO.length + '/rest/v1'.length), o);
  let corpo = null; try { corpo = o.body ? JSON.parse(o.body) : null; } catch (e) { corpo = null; }
  const primo = Array.isArray(corpo) ? corpo[0] : corpo;
  registro.push({ metodo: o.method || 'GET', percorso: u.slice(SUPABASE_FINTO.length + 9).split('?')[0], stato: r.status, righe: Array.isArray(corpo) ? corpo.length : (corpo ? 1 : 0),
    chiavi: primo && typeof primo === 'object' ? Object.keys(primo).sort() : [], firma: primo && typeof primo === 'object' && 'contenuto_hash' in primo });
  return r;
};
Object.defineProperty(globalThis, 'fetch', { value: fetchLocale, writable: false, configurable: false });

const leggiCorpo = req => new Promise((ok, ko) => { const p = []; req.on('data', c => p.push(c)); req.on('end', () => ok(Buffer.concat(p).toString('utf8'))); req.on('error', ko); });

(async () => {
  const sorgente = fs.readFileSync(CHAT, 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(sorgente).toString('base64'));
  const { withTestSession } = require(path.join(ROOT, 'scripts', '_khub-test-session.js'));
  const handler = await withTestSession(mod.default);
  const server = http.createServer(async (req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1'].includes(host)) { res.writeHead(403); return res.end('Solo localhost'); }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/khub_mvp.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8'));
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        let body; try { body = JSON.parse(await leggiCorpo(req) || '{}'); } catch (e) { res.writeHead(400); return res.end('{}'); }
        let stato = 200, uscita;
        const r = { status(c) { stato = c; return r; }, json(o) { uscita = o; return r; }, setHeader() { return r; }, end() { return r; } };
        await handler({ method: 'POST', headers: {}, body }, r);
        res.writeHead(stato, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(uscita === undefined ? null : uscita));
      }
      if (req.method === 'GET' && url.pathname === '/test/registro') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(registro));
      }
      res.writeHead(404); res.end('Non trovato');
    } catch (e) {
      console.error('  errore:', e && e.message);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Errore nel server di test' }));
    }
  });
  server.listen(PORTA, '127.0.0.1', () => console.log('Server di test P0-c.1 pronto su ' + PORTA));
})();
