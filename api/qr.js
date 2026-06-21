// Vercel serverless function: GET /api/qr?text=...  -> image/svg+xml
const QRCode = require('qrcode');

module.exports = async (req, res) => {
  const text = (req.query && req.query.text) ? String(req.query.text) : '';
  if (!text) { res.status(400).json({ error: 'Missing ?text= parameter' }); return; }
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg', margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#0c1226', light: '#ffffff' }
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(svg);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
};
