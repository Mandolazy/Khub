/*
 * Test — P0-a: estrazione dell'importazione (extractRecipe in khub_mvp.html).
 *
 * Codice REALE della pagina eseguito in Node con fetch simulato: nessuna rete,
 * nessuna AI. Per la non regressione la stessa extractRecipe del commit di
 * partenza (0de0e8f, letta da git) gira sugli stessi input: con contenuti
 * normali l'anteprima deve essere identica. I percorsi che leggono una pagina
 * web (DOMParser) sono verificati nel browser da test-import-p0a-ui.js.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASE = '0de0e8f';
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
let htmlBase = null;
try { htmlBase = execFileSync('git', ['show', BASE + ':khub_mvp.html'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { htmlBase = null; }

let passed = 0, failed = 0, skipped = 0;
async function test(name, fn) {
  try { const r = await fn(); if (r === 'skip') { skipped++; console.log('  skip - ' + name); } else { passed++; console.log('  ok - ' + name); } }
  catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n    ')); }
}
function fn(src, m) { const s = src.indexOf(m); if (s === -1) throw new Error('marker ' + m); let d = 0; for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } } }
const DEPS = ['function importTargetValue(field,value)', 'function validateLabProductionTarget(field,value)', 'function parseLocaleNumber(value)', 'function importYieldText(t)',
  'function importDeclaredYield(raw,fonte)', 'function normalizeDeclaredYield(qty,unit)', 'function classifyYieldUnit(unit)'];
function costanti(src) {
  return [/var IMPORT_YIELD_PORTION_ALIASES=\[[^\]]*\];/, /var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/, /var DECLARED_YIELD_MEASURE_UNITS=\{[\s\S]*?\n\};/,
    /var DECLARED_YIELD_UNSUPPORTED_UNITS=\[[^\]]*\];/, /var LAB_TARGET_PORTIONS_MAX=\d+;/, /const UNITS = \[[^\]]*\];/].map(r => (src.match(r) || [''])[0]).join('\n');
}

// Client con fetch simulato. risposte: { ai, fetchUrl } -> funzioni (body) => {status, json|testo}
function client(src, risposte) {
  const log = { ai: [], fetchUrl: [], toasts: [], render: 0 };
  const fetch = async (u, o) => {
    const body = JSON.parse(o.body);
    const r = body.fetchUrl !== undefined ? (log.fetchUrl.push(body), risposte.fetchUrl(body)) : (log.ai.push(body), risposte.ai(body));
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.testo !== undefined) throw new SyntaxError('non JSON'); return r.json; } };
  };
  const S = { recipes: [], loadTab: 'testo', loadText: '', loadUrl: '', loadVideoUrl: '', loadImageB64: null, loadPreview: null, loadError: null, isLoading: false, view: 'load' };
  let n = 0;
  const api = new Function('S', 'fetch', 'log', `
    function render(){log.render++;} function toast(m){log.toasts.push(m);} function categorieUsate(){return ['Dolci','Basi'];} function uid(){return 'id'+(++uid.n);} uid.n=0;
    ${costanti(src)}
    ${DEPS.map(m => fn(src, m)).join('\n')}
    ${fn(src, 'async function extractRecipe()')}
    return { extractRecipe };`)(S, fetch, log);
  void n;
  return { S, log, extractRecipe: api.extractRecipe };
}
const okAI = obj => () => ({ status: 200, json: { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], stop_reason: 'end_turn' } });
const RICETTA = { name: 'Crema pasticcera', category: 'Dolci', portionsCount: null, gramsPerPortion: null,
  declaredYield: { qty: 6, unit: 'persone', range: null, source: 'Per 6 persone' },
  ingredients: [{ name: 'Latte intero', qty: 500, unit: 'g' }, { name: 'Tuorli', qty: 6, unit: 'n' }, { name: "Zucchero l'ultimo", qty: '150', unit: 'g' }, { name: 'Sale', qty: null, unit: 'q.b.' }],
  steps: ['Scaldare il latte a 80 °C.', 'Cuocere fino a <85 °C mescolando.'],
  subRecipes: [{ name: 'Caramello', declaredYield: null, ingredients: [{ name: 'Zucchero', qty: 100, unit: 'g' }], steps: ['Caramellare.'] }] };
// P0-c (approvato): "Sale" con unita' "q.b." non diventa piu' 0 g ma una quantita'
// variabile (qty null, nessuna unita' inventata). Tutto il resto dell'anteprima e la
// richiesta all'AI restano identici a 0de0e8f.
const conP0c = p => { const x = JSON.parse(JSON.stringify(p)); x.ingredients = x.ingredients.map(i => i.name === 'Sale' ? Object.assign(i, { qty: null, unit: null, qtyKind: 'variabile' }) : i); return x; };
const TESTO = 'Crema pasticcera. Per 6 persone. Latte 500 g, 6 tuorli, zucchero 150 g.';

(async () => {
  console.log('P0-a — estrazione dell\'importazione (extractRecipe)');

  await test('E1. non regressione: testo con contenuti normali -> anteprima identica a ' + BASE + ' (stessa richiesta AI, stessi dati)', async () => {
    if (!htmlBase) return 'skip';
    const run = async src => { const c = client(src, { ai: okAI(RICETTA), fetchUrl: () => ({ status: 200, json: {} }) }); c.S.loadTab = 'testo'; c.S.loadText = TESTO; await c.extractRecipe(); return c; };
    const a = await run(htmlBase), b = await run(html);
    assert.deepStrictEqual(b.S.loadPreview, conP0c(a.S.loadPreview)); assert.strictEqual(b.S.view, 'preview');
    assert.deepStrictEqual(b.log.ai, a.log.ai, 'richiesta AI identica (modello, token, prompt, testo)');
    assert.strictEqual(b.S.loadError, null);
  });

  await test('E2. non regressione: foto (mock) -> stessa richiesta con blocco immagine e stessa anteprima; resa "da verificare"', async () => {
    if (!htmlBase) return 'skip';
    const run = async src => { const c = client(src, { ai: okAI(RICETTA), fetchUrl: () => ({ status: 200, json: {} }) }); c.S.loadTab = 'foto'; c.S.loadImageB64 = { mediaType: 'image/jpeg', data: '/9j/4AAQ' }; await c.extractRecipe(); return c; };
    const a = await run(htmlBase), b = await run(html);
    assert.deepStrictEqual(b.log.ai, a.log.ai); assert.deepStrictEqual(b.S.loadPreview, conP0c(a.S.loadPreview));
    assert.strictEqual(b.log.ai[0].messages[0].content[0].type, 'image'); assert.strictEqual(b.S.loadPreview.declaredYield.toVerify, true);
  });

  await test('E3. markup restituito dall\'AI neutralizzato in nome, categoria, ingredienti, unita\', passi, sottoricette e resa (anche codificato con entita\')', async () => {
    const c = client(html, { ai: okAI({
      name: 'Tiramisù <img src=x onerror="window.x=1">', category: '<script>alert(1)</script>Dolci',
      ingredients: [{ name: 'Mascarpone &lt;img src=x onerror=alert(1)&gt;', qty: 500, unit: 'g' }, { name: '"><svg onload=alert(1)>Uova', qty: 4, unit: '<b>n</b>' }, { name: 'Caffè &amp;lt;script&amp;gt;', qty: 1, unit: 'tsp' }],
      steps: ['Montare <iframe srcdoc="<script>alert(1)</script>"></iframe> i tuorli', 'Cuocere a <85 °C', 'Servire &#60;img src=x onerror=alert(1)&#62;', '<img src=x onerror=alert(1)'],
      declaredYield: { qty: 6, unit: '<i>persone</i>', range: null, source: 'per 6 persone' },
      subRecipes: [{ name: '<a href="javascript:alert(1)">Crema</a>', ingredients: [{ name: '<img src=x>Latte', qty: 1, unit: 'l' }], steps: ['<b>Scaldare</b>'] }] }), fetchUrl: () => ({}) });
    c.S.loadTab = 'testo'; c.S.loadText = 'Tiramisù per 6 persone.'; await c.extractRecipe();
    const p = c.S.loadPreview; const tutto = JSON.stringify(p);
    assert.ok(!/<[a-z!\/?]/i.test(tutto.replace(/\\u003c/gi, '<')), 'nessun tag: ' + tutto);
    assert.ok(!/&(lt|gt|#\d+|#x[0-9a-f]+|amp);/i.test(tutto), 'nessuna entita\' residua');
    assert.strictEqual(p.name, 'Tiramisù'); assert.strictEqual(p.category, 'alert(1) Dolci');
    assert.deepStrictEqual(p.ingredients.map(i => [i.name, i.unit]), [['Mascarpone', 'g'], ['”> Uova', 'n'], ['Caffè', 'tsp']]);
    // Un attributo con ">" lascia frammenti di solo testo (mai un tag): conta l'assenza di markup.
    assert.ok(p.steps[0].startsWith('Montare') && p.steps[0].endsWith('i tuorli') && !/<[a-z!\/?]/i.test(p.steps[0]), p.steps[0]);
    assert.deepStrictEqual(p.steps.slice(1), ['Cuocere a <85 °C', 'Servire', 'img src=x onerror=alert(1)'], 'tag non chiuso: resta solo testo');
    assert.strictEqual(p.subRecipes[0].name, 'Crema'); assert.strictEqual(p.subRecipes[0].ingredients[0].name, 'Latte'); assert.deepStrictEqual(p.subRecipes[0].steps, ['Scaldare']);
    assert.strictEqual(p.declaredYield.unit, 'porzioni', 'unita\' della resa pulita e normalizzata');
  });

  await test('E4. testi normali intatti: apostrofi, accenti, simboli, "<80 °C", frazioni, emoji, a capo nei passi', async () => {
    const c = client(html, { ai: okAI({ name: "Pan di Spagna all'arancia ½ dose 🍊", ingredients: [{ name: "Farina 00 & fecola", qty: 200, unit: 'g' }], steps: ['Cuocere a 170–180 °C\nper 30′', 'Temperatura <80 °C, poi >60 °C'] }), fetchUrl: () => ({}) });
    c.S.loadTab = 'testo'; c.S.loadText = 'x'; await c.extractRecipe();
    assert.strictEqual(c.S.loadPreview.name, "Pan di Spagna all'arancia ½ dose 🍊");
    assert.strictEqual(c.S.loadPreview.ingredients[0].name, 'Farina 00 & fecola');
    assert.deepStrictEqual(c.S.loadPreview.steps, ['Cuocere a 170–180 °C\nper 30′', 'Temperatura <80 °C, poi >60 °C']);
  });

  await test('E5. scheda Video: nessuna chiamata AI, nessuna lettura di pagine, nessuna anteprima; messaggio esplicito "non acquisito né analizzato"', async () => {
    for (const u of ['https://www.youtube.com/watch?v=abc', 'https://youtube.com/shorts/abc', 'https://www.instagram.com/reel/ABC/', 'https://www.tiktok.com/@c/video/1', 'https://www.facebook.com/watch/?v=1', '']) {
      const c = client(html, { ai: okAI(RICETTA), fetchUrl: () => ({ status: 200, json: { ok: true, html: '<p>x</p>' } }) });
      c.S.loadTab = 'video'; c.S.loadVideoUrl = u; await c.extractRecipe();
      assert.strictEqual(c.log.ai.length, 0, u); assert.strictEqual(c.log.fetchUrl.length, 0, u); assert.strictEqual(c.S.loadPreview, null);
      assert.ok(/non e' stato acquisito ne' analizzato/.test(c.S.loadError.msg) && c.S.loadError.offriTesto === true, c.S.loadError.msg);
      assert.strictEqual(c.S.isLoading, false);
    }
  });

  await test('E6. link non leggibile: nessuna chiamata AI e nessuna ricetta dedotta dall\'indirizzo; messaggio distinto per ogni causa e invito a incollare il testo', async () => {
    const CASI = [
      [{ status: 502, json: { ok: false, code: 'http_403', error: 'Pagina non acquisita' } }, /rifiutato l'accesso automatico \(errore 403\)/],
      [{ status: 502, json: { ok: false, code: 'http_404', error: 'x' } }, /Pagina non trovata \(errore 404\)/],
      [{ status: 502, json: { ok: false, code: 'http_429', error: 'x' } }, /limitando le richieste/],
      [{ status: 502, json: { ok: false, code: 'http_500', error: 'x' } }, /restituito un errore \(errore 500\)/],
      [{ status: 504, json: { ok: false, code: 'timeout', error: 'x' } }, /non ha risposto in tempo/],
      [{ status: 502, json: { ok: false, code: 'non_html', error: 'x' } }, /formato non supportato/],
      [{ status: 422, json: { ok: false, code: 'host_non_consentito', error: 'x' } }, /rete locale, privata/],
      [{ status: 422, json: { ok: false, code: 'url_non_valido', error: 'x' } }, /Indirizzo non valido/],
      [{ status: 502, json: { ok: false, code: 'dns', error: 'x' } }, /Sito non trovato/],
      [{ status: 502, json: { ok: false, code: 'troppi_redirect', error: 'x' } }, /rimanda troppe volte/],
      [{ status: 401, json: { error: 'Accesso non autorizzato' } }, /Sessione scaduta/],
      [{ status: 500, testo: 'Internal error' }, /Connessione interrotta durante la lettura/],
      [new TypeError('Failed to fetch'), /Connessione interrotta durante la lettura/],
      [{ status: 200, json: { html: null } }, /Connessione interrotta durante la lettura/],
    ];
    for (const [risposta, msg] of CASI) {
      const c = client(html, { ai: okAI(RICETTA), fetchUrl: () => risposta });
      c.S.loadTab = 'link'; c.S.loadUrl = 'https://ricette.esempio.test/crema'; await c.extractRecipe();
      assert.strictEqual(c.log.fetchUrl.length, 1); assert.strictEqual(c.log.ai.length, 0, 'nessuna AI: ' + msg);
      assert.strictEqual(c.S.loadPreview, null); assert.ok(msg.test(c.S.loadError.msg), c.S.loadError.msg);
      assert.ok(/incollarlo nella scheda Testo/.test(c.S.loadError.msg) && c.S.loadError.offriTesto, 'invito a incollare');
      assert.ok(!c.log.ai.some(b => JSON.stringify(b).includes("Usa il nome nell")), 'mai il prompt "deduci dall\'URL"');
    }
    assert.ok(!fn(html, 'async function extractRecipe()').includes("Usa il nome nell"), 'prompt "deduci dall\'URL" rimosso dal codice');
  });

  await test('E7. errori AI distinti, senza dettagli interni: configurazione, sessione, sovraccarico, limite, formato, troncamento, rifiuto, non interpretabile, ricetta assente, rete', async () => {
    const ERR = (st, tipo) => () => ({ status: st, json: { type: 'error', error: { type: tipo, message: 'x-api-key header is required / segreto interno' } } });
    const CASI = [
      [ERR(401, 'authentication_error'), /Servizio AI non configurato/], [ERR(403, 'permission_error'), /Servizio AI non configurato/],
      [() => ({ status: 401, json: { error: 'Accesso non autorizzato' } }), /Sessione scaduta/], [() => ({ status: 403, json: { error: 'Origine non consentita' } }), /Richiesta non consentita/],
      [ERR(429, 'rate_limit_error'), /momentaneamente occupato/], [ERR(529, 'overloaded_error'), /temporaneamente non disponibile/], [ERR(500, 'api_error'), /temporaneamente non disponibile/],
      [() => ({ status: 500, json: { error: 'Proxy error', details: 'ECONNRESET segreto' } }), /temporaneamente non disponibile/],
      [() => ({ status: 413, testo: 'Request Entity Too Large' }), /limite tecnico/], [ERR(413, 'request_too_large'), /limite tecnico/],
      [ERR(400, 'invalid_request_error'), /formato non supportato o troppo grande/],
      [() => ({ status: 200, json: { content: [{ type: 'text', text: '{"name":"x","ingredients":[{"na' }], stop_reason: 'max_tokens' } }), /troppo lunga per una sola estrazione/],
      [() => ({ status: 200, json: { content: [], stop_reason: 'refusal' } }), /non ha elaborato questo contenuto/],
      [okAI('Non posso accedere a questo contenuto.'), /non e' interpretabile/], [okAI('[1,2]'), /non e' interpretabile/],
      [okAI({ name: 'Vuota', ingredients: [], steps: [] }), /non e' stata riconosciuta una ricetta/],
      [() => new TypeError('Failed to fetch'), /Connessione al servizio AI interrotta/],
    ];
    for (const [ai, msg] of CASI) {
      const c = client(html, { ai: b => ai(b), fetchUrl: () => ({}) });
      c.S.loadTab = 'testo'; c.S.loadText = TESTO; await c.extractRecipe();
      assert.strictEqual(c.S.loadPreview, null); assert.ok(c.S.loadError && msg.test(c.S.loadError.msg), (c.S.loadError && c.S.loadError.msg) + ' atteso ' + msg);
      assert.ok(!/segreto|x-api-key|ECONNRESET|Proxy error|stack/i.test(c.S.loadError.msg), 'nessun dettaglio interno');
      assert.strictEqual(c.S.isLoading, false);
    }
  });

  await test('E8. foto: formato non supportato (HEIC, SVG, PDF) -> messaggio, nessuna chiamata AI; formati ammessi invariati', async () => {
    for (const t of ['image/heic', 'image/heif', 'image/svg+xml', 'application/pdf', 'image/tiff']) {
      const c = client(html, { ai: okAI(RICETTA), fetchUrl: () => ({}) });
      c.S.loadTab = 'foto'; c.S.loadImageB64 = { mediaType: t, data: 'AAAA' }; await c.extractRecipe();
      assert.strictEqual(c.log.ai.length, 0, t); assert.ok(/Formato immagine non supportato/.test(c.S.loadError.msg));
    }
    for (const t of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      const c = client(html, { ai: okAI(RICETTA), fetchUrl: () => ({}) });
      c.S.loadTab = 'foto'; c.S.loadImageB64 = { mediaType: t, data: 'AAAA' }; await c.extractRecipe();
      assert.strictEqual(c.log.ai.length, 1, t); assert.strictEqual(c.S.view, 'preview');
    }
  });

  await test('E9. campi vuoti: stesso messaggio di prima ("Inserisci contenuto da importare"), nessuna chiamata', async () => {
    for (const tab of ['testo', 'link', 'foto']) {
      const c = client(html, { ai: okAI(RICETTA), fetchUrl: () => ({}) }); c.S.loadTab = tab; await c.extractRecipe();
      assert.deepStrictEqual(c.log.toasts, ['Inserisci contenuto da importare']); assert.strictEqual(c.log.ai.length + c.log.fetchUrl.length, 0);
    }
  });

  await test('E10. codice: prompt di estrazione invariato rispetto a ' + BASE, async () => {
    if (!htmlBase) return 'skip';
    const prompt = src => fn(src, 'async function extractRecipe()').match(/const PROMPT=`([^`]*)`/)[1];
    assert.strictEqual(prompt(html), prompt(htmlBase));
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
  process.exit(failed ? 1 : 0);
})();
