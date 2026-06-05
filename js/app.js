// ── Family Groups ─────────────────────────────────────────
const FAMILY_MAP = {
  'nishaypatel@gmail.com':   'patel-family',
  'prinapatel1097@gmail.com': 'patel-family',
};

const ALLOWED_EMAILS = Object.keys(FAMILY_MAP);

// ── App State ─────────────────────────────────────────────
const STATE = {
  user: null,
  familyId: null,
  currentWeekId: null,
  words: [],
  wordData: {},
  theme: 'lionking',
  results: [],
};

const THEMES = [
  { id: 'lionking',   name: 'Lion King',           emoji: '🦁' },
  { id: 'kpop',       name: 'K-Pop Demon Hunters',  emoji: '⚔️' },
  { id: 'airplanes',  name: 'Airplanes',            emoji: '✈️' },
  { id: 'cars',       name: 'Cars',                 emoji: '🏎️' },
  { id: 'dinosaurs',  name: 'Dinosaurs',            emoji: '🦕' },
  { id: 'space',      name: 'Space',                emoji: '🚀' },
  { id: 'football',   name: 'Football',             emoji: '⚽' },
];

// ── Firebase Init ──────────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();

// ── Week ID ───────────────────────────────────────────────
function getWeekId() {
  const now  = new Date();
  const day  = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const mon  = new Date(now.setDate(diff));
  return mon.toISOString().slice(0, 10);
}

// ── Screen Router ─────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('hidden');
    el.classList.add('active');
  }
}

// ── Theme ─────────────────────────────────────────────────
function applyTheme(themeId) {
  STATE.theme = themeId;
  const body = document.body;
  THEMES.forEach(t => body.classList.remove('theme-' + t.id));
  body.classList.add('theme-' + themeId);
  const t = THEMES.find(x => x.id === themeId);
  if (t) {
    document.querySelectorAll('.login-mascot, .header-mascot, .results-mascot')
      .forEach(el => el.textContent = t.emoji);
  }
}

async function saveTheme(themeId) {
  applyTheme(themeId);
  if (STATE.familyId) {
    await db.collection('families').doc(STATE.familyId)
      .collection('settings').doc('prefs')
      .set({ theme: themeId }, { merge: true });
  }
}

async function loadTheme() {
  if (!STATE.familyId) return;
  try {
    const doc = await db.collection('families').doc(STATE.familyId)
      .collection('settings').doc('prefs').get();
    if (doc.exists && doc.data().theme) {
      applyTheme(doc.data().theme);
    }
  } catch (e) {}
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

// ── Auth ──────────────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  if (user) {
    const email = user.email.toLowerCase();
    if (!ALLOWED_EMAILS.includes(email)) {
      await auth.signOut();
      showToast('Sorry, you are not authorised to use this app.');
      showScreen('screen-login');
      return;
    }
    STATE.user     = user;
    STATE.familyId = FAMILY_MAP[email];
    await loadTheme();
    await loadCurrentWeek();
    renderHome();
    showScreen('screen-home');
  } else {
    STATE.user     = null;
    STATE.familyId = null;
    showScreen('screen-login');
  }
});

document.getElementById('btn-signin').addEventListener('click', () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => showToast('Sign-in failed: ' + err.message));
});

document.getElementById('btn-signout').addEventListener('click', () => {
  auth.signOut();
});

// ── Load / Save Words ─────────────────────────────────────
async function loadCurrentWeek() {
  const weekId = getWeekId();
  STATE.currentWeekId = weekId;
  try {
    const doc = await db.collection('families').doc(STATE.familyId)
      .collection('weeks').doc(weekId).get();
    if (doc.exists) {
      STATE.words    = doc.data().words    || [];
      STATE.wordData = doc.data().wordData || {};
    } else {
      STATE.words    = [];
      STATE.wordData = {};
    }
  } catch (e) {
    console.error('loadCurrentWeek', e);
  }
}

