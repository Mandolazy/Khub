# P2-a.2, blocco 2d — Dalla conversazione alla proposta di Ricetta (Fase A)

**Stato:**
- solo locale, branch `claude/p2a2-idee-ricetta` (da `3d0a1ba`);
- nessun commit, push, merge o deploy;
- migrazione 0015 **preparata, non applicata**;
- nessuna chiamata AI reale; Anthropic non configurato nella Preview, per scelta.

**Fuori da questo blocco (2e):**
- salvataggio in una Scheda, nuova o esistente;
- `linkIdeaToRecipe`;
- stato `trasformata`;
- apertura nel LAB.

Nell'anteprima di una proposta da Idea **non** ci sono destinazione né «Crea Scheda».

## 1. Server: `ideaProposal` (`api/chat.js`)
Sta nello stesso blocco di `loadIdeaTurns` e `ideaChat`: stessa sessione obbligatoria, stessi aiutanti per il database.

**Richiesta:** solo `{ideaId, rigenera?}`. Ogni altro campo, compresi modello e istruzioni, è rifiutato. Le Idee archiviate o trasformate sono rifiutate; un'Idea senza conversazione né testo riceve `proposta_senza_contenuto`.

**Funzionamento:**
1. **Contesto dal database:** Idea, fonte, note e **intera** conversazione completata, dal più vecchio al più recente. Con più di 90 000 caratteri hanno la precedenza gli scambi recenti.
2. **Istruzione dedicata `IDEA_PROPOSTA_PROMPT`:**
   - vale l'ultima decisione dello chef;
   - rifiuti e sostituzioni vanno in `scartate`, mai negli ingredienti;
   - provenienza di ogni quantità con la citazione esatta;
   - i quattro tipi di quantità di KHUB;
   - risposta `pronta:false` con una domanda se manca un'informazione essenziale;
   - solo JSON.

   Stesso modello e stesso tempo massimo della conversazione; `max_tokens` 4000. `chiamaMichelinAIIdea` accetta ora istruzione e `max_tokens` come opzioni, e la conversazione usa ancora i suoi valori (test D9).
3. **Verifica della risposta (`ideaPropostaNormalizza`):**
   - JSON obbligatorio, anche dentro un blocco di codice; forma chiusa; titolo e almeno un ingrediente;
   - nomi e testi ripuliti e limitati; passaggi vuoti tolti;
   - unità comuni normalizzate (`grammi` → `g`, `pezzi` → `n`…); le altre restano come sono, «unità della fonte», come nell'importazione;
   - **quantità coerenti con i tipi di KHUB:** una `certa` senza numero positivo o senza unità, o un `intervallo` incoerente, diventa `mancante` (`nonCoerente`); `variabile` e `mancante` non hanno quantità né provenienza;
   - **provenienza controllata sul testo reale:**
     - `chef` solo se la citazione compare davvero nelle parole dello chef (messaggi, note, titolo, spunto di un appunto) e contiene **lo stesso numero**;
     - `fonte` solo se compare nel testo della fonte di un'Idea `link` o `testo`;
     - altrimenti `ai`.

     Lo chef non riceve mai una quantità che non ha detto.
4. **Conservazione:**
   - la proposta (`tipo: 'proposta_michelinai'`) va in `ideas.preview` con `preview_origin = 'ai'`, insieme all'impronta di Idea e conversazione;
   - **stessa impronta e senza `rigenera`:** si restituisce la proposta salvata, **senza** una nuova chiamata AI;
   - non si sovrascrive mai un'anteprima `strutturata`;
   - se il database rifiuta il salvataggio (un appunto prima della 0015) la proposta arriva comunque allo chef con `salvata: false`.
5. **Limiti:** al massimo 10 proposte per Idea nelle 24 ore, più il limite giornaliero della conversazione (200 turni). Log con soli codici, nessun testo.

## 2. Interfaccia (`khub_mvp.html`)
**Dettaglio dell'Idea, riquadro «Dalla conversazione alla Ricetta»:**
- compare solo per le Idee aperte con conversazione o testo;
- **Prepara la Ricetta** usa uno stile pieno scuro, non giallo, perché il primario resta «Invia»;
- un solo invio alla volta; disattivato mentre MichelinAI risponde in chat;
- se MichelinAI chiede un chiarimento, la domanda compare qui con l'invito a rispondere nella conversazione;
- con una proposta salvata il pulsante diventa «Prepara la Ricetta (aggiornata)» e mostra la data dell'ultima proposta.

