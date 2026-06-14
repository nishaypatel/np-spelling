// ── Text-to-Speech ─────────────────────────────────────────

// ── Device voice helpers (Web Speech API) ──────────────────
const FEMALE_VOICE_NAMES = ['Samantha','Serena','Karen','Moira','Tessa','Kate','Susan','Victoria','Zoe','Ava','Allison','Fiona','Veena','Martha','Hazel'];
const MALE_VOICE_NAMES   = ['Daniel','Alex','Oliver','Arthur','Fred','Tom','Rishi','George','Thomas'];

function voiceNameIncludes(voice, names) { return names.some(n => String(voice?.name||'').toLowerCase().includes(n.toLowerCase())); }
function isEnglishVoice(v)       { return String(v?.lang||'').toLowerCase().startsWith('en'); }
function isBritishEnglishVoice(v){ return String(v?.lang||'').toLowerCase() === 'en-gb'; }
function isClearlyFemaleVoice(v) { return voiceNameIncludes(v, FEMALE_VOICE_NAMES) && !voiceNameIncludes(v, MALE_VOICE_NAMES); }
function isClearlyMaleVoice(v)   { return voiceNameIncludes(v, MALE_VOICE_NAMES)   && !voiceNameIncludes(v, FEMALE_VOICE_NAMES); }
function chooseVoice(voices, gender) {
  const en = voices.filter(isEnglishVoice);
  const gendered = en.filter(gender === 'male' ? isClearlyMaleVoice : isClearlyFemaleVoice);
  return gendered.find(isBritishEnglishVoice) || gendered[0] || en.find(isBritishEnglishVoice) || en[0] || null;
}

// Pre-cache voices so _deviceSpeak() stays synchronous (iOS gesture requirement)
let _voiceCache = [];
function _refreshVoiceCache() { const v = window.speechSynthesis.getVoices(); if (v.length) _voiceCache = v; }
if ('speechSynthesis' in window) { _refreshVoiceCache(); window.speechSynthesis.addEventListener('voiceschanged', _refreshVoiceCache); }

function _deviceSpeak(text, rate = 0.75, pitch = 1.05) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'en-GB'; utt.rate = rate; utt.pitch = pitch;
    utt.onend = resolve; utt.onerror = resolve;
    const preferred = chooseVoice(_voiceCache, STATE?.settings?.voiceGender === 'male' ? 'male' : 'female');
    if (preferred) utt.voice = preferred;
    window.speechSynthesis.speak(utt);
  });
}

// ── Azure TTS ───────────────────────────────────────────────
let _audioCtx = null;
function _getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

let _azureSource = null;

// Calls our own /api/tts serverless proxy, which holds the Azure key
// server-side (as a Vercel env var) — the key is never sent to the browser.
async function _azureSpeak(text, rate = 0.75) {
  const ctx = _getAudioCtx(); // unlock AudioContext synchronously before the async fetch
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      rate,
      gender: STATE?.settings?.voiceGender === 'male' ? 'male' : 'female',
    }),
  });
  if (!res.ok) throw new Error(`TTS proxy ${res.status}`);
  const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
  return new Promise(resolve => {
    if (_azureSource) { try { _azureSource.stop(); } catch (e) {} }
    const src = ctx.createBufferSource();
    src.buffer = decoded; src.connect(ctx.destination);
    src.onended = resolve; _azureSource = src; src.start();
  });
}

