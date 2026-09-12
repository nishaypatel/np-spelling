#!/usr/bin/env python3
"""Add one week of spelling words to data/weeks/.

Reads a single JSON blob (file argument or stdin) describing the week, then
does everything mechanical: picks the weekId, the "Week N" label and the shard
(rolling over to a new shard file when the current one is full), writes the
week into that shard, appends the manifest entry and points currentWeekId at
it. Everything is validated before anything is written.

Input shape — one entry per word, in the order shown on the school sheet:

    {
      "theme": "y saying /igh/ (long i)",
      "words": {
        "cry": {
          "chunks": ["cr", "y"],
          "sentences": ["The baby began to cry.", "...", "..."],
          "family": "y saying /igh/ family",
          "trickyPart": "y",
          "wrongVersions": ["cri", "crie"]
        },
        "old": { ... }
      }
    }

A word mapped to {} is allowed: the app derives chunks/sentences at runtime.

    python3 tools/add-week.py week.json          # add the week
    python3 tools/add-week.py --check            # re-validate the current week
"""

import argparse
import collections
import datetime
import json
import re
import sys

WEEK_DAY = 1  # weeks are keyed to the Tuesday of the school week (Mon=0)


def load_json(path):
    with open(path) as f:
        return json.load(f, object_pairs_hook=collections.OrderedDict)


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def default_week_id(manifest):
    """Tuesday of the current Mon–Sun week."""
    today = datetime.date.today()
    return str(today - datetime.timedelta(days=today.weekday() - WEEK_DAY))


def next_label(manifest):
    numbers = [int(m.group(1)) for m in
               (re.match(r"Week (\d+)$", w.get("label", "")) for w in manifest["weeks"]) if m]
    return f"Week {max(numbers) + 1 if numbers else len(manifest['weeks']) + 1}"


def pick_shard(manifest, data_dir):
    """Newest shard with room, else the next shard file (created empty)."""
    per_shard = manifest.get("weeksPerShard", 5)
    counts = collections.Counter(w["shard"] for w in manifest["weeks"])
    newest = manifest["weeks"][-1]["shard"] if manifest["weeks"] else "shard-001.json"
    if counts[newest] < per_shard:
        return newest, False
    number = int(re.search(r"(\d+)", newest).group(1)) + 1
    return f"shard-{number:03d}.json", True


def validate(week, errors):
    words = week["words"]
    if not words:
        errors.append("no words given")
    if len(set(words)) != len(words):
        errors.append("duplicate words in the list")
    for word in words:
        data = week["wordData"].get(word)
        if data is None:
            errors.append(f"{word}: missing from wordData")
            continue
        if not data:
            print(f"note: {word} has no word data — chunks and sentences will be auto-derived")
            continue
        chunks = data.get("chunks") or []
        if "".join(chunks) != word:
            errors.append(f"{word}: chunks {chunks} do not spell the word")
        sentences = [s for s in data.get("sentences") or [] if s.strip()]
        if len(sentences) < 3:
            errors.append(f"{word}: needs 3 sentences, has {len(sentences)}")
        for sentence in sentences:
            if word.lower() not in sentence.lower():
                errors.append(f"{word}: sentence does not contain the word — {sentence!r}")
        wrong = [w for w in data.get("wrongVersions") or [] if w]
        if len(set(wrong)) < 2:
            errors.append(f"{word}: needs 2 distinct wrongVersions, has {sorted(set(wrong))}")
        if word in wrong:
            errors.append(f"{word}: wrongVersions must differ from the word (compared case-sensitively)")
        if not data.get("family") or not data.get("trickyPart"):
            errors.append(f"{word}: family and trickyPart are required")


def check_current(data_dir):
    manifest = load_json(f"{data_dir}/manifest.json")
    entry = next(w for w in manifest["weeks"] if w["weekId"] == manifest["currentWeekId"])
    week = load_json(f"{data_dir}/{entry['shard']}")[entry["weekId"]]
    errors = []
    if entry["words"] != week["words"]:
        errors.append("manifest and shard word lists disagree")
    validate(week, errors)
    return manifest, entry, week, errors


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", help="JSON file describing the week (default: stdin)")
    ap.add_argument("--week-id", help="ISO date key (default: Tuesday of this week)")
    ap.add_argument("--label", help='default: the next "Week N"')
    ap.add_argument("--data-dir", default="data/weeks")
    ap.add_argument("--check", action="store_true", help="validate the current week and exit")
    args = ap.parse_args()

    if args.check:
        manifest, entry, week, errors = check_current(args.data_dir)
        for e in errors:
            print("error:", e, file=sys.stderr)
        print(f"{'FAILED' if errors else 'ok'} — {week['label']} ({week['weekId']}): {', '.join(week['words'])}")
        return 1 if errors else 0

    payload = json.loads(sys.stdin.read()) if not args.input else load_json(args.input)
    words = list(payload["words"])
    manifest = load_json(f"{args.data_dir}/manifest.json")

    week_id = args.week_id or default_week_id(manifest)
    label = args.label or next_label(manifest)
    week = collections.OrderedDict([
        ("weekId", week_id),
        ("label", label),
        ("theme", payload.get("theme", "Not shown")),
        ("words", words),
        ("wordData", payload["words"]),
        ("testMistakes", []),
    ])

    errors = []
    if any(w["weekId"] == week_id for w in manifest["weeks"]):
        errors.append(f"{week_id} is already in the manifest — pass --week-id for a different date")
    last = manifest["weeks"][-1]["weekId"] if manifest["weeks"] else ""
    if week_id <= last:
        errors.append(f"{week_id} is not after the last week ({last}) — pass --week-id to override")
    validate(week, errors)
    if errors:
        for e in errors:
            print("error:", e, file=sys.stderr)
        return 1

    shard_name, is_new = pick_shard(manifest, args.data_dir)
    shard_path = f"{args.data_dir}/{shard_name}"
    shard = collections.OrderedDict() if is_new else load_json(shard_path)
    shard[week_id] = week
    save_json(shard_path, shard)

    manifest["weeks"].append(collections.OrderedDict([
        ("weekId", week_id),
        ("label", label),
        ("shard", shard_name),
        ("words", words),
        ("testMistakes", []),
    ]))
    manifest["currentWeekId"] = week_id
    save_json(f"{args.data_dir}/manifest.json", manifest)

    print(f"added {label} ({week_id}) to {shard_name}{' (new shard)' if is_new else ''} "
          f"and set it as the current week")
    print(f"  {len(words)} words: {', '.join(words)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
