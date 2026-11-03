# 2026-11-01T22:39:39.553Z  esito: ok
# output: "323:  await test('P1. grafica attuale invariata: LAB e Scheda classici identici a main quando l\\'anteprima e\\' spenta', async () => {\n342:  await test('P2. motore preservato: LAB, scaling, rese, conversioni, Sessioni, salvataggio e MichelinAI identici a main; cambiano solo le funzioni di presentazio"
python3 - <<'EOF'
p='khub_mvp.html'; s=open(p).read()
old=".d3-ricerca-freccia{color:var(--d3-grigio);font-size:22px;line-height:1;}\n"
assert s.count(old)==1
s=s.replace(old,old+"@media(max-width:600px){.d3-ricerca-riga{padding:12px 14px;gap:12px;}.d3-ricerca-ricetta{padding-left:14px;}}\n")
open(p,'w').write(s)
EOF
grep -n "await test('P" scripts/test-preview-direzione-3.js | cut -c1-200
