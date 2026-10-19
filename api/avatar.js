// Vercel serverless proxy for Telegram profile photos.
// t.me serves avatars with a CSP sandbox header, so the browser cannot read them
// into a canvas (the share card). This endpoint fetches the bytes server-side and
// returns them same-origin, which keeps the canvas clean.

const ALLOWED = /^https:\/\/t\.me\/i\/userpic\//;

module.exports = async function handler(req, res) {
  const u = String((req.query && req.query.u) || '');
  if (!ALLOWED.test(u)) {
    res.status(400).json({ error: 'bad-url' });
    return;
  }
  try {
    const upstream = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 MSCQuiz' } });
    if (!upstream.ok) {
      res.status(502).json({ error: 'upstream-' + upstream.status });
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: 'fetch-failed' });
  }
};
