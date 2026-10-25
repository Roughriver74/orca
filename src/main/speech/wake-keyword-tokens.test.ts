import { describe, expect, it } from 'vitest'
import { buildWakeKeywordList, inflectedDecoyForms } from './wake-keyword-tokens'

// A slice of the real model's tokens.txt pieces these phrases need.
const VOCABULARY = new Set([
  '▁',
  '▁д',
  '▁п',
  '▁э',
  'жа',
  'р',
  'ви',
  'с',
  'са',
  'у',
  'ом',
  'е',
  'ят',
  'ни',
  'ца',
  'ц',
  'ы',
  'це',
  'й',
  'со',
  'м',
  'а'
])

describe('buildWakeKeywordList', () => {
  it('spells phrases in model pieces with a word-start marker, labelled by the phrase', () => {
    const { keywords, skipped } = buildWakeKeywordList(['Джарвис', 'Эй, Джарвис'], VOCABULARY)
    const lines = keywords.split('\n')
    expect(lines).toContain('▁д жа р ви с @джарвис')
    expect(lines).toContain('▁э й ▁д жа р ви с @эй_джарвис')
    expect(skipped).toEqual([])
  })

  it('adds inflected decoys so "в эту пятницу" cannot address "Пятница"', () => {
    const lines = buildWakeKeywordList(['Пятница'], VOCABULARY).keywords.split('\n')
    expect(lines).toContain('▁п ят ни ца @пятница')
    expect(lines).toContain('▁п ят ни ц у @~пятницу')
    expect(lines).toContain('▁п ят ни ц ы @~пятницы')
  })

  it('skips phrases the vocabulary cannot spell instead of failing all of them', () => {
    const { keywords, skipped } = buildWakeKeywordList(['jarvis', 'джарвис'], VOCABULARY)
    expect(skipped).toEqual(['jarvis'])
    expect(keywords).toContain('@джарвис')
  })
})

describe('inflectedDecoyForms', () => {
  it('follows Russian spelling after hushing/velar stems and soft nouns', () => {
    expect(inflectedDecoyForms('пятница')).toEqual(['пятницу', 'пятницы', 'пятнице', 'пятницей'])
    expect(inflectedDecoyForms('алиса')).toEqual(['алису', 'алисы', 'алисе', 'алисой'])
    expect(inflectedDecoyForms('маша')).toEqual(['машу', 'маши', 'маше', 'машей'])
    expect(inflectedDecoyForms('соня')).toEqual(['соню', 'сони', 'соне', 'соней'])
    expect(inflectedDecoyForms('джарвис')).toEqual([
      'джарвиса',
      'джарвису',
      'джарвисом',
      'джарвисе'
    ])
  })
})
