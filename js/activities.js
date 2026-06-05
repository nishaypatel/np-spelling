// ── Text-to-Speech ─────────────────────────────────────────
const TTS = {
  speak(text, rate = 0.85, pitch = 1.1) {
    return new Promise(resolve => {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang  = 'en-GB';
      utt.rate  = rate;
      utt.pitch = pitch;
      utt.onend = resolve;
      utt.onerror = resolve;
      // Prefer a child-friendly UK voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v =>
        v.lang === 'en-GB' && (v.name.includes('Daniel') || v.name.includes('Serena') || v.name.includes('Karen'))
      ) || voices.find(v => v.lang === 'en-GB') || voices.find(v => v.lang.startsWith('en'));
      if (preferred) utt.voice = preferred;
      window.speechSynthesis.speak(utt);
    });
  },

  async sayWord(word, wordData) {
    await TTS.speak(word, 0.75, 1.15);
    await new Promise(r => setTimeout(r, 400));
    const sentence = wordData?.sentence || `Can you spell ${word}?`;
    await TTS.speak(sentence, 0.85, 1.0);
  },

  cancel() { window.speechSynthesis.cancel(); }
};

// Preload voices on iOS/Safari (they load async)
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

// ── Activity Entry Point ───────────────────────────────────
function startActivity(type) {
  if (STATE.words.length === 0) { showToast('No words loaded yet!'); return; }
  TTS.cancel();

  const titleMap = {
    'hear-write':      '👂 Hear & Write',
    'missing-letters': '🔡 Missing Letters',
    'fix-mistake':     '🔍 Fix the Mistake',
    'test-mode':       '📝 Spelling Test',
  };
  document.getElementById('activity-title').textContent = titleMap[type] || 'Activity';

  // Shuffle words for variety (except test mode which uses all in order)
  const words = type === 'test-mode'
    ? [...STATE.words]
    : shuffle([...STATE.words]);

  switch (type) {
    case 'hear-write':      runHearWrite(words);      break;
    case 'missing-letters': runMissingLetters(words); break;
    case 'fix-mistake':     runFixMistake(words);     break;
    case 'test-mode':       runTestMode(words);       break;
  }
  showScreen('screen-activity');
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function updateProgress(current, total) {
  document.getElementById('progress-pill').textContent = `${current} / ${total}`;
}

// ── ACTIVITY 1: Hear & Write ───────────────────────────────
function runHearWrite(words) {
  let idx = 0;
  const sessionResults = [];

  function renderQuestion() {
    if (idx >= words.length) {
      sessionResults.forEach(r => saveResult(r.word, 'hear-write', r.correct));
      showResults('hear-write', sessionResults);
      return;
    }

    const word = words[idx];
    const data = STATE.wordData[word] || {};
    updateProgress(idx + 1, words.length);

    const body = document.getElementById('activity-body');
    body.innerHTML = '';
    body.classList.add('fade-in');

    // Phonics chunks display
    const chunks = data.chunks || [word];
    const chunksHtml = chunks.map(c =>
      `<span class="phonics-chunk">${c}</span>`
    ).join('');

    body.innerHTML = `
      <p class="hw-word-display">Listen carefully, then write the word</p>

      <button class="hw-play-btn" id="hw-play" title="Hear the word">🔊</button>

      <div class="phonics-chunks" id="hw-chunks" style="opacity:0">${chunksHtml}</div>

      <div class="hw-input-wrap">
        <input class="hw-answer-input" id="hw-input"
               type="text" inputmode="text"
               autocorrect="off" autocapitalize="off" spellcheck="false"
               placeholder="write the word here">
        <div class="hw-feedback" id="hw-feedback"></div>
        <button class="btn btn-primary" id="hw-submit">Check ✓</button>
      </div>

      <p class="activity-hint">💡 Tap 🔊 again to hear the word again</p>
    `;

    // Auto-play on load
    setTimeout(() => TTS.sayWord(word, data), 300);

    document.getElementById('hw-play').addEventListener('click', () => {
      TTS.sayWord(word, data);
    });

    const input = document.getElementById('hw-input');
    const feedback = document.getElementById('hw-feedback');
    const submitBtn = document.getElementById('hw-submit');
    const chunksEl  = document.getElementById('hw-chunks');

    submitBtn.addEventListener('click', () => checkAnswer());
    input.addEventListener('keydown', e => { if (e.key === 'Enter') checkAnswer(); });

    function checkAnswer() {
      const answer  = input.value.trim().toLowerCase();
      const correct = answer === word.toLowerCase();

      input.className = 'hw-answer-input ' + (correct ? 'correct' : 'wrong');
      feedback.className = 'hw-feedback ' + (correct ? 'correct' : 'wrong');

      if (correct) {
        feedback.textContent = getPositiveMessage();
        submitBtn.textContent = 'Next Word →';
        submitBtn.className = 'btn btn-correct';
        // Show phonics chunks as reward
        chunksEl.style.opacity = '1';
        chunksEl.style.transition = 'opacity 0.4s';
        TTS.speak(getPositiveMessage(), 1.0, 1.3);
      } else {
        feedback.textContent = `The correct spelling is:`;
        submitBtn.textContent = 'Try Again';
        submitBtn.className = 'btn btn-wrong';
        const reveal = document.createElement('div');
        reveal.className = 'correct-answer-reveal';
        reveal.textContent = word;
        feedback.after(reveal);
        TTS.speak(word, 0.7, 1.1);
        // Show chunks as teaching aid
        chunksEl.style.opacity = '1';
        chunksEl.style.transition = 'opacity 0.4s';
      }

      sessionResults.push({ word, correct });
      submitBtn.replaceWith(submitBtn.cloneNode(true)); // remove old listeners

      const newBtn = body.querySelector('#hw-submit') || (() => {
        const b = document.createElement('button');
        b.id = 'hw-submit';
        b.className = correct ? 'btn btn-correct' : 'btn btn-wrong';
        b.textContent = correct ? 'Next Word →' : 'Next Word →';
        return b;
      })();

      // Replace submit with next
      const nextBtn = document.createElement('button');
      nextBtn.className = correct ? 'btn btn-correct' : 'btn btn-secondary';
      nextBtn.textContent = 'Next Word →';
      const wrap = document.querySelector('.hw-input-wrap');
      wrap.querySelectorAll('button').forEach(b => b.remove());
      wrap.appendChild(nextBtn);
      nextBtn.addEventListener('click', () => { idx++; renderQuestion(); });
    }
  }

  renderQuestion();
}

// ── ACTIVITY 2: Missing Letters ────────────────────────────
function runMissingLetters(words) {
  let idx = 0;
  const sessionResults = [];

  function renderQuestion() {
    if (idx >= words.length) {
      sessionResults.forEach(r => saveResult(r.word, 'missing-letters', r.correct));
      showResults('missing-letters', sessionResults);
      return;
    }

    const word = words[idx];
    const data = STATE.wordData[word] || {};
    updateProgress(idx + 1, words.length);

    // Pick missing letter position(s): for short words 1 missing, longer 2
    const missingCount = word.length <= 4 ? 1 : word.length <= 7 ? 1 : 2;
    const positions = pickMissingPositions(word, missingCount);

    const body = document.getElementById('activity-body');
    body.innerHTML = '';
    body.classList.add('fade-in');

    // Build the word display with blanks
    let letterHtml = '';
    for (let i = 0; i < word.length; i++) {
      if (positions.includes(i)) {
        letterHtml += `<input class="ml-blank" data-pos="${i}"
                              type="text" inputmode="text" maxlength="1"
                              autocorrect="off" autocapitalize="off" spellcheck="false">`;
      } else {
        letterHtml += `<span class="ml-letter">${word[i]}</span>`;
      }
    }

    const chunks = data.chunks || [word];
    const chunksHtml = chunks.map(c => `<span class="phonics-chunk">${c}</span>`).join('');

    body.innerHTML = `
      <p class="hw-word-display">Fill in the missing letter${missingCount > 1 ? 's' : ''}</p>
      <button class="hw-play-btn" id="ml-play" title="Hear the word" style="width:60px;height:60px;font-size:1.6rem">🔊</button>
      <div class="ml-word-display">${letterHtml}</div>
      <div class="phonics-chunks" style="opacity:0;transition:opacity 0.4s" id="ml-chunks">${chunksHtml}</div>
      <div class="hw-feedback" id="ml-feedback"></div>
      <button class="btn btn-primary" id="ml-submit">Check ✓</button>
    `;

    setTimeout(() => TTS.speak(word, 0.75, 1.1), 300);

    document.getElementById('ml-play').addEventListener('click', () => TTS.speak(word, 0.75, 1.1));

    // Auto-advance between blanks
    const blanks = body.querySelectorAll('.ml-blank');
    blanks.forEach((b, i) => {
      b.addEventListener('input', () => {
        if (b.value.length >= 1 && i < blanks.length - 1) blanks[i + 1].focus();
      });
    });
    if (blanks.length) blanks[0].focus();

    document.getElementById('ml-submit').addEventListener('click', () => {
      let correct = true;
      blanks.forEach(b => {
        const pos = parseInt(b.dataset.pos);
        if (b.value.trim().toLowerCase() !== word[pos]) correct = false;
      });

      const feedback = document.getElementById('ml-feedback');
      feedback.className = 'hw-feedback ' + (correct ? 'correct' : 'wrong');
      feedback.textContent = correct ? getPositiveMessage() : `The word is: ${word}`;
      document.getElementById('ml-chunks').style.opacity = '1';

      if (correct) TTS.speak(getPositiveMessage(), 1.0, 1.3);
      else TTS.speak(word, 0.7, 1.1);

      sessionResults.push({ word, correct });

      const oldBtn = document.getElementById('ml-submit');
      const nextBtn = document.createElement('button');
      nextBtn.className = correct ? 'btn btn-correct' : 'btn btn-secondary';
      nextBtn.textContent = 'Next →';
      oldBtn.replaceWith(nextBtn);
      nextBtn.addEventListener('click', () => { idx++; renderQuestion(); });
    });
  }

  renderQuestion();
}

function pickMissingPositions(word, count) {
  // Avoid first and last letter for young children
  const candidates = [];
  for (let i = 1; i < word.length - 1; i++) candidates.push(i);
  if (candidates.length < count) return [Math.floor(word.length / 2)];
  const positions = [];
  const shuffled = shuffle([...candidates]);
  for (let i = 0; i < count; i++) positions.push(shuffled[i]);
  return positions.sort((a, b) => a - b);
}

// ── ACTIVITY 3: Fix the Mistake ────────────────────────────
function runFixMistake(words) {
  let idx = 0;
  const sessionResults = [];

  function renderQuestion() {
    if (idx >= words.length) {
      sessionResults.forEach(r => saveResult(r.word, 'fix-mistake', r.correct));
      showResults('fix-mistake', sessionResults);
      return;
    }

    const word = words[idx];
    const data = STATE.wordData[word] || {};
    updateProgress(idx + 1, words.length);

    // Get wrong versions — use AI-generated ones or create simple ones
    const wrongs = (data.wrongVersions || []).slice(0, 2);
    while (wrongs.length < 2) wrongs.push(makeSimpleMistake(word, wrongs));

    // Build options: 1 correct + 2 wrong, shuffled
    const options = shuffle([word, ...wrongs.slice(0, 2)]);

    const body = document.getElementById('activity-body');
    body.innerHTML = '';
    body.classList.add('fade-in');

    body.innerHTML = `
      <p class="hw-word-display">Which one is spelled correctly?</p>
      <button class="hw-play-btn" id="fm-play" style="width:60px;height:60px;font-size:1.6rem">🔊</button>
      <div class="fix-options" id="fix-options">
        ${options.map(o => `<button class="fix-option" data-word="${o}">${o}</button>`).join('')}
      </div>
      <div class="hw-feedback" id="fm-feedback"></div>
    `;

    setTimeout(() => TTS.speak(word, 0.75, 1.1), 300);
    document.getElementById('fm-play').addEventListener('click', () => TTS.speak(word, 0.75, 1.1));

    document.querySelectorAll('.fix-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosen  = btn.dataset.word;
        const correct = chosen === word;

        document.querySelectorAll('.fix-option').forEach(b => {
          if (b.dataset.word === word) b.classList.add('correct-choice');
          else b.classList.add('wrong-choice');
          b.disabled = true;
        });

        const feedback = document.getElementById('fm-feedback');
        feedback.className = 'hw-feedback ' + (correct ? 'correct' : 'wrong');
        feedback.textContent = correct ? getPositiveMessage() : `The correct spelling is: ${word}`;

        if (correct) TTS.speak(getPositiveMessage(), 1.0, 1.3);
        else TTS.speak(word, 0.7, 1.1);

        sessionResults.push({ word, correct });

        setTimeout(() => {
          const nextBtn = document.createElement('button');
          nextBtn.className = correct ? 'btn btn-correct' : 'btn btn-secondary';
          nextBtn.textContent = 'Next →';
          nextBtn.style.marginTop = '8px';
          document.getElementById('activity-body').appendChild(nextBtn);
          nextBtn.addEventListener('click', () => { idx++; renderQuestion(); });
        }, 500);
      });
    });
  }

  renderQuestion();
}

