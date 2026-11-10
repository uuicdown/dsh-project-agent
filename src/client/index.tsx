/** Browser plugin entry point registering the sidebar icon, main management panel, and Plugin Manager config view. */
import { useCallback, useEffect, useRef } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { openKnownSession, SessionNavigationError } from '../navigation.ts'
import { App } from './app.tsx'
import { ProjectsSidebar } from './projects-sidebar.tsx'
import { PluginConfig, usePageForm } from './deployment.tsx'
import { en, zh } from './locales.ts'
import type { T } from './text.ts'

type ClientContext = Context & { sessions: ISessions }
/** The project seat this plugin renders above the workspace browser, declared by the sidebar shell. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.projects': { kind: 'list'; scope: 'root'; owner: { wide: boolean } }
  }
}
const NS = 'dshSuperagent'
const PANEL_ID = 'dsh-superagent' as MainPanelId
const ENTRY = 'dsh-superagent'

function HammerIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 3.5h9l3.5 1.75v2.5L15 9.5H6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" /><path d="M10 9.5v10.25a1.75 1.75 0 0 0 3.5 0V9.5" /><path d="M10 15.5h3.5" />
  </svg>
}

/**
 * Opens a Session from the sidebar seat. A Session the shell cannot list yet is left for its next poll instead of raising an
 * error in a seat that has no place to show one.
 */
function openSidebarSession(ctx: ClientContext, sessionId: string): void {
  openKnownSession(ctx.sessions, sessionId as SessionId, target => { ctx.uiWorkspace.openSession(target) },
    new AbortController().signal).catch(() => { /* the seat polls the same list again */ })
}

/** Mounted panel wrapper; cancels any pending Session navigation when a new one starts or the panel unmounts. */
function Mounted({ ctx, t }: { ctx: ClientContext; t: T }) {
  const pending = useRef<AbortController>(undefined)
  useEffect(() => () => { pending.current?.abort() }, [])
  const openSession = useCallback(async (id: string) => {
    pending.current?.abort()
    const request = new AbortController(); pending.current = request
    try {
      await openKnownSession(ctx.sessions, id as SessionId, target => { ctx.uiWorkspace.openSession(target) }, request.signal)
    } catch (error) {
      if (error instanceof SessionNavigationError) throw new Error(t(error.code === 'not-ready' ? 'sessionListNotReady' : 'sessionNotListed'))
      throw error
    }
  }, [ctx, t])
  const form = usePageForm(ctx.get('configForms')?.get<Record<string, unknown>>(ENTRY))
  return <App t={t} openSession={openSession} deploymentForm={form} />
}

export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace']
/**
 * Registers the panel, sidebar icon, and Plugin Manager config view. The three views a disabled plugin hides (the panel, the
 * sidebar icon and the project seat) are registered and disposed as `GET state` reports the flag; the Plugin Manager page keeps
 * the switch, so a disabled plugin can always be turned back on. `configForms` is optional (without it, machine settings are read-only).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-superagent: dictionaries')
  const t = ctx.locale.bind(NS)
  const views = (): (() => void)[] => [
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) },
      (props: { t: T }) => <Mounted ctx={ctx} t={props.t} />)),
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => t('panel'), locale: NS }, HammerIcon)),
    ctx.slots.inject('sidebar.projects', () => ctx.slots.register({ name: 'sidebar.projects', id: `${ENTRY}-projects`, order: 10, label: () => t('panel'), locale: NS },
      (props: { wide?: boolean }) => <ProjectsSidebar {...props} t={t} open={session => { openSidebarSession(ctx, session) }} />)),
  ]
  let shown = views()
  /** @param enabled - whether the plugin's views belong on screen; the switch page itself stays registered below. */
  const reveal = (enabled: boolean): void => {
    if (enabled) { if (!shown.length) shown = views(); return }
    for (const dispose of shown.splice(0)) { try { dispose() } catch { /* A slot the shell already released. */ } }
  }
  ctx.effect(() => {
    let live = true
    const read = async (): Promise<void> => {
      try {
        const response = await fetch('/orchestrator/api/state', { headers: { 'x-orchestrator-request': '1' } })
        if (!response.ok) return
        const state = await response.json() as { enabled?: boolean }
        if (live) reveal(state.enabled !== false)
      } catch { /* A host that is restarting keeps the current views. */ }
    }
    void read()
    const timer = setInterval(() => { void read() }, 4000)
    return () => { live = false; clearInterval(timer); reveal(true) }
  }, 'dsh-superagent: plugin switch')
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: `${ENTRY}#${ENTRY}`, locale: NS },
    (props: PluginConfigViewProps & { t: T }) => <PluginConfig t={props.t} view={props.view} form={props.form} />))
}
