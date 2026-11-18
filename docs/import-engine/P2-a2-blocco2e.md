# P2-a.2, blocco 2e — Dalla proposta confermata alla Bozza nel LAB

**Stato:**
- solo locale, branch `claude/p2a2-idee-ricetta` (dopo `adcf827`, blocco 2d);
- nessun commit, push, merge o deploy;
- migrazione 0016 **preparata, non applicata** (la 0015 resta preparata, non applicata);
- nessuna chiamata AI reale.

Le correzioni al blocco 2d sono descritte a parte: `docs/import-engine/P2-a2-blocco2d-correzioni.md`.

## 1. Percorso
Idea → «Prepara la Ricetta» → anteprima confermata → **Scheda nuova o esistente** → salvataggio confermato dal database → collegamento dell'Idea → **Bozza aperta nel LAB**.

1. **Destinazione** nell'anteprima della proposta, la stessa scelta dell'importazione (`S.loadDestinazione`):
   - **Nuova Scheda** → «Crea la Scheda e apri nel LAB»;
   - **Scheda esistente** → «Aggiungi come Bozza e apri nel LAB»: la Ricetta entra come **nuova Bozza**; Ricetta attiva e altre Bozze non cambiano.
2. **Controlli prima di tutto** (`ideaPrevPerSalvataggio`), senza nessuna richiesta se falliscono: nome, Scheda scelta, porzioni, g/porzione, resa, unità delle quantità certe o a intervallo, almeno un ingrediente con il nome.
3. **Contenuto fissato e id fissati** prima del primo tentativo: Scheda (`r…`), Bozza (`lv…`) e ingredienti (`lv…_1`, `_2`…) in un **registro per Idea**, tenuto nello stato e nel browser (`localStorage`, chiave `khub.ideaSalvataggio.<id>`).
4. **Salvataggio con il sistema normale delle Schede:** `savePreview({rif})` costruisce la Scheda o la Bozza esattamente come l'importazione, poi `saveToSupabase` la salva. Il collegamento parte **solo** dopo la risposta `ok` del database.
5. **Collegamento:** nuova azione server `linkIdeaToRecipe`. L'Idea diventa `trasformata` con `linked_recipe_id` e `linked_variant_id`.
6. **LAB:** `apriBozzaDalLabGlobale(recipeId, variantId)` apre proprio la nuova Bozza.

**Cosa viene salvato:**
- **Ingredienti, quantità, unità, procedimento, nome, categoria, porzioni** come corretti dallo chef nell'anteprima. Ingredienti senza nome e passaggi vuoti vengono tolti.
- **Quantità:**
  - **confermata** (dallo chef, dalla fonte, oppure proposta da MichelinAI e confermata) → `certa` o `intervallo`;
  - **proposta da MichelinAI e non confermata** → `mancante` («da indicare»), con nella nota dell'ingrediente (`source_text`) «Proposta di MichelinAI, non confermata: 250 g». L'unità proposta resta come suggerimento.
- **Citazioni:** la citazione dello chef o della fonte va nella nota dell'ingrediente, solo se lo chef non ha modificato la quantità.
- **Resa:**
  - proposta da MichelinAI → salvata solo se lo chef la conferma o la modifica;
  - altrimenti va nella nota della Bozza («Resa proposta da MichelinAI, non confermata: 6 porzioni»).
- **Nota della Bozza:** «Dall'Idea «titolo»».
- **Idea:** titolo, note, proposta (`preview`) e conversazione (`idea_turns`) **restano com'erano**. La conversazione diventa in sola lettura, come per ogni Idea trasformata.

## 2. Nessun duplicato
| Situazione | Cosa succede |
|---|---|
| Salvataggio rifiutato o rete assente | Sparisce la Scheda (o Bozza) locale non salvata. L'Idea resta aperta e **nessun collegamento** parte. «Riprova il salvataggio» usa lo stesso registro. |
| Risposta persa: il database ha scritto, la pagina non lo sa | «Riprova» riscrive **le stesse righe** (upsert per id): nessuna Scheda, Bozza o riga in più (test E4). |
| Salvataggio riuscito, collegamento fallito | «Collega di nuovo» collega **senza salvare di nuovo**. Si può comunque aprire la Bozza nel LAB. |
| Pagina chiusa o ricaricata a metà | Il registro resta nel browser. Nel dettaglio dell'Idea compare «Riprendi il salvataggio» al posto di «Prepara la Ricetta», così non si avvia una seconda Ricetta. Un tentativo interrotto si ripete con gli stessi id (E5, E6). |
| Doppio clic | Un solo tentativo alla volta. |

**Dopo il primo tentativo il contenuto non si modifica più nell'anteprima:**
- compare il riquadro «Dalla proposta alla Bozza», con lo stato del salvataggio;
- le correzioni successive si fanno nella Bozza, nel LAB.

Così ogni ripetizione invia esattamente lo stesso contenuto.

## 3. Server: `linkIdeaToRecipe` (`api/chat.js`)
Sta nello stesso blocco di `loadIdeaTurns`, `ideaChat` e `ideaProposal`: sessione obbligatoria, stessi aiutanti, percorsi costanti (`ideas`, `idea_turns`, `idea_proposal_locks`, `variants`).

**Richiesta:** solo `{ideaId, recipeId, variantId}`. Ogni altro campo è rifiutato; gli id sono validati.

**Controlli, prima di scrivere:**
- Idea esistente e `aperta`. Se è archiviata → `idea_archiviata`. Se è già trasformata con **gli stessi** id → `ok`, `ripetuto: true`; con id diversi → `idea_gia_trasformata`;
- la Bozza **esiste nel database**: altrimenti `ricetta_non_trovata`, con `retry: true`;
- la Bozza appartiene a quella Scheda ed è in LAB (`status = 'lab'`): una Ricetta attiva non si collega (`ricetta_non_valida`).

