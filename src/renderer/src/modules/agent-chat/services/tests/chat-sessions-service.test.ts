import { test, expect, beforeEach, afterEach } from 'vitest'
import { ObservableCollection, ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DialogService, PanelDockService, type IDocument } from '@pragmatic-tech-ai/mural/framework'
import { AgentEventKind, AgentSkillKind, type CatalogItem, type IAgentApi, type TaggedAgentEvent } from '../../../../../../shared/agent-api.js'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../../services/projects/open-projects-store.js'
import { BackgroundWorkService } from '../../../background-work/services/background-work-service.js'
import { ChatStore } from '../chat-store.js'
import { ChatSessionsService, seedInvocation } from '../chat-sessions-service.js'
import { AgentModel } from '../agent-model.js'

function fakeAgent() {
    const turns: Array<{ sessionId: string; text: string }> = []
    const sends: Array<{ id: string; cwd: string; dirs: string[]; text: string; model: string }> = []
    const started: string[] = []
    const starts: Array<{ id: string; cwd: string; resume: string | undefined }> = []
    let push: ((m: TaggedAgentEvent) => void) | undefined
    const api: IAgentApi = {
        startSession: (id, cwd, _dirs, resume) => { started.push(id); starts.push({ id, cwd, resume }); return Promise.resolve() },
        closeSession: () => Promise.resolve(),
        sendTurn: (id, cwd, dirs, text, model) => {
            turns.push({ sessionId: id, text })
            sends.push({ id, cwd, dirs: [...dirs], text, model: model ?? '' })
            return Promise.resolve()
        },
        abort: () => Promise.resolve(),
        isResumable: () => Promise.resolve(true),
        listAgentsAndSkills: () => Promise.resolve({ agents: [], skills: [] }),
        listSkills: () => Promise.resolve([]),
        answerQuestion: () => Promise.resolve(),
        refreshProjectResult: () => Promise.resolve(),
        createProjectResult: () => Promise.resolve(),
        getProblemsResult: () => Promise.resolve(),
        answerToolApproval: () => Promise.resolve(),
        listApprovalRules: () => Promise.resolve([]),
        revokeApprovalRule: () => Promise.resolve(),
        onEvent: (h) => { push = h; return () => {} },
    }
    return { api, turns, sends, started, starts, emit: (m: TaggedAgentEvent) => push?.(m) }
}

function fakeStore(initial: string[] = []) {
    let folders = [...initial]
    const listeners = new Set<(f: readonly string[]) => void>()
    return {
        Current: () => folders, List: () => Promise.resolve(folders),
        Subscribe: (l: (f: readonly string[]) => void) => { listeners.add(l); return () => listeners.delete(l) },
        push: (n: string[]) => { folders = n; for (const l of listeners) l(folders) },
    }
}

let bridge: ReturnType<typeof fakeAgent>
beforeEach(() => { bridge = fakeAgent(); (globalThis as unknown as { api: unknown }).api = { agent: bridge.api } })
afterEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

function makeService(store = fakeStore(['/A']), stored: Array<{ Id: string; Title: string; Cwd?: string }> = []) {
    const provider = new ServiceProvider()
    provider.registerInstance(OpenProjectsStore.Key, store as unknown as OpenProjectsStore)
    provider.registerInstance(EnvironmentService.Key, { CurrentDirectory: '/fallback' } as EnvironmentService)
    provider.registerInstance(PanelDockService.Key, new PanelDockService(provider))
    const upserts: Array<{ Id: string; Title: string }> = []
    const removes: string[] = []
    provider.registerInstance(ChatStore.Key, {
        List: () => Promise.resolve(stored.map((r) => ({ ...r, ResumeToken: 't', UpdatedAt: 0, Transcript: [] }))),
        Upsert: (r: { Id: string; Title: string }) => { upserts.push({ Id: r.Id, Title: r.Title }); return Promise.resolve() },
        Remove: (id: string) => { removes.push(id); return Promise.resolve() },
    } as unknown as ChatStore)
    const submitted: Array<{ title: string; open?: () => void }> = []
    provider.registerInstance(BackgroundWorkService.Key, {
        submit: (t: { title: string; open?: () => void }) => { submitted.push({ title: t.title, open: t.open }); return { handle: {}, done: Promise.resolve() } },
    } as unknown as BackgroundWorkService)
    const dialogs: Array<{ Title?: string; Content: unknown }> = []
    provider.registerInstance(DialogService.Key, {
        Show: (o: { Title?: string; Content: unknown }) => { dialogs.push(o); return Promise.resolve(undefined) }, Close: () => {},
    } as unknown as DialogService)
    // Fake content host: OpenDocuments is a real ObservableCollection so the service's
    // tab-close subscription fires; Open/CloseById/ActivateById mirror the framework.
    const openDocs = new ObservableCollection<IDocument>()
    const activated: string[] = []
    provider.registerInstance(ContentHostService.Key, {
        OpenDocuments: openDocs,
        Open: (d: IDocument) => { openDocs.Add(d) },
        CloseById: (id: string) => { const d = openDocs.ToArray().find((x) => x.Id === id); if (d !== undefined) openDocs.Remove(d) },
        ActivateById: (id: string) => { activated.push(id) },
    } as unknown as ContentHostService)
    const svc = new ChatSessionsService(provider)
    return { svc, provider, upserts, removes, submitted, dialogs, openDocs, activated, dock: provider.getRequired(PanelDockService.Key) }
}

