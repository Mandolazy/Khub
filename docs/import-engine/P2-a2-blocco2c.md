# P2-a.2, blocco 2c — Conversazione con MichelinAI nel dettaglio dell'Idea

**Stato:**
- solo locale, branch `claude/p2a2-idee-chat` (da `560288c`);
- nessun commit, push, merge o deploy;
- nessuna migrazione, che è la 0014, già applicata su KHUB Test;
- nessuna chiamata AI reale; nessuna modifica al server: `api/chat.js` è identico a `560288c`.

## 1. Interfaccia (`khub_mvp.html`)
Il segnaposto «Conversazione con MichelinAI — Previsto» è sostituito da una conversazione vera.

**Messaggi:**
- in ordine cronologico, come li restituisce `loadIdeaTurns`;
- bolle dello chef (destra, tinta gialla, «Tu», con «· dettato» se il messaggio è nato dalla voce) e di MichelinAI (sinistra, chiare, «MichelinAI»): distinguibili anche senza colori.

**Campo e azioni:**
- campo libero fino a 4000 caratteri;
- **Invia**, l'azione primaria del dettaglio: «Salva note» diventa secondaria;
- **Detta**;
- Ctrl+Invio per inviare. Nessuna domanda guidata e nessun percorso a scelta.

**Durante la risposta:**
- il messaggio passa subito dal campo alla conversazione;
- compare la bolla «Sta rispondendo…»;
- **Invia** resta disattivato («MichelinAI sta rispondendo…»).

**Errori comprensibili:**

| Situazione | Cosa vede lo chef |
|---|---|
| Rete, sessione o esito incerto | il messaggio torna nel campo con lo stesso `turnId` |
| Idea occupata, limiti | spiegazione; il messaggio resta nel campo |
| Turno fallito sul server | bolla d'errore con **Riprova** |
| Dopo 3 tentativi | **Riscrivi il messaggio** |
| Elaborazione interrotta (prenotazione scaduta) | «L'elaborazione si è interrotta» con **Riprova** |

**Scorrimento:** la pagina, non un riquadro interno, scende sull'ultimo scambio; funziona anche da smartphone.

**Sola lettura:** le Idee archiviate o trasformate mostrano la cronologia senza campo, senza **Invia** e senza **Riprova**.

**Avviso fisso sotto il campo:** «Le quantità proposte da MichelinAI sono indicative: diventano tue solo quando le scegli».

**Testi:** sempre come testo (`escAttr`, `white-space: pre-wrap`); nessun HTML interpretato.

## 2. Dettatura
- Riusa `startDictation` con il target `idea-chat`: un solo microfono alla volta.
- Il testo viene **aggiunto** al campo, si può correggere e non viene mai inviato da solo.
- Nessun audio salvato, nessun servizio esterno.
- Se il messaggio nasce dalla voce, l'origine inviata è `voce`.
- Si ferma uscendo dalla schermata.
- Nei browser senza riconoscimento vocale il pulsante non c'è e un'indicazione dice che si può scrivere.

## 3. API e invii (solo `loadIdeaTurns` e `ideaChat`)
- **Richiesta:** il browser invia solo `ideaId`, `turnId`, `message` e `origin`. Il server costruisce il contesto da Idea e scambi salvati (blocco 2b).
- **`turnId`:** `it_` + 24 cifre esadecimali casuali (`crypto.getRandomValues`), uno per ogni nuovo messaggio.
- **Bozza locale per Idea** (`localStorage`, chiave `khub_idea_chat_<id>`): testo non inviato e, finché l'esito non è certo, `turnId` con il testo inviato. Lo **stesso testo** riusa lo **stesso `turnId`**, quindi l'idempotenza è quella del server: in questo blocco non ce n'è un'altra.
- **Un solo invio alla volta per Idea:** i doppi clic, Ctrl+Invio e chiamate ripetute producono una sola richiesta.
- **Dopo ogni invio** la conversazione viene riletta dal server: ogni turno compare una volta sola, per id.
- **Riapertura o ricarica:**
  1. si legge la conversazione;
  2. un messaggio in sospeso già presente sul server esce dal campo;
  3. uno mai arrivato torna nel campo con lo stesso `turnId`;
  4. i turni in elaborazione vengono ricontrollati ogni 4 secondi finché arriva la risposta o scade la prenotazione (180 s + margine); poi appaiono come interrotti, con **Riprova**.
