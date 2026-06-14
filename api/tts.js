// Vercel serverless proxy for Azure Text-to-Speech.
// Reads AZURE_SPEECH_KEY and AZURE_SPEECH_REGION from Vercel env vars.
// Browser POSTs { text, rate, gender } → receives MP3 audio.

function escapeXml(t) {
  return String(t).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') { resolve(req.body); return; }
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  // Diagnostic GET so we can confirm the function runs and env vars are present
  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      hasKey: !!process.env.AZURE_SPEECH_KEY,
      hasRegion: !!process.env.AZURE_SPEECH_REGION,
      region: process.env.AZURE_SPEECH_REGION || 'not set',
    });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) { res.status(500).json({ error: `Missing env vars: key=${!!key} region=${!!region}` }); return; }

  const body = await readBody(req);
  const text = String(body.text || '').slice(0, 1000).trim();
  if (!text) { res.status(400).json({ error: 'No text' }); return; }

  const gender = body.gender === 'male' ? 'male' : 'female';
  const rate   = Math.max(0.5, Math.min(2, Number(body.rate) || 0.95));
  const voice  = gender === 'male' ? 'en-GB-RyanNeural' : 'en-GB-SoniaNeural';
  const pct    = Math.round((rate - 0.95) * 100);
  const ssml   = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB"><voice name="${voice}"><prosody rate="${pct >= 0 ? '+' : ''}${pct}%">${escapeXml(text)}</prosody></voice></speak>`;

  try {
    const azureRes = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      },
      body: ssml,
    });
    if (!azureRes.ok) {
      const msg = await azureRes.text().catch(() => '');
      res.status(502).json({ error: `Azure ${azureRes.status}: ${msg.slice(0, 120)}` });
      return;
    }
    const audio = Buffer.from(await azureRes.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(audio);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
