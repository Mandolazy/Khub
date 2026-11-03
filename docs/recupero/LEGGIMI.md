# Recupero della Direzione 3 — materiali

Il branch originale `feat/stati-ricetta-direzione-3` (10 commit locali, da
`7b688e3` a `179bf08`) non era stato pubblicato ed è andato perso quando
l'ambiente di lavoro temporaneo è stato ricreato. Questa cartella conserva
tutto ciò che è stato possibile recuperare, **senza modifiche**, per la
ricostruzione. Non viene pubblicata online: `.vercelignore` pubblica solo
i file dell'app.

## Origine

| Materiale | Fonte | Stato |
|---|---|---|
| `khub_mvp.html`, `demo/direzione-3/` (commit precedente del branch) | ZIP dal Mac `KHUB_Direzione3_RECUPERO.zip`, SHA-256 `75e0707b1ed14100…` | Stato `e4860f4`, identificato dal contenuto (non verificabile con l'hash) |
| `patch-originali/` | Comandi registrati nella cronologia della sessione di lavoro | Testo esatto, così come eseguito |
| `sql/elimina_scheda_se_vuota.sql` | Cronologia: file scritto per il commit `607a27f` | Testo esatto, mai modificato dopo |
| `sql/khub_test_elimina_scheda_se_vuota.sql` | Copia del precedente con sola intestazione per KHUB Test | Corpo identico |
| `stato-successivo/` | Letture complete dei file nella cronologia (stato del commit `fb90da0`) | Testo esatto |

## Patch originali (`patch-originali/`)

Ogni file contiene in testa data, esito e inizio dell'output. Le patch in
Python sostituiscono testo **esatto** (`assert s.count(old)==1`): se il
codice di base è diverso, si fermano senza modificare nulla.

| File | Commit originale | Contenuto |
|---|---|---|
| `01_…222820.sh` | `fb90da0` | Solo il comando di commit (le modifiche di `fb90da0` sono precedenti alla cronologia) |
| `02`–`08` | `d455725` | `api/chat.js`, `khub_mvp.html`, `test-stati-ricetta.js`, `test-supabase-secret-key.js` |
| `09_…231802.sh` | `d455725` | Commit |
| `10_…093729.sh` | `607a27f` | Commit della proposta SQL (testo in `sql/`) |
| `11_…_ERRORE.sh` | — | Primo tentativo fallito di `7e67e01`, **non applicato**; sostituito da `12` |
| `12`–`19` | `7e67e01` | `khub_mvp.html` (ricerca, confronto, benvenuto, CSS), test (`test-preview-direzione-3.js`, `test-start-home.js`, impronte in `test-fix2d-lab-weights.js` e `test-schede-categorie.js`) |
| `20_…224259.sh` | `7e67e01` | Commit |
| `21`–`23`, `25` | `179bf08` | Server, client, test, demo |
| `24_…233621.sh` | — | Prova di mutazione **temporanea**, annullata subito (non è una modifica) |
| `26_…233711.sh` | `179bf08` | Commit |
| `sed_…231553`, `sed_…231559` | — | Ritocchi temporanei della stampa degli errori nei test, annullati |
| `sed_…231607.sh` | `d455725` | Correzione definitiva del test E10 |
| `sed_…231753.sh`, `sed_…224107.sh` | — | Prove di mutazione temporanee, annullate |
| `sed_…224203.sh` | — | Diagnostica temporanea in P10, sostituita da `19` |
| `sed_…224218.sh` | `7e67e01` | Aggiornamento dell'impronta di `renderProdRecipe` nei test |

## Cosa manca (da ricostruire)

- `c52d013` (colori di ambiente, ordine LAB → Schede → Produzione,
  ordinamento LAB, "Resa prevista", barre mobile): solo frammenti.
- `b73f023` (stati delle Ricette garantiti dal server): non recuperabile.
- `fb90da0` (eliminazioni protette, "Unisci"): codice recuperabile in gran
  parte dalle letture nella cronologia, non come patch.
- Tutti i test della Direzione 3 tranne `stato-successivo/scripts__test-demo-direzione-3.js`.

Le patch `d455725`, `7e67e01` e `179bf08` si applicano solo dopo aver
ricostruito `c52d013` e `fb90da0`, nell'ordine originale.

## Script SQL superato (novembre 2026)

`sql/khub_test_elimina_scheda_se_vuota.sql` resta qui come testo storico ma
**non va più eseguito**: la sua verifica preliminare rifiuta le due foreign
key `ON DELETE SET NULL` che lo schema reale contiene
(`recipes.parent_recipe_id`, `ingredients.group_recipe_id`). La versione
corretta per KHUB Test è `docs/proposte/khub_test_elimina_scheda_se_vuota.sql`,
verificata da `scripts/db/test-elimina-scheda-se-vuota.sh`.
