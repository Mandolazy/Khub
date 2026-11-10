# P0-c — Integrità delle quantità degli ingredienti

**Stato:** implementato **solo in locale** sul branch `claude/p0c-integrita-quantita` (da `76d6e5a`, P1-a). Nessun commit, nessun push, nessun deploy. Migrazione 0012 preparata e **non eseguita**. Nessuna scrittura su Supabase, nessuna chiamata AI reale.

## 1. Problema

Prima di P0-c ogni ingrediente aveva solo `qty` (numero) e `unit`. Di conseguenza:
- «Sale q.b.» diventava `0 g`;
- un ingrediente senza quantità («Burro») diventava `0 g`;
- un intervallo («20–30 g») perdeva l'informazione o veniva ridotto a un valore;
- un'unità non standard («2 spicchi», «1 baccello») diventava `g` o veniva persa.

Uno `0 g` è indistinguibile da un vero zero: entra nei pesi, nei totali, nella Produzione e nello snapshot della Sessione.

## 2. Modello

Ogni ingrediente può avere un **tipo di quantità** (`qtyKind` in memoria, `qty_kind` nel database). L'assenza del tipo indica un ingrediente precedente a P0-c, che si comporta esattamente come prima.

| Tipo | Esempio | `qty` nel DB | Pesi | Validazione | Attivazione | Produzione |
|---|---|---|---|---|---|---|
| *(nessuno)* | Ricette precedenti | come prima | come prima | come prima | come prima | come prima |
| `certa` | 500 g; 2 spicchi | > 0 | calcolata (con conversione se l'unità non è di massa) | ammessa | ammessa | scalata |
| `variabile` | Sale q.b. | 0 (segnaposto) | **esclusa**, con indicazione | ammessa | ammessa | mostrata «q.b.», mai scalata |
| `mancante` | Burro | 0 (segnaposto) | **non risolta**: nessun totale | ammessa | **bloccata dal server** | bloccata |
| `intervallo` | 20–30 g | 0 (segnaposto) + `qty_min`/`qty_max` | **non risolta**: nessun totale | ammessa | ammessa | il valore va **scelto** nell'intervallo a ogni invio in Produzione |

Stati derivati (non salvati): «conversione in grammi da confermare» (tipo `certa` con unità non di massa e nessun fatto di conversione) e «convertita» (fatto presente in `ingredient_conversions`). Si usa il sistema di conversioni esistente: nessuna tabella nuova.

Il testo originale della fonte è conservato in `source_text` (max 300 caratteri) e mostrato come nota. `qty_kind` non compare mai come parola nell'interfaccia: lo chef vede «q.b.», «quantità da indicare», «intervallo», «conversione in grammi da confermare».

## 3. Modifiche applicative (`khub_mvp.html`)

**Funzioni nuove** (nessuna dipendenza aggiunta alle funzioni protette, che restano autosufficienti per gli harness di test):
- `qtyKindDi`, `quantitaNonNumerica`, `etichettaQuantita`, `testoQuantitaIngrediente` — lettura e presentazione del tipo;
- `interpretaTestoQuantita(testo)` — un solo campo accetta un numero, «q.b.»/«qb»/«quanto basta», «a piacere», un intervallo «20-30»/«20–30»; vuoto o 0 = da indicare; altro = rifiutato;
- `UNITA_FONTE_SINGOLARE`, `unitaFonteCanonica` — unità della fonte al singolare («spicchi» → «spicchio»);
- `importQuantitaDaRiga` — mappa la riga strutturata P1-a nel nuovo modello;
- `onIngQtyTesto` — modifica della quantità nel LAB per gli ingredienti con tipo (`onIngQty` invariata per gli altri);
- `sceltaIntervalloProduzione` — scelta del valore dell'intervallo prima di creare la Sessione (in memoria, `S.produzioneIntervalli`).

**Percorso completo:**

| Passaggio | Cosa cambia |
|---|---|
| Importazione strutturata (P1-a) | Il parser conserva intervallo (`qtyMin`/`qtyMax`), q.b. e unità originale; ogni riga porta il testo della fonte |
| Importazione AI (`extractRecipe`) | Quantità e unità validate: unità standard come prima; alias riconosciuti; unità non standard conservate; numero senza unità → `n`; intervallo, q.b. riconosciuti; quantità assente, 0 o negativa → **da indicare** (mai `0 g`) |
| Anteprima (`renderPreview`, `bindEvents`) | Campo quantità testuale; unità della fonte mostrata; note per ogni riga; banda corretta (*«N ingredienti da confermare… Nessuna diventa 0 g.»*, risolve il messaggio errato di P1-a); salvataggio fermato se manca l'unità di una quantità numerica |
| Salvataggio (`saveToSupabase`, `buildValidatedVariantPayload`) | Campi P0-c inviati **solo** per ingredienti con tipo; `qty = 0` come segnaposto per i tipi non numerici; `certa` senza numero positivo salvata come `mancante` |
| Ricaricamento (`loadFromSupabase`) | Tipo, intervallo e testo riletti solo se il tipo è valido; `qty` in memoria `null` per i tipi non numerici (lo 0 del DB non diventa mai un peso) |
| Firma della bozza (`firmaContenutoBozza`) | Tipo, intervallo e testo aggiunti **solo** se il tipo è presente: le firme delle bozze precedenti sono identiche (test Q3) |
| LAB (`renderLabRecipe`, pannelli pesi) | Nota sotto il nome; campo testuale solo per gli ingredienti con tipo; avviso per le quantità da indicare; pesi con esclusi e non risolti espliciti |
| Pesi (`computeFormulationWeights`) | Nuovo stato `unresolved` (mancante, intervallo): nessun totale falsamente completo; `variabile` esclusa ed elencata |
| Confronto, Contenuto, PDF | Etichette «q.b.», «da indicare», «20–30 g» al posto di «0 g» |
| Produzione (`buildPreparedInputDaRicettaAttiva`, `computeSessionScaling`, `buildSessionSnapshotV1`, `renderMandaInProduzioneModal`, `confirmMandaInProduzione`, `renderSessioneOperativa`, `renderQuickCalcPanel`, `renderProdRecipe`) | Intervallo da scegliere (fuori intervallo rifiutato); mancante blocca con messaggio; q.b. nello snapshot senza quantità e mostrato «q.b.»; conversioni non di massa richieste con il preflight esistente |

## 4. Modifiche al server (`api/chat.js`)

- **Validazione prima di scrivere** (`quantita_non_valida`): gli stessi vincoli della migrazione (tipo ammesso, certa > 0, segnaposto 0, intervallo coerente, minimo/massimo solo per l'intervallo, testo ≤ 300). Righe senza tipo: nessun controllo nuovo.
- **Attivazione** (`quantita_mancante`): una Ricetta non diventa Attiva se ha ingredienti `mancante`. Il controllo legge le righe **salvate** nel database (unite a quelle della richiesta, senza quelle eliminate), non solo quelle inviate dal client.
- **Protezione della formulazione**: `qty_kind`, `qty_min`, `qty_max` aggiunti ai campi che non cambiano sul posto in una Ricetta validata.
- **Sessione di Produzione**: uno snapshot con ingredienti `mancante` o `intervallo` (valore non scelto) viene rifiutato.

## 5. Compatibilità con le Ricette precedenti

- Nessuna riga esistente viene modificata (né dalla migrazione né dal codice).
- Ingredienti senza tipo: pesi, scalatura, snapshot, firma, payload di salvataggio e rilettura **identici** a `76d6e5a` — verificato da `test-p0c-equivalenza.js` su 120 formulazioni deterministiche (114 scalabili, stessi errori per le altre).
- Nessun blocco retroattivo: una Ricetta precedente con `qty = 0` resta validabile e attivabile (test V5).
- Il LAB mostra per le righe precedenti lo stesso campo numerico di prima (markup identico).

## 6. Funzioni con impronta modificate (motivazione)

I test esistenti confrontano l'impronta (hash) di alcune funzioni. Queste 10 sono cambiate **intenzionalmente**; per ciascuna l'equivalenza sulle Ricette precedenti è verificata da `test-p0c-equivalenza.js` o dai test di comportamento:

| Funzione | Motivo |
|---|---|
| `saveToSupabase` | invia i campi P0-c solo per ingredienti con tipo; segnaposto 0 |
| `buildValidatedVariantPayload` | come sopra, per la Ricetta validata |
| `loadFromSupabase` | rilegge tipo/intervallo/testo; `qty` null per i tipi non numerici |
| `firmaContenutoBozza` | include tipo/intervallo/testo solo se presenti |
| `computeFormulationWeights` | esclusi (q.b.) e non risolti (mancante, intervallo) |
| `buildPreparedInputDaRicettaAttiva` | marca i tipi; valore scelto dell'intervallo |
| `computeSessionScaling` | errore esplicito per mancante/intervallo; q.b. senza quantità |
| `buildSessionSnapshotV1` | copia tipo, intervallo e testo solo se presenti |
| `confirmMandaInProduzione` | controlla mancante/intervallo prima del preflight delle conversioni |
| `renderProdRecipe` | etichette «q.b.»/«da indicare» |

Funzioni non protette da impronta ma presenti nell'elenco di controllo delle modifiche di `test-preview-direzione-3` (P2): `buildPreparedInputDaRicettaAttiva`, `buildSessionSnapshotV1`, `buildValidatedVariantPayload`, `computeFormulationWeights`, `computeSessionScaling`, `confirmMandaInProduzione`, `contaVariabiliCambiate`, `firmaContenutoBozza`, `renderActiveYieldSection`, `renderLabWeightsPanel`, `renderMandaInProduzioneModal`, `renderQuickCalcPanel`, `renderSessioneOperativa`.

## 7. Test

**Nuovi** (tutti verdi):

| File | Contenuto | Esito |
|---|---|---|
| `scripts/test-p0c-quantita.js` | Chromium sulla demo locale (pagina e `api/chat.js` reali, DB in memoria, rete bloccata): P1–P3 anteprima/salvataggio/ricaricamento/LAB/firma; C1–C2 pesi e modifica nel LAB; V1–V6 regole del server; R1 Produzione con intervallo, q.b., conversione e snapshot | 12/12 |
| `scripts/test-p0c-equivalenza.js` | attuale vs `76d6e5a` sulle Ricette precedenti | 4/4 |
| `scripts/test-p0c-migrazione.js` | migrazione e rollback su PostgreSQL locale fittizio | 5/5 |

**Suite completa** (55 file, esclusi `test-m1-live` e `test-supabase-roundtrip` che richiedono servizi reali): **41 verdi, 14 con differenze**. Rieseguendo le 14 con le sole asserzioni di impronta trasformate in avvisi, **tutte le altre asserzioni passano**. Le differenze, nessuna modificata in questa fase:

| Test | Causa | Aggiornamento proposto (da approvare) |
|---|---|---|
| `conversion-name-groups` G8; `fix2d-lab-weights` D9; `import-declared-yield` R9; `lab-fix2b-i3-conversions` T13; `lab-fix2b-i6-active-yield` A11; `lab-fix2c-c4-weight-summary` C1; `lab-fix2c-r1-polish` A4; `post-validation-ux` U9; `schede-categorie` C9 | impronte delle funzioni della §6 | nuove impronte, con riferimento a `test-p0c-equivalenza` |
| `import-preview-weights` P6 | impronta di `computeFormulationWeights` | come sopra |
| `import-preview-weights` P4 | quantità AI −5 o 0: ora «quantità da indicare» invece di «Percentuali non disponibili» | atteso il nuovo messaggio (comportamento voluto: mai 0 g) |
| `import-p0a-estrazione` E1, E2 | «Sale q.b.» dall'AI: ora `variabile` (qty null, unità null) invece di `0 g` | atteso il tipo `variabile` |
| `import-p1a-strutturato` F3 | «1 baccello di vaniglia»: unità `baccello` conservata invece di `null` | attesa l'unità della fonte |
| `preview-direzione-3` P2 | elenco di controllo delle funzioni cambiate | aggiungere le funzioni della §6 con la motivazione P0-c |
| `m2-contract` (R3A) | **preesistente**, già rosso su `76d6e5a` | nessuno in P0-c |

## 8. Limiti noti

- **MichelinAI M1/M2**: risolto in P0-c.1 (`docs/import-engine/P0-c1.md` §2).
- **Salvataggio con righe miste** (PostgREST `PGRST102`): risolto in P0-c.1 (§1).
- **Importazione AI**: le righe non hanno `source_text` (l'AI non restituisce la riga originale).
- **Ingredienti precedenti nel LAB**: mantengono il campo numerico; non si può scrivere «q.b.» su una riga senza tipo (scelta voluta per non cambiare il markup protetto).
- **Ingredienti `variabile`/`mancante` senza unità**: salvati con `unit = 'g'` per il vincolo `NOT NULL DEFAULT 'g'` (come già avveniva); la firma della bozza usa lo stesso valore, quindi resta stabile dopo la rilettura.
- **Scelta dell'intervallo in Produzione**: solo in memoria, da ripetere a ogni invio (lo snapshot conserva valore scelto e intervallo).
- **Tabelle duplicate** dentro `extractRecipe` (alias e singolari delle unità), per mantenere la funzione autosufficiente negli harness di test.
- **PDF**: i totali escludono i q.b. con una nota; non c'è un totale per le ricette con quantità non risolte.
- **Rilascio**: il codice P0-c **richiede** la migrazione 0012 per salvare ingredienti con tipo (§3 di `docs/migrations/0012_ingredients_quantity_kind.md`).

## 9. Piano di collaudo su KHUB Test (da eseguire solo dopo autorizzazione)

Ordine obbligatorio: **1. migrazione su KHUB Test → 2. deploy della Preview → 3. collaudo**. Production (`main` @ `f13b6d1`) resta invariata.

1. **Migrazione** su KHUB Test secondo `docs/migrations/0012_ingredients_quantity_kind.md` §5 (verifica preliminare, copia, esecuzione, verifica successiva).
2. **Preview**: commit e push del branch solo dopo autorizzazione e conferma che la Preview usa KHUB Test.
3. **Collaudo** (nella Preview):
   1. Importare un link con «Sale q.b.», «Burro», «20–30 g acqua», «2 spicchi d'aglio», «1 baccello di vaniglia»: l'anteprima mostra q.b., campo vuoto «da indicare», «20-30», unità della fonte; nessuno «0 g».
   2. Salvare la Scheda; in KHUB Test controllare `qty_kind`, `qty_min`, `qty_max`, `source_text` delle nuove righe (sola lettura).
   3. Ricaricare la pagina: stessi valori nel LAB; nessuna bozza segnalata come modificata.
   4. Nel LAB: indicare la quantità del Burro; scrivere «qb», «3-4», un testo non valido (rifiutato).
   5. Validare con una quantità da indicare: ammesso. Rendere Attiva: rifiutato con il nome dell'ingrediente. Indicata la quantità: ammesso.
   6. Manda in Produzione: scelta dell'intervallo richiesta, fuori intervallo rifiutato; conversione dello spicchio chiesta; Sessione con «q.b.».
   7. Ricette esistenti: aprire, modificare e salvare una bozza precedente; avviare una Sessione da una Ricetta Attiva precedente: nessuna differenza.
   8. Verificare in KHUB Test che le righe precedenti abbiano ancora `qty_kind` NULL.
4. **Esito**: in caso di problemi, ripristino del codice precedente e poi rollback 0012 (§6 del documento della migrazione).
