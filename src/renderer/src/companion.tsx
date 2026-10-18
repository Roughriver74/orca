// Why first, and why the import-free shim: react-dom reads
// __REACT_DEVTOOLS_GLOBAL_HOOK__ once at module evaluation, so the global has to
// exist before it. The observer below only wraps a property react-dom re-reads
// per commit, so its own import graph can evaluate whenever it likes.
import './lib/react-devtools-commit-hook-shim'
import './lib/react-commit-cascade-observer'
import './assets/main.css'

import { StrictMode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { CompanionPanel } from './components/companion/CompanionPanel'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import {
  installRendererCrashDiagnostics,
  recordRendererCrashBreadcrumb
} from './lib/crash-diagnostics'
import { applyDocumentTheme } from './lib/document-theme'
import { I18nProvider } from './i18n/I18nProvider'
import { translate } from './i18n/i18n'
import { getOrCreateRendererRoot } from './lib/react-renderer-root'
import { setReactCommitCascadeRendererSurface } from './lib/react-commit-cascade-telemetry'
import { useAppStore } from './store'
import type { GlobalSettings } from '../../shared/global-settings-types'
// Why: the companion panel is a separate BrowserWindow with its own React root,
// so it runs the same renderer bootstrap as main.tsx/popout.tsx (crash
// diagnostics, theme, i18n, error boundary) rather than inheriting anything.
recordRendererCrashBreadcrumb('companion_bootstrap_started', { dev: import.meta.env.DEV })
installRendererCrashDiagnostics('companion')
setReactCommitCascadeRendererSurface('companion')

// Why: always dark, transparent — the panel is a small floating overlay drawn
// over arbitrary apps, not a themed document window.
applyDocumentTheme('dark', { disableTransitions: true })

// Why: this window owns a separate renderer store; seed only `uiLanguage` so
// error-boundary/panel copy follows the user's language preference without
// pulling in the main window's full theme/font bootstrap (irrelevant here).
try {
  const startupSettings = window.api.settings.getSync()
  if (startupSettings) {
    useAppStore.setState({ settings: startupSettings })
  }
} catch {
  // Async hydration below remains available if the startup read fails.
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  recordRendererCrashBreadcrumb('companion_root_missing')
  throw new Error('Companion root element not found.')
}
function CompanionSettingsSync(): null {
  useEffect(() => {
    let disposed = false
    const setSettings = (next: GlobalSettings): void => {
      if (!disposed) {
        useAppStore.setState({ settings: next })
      }
    }
    const offChanged = window.api.settings.onChanged((updates) => {
      const current = useAppStore.getState().settings
      if (current) {
        setSettings({ ...current, ...updates })
      }
    })
    void window.api.settings
      .get()
      .then(setSettings)
      .catch(() => undefined)
    return () => {
      disposed = true
      offChanged()
    }
  }, [])
  return null
}

function CompanionRoot(): React.JSX.Element {
  useTranslation()
  useEffect(() => {
    recordRendererCrashBreadcrumb('companion_bootstrap_rendered')
  }, [])
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="companion.root"
      surface="companion"
      title={translate('companion.recoverableError.title', 'Джарвис завис.')}
      description={translate(
        'companion.recoverableError.description',
        'Панель не смогла отрисоваться. Закройте её и попробуйте снова.'
      )}
    >
      <CompanionPanel />
    </RecoverableRenderErrorBoundary>
  )
}

getOrCreateRendererRoot(rootElement, import.meta.hot?.data).render(
  <StrictMode>
    <I18nProvider>
      <CompanionSettingsSync />
      <CompanionRoot />
    </I18nProvider>
  </StrictMode>
)
