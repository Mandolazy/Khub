/*
 * Test START-01 — la Home (app-home) e' l'entry point canonico di KHUB.
 * Esegue il codice REALE estratto da khub_mvp.html: il gestore del pulsante
 * "Inizia" del popup di benvenuto e il blocco di avvio (INIT).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'khub_mvp.html'), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); failed++; }
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

(async () => {
  await test('onboarding: "Inizia" chiude il popup, ricorda l\'onboarding e porta alla Home (app-home)', () => {
    const markup = new Function(extractFunction('function renderOnboarding()') + '\nreturn renderOnboarding();')();
    const m = markup.match(/<button[^>]*onclick="([^"]*)"[^>]*>\s*Inizia/);
    assert.ok(m, 'pulsante Inizia trovato');
    const S = { view: 'app-home', showOnboarding: true };
    const store = {};
    let renders = 0;
    new Function('S', 'localStorage', 'render', m[1])(S, { setItem: (k, v) => { store[k] = v; } }, () => { renders++; });
    assert.deepStrictEqual([S.view, S.showOnboarding, store.khub_onboarded, renders], ['app-home', false, '1', 1]);
  });

  async function runInit(recipes, onboarded) {
    const start = html.indexOf('(async()=>{', html.indexOf('// INIT'));
    const end = html.indexOf('})();', start) + '})();'.length;
    const S = { view: 'app-home', recipes: [], showOnboarding: false };
    const storage = onboarded ? { khub_onboarded: '1' } : {};
    const checkOnboarding = new Function('S', 'localStorage', extractFunction('function checkOnboarding()') + '\nreturn checkOnboarding;')(S, { getItem: k => storage[k] || null });
    let done;
    const finished = new Promise(r => { done = r; });
    const body = 'var _initDone=false;\nreturn ' + html.slice(start, end - 1).replace(/_initDone=true;/, '_initDone=true;done();');
    new Function('S', 'render', 'loadFromSupabase', 'checkOnboarding', 'done', body)(
      S, () => {}, async () => { S.recipes = recipes; }, checkOnboarding, done);
    await finished;
    return S;
  }

  await test('avvio con zero Ricette -> resta sulla Home (app-home), mai "Carica Ricetta"', async () => {
    assert.strictEqual((await runInit([], true)).view, 'app-home');
    const S = await runInit([], false);
    assert.deepStrictEqual([S.view, S.showOnboarding], ['app-home', true], 'primo accesso: popup sopra la Home');
  });

  await test('avvio con Ricette -> Home (app-home), invariato', async () => {
    assert.strictEqual((await runInit([{ id: 'r1' }], true)).view, 'app-home');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
