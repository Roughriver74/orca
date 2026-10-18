import { translate } from '@/i18n/i18n'
import type { CompanionAgentNotice } from '../../../../shared/companion-types'

type CompanionNoticeToastProps = {
  notice: CompanionAgentNotice
  onRespond: (action: 'discuss' | 'later') => void
}

export function CompanionNoticeToast({
  notice,
  onRespond
}: CompanionNoticeToastProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/90 p-3 text-sm text-white shadow-2xl backdrop-blur-xl">
      <p className="text-white/90">{notice.text}</p>
      <div className="flex justify-end gap-2 text-xs font-medium">
        <button
          type="button"
          onClick={() => onRespond('discuss')}
          className="rounded-md bg-white/15 px-2.5 py-1 hover:bg-white/25"
        >
          {translate('companion.panel.notice.discuss', 'Обсудить')}
        </button>
        <button
          type="button"
          onClick={() => onRespond('later')}
          className="rounded-md px-2.5 py-1 text-white/70 hover:bg-white/10"
        >
          {translate('companion.panel.notice.later', 'Позже')}
        </button>
      </div>
    </div>
  )
}
