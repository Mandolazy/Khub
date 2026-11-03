# 2026-11-01T22:42:59.141Z  esito: ok
# output: 'feat/stati-ricetta-direzione-3\n M khub_mvp.html\n M scripts/test-fix2d-lab-weights.js\n M scripts/test-preview-direzione-3.js\n M scripts/test-schede-categorie.js\n M scripts/test-start-home.js\n 5 files changed, 282 insertions(+), 53 deletions(-)\n7e67e01 Direzione 3: finalizzazione grafica (solo present'
ps -eo pid,args | awk '/demo\/direzione-3\/server.js 4177/ && !/awk/ {print $1}' | xargs -r kill; cd /home/user/Khub && git branch --show-current && git status --short && git diff --stat | tail -1 && git add khub_mvp.html scripts/test-preview-direzione-3.js scripts/test-fix2d-lab-weights.js scripts/test-schede-categorie.js scripts/test-start-home.js && git commit -q -F - <<'EOF'
Direzione 3: finalizzazione grafica (solo presentazione, anteprima invariata)

- Pulsanti principali nel colore dell'ambiente: LAB verde, Schede ocra,
  Produzione terracotta (contrasto col bianco >= 4.5:1).
- Confronta Ricette: intestazione editoriale al posto di quella viola-indaco.
- Ricerca globale: icone nel codice, stato reale di ogni Ricetta (Attiva,
  Validata, Archiviata); stessi risultati e destinazioni.
- Benvenuto: nessuna emoji, componenti D3, "Ricetta Validata".
- Selettore LAB / Produzione con i colori dei due ambienti; le regole sugli
  stati restano (solo le Attive vanno in Produzione).
- Ricetta in Produzione: "Elimina questa Ricetta" separata dalle azioni di
  produzione, stesso gestore.
- Segnaposto Profilo e MichelinAI con barra laterale e barra in basso;
  conversione "pezzi -> grammi"; sfumatura di scorrimento delle schede LAB.
- Coerenza: criterio "Ultima modifica" in una sola funzione condivisa,
  conteggio Schede della Home come l'archivio.

Grafica classica identica a main (HTML confrontato funzione per funzione).
Test: test-preview-direzione-3 P18-P22; impronta di renderProdRecipe
aggiornata in test-fix2d-lab-weights e test-schede-categorie.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EggKAzYnEJh113Jp9EaWA2
EOF
git log --oneline -2; git status --short | wc -l