function makeSimpleMistake(word, existing) {
  const mistakes = [];
  // Common mistake: swap a vowel
  const vowels = 'aeiou';
  for (let i = 0; i < word.length; i++) {
    if (vowels.includes(word[i])) {
      const alt = vowels.replace(word[i], '').split('');
      const replacement = alt[Math.floor(Math.random() * alt.length)];
      const m = word.slice(0, i) + replacement + word.slice(i + 1);
      if (!existing.includes(m) && m !== word) mistakes.push(m);
    }
  }
  if (mistakes.length) return mistakes[Math.floor(Math.random() * mistakes.length)];
  // Fallback: duplicate a letter
  const pos = Math.floor(word.length / 2);
  return word.slice(0, pos) + word[pos] + word.slice(pos);
}

// ── ACTIVITY 4: Test Mode ──────────────────────────────────
function runTestMode(words) {
  let idx = 0;
  const sessionResults = [];
  let answered = false;

  async function renderQuestion() {
    if (idx >= words.length) {
      sessionResults.forEach(r => saveResult(r.word, 'test-mode', r.correct));
      showResults('test-mode', sessionResults);
      return;
    }

    const word = words[idx];
    const data = STATE.wordData[word] || {};
    updateProgress(idx + 1, words.length);
    answered = false;

    const body = document.getElementById('activity-body');
    body.innerHTML = '';
    body.classList.add('fade-in');

    body.innerHTML = `
      <p class="hw-word-display" style="font-size:0.9rem">🏫 Spelling Test — just like school</p>
      <p class="hw-word-display" style="font-size:0.85rem;margin-top:-8px">Listen carefully, then write the word</p>

      <div class="hw-input-wrap" style="margin-top:8px">
        <input class="hw-answer-input" id="test-input"
               type="text" inputmode="text"
               autocorrect="off" autocapitalize="off" spellcheck="false"
               placeholder="write the word here">
        <div class="hw-feedback" id="test-feedback"></div>
        <button class="btn btn-primary" id="test-submit">Check ✓</button>
      </div>

      <p class="activity-hint">No peeking — this is the real test! 💪</p>
    `;

    const input    = document.getElementById('test-input');
    const feedback = document.getElementById('test-feedback');
    const submit   = document.getElementById('test-submit');

    // Read word + sentence (no second chance in test mode — they can tap the word to replay ONCE)
    await TTS.sayWord(word, data);
    input.focus();

    submit.addEventListener('click', () => checkTestAnswer());
    input.addEventListener('keydown', e => { if (e.key === 'Enter') checkTestAnswer(); });

    function checkTestAnswer() {
      if (answered) return;
      answered = true;

      const answer  = input.value.trim().toLowerCase();
      const correct = answer === word.toLowerCase();

      input.className = 'hw-answer-input ' + (correct ? 'correct' : 'wrong');
      feedback.className = 'hw-feedback ' + (correct ? 'correct' : 'wrong');
      feedback.textContent = correct ? getPositiveMessage() : `The correct spelling is: ${word}`;

      if (!correct) {
        const reveal = document.createElement('div');
        reveal.className = 'correct-answer-reveal';
        reveal.textContent = word;
        feedback.after(reveal);
      }

      sessionResults.push({ word, correct });

      const nextBtn = document.createElement('button');
      nextBtn.className = correct ? 'btn btn-correct' : 'btn btn-secondary';
      nextBtn.textContent = idx < words.length - 1 ? 'Next Word →' : 'See Results 🎉';
      submit.replaceWith(nextBtn);
      nextBtn.addEventListener('click', () => { idx++; renderQuestion(); });

      if (correct) TTS.speak(getPositiveMessage(), 1.0, 1.3);
    }
  }

  renderQuestion();
}

// ── Positive messages ──────────────────────────────────────
const POSITIVE_MSGS = [
  'Amazing! 🌟', 'Brilliant! ⭐', 'Superstar! 🎉',
  'Fantastic! 🥳', 'You got it! 🎊', 'Wonderful! ✨',
  'Excellent! 🏆', 'Top marks! 💫', 'Nailed it! 🙌',
];
function getPositiveMessage() {
  return POSITIVE_MSGS[Math.floor(Math.random() * POSITIVE_MSGS.length)];
}
