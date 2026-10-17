import { useMemo, useState } from 'react'
import type { AgentSessionBackgroundTask } from '../../../../shared/agent-session-wire'
import { NativeChatBackgroundTasksStatus } from './NativeChatBackgroundTasksStatus'
import { foldNativeChatTranscriptBackgroundTasks } from './native-chat-transcript-background-tasks'

const NO_STOPPING: ReadonlySet<string> = new Set()
const NO_STOP = (): void => {}

/** The session with background-job snapshots folded out of its transcript into a roster. */
export function useNativeChatTranscriptBackgroundTasks<
  S extends { messages: Parameters<typeof foldNativeChatTranscriptBackgroundTasks>[0] }
>(
  session: S
): { session: S; tasks: AgentSessionBackgroundTask[]; settledTasks: AgentSessionBackgroundTask[] } {
  return useMemo(() => {
    const folded = foldNativeChatTranscriptBackgroundTasks(session.messages)
    return {
      session:
        folded.messages === session.messages ? session : { ...session, messages: folded.messages },
      tasks: folded.tasks,
      settledTasks: folded.settledTasks
    }
  }, [session])
}

/** The background-jobs strip for a terminal agent: what runs beside the turn and for how long.
 *  Read-only — the transcript gives Orca no handle to stop a job. */
export function NativeChatTranscriptBackgroundTasks(props: {
  tasks: readonly AgentSessionBackgroundTask[]
  settledTasks: readonly AgentSessionBackgroundTask[]
  isVisible: boolean
  turnActive: boolean
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  if (props.tasks.length === 0) {
    return null
  }
  return (
    <NativeChatBackgroundTasksStatus
      tasks={props.tasks}
      settledTasks={props.settledTasks}
      supportsTaskStop={false}
      supportsStopAll={false}
      stoppingTaskIds={NO_STOPPING}
      stoppingAll={false}
      indicatorActive={!props.turnActive}
      isVisible={props.isVisible}
      expanded={expanded}
      onExpandedChange={setExpanded}
      onStop={NO_STOP}
    />
  )
}
