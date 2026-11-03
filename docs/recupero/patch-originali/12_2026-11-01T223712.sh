# 2026-11-01T22:37:12.101Z  esito: ok
# output: 'ok'
python3 - <<'EOF'
p='khub_mvp.html'; s=open(p).read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count, (s.count(old), old[:80])
    s=s.replace(old,new)
rep("""  document.body.classList.toggle('ui-d3',!!S.uiD3); // Anteprima Direzione 3
""","""  document.body.classList.toggle('ui-d3',!!S.uiD3); // Anteprima Direzione 3
  // Direzione 3: i pulsanti principali prendono il colore dell'ambiente (solo CSS).
  if(S.uiD3)document.body.setAttribute('data-d3-amb',d3SezioneNav());else document.body.removeAttribute('data-d3-amb');
""")
rep("""    // Direzione 3: stessa barra laterale su tutte le schermate (tranne le due
    // schermate segnaposto, scollegate dalla navigazione).
    const hideSidebar=S.uiD3?(S.view==='profilo'||S.view==='michelinai-globale'):""","""    // Direzione 3: stessa barra laterale su tutte le schermate, segnaposto
    // Profilo e MichelinAI compresi (si torna agli ambienti principali).
    const hideSidebar=S.uiD3?false:""")
rep("""  if(S.uiD3){d3Autosize();d3NascondiDuplicati();}""","""  if(S.uiD3){d3Autosize();d3NascondiDuplicati();d3AggiornaScorrimento();}""")
rep("""  return `
  <div class="confronto-header">
    <button onclick="S.view='ricetta-madre-v2';render()\"""","""  const intestazione=S.uiD3
    ?`<div class="d3-confronto-testa">
    <div class="d3-crumb"><button onclick="S.view='home';render()">Schede</button> › <button onclick="S.view='ricetta-madre-v2';render()">${d3Esc(recipe.name)}</button></div>
    <h1 class="d3-h1 d3-serif">Confronta Ricette</h1>
    <div class="d3-confronto-sub">${varianti.length} Ricett${varianti.length===1?'a':'e'} della Scheda · ★ = Attiva</div>
  </div>`:null;
  return `
  ${intestazione||`<div class="confronto-header">
    <button onclick="S.view='ricetta-madre-v2';render()\"""")
rep("""    <div class="confronto-sub">${varianti.length} Ricett${varianti.length===1?'a attiva':'e attive'} disponibili</div>
  </div>
""","""    <div class="confronto-sub">${varianti.length} Ricett${varianti.length===1?'a attiva':'e attive'} disponibili</div>
  </div>`}
""")
rep("""        results.push({type:"variant",name:r.name,meta:"Ricetta attiva: "+vv.name,id:r.id,variantId:vv.id,emoji:catEmoji(r.category)});""","""        results.push({type:"variant",name:r.name,meta:"Ricetta attiva: "+vv.name,id:r.id,variantId:vv.id,emoji:catEmoji(r.category),variante:vv});""")
rep("""  if(results.length===0)return `<div class="card" style="text-align:center;padding:32px;color:var(--mid)"><i class="ti ti-search\"""","""  if(S.uiD3)return renderRicercaD3(query,results);
  if(results.length===0)return `<div class="card" style="text-align:center;padding:32px;color:var(--mid)"><i class="ti ti-search\"""")
rep("""function renderOnboarding(){
  return `""","""function renderOnboarding(){
  if(S.uiD3)return renderOnboardingD3();
  return `""")
rep("""      <button class="btn btn-ghost-danger btn-sm" style="margin-left:auto" onclick="deleteVariant('${recipe.id}','${vv.id}')" title="Elimina Ricetta"><i class="ti ti-trash"></i> Elimina</button>
    </div>
    ${renderAzioniLabRicetta(recipe,vv)}
  </div>""","""      ${S.uiD3?'':`<button class="btn btn-ghost-danger btn-sm" style="margin-left:auto" onclick="deleteVariant('${recipe.id}','${vv.id}')" title="Elimina Ricetta"><i class="ti ti-trash"></i> Elimina</button>`}
    </div>
    ${renderAzioniLabRicetta(recipe,vv)}
    ${S.uiD3?`<div class="d3-prod-gestione"><span>Gestione della Ricetta · non riguarda le Sessioni di Produzione</span><button class="d3-btn-text d3-testo-pericolo" onclick="deleteVariant('${recipe.id}','${vv.id}')" title="Elimina questa Ricetta dalla Scheda: le Sessioni di Produzione non vengono toccate">Elimina questa Ricetta</button></div>`:''}
  </div>""")
