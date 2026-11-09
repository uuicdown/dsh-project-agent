/** The built client bundle must survive being evaluated twice: the shell can load it under two revisions. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Evaluate the bundle against a loader that rejects a duplicate id, like the real module system does. */
function evaluateTwice(): void {
  const seen = new Set<string>()
  const window = {
    __ModuleLoader__: {
      load: (registration: { id: string }) => {
        if (seen.has(registration.id)) throw new Error(`client-modules: duplicate factory registration for "${registration.id}"`)
        seen.add(registration.id)
      },
    },
  }
  const run = (): unknown => new Function('window', 'require', code)(window, () => ({}))
  run()
  run()
}

describe('client bundle entry', () => {
  it('does not throw when the same bundle is evaluated twice', () => {
    expect(evaluateTwice).not.toThrow()
  })
})
