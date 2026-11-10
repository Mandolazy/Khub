# Migrazione 0012 — tipo di quantità degli ingredienti (`ingredients.qty_kind`, `qty_min`, `qty_max`, `source_text`)

**Stato:** preparata e testata solo su un PostgreSQL locale fittizio. **Non applicata** né su KHUB Test né su Production. Va applicata solo dopo un'autorizzazione esplicita, prima su KHUB Test.

| File | Ruolo |
|---|---|
| `supabase/migrations/0012_ingredients_quantity_kind.sql` | migrazione additiva, in un'unica transazione |
| `supabase/rollback/PREPARED_NOT_EXECUTED__0012_ingredients_quantity_kind_rollback.sql` | rollback protetto (non eseguito, fuori dalla sequenza) |
| `scripts/test-p0c-migrazione.js` | test M1–M5 su un PostgreSQL locale vuoto (`KHUB_PG_TEST`) |

## 1. Schema di partenza (verificato su KHUB Test)

- `ingredients.qty numeric NOT NULL DEFAULT 0`
- `ingredients.unit text NOT NULL DEFAULT 'g'`
- nessun CHECK su `qty` o `unit`; 1 chiave primaria e 4 chiavi esterne
- nessuna colonna P0-c; 12 righe, nessuna con `qty = 0`, nessun NULL, nessuna unità fuori standard

## 2. Cosa fa

Aggiunge quattro colonne **nullable, senza DEFAULT**:

| Colonna | Tipo | Significato |
|---|---|---|
| `qty_kind` | `text` | `certa` · `variabile` (q.b.) · `mancante` · `intervallo`. `NULL` = ingrediente precedente a P0-c: comportamento identico a oggi |
| `qty_min` | `numeric` | minimo dell'intervallo (solo `intervallo`) |
| `qty_max` | `numeric` | massimo dell'intervallo (solo `intervallo`) |
| `source_text` | `text` | riga originale della fonte importata (max 300 caratteri) |

**Nessun `ADD COLUMN IF NOT EXISTS` cieco:** per ogni colonna si legge `information_schema.columns`.
- Colonna assente → viene aggiunta.
- Colonna presente con il tipo atteso → avviso (`NOTICE`), nessuna modifica.
- Colonna presente con un tipo diverso → `EXCEPTION`: la transazione viene annullata e **nulla** cambia.

Aggiunge cinque vincoli `CHECK`, solo se non esistono già con lo stesso nome:

| Vincolo | Regola |
|---|---|
| `ingredients_qty_kind_chk` | `qty_kind` NULL oppure uno dei quattro tipi |
| `ingredients_qty_intervallo_chk` | `intervallo` ⇒ `qty_min` e `qty_max` non nulli, `qty_min > 0`, `qty_max > qty_min`; ogni altro tipo (NULL compreso) ⇒ `qty_min` e `qty_max` NULL |
| `ingredients_qty_certa_chk` | `certa` ⇒ `qty > 0` |
| `ingredients_qty_segnaposto_chk` | `variabile`, `mancante`, `intervallo` ⇒ `qty = 0` (segnaposto tecnico, mai un peso) |
| `ingredients_source_text_chk` | `source_text` NULL o al massimo 300 caratteri |

Nota tecnica: in un CHECK un confronto con NULL dà NULL e il vincolo risulta **superato**. Per questo l'intervallo richiede esplicitamente `is not null` e il tipo è confrontato con `IS [NOT] DISTINCT FROM`. Due errori di questo tipo sono stati trovati e corretti proprio dal test locale (intervallo senza massimo; minimo/massimo senza tipo).

**Cosa non fa:**
- non modifica `qty` (resta `NOT NULL DEFAULT 0`) né `unit` (resta `NOT NULL DEFAULT 'g'`);
- nessun DEFAULT, nessun backfill, nessuna riga aggiornata: le righe esistenti hanno `qty_kind` NULL e soddisfano tutti i vincoli;
- nessuna modifica ad altre tabelle, funzioni, trigger o RLS.

**Impatto operativo:** `ADD COLUMN` senza DEFAULT modifica solo il catalogo. `ADD CONSTRAINT ... CHECK` verifica le righe esistenti (12 su KHUB Test): blocco di pochi millisecondi.

## 3. Compatibilità

| Combinazione | Esito |
|---|---|
| Codice attuale (P1-a o Production) + migrazione applicata | Compatibile. Il codice non invia né legge le nuove colonne; PostgREST aggiorna solo le colonne del payload; le righe restano `qty_kind` NULL |
| Codice P0-c + migrazione applicata | Configurazione prevista |
| **Codice P0-c senza migrazione** | **Non compatibile** per gli ingredienti importati con un tipo: PostgREST rifiuta `qty_kind` (colonna inesistente) e il salvataggio della Scheda fallisce. Le Ricette precedenti (senza tipo) continuano a salvarsi, perché il payload non contiene i campi P0-c |

