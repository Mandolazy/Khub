# P2-a.2, blocco 2a — Interfaccia delle Idee

**Stato:** solo locale, branch `claude/p2a2-idee-interfaccia` (da `2d536b7`). Nessun commit, push, merge o deploy. Nessuna migrazione, nessuna chiamata AI.

**Ambito:** Home, elenco, Nuova Idea, dettaglio. Usa **solo** le azioni server di P2-a.1 (`loadIdeas`, `createIdea`, `updateIdeaNotes`, `archiveIdea`): `api/chat.js` e il database non cambiano.

## Schermate
- **Home**
  - Direzione 3 (grafica predefinita, quella della Preview): quarta area «Idee», nel suo colore d'ambiente, con il conteggio delle Idee aperte. È la prima, secondo l'ordine del lavoro (Idee → LAB → Schede → Produzione); su schermi larghi le aree stanno due per riga.
  - Grafica classica: riga «Idee» dopo LAB.
  - «Nuova Scheda / Carica Scheda» (D3) e «Nuova Ricetta / Carica Ricetta» (classica) restano invariate.
- **Elenco** (`S.view='idee'`):
  - filtri Aperte (predefinito), Trasformate, Archiviate, con i conteggi;
  - righe con titolo, tipo, data, Scheda collegata e presenza di note.
- **Nuova Idea** (`idea-nuova`):
  - «Appunto»: titolo + spunto;
  - «Da link»: titolo + link http(s) + note facoltative. Il link è salvato così com'è: nessuna lettura della pagina, nessuna AI. Per importare una ricetta resta «Carica Scheda»;
  - ogni Nuova Idea riparte da «Appunto»;
  - «Salva» resta bloccato finché mancano i campi obbligatori (il server ripete i controlli).
- **Dettaglio** (`idea`):
  - stato, titolo, tipo e data;
  - Spunto o Provenienza, con il link aperto in una nuova scheda (`noopener noreferrer nofollow`);
  - **spazio della conversazione con MichelinAI**: solo segnaposto, contrassegnato «Previsto», senza comandi;
  - Note;
  - «Archivia Idea» con conferma;
  - archiviata o trasformata: sola lettura. Se trasformata, «Apri la Scheda» apre la Scheda reale collegata.
- **Nessun editor** di ingredienti o procedimento; un'Idea non crea Ricette.

## Colore delle Idee e token di tema
**Giallo miele `#E9B949`** (`--d3-amb-idee`), solo per riempimenti e segni, perché su fondo chiaro arriva a 1,8:1:
- banda della carta in Home;
- pulsante primario («+ Nuova Idea», «Salva Idea»), con testo inchiostro `#231B14` (9,3:1);
- segno sotto il filtro o il tipo selezionato;
- bordo della pillola «Aperta», fondo della pillola «Trasformata».

**Testi e icone su fondo chiaro** usano `--d3-amb-idee-testo` `#7A5A12` (6,3:1 sulla carta, 5,7:1 sulla tinta): conteggio, freccia e icona in Home, frecce delle righe, link, pillola, anello di fuoco. **Fondi tenui:** `--d3-amb-idee-tinta` `#FBF1D6`.

Nella barra laterale e nella barra in basso non c'è una voce Idee: come approvato, Idee si apre dalla Home. Quindi nessuna voce di navigazione si accende nella sezione Idee; il colore d'ambiente (`data-d3-amb="idee"`) vale per i pulsanti primari.

**Token centralizzati** (una sola regola, inizio della sezione D3: `body.ui-d3,body:not(.ui-d3) .idee-env{…}`; con la grafica classica valgono solo dentro le Idee):

