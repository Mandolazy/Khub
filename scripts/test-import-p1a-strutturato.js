/*
 * Test — P1-a: estrazione strutturata da link web (schema.org/Recipe, testo
 * selezionato della pagina, AI solo se serve).
 *
 * Chromium offline sulla demo locale isolata (demo/direzione-3/server.js:
 * pagina e api/chat.js reali, database in memoria, rete bloccata). Le sole
 * risposte simulate sono la lettura della pagina (fetchUrl) e l'AI. Fixture
 * SINTETICHE; le due "rappresentative" sono ricostruite sui dati della diagnosi
 * R0 (GialloZafferano Tiramisu', Sonia Peronaci Ganache) e non sono copie delle
 * pagine reali.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    ')); }
}
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
// La neutralizzazione dei testi e' interna a extractRecipe (P0-a): la si usa identica.
const er = HTML.indexOf('async function extractRecipe(){');
const PULISCI = HTML.slice(HTML.indexOf('  const ENTITA=', er), HTML.indexOf('  const sicuroSeTesto', er)) + 'return testoSicuro;';
// Come nei siti reali, "</" dentro il JSON-LD e' scritto "<\/" (altrimenti chiude il blocco <script>).
const ld = o => `<script type="application/ld+json">${JSON.stringify(o).replace(/<\//g, '<\\/')}</script>`;

// ── Fixture rappresentative (sintetiche, costruite sui dati R0) ──────────────
const GZ_RICETTA = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Tiramisù', description: 'Il tiramisù è il dolce al cucchiaio più famoso.',
  url: 'https://ricette.giallozafferano.it/Tiramisu.html', recipeYield: '10', prepTime: 'PT40M', cookTime: 'PT0M', totalTime: 'PT40M',
  recipeIngredient: ['Mascarpone 750 g', 'Uova (freschissime, circa 5 medie) 260 g', 'Savoiardi 250 g', 'Zucchero 120 g', 'Caffè 300 g (preparato con moka e zuccherato a piacere)', 'Cacao amaro in polvere q.b.'],
  recipeInstructions: ['Preparate il caffè con la moka.', 'Separate gli albumi dai tuorli.', 'Montate i tuorli con metà dello zucchero.', 'Aggiungete il mascarpone poco alla volta.', 'Montate gli albumi con lo zucchero rimasto.', 'Inzuppate i savoiardi nel caffè freddo.', 'Alternate strati di crema e savoiardi e spolverizzate con cacao.'].map(t => ({ '@type': 'HowToStep', text: t })) };
const GZ_INTRO = '<p>' + 'Il tiramisù è un dolce della tradizione italiana, nato in Veneto e amato in tutto il mondo per la sua crema morbida. '.repeat(22) + '</p>';
const GZ_HTML = `<!doctype html><html><head><title>Ricetta Tiramisù - La Ricetta di GialloZafferano</title>${ld({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'GialloZafferano' })}${ld({ '@type': 'BreadcrumbList', itemListElement: [] })}${ld(GZ_RICETTA)}</head>
<body><header><nav>${'<a>Ricette</a><a>Dolci</a><a>Primi</a>'.repeat(40)}</nav></header><main><h1>Tiramisù</h1>${GZ_INTRO}
<div class="gz-list-featured-data"><span>Difficoltà: facile</span><span>Preparazione: 40 min</span><span>Dosi per: 10 persone</span></div>
<h2>Ingredienti</h2><ul>${GZ_RICETTA.recipeIngredient.map(i => '<li><span class="gz-ingredient">' + i + '</span></li>').join('')}</ul>
<h2>Come preparare il Tiramisù</h2>${GZ_RICETTA.recipeInstructions.map(s => '<p>' + s.text + '</p>').join('')}
<section class="commenti">${'<p>Ottima ricetta, la rifarò per Natale con la mia famiglia!</p>'.repeat(120)}</section></main><footer>${'<p>Informazioni legali e privacy</p>'.repeat(80)}</footer></body></html>`;
const SP_RICETTA = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', '@id': 'https://www.soniaperonaci.it/ganache-al-caramello-salato/' }, { '@type': 'Person', name: 'Sonia Peronaci' },
  { '@type': ['Recipe'], name: 'Ganache al caramello salato', mainEntityOfPage: { '@id': 'https://www.soniaperonaci.it/ganache-al-caramello-salato/' }, prepTime: 'PT20M', cookTime: 'PT10M',
    recipeIngredient: ['200 g di panna fresca liquida', '150 g di zucchero semolato', '30 g di burro', '2 g di fior di sale', '150 g di cioccolato bianco', '1 baccello di vaniglia', '1 cucchiaio di sciroppo di glucosio'],
    recipeInstructions: ['Scaldate la panna con i semi della vaniglia.', 'In un pentolino caramellate lo zucchero a secco.', 'Versate la panna calda sul caramello mescolando.', 'Aggiungete burro e fior di sale.', 'Unite il glucosio.', 'Versate sul cioccolato bianco tritato ed emulsionate.', 'Coprite con pellicola a contatto e lasciate raffreddare.'] }] };
const SP_HTML = `<!doctype html><html><head><title>Ganache al caramello salato - Sonia Peronaci</title>${ld({ '@type': 'Organization', name: 'SP' })}${ld({ '@type': 'BreadcrumbList' })}${ld(SP_RICETTA)}</head>
<body><header><nav>${'<a>Ricette</a><a>Video</a>'.repeat(30)}</nav></header><article><h1>Ganache al caramello salato</h1><p>${'Una ganache golosa e versatile, perfetta per farcire torte e crostate. '.repeat(30)}</p>
<aside class="recipe-card"><h3>Ingredienti</h3><ul><li>Panna fresca liquida 200 g</li><li>Zucchero semolato 150 g</li><li>Burro 30 g</li><li>Fior di sale 2 g</li><li>Cioccolato bianco 150 g</li><li>Vaniglia 1 baccello</li><li>Sciroppo di glucosio 1 cucchiaio</li></ul></aside>
<h2>Preparazione</h2>${SP_RICETTA['@graph'][2].recipeInstructions.map(s => '<p>' + s + '</p>').join('')}</article><footer>${'<p>Newsletter e social</p>'.repeat(40)}</footer></body></html>`;

(async () => {
  if (!chromium) { console.log('Playwright non disponibile: test non eseguibile'); process.exit(1); }
  const porta = await portaLibera();
  const figlio = spawn(process.execPath, [path.join(ROOT, 'demo/direzione-3/server.js'), String(porta)], { env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logDemo = ''; figlio.stdout.on('data', d => { logDemo += d; }); figlio.stderr.on('data', d => { logDemo += d; });
  const t0 = Date.now();
  while (!/Apri nel browser/.test(logDemo)) { if (Date.now() - t0 > 15000) { console.log(logDemo); throw new Error('demo non avviata'); } await new Promise(r => setTimeout(r, 50)); }
  const ORIGINE = 'http://localhost:' + porta;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const chiamate = { ai: [], pagina: [] };
  let rispostaAI = () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'x' } } });
  let paginaHtml = '';
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGINE) return route.abort();
    if (/^\/lib\/[a-z]+\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, u.pathname)) });
    if (u.pathname === '/api/chat') {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* vuoto */ }
      if (body.messages) { chiamate.ai.push(body); const r = rispostaAI(body); return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.json) }); }
      if (body.fetchUrl !== undefined) { chiamate.pagina.push(body); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, html: paginaHtml, finalUrl: body.fetchUrl, status: 200, troncato: false }) }); }
    }
    return route.continue();
  });
  await context.addInitScript(() => { window.__xss = []; window.alert = () => window.__xss.push('alert'); try { localStorage.setItem('khub_onboarded', '1'); } catch (e) { /* no */ } });
  const page = await context.newPage();
  const erroriPagina = []; page.on('pageerror', e => erroriPagina.push(String(e && e.message || e)));
  await page.goto(ORIGINE + '/khub_mvp.html?ui=d3');
  await page.waitForFunction(() => typeof S !== 'undefined' && Array.isArray(S.recipes) && S.recipes.length > 0, null, { timeout: 15000 });
  await page.evaluate(src => { window.__pulisci = new Function(src)(); }, PULISCI);
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const okAI = obj => () => ({ status: 200, json: { content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' } });
  const importaLink = async (html, url) => {
    paginaHtml = html;
    await ev(u => { S.view = 'load'; S.loadPreview = null; S.loadError = null; S.loadTab = 'link'; S.loadUrl = u; render(); }, url);
    await page.click('#btn-extract');
    await page.waitForFunction(() => !S.isLoading && (S.loadPreview || S.loadError));
    return ev(() => ({ p: S.loadPreview, err: S.loadError && S.loadError.msg }));
  };
  const analizza = (html, url) => ev(([h, u]) => importAnalizzaPagina(h, u, window.__pulisci), [html, url]);
  // Estrazione di P0-a (0d5512f) per il confronto prima/dopo: stessa regola di testoPagina.
  const vecchioTesto = html => ev(h => { const d = new DOMParser().parseFromString(h, 'text/html'); d.querySelectorAll('script,style,nav,header,footer,aside').forEach(e => e.remove()); return ((d.documentElement && d.documentElement.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 6000); }, html);
  const caricaDb = () => ev(async () => (await (await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supabaseAction: 'load' }) })).json()));

  console.log('P1-a — estrazione strutturata (JSON-LD, ingredienti, HTML)');

  await test('J1. Recipe singola, array, @graph, @type come array o URL, struttura annidata (mainEntity)', async () => {
    const R = { '@type': 'Recipe', name: 'Crema', recipeIngredient: ['500 g latte'], recipeInstructions: 'Scaldare.' };
    const casi = [[ld(R), 'singola'], [ld([{ '@type': 'Organization' }, R]), 'array'], [ld({ '@graph': [{ '@type': 'WebSite' }, R] }), '@graph'],
      [ld(Object.assign({}, R, { '@type': ['Recipe', 'NewsArticle'] })), '@type array'], [ld(Object.assign({}, R, { '@type': 'http://schema.org/Recipe' })), '@type URL'],
      [ld({ '@type': 'WebPage', mainEntity: { '@type': 'ItemPage', about: R } }), 'annidata']];
    for (const [h, nome] of casi) { const a = await analizza('<html><head>' + h + '</head><body></body></html>', 'https://x.test/r');
      assert.strictEqual(a.jsonld.ricette, 1, nome); assert.ok(a.ricetta && a.ricetta.nome === 'Crema' && a.ricetta.completa, nome); }
  });

  await test('J2. procedimento: testo semplice con a capo/HTML, array di stringhe, HowToStep, HowToSection (sezioni conservate, nessuna sottoricetta)', async () => {
    const P = istr => analizza('<html>' + ld({ '@type': 'Recipe', name: 'X', recipeIngredient: ['1 uovo'], recipeInstructions: istr }) + '</html>', 'https://x.test/');
    assert.deepStrictEqual((await P('Scaldare il latte.\nUnire i tuorli.<br>Cuocere.')).ricetta.passi, ['Scaldare il latte.', 'Unire i tuorli.', 'Cuocere.']);
    assert.deepStrictEqual((await P('<p>Uno.</p><p>Due.</p>')).ricetta.passi, ['Uno.', 'Due.']);
    assert.deepStrictEqual((await P(['A.', 'B.'])).ricetta.passi, ['A.', 'B.']);
    assert.deepStrictEqual((await P([{ '@type': 'HowToStep', text: 'A.' }, { '@type': 'HowToStep', name: 'B.' }])).ricetta.passi, ['A.', 'B.']);
    const s = (await P([{ '@type': 'HowToSection', name: 'Per la crema', itemListElement: [{ '@type': 'HowToStep', text: 'Scaldare.' }, { '@type': 'HowToStep', text: 'Montare.' }] },
      { '@type': 'HowToSection', name: 'Per la base', itemListElement: [{ '@type': 'HowToStep', text: 'Impastare.' }] }])).ricetta;
    assert.deepStrictEqual(s.passi, ['Scaldare.', 'Montare.', 'Impastare.']);
    assert.deepStrictEqual(s.sezioni, [{ nome: 'Per la crema', da: 0, a: 1 }, { nome: 'Per la base', da: 2, a: 2 }]);
    const ant = await ev(r => importAnteprimaStrutturata(r, 'https://x.test/'), s);
    assert.deepStrictEqual(ant.steps, ['Per la crema — Scaldare.', 'Montare.', 'Per la base — Impastare.'], 'nome della sezione dalla fonte, nessun passaggio inventato');
    assert.deepStrictEqual(ant.subRecipes, [], 'nessuna sottoricetta automatica');
  });

  await test('J3. piu\' Recipe: scelta deterministica (indirizzo della pagina, unica completa) oppure nessuna se ambigua', async () => {
    const A = { '@type': 'Recipe', name: 'A', url: 'https://x.test/a', recipeIngredient: ['1 uovo'], recipeInstructions: 'x' };
    const B = { '@type': 'Recipe', name: 'B', url: 'https://x.test/b/', recipeIngredient: ['2 uova'], recipeInstructions: 'y' };
    const C = { '@type': 'Recipe', name: 'C (anteprima)', url: 'https://x.test/c' };
    const h = '<html>' + ld([A, B, C]) + '</html>';
    assert.strictEqual((await analizza(h, 'https://x.test/b?utm=1#top')).ricetta.nome, 'B', 'stesso indirizzo');
    assert.strictEqual((await analizza('<html>' + ld([A, C]) + '</html>', 'https://x.test/altro')).ricetta.nome, 'A', 'unica completa');
    const amb = await analizza(h, 'https://x.test/elenco');
    assert.strictEqual(amb.ricetta, null); assert.strictEqual(amb.jsonld.scelta, 'ambigua');
  });

  await test('J4. JSON-LD non valido ignorato senza errori (gli altri blocchi restano letti); Recipe incompleta riconosciuta come tale', async () => {
    const a = await analizza('<html><script type="application/ld+json">{ "@type": "Recipe", "name": "Rotta", }</script>' + ld({ '@type': 'Recipe', name: 'Buona', recipeIngredient: ['1 uovo'], recipeInstructions: 'x' }) + '</html>', 'https://x.test/');
    assert.strictEqual(a.jsonld.nonValidi, 1); assert.strictEqual(a.ricetta.nome, 'Buona');
    const inc = (await analizza('<html>' + ld({ '@type': 'Recipe', name: 'Solo ingredienti', recipeIngredient: ['1 uovo'] }) + '</html>', 'https://x.test/')).ricetta;
    assert.strictEqual(inc.completa, false); assert.deepStrictEqual(inc.mancanze, ['procedimento']);
    const vuota = (await analizza('<html>' + ld({ '@type': 'Recipe' }) + '</html>', 'https://x.test/')).ricetta;
    assert.deepStrictEqual(vuota.mancanze, ['nome', 'ingredienti', 'procedimento']);
  });

  await test('J5. tempi ISO 8601 e resa: mai inventata (numero senza unita\' solo con conferma nella pagina), intervalli mai ridotti', async () => {
    const R = extra => '<html>' + ld(Object.assign({ '@type': 'Recipe', name: 'X', recipeIngredient: ['1 uovo'], recipeInstructions: 'x' }, extra)) + '<body><p>Dosi per: 10 persone</p></body></html>';
    let r = (await analizza(R({ recipeYield: '10', prepTime: 'PT1H30M', cookTime: 'P0DT0H40M', totalTime: 'PT2H10M' }), 'https://x.test/')).ricetta;
    assert.deepStrictEqual(r.resa.raw, { qty: '10', unit: 'persone', range: null, source: '10 persone' }, 'unita\' presa dalla pagina, citazione letterale');
    assert.deepStrictEqual([r.tempi.preparazione.minuti, r.tempi.cottura.minuti, r.tempi.totale.minuti], [90, 40, 130]);
    r = (await analizza('<html>' + ld({ '@type': 'Recipe', name: 'X', recipeIngredient: ['1 uovo'], recipeInstructions: 'x', recipeYield: '10' }) + '</html>', 'https://x.test/')).ricetta;
    assert.strictEqual(r.resa.raw, null); assert.ok(/«10» senza unità/.test(r.resa.nota), 'nessuna unita\' inventata');
    assert.deepStrictEqual((await analizza(R({ recipeYield: ['4', '4 persone'] }), 'https://x.test/')).ricetta.resa.raw, { qty: '4', unit: 'persone', range: null, source: '4 persone' });
    assert.deepStrictEqual((await analizza(R({ recipeYield: '4-6 porzioni' }), 'https://x.test/')).ricetta.resa.raw.range, { min: '4', max: '6' });
    assert.strictEqual((await analizza(R({ recipeYield: 'Serves 4' }), 'https://x.test/')).ricetta.resa.raw.unit, 'Serves');
    const ant = await ev(r2 => importAnteprimaStrutturata(r2, 'https://x.test/'), (await analizza(R({ recipeYield: 'Serves 4' }), 'https://x.test/')).ricetta);
    assert.deepStrictEqual([ant.declaredYield.qty, ant.declaredYield.unit, ant.declaredYield.source], ['4', 'porzioni', 'Serves 4']);
    assert.strictEqual(ant.portionsCount, 0, 'la resa non diventa Porzioni');
  });

  await test('I1. ingredienti: testo originale sempre conservato; quantita\' e unita\' solo se rappresentabili; mai 0 per assenti, mai "g" per sconosciute', async () => {
    const T = [
      ['500 g di farina', 'farina', 500, 'g', 'estratto'], ['Mascarpone 750 g', 'Mascarpone', 750, 'g', 'estratto'], ['1,5 kg patate', 'patate', 1.5, 'kg', 'estratto'],
      ['½ litro di latte', 'latte', 0.5, 'l', 'estratto'], ['1/2 cucchiaino di sale', 'sale', 0.5, 'tsp', 'estratto'], ['1 cucchiaio di olio', 'olio', 1, 'tbsp', 'estratto'],
      ['6 uova', 'uova', 6, 'n', 'estratto'], ['Uova 6', 'Uova', 6, 'n', 'estratto'], ['Panna fresca 200 gr.', 'Panna fresca', 200, 'g', 'estratto'],
      ['2 spicchi d\'aglio', 'aglio', 2, null, 'da_confermare'], ['1 pizzico di sale', 'sale', 1, null, 'da_confermare'], ['1 dl di latte', 'latte', 1, null, 'da_confermare'],
      ['2-3 cucchiai di olio', 'olio', null, null, 'da_confermare'], ['Sale q.b.', 'Sale', null, null, 'mancante'], ['Pepe nero qb', 'Pepe nero', null, null, 'mancante'],
      ['Zucchero a velo per decorare', 'Zucchero a velo', null, null, 'mancante'], ['Sale fino', 'Sale fino', null, null, 'mancante'],
      ['Uova (freschissime, circa 5 medie) 260 g', 'Uova (freschissime, circa 5 medie)', 260, 'g', 'estratto'], ['Caffè 300 g (preparato con moka)', 'Caffè (preparato con moka)', 300, 'g', 'estratto'],
      ['200 ml di panna fresca liquida (35% di grassi)', 'panna fresca liquida (35% di grassi)', 200, 'ml', 'estratto'], ['3 tuorli (60 g)', 'tuorli (60 g)', 3, 'n', 'estratto'],
      ['Burro 100 g + q.b. per la teglia', 'Burro 100 g + q.b. per la teglia', null, null, 'da_confermare'], ['Farina 00 300 g', 'Farina 00', 300, 'g', 'estratto'],
    ];
    const r = await ev(righe => righe.map(x => importIngredienteDaRiga(x, window.__pulisci)), T.map(x => x[0]));
    T.forEach(([riga, name, qty, unit, stato], i) => assert.deepStrictEqual([r[i].name, r[i].qty, r[i].unit, r[i].statoImport, r[i].originale], [name, qty, unit, stato, riga], riga));
  });

  await test('H1. pagina senza JSON-LD con lunga introduzione e ingredienti oltre i 6.000 caratteri: prima 0 ingredienti all\'AI, ora tutti', async () => {
    const ing = ['500 g di farina', '250 g di burro', '200 g di zucchero', '3 uova', '1 bustina di lievito'];
    const h = `<html><body><h1>Crostata</h1><p>${'La crostata della nonna era sempre pronta la domenica. '.repeat(160)}</p><h2>Ingredienti</h2><ul>${ing.map(i => '<li>' + i + '</li>').join('')}</ul><h2>Preparazione</h2><p>Impastate e cuocete in forno a 180 °C per 40 minuti.</p></body></html>`;
    const vecchio = await vecchioTesto(h);
    assert.strictEqual(ing.filter(i => vecchio.includes(i)).length, 0, 'P0-a: ingredienti esclusi dal taglio a 6.000');
    const a = await analizza(h, 'https://x.test/');
    assert.strictEqual(a.ricetta, null); assert.strictEqual(a.selezione.gastronomica, true);
    assert.ok(ing.every(i => a.selezione.testo.includes(i)), 'tutti gli ingredienti selezionati');
    assert.ok(a.selezione.testo.includes('180 °C') && a.selezione.testo.startsWith('Crostata'), 'titolo e procedimento');
    assert.ok(a.selezione.testo.length < 1000, 'solo la parte gastronomica: ' + a.selezione.testo.length);
  });

  await test('H2. ricetta dentro <aside>: prima eliminata, ora conservata; aside non gastronomici ancora eliminati', async () => {
    const h = `<html><body><article><h1>Ganache</h1><p>Breve introduzione alla ricetta con qualche consiglio per la conservazione in frigorifero per un giorno o due.</p></article>
      <aside class="pubblicita"><p>Iscriviti alla newsletter per ricevere sconti esclusivi ogni settimana</p></aside>
      <aside class="ricetta"><h3>Ingredienti</h3><ul><li>Panna 200 g</li><li>Cioccolato 150 g</li></ul></aside><p>Scaldate la panna e versatela sul cioccolato mescolando.</p></body></html>`;
    assert.ok(!(await vecchioTesto(h)).includes('Panna 200 g'));
    const s = (await analizza(h, 'https://x.test/')).selezione;
    assert.ok(s.testo.includes('Panna 200 g') && s.testo.includes('Cioccolato 150 g')); assert.ok(!s.testo.includes('newsletter'));
  });

  await test('H3. contenuti non gastronomici riconosciuti (nessuna AI); pagina normale senza JSON-LD riconosciuta come ricetta', async () => {
    const news = '<html><body><h1>Elezioni comunali</h1><p>' + 'Il consiglio comunale si è riunito per discutere il bilancio annuale e le nuove opere pubbliche. '.repeat(20) + '</p></body></html>';
    assert.strictEqual((await analizza(news, 'https://x.test/')).selezione.gastronomica, false);
    const ric = '<html><body><h1>Pasta</h1><ul><li>320 g di spaghetti</li><li>2 spicchi d\'aglio</li><li>Olio q.b.</li></ul><p>Cuocete la pasta.</p></body></html>';
    assert.strictEqual((await analizza(ric, 'https://x.test/')).selezione.gastronomica, true);
  });

  await test('H4. HTML malevolo: script e gestori della pagina mai eseguiti; markup e entita\' nel JSON-LD neutralizzati', async () => {
    const R = { '@type': 'Recipe', name: 'Torta <img src=x onerror="window.__xss.push(\'nome\')">', recipeIngredient: ['200 g farina <script>window.__xss.push("ing")</script>', '&lt;img src=x onerror=alert(1)&gt; 100 g'],
      recipeInstructions: [{ '@type': 'HowToStep', text: '<b>Impastare</b> <svg onload="window.__xss.push(\'passo\')">' }] };
    const h = '<html><head><script>window.__xss.push("script")</script>' + ld(R) + '</head><body><img src=x onerror="window.__xss.push(\'pagina\')"><p>200 g farina</p><p>100 g zucchero</p></body></html>';
    const a = await analizza(h, 'https://x.test/');
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await ev(() => window.__xss.slice()), []);
    const tutto = JSON.stringify(a);
    assert.ok(!/<img|<svg|<script|<b>/i.test(tutto), 'nessun markup nei dati: ' + tutto);
    assert.ok(!/&lt;|&gt;|&amp;lt;/i.test(tutto), 'nessuna entita\' che possa tornare markup');
    assert.strictEqual(a.ricetta.nome, 'Torta'); assert.deepStrictEqual(a.ricetta.passi, ['Impastare']);
  });

  console.log('P1-a — flusso link -> anteprima -> Scheda -> LAB');

  await test('F1. fixture GialloZafferano (Tiramisù): anteprima dai dati strutturati, nessuna chiamata AI, ingredienti con testo originale, 7 passaggi, resa "10 persone" citata, tempi', async () => {
    const n0 = chiamate.ai.length;
    const { p, err } = await importaLink(GZ_HTML, 'https://ricette.giallozafferano.it/Tiramisu.html');
    assert.strictEqual(err, null); assert.strictEqual(chiamate.ai.length - n0, 0, 'nessuna AI');
    assert.strictEqual(p.name, 'Tiramisù'); assert.strictEqual(p.importFonte.tipo, 'strutturata');
    assert.deepStrictEqual(p.ingredients.map(i => [i.name, i.qty, i.unit, i.statoImport]), [['Mascarpone', 750, 'g', 'estratto'], ['Uova (freschissime, circa 5 medie)', 260, 'g', 'estratto'],
      ['Savoiardi', 250, 'g', 'estratto'], ['Zucchero', 120, 'g', 'estratto'], ['Caffè (preparato con moka e zuccherato a piacere)', 300, 'g', 'estratto'], ['Cacao amaro in polvere', null, null, 'mancante']]);
    assert.strictEqual(p.steps.length, 7);
    assert.deepStrictEqual([p.declaredYield.qty, p.declaredYield.unit, p.declaredYield.source], ['10', 'porzioni', '10 persone']);
    const banda = await page.textContent('.preview-fonte');
    assert.ok(/dati strutturati/.test(banda) && /Preparazione: 40 min/.test(banda) && /1 ingrediente da confermare/.test(banda), banda);
    assert.ok((await page.textContent('.preview-ing-originale')).includes('Cacao amaro in polvere q.b.'));
    assert.strictEqual(await page.$eval('select[data-prev-ing="5"]', s => s.value), '', 'unita\' "—", non "g"');
  });

  await test('F2. salvataggio GialloZafferano come nuova Scheda: Ricetta in LAB, ingredienti e passaggi salvati; limite noto: "q.b." salvato oggi come 0 g', async () => {
    const prima = (await caricaDb()).recipes.length;
    await page.click('#btn-save-preview'); await page.waitForFunction(() => S.view === 'ricetta-madre-v2'); await page.waitForTimeout(700);
    const db = await caricaDb(); assert.strictEqual(db.recipes.length, prima + 1, 'una sola Scheda, nessuna sottoricetta');
    const rec = db.recipes.find(r => r.name === 'Tiramisù' && !db.variants.some(v => v.recipe_id === r.id && v.status !== 'lab'));
    const v = db.variants.find(x => x.recipe_id === rec.id);
    assert.strictEqual(v.status, 'lab'); assert.strictEqual(v.active, false);
    const ing = db.ingredients.filter(i => i.variant_id === v.id).sort((a, b) => a.sort_order - b.sort_order).map(i => [i.name, Number(i.qty), i.unit]);
    assert.deepStrictEqual(ing.slice(0, 5).map(x => x[1]), [750, 260, 250, 120, 300]);
    assert.deepStrictEqual(ing[5], ['Cacao amaro in polvere', 0, 'g'], 'limite del modello attuale (P0-c): quantita\' assente persistita come 0 g');
    assert.deepStrictEqual([Number(v.declared_yield_qty), v.declared_yield_unit], [10, 'porzioni']);
    await ev(id => { S.view = 'recipe'; S.mode = 'lab'; S.selectedId = id; render(); }, rec.id); await page.waitForTimeout(300);
    assert.strictEqual(await ev(() => curLab(R(S.selectedId)).steps.length), 7, 'apertura nel LAB');
  });

  await test('F3. fixture Sonia Peronaci (Ganache, @graph, ingredienti in aside in formato diverso): nessuna AI, 7 ingredienti, 7 passaggi, nessuna resa inventata; importazione in Scheda esistente con Ricette Attive invariate', async () => {
    const db0 = await caricaDb();
    const scheda = db0.recipes.find(r => db0.variants.some(v => v.recipe_id === r.id && v.active === true));
    const varianti0 = db0.variants.filter(v => v.recipe_id === scheda.id);
    const n0 = chiamate.ai.length;
    const { p } = await importaLink(SP_HTML, 'https://www.soniaperonaci.it/ganache-al-caramello-salato/');
    assert.strictEqual(chiamate.ai.length - n0, 0);
    assert.deepStrictEqual(p.ingredients.map(i => [i.name, i.qty, i.unit, i.statoImport]), [['panna fresca liquida', 200, 'g', 'estratto'], ['zucchero semolato', 150, 'g', 'estratto'], ['burro', 30, 'g', 'estratto'],
      ['fior di sale', 2, 'g', 'estratto'], ['cioccolato bianco', 150, 'g', 'estratto'], ['vaniglia', 1, null, 'da_confermare'], ['sciroppo di glucosio', 1, 'tbsp', 'estratto']]);
    assert.strictEqual(p.ingredients[5].unitaOriginale, 'baccello'); assert.strictEqual(p.steps.length, 7);
    assert.deepStrictEqual([p.declaredYield.qty, p.declaredYield.unit], ['', ''], 'resa non dichiarata: vuota');
    const bozze = await ev(id => (R(id).labVersions || []).map(v => v.id), scheda.id);
    await ev(id => { S.loadDestinazione = 'esistente'; S.loadDestinazioneSchedaId = id; render(); }, scheda.id);
    await page.click('#btn-save-preview'); await page.waitForFunction(() => S.view === 'ricetta-madre-v2'); await page.waitForTimeout(700);
    const db1 = await caricaDb(); const varianti1 = db1.variants.filter(v => v.recipe_id === scheda.id);
    for (const v of varianti0) assert.deepStrictEqual(varianti1.find(x => x.id === v.id), v, 'Ricetta invariata ' + v.id);
    const nuove = varianti1.filter(v => !varianti0.some(x => x.id === v.id) && !bozze.includes(v.id));
    assert.strictEqual(nuove.length, 1); assert.strictEqual(nuove[0].name, 'Ganache al caramello salato'); assert.strictEqual(nuove[0].status, 'lab');
  });

  await test('F4. pagina senza JSON-LD: una sola chiamata AI con il solo testo selezionato (ingredienti inclusi), provenienza mostrata', async () => {
    const ing = ['500 g di farina', '250 g di burro', '3 uova'];
    const h = `<html><body><nav>${'<a>menu</a>'.repeat(50)}</nav><h1>Frolla</h1><p>${'Una storia di famiglia lunga e appassionata. '.repeat(200)}</p><h2>Ingredienti</h2><ul>${ing.map(i => '<li>' + i + '</li>').join('')}</ul><p>Impastate e fate riposare in frigorifero.</p></body></html>`;
    rispostaAI = okAI({ name: 'Frolla', ingredients: [{ name: 'farina', qty: 500, unit: 'g' }], steps: ['Impastate.'] });
    const n0 = chiamate.ai.length; const { p } = await importaLink(h, 'https://x.test/frolla');
    assert.strictEqual(chiamate.ai.length - n0, 1);
    const inviato = chiamate.ai[chiamate.ai.length - 1].messages[0].content;
    const testo = inviato.slice(inviato.indexOf('TESTO:\n') + 7);
    assert.ok(ing.every(i => testo.includes(i)), 'ingredienti nel testo inviato'); assert.ok(testo.length < 1000, 'testo selezionato: ' + testo.length);
    assert.strictEqual(p.importFonte.tipo, 'testo_pagina'); assert.ok((await page.textContent('.preview-fonte')).includes('interpretato dall\'AI'));
  });

  await test('F5. JSON-LD incompleto: una sola chiamata AI con i dati strutturati (righe originali) e l\'istruzione di non cambiare quantita\' e unita\'', async () => {
    const h = '<html>' + ld({ '@type': 'Recipe', name: 'Ragù', recipeIngredient: ['500 g di macinato', '2 spicchi d\'aglio'] }) + '<body><h1>Ragù</h1><p>Il ragù della domenica: un classico della cucina di casa che richiede pazienza e una buona pentola dal fondo spesso.</p><p>Rosolate la carne in pentola, aggiungete il pomodoro e cuocete a fuoco basso per due ore mescolando di tanto in tanto.</p><p>500 g di macinato</p></body></html>';
    rispostaAI = okAI({ name: 'Ragù', ingredients: [{ name: 'macinato', qty: 500, unit: 'g' }], steps: ['Rosolate.'] });
    const n0 = chiamate.ai.length; await importaLink(h, 'https://x.test/ragu');
    assert.strictEqual(chiamate.ai.length - n0, 1);
    const c = chiamate.ai[chiamate.ai.length - 1].messages[0].content;
    assert.ok(/DATI STRUTTURATI DELLA PAGINA/.test(c) && /manca procedimento/.test(c) && c.includes("- 2 spicchi d'aglio") && /mantieni esattamente quantita' e unita'/.test(c));
  });

  await test('F6. pagina non gastronomica: nessuna chiamata AI, messaggio esplicito; piu\' Recipe ambigue: testo all\'AI e avviso in anteprima', async () => {
    const news = '<html><body><h1>Elezioni comunali</h1><p>' + 'Il consiglio comunale si è riunito per discutere il bilancio annuale e le nuove opere pubbliche. '.repeat(20) + '</p></body></html>';
    let n0 = chiamate.ai.length; const r = await importaLink(news, 'https://x.test/news');
    assert.strictEqual(chiamate.ai.length - n0, 0); assert.ok(/non sembra contenere una ricetta/.test(r.err), r.err);
    const A = { '@type': 'Recipe', name: 'A', recipeIngredient: ['1 uovo'], recipeInstructions: 'x' }, B = { '@type': 'Recipe', name: 'B', recipeIngredient: ['2 uova'], recipeInstructions: 'y' };
    rispostaAI = okAI({ name: 'A', ingredients: [{ name: 'uovo', qty: 1, unit: 'n' }], steps: ['x'] });
    n0 = chiamate.ai.length; const amb = await importaLink('<html>' + ld([A, B]) + '<body><h1>Due ricette</h1><p>Due varianti della stessa frittata, una semplice e una piu\' ricca: scegliete quella che preferite secondo il tempo a disposizione. Entrambe si preparano in pochi minuti con ingredienti che avete gia\' in dispensa.</p><ul><li>1 uovo</li><li>2 uova</li></ul><p>Cuocere in padella a fuoco medio.</p></body></html>', 'https://x.test/elenco');
    assert.strictEqual(chiamate.ai.length - n0, 1, 'esito: ' + amb.err); assert.ok((await page.textContent('.preview-fonte')).includes('più ricette strutturate'));
  });

  await test('F7. sicurezza P0-a sul nuovo percorso: pagina con JSON-LD malevolo -> anteprima, Scheda e LAB senza esecuzione', async () => {
    const R = { '@type': 'Recipe', name: 'Torta <img src=x onerror="window.__xss.push(\'n\')">', recipeIngredient: ['200 g farina "><svg onload="window.__xss.push(\'i\')">'],
      recipeInstructions: ['<img src=x onerror="window.__xss.push(\'p\')">Impastare'], description: '<script>window.__xss.push("d")</script>' };
    const { p } = await importaLink('<html><head>' + ld(R) + '</head><body></body></html>', 'https://x.test/x');
    await page.waitForTimeout(200); assert.deepStrictEqual(await ev(() => window.__xss.slice()), [], 'anteprima');
    assert.ok(!/<img|<svg|<script/i.test(JSON.stringify(p)));
    await page.click('#btn-save-preview'); await page.waitForFunction(() => S.view === 'ricetta-madre-v2'); await page.waitForTimeout(500);
    const id = await ev(() => S.selectedId);
    await ev(i => { S.view = 'recipe'; S.mode = 'lab'; S.selectedId = i; render(); }, id); await page.waitForTimeout(300);
    assert.deepStrictEqual(await ev(() => window.__xss.slice()), [], 'Scheda e LAB');
    assert.deepStrictEqual(erroriPagina, []);
  });

  await test('C1. confronto prima/dopo sulle fixture rappresentative (riportato nel rapporto)', async () => {
    const riga = async (nome, html, url, nIng) => {
      const vecchio = await vecchioTesto(html); const a = await analizza(html, url);
      const ingJ = a.ricetta ? a.ricetta.ingredienti : [];
      return { nome, prima_AI: 1, prima_caratteri: vecchio.length, prima_ingredienti_letterali: (a.ricetta ? a.ricetta.ingredienti.map(i => i.originale) : []).filter(o => vecchio.includes(o)).length + '/' + nIng,
        dopo_AI: a.ricetta && a.ricetta.completa ? 0 : 1, dopo_ingredienti: ingJ.length, dopo_quantita_rappresentate: ingJ.filter(i => i.statoImport === 'estratto').length, dopo_passi: a.ricetta ? a.ricetta.passi.length : 0,
        dopo_resa: a.ricetta && a.ricetta.resa.raw ? a.ricetta.resa.raw.source : '—', dopo_tempi: a.ricetta ? Object.keys(a.ricetta.tempi).filter(k => a.ricetta.tempi[k]).join(',') : '—' };
    };
    const t = [await riga('GialloZafferano (fixture)', GZ_HTML, 'https://ricette.giallozafferano.it/Tiramisu.html', 6), await riga('Sonia Peronaci (fixture)', SP_HTML, 'https://www.soniaperonaci.it/ganache-al-caramello-salato/', 7)];
    console.log('    ' + JSON.stringify(t));
    assert.strictEqual(t[0].dopo_AI, 0); assert.strictEqual(t[1].dopo_AI, 0);
  });

  await browser.close(); figlio.kill();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack || e); process.exit(1); });
