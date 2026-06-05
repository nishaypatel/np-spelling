// api/generate-word-data.js
// Vercel serverless function — keeps Anthropic API key server-side

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { words } = req.body;
  if (!words || !Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words array required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  const prompt = `You are helping a UK primary school teacher prepare spelling activities for children aged 5-6.

Here are this week's spelling words: ${words.join(', ')}

For EACH word, generate:
1. "chunks": array of phonics chunks showing how to sound out the word (e.g. "astronaut" → ["as","tro","naut"]). Use Anima Phonics style: break at natural phoneme boundaries.
2. "sentence": a very simple sentence using the word, suitable for a 5-6 year old. Keep it short and clear.
3. "trickyPart": the part of the word children this age most commonly spell wrong (just that substring).
4. "wrongVersions": array of exactly 2 common misspellings a 5-6 year old might write.

Return ONLY a valid JSON object with each word as a key. No markdown, no explanation, no backticks. Example format:
{
  "because": {
    "chunks": ["be","cause"],
    "sentence": "I stayed inside because it was raining.",
    "trickyPart": "au",
    "wrongVersions": ["becaus","becoz"]
  }
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return res.status(502).json({ error: 'Upstream API error' });
    }

    const data = await response.json();
    const text = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Strip any accidental markdown fences
    const clean = text.replace(/```json|```/g, '').trim();
    const wordData = JSON.parse(clean);

    return res.status(200).json(wordData);
  } catch (err) {
    console.error('generate-word-data error:', err);
    return res.status(500).json({ error: 'Failed to generate word data' });
  }
}
