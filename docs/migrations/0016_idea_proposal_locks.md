# Migrazione 0016 — Una sola proposta e una sola trasformazione alla volta per Idea

**Stato:** preparata e testata solo su PostgreSQL 16 + PostgREST 12.2.3 locali. **Non applicata.** Richiede la 0013. È indipendente dalla 0015: si possono applicare in qualunque ordine.

| File | Ruolo |
|---|---|
| `supabase/migrations/0016_idea_proposal_locks.sql` | crea `public.idea_proposal_locks` e `public.idea_recipe_claims` |
| `supabase/rollback/PREPARED_NOT_EXECUTED__0016_idea_proposal_locks_rollback.sql` | le elimina |

## Perché serve
`ideaProposal` (blocco 2d) chiama MichelinAI per ricostruire la proposta di Ricetta. Due richieste simultanee per la stessa Idea, per esempio da due schede del browser, producevano due chiamate AI. Con la 0016 il server prenota la generazione: vince una sola richiesta, l'altra riceve `proposta_in_corso`.

Dettagli: `docs/import-engine/P2-a2-blocco2d-correzioni.md` (C1).

## Cosa crea
**Seconda tabella (release candidate): `public.idea_recipe_claims`** con `idea_id` come chiave primaria (riferimento a `ideas`, cancellazione a cascata), `recipe_id`, `variant_id` e `claimed_at`. È la prenotazione della trasformazione di un'Idea in Ricetta, chiesta dalla pagina prima di salvare la Scheda: due dispositivi non creano due Ricette. Ha gli stessi privilegi e lo stesso RLS della prima tabella. Il rollback elimina entrambe le tabelle.

**Prima tabella: `public.idea_proposal_locks`**

| Colonna | Tipo | Note |
|---|---|---|
| `idea_id` | `text` | chiave primaria, `references public.ideas(id) on delete cascade` |
| `started_at` | `timestamptz not null` | inizio della prenotazione; scade dopo 120 s; rilasciata con una data nel passato |

- **Nessun testo dello chef.**
- **Accesso:**
  - RLS attivo senza policy;
  - `anon` e `authenticated` senza privilegi;
  - `service_role` con `SELECT`, `INSERT`, `UPDATE`, senza `DELETE`.
- Additiva e idempotente, in un'unica transazione. Si ferma se la tabella esiste con colonne diverse.

**Senza la 0016** il codice funziona come nel 2d, quindi l'ordine fra codice e migrazione è libero.

## Procedura su KHUB Test (solo dopo autorizzazione)
1. **Sola lettura:**
   ```sql
   select to_regclass('public.idea_proposal_locks');   -- atteso: null
   ```
2. **Esecuzione:** incollare l'intero file `0016_idea_proposal_locks.sql`, una volta.
3. **Verifica, sola lettura:**
   ```sql
   select relrowsecurity from pg_class where oid = 'public.idea_proposal_locks'::regclass;   -- atteso: true
   select grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'idea_proposal_locks' order by 1, 2;   -- solo service_role: INSERT, SELECT, UPDATE
   ```

## Rollback (preparato, non eseguito)
La tabella contiene solo prenotazioni temporanee, quindi eliminarla non cancella contenuti. Il codice continua a funzionare senza: non serve ripristinare il codice prima.

**Rollback della 0013:** con la 0016 applicata va eseguito prima questo rollback (la tabella fa riferimento a `public.ideas`). Lo script di rollback della 0013, preparato e mai eseguito, ora si ferma con un messaggio esplicito («Eseguire prima il rollback 0016»), come già fa per la 0014 (test `test-p2a1-idee.js` B9). La migrazione 0013, già applicata su KHUB Test, non cambia.
