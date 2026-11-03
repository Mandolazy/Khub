# 2026-10-28T23:18:02.615Z  esito: ok
# output: 'd455725 Elimina Scheda: conferma unica con numero di Ricette e elenco verificato dal server\nfb90da0 Ciclo di vita Ricette: unione sicura, eliminazioni protette, esiti verificati'
git add api/chat.js khub_mvp.html scripts/test-stati-ricetta.js scripts/test-supabase-secret-key.js docs/proposte/elimina_scheda_se_vuota.sql && git commit -q -F - <<'EOF'
Elimina Scheda: conferma unica con numero di Ricette e elenco verificato dal server

- Una sola conferma (nella pagina) con nome della Scheda e numero di Ricette;
  il client invia al server l'elenco confermato (ricetteAttese) e il server
  rifiuta senza eliminare nulla se nel database la Scheda contiene Ricette non
  confermate (scheda_cambiata) o se l'elenco manca (conferma_mancante).
- ON DELETE CASCADE invariato per l'eliminazione voluta; restano le
  protezioni per mattoncini esterni e Sessioni anche storiche; i mattoncini
  interni alla Scheda non bloccano.
- Osservazioni MichelinAI (L2/L3): mai cancellate; se presenti l'eliminazione
  e' rifiutata con un messaggio comprensibile (osservazioni_michelinai).
- Eliminazione fallita: nessun aggiornamento ingannevole, conferma chiusa,
  dati ricaricati se la Scheda e' cambiata.
- Proposta SQL non eseguita: docs/proposte/elimina_scheda_se_vuota.sql.
- Test: mattoncino interno, origin_variant_id, L2/L3, elenco cambiato,
  fallimenti di rete, database e controllo.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EggKAzYnEJh113Jp9EaWA2
EOF
git log --oneline -2; git status --short
