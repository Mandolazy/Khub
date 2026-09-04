/*
 * Test R3D — runM2() reale: CALL + PARSE + VALIDATION + PREPARAZIONE.
 * MAI persistenza in questo step (R3E).
 *
 * Come test-m2-context-builder.js: runM2()/R()/curLab()/costruisciPayloadM2()
 * vengono ESTRATTE da khub_mvp.html ed ESEGUITE davvero (new Function,
 * stesso realm), con KhubReconciliation REALE (require diretto di
 * lib/reconciliation.js — nessun mock su quel livello: integrazione vera).
 * Solo fetch/render/toast sono mock, perché sono l'unico vero confine I/O.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function test(name, fn) {
  return (async () => {
    try { await fn(); console.log('  ok - ' + name); passed++; }
    catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); failed++; }
  })();
}

const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
const KhubReconciliation = require(path.join(ROOT, 'lib', 'reconciliation.js'));

function extractFunction(startMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error('marker non trovato: ' + startMarker);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('graffe non bilanciate a partire da: ' + startMarker);
}

const srcR = extractFunction('function R(id)');
const srcCurLab = extractFunction('function curLab(recipe)');
const srcBuilder = extractFunction('function costruisciPayloadM2(recipeId, message)');
const srcRunM2 = extractFunction('async function runM2(recipeId, message)');

// Carica R/curLab/costruisciPayloadM2/runM2 REALI nello stesso realm del
// test file; KhubReconciliation/fetch/render/toast sono parametri della
// factory (l'unico vero confine da mockare è I/O: rete + UI).
function makeRunM2(S, fetchImpl) {
  const toastLog = [];
  const renderLog = [];
  const factory = new Function(
    'S', 'KhubReconciliation', 'fetch', 'render', 'toast', 'console',
    srcR + '\n' + srcCurLab + '\n' + srcBuilder + '\n' + srcRunM2 + '\nreturn runM2;'
  );
  const runM2 = factory(
    S, KhubReconciliation, fetchImpl,
    () => renderLog.push(1),
    (msg, icon) => toastLog.push({ msg, icon }),
    console
  );
  return { runM2, toastLog, renderLog };
}

function makeFetch(responseText, opts) {
  opts = opts || {};
  const calls = [];
  const fn = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (opts.beforeResolve) opts.beforeResolve();
    if (opts.networkError) throw new Error('rete simulata: errore');
    if (opts.httpStatus && opts.httpStatus !== 200) {
      return { ok: false, status: opts.httpStatus, json: async () => ({ error: 'simulato' }) };
    }
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: responseText }] }) };
  };
  fn.calls = calls;
  return fn;
}

function m2ResponseText(prosa, structured) {
  return prosa + '\n===M2_UPDATE===\n' + JSON.stringify(structured);
}

function makeL2(overrides) {
  return Object.assign({
    id: 'l2_x', operationalState: 'open', decisionState: 'none',
    content: { label: 'x', text: 'y' }, evidence: null,
    provenanceType: 'm1', sourceL2ItemId: null,
    baselineHash: 'CURRENT', baselineContext: { note: 'placeholder' },
  }, overrides || {});
}

function makeRecipe() {
  return {
    id: 'r1', name: 'Cacio e pepe', category: 'Salato',
    l3Items: [],
    labVersions: [{
      id: 'v1', name: 'Cacio e pepe', note: '',
      ingredients: [{ id: 'i1', name: 'Pecorino', qty: 200, unit: 'g', isSubRecipe: false }],
      steps: ['Mantecare fuori dal fuoco.'],
      portionsCount: 2, gramsPerPortion: 260,
      l2Items: [
        makeL2({ id: 'l2_unengaged', operationalState: 'unengaged', decisionState: 'none', provenanceType: 'm1' }),
        makeL2({ id: 'l2_open', operationalState: 'open', decisionState: 'probable' }),
        makeL2({ id: 'l2_confirmed', operationalState: 'resolved', decisionState: 'confirmed' }),
      ],
      intentionInitial: null, intentionCurrent: null,
      criteriaInitial: null, criteriaCurrent: null,
    }],
    currentLabIdx: 0,
  };
}

// I fixture sopra usano baselineHash:'CURRENT' come placeholder: lo
// sostituiamo con l'hash reale del variant appena creato, cosi' i test che
// NON riguardano la divergenza partono da uno stato "current" coerente.
function withRealBaseline(recipe) {
  const v = recipe.labVersions[recipe.currentLabIdx];
  const baseline = KhubReconciliation.computeCurrentBaseline(v);
  v.l2Items.forEach(item => { if (item.baselineHash === 'CURRENT') item.baselineHash = baseline.baseline_hash; });
  return recipe;
}

const EMPTY_STRUCTURED = { l2_updates: [], l2_new: [], intention_change: null, criteria_change: null, l3_candidates: [] };

// Stato S minimo ma completo: replica i campi che l'app reale inizializza
// all'avvio (m2Loading/m2LoadingKey/m2Error/m2Result) — runM2() li dà per
// esistenti, esattamente come nell'app vera.
function makeS(recipes) {
  return {
    recipes: recipes,
    m2Loading: false, m2LoadingKey: null,
    m2Error: {}, m2Result: {},
  };
}

async function run() {
  console.log('A/B. payload reale + mode:\'m2\' inviato a /api/chat');

  await test('A/B: payload prodotto da costruisciPayloadM2 inviato a /api/chat con mode="m2"', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const fetchImpl = makeFetch(m2ResponseText('Risposta di prova.', EMPTY_STRUCTURED));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'Domanda di prova');
    assert.strictEqual(fetchImpl.calls.length, 1);
    assert.strictEqual(fetchImpl.calls[0].url, '/api/chat');
    const body = fetchImpl.calls[0].body;
    assert.strictEqual(body.mode, 'm2');
    assert.deepStrictEqual(body.recipe, { id: 'r1', name: 'Cacio e pepe', category: 'Salato' });
    assert.strictEqual(body.variant.id, 'v1');
    assert.strictEqual(body.message, 'Domanda di prova');
    assert.strictEqual(body.l2.length, 3);
  });

  console.log('');
  console.log('C-F. parsing e validazione della risposta');

  await test('C: parsing corretto prosa + marker + JSON -> risultato preparato in S.m2Result', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const fetchImpl = makeFetch(m2ResponseText('Ecco la mia lettura.', EMPTY_STRUCTURED));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'ciao');
    const result = S.m2Result['v1'];
    assert.ok(result);
    assert.strictEqual(result.response, 'Ecco la mia lettura.');
    assert.deepStrictEqual(result.l2New, []);
    assert.strictEqual(result.intentionChange, null);
    assert.strictEqual(result.criteriaChange, null);
  });

  await test('D: marker ===M2_UPDATE=== mancante -> reject (errore impostato, nessun risultato)', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const fetchImpl = makeFetch('Solo prosa, nessun blocco strutturato.');
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.ok(!S.m2Result['v1']);
    assert.ok(S.m2Error['v1']);
  });

  await test('E: JSON invalido dopo il marker -> reject', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const fetchImpl = makeFetch('Prosa.\n===M2_UPDATE===\n{questo non e\' json valido,,,}');
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.ok(!S.m2Result['v1']);
    assert.ok(S.m2Error['v1']);
  });

  await test('F: shape strutturata invalida (array attesi mancanti) -> reject', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const bad = { l2_updates: [], intention_change: null, criteria_change: null }; // manca l2_new e l3_candidates
    const fetchImpl = makeFetch(m2ResponseText('Prosa.', bad));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.ok(!S.m2Result['v1']);
    assert.ok(S.m2Error['v1']);
  });

  console.log('');
  console.log('G/H. stale-Bozza protection (id E baseline, non solo id)');

  await test('G: variant.id cambiato durante l\'attesa -> risultato scartato, nessun errore mostrato', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const fetchImpl = makeFetch(m2ResponseText('ok', EMPTY_STRUCTURED), {
      beforeResolve: () => { S.recipes[0].labVersions[0] = Object.assign({}, S.recipes[0].labVersions[0], { id: 'v1_NUOVO' }); },
    });
    const { runM2, toastLog } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.ok(!S.m2Result['v1']);
    assert.ok(!S.m2Result['v1_NUOVO']);
    assert.strictEqual(S.m2Error['v1'], null, 'scarto silenzioso: non è un errore applicativo');
    assert.ok(toastLog.some(t => t.msg.includes('cambiata nel frattempo')));
  });

  await test('H: STESSO variant.id ma baseline cambiato (ingrediente modificato) durante l\'attesa -> risultato scartato', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const fetchImpl = makeFetch(m2ResponseText('ok', EMPTY_STRUCTURED), {
      beforeResolve: () => { S.recipes[0].labVersions[0].ingredients[0].qty = 999; }, // stesso id, contenuto diverso
    });
    const { runM2, toastLog } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.ok(!S.m2Result['v1'], 'un id invariato ma un baseline diverso deve comunque scartare il risultato');
    assert.ok(toastLog.some(t => t.msg.includes('cambiata nel frattempo')));
  });

  console.log('');
  console.log('I/J. nessuna mutazione, nessuna persistenza');

  await test('I: v.l2Items non viene mai mutato da una chiamata riuscita (la preview resta locale)', async () => {
    const recipe = withRealBaseline(makeRecipe());
    const S = makeS([recipe]);
    const l2Snapshot = JSON.parse(JSON.stringify(recipe.labVersions[0].l2Items));
    const structured = Object.assign({}, EMPTY_STRUCTURED, { l2_updates: [{ id: 'l2_open', operational_state: 'affected' }] });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.deepStrictEqual(S.recipes[0].labVersions[0].l2Items, l2Snapshot, 'v.l2Items non deve mai essere mutato da runM2 in R3D');
    const preview = S.m2Result['v1'].l2Updates.items.find(x => x.id === 'l2_open');
    assert.strictEqual(preview.operationalState, 'affected', 'la preview (locale, non persistita) deve comunque riflettere l\'update validato');
  });

  await test('J: nessuna persistenza — un solo fetch verso /api/chat con mode:m2, mai supabaseAction', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const fetchImpl = makeFetch(m2ResponseText('ok', EMPTY_STRUCTURED));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.strictEqual(fetchImpl.calls.length, 1);
    assert.ok(!('supabaseAction' in fetchImpl.calls[0].body));
  });

  console.log('');
  console.log('K/L. l2_updates: validation path reale + gate confirmed');

  await test('K: l2_updates passa dal validation path reale di KhubReconciliation.applyL2Updates', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const structured = Object.assign({}, EMPTY_STRUCTURED, { l2_updates: [{ id: 'l2_open', operational_state: 'affected' }] });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    const l2Updates = S.m2Result['v1'].l2Updates;
    assert.deepStrictEqual(l2Updates.applied, ['l2_open']);
    assert.deepStrictEqual(l2Updates.rejected, []);
    assert.ok(Array.isArray(l2Updates.items));
  });

  await test('L: transizione non autorizzata verso confirmed non viene accettata (chefAttributedThisTurn sempre false in R3D)', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const structured = Object.assign({}, EMPTY_STRUCTURED, { l2_updates: [{ id: 'l2_open', decision_state: 'confirmed' }] });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    const l2Updates = S.m2Result['v1'].l2Updates;
    assert.deepStrictEqual(l2Updates.applied, []);
    assert.strictEqual(l2Updates.rejected.length, 1);
    assert.strictEqual(l2Updates.rejected[0].id, 'l2_open');
    const preview = l2Updates.items.find(x => x.id === 'l2_open');
    assert.strictEqual(preview.decisionState, 'probable', 'lo stato originale deve restare invariato nella preview');
  });

  await test('L-bis: un item GIÀ confirmed resta rivalutabile (senza attribuzione) — nessuna transizione, quindi il gate non scatta', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const structured = Object.assign({}, EMPTY_STRUCTURED, { l2_updates: [{ id: 'l2_confirmed', operational_state: 'open' }] });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    const l2Updates = S.m2Result['v1'].l2Updates;
    assert.deepStrictEqual(l2Updates.applied, ['l2_confirmed']);
    const preview = l2Updates.items.find(x => x.id === 'l2_confirmed');
    assert.strictEqual(preview.decisionState, 'confirmed', 'confirmed preservato');
    assert.strictEqual(preview.operationalState, 'open', 'operational_state comunque aggiornabile');
  });

  console.log('');
  console.log('M/N. l2_new: validazione di forma');

  await test('M: l2_new con operational_state non ammesso viene rifiutato', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const structured = Object.assign({}, EMPTY_STRUCTURED, { l2_new: [{ operational_state: 'in_lavorazione', decision_state: 'none', content: { label: 'x', text: 'y' } }] });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.strictEqual(S.m2Result['v1'].l2New[0].validation.valid, false);
  });

  await test('N: l2_new unengaged con decision_state diverso da none viene rifiutato', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const structured = Object.assign({}, EMPTY_STRUCTURED, { l2_new: [{ operational_state: 'unengaged', decision_state: 'probable', content: { label: 'x', text: 'y' } }] });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.strictEqual(S.m2Result['v1'].l2New[0].validation.valid, false);
  });

  await test('N-bis: l2_new valida (forma corretta) viene accettata dal validator, ma non è mai persistita qui', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const structured = Object.assign({}, EMPTY_STRUCTURED, { l2_new: [{ operational_state: 'open', decision_state: 'probable', content: { label: 'Nuova osservazione', text: 'testo valido' } }] });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.strictEqual(S.m2Result['v1'].l2New[0].validation.valid, true);
    assert.strictEqual(S.recipes[0].labVersions[0].l2Items.length, 3, 'nessun nuovo L2 deve comparire in v.l2Items in R3D');
  });

  console.log('');
  console.log('O/P/Q. intention/criteria/L3: proposte, mai adottate/create');

  await test('O: intention_change resta proposta, non modifica intentionInitial/Current sul variant reale', async () => {
    const recipe = withRealBaseline(makeRecipe());
    const S = makeS([recipe]);
    const structured = Object.assign({}, EMPTY_STRUCTURED, { intention_change: { proposed_current: { text: 'nuova intenzione' } } });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.strictEqual(S.recipes[0].labVersions[0].intentionInitial, null);
    assert.strictEqual(S.recipes[0].labVersions[0].intentionCurrent, null);
    assert.deepStrictEqual(S.m2Result['v1'].intentionChange, { proposed_current: { text: 'nuova intenzione' } });
  });

  await test('P: criteria_change resta proposta, non modifica criteriaInitial/Current sul variant reale', async () => {
    const recipe = withRealBaseline(makeRecipe());
    const S = makeS([recipe]);
    const structured = Object.assign({}, EMPTY_STRUCTURED, { criteria_change: { proposed_current: { list: ['x'] } } });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.strictEqual(S.recipes[0].labVersions[0].criteriaInitial, null);
    assert.strictEqual(S.recipes[0].labVersions[0].criteriaCurrent, null);
    assert.deepStrictEqual(S.m2Result['v1'].criteriaChange, { proposed_current: { list: ['x'] } });
  });

  await test('Q: l3_candidates non crea alcun L3Item su recipe.l3Items', async () => {
    const recipe = withRealBaseline(makeRecipe());
    const S = makeS([recipe]);
    const structured = Object.assign({}, EMPTY_STRUCTURED, { l3_candidates: [{ origin_l2_item_id: 'l2_confirmed', distilled_content: { summary: 'candidato' } }] });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    const l3Before = JSON.parse(JSON.stringify(S.recipes[0].l3Items));
    await runM2('r1', 'x');
    assert.deepStrictEqual(S.recipes[0].l3Items, l3Before, 'recipe.l3Items non deve mai cambiare in R3D');
    assert.strictEqual(S.m2Result['v1'].l3Candidates[0].validation.valid, true);
  });

  await test('Q-bis: l3_candidate con origin_l2_item_id inesistente viene rifiutato (mai un id inventato dall\'AI)', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const structured = Object.assign({}, EMPTY_STRUCTURED, { l3_candidates: [{ origin_l2_item_id: 'l2_fantasma', distilled_content: { summary: 'x' } }] });
    const fetchImpl = makeFetch(m2ResponseText('ok', structured));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.strictEqual(S.m2Result['v1'].l3Candidates[0].validation.valid, false);
  });

  console.log('');
  console.log('R. M1 invariato (controllo leggero — la suite reale è test-m1.js, eseguita separatamente)');

  await test('R: runM1()/hasM1() restano presenti e non toccati da R3D', () => {
    assert.match(html, /async function runM1\(recipeId\)\{/);
    assert.match(html, /function hasM1\(v\)\{/);
    assert.notStrictEqual(html.indexOf('async function runM1(recipeId)'), -1);
    assert.notStrictEqual(html.indexOf('async function runM2(recipeId, message)'), -1);
  });

  console.log('');
  console.log('Robustezza aggiuntiva: errori HTTP e di rete');

  await test('errore HTTP (status != 200) -> reject, nessun risultato', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const fetchImpl = makeFetch('', { httpStatus: 500 });
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.ok(!S.m2Result['v1']);
    assert.ok(S.m2Error['v1']);
  });

  await test('errore di rete (fetch rifiutata) -> reject, nessuna eccezione non gestita', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const fetchImpl = makeFetch('', { networkError: true });
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('r1', 'x');
    assert.ok(!S.m2Result['v1']);
    assert.ok(S.m2Error['v1']);
  });

  await test('recipeId inesistente o Scheda senza Bozza LAB -> nessuna eccezione, nessuna chiamata di rete', async () => {
    const S = makeS([withRealBaseline(makeRecipe())]);
    const fetchImpl = makeFetch(m2ResponseText('ok', EMPTY_STRUCTURED));
    const { runM2 } = makeRunM2(S, fetchImpl);
    await runM2('non_esiste', 'x');
    assert.strictEqual(fetchImpl.calls.length, 0);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  console.log('');
  console.log('NOTA: la chiamata Anthropic reale (M2 dal vivo) NON è eseguibile da questo');
  console.log('ambiente (nessuna credenziale). Va verificata manualmente contro un');
  console.log('deployment reale quando runM2() verrà collegata alla UI (R3F).');

  if (failed > 0) process.exit(1);
}

run();
