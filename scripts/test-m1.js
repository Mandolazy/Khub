/*
 * Test M1 — Primo Consulto (KHUB / MichelinAI 2.0).
 * Nessun framework introdotto: Node puro + assert, stesso stile di
 * test-persistent-state.js.
 *
 * Copre due livelli, onestamente distinti:
 *  A. Unit test reali sulla logica di parsing/validazione della risposta
 *     M1 e sulla costruzione degli L2 — la stessa identica logica di
 *     runM1() in khub_mvp.html, replicata qui 1:1 (nessun modulo
 *     condiviso nel progetto: se cambia una va aggiornata anche l'altra).
 *     Nessuna rete, nessuna credenziale richiesta.
 *  B. Verifiche strutturali su api/chat.js e khub_mvp.html: presenza del
 *     branch mode:'m1', del gate "gia' avvenuto", rimozione completa del
 *     pannello legacy "Consulente AI", e che runM1() non muti mai
 *     ingredienti/steps della Ricetta.
 *
 * Cosa NON e' eseguibile da questo script (richiede ANTHROPIC_API_KEY e
 * SUPABASE_URL/SUPABASE_ANON_KEY configurate sul deployment Vercel reale,
 * assenti in questo ambiente): i casi T2, T3, T5, T6, T7, T8, T9, T10,
 * T11, T12 nella loro forma end-to-end, e i due test comportamentali
 * B1/B2 (richiedono una vera risposta del modello). Per quelli vedi
 * scripts/test-m1-live.js.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + e.message); failed++; }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// ══════════════════════════════════════════════════════════
// Replica 1:1 della logica di parsing in runM1() (khub_mvp.html)
// ══════════════════════════════════════════════════════════
function parseM1Response(text) {
  if (!text.trim()) throw new Error('Risposta AI vuota');
  const marker = '===M1_OBSERVATIONS===';
  const idx = text.indexOf(marker);
  if (idx === -1) throw new Error('Blocco osservazioni mancante nella risposta');
  const userText = text.slice(0, idx).trim();
  if (!userText) throw new Error('Lettura del Primo Consulto vuota');
  let jsonPart = text.slice(idx + marker.length).trim();
  jsonPart = jsonPart.replace(/```json|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(jsonPart); } catch (e) { throw new Error("Blocco osservazioni non e'JSON valido"); }
  if (!parsed || !Array.isArray(parsed.observations)) throw new Error('Formato osservazioni non valido');
  const validObs = parsed.observations.filter(o => o && typeof o.content === 'string' && o.content.trim());
  if (validObs.length === 0) throw new Error('Nessuna osservazione valida prodotta');
  return { userText, validObs };
}

// Replica 1:1 della costruzione L2 in runM1()
function buildL2(validObs, baseline) {
  return validObs.map(o => ({
    id: 'l2_test_' + Math.random().toString(36).slice(2, 8),
    operationalState: 'unengaged', decisionState: 'none',
    content: { label: (o.label && String(o.label).trim()) || o.content.trim().slice(0, 60), text: o.content.trim() },
    evidence: null, provenanceType: 'm1', sourceL2ItemId: null,
    baselineHash: baseline.baseline_hash, baselineContext: baseline.baseline_context,
  }));
}

console.log('A. logica di parsing/validazione M1 (mirror di runM1)');

test('T-parsing: risposta valida -> testo + osservazioni estratti correttamente', () => {
  const text = 'Il piatto ha una base solida ma la mantecatura rischia di stracciare.\n' +
    '===M1_OBSERVATIONS===\n' +
    '{"observations":[{"label":"Rischio mantecatura","content":"La quantita\' di pecorino rispetto all\'acqua di cottura rende la mantecatura instabile a freddo."}]}';
  const { userText, validObs } = parseM1Response(text);
  assert.strictEqual(userText, "Il piatto ha una base solida ma la mantecatura rischia di stracciare.");
  assert.strictEqual(validObs.length, 1);
  assert.match(validObs[0].content, /mantecatura instabile/);
});

test('T-parsing: risposta con blocco JSON avvolto in fence ```json viene comunque letta', () => {
  const text = 'Testo di consulto.\n===M1_OBSERVATIONS===\n```json\n{"observations":[{"label":"x","content":"y"}]}\n```';
  const { validObs } = parseM1Response(text);
  assert.strictEqual(validObs.length, 1);
});

test('T7/T9 equivalente: risposta vuota viene rifiutata', () => {
  assert.throws(() => parseM1Response('   '), /Risposta AI vuota/);
});

test('T9: marcatore osservazioni mancante viene rifiutato', () => {
  assert.throws(() => parseM1Response('Solo testo, nessun blocco strutturato.'), /Blocco osservazioni mancante/);
});

test('T9: testo user-facing vuoto (marcatore in testa) viene rifiutato', () => {
  const text = '===M1_OBSERVATIONS===\n{"observations":[{"label":"x","content":"y"}]}';
  assert.throws(() => parseM1Response(text), /Lettura del Primo Consulto vuota/);
});

test('T9: JSON malformato dopo il marcatore viene rifiutato', () => {
  const text = 'Testo.\n===M1_OBSERVATIONS===\n{observations: [non valido}';
  assert.throws(() => parseM1Response(text), /non e'JSON valido/);
});

test('T9: observations non-array viene rifiutato', () => {
  const text = 'Testo.\n===M1_OBSERVATIONS===\n{"observations":"non un array"}';
  assert.throws(() => parseM1Response(text), /Formato osservazioni non valido/);
});

test('T9: zero osservazioni valide (array vuoto) viene rifiutato', () => {
  const text = 'Testo.\n===M1_OBSERVATIONS===\n{"observations":[]}';
  assert.throws(() => parseM1Response(text), /Nessuna osservazione valida prodotta/);
});

test('T9: osservazioni senza content valido vengono filtrate; se restano zero, rifiutato', () => {
  const text = 'Testo.\n===M1_OBSERVATIONS===\n{"observations":[{"label":"x"},{"content":""},{"content":123}]}';
  assert.throws(() => parseM1Response(text), /Nessuna osservazione valida prodotta/);
});

test('T4/T11: L2 costruiti da osservazioni valide hanno i campi deterministici corretti', () => {
  const text = 'Testo di consulto con due punti.\n===M1_OBSERVATIONS===\n' +
    '{"observations":[{"label":"A","content":"Primo punto operativo."},{"label":"B","content":"Secondo punto operativo."}]}';
  const { validObs } = parseM1Response(text);
  const baseline = { baseline_hash: 'hash123', baseline_context: { ingredients: [] } };
  const l2 = buildL2(validObs, baseline);
  assert.strictEqual(l2.length, 2);
  l2.forEach(item => {
    assert.strictEqual(item.operationalState, 'unengaged');
    assert.strictEqual(item.decisionState, 'none');
    assert.strictEqual(item.provenanceType, 'm1');
    assert.strictEqual(item.sourceL2ItemId, null);
    assert.strictEqual(item.evidence, null);
  });
});

test('T5: tutti gli L2 dello stesso M1 condividono baseline_hash e baseline_context', () => {
  const text = 'Testo.\n===M1_OBSERVATIONS===\n{"observations":[{"content":"a"},{"content":"b"},{"content":"c"}]}';
  const { validObs } = parseM1Response(text);
  const baseline = { baseline_hash: 'sharedhash', baseline_context: { note: 'stato bozza' } };
  const l2 = buildL2(validObs, baseline);
  const hashes = new Set(l2.map(x => x.baselineHash));
  const contexts = new Set(l2.map(x => JSON.stringify(x.baselineContext)));
  assert.strictEqual(hashes.size, 1);
  assert.strictEqual(contexts.size, 1);
});

test('label mancante: usa fallback troncato dal content (mai vuoto)', () => {
  const text = 'Testo.\n===M1_OBSERVATIONS===\n{"observations":[{"content":"Osservazione senza label esplicita ma abbastanza lunga."}]}';
  const { validObs } = parseM1Response(text);
  const l2 = buildL2(validObs, { baseline_hash: 'h', baseline_context: {} });
  assert.ok(l2[0].content.label.length > 0);
});

console.log('');
console.log('B. verifiche strutturali su api/chat.js e khub_mvp.html');

const chat = read('api/chat.js');
const html = read('khub_mvp.html');

test("api/chat.js: esiste il branch mode==='m1'", () => {
  assert.match(chat, /if \(body\.mode === 'm1'\)/);
});

test('api/chat.js: M1_SYSTEM_PROMPT costruito server-side (non passato dal client)', () => {
  assert.match(chat, /const M1_SYSTEM_PROMPT = `/);
  assert.match(chat, /system: M1_SYSTEM_PROMPT/);
});

test('api/chat.js: il branch m1 usa una sola chiamata Anthropic (nessun secondo passaggio)', () => {
  const m1Block = chat.slice(chat.indexOf("body.mode === 'm1'"), chat.indexOf('// Proxy Anthropic AI'));
  const calls = (m1Block.match(/api\.anthropic\.com/g) || []).length;
  assert.strictEqual(calls, 1, 'attesa 1 sola chiamata Anthropic nel branch m1, trovate ' + calls);
});

test("khub_mvp.html: gate 'gia' avvenuto' basato su L2 provenance m1 (nessun nuovo flag DB)", () => {
  assert.match(html, /function hasM1\(v\)\{return\(v&&v\.l2Items\|\|\[\]\)\.some\(x=>x\.provenanceType==='m1'\)/);
  assert.match(html, /if\(hasM1\(v\)\)return;/);
});

test('khub_mvp.html: pannello legacy "Consulente AI" completamente rimosso', () => {
  ['sendAI', 'applyAISugg', 'aiMsgs', 'aiSugg', 'ai-input', 'btn-send-ai', 'ai-panel', 'ai-msg'].forEach(needle => {
    assert.ok(!html.includes(needle), 'trovato residuo legacy: ' + needle);
  });
});

test("khub_mvp.html: M1 usa KhubBaseline.compute() una sola volta per run", () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function toggleRecording'));
  const calls = (fnBody.match(/KhubBaseline\.compute\(/g) || []).length;
  assert.strictEqual(calls, 1, 'atteso 1 solo compute() per Primo Consulto, trovati ' + calls);
});

test('T13: runM1() non muta mai ingredienti/steps della Ricetta (nessuna chiamata alle funzioni di editing)', () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function toggleRecording'));
  ['onIngQty(', 'onIngUnit(', 'onIngName(', 'addIngredient(', 'delIngredient(', 'onStepText(', 'addStep(', 'delStep('].forEach(needle => {
    assert.ok(!fnBody.includes(needle), 'runM1 chiama una funzione di editing Ricetta: ' + needle);
  });
});

test("T13: le uniche mutazioni di stato in runM1() toccano solo l2Items, mai ingredients/steps", () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function toggleRecording'));
  const upLabCalls = fnBody.match(/upLab\(recipeId,lab=>\(\{[^}]*\}\)\)/g) || [];
  assert.ok(upLabCalls.length >= 2, 'attese almeno 2 chiamate upLab (add + rollback), trovate ' + upLabCalls.length);
  upLabCalls.forEach(call => {
    assert.match(call, /l2Items:/, 'una chiamata upLab in runM1 non tocca l2Items: ' + call);
    assert.doesNotMatch(call, /ingredients:/, 'una chiamata upLab in runM1 tocca ingredients: ' + call);
    assert.doesNotMatch(call, /steps:/, 'una chiamata upLab in runM1 tocca steps: ' + call);
  });
});

test('khub_mvp.html: M1 non completato se saveToSupabase() fallisce (rollback esplicito)', () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function toggleRecording'));
  assert.match(fnBody, /const ok=await saveToSupabase\(fresh\);/);
  assert.match(fnBody, /if\(!ok\)\{/);
  assert.match(fnBody, /throw new Error\('Salvataggio delle osservazioni non riuscito'\)/);
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
console.log('');
console.log('NOTA: T2, T3, T5(end-to-end), T6, T7, T8(end-to-end), T10, T11, T12 e i test');
console.log('comportamentali B1/B2 richiedono una vera risposta Anthropic + persistenza');
console.log('Supabase reale (credenziali assenti in questo ambiente). Usa');
console.log('scripts/test-m1-live.js contro il deployment reale per quei casi.');

if (failed > 0) process.exit(1);
