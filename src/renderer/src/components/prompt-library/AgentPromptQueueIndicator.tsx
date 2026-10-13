import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { clearAgentPromptQueue, useAgentPromptQueue } from './agent-prompt-queue'

/** Compact "N queued" badge for a pane's pending follow-up prompts (see
 *  `agent-prompt-queue.ts`). Renders nothing while the queue is empty. */
export function AgentPromptQueueIndicator({
  paneKey
}: {
  paneKey: string
}): React.JSX.Element | null {
  const queue = useAgentPromptQueue(paneKey)

  if (queue.length === 0) {
    return null
  }

  const label = translate(
    'auto.components.prompt-library.AgentPromptQueueIndicator.count',
    '{{value0}} queued',
    { value0: queue.length }
  )
  const clearLabel = translate(
    'auto.components.prompt-library.AgentPromptQueueIndicator.clear',
    'Clear queued prompts'
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary">
          <span>{label}</span>
          <button
            type="button"
            aria-label={clearLabel}
            onClick={(event) => {
              event.stopPropagation()
              clearAgentPromptQueue(paneKey)
            }}
            className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full hover:bg-accent/80"
          >
            <X className="size-2.5" aria-hidden="true" />
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="max-w-xs">
        <ol className="list-decimal space-y-1 pl-4 text-left">
          {queue.map((item) => (
            <li key={item.id} className="truncate">
              {item.text}
            </li>
          ))}
        </ol>
      </TooltipContent>
    </Tooltip>
  )
}
