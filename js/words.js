// Offline fallback data. The source of truth lives in data/weeks/*.json
// (manifest + per-shard files) and is fetched at runtime by js/weeks.js.
// This fallback keeps the app working if those files cannot be fetched
// (e.g. opened from file://). It mirrors the latest/default week plus a
// lightweight manifest so the Word History grid still renders.

const FALLBACK_MANIFEST = {
  currentWeekId: '2026-06-16',
  weeksPerShard: 5,
  weeks: [
    {
      weekId: '2026-06-09',
      label: 'Week 1',
      shard: 'shard-001.json',
      words: ['unzip', 'unlock', 'unkind', 'unwell', 'unhappy', 'push', 'unlucky', 'unfair'],
    },
    {
      weekId: '2026-06-16',
      label: 'Week 2',
      shard: 'shard-001.json',
      words: ['hunting', 'playing', 'buzzing', 'jumping', 'pushing', 'thinking', 'asking', 'pull'],
    },
  ],
};

// Full data for the default week, used when the shard file cannot be fetched.
const WEEK_WORDS = {
  weekId: '2026-06-16',
  label: 'Week 2',
  words: ['hunting', 'playing', 'buzzing', 'jumping', 'pushing', 'thinking', 'asking', 'pull'],
  wordData: {
    hunting: {
      chunks: ['hunt', 'ing'],
      sentences: ['The cat is hunting a mouse.', 'We are hunting for shells.', 'The owl goes hunting at night.'],
      family: '-ing suffix family',
      trickyPart: 'ing',
      wrongVersions: ['huntting', 'huting'],
    },
    playing: {
      chunks: ['play', 'ing'],
      sentences: ['I am playing in the park.', 'The kids are playing tag.', 'She is playing with her doll.'],
      family: '-ing suffix family',
      trickyPart: 'ay',
      wrongVersions: ['plaing', 'playin'],
    },
    buzzing: {
      chunks: ['buzz', 'ing'],
      sentences: ['A bee is buzzing by the flower.', 'The fly keeps buzzing in the room.', 'My phone is buzzing on the table.'],
      family: '-ing suffix family',
      trickyPart: 'zz',
      wrongVersions: ['buzing', 'buzzin'],
    },
    jumping: {
      chunks: ['jump', 'ing'],
      sentences: ['The frog is jumping in the pond.', 'I love jumping on the bed.', 'The dog is jumping for the ball.'],
      family: '-ing suffix family',
      trickyPart: 'ing',
      wrongVersions: ['jumpping', 'jumpin'],
    },
    pushing: {
      chunks: ['push', 'ing'],
      sentences: ['He is pushing the heavy box.', 'Please stop pushing your brother.', 'Mum is pushing the pram.'],
      family: '-ing suffix family',
      trickyPart: 'sh',
      wrongVersions: ['pushhing', 'pushin'],
    },
    thinking: {
      chunks: ['think', 'ing'],
      sentences: ['I am thinking about lunch.', 'She is thinking of a plan.', 'He sat thinking very hard.'],
      family: '-ing suffix family',
      trickyPart: 'th',
      wrongVersions: ['thinkking', 'thinkin'],
    },
    asking: {
      chunks: ['ask', 'ing'],
      sentences: ['I am asking for some help.', 'She is asking a good question.', 'He keeps asking for sweets.'],
      family: '-ing suffix family',
      trickyPart: 'sk',
      wrongVersions: ['askking', 'asken'],
    },
    pull: {
      chunks: ['pu', 'll'],
      sentences: ['Please pull the rope hard.', 'I can pull the cart.', 'Pull the door to open it.'],
      family: 'double l spelling family',
      trickyPart: 'll',
      wrongVersions: ['pul', 'poll'],
    },
  },
};