rep("""      <div style="font-size:13px;color:var(--mid);margin-bottom:6px">Da ${escAttr(p.fromUnit)} a ${escAttr(p.toUnit)}: serve un dato di questo ingrediente.</div>""","""      <div style="font-size:13px;color:var(--mid);margin-bottom:6px">${S.uiD3?`Da ${escAttr(d3NomeUnita(p.fromUnit))} → ${escAttr(d3NomeUnita(p.toUnit))}`:`Da ${escAttr(p.fromUnit)} a ${escAttr(p.toUnit)}`}: serve un dato di questo ingrediente.</div>""")
rep("""    <div class="card" style="text-align:center;padding:48px 24px">
      <i class="ti ti-user\"""","""    <div class="card${S.uiD3?' d3-segnaposto':''}" style="text-align:center;padding:48px 24px">
      <i class="ti ti-user\"""")
rep("""    <div class="card" style="text-align:center;padding:48px 24px">
      <i class="ti ti-chef-hat\"""","""    <div class="card${S.uiD3?' d3-segnaposto':''}" style="text-align:center;padding:48px 24px">
      <i class="ti ti-chef-hat\"""")
rep("""function renderLabGlobale(){
  const mainRecipes=S.recipes.filter(r=>!r.parentRecipeId);
  const tutteLeBozze=[];
  mainRecipes.forEach(r=>{
    (r.labVersions||[]).forEach(v=>{
      tutteLeBozze.push({recipeId:r.id,recipeName:r.name,bozza:v});
    });
  });

  tutteLeBozze.sort((a,b)=>{
    const ta=a.bozza.contenutoModificatoIl,tb=b.bozza.contenutoModificatoIl;
    if(ta&&tb)return new Date(tb)-new Date(ta); // più recente prima
    if(ta&&!tb)return -1; // chi ha un dato tracciato viene sempre prima di chi non ce l'ha
    if(!ta&&tb)return 1;
    return 0; // entrambe senza dato: nessun criterio inventato, ordine stabile
  });
""","""// Bozze di tutte le Schede principali e criterio «Ultima modifica»: unici per
// l'elenco LAB classico e per quello della Direzione 3.
function tutteLeBozzeLab(){
  const bozze=[];
  S.recipes.filter(r=>!r.parentRecipeId).forEach(r=>{
    (r.labVersions||[]).forEach(v=>{
      bozze.push({recipeId:r.id,recipeName:r.name,bozza:v});
    });
  });
  return bozze;
}
function confrontaUltimaModificaBozze(a,b){
  const ta=a.bozza.contenutoModificatoIl,tb=b.bozza.contenutoModificatoIl;
  if(ta&&tb)return new Date(tb)-new Date(ta); // più recente prima
  if(ta&&!tb)return -1; // chi ha un dato tracciato viene sempre prima di chi non ce l'ha
  if(!ta&&tb)return 1;
  return 0; // entrambe senza dato: nessun criterio inventato, ordine stabile
}

function renderLabGlobale(){
  const tutteLeBozze=tutteLeBozzeLab();
  tutteLeBozze.sort(confrontaUltimaModificaBozze);
""")
rep("""  var bozze=[];
  S.recipes.filter(function(r){return!r.parentRecipeId;}).forEach(function(r){
    (r.labVersions||[]).forEach(function(v){bozze.push({recipeId:r.id,recipeName:r.name,bozza:v});});
  });
  var nome=function(b){return b.label||b.name||'Bozza';};""","""  var bozze=tutteLeBozzeLab();
  var nome=function(b){return b.label||b.name||'Bozza';};""")
rep("""  }else{
    bozze.sort(function(a,b){
      var ta=a.bozza.contenutoModificatoIl,tb=b.bozza.contenutoModificatoIl;
      if(ta&&tb)return new Date(tb)-new Date(ta);
      if(ta&&!tb)return -1;
      if(!ta&&tb)return 1;
      return 0;
    });
  }""","""  }else{
    bozze.sort(confrontaUltimaModificaBozze);
  }""")
rep("""  return{attive:activeRecipeEntries(S.recipes).length,schede:S.recipes.length,bozze:bozze,schedeLab:schedeLab};""","""  return{attive:activeRecipeEntries(S.recipes).length,schede:principali.length,bozze:bozze,schedeLab:schedeLab}; // come l'archivio Schede""")
open(p,'w').write(s); print('ok')
EOF
