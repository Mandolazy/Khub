/*
 * Finto Supabase (PostgREST) in memoria per la demo locale della Direzione 3.
 * Riproduce solo cio' che api/chat.js usa davvero: GET con filtri, ordine e
 * paginazione; POST con upsert (merge-duplicates / ignore-duplicates);
 * PATCH e DELETE filtrati; Prefer: return=representation; la funzione
 * elimina_scheda_se_vuota (Unisci).
 * Nessuna rete: i dati vivono solo nella memoria del processo e si perdono
 * alla chiusura della demo.
 */
'use strict';

// Chiave di ogni tabella per l'upsert (default: id).
const CHIAVI = {
  variant_families: ['variant_id', 'family_id'],
};

function creaFintoSupabase(datiIniziali) {
  let tables = JSON.parse(JSON.stringify(datiIniziali));
  const registro = [];

  const risposta = (status, data) => ({
    ok: status < 400, status,
    json: async () => JSON.parse(JSON.stringify(data === undefined ? null : data)),
    text: async () => (data === undefined || data === null ? '' : JSON.stringify(data)),
  });

  function valore(v) { return v == null ? null : String(v); }
  function confronta(row, [col, neg, op, val]) {
    const v = row[col];
    let ok;
    if (op === 'eq') ok = valore(v) === val;
    else if (op === 'neq') ok = valore(v) !== val;
    else if (op === 'in') ok = val.includes(valore(v));
    else if (op === 'is') ok = val === 'null' ? v == null : String(v) === val;
    else if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
      if (v == null) ok = false;
      else {
        const a = typeof v === 'number' ? v : String(v), b = typeof v === 'number' ? Number(val) : val;
        ok = op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
      }
    } else throw new Error('filtro non supportato nella demo: ' + op);
    return neg ? !ok : ok;
  }
  function ordina(a, b, ordine) {
    for (const [col, dir] of ordine) {
      const x = a[col], y = b[col];
      if (x === y) continue;
      if (x == null) return 1; if (y == null) return -1;
      const c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y));
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return 0;
  }
  function proietta(rows, select) {
    if (!select || select === '*') return rows;
    const cols = select.split(',').map(s => s.trim()).filter(Boolean);
    return rows.map(r => Object.fromEntries(cols.map(c => [c, r[c] === undefined ? null : r[c]])));
  }

  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const table = u.pathname.replace(/^\/rest\/v1\//, '');
    const method = (opts.method || 'GET').toUpperCase();
    const headers = opts.headers || {};
    const prefer = String(headers.Prefer || headers.prefer || '');
    let ordine = [], limit = null, offset = 0, select = null;
    const filtri = [];
    try {
      for (const [k, raw] of u.searchParams) {
        if (k === 'select') { select = raw; continue; }
        if (k === 'order') { ordine = raw.split(',').map(s => { const p = s.split('.'); return [p[0], p[1] === 'desc' ? 'desc' : 'asc']; }); continue; }
        if (k === 'limit') { limit = parseInt(raw, 10); continue; }
        if (k === 'offset') { offset = parseInt(raw, 10); continue; }
        if (k === 'on_conflict' || k === 'columns') continue;
        let resto = raw, neg = false;
        if (resto.startsWith('not.')) { neg = true; resto = resto.slice(4); }
        const dot = resto.indexOf('.');
        const op = resto.slice(0, dot), val = resto.slice(dot + 1);
        filtri.push([k, neg, op, op === 'in' ? val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')) : val]);
      }
    } catch (e) {
      return risposta(400, { message: String(e.message || e) });
    }
    registro.push({ method, table, quando: new Date().toISOString() });
    const rows = tables[table] = tables[table] || [];
    const corrisponde = r => filtri.every(f => confronta(r, f));

    try {
      // Funzione elimina_scheda_se_vuota (docs/proposte/elimina_scheda_se_vuota.sql):
      // nella demo e' "installata", con la stessa logica.
      if (method === 'POST' && table === 'rpc/elimina_scheda_se_vuota') {
        const id = String((JSON.parse(opts.body || '{}') || {}).p_recipe_id || '');
        let esito;
        if (!(tables.recipes || []).some(r => r.id === id)) esito = 'assente';
        else if ((tables.variants || []).some(v => v.recipe_id === id)) esito = 'non_vuota';
        else if ((tables.l3_items || []).some(x => x.recipe_id === id)) esito = 'osservazioni_michelinai';
        else { tables.recipes = tables.recipes.filter(r => r.id !== id); esito = 'eliminata'; }
        return risposta(200, esito);
      }
      if (method === 'GET') {
        const out = rows.filter(corrisponde).sort((a, b) => ordina(a, b, ordine));
        return risposta(200, proietta(out.slice(offset, limit == null ? undefined : offset + limit), select));
      }
      if (method === 'POST') {
        const data = JSON.parse(opts.body || 'null');
        const elenco = Array.isArray(data) ? data : [data];
        const chiave = CHIAVI[table] || ['id'];
        const ignora = /ignore-duplicates/.test(prefer);
        const unisci = /merge-duplicates/.test(prefer);
        const inseriti = [];
        for (const row of elenco) {
          const completa = chiave.every(c => row[c] != null);
          const i = completa ? rows.findIndex(r => chiave.every(c => valore(r[c]) === valore(row[c]))) : -1;
          if (i >= 0) {
            if (ignora) continue;
            if (!unisci) return risposta(409, { message: 'duplicate key value violates unique constraint (' + table + ')' });
            const primaHash = rows[i].contenuto_hash;
            rows[i] = { ...rows[i], ...row };
            // Come il database reale (e i test): la data di modifica della bozza
            // si aggiorna solo quando cambia la firma del contenuto.
            if (table === 'variants' && 'contenuto_hash' in row && row.contenuto_hash !== primaHash) rows[i].contenuto_modificato_il = new Date().toISOString();
            inseriti.push(rows[i]);
          } else {
            const nuova = { created_at: new Date().toISOString(), ...row };
            if (table === 'variants' && nuova.contenuto_hash != null && nuova.contenuto_modificato_il == null) nuova.contenuto_modificato_il = new Date().toISOString();
            if (nuova.id == null && !CHIAVI[table]) nuova.id = 'demo-' + Math.random().toString(36).slice(2, 10);
            rows.push(nuova); inseriti.push(nuova);
          }
        }
        return /return=representation/.test(prefer) ? risposta(201, proietta(inseriti, select)) : risposta(201, null);
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(opts.body || '{}');
        const toccate = rows.filter(corrisponde);
        toccate.forEach(r => Object.assign(r, patch));
        return /return=representation/.test(prefer) ? risposta(200, proietta(toccate, select)) : risposta(204, null);
      }
      if (method === 'DELETE') {
        if (!filtri.length) return risposta(400, { message: 'DELETE senza filtri rifiutata dalla demo' });
        tables[table] = rows.filter(r => !corrisponde(r));
        return risposta(204, null);
      }
    } catch (e) {
      return risposta(400, { message: String(e.message || e) });
    }
    return risposta(405, { message: 'metodo non supportato: ' + method });
  }

  return {
    fetch,
    registro,
    get tables() { return tables; },
    ripristina() { tables = JSON.parse(JSON.stringify(datiIniziali)); registro.length = 0; },
  };
}

module.exports = { creaFintoSupabase };
