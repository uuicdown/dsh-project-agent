/** Reader of the local plugin-market cache: ranks candidate skill providers by keyword hits and stars. */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface Repository {
  full_name: string
  name: string
  description?: string
  stargazers_count?: number
  topics?: string[]
  pkg_name?: string
  version?: string
}

let cached: { path: string; mtimeMs: number; repositories: Repository[] } | undefined

/** The marketplace index the Client keeps on disk, reloaded only when it changes. */
function load(): Repository[] {
  const path = process.env.DSH_MARKET_CACHE ?? join(homedir(), '.dsh', 'marketplace', 'list-cache', 'dsh.json')
  try {
    const mtimeMs = statSync(path).mtimeMs
    if (cached?.path === path && cached.mtimeMs === mtimeMs) return cached.repositories
    const data = JSON.parse(readFileSync(path, 'utf8')) as { repos?: Repository[] }
    cached = { path, mtimeMs, repositories: data.repos ?? [] }
    return cached.repositories
  } catch {
    // A missing or unreadable market cache means no recommendations, never a failed turn.
    return []
  }
}

export interface SkillCandidate {
  name: string
  package?: string
  description?: string
  stars: number
  url: string
}

/**
 * Rank marketplace repositories that match every whitespace-separated term, best match first, then most starred.
 * @param query - What the work needs, such as `gongwen` or `excel 清洗`.
 * @param limit - Maximum candidates to return.
 * @returns Candidate providers; empty when the cache is absent or nothing matches.
 */
export function searchSkills(query: string, limit = 5): SkillCandidate[] {
  const terms = query.toLowerCase().split(/\s+/).filter(term => term.length > 0)
  if (terms.length === 0) return []
  const scored = load().map(repository => {
    const haystack = `${repository.name} ${repository.description ?? ''} ${(repository.topics ?? []).join(' ')} ${repository.pkg_name ?? ''}`
      .toLowerCase()
    return { repository, hits: terms.filter(term => haystack.includes(term)).length }
  }).filter(item => item.hits > 0)
  scored.sort((a, b) => b.hits - a.hits || (b.repository.stargazers_count ?? 0) - (a.repository.stargazers_count ?? 0))
  return scored.slice(0, limit).map(({ repository }) => ({
    name: repository.name,
    ...(repository.pkg_name === undefined ? {} : { package: repository.pkg_name }),
    ...(repository.description === undefined ? {} : { description: repository.description }),
    stars: repository.stargazers_count ?? 0,
    url: `https://github.com/${repository.full_name}`,
  }))
}
