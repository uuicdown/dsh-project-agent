/**
 * Project entities: the named workspaces dispatches belong to, kept in one KV record so that renaming a project writes a
 * display name alone. Records are read and written inside `atomic` because the whole list is one value.
 */
import { createHash } from 'node:crypto'
import { KV, type Key } from '../kv.ts'

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
/** One project as the management API lists it. */
export interface ProjectView extends ProjectRecord {}
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

/** Every project, oldest first; an untouched database holds none. */
export function listProjects(store: ProjectStore): ProjectRecord[] { return [...(store.get(KV.projects.all) ?? [])] }

/** The project that answers to `name`, by its current display name or by the dispatch name it was created under. */
export function projectByName(store: ProjectStore, name: string): ProjectRecord | undefined {
  const wanted = trimmed(name)
  if (!wanted) return undefined
  return listProjects(store).find(project => project.name === wanted || project.key === wanted)
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
