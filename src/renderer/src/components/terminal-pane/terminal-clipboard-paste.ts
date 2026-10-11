import {
  isClipboardTextTooLargeError,
  type ReadClipboardTextOptions
} from '../../../../shared/clipboard-text'
import { TERMINAL_PASTE_MAX_BYTES } from './terminal-paste-limits'
import type { TerminalPasteTextOptions } from './terminal-paste-model'

type SaveClipboardImageAsTempFile = (args?: {
  connectionId?: string | null
  runtimeEnvironmentId?: string | null
}) => Promise<string | null>

type PasteTerminalClipboardDeps = {
  readClipboardText: (options?: ReadClipboardTextOptions) => Promise<string>
  readClipboardFilePaths?: () => Promise<string[]>
  saveClipboardImageAsTempFile: SaveClipboardImageAsTempFile
  pasteText: (
    text: string,
    options?: TerminalPasteTextOptions
  ) => boolean | void | Promise<boolean | void>
  /** Pastes absolute local paths a file manager copied; undefined leaves file
   *  copies to fall through to the ordinary text/image paste path. */
  pasteFilePaths?: (paths: string[]) => boolean | void | Promise<boolean | void>
  connectionId?: string | null
  runtimeEnvironmentId?: string | null
  forceBracketedMultilineTextPaste?: boolean
  protectedMultilineTextPasteOptions?: TerminalPasteTextOptions
  onTextPasteError?: (error: unknown) => void
  onFilePathsPasteError?: (error: unknown) => void
  onImagePasteError?: (error: unknown) => void
}

export type TerminalClipboardPasteResult =
  | { status: 'pasted'; kind: 'file-paths' | 'image-path' | 'text' }
  | {
      status: 'skipped'
      reason:
        | 'empty'
        | 'file-paths-paste-failed'
        | 'file-paths-paste-rejected'
        | 'image-paste-failed'
        | 'image-paste-rejected'
        | 'text-paste-failed'
        | 'text-paste-rejected'
        | 'text-too-large'
    }
export async function pasteTerminalClipboard({
  readClipboardText,
  readClipboardFilePaths,
  saveClipboardImageAsTempFile,
  pasteText,
  pasteFilePaths,
  connectionId,
  runtimeEnvironmentId,
  forceBracketedMultilineTextPaste = false,
  protectedMultilineTextPasteOptions,
  onTextPasteError,
  onFilePathsPasteError,
  onImagePasteError
}: PasteTerminalClipboardDeps): Promise<TerminalClipboardPasteResult> {
  // Why: a file manager copy also puts the files' names on the clipboard as
  // text, which this paste must never type — so files are checked, and acted
  // on, before text or an image are even considered (issue request STA-clip).
  if (pasteFilePaths) {
    const filePaths = await readClipboardFilePaths?.().catch(() => [] as string[])
    if (filePaths && filePaths.length > 0) {
      try {
        const result = await pasteFilePaths(filePaths)
        if (result === false) {
          return { status: 'skipped', reason: 'file-paths-paste-rejected' }
        }
        return { status: 'pasted', kind: 'file-paths' }
      } catch (error) {
        onFilePathsPasteError?.(error)
        return { status: 'skipped', reason: 'file-paths-paste-failed' }
      }
    }
  }

  let text = ''
  try {
    text = await readClipboardText({ maxBytes: TERMINAL_PASTE_MAX_BYTES })
  } catch (error) {
    if (isClipboardTextTooLargeError(error)) {
      onTextPasteError?.(error)
      return { status: 'skipped', reason: 'text-too-large' }
    }
    // Why: browser clipboard text reads can fail for image-only clipboards.
    // Still try the image path so Cmd/Ctrl+V works for screenshots.
  }
  if (text) {
    try {
      const textOptions =
        protectedMultilineTextPasteOptions ??
        (forceBracketedMultilineTextPaste ? { forceBracketedPasteForMultiline: true } : undefined)
      const result = await (textOptions ? pasteText(text, textOptions) : pasteText(text))
      if (result === false) {
        return { status: 'skipped', reason: 'text-paste-rejected' }
      }
      return { status: 'pasted', kind: 'text' }
    } catch (error) {
      onTextPasteError?.(error)
      return { status: 'skipped', reason: 'text-paste-failed' }
    }
  }

  try {
    const filePath = await saveClipboardImageAsTempFile({ connectionId, runtimeEnvironmentId })
    if (!filePath) {
      return { status: 'skipped', reason: 'empty' }
    }
    const result = await pasteText(filePath, {
      // Why: a generated clipboard-image path is terminal image injection, not
      // ordinary one-line text. Keep it off the Ctrl+C stale-text paste path.
      forceBracketedPaste: true,
      recoverImagePasteWebglAtlas: true
    })
    if (result === false) {
      return { status: 'skipped', reason: 'image-paste-rejected' }
    }
    return { status: 'pasted', kind: 'image-path' }
  } catch (error) {
    onImagePasteError?.(error)
    return { status: 'skipped', reason: 'image-paste-failed' }
  }
}
