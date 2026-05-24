export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    // Se è una richiesta di fetch URL, scarica la pagina e restituisci il testo
    if (body.fetchUrl) {
      const pageRes = await fetch(body.fetchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const html = await pageRes.text();
      return res.status(200).json({ html });
    }

    // Altrimenti è una chiamata AI normale
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
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
}
