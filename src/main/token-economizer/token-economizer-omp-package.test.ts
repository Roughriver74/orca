import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  renderOmpExtension,
  renderOmpPackageJson,
  renderPiShim
} from './token-economizer-omp-package'

describe('omp wrapper package', () => {
  it('declares the extension omp loads', () => {
    expect(JSON.parse(renderOmpPackageJson())).toMatchObject({
      name: 'tokeneconomizer-orca',
      omp: { extensions: ['./tokeneconomizer-omp.ts'] }
    })
  })

  it('JSON-quotes paths so Windows backslashes survive', () => {
    const source = renderOmpExtension({ cloneDir: 'C:\\Users\\me\\te', shimDir: 'C:\\o"mp\\shim' })
    expect(source).toContain(
      JSON.stringify(join('C:\\Users\\me\\te', 'plugin', 'pi', 'tokeneconomizer.ts'))
    )
  })

  it('single-quotes the omp path in the pi shim, escaping embedded quotes', () => {
    expect(renderPiShim("/opt/it's/omp")).toContain(`exec '/opt/it'\\''s/omp' "$@"`)
    expect(renderPiShim('/bin/omp')).toContain('--no-prompt-templates|--offline|--no-mcp) ;;')
  })
})
