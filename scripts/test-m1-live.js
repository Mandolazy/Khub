/*
 * Test M1 — Primo Consulto — chiamata live contro il deployment reale.
 *
 * Colpisce /api/chat con mode:'m1' esattamente come farebbe il browser
 * (stesso payload costruito da runM1() in khub_mvp.html), usando due
 * fixture realistiche (B1 Cacio e pepe, B2 mousse cioccolato/olio di
 * cocco) e stampa la risposta INTEGRALE del modello per revisione.
 *
 * Non e' eseguibile da questo sandbox: richiede un deployment raggiungibile
 * (Vercel prod, preview, o `vercel dev` locale) con ANTHROPIC_API_KEY
 * configurata lato server — nessuna delle due e' disponibile qui.
 *
 * Uso:
 *   node scripts/test-m1-live.js https://<il-tuo-deployment>.vercel.app
 * oppure, con `vercel dev` in esecuzione in locale:
 *   node scripts/test-m1-live.js http://localhost:3000
 *
 * Questo script NON persiste nulla su Supabase (chiama solo mode:'m1',
 * non supabaseAction:'save'): verifica solo la risposta del modello.
 * Per T3/T6/T7(persistenza)/T10 il modo piu' semplice e' usare l'app
 * reale nel browser (Ricetta in LAB -> "Avvia Primo Consulto") e
 * verificare gli L2 risultanti da Supabase.
 */
const baseUrl = process.argv[2] || process.env.APP_URL;
if (!baseUrl) {
  console.error('Manca l\'URL del deployment.');
  console.error('Uso: node scripts/test-m1-live.js https://<il-tuo-deployment>.vercel.app');
  console.error('oppure: node scripts/test-m1-live.js http://localhost:3000  (con `vercel dev` attivo)');
  process.exit(2);
}

const FIXTURES = [
  {
    name: 'B1 — Cacio e pepe',
    payload: {
      mode: 'm1',
      recipe: { id: 'test-b1-cacio-pepe', name: 'Cacio e pepe', category: 'Salato' },
      variant: {
        id: 'test-b1-variant',
        ingredients: [
          { name: 'Spaghetti', qty: 320, unit: 'g' },
          { name: 'Pecorino Romano DOP', qty: 200, unit: 'g' },
          { name: 'Pepe nero in grani, tostato e macinato al momento', qty: 6, unit: 'g' },
          { name: 'Acqua di cottura della pasta', qty: 150, unit: 'ml' },
        ],
        steps: [
          "Tostare il pepe nero in grani in padella a secco, poi macinarlo grossolanamente.",
          "Cuocere gli spaghetti in acqua poco salata.",
          "Grattugiare finemente il pecorino e stemperarlo con un po' di acqua di cottura tiepida fino a ottenere una crema liscia.",
          "Scolare la pasta al dente direttamente in padella con il pepe tostato, aggiungere un mestolo di acqua di cottura.",
          "Fuori dal fuoco, mantecare con la crema di pecorino fino a ottenere una salsa cremosa e omogenea.",
        ],
        portionsCount: 2, gramsPerPortion: 260,
        note: "Ricetta classica, provata due volte: la seconda volta la salsa ha stracciato appena tolta dal fuoco.",
      },
      intention: { initial: null, current: null },
      criteria: { initial: null, current: null },
      l3: [],
    },
  },
  {
    name: 'B2 — Mousse cioccolato / olio di cocco',
    payload: {
      mode: 'm1',
      recipe: { id: 'test-b2-choc-coco', name: 'Mousse al cioccolato fondente con olio di cocco', category: 'Dolci' },
      variant: {
        id: 'test-b2-variant',
        ingredients: [
          { name: 'Cioccolato fondente 70%', qty: 200, unit: 'g' },
          { name: 'Olio di cocco', qty: 30, unit: 'g' },
          { name: 'Panna fresca 35% m.g.', qty: 250, unit: 'ml' },
          { name: 'Zucchero a velo', qty: 20, unit: 'g' },
          { name: 'Albumi', qty: 2, unit: 'n' },
        ],
        steps: [
          "Sciogliere il cioccolato fondente a bagnomaria insieme all'olio di cocco.",
          "Montare la panna a neve morbida.",
          "Montare gli albumi a neve con lo zucchero a velo.",
          "Incorporare delicatamente la panna montata al cioccolato intiepidito.",
          "Incorporare infine gli albumi montati.",
          "Far riposare in frigorifero almeno 4 ore.",
        ],
        portionsCount: 6, gramsPerPortion: 110,
        note: "Ho sostituito parte del burro di cacao con olio di cocco pensando desse più scioglievolezza in bocca. Non sono sicuro se cambi la struttura della mousse dopo il riposo in frigo.",
      },
      intention: { initial: null, current: { text: "Vorrei una mousse che si sciolga rapidamente in bocca, quasi 'burrosa', mantenendo comunque struttura sufficiente da tenere la forma se servita a quenelle." } },
      criteria: { initial: null, current: null },
      l3: [],
    },
  },
];

function checkShape(text) {
  const issues = [];
  if (!text.trim()) { issues.push('risposta vuota'); return issues; }
  const marker = '===M1_OBSERVATIONS===';
  const idx = text.indexOf(marker);
  if (idx === -1) { issues.push('marcatore ===M1_OBSERVATIONS=== assente'); return issues; }
  const userText = text.slice(0, idx).trim();
  if (!userText) issues.push('testo user-facing vuoto');
  let jsonPart = text.slice(idx + marker.length).trim().replace(/```json|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(jsonPart); } catch (e) { issues.push('blocco JSON non valido: ' + e.message); return issues; }
  if (!parsed || !Array.isArray(parsed.observations)) { issues.push('observations non e\' un array'); return issues; }
  parsed.observations.forEach((o, i) => {
    const keys = Object.keys(o || {}).sort();
    const extra = keys.filter(k => k !== 'label' && k !== 'content');
    if (extra.length) issues.push('osservazione ' + i + ' ha chiavi non attese: ' + extra.join(','));
    if (typeof o.content !== 'string' || !o.content.trim()) issues.push('osservazione ' + i + ' senza content valido');
  });
  return issues;
}

async function run() {
  for (const fixture of FIXTURES) {
    console.log('══════════════════════════════════════════════════');
    console.log(fixture.name);
    console.log('══════════════════════════════════════════════════');
    try {
      const res = await fetch(baseUrl.replace(/\/$/, '') + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fixture.payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        console.log('FAIL — HTTP ' + res.status + ' — ' + JSON.stringify(data));
        continue;
      }
      const text = (data.content || []).map(c => c.text || '').join('');
      console.log('--- OUTPUT INTEGRALE DEL MODELLO ---');
      console.log(text);
      console.log('--- FINE OUTPUT ---');
      const issues = checkShape(text);
      console.log(issues.length ? ('FORMA: FAIL — ' + issues.join('; ')) : 'FORMA: ok (marcatore, JSON, chiavi attese)');
    } catch (e) {
      console.log('FAIL — errore di rete/esecuzione: ' + e.message);
    }
    console.log('');
  }
  console.log('Revisione qualitativa (specificita\', selettivita\', distinzione epistemica) NON automatizzabile:');
  console.log('leggi l\'output integrale sopra per B1 (specifico/selettivo/operativo, non descrittivo)');
  console.log('e B2 (distingue fatto tecnico da ipotesi/preferenza, non inventa dati mancanti).');
}

run();
