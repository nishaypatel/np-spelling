// ── Family Groups ─────────────────────────────────────────
const FAMILY_MAP = {
  'nishaypatel@gmail.com': 'patel-family',
  'prinapatel1097@gmail.com': 'patel-family',
};
const ALLOWED_EMAILS = Object.keys(FAMILY_MAP);

const DEFAULT_VISIBLE_GAMES = [
  'hear-write',
  'look-cover-write',
  'build-sounds',
  'tap-sound',
  'tricky-bit',
  'dictation-sentence',
];

const GAME_CATALOG = [
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
  voiceGender: 'female',
  speechRate: 0.75,
  visibleGames: DEFAULT_VISIBLE_GAMES,
};

const STATE = {
  user: null,
  familyId: null,
  currentWeekId: null,
  words: [],
  wordData: {},
  settings: { ...DEFAULT_SETTINGS },
  results: [],
};

const THEMES = [
  { id: 'rainbow', name: 'Rainbow Squad', emoji: '🌈' },
  { id: 'ocean', name: 'Ocean', emoji: '🐬' },
  { id: 'jungle', name: 'Jungle', emoji: '🦜' },
  { id: 'space', name: 'Space', emoji: '🚀' },
  { id: 'football', name: 'Football', emoji: '⚽' },
];

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

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
  const visible = Array.isArray(raw.visibleGames) && raw.visibleGames.length ? raw.visibleGames : DEFAULT_VISIBLE_GAMES;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    speechRate: Number(raw.speechRate || DEFAULT_SETTINGS.speechRate),
    visibleGames: visible.filter(id => GAME_CATALOG.some(game => game.id === id)),
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

function getDefaultWeek() {
  return JSON.parse(JSON.stringify(WEEK_WORDS));
}

function enrichWordData(words, wordData = {}) {
  const enriched = {};
  words.forEach(word => {
    enriched[word] = {
      ...autoDetectPatterns(word),
      ...(wordData[word] || {}),
    };
  });
  return enriched;
}

async function loadCurrentWeek() {
  const defaults = getDefaultWeek();
  STATE.currentWeekId = defaults.weekId;
  STATE.words = [...defaults.words];
  STATE.wordData = enrichWordData(STATE.words, defaults.wordData);

  if (!STATE.familyId) return;
  try {
    const doc = await db.collection('families').doc(STATE.familyId).collection('weeks').doc(STATE.currentWeekId).get();
    if (doc.exists && Array.isArray(doc.data().words)) {
      STATE.words = doc.data().words.slice(0, 8).map(w => String(w).trim().toLowerCase()).filter(Boolean);
      STATE.wordData = enrichWordData(STATE.words, { ...defaults.wordData, ...(doc.data().wordData || {}) });
    }
  } catch (e) {
    console.warn('loadCurrentWeek', e);
  }
}

