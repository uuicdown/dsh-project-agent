/** Project entities: a dispatch name creates one stable record that the sidebar groups by and renames without losing tickets. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ensureProject, dispatchBriefing, dispatchHistory, isRouterSession, listProjects, projectByPath, projectByName, projectView,
  renameProject, routerSessionId, routerTitle } from '../src/app/projects.ts'
import type { Ticket } from '../src/core/index.ts'
import { Store } from '../src/app/store.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'orchestrator-projects-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })
const open = () => new Store(join(directory, 'orchestrator.sqlite'))

it('creates one project per dispatch name and falls back to the workspace folder name', () => {
  const store = open()
  const first = ensureProject(store, '/w/default-workspace', 'dsh-spinner-words')
  expect(first).toMatchObject({ key: 'dsh-spinner-words', name: 'dsh-spinner-words', path: '/w/default-workspace' })
  expect(first.id).toMatch(/^project-[0-9a-f]{12}$/)
  // A trailing separator is the same folder, so the project is not created twice.
  expect(ensureProject(store, '/w/default-workspace/', 'dsh-spinner-words')).toEqual(first)
  // With no name of its own, a project takes the last segment of the workspace it was first dispatched from.
  const unnamed = ensureProject(store, '/w/proj-test/', '')
  expect(unnamed.name).toBe('proj-test')
  expect(listProjects(store).map(project => project.name)).toEqual(['dsh-spinner-words', 'proj-test'])
  expect(projectByName(store, 'proj-test')?.id).toBe(unnamed.id)
  // A Session without a workspace still gets its project; only the path it records stays empty.
  expect(ensureProject(store, undefined, 'dsh')).toMatchObject({ name: 'dsh', key: 'dsh', path: '' })
  expect(() => ensureProject(store, '', '  ')).toThrow()
  store.close()
})

it('renames only the display name and keeps the project across a reopen', () => {
  const store = open()
  const project = ensureProject(store, '/w/a', 'dsh')
  expect(renameProject(store, project.id, '  前端 公告  ')).toMatchObject({ id: project.id, key: 'dsh', name: '前端 公告', path: '/w/a' })
  expect(renameProject(store, 'project-missing', 'x')).toBeUndefined()
  expect(() => renameProject(store, project.id, '   ')).toThrow()
  // A later dispatch under the original or the current name is the same project, and records where it ran last.
  expect(ensureProject(store, '/w/a', 'dsh').id).toBe(project.id)
  expect(ensureProject(store, '/w/b', '前端 公告')).toMatchObject({ id: project.id, name: '前端 公告', path: '/w/b' })
  expect(listProjects(store)).toHaveLength(1)
  store.close()
  const reopened = open()
  expect(listProjects(reopened).map(item => [item.id, item.name])).toEqual([[project.id, '前端 公告']])
  reopened.close()
})

it('gives a project one Router Session of its own, titled after the project, and finds it by its directory', () => {
  const store = open()
  const project = ensureProject(store, '/w/default-workspace', 'dsh-spinner-words')
  // The id is derived from the project, so every caller asks for the same Session without storing a second record.
  expect(routerSessionId(project.id)).toBe(`router-${project.id}`)
  expect(isRouterSession(routerSessionId(project.id))).toBe(true)
  // A Session the person opened, and a ticket's worker Session, are not routers.
  expect(isRouterSession(`session-${'0'.repeat(8)}`)).toBe(false)
  expect(isRouterSession('worker-t1')).toBe(false)
  expect(routerTitle({ ...project, name: '旋转词插件' })).toBe('Router · 旋转词插件')
  expect(projectView(project)).toMatchObject({ id: project.id, name: 'dsh-spinner-words', path: '/w/default-workspace',
    sessionId: `router-${project.id}` })
  // A dispatch that names the directory's project differently still lands in it, so one directory holds one project.
  expect(projectByPath(store, '/w/default-workspace/')?.id).toBe(project.id)
  expect(projectByPath(store, '/w/elsewhere')).toBeUndefined()
  expect(projectByPath(store, '')).toBeUndefined()
  store.close()
})

/** A dispatched ticket as the briefing reads it: chronological order is the caller's to keep. */
const dispatched = (id: string, at: string, title: string, outcome?: 'completed', said?: string) => ({
  id, title, decisionId: id, channels: [], assignments: said ? [{ id: `a-${id}`, state: 'ended' as const, createdAt: at,
    report: { state: 'ready' as const, summary: said, at } }] : [], inputs: [], undelivered: [], createdAt: at, updatedAt: at,
  mandate: { strength: 'explicit' as const, policyVersion: 'dispatch', basis: { via: 'listed' as const }, actor: { source: 'project', id: 'user' },
    scope: title },
  origin: { triggerId: id, triggerIds: [] }, ...outcome ? { ended: { at, by: 'executor' as const, outcome } } : {} }) as Ticket