async function saveWords(words, wordData) {
  STATE.words    = words;
  STATE.wordData = wordData;
  await db.collection('families').doc(STATE.familyId)
    .collection('weeks').doc(STATE.currentWeekId)
    .set({ words, wordData, created: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

// ── Save Result ───────────────────────────────────────────
async function saveResult(word, activity, correct) {
  const result = { word, activity, correct, timestamp: Date.now() };
  STATE.results.push(result);
  try {
    await db.collection('families').doc(STATE.familyId)
      .collection('weeks').doc(STATE.currentWeekId)
      .collection('results').add({
        ...result,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
  } catch (e) { console.error('saveResult', e); }
}

// ── Home Screen ───────────────────────────────────────────
function renderHome() {
  const noWords   = document.getElementById('no-words-notice');
  const grid      = document.getElementById('activity-grid');
  const chips     = document.getElementById('word-chips');
  const weekLabel = document.getElementById('header-week-label');

  const weekDate = new Date(STATE.currentWeekId + 'T00:00:00');
  const opts = { day: 'numeric', month: 'long' };
  weekLabel.textContent = 'Week of ' + weekDate.toLocaleDateString('en-GB', opts);

  chips.innerHTML = '';
  if (STATE.words.length > 0) {
    noWords.classList.add('hidden');
    grid.classList.remove('hidden');
    STATE.words.forEach(w => {
      const chip = document.createElement('div');
      chip.className = 'word-chip fade-in';
      chip.textContent = w;
      chips.appendChild(chip);
    });
  } else {
    noWords.classList.remove('hidden');
    grid.classList.add('hidden');
  }

  const t = THEMES.find(x => x.id === STATE.theme);
  if (t) {
    const hm = document.getElementById('home-mascot');
    if (hm) hm.textContent = t.emoji;
  }
}

// ── Word Entry Screen ─────────────────────────────────────
function renderWordEntry() {
  const grid = document.getElementById('word-entry-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const item = document.createElement('div');
    item.className = 'word-entry-item';
    item.innerHTML = `
      <label class="word-entry-label">Word ${i + 1}</label>
      <input class="word-input" type="text" inputmode="text"
             autocorrect="off" autocapitalize="off" spellcheck="false"
             placeholder="word ${i + 1}"
             value="${(STATE.words[i] || '')}">
    `;
    grid.appendChild(item);
  }
  document.getElementById('entry-status').classList.add('hidden');
}

document.getElementById('btn-enter-words').addEventListener('click', () => {
  renderWordEntry();
  showScreen('screen-word-entry');
});

document.getElementById('btn-goto-enter').addEventListener('click', () => {
  renderWordEntry();
  showScreen('screen-word-entry');
});

document.getElementById('btn-back-from-entry').addEventListener('click', () => {
  renderHome();
  showScreen('screen-home');
});

document.getElementById('btn-save-words').addEventListener('click', async () => {
  const inputs = document.querySelectorAll('.word-input');
  const words  = Array.from(inputs)
    .map(i => i.value.trim().toLowerCase())
    .filter(w => w.length > 0);

  if (words.length < 4) {
    showToast('Please enter at least 4 words');
    return;
  }

  const btn    = document.getElementById('btn-save-words');
  const status = document.getElementById('entry-status');
  btn.disabled = true;
  btn.textContent = 'Generating... ✨';
  status.textContent = '🤖 Claude is creating phonics breakdowns and activities...';
  status.classList.remove('hidden');

  try {
    const wordData = await generateWordData(words);
    await saveWords(words, wordData);
    renderHome();
    showScreen('screen-home');
    showToast('Words saved! Ready to practise 🎉');
  } catch (e) {
    console.error(e);
    const basicData = {};
    words.forEach(w => {
      basicData[w] = {
        chunks: [w],
        sentence: `Can you spell ${w}?`,
        trickyPart: '',
        wrongVersions: [w.slice(0,-1) + 'x', w[0] + w.slice(2)]
      };
    });
    await saveWords(words, basicData);
    renderHome();
    showScreen('screen-home');
    showToast('Words saved (basic mode — check API key)');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Generate ✨';
  }
});

// ── Generate Word Data ────────────────────────────────────
async function generateWordData(words) {
  const res = await fetch('/api/generate-word-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words })
  });
  if (!res.ok) throw new Error('API error ' + res.status);
  return await res.json();
}

// ── Activity Routing ──────────────────────────────────────
document.querySelectorAll('[data-activity]').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.getAttribute('data-activity');
    startActivity(type);
  });
});

document.getElementById('btn-back-from-activity').addEventListener('click', () => {
  renderHome();
  showScreen('screen-home');
});

// ── Dashboard ─────────────────────────────────────────────
document.getElementById('btn-dashboard').addEventListener('click', async () => {
  await renderDashboard();
  showScreen('screen-dashboard');
});

document.getElementById('btn-back-from-dashboard').addEventListener('click', () => {
  showScreen('screen-home');
});

