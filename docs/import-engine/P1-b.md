# P1-b — Rifinitura dell'estrazione strutturata (schema.org/Recipe)

**Stato:** solo locale, branch `claude/p1b-rifinitura-import` (da `b444b79`, invariato). Nessun commit, push, merge o deploy. Nessuna modifica a Supabase, nessuna migrazione, nessuna chiamata AI reale.

**Ambito:** solo l'estrazione da dati strutturati (link con JSON-LD) e la sua anteprima. Nessun cambiamento a ingredienti P0-c, Schede, LAB, Produzione, M1, MichelinAI, conversioni o formule di resa produttiva. L'AI resta facoltativa e non viene chiamata quando i dati strutturati sono completi.

## 1. Diagnosi

| Osservazione del collaudo | Causa |
|---|---|
| Tiramisù: «Porzioni» vuoto benché la fonte dica 10 persone | **Comportamento voluto, spiegato male.** In KHUB «Porzioni» (e G/porzione) è l'**Obiettivo di Produzione**; «Dosi per 10 persone» è la **Resa dichiarata** (10 porzioni). La stessa regola vale per l'importazione AI («non trasformare "per 6 persone" in porzioni»). L'anteprima non lo diceva. Inoltre, con `recipeYield: "10"` (solo numero), l'unità veniva cercata nel testo della pagina ottenuto con `textContent`: se numero e unità stanno in elementi adiacenti senza spazio (`<strong>10</strong><span>persone</span>`) il testo diventa «10persone» e **la resa non veniva riconosciuta**. Senza le pagine reali (vedi §7) non posso dire quale dei due casi si sia verificato nel collaudo: P1-b corregge entrambi. |
| Tiramisù: numeri delle foto nei passaggi | Il procedimento veniva diviso e ripulito dal markup (`<span>`, `<a>`, `<figure>`…) togliendo i **tag** ma lasciando il **loro testo**: l'indice della foto («1», «3», «4») restava nel passaggio o diventava un passaggio a sé. |
| Ganache: Porzioni e Resa vuote | Corretto se la fonte non dichiara `recipeYield` (fixture). Nessuna resa va inventata. |
| Ganache: 30 + 15 min contro 12 h 45 min | I tre tempi erano mostrati come dichiarati, senza spiegare che il totale **non** è la somma: la differenza (12 h) non è descritta dai dati strutturati. |
| (trovato in analisi) «Per una tortiera da 24 cm» | Veniva letto come resa «24 cm». |

## 2. Resa e porzioni

`importResaDaJsonLd` (e le nuove `importValoriResa`, `importResaDaValore`, `importResaInPagina`, `importNotaPorzioni`):

- **valori ammessi:** stringa, numero, array, `QuantitativeValue` (`value`/`minValue`–`maxValue` + `unitText`);
- **persone, porzioni, coperti, serves…** → Resa dichiarata in «porzioni»; **pezzi** («24 biscotti»), **peso** («1 kg»), **volume** («1,5 l») → Resa dichiarata con la loro unità. Mai l'Obiettivo di Produzione (`portionsCount` resta vuoto, come in P1-a e nell'importazione AI);
- **numero senza unità** → usato solo se il testo **visibile** della pagina lo accompagna con «persone/porzioni/coperti/pezzi»; il testo è ora costruito con i nodi separati da spazi, senza script e stili; altrimenti campi vuoti e nota «senza unità»;
- **intervallo** («6–8 persone») → nessun valore scelto (come P1-a);
- **più valori** → preferito quello in porzioni; gli altri, se diversi, in nota («Altre indicazioni di resa nella fonte: …»); nessun duplicato per lo stesso numero ripetuto;
- **misure di stampi o teglie** («24 cm», «20x30 cm», «30 × 40 cm») → non sono una resa: campi vuoti, testo originale in nota;
- **nessun `recipeYield`** → campi vuoti; se la pagina mostra un'etichetta esplicita («Dosi per: 6 persone», «Porzioni: 4», «Resa: …») è **solo citata in nota**, mai compilata (la pagina può riferirsi ad altro);
- **anteprima:** quando la Resa è in porzioni compare «La fonte indica «10 persone»: è riportata come Resa dichiarata (10 porzioni). Il campo «Porzioni» è l'Obiettivo di Produzione e resta vuoto finché non lo scegli tu.»;
- **correzioni dello chef:** i campi dell'anteprima scritti a mano prevalgono (invariato, verificato).

**Limite del modello dati (non modificato):** la citazione della fonte («Dosi per 10 persone») è mostrata in anteprima ma non è salvata: la Ricetta conserva solo `declared_yield_qty`/`declared_yield_unit` (l'intervallo resta nella nota, come in P1-a). Modifica minima proposta, **non implementata**: colonna `variants.declared_yield_source text` (nullable, senza default) con migrazione e rollback dedicati.

## 3. Procedimento

`importPassoTesto` (prima della divisione in passaggi) e `importNumeriIsolati`:

- **tolto solo con prova strutturale o lessicale:**
  - elementi immagine: `img`, `picture`, `figure`, `figcaption`, `svg`, `video`, `audio`, `source`, `iframe`…;
  - collegamenti a un file immagine (`.jpg`, `.png`, `.webp`…);
  - elementi con classe o id fotografici (`foto`, `photo`, `image`, `img`, `gallery`, `caption`, `didascalia`, `thumb`, `lightbox`, `carousel`) **solo se contengono soltanto numeri o niente**: un testo con quella classe resta;
  - riferimenti espliciti: «(foto 5)», «[fig. 6]», «(vedi foto 2-3)», «Foto 7:» a inizio passaggio;
- il markup anche **codificato** (`&lt;span…&gt;`, tipico del JSON-LD) è letto in un documento inerte (`DOMParser`: nessuno script eseguito, nessuna immagine caricata); `<br>`, `</p>`, `</li>` restano separatori di passaggio come in P1-a;
- **mai toccati:** quantità e unità («60 g», «1/2 cucchiaino»), temperature («180 °C»), tempi («12-15 minuti», «2 h»), numerazione propria («1.», «2)»), fasi e passaggi («fase 2», «passaggi 2 e 3»);
- **numeri senza prova** («…dai tuorli. 2», «1Preparate», un passaggio fatto solo di «3») → **lasciati** come nella fonte e segnalati in anteprima: «Da controllare: nei passaggi 2 ci sono numeri isolati che potrebbero riferirsi alle fotografie della pagina. Sono lasciati come nella fonte: toglili tu se non servono.»;
- nessuna espressione regolare generica sui numeri.

