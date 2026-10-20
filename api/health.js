export default function handler(_req, res) {
  res.status(200).setHeader('Cache-Control', 'no-store').json({ ok: true, service: 'maotsetung-comuna', version: '0.1.0' });
}