| Gruppo | Token | Valore |
|---|---|---|
| Sfondi e superfici | `--d3-bg`, `--d3-card`, `--d3-bar`, `--d3-sabbia` | `#F4EEE2`, `#FFFDF9`, `#FAF6EE`, `#EDE4D3` |
| Bordi e campi | `--d3-bordo`, `--d3-campo` | `#E2D7C4`, `#C9BBA4` |
| Testi | `--d3-ink`, `--d3-ink2`, `--d3-grigio` | `#231B14`, `#6B5F55`, `#8C8277` |
| Primario e secondario | `--d3-terra`, `--d3-terra2` | `#B4501C`, `#9C4416` |
| Stati delle Ricette | `--d3-verde`, `--d3-ardesia`, `--d3-tratto` | `#2E6A45`, `#55606A`, `#8C7B68` |
| Pericolo (nuovi, stessi valori di prima) | `--d3-pericolo`, `--d3-pericolo-tinta` | `#9B2C1F`, `#FBEDEA` |
| LAB | `--d3-amb-lab`, `--d3-amb-lab-tinta` | `#24533F`, `#E3EDE7` |
| Schede | `--d3-amb-schede`, `--d3-amb-schede-tinta` | `#94661C`, `#F3E8D2` |
| Produzione | `--d3-amb-produzione`, `--d3-amb-produzione-tinta` | `#B4501C`, `#F6E4D8` |
| Idee (nuovi) | `--d3-amb-idee`, `--d3-amb-idee-tinta`, `--d3-amb-idee-testo` | `#E9B949`, `#FBF1D6`, `#7A5A12` |
| Primario della sezione (già esistente) | `--d3-primario` | terracotta; colore dell'ambiente in LAB, Schede, Produzione, Idee |

**Riusati, senza doppioni:**
- i nomi storici che la D3 ridefinisce (`--cream`, `--white`, `--border`, `--dark`, `--mid`, `--light`, `--orange*`, `--sage*`, `--lab*`, `--prod`, `--dpop-*`) puntano ora ai token, con gli stessi valori;
- le classi `.d3-btn-danger`, `.d3-menu-item.danger`, `.d3-errore` e `.d3-testo-pericolo` usano `var(--d3-pericolo, #9B2C1F)`: valore di riserva identico, perché sono classi globali;
- la regola separata dei colori d'ambiente e la palette locale delle Idee sono state tolte (erano doppioni).

**Verifica «centralizzare non significa cambiare»:** confronto automatico degli stili calcolati dal browser (colore, sfondo, bordi, ombre, contorno, filtro, opacità, riempimento, tratto e bande di stato) di ogni elemento, pagina di `2d536b7` contro pagina attuale sugli stessi dati:
- 10 schermate: elenco LAB, archivio Schede, Scheda, Ricetta in LAB, Ricetta in Produzione, Produzione, Storico, Carica Scheda, Impostazioni, Home;
- grafica D3 e classica, 1280 e 390 px;
- **0 differenze**. In Home sono confrontati tutti gli elementi tranne l'area Idee, nuova.

**Lasciato com'è (centralizzazione futura, nessun rischio preso ora):**
- testo bianco sui colori pieni (`#FFF`);
- maschere di sfumatura (`#000`, non sono colori visibili);
- colori interni delle pillole di stato (validata `#EEF0F1`/`#3C454D`, in LAB `#5C4F42`);
- tinte chiare storiche (`#F6E7DC`, `#E6EFE8`);
- pericolo secondario (`#A33A2A`, `#E7C9C2`);
- `#C6BBAA` (indice), `#F3F6F2` (evidenza), `#3A2E24` (hover di un pulsante);
- i colori della grafica classica e quelli scritti negli attributi `style` del codice JavaScript.

## Rifinitura dopo il collaudo della Preview: colori pieni e navigazione
**Causa dei pulsanti bianchi a contorno:** i colori pieni approvati della D3 sono su `main` (Production) con due commit:
- `b2ac4af`: carte della Home, voce di navigazione attiva, titolo di pagina, schede e bozza attive a colore pieno;
- `f13b6d1`: intestazione come fascia dell'ambiente, con icona e nome.

Il ramo di P0-a…P2-a parte da `0de0e8f` e non li conteneva: per questo la Preview mostrava carte e voci bianche con il contorno.

**Correzione:**
- i due commit sono applicati al branch senza modifiche: stesse regole, stessi controlli P25 e P26 nel test di guardia;
- confronto degli stili calcolati contro `main`: 10 schermate, D3 e classica, 1280 e 390 px, esclusi i soli elementi Idee. **0 differenze**: LAB, Schede e Produzione hanno esattamente la resa approvata.

**Stessa resa per le Idee, in giallo miele.** Sul giallo testi e icone sono in inchiostro: 9,3:1, mentre il bianco darebbe 1,8:1.
- carta Idee della Home a colore pieno;
- voce «Idee» nella navigazione principale della D3, prima di LAB, con icona lampadina:
  - barra laterale e barra in basso, che su mobile passa a 4 colonne;
  - apre l'elenco;
  - attiva, gialla e piena in elenco, Nuova Idea e dettaglio;
