/** Sidebar seat: projects, the Router Session the plugin opened for each, and, folded away under it, its worker Sessions. */
import { useEffect, useRef, useState } from 'react'
import type { ProjectRow } from './api.ts'
import type { T } from './text.ts'

interface TicketRow {
  id: string
  title: string
  stage?: string
  skills?: string[]
  projectId?: string
  sessionId?: string
}

/** Attention first: a ticket that waits for a person outranks finished work. */
const STAGE_ORDER = ['attention', 'blocked', 'failed', 'working', 'queued', 'ready', 'completed', 'ended']
const rank = (stage?: string): number => {
  const index = STAGE_ORDER.indexOf(stage ?? '')
  return index === -1 ? STAGE_ORDER.length : index
}
const mark = (stage?: string): string => stage === 'attention' ? '⚠' : stage === 'blocked' || stage === 'failed' ? '●'
  : stage === 'working' || stage === 'queued' ? '◐' : '✓'
const tone = (stage?: string): string => stage === 'attention' ? '#d97706' : stage === 'blocked' || stage === 'failed' ? '#dc2626'
  : stage === 'working' || stage === 'queued' ? '#2563eb' : '#16a34a'
/** Tickets no project claims, such as one dispatched before projects existed or from a Session without a workspace. */
const ORPHANS = ''
/** Indentation of one level of the tree; a Router Session sits one level under its project, and its workers one more. */
const INDENT = 16
const SECONDARY = 'var(--dsw-alias-label-secondary)'

