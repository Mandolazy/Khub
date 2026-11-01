# KHUB — Audit tecnico-economico AI e infrastruttura (2026)

- **Data audit:** 2026-11-01
- **Commit analizzato:** `e683f77` (branch `claude/dreamy-rubin-ysj8o8`)
- **Modalità:** sola lettura. Nessuna chiamata AI reale, nessun accesso a Supabase/Vercel/dashboard, nessuna migrazione, nessun deploy. Nel sandbox non c'era nessuna credenziale (`ANTHROPIC_API_KEY`, `SUPABASE_*` assenti), quindi una chiamata reale non era nemmeno possibile.
- **Test eseguiti:** solo i test offline in `scripts/` (fetch e Supabase simulati, nessuna scrittura). Esclusi `test-m1-live.js`, `test-supabase-roundtrip.js` e `scripts/db/*.sh`. Esito: 44 file verdi su 45. L'unico rosso è `test-m2-contract.js`, con 1 asserzione superata dai fatti: vieta nuove `supabaseAction`, ma le azioni sono state aggiunte dopo R3A in sprint successivi.

**Legenda dell'origine dei dati.** Ogni numero porta una di queste etichette:
- **[M] misurato.** Non ce ne sono: il codice non registra nessun consumo reale (vedi §6).
- **[C] dedotto dal codice.** Modello, `max_tokens`, effort, dimensione dei prompt (caratteri contati sui sorgenti), limiti di troncamento.
- **[H] ipotizzato.** Dimensione delle ricette, token di thinking, frequenza d'uso, mix di clienti.

---

## 1. Sintesi esecutiva

1. **Il costo AI per operazione è basso.** Con il modello in uso (`claude-sonnet-5-5`, $2 input / $10 output per MTok) un'operazione costa tra **$0,004 e $0,11** [C+H]. Le voci di costo principali sono **MichelinAI M2** (ogni turno rimanda l'intero stato della Ricetta) e **M1**. Entrambe usano effort `medium` con thinking adattivo attivo per default, e il thinking si paga come output.
2. **Per un cliente tipo il costo AI resta tra ~$2 e ~$65 al mese** [H], a seconda dell'intensità d'uso. Con il mix ipotizzato (50% leggeri, 40% medi, 10% intensivi) la media è **~$12 per cliente al mese**: ~$350 al mese a 30 clienti, ~$1.200 a 100 clienti, ~$12.000 a 1.000 clienti, prima di qualsiasi ottimizzazione.
3. **Il primo blocco per il business plan non è il costo AI ma l'architettura, che è mono-tenant.** C'è una sola password condivisa, nessun utente, nessuna organizzazione e nessuna colonna `user_id`/`org_id`. Il server legge **tutte** le tabelle senza filtri con una chiave che scavalca le RLS. Così com'è, KHUB non può servire più clienti paganti con dati separati. Riferimenti: `middleware.js:7-10`, `api/chat.js:310-319`, `api/chat.js:876-888`.
4. **Il proxy Anthropic "legacy" è aperto, e questo è il rischio economico principale.** Il server inoltra ad Anthropic il body ricevuto dal client senza filtri: il client sceglie modello, `max_tokens`, strumenti (anche web search, a pagamento) e numero di chiamate. Non c'è nessun limite di frequenza su `/api/chat`. Riferimenti: `api/chat.js:1112-1125`.
5. **Il sistema crediti non esiste.** Non ci sono contatori, limiti o log dei token: la risposta `usage` di Anthropic viene scartata. Tutto è da progettare (§6 e §11).
6. **Alcune funzioni di importazione promettono più di quanto il codice faccia.** L'import da **video** passa al modello soltanto l'URL, senza contenuto, quindi il risultato è inventato. L'import da **PDF** non esiste. Gli **screenshot** passano dal flusso foto, che accetta un'immagine sola.
7. **C'è un fattore di costo infrastrutturale nascosto.** Foto e **video** del LAB vengono salvati in base64 dentro le colonne di testo `media_url`/`video_url` del database, e a ogni avvio l'app scarica tutte le tabelle con `select=*`. Già a poche decine di clienti questo fa crescere database ed egress. Riferimenti: `khub_mvp.html:7863-7876`, `khub_mvp.html:2151`, `khub_mvp.html:2179`, `api/chat.js:880-886`.

---

## 2. Inventario delle funzionalità

Stati: **IF** = implementata, coperta da test offline verdi · **INV** = implementata, non verificata da test · **PAR** = parzialmente implementata · **NI** = prevista o annunciata ma non implementata.