it('briefs a new worker on the project\'s latest dispatches, oldest first, with each report cut short', () => {
  const tickets = [1, 2, 3].map(n => dispatched(`t${n}`, `2026-11-0${n}T00:00:00Z`, `Task ${n}`, n === 1 ? 'completed' : undefined,
    n === 2 ? 'Read the handoff note' : undefined))
  expect(dispatchHistory(tickets).map(item => [item.title, item.state]))
    .toEqual([['Task 1', 'completed'], ['Task 2', 'open'], ['Task 3', 'open']])
  const briefing = dispatchBriefing('dsh', tickets)!
  expect(briefing).toContain('Earlier dispatches in project dsh (3, oldest first)')
  expect(briefing.indexOf('Task 1')).toBeLessThan(briefing.indexOf('Task 3'))
  expect(briefing).toContain('said: Read the handoff note')
  // A project's first dispatch starts with nothing to continue from.
  expect(dispatchBriefing('dsh', [])).toBeUndefined()
  // A long report is cut, so the worker's first message stays bounded; only the latest eight dispatches fit.
  const long = dispatchBriefing('dsh', [dispatched('t9', '2026-11-09T00:00:00Z', 'Big', 'completed', 'x'.repeat(4000))])!
  expect(long).toContain('x'.repeat(240))
  expect(long).not.toContain('x'.repeat(241))
  expect(dispatchHistory(Array.from({ length: 12 }, (_, index) => dispatched(`t${index}`, `2026-11-09T00:00:${String(index).padStart(2, '0')}Z`,
    `Task ${index}`))).map(item => item.title)).toEqual(['Task 4', 'Task 5', 'Task 6', 'Task 7', 'Task 8', 'Task 9', 'Task 10', 'Task 11'])
})

let host: Host
// Standalone is the project-workspace deployment: it is where a project has a Router Session of its own.
beforeEach(async () => { host = await startRuntime(undefined, { standalone: true }) })
afterEach(async () => { await host.stop() })

it('groups a dispatch into its named project, shows the project on ticket rows, and renames it over the management API', async () => {
  const header = (host.agents.get(host.runtime.masterId) as unknown as { session: { header: Record<string, unknown> } }).session.header
  header.cwd = '/w/default-workspace'
  const dispatched = await host.runTool(host.runtime.masterId, 'project_dispatch',
    { project: 'dsh-spinner-words', title: 'Draft the readme', task: 'Draft the readme', skills: [] })
  await host.runtime.idle()
  const ticketId = (dispatched.ticket as { ticket_id: string }).ticket_id
  const ticket = host.runtime.store.tickets.get(ticketId)!
  expect(ticket.projectId).toBeDefined()
  const listed = await host.api('GET', 'projects')
  expect(listed.status).toBe(200)
  const items = (listed.body as { items: { id: string; name: string; key: string; path: string; sessionId: string }[] }).items
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ name: 'dsh-spinner-words', key: 'dsh-spinner-words', path: '/w/default-workspace' })
  // The project's own Router Session is created with it, so the person has a conversation to dispatch from.
  expect(items[0]!.sessionId).toBe(`router-${items[0]!.id}`)
  expect(host.agents.has(items[0]!.sessionId)).toBe(true)
  expect(host.controller.rename).toHaveBeenCalledWith({ sessionId: items[0]!.sessionId, title: 'Router · dsh-spinner-words' })
  expect(ticket.projectId).toBe(items[0]!.id)
  // Ticket rows carry the project so the sidebar and the panel can group them.
  const rows = (await host.api('GET', 'tickets?state=open&limit=50')).body as { items: { id: string; projectId?: string }[] }
  expect(rows.items.find(row => row.id === ticketId)?.projectId).toBe(items[0]!.id)
  const renamed = await host.api('PATCH', `projects/${items[0]!.id}`, { name: '旋转词插件' })
  expect(renamed.status).toBe(200)
  expect(await host.api('GET', 'projects')).toMatchObject({ status: 200,
    body: { items: [{ id: items[0]!.id, name: '旋转词插件', path: '/w/default-workspace' }] } })
  expect(host.runtime.store.tickets.get(ticketId)!.projectId).toBe(items[0]!.id)
  expect(await host.api('PATCH', 'projects/project-missing', { name: 'x' })).toMatchObject({ status: 404 })
  expect(await host.api('PATCH', `projects/${items[0]!.id}`, { name: '   ' })).toMatchObject({ status: 400 })
})

