# Migrazione 0011 — resa dichiarata (`variants.declared_yield_*`)

**Stato:** preparata e testata in locale. **Non applicata.** Va applicata solo dopo un'autorizzazione esplicita.

| File | Ruolo |
|---|---|
| `supabase/migrations/0011_variants_declared_yield.sql` | migrazione additiva |
| `supabase/rollback/PREPARED_NOT_EXECUTED__0011_variants_declared_yield_rollback.sql` | rollback protetto (non eseguito) |
| `scripts/db/test-0011-declared-yield.sh` | test su un Postgres locale temporaneo |
| `scripts/test-lab-fix2a-declared-yield-compat.js` | compatibilità del codice attuale con le colonne presenti |

## 1. Cosa fa

```sql
alter table public.variants
  add column if not exists declared_yield_qty numeric,
  add column if not exists declared_yield_unit text;
```

Aggiunge anche due `comment on column`, cioè documentazione nel catalogo: nessun effetto sui dati.

**Tipi:**
- **`declared_yield_qty numeric`** (senza precisione fissa):
  - decimale esatto, senza errori di virgola mobile (2,5 kg; 0,75 teglie);
  - è lo stesso tipo di `grams_per_portion` e delle rese degli ingredienti;
  - una precisione fissa, es. `numeric(12,3)`, imporrebbe una scala che oggi non abbiamo motivo di scegliere.
- **`declared_yield_unit text`:**
  - l'elenco delle unità non è ancora approvato;
  - un enum o un CHECK costringerebbe a una nuova migrazione a ogni modifica dell'elenco;
  - la validazione delle unità sarà applicativa (FIX 2B) finché l'elenco non sarà congelato.

**Cosa non fa:**
- **Nessun DEFAULT, nessun aggiornamento delle righe esistenti:** tutte le 202 versioni restano con `NULL / NULL`, cioè "resa non dichiarata".
- **Nessun CHECK** (es. `qty > 0`, entrambe valorizzate o entrambe NULL): sono decisioni separate. Se approvate potranno essere aggiunte in seguito senza problemi, perché le righe NULL le rispettano.
- **Nessuna modifica** a `portions_count`, `grams_per_portion`, `portion_unit`, ai vincoli esistenti o ad altre tabelle.
- **Nessuna colonna per il formato della teglia:** richiede una decisione separata.

**Impatto operativo:** `ADD COLUMN` senza DEFAULT modifica solo il catalogo. Non riscrive la tabella, richiede un blocco di pochi millisecondi ed è idempotente (`IF NOT EXISTS`).

## 2. Compatibilità con il codice attuale (verificata)

Il codice in Production accede a `variants` in soli tre punti:

| Punto | Codice | Effetto delle nuove colonne |
|---|---|---|
| Caricamento | `api/chat.js:730` `variants?select=*` → `loadFromSupabase` | Le colonne arrivano al client e vengono **ignorate**: la mappatura legge solo i campi noti. Stato in memoria identico con e senza le colonne (test compat. 1) |
| Salvataggio | `api/chat.js:757` upsert `merge-duplicates` ← `saveToSupabase` / `buildValidatedVariantPayload` | Il payload non contiene le nuove colonne e PostgREST aggiorna solo le colonne del payload, quindi i valori restano **intatti** (test DB "salvataggio del codice attuale"; test compat. 2–5) |
| Eliminazione | `khub_mvp.html:2043`, `:2388` `delete` per id | Nessun effetto |

**Dipendenze verificate:**

| Area | Esito | Verifica |
|---|---|---|
| Approvazione / attivazione | Invariate. Una promozione mantiene lo stesso id, quindi la riga conserva la resa dichiarata della bozza | compat. 4, e2e T6 |
| Ricette Attive, FIX 1 / 1.1 | Le versioni invariate non vengono reinviate; nota, orario e mattoncini intatti | compat. 5, e2e T1–T4 |
| Mattoncini | Invariati | e2e T2, T5b, T6b |
| Sessioni, snapshot, Storico | Non leggono `variants` dal database: usano la ricetta in memoria (identica) e `production_sessions` | e2e T5, suite MS12–MS17b |
| API e funzioni server | Nessuna query con colonne esplicite su `variants`; nessuna funzione o trigger nel repository | ricerca nel codice |
| MichelinAI | Il payload è costruito dalla ricetta in memoria | suite m1 e m2 |

## 3. Test (locali, nessun accesso a Supabase)

```bash
bash scripts/db/test-0011-declared-yield.sh              # Postgres 16 locale temporaneo
node scripts/test-lab-fix2a-declared-yield-compat.js     # codice reale, PostgREST simulato
```

Il test sul database crea un cluster usa-e-getta con una replica della tabella `variants`, costruita sullo schema reale verificato, e verifica:
- checksum identico di tutte le colonne legacy;
- tipo, nullabilità e default delle nuove colonne;
- righe esistenti a NULL;
- idempotenza;
- quantità e unità memorizzate in modo esatto;
- salvataggio in stile PostgREST che non tocca le colonne assenti dal payload;
- NOT NULL e zero legacy invariati;
- rollback protetto e rollback prima dell'uso.

Lo schema replicato non include eventuali privilegi per colonna, policy o trigger non dichiarati del database reale: per questi servono le verifiche preliminari (§5).

## 4. Rollback (preparato, NON eseguito)

