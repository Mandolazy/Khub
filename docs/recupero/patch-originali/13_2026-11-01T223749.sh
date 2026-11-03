# 2026-11-01T22:37:49.053Z  esito: ok
# output: 'ok'
python3 - <<'EOF'
p='khub_mvp.html'; s=open(p).read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count, (s.count(old), old[:80])
    s=s.replace(old,new)
# Destinazione di un risultato di ricerca: una sola per le due grafiche.
rep("""      ${results.map(r=>{
        var onclick=r.type==="family"
          ? `S.selectedFamily='${r.id}';S.homeTab='prod';S.showSearch=false;S.searchQuery='';S.view='home';render()`
          : r.type==="variant"
            ? `S.selectedId='${r.id}';S.selectedVariantId='${r.variantId}';S.mode='produzione';S.view='recipe';S.showSearch=false;S.searchQuery='';render()`
            : `S.selectedId='${r.id}';S.view='ricetta-madre-v2';S.showSearch=false;S.searchQuery='';render()`;
        return""","""      ${results.map(r=>{
        var onclick=searchResultOnclick(r);
        return""")
rep("""function renderSearch(query){""","""// Destinazione di un risultato della ricerca globale (grafica classica e Direzione 3).
function searchResultOnclick(r){
  return r.type==="family"
    ? `S.selectedFamily='${r.id}';S.homeTab='prod';S.showSearch=false;S.searchQuery='';S.view='home';render()`
    : r.type==="variant"
      ? `S.selectedId='${r.id}';S.selectedVariantId='${r.variantId}';S.mode='produzione';S.view='recipe';S.showSearch=false;S.searchQuery='';render()`
      : `S.selectedId='${r.id}';S.view='ricetta-madre-v2';S.showSearch=false;S.searchQuery='';render()`;
}
function renderSearch(query){""")

nuove = r"""function d3Previsto(){return'<span class="d3-previsto">Previsto</span>';}
// Stato effettivo di una Ricetta validata (stessi campi della Scheda).
function d3StatoRicetta(v){
  if(v.status==='retired')return'archiviata';
  if(v.status==='lab')return'lab';
  return v.active===true?'attiva':'validata';
}
// Ricerca globale: stessi risultati e destinazioni della grafica classica
// (renderSearch), con icone nel codice e lo stato reale di ogni Ricetta.
var D3_ICONA_FAMIGLIA='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/></svg>';
function renderRicercaD3(query,results){
  var q=d3Esc(query);
  if(!results.length)return`<div class="d3-wrap d3-ricerca"><div class="d3-card d3-vuoto">Nessun risultato per «<strong>${q}</strong>».</div></div>`;
  var riga=function(r){
    var icona,titolo,meta;
    if(r.type==='family'){icona=`<span class="d3-ric-icona d3-amb-schede" aria-hidden="true">${D3_ICONA_FAMIGLIA}</span>`;titolo=d3Esc(r.name);meta='Famiglia';}
    else if(r.type==='variant'){icona='';titolo=d3Esc(r.variante.name);meta=`${d3Pill(d3StatoRicetta(r.variante))} <span>Scheda · ${d3Esc(r.name)}</span>`;}
    else{icona=`<span class="d3-ric-icona d3-amb-schede" aria-hidden="true">${D3_ICONE_AMBIENTE['ti-book-2']}</span>`;titolo=d3Esc(r.name);meta='Scheda'+(r.meta?' · '+d3Esc(r.meta):'');}
    return`<button class="d3-ricerca-riga${r.type==='variant'?' d3-ricerca-ricetta':''}" onclick="${searchResultOnclick(r)}">${icona}<span class="d3-ricerca-testo"><span class="d3-ricerca-titolo">${titolo}</span><span class="d3-ricerca-meta">${meta}</span></span><span class="d3-ricerca-freccia" aria-hidden="true">›</span></button>`;
  };
  return`<div class="d3-wrap d3-ricerca">
    <div class="d3-sez-titolo">Risultati per «${q}» <span>${results.length}</span></div>
    <div class="d3-card d3-ricerca-lista">${results.map(riga).join('')}</div>
  </div>`;
}
// Benvenuto: stesse azioni del classico; terminologia attuale, nessuna emoji.
function renderOnboardingD3(){
  var passi=[['lab','ti-flask','LAB','Sperimenta e modifica le tue ricette in libertà.'],
    ['schede','ti-book-2','Valida','Quando una bozza funziona, salvala come Ricetta Validata nella sua Scheda.'],
    ['produzione','ti-tools-kitchen-2','Produzione','Usa la Ricetta attiva in cucina, scala le porzioni.']];
  return`<div class="onboarding-overlay">
    <div class="onboarding-modal d3-benvenuto" role="dialog" aria-labelledby="d3-benvenuto-titolo">
      <h2 class="d3-serif d3-benvenuto-titolo" id="d3-benvenuto-titolo">Benvenuto in Khub</h2>
      <p class="d3-benvenuto-sub">Il tuo laboratorio digitale per ricette professionali</p>
      ${passi.map(function(p){return`<div class="d3-benvenuto-passo d3-amb-${p[0]}"><span class="d3-benvenuto-icona" aria-hidden="true">${D3_ICONE_AMBIENTE[p[1]]}</span><span><strong>${p[2]}</strong><span>${p[3]}</span></span></div>`;}).join('')}
      <button class="d3-btn d3-btn-ink d3-benvenuto-inizia" onclick="S.showOnboarding=false;localStorage.setItem('khub_onboarded','1');S.view='app-home';render()">Inizia</button>
    </div>
  </div>`;
}
// Nomi leggibili delle unità nei testi della Direzione 3 (le unità salvate non cambiano).
function d3NomeUnita(u){
  return{n:'pezzi',g:'grammi',kg:'chilogrammi',ml:'millilitri',cl:'centilitri',l:'litri',tbsp:'cucchiai',tsp:'cucchiaini'}[u]||u;
}
// Schede del LAB su mobile: una sfumatura discreta indica che si può scorrere.
function d3AggiornaScorrimento(){
  document.querySelectorAll('.d3-secnav,.d3-bozze').forEach(function(el){
    var resto=el.scrollWidth-el.clientWidth-el.scrollLeft;
    el.classList.toggle('d3-scorre-dx',resto>4);
    el.classList.toggle('d3-scorre-sx',el.scrollLeft>4);
  });
}
"""
rep("""function d3Previsto(){return'<span class="d3-previsto">Previsto</span>';}
""",nuove)
rep("""    // Tastiera su mobile: mentre si scrive, le barre fisse in basso si nascondono.""","""    // Schede del LAB: l'indicatore di scorrimento segue la posizione.
    document.addEventListener('scroll',function(e){var t=e.target;if(t&&t.classList&&(t.classList.contains('d3-secnav')||t.classList.contains('d3-bozze')))d3AggiornaScorrimento();},true);
    window.addEventListener('resize',function(){if(S.uiD3)d3AggiornaScorrimento();});
    // Tastiera su mobile: mentre si scrive, le barre fisse in basso si nascondono.""")
open(p,'w').write(s); print('ok')
EOF
