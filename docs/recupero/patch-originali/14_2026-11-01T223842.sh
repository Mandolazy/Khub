# 2026-11-01T22:38:42.227Z  esito: ok
# output: 'ok'
python3 - <<'EOF'
p='khub_mvp.html'; s=open(p).read()
anchor="body.ui-d3 :is(.toast,.toast-action){background:var(--d3-ink);font-family:inherit;}\n"
assert s.count(anchor)==1
css=anchor+r"""/* Finalizzazione — pulsanti principali nel colore dell'ambiente in cui si trovano
   (LAB verde, Schede ocra, Produzione terracotta: contrasto col bianco >= 4.5:1) */
body.ui-d3{--d3-primario:var(--d3-terra);}
body.ui-d3[data-d3-amb="lab"]{--d3-primario:var(--d3-amb-lab);}
body.ui-d3[data-d3-amb="schede"]{--d3-primario:var(--d3-amb-schede);}
body.ui-d3[data-d3-amb="produzione"]{--d3-primario:var(--d3-amb-produzione);}
body.ui-d3 .d3-btn-primary{background:var(--d3-primario);border-color:var(--d3-primario);}
body.ui-d3 .d3-btn-primary:is(:hover,:active){background:var(--d3-primario);border-color:var(--d3-primario);filter:brightness(.88);}
body.ui-d3 .btn-primary:not(.d3-lab *){background:var(--d3-primario);}
/* Selettore LAB / Produzione della Ricetta aperta: colori dei due ambienti */
body.ui-d3 .mode-switcher{background:var(--d3-card);border-color:var(--d3-bordo);}
body.ui-d3 .mode-btn{font-family:inherit;font-size:13px;font-weight:600;color:var(--d3-ink2);min-height:32px;}
body.ui-d3 .mode-btn.lab-active{background:var(--d3-amb-lab);color:#fff;}
body.ui-d3 .mode-btn.prod-active{background:var(--d3-amb-produzione);color:#fff;}
/* Confronta Ricette */
.d3-confronto-testa{display:flex;flex-direction:column;gap:6px;margin-bottom:18px;}
.d3-confronto-sub{font-size:14px;color:var(--d3-ink2);}
body.ui-d3 .confronto-select{background:var(--d3-card);border:1.5px solid var(--d3-bordo);border-radius:8px;font-size:15px;color:var(--d3-ink);min-height:44px;}
body.ui-d3 .confronto-select:focus{border-color:var(--d3-ink);}
body.ui-d3 .confronto-col{background:var(--d3-card);border:1px solid var(--d3-bordo);border-radius:12px;}
body.ui-d3 .confronto-col-header,body.ui-d3 .confronto-col-header:is(.col-a,.col-b){font-family:'Newsreader',Georgia,serif;font-size:19px;font-weight:500;background:var(--d3-bar);color:var(--d3-ink);border-bottom:1px solid var(--d3-bordo);padding:14px 16px;}
body.ui-d3 .confronto-ing-row{font-size:14px;padding:10px 16px;border-bottom-color:var(--d3-bordo);}
body.ui-d3 .confronto-ing-name{color:var(--d3-ink);}
body.ui-d3 .confronto-ing-qty{color:var(--d3-ink2);font-variant-numeric:tabular-nums;}
body.ui-d3 .confronto-ing-pct{color:var(--d3-grigio);font-size:12px;font-variant-numeric:tabular-nums;}
body.ui-d3 .confronto-ing-row.diff{background:var(--d3-amb-schede-tinta);}
body.ui-d3 .confronto-ing-row.diff .confronto-ing-qty{color:var(--d3-amb-schede);}
body.ui-d3 .confronto-legend{font-size:13px;color:var(--d3-ink2);}
body.ui-d3 .confronto-legend-dot{background:var(--d3-amb-schede-tinta);border-color:var(--d3-amb-schede);}
body.ui-d3 .confronto-empty{color:var(--d3-ink2);font-size:14px;}
/* Ricerca globale */
.d3-ricerca-lista{padding:0;overflow:hidden;}
.d3-ricerca-riga{display:flex;align-items:center;gap:14px;width:100%;background:none;border:none;border-bottom:1px solid var(--d3-bordo);padding:14px 18px;min-height:60px;text-align:left;font:inherit;color:var(--d3-ink);cursor:pointer;}
.d3-ricerca-riga:last-child{border-bottom:none;}
.d3-ricerca-riga:hover{background:var(--d3-sabbia);}
.d3-ricerca-ricetta{padding-left:68px;}
.d3-ric-icona{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--amb-tinta);color:var(--amb);flex-shrink:0;}
.d3-ric-icona svg{width:20px;height:20px;}
.d3-ricerca-testo{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;}
.d3-ricerca-titolo{font-family:'Newsreader',Georgia,serif;font-size:19px;line-height:1.2;}
.d3-ricerca-meta{font-size:13px;color:var(--d3-ink2);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.d3-ricerca-freccia{color:var(--d3-grigio);font-size:22px;line-height:1;}
/* Benvenuto */
body.ui-d3 .onboarding-modal.d3-benvenuto{background:var(--d3-card);border:1px solid var(--d3-bordo);border-radius:14px;padding:28px;max-width:420px;font-family:inherit;}
.d3-benvenuto-titolo{font-size:32px;font-weight:500;line-height:1.15;color:var(--d3-ink);text-align:center;margin:0;}
.d3-benvenuto-sub{text-align:center;color:var(--d3-ink2);font-size:14px;margin:6px 0 20px;}
.d3-benvenuto-passo{display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--d3-bordo);}
.d3-benvenuto-passo strong{display:block;font-size:15px;color:var(--amb);margin-bottom:2px;}
.d3-benvenuto-passo>span:last-child>span{display:block;font-size:14px;line-height:1.4;color:var(--d3-ink2);}
.d3-benvenuto-icona{width:40px;height:40px;border-radius:10px;background:var(--amb-tinta);color:var(--amb);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.d3-benvenuto-icona svg{width:22px;height:22px;}
.d3-benvenuto-inizia{width:100%;margin-top:16px;min-height:48px;font-size:16px;}
/* Ricetta in Produzione: l'eliminazione della Ricetta e' separata dalle azioni di produzione */
.d3-prod-gestione{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;margin-top:16px;padding-top:10px;border-top:1px solid var(--d3-bordo);font-size:12px;color:var(--d3-ink2);}
.d3-testo-pericolo{color:#9B2C1F;font-size:13px;}
/* Segnaposto Profilo e MichelinAI */
body.ui-d3 .d3-segnaposto{background:var(--d3-card);border:1px solid var(--d3-bordo);border-radius:12px;}
body.ui-d3 .d3-segnaposto>div:first-of-type{font-family:'Newsreader',Georgia,serif;font-size:30px !important;font-weight:500 !important;color:var(--d3-ink) !important;}
body.ui-d3 .d3-segnaposto>div:last-of-type{font-size:14px !important;color:var(--d3-ink2) !important;}
/* Schede del LAB scorrevoli: sfumatura sul lato dove c'e' altro contenuto */
.d3-scorre-dx{-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 40px),transparent);}
.d3-scorre-sx{-webkit-mask-image:linear-gradient(to right,transparent,#000 40px);mask-image:linear-gradient(to right,transparent,#000 40px);}
.d3-scorre-sx.d3-scorre-dx{-webkit-mask-image:linear-gradient(to right,transparent,#000 40px,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(to right,transparent,#000 40px,#000 calc(100% - 40px),transparent);}
"""
s=s.replace(anchor,css); open(p,'w').write(s); print('ok')
EOF
