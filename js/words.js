const WEEK_WORDS = {
  weekId: '2026-06-09',
  words: ['unzip', 'unlock', 'unkind', 'unwell', 'unhappy', 'push', 'unlucky', 'unfair'],
  wordData: {
    unzip: {
      chunks: ['un', 'zip'],
      sentence: 'I can unzip my coat.',
      sentences: [
        'I can unzip my coat.',
        'Mum can unzip the bag.',
        'I unzip my red top.',
        'Can you unzip it for me?',
        'Sam will unzip his tent.'
      ],
      trickyPart: 'un',
      wrongVersions: ['unzipp', 'unzipe']
    },
    unlock: {
      chunks: ['un', 'lock'],
      sentence: 'Can you unlock the door?',
      sentences: [
        'Can you unlock the door?',
        'Dad will unlock the gate.',
        'I can unlock my box.',
        'Please unlock the shed.',
        'She will unlock the car.'
      ],
      trickyPart: 'un',
      wrongVersions: ['onlock', 'unlok']
    },
    unkind: {
      chunks: ['un', 'kind'],
      sentence: 'It is unkind to say mean things.',
      sentences: [
        'It is unkind to say mean things.',
        'It is unkind to push.',
        'That was an unkind word.',
        'Do not be unkind to Ben.',
        'It is unkind to take toys.'
      ],
      trickyPart: 'un',
      wrongVersions: ['onkind', 'unkined']
    },
    unwell: {
      chunks: ['un', 'well'],
      sentence: 'I felt unwell so I stayed home.',
      sentences: [
        'I felt unwell so I stayed home.',
        'Tom is unwell today.',
        'She felt unwell at school.',
        'The pup is unwell.',
        'I am unwell in bed.'
      ],
      trickyPart: 'un',
      wrongVersions: ['onwell', 'unwel']
    },
    unhappy: {
      chunks: ['un', 'hap', 'py'],
      sentence: 'The dog looked unhappy in the rain.',
      sentences: [
        'The dog looked unhappy in the rain.',
        'I felt unhappy when I fell.',
        'The cat is unhappy now.',
        'Sam was unhappy at lunch.',
        'She looked unhappy on the bus.'
      ],
      trickyPart: 'happy',
      wrongVersions: ['onhappy', 'unhapey']
    },
    push: {
      chunks: ['pu', 'sh'],
      sentence: 'Please push the door to open it.',
      sentences: [
        'Please push the door to open it.',
        'I can push the swing.',
        'Do not push in line.',
        'Push the cart slowly.',
        'Dad will push the pram.'
      ],
      trickyPart: 'sh',
      wrongVersions: ['puch', 'poosh']
    },
    unlucky: {
      chunks: ['un', 'luck', 'y'],
      sentence: 'It was unlucky that it rained.',
      sentences: [
        'It was unlucky that it rained.',
        'I was unlucky in the game.',
        'The unlucky cat got wet.',
        'Sam felt unlucky today.',
        'It was unlucky to miss the bus.'
      ],
      trickyPart: 'un',
      wrongVersions: ['onlucky', 'unluckey']
    },
    unfair: {
      chunks: ['un', 'fair'],
      sentence: 'It is unfair to push in the queue.',
      sentences: [
        'It is unfair to push in the queue.',
        'That game was unfair.',
        'It is unfair to take both.',
        'She said it was unfair.',
        'It is unfair to jump ahead.'
      ],
      trickyPart: 'un',
      wrongVersions: ['onfair', 'unfare']
    }
  }
};
