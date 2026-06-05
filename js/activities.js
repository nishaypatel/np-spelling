// ── Text-to-Speech ─────────────────────────────────────────
const FEMALE_VOICE_NAMES = [
  'Samantha', 'Serena', 'Karen', 'Moira', 'Tessa', 'Kate', 'Susan',
  'Victoria', 'Zoe', 'Ava', 'Allison', 'Fiona', 'Veena', 'Martha', 'Hazel',
];
const MALE_VOICE_NAMES = [
  'Daniel', 'Alex', 'Oliver', 'Arthur', 'Fred', 'Tom', 'Rishi', 'George', 'Thomas',
];

function voiceNameIncludes(voice, names) {
  const voiceName = String(voice?.name || '').toLowerCase();
  return names.some(name => voiceName.includes(name.toLowerCase()));
}

function isEnglishVoice(voice) {
  return String(voice?.lang || '').toLowerCase().startsWith('en');
}

function isBritishEnglishVoice(voice) {
  return String(voice?.lang || '').toLowerCase() === 'en-gb';
}

function isClearlyFemaleVoice(voice) {
  return voiceNameIncludes(voice, FEMALE_VOICE_NAMES) && !voiceNameIncludes(voice, MALE_VOICE_NAMES);
}

function isClearlyMaleVoice(voice) {
  return voiceNameIncludes(voice, MALE_VOICE_NAMES) && !voiceNameIncludes(voice, FEMALE_VOICE_NAMES);
}

function waitForVoicesChanged(timeout = 180) {
  return new Promise(resolve => {
    if (window.speechSynthesis.addEventListener) {
      const timer = setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        resolve();
      }, timeout);
      const onVoicesChanged = () => {
        clearTimeout(timer);
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        resolve();
      };
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
      return;
    }
    setTimeout(resolve, timeout);
  });
}

async function getVoicesWithRetry() {
  let voices = window.speechSynthesis.getVoices();
  for (let attempt = 0; attempt < 4 && voices.length === 0; attempt++) {
    await waitForVoicesChanged(180);
    voices = window.speechSynthesis.getVoices();
  }
  return voices;
}

function chooseVoice(voices, genderSetting) {
  const englishVoices = voices.filter(isEnglishVoice);
  const requestedGenderVoices = genderSetting === 'male'
    ? englishVoices.filter(isClearlyMaleVoice)
    : englishVoices.filter(isClearlyFemaleVoice);

  return requestedGenderVoices.find(isBritishEnglishVoice)
    || requestedGenderVoices[0]
    || englishVoices.find(isBritishEnglishVoice)
    || englishVoices[0]
    || null;
}

const TTS = {
  speak(text, rate = STATE?.settings?.speechRate || 0.75, pitch = 1.05) {
    return new Promise(async resolve => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.onend = resolve;
      utterance.onerror = resolve;

      const genderSetting = STATE.settings.voiceGender === 'male' ? 'male' : 'female';
      const voices = await getVoicesWithRetry();
      const preferred = chooseVoice(voices, genderSetting);
      if (preferred) utterance.voice = preferred;

      console.log('[Spell Squad TTS] chosen voice', {
        voiceName: preferred?.name || 'browser default',
        lang: preferred?.lang || utterance.lang,
        genderSetting,
      });

      window.speechSynthesis.speak(utterance);
    });
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
  cancel() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); },
};
window.TTS = TTS;
if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

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
  if (sentences.length) return sentences[Math.floor(Math.random() * sentences.length)];
  return wordData.sentence || `Can you spell ${word}?`;
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
        ${noPeek || activity === 'look-cover-write' ? '' : phonicsHtml(word, false)}
        <div class="hw-input-wrap">
          <input class="hw-answer-input" id="answer-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${placeholder}">
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
    input.focus();
    const check = () => {
      const answer = input.value.trim().toLowerCase();
      const correct = answer === target.toLowerCase();
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
        ${soundMapHtml(word)}
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
    const letters = [...word].map((letter, i) => positions.includes(i) ? `<input class="ml-blank" data-pos="${i}" maxlength="1">` : `<span>${letter}</span>`).join('');
    body.innerHTML = `<section class="activity-card-large apple-card"><p class="eyebrow">Fill in the missing spelling</p><button class="hw-play-btn" id="play-word">🔊</button><div class="ml-word-display">${letters}</div>${phonicsHtml(word)}<div class="hw-feedback" id="feedback"></div><button class="btn btn-primary" id="check-missing">Check ✓</button></section>`;
    setTimeout(() => TTS.speak(word, STATE.settings.speechRate, 1.0), 250);
    document.getElementById('play-word').onclick = () => TTS.speak(word, STATE.settings.speechRate, 1.0);
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
    body.innerHTML = `<section class="activity-card-large apple-card"><p class="eyebrow">Unscramble the word</p><div class="scramble">${shuffle([...word]).join(' ')}</div>${phonicsHtml(word, false)}<input class="hw-answer-input" id="answer-input" placeholder="unscrambled word"><div class="hw-feedback" id="feedback"></div><button class="btn btn-primary" id="check">Check ✓</button></section>`;
    document.getElementById('check').onclick = () => {
      const correct = document.getElementById('answer-input').value.trim().toLowerCase() === word;
      results.push({ word, correct });
      finishRound(body, document.getElementById('feedback'), correct, word, () => { idx++; render(); });
    };
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
  feedback.innerHTML = correct ? getPositiveMessage() : `The correct spelling is:<div class="correct-answer-reveal">${escapeHtml(word)}</div>${phonicsHtml(word)}${soundMapHtml(word)}`;
  if (correct) TTS.speak(getPositiveMessage(), 1.0, 1.18); else TTS.saySlowly(word);
  const nextBtn = document.createElement('button');
  nextBtn.className = correct ? 'btn btn-correct' : 'btn btn-secondary';
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
