/*
 * Test R3A — contratto mode:'m2' (M2, SVILUPPO) in api/chat.js.
 * Nessun framework introdotto: Node puro + assert, stesso stile di
 * test-m1.js/test-persistent-state.js.
 *
 * SCOPE DI R3A (e quindi di questo file): SOLO il contratto API/payload.
 * Nessuna UI, nessuna persistenza M2, nessuna reconciliation baseline/L2 —
 * tutto questo e' rimandato a R3B-G. Qui si verifica solo che:
 *  - il branch mode==='m2' esista e sia server-side (system prompt, non
 *    costruito lato client);
 *  - il payload in ingresso e la richiesta Anthropic abbiano la forma
 *    prevista;
 *  - il contratto di output (marcatore + JSON) sia definito in modo da
 *    poter supportare risposta + proposte strutturate (l2_updates/l2_new/
 *    intention_change/criteria_change/l3_candidates) SENZA che nulla di
 *    tutto questo venga scritto in DB da questo branch (mode:'m2' non
 *    tocca mai Supabase, esattamente come mode:'m1');
 *  - i gate epistemici (confirmed solo con attribuzione chef, L3 mai
 *    autonomo, intention/criteria mai adottati autonomamente) siano
 *    presenti nel prompt come istruzioni operative, non solo dichiarati;
 *  - M1 non sia stato toccato (i test veri e propri di non-regressione
 *    restano in test-m1.js, da rieseguire insieme a questo file — qui
 *    solo un controllo leggero e ridondante di sicurezza).
 *
 * DOCUMENTAZIONE DEL CONTRATTO (per chi implementera' R3B-E):
 *
 * INPUT (POST /api/chat, body):
 * {
 *   mode: 'm2',
 *   recipe: { id, name, category },
 *   variant: { id, ingredients:[{name,qty,unit}], steps:[string], portionsCount, gramsPerPortion, note },
 *   l2: [ { id, operationalState, decisionState, content, evidence, provenanceType, sourceL2ItemId, baselineHash, baselineContext } ],
 *   l3: [ { id, distilledContent, contextConditions, knownLimits, originL2ItemId, supersedesId } ],
 *   intention: { initial, current },
 *   criteria: { initial, current },
 *   message: 'testo del turno corrente dello chef',
 * }
 * Nessun campo di transcript/cronologia: la continuita' e' L2/L3/intention/
 * criteria, non una lista di turni precedenti (vincolo congelato).
 *
 * OUTPUT (risposta Anthropic, stesso pattern di M1): la risposta rivolta
 * allo chef e' ESCLUSIVAMENTE la prosa che precede il marcatore — non viene
 * ripetuta nel JSON. Il blocco strutturato contiene SOLO le proposte
 * cognitive:
 * [prosa per lo chef]
 * ===M2_UPDATE===
 * {
 *   "l2_updates": [ { "id": "<id L2 esistente>", "operational_state"?, "decision_state"?, "content"?, "evidence"? } ],
 *   "l2_new": [ { "operational_state", "decision_state", "content":{"label","text"}, "evidence"? } ],  // MAI un id: lo assegna l'app
 *   "intention_change": null | { proposta },
 *   "criteria_change": null | { proposta },
 *   "l3_candidates": [ { "distilled_content", "origin_l2_item_id", "context_conditions", "known_limits" } ],
 * }
 * "evidence" e' opzionale in l2_updates/l2_new: va proposto SOLO quando
 * l'osservazione e' effettivamente valutata/rivalutata in questo turno, mai
 * aggiunto o modificato automaticamente solo perche' la Bozza e' cambiata.
 * Tutto cio' che il modello produce nel blocco JSON sono PROPOSTE: R3A non
 * le persiste, non le valida contro il DB, non le applica. La decisione su
 * cosa persistere davvero appartiene agli step successivi (R3C
 * reconciliation, R3E persistenza) e, in ultima analisi, allo chef.
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

const chat = read('api/chat.js');

console.log('A. esistenza e forma del branch mode==="m2"');

test("esiste il branch mode==='m2'", () => {
  assert.match(chat, /if \(body\.mode === 'm2'\)/);
});

test('il branch m2 viene DOPO il branch m1 e prima del fallback legacy (nessuna interferenza di ordine)', () => {
  const idxM1 = chat.indexOf("if (body.mode === 'm1')");
  const idxM2 = chat.indexOf("if (body.mode === 'm2')");
  const idxFallback = chat.indexOf('// Proxy Anthropic legacy');
  assert.ok(idxM1 !== -1 && idxM2 !== -1 && idxFallback !== -1, 'uno dei tre marcatori non e\' stato trovato');
  assert.ok(idxM1 < idxM2 && idxM2 < idxFallback, 'ordine atteso: m1 -> m2 -> fallback legacy');
});

test('M2_SYSTEM_PROMPT e\' costruito server-side (non passato dal client) — stesso pattern di M1', () => {
  assert.match(chat, /const M2_SYSTEM_PROMPT = `/);
  const m2Start = chat.indexOf("if (body.mode === 'm2')");
  const m2Block = chat.slice(m2Start, chat.indexOf('// Proxy Anthropic legacy'));
  assert.match(m2Block, /system: M2_SYSTEM_PROMPT/);
});

test('il branch m2 usa una sola chiamata Anthropic (nessun secondo passaggio)', () => {
  const m2Start = chat.indexOf("if (body.mode === 'm2')");
  const m2Block = chat.slice(m2Start, chat.indexOf('// Proxy Anthropic legacy'));
  const calls = (m2Block.match(/api\.anthropic\.com/g) || []).length;
  assert.strictEqual(calls, 1, 'attesa 1 sola chiamata Anthropic nel branch m2, trovate ' + calls);
});

test("il payload Anthropic del branch m2 contiene esplicitamente model, max_tokens, system, messages", () => {
  const m2Start = chat.indexOf("if (body.mode === 'm2')");
  const m2Block = chat.slice(m2Start, chat.indexOf('// Proxy Anthropic legacy'));
  const bodyStart = m2Block.indexOf('body: JSON.stringify({');
  assert.ok(bodyStart !== -1, 'non trovato "body: JSON.stringify({" nel branch m2');
  const bodyEnd = m2Block.indexOf('}),', bodyStart);
  assert.ok(bodyEnd !== -1, 'non trovata chiusura del body JSON nel branch m2');
  const anthropicPayload = m2Block.slice(bodyStart, bodyEnd);
  ['model:', 'max_tokens:', 'system:', 'messages:'].forEach(key => {
    assert.ok(anthropicPayload.includes(key), 'payload Anthropic del branch m2 manca del campo: ' + key.replace(':', ''));
  });
  assert.match(anthropicPayload, /model:\s*'[^']+'/, 'model deve essere una stringa esplicita non vuota');
});

console.log('');
console.log('B. payload strutturato in ingresso (buildM2UserMessage)');

test('buildM2UserMessage esiste ed e\' una funzione server-side pura (nessuna chiamata di rete al suo interno)', () => {
  const fnStart = chat.indexOf('function buildM2UserMessage(body)');
  assert.ok(fnStart !== -1, 'buildM2UserMessage non trovata');
  const fnEnd = chat.indexOf('\nexport default async function handler', fnStart);
  const fnBody = chat.slice(fnStart, fnEnd === -1 ? fnStart + 3000 : fnEnd);
  assert.doesNotMatch(fnBody, /fetch\(/, 'buildM2UserMessage non deve fare chiamate di rete');
});

test('buildM2UserMessage riceve recipe/variant/l2/l3/intention/criteria/message dal body', () => {
  const fnStart = chat.indexOf('function buildM2UserMessage(body)');
  const fnEnd = chat.indexOf('\nexport default async function handler', fnStart);
  const fnBody = chat.slice(fnStart, fnEnd);
  ['body.recipe', 'body.variant', 'body.l2', 'body.l3', 'body.intention', 'body.criteria', 'body.message'].forEach(field => {
    assert.ok(fnBody.includes(field), 'buildM2UserMessage non legge ' + field);
  });
});

test('buildM2UserMessage tratta L2 come lista unica (nessuna sezione separata "osservazioni M1")', () => {
  const fnStart = chat.indexOf('function buildM2UserMessage(body)');
  const fnEnd = chat.indexOf('\nexport default async function handler', fnStart);
  const fnBody = chat.slice(fnStart, fnEnd);
  assert.match(fnBody, /OSSERVAZIONI L2 ESISTENTI/);
  assert.doesNotMatch(fnBody, /OSSERVAZIONI M1|M1_OBSERVATIONS|blocco M1/i, 'non deve esistere una sezione L2 separata per sola provenienza m1');
});

test('buildM2UserMessage include il messaggio del turno corrente (mai una cronologia)', () => {
  const fnStart = chat.indexOf('function buildM2UserMessage(body)');
  const fnEnd = chat.indexOf('\nexport default async function handler', fnStart);
  const fnBody = chat.slice(fnStart, fnEnd);
  assert.match(fnBody, /MESSAGGIO DELLO CHEF IN QUESTO TURNO/);
  assert.doesNotMatch(fnBody, /cronologia|transcript|history/i, 'nessun riferimento a cronologia/transcript persistente nel context builder');
});

test('buildM2UserMessage espone x.evidence delle L2 esistenti (campo gia\' dichiarato nell\'input, ora anche visibile al modello)', () => {
  const fnStart = chat.indexOf('function buildM2UserMessage(body)');
  const fnEnd = chat.indexOf('\nexport default async function handler', fnStart);
  const fnBody = chat.slice(fnStart, fnEnd);
  assert.match(fnBody, /x\.evidence/);
});

test('mini-sprint E2E FIX 3: buildM2UserMessage rende esplicito x.baselineStatus per ciascun L2, MAI baseline_hash/baseline_context grezzo', () => {
  const fnStart = chat.indexOf('function buildM2UserMessage(body)');
  const fnEnd = chat.indexOf('\nexport default async function handler', fnStart);
  const fnBody = chat.slice(fnStart, fnEnd);
  assert.match(fnBody, /x\.baselineStatus/, 'baselineStatus non renderizzato nella riga L2');
  assert.doesNotMatch(fnBody, /x\.baselineHash/, 'baseline_hash grezzo non deve mai essere renderizzato al modello');
  assert.doesNotMatch(fnBody, /x\.baselineContext/, 'baseline_context grezzo non deve mai essere renderizzato al modello');
});

test('mini-sprint E2E FIX 3: il prompt spiega current/divergent, vieta l\'auto-mutazione e non tocca i gate esistenti', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  assert.match(prompt, /"current"/);
  assert.match(prompt, /"divergent"/);
  assert.match(prompt, /Divergent NON significa che l'osservazione sia risolta, ne' che sia diventata affected/);
  assert.match(prompt, /divergent da solo non autorizza mai un aggiornamento automatico/);
  // Il divieto di aggiornamento massivo (gia' testato altrove) deve restare
  // valido esplicitamente anche nel nuovo caso "piu' osservazioni divergent
  // insieme" — nessuna eccezione introdotta dalla nuova informazione.
  assert.match(prompt, /vale anche quando piu' osservazioni sono divergent insieme/);
  // Il gate epistemico su decision_state:"confirmed" resta testualmente
  // identico (vedi anche sezione D piu' sotto): qui verifichiamo solo che
  // il nuovo paragrafo non lo duplichi/ridefinisca.
  const gateOccurrences = (prompt.match(/contiene un'attribuzione chiara ed esplicita/g) || []).length;
  assert.strictEqual(gateOccurrences, 1, 'il gate epistemico su confirmed deve comparire una sola volta, invariato');
});

console.log('');
console.log('C. contratto di output (marcatore + JSON strutturato)');

test('il prompt definisce il marcatore ===M2_UPDATE=== e la forma esatta del JSON atteso', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  assert.match(prompt, /===M2_UPDATE===/);
  ['"l2_updates"', '"l2_new"', '"intention_change"', '"criteria_change"', '"l3_candidates"'].forEach(key => {
    assert.ok(prompt.includes(key), 'chiave mancante nel contratto di output M2: ' + key);
  });
});

test('il blocco JSON NON contiene piu\' "response": la risposta allo chef e\' solo la prosa prima del marcatore', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  // Lo schema JSON di esempio e' sulla riga subito dopo il marcatore.
  const markerIdx = prompt.indexOf('===M2_UPDATE===');
  const schemaLine = prompt.slice(markerIdx, prompt.indexOf('\n', markerIdx + 1) === -1 ? markerIdx + 500 : prompt.indexOf('\n\n', markerIdx));
  assert.doesNotMatch(schemaLine, /"response"/, 'la chiave "response" non deve piu\' comparire nello schema JSON di esempio');
  assert.match(prompt, /la risposta rivolta allo chef e' esclusivamente la prosa del punto 1, non va ripetuta qui dentro/);
});

test('"evidence" e\' un campo opzionale sia in l2_updates sia in l2_new, con la regola "solo se rivalutato"', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  const markerIdx = prompt.indexOf('===M2_UPDATE===');
  const schemaLine = prompt.slice(markerIdx, prompt.indexOf('\n\n', markerIdx));
  // presente nello schema di esempio sia per l2_updates sia per l2_new
  const l2UpdatesSchema = schemaLine.slice(schemaLine.indexOf('"l2_updates"'), schemaLine.indexOf('"l2_new"'));
  const l2NewSchema = schemaLine.slice(schemaLine.indexOf('"l2_new"'), schemaLine.indexOf('"intention_change"'));
  assert.match(l2UpdatesSchema, /"evidence"/, 'evidence assente dallo schema di esempio di l2_updates');
  assert.match(l2NewSchema, /"evidence"/, 'evidence assente dallo schema di esempio di l2_new');
  // regola esplicita: mai automatico solo perche' la Bozza e' cambiata
  assert.match(prompt, /"evidence" e' opzionale: proponilo SOLO se stai davvero rivalutando quell'osservazione in questo turno/);
  assert.match(prompt, /mai per il solo fatto che la Bozza e' cambiata altrove/);
});

test('il prompt vincola operational_state/decision_state agli stessi vocabolari PSL congelati', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  assert.match(prompt, /unengaged, open, affected, superseded, resolved/);
  assert.match(prompt, /none, probable, confirmed/);
  assert.match(prompt, /unengaged.*decision_state deve essere "none"/);
});

test('il prompt vieta esplicitamente all\'AI di inventare id per le nuove osservazioni (l2_new)', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  assert.match(prompt, /Non includere mai un id: lo assegna l'applicazione/);
});

console.log('');
console.log('D. gate epistemici (P10: confirmed/L3/intention-criteria mai autonomi)');

test('gate: decision_state confirmed richiede attribuzione esplicita dello chef nel turno, mai inferenza autonoma', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  assert.match(prompt, /confirmed.*SOLO quando il messaggio dello chef.*attribuzione chiara ed esplicita/s);
  assert.match(prompt, /mai come tua inferenza autonoma/);
});

test('gate: L3 non puo\' mai essere dichiarato autonomamente consolidato dall\'AI', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  assert.match(prompt, /Non puoi mai dichiarare autonomamente un candidato L3 gia' "consolidato"/);
  assert.match(prompt, /evidenza L2 sufficiente E una decisione confirmed dello chef/);
});

test('gate: intention/criteria non possono essere adottati autonomamente dall\'AI, solo proposti', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  assert.match(prompt, /Non puoi mai adottare autonomamente un cambio di intention o criteria/);
});

test('il prompt dichiara esplicitamente che l\'output e\' fatto di PROPOSTE, non scritture', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  assert.match(prompt, /TU PROPONI, NON SCRIVI/);
  assert.match(prompt, /Non decidi tu cosa viene davvero persistito/);
});

test('il prompt vieta a M2 di modificare autonomamente la Ricetta (ingredienti/procedimento)', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  assert.match(prompt, /TU NON MODIFICHI MAI LA RICETTA/);
});

test('il prompt istruisce la riconciliazione lazy: una modifica NON prova automaticamente che un problema sia risolto', () => {
  const promptStart = chat.indexOf('const M2_SYSTEM_PROMPT = `');
  const promptEnd = chat.indexOf('`;', promptStart);
  const prompt = chat.slice(promptStart, promptEnd);
  assert.match(prompt, /NON prova automaticamente che un problema sia risolto/);
  assert.match(prompt, /Nessun aggiornamento massivo/);
});

console.log('');
console.log('E. assenza di persistenza M2 in R3A (mode:\'m2\' non tocca mai Supabase)');

test("il branch m2 non chiama supabaseAction/sbPost/Supabase in alcun modo", () => {
  const m2Start = chat.indexOf("if (body.mode === 'm2')");
  const m2End = chat.indexOf('// Proxy Anthropic legacy');
  const m2Block = chat.slice(m2Start, m2End);
  assert.doesNotMatch(m2Block, /supabaseAction/);
  assert.doesNotMatch(m2Block, /sbPost\(/);
  assert.doesNotMatch(m2Block, /SB \+ '\/rest\/v1/, 'il branch m2 non deve interrogare Supabase direttamente');
});

test('R3A non ha aggiunto alcuna nuova supabaseAction (l2/l3/intention/criteria restano quelle di R1, invariate)', () => {
  const occorrenze = (chat.match(/body\.supabaseAction === '(\w+)'/g) || []).map(s => s.match(/'(\w+)'/)[1]);
  const attese = ['loadFamilies', 'saveFamily', 'saveVariantFamilies', 'load', 'save', 'update', 'delete'];
  assert.deepStrictEqual([...new Set(occorrenze)].sort(), [...attese].sort(),
    'set di supabaseAction cambiato rispetto a R1/R2 — atteso invariato in R3A');
});

console.log('');
console.log('F. non regressione M1 (controllo leggero e ridondante — la suite reale resta test-m1.js)');

test('M1_SYSTEM_PROMPT e branch mode==="m1" restano presenti e invariati nella forma', () => {
  assert.match(chat, /const M1_SYSTEM_PROMPT = `/);
  assert.match(chat, /if \(body\.mode === 'm1'\)/);
  assert.match(chat, /model: 'claude-sonnet-4-5',\s*\n\s*max_tokens: 3000,\s*\n\s*system: M1_SYSTEM_PROMPT/);
});

test('buildM1UserMessage resta invariata (stessa firma, stesso corpo minimo atteso)', () => {
  assert.match(chat, /function buildM1UserMessage\(body\) \{/);
  const fnStart = chat.indexOf('function buildM1UserMessage(body)');
  const fnEnd = chat.indexOf('\nexport default async function handler', fnStart);
  const fnBody = chat.slice(fnStart, fnEnd === -1 ? fnStart + 2000 : fnEnd);
  assert.match(fnBody, /CONOSCENZA PRECEDENTE DELLA SCHEDA \(L3\):/);
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
console.log('');
console.log('NOTA: questo file verifica solo la FORMA del contratto (server-side, statica).');
console.log('La chiamata Anthropic reale (risposta effettiva del modello al formato');
console.log('richiesto) NON e\' eseguibile da questo ambiente: nessuna credenziale.');
console.log('Va verificata manualmente contro un deployment reale, come gia\' fatto per M1');
console.log('con scripts/test-m1-live.js, quando si passera\' a implementare runM2() (R3D+).');

if (failed > 0) process.exit(1);