test('NewConversation starts a session and opens a document tab', () => {
    const { svc, openDocs, dock } = makeService()
    const chat = svc.NewConversation()
    expect(bridge.started).toContain(chat.Id)
    expect(openDocs.ToArray()).toContain(chat)   // a document tab, not a dock panel
    expect(dock.Panels.ToArray()).not.toContain(chat)
    expect(svc.Open.ToArray()).toContain(chat)
})

test('EnsurePrimary docks a fixed "Agent Chat" that is not listed as a document', async () => {
    const { svc, openDocs, dock } = makeService()
    const primary = await svc.EnsurePrimary()
    expect(primary.Title).toBe('Agent Chat')
    expect(dock.Panels.ToArray()).toContain(primary)
    expect(openDocs.ToArray()).not.toContain(primary)
    expect(svc.Open.ToArray()).not.toContain(primary)
    // Idempotent — a second call returns the same instance, no duplicate dock tab.
    expect(await svc.EnsurePrimary()).toBe(primary)
    expect(dock.Panels.ToArray().filter((p) => p === primary)).toHaveLength(1)
})

test('the docked primary is re-added if something removes it (never closable)', async () => {
    const { svc, dock } = makeService()
    const primary = await svc.EnsurePrimary()
    dock.Remove(primary)
    await Promise.resolve()
    expect(dock.Panels.ToArray()).toContain(primary)
})

test('events route to the matching session only', () => {
    const { svc } = makeService()
    const a = svc.NewConversation()
    const b = svc.NewConversation()
    bridge.emit({ SessionId: a.Id, Event: { Kind: AgentEventKind.AssistantText, Text: 'for A' } })
    expect(a.Transcript.ToArray()).toHaveLength(1)
    expect(b.Transcript.ToArray()).toHaveLength(0)
})

test('a turn addresses the session and the shared workspace cwd', () => {
    const { svc } = makeService(fakeStore(['/A', '/B']))
    const chat = svc.NewConversation()
    chat.Draft = 'hi'
    chat.SendCommand.Execute(undefined)
    expect(bridge.turns).toEqual([{ sessionId: chat.Id, text: 'hi' }])
})

test('a turn forwards the session model and merges its context dirs', () => {
    const { svc } = makeService(fakeStore(['/A', '/B']))
    const chat = svc.NewConversation()
    chat.SelectedModel = chat.Models.ToArray().find((m) => m.Value === AgentModel.Opus)!
    chat.addContextItem('C:/ctx/notes.md', false)   // parent dir C:/ctx joins the context
    chat.Draft = 'hi'
    chat.SendCommand.Execute(undefined)
    const last = bridge.sends.at(-1)!
    expect(last.model).toBe('opus')
    expect(last.dirs).toContain('/B')       // the open-project addDir
    expect(last.dirs).toContain('C:/ctx')   // the session's context dir
})

test('context dirs are deduped against the open-project dirs', () => {
    const { svc } = makeService(fakeStore(['/A', '/B']))
    const chat = svc.NewConversation()
    chat.addContextItem('/B', true)          // same dir as an open-project addDir
    chat.Draft = 'hi'
    chat.SendCommand.Execute(undefined)
    const last = bridge.sends.at(-1)!
    expect(last.dirs.filter((d) => d === '/B')).toHaveLength(1)
})

test('the default model is forwarded as the empty alias', () => {
    const { svc } = makeService(fakeStore(['/A']))
    const chat = svc.NewConversation()
    chat.Draft = 'hi'
    chat.SendCommand.Execute(undefined)
    expect(bridge.sends.at(-1)!.model).toBe('')
})

