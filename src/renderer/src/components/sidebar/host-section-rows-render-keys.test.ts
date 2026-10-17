import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { Row } from './worktree-list/grouping/row-types'
import { addHostSectionRows } from './host-section-rows'
import { getRenderRowKey } from './worktree-list/listing/render-row'

function repo(id: string, connectionId: string | null): Repo {
  return { id, path: `/${id}`, displayName: id, badgeColor: '#000000', addedAt: 0, connectionId }
}

function item(id: string, project: Repo): Extract<Row, { type: 'item' }> {
  const sectionKey = 'project-group:prodent'
  return {
    type: 'item',
    rowKey: `${sectionKey}:${id}`,
    sectionKey,
    worktree: {
      id,
      repoId: project.id,
      path: `/${project.id}/${id}`,
      branch: `refs/heads/${id}`,
      head: 'abc123',
      isBare: false,
      isMainWorktree: false,
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      isArchived: false,
      comment: '',
      isUnread: false,
      isPinned: false,
      displayName: id,
      sortOrder: 0,
      lastActivityAt: 0
    },
    repo: project,
    depth: 0,
    groupDepth: 0,
    lineageTrail: [],
    isLastLineageChild: true,
    lineageChildCount: 0
  }
}

describe('host section render keys', () => {
  // A shared render key made the virtualizer paint one host's group header behind the other's card.
  it('gives a cross-host project group header a distinct render key in each host section', () => {
    const group: Row = {
      type: 'header',
      key: 'project-group:prodent',
      label: 'PRODENT SHARQ',
      count: 2,
      tone: 'text-foreground'
    }
    const rows = [
      group,
      item('ssh-wt', repo('ssh', 'ssh-1')),
      item('local-wt', repo('local', null))
    ]

    const sectioned = addHostSectionRows({
      rows,
      hostOptions: [
        {
          id: 'local',
          kind: 'local',
          label: 'Local Mac',
          detail: 'This computer',
          health: 'local'
        },
        { id: 'ssh:ssh-1', kind: 'ssh', label: 'office', detail: 'SSH', health: 'available' }
      ],
      workspaceHostScope: 'all',
      defaultHostId: 'local'
    })

    const renderKeys = sectioned.map(getRenderRowKey)
    expect(renderKeys).toEqual([
      'host:local',
      'hdr:local:project-group:prodent',
      'wt:project-group:prodent:local-wt',
      'host:ssh:ssh-1',
      'hdr:ssh:ssh-1:project-group:prodent',
      'wt:project-group:prodent:ssh-wt'
    ])
  })
})
