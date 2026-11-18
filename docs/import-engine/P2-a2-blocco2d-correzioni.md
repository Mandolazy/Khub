# P2-a.2 — Correzioni al blocco 2d (fatte durante il blocco 2e)

**Stato:** solo locale, nessun commit. Il blocco 2d è in `adcf827`; il suo documento (`P2-a2-blocco2d.md`) resta invariato e queste note lo integrano.

## C1. Una sola proposta alla volta per Idea (server)
**Difetto del 2d (§5, «Proposte simultanee»):** due richieste insieme per la stessa Idea, per esempio da due schede del browser, potevano produrre due chiamate AI. La seconda proposta sostituiva la prima.

**Correzione:** prenotazione minima nel database, nella tabella `idea_proposal_locks` (migrazione **0016**, preparata e non applicata): una riga per Idea con `idea_id` e `started_at`.

**In `ideaProposal`**, dopo i controlli e la verifica della proposta salvata, prima della chiamata AI:
1. `INSERT` della prenotazione: la chiave primaria fa vincere **una sola** richiesta;
2. se esiste già, si riprende **solo se scaduta** (più di 120 s), con un `UPDATE … where started_at < scadenza`. Altrimenti la risposta è `proposta_in_corso` con `retry: true`, senza chiamata AI;
3. rilascio nel `finally`, anche dopo un errore AI: `started_at` riportato al 1970, solo se la prenotazione è ancora quella di questa richiesta.

**Cosa non passa dalla prenotazione:**
- la **riapertura** di una proposta salvata (stessa impronta, senza «Rigenera»), che non chiama l'AI;
- i turni della conversazione, che hanno già la loro prenotazione (0014).

**Senza la 0016:** PostgREST risponde 404, la prenotazione è ignorata e il comportamento è quello del 2d. Il 404 non viene registrato nei log.

**Nessuna infrastruttura nuova:** stesso database, stesso PostgREST, stessi privilegi del solo server.

**Test:** `test-p2a2-idee-scheda.js` S7, S8, S9. Il test del 2d resta 10/10.

## C2. Resa proposta da MichelinAI: consenso esplicito (interfaccia)
**Difetto del 2d:** le quantità di MichelinAI partivano non confermate, ma la **resa** proposta da MichelinAI compariva nei campi della resa senza nessuna indicazione. Col salvataggio del 2e sarebbe diventata una resa dichiarata certa.

**Correzione:**
- `ideaPropostaInAnteprima` conserva la resa proposta (`resaProposta`, `resaConfermata: false`);
- l'anteprima mostra «Confermo la resa proposta da MichelinAI (6 porzioni)»;
- al salvataggio una resa di MichelinAI **non confermata e non modificata** non diventa resa dichiarata: va nella nota della Bozza.

Una resa indicata dallo chef o dalla fonte non cambia.

**Test:** `test-p2a2-idee-scheda-ui.js` E1.

## C3. Fine dell'anteprima da Idea
Il riquadro del 2d «Il salvataggio in una Scheda e l'apertura nel LAB arrivano nel passaggio successivo» è sostituito da destinazione e salvataggio (2e). Il test U2 del 2d controlla ancora che manchino i comandi dell'**importazione** (`#btn-save-preview`, `#prev-scheda-esistente`), e quelli da Idea hanno id propri.