Per questo l'ordine di rilascio è: **migrazione → codice**, e per il ritorno indietro: **codice → rollback**.

## 4. Test locali (eseguiti)

`KHUB_PG_TEST="host=<socket> port=<porta> user=postgres" node scripts/test-p0c-migrazione.js` — PostgreSQL 16 locale, database temporaneo creato e distrutto a ogni esecuzione, tabella con lo schema di KHUB Test e 12 righe precedenti.

| Test | Verifica | Esito |
|---|---|---|
| M1 | 4 colonne nullable senza default; righe esistenti invariate e con tipo NULL; `qty` ancora `NOT NULL DEFAULT 0` | ok |
| M2 | seconda esecuzione senza errori; 5 vincoli, nessun duplicato | ok |
| M3 | ammessi: certa con unità della fonte, q.b. con 0, mancante con 0, intervallo 20–30, riga precedente con 0. Rifiutati: tipo sconosciuto, intervallo invertito, intervallo senza massimo, certa a 0, q.b. con 5, mancante con 5, minimo/massimo senza tipo, testo > 300 | ok |
| M4 | colonna omonima con tipo diverso (`qty_min text`): migrazione fermata, nessuna delle altre colonne aggiunta | ok |
| M5 | rollback fermato se c'è anche una riga con dati P0-c; senza dati eseguito: colonne e vincoli rimossi, righe precedenti invariate | ok |

Senza `KHUB_PG_TEST` il test si dichiara non eseguito e termina con 0 (non tocca mai Supabase).

## 5. Procedura su KHUB Test (da eseguire solo dopo autorizzazione)

1. **Verifica preliminare** (sola lettura), nell'SQL Editor di KHUB Test:
   ```sql
   select column_name, data_type, is_nullable, column_default
     from information_schema.columns
    where table_schema = 'public' and table_name = 'ingredients'
    order by ordinal_position;
   select conname from pg_constraint where conrelid = 'public.ingredients'::regclass;
   select count(*) from public.ingredients;
   ```
   Atteso: nessuna colonna `qty_kind/qty_min/qty_max/source_text`; nessun vincolo `ingredients_%_chk`; il numero di righe annotato.
2. **Copia di sicurezza** dei dati (Supabase: backup del progetto, oppure `create table ingredients_bak_0012 as select * from public.ingredients;`, da rimuovere dopo il collaudo).
3. **Esecuzione**: incollare l'intero file `0012_ingredients_quantity_kind.sql` ed eseguirlo una volta.
4. **Verifica successiva**:
   ```sql
   select column_name, data_type, is_nullable, column_default
     from information_schema.columns
    where table_schema = 'public' and table_name = 'ingredients'
      and column_name in ('qty_kind','qty_min','qty_max','source_text');
   select conname from pg_constraint
    where conrelid = 'public.ingredients'::regclass and conname like 'ingredients_%_chk';
   select count(*) filter (where qty_kind is not null) as con_tipo, count(*) as totale from public.ingredients;
   ```
   Atteso: 4 colonne `YES` senza default; 5 vincoli; `con_tipo = 0`, `totale` uguale al punto 1.
5. Solo dopo: deploy della Preview con il codice P0-c (vedi `docs/import-engine/P0-c.md`, piano di collaudo).

Production non va toccata finché il collaudo su KHUB Test non è approvato.

## 6. Rollback (preparato, non eseguito)

**Prima** si ripristina il codice precedente a P0-c (altrimenti i salvataggi degli ingredienti importati con un tipo fallirebbero), **poi** si esegue il rollback del database.

- **Variante A — nessun dato P0-c** (`select count(*) from public.ingredients where qty_kind is not null or qty_min is not null or qty_max is not null or source_text is not null` = 0): eseguire `PREPARED_NOT_EXECUTED__0012_ingredients_quantity_kind_rollback.sql`. Rimuove i 5 vincoli e le 4 colonne in un'unica transazione.
- **Variante B — ci sono dati P0-c**: lo script si **ferma** con un errore e non modifica nulla. Prima va salvata una copia (`create table ingredients_p0c_bak as select id, qty_kind, qty_min, qty_max, source_text from public.ingredients where qty_kind is not null or source_text is not null;`) e va deciso cosa fare di quelle righe: senza le colonne, gli ingredienti `variabile`, `mancante` e `intervallo` tornerebbero a essere letti come "0 g", cioè esattamente la perdita che P0-c evita. Solo dopo questa decisione, svuotare le quattro colonne e rieseguire lo script.
