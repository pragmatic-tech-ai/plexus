import { describe, it, expect, vi } from 'vitest'

const ensured = vi.hoisted(() => new Map<string, string>())
vi.mock('../model-registry.js', () => ({
    MonacoModelRegistry: class
    {
        public Ensure(uri: string, text: string): void { ensured.set(uri, text) }
        public Has(uri: string): boolean { return ensured.has(uri) }
        public Dispose(uri: string): void { ensured.delete(uri) }
    },
}))
vi.mock('../marker-source.js', () => ({
    MonacoMarkerSource: class
    {
        public Set(): void {}
        public Clear(): void {}
        public OnDidChange(): { dispose(): void } { return { dispose: () => {} } }
    },
}))
vi.mock('../typescript-language-host.js', () => ({
    TypeScriptLanguageHost: { Configure: vi.fn() },
}))

import { ContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import { TypeScriptWorkspaceSinkKey, TypeScriptDiagnosticsSinkKey } from '@pragmatic-tech-ai/plexus-core/renderer/typescript/typescript-seams.js'
import { TypeScriptModule } from '../typescript-module.js'
import { TypeScriptWorkspace } from '../typescript-workspace.js'
import { TypeScriptDiagnosticsBridge } from '../typescript-diagnostics-bridge.js'

class FakeContainer
{
    public instances = new Map<unknown, unknown>()
    public registerInstance(key: unknown, value: unknown): void { this.instances.set(key, value) }
}

class FakeProvider
{
    public listener: ((change: { kind: string; items: unknown[] }) => void) | undefined
    private readonly host = { OpenDocuments: { Subscribe: (l: FakeProvider['listener']) => { this.listener = l; return () => {} } } }
    public get(key: unknown): unknown { return key === ContentHostService.Key ? this.host : undefined }
    public getRequired(key: unknown): unknown { return key === DiagnosticsService.Key ? {} : undefined }
}

class FakeStorage
{
    public async ReadText(): Promise<string> { return 'export const x = 1' }
    public async List(): Promise<never[]> { return [] }
}

describe('TypeScriptModule.Compose', () =>
{
    it('registers the workspace and bridge under both keys', () =>
    {
        const container = new FakeContainer()
        TypeScriptModule.Compose(container as never, new FakeProvider() as never)
        expect(container.instances.get(TypeScriptWorkspace.Key)).toBeInstanceOf(TypeScriptWorkspace)
        expect(container.instances.get(TypeScriptWorkspaceSinkKey)).toBe(container.instances.get(TypeScriptWorkspace.Key))
        expect(container.instances.get(TypeScriptDiagnosticsBridge.Key)).toBeInstanceOf(TypeScriptDiagnosticsBridge)
        expect(container.instances.get(TypeScriptDiagnosticsSinkKey)).toBe(container.instances.get(TypeScriptDiagnosticsBridge.Key))
    })

    it('re-ensures a closed .ts model and ignores non-TS / unknown closes', async () =>
    {
        ensured.clear()
        const container = new FakeContainer()
        const provider = new FakeProvider()
        TypeScriptModule.Compose(container as never, provider as never)
        const workspace = container.instances.get(TypeScriptWorkspace.Key) as TypeScriptWorkspace
        await workspace.AttachProject('/proj', 'Proj', new FakeStorage() as never)
        ensured.clear()

        const uri = TypeScriptWorkspace.ModelUriFor('/proj', 'src/main.ts')
        provider.listener?.({ kind: 'removed', items: [{ Id: 'src/main.ts', Uri: uri }] })
        await new Promise(r => setTimeout(r, 0))
        expect(ensured.has(uri)).toBe(true)

        ensured.clear()
        provider.listener?.({ kind: 'removed', items: [{ Id: 'a.todl', Uri: uri }, { Id: 'b.ts', Uri: '' }, { Id: 'c.ts', Uri: TypeScriptWorkspace.ModelUriFor('/other', 'c.ts') }] })
        await new Promise(r => setTimeout(r, 0))
        expect(ensured.size).toBe(0)
    })
})