/** Reads one management route; the header marks the request as the panel's. */
async function read<T>(path: string): Promise<T> {
  const response = await fetch(`/orchestrator/api/${path}`, { headers: { 'x-orchestrator-request': '1' } })
  if (!response.ok) throw new Error(String(response.status))
  return await response.json() as T
}
/** Renames a project: only its display name changes, so its tickets keep pointing at it. */
async function rename(id: string, name: string): Promise<void> {
  const response = await fetch(`/orchestrator/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-orchestrator-request': '1' }, body: JSON.stringify({ name }) })
  if (!response.ok) throw new Error(String(response.status))
}

/**
 * Polls the management API for projects and open tickets; the panel and this seat read the same records. A project opens
 * onto its Router Session, the conversation the plugin created for it; that project's worker Sessions stay folded away
 * until a person asks for them. A Session the person opened themselves is not in this tree: it stays an ordinary Session.
 */
export function ProjectsSidebar({ wide, t, open }: { wide?: boolean; t: T; open?: (sessionId: string) => void }): JSX.Element {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [offline, setOffline] = useState(false)
  const [editing, setEditing] = useState<{ id: string; value: string }>()
  // A project starts open onto its Router Session; its workers start collapsed, so a busy project stays one line tall.
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [workers, setWorkers] = useState<Record<string, boolean>>({})
  // A rename cancelled with Escape must not be saved by the blur that follows it, and unmounting the field after a save
  // must not send the same name twice.
  const cancelled = useRef(false)
  const committed = useRef('')
  useEffect(() => {
    let live = true
    const load = async (): Promise<void> => {
      // A collapsed seat renders nothing, so it asks the host for nothing.
      if (wide === false) return
      try {
        const [listed, open] = await Promise.all([
          read<{ items: ProjectRow[] }>('projects'),
          read<{ items: TicketRow[] }>('tickets?state=open&limit=50'),
        ])
        if (!live) return
        setProjects(listed.items ?? [])
        setTickets(open.items ?? [])
        setOffline(false)
      } catch {
        if (live) setOffline(true)
      }
    }
    void load()
    const timer = setInterval(() => { void load() }, 4000)
    return () => { live = false; clearInterval(timer) }
  }, [wide])
  if (wide === false) return <></>
  const sorted = [...tickets].sort((a, b) => rank(a.stage) - rank(b.stage))
  const groups = [...projects.map(project => ({ id: project.id, name: project.name, sessionId: project.sessionId,
    tickets: sorted.filter(ticket => ticket.projectId === project.id) })),
    { id: ORPHANS, name: t('unassignedTickets'), sessionId: undefined,
      tickets: sorted.filter(ticket => !projects.some(project => project.id === ticket.projectId)) }]
    .filter(group => group.id !== ORPHANS || group.tickets.length > 0)
  const save = async (id: string, name: string): Promise<void> => {
    setEditing(undefined)
    const wanted = name.trim()
    if (!wanted) return
    if (committed.current === `${id}:${wanted}`) return
    committed.current = `${id}:${wanted}`
    try { await rename(id, wanted); setOffline(false) } catch { setOffline(true) }
  }
  const arrow = (expanded: boolean) => <span style={{ color: SECONDARY, width: 12 }}>{expanded ? '▾' : '▸'}</span>
  const row = (ticket: TicketRow, depth: number) => <div key={ticket.id} style={{ display: 'flex', gap: 6, alignItems: 'baseline',
    padding: `2px 4px 2px ${depth + 14}px`, cursor: ticket.sessionId ? 'pointer' : 'default' }}
    title={ticket.sessionId ? t('openSession') : ticket.title}
    onClick={() => { if (ticket.sessionId) open?.(ticket.sessionId) }}>
    <span style={{ color: tone(ticket.stage), width: 12 }}>{mark(ticket.stage)}</span>
    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ticket.title}>{ticket.title}</span>
    {ticket.skills?.length ? <span style={{ color: SECONDARY, fontSize: 11 }}>{ticket.skills.join(', ')}</span> : null}
  </div>
  return (
    <div style={{ padding: '4px 8px', fontSize: 12, lineHeight: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: SECONDARY, padding: '2px 4px' }}>
        <span style={{ fontWeight: 600 }}>{t('projects')}</span>
        <span>{t('projectCount', { count: tickets.length })}</span>
      </div>
      {groups.map(group => {
        const projectOpen = !closed[group.id]
        const workersOpen = !!workers[group.id]
        return <div key={group.id || 'unassigned'}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '2px 4px', alignItems: 'baseline' }}>
            <span onClick={() => setClosed(state => ({ ...state, [group.id]: projectOpen }))} style={{ cursor: 'pointer' }}>
              {arrow(projectOpen)}</span>
            {editing?.id === group.id
              ? <input autoFocus value={editing.value} aria-label={t('projectName')}
                style={{ flex: 1, minWidth: 0, font: 'inherit', padding: '0 2px' }}
                onChange={event => setEditing({ id: group.id, value: event.target.value })}
                onKeyDown={event => {
                  if (event.key === 'Enter') void save(group.id, event.currentTarget.value)
                  if (event.key !== 'Escape') return
                  cancelled.current = true; setEditing(undefined)
                }}
                onBlur={event => { if (cancelled.current) { cancelled.current = false; return } void save(group.id, event.currentTarget.value) }} />
              : <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600,
                cursor: group.id ? 'pointer' : 'default' }} title={group.id ? t('projectRenameHint', { name: group.name }) : group.name}
                onDoubleClick={() => { if (!group.id) return; cancelled.current = false; setEditing({ id: group.id, value: group.name }) }}>{group.name}</span>}
            <span style={{ color: SECONDARY }}>{group.tickets.length}</span>
          </div>
          {projectOpen && group.id !== ORPHANS && group.sessionId
            ? <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: `2px 4px 2px ${INDENT + 14}px`,
              cursor: 'pointer' }} title={t('openSession')} onClick={() => open?.(group.sessionId!)}>
              <span style={{ color: '#2563eb', width: 12 }}>●</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('routerSession')}</span>
              <span style={{ color: SECONDARY, fontSize: 11 }}>{t('routerBadge')}</span>
            </div>
            : null}
          {projectOpen && group.id !== ORPHANS && group.tickets.length > 0
            ? <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: `2px 4px 2px ${INDENT + 14}px`,
              color: SECONDARY, cursor: 'pointer' }} onClick={() => setWorkers(state => ({ ...state, [group.id]: !workersOpen }))}>
              {arrow(workersOpen)}
              <span>{t('childSessions', { count: group.tickets.length })}</span>
            </div>
            : null}
          {/* A project's workers stay folded away until a person asks for them; tickets no project claims are listed as they are. */}
          {projectOpen && (group.id === ORPHANS || workersOpen) ? group.tickets.map(ticket => row(ticket, group.sessionId ? INDENT * 2 : INDENT)) : null}
        </div>
      })}
      {offline ? <div style={{ color: SECONDARY, padding: '2px 4px' }}>{t('notConnected')}</div> : null}
    </div>
  )
}
