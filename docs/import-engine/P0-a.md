# Import Engine 2.0 — P0-a: importazione sicura e onesta

Base: `0de0e8f` (Production al momento dell'autorizzazione). Riferimenti: piano esecutivo P0 (sezione C, A1–A8) e inventario dei punti di inserimento nel DOM.
Nessuna modifica a database, migrazioni, variabili d'ambiente, `middleware.js`, `vercel.json`, M1/M2 (contratti e chiamate), calcoli, LAB o Produzione oltre all'escape dei testi visualizzati.

## Modifiche

### `api/chat.js`
- **`acquisisciPagina(url)`** sostituisce il `fetch` libero di `body.fetchUrl`.
  - Solo `http`/`https`, nessuna credenziale nell'URL, porte 80/443, URL ≤ 2.048 caratteri.
  - **DNS risolto una sola volta.** Ogni indirizzo deve essere pubblico (`paginaIndirizzoPubblico`, `net.BlockList`):
    - vietati loopback, reti private, link-local/metadati cloud, CGNAT, riservati, multicast, IPv6 locali, NAT64, 6to4, Teredo;
    - gli IPv4-mapped sono valutati sull'IPv4.
  - **Connessione fissata agli indirizzi validati** (opzione `lookup`): nessuna seconda risoluzione, quindi nessun rebinding DNS tra controllo e connessione. Gli IP letterali sono validati prima della connessione.
  - **Redirect** gestiti a mano, massimo 5, ogni destinazione rivalidata da capo.
  - **Limiti:**
    - tempo massimo 15 s complessivi;
    - massimo 3,5 MB, anche dopo la decompressione gzip/deflate/br (oltre si tronca e si segnala `troncato`);
    - solo `text/html` e `application/xhtml+xml`, oppure tipo assente con corpo HTML;
    - contenuti binari respinti.
  - **Stato HTTP della fonte restituito come codice** (`http_403`, …): la pagina d'errore non arriva mai al client.
  - Intestazioni verso i siti invariate (stesso `User-Agent`, `Accept`, `Accept-Language`); in più `Accept-Encoding` con decompressione.
- **Ramo `fetchUrl` dell'handler:**
  - successo `200 {ok:true, html, finalUrl, status, troncato}`;
  - fallimento `422`/`502`/`504` `{ok:false, code, error}`, senza dettagli interni.
  - Le funzioni di accesso (`khubAccessDenied`), della chiave Supabase e del proxy AI sono invariate.

### `khub_mvp.html`
- **`extractRecipe`** (tutte le funzioni di supporto sono interne alla funzione):
  - **Pagina web:** letta da un documento inerte (`DOMParser`, `documentElement.textContent`). Il testo estratto è identico a prima; gestori come `onerror` non vengono eseguiti.
  - **Nessuna ricetta dal solo URL:** se la pagina non è acquisita, ha meno di 200 caratteri di testo o mostra una verifica anti-bot, l'AI non viene chiamata. Lo chef riceve un messaggio specifico e il pulsante **"Incolla il testo"**. Il prompt "Usa il nome nell'URL per dedurre la ricetta" è stato rimosso.
  - **Video:** nessuna chiamata AI e nessuna lettura; messaggio "non è stato acquisito né analizzato".
  - **Foto:** formati diversi da JPG, PNG, GIF, WebP (per esempio HEIC) respinti prima della chiamata.
  - **Errori AI distinti:** sessione, configurazione, sovraccarico o occupato, limite tecnico (413, troncamento), formato, rifiuto, risposta non interpretabile, nessuna ricetta riconosciuta, rete o tempo (120 s). Nessun dettaglio del server o del servizio viene mostrato.
  - **Neutralizzazione del testo restituito dall'AI** prima che entri nei dati: nome, categoria, ingredienti, unità, passi, sottoricette, unità della resa.
    - Entità decodificate in più passaggi.
    - Tag completi e aperti rimossi.
    - Nessuna entità residua.
    - Virgolette dritte → `”`.
    - Restano apostrofi, simboli, a capo e "<80 °C".
    - La citazione della resa (`source`) resta letterale (serve alla verifica) ed è già mostrata con `escAttr`.
  - Prompt, modello, token, normalizzazione delle quantità e verifica della resa: **invariati**.
- **Escape (`escAttr`) dei testi nel perimetro P0-a:**
  - `renderLoad`: testo incollato nella `textarea`, URL, anteprima dell'immagine;
  - `renderPreview`: nome, categoria, ingredienti, quantità, passi, sottoricette, Schede nella selezione;
  - `renderSearch`;
  - toast (`render`, `renderToastAction`);
  - `exportPDF` (finestra nella stessa origine);
  - `renderContenutoVariante`;
  - `renderRicettaMadreV2` (nomi di Scheda e Ricette, compreso `_name` delle bozze);
  - `renderLabRecipe`: titolo, categoria, etichette delle bozze, ingredienti, mattoncini, passi, confronto, Ricette validate, testo e osservazioni del Primo Consulto M1.
- Stato `S.loadError` e riquadro dell'esito nella scheda di caricamento; azzerato al cambio di scheda e a ogni nuova estrazione.
- Scheda Video: avviso esplicito al posto del campo URL e del pulsante di estrazione; pulsante "Vai a Testo". Formati foto dichiarati: "JPG, PNG, WebP".

## Test T-0 (offline, nessuna AI, nessun database)

| Suite | Contenuto |
|---|---|
| `scripts/test-import-p0a-fetch.js` (13) | Regola degli indirizzi; schemi, credenziali, porte; IP letterali (anche numerici o ottali); DNS verso reti vietate; pagina valida identica; compressione; MIME e binari; errori HTTP; dimensione e "bomba"; timeout; redirect; rebinding; handler senza dettagli interni |
| `scripts/test-import-p0a-estrazione.js` (10) | Non regressione di testo e foto **contro `extractRecipe` di `0de0e8f`** (stessa richiesta, stessa anteprima); neutralizzazione; testi normali intatti; video; link non leggibili; errori AI; formati foto; prompt invariato |
| `scripts/test-import-p0a-ui.js` (9) | Chromium sulla demo locale isolata: payload eseguibili in anteprima, Scheda D3/classica, LAB, M1, toast e PDF; link valido e non valido; video; foto; errori; importazione in Scheda esistente con Ricette Attive invariate; nessuna richiesta esterna |

Controprova: sul codice di `0de0e8f`:
- falliscono E3, E5–E8, U1–U7 e U9; F13 mostra che l'handler originale raggiungeva l'indirizzo locale;
- passano i casi di non regressione (E1, E2, E4, E9, E10, U8).

## Test preesistenti aggiornati (autorizzati)

Tre suite verificavano comportamenti eliminati intenzionalmente da P0-a. Sono state aggiornate solo nei casi interessati; nessuna asserzione è stata indebolita al di fuori di questi casi.

| Suite / caso | Prima | Ora |
|---|---|---|
| `test-import-declared-yield` R2 | Sotto-caso "link senza testo": resa assente su una ricetta ricostruita dall'URL | Link senza testo letto → nessuna chiamata AI, nessuna anteprima, nulla salvato (requisito C) |
| `test-import-declared-yield` R3 | Foto e video: resa "da verificare" | Foto invariata; video → nessuna chiamata AI e nessuna anteprima (requisito D) |
| `test-import-preview-weights` P5 | Il nome `<img src=x onerror=alert(1)>` doveva comparire come testo nella nota | Nessun `<img>` nella nota (il markup non entra nei dati, requisito A); escape verificato con `Sale & "pepe" <1 g` → `Sale &amp; ”pepe” &lt;1 g` |
| `test-preview-direzione-3` P2 | Elenco chiuso delle funzioni modificabili | Aggiunte `extractRecipe`, `renderLoad`, `renderPreview`, `renderToastAction` (P0-a); tutti gli altri vincoli invariati |

`test-m2-contract` non è stato modificato: il fallimento è **preesistente** (stesso esito su `0de0e8f`).

## Rischi residui dichiarati
- **Escape non sistematico fuori dal perimetro:** restano circa 40 interpolazioni senza escape in 13 funzioni:
  - `renderLabRoundSection`, `renderProdRecipe`, `renderMergeConfirm`, `renderConfronto`, `renderRecipesAll`, `renderFamilyPicker`, `renderSessioneOperativa`, `renderMergePicker`, `renderSchedeFamigliePicker`, `renderLabGlobale`, `renderHome`, `renderCondividiStaffModal`;
  - in `renderLabRecipe`, la nota vocale in attesa e gli Appunti della Scheda.

  I dati **importati dopo P0-a** non contengono markup (neutralizzazione al confine). Restano esposti i dati **già salvati** prima di P0-a e i testi scritti o dettati dallo chef (`voiceToIngredients`, `voiceToSteps`, note vocali, Appunti). Da trattare prima del multi-tenant.
- **`fetchUrl`:**
  - la protezione copre le connessioni che il codice apre direttamente dal runtime Node (Vercel): non ci sono altri percorsi di uscita nel ramo `fetchUrl`.
  - Se in futuro venisse configurato un proxy di uscita, la regola degli indirizzi andrebbe applicata anche lì.
  - I siti che rispondono più lentamente di 15 s ora falliscono (prima l'attesa era senza limite).
- **Anti-bot:** riconosciuto per stato HTTP (403/429/503) e, sulle pagine brevi, per frasi tipiche. Una verifica anti-bot lunga e con stato 200 potrebbe ancora arrivare all'AI, che però non trova una ricetta ("nessuna ricetta riconosciuta").
- **Proxy AI generico:** invariato (P0-b). In particolare, una chiave assente lato server viene segnalata dal servizio AI (401) e mostrata come "Servizio AI non configurato".
- **Quantità e unità:** "q.b." → 0 e unità sconosciute → `g` sono invariate (P0-c / P1).
