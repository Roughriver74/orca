import { describe, expect, it } from 'vitest'
import {
  readExcalidrawSceneSource,
  resolveExcalidrawLangCode,
  withExcalidrawSceneSource
} from './excalidraw-scene'

describe('readExcalidrawSceneSource', () => {
  it('treats an empty file as a blank scene', () => {
    expect(readExcalidrawSceneSource('  \n')).toBeUndefined()
  })

  it('returns the source of a valid scene', () => {
    expect(
      readExcalidrawSceneSource('{"type":"excalidraw","source":"https://excalidraw.com"}')
    ).toBe('https://excalidraw.com')
  })

  it('rejects JSON that is not an Excalidraw scene', () => {
    expect(() => readExcalidrawSceneSource('{"type":"tldraw"}')).toThrow()
    expect(() => readExcalidrawSceneSource('{not json')).toThrow()
  })
})

describe('withExcalidrawSceneSource', () => {
  it('restores the original source and keeps the rest of the scene', () => {
    const exported = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'app://orca',
      elements: [{ id: 'a' }]
    })
    expect(JSON.parse(withExcalidrawSceneSource(exported, 'https://excalidraw.com'))).toEqual({
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: [{ id: 'a' }]
    })
  })

  it('leaves the export untouched when the file had no source', () => {
    const exported = '{"type":"excalidraw","source":"app://orca"}'
    expect(withExcalidrawSceneSource(exported, undefined)).toBe(exported)
  })
})

describe('resolveExcalidrawLangCode', () => {
  const supported = ['en', 'ja-JP', 'zh-CN', 'zh-TW', 'pt-PT', 'pt-BR']

  it.each([
    ['ja', 'ja-JP'],
    ['zh', 'zh-CN'],
    ['pt-BR', 'pt-BR'],
    ['xx', 'en'],
    [undefined, 'en']
  ])('maps %s to %s', (language, expected) => {
    expect(resolveExcalidrawLangCode(language, supported)).toBe(expected)
  })
})
