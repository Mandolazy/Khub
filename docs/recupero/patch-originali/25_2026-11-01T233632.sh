# 2026-11-01T23:36:32.227Z  esito: ok
# output: 'ok\n85:    const rows = tables[table] = tables[table] || [];'
python3 - <<'EOF'
p='demo/direzione-3/finto-supabase.js'; s=open(p).read()
old="""    try {
      if (method === 'GET') {"""
assert s.count(old)==1
s=s.replace(old,"""    try {
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
      if (method === 'GET') {""")
s=s.replace(""" * Riproduce solo cio' che api/chat.js usa davvero: GET con filtri, ordine e
 * paginazione; POST con upsert (merge-duplicates / ignore-duplicates);
 * PATCH e DELETE filtrati; Prefer: return=representation.""",""" * Riproduce solo cio' che api/chat.js usa davvero: GET con filtri, ordine e
 * paginazione; POST con upsert (merge-duplicates / ignore-duplicates);
 * PATCH e DELETE filtrati; Prefer: return=representation; la funzione
 * elimina_scheda_se_vuota (Unisci).""")
open(p,'w').write(s); print('ok')
EOF
grep -n "rows = tables\[table\]" demo/direzione-3/finto-supabase.js
