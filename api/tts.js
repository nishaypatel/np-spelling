// Vercel serverless proxy for cloud Text-to-Speech.
//
// Three providers sit behind one endpoint so the app can offer them as a
// choice in Settings; whichever the browser asks for, it gets MP3 back. Keys
// live in Vercel env vars and never reach the browser:
//
//   azure       AZURE_SPEECH_KEY + AZURE_SPEECH_REGION
//   google      GOOGLE_TTS_KEY                     (Cloud Text-to-Speech API key)
//   elevenlabs  ELEVENLABS_API_KEY                 (+ optional voice id overrides)
//
// A provider with no key configured simply reports itself unavailable, so the
// app falls back to the device voice instead of failing.
//
//   POST /api/tts  { text, rate, gender, provider } -> audio/mpeg
//   GET  /api/tts                                   -> which providers are configured
//   GET  /api/tts?probe=1                           -> asks every configured provider to speak

function escapeXml(t) {
  return String(t).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// Env vars are trimmed: a key pasted into the Vercel dashboard with a trailing
// newline is accepted there but rejected by the provider, usually with a bare
// 401 that looks identical to a wrong key.
const env = name => String(process.env[name] || '').trim();

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

// Each provider: is it configured, and how does it turn text into MP3 bytes.
// Every synth resolves to { ok, status, message } or { ok: true, audio }.
const PROVIDERS = {
  azure: {
    label: 'Azure',
    configured: () => !!(env('AZURE_SPEECH_KEY') && env('AZURE_SPEECH_REGION')),
    missing: () => `needs AZURE_SPEECH_KEY (${env('AZURE_SPEECH_KEY') ? 'set' : 'missing'}) and AZURE_SPEECH_REGION (${env('AZURE_SPEECH_REGION') ? 'set' : 'missing'})`,
    async synth({ text, rate, gender }) {
      const region = env('AZURE_SPEECH_REGION');
      const voice = gender === 'male' ? 'en-GB-RyanNeural' : 'en-GB-SoniaNeural';
      const pct = Math.round((rate - 0.95) * 100);
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB"><voice name="${voice}"><prosody rate="${pct >= 0 ? '+' : ''}${pct}%">${escapeXml(text)}</prosody></voice></speak>`;
      const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': env('AZURE_SPEECH_KEY'),
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        },
        body: ssml,
      });
      if (!r.ok) return { ok: false, status: r.status, message: (await r.text().catch(() => '')).slice(0, 200) };
      return { ok: true, status: 200, audio: Buffer.from(await r.arrayBuffer()) };
    },
  },

  google: {
    label: 'Google',
    configured: () => !!env('GOOGLE_TTS_KEY'),
    missing: () => 'needs GOOGLE_TTS_KEY',
    async synth({ text, rate, gender }) {
      // Chirp/Neural2 are the good ones; -B and -A are the en-GB male/female pair.
      const name = env('GOOGLE_TTS_VOICE') || (gender === 'male' ? 'en-GB-Neural2-B' : 'en-GB-Neural2-A');
      const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env('GOOGLE_TTS_KEY'))}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'en-GB', name },
          audioConfig: { audioEncoding: 'MP3', speakingRate: rate },
        }),
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok || !payload.audioContent) {
        const message = payload.error?.message || JSON.stringify(payload).slice(0, 200);
        return { ok: false, status: r.status, message: String(message).slice(0, 200) };
      }
      return { ok: true, status: 200, audio: Buffer.from(payload.audioContent, 'base64') };
    },
  },

  elevenlabs: {
    label: 'ElevenLabs',
    configured: () => !!env('ELEVENLABS_API_KEY'),
    missing: () => 'needs ELEVENLABS_API_KEY',
    async synth({ text, gender }) {
      // Speaking rate is not adjustable here, so the Speed setting does not
      // apply to this provider.
      const speak = async voiceId => fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'xi-api-key': env('ELEVENLABS_API_KEY'), 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, model_id: env('ELEVENLABS_MODEL') || 'eleven_multilingual_v2' }),
        },
      );

      let voiceId = await elevenVoiceId(gender);
      let r = await speak(voiceId);
      // A voice id that isn't in this account's library fails the request; look
      // one up from the account itself and try once more, so a fresh free
      // account works without anyone hunting for ids.
      if (!r.ok && [400, 404, 422].includes(r.status)) {
        const discovered = await elevenLookupVoice(gender);
        if (discovered && discovered !== voiceId) {
          voiceId = discovered;
          r = await speak(voiceId);
        }
      }
      if (!r.ok) return { ok: false, status: r.status, message: (await r.text().catch(() => '')).slice(0, 200), voiceId };
      return { ok: true, status: 200, audio: Buffer.from(await r.arrayBuffer()), voiceId };
    },
  },
};

