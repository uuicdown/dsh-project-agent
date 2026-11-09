import { describe, expect, it, vi } from 'vitest'
import { Engine, MemoryRepositories } from '../src/core/index.ts'
import type { Assessor, Assignment, EngineOptions, Executor, Policy, Ticket } from '../src/core/index.ts'

/** Minimal Engine harness: nothing external, only the ports dispatch touches. */
function harness() {
  const repo = new MemoryRepositories()
  const launches: [Ticket, Assignment][] = []
  const executor: Executor = {
    start: vi.fn((ticket, assignment) => { launches.push([ticket, assignment]) }),
    deliver: vi.fn(),
    stop: vi.fn(),
  }
  const policy: Policy = {
    version: 'v1', paused: false, evalTimeoutMs: 60_000,
    gate: () => ({ admissible: false, reason: 'no source' }),
    revalidate: () => true,
    admitsInferred: () => false,
  }
  const assessor: Assessor = { request: vi.fn(), release: vi.fn() }
  const outbox: EngineOptions['outbox'] = { send: vi.fn(), status: () => undefined, withdraw: vi.fn() }
  const engine = new Engine({
    repo, scope: { scope: () => ({ listened: true, observed: false }) }, policy: () => policy, assessor, executor, outbox,
    now: () => new Date().toISOString(),
  })
  return { repo, engine, launches }
}

describe('dispatch', () => {
  it('creates an open ticket with an explicit mandate and starts its first assignment', () => {
    const h = harness()
    const ticket = h.engine.dispatch({ project: 'p1', title: 'Write the notice', text: 'Draft a notice', name: 'task', skills: ['gongwen'] })
    expect(ticket.title).toBe('Write the notice')
    expect(ticket.mandate.strength).toBe('explicit')
    expect(ticket.mandate.scope).toBe('Write the notice')
    expect(ticket.skills).toEqual(['gongwen'])
    expect(ticket.ended).toBeUndefined()
    expect(h.repo.tickets.get(ticket.id)?.id).toBe(ticket.id)
    expect(h.launches).toHaveLength(1)
    expect(h.launches[0]![0].id).toBe(ticket.id)
  })

  it('records the project a dispatch belongs to, and leaves it out when there is none', () => {
    const h = harness()
    const ticket = h.engine.dispatch({ project: 'dsh-spinner-words', projectId: 'project-0123456789ab',
      title: 'Write the notice', text: 'Draft a notice', name: 'task' })
    expect(ticket.projectId).toBe('project-0123456789ab')
    expect(h.repo.tickets.get(ticket.id)?.projectId).toBe('project-0123456789ab')
    expect(h.engine.dispatch({ project: 'dsh-spinner-words', title: 'Other', text: 'Other', name: 'task' })).not.toHaveProperty('projectId')
  })
})
