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
