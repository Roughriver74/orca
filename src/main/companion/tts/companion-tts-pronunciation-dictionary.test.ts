import { describe, expect, it, vi } from 'vitest'
import {
  createPronunciationDictionaryLoader,
  parsePronunciationDictionary,
  type CompanionPronunciationFs
} from './companion-tts-pronunciation-dictionary'

describe('parsePronunciationDictionary', () => {
  it('reads `english = как читать` lines, skipping comments, blanks and junk', () => {
    const dictionary = parsePronunciationDictionary(
      [
        '# Словарь произношения',
        'Worktree = вёрктри',
        '  Pull   Request =  пул реквест  # частое',
        '',
        'без равенства',
        'пусто =',
        'кириллица = не ключ',
        '= нет ключа'
      ].join('\n')
    )
    expect([...dictionary]).toEqual([
      ['worktree', 'вёрктри'],
      ['pull request', 'пул реквест']
    ])
  })
})

function fakeFs(files: Record<string, { text: string; mtimeMs: number }>): {
  fs: CompanionPronunciationFs
  readFile: ReturnType<typeof vi.fn>
} {
  const readFile = vi.fn(async (path: string) => files[path].text)
  return {
    readFile,
    fs: {
      stat: async (path) => {
        const file = files[path]
        if (!file) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
        return { mtimeMs: file.mtimeMs, size: file.text.length }
      },
      readFile
    }
  }
}

describe('createPronunciationDictionaryLoader', () => {
  it('re-reads the file only after it changes', async () => {
    const files = { '/home/d.txt': { text: 'commit = комит', mtimeMs: 1 } }
    const { fs, readFile } = fakeFs(files)
    const load = createPronunciationDictionaryLoader(fs)

    expect((await load('/home/d.txt')).get('commit')).toBe('комит')
    await load('/home/d.txt')
    expect(readFile).toHaveBeenCalledTimes(1)

    files['/home/d.txt'] = { text: 'commit = коммит', mtimeMs: 2 }
    expect((await load('/home/d.txt')).get('commit')).toBe('коммит')
    expect(readFile).toHaveBeenCalledTimes(2)
  })

  it('treats a missing file as an empty dictionary', async () => {
    const { fs } = fakeFs({})
    const load = createPronunciationDictionaryLoader(fs)
    expect((await load('/nowhere.txt')).size).toBe(0)
  })

  it('degrades to an empty dictionary on an unreadable file instead of failing the reply', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const load = createPronunciationDictionaryLoader({
      stat: async () => ({ mtimeMs: 1, size: 1 }),
      readFile: async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      }
    })
    expect((await load('/locked.txt')).size).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