// ── TTS dispatcher ──────────────────────────────────────────
const TTS = {
  async speak(text, rate = STATE?.settings?.speechRate || 0.75, pitch = 1.05) {
    const engine = STATE?.settings?.voiceEngine || 'azure';
    if (engine === 'azure') {
      try { return await _azureSpeak(text, rate); }
      catch (e) {
        console.warn('Azure TTS:', e.message);
        if (typeof showToast === 'function') showToast('⚠️ Azure voice error: ' + e.message, 4000);
        return _deviceSpeak(text, rate, pitch);
      }
    }
    return _deviceSpeak(text, rate, pitch);
  },
  async sayWord(word, wordData = {}) {
    await TTS.speak(word, STATE.settings.speechRate, 1.08);
    await wait(260);
    await TTS.speak(pickSentence(word, wordData), Math.min(STATE.settings.speechRate + 0.08, 1.2), 1.0);
  },
  async saySlowly(word) {
    const chunks = (STATE.wordData[word]?.chunks || [word]).join(' ... ');
    await TTS.speak(chunks, Math.max(0.55, STATE.settings.speechRate - 0.12), 1.0);
  },
  cancel() {
    if (_azureSource) { try { _azureSource.stop(); } catch (e) {} _azureSource = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  },
};
window.TTS = TTS;

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function detectWordPatterns(word) {
  const knownDigraphs = ['igh', 'air', 'ear', 'ure', 'sh', 'ch', 'th', 'ck', 'ng', 'ai', 'ee', 'oa', 'oo', 'ar', 'or', 'er', 'ir', 'ur', 'ow', 'oi', 'oy'];
  const chunks = [];
  let i = 0;
  while (i < word.length) {
    const tri = word.slice(i, i + 3);
    const duo = word.slice(i, i + 2);
    if (knownDigraphs.includes(tri)) { chunks.push(tri); i += 3; }
    else if (knownDigraphs.includes(duo)) { chunks.push(duo); i += 2; }
    else if (word.startsWith('un') && i === 0) { chunks.push('un'); i += 2; }
    else { chunks.push(word[i]); i += 1; }
  }
  const family = word.startsWith('un') ? 'un- prefix family' : knownDigraphs.find(pattern => word.includes(pattern)) ? `${knownDigraphs.find(pattern => word.includes(pattern))} sound family` : 'single sound spelling';
  const trickyPart = word.startsWith('un') ? 'un' : chunks.find(chunk => chunk.length > 1) || word.slice(-1);
  return {
    chunks,
    family,
    trickyPart,
    phonicsMap: chunks.map(chunk => ({ sound: chunk, spelling: chunk })),
    sentence: `Can you use ${word} in a sentence?`,
    wrongVersions: [makeSimpleMistake(word, []), makeSimpleMistake(word, [makeSimpleMistake(word, [])])],
  };
}

function startActivity(type) {
  if (!STATE.words.length) { showToast('No words loaded yet!'); return; }
  TTS.cancel();
  const game = GAME_CATALOG.find(item => item.id === type) || GAME_CATALOG[0];
  document.getElementById('activity-title').textContent = `${game.emoji} ${game.name}`;
  const orderedWords = ['test-mode', 'boss-round'].includes(type) ? [...STATE.words] : shuffle([...STATE.words]);
  const runners = {
    'hear-write': runWriteActivity,
    'look-cover-write': runLookCoverWrite,
    'build-sounds': runBuildSounds,
    'tap-sound': runTapSound,
    'tricky-bit': runTrickyBit,
    'dictation-sentence': runDictationSentence,
    'missing-letters': runMissingLetters,
    'sound-match': runTapSound,
    'unscramble': runUnscramble,
    'memory-match': runMemoryMatch,
    'odd-one-out': runOddOneOut,
    'speed-spell': runSpeedSpell,
    'boss-round': runBossRound,
    'test-mode': runTestMode,
  };
  (runners[type] || runWriteActivity)(orderedWords, type);
  showScreen('screen-activity');
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function updateProgress(current, total) { document.getElementById('progress-pill').textContent = `${current} / ${total}`; }
function getData(word) { return STATE.wordData[word] || detectWordPatterns(word); }
function pickSentence(word, wordData = {}) {
  const sentences = Array.isArray(wordData.sentences) ? wordData.sentences.filter(Boolean) : [];
  const choices = sentences.length ? sentences : [wordData.sentence || `Can you spell ${word}?`];
  if (choices.length <= 1) return choices[0];

  if (!pickSentence.lastByWord) pickSentence.lastByWord = {};
  const lastSentence = pickSentence.lastByWord[word];
  const nextChoices = choices.filter(sentence => sentence !== lastSentence);
  const picked = nextChoices[Math.floor(Math.random() * nextChoices.length)];
  pickSentence.lastByWord[word] = picked;
  return picked;
}

function inputControlsHtml(clearId) {
  return `<div class="answer-actions"><button class="btn btn-soft" id="${clearId}" type="button">Clear input</button></div>`;
}

// On-screen keyboard so kids can tap letters without the device keyboard.
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function keyboardHtml() {
  const rows = KEYBOARD_ROWS.map(row =>
    `<div class="kb-row">${[...row].map(ch => `<button type="button" class="kb-key" data-key="${ch}">${ch}</button>`).join('')}</div>`
  ).join('');
  return `<div class="onscreen-keyboard" id="onscreen-keyboard">${rows}
    <div class="kb-row">
      <button type="button" class="kb-key kb-space" data-key=" ">space</button>
      <button type="button" class="kb-key kb-back" data-action="backspace">⌫</button>
    </div>
  </div>`;
}
function wireKeyboard(container, getInput) {
  if (!container) return;
  container.querySelectorAll('.kb-key').forEach(key => key.addEventListener('click', () => {
    const input = typeof getInput === 'function' ? getInput() : getInput;
    if (!input) return;
    if (key.dataset.action === 'backspace') input.value = input.value.slice(0, -1);
    else input.value += key.dataset.key;
    input.focus();
    input.dispatchEvent(new Event('input'));
  }));
}

function phonicsHtml(word, revealed = true) {
  const chunks = getData(word).chunks || [word];
  return `<div class="phonics-chunks ${revealed ? '' : 'muted'}">${chunks.map((chunk, index) => `<span class="phonics-chunk chunk-${(index % 4) + 1}">${escapeHtml(chunk)}</span>`).join('')}</div>`;
}
function soundMapHtml(word) {
  return `<div class="sound-map">${(getData(word).phonicsMap || []).map(pair => `<span><b>${escapeHtml(pair.sound)}</b> → ${escapeHtml(pair.spelling)}</span>`).join('')}</div>`;
}

function renderInputRound({ words, activity, intro, placeholder = 'write the word here', sentenceMode = false, preReveal = '', noPeek = false }) {
  let idx = 0;
  const results = [];
  function render() {
    if (idx >= words.length) { results.forEach(r => saveResult(r.word, activity, r.correct)); showResults(activity, results); return; }
    const word = words[idx];
    const data = getData(word);
    updateProgress(idx + 1, words.length);
    const body = document.getElementById('activity-body');
    body.innerHTML = `
      <section class="activity-card-large apple-card">
        <p class="eyebrow">${intro}</p>
        ${preReveal ? preReveal.replaceAll('{{word}}', escapeHtml(word)) : ''}
        <button class="hw-play-btn" id="play-word">🔊</button>
        <div class="hw-input-wrap">
          <input class="hw-answer-input" id="answer-input" inputmode="none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${placeholder}">
          ${inputControlsHtml('clear-answer')}
          ${keyboardHtml()}
          <div class="hw-feedback" id="feedback"></div>
          <button class="btn btn-primary" id="submit-answer">Check ✓</button>
        </div>
      </section>`;
    const sentence = pickSentence(word, data);
    const target = sentenceMode ? sentence : word;
    setTimeout(() => sentenceMode ? TTS.speak(sentence, STATE.settings.speechRate, 1.0) : TTS.sayWord(word, data), 250);
    document.getElementById('play-word').onclick = () => sentenceMode ? TTS.speak(sentence, STATE.settings.speechRate, 1.0) : TTS.sayWord(word, data);
    const lookWord = document.getElementById('look-word');
    const coverWord = document.getElementById('cover-word');
    if (lookWord && coverWord) {
      const originalWord = lookWord.textContent;
      coverWord.onclick = () => { lookWord.textContent = '■'.repeat(originalWord.length); };
    }
    const input = document.getElementById('answer-input');
    document.getElementById('clear-answer').onclick = () => { input.value = ''; input.focus(); };
    wireKeyboard(document.getElementById('onscreen-keyboard'), input);
    input.focus();
    // Sentence dictation ignores punctuation/caps since the on-screen
    // keyboard only has letters and a space bar.
    const normalize = s => String(s).trim().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    const check = () => {
      const correct = sentenceMode
        ? normalize(input.value) === normalize(target)
        : input.value.trim().toLowerCase() === target.toLowerCase();
      finishRound(body, document.getElementById('feedback'), correct, word, () => { idx++; render(); });
      results.push({ word, correct });
    };
    document.getElementById('submit-answer').onclick = check;
    input.onkeydown = e => { if (e.key === 'Enter') check(); };
  }
  render();
}

function runWriteActivity(words, activity = 'hear-write') {
  renderInputRound({ words, activity, intro: 'Listen, segment, then write the word' });
}

function runLookCoverWrite(words, activity = 'look-cover-write') {
  renderInputRound({
    words,
    activity,
    intro: 'Look, cover, write, check',
    preReveal: '<div class="look-cover-word" id="look-word">{{word}}</div><button class="btn btn-soft" id="cover-word">🙈 Cover word</button>',
  });
}

function runDictationSentence(words, activity = 'dictation-sentence') {
  renderInputRound({ words, activity, intro: 'Listen to the sentence and write it', placeholder: 'write the full sentence here', sentenceMode: true });
}

function runTestMode(words) {
  renderInputRound({ words, activity: 'test-mode', intro: 'Spelling Test — just like school', noPeek: true });
}

function runBuildSounds(words, activity = 'build-sounds') {
  let idx = 0;
  const results = [];
  function render() {
    if (idx >= words.length) { results.forEach(r => saveResult(r.word, activity, r.correct)); showResults(activity, results); return; }
    const word = words[idx];
    const chunks = getData(word).chunks || [word];
    const body = document.getElementById('activity-body');
    updateProgress(idx + 1, words.length);
    body.innerHTML = `
      <section class="activity-card-large apple-card">
        <p class="eyebrow">Build the sounds in order</p>
        <button class="hw-play-btn" id="play-word">🔊</button>
        <div class="build-target" id="build-target"></div>
        <button class="btn btn-secondary" id="reset-build">Reset ↺</button>
        <div class="chunk-bank">${shuffle([...chunks]).map(chunk => `<button class="phonics-chunk chunk-choice" data-chunk="${escapeHtml(chunk)}">${escapeHtml(chunk)}</button>`).join('')}</div>
        <div class="hw-feedback" id="feedback"></div>
        <button class="btn btn-primary" id="check-build">Check ✓</button>
      </section>`;
    setTimeout(() => TTS.sayWord(word, getData(word)), 250);
    document.getElementById('play-word').onclick = () => TTS.sayWord(word, getData(word));
    const picked = [];
    const buildTarget = document.getElementById('build-target');
    body.querySelectorAll('.chunk-choice').forEach(btn => btn.onclick = () => { picked.push(btn.dataset.chunk); btn.disabled = true; buildTarget.innerHTML = picked.map(c => `<span>${escapeHtml(c)}</span>`).join(''); });
    document.getElementById('reset-build').onclick = () => {
      picked.length = 0;
      buildTarget.innerHTML = '';
      body.querySelectorAll('.chunk-choice').forEach(btn => { btn.disabled = false; });
    };
    document.getElementById('check-build').onclick = () => {
      const correct = picked.join('') === word;
      results.push({ word, correct });
      finishRound(body, document.getElementById('feedback'), correct, word, () => { idx++; render(); });
    };
  }
  render();
}

function runTapSound(words, activity = 'tap-sound') {
  let idx = 0;
  const results = [];
  function render() {
    if (idx >= words.length) { results.forEach(r => saveResult(r.word, activity, r.correct)); showResults(activity, results); return; }
    const word = words[idx];
    const chunks = getData(word).chunks || [word];
    const target = chunks.find(c => c.length > 1) || chunks[Math.floor(Math.random() * chunks.length)];
    updateProgress(idx + 1, words.length);
    const body = document.getElementById('activity-body');
    body.innerHTML = `
      <section class="activity-card-large apple-card">
        <p class="eyebrow">Tap the spelling for this sound</p>
        <h2 class="target-sound">🔊 ${escapeHtml(target)}</h2>
        <button class="btn btn-soft" id="play-target">Hear sound</button>
        <div class="tap-word">${chunks.map((chunk, index) => `<button class="phonics-chunk chunk-${(index % 4) + 1}" data-chunk="${escapeHtml(chunk)}">${escapeHtml(chunk)}</button>`).join('')}</div>
        <div class="hw-feedback" id="feedback"></div>
      </section>`;
    document.getElementById('play-target').onclick = () => TTS.speak(target, STATE.settings.speechRate, 1.0);
    body.querySelectorAll('[data-chunk]').forEach(btn => btn.onclick = () => {
      const correct = btn.dataset.chunk === target;
      results.push({ word, correct });
      finishRound(body, document.getElementById('feedback'), correct, word, () => { idx++; render(); });
    });
  }
  render();
}

function runTrickyBit(words, activity = 'tricky-bit') {
  let idx = 0;
  const results = [];
  function render() {
    if (idx >= words.length) { results.forEach(r => saveResult(r.word, activity, r.correct)); showResults(activity, results); return; }
    const word = words[idx];
    const data = getData(word);
    updateProgress(idx + 1, words.length);
    const wrongs = shuffle([...new Set([...(data.wrongVersions || []), makeSimpleMistake(word, [])])]).slice(0, 2);
    const options = shuffle([word, ...wrongs]);
    const body = document.getElementById('activity-body');
    body.innerHTML = `
      <section class="activity-card-large apple-card">
        <p class="eyebrow">Find the word with the correct tricky bit</p>
        <div class="red-word">🔴 Tricky bit: ${escapeHtml(data.trickyPart || '')}</div>
        <button class="hw-play-btn" id="play-word">🔊</button>
        <div class="fix-options">${options.map(option => `<button class="fix-option" data-word="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join('')}</div>
        <div class="hw-feedback" id="feedback"></div>
      </section>`;
    setTimeout(() => TTS.speak(word, STATE.settings.speechRate, 1.0), 250);
    document.getElementById('play-word').onclick = () => TTS.speak(word, STATE.settings.speechRate, 1.0);
    body.querySelectorAll('.fix-option').forEach(btn => btn.onclick = () => {
      const correct = btn.dataset.word === word;
      results.push({ word, correct });
      finishRound(body, document.getElementById('feedback'), correct, word, () => { idx++; render(); });
    });
  }
  render();
}

function runMissingLetters(words, activity = 'missing-letters') {
  let idx = 0;
  const results = [];
  function render() {
    if (idx >= words.length) { results.forEach(r => saveResult(r.word, activity, r.correct)); showResults(activity, results); return; }
    const word = words[idx];
    const positions = pickMissingPositions(word, word.length > 7 ? 2 : 1);
    updateProgress(idx + 1, words.length);
    const body = document.getElementById('activity-body');
    const letters = [...word].map((letter, i) => positions.includes(i) ? `<input class="ml-blank" inputmode="none" data-pos="${i}" maxlength="1">` : `<span>${letter}</span>`).join('');
    body.innerHTML = `<section class="activity-card-large apple-card"><p class="eyebrow">Fill in the missing spelling</p><button class="hw-play-btn" id="play-word">🔊</button><div class="ml-word-display">${letters}</div>${inputControlsHtml('clear-missing')}${keyboardHtml()}<div class="hw-feedback" id="feedback"></div><button class="btn btn-primary" id="check-missing">Check ✓</button></section>`;
    setTimeout(() => TTS.speak(word, STATE.settings.speechRate, 1.0), 250);
    document.getElementById('play-word').onclick = () => TTS.speak(word, STATE.settings.speechRate, 1.0);
    const blanks = [...body.querySelectorAll('.ml-blank')];
    let activeBlank = blanks[0] || null;
    blanks.forEach(b => b.addEventListener('focus', () => { activeBlank = b; }));
    document.getElementById('clear-missing').onclick = () => {
      blanks.forEach(input => { input.value = ''; });
      activeBlank = blanks[0] || null;
      activeBlank?.focus();
    };
    // On-screen keyboard fills the active blank, then advances to the next empty one.
    wireKeyboard(document.getElementById('onscreen-keyboard'), () => activeBlank);
    activeBlank?.focus();
    blanks.forEach(input => {
      input.onkeydown = e => { if (e.key === 'Enter') document.getElementById('check-missing').click(); };
      input.addEventListener('input', () => { const next = blanks.find(b => !b.value); activeBlank = next || input; next?.focus(); });
    });
    document.getElementById('check-missing').onclick = () => {
      const correct = [...body.querySelectorAll('.ml-blank')].every(input => input.value.trim().toLowerCase() === word[Number(input.dataset.pos)]);
      results.push({ word, correct });
      finishRound(body, document.getElementById('feedback'), correct, word, () => { idx++; render(); });
    };
  }
  render();
}

function runUnscramble(words, activity = 'unscramble') {
  let idx = 0;
  const results = [];
  function render() {
    if (idx >= words.length) { results.forEach(r => saveResult(r.word, activity, r.correct)); showResults(activity, results); return; }
    const word = words[idx];
    updateProgress(idx + 1, words.length);
    const body = document.getElementById('activity-body');
    const scrambled = shuffle([...word]);
    body.innerHTML = `<section class="activity-card-large apple-card">
      <p class="eyebrow">Tap the letters in order to build the word</p>
      <div class="unscramble-answer" id="unscramble-answer"></div>
      <div class="letter-bank" id="letter-bank">${scrambled.map((ch, i) => `<button type="button" class="letter-block" data-i="${i}">${escapeHtml(ch)}</button>`).join('')}</div>
      <div class="answer-actions">
        <button class="btn btn-soft" id="undo-letter" type="button">⌫ Undo</button>
        <button class="btn btn-soft" id="clear-unscramble" type="button">Clear</button>
      </div>
      <div class="hw-feedback" id="feedback"></div>
      <button class="btn btn-primary" id="check">Check ✓</button>
    </section>`;
    const answerEl = document.getElementById('unscramble-answer');
    const bank = document.getElementById('letter-bank');
    const picked = []; // { letter, btn }
    const refresh = () => {
      answerEl.innerHTML = picked.length
        ? picked.map(p => `<span class="answer-tile">${escapeHtml(p.letter)}</span>`).join('')
        : '<span class="answer-placeholder">Tap letters below…</span>';
    };
    bank.querySelectorAll('.letter-block').forEach(btn => btn.onclick = () => {
      if (btn.disabled) return;
      picked.push({ letter: btn.textContent, btn });
      btn.disabled = true;
      refresh();
    });
    document.getElementById('undo-letter').onclick = () => {
      const last = picked.pop();
      if (last) last.btn.disabled = false;
      refresh();
    };
    document.getElementById('clear-unscramble').onclick = () => {
      picked.forEach(p => { p.btn.disabled = false; });
      picked.length = 0;
      refresh();
    };
    document.getElementById('check').onclick = () => {
      const correct = picked.map(p => p.letter).join('') === word;
      results.push({ word, correct });
      finishRound(body, document.getElementById('feedback'), correct, word, () => { idx++; render(); });
    };
    refresh();
  }
  render();
}

function runMemoryMatch(words, activity = 'memory-match') { runBuildSounds(words, activity); }
function runOddOneOut(words, activity = 'odd-one-out') { runTrickyBit(words, activity); }
function runSpeedSpell(words, activity = 'speed-spell') { runWriteActivity(words.slice(0, 6), activity); }
function runBossRound(words, activity = 'boss-round') { runWriteActivity(words, activity); }

function finishRound(body, feedback, correct, word, next) {
  body.querySelectorAll('button, input').forEach(el => { if (!el.id?.startsWith('next')) el.disabled = true; });
  feedback.className = `hw-feedback ${correct ? 'correct' : 'wrong'}`;
  if (correct) {
    const message = getPositiveMessage();
    feedback.innerHTML = `${message}<div class="auto-next-note">Next word coming up…</div>`;
    TTS.speak(message, 1.0, 1.18).then(() => setTimeout(next, 350));
    return;
  }

  feedback.innerHTML = `The correct spelling is:<div class="correct-answer-reveal">${escapeHtml(word)}</div>${phonicsHtml(word)}${soundMapHtml(word)}`;
  TTS.saySlowly(word);
  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-secondary';
  nextBtn.textContent = 'Next →';
  nextBtn.id = 'next-round';
  nextBtn.onclick = next;
  body.querySelector('.activity-card-large').appendChild(nextBtn);
}

function pickMissingPositions(word, count) {
  const candidates = [];
  for (let i = 1; i < word.length - 1; i++) candidates.push(i);
  return shuffle(candidates).slice(0, count).sort((a, b) => a - b);
}

function makeSimpleMistake(word, existing = []) {
  const vowels = 'aeiou';
  for (let i = 0; i < word.length; i++) {
    if (vowels.includes(word[i])) {
      const replacement = vowels.replace(word[i], '')[Math.floor(Math.random() * 4)];
      const mistake = word.slice(0, i) + replacement + word.slice(i + 1);
      if (!existing.includes(mistake) && mistake !== word) return mistake;
    }
  }
  const pos = Math.max(1, Math.floor(word.length / 2));
  return word.slice(0, pos) + word[pos - 1] + word.slice(pos);
}

const POSITIVE_MSGS = ['Amazing! 🌟', 'Brilliant! ⭐', 'Superstar! 🎉', 'Fantastic! 🥳', 'You got it! 🎊', 'Wonderful! ✨', 'Excellent! 🏆', 'Top marks! 💫'];
function getPositiveMessage() { return POSITIVE_MSGS[Math.floor(Math.random() * POSITIVE_MSGS.length)]; }