| # | Funzione | Stato | Tecnologia | Riferimenti |
|---|---|---|---|---|
| 1 | Import da **testo** | IF (AI simulata nei test) | AI (Sonnet 5.5) | `khub_mvp.html:2402-2404`, `scripts/test-lab-fix2c-c5-import.js`, `scripts/test-import-declared-yield.js` |
| 2 | Import da **URL** (link) | PAR | Fetch server + AI | `khub_mvp.html:2405-2414`, `api/chat.js:488-494`. Testo pagina troncato a 6.000 caratteri (`:2410`). Se il fetch fallisce, il modello "deduce" la ricetta dal solo URL (`:2414`), cioè la inventa |
| 3 | Import da **immagine/foto** | INV | AI vision | `khub_mvp.html:2397-2401`, `:10354-10364`. Un'immagine per volta, nessun ridimensionamento, nessun test della ramificazione foto |
| 4 | Import da **screenshot** | PAR | AI vision | Nessun flusso dedicato: si usa la scheda "Foto" (`khub_mvp.html:8405`) |
| 5 | Import da **PDF** | NI | — | Nessun `application/pdf`, nessun blocco `document`. Le schede disponibili sono foto/testo/link/video (`khub_mvp.html:8405`) |
| 6 | Import da **video** | PAR (di fatto non funzionante) | AI senza contenuto | `khub_mvp.html:2415-2416`: al modello arriva solo la stringa URL. L'API non scarica video, quindi ingredienti e passaggi sono inventati |
| 7 | **MichelinAI M1** (Primo Consulto) | IF (contratto e parsing); qualità reale non verificata | AI (Sonnet 5.5, effort medium) | Server `api/chat.js:9-110`, `:1070-1089`; client `khub_mvp.html:7054-7141`; UI `:8856`; test `scripts/test-m1.js`. Il test live `test-m1-live.js` non è stato eseguito |
| 8 | **MichelinAI M2** (Sviluppo, chat) | IF (contratto, runtime, persistenza, UI) | AI + validatori deterministici | Server `api/chat.js:123-238`, `:1091-1110`; client `khub_mvp.html:6440-6590` (`runM2`), `:7673-7710` (`inviaMichelinAI`); `lib/reconciliation.js`; cronologia `m2_turns` (`supabase/migrations/0010_m2_turns.sql`) |
| 9 | Primo Consulto **legacy** | Codice morto (non collegato alla UI) | AI (`claude-sonnet-4-6`) | `khub_mvp.html:7143-7190` |
| 10 | **Analisi rese AI** (suggerimento resa% per ingrediente) | INV | AI (Sonnet 5.5, effort low) | `khub_mvp.html:6249-6305`, pulsante `:7510` |
| 11 | **Note vocali** → ingredienti / passaggi | INV | Dettatura del browser (Web Speech API) + AI | Dettatura `khub_mvp.html:7779-7835`; AI `:7733-7765`; pulsanti `:8895` |
| 12 | Note vocali → appunti; dettatura in M2 | IF | Solo browser, nessuna AI | `khub_mvp.html:7767-7772`, `:7845-7858`, `scripts/test-m2-chat-persistence.js` |
| 13 | **LAB**: Schede (ricette madri), bozze, versioni, validazione, Ricette attive, famiglie, sotto-ricette ("mattoncini") | IF | Codice tradizionale + Supabase | `khub_mvp.html:2142-2232` (save), `:1185` (dipendenze), `:2762` (rendiAttiva), famiglie `api/chat.js:497-528`; test `test-lab-protect-active.js`, `test-post-validation-ux.js`, `test-schede-categorie.js` |
| 14 | **Produzione Guidata**, oggi Home Produzione + Sessione operativa (spunte, step Fatto, timer, note, completamento con resa reale) | IF | Codice + Supabase | `khub_mvp.html:3954`, `:4653+`, `api/chat.js:593-874`; test `test-ms12…ms16`, `test-production-home.js`. Il nome "Produzione Guidata" è ritirato (`khub_mvp.html:1058`, `:10052`) |
| 15 | **Scaling** / Calcolo rapido, pesi a crudo e finito, rese dichiarate | IF | Deterministico | `khub_mvp.html:8954-9040`, `:9096`; test `test-quick-calc.js`, `test-recipe-weight-summary.js`, `test-fix2d-lab-weights.js`, `test-lab-fix2b-*` |
| 16 | **Conversioni ingredienti** (unità e conversioni specifiche persistite) | IF | Deterministico + Supabase | `khub_mvp.html:1089`, `:4332`, `api/chat.js:534-547`, tabella `ingredient_conversions` (`0005`); test `test-conversion-name-groups.js`, `test-lab-fix2b-i3-conversions.js` |
| 17 | **Storico** produzioni e cronologia M2 | IF | Codice + Supabase | `khub_mvp.html:5672+`; test `test-ms17-history.js`, `test-ms17b-history-ui.js` |
| 18 | **Persistenza** (load paginata, save fail-fast, cancellazioni esplicite) | IF | Supabase REST (PostgREST) | `api/chat.js:429-453`, `:876-962`; test `test-supabase-load-save-safety.js` |
| 19 | **PDF** di una Ricetta | IF (indiretto) | Stampa del browser (`window.print`), nessun servizio esterno | `khub_mvp.html:7890-7918`, `test-lab-fix2c-c3-target-display.js` |
| 20 | Condivisione via link | INV | Dati in base64 nell'URL | `khub_mvp.html:7880-7888` |
| 21 | Foto e video nel LAB | INV | Base64 salvato nel DB | `khub_mvp.html:7863-7876` |
| 22 | Controlli formali LAB (deterministici) | INV | Codice | `khub_mvp.html:1224` (`checkDeterministicoLAB`) |
| 23 | Accesso privato (password unica + sessione HMAC) | IF | Codice | `middleware.js`, `api/chat.js:260-319`, `test-security-access.js` |
| 24 | Account utente, organizzazioni, multi-tenant, abbonamenti, pagamenti | NI | — | Nessuna traccia in SQL, JS o HTML |

