# 2026-10-29T09:37:29.421Z  esito: ok
# output: 'feat/stati-ricetta-direzione-3\n607a27f Proposta SQL elimina_scheda_se_vuota: transazione unica e verifiche (non eseguita)'
git branch --show-current && git add docs/proposte/elimina_scheda_se_vuota.sql && git commit -q -F - <<'EOF'
Proposta SQL elimina_scheda_se_vuota: transazione unica e verifiche (non eseguita)

- Installazione in BEGIN/COMMIT: creazione, REVOKE/GRANT, verifica finale
  dei permessi e notifica PostgREST; ROLLBACK se una verifica fallisce.
- CREATE (non OR REPLACE): interruzione se la funzione esiste gia'.
- Verifiche preliminari: tipi text, FK verso recipes senza cascate inattese,
  nessun trigger ON DELETE su recipes, ruolo service_role presente.
- Funzione VOLATILE, solo READ COMMITTED, lock_timeout 5s.
- Vincoli e dati invariati; nessuna esecuzione su Supabase.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EggKAzYnEJh113Jp9EaWA2
EOF
git log --oneline -1; git status --short
