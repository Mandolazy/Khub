/*
 * Test R3B — Context Builder M2 (costruisciPayloadM2) in khub_mvp.html.
 *
 * A differenza di test-m1.js/test-persistent-state.js/test-m2-contract.js
 * (verifiche strutturali/regex sul testo sorgente), qui la funzione viene
 * DAVVERO ESTRATTA ed ESEGUITA in un sandbox Node (vm), con fixture
 * sintetiche di S/recipe/variant/L2/L3. E' possibile perche'
 * costruisciPayloadM2 (insieme a R()/curLab(), le uniche due dipendenze)
 * e' pura: nessuna rete, nessun DOM, nessuna mutazione — un caso raro in
 * khub_mvp.html abbastanza isolato da poter essere testato per
 * comportamento reale, non solo per forma del testo.
 *
 * Nessun framework introdotto: Node puro + assert + vm (built-in).
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

const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');

// Estrae una function declaration per intero, contando le graffe a partire
// dal punto in cui compare startMarker — robusto anche se la funzione
// contiene altre graffe annidate (if/map/oggetti), purche' nessuna sia
// dentro una stringa contenente '{'/'}' sbilanciati (non e' il caso qui).
function extractFunction(startMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error('marker non trovato: ' + startMarker);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('graffe non bilanciate a partire da: ' + startMarker);
}

const srcR = extractFunction('function R(id)');
const srcCurLab = extractFunction('function curLab(recipe)');
const srcBuilder = extractFunction('function costruisciPayloadM2(recipeId, message, classification)');

console.log('A. estrazione e caricamento in sandbox');

test('le tre funzioni (R, curLab, costruisciPayloadM2) sono state estratte dal sorgente', () => {
  assert.ok(srcR.startsWith('function R(id)'));
  assert.ok(srcCurLab.startsWith('function curLab(recipe)'));
  assert.ok(srcBuilder.startsWith('function costruisciPayloadM2(recipeId, message, classification)'));
});

// Compila le tre funzioni estratte con `new Function`, non con vm: gira
// nello stesso realm del test file (stesso Object.prototype), cosi'
// assert.deepStrictEqual confronta gli oggetti prodotti dal builder senza
// il falso negativo "same structure but not reference-equal" tipico di
// vm.createContext (un secondo realm avrebbe un Object.prototype diverso
// pur essendo l'output strutturalmente identico). Nessun bisogno di vero
// isolamento: il codice estratto e' quello, fidato, di khub_mvp.html.
function loadBuilder(S) {
  const factory = new Function('S', srcR + '\n' + srcCurLab + '\n' + srcBuilder + '\nreturn costruisciPayloadM2;');
  return factory(S);
}

console.log('');
console.log('B. fixture di base e forma del payload (contratto R3A)');

function fixtureRecipeCompleta() {
  return {
    id: 'r1', name: 'Cacio e pepe', category: 'Salato',
    l3Items: [
      { id: 'l3_a', distilledContent: { summary: 'la mantecatura fuori dal fuoco riduce il rischio di stracciare' }, contextConditions: null, knownLimits: null, originL2ItemId: 'l2_confirmed', supersedesId: null },
    ],
    labVersions: [
      {
        id: 'v1', name: 'Cacio e pepe', note: 'prova 3',
        ingredients: [
          { id: 'i1', name: 'Pecorino', qty: 200, unit: 'g', isSubRecipe: false },
          { id: 'i2', name: 'Pepe nero', qty: 6, unit: 'g', isSubRecipe: false },
        ],
        steps: ['Tostare il pepe.', 'Mantecare fuori dal fuoco.'],
        portionsCount: 2, gramsPerPortion: 260,
        l2Items: [
          { id: 'l2_m1_a', operationalState: 'unengaged', decisionState: 'none', content: { label: 'Rischio stracciatura', text: 'La mantecatura a fuoco acceso rischia di stracciare.' }, evidence: null, provenanceType: 'm1', sourceL2ItemId: null, baselineHash: 'hash_v1_a', baselineContext: { note: 'snapshot v1' } },
          { id: 'l2_confirmed', operationalState: 'resolved', decisionState: 'confirmed', content: { label: 'Fuori dal fuoco', text: 'Confermato: mantecare sempre fuori dal fuoco.' }, evidence: { source: 'prova chef' }, provenanceType: 'm2', sourceL2ItemId: null, baselineHash: 'hash_v1_b', baselineContext: { note: 'snapshot v1' } },
        ],
        intentionInitial: { text: 'ricetta tradizionale' }, intentionCurrent: { text: 'ricetta tradizionale, piu\' cremosa' },
        criteriaInitial: { list: ['cremosita\''] }, criteriaCurrent: { list: ['cremosita\'', 'niente grumi'] },
      },
    ],
    currentLabIdx: 0,
  };
}

test('il payload ha esattamente le chiavi top-level previste dal contratto R3A', () => {
  const S = { recipes: [fixtureRecipeCompleta()] };
  const builder = loadBuilder(S);
  const payload = builder('r1', 'Come evito che stracci?');
  assert.deepStrictEqual(Object.keys(payload).sort(), ['criteria', 'intention', 'l2', 'l3', 'message', 'mode', 'recipe', 'variant'].sort());
  assert.strictEqual(payload.mode, 'm2');
});

test('recipe/variant riportano i campi previsti dal contratto (id/name/category, id/ingredients/steps/portionsCount/gramsPerPortion/note)', () => {
  const S = { recipes: [fixtureRecipeCompleta()] };
  const builder = loadBuilder(S);
  const payload = builder('r1', '');
  assert.deepStrictEqual(payload.recipe, { id: 'r1', name: 'Cacio e pepe', category: 'Salato' });
  assert.strictEqual(payload.variant.id, 'v1');
  assert.deepStrictEqual(payload.variant.ingredients, [{ name: 'Pecorino', qty: 200, unit: 'g' }, { name: 'Pepe nero', qty: 6, unit: 'g' }]);
  assert.deepStrictEqual(payload.variant.steps, ['Tostare il pepe.', 'Mantecare fuori dal fuoco.']);
  assert.strictEqual(payload.variant.portionsCount, 2);
  assert.strictEqual(payload.variant.gramsPerPortion, 260);
  assert.strictEqual(payload.variant.note, 'prova 3');
});

test('message viene passato cosi\' come fornito dal chiamante (wiring UI reale fuori scope R3B)', () => {
  const S = { recipes: [fixtureRecipeCompleta()] };
  const builder = loadBuilder(S);
  assert.strictEqual(builder('r1', 'domanda dello chef').message, 'domanda dello chef');
  assert.strictEqual(builder('r1').message, '', 'senza message esplicito, default a stringa vuota (mai undefined)');
});

console.log('');
console.log('C. L2/L3: pertinenza, provenienza M1, nessuna duplicazione');

test('gli L2 M1 arrivano dentro l2 con provenanceType="m1", senza alcun campo/blocco M1 separato', () => {
  const S = { recipes: [fixtureRecipeCompleta()] };
  const builder = loadBuilder(S);
  const payload = builder('r1', '');
  assert.strictEqual(payload.l2.length, 2);
  const m1Item = payload.l2.find(x => x.id === 'l2_m1_a');
  assert.ok(m1Item, 'osservazione M1 assente da l2');
  assert.strictEqual(m1Item.provenanceType, 'm1');
  assert.ok(!('m1' in payload), 'non deve esistere una chiave top-level "m1" separata');
  assert.ok(!payload.hasOwnProperty('m1Observations'), 'non deve esistere un campo m1Observations separato');
});

test('vengono inclusi SOLO gli L2 della variant corrente (non quelli di altre bozze della stessa Scheda)', () => {
  const recipe = fixtureRecipeCompleta();
  const altraBozza = {
    id: 'v2', name: 'Cacio e pepe (v2)', note: '', ingredients: [], steps: [],
    portionsCount: 1, gramsPerPortion: 100,
    l2Items: [{ id: 'l2_altra_bozza', operationalState: 'open', decisionState: 'none', content: { label: 'x', text: 'y' }, evidence: null, provenanceType: 'm1', sourceL2ItemId: null, baselineHash: 'h', baselineContext: {} }],
    intentionInitial: null, intentionCurrent: null, criteriaInitial: null, criteriaCurrent: null,
  };
  recipe.labVersions.push(altraBozza);
  recipe.currentLabIdx = 1; // ora la Bozza corrente e' v2, non v1
  const S = { recipes: [recipe] };
  const builder = loadBuilder(S);
  const payload = builder('r1', '');
  assert.strictEqual(payload.variant.id, 'v2');
  assert.strictEqual(payload.l2.length, 1);
  assert.strictEqual(payload.l2[0].id, 'l2_altra_bozza');
  assert.ok(!payload.l2.some(x => x.id === 'l2_m1_a' || x.id === 'l2_confirmed'), 'gli L2 di v1 non devono comparire quando la Bozza corrente e\' v2');
});

test('vengono inclusi gli L3 della Scheda corrente', () => {
  const S = { recipes: [fixtureRecipeCompleta()] };
  const builder = loadBuilder(S);
  const payload = builder('r1', '');
  assert.strictEqual(payload.l3.length, 1);
  assert.strictEqual(payload.l3[0].id, 'l3_a');
});

test('gli L3 di ALTRE Schede non vengono inclusi', () => {
  const recipeA = fixtureRecipeCompleta();
  const recipeB = fixtureRecipeCompleta();
  recipeB.id = 'r2'; recipeB.name = 'Amatriciana';
  recipeB.l3Items = [{ id: 'l3_b_altra_scheda', distilledContent: { summary: 'non pertinente a r1' }, contextConditions: null, knownLimits: null, originL2ItemId: 'l2_x', supersedesId: null }];
  recipeB.labVersions[0].id = 'v_altra_scheda';
  const S = { recipes: [recipeA, recipeB] };
  const builder = loadBuilder(S);
  const payload = builder('r1', '');
  assert.ok(!payload.l3.some(x => x.id === 'l3_b_altra_scheda'), 'un L3 di unaltra Scheda e\' finito nel payload di r1');
});

test('baselineHash/baselineContext degli L2 vengono riportati invariati (nessun ricalcolo)', () => {
  const S = { recipes: [fixtureRecipeCompleta()] };
  const builder = loadBuilder(S);
  const payload = builder('r1', '');
  const item = payload.l2.find(x => x.id === 'l2_confirmed');
  assert.strictEqual(item.baselineHash, 'hash_v1_b');
  assert.deepStrictEqual(item.baselineContext, { note: 'snapshot v1' });
});

console.log('');
console.log('C2. mini-sprint E2E FIX 3 — baselineStatus (classification) verso il payload M2');

test('senza classification esplicita, ogni L2 riceve baselineStatus:"current" di default (retrocompatibile)', () => {
  const S = { recipes: [fixtureRecipeCompleta()] };
  const builder = loadBuilder(S);
  const payload = builder('r1', ''); // nessun terzo argomento
  payload.l2.forEach(item => assert.strictEqual(item.baselineStatus, 'current'));
});

test('con classification fornita, ogni L2 riceve baselineStatus mappato correttamente PER ID (mai uniforme/posizionale)', () => {
  const S = { recipes: [fixtureRecipeCompleta()] };
  const builder = loadBuilder(S);
  const classification = [
    { id: 'l2_m1_a', status: 'divergent' },
    { id: 'l2_confirmed', status: 'current' },
  ];
  const payload = builder('r1', '', classification);
  assert.strictEqual(payload.l2.find(x => x.id === 'l2_m1_a').baselineStatus, 'divergent');
  assert.strictEqual(payload.l2.find(x => x.id === 'l2_confirmed').baselineStatus, 'current');
});

test('baselineHash/baselineContext restano presenti e invariati anche quando baselineStatus viene aggiunto (arricchimento, mai sostituzione)', () => {
  const S = { recipes: [fixtureRecipeCompleta()] };
  const builder = loadBuilder(S);
  const payload = builder('r1', '', [{ id: 'l2_confirmed', status: 'divergent' }]);
  const item = payload.l2.find(x => x.id === 'l2_confirmed');
  assert.strictEqual(item.baselineStatus, 'divergent');
  assert.strictEqual(item.baselineHash, 'hash_v1_b', 'baselineHash non deve sparire ne\' cambiare');
  assert.deepStrictEqual(item.baselineContext, { note: 'snapshot v1' }, 'baselineContext non deve sparire ne\' cambiare');
});

test('costruisciPayloadM2 NON ricalcola mai il baseline: nessun riferimento a KhubReconciliation/classifyBaseline/computeCurrentBaseline', () => {
  ['KhubReconciliation', 'classifyBaseline', 'computeCurrentBaseline', 'KhubBaseline'].forEach(needle => {
    assert.ok(!srcBuilder.includes(needle), 'costruisciPayloadM2 non deve calcolare il baseline internamente: trovato riferimento a ' + needle);
  });
});

test('il builder non muta S/recipe/variant/L2 anche quando classification marca item come divergent', () => {
  const recipe = fixtureRecipeCompleta();
  const S = { recipes: [recipe] };
  const before = JSON.parse(JSON.stringify(S));
  const builder = loadBuilder(S);
  builder('r1', 'un messaggio qualsiasi', [{ id: 'l2_m1_a', status: 'divergent' }, { id: 'l2_confirmed', status: 'divergent' }]);
  assert.deepStrictEqual(S, before, 'S e\' stato mutato dalla chiamata a costruisciPayloadM2 con classification');
});

console.log('');
console.log('D. intention/criteria: passthrough senza inferenza');

test('intention_initial/current e criteria_initial/current vengono riportati senza modifica', () => {
  const S = { recipes: [fixtureRecipeCompleta()] };
  const builder = loadBuilder(S);
  const payload = builder('r1', '');
  assert.deepStrictEqual(payload.intention, { initial: { text: 'ricetta tradizionale' }, current: { text: 'ricetta tradizionale, piu\' cremosa' } });
  assert.deepStrictEqual(payload.criteria, { initial: { list: ['cremosita\''] }, current: { list: ['cremosita\'', 'niente grumi'] } });
});

console.log('');
console.log('E. robustezza: nessun M1, L2/L3 vuoti, intention/criteria null');

function fixtureRecipeMinimale() {
  return {
    id: 'r_min', name: 'Bozza nuova', category: 'Altro',
    l3Items: [],
    labVersions: [{
      id: 'v_min', name: 'Bozza nuova', note: '',
      ingredients: [], steps: [], portionsCount: 1, gramsPerPortion: 0,
      l2Items: [],
      intentionInitial: null, intentionCurrent: null, criteriaInitial: null, criteriaCurrent: null,
    }],
    currentLabIdx: 0,
  };
}

test('funziona con nessun M1 pregresso, L2 vuoto, L3 vuoto, intention/criteria null — nessuna eccezione, forma sempre coerente', () => {
  const S = { recipes: [fixtureRecipeMinimale()] };
  const builder = loadBuilder(S);
  const payload = builder('r_min', '');
  assert.deepStrictEqual(payload.l2, []);
  assert.deepStrictEqual(payload.l3, []);
  assert.deepStrictEqual(payload.intention, { initial: null, current: null });
  assert.deepStrictEqual(payload.criteria, { initial: null, current: null });
  assert.strictEqual(payload.variant.note, '');
});

test('recipeId inesistente restituisce null (mai un\'eccezione)', () => {
  const S = { recipes: [fixtureRecipeMinimale()] };
  const builder = loadBuilder(S);
  assert.strictEqual(builder('non_esiste', ''), null);
});

test('Scheda senza alcuna Bozza LAB (labVersions vuoto) restituisce null', () => {
  const recipe = fixtureRecipeMinimale();
  recipe.labVersions = [];
  const S = { recipes: [recipe] };
  const builder = loadBuilder(S);
  assert.strictEqual(builder('r_min', ''), null);
});

console.log('');
console.log('F. nessuna mutazione, nessuna persistenza');

test('il builder non muta S/recipe/variant/L2/L3 (deep-equal prima/dopo la chiamata)', () => {
  const recipe = fixtureRecipeCompleta();
  const S = { recipes: [recipe] };
  const before = JSON.parse(JSON.stringify(S));
  const builder = loadBuilder(S);
  builder('r1', 'un messaggio qualsiasi');
  assert.deepStrictEqual(S, before, 'S e\' stato mutato dalla chiamata a costruisciPayloadM2');
});

test('costruisciPayloadM2 non contiene chiamate di rete, save o mutazioni di stato applicativo (fetch/saveToSupabase/upLab/upRec)', () => {
  ['fetch(', 'saveToSupabase(', 'upLab(', 'upRec(', 'supabaseAction'].forEach(needle => {
    assert.ok(!srcBuilder.includes(needle), 'costruisciPayloadM2 contiene un riferimento non atteso: ' + needle);
  });
});

console.log('');
console.log('G. non regressione (controllo leggero — la suite reale resta test-m1.js/test-m2-contract.js/test-persistent-state.js)');

test('costruisciContestoSchedaLAB (R3F): rimossa insieme alla pipeline "Chiedi a MichelinAI" legacy che la usava; costruisciPayloadM2 resta definita', () => {
  const idxOld = html.indexOf('function costruisciContestoSchedaLAB(recipeId)');
  const idxNew = html.indexOf('function costruisciPayloadM2(recipeId, message, classification)');
  assert.strictEqual(idxOld, -1, 'era usata SOLO da chiediMichelinAI(), rimossa con essa in R3F');
  assert.ok(idxNew !== -1);
});

test('chiediMichelinAI()/interpretaModifiche() (R3F): assorbite da M2, rimosse e non più raggiungibili; runM2 ora e\' collegata alla UI reale', () => {
  assert.doesNotMatch(html, /async function chiediMichelinAI\(recipeId\)\{/);
  assert.doesNotMatch(html, /async function interpretaModifiche\(recipeId\)\{/);
  // R3F: il seam reale e' runM2() via inviaMichelinAI(), mai una chiamata
  // diretta a costruisciPayloadM2 da un onclick/event listener.
  assert.doesNotMatch(html, /onclick="costruisciPayloadM2/);
  assert.match(html, /addEventListener\('click',\(\)=>inviaMichelinAI\(recipe\.id\)\)/, 'il click su #mai-q-send deve chiamare inviaMichelinAI (che a sua volta chiama runM2)');
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');

if (failed > 0) process.exit(1);