---

## 3. Tabella delle chiamate AI

Provider unico: **Anthropic Messages API**, `POST https://api.anthropic.com/v1/messages`, header `anthropic-version: 2023-06-01`, raw `fetch` senza SDK. Tutte le chiamate passano da `api/chat.js`.

Le voci **comuni a tutti i punti** non sono ripetute in tabella:
- **Streaming:** nessuno.
- **Retry e fallback:** nessuno.
- **Timeout:** nessuno (nessun `AbortController`).
- **Prompt caching:** nessuno.
- **Gestione di `stop_reason`:** nessuna, né `max_tokens` né `refusal`.
- **Log di consumo:** nessuno. `usage` torna al browser e viene ignorato.
- **Batch API:** non usata.

| # | Funzione / file:riga | Modello e parametri | Invocazione | Prompt (ruolo) | Contesto indicativo [C] | Input speciali | Rischi di duplicazione o consumo |
|---|---|---|---|---|---|---|---|
| A1 | `extractRecipe` `khub_mvp.html:2386-2446` (chiamata `:2422`) | `claude-sonnet-5-5`, `max_tokens 8000`, effort `low`; nessun `thinking`, quindi adattivo per default | Client → proxy legacy (`api/chat.js:1115`) | Prompt utente di estrazione JSON (~2.256 caratteri, `:2395`): traduzione in italiano, unità, resa dichiarata. Nessun system prompt | ~900 token di istruzioni + fonte. Link: max 6.000 caratteri ≈ 2.400 token | Testo; link (fetch server `api/chat.js:488`, testo HTML pulito nel browser); foto in base64 (`:2398`); video come solo URL (`:2416`) | Pulsante disabilitato durante il caricamento (`:8433`), ma la funzione non ha un guard interno. Un errore di parsing JSON (`:2427`) butta una chiamata già pagata. Il fallback "deduci dall'URL" (`:2414`) paga per un risultato inventato |
| A2 | `runM1` `khub_mvp.html:7054-7141` → `api/chat.js:1070-1089` | `claude-sonnet-5-5`, `max_tokens 16000`, effort `medium`, thinking adattivo per default | `mode:'m1'`, prompt costruito lato server | System M1 (~6.516 caratteri ≈ 2.600 token): Primo Consulto tecnico-gastronomico, regole epistemiche, output in prosa + `===M1_OBSERVATIONS===` + JSON | System ~2.600 + Bozza, intenzione, criteri, fino a 20 L3 (`:7078`) | Nessuno | Guard solidi: `hasM1` (una volta per Bozza, `:7052`, `:7058`) e `S.m1Loading`. Un errore di formato ("marcatore mancante") costringe a riprovare e ogni tentativo è pagato |
| A3 | `runM2` `khub_mvp.html:6482-6590`, entry `inviaMichelinAI` `:7673` → `api/chat.js:1091-1110` | `claude-sonnet-5-5`, `max_tokens 16000`, effort `medium`, thinking adattivo per default | `mode:'m2'`, una chiamata per turno | System M2 (~7.632 caratteri ≈ 3.050 token): sviluppo continuo, riconciliazione L2, gate epistemici, output in prosa + `===M2_UPDATE===` + JSON | System ~3.050 + Bozza + **tutti** gli L2 della Ricetta + tutti gli L3 (`costruisciPayloadM2` `:6440-6474`). **Cresce a ogni turno** che aggiunge osservazioni | Nessuno | Guard `S.m2Loading` e `m2SaveFailed` (`:7677`, `:7684`). La cronologia non viene rimandata (bene), ma L2/L3 crescono senza tetto. Una risposta "stale" viene scartata dopo essere stata pagata (`:6532-6536`) |
| A4 | `analyzeYields` `khub_mvp.html:6249-6305` | `claude-sonnet-5-5`, `max_tokens 8000`, effort `low` | Proxy legacy | "Sei MichelinAI… stima la resa% per ingrediente": prompt utente (~1.200 caratteri + ingredienti + procedimento), output JSON | 500–3.000 token | Nessuno | Pulsante disabilitato in caricamento (`:7510`). Nessuna cache: rilanciare l'analisi sulla stessa Ricetta ripaga l'intera chiamata |
| A5 | `voiceToIngredients` `khub_mvp.html:7733-7748` | `claude-sonnet-5-5`, `max_tokens 4000`, effort `low` | Proxy legacy | Estrazione di ingredienti in JSON array dal testo dettato | 150 + testo | Testo dettato (trascrizione del browser) | **Nessun guard né stato di caricamento**: doppio clic = doppia chiamata e ingredienti duplicati |
| A6 | `voiceToSteps` `khub_mvp.html:7750-7765` | come A5 | Proxy legacy | Estrazione di passaggi in JSON array | 150 + testo | Testo dettato | Come A5 |
| A7 | `runPrimoConsulto` (legacy) `khub_mvp.html:7149-7190` | `claude-sonnet-4-6`, `max_tokens 900`, senza effort | Proxy legacy | Primo Consulto JSON, max 4 osservazioni | ~1.500 token | Nessuno | Non raggiungibile dalla UI (commento `:7143-7148`). Costo zero, ma resta codice morto |
| A8 | **Proxy generico** `api/chat.js:1112-1125` | **Lo decide il client** | Qualsiasi body che non sia una `supabaseAction` né `mode:'m1'/'m2'` | Qualsiasi | Illimitato (fino a 1M token di contesto e 128K di output, secondo il modello) | Qualsiasi (immagini, PDF, server tool come web search) | **Rischio critico.** Un utente autenticato, o uno script con il cookie di sessione, può chiamare il modello più costoso (es. `claude-fable-5-1`, $10/$50 per MTok) con output massimo, senza limiti di frequenza |

