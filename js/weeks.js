// Loads weekly spelling words from sharded JSON files.
//
// Storage layout (keeps file sizes small as weeks accumulate):
//   data/weeks/manifest.json  – tiny index of every week: id, label, the 8
//                               words (for the history grid) and which shard
//                               holds its full data. Stays small forever.
//   data/weeks/shard-NNN.json – full word data (chunks, sentences, tricky
//                               bits) for up to WEEKS_PER_SHARD weeks each.
//                               Only the shard for the active week is loaded.

const WEEKS_DATA_BASE = 'data/weeks';

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// Returns the manifest (week index). Falls back to the bundled copy if the
// file cannot be fetched.
async function loadWeeksManifest() {
  try {
    return await fetchJson(`${WEEKS_DATA_BASE}/manifest.json`);
  } catch (e) {
    console.warn('loadWeeksManifest: using fallback', e);
    return JSON.parse(JSON.stringify(FALLBACK_MANIFEST));
  }
}

// Returns the full data ({ weekId, words, wordData }) for a single week,
// reading just that week's shard. Falls back to the bundled default week.
async function loadWeekData(entry) {
  try {
    const shard = await fetchJson(`${WEEKS_DATA_BASE}/${entry.shard}`);
    const week = shard[entry.weekId];
    if (week && Array.isArray(week.words)) return week;
    throw new Error(`week ${entry.weekId} missing from ${entry.shard}`);
  } catch (e) {
    console.warn('loadWeekData: using fallback', e);
    return JSON.parse(JSON.stringify(WEEK_WORDS));
  }
}
