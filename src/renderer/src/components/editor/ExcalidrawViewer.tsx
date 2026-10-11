import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Excalidraw,
  getNonDeletedElements,
  hashElementsVersion,
  languages,
  loadFromBlob,
  serializeAsJSON
} from '@excalidraw/excalidraw'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState
} from '@excalidraw/excalidraw/types'
import type {
  ExcalidrawElement,
  OrderedExcalidrawElement
} from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import { useDocumentDarkTheme } from '@/hooks/use-document-dark-theme'
import { translate } from '@/i18n/i18n'
import { installEditorSaveShortcut } from './editor-shortcuts'
import {
  EMPTY_EXCALIDRAW_SCENE,
  readExcalidrawSceneSource,
  resolveExcalidrawLangCode,
  withExcalidrawSceneSource
} from './excalidraw-scene'

type ExcalidrawViewerProps = {
  content: string
  readOnly: boolean
  onContentChange: (content: string) => void
  onSave: (content: string) => Promise<boolean>
}

const FLUSH_DELAY_MS = 300
const EXCALIDRAW_LANG_CODES = languages.map((language) => language.code)

function loadScene(content: string) {
  const json = content.trim() === '' ? EMPTY_EXCALIDRAW_SCENE : content
  return loadFromBlob(new Blob([json], { type: 'application/json' }), null, null)
}

export default function ExcalidrawViewer(props: ExcalidrawViewerProps): React.JSX.Element {
  const parseError = useMemo(() => {
    try {
      readExcalidrawSceneSource(props.content)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, [props.content])

  if (parseError !== null) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {translate(
          'auto.components.editor.ExcalidrawViewer.4b306c693f',
          'Cannot display this Excalidraw file: {{value0}}',
          { value0: parseError }
        )}
      </div>
    )
  }
  return <ExcalidrawCanvas {...props} />
}

function ExcalidrawCanvas({
  content,
  readOnly,
  onContentChange,
  onSave
}: ExcalidrawViewerProps): React.JSX.Element {
  const isDark = useDocumentDarkTheme()
  const { i18n } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  // Why: the canvas owns the scene after mount; this tracks what the editor buffer already holds.
  const canvasContentRef = useRef(content)
  const sourceRef = useRef(readExcalidrawSceneSource(content))
  // Why: Excalidraw repairs and normalizes scenes as it applies them, so the baseline is the first scene
  // onChange reports after a load, not the raw file — otherwise merely opening a file marks it dirty.
  const baselineRef = useRef<string | null>(null)
  const awaitingBaselineRef = useRef(false)
  const versionRef = useRef<string | null>(null)
  const fittedRef = useRef(false)
  // Why: Excalidraw clears its scene in componentWillUnmount, before our unmount flush runs, so the
  // flush serializes the last scene onChange reported instead of reading the live API.
  const latestSceneRef = useRef<{
    elements: readonly OrderedExcalidrawElement[]
    appState: AppState
    files: BinaryFiles
  } | null>(null)
  const flushTimerRef = useRef<number | undefined>(undefined)
  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange

  const serializeScene = useCallback(
    (elements: readonly ExcalidrawElement[], appState: Partial<AppState>, files: BinaryFiles) =>
      withExcalidrawSceneSource(
        serializeAsJSON(getNonDeletedElements(elements), appState, files, 'local'),
        sourceRef.current
      ),
    []
  )

  const flush = useCallback((): string => {
    window.clearTimeout(flushTimerRef.current)
    const scene = latestSceneRef.current
    const next =
      baselineRef.current === null || !scene
        ? null
        : serializeScene(scene.elements, scene.appState, scene.files)
    if (next === null || next === baselineRef.current) {
      return canvasContentRef.current
    }
    baselineRef.current = next
    canvasContentRef.current = next
    onContentChangeRef.current(next)
    return next
  }, [serializeScene])

  const [initialData] = useState<Promise<ExcalidrawInitialDataState>>(() =>
    loadScene(content).then((scene) => {
      awaitingBaselineRef.current = true
      return { ...scene, scrollToContent: true }
    })
  )

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      latestSceneRef.current = { elements, appState, files }
      const version = `${hashElementsVersion(elements)}:${appState.viewBackgroundColor}:${Object.keys(files).length}`
      if (awaitingBaselineRef.current) {
        awaitingBaselineRef.current = false
        versionRef.current = version
        baselineRef.current = serializeScene(elements, appState, files)
        if (!fittedRef.current) {
          fittedRef.current = true
          apiRef.current?.scrollToContent(undefined, {
            fitToViewport: true,
            viewportZoomFactor: 0.9
          })
        }
        return
      }
      if (version === versionRef.current) {
        return
      }
      versionRef.current = version
      if (readOnly || baselineRef.current === null) {
        return
      }
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = window.setTimeout(flush, FLUSH_DELAY_MS)
    },
    [flush, readOnly, serializeScene]
  )

  // Why: external edits (reload from disk, revert) replace the buffer; mirror them into the live canvas.
  useEffect(() => {
    if (content === canvasContentRef.current) {
      return
    }
    canvasContentRef.current = content
    sourceRef.current = readExcalidrawSceneSource(content)
    baselineRef.current = null
    let cancelled = false
    void loadScene(content).then((scene) => {
      const api = apiRef.current
      if (cancelled || !api) {
        return
      }
      awaitingBaselineRef.current = true
      api.addFiles(Object.values(scene.files))
      api.updateScene({
        elements: scene.elements,
        appState: { viewBackgroundColor: scene.appState.viewBackgroundColor }
      })
    })
    return () => {
      cancelled = true
    }
  }, [content, serializeScene])

  useEffect(() => {
    const root = rootRef.current
    if (!root || readOnly) {
      return
    }
    return installEditorSaveShortcut(root, () => {
      void onSave(flush())
    })
  }, [flush, onSave, readOnly])

  // Why: switching to Source or closing the tab must not drop edits still inside the debounce window.
  useEffect(() => () => void flush(), [flush])

  return (
    <div ref={rootRef} className="h-full min-h-0">
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={(api) => {
          apiRef.current = api
        }}
        onChange={handleChange}
        theme={isDark ? 'dark' : 'light'}
        langCode={resolveExcalidrawLangCode(i18n.language, EXCALIDRAW_LANG_CODES)}
        viewModeEnabled={readOnly}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false }
        }}
      />
    </div>
  )
}
