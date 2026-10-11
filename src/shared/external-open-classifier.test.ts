import { describe, expect, it } from 'vitest'
import { shouldOpenWithDefaultApp } from './external-open-classifier'

describe('shouldOpenWithDefaultApp', () => {
  it('routes known office/archive/compiled binary formats to the default app', () => {
    for (const path of [
      '/repo/report.docx',
      '/repo/budget.xlsx',
      '/repo/slides.pptx',
      '/repo/legacy.doc',
      '/repo/legacy.xls',
      '/repo/legacy.ppt',
      '/repo/export.pages',
      '/repo/archive.zip',
      '/repo/archive.tar.gz',
      '/repo/font.ttf',
      '/repo/app.exe',
      '/repo/library.dylib',
      '/repo/data.sqlite'
    ]) {
      expect(shouldOpenWithDefaultApp(path)).toBe(true)
    }
  })

  it('keeps extensions Orca already renders in-app out of the default-app path', () => {
    for (const path of [
      '/repo/photo.png',
      '/repo/photo.jpg',
      '/repo/icon.svg',
      '/repo/doc.pdf',
      '/repo/clip.mp4',
      '/repo/clip.mp3'
    ]) {
      expect(shouldOpenWithDefaultApp(path)).toBe(false)
    }
  })

  it('keeps text/code files and unknown/no-extension files out of the default-app path', () => {
    for (const path of [
      '/repo/src/index.ts',
      '/repo/README.md',
      '/repo/notes.txt',
      '/repo/Dockerfile',
      '/repo/.gitignore',
      '/repo/data.csv',
      '/repo/diagram.excalidraw'
    ]) {
      expect(shouldOpenWithDefaultApp(path)).toBe(false)
    }
  })
})
