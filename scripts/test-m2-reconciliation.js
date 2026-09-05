/*
 * Test R3C — Reconciliation baseline/L2 (lib/reconciliation.js).
 *
 * A differenza dei test su khub_mvp.html (regex o estrazione via
 * new Function), lib/reconciliation.js è un modulo Node reale: qui viene
 * caricato con require() diretto, come già fa test-persistent-state.js
 * con lib/baseline.js. Nessuna estrazione, nessun sandbox custom.
 *
 * Copre il contratto approvato (audit R3C) e le due decisioni congelate:
 *  #1 — rifiuto TOTALE dell'update se tenta una transizione non
 *       autorizzata verso confirmed (mai applicazione parziale);
 *  #2 — il gate chef-attribution si applica SOLO sulla transizione
 *       existing.decisionState !== 'confirmed' -> resulting === 'confirmed';
 *       un item già confirmed resta aggiornabile (operational_state,
 *       content, evidence, baseline) senza una nuova attribuzione.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'lib', 'reconciliation.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + e.message); failed++; }
}

function makeL2(overrides) {
  return Object.assign({
    id: 'l2_1', operationalState: 'open', decisionState: 'none',
    content: { label: 'x', text: 'y' }, evidence: null,
    provenanceType: 'm1', sourceL2ItemId: null,
    baselineHash: 'hash_old', baselineContext: { note: 'vecchio' },
  }, overrides || {});
}

const VARIANT_A = { ingredients: [{ name: 'Farina', qty: 500, unit: 'g' }], steps: ['Impastare.'], portionsCount: 4, gramsPerPortion: 200, note: '' };
const VARIANT_B = { ingredients: [{ name: 'Farina', qty: 550, unit: 'g' }], steps: ['Impastare.'], portionsCount: 4, gramsPerPortion: 200, note: '' }; // diverso da A (550 vs 500)

console.log('A/B. buildSnapshot/computeCurrentBaseline/classifyBaseline: current vs divergent');

test('A: stesso baseline -> current', () => {
  const baseline = R.computeCurrentBaseline(VARIANT_A);
  const l2 = [makeL2({ id: 'l2_same', baselineHash: baseline.baseline_hash })];
  const cls = R.classifyBaseline(l2, baseline.baseline_hash);
  assert.strictEqual(cls[0].status, 'current');
});

test('B: baseline diverso -> divergent, ma NESSUNO stato L2 cambia (classifyBaseline è puro)', () => {
  const before = makeL2({ id: 'l2_div', baselineHash: 'hash_vecchio', operationalState: 'open', decisionState: 'probable' });
  const beforeSnapshot = JSON.parse(JSON.stringify(before));
  const currentBaseline = R.computeCurrentBaseline(VARIANT_B);
  const cls = R.classifyBaseline([before], currentBaseline.baseline_hash);
  assert.strictEqual(cls[0].status, 'divergent');
  assert.deepStrictEqual(before, beforeSnapshot, 'classifyBaseline ha mutato l\'item originale');
});

test('buildSnapshot produce la stessa forma esatta usata da runM1() in khub_mvp.html (stessa serializzazione)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
  const m1SnippetStart = html.indexOf('const snapshot={');
  const m1Snippet = html.slice(m1SnippetStart, m1SnippetStart + 400);
  ['ingredients:', 'steps:', 'portionsCount:', 'gramsPerPortion:', 'note:'].forEach(k => {
    assert.ok(m1Snippet.includes(k), 'snapshot di runM1() non contiene piu\' il campo atteso: ' + k);
  });
  const snap = R.buildSnapshot(VARIANT_A);
  assert.deepStrictEqual(Object.keys(snap).sort(), ['gramsPerPortion', 'ingredients', 'note', 'portionsCount', 'steps'].sort());
});

console.log('');
console.log('C-H. divergenza non tocca stati esistenti (nessun update proposto per quell\'id)');

const currentBaseline = R.computeCurrentBaseline(VARIANT_B);

test('C: unengaged M1 + divergence -> resta unengaged/none', () => {
  const item = makeL2({ id: 'l2_m1', operationalState: 'unengaged', decisionState: 'none', provenanceType: 'm1', baselineHash: 'hash_vecchio' });
  const { items, applied, rejected } = R.applyL2Updates([item], [], currentBaseline, {});
  assert.strictEqual(items[0].operationalState, 'unengaged');
  assert.strictEqual(items[0].decisionState, 'none');
  assert.strictEqual(items[0], item, 'item non proposto per update deve tornare con la stessa reference');
  assert.deepStrictEqual(applied, []);
  assert.deepStrictEqual(rejected, []);
});

test('D: open + divergence -> resta open finché non rivalutato', () => {
  const item = makeL2({ id: 'l2_open', operationalState: 'open', decisionState: 'probable', baselineHash: 'hash_vecchio' });
  const { items } = R.applyL2Updates([item], [], currentBaseline, {});
  assert.strictEqual(items[0].operationalState, 'open');
  assert.strictEqual(items[0].decisionState, 'probable');
});

test('E: resolved + divergence -> resta resolved finché non rivalutato', () => {
  const item = makeL2({ id: 'l2_resolved', operationalState: 'resolved', decisionState: 'confirmed', baselineHash: 'hash_vecchio' });
  const { items } = R.applyL2Updates([item], [], currentBaseline, {});
  assert.strictEqual(items[0].operationalState, 'resolved');
});

test('F: confirmed + divergence -> decision_state resta confirmed', () => {
  const item = makeL2({ id: 'l2_conf', decisionState: 'confirmed', baselineHash: 'hash_vecchio' });
  const { items } = R.applyL2Updates([item], [], currentBaseline, {});
  assert.strictEqual(items[0].decisionState, 'confirmed');
});

test('G: divergence non cambia evidence/content', () => {
  const item = makeL2({ id: 'l2_ev', evidence: { fonte: 'originale' }, content: { label: 'A', text: 'B' }, baselineHash: 'hash_vecchio' });
  const { items } = R.applyL2Updates([item], [], currentBaseline, {});
  assert.deepStrictEqual(items[0].evidence, { fonte: 'originale' });
  assert.deepStrictEqual(items[0].content, { label: 'A', text: 'B' });
});

test('H: divergence non aggiorna baseline', () => {
  const item = makeL2({ id: 'l2_base', baselineHash: 'hash_vecchio', baselineContext: { note: 'vecchio' } });
  const { items } = R.applyL2Updates([item], [], currentBaseline, {});
  assert.strictEqual(items[0].baselineHash, 'hash_vecchio');
  assert.deepStrictEqual(items[0].baselineContext, { note: 'vecchio' });
});

console.log('');
console.log('I/J. rivalutazione selettiva: solo l\'item proposto riceve il nuovo baseline');

test('I: rivalutazione esplicita di UN SOLO item consente baseline update solo per quell\'id', () => {
  const itemA = makeL2({ id: 'l2_A', baselineHash: 'hash_vecchio' });
  const itemB = makeL2({ id: 'l2_B', baselineHash: 'hash_vecchio' });
  const { items, applied, rejected } = R.applyL2Updates(
    [itemA, itemB],
    [{ id: 'l2_A', operational_state: 'affected' }],
    currentBaseline,
    {}
  );
  const a = items.find(x => x.id === 'l2_A');
  assert.strictEqual(a.operationalState, 'affected');
  assert.strictEqual(a.baselineHash, currentBaseline.baseline_hash);
  assert.deepStrictEqual(a.baselineContext, currentBaseline.baseline_context);
  assert.deepStrictEqual(applied, ['l2_A']);
  assert.deepStrictEqual(rejected, []);
});

test('J: gli altri L2 divergenti mantengono il baseline precedente', () => {
  const itemA = makeL2({ id: 'l2_A', baselineHash: 'hash_vecchio' });
  const itemB = makeL2({ id: 'l2_B', baselineHash: 'hash_vecchio' });
  const { items } = R.applyL2Updates([itemA, itemB], [{ id: 'l2_A', operational_state: 'affected' }], currentBaseline, {});
  const b = items.find(x => x.id === 'l2_B');
  assert.strictEqual(b.baselineHash, 'hash_vecchio');
  assert.strictEqual(b, itemB, 'l2_B non proposto per update deve tornare con la stessa reference');
});

console.log('');
console.log('K/O/P/Q. gate epistemico confirmed (decisioni #1 rifiuto totale, #2 solo transizione)');

test('K: update verso confirmed senza chefAttributedThisTurn -> rifiutato, item invariato', () => {
  const item = makeL2({ id: 'l2_k', decisionState: 'probable', baselineHash: 'hash_vecchio' });
  const { items, applied, rejected } = R.applyL2Updates([item], [{ id: 'l2_k', decision_state: 'confirmed' }], currentBaseline, {});
  assert.strictEqual(items[0].decisionState, 'probable', 'decision_state non deve cambiare se il gate non e\' superato');
  assert.strictEqual(items[0], item, 'item rifiutato deve tornare con la stessa reference (invariato)');
  assert.deepStrictEqual(applied, []);
  assert.strictEqual(rejected.length, 1);
  assert.strictEqual(rejected[0].id, 'l2_k');
});

test('#1 rifiuto TOTALE: un update confirmed non autorizzato NON applica silenziosamente operational_state/content/evidence', () => {
  const item = makeL2({ id: 'l2_partial', operationalState: 'open', decisionState: 'probable', content: { label: 'vecchio', text: 'vecchio' }, evidence: null, baselineHash: 'hash_vecchio' });
  const proposta = { id: 'l2_partial', operational_state: 'affected', content: { label: 'nuovo', text: 'nuovo' }, evidence: { fonte: 'nuova' }, decision_state: 'confirmed' };
  const { items, rejected } = R.applyL2Updates([item], [proposta], currentBaseline, {}); // chefAttributedThisTurn assente
  assert.strictEqual(items[0].operationalState, 'open', 'operational_state non deve essere applicato se il gate confirmed fallisce');
  assert.deepStrictEqual(items[0].content, { label: 'vecchio', text: 'vecchio' }, 'content non deve essere applicato se il gate confirmed fallisce');
  assert.strictEqual(items[0].evidence, null, 'evidence non deve essere applicata se il gate confirmed fallisce');
  assert.strictEqual(items[0].baselineHash, 'hash_vecchio', 'baseline non deve essere aggiornato se l\'update e\' rifiutato');
  assert.strictEqual(rejected.length, 1);
});

test('O: item GIÀ confirmed + update evidence/content senza chefAttributedThisTurn -> consentito, confirmed preservato', () => {
  const item = makeL2({ id: 'l2_o', operationalState: 'resolved', decisionState: 'confirmed', content: { label: 'vecchio', text: 'vecchio' }, evidence: null, baselineHash: 'hash_vecchio' });
  const proposta = { id: 'l2_o', operational_state: 'open', content: { label: 'aggiornato', text: 'aggiornato' }, evidence: { fonte: 'nuova prova' } };
  const { items, applied, rejected } = R.applyL2Updates([item], [proposta], currentBaseline, {}); // nessun chefAttributedThisTurn
  assert.strictEqual(items[0].decisionState, 'confirmed', 'confirmed deve restare preservato');
  assert.strictEqual(items[0].operationalState, 'open', 'operational_state deve essere aggiornabile senza nuova attribuzione');
  assert.deepStrictEqual(items[0].content, { label: 'aggiornato', text: 'aggiornato' });
  assert.deepStrictEqual(items[0].evidence, { fonte: 'nuova prova' });
  assert.strictEqual(items[0].baselineHash, currentBaseline.baseline_hash, 'la rivalutazione deve comunque aggiornare il baseline');
  assert.deepStrictEqual(applied, ['l2_o']);
  assert.deepStrictEqual(rejected, []);
});

test('P: item probable/none + proposta confirmed + chefAttributedThisTurn !== true -> intero update rifiutato', () => {
  const item = makeL2({ id: 'l2_p_probable', decisionState: 'probable', baselineHash: 'hash_vecchio' });
  const r1 = R.applyL2Updates([item], [{ id: 'l2_p_probable', decision_state: 'confirmed' }], currentBaseline, { chefAttributedThisTurn: false });
  assert.strictEqual(r1.items[0].decisionState, 'probable');
  assert.strictEqual(r1.rejected.length, 1);

  const item2 = makeL2({ id: 'l2_p_none', decisionState: 'none', operationalState: 'unengaged', baselineHash: 'hash_vecchio' });
  const r2 = R.applyL2Updates([item2], [{ id: 'l2_p_none', decision_state: 'confirmed' }], currentBaseline, {});
  assert.strictEqual(r2.items[0].decisionState, 'none');
  assert.strictEqual(r2.rejected.length, 1);
});

test('Q: item probable/none + proposta confirmed + chefAttributedThisTurn === true -> update validabile', () => {
  const item = makeL2({ id: 'l2_q', decisionState: 'probable', operationalState: 'open', baselineHash: 'hash_vecchio' });
  const { items, applied, rejected } = R.applyL2Updates([item], [{ id: 'l2_q', decision_state: 'confirmed' }], currentBaseline, { chefAttributedThisTurn: true });
  assert.strictEqual(items[0].decisionState, 'confirmed');
  assert.strictEqual(items[0].baselineHash, currentBaseline.baseline_hash);
  assert.deepStrictEqual(applied, ['l2_q']);
  assert.deepStrictEqual(rejected, []);
});

test('mini-sprint E2E FIX 3: il gate confirmed resta IDENTICO anche con baselineStatus presente sull\'item — divergent da solo non bypassa nulla', () => {
  // baselineStatus e' un campo che costruisciPayloadM2() aggiunge SOLO alla
  // copia inviata al modello (mai all'item PSL reale, mai al contratto
  // l2_updates in uscita) — questo test verifica in aggiunta che, anche se
  // comparisse per qualunque motivo, validateL2Update/applyL2Updates lo
  // ignorano: non e' un campo whitelisted, il gate resta lo stesso.
  const item = makeL2({ id: 'l2_divergent', decisionState: 'probable', operationalState: 'open', baselineHash: 'hash_vecchio' });
  item.baselineStatus = 'divergent'; // campo estraneo, mai scritto realmente su un L2 PSL
  const tentativo = R.applyL2Updates([item], [{ id: 'l2_divergent', decision_state: 'confirmed', baselineStatus: 'divergent' }], currentBaseline, { chefAttributedThisTurn: false });
  assert.strictEqual(tentativo.items[0].decisionState, 'probable', 'divergent non deve mai bypassare il gate epistemico su confirmed');
  assert.strictEqual(tentativo.applied.length, 0);
  assert.strictEqual(tentativo.rejected.length, 1);
  assert.match(tentativo.rejected[0].reason, /chef-attributable/);

  // Stesso tentativo, ma con attribuzione chef esplicita: valido esattamente
  // come test Q — la presenza di baselineStatus non cambia nulla nel gate.
  const riuscito = R.applyL2Updates([item], [{ id: 'l2_divergent', decision_state: 'confirmed', baselineStatus: 'divergent' }], currentBaseline, { chefAttributedThisTurn: true });
  assert.strictEqual(riuscito.items[0].decisionState, 'confirmed');
  assert.deepStrictEqual(riuscito.applied, ['l2_divergent']);
});

console.log('');
console.log('validazione di forma (vocabolari, id sconosciuto, vincolo unengaged=>none)');

test('id sconosciuto -> rifiutato, mai un\'eccezione', () => {
  const item = makeL2({ id: 'l2_reale' });
  const { items, rejected } = R.applyL2Updates([item], [{ id: 'l2_fantasma', operational_state: 'open' }], currentBaseline, {});
  assert.strictEqual(items[0], item);
  assert.strictEqual(rejected.length, 1);
  assert.strictEqual(rejected[0].id, 'l2_fantasma');
});

test('operational_state non ammesso -> rifiutato', () => {
  const item = makeL2({ id: 'l2_voc' });
  const { rejected } = R.applyL2Updates([item], [{ id: 'l2_voc', operational_state: 'in_lavorazione' }], currentBaseline, {});
  assert.strictEqual(rejected.length, 1);
});

test('decision_state non ammesso -> rifiutato', () => {
  const item = makeL2({ id: 'l2_voc2' });
  const { rejected } = R.applyL2Updates([item], [{ id: 'l2_voc2', decision_state: 'quasi_sicuro' }], currentBaseline, {});
  assert.strictEqual(rejected.length, 1);
});

test('proposta unengaged con decision_state diverso da none -> rifiutata (vincolo PSL)', () => {
  const item = makeL2({ id: 'l2_unengaged_bad', operationalState: 'open', decisionState: 'probable' });
  const { items, rejected } = R.applyL2Updates([item], [{ id: 'l2_unengaged_bad', operational_state: 'unengaged' }], currentBaseline, {});
  // decisionState risultante sarebbe 'probable' (non proposto in update) con operational 'unengaged' -> violazione
  assert.strictEqual(items[0].operationalState, 'open', 'update rifiutato: operational_state non deve cambiare');
  assert.strictEqual(rejected.length, 1);
});

test('proposta unengaged + decision_state:none esplicito -> valida', () => {
  const item = makeL2({ id: 'l2_unengaged_ok', operationalState: 'open', decisionState: 'probable' });
  const { items, applied } = R.applyL2Updates([item], [{ id: 'l2_unengaged_ok', operational_state: 'unengaged', decision_state: 'none' }], currentBaseline, {});
  assert.strictEqual(items[0].operationalState, 'unengaged');
  assert.strictEqual(items[0].decisionState, 'none');
  assert.deepStrictEqual(applied, ['l2_unengaged_ok']);
});

console.log('');
console.log('L/M. nessuna mutazione, nessuna persistenza');

test('L: applyL2Updates non muta gli array/oggetti originali in input', () => {
  const item = makeL2({ id: 'l2_immut', baselineHash: 'hash_vecchio' });
  const l2Items = [item];
  const l2ItemsSnapshot = JSON.parse(JSON.stringify(l2Items));
  const proposedUpdates = [{ id: 'l2_immut', operational_state: 'affected' }];
  const proposedSnapshot = JSON.parse(JSON.stringify(proposedUpdates));
  R.applyL2Updates(l2Items, proposedUpdates, currentBaseline, {});
  assert.deepStrictEqual(l2Items, l2ItemsSnapshot, 'l2Items in input e\' stato mutato');
  assert.deepStrictEqual(proposedUpdates, proposedSnapshot, 'proposedUpdates in input e\' stato mutato');
});

test('M: lib/reconciliation.js non contiene chiamate di rete, save o riferimenti a Supabase/DOM', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'reconciliation.js'), 'utf8');
  ['fetch(', 'XMLHttpRequest', 'supabaseAction', 'sbPost(', 'document.', 'saveToSupabase', 'upLab(', 'upRec('].forEach(needle => {
    assert.ok(!src.includes(needle), 'riferimento non atteso in lib/reconciliation.js: ' + needle);
  });
});

console.log('');
console.log('N. non regressione — controllo leggero (la suite reale sono i 4 file esistenti, ri-eseguiti separatamente)');

test('khub_mvp.html carica lib/reconciliation.js dopo lib/baseline.js, prima dello script principale', () => {
  const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
  assert.match(html, /<script src="lib\/baseline\.js"><\/script>\s*<script src="lib\/reconciliation\.js"><\/script>\s*<script>/);
});

// NOTA (R3D, approvato dopo il congelamento di R3C): il test che era qui
// verificava "nessuna funzione applicativa chiama ancora KhubReconciliation"
// — vero allora, non più per costruzione da quando R3D ha introdotto
// runM2() come primo chiamante legittimo (era esattamente lo scopo del
// meccanismo). La verifica del wiring corretto vive ora in
// scripts/test-m2-runtime.js, insieme al resto del comportamento di runM2.

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');

if (failed > 0) process.exit(1);
