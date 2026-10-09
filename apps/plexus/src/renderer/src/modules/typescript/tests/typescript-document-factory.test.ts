import { describe, it, expect } from 'vitest'
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { TypeScriptDocumentFactory } from '../typescript-document-factory.js'
import { TypeScriptWorkspace } from '../typescript-workspace.js'

class FakeRegistry
{
    public models = new Map<string, string>()
    public Ensure(uri: string, text: string): void { this.models.set(uri, text) }
    public Has(uri: string): boolean { return this.models.has(uri) }
    public Dispose(uri: string): void { this.models.delete(uri) }
}

class FakeStorage
{
    constructor(private readonly files: Record<string, string>)
    {
    }

    public async List(): Promise<never[]> { return [] }
    public async ReadText(path: string): Promise<string> { return this.files[path] ?? '' }
    public async WriteText(path: string, text: string): Promise<void> { this.files[path] = text }
}

class FakeProvider
{
    constructor(private readonly workspace: TypeScriptWorkspace)
    {
    }

    public get(key: unknown): unknown { return key === TypeScriptWorkspace.Key ? this.workspace : undefined }
    public getRequired(key: unknown): unknown { return this.get(key) }
}

describe('TypeScriptDocumentFactory', () =>
{
    it('opens a .ts file as a CodeDocument with language typescript and a workspace URI', async () =>
    {
        const ws = new TypeScriptWorkspace(new FakeRegistry() as never)
        const storage = new FakeStorage({ 'src/main.ts': 'export const a = 1' })
        await ws.AttachProject('C:\\proj', 'proj', storage as never)
        const factory = new TypeScriptDocumentFactory(new FakeProvider(ws) as unknown as IServiceProvider)
        const doc = await factory.openFile(storage as never, 'src/main.ts') as any
        expect(doc.Language).toBe('typescript')
        expect(doc.Uri).toBe(TypeScriptWorkspace.ModelUriFor('C:\\proj', 'src/main.ts'))
    })

    it('newFile appends .ts only when no TypeScript extension is present', async () =>
    {
        const ws = new TypeScriptWorkspace(new FakeRegistry() as never)
        const storage = new FakeStorage({})
        const factory = new TypeScriptDocumentFactory(new FakeProvider(ws) as unknown as IServiceProvider)
        expect(await factory.newFile(storage as never, 'foo')).toBe('foo.ts')
        expect(await factory.newFile(storage as never, 'bar.tsx')).toBe('bar.tsx')
    })
})
