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

// Env vars are trimmed: a key or region pasted into the Vercel dashboard with
// a trailing newline or space is accepted there but rejected by Azure with a
// bare 401, which is indistinguishable from a wrong key.
const azureKey = () => String(process.env.AZURE_SPEECH_KEY || '').trim();
const azureRegion = () => String(process.env.AZURE_SPEECH_REGION || '').trim();

// Calls Azure and returns the decoded response. Shared by the POST path and
// the ?probe=1 diagnostic so both exercise exactly the same request.
async function synthesize({ key, region, text, rate, gender }) {
  const voice = gender === 'male' ? 'en-GB-RyanNeural' : 'en-GB-SoniaNeural';
  const pct   = Math.round((rate - 0.95) * 100);
  const ssml  = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB"><voice name="${voice}"><prosody rate="${pct >= 0 ? '+' : ''}${pct}%">${escapeXml(text)}</prosody></voice></speak>`;
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
    return { ok: false, status: azureRes.status, message: msg.slice(0, 200) };
  }
  return { ok: true, status: 200, audio: Buffer.from(await azureRes.arrayBuffer()) };
}

// Asks Azure's token endpoint whether the key is recognised in a region. A
// Speech key is region-bound: used against the wrong region it fails exactly
// like an invalid key, so the same key is tried across the common regions to
// tell "wrong region" from "bad key". Only statuses are reported, never keys.
const SCAN_REGIONS = ['uksouth', 'ukwest', 'westeurope', 'northeurope', 'eastus', 'westus2'];

async function tokenCheck(key, region) {
  try {
    const r = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' },
    });
    if (r.ok) return { region, accepted: true, status: r.status };
    const body = await r.text().catch(() => '');
    return { region, accepted: false, status: r.status, message: body.slice(0, 160) || undefined };
  } catch (e) {
    return { region, accepted: false, error: e.message };
  }
}

module.exports = async function handler(req, res) {
  // Diagnostic GET so we can confirm the function runs and env vars are present.
  // ?probe=1 goes one step further and actually asks Azure to say a word, so a
  // rejected key, a wrong region or an exhausted quota shows up as a readable
  // status instead of a generic "Azure voice unavailable" toast in the app.
  if (req.method === 'GET') {
    const key = azureKey();
    const region = azureRegion();
    const raw = process.env.AZURE_SPEECH_KEY || '';
    const info = {
      ok: true,
      hasKey: !!key,
      hasRegion: !!region,
      region: region || 'not set',
      keyLength: key.length,
      keyHadWhitespace: raw !== raw.trim(),
    };
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!url.searchParams.has('probe')) { res.status(200).json(info); return; }
    if (!key || !region) { res.status(200).json({ ...info, probe: 'skipped — env vars missing' }); return; }
    try {
      const result = await synthesize({ key, region, text: 'test', rate: 0.95, gender: 'female' });
      const out = {
        ...info,
        probe: result.ok ? 'azure ok' : 'azure rejected the request',
        azureStatus: result.status,
        azureMessage: result.ok ? undefined : result.message,
        audioBytes: result.ok ? result.audio.length : undefined,
      };
      // On a rejection, find out whether any region accepts this key at all.
      if (!result.ok) {
        const scans = await Promise.all(SCAN_REGIONS.map(r => tokenCheck(key, r)));
        const accepted = scans.filter(r => r.accepted).map(r => r.region);
        out.keyAcceptedIn = accepted;
        out.verdict = accepted.length
          ? `key belongs to ${accepted.join(', ')} — set AZURE_SPEECH_REGION to that and redeploy`
          : 'no region accepts this key — it is wrong, regenerated, or key access is disabled on the resource';
        out.regionChecks = scans.map(r => `${r.region}: ${r.accepted ? 'accepted' : r.status || r.error}`);
      }
      res.status(200).json(out);
    } catch (e) {
      res.status(200).json({ ...info, probe: 'request to azure failed', error: e.message });
    }
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const key = azureKey();
  const region = azureRegion();
  if (!key || !region) { res.status(500).json({ error: `Missing env vars: key=${!!key} region=${!!region}` }); return; }

  const body = await readBody(req);
  const text = String(body.text || '').slice(0, 1000).trim();
  if (!text) { res.status(400).json({ error: 'No text' }); return; }

  const gender = body.gender === 'male' ? 'male' : 'female';
  const rate   = Math.max(0.5, Math.min(2, Number(body.rate) || 0.95));

  try {
    const result = await synthesize({ key, region, text, rate, gender });
    if (!result.ok) {
      res.status(502).json({ error: `Azure ${result.status}: ${result.message.slice(0, 120)}` });
      return;
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(result.audio);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