it('shows what a dispatch chose, and starts each new worker with the project\'s earlier dispatches', async () => {
  const header = (host.agents.get(host.runtime.masterId) as unknown as { session: { header: Record<string, unknown> } }).session.header
  header.cwd = '/w/default-workspace'
  const first = await host.runTool(host.runtime.masterId, 'project_dispatch',
    { project: 'dsh-spinner-words', title: 'Draft the readme', task: 'Draft the readme', skills: ['gongwen'] })
  await host.runtime.idle()
  const firstId = (first.ticket as { ticket_id: string }).ticket_id
  // What the dispatch chose is reported back, so a person can see the skills and the model the ticket got.
  expect(first.dispatch).toEqual({ project: 'dsh-spinner-words', project_id: expect.stringMatching(/^project-/), session: `worker-${firstId}`,
    skills: ['gongwen'], skills_unrestricted: false, model: null, briefing: 0, dispatcher: host.runtime.masterId })
  const second = await host.runTool(host.runtime.masterId, 'project_dispatch',
    { project: 'dsh-spinner-words', title: 'Add the install note', task: 'Add the install note', skills: [] })
  await host.runtime.idle()
  const secondId = (second.ticket as { ticket_id: string }).ticket_id
  expect(second.dispatch).toMatchObject({ skills: [], skills_unrestricted: true, briefing: 1 })
  const stored = host.runtime.store.tickets.get(secondId)!
  expect(stored.dispatcher).toBe(host.runtime.masterId)
  // The new worker, in its own Session, starts from what the project already did instead of from nothing.
  expect(stored.execution?.assignment).toContain('Draft the readme')
})

it('continues an earlier dispatch in its Session when the router judges the request follows on', async () => {
  const header = (host.agents.get(host.runtime.masterId) as unknown as { session: { header: Record<string, unknown> } }).session.header
  header.cwd = '/w/default-workspace'
  const first = await host.runTool(host.runtime.masterId, 'project_dispatch',
    { project: 'dsh-spinner-words', title: 'Draft the readme', task: 'Draft the readme' })
  await host.runtime.idle()
  const firstId = (first.ticket as { ticket_id: string }).ticket_id
  const sessionId = `worker-${firstId}`
  // The worker handed off: its turn ended, so its Session is idle between turns.
  const worker = host.agents.get(sessionId) as unknown as { status: string }
  worker.status = 'idle'
  host.ctx.emit('agent/status', { agent: worker, status: 'idle' } as never)
  await host.runtime.idle()
  const second = await host.runTool(host.runtime.masterId, 'project_dispatch',
    { project: 'dsh-spinner-words', title: 'Add the install note', task: 'Add the install note', continue_ticket: firstId })
  await host.runtime.idle()
  const secondId = (second.ticket as { ticket_id: string }).ticket_id
  // The dispatch continues the earlier Session, and says which earlier dispatch it continues.
  expect(second.dispatch).toMatchObject({ session: sessionId, continued_from: firstId })
  expect(host.runtime.store.tickets.get(secondId)).toMatchObject({ session: sessionId, continuedFrom: firstId })
  expect(host.agents.has(`worker-${secondId}`)).toBe(false)
  // The one Session now speaks for the second ticket: its report lands on it, not on the dispatch it continues.
  await host.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: 'Install note added' })
  await host.runtime.idle()
  expect(host.runtime.store.tickets.get(secondId)!.assignments.at(-1)!.report).toMatchObject({ summary: 'Install note added' })
  expect(host.runtime.store.tickets.get(firstId)!.assignments.at(-1)!.report?.summary).not.toBe('Install note added')
  // A request about different work starts a Session of its own, with the project briefing instead of the conversation.
  const third = await host.runTool(host.runtime.masterId, 'project_dispatch',
    { project: 'dsh-spinner-words', title: 'Ship the release', task: 'Ship the release' })
  await host.runtime.idle()
  const thirdId = (third.ticket as { ticket_id: string }).ticket_id
  expect(third.dispatch).toMatchObject({ session: `worker-${thirdId}` })
  expect((third.dispatch as Record<string, unknown>).continued_from).toBeUndefined()
  expect(host.agents.has(`worker-${thirdId}`)).toBe(true)
})

