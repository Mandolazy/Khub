# Migrazione 0014 — Conversazione delle Idee (`public.idea_turns`)

**Stato:** preparata e testata solo su PostgreSQL 16 + PostgREST 12.2.3 locali. **Non applicata.** Va applicata prima su KHUB Test, solo dopo un'autorizzazione esplicita. Richiede la 0013 (`public.ideas`).

| File | Ruolo |
|---|---|
| `supabase/migrations/0014_idea_turns.sql` | tabella nuova, additiva, in un'unica transazione |
| `supabase/rollback/PREPARED_NOT_EXECUTED__0014_idea_turns_rollback.sql` | rollback protetto (non eseguito) |
| `scripts/test-p2a2-idee-conversazione.js` | test C1–C18 su PostgreSQL + PostgREST locali |

## 1. Schema
Un turno è un messaggio dello chef con la risposta di MichelinAI.

| Colonna | Tipo | Regole |
|---|---|---|
| `id` | text PK | `it_` + 8–64 caratteri `[A-Za-z0-9_-]`, generato dal browser (chiave d'idempotenza) |
| `idea_id` | text NOT NULL | riferimento a `ideas(id)`, `on delete cascade` |
| `question` | text NOT NULL | 1–4000 caratteri (spazi esclusi) |
| `question_origin` | text NOT NULL | `testo` o `voce` |
| `question_hash` | text NOT NULL | sha256 esadecimale del messaggio normalizzato, calcolato dal server |
| `response` | text | 1–20 000 caratteri; solo se `completato` |
| `status` | text NOT NULL, default `in_corso` | `in_corso`, `completato`, `fallito` |
| `attempts` | integer NOT NULL, default 1 | 1–10: elaborazioni avviate per questo turno |
| `lease_until` | timestamptz | scadenza della prenotazione; solo se `in_corso` |
| `error_code` | text | `[a-z_]{1,40}`; solo se `fallito` |
| `created_at`, `updated_at` | timestamptz NOT NULL default now() | |
| `completed_at` | timestamptz | solo se `completato` |

**Vincolo di coerenza degli stati (`idea_turns_stato_chk`):**

| Stato | `response` | `lease_until` | Altro |
|---|---|---|---|
| `in_corso` | assente | presente | — |
| `completato` | presente | assente | `completed_at` presente, nessun errore |
| `fallito` | assente | assente | `error_code` presente |

**Indici:**
- `idea_turns_cronologia_idx (idea_id, created_at, id)`: cronologia in ordine stabile;
- `idea_turns_creati_idx (created_at)`: conteggio delle ultime 24 ore;
- `idea_turns_uno_in_corso_idx`: **unico**, su `idea_id` con condizione `status = 'in_corso'`. Al massimo un turno in elaborazione per Idea.

**Accesso:**
- RLS attivo **senza policy**;
- `revoke all` per `anon` e `authenticated`;
- per `service_role` `revoke all` e poi **`grant select, insert, update`**. Nessun DELETE: i turni non si cancellano; spariscono solo con la loro Idea, in cascata;
- non usa la policy aperta di `m2_turns`.

**Sicurezza della migrazione:**
- idempotente;
- si ferma senza modificare nulla se `ideas` manca, se `idea_turns` esiste con colonne diverse o se trova policy sulla tabella.

## 2. Procedura su KHUB Test (solo dopo autorizzazione)

### 2.1 Sola lettura, prima
```sql
select to_regclass('public.ideas')      as ideas,       -- atteso: public.ideas
       to_regclass('public.idea_turns') as idea_turns;  -- atteso: NULL
select status, count(*) from public.ideas group by status order by 1;  -- annotare
```

### 2.2 Esecuzione
Incollare l'intero file `supabase/migrations/0014_idea_turns.sql` nell'SQL Editor, una volta.

### 2.3 Verifica, sola lettura (tutte le righe devono essere OK)
```sql
with controlli(ordine, controllo, atteso, valore) as (values
  (1, 'tabella presente', 'true', (to_regclass('public.idea_turns') is not null)::text),
  (2, 'colonne', '13', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='idea_turns')),
  (3, 'RLS attivo', 'true', (select relrowsecurity::text from pg_class where oid = to_regclass('public.idea_turns'))),
  (4, 'nessuna policy', '0', (select count(*)::text from pg_policies where schemaname='public' and tablename='idea_turns')),
  (5, 'anon: nessun privilegio', 'false', (select has_table_privilege('anon', 'public.idea_turns', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')::text)),
  (6, 'authenticated: nessun privilegio', 'false', (select has_table_privilege('authenticated', 'public.idea_turns', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')::text)),
  (7, 'service_role: SELECT, INSERT, UPDATE', 'true', (select (has_table_privilege('service_role','public.idea_turns','SELECT') and has_table_privilege('service_role','public.idea_turns','INSERT') and has_table_privilege('service_role','public.idea_turns','UPDATE'))::text)),
  (8, 'service_role: nessun DELETE, TRUNCATE, REFERENCES, TRIGGER', 'false', (select has_table_privilege('service_role','public.idea_turns','DELETE,TRUNCATE,REFERENCES,TRIGGER')::text)),
  (9, 'nessun privilegio a PUBLIC', '0', (select count(*)::text from pg_class c, aclexplode(c.relacl) a where c.oid = to_regclass('public.idea_turns') and a.grantee = 0)),
  (10, 'vincolo degli stati', 'true', (exists (select 1 from pg_constraint where conname='idea_turns_stato_chk' and conrelid=to_regclass('public.idea_turns')))::text),
  (11, 'un solo turno in corso per Idea (indice unico parziale)', 'true', (exists (select 1 from pg_indexes where schemaname='public' and indexname='idea_turns_uno_in_corso_idx' and indexdef ilike '%unique%where%in_corso%'))::text),
  (12, 'indice cronologico', 'true', (to_regclass('public.idea_turns_cronologia_idx') is not null)::text),
  (13, 'chiave esterna verso ideas con cascata', 'true', (exists (select 1 from pg_constraint where conrelid=to_regclass('public.idea_turns') and contype='f' and confrelid=to_regclass('public.ideas') and confdeltype='c'))::text),
  (14, 'tabella vuota', '0', (select count(*)::text from public.idea_turns)))
select ordine, controllo, atteso, valore, case when valore = atteso then 'OK' else 'FERMARSI' end as esito
  from controlli order by ordine;
```

### 2.4 Dopo la verifica
- Rileggere i conteggi di §2.1: devono restare identici; la migrazione non tocca `ideas`.
- Collaudo dalla Preview solo con chiamate AI **autorizzate**: blocco 2c.

## 3. Rollback (preparato, non eseguito)
1. **Prima** si ripristina il codice precedente al blocco 2b.
2. Poi si esegue `PREPARED_NOT_EXECUTED__0014_idea_turns_rollback.sql`.

Lo script si **ferma** se la tabella contiene righe. In quel caso:
1. si copia la tabella (`create table ... as select * from public.idea_turns`);
2. si decide che fare di quei dati.

Nessun'altra tabella è toccata.

**Ordine dei rollback:** con la 0014 applicata, il rollback della 0013 si ferma con il messaggio «Eseguire prima il rollback 0014»; il controllo è stato aggiunto a `PREPARED_NOT_EXECUTED__0013_ideas_rollback.sql`. L'ordine è sempre 0014 → 0013.
