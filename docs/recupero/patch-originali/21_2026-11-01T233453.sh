# 2026-11-01T23:34:53.442Z  esito: ok
# output: "      return null;\n    }\n\n    // Eliminazione di Ricette e Schede: mai una Ricetta usata come mattoncino da\n    // un'altra Ricetta o collegata a una Sessione di Produzione (come origine o\n    // come mattoncino nello snapshot, anche storica): si archivia, non si\n    // elimina. Una Scheda si elimin"
sed -n 604,612p api/chat.js && python3 - <<'EOF'
p='api/chat.js'; s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1,(s.count(old),old[:80]); s=s.replace(old,new)
# eliminazioneProblema: il caso soloSeVuota passa ora dalla funzione transazionale
rep("""    // con soloSeVuota (Unisci) solo se non contiene piu' alcuna Ricetta.
""","""    // Unisci (soloSeVuota) non passa da qui: vedi eliminaSchedaSeVuota.
""")
rep("""    async function eliminazioneProblema(table, id, soloSeVuota, ricetteAttese) {""","""    async function eliminazioneProblema(table, id, ricetteAttese) {""")
rep("""        if (soloSeVuota && ids.length) return { code: 'scheda_non_vuota', msg: 'la Scheda contiene ancora ' + ids.length + ' Ricett' + (ids.length === 1 ? 'a' : 'e') + ': non viene eliminata' };
        if (!soloSeVuota) {
          if (!Array.isArray(ricetteAttese)) return { code: 'conferma_mancante', msg: 'manca l\\'elenco delle Ricette confermate: nessuna eliminazione' };
          const nonConfermate = ids.filter(v => !ricetteAttese.includes(v));
          if (nonConfermate.length) return { code: 'scheda_cambiata', msg: 'la Scheda contiene Ricette diverse da quelle confermate: nessuna eliminazione' };
        }
""","""        if (!Array.isArray(ricetteAttese)) return { code: 'conferma_mancante', msg: 'manca l\\'elenco delle Ricette confermate: nessuna eliminazione' };
        const nonConfermate = ids.filter(v => !ricetteAttese.includes(v));
        if (nonConfermate.length) return { code: 'scheda_cambiata', msg: 'la Scheda contiene Ricette diverse da quelle confermate: nessuna eliminazione' };
""")
rep("""    // Sessioni: una Sessione si crea una sola volta""","""    // Unisci: la Scheda di origine si elimina solo se e' vuota, con controllo
    // ed eliminazione in un'unica transazione nel database (funzione
    // elimina_scheda_se_vuota, docs/proposte/elimina_scheda_se_vuota.sql):
    // nessuna Ricetta puo' finire nella cascata di variants.recipe_id.
    // Mai una DELETE alternativa: se la funzione manca, sbaglia o non
    // risponde, la Scheda resta e l'esito lo dice.
    async function eliminaSchedaSeVuota(id) {
      let r;
      try {
        r = await fetch(SB + '/rest/v1/rpc/elimina_scheda_se_vuota', { method: 'POST', headers: SH_READ, body: JSON.stringify({ p_recipe_id: id }) });
      } catch (e) {
        return { code: 'rpc_errore', msg: 'eliminazione sicura non raggiungibile: la Scheda e\\' conservata' };
      }
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        console.error('Supabase error [rpc elimina_scheda_se_vuota]:', r.status, detail);
        if (r.status === 404 || /PGRST202/.test(detail)) return { code: 'rpc_assente', msg: 'funzione elimina_scheda_se_vuota non installata: la Scheda e\\' conservata' };
        return { code: 'rpc_errore', msg: 'eliminazione sicura non riuscita: la Scheda e\\' conservata' };
      }
      const esito = await r.json().catch(() => null);
      if (esito === 'eliminata') return { ok: true, deleted: 1 };
      if (esito === 'assente') return { ok: true, deleted: 0 };
      if (esito === 'non_vuota') return { code: 'scheda_non_vuota', msg: 'la Scheda contiene ancora delle Ricette: non viene eliminata' };
      if (esito === 'osservazioni_michelinai') return { code: 'osservazioni_michelinai', msg: 'la Scheda ha osservazioni di MichelinAI collegate: non viene eliminata' };
      console.error('Risposta inattesa da elimina_scheda_se_vuota:', JSON.stringify(esito).slice(0, 100));
      return { code: 'rpc_errore', msg: 'risposta inattesa dall\\'eliminazione sicura: la Scheda e\\' conservata' };
    }

    // Sessioni: una Sessione si crea una sola volta""")
rep("""      if (table === 'variants' || table === 'recipes') {
        let problema;
        try { problema = await eliminazioneProblema(table, body.id, body.soloSeVuota === true, body.ricetteAttese); }""","""      if (table === 'recipes' && body.soloSeVuota === true) {
        const esito = await eliminaSchedaSeVuota(body.id);
        if (esito.ok) return res.status(200).json({ ok: true, deleted: esito.deleted });
        console.error('Eliminazione rifiutata:', table, body.id, esito.code);
        return res.status(200).json({ ok: false, code: esito.code, error: esito.msg });
      }
      if (table === 'variants' || table === 'recipes') {
        let problema;
        try { problema = await eliminazioneProblema(table, body.id, body.ricetteAttese); }""")
open(p,'w').write(s)
p='khub_mvp.html'; s=open(p).read()
rep("""      conferma_mancante:'manca la conferma delle Ricette da eliminare: riprova.'
    };""","""      conferma_mancante:'manca la conferma delle Ricette da eliminare: riprova.',
      rpc_assente:'l\\'eliminazione sicura non è ancora installata nel database: la Scheda è stata conservata.',
      rpc_errore:'l\\'eliminazione sicura non è riuscita: la Scheda è stata conservata. Riprova più tardi.'
    };""")
rep("""  const nonEliminate=[];
  for(const id of absorbedIds){
    const esito=await eliminaSulServer('recipes',id,{soloSeVuota:true});
    if(!esito.ok)nonEliminate.push(id);
  }""","""  const nonEliminate=[];let motivo='';
  for(const id of absorbedIds){
    const esito=await eliminaSulServer('recipes',id,{soloSeVuota:true});
    if(!esito.ok){nonEliminate.push(id);motivo=motivo||esito.messaggio;}
  }""")
rep("""  if(nonEliminate.length)toast('Ricette trasferite in "'+updatedSurvivor.name+'". '+nonEliminate.length+' Scheda/e di origine non eliminata/e: risulta ancora collegata ad altri dati.','ti-alert-circle');""","""  if(nonEliminate.length)toast('Ricette trasferite in "'+updatedSurvivor.name+'". '+nonEliminate.length+' Scheda/e di origine non eliminata/e: '+motivo,'ti-alert-circle');""")
open(p,'w').write(s); print('ok')
EOF
