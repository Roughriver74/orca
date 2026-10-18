// Decides whether a finalized STT utterance looks cut off mid-thought — the panel holds
// such utterances a few seconds instead of handing them straight to the brain (see
// CompanionPanel.tsx's handleFinalText). Two independent signals, either one is enough:
//   - it ends on a comma/colon/semicolon/dash, which audibly continues a clause;
//   - its last word is a conjunction/preposition/particle that cannot end a sentence on
//     its own ("я пошёл в", "потому что").
// A sentence-terminating "./!/?" always wins over both: "...и т.д." and "...и всё."  are
// deliberately NOT dangling even though "т.д."/"всё" would otherwise look suspicious, because
// the user explicitly closed the thought.

const TRAILING_CLAUSE_PUNCTUATION = /[,:;—–-]\s*$/
const TRAILING_SENTENCE_PUNCTUATION = /[.!?]\s*$/

/** Conjunctions/prepositions/particles that cannot be the last word of a finished thought. */
const DANGLING_TRAILING_WORDS: Record<string, true> = {
  и: true,
  а: true,
  но: true,
  или: true,
  что: true,
  чтобы: true,
  если: true,
  когда: true,
  потому: true,
  в: true,
  на: true,
  с: true,
  к: true,
  по: true,
  для: true,
  у: true,
  от: true,
  за: true,
  ну: true,
  вот: true,
  типа: true
}

export function isCompanionUtteranceDangling(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') {
    return false
  }
  if (TRAILING_CLAUSE_PUNCTUATION.test(trimmed)) {
    return true
  }
  if (TRAILING_SENTENCE_PUNCTUATION.test(trimmed)) {
    return false
  }
  const words = trimmed.toLowerCase().match(/[а-яё]+/gu)
  const lastWord = words?.at(-1)?.replace(/ё/g, 'е')
  if (lastWord === undefined) {
    return false
  }
  return lastWord in DANGLING_TRAILING_WORDS
}
