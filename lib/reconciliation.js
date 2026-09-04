/*
 * KhubReconciliation — meccanismo minimo per la riconciliazione L2/baseline
 * (R3C, MichelinAI 2.0).
 *
 * Principio congelato: una modifica della Bozza NON prova automaticamente
 * che un problema sia risolto. baseline_hash/baseline_context di un L2
 * rappresentano lo stato della Ricetta rispetto al quale QUELL'ITEM è stato
 * valutato/rivalutato — non vanno mai aggiornati in massa solo perché la
 * Ricetta è cambiata, solo quando quell'item è realmente rivalutato.
 *
 * Questo modulo NON decide se una divergenza è rilevante (nessuna euristica
 * di pertinenza gastronomica: keyword matching, substring, distanza
 * testuale, regole hardcoded — tutto questo è vietato qui ed è comunque
 * fuori perimetro: il riconoscimento semantico dell'impatto appartiene a
 * M2). Fa solo tre cose, in modo puro e deterministico:
 *   1. calcola/confronta baseline_hash (current vs divergent);
 *   2. valida la FORMA e i vincoli di un proposed update (mai la sua
 *      qualità gastronomica);
 *   3. applica SOLO gli update validati, senza mai mutare gli originali.
 *
 * Nessuna persistenza, nessuna chiamata di rete, nessuna mutazione di
 * stato: pura infrastruttura, come lib/baseline.js.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./baseline.js'));
  } else {
    root.KhubReconciliation = factory(root.KhubBaseline);
  }
})(typeof self !== 'undefined' ? self : this, function (KhubBaseline) {
  'use strict';

  var OPERATIONAL_STATES = ['unengaged', 'open', 'affected', 'superseded', 'resolved'];
  var DECISION_STATES = ['none', 'probable', 'confirmed'];

  /**
   * buildSnapshot(variant) -> snapshot
   * STESSA forma esatta usata da runM1() per calcolare il baseline di un
   * L2 al momento della sua creazione — deve restare identica, altrimenti
   * gli hash non sarebbero mai comparabili anche a parità di contenuto.
   */
  function buildSnapshot(variant) {
    var v = variant || {};
    return {
      ingredients: (v.ingredients || []).map(function (i) { return { name: i.name, qty: i.qty, unit: i.unit }; }),
      steps: v.steps || [],
      portionsCount: v.portionsCount,
      gramsPerPortion: v.gramsPerPortion,
      note: v.note || '',
    };
  }

  /**
   * computeCurrentBaseline(variant) -> { baseline_hash, baseline_context }
   * = KhubBaseline.compute(buildSnapshot(variant))
   */
  function computeCurrentBaseline(variant) {
    return KhubBaseline.compute(buildSnapshot(variant));
  }

  /**
   * classifyBaseline(l2Items, currentBaselineHash) -> [{id, status}]
   * Confronto puro: nessuna mutazione, nessuna proprietà nuova scritta
   * sugli L2. 'current' se l2.baselineHash === currentBaselineHash,
   * altrimenti 'divergent'. La divergenza NON implica alcun cambio di
   * operational_state/decision_state/evidence/content/baseline: è solo
   * un fatto rilevato, non un'azione.
   */
  function classifyBaseline(l2Items, currentBaselineHash) {
    return (l2Items || []).map(function (item) {
      return { id: item.id, status: item.baselineHash === currentBaselineHash ? 'current' : 'divergent' };
    });
  }

  /**
   * validateL2Update(existingL2, proposedUpdate, opts) -> {valid, sanitized?|reason}
   *
   * proposedUpdate: forma grezza (snake_case), esattamente un'entry
   * l2_updates del contratto mode:'m2' (R3A): {id, operational_state?,
   * decision_state?, content?, evidence?}.
   *
   * opts.chefAttributedThisTurn: boolean, fornito dal chiamante — questo
   * modulo non decide COME determinarlo, solo che è obbligatorio quando
   * l'update fa transitare l'item VERSO confirmed.
   *
   * Gate (decisione congelata R3C): l'attribuzione dello chef è richiesta
   * SOLO quando existing.decisionState !== 'confirmed' E il decision_state
   * risultante è 'confirmed' — cioè solo sulla TRANSIZIONE verso confirmed.
   * Un item già confirmed resta confirmed anche se si aggiornano altri
   * campi (operational_state/content/evidence/baseline) senza una nuova
   * attribuzione: confirmed è una proprietà persistente valida finché non
   * viene esplicitamente cambiata secondo regole future, non qualcosa da
   * ri-attestare a ogni rivalutazione.
   *
   * Un update che tenta una transizione non autorizzata verso confirmed
   * viene rifiutato PER INTERO (decisione congelata R3C: mai applicare
   * silenziosamente solo operational_state/content/evidence scartando il
   * solo decision_state — un update parziale sarebbe difficile da auditare).
   */
  function validateL2Update(existingL2, proposedUpdate, opts) {
    opts = opts || {};

    if (!existingL2) {
      return { valid: false, reason: 'id sconosciuto: nessun L2 esistente corrisponde a questo id' };
    }
    if (!proposedUpdate || proposedUpdate.id !== existingL2.id) {
      return { valid: false, reason: 'proposedUpdate.id non corrisponde all\'L2 esistente fornito' };
    }
    if (proposedUpdate.operational_state !== undefined && OPERATIONAL_STATES.indexOf(proposedUpdate.operational_state) === -1) {
      return { valid: false, reason: 'operational_state non ammesso: ' + proposedUpdate.operational_state };
    }
    if (proposedUpdate.decision_state !== undefined && DECISION_STATES.indexOf(proposedUpdate.decision_state) === -1) {
      return { valid: false, reason: 'decision_state non ammesso: ' + proposedUpdate.decision_state };
    }

    var resultingOperationalState = proposedUpdate.operational_state !== undefined ? proposedUpdate.operational_state : existingL2.operationalState;
    var resultingDecisionState = proposedUpdate.decision_state !== undefined ? proposedUpdate.decision_state : existingL2.decisionState;

    if (resultingOperationalState === 'unengaged' && resultingDecisionState !== 'none') {
      return { valid: false, reason: 'unengaged richiede decision_state="none" (vincolo PSL)' };
    }

    var transitionsToConfirmed = existingL2.decisionState !== 'confirmed' && resultingDecisionState === 'confirmed';
    if (transitionsToConfirmed && opts.chefAttributedThisTurn !== true) {
      return { valid: false, reason: 'decision_state="confirmed" richiede un segnale chef-attributable esplicito in questo turno (gate epistemico non aggirabile)' };
    }

    var sanitized = {};
    if (proposedUpdate.operational_state !== undefined) sanitized.operationalState = proposedUpdate.operational_state;
    if (proposedUpdate.decision_state !== undefined) sanitized.decisionState = proposedUpdate.decision_state;
    if (proposedUpdate.content !== undefined) sanitized.content = proposedUpdate.content;
    if (proposedUpdate.evidence !== undefined) sanitized.evidence = proposedUpdate.evidence;

    return { valid: true, sanitized: sanitized };
  }

  /**
   * applyL2Updates(l2Items, proposedUpdates, currentBaseline, opts)
   *   -> { items, applied, rejected }
   *
   * Un solo currentBaseline per l'intero batch (stesso principio di
   * runM1(): un compute() per run). Ogni update invalido viene scartato
   * (mai un'eccezione) e riportato in `rejected`, senza toccare l'item
   * corrispondente. Gli item non proposti per update, o proposti ma
   * rifiutati, tornano nell'array risultato con la STESSA reference
   * dell'originale — mai mutati, mai ricreati.
   */
  function applyL2Updates(l2Items, proposedUpdates, currentBaseline, opts) {
    l2Items = l2Items || [];
    proposedUpdates = proposedUpdates || [];

    var byId = {};
    l2Items.forEach(function (item) { byId[item.id] = item; });

    var resultById = {};
    l2Items.forEach(function (item) { resultById[item.id] = item; });

    var applied = [];
    var rejected = [];

    proposedUpdates.forEach(function (proposedUpdate) {
      var existingL2 = proposedUpdate ? byId[proposedUpdate.id] : undefined;
      var result = validateL2Update(existingL2, proposedUpdate, opts);
      if (!result.valid) {
        rejected.push({ id: proposedUpdate && proposedUpdate.id, reason: result.reason });
        return;
      }
      var newItem = Object.assign({}, existingL2, result.sanitized, {
        baselineHash: currentBaseline.baseline_hash,
        baselineContext: currentBaseline.baseline_context,
      });
      resultById[existingL2.id] = newItem;
      applied.push(existingL2.id);
    });

    var items = l2Items.map(function (item) { return resultById[item.id]; });

    return { items: items, applied: applied, rejected: rejected };
  }

  return {
    buildSnapshot: buildSnapshot,
    computeCurrentBaseline: computeCurrentBaseline,
    classifyBaseline: classifyBaseline,
    validateL2Update: validateL2Update,
    applyL2Updates: applyL2Updates,
  };
});
