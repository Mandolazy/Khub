/*
 * KhubBaseline — infrastruttura minima per baseline_hash / baseline_context.
 *
 * Sprint 1 (Persistent State Layer): questo modulo NON decide quali campi
 * della Ricetta siano pertinenti per un L2Item — riceve uno snapshot già
 * selezionato dal chiamante (la futura logica MichelinAI), lo serializza in
 * modo deterministico e produce una firma stabile.
 *
 * Non e' usato da nessuna logica cognitiva in questo Sprint: e' solo
 * infrastruttura pronta per gli Sprint successivi.
 *
 * Hash: non crittografico (FNV-1a a 32 bit, eseguito due volte con basi
 * diverse per un output a 64 bit) — sufficiente per rilevare variazioni di
 * stato (reconciliation), non pensato per garanzie di sicurezza. Se in
 * futuro serve una garanzia crittografica, va sostituito con SHA-256.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KhubBaseline = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function sortValue(v) {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce(function (acc, k) {
        acc[k] = sortValue(v[k]);
        return acc;
      }, {});
    }
    return v;
  }

  function stableStringify(value) {
    return JSON.stringify(sortValue(value === undefined ? null : value));
  }

  function fnv1a(str, seed) {
    var hash = seed >>> 0;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function hash64(str) {
    return fnv1a(str, 0x811c9dc5) + fnv1a(str, 0x9e3779b9);
  }

  /**
   * compute(snapshot) -> { baseline_hash, baseline_context }
   * snapshot: qualunque valore JSON-serializzabile scelto dal chiamante.
   */
  function compute(snapshot) {
    var serialized = stableStringify(snapshot);
    return {
      baseline_hash: hash64(serialized),
      baseline_context: snapshot === undefined ? null : snapshot,
    };
  }

  return { compute: compute, stableStringify: stableStringify, hash64: hash64 };
});