**Scrittura:** un solo `PATCH ideas … &status=eq.aperta`: diventa `trasformata` con i due id. Se nel frattempo l'Idea è cambiata, il PATCH non trova righe: si rilegge l'Idea, e se il collegamento è lo stesso la risposta è `ok`, altrimenti `idea_cambiata`.

**Non tocca mai:** Ricette, Bozze, ingredienti, conversazione, proposta. Log con soli codici.

## 4. Interfaccia (`khub_mvp.html`)
**`savePreview(opz)`:** stessa funzione dell'importazione. Senza argomento il comportamento è identico (test E8, e la suite dell'importazione). Con `opz.rif`:
- id della Scheda, della Bozza e degli ingredienti presi dal registro;
- una Scheda o una Bozza già presente non si aggiunge di nuovo;
- nessuna navigazione, nessun salvataggio automatico dopo 200 ms;
- restituisce gli id, e il chiamante **attende** `saveToSupabase`.

**Nuove funzioni:**
- `ideaSalvaLeggi` / `ideaSalvaScrivi`: il registro;
- `ideaPrevPerSalvataggio`: i controlli e il contenuto da salvare;
- `ideaSalvaRicetta`, `ideaSalvaEsegui`, `ideaCollegaEsegui`, `ideaApriBozzaSalvata`, `ideaRiprendiSalvataggio`;
- `ideaSalvataggioHtml`, `ideaPrevDestinazioneHtml`;
- `ideaPrevConfermaResa`.

**Anteprima:**
- «Il salvataggio … arriva nel passaggio successivo» è sostituito da destinazione e pulsante;
- **conferma della resa** proposta da MichelinAI.

**Dettaglio dell'Idea:** «Riprendi il salvataggio» quando c'è un registro aperto.

## 5. Una sola proposta alla volta (correzione del 2d)
Vedi `P2-a2-blocco2d-correzioni.md` e `docs/migrations/0016_idea_proposal_locks.md`.

## 6. Test
**`scripts/test-p2a2-idee-scheda.js`: 10/10** (server, AI simulata).

| Test | Cosa verifica |
|---|---|
| S1 | sessione |
| S2 | richieste non ammesse, Ricetta non salvata, Bozza di un'altra Scheda, Ricetta attiva |
| S3 | nuova Scheda salvata con l'azione `save`, poi collegamento; conversazione e proposta intatte |
| S4 | salvataggio ripetuto = stesse righe; collegamento ripetuto ok; un'altra Ricetta rifiutata |
| S5 | Scheda esistente: Ricetta attiva invariata |
| S6 | Idea archiviata |
| S7 | due proposte simultanee = una chiamata AI; prenotazione rilasciata, anche dopo un errore AI; prenotazione scaduta ripresa |
| S8 | senza la 0016 come nel 2d, nessun errore nei log |
| S9 | 0016 idempotente, privilegi, rollback, log puliti |
| S10 | M1, M2 e `save` invariati rispetto al 2d |

**`scripts/test-p2a2-idee-scheda-ui.js`: 10/10** (pagina reale, AI simulata, guasti simulati sulle richieste della pagina).

| Test | Cosa verifica |
|---|---|
| E1 | nuova Scheda: correzioni salvate, confermate certe, non confermate «da indicare» con nota, resa non confermata non salvata, ordine `save` → `linkIdeaToRecipe`, LAB sulla nuova Bozza, nessuna chiamata AI |
| E2 | Idea trasformata: conversazione in sola lettura, collegamento visibile |
| E3 | Scheda esistente |
| E4 | salvataggio fallito e risposta persa, senza duplicati |
| E5 | collegamento fallito, ricarica, «Collega di nuovo» senza salvare di nuovo |
| E6 | pagina chiusa a metà |
| E7 | controlli |
| E8 | importazione invariata |
| E9 | smartphone |
| E10 | nessun errore, azioni previste |

**Prova a ritroso:** con un id nuovo della Scheda a ogni tentativo falliscono E1, E2, E4, E5 ed E6 (Schede duplicate).

**Altri test e file toccati:**
- `test-preview-direzione-3.js` P2: `savePreview` aggiunta alle funzioni che possono cambiare, con il motivo. La firma `function savePreview()` resta invariata (l'argomento si legge da `arguments[0]`), perché quattro test dell'importazione estraggono la funzione per nome;
- `test-p2a1-idee.js` B9 e `supabase/rollback/PREPARED_NOT_EXECUTED__0013_ideas_rollback.sql`: con la 0016 applicata, il rollback della 0013 ora si ferma con un messaggio esplicito e chiede prima il rollback della 0016. Prima falliva a metà con un errore generico di dipendenza.

## 7. Rischi e limiti
- **Registro nel browser:** «Riprendi il salvataggio» vale nello stesso browser. Da un altro dispositivo, durante un tentativo non concluso, l'Idea risulta ancora aperta. Una nuova preparazione lì creerebbe un'altra Scheda; il database è comunque coerente, perché l'Idea si collega a una sola.
- **Contenuto fissato:** se il salvataggio continua a fallire per un motivo permanente, non si torna a modificare l'anteprima. Si riprova, oppure si interviene nel LAB dopo un salvataggio riuscito. È una scelta voluta: modificare dopo un tentativo forse arrivato al database potrebbe lasciare righe vecchie.
- **Scheda esistente:** `saveToSupabase` invia l'intera Scheda, come ogni salvataggio del LAB. Le Ricette attive non cambiate non vengono inviate (LAB FIX 1).
- **Senza la 0016** le proposte simultanee restano possibili, come nel 2d.
