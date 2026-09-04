/*
 * Test R3E — applyM2Persistence(): persistenza controllata di S.m2Result +
 * chef attribution.
 *
 * Stesso stile/harness di test-m2-runtime.js: la funzione viene ESTRATTA da
 * khub_mvp.html ed ESEGUITA davvero (new Function, stesso realm), con
 * KhubReconciliation REALE (require diretto di lib/reconciliation.js —
 * nessun mock su quel livello). Solo saveToSupabase (rete) e uid() (per i
 * soli test che devono predire un id) sono mock — l'unico vero confine I/O
 * e l'unica sorgente di non-determinismo.
 *
 * NON collegata a nessun pulsante (R3F, boundary): questi test la chiamano
 * solo programmaticamente, come già runM1()/runM2().
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function test(name, fn) {
  return (async () => {
    try { await fn(); console.log('  ok - ' + name); passed++; }
    catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); failed++; }
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
const srcHasEvidence = extractFunction('function hasNonEmptyEvidence(evidence)');
const srcRealUid = extractFunction('function uid()');
const srcApply = extractFunction('async function applyM2Persistence(recipeId, options)');

// uid() reale di khub_mvp.html, compilata a parte, usata come default nei
// test — solo il test P inietta un uid deterministico (deve predire l'id
// che il l2_new riceverà, per costruire il caso "L3 da l2_new same-turn").
const realUid = new Function(srcRealUid + '\nreturn uid;')();

function makeApply(S, saveImpl, uidImpl) {
  const factory = new Function(
    'S', 'KhubReconciliation', 'saveToSupabase', 'uid',
    srcR + '\n' + srcCurLab + '\n' + srcHasEvidence + '\n' + srcApply + '\nreturn applyM2Persistence;'
  );
  return factory(S, KhubReconciliation, saveImpl, uidImpl || realUid);
}

function makeSave(returnValue) {
  const calls = [];
  const fn = async (recipe) => { calls.push(recipe); return returnValue; };
  fn.calls = calls;
  return fn;
}

function makeL2(overrides) {
  return Object.assign({
    id: 'l2_x', operationalState: 'open', decisionState: 'none',
    content: { label: 'x', text: 'y' }, evidence: null,
    provenanceType: 'm1', sourceL2ItemId: null,
    baselineHash: 'CURRENT', baselineContext: { note: 'placeholder' },
  }, overrides || {});
}

function makeRecipe(l2Items, l3Items) {
  return {
    id: 'r1', name: 'Cacio e pepe', category: 'Salato',
    l3Items: l3Items || [],
    labVersions: [{
      id: 'v1', name: 'Cacio e pepe', note: '',
      ingredients: [{ id: 'i1', name: 'Pecorino', qty: 200, unit: 'g', isSubRecipe: false }],
      steps: ['Mantecare fuori dal fuoco.'],
      portionsCount: 2, gramsPerPortion: 260,
      l2Items: l2Items || [],
      intentionInitial: null, intentionCurrent: null,
      criteriaInitial: null, criteriaCurrent: null,
    }],
    currentLabIdx: 0,
    validatedVariants: [],
  };
}

function withRealBaseline(recipe) {
  const v = recipe.labVersions[recipe.currentLabIdx];
  const baseline = KhubReconciliation.computeCurrentBaseline(v);
  v.l2Items.forEach(item => { if (item.baselineHash === 'CURRENT') item.baselineHash = baseline.baseline_hash; });
  return recipe;
}

function makeS(recipes) {
  return { recipes: recipes, m2Result: {} };
}

// Costruisce S.m2Result[variantId] con la STESSA forma reale prodotta da
// runM2 (R3D), riusando KhubReconciliation reale — fedeltà 1:1, non un
// doppione a mano.
function buildM2Result(v, opts) {
  opts = opts || {};
  const proposedUpdates = opts.l2Updates || [];
  const baseline = KhubReconciliation.computeCurrentBaseline(v);
  const l2UpdatesResult = KhubReconciliation.applyL2Updates(v.l2Items || [], proposedUpdates, baseline, { chefAttributedThisTurn: false });
  // tempId deterministico (non il vero uid() di runM2, ma stessa forma/ruolo:
  // stabile, locale, mai un id DB) cosi' i test possono referenziare una
  // proposta l2_new precisa attraverso piu' chiamate senza dipendere da
  // un indice posizionale che il pruning di R3F puo' far scorrere.
  const l2New = (opts.l2New || []).map((p, idx) => ({ tempId: 'm2new_test_' + idx, proposedNew: p, validation: KhubReconciliation.validateL2New(p, { chefAttributedThisTurn: false }) }));
  const existingL2ById = {};
  (v.l2Items || []).forEach(i => { existingL2ById[i.id] = i; });
  const l3Candidates = (opts.l3Candidates || []).map(c => ({ candidate: c, validation: KhubReconciliation.validateL3Candidate(c, existingL2ById) }));
  return {
    response: opts.response || 'ok',
    classification: KhubReconciliation.classifyBaseline(v.l2Items || [], baseline.baseline_hash),
    l2Updates: l2UpdatesResult,
    l2New: l2New,
    intentionChange: opts.intentionChange !== undefined ? opts.intentionChange : null,
    criteriaChange: opts.criteriaChange !== undefined ? opts.criteriaChange : null,
    l3Candidates: l3Candidates,
  };
}

function curV(recipe) { return recipe.labVersions[recipe.currentLabIdx || 0]; }
function findL2(recipe, id) { return curV(recipe).l2Items.find(x => x.id === id); }

async function run() {
  console.log('A-D. L2 updates esistenti');

  await test('A: update L2 none/probable applicato senza chef confirmation', async () => {
    const recipe = withRealBaseline(makeRecipe([makeL2({ id: 'l2_open', operationalState: 'open', decisionState: 'probable' })]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2Updates: [{ id: 'l2_open', operational_state: 'affected' }] });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.l2Applied, ['l2_open']);
    const item = findL2(S.recipes[0], 'l2_open');
    assert.strictEqual(item.operationalState, 'affected');
    assert.strictEqual(item.decisionState, 'probable', 'nessuna transizione richiesta, resta invariato');
  });

  await test('B: transition existing L2 -> confirmed rifiutata senza autorizzazione', async () => {
    const recipe = withRealBaseline(makeRecipe([makeL2({ id: 'l2_probable', decisionState: 'probable' })]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2Updates: [{ id: 'l2_probable', decision_state: 'confirmed' }] });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {}); // nessuna autorizzazione
    assert.strictEqual(res.ok, true, 'nessun errore applicativo: solo nulla da applicare per questo id');
    assert.deepStrictEqual(res.l2Applied, []);
    assert.strictEqual(res.l2Rejected.length, 1);
    assert.strictEqual(res.l2Rejected[0].id, 'l2_probable');
    const item = findL2(S.recipes[0], 'l2_probable');
    assert.strictEqual(item.decisionState, 'probable', 'item invariato');
  });

  await test('C: stessa transition accettata con confirmExistingL2Ids', async () => {
    const recipe = withRealBaseline(makeRecipe([makeL2({ id: 'l2_probable', decisionState: 'probable' })]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2Updates: [{ id: 'l2_probable', decision_state: 'confirmed' }] });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', { confirmExistingL2Ids: ['l2_probable'] });
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.l2Applied, ['l2_probable']);
    assert.deepStrictEqual(res.l2Rejected, []);
    const item = findL2(S.recipes[0], 'l2_probable');
    assert.strictEqual(item.decisionState, 'confirmed');
  });

  await test('D: rejected update non muta item (stessa reference)', async () => {
    const original = makeL2({ id: 'l2_probable', decisionState: 'probable', operationalState: 'open' });
    const recipe = withRealBaseline(makeRecipe([original]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2Updates: [{ id: 'l2_probable', operational_state: 'STATO_INESISTENTE' }] });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.l2Rejected.length, 1);
    const item = findL2(S.recipes[0], 'l2_probable');
    assert.strictEqual(item, original, 'stessa reference, mai ricreato');
  });

  console.log('');
  console.log('E-H. l2_new');

  await test('E: l2_new non-confirmed creato automaticamente', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2New: [{ operational_state: 'open', decision_state: 'probable', content: { text: 'nuova osservazione' } }] });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.l2Created.length, 1);
    assert.ok(res.l2Created[0].startsWith('l2_'));
    const items = curV(S.recipes[0]).l2Items;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].decisionState, 'probable');
    assert.strictEqual(items[0].provenanceType, 'm2');
  });

  await test('F: l2_new confirmed rifiutato senza chef authorization', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2New: [{ operational_state: 'open', decision_state: 'confirmed', content: { text: 'osservazione forte' } }] });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.l2Created, []);
    assert.strictEqual(res.l2Rejected.length, 1);
    assert.strictEqual(curV(S.recipes[0]).l2Items.length, 0);
  });

  await test('G: l2_new confirmed creato con authorization', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2New: [{ operational_state: 'open', decision_state: 'confirmed', content: { text: 'osservazione forte' } }] });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', { confirmNewL2Ids: ['m2new_test_0'] });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.l2Created.length, 1);
    const items = curV(S.recipes[0]).l2Items;
    assert.strictEqual(items[0].decisionState, 'confirmed');
  });

  await test('H: stable id assegnato solo a new effettivamente adottati', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2New: [
        { operational_state: 'open', decision_state: 'probable', content: { text: 'auto-applicabile' } },
        { operational_state: 'open', decision_state: 'confirmed', content: { text: 'non autorizzata' } },
      ],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {}); // nessuna autorizzazione per la seconda proposta
    assert.strictEqual(res.l2Created.length, 1);
    assert.strictEqual(res.l2Rejected.length, 1);
    assert.strictEqual(res.l2Rejected[0].tempId, 'm2new_test_1');
    const items = curV(S.recipes[0]).l2Items;
    assert.strictEqual(items.length, 1, 'un solo L2 nuovo persistito, mai id assegnato al rifiutato');
  });

  console.log('');
  console.log('I-L. intention / criteria');

  await test('I: intention proposta non adottata se flag false', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { intentionChange: { text: 'nuova intenzione' } });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {}); // adoptIntention assente = false
    assert.strictEqual(res.intentionAdopted, false);
    assert.strictEqual(curV(S.recipes[0]).intentionInitial, null);
    assert.strictEqual(curV(S.recipes[0]).intentionCurrent, null);
  });

  await test('J: first intention adoption imposta initial+current', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { intentionChange: { text: 'prima intenzione' } });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', { adoptIntention: true });
    assert.strictEqual(res.intentionAdopted, true);
    assert.deepStrictEqual(curV(S.recipes[0]).intentionInitial, { text: 'prima intenzione' });
    assert.deepStrictEqual(curV(S.recipes[0]).intentionCurrent, { text: 'prima intenzione' });
  });

  await test('K: successive intention adoption cambia solo current', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    curV(recipe).intentionInitial = { text: 'iniziale' };
    curV(recipe).intentionCurrent = { text: 'iniziale' };
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { intentionChange: { text: 'evoluta' } });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', { adoptIntention: true });
    assert.strictEqual(res.intentionAdopted, true);
    assert.deepStrictEqual(curV(S.recipes[0]).intentionInitial, { text: 'iniziale' }, 'initial immutabile');
    assert.deepStrictEqual(curV(S.recipes[0]).intentionCurrent, { text: 'evoluta' });
  });

  await test('L: criteria — stessa regola (first sets both, successive changes only current)', async () => {
    const recipeFirst = withRealBaseline(makeRecipe([]));
    const S1 = makeS([recipeFirst]);
    S1.m2Result['v1'] = buildM2Result(curV(recipeFirst), { criteriaChange: { list: ['cremosita'] } });
    const apply1 = makeApply(S1, makeSave(true));
    const res1 = await apply1('r1', { adoptCriteria: true });
    assert.strictEqual(res1.criteriaAdopted, true);
    assert.deepStrictEqual(curV(S1.recipes[0]).criteriaInitial, { list: ['cremosita'] });
    assert.deepStrictEqual(curV(S1.recipes[0]).criteriaCurrent, { list: ['cremosita'] });

    const recipeNext = withRealBaseline(makeRecipe([]));
    curV(recipeNext).criteriaInitial = { list: ['cremosita'] };
    curV(recipeNext).criteriaCurrent = { list: ['cremosita'] };
    const S2 = makeS([recipeNext]);
    S2.m2Result['v1'] = buildM2Result(curV(recipeNext), { criteriaChange: { list: ['cremosita', 'niente grumi'] } });
    const apply2 = makeApply(S2, makeSave(true));
    const res2 = await apply2('r1', { adoptCriteria: true });
    assert.deepStrictEqual(curV(S2.recipes[0]).criteriaInitial, { list: ['cremosita'] }, 'initial immutabile');
    assert.deepStrictEqual(curV(S2.recipes[0]).criteriaCurrent, { list: ['cremosita', 'niente grumi'] });
  });

  console.log('');
  console.log('M-Q. L3 consolidation');

  await test('M: valid L3 creato da existing persisted confirmed L2 con evidence', async () => {
    const l2 = makeL2({ id: 'l2_confirmed', decisionState: 'confirmed', operationalState: 'resolved', evidence: { note: 'verificato in servizio' } });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l3Candidates: [{ origin_l2_item_id: 'l2_confirmed', distilled_content: { summary: 'tecnica consolidata' } }],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {}); // già confirmed prima del turno: non serve riconfermare
    assert.strictEqual(res.l3Created.length, 1);
    assert.ok(res.l3Created[0].startsWith('l3_'));
    const l3 = S.recipes[0].l3Items[0];
    assert.strictEqual(l3.originL2ItemId, 'l2_confirmed');
    assert.strictEqual(l3.supersedesId, null);
  });

  await test('M-bis: L2 confirmed + evidence non vuota MA nessun l3_candidate -> nessun L3 creato (evidence non vuota non e\' sufficienza: il candidate e\' condizione necessaria)', async () => {
    const l2 = makeL2({ id: 'l2_confirmed', decisionState: 'confirmed', operationalState: 'resolved', evidence: { note: 'verificato in servizio' } });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {}); // nessun l3Candidates
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.deepStrictEqual(res.l3Created, [], 'confirmed+evidence da soli non bastano: manca il candidate');
    assert.deepStrictEqual(res.l3Rejected, []);
    assert.deepStrictEqual(res.l3Deferred, []);
    assert.strictEqual(S.recipes[0].l3Items.length, 0);
  });

  await test('N: L3 non creato se L2 non confirmed', async () => {
    const l2 = makeL2({ id: 'l2_probable', decisionState: 'probable', evidence: { note: 'x' } });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l3Candidates: [{ origin_l2_item_id: 'l2_probable', distilled_content: { summary: 'troppo presto' } }],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.deepStrictEqual(res.l3Created, []);
    assert.strictEqual(res.l3Rejected.length, 1);
    assert.strictEqual(S.recipes[0].l3Items.length, 0);
  });

  await test('O: L3 non creato se evidence vuota', async () => {
    const l2 = makeL2({ id: 'l2_confirmed_noev', decisionState: 'confirmed', evidence: null });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l3Candidates: [{ origin_l2_item_id: 'l2_confirmed_noev', distilled_content: { summary: 'senza evidenza' } }],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.deepStrictEqual(res.l3Created, []);
    assert.strictEqual(res.l3Rejected.length, 1);
    assert.match(res.l3Rejected[0].reason, /evidence/);
  });

  await test('P: L3 da l2_new dello stesso turno viene deferred, mai persistito', async () => {
    const seed = makeL2({ id: 'l2_seed', decisionState: 'none', operationalState: 'open' });
    const recipe = withRealBaseline(makeRecipe([seed]));
    const S = makeS([recipe]);
    const predictableUid = () => 'PREDICTABLE1';
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2New: [{ operational_state: 'open', decision_state: 'probable', content: { text: 'osservazione nuova' } }],
      l3Candidates: [{ origin_l2_item_id: 'l2_PREDICTABLE1', distilled_content: { summary: 'troppo presto, stesso turno' } }],
    });
    const apply = makeApply(S, makeSave(true), predictableUid);
    const res = await apply('r1', {});
    assert.strictEqual(res.l2Created.length, 1, 'il l2_new viene comunque creato');
    assert.strictEqual(res.l2Created[0], 'l2_PREDICTABLE1');
    assert.deepStrictEqual(res.l3Created, [], 'MAI persistito nello stesso turno');
    assert.strictEqual(res.l3Deferred.length, 1);
    assert.strictEqual(S.recipes[0].l3Items.length, 0);
  });

  await test('Q: invalid candidate (origin inesistente) non crea L3', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l3Candidates: [{ origin_l2_item_id: 'l2_fantasma', distilled_content: { summary: 'x' } }],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.deepStrictEqual(res.l3Created, []);
    assert.strictEqual(res.l3Rejected.length, 1);
  });

  console.log('');
  console.log('R-U. persistenza, rollback, idempotenza');

  await test('R: saveToSupabase chiamato esattamente una volta', async () => {
    const recipe = withRealBaseline(makeRecipe([makeL2({ id: 'l2_open', decisionState: 'probable' })]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2Updates: [{ id: 'l2_open', operational_state: 'affected' }] });
    const save = makeSave(true);
    const apply = makeApply(S, save);
    await apply('r1', {});
    assert.strictEqual(save.calls.length, 1);
  });

  await test('S: save failure -> rollback locale completo', async () => {
    const originalL2 = makeL2({ id: 'l2_open', decisionState: 'probable', operationalState: 'open' });
    const recipe = withRealBaseline(makeRecipe([originalL2]));
    const originalSnapshot = JSON.parse(JSON.stringify(recipe));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2Updates: [{ id: 'l2_open', operational_state: 'affected' }],
      l2New: [{ operational_state: 'open', decision_state: 'probable', content: { text: 'nuova' } }],
      intentionChange: { text: 'intenzione' },
    });
    const apply = makeApply(S, makeSave(false)); // save fallisce
    const res = await apply('r1', { adoptIntention: true });
    assert.strictEqual(res.ok, false);
    assert.ok(res.error);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(S.recipes[0])), originalSnapshot, 'stato locale ripristinato identico al precedente');
    assert.ok(S.m2Result['v1'], 'm2Result NON consumato: resta disponibile per un nuovo tentativo');
  });

  await test('T: successful apply consuma m2Result (contro doppia applicazione)', async () => {
    const recipe = withRealBaseline(makeRecipe([makeL2({ id: 'l2_open', decisionState: 'probable' })]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2Updates: [{ id: 'l2_open', operational_state: 'affected' }] });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.strictEqual(res.ok, true);
    assert.strictEqual(S.m2Result['v1'], undefined, 'consumato dopo successo');
  });

  await test('U: seconda applicazione dello stesso result non crea duplicati', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2New: [{ operational_state: 'open', decision_state: 'probable', content: { text: 'unica' } }] });
    const save = makeSave(true);
    const apply = makeApply(S, save);
    const res1 = await apply('r1', {});
    assert.strictEqual(res1.ok, true);
    assert.strictEqual(curV(S.recipes[0]).l2Items.length, 1);

    const res2 = await apply('r1', {}); // stesso variantId, m2Result già consumato
    assert.strictEqual(res2.ok, false);
    assert.strictEqual(curV(S.recipes[0]).l2Items.length, 1, 'nessun duplicato');
    assert.strictEqual(save.calls.length, 1, 'saveToSupabase non richiamato la seconda volta');
  });

  console.log('');
  console.log('V-Y. boundary, non-mutazione, regressione');

  await test('V: applyM2Persistence non e\' collegata a nessun elemento UI', () => {
    const occurrences = (html.match(/applyM2Persistence\(/g) || []).length;
    assert.strictEqual(occurrences, 1, 'un solo riferimento: la propria definizione, nessuna chiamata da onclick/altro');
    assert.doesNotMatch(html, /onclick="[^"]*applyM2Persistence/);
  });

  await test('W: nessuna mutazione sugli oggetti raw della proposta (intention/l2New/l3Candidate)', async () => {
    const recipe = withRealBaseline(makeRecipe([makeL2({ id: 'l2_confirmed', decisionState: 'confirmed', evidence: { note: 'ok' } })]));
    const S = makeS([recipe]);
    const intentionProposal = Object.freeze({ text: 'proposta' });
    const newProposal = Object.freeze({ operational_state: 'open', decision_state: 'probable', content: Object.freeze({ text: 'nuova' }) });
    const l3Candidate = Object.freeze({ origin_l2_item_id: 'l2_confirmed', distilled_content: Object.freeze({ summary: 'x' }) });
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      intentionChange: intentionProposal,
      l2New: [newProposal],
      l3Candidates: [l3Candidate],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', { adoptIntention: true, confirmNewL2Ids: ['m2new_test_0'] });
    assert.strictEqual(res.ok, true);
    assert.ok(Object.isFrozen(intentionProposal) && Object.keys(intentionProposal).length === 1);
    assert.ok(Object.isFrozen(newProposal) && Object.keys(newProposal).length === 3);
    assert.ok(Object.isFrozen(l3Candidate) && Object.keys(l3Candidate).length === 2);
  });

  await test('X: regressione — runM2() esiste ancora ed e\' invariata nella forma attesa', () => {
    const srcRunM2 = extractFunction('async function runM2(recipeId, message)');
    assert.match(srcRunM2, /S\.m2Result\[variantId\]=\{/);
    assert.match(srcRunM2, /chefAttributedThisTurn:false/);
    assert.doesNotMatch(srcRunM2, /saveToSupabase/, 'runM2 (R3D) non deve persistere: resta invariato');
  });

  console.log('');
  console.log('Z1-Z21. R3F — lifecycle incrementale di S.m2Result (potatura progressiva)');

  await test('Z1: automatic apply persiste la parte auto-applicabile e lascia pending l\'existing L2 gated', async () => {
    const recipe = withRealBaseline(makeRecipe([
      makeL2({ id: 'l2_open', operationalState: 'open', decisionState: 'probable' }),
      makeL2({ id: 'l2_gated', decisionState: 'probable' }),
    ]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2Updates: [
        { id: 'l2_open', operational_state: 'affected' },
        { id: 'l2_gated', decision_state: 'confirmed' },
      ],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.l2Applied, ['l2_open'], 'la parte automatica viene applicata subito');
    assert.strictEqual(findL2(S.recipes[0], 'l2_open').operationalState, 'affected');
    assert.ok(S.m2Result['v1'], 'm2Result non eliminato: l2_gated resta pending');
    assert.deepStrictEqual(S.m2Result['v1'].l2Updates.applied, [], 'la parte automatica e\' consumata, non si ripropone');
    assert.strictEqual(S.m2Result['v1'].l2Updates.rejected.length, 1);
    assert.strictEqual(S.m2Result['v1'].l2Updates.rejected[0].id, 'l2_gated');
  });

  await test('Z2: seconda apply con confirmExistingL2Ids conferma il pending residuo', async () => {
    const recipe = withRealBaseline(makeRecipe([makeL2({ id: 'l2_probable', decisionState: 'probable' })]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2Updates: [{ id: 'l2_probable', decision_state: 'confirmed' }] });
    const apply = makeApply(S, makeSave(true));
    await apply('r1', {}); // prima chiamata: lascia pending
    const res2 = await apply('r1', { confirmExistingL2Ids: ['l2_probable'] });
    assert.strictEqual(res2.ok, true);
    assert.deepStrictEqual(res2.l2Applied, ['l2_probable']);
    assert.strictEqual(findL2(S.recipes[0], 'l2_probable').decisionState, 'confirmed');
  });

  await test('Z3: m2Result eliminato quando risolta l\'ultima proposal pending', async () => {
    const recipe = withRealBaseline(makeRecipe([makeL2({ id: 'l2_probable', decisionState: 'probable' })]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2Updates: [{ id: 'l2_probable', decision_state: 'confirmed' }] });
    const apply = makeApply(S, makeSave(true));
    await apply('r1', {});
    assert.ok(S.m2Result['v1'], 'ancora pending dopo la prima chiamata');
    await apply('r1', { confirmExistingL2Ids: ['l2_probable'] });
    assert.strictEqual(S.m2Result['v1'], undefined, 'nessuna proposal pending residua: turno chiuso');
  });

  await test('Z4: due l2New ricevono tempId distinti e stabili', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2New: [
        { operational_state: 'open', decision_state: 'confirmed', content: { text: 'prima' } },
        { operational_state: 'open', decision_state: 'confirmed', content: { text: 'seconda' } },
      ],
    });
    const tempIds = S.m2Result['v1'].l2New.map(e => e.tempId);
    assert.strictEqual(tempIds.length, 2);
    assert.notStrictEqual(tempIds[0], tempIds[1], 'tempId univoci');
    assert.ok(tempIds.every(t => typeof t === 'string' && t.length > 0));
  });

  await test('Z5: consumare il primo l2New non altera il tempId/identita\' del secondo', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2New: [
        { operational_state: 'open', decision_state: 'confirmed', content: { text: 'prima' } },
        { operational_state: 'open', decision_state: 'confirmed', content: { text: 'seconda' } },
      ],
    });
    const firstTempId = S.m2Result['v1'].l2New[0].tempId;
    const secondTempId = S.m2Result['v1'].l2New[1].tempId;
    const apply = makeApply(S, makeSave(true));
    await apply('r1', { confirmNewL2Ids: [firstTempId] });
    assert.ok(S.m2Result['v1'], 'la seconda proposta resta pending');
    assert.strictEqual(S.m2Result['v1'].l2New.length, 1);
    assert.strictEqual(S.m2Result['v1'].l2New[0].tempId, secondTempId, 'stesso tempId, nessun drift dopo la rimozione della prima');
  });

  await test('Z6: il secondo l2New resta confermabile in una chiamata successiva tramite il proprio tempId', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2New: [
        { operational_state: 'open', decision_state: 'confirmed', content: { text: 'prima' } },
        { operational_state: 'open', decision_state: 'confirmed', content: { text: 'seconda' } },
      ],
    });
    const firstTempId = S.m2Result['v1'].l2New[0].tempId;
    const secondTempId = S.m2Result['v1'].l2New[1].tempId;
    const apply = makeApply(S, makeSave(true));
    await apply('r1', { confirmNewL2Ids: [firstTempId] });
    const res2 = await apply('r1', { confirmNewL2Ids: [secondTempId] });
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.l2Created.length, 1);
    assert.strictEqual(curV(S.recipes[0]).l2Items.length, 2, 'entrambe le osservazioni create, una per chiamata');
    assert.strictEqual(S.m2Result['v1'], undefined, 'nessuna proposta l2New residua: turno chiuso');
  });

  await test('Z7: intentionChange resta pending dopo una apply automatica che non la adotta', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { intentionChange: { text: 'nuova intenzione' } });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.strictEqual(res.ok, true);
    assert.ok(S.m2Result['v1'], 'm2Result resta: intentionChange ancora pending');
    assert.deepStrictEqual(S.m2Result['v1'].intentionChange, { text: 'nuova intenzione' });
  });

  await test('Z8: una adoption successiva consuma intentionChange e chiude il turno', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { intentionChange: { text: 'nuova intenzione' } });
    const apply = makeApply(S, makeSave(true));
    await apply('r1', {});
    const res2 = await apply('r1', { adoptIntention: true });
    assert.strictEqual(res2.intentionAdopted, true);
    assert.deepStrictEqual(curV(S.recipes[0]).intentionCurrent, { text: 'nuova intenzione' });
    assert.strictEqual(S.m2Result['v1'], undefined, 'intentionChange consumata, nessun altro pending: turno chiuso');
  });

  await test('Z9: criteriaChange resta pending e viene consumata simmetricamente a intention', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), { criteriaChange: { list: ['cremosita'] } });
    const apply = makeApply(S, makeSave(true));
    const res1 = await apply('r1', {});
    assert.strictEqual(res1.ok, true);
    assert.ok(S.m2Result['v1'], 'criteriaChange ancora pending');
    const res2 = await apply('r1', { adoptCriteria: true });
    assert.strictEqual(res2.criteriaAdopted, true);
    assert.deepStrictEqual(curV(S.recipes[0]).criteriaCurrent, { list: ['cremosita'] });
    assert.strictEqual(S.m2Result['v1'], undefined);
  });

  await test('Z10: L3 da existing gia\' confirmed si consolida e viene rimosso dal result', async () => {
    const l2 = makeL2({ id: 'l2_confirmed', decisionState: 'confirmed', operationalState: 'resolved', evidence: { note: 'verificato in servizio' } });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l3Candidates: [{ origin_l2_item_id: 'l2_confirmed', distilled_content: { summary: 'tecnica consolidata' } }],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.strictEqual(res.l3Created.length, 1);
    assert.strictEqual(S.m2Result['v1'], undefined, 'candidate consolidato: nulla resta pending, turno chiuso');
  });

  await test('Z11: L3 con origin gated nello stesso turno resta pending (caso A, non scartato)', async () => {
    const l2 = makeL2({ id: 'l2_probable', decisionState: 'probable', evidence: { note: 'buona evidenza' } });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2Updates: [{ id: 'l2_probable', decision_state: 'confirmed' }], // M2 propone di confermarlo questo turno
      l3Candidates: [{ origin_l2_item_id: 'l2_probable', distilled_content: { summary: 'quasi pronto' } }],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {}); // nessuna autorizzazione ancora
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.l3Created, []);
    assert.ok(S.m2Result['v1'], 'm2Result resta: sia l\'update L2 sia il candidate L3 sono pending');
    assert.strictEqual(S.m2Result['v1'].l3Candidates.length, 1, 'candidate L3 mantenuto in coda (caso A)');
  });

  await test('Z12: una successiva conferma dell\'origin consolida il candidate L3 rimasto pending', async () => {
    const l2 = makeL2({ id: 'l2_probable', decisionState: 'probable', evidence: { note: 'buona evidenza' } });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2Updates: [{ id: 'l2_probable', decision_state: 'confirmed' }],
      l3Candidates: [{ origin_l2_item_id: 'l2_probable', distilled_content: { summary: 'quasi pronto' } }],
    });
    const apply = makeApply(S, makeSave(true));
    await apply('r1', {}); // lascia pending
    const res2 = await apply('r1', { confirmExistingL2Ids: ['l2_probable'] });
    assert.strictEqual(res2.l3Created.length, 1, 'ora l\'origin e\' confirmed+attribuita: il candidate si consolida');
    assert.strictEqual(S.m2Result['v1'], undefined, 'nulla resta pending: turno chiuso');
  });

  await test('Z13: L3 deferred per origin l2New dello stesso turno resta pending (caso B, non perso)', async () => {
    const seed = makeL2({ id: 'l2_seed', decisionState: 'none', operationalState: 'open' });
    const recipe = withRealBaseline(makeRecipe([seed]));
    const S = makeS([recipe]);
    const predictableUid = () => 'PREDICTABLE1';
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2New: [{ operational_state: 'open', decision_state: 'probable', content: { text: 'osservazione nuova' } }],
      l3Candidates: [{ origin_l2_item_id: 'l2_PREDICTABLE1', distilled_content: { summary: 'troppo presto, stesso turno' } }],
    });
    const apply = makeApply(S, makeSave(true), predictableUid);
    const res = await apply('r1', {});
    assert.strictEqual(res.l2Created.length, 1);
    assert.deepStrictEqual(res.l3Created, []);
    assert.strictEqual(res.l3Deferred.length, 1);
    assert.ok(S.m2Result['v1'], 'm2Result resta: il candidate deferred e\' ancora pending');
    assert.strictEqual(S.m2Result['v1'].l3Candidates.length, 1);
  });

  await test('Z14: una apply successiva consolida un candidate L3 deferred per l2New dello stesso turno', async () => {
    const seed = makeL2({ id: 'l2_seed', decisionState: 'none', operationalState: 'open' });
    const recipe = withRealBaseline(makeRecipe([seed]));
    const S = makeS([recipe]);
    const predictableUid = () => 'PREDICTABLE1';
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2New: [{ operational_state: 'open', decision_state: 'probable', content: { text: 'osservazione nuova' }, evidence: { note: 'gia\' pronta' } }],
      l3Candidates: [{ origin_l2_item_id: 'l2_PREDICTABLE1', distilled_content: { summary: 'consolidabile al turno successivo' } }],
    });
    const apply = makeApply(S, makeSave(true), predictableUid);
    await apply('r1', {}); // call 1: crea l2_new, L3 resta deferred
    assert.ok(S.m2Result['v1'], 'ancora pending dopo la prima chiamata');
    const res2 = await apply('r1', { confirmExistingL2Ids: ['l2_PREDICTABLE1'] }); // call 2: origin ora pre-existing
    assert.strictEqual(res2.l3Created.length, 1, 'origin ora pre-existing, confirmed e con evidence: il candidate deferred si consolida');
    assert.strictEqual(S.m2Result['v1'], undefined, 'nulla resta pending: turno chiuso');
  });

  await test('Z15: L3 con evidence vuota viene scartato subito, mai pending (caso C)', async () => {
    const l2 = makeL2({ id: 'l2_confirmed_noev', decisionState: 'confirmed', evidence: null });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l3Candidates: [{ origin_l2_item_id: 'l2_confirmed_noev', distilled_content: { summary: 'senza evidenza' } }],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.deepStrictEqual(res.l3Created, []);
    assert.strictEqual(S.m2Result['v1'], undefined, 'scartato subito: nessun candidate pending residuo, turno chiuso');
  });

  await test('Z16: L3 con origin non-confirmed e nessuna chef-confirmation proposta in questo turno viene scartato (caso F)', async () => {
    const l2 = makeL2({ id: 'l2_probable', decisionState: 'probable', evidence: { note: 'x' } });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    // NESSUN l2Updates proposto per l2_probable in questo turno: M2 non ha
    // chiesto di confermarlo, quindi non c'e' alcuna via di risoluzione
    // dentro questo stesso turno per il candidate (a differenza di Z11).
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l3Candidates: [{ origin_l2_item_id: 'l2_probable', distilled_content: { summary: 'troppo presto, e nessuno lo sta proponendo' } }],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.deepStrictEqual(res.l3Created, []);
    assert.strictEqual(S.m2Result['v1'], undefined, 'scartato subito: non e\' un\'attesa di evoluzioni cognitive future');
  });

  await test('Z17: L3 strutturalmente invalido (origin inesistente) viene scartato, non pending (caso D)', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l3Candidates: [{ origin_l2_item_id: 'l2_fantasma', distilled_content: { summary: 'x' } }],
    });
    const apply = makeApply(S, makeSave(true));
    const res = await apply('r1', {});
    assert.deepStrictEqual(res.l3Created, []);
    assert.strictEqual(S.m2Result['v1'], undefined, 'candidate strutturalmente invalido: mai pending, turno chiuso');
  });

  await test('Z18: L3 gia\' consolidato non viene ricreato in una chiamata successiva dello stesso turno (caso E)', async () => {
    const l2 = makeL2({ id: 'l2_confirmed', decisionState: 'confirmed', evidence: { note: 'ok' } });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l3Candidates: [{ origin_l2_item_id: 'l2_confirmed', distilled_content: { summary: 'consolidato subito' } }],
      intentionChange: { text: 'tenuta pending per non chiudere il turno' }, // mantiene m2Result vivo dopo il consolidamento
    });
    const apply = makeApply(S, makeSave(true));
    const res1 = await apply('r1', {});
    assert.strictEqual(res1.l3Created.length, 1);
    assert.ok(S.m2Result['v1'], 'intentionChange ancora pending: il turno resta aperto');
    assert.strictEqual(S.m2Result['v1'].l3Candidates.length, 0, 'il candidate consolidato non e\' piu\' in coda');
    const res2 = await apply('r1', {}); // seconda chiamata, nessuna azione su L3
    assert.deepStrictEqual(res2.l3Created, [], 'non ricreato: non e\' piu\' nella coda');
    assert.strictEqual(S.recipes[0].l3Items.filter(x => x.originL2ItemId === 'l2_confirmed').length, 1, 'un solo L3 persistito per quell\'origin');
  });

  await test('Z19: save failure lascia m2Result IDENTICO (nessun pruning parziale)', async () => {
    const l2 = makeL2({ id: 'l2_probable', decisionState: 'probable', operationalState: 'open' });
    const recipe = withRealBaseline(makeRecipe([l2]));
    const S = makeS([recipe]);
    const m2ResultOriginal = buildM2Result(curV(recipe), {
      l2Updates: [{ id: 'l2_probable', decision_state: 'confirmed' }],
      l2New: [{ operational_state: 'open', decision_state: 'probable', content: { text: 'nuova' } }],
      intentionChange: { text: 'intenzione' },
    });
    S.m2Result['v1'] = m2ResultOriginal;
    const snapshotBefore = JSON.parse(JSON.stringify(m2ResultOriginal));
    const apply = makeApply(S, makeSave(false)); // save fallisce
    const res = await apply('r1', { confirmExistingL2Ids: ['l2_probable'], adoptIntention: true });
    assert.strictEqual(res.ok, false);
    assert.ok(S.m2Result['v1'], 'm2Result non eliminato su save failure');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(S.m2Result['v1'])), snapshotBefore, 'm2Result identico: nessun pruning senza persistenza riuscita');
  });

  await test('Z20: il pruning non muta gli oggetti proposta grezzi rimasti pending', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    const firstProposal = Object.freeze({ operational_state: 'open', decision_state: 'confirmed', content: Object.freeze({ text: 'uno' }) });
    const secondProposal = Object.freeze({ operational_state: 'open', decision_state: 'confirmed', content: Object.freeze({ text: 'due' }) });
    S.m2Result['v1'] = buildM2Result(curV(recipe), { l2New: [firstProposal, secondProposal] });
    const firstTempId = S.m2Result['v1'].l2New[0].tempId;
    const apply = makeApply(S, makeSave(true));
    await apply('r1', { confirmNewL2Ids: [firstTempId] });
    assert.ok(Object.isFrozen(secondProposal) && Object.keys(secondProposal).length === 3, 'la proposta ancora pending non e\' mai stata toccata');
    assert.strictEqual(S.m2Result['v1'].l2New[0].proposedNew, secondProposal, 'stessa reference, mai clonata/ricreata');
  });

  await test('Z21: tempId non compare mai negli L2 persistiti (mai un id DB)', async () => {
    const recipe = withRealBaseline(makeRecipe([]));
    const S = makeS([recipe]);
    S.m2Result['v1'] = buildM2Result(curV(recipe), {
      l2New: [{ operational_state: 'open', decision_state: 'probable', content: { text: 'osservazione' } }],
    });
    const tempId = S.m2Result['v1'].l2New[0].tempId;
    const apply = makeApply(S, makeSave(true));
    await apply('r1', {});
    const items = curV(S.recipes[0]).l2Items;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(items[0], 'tempId'), false, 'tempId mai copiato sull\'item persistito');
    assert.notStrictEqual(items[0].id, tempId, 'id reale (l2_...) sempre distinto dal tempId effimero');
  });

  console.log('');
  console.log('Y. regressioni R3C/R3D/M1/PSL: verificate dalla suite completa (vedi comando eseguito a parte)');

  console.log('');
  console.log(`Totale: ${passed} passati, ${failed} falliti`);
  if (failed > 0) process.exit(1);
}

run();
