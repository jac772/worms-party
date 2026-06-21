// Vercel serverless function: GET /api/ably-token?clientId=...
// Mints a short-lived, capability-scoped Ably TokenRequest so the secret
// API key never reaches the browser. The key lives only in Vercel env.
const Ably = require('ably');

module.exports = async (req, res) => {
  const key = process.env.ABLY_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'ABLY_API_KEY not configured in Vercel env' });
    return;
  }
  const clientId = (req.query && req.query.clientId)
    ? String(req.query.clientId).slice(0, 64)
    : 'web-' + Math.random().toString(36).slice(2);
  try {
    const rest = new Ably.Rest(key);
    const tokenRequest = await rest.auth.createTokenRequest({
      clientId,
      ttl: 60 * 60 * 1000,                                   // 1h; SDK auto-renews
      capability: { 'worms:*': ['publish', 'subscribe', 'presence'] }
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(tokenRequest);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create token request' });
  }
};
