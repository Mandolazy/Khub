export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body;
    const SB = process.env.SUPABASE_URL;
    const SK = process.env.SUPABASE_ANON_KEY;

    const SH_READ = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
    const SH_WRITE = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };
    const SH_DEL = { apikey: SK, Authorization: 'Bearer ' + SK };

    async function sbPost(table, data) {
      const r = await fetch(SB + '/rest/v1/' + table, {
        method: 'POST', headers: SH_WRITE, body: JSON.stringify(data)
      });
      if (!r.ok) {
        const err = await r.text();
        console.error('Supabase error [' + table + ']:', r.status, err);
        return { error: err, status: r.status };
      }
      return { ok: true };
    }

    if (body.fetchUrl) {
      const pageRes = await fetch(body.fetchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'it-IT,it;q=0.9' }
      });
      const html = await pageRes.text();
      return res.status(200).json({ html });
    }


    if (body.supabaseAction === 'loadFamilies') {
      const [r1, r2] = await Promise.all([
        fetch(SB + '/rest/v1/families?select=*&order=name.asc', { headers: SH_READ }),
        fetch(SB + '/rest/v1/variant_families?select=*', { headers: SH_READ })
      ]);
      const [families, variantFamilies] = await Promise.all([r1.json(), r2.json()]);
      return res.status(200).json({ families, variantFamilies });
    }

    if (body.supabaseAction === 'saveFamily') {
      await sbPost('families', body.family);
      return res.status(200).json({ ok: true });
    }

    if (body.supabaseAction === 'saveVariantFamilies') {
      const { variantId, familyIds } = body;
      // Elimina relazioni esistenti per questa variante
      await fetch(SB + '/rest/v1/variant_families?variant_id=eq.' + variantId, {
        method: 'DELETE', headers: SH_DEL
      });
      // Inserisci nuove relazioni
      if (familyIds && familyIds.length) {
        const rows = familyIds.map(fid => ({ variant_id: variantId, family_id: fid }));
        await sbPost('variant_families', rows);
      }
      return res.status(200).json({ ok: true });
    }

    if (body.supabaseAction === 'load') {
      const [r1, r2, r3] = await Promise.all([
        fetch(SB + '/rest/v1/recipes?select=*&order=created_at.asc', { headers: SH_READ }),
        fetch(SB + '/rest/v1/variants?select=*&order=created_at.asc', { headers: SH_READ }),
        fetch(SB + '/rest/v1/ingredients?select=*&order=sort_order.asc', { headers: SH_READ })
      ]);
      const [recipes, variants, ingredients] = await Promise.all([r1.json(), r2.json(), r3.json()]);
      return res.status(200).json({ recipes, variants, ingredients });
    }

    if (body.supabaseAction === 'save') {
      const { recipe, variants, ingredients } = body.data;
      const errors = [];

      // 1. Upsert ricetta
      const r1 = await sbPost('recipes', recipe);
      if (r1.error) errors.push('recipes: ' + r1.error);

      // 2. Upsert varianti una per volta
      if (variants && variants.length) {
        for (const v of variants) {
          const rv = await sbPost('variants', v);
          if (rv.error) errors.push('variant ' + v.id + ': ' + rv.error);
        }
      }

      // 3. Ingredienti: upsert tutti, poi elimina gli orfani per variante
      if (ingredients && ingredients.length) {
        // Upsert tutti gli ingredienti
        const ri = await sbPost('ingredients', ingredients);
        if (ri.error) {
          errors.push('ingredients upsert: ' + ri.error);
        } else {
          // Elimina ingredienti orfani: per ogni variant_id, elimina quelli con ID non presenti
          const byVariant = {};
          ingredients.forEach(i => {
            if (!byVariant[i.variant_id]) byVariant[i.variant_id] = [];
            byVariant[i.variant_id].push(i.id);
          });
          for (const [vid, ids] of Object.entries(byVariant)) {
            // Elimina ingredienti di questa variante che non sono nell'elenco corrente
            const notInIds = ids.map(id => 'id.neq.' + id).join(',');
            await fetch(SB + '/rest/v1/ingredients?variant_id=eq.' + vid + '&and=(' + notInIds + ')', {
              method: 'DELETE', headers: SH_DEL
            });
          }
        }
      }

      if (errors.length > 0) {
        console.error('Save errors:', errors);
        return res.status(200).json({ ok: false, errors });
      }
      return res.status(200).json({ ok: true });
    }

    if (body.supabaseAction === 'update') {
      const ru = await sbPost(body.table, body.data);
      return res.status(200).json(ru);
    }

    if (body.supabaseAction === 'delete') {
      await fetch(SB + '/rest/v1/' + body.table + '?id=eq.' + body.id, {
        method: 'DELETE', headers: SH_DEL
      });
      return res.status(200).json({ ok: true });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
}
