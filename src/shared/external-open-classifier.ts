import { hasBinaryFileExtension } from './binary-file-extensions'
import { IMAGE_FILE_EXTENSIONS } from './image-file-extensions'
import { MEDIA_FILE_MIME_TYPES } from './media-file-extensions'

const PDF_EXTENSION = '.pdf'

function extname(filePath: string): string {
  const lowerPath = filePath.toLowerCase()
  const dotIndex = lowerPath.lastIndexOf('.')
  const separatorIndex = Math.max(lowerPath.lastIndexOf('/'), lowerPath.lastIndexOf('\\'))
  // A leading dot is a dotfile (.gitignore), not an extension.
  if (dotIndex <= separatorIndex + 1) {
    return ''
  }
  return lowerPath.slice(dotIndex)
}

/**
 * Whether double-clicking this file in the explorer should hand off to the OS default app
 * instead of opening an Orca tab. True for known-binary formats Orca can't render in-app
 * (.docx, .xlsx, .zip, compiled artifacts, fonts, ...); false for text/code and for the
 * binary formats Orca already has a viewer for (images, PDF, playable media, via `ImageViewer`/
 * `MediaViewer`) — those are excluded even though some (e.g. .pdf) are in `BINARY_FILE_EXTENSIONS`
 * too, since that list only answers "is this not text", not "does Orca have a viewer for it".
 */
export function shouldOpenWithDefaultApp(filePath: string): boolean {
  const ext = extname(filePath)
  const isNativelyRenderable =
    ext === PDF_EXTENSION || IMAGE_FILE_EXTENSIONS.includes(ext) || ext in MEDIA_FILE_MIME_TYPES
  if (!ext || isNativelyRenderable) {
    return false
  }
  return hasBinaryFileExtension(filePath)
}
