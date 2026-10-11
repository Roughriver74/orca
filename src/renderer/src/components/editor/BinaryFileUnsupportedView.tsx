import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

// Why a separate component: the open button needs its own failure state, and hooks can't
// live inside the conditional branch this replaces in EditorEditFileSurface.
export function BinaryFileUnsupportedView({
  filePath,
  canOpenLocally
}: {
  filePath: string
  canOpenLocally: boolean
}): React.JSX.Element {
  const [openFailed, setOpenFailed] = useState(false)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
      <span>
        {translate(
          'auto.components.editor.EditorContent.b9de81ba52',
          'Binary file — cannot display'
        )}
      </span>
      {canOpenLocally && (
        <div className="flex flex-col items-center gap-2">
          {openFailed && (
            <p className="text-xs text-muted-foreground" role="alert">
              {translate('mediaPreview.openFailed', 'Could not open this file in the default app.')}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                setOpenFailed(!(await window.api.shell.openFilePath(filePath)))
              } catch {
                setOpenFailed(true)
              }
            }}
          >
            {translate('mediaPreview.openDefault', 'Open in Default App')}
          </Button>
        </div>
      )}
    </div>
  )
}
