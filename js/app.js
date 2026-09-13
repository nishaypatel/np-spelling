// ── Family Groups ─────────────────────────────────────────
const FAMILY_MAP = {
  'nishaypatel@gmail.com': 'patel-family',
  'prinapatel1097@gmail.com': 'patel-family',
};
const ALLOWED_EMAILS = Object.keys(FAMILY_MAP);

// Word-list sizes. The school usually sets 8 words a week, but some lists run
// longer, so the app only enforces sane bounds on hand-edited lists.
const VOICE_ENGINES = ['device', 'azure', 'google', 'elevenlabs'];

const WORDS_PER_WEEK = 8;
const MIN_WORDS_PER_WEEK = 4;
const MAX_WORDS_PER_WEEK = 15;

const DEFAULT_VISIBLE_GAMES = [
  'hear-write',
  'look-cover-write',
  'build-sounds',
  'tap-sound',
  'tricky-bit',
  'dictation-sentence',
];

const GAME_CATALOG = [
  // `special: true` games are managed by the app (not the settings toggles):
  // My Tricky Words appears automatically while test mistakes are marked.
  { id: 'my-tricky-words', emoji: '⭐', name: 'My Tricky Words', desc: 'Beat the words from the school test', group: 'Recommended', defaultVisible: false, special: true },
  { id: 'hear-write', emoji: '👂', name: 'Hear & Write', desc: 'Listen and spell the word', group: 'Recommended', defaultVisible: true },
  { id: 'look-cover-write', emoji: '🙈', name: 'Look, Cover, Write, Check', desc: 'Study, hide, then spell', group: 'Recommended', defaultVisible: true },
  { id: 'build-sounds', emoji: '🧩', name: 'Build the Sounds', desc: 'Build words from chunks', group: 'Recommended', defaultVisible: true },
  { id: 'tap-sound', emoji: '🎯', name: 'Tap the Sound', desc: 'Match sounds to graphemes', group: 'Recommended', defaultVisible: true },
  { id: 'tricky-bit', emoji: '🔴', name: 'Tricky Bit', desc: 'Spot the red word part', group: 'Recommended', defaultVisible: true },
  { id: 'dictation-sentence', emoji: '✏️', name: 'Dictation Sentence', desc: 'Write a whole sentence', group: 'Recommended', defaultVisible: true },
  { id: 'missing-letters', emoji: '🔡', name: 'Missing Letters', desc: 'Fill in the gaps', group: 'More Practice', defaultVisible: false },
  { id: 'sound-match', emoji: '🔊', name: 'Sound Match', desc: 'Pair sounds and spellings', group: 'More Practice', defaultVisible: false },
  { id: 'unscramble', emoji: '🔀', name: 'Unscramble', desc: 'Put letters in order', group: 'More Practice', defaultVisible: false },
  { id: 'memory-match', emoji: '🧠', name: 'Word Memory Match', desc: 'Remember word chunks', group: 'More Practice', defaultVisible: false },
  { id: 'odd-one-out', emoji: '🚫', name: 'Odd One Out', desc: 'Find the pattern breaker', group: 'Challenge', defaultVisible: false },
  { id: 'speed-spell', emoji: '⌨️', name: 'Speed Spell', desc: 'Spell against the clock', group: 'Challenge', defaultVisible: false },
  { id: 'boss-round', emoji: '🏆', name: 'Boss Round', desc: 'Mixed challenge', group: 'Challenge', defaultVisible: false },
];

const DEFAULT_SETTINGS = {
  theme: 'rainbow',
  // Device voice is the default: it always works, costs nothing and needs no
  // key. The cloud engines are opt-in from Settings once one is configured.
  voiceEngine: 'device',
  voiceGender: 'female',
  speechRate: 0.75,
  visibleGames: DEFAULT_VISIBLE_GAMES,
  // Which word pool the Practice games (other than the special My Tricky
  // Words card) draw from: 'current' week, a 'week' chosen below, or every
  // word marked wrong on a school test across all weeks ('mistakes').
  practiceSource: 'current',
  practiceWeekId: null,
};

const STATE = {
  user: null,
  familyId: null,
  currentWeekId: null,
  manifest: null,
  words: [],
  wordData: {},
  testMistakes: [], // words marked wrong in the real school test, this week
  settings: { ...DEFAULT_SETTINGS },
  results: [],
  stats: { bestStreak: 0, dayStreak: 0, lastPracticeDay: null },
  // Resolved word pool for the Practice screen's regular games, based on
  // settings.practiceSource. Refreshed via refreshActivePool().
  activePool: { words: [], wordData: {} },
};

const THEMES = [
  { id: 'rainbow', name: 'Rainbow Squad', emoji: '🌈', headerColor: '#ffd166' },
  { id: 'ocean', name: 'Ocean', emoji: '🐬', headerColor: '#0284c7' },
  { id: 'jungle', name: 'Jungle', emoji: '🦜', headerColor: '#16a34a' },
  { id: 'space', name: 'Space', emoji: '🚀', headerColor: '#2d3166' },
  { id: 'football', name: 'Football', emoji: '⚽', headerColor: '#15803d' },
];

// Offline app shell — see sw.js. Registered before Firebase init so the shell
// still caches even if the Firebase CDN is unreachable.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw register', e)));
}

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();
// Offline cache: settings/words/results stay readable (and writes queue up)
// without a connection. Must run before any other Firestore call.
db.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('firestore persistence', e.code || e));

