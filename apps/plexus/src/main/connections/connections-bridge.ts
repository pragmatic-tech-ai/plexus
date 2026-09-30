/**
 * `ConnectionsBridge` — the logic behind apps/plexus's `connections:*` IPC channels. It
 * drives the TODL engine's `PackageManagerService` (the connection authority) for the
 * Connections subset the Solution Explorer needs: connection CRUD, token/default/test, and
 * the env-var list. Publish/compile is deliberately out of scope here (that stays devUI's
 * RegistryBridge). Tokens never cross the bridge — only `ConnectionView.HasToken` does.
 *
 * `Resolve` is the reference-resolution path: given the effective connection id the renderer's bag
 * catalog computed (EffectiveConnectionIdForConsumer), it resolves the registry/token by id in the
 * main process and returns the SourcedPackage (model + resources).
 */
import { PackageRegistryClient, TarReader } from '@pragmatic-tech-ai/todl/package-manager'
import type { PackageManagerService, ConnectionView, ConnectionSpec } from '@pragmatic-tech-ai/todl/package-manager'
import type { SourcedPackage, PackageResource } from '@pragmatic-tech-ai/todl'

export interface ConnectionTestResult
{
    ok: boolean
    message?: string
}

export class ConnectionsBridge
{
    private static readonly FallbackId = 'connection'
    // Tarball layout (mirrors the engine's own publish/read prefixes): the compiled model
    // and the package-relative resource tree (icons, presentation assets) live under these.
    private static readonly ModelPath = 'package/model.json'
    private static readonly ResourcePrefix = 'package/resources/'
    private static readonly Decoder = new TextDecoder()

    constructor(private readonly service: PackageManagerService)
    {
    }

    public List(): Promise<readonly ConnectionView[]>
    {
        return this.service.ListViews()
    }

    // The engine requires an id; the renderer sends a spec without a meaningful one, so
    // mint a URL-safe slug of the display name, de-duplicated against existing ids.
    public async Add(spec: ConnectionSpec): Promise<ConnectionView>
    {
        const taken = new Set((await this.service.ListViews()).map((v) => v.Id))
        const id = ConnectionsBridge.MintId(spec.DisplayName, taken)
        await this.service.AddConnection({ ...spec, Id: id })
        return this.ViewOf(id)
    }

    public async Update(id: string, partial: Partial<ConnectionSpec>): Promise<ConnectionView | undefined>
    {
        if ((await this.service.ListViews()).find((v) => v.Id === id) === undefined) return undefined
        await this.service.UpdateConnection(id, partial)
        return this.ViewOf(id)
    }

    public Remove(id: string): Promise<void>
    {
        return this.service.RemoveConnection(id)
    }

    public SetToken(id: string, token: string): Promise<void>
    {
        return this.service.SetToken(id, token)
    }

    public UseEnvToken(id: string, varName: string): Promise<void>
    {
        return this.service.UseEnvToken(id, varName)
    }

    public SetDefault(id: string): Promise<void>
    {
        return this.service.SetDefault(id)
    }

    public EnvVars(): Promise<readonly string[]>
    {
        return Promise.resolve(this.service.ListEnvVars())
    }

    /** Test a connection via the engine; surfaces the auth/reachability outcome. */
    public async Test(id: string): Promise<ConnectionTestResult>
    {
        try
        {
            const status = await this.service.TestConnection(id)
            return { ok: status.Ok, message: status.Message }
        }
        catch (e)
        {
            return { ok: false, message: (e as Error).message }
        }
    }

    // Resolve a published package from a connection's registry as a SourcedPackage
    // (model.json document + its recorded deps + its resource tree), mirroring the local
    // store's own shape. The raw tarball is read once and its resources are carried through
    // as bytes — a byte-faithful path, so binary assets (icons) survive rather than a lossy
    // text round-trip. Best-effort: any failure (unreachable registry, missing package,
    // non-TODL) returns undefined so the caller degrades to local-first, never hangs or throws.
    public async Resolve(id: string, version: string, connectionId?: string): Promise<SourcedPackage | undefined>
    {
        try
        {
            const registry = await this.service.RegistryFor(connectionId)
            const tarball = await new PackageRegistryClient(registry).getContent({ name: id, version })
            const entries = TarReader.read(tarball)
            const modelBytes = entries.find((e) => e.path === ConnectionsBridge.ModelPath)?.bytes
            if (modelBytes === undefined) return undefined
            const document = JSON.parse(ConnectionsBridge.Decoder.decode(modelBytes)) as { nodes: unknown[]; edges: unknown[]; dependencies?: SourcedPackage['Dependencies'] }
            const resources: PackageResource[] = entries
                .filter((e) => e.path.startsWith(ConnectionsBridge.ResourcePrefix))
                .map((e) => ({ path: e.path.slice(ConnectionsBridge.ResourcePrefix.length), bytes: e.bytes }))
            const sourced: SourcedPackage = { Document: document as unknown as SourcedPackage['Document'], Dependencies: document.dependencies ?? [] }
            if (resources.length > 0) sourced.resources = resources
            return sourced
        }
        catch
        {
            return undefined
        }
    }

    private async ViewOf(id: string): Promise<ConnectionView>
    {
        const view = (await this.service.ListViews()).find((v) => v.Id === id)
        if (view === undefined) throw new Error(`connection "${id}" not found after write`)
        return view
    }

    /** A URL-safe slug of `name`, de-duplicated against existing ids. */
    private static MintId(name: string, taken: ReadonlySet<string>): string
    {
        const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ConnectionsBridge.FallbackId
        if (!taken.has(base)) return base
        let n = 2
        while (taken.has(`${base}-${n}`)) n += 1
        return `${base}-${n}`
    }
}
