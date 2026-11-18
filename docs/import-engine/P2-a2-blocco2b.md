# P2-a.2, blocco 2b — Memoria persistente delle Idee e MichelinAI per l'Ideazione

**Stato:**
- solo locale, branch `claude/p2a2-idee-conversazione` (da `e104c31`);
- nessun commit, push, merge o deploy;
- migrazione 0014 **non applicata**;
- nessuna chiamata AI reale; interfaccia invariata.

**Flusso futuro:** Idea → conversazione → proposta di Ricetta → anteprima → Schede → LAB. Questo blocco realizza solo la conversazione, lato dati e server.

## 1. Dati
Tabella `public.idea_turns`: vedi `docs/migrations/0014_idea_turns.md`.

## 2. Azioni server (`api/chat.js`)
Entrambe passano dal controllo di sessione esistente: senza sessione 401, prima di qualunque lettura.

**`loadIdeaTurns {ideaId}`**
- restituisce `{ok:true, turns}` in ordine `created_at, id`, falliti compresi (la UI potrà offrire «Riprova»);
- funziona anche per le Idee archiviate o trasformate;
- non espone impronta né prenotazione.

**`ideaChat {ideaId, turnId, message, origin}`**
- **Campi ammessi solo questi.** `model`, `system`, `messages` o altro vengono rifiutati (`richiesta_non_valida`).
- **Contesto letto dal database:** titolo, tipo, link, spunto o testo (≤ 8000 caratteri), note (≤ 5000), scambi **completati**.
- **Istruzione di partenza `IDEA_SYSTEM_PROMPT`** e stesso modello di M2 (`claude-sonnet-5-5`), con `max_tokens` 1500.
- **Risposta:** `{ok:true, turn}`, oppure `{ok:false, code, error, retry?, turnId?}`.

| Codice | Significato |
|---|---|
| `idea_non_valida`, `idea_non_trovata` | Idea non valida o inesistente |
| `richiesta_non_valida`, `messaggio_non_valido` | richiesta o messaggio non ammessi |
| `idea_archiviata`, `idea_trasformata` | Idea chiusa: nessun nuovo messaggio |
| `turno_non_valido` | `turnId` già usato per un altro messaggio |
| `turno_in_elaborazione` | lo stesso messaggio è ancora in elaborazione |
| `idea_occupata` | un altro messaggio di questa Idea è in elaborazione |
| `tentativi_esauriti` | troppi tentativi per questo turno |
| `limite_turni`, `limite_giornaliero` | limiti d'uso superati |
| `ai_non_disponibile`, `ai_tempo_scaduto`, `risposta_non_valida`, `ai_non_configurata` | problema dell'AI |
| `idee_non_disponibili` | errore imprevisto |

**M1 e M2 non cambiano.** Prompt, costruzione dei messaggi e rami `mode:m1/m2` sono identici a `e104c31` (test C17). Il blocco delle Idee non usa `M2_SYSTEM_PROMPT`.

## 3. MichelinAI per l'Ideazione
`IDEA_SYSTEM_PROMPT` copre:
- conversazione libera senza Ricetta strutturata;
- attenzione al risultato voluto dallo chef;
- alternative, al massimo tre per volta;
- memoria delle scelte e dei rifiuti, senza riproporre ciò che è stato scartato;
- quantità indicative dichiarate come proposte;
- **nessuna quantità attribuita allo chef se non l'ha indicata**;
- quantità della fonte segnalate come tali;
- la stessa regola epistemica di MichelinAI;
- nessuna trasformazione in Ricetta;
- link non letto;
- testi della fonte e note trattati come materiale, non come istruzioni (protezione da istruzioni nascoste nel testo).

## 4. Idempotenza e affidabilità
Meccanismo atomico sul database, senza servizi esterni e compatibile con le funzioni serverless.
1. **Prenotazione prima dell'AI.** `INSERT` del turno con `status='in_corso'`, `attempts=1` e `lease_until = adesso + 180 s`:
   - la chiave primaria fa vincere una sola richiesta tra invii simultanei dello stesso `turnId`;
   - l'indice unico parziale ammette un solo turno in corso per Idea.
2. **Stesso `turnId` già presente:**
   - completato con la stessa impronta e la stessa Idea: restituisce la risposta salvata, senza AI (`ripetuto: true`);
   - impronta o Idea diverse: `turno_non_valido`;
   - in corso e non scaduto: `turno_in_elaborazione` (retry);
   - fallito, o in corso con prenotazione scaduta: ripresa con `UPDATE … where attempts = <letto>`. È concorrenza ottimistica: vince uno solo; al massimo 3 elaborazioni, poi `tentativi_esauriti`.
3. **Prenotazioni scadute** (funzione interrotta da timeout o crash) di quell'Idea: chiuse come `fallito / interrotto` prima di ogni nuova prenotazione. Nessun blocco permanente.
4. **Chiusura condizionata allo stesso tentativo**, `status=in_corso & attempts=<mio>`:
   - una risposta arrivata dopo che altri hanno ripreso il turno non sovrascrive nulla (`turno_in_elaborazione`);
   - un errore dell'AI chiude come `fallito` con il codice;
   - un errore imprevisto del server chiude, se possibile, come `fallito / errore_server`; altrimenti la prenotazione scade da sola.