> ⚠️ **Eliminare una colonna che contiene dati cancella quei dati in modo definitivo.**

**A. Prima che il codice usi le colonne (FIX 2B non rilasciato)**
- Le colonne sono tutte NULL.
- Eseguire `supabase/rollback/PREPARED_NOT_EXECUTED__0011_variants_declared_yield_rollback.sql` nell'SQL Editor.
- Lo script è in un'unica transazione e controlla prima che non ci siano dati: se trova anche una sola riga valorizzata **si ferma senza modificare nulla**.
- Il codice attuale non le usa, quindi non serve nessun intervento sul codice.

**B. Dopo che il codice ha iniziato a usarle (FIX 2B rilasciato)**

Lo script A **si rifiuta di procedere**: è voluto. Procedura:
1. **Prima** riportare in Production una versione del codice che non scrive le colonne. Altrimenti, dopo l'eliminazione, ogni salvataggio fallisce con "colonna sconosciuta".
2. Copia di sicurezza dei dati:
   ```sql
   create table public.backup_0011_declared_yield as
   select id, declared_yield_qty, declared_yield_unit, now() as copiato_il
   from public.variants
   where declared_yield_qty is not null or declared_yield_unit is not null;
   ```
3. Verificare il numero di righe copiate rispetto a `select count(*) from variants where declared_yield_qty is not null or declared_yield_unit is not null`.
4. Solo dopo un'ulteriore autorizzazione esplicita, eliminare le colonne a mano:
   ```sql
   alter table public.variants drop column if exists declared_yield_qty, drop column if exists declared_yield_unit;
   ```
   Le rese dichiarate restano solo nella tabella di copia.

**Alternativa consigliata a B:** **non eliminare** le colonne. Riportare solo il codice: le colonne inutilizzate non disturbano il codice precedente (verificato) e non si perde nulla.

## 5. Procedura di rilascio proposta

**1. Verifiche preliminari (solo lettura, SQL Editor)**
```sql
-- colonne già esistenti con lo stesso nome? (atteso: 0 righe)
select column_name from information_schema.columns
where table_schema='public' and table_name='variants' and column_name like 'declared_yield%';
-- privilegi per colonna su variants (se presenti, le nuove colonne potrebbero non essere leggibili da anon)
select grantee, column_name, privilege_type from information_schema.column_privileges
where table_schema='public' and table_name='variants' and grantee in ('anon','authenticated') limit 20;
-- privilegi a livello di tabella (attesi per anon: SELECT/INSERT/UPDATE/DELETE)
select grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='variants' and grantee in ('anon','authenticated');
-- trigger e policy
select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.variants'::regclass and not tgisinternal;
select policyname, cmd, qual, with_check from pg_policies where tablename='variants';
-- fotografia di controllo (da confrontare dopo)
select status, count(*), sum(portions_count), sum(grams_per_portion) from public.variants group by status order by status;
```

**2. Backup**
- Verificare che il progetto Supabase abbia un backup recente o il Point-in-Time Recovery: Dashboard → Database → Backups.
- Esportare in aggiunta `variants`, per esempio con `pg_dump --table=public.variants` oppure con l'esportazione CSV della tabella dalla Dashboard.

**3. Applicazione (solo dopo autorizzazione esplicita)**
- SQL Editor → incollare **esattamente** il contenuto di `supabase/migrations/0011_variants_declared_yield.sql` → Run.
- Nessun deploy del codice in questo passo.

**4. Verifica dopo la migrazione (solo lettura)**
```sql
select column_name, data_type, is_nullable, column_default from information_schema.columns
where table_schema='public' and table_name='variants' and column_name like 'declared_yield%';
-- atteso: declared_yield_qty numeric YES NULL; declared_yield_unit text YES NULL
select count(*) from public.variants where declared_yield_qty is not null or declared_yield_unit is not null;
-- atteso: 0
select status, count(*), sum(portions_count), sum(grams_per_portion) from public.variants group by status order by status;
-- atteso: identico alla fotografia del punto 1
```
- Se servisse, ricaricare la cache dello schema di PostgREST con `notify pgrst, 'reload schema';`. Supabase di norma lo fa da solo.
- **Controllo funzionale nell'app in Production, senza modificare ricette:** aprire Schede, LAB e Produzione e verificare che tutto si carichi.

**5. FIX 2B (separato)**
Solo dopo che la migrazione è stata applicata e verificata: il codice che legge e scrive le colonne va rilasciato **dopo** la migrazione, mai prima. Altrimenti PostgREST rifiuta l'intero salvataggio delle bozze.

## 6. Rischi residui

| Rischio | Gravità | Mitigazione |
|---|---|---|
| Privilegi per colonna su `variants` (non verificati): le nuove colonne potrebbero non essere leggibili da `anon`, e `select=*` fallirebbe | Media, improbabile su Supabase standard | verifica preliminare 1; rollback A immediato |
| Trigger o policy non dichiarati che elencano le colonne | Bassa | verifica preliminare 1 |
| Rilascio del FIX 2B prima della migrazione | Alta se accade | ordine del §5; il FIX 2B deve includere un test che lo segnali |
| Rollback B senza copia dei dati | Alta (perdita definitiva) | lo script protetto si rifiuta; procedura B con copia; alternativa senza eliminazione |
| Replica locale non identica allo schema reale | Bassa | verifiche preliminari e fotografia di controllo |
