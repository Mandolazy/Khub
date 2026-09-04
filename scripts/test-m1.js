/*
 * Test M1 — Primo Consulto (STEP R2, KHUB avanzata / MichelinAI 2.0).
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
 *     branch mode:'m1', del gate "gia' avvenuto" (D1), che runM1() non
 *     muti mai ingredienti/steps della Ricetta, che il vecchio
 *     runPrimoConsulto() non sia piu' collegato a nessun pulsante (ma
 *     resti presente, invariato, come storico), e che il pannello
 *     "Primo Consulto" nel LAB legga ora L2 provenance='m1' e non piu'
 *     variants.primo_consulto per determinare lo stato corrente.
 *
 * Cosa NON e' eseguibile da questo script (richiede ANTHROPIC_API_KEY e
 * SUPABASE_URL/SUPABASE_ANON_KEY configurate sul deployment Vercel reale,
 * assenti in questo ambiente): la chiamata end-to-end reale al modello e
 * la persistenza reale su Supabase. Per quelli vedi scripts/test-m1-live.js
 * (chiamata live, nessuna persistenza) e la verifica manuale in app.
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

test('risposta vuota viene rifiutata', () => {
  assert.throws(() => parseM1Response('   '), /Risposta AI vuota/);
});

test('marcatore osservazioni mancante viene rifiutato', () => {
  assert.throws(() => parseM1Response('Solo testo, nessun blocco strutturato.'), /Blocco osservazioni mancante/);
});

test('testo user-facing vuoto (marcatore in testa) viene rifiutato', () => {
  const text = '===M1_OBSERVATIONS===\n{"observations":[{"label":"x","content":"y"}]}';
  assert.throws(() => parseM1Response(text), /Lettura del Primo Consulto vuota/);
});

test('JSON malformato dopo il marcatore viene rifiutato', () => {
  const text = 'Testo.\n===M1_OBSERVATIONS===\n{observations: [non valido}';
  assert.throws(() => parseM1Response(text), /non e'JSON valido/);
});

test('observations non-array viene rifiutato', () => {
  const text = 'Testo.\n===M1_OBSERVATIONS===\n{"observations":"non un array"}';
  assert.throws(() => parseM1Response(text), /Formato osservazioni non valido/);
});

test('zero osservazioni valide (array vuoto) viene rifiutato', () => {
  const text = 'Testo.\n===M1_OBSERVATIONS===\n{"observations":[]}';
  assert.throws(() => parseM1Response(text), /Nessuna osservazione valida prodotta/);
});

test('osservazioni senza content valido vengono filtrate; se restano zero, rifiutato', () => {
  const text = 'Testo.\n===M1_OBSERVATIONS===\n{"observations":[{"label":"x"},{"content":""},{"content":123}]}';
  assert.throws(() => parseM1Response(text), /Nessuna osservazione valida prodotta/);
});

test('L2 costruiti da osservazioni valide hanno i campi deterministici corretti (gate M1)', () => {
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
    assert.ok(item.baselineHash, 'baseline_hash mancante');
    assert.ok(item.baselineContext, 'baseline_context mancante');
    assert.ok(item.id, 'id mancante');
  });
});

test('tutti gli L2 dello stesso M1 condividono baseline_hash e baseline_context', () => {
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
console.log('B. verifiche strutturali su api/chat.js e khub_mvp.html (base avanzata R2)');

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
  const m1Block = chat.slice(chat.indexOf("body.mode === 'm1'"), chat.indexOf("body.mode === 'm2'"));
  assert.ok(m1Block.length > 0, 'boundary del blocco m1 non trovata');
  const calls = (m1Block.match(/api\.anthropic\.com/g) || []).length;
  assert.strictEqual(calls, 1, 'attesa 1 sola chiamata Anthropic nel branch m1, trovate ' + calls);
});

test('M1_SYSTEM_PROMPT: P6 (assertivita\' proporzionata, commit 27ac7a5) e\' applicato operativamente', () => {
  const promptStart = chat.indexOf('const M1_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  [
    "non affermare come fatto avvenuto",
    "non attribuire un esito a una soglia numerica precisa",
    "prescrizione universale",
    "se un'informazione che incide sul giudizio non e' disponibile",
    "Questo non significa diventare vago",
    "vale anche per il contenuto che scrivi nel blocco delle osservazioni strutturate",
  ].forEach(clause => {
    assert.ok(prompt.includes(clause), 'clausola operativa P6 mancante nel prompt: "' + clause + '"');
  });
  // Il criterio di successo e il framework restano quelli originali: nessuna nuova regola cognitiva.
  assert.match(prompt, /Costruisci una lettura specifica, selettiva e argomentata/);
  assert.match(prompt, /sensoriale: dolcezza/);
});

test("api/chat.js: il payload Anthropic del branch m1 contiene esplicitamente model, max_tokens, system, messages", () => {
  const m1Block = chat.slice(chat.indexOf("body.mode === 'm1'"), chat.indexOf("body.mode === 'm2'"));
  const bodyStart = m1Block.indexOf('body: JSON.stringify({');
  assert.ok(bodyStart !== -1, 'non trovato "body: JSON.stringify({" nel branch m1');
  const bodyEnd = m1Block.indexOf('}),', bodyStart);
  assert.ok(bodyEnd !== -1, 'non trovata chiusura del body JSON nel branch m1');
  const anthropicPayload = m1Block.slice(bodyStart, bodyEnd);
  ['model:', 'max_tokens:', 'system:', 'messages:'].forEach(key => {
    assert.ok(anthropicPayload.includes(key), 'payload Anthropic del branch m1 manca del campo: ' + key.replace(':', ''));
  });
  assert.match(anthropicPayload, /model:\s*'[^']+'/, "model deve essere una stringa esplicita non vuota, non un campo omesso o undefined");
});

test("api/chat.js (D4): l2_items e' l'ULTIMO step della sequenza di save (nessun L2 orfano se uno step successivo fallisce)", () => {
  const saveBlock = chat.slice(chat.indexOf("body.supabaseAction === 'save'"), chat.indexOf("body.supabaseAction === 'update'"));
  const writeCalls = [...saveBlock.matchAll(/mustSave\('(\w+)'/g)].map(m => m[1]);
  assert.ok(writeCalls.length > 0, 'nessuna chiamata mustSave() trovata nel blocco save');
  assert.strictEqual(writeCalls[writeCalls.length - 1], 'l2_items',
    "l'ultima mustSave() nel blocco save deve essere su l2_items, trovato invece: " + writeCalls[writeCalls.length - 1] + ' (ordine: ' + writeCalls.join(' -> ') + ')');
  const idxL3 = saveBlock.indexOf("mustSave('l3_items'");
  const idxL2 = saveBlock.indexOf("mustSave('l2_items'");
  assert.ok(idxL3 !== -1 && idxL2 !== -1, 'mustSave l3_items o l2_items non trovate nel blocco save');
  assert.ok(idxL3 < idxL2, 'l3_items deve essere scritto prima di l2_items (l2_items ultimo step)');
});

test("api/chat.js: gli altri supabaseAction (families, load, update, delete) e fetchUrl restano presenti e non rotti dal branch m1", () => {
  ['loadFamilies', 'saveFamily', 'saveVariantFamilies', "supabaseAction === 'load'", "supabaseAction === 'update'", "supabaseAction === 'delete'", 'body.fetchUrl'].forEach(needle => {
    assert.ok(chat.includes(needle), 'azione mancante in api/chat.js: ' + needle);
  });
});

test("khub_mvp.html: gate 'gia' avvenuto' (D1) basato su L2 provenance m1, nessun nuovo flag DB", () => {
  assert.match(html, /function hasM1\(v\)\{return\(\(v&&v\.l2Items\)\|\|\[\]\)\.some\(x=>x\.provenanceType==='m1'\)/);
  assert.match(html, /if\(hasM1\(v\)\)return;/);
});

test("khub_mvp.html: M1 disponibile solo su Bozze LAB (runM1 opera su curLab, mai su validatedVariants)", () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function runPrimoConsulto'));
  assert.match(fnBody, /const v=recipe&&curLab\(recipe\);/);
  assert.doesNotMatch(fnBody, /validatedVariants/);
});

test('khub_mvp.html (D1): runPrimoConsulto() legacy resta definito e invariato, ma non piu\' collegato a nessun pulsante onclick', () => {
  assert.match(html, /async function runPrimoConsulto\(recipeId\)\{/);
  assert.doesNotMatch(html, /onclick="runPrimoConsulto\(/);
});

test('khub_mvp.html (D1): il pannello "Primo Consulto" nel LAB chiama runM1(), non piu\' runPrimoConsulto()', () => {
  assert.match(html, /onclick="runM1\('\$\{recipe\.id\}'\)"/);
});

test('khub_mvp.html (D1): variants.primo_consulto non viene piu\' scritto da nessuna funzione M1 (legacy: colonna letta ma mai scritta da runM1)', () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function runPrimoConsulto'));
  assert.doesNotMatch(fnBody, /primoConsulto:/);
});

test('khub_mvp.html: nessun residuo ATTIVO del pannello legacy "Consulente AI" con modifica automatica della Ricetta (solo la nota storica nel commento e\' ammessa)', () => {
  // Il commento a riga ~853 nomina "applyAISugg" solo per dire che e' gia'
  // stato rimosso in Step 3A (prima ancora del recovery avanzato): e' storia,
  // non codice. Qui si verifica che non esista alcun punto di codice VIVO
  // (definizione o chiamata) che lo referenzi.
  ['function applyAISugg(', 'onclick="applyAISugg', 'function sendAI(', 'onclick="sendAI(', 'id="btn-send-ai"', 'aiSugg.map(', 'aiSugg=['].forEach(needle => {
    assert.ok(!html.includes(needle), 'trovato residuo legacy pericoloso ATTIVO: ' + needle);
  });
});

test("khub_mvp.html: M1 usa KhubBaseline.compute() una sola volta per run", () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function runPrimoConsulto'));
  const calls = (fnBody.match(/KhubBaseline\.compute\(/g) || []).length;
  assert.strictEqual(calls, 1, 'atteso 1 solo compute() per Primo Consulto, trovati ' + calls);
});

test('khub_mvp.html: lib/baseline.js e\' caricato prima dello script principale', () => {
  const idxBaseline = html.indexOf('<script src="lib/baseline.js"></script>');
  const idxMain = html.indexOf('\n<script>');
  assert.ok(idxBaseline !== -1, 'tag lib/baseline.js non trovato');
  assert.ok(idxMain !== -1 && idxBaseline < idxMain, 'lib/baseline.js deve essere caricato prima dello script principale');
});

test('khub_mvp.html: runM1() non muta mai ingredienti/steps della Ricetta (nessuna chiamata alle funzioni di editing)', () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function runPrimoConsulto'));
  ['onIngQty(', 'onIngUnit(', 'onIngName(', 'addIngredient(', 'delIngredient(', 'onStepText(', 'addStep(', 'delStep('].forEach(needle => {
    assert.ok(!fnBody.includes(needle), 'runM1 chiama una funzione di editing Ricetta: ' + needle);
  });
});

test("khub_mvp.html: le uniche mutazioni di stato in runM1() toccano solo l2Items, mai ingredients/steps", () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function runPrimoConsulto'));
  const upLabCalls = fnBody.match(/upLab\(recipeId,lab=>\(\{[^}]*\}\)\)/g) || [];
  assert.ok(upLabCalls.length >= 2, 'attese almeno 2 chiamate upLab (add + rollback), trovate ' + upLabCalls.length);
  upLabCalls.forEach(call => {
    assert.match(call, /l2Items:/, 'una chiamata upLab in runM1 non tocca l2Items: ' + call);
    assert.doesNotMatch(call, /ingredients:/, 'una chiamata upLab in runM1 tocca ingredients: ' + call);
    assert.doesNotMatch(call, /steps:/, 'una chiamata upLab in runM1 tocca steps: ' + call);
  });
});

test('khub_mvp.html: M1 non completato se saveToSupabase() fallisce (rollback esplicito, gate 4)', () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function runPrimoConsulto'));
  assert.match(fnBody, /const ok=await saveToSupabase\(fresh\);/);
  assert.match(fnBody, /if\(!ok\)\{/);
  assert.match(fnBody, /throw new Error\('Salvataggio delle osservazioni non riuscito'\)/);
});

test('khub_mvp.html: saveToSupabase() restituisce true/false, cosi\' runM1() puo\' verificare il gate 4', () => {
  const fnBody = html.slice(html.indexOf('async function saveToSupabase'), html.indexOf('async function deleteRecipe'));
  assert.match(fnBody, /return false;/);
  assert.match(fnBody, /return true;/);
});

test('khub_mvp.html: runM1() scarta il risultato se la Bozza e\' cambiata durante l\'attesa (controllo avanzato preservato)', () => {
  const fnBody = html.slice(html.indexOf('async function runM1'), html.indexOf('async function runPrimoConsulto'));
  assert.match(fnBody, /const recipeOra=R\(recipeId\);/);
  assert.match(fnBody, /const labOra=recipeOra&&curLab\(recipeOra\);/);
  assert.match(fnBody, /labOra\.id!==variantId/);
  assert.doesNotMatch(fnBody, /upLab\(recipeId,lab=>\(\{\.\.\.lab,l2Items:\[\.\.\.\(lab\.l2Items\|\|\[\]\),\.\.\.newL2\]\}\)\);\s*\n\s*const recipeOra/, 'il salvataggio degli L2 non deve avvenire prima del controllo bozza-cambiata');
});

test('khub_mvp.html: pannello "Primo Consulto" nel LAB legge le osservazioni da v.l2Items (provenance m1), non piu\' da v.primoConsulto per lo stato corrente', () => {
  const idx = html.indexOf("labSectionHeader(recipe.id,'primoConsulto'");
  assert.ok(idx !== -1, 'sezione "Primo Consulto" non trovata nel render del LAB');
  const block = html.slice(idx, idx + 3000);
  assert.match(block, /hasM1\(v\)/);
  assert.match(block, /osservazioniM1=\(v\.l2Items\|\|\[\]\)\.filter\(x=>x\.provenanceType==='m1'\)/);
});

console.log('');
console.log('C. verifica preservazione funzionalita\' avanzata + PSL (non regressione R1)');

test('khub_mvp.html (R3F): interpretaModifiche/chiediMichelinAI legacy sono state assorbite da M2 e rimosse, mai più raggiungibili', () => {
  assert.doesNotMatch(html, /async function interpretaModifiche\(recipeId\)\{/);
  assert.doesNotMatch(html, /async function chiediMichelinAI\(recipeId\)\{/);
  assert.doesNotMatch(html, /onclick="[^"]*interpretaModifiche/);
  assert.doesNotMatch(html, /addEventListener\('click',\(\)=>chiediMichelinAI/);
});

test('khub_mvp.html: Famiglie/mattoncini, merge Schede, yield analysis, cronologia restano presenti', () => {
  assert.match(html, /async function saveFamilies\(/);
  assert.match(html, /async function confirmMerge\(\)\{/);
  assert.match(html, /async function analyzeYields\(/);
  assert.match(html, /function addHistory\(/);
});

test('khub_mvp.html (D3): identita\' variant.id nel lifecycle resta preservata (onValidate/rendiAttiva)', () => {
  const onValidateBody = html.slice(html.indexOf('function onValidate()'), html.indexOf('async function confirmValidate()'));
  assert.match(onValidateBody, /id:v\.id,name,/);
  const rendiAttivaBody = html.slice(html.indexOf('function rendiAttiva('), html.indexOf('function onValidate()'));
  assert.match(rendiAttivaBody, /id:v\.id,/);
});

test('khub_mvp.html (D2): active resta la source of truth, nessun residuo funzionale di .shared', () => {
  assert.doesNotMatch(html, /toggleSharedV2/);
  assert.doesNotMatch(html, /\.shared\b/);
});

test('api/chat.js (D2/D3/D4): load a 5 query, save fail-fast, invariati da R1', () => {
  assert.match(chat, /l2_items\?select=\*/);
  assert.match(chat, /const mustSave = async/);
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
console.log('');
console.log('NOTA: la chiamata end-to-end reale al modello Anthropic e la persistenza');
console.log('reale su Supabase NON sono eseguibili da questo ambiente (nessuna');
console.log('credenziale). Usa scripts/test-m1-live.js contro un deployment reale per');
console.log('la revisione qualitativa dell\'output del modello, e verifica manuale in');
console.log('app (Bozza in LAB -> "Avvia il Primo Consulto") per la persistenza reale.');

if (failed > 0) process.exit(1);
