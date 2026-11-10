/**
 * Project entities: the named workspaces dispatches belong to, kept in one KV record so that renaming a project writes a
 * display name alone. Records are read and written inside `atomic` because the whole list is one value.
 */
import { createHash } from 'node:crypto'
import { sameDirectory } from '../infra/environment.ts'
import { KV, type Key } from '../kv.ts'
import { latestReport, liveTicket, type Ticket } from '../core/index.ts'

/** One project: `id` and `key` never change, `name` is what a person renames, and `path` is where it last dispatched from. */
export interface ProjectRecord {
  /** Stable record id, derived from `key` once so a rename keeps it (and its tickets) as they are. */
  id: string
  /** The dispatch name the project was created under; a later dispatch under it reaches the renamed project. */
  key: string
  name: string
  /** The main Session's workspace directory when this project last dispatched, empty when it had none. */
  path: string
  createdAt: string
}
/** One project as the management API lists it, with the Router Session the plugin created for it. */
export interface ProjectView extends ProjectRecord {
  /** The project's Router Session: one per project, created by the plugin rather than by taking over a person's Session. */
  sessionId: string
}
/** The management API's project list. */
export interface ProjectListView { items: ProjectView[] }
/** The key-value surface a project list needs; `Store` provides it and `atomic` makes the read-modify-write one transaction. */
export interface ProjectStore {
  get<V>(name: Key<V>): V | undefined
  set<V>(name: Key<V>, value: V): void
  atomic<T>(work: () => T): T
}

/** Where a name stops being a name: surrounding spaces are never part of one. */
const trimmed = (value: string | undefined): string => (value ?? '').trim()
/** The last segment of a workspace directory, ignoring trailing separators; empty for a missing path. */
function folder(path: string): string {
  const segments = path.split(/[\\/]/).filter(segment => segment && segment !== '.')
  return segments.at(-1) ?? ''
}
/** The path a project records, without the trailing separators that would make one workspace look like two. */
const directory = (path: string): string => path.replace(/[\\/]+$/, '')

/** The record id of a project created under `key`; the hash keeps it short and free of the name's own characters. */
export function projectId(key: string): string { return `project-${createHash('sha1').update(key).digest('hex').slice(0, 12)}` }

/**
 * The id of a project's Router Session, derived from the project: every caller asks for the same Session, and no second
 * record is written to remember it. A person's own Session is never one of these, which is what keeps it their Session.
 */
export const routerSessionId = (projectId: string): string => `router-${projectId}`
/** Whether `sessionId` is a project's Router Session, which the plugin created and decorates itself. */
export const isRouterSession = (sessionId: string): boolean => sessionId.startsWith('router-')
/** The title a project's Router Session carries, so its conversation is found under the project in the Session list. */
export const routerTitle = (project: ProjectRecord): string => `Router · ${project.name}`
/** A project as the management API lists it: its record and the Router Session that belongs to it. */
export const projectView = (project: ProjectRecord): ProjectView => ({ ...project, sessionId: routerSessionId(project.id) })

/** Every project, oldest first; an untouched database holds none. */
export function listProjects(store: ProjectStore): ProjectRecord[] { return [...(store.get(KV.projects.all) ?? [])] }

/** The project that answers to `name`, by its current display name or by the dispatch name it was created under. */
export function projectByName(store: ProjectStore, name: string): ProjectRecord | undefined {
  const wanted = trimmed(name)
  if (!wanted) return undefined
  return listProjects(store).find(project => project.name === wanted || project.key === wanted)
}

/**
 * The project that works in `path`, whatever name a dispatch gives it: one directory holds one project, so a Session that
 * already belongs to a project dispatches into that project instead of creating a second one beside it.
 */
export function projectByPath(store: ProjectStore, path: string): ProjectRecord | undefined {
  const wanted = directory(path)
  if (!wanted) return undefined
  return listProjects(store).find(project => project.path !== '' && sameDirectory(project.path, wanted))
}

/**
 * The project a dispatch under `name` belongs to, created on first use: its name falls back to the last segment of `path`,
 * and an existing project keeps its display name while the path records where it last ran.
 * @throws When neither a name nor a workspace directory is given, since the project would have nothing to be called.
 */
export function ensureProject(store: ProjectStore, path: string | undefined, name?: string): ProjectRecord {
  const given = trimmed(name)
  const where = directory(path ?? '')
  const key = given || folder(where)
  if (!key) throw new Error('A project needs a name or a workspace directory')
  return store.atomic(() => {
    const projects = listProjects(store)
    const found = projects.find(project => project.name === key || project.key === key)
    if (found) {
      if (where && where !== found.path) { found.path = where; store.set(KV.projects.all, projects) }
      return found
    }
    const project: ProjectRecord = { id: projectId(key), key, name: key, path: where, createdAt: new Date().toISOString() }
    store.set(KV.projects.all, [...projects, project])
    return project
  })
}

/**
 * Rename a project: only its display name changes, so `id`, `key`, `path` and every ticket that names the id stay as they are.
 * @returns The renamed project, or undefined when no project has `id`.
 * @throws When the name is blank.
 */
export function renameProject(store: ProjectStore, id: string, name: string): ProjectRecord | undefined {
  const renamed = trimmed(name)
  if (!renamed) throw new Error('A project name is required')
  return store.atomic(() => {
    const projects = listProjects(store)
    const found = projects.find(project => project.id === id)
    if (!found) return undefined
    if (found.name !== renamed) { found.name = renamed; store.set(KV.projects.all, projects) }
    return found
  })
}

/** One earlier dispatch as a new worker hears it: what it was, how it ended, and what it last reported. */
export interface DispatchHistory { at: string; title: string; state: string; report?: string }
/** How many earlier dispatches a new worker hears about, and how much of each report the briefing keeps. */
const HISTORY_TICKETS = 8, HISTORY_REPORT_CHARS = 240

/** The latest dispatches of a project, in the order they happened, as a briefing names them; `tickets` is chronological. */
export function dispatchHistory(tickets: readonly Ticket[], limit = HISTORY_TICKETS): DispatchHistory[] {
  return tickets.slice(-limit).map(ticket => {
    const said = latestReport(ticket)?.summary.trim()
    return { at: ticket.createdAt, title: ticket.title, state: liveTicket(ticket) ? 'open' : ticket.ended!.outcome,
      ...said ? { report: said.slice(0, HISTORY_REPORT_CHARS) } : {} }
  })
}

/**
 * The briefing a project's next dispatch starts its worker with: what the project already did, so a new worker Session
 * begins with the project's context instead of from nothing. Every dispatch still runs in its own ticket and Session, which
 * keeps each request's authority and tool limits separate; this carries the continuity. Undefined for a first dispatch.
 */
export function dispatchBriefing(project: string, tickets: readonly Ticket[]): string | undefined {
  const history = dispatchHistory(tickets)
  if (!history.length) return undefined
  const lines = history.map(item => `- ${item.at} · ${item.title} · ${item.state}${item.report ? ` · said: ${item.report}` : ''}`)
  return [`Earlier dispatches in project ${project} (${history.length}, oldest first):`, ...lines,
    'Treat this as the context earlier sessions left behind: continue from it, and do not redo what these reports say is done.'].join('\n')
}
