import { describe, it, expect } from 'vitest'
import { TypeScriptWorkspace } from '../typescript-workspace.js'
import type { IModelRegistry } from '../model-registry.js'

class FakeRegistry implements IModelRegistry
{
    public models = new Map<string, string>()
    public Ensure(uri: string, text: string): void { this.models.set(uri, text) }
    public Has(uri: string): boolean { return this.models.has(uri) }
    public Dispose(uri: string): void { this.models.delete(uri) }
}

class FakeStorage
{
    constructor(private readonly files: Record<string, string>) {}
    async List(dir: string)
    {
        const prefix = dir + '/'
        const names = new Set<string>()
        const dirs = new Set<string>()
        for (const p of Object.keys(this.files))
        {
            if (!p.startsWith(prefix)) continue
            const rest = p.slice(prefix.length)
            const slash = rest.indexOf('/')
            if (slash === -1) names.add(rest)
            else dirs.add(rest.slice(0, slash))
        }
        return [
            ...[...names].map((Name) => ({ Name, IsDirectory: false })),
            ...[...dirs].map((Name) => ({ Name, IsDirectory: true })),
        ]
    }
    async ReadText(p: string) { return this.files[p] ?? '' }
}

const PROJECT = 'C:\\proj\\app'
const OTHER = 'C:\\other'

describe('TypeScriptWorkspace', () =>
{
    it('model URI round-trips a Windows project path through the file:/// form', () =>
    {
        const uri = TypeScriptWorkspace.ModelUriFor(PROJECT, 'src/main.ts')
        expect(uri).toBe(`file:///${TypeScriptWorkspace.ProjectKeyFor(PROJECT)}/src/main.ts`)
        const parsed = TypeScriptWorkspace.RelPathFromUri(uri)
        expect(parsed?.relPath).toBe('src/main.ts')
        expect(parsed?.projectKey).toBe(TypeScriptWorkspace.ProjectKeyFor(PROJECT))
        expect(uri.startsWith(TypeScriptWorkspace.PrefixFor(PROJECT))).toBe(true)
        expect(TypeScriptWorkspace.RelPathFromUri('ts://abc/src/a.ts')).toBeUndefined()
    })

    it('AttachProject ensures a model for every src/ + generated/ TypeScript file', async () =>
    {
        const reg = new FakeRegistry()
        const storage = new FakeStorage({
            'src/main.ts': 'export const a = 1',
            'src/app.mu': 'ignored',
            'generated/data.ts': 'export const b = 2',
        }) as never
        const ws = new TypeScriptWorkspace(reg)
        await ws.AttachProject(PROJECT, 'app', storage)
        expect(reg.Has(TypeScriptWorkspace.ModelUriFor(PROJECT, 'src/main.ts'))).toBe(true)
        expect(reg.Has(TypeScriptWorkspace.ModelUriFor(PROJECT, 'generated/data.ts'))).toBe(true)
        expect(reg.Has(TypeScriptWorkspace.ModelUriFor(PROJECT, 'src/app.mu'))).toBe(false)
    })

    it('DetachProject disposes only that project models', async () =>
    {
        const reg = new FakeRegistry()
        const ws = new TypeScriptWorkspace(reg)
        await ws.AttachProject(PROJECT, 'app', new FakeStorage({ 'src/main.ts': 'x' }) as never)
        await ws.AttachProject(OTHER, 'other', new FakeStorage({ 'src/main.ts': 'y' }) as never)
        ws.DetachProject(PROJECT)
        expect(reg.Has(TypeScriptWorkspace.ModelUriFor(PROJECT, 'src/main.ts'))).toBe(false)
        expect(reg.Has(TypeScriptWorkspace.ModelUriFor(OTHER, 'src/main.ts'))).toBe(true)
    })

    it('EnsureModelFor re-creates a disposed model from storage (post-close)', async () =>
    {
        const reg = new FakeRegistry()
        const ws = new TypeScriptWorkspace(reg)
        await ws.AttachProject(PROJECT, 'app', new FakeStorage({ 'src/main.ts': 'export const a = 1' }) as never)
        reg.Dispose(TypeScriptWorkspace.ModelUriFor(PROJECT, 'src/main.ts'))
        await ws.EnsureModelFor(PROJECT, 'src/main.ts')
        expect(reg.Has(TypeScriptWorkspace.ModelUriFor(PROJECT, 'src/main.ts'))).toBe(true)
    })

    it('ProjectIdFor maps storage to id; ProjectIdForKey maps hex key to id', async () =>
    {
        const ws = new TypeScriptWorkspace(new FakeRegistry())
        const storage = new FakeStorage({ 'src/main.ts': 'x' }) as never
        await ws.AttachProject(PROJECT, 'app', storage)
        expect(ws.ProjectIdFor(storage)).toBe(PROJECT)
        expect(ws.ProjectIdFor(new FakeStorage({}) as never)).toBeUndefined()
        expect(ws.ProjectIdForKey(TypeScriptWorkspace.ProjectKeyFor(PROJECT))).toBe(PROJECT)
        expect(ws.ProjectIdForKey('deadbeef')).toBeUndefined()
    })
})
