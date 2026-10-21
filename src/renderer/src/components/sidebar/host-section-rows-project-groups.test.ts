import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Row } from '../../../../shared/sidebar-list/row-types'
import {
  addHostSectionRows,
  type HostSectionOption
} from '../../../../shared/sidebar-list/host-section-rows'
import { getRenderRowKey } from './worktree-list/listing/render-row'

const OFFICE: ExecutionHostId = 'runtime:03ef704c-b180-4b10-998d-e28fbd5de9a3'
const HOSTS: HostSectionOption[] = [
  { id: 'local', kind: 'local', label: 'Local Mac', detail: 'This computer', health: 'local' },
  { id: OFFICE, kind: 'runtime', label: 'office', detail: 'Orca server', health: 'available' }
]

function repo(id: string, executionHostId?: ExecutionHostId): Repo {
  return { id, path: `/${id}`, displayName: id, badgeColor: '#000000', addedAt: 0, executionHostId }
}

function groupHeader(id: string, executionHostId?: ExecutionHostId): Row {
  const projectGroup: ProjectGroup = {
    id,
    name: id,
    parentPath: `/${id}`,
    connectionId: null,
    executionHostId,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
  return {
    type: 'header',
    key: `project-group:${id}`,
    label: id,
    count: 1,
    icon: { kind: 'project' },
    projectGroup,
    projectGroupDepth: 0
  }
}

function projectHeader(project: Repo): Row {
  return {
    type: 'header',
    key: `repo:${project.id}`,
    label: project.id,
    count: 1,
    icon: { kind: 'project' },
    repo: project
  }
}

function sectionedKeys(rows: Row[]): string[] {
  return addHostSectionRows({
    rows,
    hostOptions: HOSTS,
    workspaceHostScope: 'all',
    defaultHostId: 'local',
    localHostLabel: 'Local Mac'
  }).map(getRenderRowKey)
}

describe('project groups in host sections', () => {
  // Reported: a group floated above the host cards and headed the other host's ungrouped projects.
  it('places each project group, with only its own projects, inside its host section', () => {
    const rows = [
      groupHeader('prodent'),
      projectHeader(repo('bi')),
      groupHeader('kst21', OFFICE),
      projectHeader(repo('wstom', OFFICE)),
      projectHeader(repo('orca')),
      projectHeader(repo('riv', OFFICE))
    ]

    expect(sectionedKeys(rows)).toEqual([
      'host:local',
      'hdr:project-group:prodent',
      'hdr:repo:bi',
      'hdr:repo:orca',
      `host:${OFFICE}`,
      'hdr:project-group:kst21',
      'hdr:repo:wstom',
      'hdr:repo:riv'
    ])
  })

  it('keeps an ungrouped header repeated in each host section under a distinct render key', () => {
    const ungrouped: Row = {
      type: 'header',
      key: 'all',
      label: 'All',
      count: 2,
      icon: { kind: 'all' }
    }
    const rows = [ungrouped, projectHeader(repo('wstom', OFFICE)), projectHeader(repo('orca'))]

    expect(sectionedKeys(rows)).toEqual([
      'host:local',
      'hdr:local:all',
      'hdr:repo:orca',
      `host:${OFFICE}`,
      `hdr:${OFFICE}:all`,
      'hdr:repo:wstom'
    ])
  })
})
