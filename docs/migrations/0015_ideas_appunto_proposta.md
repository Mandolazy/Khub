# Migrazione 0015 — Proposta di Ricetta anche per le Idee «appunto»

**Stato:** preparata e testata solo su PostgreSQL 16 + PostgREST 12.2.3 locali. **Non applicata.** Richiede la 0013. **La 0013 non viene modificata**: è già eseguita su KHUB Test.

| File | Ruolo |
|---|---|
| `supabase/migrations/0015_ideas_appunto_proposta.sql` | sostituisce il solo vincolo `ideas_appunto_chk` |
| `supabase/rollback/PREPARED_NOT_EXECUTED__0015_ideas_appunto_proposta_rollback.sql` | ripristina il vincolo della 0013 (si ferma se ci sono appunti con proposta) |

## Perché serve
La 0013 vieta **qualunque** anteprima su un'Idea di tipo `appunto`. Con il blocco 2d il server conserva la proposta di MichelinAI nell'Idea (`preview`, `preview_origin = 'ai'`), così si riapre senza una nuova chiamata AI.

Gli appunti sono le Idee più comuni, quindi senza la 0015:
- la proposta arriva comunque allo chef, ma **non viene conservata** (`salvata: false`);
- per riaprirla serve una nuova chiamata.

Per le Idee `link` e `testo` la 0013 basta già.

## Cosa cambia
| | Vincolo |
|---|---|
| Prima (0013) | `source_type <> 'appunto' or (source_url is null and preview is null)` |
| Dopo (0015) | `source_type <> 'appunto' or (source_url is null and (preview is null or preview_origin = 'ai'))` |

Un appunto resta senza link e può avere un'anteprima **solo** se proposta da MichelinAI, mai `strutturata`. Nessuna colonna, nessun dato e nessun privilegio cambiano. Le righe esistenti rispettano già il nuovo vincolo, che è più permissivo. La migrazione è idempotente e in un'unica transazione.

## Procedura su KHUB Test (solo dopo autorizzazione)
1. **Sola lettura:**
   ```sql
   select pg_get_constraintdef(oid) from pg_constraint where conname = 'ideas_appunto_chk' and conrelid = 'public.ideas'::regclass;
   -- atteso: CHECK (source_type <> 'appunto' OR (source_url IS NULL AND preview IS NULL))
   select source_type, count(*), count(preview) as con_anteprima from public.ideas group by 1 order by 1;   -- annotare
   ```
2. **Esecuzione:** incollare l'intero file `0015_ideas_appunto_proposta.sql`, una volta.
3. **Verifica, sola lettura:**
   ```sql
   select pg_get_constraintdef(oid) from pg_constraint where conname = 'ideas_appunto_chk' and conrelid = 'public.ideas'::regclass;
   -- atteso: ... (preview IS NULL OR preview_origin = 'ai') ...
   select source_type, count(*), count(preview) as con_anteprima from public.ideas group by 1 order by 1;   -- identico al punto 1
   ```

## Rollback (preparato, non eseguito)
1. **Prima** si ripristina il codice precedente al blocco 2d.
2. Poi si esegue lo script.

Lo script si ferma se esistono appunti con una proposta salvata. In quel caso va deciso prima se toglierla o copiarla.
