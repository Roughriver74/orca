import { describe, expect, it, vi } from 'vitest'
import { readClipboardImageSource } from './clipboard-image-source'

function clipboardReader(
  filePath = '',
  itemCount = 1,
  formats: string[] = ['FileNameW'],
  extra: Record<string, string> = {},
  pasteboardTypes: string[] = []
) {
  const shellItems = Buffer.alloc(4 + 4 * (itemCount + 1))
  shellItems.writeUInt32LE(itemCount)
  const buffers: Record<string, Buffer> = {
    FileNameW: Buffer.from(`${filePath}\0`, 'utf16le'),
    'Shell IDList Array': shellItems,
    ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, Buffer.from(value)]))
  }
  return {
    availableFormats: vi.fn(() => formats),
    readBuffer: vi.fn((format: string) => buffers[format] ?? Buffer.alloc(0)),
    has: vi.fn((format: string) => pasteboardTypes.includes(format))
  }
}

describe('readClipboardImageSource', () => {
  it.each(['darwin', 'linux', 'win32'] as const)(
    'recognizes native image formats on %s without decoding',
    (platform) => {
      const clipboard = clipboardReader('', 1, ['text/plain', 'image/png'])
      expect(readClipboardImageSource(clipboard, platform)).toEqual({
        kind: 'native',
        imageFilePath: null
      })
      expect(clipboard.has).not.toHaveBeenCalled()
    }
  )

  it.each(['darwin', 'linux', 'win32'] as const)('ignores ordinary text on %s', (platform) => {
    expect(readClipboardImageSource(clipboardReader('', 1, ['text/plain']), platform)).toBeNull()
  })

  it.each([
    'C:\\Users\\alice\\图片\\shot.PNG',
    '\\\\server\\share\\shot.jpeg',
    '\\\\?\\C:\\Users\\alice\\shot.jpg',
    '\\\\?\\UNC\\server\\share\\shot.png'
  ])('recognizes a supported single Windows image file: %s', (filePath) => {
    const clipboard = clipboardReader(filePath)
    const source = readClipboardImageSource(clipboard, 'win32')
    expect(source).toEqual({ kind: 'file', imageFilePath: filePath })
  })

  it.each([
    ['C:\\shot.pdf', 1],
    ['C:\\shot.webp', 1],
    ['C:\\shot.png', 2],
    ['shot.png', 1],
    ['C:shot.png', 1],
    ['\\\\server\\pipe\\shot.png', 1],
    ['C:\\one.png\0C:\\two.png', 1]
  ])('rejects an unsupported file source: %s (%s items)', (filePath, itemCount) => {
    expect(readClipboardImageSource(clipboardReader(filePath, itemCount), 'win32')).toBeNull()
  })

  it.each(['darwin', 'linux'] as const)('never reads Windows file formats on %s', (platform) => {
    const clipboard = clipboardReader('C:\\shot.png')
    expect(readClipboardImageSource(clipboard, platform)).toBeNull()
    expect(clipboard.readBuffer).not.toHaveBeenCalledWith('FileNameW')
  })

  // CleanShot and Finder lead with a file URL; Electron then lists only text/uri-list.
  it.each([
    ['darwin', { 'public.file-url': 'file:///Users/me/Shots/Clean%20Shot@2x.png' }],
    ['linux', { 'text/uri-list': 'file:///home/me/shot.JPG\r\n' }]
  ] as const)('recognizes a copied image file on %s', (platform, buffers) => {
    const clipboard = clipboardReader('', 1, ['text/uri-list'], buffers)
    expect(readClipboardImageSource(clipboard, platform)).toEqual({
      kind: 'file',
      imageFilePath:
        platform === 'darwin' ? '/Users/me/Shots/Clean Shot@2x.png' : '/home/me/shot.JPG'
    })
  })

  it.each([
    ['a non-image file', { 'public.file-url': 'file:///Users/me/notes.pdf' }],
    [
      'several files',
      {
        NSFilenamesPboardType:
          '<plist><array><string>/Users/me/a.png</string><string>/Users/me/b.png</string></array></plist>'
      }
    ]
  ])('rejects %s copied on darwin', (_label, buffers) => {
    const clipboard = clipboardReader('', 1, ['text/uri-list'], buffers)
    expect(readClipboardImageSource(clipboard, 'darwin')).toBeNull()
  })

  it('keeps the copied-file fallback beside advertised native image data', () => {
    const clipboard = clipboardReader('C:\\shot.png', 1, ['image/png', 'FileNameW'])
    const source = readClipboardImageSource(clipboard, 'win32')
    expect(source?.kind).toBe('native')
    expect(source).toEqual({ kind: 'native', imageFilePath: 'C:\\shot.png' })
  })

  it.each([['public.png'], ['public.tiff']])(
    'recognizes a macOS image copied beside its file URL (%s)',
    (pasteboardType) => {
      const clipboard = clipboardReader(
        '',
        1,
        ['text/uri-list'],
        {},
        [pasteboardType, 'public.file-url']
      )
      expect(readClipboardImageSource(clipboard, 'darwin')).toEqual({
        kind: 'native',
        imageFilePath: null
      })
      expect(clipboard.readBuffer).not.toHaveBeenCalled()
    }
  )

  it('ignores a macOS file URL with no image data', () => {
    const clipboard = clipboardReader('', 1, ['text/uri-list'], {}, ['public.file-url'])
    expect(readClipboardImageSource(clipboard, 'darwin')).toBeNull()
  })

  it.each(['linux', 'win32'] as const)(
    'does not probe macOS pasteboard types on %s',
    (platform) => {
      const clipboard = clipboardReader('', 1, ['text/uri-list'], {}, ['public.png'])
      expect(readClipboardImageSource(clipboard, platform)).toBeNull()
      expect(clipboard.has).not.toHaveBeenCalled()
    }
  )
})