it('refuses to continue a Session whose worker still runs, and an earlier dispatch of another project', async () => {
  const header = (host.agents.get(host.runtime.masterId) as unknown as { session: { header: Record<string, unknown> } }).session.header
  header.cwd = '/w/default-workspace'
  const first = await host.runTool(host.runtime.masterId, 'project_dispatch',
    { project: 'dsh-spinner-words', title: 'Draft the readme', task: 'Draft the readme' })
  await host.runtime.idle()
  const firstId = (first.ticket as { ticket_id: string }).ticket_id
  // Its worker is running: the Session is no place for another ticket until it hands off.
  expect((host.agents.get(`worker-${firstId}`) as unknown as { status: string }).status).toBe('running')
  await expect(host.runTool(host.runtime.masterId, 'project_dispatch',
    { project: 'dsh-spinner-words', title: 'Add the note', task: 'Add the note', continue_ticket: firstId }))
    .rejects.toThrow(/running/)
  // Another project's dispatch cannot take this project's Session.
  header.cwd = '/w/other'
  await expect(host.runTool(host.runtime.masterId, 'project_dispatch',
    { project: 'other-project', title: 'Other work', task: 'Other work', continue_ticket: firstId }))
    .rejects.toThrow(/this project/)
})

it('delivers a worker report to the Session that dispatched the ticket', async () => {
  const chat = 'chat-other'
  await host.controller.create({ sessionId: chat })
  const ticket = host.runtime.engine.dispatch({ project: 'p1', title: 'Fix the copy', text: 'Fix the copy', name: 'task', dispatcher: chat })
  await host.runtime.idle()
  await host.runTool(`worker-${ticket.id}`, 'orchestrator_report', { state: 'ready', summary: 'Copy fixed' })
  await host.runtime.idle()
  expect(host.relays(chat).filter(item => item.kind === 'worker_report')).toHaveLength(1)
  // The background main Session no longer receives a report of work a person dispatched from their own conversation.
  expect(host.relays(host.runtime.masterId).filter(item => item.kind === 'worker_report')).toHaveLength(0)
})

it('opens a Router Session for a project instead of taking over the person\'s own Session', async () => {
  const person = 'session-person'
  await host.controller.create({ sessionId: person })
  const agent = host.agents.get(person) as unknown as { session: { header: Record<string, unknown> } }
  // A person opens this Session in a project directory; DSH says its agent was created.
  const directory = join(host.directory, 'project-x')
  agent.session.header.cwd = directory
  await (host.ctx as unknown as { parallel(event: string, payload: unknown): Promise<unknown> })
    .parallel('agent/created', { agent: host.agents.get(person) })
  const project = ensureProject(host.runtime.store, directory)
  // The Router Session is decorated a step after it is created: wait for the dispatch tool that makes it a router.
  await vi.waitFor(() => expect(host.tools.get(`router-${project.id}`)?.has('project_dispatch')).toBe(true))
  expect(host.agents.has(`router-${project.id}`)).toBe(true)
  // The Session the person opened keeps the standard toolset: the plugin registers nothing on it, not even dispatch.
  expect(host.tools.get(person)?.size).toBe(0)
})

it('keeps routing for a Session an earlier version already turned into the router', async () => {
  const old = 'session-old-router'
  await host.controller.create({ sessionId: old })
  const agent = host.agents.get(old) as unknown as { session: { header: Record<string, unknown> } }
  // The upgrade cannot take that preset off a running Session, and it carries no work tools: it keeps being a router.
  agent.session.header.agentPreset = 'dsh-superagent-router'
  await (host.ctx as unknown as { parallel(event: string, payload: unknown): Promise<unknown> })
    .parallel('agent/created', { agent: host.agents.get(old) })
  await vi.waitFor(() => expect(host.tools.get(old)?.has('project_dispatch')).toBe(true))
})