**Anteprima: la stessa `renderPreview` dell'Import Engine** con `S.loadPreview`. Le aggiunte valgono solo quando `importFonte.tipo === 'idea'`; l'importazione resta identica (test U8 e tutta la suite dell'importazione):
- riepilogo «Proposta di MichelinAI» con le **alternative scartate**, non incluse negli ingredienti;
- conteggio delle quantità da confermare, **Conferma tutte le quantità proposte**, **Rigenera la proposta**;
- correzioni:
  - **titolo, nomi degli ingredienti, quantità, unità, procedimento** (passaggi modificabili, aggiunti o tolti), **resa, porzioni, categoria**;
  - ingredienti aggiunti o tolti;
  - tutto resta nello stato a ogni ridisegno;
- **provenienza di ogni quantità:**
  - «Indicata da te», con la citazione;
  - «Dalla fonte», con la citazione;
  - «Proposta di MichelinAI · da confermare», con la casella «Confermo questa quantità»;
  - «Modificata da te», con la proposta originale visibile;
- **consenso:** le quantità di MichelinAI partono **non confermate**. Lo chef le conferma una per una o tutte insieme, oppure le modifica, e allora diventano sue. Una quantità non confermata non diventa certa: nel blocco 2e sarà salvata come «da indicare» con la proposta in nota;
- **navigazione:** la sezione Idee resta evidenziata; «Torna all'Idea». Riaprendo la stessa proposta nella sessione le correzioni restano.

## 3. Database
`ideas_appunto_chk` della 0013 vieta l'anteprima negli appunti, quindi serve la **0015**: vedi `docs/migrations/0015_ideas_appunto_proposta.md`. Senza la 0015 la funzione resta utilizzabile, ma per gli appunti la proposta non viene conservata.

## 4. Test
**`scripts/test-p2a2-idee-proposta.js`: 10/10** (server, AI simulata).

| Test | Cosa verifica |
|---|---|
| D1 | sessione |
| D2 | richieste non ammesse |
| D3 | ricostruzione e contesto |
| D4 | provenienza verificata |
| D5 | conservazione e riapertura senza AI |
| D6 | chiarimento e risposte non valide |
| D7 | senza la 0015 e anteprime strutturate |
| D8 | Ricette e conversazione intatte, log |
| D9 | M1, M2 e istruzione della chat invariati |
| D10 | 0015 e rollback |

Prova a ritroso: senza la verifica sul testo reale fallisce D4.

**`scripts/test-p2a2-idee-proposta-ui.js`: 11/11** (pagina reale, AI simulata).

| Test | Cosa verifica |
|---|---|
| U1 | presenza del pulsante |
| U2 | anteprima e scarti |
| U3 | provenienza |
| U4 | consenso |
| U5 | correzioni e riapertura |
| U5b | quantità modificata e subito un altro comando |
| U6 | chiarimento ed errore |
| U7 | HTML e script come testo |
| U8 | importazione invariata |
| U9 | smartphone |
| U10 | nessuna Ricetta creata, contratto, nessun errore |

U5b è la regressione del difetto trovato durante il lavoro: il campo modificato veniva sostituito dal ridisegno mentre il browser ne segnalava la modifica.

**Altri test toccati:**
- `scripts/_p0c-postgrest-server.js`: proposta simulata, solo con `KHUB_TEST_IA_SIMULATA=1`;
- `scripts/test-p2a1-idee.js` B4: con la 0015 un appunto accetta una proposta `ai`, quindi il caso rifiutato è ora `strutturata`.

## 5. Rischi e limiti
- **Proposte simultanee:** due richieste insieme dalla stessa Idea, per esempio da due schede del browser, possono produrre due chiamate AI. Il browser ne invia una sola alla volta; non c'è un blocco sul server come per i turni. La seconda proposta sostituisce la prima.
- **Correzioni dell'anteprima** solo nella sessione del browser: non sono salvate prima del blocco 2e. Con «Rigenera» o dopo una ricarica della pagina si riparte dalla proposta salvata.
- **Verifica della provenienza testuale:** la citazione deve comparire, a meno di maiuscole, accenti e spazi. Una parafrasi dello chef viene trattata come proposta di MichelinAI, cioè l'errore va nel verso prudente.
