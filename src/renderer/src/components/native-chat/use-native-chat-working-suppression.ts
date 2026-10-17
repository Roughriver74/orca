import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { shouldClearNativeChatWorkingSuppression } from './native-chat-working-suppression'

/** Local Stop suppression of the working state: set on Stop, cleared when live work ends
 *  or a newer working epoch starts (see shouldClearNativeChatWorkingSuppression). */
export function useNativeChatWorkingSuppression(
  liveWorking: boolean,
  hookWorkingEpoch: number | null
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [workingInterrupted, setWorkingInterrupted] = useState(false)
  const previousWorkingEpochRef = useRef<number | null>(null)
  useEffect(() => {
    if (
      shouldClearNativeChatWorkingSuppression({
        working: liveWorking,
        interrupted: workingInterrupted,
        workingEpoch: hookWorkingEpoch,
        previousWorkingEpoch: previousWorkingEpochRef.current
      })
    ) {
      setWorkingInterrupted(false)
    }
    if (liveWorking && hookWorkingEpoch != null) {
      previousWorkingEpochRef.current = hookWorkingEpoch
    }
    if (!liveWorking) {
      previousWorkingEpochRef.current = null
    }
  }, [liveWorking, workingInterrupted, hookWorkingEpoch])
  return [workingInterrupted, setWorkingInterrupted]
}