**Altri servizi esterni, non AI:**
- `fetchUrl` (`api/chat.js:488-494`) scarica **qualsiasi URL** senza allowlist, timeout o limite di dimensione, e restituisce l'HTML al browser. È un rischio di proxy aperto e di SSRF per utenti autenticati, e costa banda e durata della funzione su Vercel.
- La dettatura usa la Web Speech API del browser: costo zero per KHUB. In Chrome l'audio viene elaborato dai server Google, aspetto da considerare per la privacy.

---

## 4. Costi per operazione (tre scenari)

**Listino** (fonte: <https://platform.claude.com/docs/en/about-claude/pricing>, consultato il 2026-11-01), USD per milione di token:

| Modello | Input | Scrittura cache 5 min | Lettura cache | Output | Batch |
|---|---|---|---|---|---|
| Claude Sonnet 5.5 (in uso) | 2,00 | 2,50 | 0,10 | 10,00 | −50% |
| Claude Sonnet 4.6 (solo legacy) | 3,00 | 3,75 | 0,30 | 15,00 | −50% |
| Claude Haiku 5.5 (prompt ≤100K) | 0,10 | 0,125 | 0,01 | 0,50 | −50% |

**Ipotesi di calcolo:**
- **Thinking:** su Sonnet 5.5 è attivo per default quando il parametro `thinking` è omesso, ed è fatturato come output. È la voce più incerta [H]: 300–2.000 token a effort `low`, 1.500–6.000 a effort `medium`.
- **Tokenizer:** stima ~2,5 caratteri per token sul testo italiano [H]. Il tokenizer dei modelli 4.7+ produce ~30% di token in più rispetto a Sonnet 4.6 (fonte: stessa pagina listino). Si consiglia di ricalibrare con `count_tokens`, che è gratuito, su ricette reali.
- **Immagini:** Sonnet 5.5 rientra nella fascia ad alta risoluzione (fino a 2.576 px sul lato lungo, ~4.784 token per immagine al massimo). Un'immagine costa circa larghezza × altezza / 750 token.
- **Cambio:** **1 USD = 0,90 EUR, valore ipotetico da aggiornare**. Non ho verificato un tasso ufficiale.

**Affidabilità:** **B** = struttura certa dal codice, volumi ipotizzati (±40%). **C** = forte incertezza sul thinking o sul contenuto (±70%).

| Operazione | Scenario | Token input | Token output (inclusi thinking) | Chiamate | USD | EUR | Affidabilità |
|---|---|---|---|---|---|---|---|
| **Import testo** | Leggero (ricetta breve) | 1.500 | 800 | 1 | 0,011 | 0,010 | B |
| | Medio | 2.500 | 2.000 | 1 | 0,025 | 0,023 | B |
| | Complesso (con sotto-ricette) | 5.700 | 5.500 | 1 | 0,066 | 0,059 | C |
| **Import link** | Leggero | 2.000 | 800 | 1 + fetch | 0,012 | 0,011 | B |
| | Medio | 3.300 | 2.000 | 1 + fetch | 0,027 | 0,024 | B |
| | Complesso (testo troncato a 6.000 caratteri) | 3.300 | 4.500 | 1 + fetch | 0,052 | 0,047 | C |
| **Import foto/screenshot** | Leggero (screenshot ~1170×2532) | 4.900 | 800 | 1 | 0,018 | 0,016 | B |
| | Medio (foto ≥2576 px) | 5.700 | 2.000 | 1 | 0,031 | 0,028 | B |
| | Complesso | 5.700 | 5.000 | 1 | 0,061 | 0,055 | C |
| **Import video** (solo URL) | Qualsiasi | ~1.000 | 800–2.000 | 1 | 0,01–0,02 | 0,01–0,02 | B per il costo; **valore nullo** (risultato inventato) |
| **Import PDF** | — | — | — | — | non implementato | — | — |
| **M1 Primo Consulto** | Leggero | 3.000 | 2.300 | 1 | 0,029 | 0,026 | C |
| | Medio | 3.600 | 4.400 | 1 | 0,051 | 0,046 | C |
| | Complesso (molti L3) | 5.100 | 8.600 | 1 | 0,096 | 0,086 | C |
| | Tetto teorico | ~6.000 | 16.000 (`max_tokens`) | 1 | 0,17 | 0,15 | dal codice |
| **M2, per turno** | Leggero (pochi L2) | 3.650 | 1.500 | 1 | 0,022 | 0,020 | C |
| | Medio | 5.050 | 4.100 | 1 | 0,051 | 0,046 | C |
| | Complesso (Ricetta matura, molti L2/L3) | 9.050 | 8.700 | 1 | 0,105 | 0,095 | C |
| | Tetto teorico | crescente | 16.000 | 1 | ≥0,18 | ≥0,16 | dal codice |
| **Analisi rese** | Leggero (10 ingredienti) | 800 | 550 | 1 | 0,007 | 0,006 | B |
| | Medio (25 ingredienti) | 1.400 | 1.450 | 1 | 0,017 | 0,015 | B |
| | Complesso (50 ingredienti) | 3.000 | 2.800 | 1 | 0,034 | 0,031 | C |
| **Voce → ingredienti / passaggi** | Leggero | 350 | 350 | 1 | 0,004 | 0,004 | B |
| | Medio | 750 | 800 | 1 | 0,010 | 0,009 | B |
| | Complesso | 1.650 | 1.700 | 1 | 0,020 | 0,018 | C |
| **Proxy generico (abuso)** | Es. Fable 5.1 con 128K di output | qualsiasi | 128.000 | illimitate | ~6,4 per chiamata | ~5,8 | dal codice e dal listino |

**Osservazione:** in M1 e M2 l'output (soprattutto il thinking) pesa più di **3/4 del costo**. La leva principale è quindi l'effort, non il modello.

---

## 5. Consumo potenziale per tipologia di cliente

Tutti i volumi mensili qui sotto sono **ipotesi [H]**: servono dati di utilizzo reali (§10). Costi presi dagli scenari "medi" del §4, salvo indicazione.

| Profilo | Import | M1 | Turni M2 | Analisi rese | Voce AI | **USD al mese** | **EUR al mese** |
|---|---|---|---|---|---|---|---|
| **Leggero** (piccolo ristorante) | 10 | 5 | 30 | 5 | 10 | **~2,2** | ~2,0 |
| **Medio** (laboratorio o pasticceria attiva) | 40 (mix con foto) | 20 | 150 | 20 | 40 | **~10,6** | ~9,5 |
| **Intensivo** (R&D, consulente; scenari complessi) | 150 | 60 | 600 | 60 | 100 | **~64,5** | ~58 |

Per tutti i profili, **M2 vale il 60–75% della spesa AI.**

**Proiezione** con mix 50% leggeri / 40% medi / 10% intensivi (media ≈ $11,8 per cliente al mese):

| Clienti paganti | USD al mese | EUR al mese | USD all'anno |
|---|---|---|---|
| 30 | ~355 | ~320 | ~4.250 |
| 100 | ~1.180 | ~1.060 | ~14.200 |
| 1.000 | ~11.800 | ~10.600 | ~141.600 |

Queste cifre valgono **solo dopo** la chiusura del proxy generico. Con il proxy aperto il costo non ha un limite superiore.

---

## 6. Stato del sistema crediti

| Elemento | Esiste? | Evidenza |
|---|---|---|
| Contatori di utilizzo | **No** | `usage` della risposta Anthropic restituito al client e mai letto (`khub_mvp.html:2424`, `:6503-6505`, `:7083-7085`) |
| Limiti per utente o organizzazione | **No** | Utenti e organizzazioni non esistono (§2, riga 24) |
| Sistema crediti / crediti inclusi negli abbonamenti / pacchetti extra | **No** | Nessuna tabella, nessuna logica, nessun pagamento |
| Gestione dell'esaurimento | **No** | — |
| Protezione da abusi | **Parziale, solo sul login** | 5 tentativi per IP e 30 globali ogni 15 minuti, in memoria (`middleware.js:38-46`). Nessun limite su `/api/chat`; il proxy generico è aperto (`api/chat.js:1112-1125`) |
| Tracciamento del costo per operazione | **No** | `m2_turns` salva domanda e risposta, non i token (`0010_m2_turns.sql:26-31`) |
| Guard anti-duplicazione | **Sì per M1/M2**, no per le note vocali | §3, righe A2, A3, A5, A6 |

**Distinzione:** i **token** sono l'unità fatturata da Anthropic, misurata in `usage.input_tokens` e `usage.output_tokens`, thinking compreso. I **crediti KHUB** sono un'unità commerciale da definire. Il collegamento richiede un *ledger* lato server che registri, per ogni chiamata, i token reali e il costo calcolato (§11).

---

## 7. Costi infrastrutturali

**Configurazione rilevata dal repository:**
- **Vercel:** sito statico (`khub_mvp.html`, ~620 KB in un unico file) più una sola funzione Node (`api/chat.js`) e un Routing Middleware (`middleware.js`). Nessun `functions`/`maxDuration` in `vercel.json`, quindi valgono le impostazioni del progetto, non verificabili da qui. Allowlist di deployment in `.vercelignore`.
- **Supabase:** usato solo come Postgres via REST (PostgREST) con la chiave `sb_secret_` lato server (`api/chat.js:334-341`). Non usati: **Auth, Storage, Edge Functions, Realtime**. RLS attiva ma con policy permissiva "allow all" (`0010_m2_turns.sql:41-55`), comunque scavalcata dalla chiave secret. Lo schema base di `recipes`/`variants`/`ingredients` non è nelle migrazioni (precedente a `0001`).
- **Backup:** nel repository non c'è nessuna procedura o script. Ci sono solo rollback preparati e mai eseguiti (`supabase/rollback/`, `supabase/reconciliation/`). Dipende dal piano Supabase, non verificabile da qui.
- **Logging e monitoraggio:** solo `console.error` (log delle funzioni Vercel). Nessun APM, nessun alert, nessuna metrica di costo.
- **CDN esterni:** Google Fonts e Tabler Icons da jsDelivr con versione **`@latest`, non fissata** (`khub_mvp.html:10`). Costo zero, ma il CDN può cambiare versione senza preavviso.

**Fattori di costo per scala.** Prezzi dei piani **noti alla data di training, da verificare** sui listini ufficiali, che non ho consultato:

| Fattore | 30 clienti | 100 clienti | 1.000 clienti |
|---|---|---|---|
| Piano Vercel (il piano Hobby non consente uso commerciale; Pro ~$20 per membro al mese) | Pro | Pro | Pro, forse Enterprise |
| Durata delle funzioni (M1/M2 non in streaming, decine di secondi per chiamata) | trascurabile | basso | rilevante: valutare lo streaming e i limiti di durata |
| Body massimo delle funzioni Vercel (~4,5 MB) | **Blocca** foto di import oltre ~3,3 MB e salvataggi con video base64 | idem | idem |
| Supabase Pro (~$25 al mese, con 8 GB di DB) | sufficiente | sufficiente **se** i media escono dal DB | serve upgrade del compute e dello spazio |
| **Media in base64 nel DB** (`media_url`/`video_url`) | Un video da 20 MB ≈ 27 MB per riga | Esaurisce in fretta gli 8 GB del DB | Insostenibile: va spostato su Storage |
| **Egress**: `load` scarica tutte le tabelle con `select=*` a ogni avvio (`api/chat.js:880-886`) | Accettabile | Cresce con clienti × dati × avvii | Insostenibile senza filtro per tenant e senza escludere i media |
| `fetchUrl` aperto (banda e durata) | basso | basso | rischio abuso |
| Backup / PITR (add-on Supabase) | consigliato | necessario | necessario |
| Monitoraggio (Sentry, log drain, ecc.) | opzionale | consigliato | necessario |

---

## 8. Rischi economici

| # | Rischio | Gravità | Riferimento |
|---|---|---|---|
| R1 | Proxy Anthropic generico: modello, `max_tokens`, strumenti e volume scelti dal client | **Critico** | `api/chat.js:1112-1125` |
| R2 | Nessun limite di frequenza o quota su `/api/chat`; sessione valida 30 giorni | Alto | `api/chat.js:271`, `middleware.js:18` |
| R3 | Architettura mono-tenant: impossibile separare dati e consumi per cliente | **Bloccante** per il business plan | `api/chat.js:876-888`, nessun `user_id`/`org_id` |
| R4 | Il contesto di M2 cresce senza tetto (tutti gli L2/L3 a ogni turno) | Medio | `khub_mvp.html:6459-6463` |
| R5 | Thinking attivo per default a effort medium, che pesa più del 75% del costo di M1/M2 | Medio (governabile) | `api/chat.js:1081-1082`, `:1102-1103` |
| R6 | Chiamate pagate e poi scartate: errori di parsing, marcatore assente, risposta stale, troncamento a `max_tokens` non gestito | Medio | `khub_mvp.html:2427`, `:6510-6512`, `:6532` |
| R7 | Import video e link senza testo: si paga per output inventato, con rischio reputazionale | Medio | `khub_mvp.html:2414`, `:2416` |
| R8 | Note vocali senza guard: chiamate duplicate | Basso | `khub_mvp.html:7733`, `:7750` |
| R9 | Media base64 nel DB e load completa: costi di DB ed egress | Alto a 100+ clienti | §7 |
| R10 | `fetchUrl` aperto (SSRF, proxy) | Medio (sicurezza e costi) | `api/chat.js:488-494` |
| R11 | Nessuna misura reale dei consumi: il business plan si basa solo su stime | Alto | §6 |
| R12 | Nessun timeout o retry verso Anthropic: richieste appese che consumano durata delle funzioni | Basso | `api/chat.js:1072`, `:1093`, `:1115` |

---

## 9. Opportunità di ottimizzazione (solo raccomandazioni)

Nessuna di queste modifiche è stata applicata. L'ordine segue il rapporto risparmio/sforzo.

| Operazione | Approccio consigliato | Note |
|---|---|---|
| Conversioni, scaling, pesi, controlli formali, PDF | **Deterministico, nessuna AI** | Già così: va mantenuto |
| Import da testo strutturato o da siti con JSON-LD `schema.org/Recipe` | **Prima un parser deterministico**, AI solo come ripiego | Molti siti di ricette pubblicano JSON-LD: costo zero e nessun output inventato |
| Import testo/link, voce → ingredienti/passaggi | **Modello economico** (Claude Haiku 5.5: $0,10/$0,50, circa 20 volte meno di Sonnet 5.5) con **structured outputs** (`output_config.format`) al posto del parsing manuale | Da validare su un piccolo set di ricette reali, vedi §10 |
| Analisi rese | Modello economico o intermedio, effort `low`; **cache del risultato** per hash di ingredienti e procedimento | Evita di ripagare la stessa analisi |
| Import foto/screenshot | Pipeline multimodale con **ridimensionamento lato client** (es. 1.568 px sul lato lungo) e supporto a più pagine | Ridimensionare riduce token immagine e problemi di dimensione del body; la leggibilità va verificata |
| Import PDF | Blocco `document` nativo dell'API (PDF in base64) oppure estrazione del testo nel browser + modello economico | Oggi non esiste |
| Import video | Trascrizione (sottotitoli o descrizione) **prima** del modello; finché manca, **disattivare o dichiarare il limite** | Oggi il risultato è inventato |
| **M1** | Modello intermedio (Sonnet 5.5, quello attuale); provare effort `low` contro `medium` su un set di valutazione | Qui la qualità del ragionamento conta |
| **M2** | Modello intermedio; **prompt caching** del system prompt (~3.000 token, lettura a $0,10/MTok invece di $2); tetto o selezione degli L2 inviati (solo quelli aperti o pertinenti); effort `low` per le domande semplici | Coerente con il ruolo: M2 **assiste** lo chef verso il risultato che cerca, non contesta sistematicamente. Nel prompt esistono già i principi "rispondi a quello che lo chef chiede ORA" e "nessun aggiornamento massivo" (`api/chat.js:127`, `:131`), che limitano anche l'output. Si possono rafforzare indicando che metodi alternativi dello chef sono legittimi salvo un problema tecnico concreto |
| Modelli avanzati (Opus/Fable) | **Non consigliati** per nessuna funzione attuale | Costo 2–5 volte maggiore senza un bisogno dimostrato |
| Trasversale | Allowlist server di modello e parametri (eliminare il proxy generico); `usage` registrato lato server; gestione di `stop_reason`; timeout; streaming per M1/M2 | Prerequisito di qualsiasi sistema crediti |

---

## 10. Dati mancanti per il business plan

1. **Consumi reali:** distribuzione di token input/output (thinking compreso) per M1, M2, import e rese, su almeno 50–100 operazioni reali. Oggi `usage` non viene registrato.
2. **Frequenza d'uso:** quanti import, M1, turni M2 per cliente al mese, e la distribuzione per profilo.
3. **Segmenti di clientela** e mix leggero/medio/intensivo.
4. **Piani attuali:** Vercel (Hobby/Pro, numero di membri, Fluid compute, `maxDuration`) e Supabase (Free/Pro, compute, PITR, dimensione attuale del DB e dei media).
5. **Dimensione dei dati attuali:** numero di Schede, Ricette, L2, sessioni; peso delle colonne `media_url`/`video_url`. Va misurato con una query di sola lettura, eseguita dal titolare.
6. **Tasso di cambio** USD/EUR di riferimento e IVA o fiscalità sui servizi esteri.
7. **Organizzazione Anthropic:** tier, limiti di frequenza, eventuali sconti; residenza dei dati (`inference_geo` US = ×1,1).
8. **Requisiti multi-tenant:** utenti per cliente, ruoli, separazione dei dati. Sono il presupposto di qualsiasi prezzo.
9. **Prezzo di vendita previsto** e margine desiderato, per calibrare i crediti.
10. **Qualità minima accettabile** per ogni funzione, necessaria a scegliere modello ed effort (es. Haiku 5.5 sugli import).
11. **Politica sui media:** dimensione massima, conservazione, uso dei video.

---

## 11. Proposta preliminare di matrice crediti

> **Solo proposta: niente di tutto questo è implementato.** I valori sono indicativi e vanno ricalibrati sui consumi misurati (§10.1).

**Principio:** 1 credito KHUB ≈ $0,01 di costo AI atteso, con margine da applicare nel prezzo. I crediti si scalano **dopo** la risposta, in base alla fascia dell'operazione (prezzo prevedibile per lo chef). Il ledger interno registra i token reali per il controllo dei margini.

| Operazione | Costo medio stimato (§4) | Crediti proposti | Note |
|---|---|---|---|
| Voce → ingredienti / passaggi | $0,010 | 1 | |
| Analisi rese | $0,017 | 2 | gratis se servita dalla cache |
| Import testo / link | $0,025 | 3 | 0 se l'estrazione JSON-LD riesce senza AI |
| Import foto / screenshot | $0,031 | 4 | +2 per ogni pagina aggiuntiva, se introdotta |
| Import PDF | da stimare | 4–8 | dopo l'implementazione |
| Import video | — | **sospeso** | finché manca la trascrizione |
| M1 Primo Consulto | $0,051 | 6 | una volta per Bozza |
| M2 turno standard | $0,051 | 5 | |
| M2 turno su Ricetta "matura" (contesto oltre una soglia) | $0,105 | 10 | oppure tetto al contesto e prezzo unico |
| Errore server o risposta scartata da KHUB | — | 0 (rimborso) | il costo resta a carico di KHUB e va monitorato |

**Crediti inclusi, ipotesi di piani** (da validare su prezzi e consumi):

| Piano | Crediti al mese | Costo AI massimo per KHUB | Profilo coperto |
|---|---|---|---|
| Base | 300 | ~$3 | Leggero (~220 crediti stimati) |
| Pro | 1.500 | ~$15 | Medio (~1.060 crediti) |
| Studio | 7.000 | ~$70 | Intensivo (~6.500 crediti) |
| Pacchetto extra | 500 | ~$5 | Ricarica |

**Componenti da sviluppare** (per completezza, non implementati):
- tenant e utenti;
- tabella `ai_usage_ledger`: tenant, operazione, modello, token input, output e cache, costo USD, crediti, `request_id`;
- saldo crediti con verifica prima della chiamata e scalatura dopo;
- limite di frequenza per tenant;
- allowlist delle operazioni AI lato server, con eliminazione del proxy generico;
- blocco "crediti esauriti" con messaggio chiaro;
- report mensile margine (costo AI per tenant rispetto al ricavo).
