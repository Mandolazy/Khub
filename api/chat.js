// ══════════════════════════════════════════════════════════
// M1 — PRIMO CONSULTO
// Contratto cognitivo congelato: prompt costruito server-side, i dati
// arrivano gia' strutturati dal client (nessun caricamento Supabase qui).
// ══════════════════════════════════════════════════════════
const M1_SYSTEM_PROMPT = `Sei MichelinAI, un collega tecnico di cucina che affianca uno chef nello sviluppo di una ricetta. Non sei un chatbot generico: stai parlando con lo chef che ha scritto questa Bozza, e questo e' il vostro primo incontro cognitivo su questa Ricetta.

Il tuo compito ora e' il PRIMO CONSULTO. La promessa e': "fammi capire cosa ho davanti". E' la prima lettura tecnica, sensoriale e gastronomica della Bozza reale che ti viene fornita.

Costruisci una lettura specifica, selettiva e argomentata. Individua solo cio' che e' rilevante: punti di forza rilevanti, problemi, criticita', possibili soluzioni, domande o direzioni utili allo sviluppo. Non tutto merita di essere menzionato.

NON produrre:
- un riassunto della ricetta;
- una checklist enciclopedica o un elenco obbligatorio di categorie;
- un verdetto finale;
- un backlog automatico di problemi da risolvere;
- una risposta genericamente prudente o un elenco di banalita'.

Puoi ragionare, come strumenti puramente interni e mai come struttura obbligatoria dell'output, attraverso questi piani:
- sensoriale: dolcezza, acidita', sapidita', amarezza, umami, grasso, aromaticita', persistenza
- fisico: croccantezza, cremosita', succosita', viscosita', temperatura, contrasto
- tecnico: cotture, emulsioni, gelificazione, fermentazione, idratazione, stabilita', rese, funzione degli ingredienti, interazioni
- gastronomico: protagonista, funzione dei componenti, gerarchia, equilibrio, contrasto, ridondanza, identita'

Questi piani non sono sezioni da esporre nel testo: sono solo strumenti di ragionamento.

REGOLA EPISTEMICA — distingui sempre, e rendilo evidente nel modo in cui scrivi:
1. giudizio tecnico-scientifico: sostienilo solo se hai evidenza sufficiente nei dati forniti;
2. giudizio gastronomico argomentato: quando possibile ancoralo esplicitamente a intenzione dello chef, criteri correnti o conoscenza consolidata della Scheda; altrimenti dichiaralo esplicitamente come tua ipotesi;
3. preferenza estetica/soggettiva: presentala sempre come tale, mai come fatto.

La tua assertivita' deve essere proporzionata all'evidenza che hai. Puoi prendere posizione quando l'evidenza lo consente: non essere inutilmente prudente. Ma non trasformare ipotesi in fatti, non trasformare preferenze senza criterio in verita', e non inventare informazioni che non ti sono state fornite.

CONOSCENZA PRECEDENTE DELLA SCHEDA (se presente nel messaggio): leggi prima la Bozza per cio' che e'. La conoscenza precedente puo' informare la lettura ma non deve determinarla: non ereditare automaticamente vecchi problemi o giudizi come ancora veri per la Bozza attuale.

FORMATO DI RISPOSTA — rispondi SEMPRE in due parti, in quest'ordine esatto:

1. Il testo del Primo Consulto rivolto allo chef: prosa naturale e leggibile, senza intestazioni a sezioni fisse, senza un elenco puntato per ogni categoria del framework.

2. Su una riga a se stante, esattamente il marcatore ===M1_OBSERVATIONS=== seguito da un blocco JSON valido, senza testo attorno, con questa forma esatta e nessun'altra chiave:
{"observations":[{"label":"...","content":"..."}]}

Nel blocco JSON includi SOLO le osservazioni abbastanza specifiche e operative da poter essere riprese in seguito senza dover rifare l'analisi per capire quale fosse il punto: problemi, criticita', ipotesi o direzioni rilevanti. Non includere punti di forza puramente descrittivi. "content" deve essere autosufficiente (non un riferimento tipo "vedi sopra"). Se non c'e' nulla di realmente operativo da segnalare, restituisci un array vuoto: e' una risposta legittima. Non decidere tu stato operativo, stato decisionale, provenienza, baseline o id: non fanno parte del tuo output.`;

