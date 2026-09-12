# np-spelling — notes for Claude

Spell Squad: a static PWA my kid uses to practise the weekly school spelling
list. **No build, no tests, no dependencies** — vanilla JS, Firebase compat
from the CDN, one Vercel serverless function for Azure TTS. Edit files, commit,
push; Vercel serves the repo as-is.

## The usual request: "Here are the words for this week" + a photo

That is a data task. Read the words off the photo and add **one new week** to
`data/weeks/`. Nothing else normally needs to change.

### 1. Read the list off the photo

- Keep the order shown on the sheet.
- **Red words are the tricky/common-exception words** (the school prints them
  in red). They are normally the last one or two, e.g. `old`, `cold`. Keep them
  in the list — just describe them as tricky words in `family`.
- Preserve capitals and apostrophes exactly: `July`, `Tuesday`, `I'm`.
- Lists are usually 8 words, but not always (Week 30 has 10). Never truncate.

### 2. Pick the weekId and label

- `weekId` is an ISO date and **every week so far is a Tuesday** — use the
  Tuesday of the current week (`date -d 'last tuesday'` / check with python).
- `label` is `"Week N"`, continuing the sequence in the manifest. Gaps in the
  dates are fine (school holidays); the numbering just keeps counting.

### 3. Pick the shard

`data/weeks/manifest.json` holds `weeksPerShard: 5`. Count how many weeks
already point at the newest shard; if it is full, start the next one with a new
file containing `{}` and reference it from the manifest entry. `js/weeks.js`
fetches whatever filename the entry names, so no code change is needed.
(`shard-006.json` is full: weeks 26–30. **The next week starts
`shard-007.json`.**) `sw.js` precaches only `shard-001.json`; leave that alone.

### 4. Write the week into the shard

Keyed by `weekId`, appended at the end of the shard object:

```json
"2026-09-08": {
  "weekId": "2026-09-08",
  "label": "Week 30",
  "theme": "y saying /igh/ (long i)",
  "words": ["cry", "by", "..."],
  "wordData": {
    "cry": {
      "chunks": ["cr", "y"],
      "sentences": ["The baby began to cry.", "…", "…"],
      "family": "y saying /igh/ family",
      "trickyPart": "y",
      "wrongVersions": ["cri", "crie"]
    }
  },
  "testMistakes": []
}
```

What each field feeds (see `js/activities.js`):

| field | used by | rules |
| --- | --- | --- |
| `chunks` | Build the Sounds, Tap the Sound, chunk-by-chunk TTS | **must concatenate to the exact word**; phonic pieces, not letters |
| `sentences` | Hear & Write, dictation, Look-Cover-Write | 3 short sentences a 6-year-old knows, each containing the word |
| `family` | word card "Pattern:" | free text |
| `trickyPart` | word card + Tricky Bit header | free text (`"y"`, `"capital J"`) |
| `wrongVersions` | Tricky Bit distractors | exactly 2, plausible misspellings, compared **case-sensitively** so `"july"` is a valid distractor for `July` |
| `theme` | nothing — metadata only, not rendered | |
| `testMistakes` | My Tricky Words game | `[]` for a new week; the parent marks these in the app after the school test |

`wordData` may be left `{}` — `autoDetectPatterns()` in `js/app.js` guesses
chunks/family/sentences at runtime — but hand-written data is much better, so
fill it in.

### 5. Update the manifest

Append `{ weekId, label, shard, words, testMistakes }` to `manifest.weeks`
(same words, in the same order) **and set `currentWeekId` to the new weekId**.
The manifest is the index the Word History grid renders from; shards are only
fetched for the week being practised.

### 6. Verify, commit, push

```bash
python3 - <<'PY'
import json
m = json.load(open('data/weeks/manifest.json'))
s = json.load(open('data/weeks/shard-006.json'))   # the shard you touched
w = s[m['currentWeekId']]
entry = next(e for e in m['weeks'] if e['weekId'] == w['weekId'])
assert entry['words'] == w['words'], 'manifest/shard word lists disagree'
assert list(w['wordData']) == w['words'], 'wordData must cover every word'
for word, d in w['wordData'].items():
    assert ''.join(d['chunks']) == word, f'chunks do not spell {word}'
    assert len(d['sentences']) >= 3 and word not in d['wrongVersions'], word
print('ok', w['label'], w['words'])
PY
node --check js/app.js && node --check js/activities.js   # only if JS changed
```

Commit both files together and push to the session's designated branch. Do not
open a PR unless asked.

## Things already fixed — don't reintroduce them

- **Week length is not fixed at 8.** `WORDS_PER_WEEK` / `MIN_WORDS_PER_WEEK` /
  `MAX_WORDS_PER_WEEK` in `js/app.js` bound the *hand-edited* list only; the
  JSON path takes whatever the week has. No `slice(0, 8)`, no "exactly 8 words".
- **Capitals survive.** `saveWeeklyWords()` and the Firestore override no longer
  lowercase words, so proper nouns stay correct.
- **Letter comparisons are case-insensitive** (Missing Letters), otherwise the
  capital `J` in `July` can never be typed on the letter keyboard.
- Bump `CACHE_VERSION` in `sw.js` when shell files (HTML/CSS/JS/icons) change.
  `data/weeks/*.json` is network-first, so **data-only weeks need no bump**.

## File map

| file | what it is |
| --- | --- |
| `index.html` | all screens, hidden/shown by `showScreen()` |
| `js/app.js` | state, auth/Firestore, week loading, home/parent/history screens, `autoDetectPatterns()` |
| `js/activities.js` | every game + TTS |
| `js/weeks.js` | fetches manifest + shards, with caching and fallbacks |
| `js/words.js` | offline fallback copy of *an old* week — stale on purpose, only used when `data/weeks/*.json` cannot be fetched (e.g. `file://`). Not updated weekly |
| `data/weeks/` | the source of truth: `manifest.json` + `shard-NNN.json` |
| `api/tts.js` | Vercel function proxying Azure TTS (CommonJS, Node 18) |

## Data quirks

- Weeks 1–24, 28 and 29 have empty `wordData` (imported in bulk; the app
  derives chunks/sentences at runtime). Weeks 25–27 and 30 are hand-written.
- Week 29 repeats Week 28's words — an artefact of the master import, left as-is.
- A family can override a week's words in Firestore
  (`families/{familyId}/weeks/{weekId}`); that record wins over the JSON for
  that weekId only.
