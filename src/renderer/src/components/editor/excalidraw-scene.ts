import { z } from 'zod'

// Why: kept free of @excalidraw/excalidraw imports — that package needs a real canvas at module load.

const ExcalidrawSceneHeaderSchema = z.looseObject({
  type: z.literal('excalidraw'),
  source: z.string().optional()
})

export const EMPTY_EXCALIDRAW_SCENE = '{"type":"excalidraw"}'

/** Validates a `.excalidraw` document and returns its `source`; an empty file is a blank scene. */
export function readExcalidrawSceneSource(content: string): string | undefined {
  const data: unknown = JSON.parse(content.trim() === '' ? EMPTY_EXCALIDRAW_SCENE : content)
  return ExcalidrawSceneHeaderSchema.parse(data).source
}

/** Restores the file's original `source` so saving from Orca does not rewrite it to the app origin. */
export function withExcalidrawSceneSource(json: string, source: string | undefined): string {
  if (source === undefined) {
    return json
  }
  return JSON.stringify({ ...ExcalidrawSceneHeaderSchema.parse(JSON.parse(json)), source }, null, 2)
}

/** Maps an i18next language (`ja`, `pt-BR`) to the closest supported Excalidraw locale code. */
export function resolveExcalidrawLangCode(
  language: string | undefined,
  supportedCodes: readonly string[]
): string {
  const wanted = language?.toLowerCase()
  if (!wanted) {
    return 'en'
  }
  const base = wanted.split('-')[0]
  return (
    supportedCodes.find((code) => code.toLowerCase() === wanted) ??
    supportedCodes.find((code) => code.toLowerCase().split('-')[0] === base) ??
    'en'
  )
}
