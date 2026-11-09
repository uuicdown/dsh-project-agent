/** Resolves packaged asset paths from either the source tree or the compiled lib/ output. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let cached: string | undefined
/** Package names this fork may be installed under, upstream and renamed. */
const PACKAGE_NAMES = new Set(['dsh-superagent', 'dsh-project-agent'])
export function packageRoot(): string {
  if (cached) return cached
  let directory = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth++) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      try { if (PACKAGE_NAMES.has((JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name ?? '')) return cached = directory }
      catch { /* A foreign package.json on the way up is not this package. */ }
    }
    directory = dirname(directory)
  }
  throw new Error('dsh-project-agent package root not found')
}
export const packagePath = (...parts: string[]): string => join(packageRoot(), ...parts)
