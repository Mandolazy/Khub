/*
 * Test — P0-a: importazione nel browser reale (Chromium, offline).
 *
 * Pagina REALE (khub_mvp.html) servita dalla demo locale isolata
 * (demo/direzione-3/server.js: api/chat.js reale, database in memoria con dati
 * sintetici, rete in uscita bloccata). Nel browser ogni richiesta verso
 * l'esterno e' bloccata; le sole risposte simulate sono l'AI (body.messages) e
 * la lettura delle pagine (body.fetchUrl). Nessuna AI reale, nessun Supabase.
 *
 * Verifica: nessuna esecuzione di markup proveniente da fonti esterne, AI o
 * dati salvati nei percorsi P0-a (anteprima, Schede, LAB, toast, PDF, M1);
 * link, video, foto ed errori; non regressione di nuova Scheda, Scheda
 * esistente, Ricette indipendenti, LAB, Ricette Attive.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    ')); }
}
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const XSS = n => `<img src=x onerror="window.__xss.push('${n}')">`;

(async () => {
  if (!chromium) { console.log('Playwright non disponibile: test non eseguibile'); process.exit(1); }
  const porta = await portaLibera();
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  const figlio = spawn(process.execPath, [path.join(ROOT, 'demo/direzione-3/server.js'), String(porta)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logDemo = '';
  figlio.stdout.on('data', d => { logDemo += d; }); figlio.stderr.on('data', d => { logDemo += d; });
  const t0 = Date.now();
  while (!/Apri nel browser/.test(logDemo)) { if (Date.now() - t0 > 15000) { console.log(logDemo); throw new Error('demo non avviata'); } await new Promise(r => setTimeout(r, 50)); }
  const ORIGINE = 'http://localhost:' + porta;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const chiamate = { ai: [], pagina: [], esterne: [] };
  let rispostaAI = () => ({ status: 500, json: { error: 'non configurato nel test' } });
  let rispostaPagina = () => ({ status: 502, json: { ok: false, code: 'rete', error: 'x' } });
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGINE) { chiamate.esterne.push(u.href); return route.abort(); }
    if (/^\/lib\/[a-z]+\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, u.pathname)) });
    if (u.pathname === '/api/chat') {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* vuoto */ }
      if (body.messages) { chiamate.ai.push(body); const r = rispostaAI(body); return route.fulfill({ status: r.status, contentType: r.testo !== undefined ? 'text/plain' : 'application/json', body: r.testo !== undefined ? r.testo : JSON.stringify(r.json) }); }
      if (body.fetchUrl !== undefined) { chiamate.pagina.push(body); const r = rispostaPagina(body); return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.json) }); }
    }
    return route.continue();
  });
  await context.addInitScript(() => { window.__xss = []; window.alert = () => window.__xss.push('alert'); try { localStorage.setItem('khub_onboarded', '1'); } catch (e) { /* no */ } });
  const page = await context.newPage();
  const erroriPagina = [];
  page.on('pageerror', e => erroriPagina.push(String(e && e.message || e)));
  await page.goto(ORIGINE + '/khub_mvp.html?ui=d3');
  await page.waitForFunction(() => typeof S !== 'undefined' && Array.isArray(S.recipes) && S.recipes.length > 0, null, { timeout: 15000 });
  const xss = () => page.evaluate(() => window.__xss.slice());
  const attendi = ms => page.waitForTimeout(ms);
  const vai = js => page.evaluate(js);
  const okAI = obj => () => ({ status: 200, json: { content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' } });
  const apriCarica = async tab => { await vai(`S.view='load';S.loadPreview=null;S.loadError=null;S.loadTab=${JSON.stringify(tab)};render()`); };
  const conta = () => ({ ai: chiamate.ai.length, pagina: chiamate.pagina.length });
  const caricaDb = () => page.evaluate(async () => (await (await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supabaseAction: 'load' }) })).json()));

  const MALEVOLA = {
    name: 'Crostata ' + XSS('nome'), category: 'Dolci',
    ingredients: [{ name: 'Farina ' + XSS('ingrediente'), qty: 250, unit: 'g' }, { name: '"><svg onload="window.__xss.push(\'attr\')">Burro', qty: 125, unit: 'g' },
      { name: 'Zucchero &lt;img src=x onerror="window.__xss.push(\'entita\')"&gt;', qty: 100, unit: 'g' }],
    steps: ['Impastare ' + XSS('passo'), '</textarea>' + XSS('textarea'), 'Cuocere a 180 °C per 30 minuti.'],
    subRecipes: [{ name: 'Frolla ' + XSS('sotto'), ingredients: [{ name: 'Uova ' + XSS('sottoing'), qty: 2, unit: 'n' }], steps: ['Stendere ' + XSS('sottopasso')] }],
  };
  console.log('P0-a — importazione nel browser (Chromium, demo locale)');

  await test('U1. testo con output AI malevolo: anteprima, salvataggio, Scheda (D3 e classica) e LAB senza esecuzione; dati salvati senza markup', async () => {
    rispostaAI = okAI(MALEVOLA);
    await apriCarica('testo');
    await page.fill('#text-input', 'Crostata di frolla. Farina 250 g, burro 125 g, zucchero 100 g.');
    await page.click('#btn-extract');
    await page.waitForSelector('#btn-save-preview');
    await attendi(200);
    assert.deepStrictEqual(await xss(), [], 'anteprima');
    assert.strictEqual(await page.inputValue('#prev-name'), 'Crostata');
    const prima = (await caricaDb()).recipes.length;
    await page.click('#btn-save-preview');
    await page.waitForFunction(() => S.view === 'ricetta-madre-v2');
    await attendi(600);
    assert.deepStrictEqual(await xss(), [], 'Scheda D3 e toast');
    const db = await caricaDb();
    assert.strictEqual(db.recipes.length, prima + 2, 'Scheda + sotto-ricetta');
    const testo = JSON.stringify(db);
    assert.ok(!/__xss/.test(testo), 'nessun gestore salvato');
    const id = await vai('S.selectedId');
    await vai(`S.uiD3=false;document.body.classList.remove('ui-d3');render()`); await attendi(200);
    assert.deepStrictEqual(await xss(), [], 'Scheda classica');
    await vai(`S.view='recipe';S.mode='lab';S.selectedId=${JSON.stringify(id)};render()`); await attendi(300);
    assert.deepStrictEqual(await xss(), [], 'LAB classico');
    await vai(`S.uiD3=true;document.body.classList.add('ui-d3');render()`); await attendi(300);
    assert.deepStrictEqual(await xss(), [], 'LAB Direzione 3');
    assert.deepStrictEqual(erroriPagina, []);
  });

  await test('U2. dati gia\' salvati con markup (non passati dall\'importazione): Scheda, contenuto della Ricetta, LAB, testo e osservazioni M1, toast ed esportazione PDF non eseguono nulla e mostrano il testo', async () => {
    const id = await vai(`(function(){
      var x=${JSON.stringify(XSS('salvato'))};
      var lab={id:'lvXSS',label:'Bozza '+x,name:'Bozza '+x,note:'',portionsCount:0,gramsPerPortion:0,portionSize:0,portionUnit:'g',
        ingredients:[{id:'iX1',name:'Sale '+x,qty:5,unit:'g',isSubRecipe:false,subRecipeId:null}],steps:['Mescolare '+x],stepsV2:[],
        mediaUrl:null,videoUrl:null,active:false,l2Items:[{id:'l2X',provenanceType:'m1',operationalState:'open',decisionState:'none',content:{label:'Etichetta '+x,text:'Osservazione '+x}}],
        m1ReadingText:'Lettura '+x};
      var att={id:'vvXSS',name:'Attiva '+x,label:'Attiva',status:'validated',active:true,validatedAt:'01/01/2026',portionsCount:0,gramsPerPortion:0,portionUnit:'g',
        ingredients:[{id:'iX2',name:'Pepe '+x,qty:1,unit:'g',isSubRecipe:false,subRecipeId:null}],steps:['Servire '+x],stepsV2:[],l2Items:[]};
      S.recipes=S.recipes.concat([{id:'rXSS',name:'Scheda '+x,category:'Prova '+x,department:'Cucina',currentLabIdx:0,labVersions:[lab],validatedVariants:[att],mediaUrl:null,videoUrl:null,notes:'',l3Items:[]}]);
      S.rmv2AttivaEspansa['vvXSS']=true;S.selectedId='rXSS';S.view='ricetta-madre-v2';render();return 'rXSS';})()`);
    await attendi(300);
    assert.deepStrictEqual(await xss(), [], 'Scheda D3 con contenuto espanso');
    await vai(`S.uiD3=false;document.body.classList.remove('ui-d3');render()`); await attendi(300);
    assert.deepStrictEqual(await xss(), [], 'Scheda classica');
    await vai(`S.view='recipe';S.mode='lab';S.selectedId='${id}';render()`); await attendi(300);
    assert.deepStrictEqual(await xss(), [], 'LAB classico con M1');
    const testoLab = await page.evaluate(() => document.body.innerText);
    assert.ok(testoLab.includes('Lettura <img src=x onerror='), 'testo M1 mostrato come testo');
    await vai(`S.uiD3=true;document.body.classList.add('ui-d3');render()`); await attendi(300);
    assert.deepStrictEqual(await xss(), [], 'LAB Direzione 3');
    await vai(`toast('Ricetta '+${JSON.stringify(XSS('toast'))}+' salvata')`); await attendi(200);
    assert.deepStrictEqual(await xss(), [], 'toast');
    assert.ok((await page.textContent('.toast')).includes('<img src=x'), 'toast come testo');
    const [popup] = await Promise.all([context.waitForEvent('page'), vai(`exportPDF('${id}','vvXSS')`)]);
    await popup.waitForLoadState(); await popup.waitForTimeout(400);
    assert.deepStrictEqual(await popup.evaluate(() => (window.opener && window.opener.__xss || []).slice()), [], 'PDF (stessa origine)');
    assert.ok((await popup.evaluate(() => document.body.innerText)).includes('Pepe <img src=x'), 'PDF come testo');
    await popup.close();
    const [popup2] = await Promise.all([context.waitForEvent('page'), vai(`exportPDF('${id}','lvXSS')`)]);
    await popup2.waitForLoadState(); await popup2.waitForTimeout(300); await popup2.close();
    assert.deepStrictEqual(await xss(), [], 'PDF della bozza');
    await vai(`S.recipes=S.recipes.filter(function(r){return r.id!=='rXSS';});S.view='home';render()`);
  });

  await test('U3. link con pagina valida: HTML della pagina mai eseguito (DOMParser); all\'AI solo testo; anteprima creata', async () => {
    const corpo = 'Crema pasticcera della tradizione. Ingredienti: 500 g di latte intero, 6 tuorli, 150 g di zucchero, 40 g di amido di mais. Scaldare il latte, unire i tuorli montati con lo zucchero e cuocere fino a 82 °C mescolando continuamente.';
    rispostaPagina = () => ({ status: 200, json: { ok: true, html: '<html><head><script>window.__xss.push("script")</script></head><body>' + XSS('pagina') + '<svg onload="window.__xss.push(\'svg\')"></svg><iframe srcdoc="<script>parent.__xss.push(\'iframe\')</script>"></iframe><p>' + corpo + '</p></body></html>', finalUrl: 'https://ricette.esempio.test/crema', status: 200, troncato: false } });
    rispostaAI = okAI({ name: 'Crema pasticcera', ingredients: [{ name: 'Latte intero', qty: 500, unit: 'g' }], steps: ['Scaldare il latte.'] });
    const n0 = conta();
    await apriCarica('link'); await page.fill('#url-input', 'https://ricette.esempio.test/crema'); await page.click('#btn-extract');
    await page.waitForSelector('#btn-save-preview'); await attendi(500);
    assert.deepStrictEqual(await xss(), [], 'nessun gestore della pagina eseguito');
    assert.strictEqual(conta().ai - n0.ai, 1); assert.strictEqual(conta().pagina - n0.pagina, 1);
    const inviato = chiamate.ai[chiamate.ai.length - 1].messages[0].content;
    assert.ok(inviato.includes(corpo) && !/<img|<svg|onerror/.test(inviato), 'solo testo all\'AI');
  });

  await test('U4. link non leggibile o insufficiente: messaggio visibile, nessuna chiamata AI, "Incolla il testo" porta alla scheda Testo', async () => {
    const CASI = [
      [{ status: 502, json: { ok: false, code: 'http_403', error: 'x' } }, 'rifiutato l\'accesso automatico'],
      [{ status: 200, json: { ok: true, html: '<html><body><div id="app"></div><script>x()</script></body></html>', status: 200 } }, 'non contiene abbastanza testo'],
      [{ status: 200, json: { ok: true, html: '<html><body><h1>Just a moment...</h1><p>Checking your browser before accessing the site. ' + 'Please enable cookies. '.repeat(10) + '</p></body></html>', status: 200 } }, 'verifica anti-bot'],
      [{ status: 502, json: { ok: false, code: 'non_html', error: 'x' } }, 'formato non supportato'],
    ];
    for (const [risposta, atteso] of CASI) {
      rispostaPagina = () => risposta; const n0 = conta();
      await apriCarica('link'); await page.fill('#url-input', 'https://ricette.esempio.test/x'); await page.click('#btn-extract');
      await page.waitForSelector('.load-errore');
      assert.ok((await page.textContent('.load-errore')).includes(atteso), atteso);
      assert.strictEqual(conta().ai - n0.ai, 0, 'nessuna AI: ' + atteso);
      assert.strictEqual(await vai('S.loadPreview'), null);
      await page.click('#btn-load-incolla-testo');
      assert.strictEqual(await vai('S.loadTab'), 'testo'); assert.strictEqual(await page.$('.load-errore'), null);
    }
  });

  await test('U5. scheda Video: avviso esplicito, nessun pulsante di estrazione, nessuna chiamata; "Vai a Testo"', async () => {
    const n0 = conta();
    await apriCarica('foto'); await page.click('button.load-tab[data-tab="video"]');
    const avviso = await page.textContent('.load-video-avviso');
    assert.ok(/non legge ancora i video/.test(avviso) && /non vengono acquisiti né analizzati/.test(avviso), avviso);
    assert.strictEqual(await page.$('#btn-extract'), null); assert.strictEqual(await page.$('#video-input'), null);
    await page.click('#btn-load-vai-testo'); assert.strictEqual(await vai('S.loadTab'), 'testo');
    await vai(`S.loadTab='video';S.loadVideoUrl='https://www.instagram.com/reel/ABC/'`); await vai('extractRecipe()'); await attendi(100);
    assert.deepStrictEqual(conta(), n0, 'nessuna chiamata AI o di lettura');
  });

  await test('U6. foto: PNG caricata -> blocco immagine all\'AI e anteprima; HEIC -> formato non supportato, nessuna chiamata', async () => {
    rispostaAI = okAI({ name: 'Focaccia', ingredients: [{ name: 'Farina', qty: 500, unit: 'g' }], steps: ['Impastare.'] });
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    let n0 = conta();
    await apriCarica('foto'); await page.setInputFiles('#foto-input', { name: 'ricetta.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => !!S.loadImageB64); await page.click('#btn-extract'); await page.waitForSelector('#btn-save-preview');
    const blocco = chiamate.ai[chiamate.ai.length - 1].messages[0].content[0];
    assert.strictEqual(conta().ai - n0.ai, 1); assert.strictEqual(blocco.type, 'image'); assert.strictEqual(blocco.source.media_type, 'image/png');
    n0 = conta();
    await apriCarica('foto'); await page.setInputFiles('#foto-input', { name: 'ricetta.heic', mimeType: 'image/heic', buffer: PNG });
    await page.waitForFunction(() => S.loadImageB64 && S.loadImageB64.mediaType === 'image/heic'); await page.click('#btn-extract');
    await page.waitForSelector('.load-errore');
    assert.ok((await page.textContent('.load-errore')).includes('Formato immagine non supportato')); assert.strictEqual(conta().ai - n0.ai, 0);
    await vai('S.loadImageB64=null;S.loadImagePreviewUrl=null');
  });

  await test('U7. errori AI mostrati nella scheda (configurazione, sovraccarico, limite, non interpretabile), nessuna anteprima', async () => {
    const CASI = [
      [() => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'x-api-key header is required' } } }), 'Servizio AI non configurato'],
      [() => ({ status: 529, json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }), 'temporaneamente non disponibile'],
      [() => ({ status: 413, testo: 'Request Entity Too Large' }), 'limite tecnico'],
      [() => ({ status: 200, json: { content: [{ type: 'text', text: 'Mi dispiace, non posso.' }] } }), 'non e\' interpretabile'],
    ];
    for (const [r, atteso] of CASI) {
      rispostaAI = r; await apriCarica('testo'); await page.fill('#text-input', 'Testo di prova della ricetta.'); await page.click('#btn-extract');
      await page.waitForSelector('.load-errore'); const t = await page.textContent('.load-errore');
      assert.ok(t.includes(atteso), t); assert.ok(!/x-api-key|Overloaded|Entity/.test(t)); assert.strictEqual(await vai('S.loadPreview'), null);
    }
  });

  await test('U8. non regressione: importazione in una Scheda esistente con Ricetta Attiva -> nuova bozza; Ricette Attive e altre Ricette invariate nel database; apertura nel LAB', async () => {
    const db0 = await caricaDb();
    const scheda = db0.recipes.find(r => (db0.variants || []).some(v => v.recipe_id === r.id && v.active === true));
    assert.ok(scheda, 'una Scheda con Ricetta Attiva nei dati sintetici');
    const varianti0 = (db0.variants || []).filter(v => v.recipe_id === scheda.id);
    const ing0 = JSON.stringify((db0.ingredients || []).filter(i => varianti0.some(v => v.id === i.variant_id)).sort((a, b) => a.id < b.id ? -1 : 1));
    // Bozze gia' presenti in memoria prima dell'importazione (es. la bozza predefinita che l'app
    // crea al caricamento per una Scheda senza bozze): comportamento preesistente, non di P0-a.
    const bozzeInMemoria = await vai(`(R(${JSON.stringify(scheda.id)}).labVersions||[]).map(function(v){return v.id;})`);
    rispostaAI = okAI({ name: 'Variante importata', ingredients: [{ name: 'Farina', qty: 300, unit: 'g' }], steps: ['Impastare.'] });
    await apriCarica('testo'); await page.fill('#text-input', 'Variante: farina 300 g.'); await page.click('#btn-extract'); await page.waitForSelector('#btn-save-preview');
    await vai(`S.loadDestinazione='esistente';S.loadDestinazioneSchedaId=${JSON.stringify(scheda.id)};render()`);
    await page.click('#btn-save-preview'); await page.waitForFunction(() => S.view === 'ricetta-madre-v2'); await attendi(800);
    const db1 = await caricaDb();
    const varianti1 = (db1.variants || []).filter(v => v.recipe_id === scheda.id);
    for (const v of varianti0) assert.deepStrictEqual(varianti1.find(x => x.id === v.id), v, 'Ricetta invariata: ' + v.id);
    const ing1 = JSON.stringify((db1.ingredients || []).filter(i => varianti0.some(v => v.id === i.variant_id)).sort((a, b) => a.id < b.id ? -1 : 1));
    assert.strictEqual(ing1, ing0, 'ingredienti delle Ricette esistenti invariati');
    const nuove = varianti1.filter(v => !varianti0.some(x => x.id === v.id));
    const importate = nuove.filter(v => !bozzeInMemoria.includes(v.id));
    assert.strictEqual(importate.length, 1, 'una sola Ricetta nuova oltre alle bozze gia\' in memoria');
    assert.strictEqual(importate[0].status, 'lab'); assert.strictEqual(importate[0].active, false); assert.strictEqual(importate[0].name, 'Variante importata');
    assert.ok(nuove.every(v => v.active === false && v.status === 'lab'), 'nessuna Ricetta nuova attiva o validata');
    assert.strictEqual(db1.recipes.length, db0.recipes.length, 'nessuna Scheda in piu\'');
    await vai(`S.view='recipe';S.mode='lab';S.selectedId=${JSON.stringify(scheda.id)};render()`); await attendi(300);
    assert.strictEqual(await vai('curLab(R(S.selectedId)).name'), 'Variante importata', 'la nuova bozza e\' quella aperta nel LAB');
    assert.deepStrictEqual(erroriPagina, []);
  });

  await test('U9. isolamento: nessuna richiesta verso l\'esterno e' + ' nessun errore JavaScript durante i test', async () => {
    assert.ok(chiamate.esterne.every(u => /fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/.test(u)), 'solo font e icone (bloccati): ' + chiamate.esterne.filter(u => !/fonts|jsdelivr/.test(u)).join(', '));
    assert.deepStrictEqual(erroriPagina, []);
    assert.deepStrictEqual(await xss(), []);
  });

  await browser.close();
  figlio.kill();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack || e); process.exit(1); });
