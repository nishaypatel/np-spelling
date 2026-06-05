const WEEK_WORDS = {
  weekId: '2026-06-09',
  words: ['unzip', 'unlock', 'unkind', 'unwell', 'unhappy', 'push', 'unlucky', 'unfair'],
  wordData: {
    unzip: {
      chunks: ['un', 'zip'],
      sentence: 'I can unzip my coat.',
      trickyPart: 'un',
      wrongVersions: ['unzipp', 'unzipe']
    },
    unlock: {
      chunks: ['un', 'lock'],
      sentence: 'Can you unlock the door?',
      trickyPart: 'un',
      wrongVersions: ['onlock', 'unlok']
    },
    unkind: {
      chunks: ['un', 'kind'],
      sentence: 'It is unkind to say mean things.',
      trickyPart: 'un',
      wrongVersions: ['onkind', 'unkined']
    },
    unwell: {
      chunks: ['un', 'well'],
      sentence: 'I felt unwell so I stayed home.',
      trickyPart: 'un',
      wrongVersions: ['onwell', 'unwel']
    },
    unhappy: {
      chunks: ['un', 'hap', 'py'],
      sentence: 'The dog looked unhappy in the rain.',
      trickyPart: 'happy',
      wrongVersions: ['onhappy', 'unhapey']
    },
    push: {
      chunks: ['pu', 'sh'],
      sentence: 'Please push the door to open it.',
      trickyPart: 'sh',
      wrongVersions: ['puch', 'poosh']
    },
    unlucky: {
      chunks: ['un', 'luck', 'y'],
      sentence: 'It was unlucky that it rained.',
      trickyPart: 'un',
      wrongVersions: ['onlucky', 'unluckey']
    },
    unfair: {
      chunks: ['un', 'fair'],
      sentence: 'It is unfair to push in the queue.',
      trickyPart: 'un',
      wrongVersions: ['onfair', 'unfare']
    }
  }
};