- **Retry di un turno salvato:** stesso `turnId` e stesso testo; il server lo riprende (al massimo 3 tentativi).

## 4. Costi e sicurezza
- **Durata delle funzioni Vercel: DA VERIFICARE prima delle chiamate AI reali.**
  - `vercel.json` non fissa `maxDuration`, `api/chat.js` non dichiara una configurazione e dal repository non si può sapere se il progetto ha Fluid compute attivo.
  - Con Fluid compute attivo la durata predefinita è 300 s su ogni piano (documentazione Vercel): compatibile con i 60 s della chiamata AI e con la prenotazione di 180 s.
  - Senza Fluid compute vale il limite del piano e potrebbe essere troppo basso.
  - Da controllare nel progetto Vercel: Settings → Functions (Fluid compute e durata massima) o nei dettagli della funzione di una Preview.
- **Limite giornaliero:** attivo sul server, 200 turni nelle 24 ore (blocco 2b, test C13); provvisorio, non è il sistema di crediti.
- **Autenticazione obbligatoria:** senza sessione 401 prima di qualunque lettura o chiamata AI (blocco 2b, test C1).
- **Log:** nessuna chiave e nessun testo dello chef nei log (blocco 2b, test C16; test K15).
- **M2 del LAB invariato:** prompt e rami identici (blocco 2b, test C17). In questo blocco `api/chat.js` non cambia.
- **Nessuna nuova API a pagamento.**

## 5. Test
**`scripts/test-p2a2-idee-chat-ui.js`: 15/15.** Pagina reale e server reale, con Anthropic **simulato** nel server di test (`KHUB_TEST_IA_SIMULATA=1`), su PostgREST e PostgreSQL locali.

| Test | Cosa verifica |
|---|---|
| K1 | apertura |
| K2 | invio con indicatore |
| K3 | scenario albicocche e rosmarino, con la cronologia inviata all'AI |
| K4 | doppi invii |
| K5 | due schede del browser: «Idea occupata» |
| K6 | ricaricamento e bozza |
| K7 | esito perso nella rete: stesso `turnId`, una sola chiamata AI |
| K8 | ricarica durante l'elaborazione |
| K9 | turno interrotto |
| K10 | errori dell'AI, **Riprova**, **Riscrivi il messaggio** |
| K11 | sola lettura |
| K12 | dettatura con e senza supporto del browser |
| K13 | HTML e script mostrati come testo |
| K14 | smartphone |
| K15 | nessuna regressione, contratto delle azioni, log |

**Altre modifiche ai test:**
- `scripts/_p0c-postgrest-server.js` ha un MichelinAI simulato, attivo solo con quell'opzione; senza, il server di test non cambia;
- in `scripts/test-p2a2-idee-ui.js`:
  - G1 controlla «Invia» primario e «Salva note» secondario;
  - Z1 ammette `loadIdeaTurns`;
  - C1 legge gli stili ripetendo la lettura mentre la conversazione si carica.

## 6. Collaudo sulla Preview KHUB Test (dopo autorizzazione)
1. Verificare la durata delle funzioni Vercel (§4).
2. Push del branch e Preview pronta.
3. Aprire un'Idea aperta: deve comparire «Racconta a MichelinAI…» senza errori. Nessuna chiamata AI.
4. **Chiamata 1:** «Vorrei creare un dessert con albicocche e rosmarino». Attesa, risposta, campo vuoto.
5. **Chiamata 2:** «Non voglio muffin. Preferisco un dolce al cucchiaio». La risposta deve tenere conto del rifiuto.
6. **Chiamata 3:** «Mi piace. Metterei le noci al posto delle mandorle. Quali ingredienti e quantità indicative mi suggerisci?». Quantità presentate come proposte, noci recepite.
7. Ricaricare la pagina: stessi 3 scambi, nello stesso ordine, senza nuove chiamate.
8. In Supabase, sola lettura:

   ```sql
   select status, count(*) from public.idea_turns group by status;
   ```
   Atteso: `completato = 3`.
9. Facoltativo, senza costi: un'Idea archiviata mostra la conversazione in sola lettura.

**Chiamate AI reali minime: 3.**
- La prima verifica il funzionamento.
- La seconda verifica la memoria di un rifiuto.
- La terza verifica una preferenza e le quantità indicative.

Riprova, errori e doppi invii sono coperti dai test con l'AI simulata e non richiedono altre chiamate reali.
