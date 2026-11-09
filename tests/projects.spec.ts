/** Project entities: a dispatch name creates one stable record that the sidebar groups by and renames without losing tickets. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ensureProject, listProjects, projectByName, renameProject } from '../src/app/projects.ts'
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

let host: Host
beforeEach(async () => { host = await startRuntime() })
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
  const items = (listed.body as { items: { id: string; name: string; key: string; path: string }[] }).items
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ name: 'dsh-spinner-words', key: 'dsh-spinner-words', path: '/w/default-workspace' })
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
