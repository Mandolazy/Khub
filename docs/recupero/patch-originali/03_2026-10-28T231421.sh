# 2026-10-28T23:14:21.412Z  esito: ok
# output: "1437:  // loadFromSupabase(). Resta indipendente da S.recipes/validatedVariants/\n2340:async function loadFromSupabase(){\n2714:    if(esito.codice==='scheda_cambiata'){try{await loadFromSupabase();}catch(e){}}"
python3 - <<'EOF'
p='khub_mvp.html'; s=open(p).read()
old="""      controllo_non_eseguibile:'non è stato possibile verificare le dipendenze: riprova.'
    };"""
new="""      controllo_non_eseguibile:'non è stato possibile verificare le dipendenze: riprova.',
      osservazioni_michelinai:'ha osservazioni di MichelinAI collegate, che non vengono eliminate: per ora non si può eliminare.',
      scheda_cambiata:'la Scheda è cambiata nel frattempo (contiene Ricette diverse da quelle confermate). Ricontrolla e riprova.',
      conferma_mancante:'manca la conferma delle Ricette da eliminare: riprova.'
    };"""
assert old in s; s=s.replace(old,new)
old="""async function deleteRecipe(id){
  const recipe=R(id);
  if(!recipe)return;"""
new="""// Elimina Scheda: le Ricette che la conferma mostra sono le stesse inviate al
// server, che rifiuta se nel database la Scheda ne contiene altre.
function ricetteDellaScheda(recipe){
  return[...new Set((recipe.validatedVariants||[]).concat(recipe.labVersions||[]).map(v=>v.id))];
}
function testoEliminaScheda(recipe){
  const n=ricetteDellaScheda(recipe).length;
  return 'Eliminare la Scheda «'+escAttr(recipe.name)+'»'+(n?' e '+(n===1?'la sua Ricetta':'le sue '+n+' Ricette'):'')+'? L\\'azione è irreversibile.';
}

async function deleteRecipe(id){
  const recipe=R(id);
  if(!recipe)return;"""
assert old in s; s=s.replace(old,new)
old="""  if(!confirm(`Eliminare "${recipe.name}"?`))return;
  const esito=await eliminaSulServer('recipes',id);
  if(!esito.ok){toast('"'+recipe.name+'" non eliminata: '+(esito.codice==='usata_come_mattoncino'||esito.codice==='usata_in_produzione'?'una sua Ricetta '+esito.messaggio:esito.messaggio),'ti-alert-circle');return;}
  S.recipes"""
new="""  // Una sola conferma: quella nella pagina (testoEliminaScheda), che ha portato qui.
  const esito=await eliminaSulServer('recipes',id,{ricetteAttese:ricetteDellaScheda(recipe)});
  if(!esito.ok){
    S.confirmDeleteId=null;
    if(esito.codice==='scheda_cambiata'){try{await loadFromSupabase();}catch(e){}}
    render();
    toast('"'+recipe.name+'" non eliminata: '+(esito.codice==='usata_come_mattoncino'||esito.codice==='usata_in_produzione'?'una sua Ricetta '+esito.messaggio:esito.messaggio),'ti-alert-circle');
    return;
  }
  S.confirmDeleteId=null;
  S.recipes"""
assert old in s; s=s.replace(old,new)
a="""<i class="ti ti-alert-triangle"></i> Sei sicuro? Questa azione è irreversibile.</div>"""
assert s.count(a)==2
s=s.replace(a,"""<i class="ti ti-alert-triangle"></i> ${testoEliminaScheda(recipe)}</div>""")
a="""<div>Eliminare la Scheda «${d3Esc(recipe.name)}» e tutte le sue Ricette? L'azione è irreversibile.</div>"""
assert a in s; s=s.replace(a,"""<div>${testoEliminaScheda(recipe)}</div>""")
open(p,'w').write(s)
EOF
grep -n "loadFromSupabase()" khub_mvp.html | head -3
