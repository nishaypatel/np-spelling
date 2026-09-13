# np-spelling — notes for Claude

Spell Squad: a static PWA my daughter uses to practise the weekly school
spelling list (she/her, in case it comes up). **No build, no tests, no dependencies** — vanilla JS, Firebase compat
from the CDN, one Vercel serverless function for cloud text-to-speech. Edit files, commit,
push; Vercel serves the repo as-is.

## The usual request: "Here are the words for this week" + a photo

This is a data task and should take about four tool calls. Do not re-explore
the repo — everything mechanical is in `tools/add-week.py`.

**1. Read the list off the photo into one JSON blob.** This is the only part
that needs thought. One entry per word, in the order shown on the sheet:

```json
{
  "theme": "y saying /igh/ (long i)",
  "words": {
    "cry": {
      "chunks": ["cr", "y"],
      "sentences": ["The baby began to cry.", "Try not to cry when you fall over.", "I heard the puppy cry in the night."],
      "family": "y saying /igh/ family",
      "trickyPart": "y",
      "wrongVersions": ["cri", "crie"]
    }
  }
}
```

Reading the photo:

- Keep the order shown on the sheet.
- **Red words are the tricky/common-exception words** (the school prints them
  in red), normally the last one or two — e.g. `old`, `cold`. Keep them in the
  list; just say so in `family`, as in `"-old word family (tricky word)"`.
- Preserve capitals and apostrophes exactly: `July`, `Tuesday`, `I'm`.
- Lists are usually 8 words, but not always (Week 29 has 10). Never truncate.

Writing the word data (see `js/activities.js` for what consumes it):

| field | used by | rules |
| --- | --- | --- |
| `chunks` | Build the Sounds, Tap the Sound, chunk-by-chunk TTS | **must concatenate to the exact word**; phonic pieces, not single letters |
| `sentences` | Hear & Write, dictation, Look-Cover-Write | 3 short sentences a 6-year-old knows, each containing the word |
| `family` | word card "Pattern:" | free text |
| `trickyPart` | word card + Tricky Bit header | free text (`"y"`, `"capital J"`) |
| `wrongVersions` | Tricky Bit distractors | 2 plausible misspellings, compared **case-sensitively** so `"july"` is a valid distractor for `July` |
| `theme` | nothing — metadata only, never rendered | |

A word mapped to `{}` is accepted (the app derives chunks and sentences at
runtime via `autoDetectPatterns()`), but hand-written data is much better.

**2. Run the script.** It picks the weekId (Tuesday of the current week), the
next `Week N` label and the shard — rolling over to a new shard file when the
current one is full — writes the week, appends the manifest entry and points
`currentWeekId` at it. It validates everything first and writes nothing if any
check fails.

```bash
python3 tools/add-week.py week.json          # or pipe the JSON on stdin
python3 tools/add-week.py --check            # re-validate the current week
```

Only if the defaults are wrong: `--week-id 2026-09-15` (a second list in the
same week, or a catch-up week) and `--label "Week 31"`.

**3. Commit both changed files and push** — see *Branches* below for where.
Do not open a PR unless asked.

That is the whole job. App code only needs touching if the list breaks an
assumption — see the next section for the ones already removed.

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
| `tools/add-week.py` | adds a week to `data/weeks/` and validates it (`--check`) |
| `api/tts.js` | Vercel function proxying cloud TTS — Azure, Google or ElevenLabs, one env var set each (CommonJS, Node 18). `GET /api/tts?probe=1` reports which are working |

## Voices

The app speaks through `js/activities.js`. `Settings → Voice Engine` picks one
of `device` (the default: the browser's own voice, free and offline) or the
cloud engines `azure`, `google`, `elevenlabs`, which go through `/api/tts`.
Each cloud engine needs its own Vercel env vars (`AZURE_SPEECH_KEY` +
`AZURE_SPEECH_REGION`, `GOOGLE_TTS_KEY`, `ELEVENLABS_API_KEY`); one without a
key reports itself unavailable and the app just uses the device voice. Any
cloud failure falls back to the device voice and skips that engine for a
minute. **Env var changes need a redeploy** before the running deployment sees
them.

## Branches

Push to `main`: Vercel deploys it, so nothing is live until it lands there, and
work sitting on a branch looks to the family like the app is broken or stale.

If a session is handed its own working branch, use it while working, then
fast-forward `main` to it and say the branch can be deleted — **this sandbox
cannot delete remote branches.** The git proxy silently refuses delete pushes
(`Everything up-to-date`, nothing removed) and no GitHub tool available here
deletes a ref, so every leftover branch is manual cleanup for the user. Eighteen
had accumulated before anyone noticed, one of them holding word data that was
never merged. Never leave a session's branch behind unmentioned.

Deleting one is a single command on the user's own machine:

```
gh api -X DELETE repos/nishaypatel/np-spelling/git/refs/heads/<branch>
```

## Data quirks

- Weeks 1–24 and 28 have empty `wordData` (imported in bulk; the app derives
  chunks/sentences at runtime). Weeks 25–27 and 29 are hand-written.
- The bulk import left a Week 29 that repeated Week 28's words; it was deleted
  and the later weeks renumbered, so labels run 1–N with no gaps. Keep it that
  way if a week is ever removed again.
- A family can override a week's words in Firestore
  (`families/{familyId}/weeks/{weekId}`); that record wins over the JSON for
  that weekId only.
