# 2026-10-28T22:28:20.332Z  esito: ok
# output: 'fb90da0 Ciclo di vita Ricette: unione sicura, eliminazioni protette, esiti verificati'
git add api/chat.js khub_mvp.html scripts/test-preview-direzione-3.js scripts/test-stati-ricetta.js scripts/test-supabase-secret-key.js && git commit -q -F - <<'EOF'
Ciclo di vita Ricette: unione sicura, eliminazioni protette, esiti verificati

- Unisci: rimossa la regola scheda_diversa (il trasferimento di Scheda e' lecito;
  stato, attivazione e formulazione restano controllati). Le Schede assorbite
  vengono eliminate solo dopo il salvataggio riuscito della Scheda superstite e
  solo se il server le trova vuote (soloSeVuota); in caso di errore nulla viene
  eliminato e i dati vengono ricaricati.
- Eliminazione lato server: rifiutate Ricette usate come mattoncino o in
  Produzione (anche Sessioni storiche e snapshot) e Schede che le contengono;
  le bozze mai usate restano eliminabili.
- L'API restituisce ok:false con un codice quando il controllo o il database
  rifiutano; il client aggiorna l'interfaccia solo dopo un esito positivo.
- Test mirati: eliminazioni protette, errori API, unione di Validate, Attive e
  bozze, regressioni su archiviazione, riapertura in LAB e Sessioni storiche.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EggKAzYnEJh113Jp9EaWA2
EOF
git log --oneline -1 && git status --short | head
