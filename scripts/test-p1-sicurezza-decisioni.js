/*
 * Test P1 — sicurezza dei contenuti AI e protezione delle decisioni confermate.
 * Node puro + assert, nessuna rete, nessuna chiamata AI.
 *  - lib/reconciliation.js reale: una decisione confirmed non puo' essere
 *    revocata o declassata senza segnale chef; gli aggiornamenti legittimi
 *    continuano a funzionare.
 *  - Funzioni client reali estratte da khub_mvp.html: renderContenutoL2Umano e
 *    renderMichelinAIPendingActions mostrano il contenuto AI come testo.
 * Uso: node scripts/test-p1-sicurezza-decisioni.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
const R = require(path.join(ROOT, 'lib/reconciliation.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); failed++; }
}
function extract(marker) {
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('marker non trovato: ' + marker);
  const b = html.indexOf('{', start); let d = 0;
  for (let i = b; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}') { d--; if (!d) return html.slice(start, i + 1); } }
  throw new Error('graffe: ' + marker);
}

const l2 = (o) => Object.assign({ id: 'l2a', operationalState: 'open', decisionState: 'none', content: { label: 'Sale', text: 'Manca il sale.' },
  evidence: null, provenanceType: 'm2', baselineHash: 'h0', baselineContext: { x: 0 } }, o);
const BASE = { baseline_hash: 'h1', baseline_context: { x: 1 } };

console.log('P1 — Protezione delle decisioni confermate (lib/reconciliation.js)');

test('D1. confirmed -> probable senza segnale chef: rifiutato', () => {
  const r = R.validateL2Update(l2({ decisionState: 'confirmed' }), { id: 'l2a', decision_state: 'probable' }, { chefAttributedThisTurn: false });
  assert.strictEqual(r.valid, false);
  assert.ok(/revocata o declassata/.test(r.reason), r.reason);
});

test('D2. confirmed -> none senza segnale chef: rifiutato (anche senza opts)', () => {
  assert.strictEqual(R.validateL2Update(l2({ decisionState: 'confirmed' }), { id: 'l2a', decision_state: 'none' }).valid, false);
  assert.strictEqual(R.validateL2Update(l2({ decisionState: 'confirmed' }), { id: 'l2a', decision_state: 'none' }, {}).valid, false);
});

test('D3. confirmed -> unengaged/none senza segnale chef: rifiutato', () => {
  const r = R.validateL2Update(l2({ decisionState: 'confirmed' }), { id: 'l2a', operational_state: 'unengaged', decision_state: 'none' }, { chefAttributedThisTurn: false });
  assert.strictEqual(r.valid, false);
  // unengaged senza decision_state esplicito: resta confirmed, gia' vietato dal vincolo PSL.
  assert.strictEqual(R.validateL2Update(l2({ decisionState: 'confirmed' }), { id: 'l2a', operational_state: 'unengaged' }, {}).valid, false);
});

test('D4. revoca con segnale chef esplicito: ammessa', () => {
  const r = R.validateL2Update(l2({ decisionState: 'confirmed' }), { id: 'l2a', decision_state: 'probable' }, { chefAttributedThisTurn: true });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.sanitized.decisionState, 'probable');
});

test('D5. su un item confirmed MichelinAI puo\' segnalare nuove informazioni: stato, contenuto, evidenza; la decisione resta', () => {
  const r = R.validateL2Update(l2({ decisionState: 'confirmed' }),
    { id: 'l2a', operational_state: 'affected', content: { label: 'Sale', text: 'Contraddizione: il fondo e\' gia\' sapido.' }, evidence: 'turno corrente' }, { chefAttributedThisTurn: false });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.sanitized.decisionState, undefined, 'decision_state non toccato');
  const r2 = R.validateL2Update(l2({ decisionState: 'confirmed' }), { id: 'l2a', decision_state: 'confirmed', operational_state: 'resolved' }, {});
  assert.strictEqual(r2.valid, true, 'confirmed ribadito: ammesso');
});

test('D6. aggiornamenti legittimi invariati (none/probable, transizione verso confirmed solo con chef)', () => {
  assert.strictEqual(R.validateL2Update(l2(), { id: 'l2a', decision_state: 'probable', operational_state: 'affected' }, {}).valid, true);
  assert.strictEqual(R.validateL2Update(l2({ decisionState: 'probable' }), { id: 'l2a', decision_state: 'none' }, {}).valid, true);
  assert.strictEqual(R.validateL2Update(l2({ decisionState: 'probable' }), { id: 'l2a', operational_state: 'resolved' }, {}).valid, true);
  assert.strictEqual(R.validateL2Update(l2(), { id: 'l2a', decision_state: 'confirmed' }, {}).valid, false, 'gate verso confirmed invariato');
  assert.strictEqual(R.validateL2Update(l2(), { id: 'l2a', decision_state: 'confirmed' }, { chefAttributedThisTurn: true }).valid, true);
});

test('D7. applyL2Updates (percorso di runM2 e applyM2Persistence): il declassamento e\' scartato, l\'item resta identico; l\'update legittimo e\' applicato', () => {
  const conf = l2({ id: 'c1', decisionState: 'confirmed' }), aperto = l2({ id: 'o1' });
  const res = R.applyL2Updates([conf, aperto], [{ id: 'c1', decision_state: 'probable' }, { id: 'o1', operational_state: 'resolved', evidence: 'chef: risolto' }], BASE, { chefAttributedThisTurn: false });
  assert.deepStrictEqual(res.applied, ['o1']);
  assert.strictEqual(res.rejected.length, 1);
  assert.strictEqual(res.rejected[0].id, 'c1');
  assert.strictEqual(res.items[0], conf, 'stessa reference: mai mutato');
  assert.strictEqual(res.items[1].operationalState, 'resolved');
  assert.strictEqual(res.items[1].baselineHash, 'h1');
});

console.log('\nP1 — Contenuti AI mostrati come testo (khub_mvp.html)');

const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
const client = new Function('S', `
  ${extract('function escAttr(s)')}
  ${extract('function R(id)')}
  ${extract('function curLab(recipe)')}
  ${extract('function renderContenutoL2Umano(content)')}
  ${extract('function renderMichelinAIPendingActions(recipeId,v)')}
  return { renderContenutoL2Umano, renderMichelinAIPendingActions };`);

test('X1. HTML e script nel contenuto AI restano testo', () => {
  const api = client({});
  const h = api.renderContenutoL2Umano({ label: XSS, text: XSS });
  assert.ok(!/<img|<script/i.test(h), 'nessun tag eseguibile: ' + h);
  assert.ok(h.includes('&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;&lt;script&gt;'));
});

test('X2. osservazioni normali: etichetta e testo mostrati come prima', () => {
  const api = client({});
  const h = api.renderContenutoL2Umano({ label: 'Sale', text: 'Manca il sale nel condimento.' });
  assert.ok(h.includes('>Sale</div>') && h.includes('>Manca il sale nel condimento.</div>'));
  assert.ok(h.includes('font-size:10.5px') && h.includes('font-size:13px'), 'stessa formattazione');
  assert.strictEqual(api.renderContenutoL2Umano(null), '');
  assert.strictEqual(api.renderContenutoL2Umano({ text: 'Solo testo' }).includes('text-transform:uppercase'), false, 'senza etichetta: nessuna riga vuota');
  const amp = api.renderContenutoL2Umano({ label: 'Sale & pepe', text: "Ridurre l'acidità di 1/2" });
  assert.ok(amp.includes('Sale &amp; pepe') && amp.includes('Ridurre l&#39;acidità di 1/2'), 'caratteri speciali codificati una sola volta');
});

test('X3. azioni in sospeso: contenuto AI codificato; nessun «Conferma» per un\'osservazione gia\' confermata', () => {
  const v = { id: 'v1', l2Items: [l2({ id: 'o1', content: { label: XSS, text: 'aperta' } }), l2({ id: 'c1', decisionState: 'confirmed', content: { label: 'Decisa', text: 'confermata dallo chef' } })] };
  const S = { recipes: [], m2Result: { v1: {
    l2Updates: { rejected: [{ id: 'o1', reason: 'verso confirmed senza chef' }, { id: 'c1', reason: 'declassamento senza chef' }] },
    l2New: [{ tempId: 't1', proposedNew: { content: { label: 'Nuova', text: XSS } } }] } } };
  const h = client(S).renderMichelinAIPendingActions('r1', v);
  assert.ok(!/<img|<script/i.test(h), 'nessun tag eseguibile');
  assert.ok(h.includes(`confermaEsistenteM2('r1','o1')`), 'riga per l\'osservazione non confermata');
  assert.ok(!h.includes(`confermaEsistenteM2('r1','c1')`), 'nessuna riga per quella gia\' confermata');
  assert.ok(h.includes(`confermaNuovoM2('r1','t1')`), 'nuove osservazioni invariate');
});

test('X4. pannello del Consulto: testo e osservazioni passano da escAttr', () => {
  const src = extract('function renderLabRecipe(recipe)');
  assert.ok(src.includes('${escAttr(testoFresco)}'), 'testo del Consulto');
  assert.strictEqual((src.match(/\$\{escAttr\(\(o\.content&&o\.content\.label\)\|\|'Osservazione'\)\}/g) || []).length, 2, 'etichette (aperte e risolte)');
  assert.strictEqual((src.match(/\$\{escAttr\(\(o\.content&&o\.content\.text\)\|\|''\)\}/g) || []).length, 2, 'testi (aperte e risolte)');
  assert.ok(!/\$\{\(o\.content&&o\.content\.(label|text)\)/.test(src), 'nessun contenuto L2 inserito senza escaping');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
