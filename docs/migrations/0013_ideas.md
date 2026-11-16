# Migrazione 0013 — Idee (`public.ideas`)

**Stato:** preparata e testata solo su PostgreSQL 16 + PostgREST 12.2.3 locali. **Non applicata.** Va applicata prima su KHUB Test, solo dopo un'autorizzazione esplicita.

| File | Ruolo |
|---|---|
| `supabase/migrations/0013_ideas.sql` | tabella nuova, additiva, in un'unica transazione |
| `supabase/rollback/PREPARED_NOT_EXECUTED__0013_ideas_rollback.sql` | rollback protetto (non eseguito) |
| `scripts/test-p2a1-idee.js` | test (parte B su PostgreSQL + PostgREST locali con ruoli come Supabase) |

## 1. Cosa fa
Crea la sola tabella `public.ideas`. Nessuna tabella esistente viene modificata.

| Colonna | Tipo | Regole |
|---|---|---|
| `id` | text PK | `idea_` + 8–64 caratteri `[A-Za-z0-9_-]`, generato dal server |
| `title` | text NOT NULL | 1–200 caratteri (spazi esclusi) |
| `status` | text NOT NULL, default `aperta` | `aperta`, `trasformata`, `archiviata` (solo ciclo di vita) |
| `source_type` | text NOT NULL | `link`, `testo`, `appunto` (provenienza) |
| `source_url` | text | ≤ 2000, solo `http(s)://` |
| `source_text` | text | 1–20 000 caratteri |
| `preview` | jsonb | oggetto ≤ 200 000 byte; NULL = Idea grezza |
| `preview_origin` | text | `strutturata` o `ai`; NULL se e solo se `preview` è NULL |
| `notes` | text | ≤ 5000 caratteri |
| `linked_recipe_id`, `linked_variant_id` | text | chiavi esterne verso recipes/variants, `on delete set null` (per la futura trasformazione) |
| `created_at`, `updated_at` | timestamptz NOT NULL default now() | |

**Vincoli di coerenza:**
- un `link` ha `source_url`;
- `testo` e `appunto` hanno `source_text`;
- un `appunto` non ha né link né anteprima;
- anteprima e origine sono presenti insieme o assenti insieme.

Non esiste uno stato «analizzata»: un'Idea è grezza o analizzata **solo** in base alla presenza dell'anteprima, quindi nessuna combinazione è ambigua.

**Escluso di proposito:** nessun vincolo fra `linked_recipe_id` e `linked_variant_id`. Con due chiavi esterne «on delete set null», il test B8 ha mostrato che un tale vincolo **bloccherebbe l'eliminazione di una Scheda** collegata.

**Accesso:**
- RLS attivo **senza alcuna policy**;
- `revoke all` per `anon` e `authenticated` (privilegi che Supabase concede di default alle nuove tabelle di `public`);
- il server usa la chiave secret (`service_role`, che ignora RLS);
- la migrazione si ferma se trova policy sulla tabella.

**Sicurezza della migrazione:**
- idempotente;
- si ferma senza modificare nulla se `public.ideas` esiste già con colonne diverse, o se mancano `recipes` o `variants`.

## 2. Compatibilità
- Il codice precedente non conosce la tabella: compatibile.
- Il codice P2-a.1 senza la tabella: le azioni delle Idee rispondono «Idee non disponibili» (`ok:false`). Il resto dell'app non è toccato, perché la lettura delle Schede non legge `ideas`.
- Per l'interfaccia futura vale comunque l'ordine migrazione → codice.

## 3. Procedura su KHUB Test (solo dopo autorizzazione)
1. **Sola lettura:**
   ```sql
   select to_regclass('public.ideas');   -- atteso NULL
   ```
2. **Esecuzione:** incollare l'intero file `0013_ideas.sql`, una volta.
3. **Verifica, sola lettura:**
   ```sql
   select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='ideas' order by ordinal_position;
   select relrowsecurity from pg_class where oid = 'public.ideas'::regclass;                 -- atteso true
   select count(*) from pg_policies where schemaname='public' and tablename='ideas';            -- atteso 0
   select r, has_table_privilege(r, 'public.ideas', 'SELECT') as sel, has_table_privilege(r, 'public.ideas', 'INSERT') as ins,
          has_table_privilege(r, 'public.ideas', 'UPDATE') as upd, has_table_privilege(r, 'public.ideas', 'DELETE') as del
     from unnest(array['anon','authenticated']) r;                                              -- atteso tutto false
   ```

## 4. Rollback (preparato, non eseguito)
**Prima** si ripristina il codice precedente, poi si esegue `PREPARED_NOT_EXECUTED__0013_ideas_rollback.sql`.
- Lo script si **ferma** se la tabella contiene righe (variante B): in quel caso prima la copia `create table ... as select * from public.ideas`, poi la decisione su quei dati.
- Nessun'altra tabella è toccata.

## 5. Verifica in sola lettura dei permessi esistenti su KHUB Test (`m2_turns` e altre tabelle)
Da eseguire **prima** della migrazione, senza modificare nulla:
```sql
select c.relname as tabella, c.relrowsecurity as rls,
       coalesce((select string_agg(p.policyname||' → '||array_to_string(p.roles,',')||' '||p.cmd, '; ') from pg_policies p where p.schemaname='public' and p.tablename=c.relname), '-') as policy,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select, has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
       has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname;
```
Lettura dell'esito:
- **`anon_select` = true e RLS non attivo:** tabella leggibile con la chiave anonima del progetto;
- **RLS attivo con una policy verso `public` o `anon`:** stesso effetto per le operazioni coperte dalla policy;
- **RLS attivo senza policy, o nessun privilegio:** accesso negato.