function qs(id) { return document.getElementById(id); }
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function showScreen(id) {
  if (typeof TTS !== 'undefined') TTS.cancel();
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
    screen.classList.add('hidden');
  });
  qs(id)?.classList.remove('hidden');
  qs(id)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showToast(msg, duration = 2600) {
  const toast = qs('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), duration);
}

function applyTheme(themeId) {
  const safeTheme = THEMES.some(t => t.id === themeId) ? themeId : DEFAULT_SETTINGS.theme;
  STATE.settings.theme = safeTheme;
  THEMES.forEach(t => document.body.classList.remove('theme-' + t.id));
  document.body.classList.add('theme-' + safeTheme);
  const theme = THEMES.find(t => t.id === safeTheme);
  document.querySelectorAll('.brand-bubble, .header-mascot, .results-mascot').forEach(el => { el.textContent = theme?.emoji || '✨'; });
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme?.headerColor || '#ffd166');
}


function autoDetectPatterns(word) {
  const patterns = ['igh', 'air', 'ear', 'ure', 'sh', 'ch', 'th', 'ck', 'ng', 'ai', 'ee', 'oa', 'oo', 'ar', 'or', 'er', 'ir', 'ur', 'ow', 'oi', 'oy'];
  const chunks = [];
  let i = 0;
  while (i < word.length) {
    const tri = word.slice(i, i + 3);
    const duo = word.slice(i, i + 2);
    if (word.startsWith('un') && i === 0) { chunks.push('un'); i += 2; }
    else if (patterns.includes(tri)) { chunks.push(tri); i += 3; }
    else if (patterns.includes(duo)) { chunks.push(duo); i += 2; }
    else { chunks.push(word[i]); i += 1; }
  }
  const pattern = patterns.find(item => word.includes(item));
  return {
    chunks,
    family: word.startsWith('un') ? 'un- prefix family' : pattern ? `${pattern} sound family` : 'single sound spelling',
    trickyPart: word.startsWith('un') ? 'un' : chunks.find(chunk => chunk.length > 1) || word.slice(-1),
    phonicsMap: chunks.map(chunk => ({ sound: chunk, spelling: chunk })),
    sentence: `Can you spell ${word}?`,
    wrongVersions: [],
  };
}

function normaliseSettings(raw = {}) {
  const visible = Array.isArray(raw.visibleGames) ? raw.visibleGames : DEFAULT_VISIBLE_GAMES;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    voiceEngine: VOICE_ENGINES.includes(raw.voiceEngine) ? raw.voiceEngine : DEFAULT_SETTINGS.voiceEngine,
    speechRate: Number(raw.speechRate || DEFAULT_SETTINGS.speechRate),
    visibleGames: visible.filter(id => GAME_CATALOG.some(game => game.id === id)),
    practiceSource: ['current', 'week', 'mistakes'].includes(raw.practiceSource) ? raw.practiceSource : DEFAULT_SETTINGS.practiceSource,
    practiceWeekId: raw.practiceWeekId || null,
  };
}

async function saveSettings(partial) {
  STATE.settings = normaliseSettings({ ...STATE.settings, ...partial });
  applyTheme(STATE.settings.theme);
  if (!STATE.familyId) return;
  await db.collection('families').doc(STATE.familyId).collection('settings').doc('prefs').set(STATE.settings, { merge: true });
}

async function loadSettings() {
  STATE.settings = { ...DEFAULT_SETTINGS };
  if (!STATE.familyId) { applyTheme(STATE.settings.theme); return; }
  try {
    const doc = await db.collection('families').doc(STATE.familyId).collection('settings').doc('prefs').get();
    STATE.settings = normaliseSettings(doc.exists ? doc.data() : {});
  } catch (e) {
    console.warn('loadSettings', e);
  }
  applyTheme(STATE.settings.theme);
}

// ── Streak stats (best run + days practised in a row) ─────
function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function loadStats() {
  STATE.stats = { bestStreak: 0, dayStreak: 0, lastPracticeDay: null };
  if (!STATE.familyId) return;
  try {
    const doc = await db.collection('families').doc(STATE.familyId).collection('settings').doc('stats').get();
    if (doc.exists) STATE.stats = { ...STATE.stats, ...doc.data() };
  } catch (e) {
    console.warn('loadStats', e);
  }
}

async function saveStats() {
  if (!STATE.familyId) return;
  try {
    await db.collection('families').doc(STATE.familyId).collection('settings').doc('stats').set(STATE.stats, { merge: true });
  } catch (e) {
    console.warn('saveStats', e);
  }
}

// Called after every answered round. Updates the day streak (any practice
// counts) and the best correct-run streak. Returns true on a new best.
function recordPracticeStats(streak) {
  const stats = STATE.stats;
  let changed = false;
  let newBest = false;
  const today = localDay();
  if (stats.lastPracticeDay !== today) {
    const yesterday = localDay(new Date(Date.now() - 86400000));
    stats.dayStreak = stats.lastPracticeDay === yesterday ? stats.dayStreak + 1 : 1;
    stats.lastPracticeDay = today;
    changed = true;
  }
  if (streak > stats.bestStreak) {
    stats.bestStreak = streak;
    changed = newBest = true;
  }
  if (changed) saveStats();
  return newBest;
}

// Day streak shown to the user: stale streaks (no practice since the day
// before yesterday) display as 0 until they practise again.
function currentDayStreak() {
  const { dayStreak, lastPracticeDay } = STATE.stats;
  const active = lastPracticeDay === localDay() || lastPracticeDay === localDay(new Date(Date.now() - 86400000));
  return active ? dayStreak : 0;
}

function defaultSentencesForWord(word) {
  return [
    `Can you spell ${word}?`,
    `I can read the word ${word}.`,
    `Please write ${word} carefully.`,
    `The word of the week is ${word}.`,
    `Listen for ${word} in this sentence.`,
  ];
}