- fascia d'intestazione gialla con icona e nome «Idee»;
- titolo di pagina nella variante leggibile `#7A5A12`.

La grafica classica non ha la voce Idee nella navigazione (resta la riga nella Home): l'HTML della navigazione classica è identico a `main` (test P10).

**Pulsanti, primari e secondari:**
- **primari** (`d3-btn-primary`, pieni nel colore della sezione tramite `--d3-primario`): «+ Nuova Idea», «Salva Idea» e ora «Salva note», l'azione principale del dettaglio;
- **secondari**, a contorno come nella D3 di Production: «Detta», «Riprova», «+ Nuova Scheda» e «Carica Scheda» in Home, «+ Nuova» nelle Schede;
- testuali: «Annulla», «Archivia Idea»;
- la conferma di archiviazione è inchiostro pieno, come nel resto della D3.

**Disattivati delle Idee:** senza trasparenza. Il primario passa a tinta `#FBF1D6` con testo `#6B5F55` (5,5:1); il secondario a carta con testo `#6B5F55` (6,1:1).

## Dettatura
- Riusa il motore condiviso (`startDictation`) con i target `idea-spunto`, `idea-nuova-note` e `idea-note`.
- Il testo riconosciuto viene **aggiunto** al campo: mai inviato o salvato da solo.
- Un solo microfono alla volta; si ferma uscendo dalla schermata.
- Senza riconoscimento vocale nel browser: nessun pulsante e l'indicazione «puoi scrivere».

## Sicurezza della visualizzazione
- Titoli, testi, note e link passano sempre per `escAttr`; il testo resta testo (a capo con `white-space: pre-wrap`).
- Un link diventa un collegamento solo se `http(s)` e leggibile da `URL`; altrimenti nessun collegamento.
- Negli attributi `onclick` entrano solo id nel formato del server (`idea_…`).

## Modifiche fuori dal blocco Idee (minime)
- **Funzioni toccate:**
  - `render()`: tre viste nuove, dettatura fermata uscendo dalla schermata, primo caricamento delle Idee, fuoco dei nuovi campi;
  - `bindEvents()`: area Idee della Home;
  - `navState()` e `popstate`: l'Idea aperta è ricordata dal tasto Indietro;
  - `d3SezioneNav()`: sezione `idee`;
  - `renderAppHome()` / `renderAppHomeD3()`: la nuova area.
- **CSS:**
  - token di tema centralizzati (vedi sopra);
  - blocco `.idee-*` prima di quello della Direzione 3: vale anche con la grafica classica, con i token di tema;
  - nel blocco D3: solo il colore d'ambiente delle Idee e la griglia della Home a due colonne.
- **Test di guardia** `test-preview-direzione-3`, aggiornati con commento P2-a.2:
  - funzioni cambiate ammesse (`navState`, `renderAppHome`);
  - Home classica identica a `main` salvo la riga «Idee»;
  - quattro icone nella Home D3;
  - in P21, colori degli ambienti letti dai token centralizzati.

## Test
`scripts/test-p2a2-idee-ui.js`: 17/17 (pagina reale + server reale + PostgREST e PostgreSQL locali con le migrazioni del repository; privilegi come su Supabase oggi; AI intercettata e vietata).

| Test | Cosa verifica |
|---|---|
| H1, H2 | Home D3 e classica |
| N1, N2 | appunto; link (anche un link `javascript:` rifiutato senza richieste) |
| S1 | testi e link ostili, anche scritti direttamente nel database |
| D1 | note: dettatura, guasto del server con il testo conservato |
| V1 | dettatura presente o assente |
| A1 | archiviazione e filtri |
| T1 | Idea trasformata e «Apri la Scheda» |
| R1 | persistenza dopo il ricaricamento |
| B1 | tasto Indietro |
| E1 | server non disponibile |
| M1 | mobile a 390 px |
| X1 | LAB, Schede e Produzione invariati |
| G1 | voce Idee nella navigazione D3 (barra laterale e in basso), voce attiva, fascia gialla, «Salva note» primario e disattivato leggibile, navigazione classica invariata |
| C1 | colore Idee e contrasti, colori degli altri ambienti invariati, token assenti nella grafica classica fuori dalle Idee |
| Z1 | solo le quattro azioni di P2-a.1, zero richieste AI, nessun errore JavaScript |

Schermate facoltative con `KHUB_SCREENSHOT_DIR`.
