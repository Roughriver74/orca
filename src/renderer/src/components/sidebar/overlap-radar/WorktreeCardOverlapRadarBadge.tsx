import React from 'react'
import { GitCompareArrows } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { useOverlapRadarPeers } from '@/store/overlap-radar-selectors'
import type { Worktree } from '../../../../../shared/worktree/types'
import { useOpenOverlapRadarFile } from './overlap-radar-open-file'

/** Small warning badge on a worktree's sidebar card when a sibling worktree of the same
 *  repo has changed one of the same files; the popover names the sibling(s) and the
 *  overlapping file(s), and clicking a file opens it in this worktree. */
export function WorktreeCardOverlapRadarBadge({
  worktree
}: {
  worktree: Worktree
}): React.JSX.Element | null {
  const peers = useOverlapRadarPeers(worktree.id)
  const openOverlapFile = useOpenOverlapRadarFile()

  if (peers.length === 0) {
    return null
  }

  const hasLockfileOverlap = peers.some((peer) => peer.files.some((file) => file.isLockfile))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="warning"
          className="cursor-pointer"
          aria-label={translate(
            'overlapRadar.badgeAriaLabel',
            'Overlapping changes with other workspaces'
          )}
        >
          <GitCompareArrows className="size-2.5" />
          {translate('overlapRadar.badge', 'Overlap')}
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="p-3 text-xs">
          <div className="mb-2 font-medium text-foreground">
            {translate('overlapRadar.popoverHeading', 'Overlapping changes')}
          </div>
          <div className="flex flex-col gap-3">
            {peers.map((peer) => (
              <div key={peer.worktreeId}>
                <div className="mb-1 truncate text-muted-foreground">
                  {translate('overlapRadar.alsoChangedIn', 'Also changed in {{workspace}}', {
                    workspace: peer.displayName
                  })}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {peer.files.map((file) => (
                    <li key={file.path}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 truncate rounded px-1 py-0.5 text-left font-mono text-foreground hover:bg-accent"
                        onClick={() =>
                          openOverlapFile({
                            worktreeId: worktree.id,
                            worktreePath: worktree.path,
                            path: file.path
                          })
                        }
                      >
                        <span className="truncate">{file.path}</span>
                        {file.isLockfile && (
                          <span className="shrink-0 text-muted-foreground">
                            {translate('overlapRadar.lockfileTag', 'lockfile')}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {hasLockfileOverlap && (
            <div className="mt-2 text-muted-foreground">
              {translate(
                'overlapRadar.lockfileNote',
                'Lockfiles are usually safe to regenerate and rarely need manual merging.'
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
