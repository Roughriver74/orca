import { posix } from 'node:path'
import { clipboardFormatsIncludeImage } from '../../shared/clipboard-image'
import { readWindowsCopiedImageFilePath } from './clipboard-windows-image-file'
import { readClipboardCopiedFilePaths } from './clipboard-copied-file-paths'
import { isCopiedImageFileExtension } from './clipboard-copied-image-file'

type ClipboardImageReader = {
  availableFormats: () => string[]
  readBuffer: (format: string) => Buffer
}

/** `imageFilePath`: the one JPEG/PNG file a file manager or screenshot tool copied. */
type ClipboardImageSource =
  | { kind: 'native'; imageFilePath: string | null }
  | { kind: 'file'; imageFilePath: string }

function readPosixCopiedImageFilePath(
  clipboard: ClipboardImageReader,
  platform: NodeJS.Platform
): string | null {
  const paths = readClipboardCopiedFilePaths(clipboard, platform)
  return paths.length === 1 && isCopiedImageFileExtension(posix.extname(paths[0])) ? paths[0] : null
}

/** Select image sources without decoding pixels or reading a copied file. */
export function readClipboardImageSource(
  clipboard: ClipboardImageReader,
  platform: NodeJS.Platform = process.platform
): ClipboardImageSource | null {
  const windowsImageFilePath =
    platform === 'win32'
      ? readWindowsCopiedImageFilePath({
          fileNameW: clipboard.readBuffer('FileNameW'),
          shellIdListArray: clipboard.readBuffer('Shell IDList Array')
        })
      : null
  if (clipboardFormatsIncludeImage(clipboard.availableFormats())) {
    return { kind: 'native', imageFilePath: windowsImageFilePath }
  }
  // Why: macOS reports only text/uri-list when a file URL leads the pasteboard (CleanShot, Finder), hiding its image.
  const imageFilePath =
    platform === 'win32' ? windowsImageFilePath : readPosixCopiedImageFilePath(clipboard, platform)
  return imageFilePath ? { kind: 'file', imageFilePath } : null
}
