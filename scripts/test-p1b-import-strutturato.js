/*
 * Test — P1-b: rifinitura dell'estrazione strutturata (schema.org/Recipe).
 * Resa e porzioni, pulizia conservativa del procedimento, tempi ISO 8601,
 * nessuna regressione sugli ingredienti P0-c.
 *
 * Chromium offline sulla demo locale isolata (pagina e api/chat.js reali,
 * database in memoria, rete bloccata). Simulate solo la lettura della pagina
 * (fetchUrl) e l'AI, che non deve mai essere chiamata con dati strutturati
 * completi. Le fixture sono SINTETICHE: GialloZafferano (Tiramisu') e Sonia
 * Peronaci (Ganache) sono ricostruite sulle osservazioni del collaudo manuale
 * (resa "10 persone"; numeri delle foto nel procedimento; preparazione 30 min,
 * cottura 15 min, totale 12 h 45 min), non sono copie delle pagine reali.
 * Confronto prima/dopo: la stessa analisi viene eseguita anche con
 * khub_mvp.html di b444b79 (letto da git) in una seconda pagina.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
const BASE = 'b444b798a3f41f34875fa862d9abe2ae1fcf9225';
let HTML_PRIMA = null;
try { HTML_PRIMA = execFileSync('git', ['show', BASE + ':khub_mvp.html'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { HTML_PRIMA = null; }
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    ')); }
}
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const pulisciDa = src => { const er = src.indexOf('async function extractRecipe(){'); return src.slice(src.indexOf('  const ENTITA=', er), src.indexOf('  const sicuroSeTesto', er)) + 'return testoSicuro;'; };
const ld = o => `<script type="application/ld+json">${JSON.stringify(o).replace(/<\//g, '<\\/')}</script>`;
const pagina = (ricetta, corpo) => '<!doctype html><html><head>' + ld({ '@type': 'WebSite', name: 'x' }) + (ricetta ? ld(ricetta) : '') + '</head><body>' + (corpo || '') + '</body></html>';

// ── Fixture rappresentative (sintetiche) ─────────────────────────────────────
// GialloZafferano: recipeYield solo numero; "Dosi per" con numero e unita' in
// elementi separati e SENZA spazio fra loro; numeri delle foto nel procedimento.
const GZ = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Tiramisù', url: 'https://ricette.giallozafferano.it/Tiramisu.html',
  recipeYield: '10', prepTime: 'PT40M', cookTime: 'PT0M', totalTime: 'PT40M',
  recipeIngredient: ['Mascarpone 750 g', 'Uova (freschissime, circa 5 medie) 260 g', 'Savoiardi 250 g', 'Zucchero 120 g', 'Caffè 300 g (preparato con moka e zuccherato a piacere)', 'Cacao amaro in polvere q.b.'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Per preparare il tiramisù preparate il caffè con la moka.<span class="gz-photo-number">1</span>', image: ['https://x.test/1.jpg'] },
    { '@type': 'HowToStep', text: 'Separate gli albumi dai tuorli. 2' },
    { '@type': 'HowToStep', text: '<p>Montate i tuorli con metà dello zucchero (60 g) per 10 minuti <a href="https://x.test/foto/3.jpg">3</a></p><figure><img src="x"><figcaption>4</figcaption></figure>' },
    { '@type': 'HowToStep', text: 'Aggiungete il mascarpone a 18-20 °C poco alla volta (foto 5).' },
    { '@type': 'HowToStep', text: 'Montate gli albumi con lo zucchero rimasto [fig. 6] e uniteli in 2 o 3 volte.' },
    { '@type': 'HowToStep', text: 'Foto 7: Inzuppate i savoiardi nel caffè freddo per 1-2 secondi.' },
    { '@type': 'HowToStep', text: 'Alternate strati di crema e savoiardi, poi spolverizzate con cacao e riponete in frigorifero per 2 ore a 4 °C.' }] };
const GZ_HTML = pagina(GZ, '<main><h1>Tiramisù</h1><div class="gz-list-featured-data"><span>Difficoltà: facile</span><span>Dosi per:</span><strong>10</strong><span>persone</span></div>'
  + '<h2>Ingredienti</h2><ul>' + GZ.recipeIngredient.map(i => '<li>' + i + '</li>').join('') + '</ul></main>');
// Sonia Peronaci: @graph, nessun recipeYield, totale molto maggiore di preparazione + cottura.
const SP = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', '@id': 'https://www.soniaperonaci.it/ganache-al-caramello-salato/' },
  { '@type': ['Recipe'], name: 'Ganache al caramello salato', mainEntityOfPage: { '@id': 'https://www.soniaperonaci.it/ganache-al-caramello-salato/' },
    prepTime: 'PT30M', cookTime: 'PT15M', totalTime: 'PT12H45M',
    recipeIngredient: ['200 g di panna fresca liquida', '150 g di zucchero semolato', '30 g di burro', 'fior di sale q.b.', '150 g di cioccolato bianco', '1 baccello di vaniglia', '1 cucchiaio di sciroppo di glucosio', '20–30 g di acqua', 'Burro per lo stampo'],
    recipeInstructions: [{ '@type': 'HowToSection', name: 'Caramello', itemListElement: [{ '@type': 'HowToStep', text: 'Scaldate la panna con i semi della vaniglia fino a 80 °C.' }, { '@type': 'HowToStep', text: 'In un pentolino caramellate lo zucchero a secco fino a 170 °C.' }] },
      { '@type': 'HowToSection', name: 'Ganache', itemListElement: [{ '@type': 'HowToStep', text: 'Versate la panna calda sul caramello mescolando.' }, { '@type': 'HowToStep', text: 'Aggiungete burro e fior di sale.' },
        { '@type': 'HowToStep', text: 'Versate sul cioccolato bianco tritato ed emulsionate.' }, { '@type': 'HowToStep', text: 'Coprite con pellicola a contatto e lasciate in frigorifero per 12 ore.' }] }] }] };
const SP_HTML = pagina(SP, '<article><h1>Ganache al caramello salato</h1><p>Una ganache golosa e versatile.</p></article>');

(async () => {
  if (!chromium) { console.log('Playwright non disponibile: test non eseguibile'); process.exit(1); }
  const porta = await portaLibera();
  const figlio = spawn(process.execPath, [path.join(ROOT, 'demo/direzione-3/server.js'), String(porta)], { env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logDemo = ''; figlio.stdout.on('data', d => { logDemo += d; }); figlio.stderr.on('data', d => { logDemo += d; });
  const t0 = Date.now();
  while (!/Apri nel browser/.test(logDemo)) { if (Date.now() - t0 > 15000) { console.log(logDemo); throw new Error('demo non avviata'); } await new Promise(r => setTimeout(r, 50)); }
  const ORIGINE = 'http://localhost:' + porta;
  const browser = await chromium.launch(); const context = await browser.newContext();
  const chiamate = { ai: [] }; let paginaHtml = '';
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGINE) return route.abort();
    if (u.pathname === '/khub_prima.html' && HTML_PRIMA) return route.fulfill({ status: 200, contentType: 'text/html', body: HTML_PRIMA });
    if (/^\/lib\/[a-z]+\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, u.pathname)) });
    if (u.pathname === '/api/chat') {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* vuoto */ }
      if (body.messages) { chiamate.ai.push(body); return route.fulfill({ status: 401, contentType: 'application/json', body: '{"type":"error","error":{"type":"authentication_error"}}' }); }
      if (body.fetchUrl !== undefined) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, html: paginaHtml, finalUrl: body.fetchUrl, status: 200, troncato: false }) });
    }
    return route.continue();
  });
  await context.addInitScript(() => { window.__xss = []; window.alert = () => window.__xss.push('alert'); try { localStorage.setItem('khub_onboarded', '1'); } catch (e) { /* no */ } });
  const page = await context.newPage();
  const errori = []; page.on('pageerror', e => errori.push(String(e && e.message || e)));
  await page.goto(ORIGINE + '/khub_mvp.html?ui=classic');
  await page.waitForFunction(() => typeof S !== 'undefined' && S.recipes.length > 0, null, { timeout: 15000 });
  await page.evaluate(src => { window.__pulisci = new Function(src)(); }, pulisciDa(HTML));
  const ev = (f, a) => page.evaluate(f, a);
  const analizza = (html, url) => ev(([h, u]) => importAnalizzaPagina(h, u || 'https://x.test/r', window.__pulisci), [html, url]);
  const resa = (y, corpo) => ev(([yy, c]) => { const r = { '@type': 'Recipe', name: 'R', recipeIngredient: ['100 g farina'], recipeInstructions: ['Impastare.'] }; if (yy !== undefined) r.recipeYield = yy;
    const a = importAnalizzaPagina('<html><head><script type="application/ld+json">' + JSON.stringify(r) + '</script></head><body>' + (c || '') + '</body></html>', 'https://x.test/r', window.__pulisci);
    const ant = importAnteprimaStrutturata(a.ricetta, 'https://x.test/r');
    return { qty: ant.declaredYield.qty, unit: ant.declaredYield.unit, source: ant.declaredYield.source, range: ant.declaredYield.range, nota: ant.importFonte.notaResa, porzioni: ant.portionsCount, notaPorzioni: ant.importFonte.notaPorzioni }; }, [y, corpo]);
  const importaLink = async (html, url) => {
    paginaHtml = html;
    await ev(u => { S.view = 'load'; S.loadPreview = null; S.loadError = null; S.loadTab = 'link'; S.loadUrl = u; render(); }, url);
    await page.click('#btn-extract');
    await page.waitForFunction(() => !S.isLoading && (S.loadPreview || S.loadError));
    return ev(() => ({ p: S.loadPreview, err: S.loadError && S.loadError.msg, banda: (document.querySelector('.preview-fonte') || {}).innerText || '' }));
  };
  const db = async () => (await ev(async () => (await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supabaseAction: 'load' }) })).json()));
  // Pagina con il codice di b444b79, per il confronto prima/dopo.
  let prima = null;
  if (HTML_PRIMA) {
    prima = await context.newPage();
    await prima.goto(ORIGINE + '/khub_prima.html?ui=classic');
    await prima.waitForFunction(() => typeof importAnalizzaPagina === 'function', null, { timeout: 15000 });
    await prima.evaluate(src => { window.__pulisci = new Function(src)(); }, pulisciDa(HTML_PRIMA));
  }
  const analizzaPrima = (html, url) => prima.evaluate(([h, u]) => { const a = importAnalizzaPagina(h, u, window.__pulisci); const ant = a.ricetta && importAnteprimaStrutturata(a.ricetta, u);
    return { passi: a.ricetta && a.ricetta.passi, resa: ant && [ant.declaredYield.qty, ant.declaredYield.unit], nota: ant && ant.importFonte.notaResa }; }, [html, url]);

  console.log('P1-b — casi osservati nel collaudo (fixture sintetiche)');

  await test('G1. Tiramisù: "10" + "Dosi per:<strong>10</strong><span>persone</span>" -> Resa dichiarata 10 porzioni con citazione; Porzioni (Obiettivo) vuoto e spiegato; nessuna AI', async () => {
    const n0 = chiamate.ai.length;
    const { p, err, banda } = await importaLink(GZ_HTML, 'https://ricette.giallozafferano.it/Tiramisu.html');
    assert.strictEqual(err, null); assert.strictEqual(chiamate.ai.length - n0, 0, 'nessuna AI');
    assert.deepStrictEqual([p.declaredYield.qty, p.declaredYield.unit, p.declaredYield.source], ['10', 'porzioni', '10 persone']);
    assert.strictEqual(p.portionsCount, 0, 'Obiettivo di Produzione non inventato');
    assert.ok(/«10 persone».*Resa dichiarata \(10 porzioni\).*«Porzioni» è l'Obiettivo di Produzione/.test(banda), banda);
    assert.strictEqual(await ev(() => document.getElementById('prev-portions').value), '', 'campo Porzioni vuoto');
    assert.strictEqual(await ev(() => document.getElementById('prev-yield-qty').value), '10');
    if (prima) { const a = await analizzaPrima(GZ_HTML, 'https://ricette.giallozafferano.it/Tiramisu.html'); assert.deepStrictEqual(a.resa, ['', ''], 'prima: resa persa (numero e unita\' in elementi attaccati)'); }
  });

  await test('G2. Tiramisù: numeri delle foto tolti solo con prova (markup, link a immagini, "(foto 5)", "[fig. 6]", "Foto 7:"); numeri gastronomici intatti; numero senza prova lasciato e segnalato', async () => {
    const a = await analizza(GZ_HTML, 'https://ricette.giallozafferano.it/Tiramisu.html');
    assert.deepStrictEqual(a.ricetta.passi, [
      'Per preparare il tiramisù preparate il caffè con la moka.',
      'Separate gli albumi dai tuorli. 2',
      'Montate i tuorli con metà dello zucchero (60 g) per 10 minuti',
      'Aggiungete il mascarpone a 18-20 °C poco alla volta.',
      'Montate gli albumi con lo zucchero rimasto e uniteli in 2 o 3 volte.',
      'Inzuppate i savoiardi nel caffè freddo per 1-2 secondi.',
      'Alternate strati di crema e savoiardi, poi spolverizzate con cacao e riponete in frigorifero per 2 ore a 4 °C.']);
    assert.deepStrictEqual(a.ricetta.passiDaControllare, [2]);
    const banda = await ev(() => document.querySelector('.preview-fonte').innerText);
    assert.ok(/nei passaggi 2 ci sono numeri isolati.*lasciati come nella fonte/.test(banda), banda);
    if (prima) { const b = await analizzaPrima(GZ_HTML, 'https://ricette.giallozafferano.it/Tiramisu.html');
      assert.ok(/moka\. ?1$/.test(b.passi[0]) && b.passi.includes('4') && b.passi.some(x => /\(foto 5\)/.test(x)) && b.passi.some(x => /^Foto 7:/.test(x)) && b.passi.some(x => /per 10 minuti 3$/.test(x)),
        'prima: numeri delle foto nei passaggi ' + JSON.stringify(b.passi)); }
  });

  await test('S1. Ganache: tempi dichiarati 30 min / 15 min / 12 h 45 min; differenza segnalata come calcolata e non attribuita; Porzioni e Resa vuote (nessun recipeYield); sezioni conservate', async () => {
    const { p, err, banda } = await importaLink(SP_HTML, 'https://www.soniaperonaci.it/ganache-al-caramello-salato/');
    assert.strictEqual(err, null);
    assert.ok(/Tempi dichiarati dalla fonte \(non salvati nella Ricetta\): Preparazione: 30 min · Cottura: 15 min · Totale: 12 h 45 min/.test(banda), banda);
    assert.ok(/Il tempo totale dichiarato \(12 h 45 min\) supera di 12 h preparazione \+ cottura \(45 min; differenza calcolata da KHUB\): la fonte non indica a cosa corrisponda\./.test(banda), banda);
    assert.ok(!/riposo/i.test(p.importFonte.notaTempi), 'nessuna attribuzione al riposo');
    assert.deepStrictEqual([p.declaredYield.qty, p.declaredYield.unit, p.portionsCount], ['', '', 0]);
    assert.strictEqual(p.steps.length, 6); assert.ok(/^Caramello — Scaldate/.test(p.steps[0]) && /^Ganache — Versate/.test(p.steps[2]));
    assert.ok(/fino a 80 °C/.test(p.steps[0]) && /per 12 ore/.test(p.steps[5]), 'temperature e tempi nei passaggi intatti');
  });

  await test('S2. Ganache: ingredienti P0-c invariati (certa, q.b., baccello, intervallo, da indicare, testo originale); salvataggio con tipi e unita\' della fonte; nessuna unita\' -> g', async () => {
    const p = await ev(() => S.loadPreview);
    assert.deepStrictEqual(p.ingredients.map(i => [i.name, i.qty, i.unit, i.qtyKind, i.qtyMin, i.qtyMax]), [
      ['panna fresca liquida', 200, 'g', 'certa', null, null], ['zucchero semolato', 150, 'g', 'certa', null, null], ['burro', 30, 'g', 'certa', null, null],
      ['fior di sale', null, null, 'variabile', null, null], ['cioccolato bianco', 150, 'g', 'certa', null, null], ['vaniglia', 1, 'baccello', 'certa', null, null],
      ['sciroppo di glucosio', 1, 'tbsp', 'certa', null, null], ['acqua', null, 'g', 'intervallo', 20, 30], ['Burro per lo stampo', null, null, 'mancante', null, null]]);
    assert.deepStrictEqual(p.ingredients.map(i => i.sourceText), SP['@graph'][1].recipeIngredient);
    await page.click('#btn-save-preview'); await page.waitForFunction(() => S.view === 'ricetta-madre-v2'); await page.waitForTimeout(800);
    const d = await db(); const id = await ev(() => R(S.selectedId).labVersions[0].id);
    const r = d.ingredients.filter(i => i.variant_id === id).sort((a, b) => a.sort_order - b.sort_order).map(i => [i.name, Number(i.qty), i.unit, i.qty_kind || null]);
    assert.deepStrictEqual(r, [['panna fresca liquida', 200, 'g', 'certa'], ['zucchero semolato', 150, 'g', 'certa'], ['burro', 30, 'g', 'certa'], ['fior di sale', 0, 'g', 'variabile'],
      ['cioccolato bianco', 150, 'g', 'certa'], ['vaniglia', 1, 'baccello', 'certa'], ['sciroppo di glucosio', 1, 'tbsp', 'certa'], ['acqua', 0, 'g', 'intervallo'], ['Burro per lo stampo', 0, 'g', 'mancante']]);
    const v = d.variants.find(x => x.id === id);
    assert.ok(v.declared_yield_qty == null && v.declared_yield_unit == null && Number(v.portions_count || 0) === 0, 'nessuna resa o porzione inventata');
  });

  await test('G3. correzioni dello chef in anteprima conservate: Resa e Porzioni scritte a mano vincono sui dati della fonte', async () => {
    await importaLink(GZ_HTML, 'https://ricette.giallozafferano.it/Tiramisu.html');
    await ev(() => { document.getElementById('prev-yield-qty').value = '12'; document.getElementById('prev-portions').value = '8'; });
    await page.click('#btn-save-preview'); await page.waitForFunction(() => S.view === 'ricetta-madre-v2'); await page.waitForTimeout(800);
    const v = await ev(() => { const l = R(S.selectedId).labVersions[0]; return [l.declaredYieldQty, l.declaredYieldUnit, l.portionsCount]; });
    assert.deepStrictEqual([Number(v[0]), v[1], v[2]], [12, 'porzioni', 8]);
  });

  console.log('P1-b — resa e porzioni');
  await test('Y1. recipeYield numerico o solo numero: usato solo con un\'unita\' verificabile nella pagina, altrimenti nota con il valore originale', async () => {
    assert.deepStrictEqual((({ qty, unit, source }) => [qty, unit, source])(await resa(4, '<p>Per 4 <b>persone</b></p>')), ['4', 'porzioni', '4 persone']);
    const r = await resa('6'); assert.deepStrictEqual([r.qty, r.unit], ['', '']); assert.ok(/«6» senza unità/.test(r.nota), r.nota);
    const n = await resa(8); assert.deepStrictEqual([n.qty, n.unit], ['', '']);
  });
  await test('Y2. recipeYield testuale: persone e porzioni -> porzioni; pezzi, peso e volume come resa dichiarata; mai Porzioni (Obiettivo) da grammi o pezzi', async () => {
    const casi = [['10 persone', '10', 'porzioni'], ['4 porzioni', '4', 'porzioni'], ['Porzioni: 4', '4', 'porzioni'], ['Dosi per 6 persone', '6', 'porzioni'], ['24 biscotti', '24', 'biscotti'],
      ['1 kg', '1', 'kg'], ['500 g', '500', 'g'], ['1,5 l', '1.5', 'l'], ['1 torta da 24 cm', '1', 'torta']];
    for (const [y, q, u] of casi) { const r = await resa(y); assert.deepStrictEqual([r.qty, r.unit, r.porzioni], [q, u, 0], y); }
    const b = await resa('24 biscotti'); assert.ok(b.source === '24 biscotti' && b.notaPorzioni === '', 'nessuna nota porzioni per i pezzi: ' + JSON.stringify(b));
  });
  await test('Y3. intervallo, array, QuantitativeValue: nessuna scelta arbitraria; valori diversi in nota; nessuna duplicazione', async () => {
    const r = await resa('6-8 persone'); assert.deepStrictEqual([r.qty, r.unit, r.range && [r.range.min, r.range.max, r.range.unit]], ['', '', [6, 8, 'porzioni']]);
    assert.ok(/6–8 porzioni/.test(r.notaPorzioni), r.notaPorzioni);
    let a = await resa(['8', '8 persone']); assert.deepStrictEqual([a.qty, a.unit, a.nota], ['8', 'porzioni', ''], 'stesso valore ripetuto: nessuna nota');
    a = await resa(['1 torta', '8 persone']); assert.deepStrictEqual([a.qty, a.unit], ['8', 'porzioni']); assert.ok(/Altre indicazioni di resa nella fonte: «1 torta»/.test(a.nota), a.nota);
    a = await resa({ '@type': 'QuantitativeValue', value: 12, unitText: 'pezzi' }); assert.deepStrictEqual([a.qty, a.unit, a.source], ['12', 'pezzi', '12 pezzi']);
  });
  await test('Y4. misure di stampi e teglie non sono una resa ("24 cm", "20x30 cm"): nessun campo, testo originale in nota', async () => {
    for (const y of ['Per una tortiera da 24 cm', 'Stampo 20x30 cm', 'teglia 30 × 40 cm']) { const r = await resa(y); assert.deepStrictEqual([r.qty, r.unit], ['', ''], y); assert.ok(r.nota.includes('«' + y + '»'), r.nota); }
    if (prima) { const b = await analizzaPrima(pagina({ '@type': 'Recipe', name: 'R', recipeYield: 'Per una tortiera da 24 cm', recipeIngredient: ['100 g farina'], recipeInstructions: ['Impastare.'] }), 'https://x.test/r');
      assert.deepStrictEqual(b.resa, ['24', 'cm'], 'prima: "24 cm" letto come resa'); }
  });
  await test('Y5. nessun recipeYield: campi vuoti; un\'etichetta della pagina ("Dosi per: 6 persone") e\' solo citata in nota, mai compilata', async () => {
    const r = await resa(undefined, '<div><span>Dosi per:</span><b>6 persone</b></div>');
    assert.deepStrictEqual([r.qty, r.unit, r.porzioni], ['', '', 0]); assert.ok(/Nella pagina \(non nei dati strutturati\): «Dosi per: 6 persone»/.test(r.nota), r.nota);
    const s = await resa(undefined, '<p>Ottima, l\'ho fatta per 6 amici</p>'); assert.strictEqual(s.nota, '', 'nessuna etichetta: nessuna nota');
  });

  console.log('P1-b — tempi');
  await test('T1. durate ISO 8601: ore e minuti, giorni, settimane, decimali, minuti oltre 60, zero; non ISO lasciato come testo', async () => {
    const r = await ev(() => ['PT1H30M', 'P1DT2H', 'PT90M', 'P1W', 'PT0,5H', 'PT0M', 'PT45S', '20 minuti', 'P', ''].map(v => { const d = importDurata(v, window.__pulisci); return d ? [d.minuti, importDurataTesto(d)] : null; }));
    assert.deepStrictEqual(r, [[90, '1 h 30 min'], [1560, '1 giorno 2 h'], [90, '1 h 30 min'], [10080, '7 giorni'], [30, '30 min'], [0, '0 min'], [1, '1 min'], [null, '20 minuti'], [null, 'P'], null]);
  });
  await test('T2. tempi parziali o incoerenti: nessuna somma come tempo; nessuna nota se il totale manca o coincide; incoerenza segnalata; performTime mostrato', async () => {
    const t = await ev(() => { const P = window.__pulisci; const T = r => { const x = importTempiRicetta(r, P); return [importTempiTesto(x), importNotaTempi(x)]; };
      return [T({ prepTime: 'PT20M' }), T({ prepTime: 'PT20M', cookTime: 'PT10M' }), T({ prepTime: 'PT20M', cookTime: 'PT10M', totalTime: 'PT30M' }), T({ prepTime: 'PT40M', cookTime: 'PT20M', totalTime: 'PT30M' }),
        T({ totalTime: 'PT2H' }), T({ prepTime: 'PT15M', performTime: 'PT30M', totalTime: 'PT1H' })]; });
    assert.deepStrictEqual(t[0], ['Preparazione: 20 min', '']);
    assert.deepStrictEqual(t[1], ['Preparazione: 20 min · Cottura: 10 min', ''], 'nessun totale calcolato');
    assert.deepStrictEqual(t[2], ['Preparazione: 20 min · Cottura: 10 min · Totale: 30 min', '']);
    assert.ok(/inferiore a preparazione \+ cottura \(1 h\): i tempi della fonte non sono coerenti/.test(t[3][1]), t[3][1]);
    assert.deepStrictEqual(t[4], ['Totale: 2 h', '']);
    assert.ok(t[5][0] === 'Preparazione: 15 min · Esecuzione: 30 min · Totale: 1 h' && /supera di 15 min preparazione \+ esecuzione/.test(t[5][1]), JSON.stringify(t[5]));
  });

  console.log('P1-b — procedimento');
  await test('P1. markup fotografico (anche codificato): img, figure, figcaption, link a immagini, classi foto/gallery con soli numeri; testo con classe fotografica ma non numerico conservato', async () => {
    const passi = await ev(() => importPassiRicetta([
      'Scaldate il latte &lt;span class=&quot;foto-numero&quot;&gt;3&lt;/span&gt;',
      'Mescolate<div class="gallery-index">12</div>',
      'Versate nello stampo<span class="caption">come in figura</span>',
      'Infornate a 180 °C per 25 minuti<img src="a.jpg">',
      '&lt;img src=x onerror=alert(1)&gt;Lasciate raffreddare.'], window.__pulisci).passi);
    assert.deepStrictEqual(passi, ['Scaldate il latte', 'Mescolate', 'Versate nello stampocome in figura', 'Infornate a 180 °C per 25 minuti', 'Lasciate raffreddare.']);
    assert.deepStrictEqual(await ev(() => window.__xss), [], 'nessuna esecuzione');
  });
  await test('P2. numeri gastronomici e numerazione propria preservati; riferimenti a fasi preservati; nessun numero tolto senza prova', async () => {
    const testi = ['1. Preparate la base.', '2) Cuocete a 170 °C per 12-15 minuti.', 'Dividete in 3 parti da 250 g.', 'Ripetete i passaggi 2 e 3.', 'Riprendete dalla fase 2 (vedi sopra).',
      'Aggiungete 2 uova e 1/2 cucchiaino di sale.', 'Lasciate lievitare 2 h a 26 °C, poi 1 notte in frigo a 4 °C.'];
    const r = await ev(t => { const x = importPassiRicetta(t, window.__pulisci); return [x.passi, x.passi.map(importNumeriIsolati)]; }, testi);
    assert.deepStrictEqual(r[0], testi); assert.deepStrictEqual(r[1], testi.map(() => false), 'nessuna segnalazione');
  });
  await test('P3. numeri senza prova: lasciati e segnalati ("1Preparate", "...moka. 1 2", passaggio fatto solo di numeri)', async () => {
    const r = await ev(() => ['1Preparate il caffè.', 'Preparate il caffè con la moka. 1 2', '3', 'Montate. 4 Aggiungete lo zucchero.'].map(importNumeriIsolati));
    assert.deepStrictEqual(r, [true, true, true, true]);
  });

  console.log('P1-b — compatibilita\'');
  await test('C1. JSON-LD assente o incompleto: stesso comportamento di P1-a (nessuna ricetta strutturata; incompleta segnalata)', async () => {
    const a = await analizza('<html><body><h1>Torta</h1><p>200 g farina</p></body></html>');
    assert.strictEqual(a.ricetta, null); assert.strictEqual(a.jsonld.ricette, 0);
    const b = await analizza(pagina({ '@type': 'Recipe', name: 'Solo nome', recipeIngredient: ['100 g farina'] }));
    assert.strictEqual(b.ricetta.completa, false); assert.deepStrictEqual(b.ricetta.mancanze, ['procedimento']);
    if (prima) { const x = await prima.evaluate(h => { const r = importAnalizzaPagina(h, 'https://x.test/r', window.__pulisci); return [r.ricetta && r.ricetta.completa, r.ricetta && r.ricetta.mancanze]; }, pagina({ '@type': 'Recipe', name: 'Solo nome', recipeIngredient: ['100 g farina'] }));
      assert.deepStrictEqual(x, [false, ['procedimento']]); }
  });
  await test('C2. procedimento semplice e HowToStep senza foto: identico a b444b79 (stessi passaggi)', async () => {
    if (!prima) return;
    for (const istr of [['Impastare.', 'Cuocere a 180 °C per 20 minuti.'], 'Impastare.\nRiposare 1 h.\nCuocere.', '<p>Impastare.</p><p>Cuocere.</p>', [{ '@type': 'HowToStep', text: 'Scaldare a 80 °C.' }, { '@type': 'HowToStep', name: 'Mescolare 2 minuti.' }]]) {
      const h = pagina({ '@type': 'Recipe', name: 'R', recipeIngredient: ['100 g farina'], recipeInstructions: istr });
      assert.deepStrictEqual((await analizza(h)).ricetta.passi, (await analizzaPrima(h, 'https://x.test/r')).passi, JSON.stringify(istr));
    }
  });
  await test('C3. nessun errore nella pagina e nessuna esecuzione di codice', async () => {
    assert.deepStrictEqual(errori, []); assert.deepStrictEqual(await ev(() => window.__xss), []);
  });

  await browser.close(); figlio.kill();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack || e); process.exit(1); });
