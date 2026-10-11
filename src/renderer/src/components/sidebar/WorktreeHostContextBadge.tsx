import React from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * The chip that names the machine a workspace runs on — "Local Mac", an SSH host, and so on.
 *
 * Extracted from the sidebar card's meta row so a second surface can show the SAME chip instead of
 * growing a near-copy. The card still decides WHETHER to show it (only when the visible worktrees
 * span more than one host); other surfaces may show it unconditionally. That policy deliberately
 * stays with each caller — what is shared here is the appearance, not the decision.
 *
 * Deliberately not `DashboardHostBadge`: that one renders nothing for a local host, which is exactly
 * the label this has to be able to show.
 */
export function WorktreeHostContextBadge({
  label,
  className,
  tint = null
}: {
  label: string
  className?: string
  /** Host color shared with the card's left bar, so the chip reads as its legend. */
  tint?: string | null
}): React.JSX.Element {
  const style: (React.CSSProperties & { '--host-tint'?: string }) | undefined = tint
    ? { '--host-tint': tint }
    : undefined
  return (
    <Badge
      variant="hostContext"
      className={cn('max-w-[7rem]', className)}
      data-host-tint={tint ? '' : undefined}
      style={style}
    >
      <span className="truncate">{label}</span>
    </Badge>
  )
}
