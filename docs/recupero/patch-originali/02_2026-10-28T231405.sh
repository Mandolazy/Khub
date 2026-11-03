# 2026-10-28T23:14:05.642Z  esito: ok
# output: '(Bash completed with no output)'
python3 - <<'EOF'
p='api/chat.js'; s=open(p).read()
old="""    // con soloSeVuota (Unisci) solo se non contiene piu' alcuna Ricetta.
    async function eliminazioneProblema(table, id, soloSeVuota) {
      let ids = [id];
      if (table === 'recipes') {
        const vr = await fetch(SB + '/rest/v1/variants?recipe_id=eq.' + encodeURIComponent(id) + '&select=id', { headers: SH_READ });
        if (!vr.ok) throw new Error('lettura delle Ricette della Scheda non riuscita');
        ids = (await vr.json()).map(v => v.id).filter(isValidId);
        if (soloSeVuota && ids.length) return { code: 'scheda_non_vuota', msg: 'la Scheda contiene ancora ' + ids.length + ' Ricett' + (ids.length === 1 ? 'a' : 'e') + ': non viene eliminata' };
        if (!ids.length) return null;
      }
"""
new="""    // con soloSeVuota (Unisci) solo se non contiene piu' alcuna Ricetta.
    // Elimina Scheda: la cascata cancella solo Ricette confermate dall'utente
    // (ricetteAttese); se nel database ce n'e' una in piu', nulla si elimina.
    // Le osservazioni di MichelinAI (L2/L3) non si cancellano mai da qui.
    async function eliminazioneProblema(table, id, soloSeVuota, ricetteAttese) {
      let ids = [id];
      if (table === 'recipes') {
        const vr = await fetch(SB + '/rest/v1/variants?recipe_id=eq.' + encodeURIComponent(id) + '&select=id', { headers: SH_READ });
        if (!vr.ok) throw new Error('lettura delle Ricette della Scheda non riuscita');
        ids = (await vr.json()).map(v => v.id).filter(isValidId);
        if (soloSeVuota && ids.length) return { code: 'scheda_non_vuota', msg: 'la Scheda contiene ancora ' + ids.length + ' Ricett' + (ids.length === 1 ? 'a' : 'e') + ': non viene eliminata' };
        if (!soloSeVuota) {
          if (!Array.isArray(ricetteAttese)) return { code: 'conferma_mancante', msg: 'manca l\\'elenco delle Ricette confermate: nessuna eliminazione' };
          const nonConfermate = ids.filter(v => !ricetteAttese.includes(v));
          if (nonConfermate.length) return { code: 'scheda_cambiata', msg: 'la Scheda contiene Ricette diverse da quelle confermate: nessuna eliminazione' };
        }
        const l3 = await fetch(SB + '/rest/v1/l3_items?recipe_id=eq.' + encodeURIComponent(id) + '&select=id&limit=1', { headers: SH_READ });
        if (!l3.ok) throw new Error('verifica delle osservazioni MichelinAI non riuscita');
        if ((await l3.json()).length) return { code: 'osservazioni_michelinai', msg: 'la Scheda ha osservazioni di MichelinAI collegate: non viene eliminata' };
        if (!ids.length) return null;
      }
"""
assert old in s; s=s.replace(old,new)
old2="""      if (usata) return { code: 'usata_in_produzione', msg: (table === 'recipes' ? 'una Ricetta di questa Scheda e\\' stata usata' : 'la Ricetta e\\' stata usata') + ' in Produzione: si puo\\' archiviare, non eliminare' };
      return null;"""
new2="""      if (usata) return { code: 'usata_in_produzione', msg: (table === 'recipes' ? 'una Ricetta di questa Scheda e\\' stata usata' : 'la Ricetta e\\' stata usata') + ' in Produzione: si puo\\' archiviare, non eliminare' };
      const l2 = await fetch(SB + '/rest/v1/l2_items?variant_id=in.' + listaIn(ids) + '&select=id&limit=1', { headers: SH_READ });
      if (!l2.ok) throw new Error('verifica delle osservazioni MichelinAI non riuscita');
      if ((await l2.json()).length) return { code: 'osservazioni_michelinai', msg: (table === 'recipes' ? 'una Ricetta di questa Scheda ha' : 'la Ricetta ha') + ' osservazioni di MichelinAI collegate: non viene eliminata' };
      return null;"""
assert old2 in s; s=s.replace(old2,new2)
old3="problema = await eliminazioneProblema(table, body.id, body.soloSeVuota === true); }"
new3="problema = await eliminazioneProblema(table, body.id, body.soloSeVuota === true, body.ricetteAttese); }"
assert old3 in s; s=s.replace(old3,new3)
open(p,'w').write(s)
EOF