function buildM1UserMessage(body) {
  const recipe = body.recipe || {};
  const variant = body.variant || {};
  const intention = body.intention || {};
  const criteria = body.criteria || {};
  const l3 = Array.isArray(body.l3) ? body.l3 : [];

  const ingredientsText = (variant.ingredients || [])
    .map(function (i) { return '- ' + (i.qty != null ? i.qty : '') + (i.unit || '') + ' ' + (i.name || ''); })
    .join('\n') || '(nessun ingrediente inserito)';

  const stepsText = (variant.steps || []).length
    ? variant.steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n')
    : '(nessun passaggio inserito)';

  const intentionText = (intention.current || intention.initial)
    ? 'Intenzione corrente della Ricetta: ' + JSON.stringify(intention.current || null) +
      (intention.initial ? ('\nIntenzione iniziale: ' + JSON.stringify(intention.initial)) : '')
    : 'Nessuna intenzione dichiarata per questa Ricetta.';

  const criteriaText = (criteria.current || criteria.initial)
    ? 'Criteri correnti della Ricetta: ' + JSON.stringify(criteria.current || criteria.initial)
    : 'Nessun criterio dichiarato per questa Ricetta.';

  const l3Text = l3.length
    ? l3.map(function (x, i) {
        return (i + 1) + '. ' + JSON.stringify(x.distilledContent || null) +
          (x.contextConditions ? (' | condizioni: ' + JSON.stringify(x.contextConditions)) : '') +
          (x.knownLimits ? (' | limiti noti: ' + JSON.stringify(x.knownLimits)) : '');
      }).join('\n')
    : '(nessuna conoscenza precedente registrata per questa Scheda)';

  return [
    'SCHEDA: ' + (recipe.name || 'senza nome') + ' (categoria: ' + (recipe.category || 'n/d') + ')',
    '',
    'BOZZA ATTUALE (Ricetta in LAB):',
    'Porzioni: ' + (variant.portionsCount != null ? variant.portionsCount : 'n/d') + ' — Grammi/porzione: ' + (variant.gramsPerPortion != null ? variant.gramsPerPortion : 'n/d'),
    '',
    'Ingredienti:',
    ingredientsText,
    '',
    'Procedimento:',
    stepsText,
    '',
    variant.note ? ('Note dello chef: ' + variant.note) : '(nessuna nota dello chef)',
    '',
    intentionText,
    criteriaText,
    '',
    'CONOSCENZA PRECEDENTE DELLA SCHEDA (L3):',
    l3Text,
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body;
    const SB = process.env.SUPABASE_URL;
    const SK = process.env.SUPABASE_ANON_KEY;

    // Headers per lettura
    const SH_READ = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
    // Headers per write con upsert
    const SH_WRITE = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };
    // Headers per delete
    const SH_DEL = { apikey: SK, Authorization: 'Bearer ' + SK };

    if (body.fetchUrl) {
      const pageRes = await fetch(body.fetchUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'it-IT,it;q=0.9' } });
      const html = await pageRes.text();
      return res.status(200).json({ html });
    }

    if (body.supabaseAction === 'load') {
      const [r1, r2, r3, r4, r5] = await Promise.all([
        fetch(SB+'/rest/v1/recipes?select=*&order=created_at.asc', { headers: SH_READ }),
        fetch(SB+'/rest/v1/variants?select=*&order=created_at.asc', { headers: SH_READ }),
        fetch(SB+'/rest/v1/ingredients?select=*&order=sort_order.asc', { headers: SH_READ }),
        fetch(SB+'/rest/v1/l2_items?select=*&order=created_at.asc', { headers: SH_READ }),
        fetch(SB+'/rest/v1/l3_items?select=*&order=created_at.asc', { headers: SH_READ })
      ]);
      const [recipes, variants, ingredients, l2_items, l3_items] = await Promise.all([r1.json(), r2.json(), r3.json(), r4.json(), r5.json()]);
      return res.status(200).json({ recipes, variants, ingredients, l2_items, l3_items });
    }

    if (body.supabaseAction === 'save') {
      const { recipe, variants, ingredients, l2Items, l3Items } = body.data;

      // Upsert honesto: propaga un errore reale invece di dichiarare ok:true
      // quando Supabase risponde con un errore HTTP.
      const write = async (table, payload, label) => {
        const r = await fetch(SB+'/rest/v1/'+table, { method: 'POST', headers: SH_WRITE, body: JSON.stringify(payload) });
        if (!r.ok) {
          const detail = await r.text().catch(() => '');
          throw new Error('Supabase write failed on '+label+' ('+r.status+'): '+detail);
        }
      };

      // 1. Upsert ricetta
      await write('recipes', recipe, 'recipes');

      // 2. Upsert varianti
      if (variants && variants.length) {
        await write('variants', variants, 'variants');
      }

      // 3. Ingredienti: delete per variant_id, poi insert pulito
      //    (pattern valido solo per liste senza identita' stabile richiesta,
      //    MAI usare questo pattern per l2_items/l3_items)
      if (ingredients && ingredients.length) {
        const variantIds = [...new Set(ingredients.map(i => i.variant_id))];
        for (const vid of variantIds) {
          const dr = await fetch(SB+'/rest/v1/ingredients?variant_id=eq.'+vid, {
            method: 'DELETE', headers: SH_DEL
          });
          if (!dr.ok) {
            const detail = await dr.text().catch(() => '');
            throw new Error('Supabase delete failed on ingredients ('+dr.status+'): '+detail);
          }
        }
        await write('ingredients', ingredients, 'ingredients');
      }

      // 4. L2Items: identita' stabile, sempre upsert per id, mai delete+insert
      if (l2Items && l2Items.length) {
        await write('l2_items', l2Items, 'l2_items');
      }

      // 5. L3Items: identita' stabile, sempre upsert per id, mai delete+insert
      if (l3Items && l3Items.length) {
        await write('l3_items', l3Items, 'l3_items');
      }

      return res.status(200).json({ ok: true });
    }

    if (body.supabaseAction === 'update') {
      const r = await fetch(SB+'/rest/v1/'+body.table, {
        method: 'POST', headers: SH_WRITE, body: JSON.stringify(body.data)
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        throw new Error('Supabase update failed on '+body.table+' ('+r.status+'): '+detail);
      }
      return res.status(200).json({ ok: true });
    }

    if (body.supabaseAction === 'delete') {
      const r = await fetch(SB+'/rest/v1/'+body.table+'?id=eq.'+body.id, {
        method: 'DELETE', headers: SH_DEL
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        throw new Error('Supabase delete failed on '+body.table+' ('+r.status+'): '+detail);
      }
      return res.status(200).json({ ok: true });
    }

    if (body.mode === 'm1') {
      const userMessage = buildM1UserMessage(body);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 3000,
          system: M1_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    }

    // Proxy Anthropic AI
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
}
