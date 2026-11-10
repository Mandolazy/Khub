# Import Engine 2.0 — P1-a: estrazione strutturata da link web

Base: P0-a (`0d5512f`). Solo `khub_mvp.html`. Invariati: `api/chat.js` (acquisizione protetta P0-a), prompt dell'AI, modello dati, motore delle quantità, salvataggio (`savePreview`, `saveToSupabase`), Schede, LAB, Produzione, M1, M2.

## Flusso dell'importazione da link
1. **Lettura della pagina:** `fetchUrl` protetto, P0-a, invariato.
2. **JSON-LD `schema.org/Recipe`**, deterministico, nessuna AI. Se la Recipe è **completa** (nome, almeno un ingrediente, almeno un passaggio), l'anteprima nasce da questi dati, **senza chiamata AI**.
3. **Altrimenti:** si applicano gli stessi controlli di P0-a (testo insufficiente, anti-bot), poi un nuovo controllo: una pagina **non gastronomica** viene fermata senza AI.
4. **Una sola chiamata AI** riceve:
   - il **testo selezionato** dalla parte gastronomica della pagina, al massimo 6.000 caratteri;
   - gli eventuali **dati strutturati parziali**, con le righe originali e l'istruzione di non modificare quantità e unità.

## Funzioni (nuove, di primo livello, pure)

| Funzione | Responsabilità |
|---|---|
| `importJsonLdRicette(doc)` | Tutte le Recipe: oggetto, array, `@graph`, `mainEntity`, strutture annidate, `@type` come stringa, array o URL. JSON non valido contato e ignorato |
| `importSceltaRicetta(ricette, url)` | Più Recipe: l'unica; altrimenti l'unica con l'indirizzo della pagina; altrimenti l'unica completa; altrimenti **nessuna** (ambigua → testo + AI) |
| `importRicettaDaJsonLd(r, …)` | Nome, descrizione, ingredienti, procedimento, sezioni, resa, tempi, completezza e mancanze |
| `importIngredienteDaRiga(riga, …)` | Riga della fonte → nome, quantità, unità; **testo originale sempre conservato** |
| `importPassiRicetta(istr, …)` | Testo, array, `HowToStep`, `HowToSection` annidati; sezioni conservate come informazione |
| `importResaDaJsonLd(y, …)` | Resa mai inventata (vedi sotto) |
| `importDurata(v, …)` | Durate ISO 8601 → minuti; testo originale altrimenti |
| `importTestoSelezionato(html, …)` | Testo per l'AI (vedi sotto) |
| `importAnalizzaPagina(html, url, …)` | Riunisce JSON-LD, scelta della ricetta e selezione del testo |
| `importAnteprimaStrutturata(ric, url)` | Anteprima nello stesso formato dell'anteprima AI, più la provenienza (`importFonte`) |

`importTestoSelezionato`, nel dettaglio:
- spezza la pagina in righe vere (a capo dopo ogni blocco);
- tiene `nav`, `header`, `footer` e `aside` se contengono ingredienti;
- parte dalla ricetta invece che dall'inizio della pagina;
- riconosce i contenuti non gastronomici.

Le funzioni ricevono la neutralizzazione dei testi di P0-a (`testoSicuro` interna a `extractRecipe`). L'HTML scaricato è letto solo da documenti inerti (`DOMParser`): nessun codice della pagina viene eseguito, nessun HTML entra nel DOM.

### Regole sugli ingredienti
- **Unità equivalenti** (g/gr/grammi, kg, ml, l/litro, cl, cucchiaio→`tbsp`, cucchiaino→`tsp`, pezzi→`n`): stessa unità, nessuna conversione. Un numero senza unità vale come conteggio (`6 uova` → `6 n`).
- **Unità non rappresentabili** (spicchi, pizzico, bustina, baccello, dl, tazza, oz, …): quantità conservata, unità `null`, stato "da confermare". Mai trasformate in `g` o in `n`.
- **Quantità assenti** (q.b., a piacere, per decorare, nessun numero): quantità `null`, stato "mancante". Mai 0.
- **Intervalli** (2-3 cucchiai): nessun numero scelto.
- **Righe miste** ("Burro 100 g + q.b."): restano intere da confermare.

### Resa
- Presa da `recipeYield` solo con unità esplicita ("4 persone", "Serves 4"), oppure se la pagina accompagna il numero con un'unità ("Dosi per: 10 persone").
- Un numero da solo non viene mai completato: compare la nota «Resa nella fonte: «10» senza unità».
- Gli intervalli restano intervalli.
- La resa non diventa mai Porzioni o G/porzione.

## Anteprima
Stessa anteprima, con in più:
- una banda "Fonte":
  - dati strutturati e nessuna AI, oppure testo della pagina interpretato dall'AI;
  - tempi della fonte;
  - nota sulla resa;
  - possibili preparazioni intermedie;
  - numero di ingredienti da confermare;
- la riga «Nella fonte: «…»» sotto ogni ingrediente non rappresentabile o mancante;
- l'opzione "—" per l'unità quando non è rappresentabile, invece di mostrare "g".

Le sezioni del procedimento (`HowToSection`) restano passaggi della Ricetta: il nome della sezione precede il suo primo passaggio («Per la crema — …»). Nessuna sottoricetta automatica.

## Limiti noti (non risolti in P1-a)
- **Persistenza di quantità e unità non rappresentabili:**
  - se lo chef non le corregge in anteprima o nel LAB, il salvataggio attuale le registra come **0 g**: comportamento preesistente (`saveToSupabase`), soluzione in P0-c/P1;
  - il testo originale dell'ingrediente non viene salvato;
  - l'anteprima lo dichiara esplicitamente.
- **Tempi e descrizione:** mostrati in anteprima ma non salvati (il modello della Ricetta non ha questi campi; `savePreview` invariato).
- **Testi strutturati:** non tradotti né categorizzati (l'AI non interviene). La categoria resta vuota, come una categoria non indicata.
- **Selezione del testo senza JSON-LD:** euristica. Pagine molto atipiche possono essere giudicate non gastronomiche: lo chef riceve il messaggio e può incollare il testo.
- **Fixture:** quelle di GialloZafferano e Sonia Peronaci sono **ricostruite** sui dati R0. Il comportamento sulle pagine reali va confermato su KHUB Test.

## Test
`scripts/test-import-p1a-strutturato.js` (18 casi, Chromium sulla demo locale isolata, AI e pagine simulate):
- JSON-LD: singola, array, `@graph`, `@type` array o URL, annidata, HowToStep, HowToSection, più Recipe, JSON non valido, Recipe incompleta, tempi, resa;
- 23 righe d'ingredienti;
- HTML: introduzione lunga, ingredienti oltre i 6.000 caratteri, `aside`, nessun JSON-LD, pagina non gastronomica, HTML malevolo;
- flusso completo con salvataggio in nuova Scheda e in Scheda esistente (Ricette Attive invariate), apertura nel LAB, sicurezza;
- confronto prima/dopo.