// ElevenLabs voices. The defaults are its stock British pair; either can be
// overridden with an env var, and if neither exists in the account the library
// is searched instead. Discovered ids are cached for the life of the instance.
const ELEVEN_DEFAULTS = { female: 'Xb7hH8MSUJpSbSDYk0k2', male: 'JBFqnCBsd6RMkjVDRZzb' };
const _elevenFound = {};

async function elevenVoiceId(gender) {
  const configured = gender === 'male' ? env('ELEVENLABS_VOICE_MALE') : env('ELEVENLABS_VOICE_FEMALE');
  return configured || _elevenFound[gender] || ELEVEN_DEFAULTS[gender] || ELEVEN_DEFAULTS.female;
}

async function elevenLookupVoice(gender) {
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': env('ELEVENLABS_API_KEY') } });
    if (!r.ok) return null;
    const voices = (await r.json()).voices || [];
    if (!voices.length) return null;
    const wanted = gender === 'male' ? 'male' : 'female';
    const british = v => /british|england|uk/i.test(`${v.labels?.accent || ''} ${v.labels?.description || ''}`);
    const matches = v => (v.labels?.gender || '').toLowerCase() === wanted;
    const pick = voices.find(v => matches(v) && british(v)) || voices.find(matches) || voices[0];
    _elevenFound[gender] = pick.voice_id;
    return pick.voice_id;
  } catch (e) {
    return null;
  }
}

const pickProvider = name => (Object.prototype.hasOwnProperty.call(PROVIDERS, name) ? name : 'azure');

module.exports = async function handler(req, res) {
  // GET reports which providers are usable. ?probe=1 goes further and has each
  // configured one actually speak, so a rejected key shows up as a readable
  // status instead of a generic fallback toast in the app.
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const status = {};
    for (const [name, provider] of Object.entries(PROVIDERS)) {
      status[name] = provider.configured() ? 'configured' : provider.missing();
    }
    const info = { ok: true, providers: status, region: env('AZURE_SPEECH_REGION') || 'not set' };
    if (!url.searchParams.has('probe')) { res.status(200).json(info); return; }

    const only = url.searchParams.get('provider');
    const names = Object.keys(PROVIDERS).filter(n => (!only || n === only) && PROVIDERS[n].configured());
    const probes = {};
    for (const name of names) {
      try {
        const result = await PROVIDERS[name].synth({ text: 'test', rate: 0.95, gender: 'female' });
        probes[name] = result.ok
          ? { ok: true, audioBytes: result.audio.length, voiceId: result.voiceId }
          : { ok: false, status: result.status, message: result.message || '(empty response body)', voiceId: result.voiceId };
      } catch (e) {
        probes[name] = { ok: false, error: e.message };
      }
    }
    const working = Object.keys(probes).filter(n => probes[n].ok);
    res.status(200).json({
      ...info,
      probe: probes,
      working,
      verdict: working.length ? `usable: ${working.join(', ')}` : 'no configured provider is working — the app will use the device voice',
    });
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = await readBody(req);
  const name = pickProvider(String(body.provider || 'azure'));
  const provider = PROVIDERS[name];
  if (!provider.configured()) { res.status(503).json({ error: `${provider.label} ${provider.missing()}` }); return; }

  const text = String(body.text || '').slice(0, 1000).trim();
  if (!text) { res.status(400).json({ error: 'No text' }); return; }
  const gender = body.gender === 'male' ? 'male' : 'female';
  const rate = Math.max(0.5, Math.min(2, Number(body.rate) || 0.95));

  try {
    const result = await provider.synth({ text, rate, gender });
    if (!result.ok) {
      res.status(502).json({ error: `${provider.label} ${result.status}: ${(result.message || '').slice(0, 120)}` });
      return;
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(result.audio);
  } catch (e) {
    res.status(502).json({ error: `${provider.label}: ${e.message}` });
  }
};
