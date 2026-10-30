import { describe, expect, it } from 'vitest'
import {
  planTokenEconomizer,
  TOKEN_ECONOMIZER_AGENT_CLIS,
  type TokenEconomizerTarget
} from './token-economizer-plan'

const cloneDir = '/data/token-economizer/TokenEconomizer'
const claude = (installed: boolean): TokenEconomizerTarget => ({
  agent: 'claude',
  home: null,
  installed
})
const codex = (installed: boolean): TokenEconomizerTarget => ({
  agent: 'codex',
  home: '/home/u/.codex',
  installed
})
const omp = (installed: boolean): TokenEconomizerTarget => ({
  agent: 'omp',
  home: null,
  installed
})
const ompPackageDir = '/data/token-economizer/omp'
const plan = (enabled: boolean, targets: TokenEconomizerTarget[]) =>
  planTokenEconomizer({ enabled, cloneDir, ompPackageDir, targets })

describe('planTokenEconomizer for omp', () => {
  it('writes the package then links it on an empty profile', () => {
    expect(plan(true, [omp(false)])[0].steps).toEqual([
      { kind: 'write-package' },
      { kind: 'cli', args: ['plugin', 'install', ompPackageDir] }
    ])
  })

  it('only rewrites the package when already linked', () => {
    expect(plan(true, [omp(true)])[0].steps).toEqual([{ kind: 'write-package' }])
  })

  it('uninstalls then deletes the package, only when linked', () => {
    expect(plan(false, [omp(true)])[0].steps).toEqual([
      { kind: 'cli', args: ['plugin', 'uninstall', 'tokeneconomizer-orca'] },
      { kind: 'remove-package' }
    ])
    expect(plan(false, [omp(false)])[0].steps).toEqual([])
  })

  it('reads omp plugin list JSON', () => {
    const { isInstalled } = TOKEN_ECONOMIZER_AGENT_CLIS.omp
    expect(
      isInstalled('{"npm":[{"name":"tokeneconomizer-orca","enabled":true}],"marketplace":[]}')
    ).toBe(true)
    expect(isInstalled('{"npm":[{"name":"other"}],"marketplace":[]}')).toBe(false)
    expect(isInstalled('{"marketplace":[]}')).toBe(false)
  })
})

describe('planTokenEconomizer', () => {
  it('enables an empty home with marketplace add then install, plus codex hook trust', () => {
    expect(plan(true, [claude(false), codex(false)]).map(({ steps }) => steps)).toEqual([
      [
        { kind: 'cli', args: ['plugin', 'marketplace', 'add', cloneDir] },
        { kind: 'cli', args: ['plugin', 'install', 'tokeneconomizer@tokeneconomizer'] }
      ],
      [
        { kind: 'cli', args: ['plugin', 'marketplace', 'add', cloneDir] },
        { kind: 'cli', args: ['plugin', 'add', 'tokeneconomizer@tokeneconomizer'] },
        { kind: 'trust' }
      ]
    ])
  })

  it('does nothing for an installed home except codex trust', () => {
    expect(plan(true, [claude(true), codex(true)]).map(({ steps }) => steps)).toEqual([
      [],
      [{ kind: 'trust' }]
    ])
  })

  it('removes only installed homes', () => {
    expect(plan(false, [claude(false), codex(false)]).map(({ steps }) => steps)).toEqual([[], []])
    expect(plan(false, [claude(true), codex(true)]).map(({ steps }) => steps)).toEqual([
      [
        { kind: 'cli', args: ['plugin', 'uninstall', 'tokeneconomizer@tokeneconomizer'] },
        { kind: 'cli', args: ['plugin', 'marketplace', 'remove', 'tokeneconomizer'] }
      ],
      [
        { kind: 'cli', args: ['plugin', 'remove', 'tokeneconomizer@tokeneconomizer'] },
        { kind: 'cli', args: ['plugin', 'marketplace', 'remove', 'tokeneconomizer'] }
      ]
    ])
  })
})

describe('installed-state parsers', () => {
  it('reads Claude plugin list JSON', () => {
    const { isInstalled } = TOKEN_ECONOMIZER_AGENT_CLIS.claude
    expect(isInstalled('[{"id":"tokeneconomizer@tokeneconomizer","enabled":true}]')).toBe(true)
    expect(isInstalled('[{"id":"other@market"}]')).toBe(false)
    expect(isInstalled('[]')).toBe(false)
  })

  it('reads Codex plugin list rows', () => {
    const { isInstalled } = TOKEN_ECONOMIZER_AGENT_CLIS.codex
    expect(isInstalled('NAME  STATUS\ntokeneconomizer@tokeneconomizer  installed, enabled\n')).toBe(
      true
    )
    expect(isInstalled('tokeneconomizer@tokeneconomizer  available\n')).toBe(false)
    expect(isInstalled('')).toBe(false)
  })
})