## 4. Tempi

`importDurata`, `importDurataTesto`, `importTempiRicetta`, `importTempiTesto`, `importNotaTempi`:

- **ISO 8601:** `PnW`, `PnD`, `PTnHnMnS`, decimali con punto o virgola, minuti oltre 60 (`PT90M` → 1 h 30 min), giorni («1 giorno 2 h»); un valore non ISO resta il testo originale, mai interpretato;
- **campi letti:** `prepTime`, `cookTime`, `totalTime`, `performTime` (Esecuzione). Solo durate dichiarate;
- **nessuna somma usata come tempo:** se `totalTime` manca non viene calcolato;
- **differenza:** se il totale supera la somma dei tempi dichiarati → «Il tempo totale dichiarato (12 h 45 min) supera di 12 h preparazione + cottura (45 min; differenza calcolata da KHUB): la fonte non indica a cosa corrisponda.» Non viene attribuita al riposo; se il totale è inferiore → «i tempi della fonte non sono coerenti fra loro»;
- **persistenza:** invariata. I tempi restano informazioni dell'anteprima («non salvati nella Ricetta»), mai in campi impropri. Una persistenza richiederebbe uno o più campi dedicati sulla variante (es. `source_times jsonb` con valori dichiarati e originali): **non implementata**.

## 5. Ingredienti e compatibilità

Nessun cambiamento al codice degli ingredienti. Verificato (fixture Ganache, salvataggio nel database della demo):
- quantità certe;
- «baccello» conservato;
- q.b. → variabile;
- «20–30 g» → intervallo;
- «Burro per lo stampo» → da indicare;
- testo originale per ogni riga;
- nessuna unità → «g», nessuno 0 effettivo;
- nessuna chiamata AI.

Procedimenti senza marcatori fotografici: **identici a `b444b79`** (test C2). JSON-LD assente o incompleto: stesso comportamento.

## 6. Test

`scripts/test-p1b-import-strutturato.js` (Chromium sulla demo locale, pagina e server reali, rete bloccata; confronto con il codice di `b444b79` letto da git), 18/18:

| Gruppo | Test |
|---|---|
| Casi del collaudo | G1 Tiramisù resa/porzioni; G2 foto nel procedimento; G3 correzioni dello chef; S1 Ganache tempi e sezioni; S2 Ganache ingredienti P0-c e salvataggio |
| Resa | Y1 numerico; Y2 testuale (persone, porzioni, pezzi, peso, volume); Y3 intervallo, array, QuantitativeValue; Y4 stampi e teglie; Y5 nessun recipeYield |
| Tempi | T1 durate ISO; T2 tempi parziali e incoerenti, performTime |
| Procedimento | P1 markup fotografico anche codificato; P2 numeri gastronomici preservati; P3 numeri senza prova segnalati |
| Compatibilità | C1 JSON-LD assente o incompleto; C2 procedimenti identici a `b444b79`; C3 nessun errore, nessuna esecuzione |

## 7. Controlli HTTP pubblici

Tentata una sola lettura per pagina (GialloZafferano Tiramisù, Sonia Peronaci Ganache) per confrontare le fixture con i dati reali: **bloccata dalla rete dell'ambiente** (proxy 403; i due domini non sono tra quelli consentiti). Nessun aggiramento. Le fixture restano **sintetiche**, costruite sulle osservazioni del collaudo: la struttura reale va verificata nel collaudo su KHUB Test (§8).

## 8. Collaudo proposto su KHUB Test (da autorizzare)

Dopo commit e Preview autorizzati, senza AI:
1. **Tiramisù:**
   - Resa dichiarata «10 porzioni» con la citazione;
   - nota che spiega «Porzioni»;
   - passaggi senza numeri delle foto, oppure segnalati «da controllare»;
   - q.b. sul cacao.
2. **Ganache:**
   - tempi 30 min / 15 min / 12 h 45 min, con la nota sulla differenza;
   - Resa e Porzioni vuote, se la fonte non ha `recipeYield`;
   - «baccello», q.b., intervalli e testo originale.
3. **Salvataggio e ricaricamento:** ingredienti e Resa dichiarata come in anteprima; i tempi non salvati, come prima.
4. **Correzioni:** modificare Resa e Porzioni in anteprima e controllare dopo il salvataggio che restino quelle dello chef.
5. **Ricette già presenti in KHUB Test:** nessun cambiamento, perché P1-b agisce solo durante una nuova importazione.
