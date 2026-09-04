/*
 * Test R3F — M2 UI INTEGRATION + LEGACY ABSORPTION.
 *
 * Stesso stile/harness degli altri file test-m2-*.js: le funzioni vengono
 * ESTRATTE da khub_mvp.html ed ESEGUITE davvero (new Function, stesso
 * realm). Solo document/render/runM2/applyM2Persistence sono mock quando
 * serve isolare il seam sotto test — mai un doppione a mano della logica
 * reale quando la funzione stessa può essere estratta ed eseguita.
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

// Estrae il testo dell'IIFE del pannello MichelinAI dentro la card LAB,
// a partire dal marker esatto usato nel render, per ispezionare cosa
// finisce davvero nell'HTML mostrato allo chef (mai un doppione: e' il
// testo sorgente reale del template).
function extractTemplateBlock(startMarker, endMarkerRegexSrc) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error('marker non trovato: ' + startMarker);
  const rest = html.slice(start);
  const m = rest.match(new RegExp(endMarkerRegexSrc));
  if (!m) throw new Error('fine blocco non trovata dopo: ' + startMarker);
  return rest.slice(0, m.index + m[0].length);
}

const srcR = extractFunction('function R(id)');
const srcCurLab = extractFunction('function curLab(recipe)');
const srcRenderContenuto = extractFunction('function renderContenutoL2Umano(content)');
const srcRenderPending = extractFunction('function renderMichelinAIPendingActions(recipeId,v)');
const srcInvia = extractFunction('async function inviaMichelinAI(recipeId)');
const srcConfermaEsistente = extractFunction('async function confermaEsistenteM2(recipeId,l2Id)');
const srcConfermaNuovo = extractFunction('async function confermaNuovoM2(recipeId,tempId)');
const srcAdottaIntention = extractFunction('async function adottaIntentionM2(recipeId)');
const srcAdottaCriteria = extractFunction('async function adottaCriteriaM2(recipeId)');
const srcRiprova = extractFunction('async function riprovaSalvataggioM2(recipeId)');

function makeS(recipes) {
  return { recipes: recipes, m2Result: {}, m2Loading: false, m2LoadingKey: null, m2Error: {}, m2SaveFailed: {}, michelinAIQuestion: '', michelinAILastQuestion: null, michelinAILastResponse: null };
}

function makeRecipe(l2Items) {
  return {
    id: 'r1', name: 'Cacio e pepe', category: 'Salato', l3Items: [],
    labVersions: [{
      id: 'v1', name: 'Cacio e pepe', note: '',
      ingredients: [{ id: 'i1', name: 'Pecorino', qty: 200, unit: 'g', isSubRecipe: false }],
      steps: ['Mantecare fuori dal fuoco.'],
      portionsCount: 2, gramsPerPortion: 260,
      l2Items: l2Items || [],
      intentionInitial: null, intentionCurrent: null, criteriaInitial: null, criteriaCurrent: null,
    }],
    currentLabIdx: 0,
  };
}

function makeDocument(inputValue) {
  return { getElementById(id) { return id === 'mai-q-input' ? { value: inputValue } : null; } };
}

// Factory per inviaMichelinAI: runM2/applyM2Persistence/render sono le
// uniche dipendenze mockate (il vero confine I/O + il seam sotto test);
// R/curLab sono le funzioni REALI estratte da khub_mvp.html.
function makeInvia(S, opts) {
  opts = opts || {};
  const renderLog = [];
  const runM2Calls = [];
  const applyCalls = [];
  const runM2Impl = opts.runM2 || (async () => {});
  const applyImpl = opts.apply || (async () => ({ ok: true }));
  const factory = new Function(
    'S', 'document', 'runM2', 'applyM2Persistence', 'render',
    srcR + '\n' + srcCurLab + '\n' + srcInvia + '\nreturn inviaMichelinAI;'
  );
  const inviaMichelinAI = factory(
    S, makeDocument(opts.inputValue),
    async (recipeId, message) => { runM2Calls.push({ recipeId, message }); return runM2Impl(recipeId, message); },
    async (recipeId, options) => { applyCalls.push({ recipeId, options }); return applyImpl(recipeId, options); },
    () => renderLog.push(1)
  );
  return { inviaMichelinAI, runM2Calls, applyCalls, renderLog };
}

function makeAzioneChef(srcFn, fnName, S, applyImpl) {
  const applyCalls = [];
  const renderLog = [];
  const factory = new Function(
    'applyM2Persistence', 'render',
    srcFn + '\nreturn ' + fnName + ';'
  );
  const fn = factory(
    async (recipeId, options) => { applyCalls.push({ recipeId, options }); return (applyImpl || (async () => ({ ok: true })))(recipeId, options); },
    () => renderLog.push(1)
  );
  return { fn, applyCalls, renderLog };
}

function makeRenderPending() {
  const factory = new Function(
    'S',
    srcRenderContenuto + '\n' + srcRenderPending + '\nreturn renderMichelinAIPendingActions;'
  );
  return factory;
}

// Factory per riprovaSalvataggioM2: mai runM2, mai una nuova risposta AI —
// solo un retry del SOLO salvataggio (applyM2Persistence(id,{})).
function makeRiprova(S, applyImpl) {
  const applyCalls = [];
  const renderLog = [];
  const factory = new Function(
    'S', 'applyM2Persistence', 'render',
    srcR + '\n' + srcCurLab + '\n' + srcRiprova + '\nreturn riprovaSalvataggioM2;'
  );
  const riprovaSalvataggioM2 = factory(
    S,
    async (recipeId, options) => { applyCalls.push({ recipeId, options }); return (applyImpl || (async () => ({ ok: true })))(recipeId, options); },
    () => renderLog.push(1)
  );
  return { riprovaSalvataggioM2, applyCalls, renderLog };
}

async function run() {
  console.log('1-2. seam: invio -> runM2 (mai chiediMichelinAI)');

  await test('1: click/invio chiama runM2 con (recipeId, message) dalla textarea, non chiediMichelinAI', async () => {
    const recipe = makeRecipe([]);
    const S = makeS([recipe]);
    let recordedResponse = 'Ecco la mia lettura sulla tua Scheda.';
    const { inviaMichelinAI, runM2Calls } = makeInvia(S, {
      inputValue: 'Cosa succede se riduco il burro?',
      runM2: async (recipeId) => { S.m2Result['v1'] = { response: recordedResponse, l2Updates: { applied: [], rejected: [] }, l2New: [], intentionChange: null, criteriaChange: null, l3Candidates: [] }; },
      apply: async () => { delete S.m2Result['v1']; return { ok: true }; },
    });
    await inviaMichelinAI('r1');
    assert.strictEqual(runM2Calls.length, 1);
    assert.strictEqual(runM2Calls[0].recipeId, 'r1');
    assert.strictEqual(runM2Calls[0].message, 'Cosa succede se riduco il burro?');
  });

  await test('2: Cmd/Ctrl+Enter e click #mai-q-send chiamano entrambi inviaMichelinAI(recipe.id), mai chiediMichelinAI', () => {
    assert.match(html, /maiQInput\.addEventListener\('keydown',e=>\{if\(e\.key==='Enter'&&\(e\.metaKey\|\|e\.ctrlKey\)\)\{e\.preventDefault\(\);inviaMichelinAI\(recipe\.id\);\}\}\)/);
    assert.match(html, /maiQSend\.addEventListener\('click',\(\)=>inviaMichelinAI\(recipe\.id\)\)/);
    assert.doesNotMatch(html, /chiediMichelinAI/, 'nessun riferimento residuo alla pipeline legacy');
  });

  console.log('');
  console.log('3-4. risposta visibile, mai JSON/PSL');

  await test('3: response prose salvata come ultima domanda/risposta effimera dopo un turno riuscito', async () => {
    const recipe = makeRecipe([]);
    const S = makeS([recipe]);
    const { inviaMichelinAI } = makeInvia(S, {
      inputValue: 'Che ne pensi della cottura?',
      runM2: async () => { S.m2Result['v1'] = { response: 'La cottura mi sembra corretta.', l2Updates: { applied: [], rejected: [] }, l2New: [], intentionChange: null, criteriaChange: null, l3Candidates: [] }; },
      apply: async () => { delete S.m2Result['v1']; return { ok: true }; },
    });
    await inviaMichelinAI('r1');
    assert.strictEqual(S.michelinAILastQuestion, 'Che ne pensi della cottura?');
    assert.strictEqual(S.michelinAILastResponse, 'La cottura mi sembra corretta.');
  });

  await test('4: il template della card MichelinAI non renderizza mai JSON/PSL/marker interni', () => {
    const block = extractTemplateBlock('return`<div class="ai-panel">', /\}\)\(\):''\}/);
    ['===M2_UPDATE===', 'decision_state', 'operational_state', 'provenanceType', 'provenance_type', 'baselineHash', 'baseline_hash', 'l3Candidates', 'classification'].forEach(tok => {
      assert.doesNotMatch(block, new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'token PSL/interno esposto in UI: ' + tok);
    });
  });

  console.log('');
  console.log('5. auto-persistence dopo runM2');

  await test('5: dopo un runM2 riuscito, auto-apply chiama applyM2Persistence(recipeId,{})', async () => {
    const recipe = makeRecipe([]);
    const S = makeS([recipe]);
    const { inviaMichelinAI, applyCalls } = makeInvia(S, {
      inputValue: 'domanda',
      runM2: async () => { S.m2Result['v1'] = { response: 'ok', l2Updates: { applied: [], rejected: [] }, l2New: [], intentionChange: null, criteriaChange: null, l3Candidates: [] }; },
    });
    await inviaMichelinAI('r1');
    assert.strictEqual(applyCalls.length, 1);
    assert.strictEqual(applyCalls[0].recipeId, 'r1');
    assert.deepStrictEqual(applyCalls[0].options, {});
  });

  console.log('');
  console.log('6-9. azioni chef granulari: existing/new L2');

  await test('6: existing L2 pending e\' visibile con testo letto da v.l2Items (mai inventato)', () => {
    const factory = makeRenderPending();
    const S = {};
    const renderMichelinAIPendingActions = factory(S);
    const v = { l2Items: [{ id: 'l2_a', content: { label: 'Struttura', text: 'La crema rischia di separarsi.' } }] };
    S.m2Result = { v1: { l2Updates: { rejected: [{ id: 'l2_a', reason: 'gate' }] }, l2New: [], intentionChange: null, criteriaChange: null } };
    v.id = 'v1';
    const outHtml = renderMichelinAIPendingActions('r1', v);
    assert.match(outHtml, /La crema rischia di separarsi\./);
    assert.match(outHtml, /Conferma/);
  });

  await test('7: click Conferma existing usa l\'id corretto in confirmExistingL2Ids', async () => {
    const factory = makeRenderPending();
    const S = {};
    const renderMichelinAIPendingActions = factory(S);
    const v = { id: 'v1', l2Items: [{ id: 'l2_a', content: { text: 'Testo esistente' } }] };
    S.m2Result = { v1: { l2Updates: { rejected: [{ id: 'l2_a', reason: 'gate' }] }, l2New: [], intentionChange: null, criteriaChange: null } };
    const outHtml = renderMichelinAIPendingActions('r1', v);
    assert.match(outHtml, /confermaEsistenteM2\('r1','l2_a'\)/);

    const { fn, applyCalls } = makeAzioneChef(srcConfermaEsistente, 'confermaEsistenteM2');
    await fn('r1', 'l2_a');
    assert.strictEqual(applyCalls.length, 1);
    assert.deepStrictEqual(applyCalls[0], { recipeId: 'r1', options: { confirmExistingL2Ids: ['l2_a'] } });
  });

  await test('8: new L2 pending usa tempId (mai un indice posizionale)', () => {
    const factory = makeRenderPending();
    const S = {};
    const renderMichelinAIPendingActions = factory(S);
    const v = { id: 'v1', l2Items: [] };
    S.m2Result = { v1: { l2Updates: { rejected: [] }, l2New: [{ tempId: 'm2new_xyz', proposedNew: { content: { text: 'Nuova osservazione forte' } } }], intentionChange: null, criteriaChange: null } };
    const outHtml = renderMichelinAIPendingActions('r1', v);
    assert.match(outHtml, /Nuova osservazione forte/);
    assert.match(outHtml, /confermaNuovoM2\('r1','m2new_xyz'\)/);
    assert.doesNotMatch(outHtml, /confermaNuovoM2\('r1',0\)/, 'mai un indice numerico');
  });

  await test('9: click Conferma new chiama applyM2Persistence con confirmNewL2Ids (per tempId)', async () => {
    const { fn, applyCalls } = makeAzioneChef(srcConfermaNuovo, 'confermaNuovoM2');
    await fn('r1', 'm2new_xyz');
    assert.strictEqual(applyCalls.length, 1);
    assert.deepStrictEqual(applyCalls[0], { recipeId: 'r1', options: { confirmNewL2Ids: ['m2new_xyz'] } });
  });

  console.log('');
  console.log('10-11. intention / criteria');

  await test('10: intentionChange pending mostra "Adotta intenzione" -> adoptIntention:true', async () => {
    const factory = makeRenderPending();
    const S = {};
    const renderMichelinAIPendingActions = factory(S);
    const v = { id: 'v1', l2Items: [] };
    S.m2Result = { v1: { l2Updates: { rejected: [] }, l2New: [], intentionChange: { text: 'nuova intenzione' }, criteriaChange: null } };
    const outHtml = renderMichelinAIPendingActions('r1', v);
    assert.match(outHtml, /Adotta intenzione/);
    assert.match(outHtml, /adottaIntentionM2\('r1'\)/);

    const { fn, applyCalls } = makeAzioneChef(srcAdottaIntention, 'adottaIntentionM2');
    await fn('r1');
    assert.deepStrictEqual(applyCalls[0], { recipeId: 'r1', options: { adoptIntention: true } });
  });

  await test('11: criteriaChange pending mostra "Adotta criterio" -> adoptCriteria:true', async () => {
    const factory = makeRenderPending();
    const S = {};
    const renderMichelinAIPendingActions = factory(S);
    const v = { id: 'v1', l2Items: [] };
    S.m2Result = { v1: { l2Updates: { rejected: [] }, l2New: [], intentionChange: null, criteriaChange: { list: ['x'] } } };
    const outHtml = renderMichelinAIPendingActions('r1', v);
    assert.match(outHtml, /Adotta criterio/);
    assert.match(outHtml, /adottaCriteriaM2\('r1'\)/);

    const { fn, applyCalls } = makeAzioneChef(srcAdottaCriteria, 'adottaCriteriaM2');
    await fn('r1');
    assert.deepStrictEqual(applyCalls[0], { recipeId: 'r1', options: { adoptCriteria: true } });
  });

  console.log('');
  console.log('12-13. niente conferma globale, niente UI L3');

  await test('12: nessun "conferma tutto"/"applica tutto" globale nel pannello MichelinAI; applyM2Persistence mai da un onclick diretto', () => {
    const block = extractTemplateBlock('return`<div class="ai-panel">', /\}\)\(\):''\}/);
    assert.doesNotMatch(block, /[Cc]onferma tutto|[Aa]pplica tutt[oi]/);
    assert.doesNotMatch(html, /onclick="[^"]*applyM2Persistence/);
    const occurrences = (html.match(/applyM2Persistence\(/g) || []).length;
    assert.strictEqual(occurrences, 7, 'definizione + inviaMichelinAI (auto-apply) + 4 azioni chef granulari + riprovaSalvataggioM2 (retry), nessun\'altra chiamata');
  });

  await test('13: zero UI L3 — nessun riferimento a l3Candidates/evidence/consolidamento nel pannello o nelle azioni pending', () => {
    const block = extractTemplateBlock('return`<div class="ai-panel">', /\}\)\(\):''\}/);
    ['l3Candidates', 'l3Created', 'evidence', 'consolidat', 'knowledge', 'L3'].forEach(tok => {
      assert.doesNotMatch(block, new RegExp(tok));
    });
    assert.doesNotMatch(srcRenderPending, /l3Candidates\.forEach|l3Candidates\.map/, 'renderMichelinAIPendingActions non deve mai iterare l3Candidates');
  });

  console.log('');
  console.log('14-15. loading / error');

  await test('14: la card usa S.m2Loading/S.m2LoadingKey (mai lo stato legacy michelinAILoading)', () => {
    assert.match(html, /staRispondendo=S\.m2Loading&&S\.m2LoadingKey===chiaveBozzaAttuale/);
    assert.doesNotMatch(html, /michelinAILoading/);
  });

  await test('15: la card mostra S.m2Error[v.id] in modo semplice quando non in loading (e non durante il guardrail save-failed)', () => {
    assert.match(html, /erroreM2=!staRispondendo&&!salvataggioFallito&&S\.m2Error\[v\.id\]/);
    assert.match(html, /erroreM2\?`<div style="margin-top:10px;font-size:13px;color:#c0392b">/);
  });

  console.log('');
  console.log('16-17. legacy irraggiungibile');

  await test('16: chiediMichelinAI() non esiste piu\' e nessun listener/onclick la richiama', () => {
    assert.doesNotMatch(html, /async function chiediMichelinAI\(/);
    assert.doesNotMatch(html, /onclick="[^"]*chiediMichelinAI/);
    assert.doesNotMatch(html, /addEventListener\('(?:click|keydown)',[^)]*chiediMichelinAI/);
  });

  await test('17: interpretaModifiche() non esiste piu\' e nessun onclick la richiama', () => {
    assert.doesNotMatch(html, /async function interpretaModifiche\(/);
    assert.doesNotMatch(html, /onclick="[^"]*interpretaModifiche/);
  });

  console.log('');
  console.log('18-19. diff deterministico preservato');

  await test('18: contaVariabiliCambiate() resta definita e funzionante', () => {
    assert.match(html, /function contaVariabiliCambiate\(/);
    const srcConta = extractFunction('function contaVariabiliCambiate(');
    const srcCnum = extractFunction('function cnum(n)');
    const fn = new Function(srcCnum + '\n' + srcConta + '\nreturn contaVariabiliCambiate;')();
    const prima = [{ id: 'i1', name: 'Farina', qty: 100, unit: 'g' }];
    const dopo = [{ id: 'i1', name: 'Farina', qty: 150, unit: 'g' }, { id: 'i2', name: 'Zucchero', qty: 20, unit: 'g' }];
    const risultato = fn(prima, dopo);
    assert.ok(risultato.numeroIngredientiCoinvolti >= 2, 'rileva sia la modifica che l\'aggiunta');
  });

  await test('19: pannello "Confronta con la Ricetta di partenza" (deterministico) resta presente', () => {
    assert.match(html, /Confronta con la Ricetta di partenza/);
    assert.match(html, /S\.mostraConfrontoOrigine=!S\.mostraConfrontoOrigine/);
    assert.match(html, /contaVariabiliCambiate\(origine\.variant\.ingredients,v\.ingredients\)/);
  });

  console.log('');
  console.log('20. response sopravvive anche a m2Result completamente consumato');

  await test('20: la risposta resta visibile (stato UI effimero) anche se l\'auto-apply consuma interamente m2Result', async () => {
    const recipe = makeRecipe([]);
    const S = makeS([recipe]);
    const { inviaMichelinAI } = makeInvia(S, {
      inputValue: 'domanda che non lascia nulla pending',
      runM2: async () => { S.m2Result['v1'] = { response: 'Tutto a posto, nessuna azione richiesta.', l2Updates: { applied: ['l2_x'], rejected: [] }, l2New: [], intentionChange: null, criteriaChange: null, l3Candidates: [] }; },
      apply: async () => { delete S.m2Result['v1']; return { ok: true }; }, // simula il pruning reale quando nulla resta pending
    });
    await inviaMichelinAI('r1');
    assert.strictEqual(S.m2Result['v1'], undefined, 'm2Result davvero consumato dall\'auto-apply');
    assert.strictEqual(S.michelinAILastResponse, 'Tutto a posto, nessuna azione richiesta.', 'la prosa resta leggibile nello stato UI effimero, non e\' sparita col result');
  });

  console.log('');
  console.log('21. mobile structural sanity (statico)');

  await test('21: input/bottoni della card hanno un tap target adeguato in mobile (min-height in @media)', () => {
    const mobileBlockMatch = html.match(/@media\(max-width:768px\)\{[\s\S]*?\.ai-input\{font-size:13px;min-height:44px;\}/);
    assert.ok(mobileBlockMatch, '.ai-input deve avere min-height:44px in mobile');
    assert.match(html, /\.btn\{min-height:40px;\}/, 'i bottoni (Invio/Conferma/Adotta usano .btn) hanno un tap target minimo in mobile');
  });

  console.log('');
  console.log('22-30. EDGE CASE: guardrail m2SaveFailed dopo auto-apply fallito');

  await test('22: auto-apply failure attiva S.m2SaveFailed e lascia m2Result invariato', async () => {
    const recipe = makeRecipe([]);
    const S = makeS([recipe]);
    const rispostaOriginale = { response: 'Risposta M2 di prova.', l2Updates: { applied: ['l2_x'], rejected: [] }, l2New: [], intentionChange: null, criteriaChange: null, l3Candidates: [] };
    const { inviaMichelinAI } = makeInvia(S, {
      inputValue: 'prima domanda',
      runM2: async () => { S.m2Result['v1'] = rispostaOriginale; },
      apply: async () => ({ ok: false, error: 'Salvataggio M2 non riuscito: stato locale ripristinato' }),
    });
    await inviaMichelinAI('r1');
    assert.strictEqual(S.m2SaveFailed['v1'], true);
    assert.deepStrictEqual(S.m2Result['v1'], rispostaOriginale, 'm2Result invariato: nessuna proposta persa');
  });

  await test('23: con il flag attivo un nuovo invio e\' bloccato e runM2 non viene mai chiamato', async () => {
    const recipe = makeRecipe([]);
    const S = makeS([recipe]);
    S.m2SaveFailed['v1'] = true;
    S.m2Result['v1'] = { response: 'Vecchia risposta', l2Updates: { applied: [], rejected: [] }, l2New: [], intentionChange: null, criteriaChange: null, l3Candidates: [] };
    const { inviaMichelinAI, runM2Calls } = makeInvia(S, { inputValue: 'nuova domanda' });
    await inviaMichelinAI('r1');
    assert.strictEqual(runM2Calls.length, 0, 'runM2 non deve mai essere chiamato mentre il blocco e\' attivo');
    assert.strictEqual(S.m2Result['v1'].response, 'Vecchia risposta', 'm2Result non toccato dal tentativo bloccato');
  });

  await test('24: "Riprova salvataggio" e\' visibile e l\'input e\' disabilitato quando il guardrail e\' attivo', () => {
    assert.match(html, /Il salvataggio non è riuscito\./);
    assert.match(html, /Riprova salvataggio/);
    assert.match(html, /onclick="riprovaSalvataggioM2\('\$\{recipe\.id\}'\)"/);
    assert.match(html, /const inputBloccato=staRispondendo\|\|salvataggioFallito;/);
  });

  await test('25: il retry chiama applyM2Persistence(recipeId,{}), mai runM2', async () => {
    const S = makeS([makeRecipe([])]);
    const { riprovaSalvataggioM2, applyCalls } = makeRiprova(S, async () => ({ ok: true }));
    await riprovaSalvataggioM2('r1');
    assert.strictEqual(applyCalls.length, 1);
    assert.deepStrictEqual(applyCalls[0], { recipeId: 'r1', options: {} });
  });

  await test('26: retry riuscito rimuove il flag m2SaveFailed', async () => {
    const S = makeS([makeRecipe([])]);
    S.m2SaveFailed['v1'] = true;
    const { riprovaSalvataggioM2 } = makeRiprova(S, async () => ({ ok: true }));
    await riprovaSalvataggioM2('r1');
    assert.strictEqual(S.m2SaveFailed['v1'], undefined);
  });

  await test('27: dopo un retry riuscito la risposta precedente resta visibile (stato UI effimero non toccato)', async () => {
    const S = makeS([makeRecipe([])]);
    S.m2SaveFailed['v1'] = true;
    S.michelinAILastQuestion = 'domanda precedente';
    S.michelinAILastResponse = 'risposta precedente';
    const { riprovaSalvataggioM2 } = makeRiprova(S, async () => ({ ok: true }));
    await riprovaSalvataggioM2('r1');
    assert.strictEqual(S.michelinAILastQuestion, 'domanda precedente');
    assert.strictEqual(S.michelinAILastResponse, 'risposta precedente');
  });

  await test('28: dopo un retry riuscito un nuovo invio e\' nuovamente consentito (runM2 tornato chiamabile)', async () => {
    const S = makeS([makeRecipe([])]);
    S.m2SaveFailed['v1'] = true; // stato post-fallimento simulato
    const { riprovaSalvataggioM2 } = makeRiprova(S, async () => ({ ok: true }));
    await riprovaSalvataggioM2('r1');
    assert.strictEqual(S.m2SaveFailed['v1'], undefined, 'precondizione: flag rimosso dal retry riuscito');

    const { inviaMichelinAI, runM2Calls } = makeInvia(S, {
      inputValue: 'nuova domanda dopo il retry',
      runM2: async () => { S.m2Result['v1'] = { response: 'ok', l2Updates: { applied: [], rejected: [] }, l2New: [], intentionChange: null, criteriaChange: null, l3Candidates: [] }; },
      apply: async () => { delete S.m2Result['v1']; return { ok: true }; },
    });
    await inviaMichelinAI('r1');
    assert.strictEqual(runM2Calls.length, 1, 'runM2 di nuovo chiamabile dopo la rimozione del flag');
  });

  await test('29: retry fallito lascia il flag attivo e m2Result invariato (nessuna proposta persa neanche al secondo fallimento)', async () => {
    const S = makeS([makeRecipe([])]);
    S.m2SaveFailed['v1'] = true;
    const rispostaOriginale = { response: 'ok', l2Updates: { applied: ['l2_x'], rejected: [] }, l2New: [], intentionChange: null, criteriaChange: null, l3Candidates: [] };
    S.m2Result['v1'] = rispostaOriginale;
    const { riprovaSalvataggioM2 } = makeRiprova(S, async () => ({ ok: false, error: 'ancora giu\'' }));
    await riprovaSalvataggioM2('r1');
    assert.strictEqual(S.m2SaveFailed['v1'], true);
    assert.deepStrictEqual(S.m2Result['v1'], rispostaOriginale);
  });

  await test('30: un m2Result normale con SOLE proposte chef pending NON attiva il guardrail e non blocca un nuovo turno', async () => {
    const recipe = makeRecipe([{ id: 'l2_a', operationalState: 'open', decisionState: 'probable', content: { text: 'x' }, evidence: null, provenanceType: 'm1', sourceL2ItemId: null, baselineHash: 'h', baselineContext: {} }]);
    const S = makeS([recipe]);

    const primo = makeInvia(S, {
      inputValue: 'domanda con proposta gated',
      runM2: async () => { S.m2Result['v1'] = { response: 'ok, ma una decisione resta da confermare', l2Updates: { applied: [], rejected: [{ id: 'l2_a', reason: 'gate' }] }, l2New: [], intentionChange: null, criteriaChange: null, l3Candidates: [] }; },
      apply: async () => ({ ok: true }), // auto-apply riesce: nulla di automatico da applicare, ma il save e' comunque un successo
    });
    await primo.inviaMichelinAI('r1');
    assert.strictEqual(S.m2SaveFailed['v1'], undefined, 'auto-apply riuscito: nessun guardrail, anche se m2Result sopravvive per la proposta pending');
    assert.ok(S.m2Result['v1'], 'm2Result sopravvive normalmente per la proposta chef pending (caso A, non un fallimento)');

    const secondo = makeInvia(S, {
      inputValue: 'seconda domanda',
      runM2: async () => { S.m2Result['v1'] = { response: 'seconda risposta', l2Updates: { applied: [], rejected: [] }, l2New: [], intentionChange: null, criteriaChange: null, l3Candidates: [] }; },
      apply: async () => { delete S.m2Result['v1']; return { ok: true }; },
    });
    await secondo.inviaMichelinAI('r1');
    assert.strictEqual(secondo.runM2Calls.length, 1, 'il secondo turno NON e\' bloccato da un m2Result che sopravvive solo per proposte chef pending');
  });

  console.log('');
  console.log(`Totale: ${passed} passati, ${failed} falliti`);
  if (failed > 0) process.exit(1);
}

run();