test('a resumable SessionStarted upserts the conversation into the store', async () => {
    const { svc, upserts } = makeService()
    const chat = svc.NewConversation()
    await Promise.resolve()   // let the isResumable() probe settle
    bridge.emit({ SessionId: chat.Id, Event: { Kind: AgentEventKind.SessionStarted, SessionId: 'cli-1' } })
    await Promise.resolve()
    expect(upserts.map((u) => u.Id)).toContain(chat.Id)
})

test('Close removes the document tab and closes the backend session', () => {
    const { svc, openDocs } = makeService()
    const chat = svc.NewConversation()
    svc.Close(chat)
    expect(openDocs.ToArray()).not.toContain(chat)
    expect(svc.Open.ToArray()).not.toContain(chat)
})

test('closing a document tab via its own ✕ cleans up the session', () => {
    const { svc, openDocs } = makeService()
    const chat = svc.NewConversation()
    // Simulate the tab's own close button: the content host drops the document.
    const doc = openDocs.ToArray().find((d) => d.Id === chat.Id)!
    openDocs.Remove(doc)
    expect(svc.Open.ToArray()).not.toContain(chat)   // service synced its state
})

test('the primary chat is never closed by Close()', async () => {
    const { svc, dock } = makeService()
    const primary = await svc.EnsurePrimary()
    svc.Close(primary)
    expect(dock.Panels.ToArray()).toContain(primary)
})

test('Close flushes the conversation to the store first', async () => {
    const { svc, upserts } = makeService()
    const chat = svc.NewConversation()
    await Promise.resolve()   // let the isResumable() probe settle
    bridge.emit({ SessionId: chat.Id, Event: { Kind: AgentEventKind.SessionStarted, SessionId: 'cli-1' } })
    await Promise.resolve()
    const before = upserts.length
    svc.Close(chat)
    await Promise.resolve()
    expect(upserts.length).toBeGreaterThan(before)
    expect(upserts.some((u) => u.Id === chat.Id)).toBe(true)
})

test('FlushAll persists every open conversation', async () => {
    const { svc, upserts } = makeService()
    const a = svc.NewConversation()
    const b = svc.NewConversation()
    await Promise.resolve()
    bridge.emit({ SessionId: a.Id, Event: { Kind: AgentEventKind.SessionStarted, SessionId: 'cli-a' } })
    bridge.emit({ SessionId: b.Id, Event: { Kind: AgentEventKind.SessionStarted, SessionId: 'cli-b' } })
    await Promise.resolve()
    upserts.length = 0
    await svc.FlushAll()
    expect(upserts.map((u) => u.Id).sort()).toEqual([a.Id, b.Id].sort())
})

test('a resumed conversation seeds its token, so a later turn is persisted', async () => {
    const { svc, upserts } = makeService(fakeStore(['/A']), [{ Id: 'r1', Title: 'Past chat' }])
    await Promise.resolve()
    const chat = await svc.OpenStored('r1')
    expect(chat).toBeDefined()
    upserts.length = 0
    // No SessionStarted re-emitted for a resume — the seeded token must carry it.
    bridge.emit({ SessionId: 'r1', Event: { Kind: AgentEventKind.TurnComplete } })
    await Promise.resolve()
    expect(upserts.some((u) => u.Id === 'r1')).toBe(true)
})

test('a resumed conversation starts under its persisted cwd, not the current workspace cwd', async () => {
    // The record's session was created under /project; the current workspace is /A.
    // The backend keys resumable sessions by cwd, so resume MUST spawn at /project —
    // resuming at /A fails with "No conversation found" (the restore bug this fixes).
    const { svc } = makeService(fakeStore(['/A']), [{ Id: 'r1', Title: 'Past chat', Cwd: '/project' }])
    await Promise.resolve()
    await svc.OpenStored('r1')
    const start = bridge.starts.find((s) => s.id === 'r1')
    expect(start?.cwd).toBe('/project')
    expect(start?.resume).toBe('t')
})

test('the docked primary resumes under its persisted cwd even before the workspace dirs load', async () => {
    const { svc } = makeService(fakeStore(['/A']), [{ Id: 'agent-chat-primary', Title: 'Agent Chat', Cwd: '/project' }])
    await svc.EnsurePrimary()
    const start = bridge.starts.find((s) => s.id === 'agent-chat-primary')
    expect(start?.cwd).toBe('/project')
})

test('turns of a bound conversation go to its cwd, so a respawn resumes in the right directory', async () => {
    const { svc } = makeService(fakeStore(['/A']), [{ Id: 'r1', Title: 'Past chat', Cwd: '/project' }])
    await Promise.resolve()
    const chat = await svc.OpenStored('r1')
    chat!.Draft = 'hello'
    chat!.SendCommand.Execute(undefined)
    const send = bridge.sends.find((s) => s.id === 'r1')
    expect(send?.cwd).toBe('/project')
})