function makeSentenceOptions(word, data = {}) {
  const existing = Array.isArray(data.sentences) ? data.sentences : [];
  const sentenceList = [...existing, data.sentence, ...defaultSentencesForWord(word)]
    .map(sentence => String(sentence || '').trim())
    .filter(Boolean);
  return [...new Set(sentenceList)].slice(0, 5);
}

function enrichWordData(words, wordData = {}) {
  const enriched = {};
  words.forEach(word => {
    const existing = wordData[word] || {};
    if (existing.chunks && existing.chunks.length > 0) {
      enriched[word] = { ...existing };
    } else {
      enriched[word] = {
        ...autoDetectPatterns(word),
        ...existing,
      };
    }
    enriched[word].sentences = makeSentenceOptions(word, enriched[word]);
    enriched[word].sentence = enriched[word].sentences[0];
  });
  return enriched;
}

async function loadCurrentWeek() {
  const manifest = await loadWeeksManifest();
  STATE.manifest = manifest;
  const entry = manifest.weeks.find(w => w.weekId === manifest.currentWeekId)
    || manifest.weeks[manifest.weeks.length - 1];
  const full = await loadWeekData(entry);

  await applyWeekData(entry, full);
}

async function applyWeekData(entry, full) {
  STATE.currentWeekId = full.weekId || entry.weekId;
  STATE.words = [...full.words];
  STATE.wordData = enrichWordData(STATE.words, full.wordData || {});
  // Seed from the bundled dataset (e.g. the master word list import), then
  // let any family-specific Firestore record override it below.
  STATE.testMistakes = Array.isArray(full.testMistakes) ? full.testMistakes.filter(w => STATE.words.includes(w)) : [];

  if (!STATE.familyId) return;
  try {
    const doc = await db.collection('families').doc(STATE.familyId).collection('weeks').doc(STATE.currentWeekId).get();
    if (doc.exists && Array.isArray(doc.data().words)) {
      STATE.words = doc.data().words.slice(0, MAX_WORDS_PER_WEEK).map(w => String(w).trim()).filter(Boolean);
      STATE.wordData = enrichWordData(STATE.words, { ...(full.wordData || {}), ...(doc.data().wordData || {}) });
    }
    if (doc.exists && Array.isArray(doc.data().testMistakes)) {
      STATE.testMistakes = doc.data().testMistakes.filter(w => STATE.words.includes(w));
    }
  } catch (e) {
    console.warn('applyWeekData', e);
  }
}

// ── Practice word source (Settings → Practice Word Source) ────────────────
// Resolves the word pool the regular Practice games draw from. "My Tricky
// Words" is unaffected — it always stays scoped to STATE.testMistakes for
// the current week.
async function resolveWeekPool(weekId) {
  if (weekId === STATE.currentWeekId) return { words: STATE.words, wordData: STATE.wordData };
  const entry = STATE.manifest?.weeks.find(w => w.weekId === weekId);
  if (!entry) return { words: STATE.words, wordData: STATE.wordData };
  const full = await loadWeekData(entry);
  return { words: [...full.words], wordData: enrichWordData(full.words, full.wordData || {}) };
}

// Fetches each week's testMistakes (family override if present, else the
// bundled default) and unions the words that were ever marked wrong,
// together with their word data so games can show chunks/sentences.
async function collectAllMistakes() {
  const weeks = STATE.manifest?.weeks || [];
  const seen = new Set();
  const words = [];
  const wordData = {};
  for (const entry of weeks) {
    let mistakes = [];
    let weekWordData = {};
    try {
      const full = await loadWeekData(entry);
      weekWordData = full.wordData || {};
      mistakes = Array.isArray(full.testMistakes) ? full.testMistakes : [];
    } catch (e) {
      console.warn('collectAllMistakes: week load failed', entry.weekId, e);
    }
    if (STATE.familyId) {
      try {
        const doc = await db.collection('families').doc(STATE.familyId).collection('weeks').doc(entry.weekId).get();
        if (doc.exists && Array.isArray(doc.data().testMistakes)) mistakes = doc.data().testMistakes;
        if (doc.exists && doc.data().wordData) weekWordData = { ...weekWordData, ...doc.data().wordData };
      } catch (e) {
        console.warn('collectAllMistakes: firestore read failed', entry.weekId, e);
      }
    }
    mistakes.forEach(word => {
      if (seen.has(word)) return;
      seen.add(word);
      words.push(word);
      wordData[word] = weekWordData[word] || autoDetectPatterns(word);
    });
  }
  return { words, wordData: enrichWordData(words, wordData) };
}

async function refreshActivePool() {
  const { practiceSource, practiceWeekId } = STATE.settings;
  if (practiceSource === 'week') {
    const targetWeekId = practiceWeekId || STATE.currentWeekId;
    STATE.activePool = await resolveWeekPool(targetWeekId);
  } else if (practiceSource === 'mistakes') {
    STATE.activePool = await collectAllMistakes();
  } else {
    STATE.activePool = { words: STATE.words, wordData: STATE.wordData };
  }
}

// Most weeks have 8 words, but some lists are longer, so the editor shows a
// slot per word in the current week (never fewer than the usual 8) plus a
// spare for adding one.
function wordSlotCount() { return Math.max(WORDS_PER_WEEK, STATE.words.length + 1); }