5. **Tempi:** la chiamata AI ha un tempo massimo di 60 s, inferiore alla prenotazione di 180 s.

## 5. Limiti e costi (costanti `IDEA_CHAT`, controllati prima dell'AI)
- messaggio: 4000 caratteri;
- scambi non falliti per Idea: 80;
- turni avviati nelle ultime 24 ore, tutte le Idee insieme: 200. Finestra mobile; i retry non creano righe, ma ognuno è contato nei 3 tentativi massimi;
- contesto: 60 000 caratteri. Prima l'Idea, poi gli scambi più recenti che entrano; gli altri sono omessi con un avviso;
- risposta: `max_tokens` 1500, al massimo 20 000 caratteri salvati;
- **log:** solo stato HTTP e tipo d'errore. Mai chiavi, mai testi dello chef: dal database si registra solo il codice d'errore (test C16).

Nessuna API nuova a pagamento.

## 6. Test
`scripts/test-p2a2-idee-conversazione.js`: 18/18. Server reale nello stesso processo, PostgreSQL + PostgREST locali, Anthropic simulato.

| Test | Cosa verifica |
|---|---|
| C1 | nessuna sessione |
| C2 | validazione; il browser non può scegliere modello, istruzioni o cronologia |
| C3 | primo scambio e contesto letto dal database |
| C4 | cronologia, ordine, persistenza dopo il riavvio |
| C5 | retry e riuso del `turnId` |
| C6 | invii simultanei dello stesso turno: una sola chiamata AI |
| C7 | messaggi simultanei diversi |
| C8 | errori dell'AI e ripresa |
| C9 | elaborazioni interrotte |
| C10 | tentativi |
| C11 | Idea archiviata o trasformata |
| C12 | dimensione del contesto |
| C13 | limiti d'uso |
| C14 | accesso diretto negato e privilegi |
| C15 | vincoli del database |
| C16 | log e Ricette intatte |
| C17 | immutabilità di M1 e M2 |
| C18 | migrazione e rollback |

**Prova a ritroso**, con il server indebolito in una copia:
- senza controllo dell'impronta fallisce C5;
- senza gestione del conflitto falliscono C6, C7 e C9;
- senza chiusura delle prenotazioni scadute fallisce C9.

## 7. File
| File | Modifica |
|---|---|
| `supabase/migrations/0014_idea_turns.sql` | nuova migrazione (non applicata) |
| `supabase/rollback/PREPARED_NOT_EXECUTED__0014_idea_turns_rollback.sql` | nuovo rollback protetto |
| `supabase/rollback/PREPARED_NOT_EXECUTED__0013_ideas_rollback.sql` | si ferma se esiste `idea_turns` (ordine 0014 → 0013) |
| `api/chat.js` | azioni `loadIdeaTurns` e `ideaChat`; blocco Idee in fondo al modulo; `idea_turns` tra le tabelle lette dal server; `createHash` importato |
| `scripts/test-p2a2-idee-conversazione.js` | nuovo, 18 test |
| `scripts/test-p2a1-idee.js` | B9: rollback nell'ordine 0014 → 0013 |
| `docs/migrations/0014_idea_turns.md`, questo file | documentazione e procedura per KHUB Test |

`khub_mvp.html` (interfaccia) non cambia.

## 8. Limiti noti (approvati come tali, non da risolvere in questo blocco)
1. **Tetto giornaliero provvisorio.** I 200 turni nelle 24 ore sono una protezione tecnica di tutta l'installazione. **Non** sono il futuro sistema di crediti per cliente: quel sistema (misura per cliente o utente, piani, consumo reale in token) andrà progettato a parte.
2. **Idempotenza e costi AI.** L'idempotenza impedisce turni duplicati e una seconda elaborazione mentre la prima è valida. **Non può garantire** l'assenza di una seconda chiamata AI fatturabile dopo un'interruzione. Se la funzione si ferma dopo che Anthropic ha già elaborato la richiesta, la risposta va persa: alla ripresa (retry dello stesso turno, al massimo 3 tentativi) la chiamata si ripete ed è fatturata di nuovo.
3. **Durata delle funzioni Vercel da verificare prima di usare l'AI reale.** `vercel.json` non fissa `maxDuration`. Se il piano interrompe la funzione prima dei 60 s concessi alla chiamata AI, il turno resta `in_corso` fino alla scadenza (180 s), poi si chiude o si riprende; vale anche il punto 2.

## 9. Altri rischi residui
- **Orologio:** le scadenze usano l'ora del server applicativo confrontata con quella del database. Una differenza di pochi secondi è assorbita dalla prenotazione di 180 s.
- **Proxy AI generico** (preesistente): qualunque richiesta senza `supabaseAction` né `mode` viene inoltrata ad Anthropic. Non riguarda le Idee, ma resta da chiudere in una fase dedicata.
- **Costi:** il tetto giornaliero (200) va confermato con i prezzi del modello, da verificare sul listino attuale (vedi limiti noti, punto 1).
- **Cronologia lunga:** oltre i 60 000 caratteri gli scambi più vecchi non sono inviati. Le decisioni prese all'inizio potrebbero non essere più nel contesto; il riassunto delle decisioni è previsto con la proposta di Ricetta (blocco 2d).
