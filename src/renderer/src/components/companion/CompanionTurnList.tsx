import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { CompanionTurn } from './CompanionPanel'

type CompanionTurnListProps = {
  turns: CompanionTurn[]
  /** True while a dangling utterance is held — shows "…жду продолжения" below the turns. */
  isHolding: boolean
  partialText: string
}

/** The scrolling conversation transcript: past turns, the "…жду продолжения" hold
 *  indicator, and the live partial transcript — split out of `CompanionPanel` to keep
 *  that file under the repo's per-file line cap. */
export function CompanionTurnList({
  turns,
  isHolding,
  partialText
}: CompanionTurnListProps): React.JSX.Element {
  return (
    <div className="scrollbar-sleek flex-1 space-y-1.5 overflow-y-auto">
      {turns.map((turn) => (
        <div
          key={turn.id}
          className={cn(
            'rounded-lg px-2.5 py-1.5 whitespace-pre-wrap',
            turn.role === 'user' ? 'bg-white/5 text-white/90' : 'bg-white/10 text-white',
            turn.isError && 'text-destructive',
            turn.isDropped && 'bg-transparent text-white/30 italic'
          )}
        >
          {turn.text}
        </div>
      ))}
      {isHolding && (
        <div className="rounded-lg px-2.5 py-1.5 text-white/40 italic">
          {translate('companion.panel.holdingContinuation', '…жду продолжения')}
        </div>
      )}
      {partialText !== '' && (
        <div className="rounded-lg px-2.5 py-1.5 text-white/50 italic">{partialText}</div>
      )}
    </div>
  )
}
