# 2026-11-01T23:37:11.243Z  esito: ok
# output: 'feat/stati-ricetta-direzione-3\n M api/chat.js\n M demo/direzione-3/finto-supabase.js\n M khub_mvp.html\n M scripts/test-stati-ricetta.js\n M scripts/test-supabase-secret-key.js\n179bf08 Unisci: Schede di origine eliminate solo tramite elimina_scheda_se_vuota\n7e67e01 Direzione 3: finalizzazione grafica (s'
git branch --show-current && git status --short && git add api/chat.js khub_mvp.html demo/direzione-3/finto-supabase.js scripts/test-stati-ricetta.js scripts/test-supabase-secret-key.js && git commit -q -F - <<'EOF'
Unisci: Schede di origine eliminate solo tramite elimina_scheda_se_vuota

- Server: per "Unisci" (delete con soloSeVuota) una sola chiamata
  POST /rest/v1/rpc/elimina_scheda_se_vuota con l'id nel corpo; esiti
  eliminata/assente -> ok, non_vuota e osservazioni_michelinai -> rifiuto.
  Funzione assente (404/PGRST202), errore o rete -> rpc_assente/rpc_errore:
  nessuna DELETE alternativa, la Scheda resta.
- Elimina Scheda invariata (DELETE con cascata, elenco confermato,
  protezioni per mattoncini, Sessioni e osservazioni MichelinAI).
- Client: messaggi chiari per funzione non installata o non riuscita.
- Demo locale: il finto database emula la funzione.
- Test: esiti positivo, Scheda non vuota (anche per una Ricetta tornata
  da un'altra finestra), osservazioni L3, funzione assente, errore e rete;
  test di sicurezza: unica RPC ammessa, solo per Unisci, id solo nel corpo.

La funzione SQL resta una proposta non installata (docs/proposte).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EggKAzYnEJh113Jp9EaWA2
EOF
git log --oneline -3; git status --short | wc -l