async function saveWeeklyWords(words) {
  const cleanWords = words.map(w => w.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  if (cleanWords.length !== 8) { showToast('Please enter exactly 8 words.'); return false; }
  STATE.words = cleanWords;
  STATE.wordData = enrichWordData(cleanWords, STATE.wordData);
  await db.collection('families').doc(STATE.familyId).collection('weeks').doc(STATE.currentWeekId).set({
    words: cleanWords,
    wordData: STATE.wordData,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  renderWords();
  showToast('This week’s words saved!');
  return true;
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
    <button class="mini-sound" data-say-word="${escapeHtml(word)}">🔊</button>
    <strong>${escapeHtml(word)}</strong>
    <div class="phonics-chunks">${chunks.map((chunk, index) => `<button class="phonics-chunk chunk-${(index % 4) + 1}" data-say-chunk="${escapeHtml(chunk)}">${escapeHtml(chunk)}</button>`).join('')}</div>
    <small>Pattern: ${escapeHtml(data.family || 'spelling sounds')} • Tricky bit: <b>${escapeHtml(data.trickyPart || chunks[chunks.length - 1])}</b></small>
  </article>`;
}

function renderPractice() {
  const visibleGames = GAME_CATALOG.filter(game => STATE.settings.visibleGames.includes(game.id));
  const body = qs('practice-body');
  if (visibleGames.length <= 6) {
    body.innerHTML = `<section class="game-grid two-column">${visibleGames.map(renderGameCard).join('')}</section>`;
  } else {
    body.innerHTML = ['Recommended', 'More Practice', 'Challenge'].map(group => {
      const games = visibleGames.filter(game => game.group === group);
      if (!games.length) return '';
      return `<section class="game-section"><h2>${group}</h2><div class="game-grid">${games.map(renderGameCard).join('')}</div></section>`;
    }).join('');
  }
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
      <div class="stat-card apple-card"><span>Tricky words</span><strong>${trickyWords.length ? trickyWords.join(', ') : 'None yet 🎉'}</strong><em>Words under 70% accuracy</em></div>
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
      <h2>Edit this week’s 8 words</h2>
      <form id="words-form" class="word-entry-grid">${Array.from({ length: 8 }, (_, i) => `<label class="word-entry-item"><span>Word ${i + 1}</span><input class="word-input" value="${escapeHtml(STATE.words[i] || '')}"></label>`).join('')}<button class="btn btn-primary form-wide" type="submit">Save words</button></form>
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
  const themeGrid = qs('theme-grid');
  themeGrid.innerHTML = THEMES.map(theme => `<button class="theme-card ${theme.id === STATE.settings.theme ? 'active' : ''}" data-theme="${theme.id}"><span>${theme.emoji}</span><b>${theme.name}</b></button>`).join('');
  themeGrid.querySelectorAll('[data-theme]').forEach(btn => btn.addEventListener('click', async () => { await saveSettings({ theme: btn.dataset.theme }); renderSettings(); showToast('Theme saved!'); }));

  renderSegmented('voice-gender-options', [
    { label: 'Female voice', value: 'female' },
    { label: 'Male voice', value: 'male' },
  ], STATE.settings.voiceGender, value => saveSettings({ voiceGender: value }));
  renderSegmented('speech-rate-options', [
    { label: 'Slow', value: '0.75' },
    { label: 'Normal', value: '0.95' },
    { label: 'Fast', value: '1.15' },
  ], String(STATE.settings.speechRate), value => saveSettings({ speechRate: Number(value) }));

  qs('btn-try-voice').onclick = () => {
    const voiceLabel = STATE.settings.voiceGender === 'male' ? 'male' : 'female';
    TTS.speak(`Hello, I am the ${voiceLabel} voice for Spell Squad`, STATE.settings.speechRate, 1.05);
  };
  const allToggle = qs('toggle-all-games');
  allToggle.checked = STATE.settings.visibleGames.length === GAME_CATALOG.length;
  allToggle.onchange = async () => {
    await saveSettings({ visibleGames: allToggle.checked ? GAME_CATALOG.map(g => g.id) : DEFAULT_VISIBLE_GAMES });
    renderSettings();
  };
  qs('game-toggle-list').innerHTML = GAME_CATALOG.map(game => `<label class="toggle-row"><span>${game.emoji} ${game.name}</span><input type="checkbox" data-game-toggle="${game.id}" ${STATE.settings.visibleGames.includes(game.id) ? 'checked' : ''}></label>`).join('');
  qs('game-toggle-list').querySelectorAll('[data-game-toggle]').forEach(input => input.addEventListener('change', async () => {
    const visibleGames = GAME_CATALOG.filter(game => qs('game-toggle-list').querySelector(`[data-game-toggle="${game.id}"]`).checked).map(game => game.id);
    await saveSettings({ visibleGames: visibleGames.length ? visibleGames : DEFAULT_VISIBLE_GAMES });
    renderSettings();
  }));
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
  qs('btn-try-again').onclick = () => startActivity(activityType);
  qs('btn-results-home').onclick = () => { renderHome(); showScreen('screen-home'); };
  showScreen('screen-results');
}

function wireNavigation() {
  qs('btn-signin').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err => showToast('Sign-in failed: ' + err.message));
  });
  document.querySelectorAll('#btn-signout, .top-signout').forEach(btn => btn.addEventListener('click', () => auth.signOut()));
  document.querySelectorAll('#btn-parent, .top-parent').forEach(btn => btn.addEventListener('click', async () => { await renderParent(); showScreen('screen-parent'); }));
  document.querySelectorAll('#btn-settings, .top-settings').forEach(btn => btn.addEventListener('click', () => { renderSettings(); showScreen('screen-settings'); }));
  qs('btn-open-words').addEventListener('click', () => { renderWords(); showScreen('screen-words'); });
  qs('btn-open-practice').addEventListener('click', () => { renderPractice(); showScreen('screen-practice'); });
  document.querySelectorAll('[data-activity]').forEach(btn => btn.addEventListener('click', () => startActivity(btn.dataset.activity)));
  qs('btn-back-from-words').addEventListener('click', () => showScreen('screen-home'));
  qs('btn-back-from-practice').addEventListener('click', () => showScreen('screen-home'));
  qs('btn-back-from-activity').addEventListener('click', () => { renderPractice(); showScreen('screen-practice'); });
  qs('btn-back-from-parent').addEventListener('click', () => showScreen('screen-home'));
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
    await loadCurrentWeek();
    renderHome();
    showScreen('screen-home');
  } else {
    STATE.user = null;
    STATE.familyId = null;
    STATE.results = [];
    showScreen('screen-login');
  }
});