async function renderDashboard() {
  const body = document.getElementById('dashboard-body');
  body.innerHTML = '<div class="loading-wrap"><div class="spinner"></div><p class="loading-text">Loading progress...</p></div>';

  try {
    const snap = await db.collection('families').doc(STATE.familyId)
      .collection('weeks').doc(STATE.currentWeekId)
      .collection('results').orderBy('timestamp', 'desc').get();

    const allResults = snap.docs.map(d => d.data());

    if (allResults.length === 0 || STATE.words.length === 0) {
      body.innerHTML = '<p class="dash-empty">No results yet — start practising! 🌟</p>';
      return;
    }

    const stats = {};
    STATE.words.forEach(w => { stats[w] = { correct: 0, total: 0 }; });
    allResults.forEach(r => {
      if (stats[r.word]) {
        stats[r.word].total++;
        if (r.correct) stats[r.word].correct++;
      }
    });

    let html = `<p class="dash-week-title">This week's progress</p>
    <table class="dash-table">
      <thead>
        <tr>
          <th>Word</th>
          <th>Accuracy</th>
          <th>Attempts</th>
          <th>Level</th>
        </tr>
      </thead>
      <tbody>`;

    STATE.words.forEach(w => {
      const s = stats[w];
      const pct = s.total === 0 ? '—' : Math.round((s.correct / s.total) * 100) + '%';
      const pctNum = s.total === 0 ? -1 : (s.correct / s.total) * 100;
      const accClass = pctNum < 0 ? '' : pctNum >= 80 ? 'accuracy-high' : pctNum >= 50 ? 'accuracy-mid' : 'accuracy-low';
      const diff = pctNum < 0 ? '' : pctNum >= 80 ? '<span class="dash-difficulty diff-easy">Easy</span>' : pctNum >= 50 ? '<span class="dash-difficulty diff-medium">Getting there</span>' : '<span class="dash-difficulty diff-hard">Needs work</span>';
      html += `<tr>
        <td><span class="dash-word">${w}</span></td>
        <td><span class="dash-accuracy ${accClass}">${pct}</span></td>
        <td>${s.total}</td>
        <td>${diff}</td>
      </tr>`;
    });

    html += '</tbody></table>';
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<p class="dash-empty">Could not load results.</p>';
    console.error(e);
  }
}

// ── Settings ──────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', () => {
  renderSettings();
  showScreen('screen-settings');
});

document.getElementById('btn-back-from-settings').addEventListener('click', () => {
  showScreen('screen-home');
});

function renderSettings() {
  const grid = document.getElementById('theme-grid');
  grid.innerHTML = '';
  THEMES.forEach(t => {
    const card = document.createElement('div');
    card.className = 'theme-card' + (t.id === STATE.theme ? ' active' : '');
    card.innerHTML = `<span class="theme-emoji">${t.emoji}</span><span class="theme-name">${t.name}</span>`;
    card.addEventListener('click', async () => {
      await saveTheme(t.id);
      document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      showToast(t.name + ' theme applied!');
    });
    grid.appendChild(card);
  });
}

// ── Results Screen ────────────────────────────────────────
function showResults(activityType, resultsArr) {
  const total   = resultsArr.length;
  const correct = resultsArr.filter(r => r.correct).length;
  const pct     = Math.round((correct / total) * 100);

  const t = THEMES.find(x => x.id === STATE.theme);
  document.getElementById('results-mascot').textContent = pct === 100 ? (t?.emoji || '🌟') : '📝';

  let title = 'Test Complete!';
  if (pct === 100) title = 'Perfect Score! 🎉';
  else if (pct >= 75) title = 'Great Work! 🌟';
  else if (pct >= 50) title = 'Good Try! Keep practising!';
  else title = 'Keep going — you\'ll get there!';

  document.getElementById('results-title').textContent = title;
  document.getElementById('results-score').textContent = `${correct} / ${total}`;

  const list = document.getElementById('results-list');
  list.innerHTML = '';
  resultsArr.forEach(r => {
    const row = document.createElement('div');
    row.className = 'result-row';
    row.innerHTML = `<span class="result-word">${r.word}</span><span class="result-badge">${r.correct ? '✅' : '❌'}</span>`;
    list.appendChild(row);
  });

  document.getElementById('btn-try-again').onclick = () => startActivity(activityType);
  document.getElementById('btn-results-home').onclick = () => { renderHome(); showScreen('screen-home'); };

  showScreen('screen-results');
}
