import { test, expect, beforeEach, afterEach } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { OpenProjectsStore } from '../../../../services/projects/open-projects-store.js'
import { McpGatingMode, McpScope, McpTransportKind, type IMcpClientApi, type McpServerEntry } from '../../../../../../shared/mcp-client-api.js'
import { McpServersService } from '../mcp-servers-service.js'

function entry(key: string): McpServerEntry {
    return {
        key, label: key, enabled: true,
        transport: { kind: McpTransportKind.Stdio, command: 'x', args: [], env: {} },
        gating: { mode: McpGatingMode.Prompt, tools: [] },
    }
}

function fakeApi() {
    const global: McpServerEntry[] = []
    const projects = new Map<string, McpServerEntry[]>()
    const api: IMcpClientApi = {
        listGlobal: () => Promise.resolve([...global]),
        saveGlobal: (e) => { global.splice(0, global.length, ...e); return Promise.resolve() },
        listProject: (root) => Promise.resolve([...(projects.get(root) ?? [])]),
        saveProject: (root, e) => { projects.set(root, [...e]); return Promise.resolve() },
        probe: () => Promise.resolve({ ok: true, toolCount: 0 }),
        listTools: () => Promise.resolve([]),
        importCandidates: () => Promise.resolve([entry('imported')]),
    }
    return { api, global, projects }
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

let bridge: ReturnType<typeof fakeApi>
beforeEach(() => { bridge = fakeApi(); (globalThis as unknown as { api: unknown }).api = { mcp: bridge.api } })
afterEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

function make(store = fakeStore([])) {
    const provider = new ServiceProvider()
    provider.registerInstance(OpenProjectsStore.Key, store as unknown as OpenProjectsStore)
    return new McpServersService(provider)
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

test('Reload populates GlobalServers from the api', async () => {
    bridge.global.push(entry('a'), entry('b'))
    const svc = make()
    await svc.Reload()
    expect(svc.GlobalServers.ToArray().map((r) => r.Key).sort()).toEqual(['a', 'b'])
    expect(svc.IsProjectOpen).toBe(false)
})

test('saving a new global server persists via saveGlobal and lists it', async () => {
    const svc = make()
    await svc.Reload()
    // drive the private save path through the editor the service builds on Add
    svc.AddCommand.Execute(undefined)
    const editor = svc.ActiveEditor!
    editor.Key = 'new'; editor.Command = 'srv'
    editor.SaveCommand.Execute(undefined)
    await tick()
    expect(bridge.global.map((e) => e.key)).toContain('new')
    expect(svc.HasEditor).toBe(false)
})

test('with a project open, project servers load and save under the project root', async () => {
    const svc = make(fakeStore(['/proj']))
    await svc.Reload()
    expect(svc.IsProjectOpen).toBe(true)
    svc.AddProjectCommand.Execute(undefined)
    const editor = svc.ActiveEditor!
    editor.Key = 'p1'; editor.Command = 'srv'
    editor.SaveCommand.Execute(undefined)
    await tick()
    expect((bridge.projects.get('/proj') ?? []).map((e) => e.key)).toEqual(['p1'])
})

test('import brings candidates into the chosen scope', async () => {
    const svc = make()
    await svc.Reload()
    svc.ImportCommand.Execute(undefined)
    await tick()
    const imp = svc.ActiveImport!
    imp.SelectedScope = McpScope.Global
    imp.ImportCommand.Execute(undefined)
    await tick()
    expect(bridge.global.map((e) => e.key)).toContain('imported')
    expect(svc.HasImport).toBe(false)
})