async function saveWeeklyWords(words) {
  // Capitals are kept: some words are proper nouns (July, Tuesday, August).
  const cleanWords = words.map(w => w.trim()).filter(Boolean).slice(0, MAX_WORDS_PER_WEEK);
  if (cleanWords.length < MIN_WORDS_PER_WEEK) { showToast(`Please enter at least ${MIN_WORDS_PER_WEEK} words.`); return false; }
  STATE.words = cleanWords;
  STATE.wordData = enrichWordData(cleanWords, STATE.wordData);
  STATE.testMistakes = STATE.testMistakes.filter(w => cleanWords.includes(w));
  await db.collection('families').doc(STATE.familyId).collection('weeks').doc(STATE.currentWeekId).set({
    words: cleanWords,
    wordData: STATE.wordData,
    testMistakes: STATE.testMistakes,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  showToast('This week’s words saved!');
  return true;
}

async function saveTestMistakes(mistakes) {
  STATE.testMistakes = mistakes.filter(w => STATE.words.includes(w));
  if (!STATE.familyId) return;
  try {
    await db.collection('families').doc(STATE.familyId).collection('weeks').doc(STATE.currentWeekId).set({
      testMistakes: STATE.testMistakes,
    }, { merge: true });
  } catch (e) {
    console.error('saveTestMistakes', e);
    showToast('Could not save test results.');
  }
}

// ── All Test Results (review/edit mistakes for any week, not just the
// currently active one) ────────────────────────────────────────────────
async function loadAllWeeksMistakes() {
  const weeks = STATE.manifest?.weeks || [];
  const out = [];
  for (const entry of weeks) {
    let mistakes = Array.isArray(entry.testMistakes) ? entry.testMistakes : [];
    let words = entry.words;
    if (STATE.familyId) {
      try {
        const doc = await db.collection('families').doc(STATE.familyId).collection('weeks').doc(entry.weekId).get();
        if (doc.exists && Array.isArray(doc.data().testMistakes)) mistakes = doc.data().testMistakes;
        if (doc.exists && Array.isArray(doc.data().words)) words = doc.data().words; // family may have edited the word list
      } catch (e) {
        console.warn('loadAllWeeksMistakes: firestore read failed', entry.weekId, e);
      }
    }
    out.push({ weekId: entry.weekId, label: entry.label, words, mistakes: mistakes.filter(w => words.includes(w)) });
  }
  return out;
}

async function saveWeekMistakes(weekId, mistakes) {
  if (weekId === STATE.currentWeekId) STATE.testMistakes = mistakes.filter(w => STATE.words.includes(w));
  if (!STATE.familyId) return;
  try {
    await db.collection('families').doc(STATE.familyId).collection('weeks').doc(weekId).set({ testMistakes: mistakes }, { merge: true });
  } catch (e) {
    console.error('saveWeekMistakes', e);
    showToast('Could not save test results.');
  }
}

async function renderTestHistory() {
  const body = qs('test-history-body');
  body.innerHTML = '<div class="loading-wrap"><div class="spinner"></div><p>Loading test results...</p></div>';
  const weeks = await loadAllWeeksMistakes();
  body.innerHTML = `
    <p class="history-intro">Tap any word to mark or unmark it as spelled wrong on that week's real test.</p>
    ${weeks.map(week => `
      <section class="apple-card">
        <h2>${escapeHtml(week.label)} <small class="week-date">${escapeHtml(week.weekId)}</small></h2>
        <div class="mistake-chips" data-week-id="${escapeHtml(week.weekId)}">
          ${week.words.map(word => `<button class="mistake-chip${week.mistakes.includes(word) ? ' marked' : ''}" data-mistake="${escapeHtml(word)}">${escapeHtml(word)}</button>`).join('')}
        </div>
      </section>`).reverse().join('')}`;

  body.querySelectorAll('[data-week-id]').forEach(group => {
    group.querySelectorAll('[data-mistake]').forEach(chip => chip.addEventListener('click', () => {
      chip.classList.toggle('marked');
      const marked = [...group.querySelectorAll('.mistake-chip.marked')].map(el => el.dataset.mistake);
      saveWeekMistakes(group.dataset.weekId, marked);
    }));
  });
}

async function saveResult(word, activity, correct) {
  const result = { word, activity, correct, timestamp: Date.now() };
  STATE.results.push(result);
  try {
    await db.collection('families').doc(STATE.familyId).collection('weeks').doc(STATE.currentWeekId).collection('results').add({
      ...result,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { console.error('saveResult', e); }
}

async function loadResults() {
  if (!STATE.familyId || !STATE.currentWeekId) return [];
  try {
    const snap = await db.collection('families').doc(STATE.familyId).collection('weeks').doc(STATE.currentWeekId).collection('results').orderBy('timestamp', 'desc').get();
    return snap.docs.map(doc => doc.data());
  } catch (e) {
    console.error('loadResults', e);
    return [];
  }
}

function setWeekLabel() {
  const weekDate = new Date(STATE.currentWeekId + 'T00:00:00');
  qs('header-week-label').textContent = 'Week of ' + weekDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function renderHome() {
  setWeekLabel();
  applyTheme(STATE.settings.theme);
  const statsRow = qs('home-stats');
  const dayStreak = currentDayStreak();
  const best = STATE.stats.bestStreak;
  statsRow.classList.toggle('hidden', !best && !dayStreak);
  statsRow.innerHTML = `
    <div class="stat-pill">🔥 Best run <b>${best}</b> word${best === 1 ? '' : 's'}</div>
    <div class="stat-pill">📅 <b>${dayStreak}</b> day${dayStreak === 1 ? '' : 's'} in a row</div>`;
}

function renderWords() {
  const body = qs('words-body');
  body.innerHTML = `
    <section class="apple-card words-hero">
      <p class="eyebrow">Say it • Segment it • Spell it</p>
      <h2>Tap a sound chunk to hear it slowly</h2>
      <div class="word-chips detailed">
        ${STATE.words.map(word => renderWordCard(word)).join('')}
      </div>
    </section>`;
  body.querySelectorAll('[data-say-word]').forEach(btn => btn.addEventListener('click', () => TTS.sayWord(btn.dataset.sayWord, STATE.wordData[btn.dataset.sayWord])));
  body.querySelectorAll('[data-say-chunk]').forEach(btn => btn.addEventListener('click', () => TTS.speak(btn.dataset.sayChunk, STATE.settings.speechRate, 1.08)));
}

function renderWordCard(word) {
  const data = STATE.wordData[word] || autoDetectPatterns(word);
  const chunks = data.chunks || [word];
  return `<article class="word-card">
    <button class="mini-sound" data-say-word="${escapeHtml(word)}" aria-label="Hear ${escapeHtml(word)}">🔊</button>
    <strong>${escapeHtml(word)}</strong>
    <div class="phonics-chunks">${chunks.map((chunk, index) => `<button class="phonics-chunk chunk-${(index % 4) + 1}" data-say-chunk="${escapeHtml(chunk)}">${escapeHtml(chunk)}</button>`).join('')}</div>
    <small>Pattern: ${escapeHtml(data.family || 'spelling sounds')} • Tricky bit: <b>${escapeHtml(data.trickyPart || chunks[chunks.length - 1])}</b></small>
  </article>`;
}

function practiceSourceBanner() {
  const { practiceSource, practiceWeekId } = STATE.settings;
  if (practiceSource === 'mistakes') {
    const count = STATE.activePool.words.length;
    return `<div class="practice-source-banner">⭐ Practicing ${count} word${count === 1 ? '' : 's'} she's gotten wrong, across every week</div>`;
  }
  if (practiceSource === 'week') {
    const weekId = practiceWeekId || STATE.currentWeekId;
    const entry = STATE.manifest?.weeks.find(w => w.weekId === weekId);
    return `<div class="practice-source-banner">📅 Practicing ${escapeHtml(entry?.label || 'a chosen week')}'s words</div>`;
  }
  return '';
}

function renderPractice() {
  // My Tricky Words pins itself to the top while test mistakes are marked.
  const specialGames = STATE.testMistakes.length
    ? GAME_CATALOG.filter(game => game.special).map(game => ({ ...game, desc: `${STATE.testMistakes.length} word${STATE.testMistakes.length === 1 ? '' : 's'} to beat` }))
    : [];
  const visibleGames = [...specialGames, ...GAME_CATALOG.filter(game => !game.special && STATE.settings.visibleGames.includes(game.id))];
  const body = qs('practice-body');
  const banner = practiceSourceBanner();
  const grid = visibleGames.length <= 6
    ? `<section class="game-grid two-column">${visibleGames.map(renderGameCard).join('')}</section>`
    : ['Recommended', 'More Practice', 'Challenge'].map(group => {
      const games = visibleGames.filter(game => game.group === group);
      if (!games.length) return '';
      return `<section class="game-section"><h2>${group}</h2><div class="game-grid">${games.map(renderGameCard).join('')}</div></section>`;
    }).join('');
  body.innerHTML = banner + grid;
  body.querySelectorAll('[data-activity]').forEach(btn => btn.addEventListener('click', () => startActivity(btn.dataset.activity)));
}

function renderGameCard(game) {
  return `<button class="activity-card" data-activity="${game.id}">
    <span class="ac-icon">${game.emoji}</span>
    <span class="ac-label">${game.name}</span>
    <span class="ac-desc">${game.desc}</span>
  </button>`;
}

function statsFromResults(results) {
  const stats = {};
  STATE.words.forEach(word => { stats[word] = { correct: 0, total: 0, testCorrect: 0, testTotal: 0 }; });
  results.forEach(result => {
    if (!stats[result.word]) return;
    stats[result.word].total += 1;
    if (result.correct) stats[result.word].correct += 1;
    if (result.activity === 'test-mode') {
      stats[result.word].testTotal += 1;
      if (result.correct) stats[result.word].testCorrect += 1;
    }
  });
  return stats;
}

function readinessFromStats(stats) {
  const attempted = STATE.words.filter(word => stats[word]?.total > 0);
  if (!attempted.length) return 0;
  const avg = attempted.reduce((sum, word) => sum + (stats[word].correct / stats[word].total), 0) / STATE.words.length;
  return Math.round(avg * 100);
}

function readinessLabel(score) {
  if (score >= 90) return 'Ready for Monday ✅';
  if (score >= 70) return 'Almost ready 🟡';
  return 'More practice needed 🔴';
}

async function renderParent() {
  const body = qs('parent-body');
  body.innerHTML = '<div class="loading-wrap"><div class="spinner"></div><p>Loading progress...</p></div>';
  const results = await loadResults();
  const stats = statsFromResults(results);
  const readiness = readinessFromStats(stats);
  const testResults = results.filter(r => r.activity === 'test-mode');
  const latestTest = testResults.slice(0, STATE.words.length).reverse();
  const latestScore = latestTest.length ? `${latestTest.filter(r => r.correct).length} / ${latestTest.length}` : 'No test yet';
  const trickyWords = STATE.words.filter(word => stats[word].total > 0 && (stats[word].correct / stats[word].total) < 0.7);

  body.innerHTML = `
    <section class="parent-summary">
      <div class="stat-card apple-card"><span>Monday Readiness Score</span><strong>${readiness}%</strong><em>${readinessLabel(readiness)}</em></div>
      <div class="stat-card apple-card"><span>Latest spelling test score</span><strong>${latestScore}</strong><em>${testResults.length ? 'Most recent test attempt' : 'Start a spelling test to track this'}</em></div>
      <div class="stat-card apple-card"><span>Tricky words</span><strong>${trickyWords.length ? trickyWords.map(escapeHtml).join(', ') : 'None yet 🎉'}</strong><em>Words under 70% accuracy</em>${trickyWords.length ? '<button class="btn btn-primary btn-compact" id="btn-practise-tricky">🎯 Practise these now</button>' : ''}</div>
    </section>
    <section class="apple-card">
      <h2>School test results</h2>
      <p class="mistake-intro">Tap the words that were spelled wrong in the real spelling test. They unlock the ⭐ My Tricky Words game on the Practice screen.</p>
      <div class="mistake-chips" id="mistake-chips">${STATE.words.map(word => `<button class="mistake-chip${STATE.testMistakes.includes(word) ? ' marked' : ''}" data-mistake="${escapeHtml(word)}">${escapeHtml(word)}</button>`).join('')}</div>
      <button class="btn btn-secondary btn-compact" id="btn-open-test-history">📝 Review all weeks' results</button>
    </section>
    <section class="apple-card">
      <h2>Progress summary</h2>
      <div class="progress-list">${STATE.words.map(word => {
        const s = stats[word];
        const pct = s.total ? Math.round((s.correct / s.total) * 100) : 0;
        return `<div class="progress-row"><span>${escapeHtml(word)}</span><div class="meter"><i style="width:${pct}%"></i></div><b>${s.total ? pct + '%' : '—'}</b></div>`;
      }).join('')}</div>
    </section>
    <section class="apple-card">
      <h2>Edit this week’s words</h2>
      <form id="words-form" class="word-entry-grid">${Array.from({ length: wordSlotCount() }, (_, i) => `<label class="word-entry-item"><span>Word ${i + 1}</span><input class="word-input" value="${escapeHtml(STATE.words[i] || '')}"></label>`).join('')}<button class="btn btn-primary form-wide" type="submit">Save words</button></form>
    </section>
    <section class="apple-card danger-zone">
      <h2>Reset Progress</h2>
      <p>Clears all saved practice and test results for this week. Words and settings stay the same.</p>
      <button class="btn btn-danger" id="btn-reset-progress">Reset Progress</button>
    </section>`;

  qs('words-form').addEventListener('submit', async e => {
    e.preventDefault();
    await saveWeeklyWords([...body.querySelectorAll('.word-input')].map(input => input.value));
    renderParent();
  });
  qs('btn-reset-progress').addEventListener('click', resetProgressWithConfirm);
  qs('btn-practise-tricky')?.addEventListener('click', () => startActivity('hear-write', trickyWords));
  qs('btn-open-test-history').addEventListener('click', async () => { showScreen('screen-test-history'); await renderTestHistory(); });
  // Toggle in place (no full re-render — renderParent refetches results).
  body.querySelectorAll('[data-mistake]').forEach(chip => chip.addEventListener('click', () => {
    chip.classList.toggle('marked');
    const marked = [...body.querySelectorAll('.mistake-chip.marked')].map(el => el.dataset.mistake);
    saveTestMistakes(marked);
  }));
}

async function resetProgressWithConfirm() {
  if (!window.confirm('Reset all progress for this week? This cannot be undone.')) return;
  try {
    const snap = await db.collection('families').doc(STATE.familyId).collection('weeks').doc(STATE.currentWeekId).collection('results').get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    STATE.results = [];
    showToast('Progress reset.');
    renderParent();
  } catch (e) {
    console.error('resetProgress', e);
    showToast('Could not reset progress.');
  }
}

function renderSettings() {
  const engineNotes = {
    device:     '📱 Your phone\'s or computer\'s own voice. Free, works offline, nothing to set up. On an iPhone, Settings → Accessibility → Spoken Content → Voices → English (UK) offers free Enhanced voices that sound much better than the default.',
    azure:      '✨ British neural voices from Azure, through the app\'s own server so the key stays private. Needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.',
    google:     '🌍 British neural voices from Google Cloud Text-to-Speech. Needs GOOGLE_TTS_KEY. The Speed setting applies.',
    elevenlabs: '🎙️ The most natural-sounding of the three, from ElevenLabs. Needs ELEVENLABS_API_KEY. The Speed setting does not apply to this one.',
  };

  qs('settings-body').innerHTML = `
    <section class="settings-card apple-card">
      <h2>Theme selector</h2>
      <div class="theme-grid" id="theme-grid"></div>
    </section>
    <section class="settings-card apple-card">
      <h2>Voice Engine</h2>
      <div class="segmented" id="voice-engine-options"></div>
      <p class="engine-note" id="engine-note">${engineNotes[STATE.settings.voiceEngine] || ''}</p>
    </section>
    <section class="settings-card apple-card">
      <h2>Voice</h2>
      <div class="settings-voice-row">
        <div>
          <h3>Voice</h3>
          <div class="segmented" id="voice-gender-options"></div>
        </div>
        <div>
          <h3>Speed</h3>
          <div class="segmented" id="speech-rate-options"></div>
        </div>
      </div>
      <div class="settings-voice-try"><span>Test your voice</span><button class="btn btn-secondary" id="btn-try-voice">🔊 Try voice</button></div>
    </section>
    <section class="settings-card apple-card">
      <h2>Practice Word Source</h2>
      <p class="engine-note">Choose which words the Practice games use (My Tricky Words always stays scoped to this week's test).</p>
      <div class="segmented" id="practice-source-options"></div>
      <div id="practice-week-picker" class="hidden"></div>
    </section>
    <section class="settings-card apple-card">
      <h2>Practice Games Shown</h2>
      <div class="game-toggle-grid" id="game-toggle-list"></div>
    </section>
    <section class="settings-card apple-card">
      <h2>Word History</h2>
      <p class="history-intro">Every week’s spelling list, in order across the columns.</p>
      <div class="history-grid" id="history-grid"></div>
    </section>`;

  renderWordHistory();

  const themeGrid = qs('theme-grid');
  themeGrid.innerHTML = THEMES.map(theme => `<button class="theme-card ${theme.id === STATE.settings.theme ? 'active' : ''}" data-theme="${theme.id}"><span>${theme.emoji}</span><b>${theme.name}</b></button>`).join('');
  themeGrid.querySelectorAll('[data-theme]').forEach(btn => btn.addEventListener('click', async () => { await saveSettings({ theme: btn.dataset.theme }); renderSettings(); showToast('Theme saved!'); }));

  const engineOptions = [
    { label: '📱 Device', value: 'device' },
    { label: '✨ Azure', value: 'azure' },
    { label: '🌍 Google', value: 'google' },
    { label: '🎙️ ElevenLabs', value: 'elevenlabs' },
  ];
  const onEngineChange = async value => {
    await saveSettings({ voiceEngine: value });
    const note = qs('engine-note');
    if (note) note.textContent = engineNotes[value] || '';
    showToast('Voice engine saved!');
  };
  renderSegmented('voice-engine-options', engineOptions, STATE.settings.voiceEngine, onEngineChange);
  // Then hide the cloud engines this deployment has no key for, so the list
  // only offers voices that can actually speak. The device voice and whatever
  // is currently selected always stay, and a failed check changes nothing.
  hideUnconfiguredEngines(engineOptions, onEngineChange);

  renderSegmented('voice-gender-options', [
    { label: 'Female voice', value: 'female' },
    { label: 'Male voice', value: 'male' },
  ], STATE.settings.voiceGender, value => saveSettings({ voiceGender: value }));
  renderSegmented('speech-rate-options', [
    { label: 'Slow', value: '0.75' },
    { label: 'Normal', value: '0.95' },
    { label: 'Fast', value: '1.15' },
  ], String(STATE.settings.speechRate), value => saveSettings({ speechRate: Number(value) }));

  renderSegmented('practice-source-options', [
    { label: 'This week', value: 'current' },
    { label: 'A chosen week', value: 'week' },
    { label: "Words she's got wrong", value: 'mistakes' },
  ], STATE.settings.practiceSource, async value => {
    await saveSettings({ practiceSource: value, practiceWeekId: value === 'week' ? (STATE.settings.practiceWeekId || STATE.currentWeekId) : STATE.settings.practiceWeekId });
  });

  const weekPicker = qs('practice-week-picker');
  weekPicker.classList.toggle('hidden', STATE.settings.practiceSource !== 'week');
  if (STATE.settings.practiceSource === 'week') {
    const weeks = STATE.manifest?.weeks || [];
    weekPicker.innerHTML = `<select id="practice-week-select" class="settings-select">${weeks.map(w => `<option value="${escapeHtml(w.weekId)}"${(STATE.settings.practiceWeekId || STATE.currentWeekId) === w.weekId ? ' selected' : ''}>${escapeHtml(w.label)} — ${escapeHtml(w.weekId)}</option>`).join('')}</select>`;
    qs('practice-week-select').addEventListener('change', async e => {
      await saveSettings({ practiceWeekId: e.target.value });
    });
  }

  qs('btn-try-voice').onclick = () => {
    const voiceLabel = STATE.settings.voiceGender === 'male' ? 'male' : 'female';
    TTS.speak(`Hello, I am the ${voiceLabel} voice for Spell Squad`, STATE.settings.speechRate, 1.05);
  };
  qs('game-toggle-list').innerHTML = GAME_CATALOG.filter(game => !game.special).map(game => `<button class="theme-card ${STATE.settings.visibleGames.includes(game.id) ? 'active' : ''}" data-game-toggle="${game.id}"><span>${game.emoji}</span><b>${game.name}</b></button>`).join('');
  qs('game-toggle-list').querySelectorAll('[data-game-toggle]').forEach(tile => tile.addEventListener('click', async () => {
    const visibleGames = STATE.settings.visibleGames.includes(tile.dataset.gameToggle)
      ? STATE.settings.visibleGames.filter(id => id !== tile.dataset.gameToggle)
      : [...STATE.settings.visibleGames, tile.dataset.gameToggle];
    await saveSettings({ visibleGames });
    renderSettings();
  }));
}

async function renderWordHistory() {
  const grid = qs('history-grid');
  if (!grid) return;
  const weeks = STATE.manifest?.weeks || [];
  if (!weeks.length) {
    grid.innerHTML = '<p class="history-empty">No weeks saved yet.</p>';
    return;
  }
  grid.innerHTML = '<p class="history-empty">Loading…</p>';
  const mistakesByWeek = await loadAllWeeksMistakes();
  const mistakesByWeekId = Object.fromEntries(mistakesByWeek.map(w => [w.weekId, w.mistakes]));

  // Columns flow left-to-right; CSS wraps to a new row after every 5 weeks.
  grid.innerHTML = weeks.map(week => {
    const isActive = week.weekId === STATE.currentWeekId;
    const mistakes = mistakesByWeekId[week.weekId] || [];
    const words = (week.words || []).map(w => `<li class="${mistakes.includes(w) ? 'history-word-wrong' : ''}">${escapeHtml(w)}</li>`).join('');
    return `<button class="history-week${isActive ? ' current' : ''}" data-week-id="${escapeHtml(week.weekId)}">
      <h3>${escapeHtml(week.label || week.weekId)}${isActive ? ' <span class="history-now">now</span>' : ''}</h3>
      <ol class="history-words">${words}</ol>
    </button>`;
  }).join('');

  grid.querySelectorAll('.history-week').forEach(btn => {
    btn.addEventListener('click', async () => {
      const entry = STATE.manifest.weeks.find(w => w.weekId === btn.dataset.weekId);
      if (!entry) return;
      btn.disabled = true;
      const full = await loadWeekData(entry);
      await applyWeekData(entry, full);
      setWeekLabel();
      renderHome();
      await renderWordHistory();
      showToast(`Switched to ${entry.label}!`);
      showScreen('screen-home');
    });
  });
}

async function hideUnconfiguredEngines(options, onChange) {
  try {
    const res = await fetch('/api/tts', { cache: 'no-store' });
    if (!res.ok) return;
    const providers = (await res.json()).providers || {};
    const usable = options.filter(opt =>
      opt.value === 'device'
      || opt.value === STATE.settings.voiceEngine
      || providers[opt.value] === 'configured');
    if (usable.length === options.length || !qs('voice-engine-options')) return;
    renderSegmented('voice-engine-options', usable, STATE.settings.voiceEngine, onChange);
  } catch (e) {
    console.warn('voice engine availability', e); // offline: leave every option in place
  }
}

function renderSegmented(containerId, options, current, onChange) {
  const container = qs(containerId);
  container.innerHTML = options.map(opt => `<button class="segment ${String(current) === String(opt.value) ? 'active' : ''}" data-value="${opt.value}">${opt.label}</button>`).join('');
  container.querySelectorAll('[data-value]').forEach(btn => btn.addEventListener('click', async () => { await onChange(btn.dataset.value); renderSettings(); }));
}

function showResults(activityType, resultsArr) {
  const total = resultsArr.length || 1;
  const correct = resultsArr.filter(r => r.correct).length;
  const pct = Math.round((correct / total) * 100);
  qs('results-mascot').textContent = pct === 100 ? '🏆' : '📝';
  qs('results-title').textContent = pct === 100 ? 'Perfect Score! 🎉' : pct >= 75 ? 'Great Work! 🌟' : pct >= 50 ? 'Good Try! Keep practising!' : 'Keep going — you’ll get there!';
  qs('results-score').textContent = `${correct} / ${resultsArr.length}`;
  qs('results-list').innerHTML = resultsArr.map(r => `<div class="result-row"><span>${escapeHtml(r.word)}</span><span>${r.correct ? '✅' : '❌'}</span></div>`).join('');
  // Replay the same word set (matters when the round used a custom list,
  // e.g. tricky-word practice from the Parent Area).
  qs('btn-try-again').onclick = () => startActivity(activityType, resultsArr.map(r => r.word));
  qs('btn-results-home').onclick = () => { renderHome(); showScreen('screen-home'); };
  showScreen('screen-results');
}

function wireNavigation() {
  qs('btn-signin').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err => {
      // Popups are often blocked when launched from the home screen
      // (standalone mode) — fall back to a full-page redirect.
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err.code)) {
        auth.signInWithRedirect(provider).catch(e2 => showToast('Sign-in failed: ' + e2.message));
      } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        showToast('Sign-in failed: ' + err.message);
      }
    });
  });
  document.querySelectorAll('#btn-signout, .top-signout').forEach(btn => btn.addEventListener('click', () => auth.signOut()));
  document.querySelectorAll('#btn-parent, .top-parent').forEach(btn => btn.addEventListener('click', async () => { await renderParent(); showScreen('screen-parent'); }));
  document.querySelectorAll('#btn-settings, .top-settings').forEach(btn => btn.addEventListener('click', () => { renderSettings(); showScreen('screen-settings'); }));
  qs('btn-open-words').addEventListener('click', () => { renderWords(); showScreen('screen-words'); });
  qs('btn-open-practice').addEventListener('click', async () => {
    showScreen('screen-practice');
    qs('practice-body').innerHTML = '<div class="loading-wrap"><div class="spinner"></div><p>Loading words...</p></div>';
    await refreshActivePool();
    renderPractice();
  });
  document.querySelectorAll('[data-activity]').forEach(btn => btn.addEventListener('click', () => startActivity(btn.dataset.activity)));
  qs('btn-back-from-words').addEventListener('click', () => showScreen('screen-home'));
  qs('btn-back-from-practice').addEventListener('click', () => showScreen('screen-home'));
  qs('btn-back-from-activity').addEventListener('click', () => { renderPractice(); showScreen('screen-practice'); });
  qs('btn-back-from-parent').addEventListener('click', () => showScreen('screen-home'));
  qs('btn-back-from-test-history').addEventListener('click', async () => { showScreen('screen-parent'); await renderParent(); });
  qs('btn-back-from-settings').addEventListener('click', () => showScreen('screen-home'));
}

wireNavigation();

auth.onAuthStateChanged(async user => {
  if (user) {
    const email = user.email.toLowerCase();
    if (!ALLOWED_EMAILS.includes(email)) {
      await auth.signOut();
      showToast('Sorry, you are not authorised to use this app.');
      showScreen('screen-login');
      return;
    }
    STATE.user = user;
    STATE.familyId = FAMILY_MAP[email];
    await loadSettings();
    await loadStats();
    await loadCurrentWeek();
    STATE.activePool = { words: STATE.words, wordData: STATE.wordData }; // cheap default; refreshActivePool() runs the real resolution when Practice opens
    renderHome();
    showScreen('screen-home');
  } else {
    STATE.user = null;
    STATE.familyId = null;
    STATE.results = [];
    STATE.testMistakes = [];
    STATE.activePool = { words: [], wordData: {} };
    STATE.stats = { bestStreak: 0, dayStreak: 0, lastPracticeDay: null };
    showScreen('screen-login');
  }
});