test('a record without a stored cwd falls back to the current workspace cwd', async () => {
    const { svc } = makeService(fakeStore(['/A']), [{ Id: 'r1', Title: 'Past chat' }])   // no Cwd
    await Promise.resolve()
    await svc.OpenStored('r1')
    expect(bridge.starts.find((s) => s.id === 'r1')?.cwd).toBe('/A')
})

test('seedInvocation builds a slash command for a skill and a subagent instruction for an agent', () => {
    expect(seedInvocation({ kind: AgentSkillKind.Skill, name: 'security-review', description: '' })).toBe('/security-review')
    expect(seedInvocation({ kind: AgentSkillKind.Agent, name: 'reviewer', description: '' }))
        .toBe('Use the "reviewer" subagent for this task.')
})

test('the visible lists mirror the open conversations until a search narrows them', () => {
    const { svc } = makeService()
    const a = svc.NewConversation()   // "Chat 1"
    const b = svc.NewConversation()   // "Chat 2"
    expect(svc.VisibleOpen.ToArray()).toEqual([a, b])
    svc.SearchText = '2'
    expect(svc.VisibleOpen.ToArray()).toEqual([b])
    svc.SearchText = ''
    expect(svc.VisibleOpen.ToArray()).toEqual([a, b])
})

test('search matches conversation titles case-insensitively', () => {
    const { svc } = makeService()
    const a = svc.NewConversation()
    a.setTitle('Billing review')
    svc.NewConversation().setTitle('Layout pass')
    // Re-run the filter after the out-of-band title change.
    svc.SearchText = 'BILL'
    expect(svc.VisibleOpen.ToArray().map((c) => c.Title)).toEqual(['Billing review'])
})

test('RestoreSession loads stored rows into the (visible) Stored list', async () => {
    const { svc } = makeService(fakeStore(['/A']), [{ Id: 'r1', Title: 'Past chat' }])
    await svc.RestoreSession()
    expect(svc.VisibleStored.ToArray().map((r) => r.Title)).toEqual(['Past chat'])
})

test('DeleteConversation removes a stored row and deletes it from the store', async () => {
    const { svc, removes } = makeService(fakeStore(['/A']), [{ Id: 'r1', Title: 'Past chat' }])
    await svc.RestoreSession()
    await svc.DeleteConversation('r1')
    expect(svc.Stored.ToArray()).toHaveLength(0)
    expect(svc.VisibleStored.ToArray()).toHaveLength(0)
    expect(removes).toEqual(['r1'])
})

test('DeleteConversation closes a live conversation too', () => {
    const { svc, openDocs } = makeService()
    const chat = svc.NewConversation()
    void svc.DeleteConversation(chat.Id)
    expect(svc.Open.ToArray()).not.toContain(chat)
    expect(openDocs.ToArray()).not.toContain(chat)
})

test('Rename retitles a live conversation and persists the new title', async () => {
    const { svc, upserts } = makeService()
    const chat = svc.NewConversation()
    await Promise.resolve()
    bridge.emit({ SessionId: chat.Id, Event: { Kind: AgentEventKind.SessionStarted, SessionId: 'cli-1' } })
    await Promise.resolve()
    await svc.Rename(chat.Id, 'Renamed chat')
    expect(chat.Title).toBe('Renamed chat')
    expect(upserts.some((u) => u.Id === chat.Id && u.Title === 'Renamed chat')).toBe(true)
})

test('OpenApprovedToolsCommand shows the shared approved-tools list in a dialog', async () => {
    const { svc, dialogs } = makeService()
    svc.OpenApprovedToolsCommand.Execute(undefined)
    await Promise.resolve(); await Promise.resolve()   // let the refresh + Show settle
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].Title).toBe('Approved tools')
    expect(dialogs[0].Content).toBeDefined()
})

test('RunAgentSkill opens a titled conversation and submits a background task', () => {
    const { svc, submitted } = makeService()
    const item: CatalogItem = { kind: AgentSkillKind.Skill, name: 'security-review', description: '' }
    const chat = svc.RunAgentSkill(item, '/A', 'Billing')
    expect(chat.Title).toBe('security-review · Billing')
    expect(bridge.started).toContain(chat.Id)
    expect(bridge.turns).toEqual([{ sessionId: chat.Id, text: '/security-review' }])   // seeded turn
    expect(submitted).toHaveLength(1)
    expect(submitted[0].title).toBe('security-review · Billing')
    expect(typeof submitted[0].open).toBe('function')
})
