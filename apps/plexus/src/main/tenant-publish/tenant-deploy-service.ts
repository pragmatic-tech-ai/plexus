import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { RemoteBuildDirName, TenantPublishStatus } from '@pragmatic-tech-ai/plexus-core/shared/tenant-publish-api.js'
import { TargetKind, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { CypherAppDeployParamsDto, ServableAppManifestDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { ITenantPublishApi, TenantPublishResult } from '../../shared/tenant-publish-api.js'
import { RelayConnector, type IRelayConnector, type RelayClient } from '../account/relay-connector.js'

// A failure reading the build output that this service wrote the sentence for (no manifest, a
// missing file, an unsafe path, a bad manifest): shown to the maker as is.
class BuildOutputError extends Error
{
    private static readonly ErrorName = 'BuildOutputError'

    public constructor(message: string)
    {
        super(message)
        this.name = BuildOutputError.ErrorName
    }
}

// Main-process deploy: takes the output directory of a finished html-bundle-remote build
// (index.html, servable-manifest.json, packages/<id>/<version>/model.json for the full
// closure), assembles the protocol's CypherAppDeployParamsDto from it and uploads it to a Runtime
// environment through the publish relay of the target's source (the environment credential stays
// server-side). The renderer does the build; this class only reads its output, so no closure
// resolution happens here. Trust boundary: outputDir
// arrives from the renderer, so it must be a remote-build dir (a path segment named build-remote,
// the dir PublishTenantContributor builds into) and every file read stays confined inside it. The
// build output is read before the relay is opened, so a bad output never connects.
export class TenantDeployService implements ITenantPublishApi
{
    private static readonly ManifestFile = 'servable-manifest.json'
    private static readonly PackagesDir = 'packages'
    private static readonly ModelFile = 'model.json'
    private static readonly Utf8 = 'utf8'
    private static readonly Base64 = 'base64'
    private static readonly NoManifest = 'Remote build output has no servable-manifest.json: build the HTML app (remote) flavor first. Looked in: '
    private static readonly BadManifest = 'servable-manifest.json is not a valid servable app manifest.'
    private static readonly ManifestNotJson = 'servable-manifest.json is not valid JSON.'
    private static readonly MissingFile = 'Remote build output is missing: '
    private static readonly UnsafePath = 'Manifest references a path outside the build output: '
    private static readonly NotABuildDir = 'Refusing to publish a directory that is not a remote build output: '
    private static readonly Unreadable = 'The build output could not be read.'
    private static readonly UnreadableLog = 'TenantDeployService: reading the build output failed:'

    constructor(private readonly relay: IRelayConnector)
    {
    }

    public async Deploy(target: TargetRef, outputDir: string): Promise<TenantPublishResult>
    {
        TenantDeployService.RequireBuildDir(outputDir)
        const params = await TenantDeployService.AssembleOrSentence(outputDir)
        const client = await this.relay.Connect(target, TargetKind.Publish)
        try
        {
            const result = await RelayConnector.Call({ Environment: target.Name, Client: client }, () => client.DeployApplication(params))
            return { Status: result.status as string as TenantPublishStatus, Reason: result.reason, AppName: result.appName, AppVersion: result.appVersion }
        }
        finally
        {
            await TenantDeployService.Close(client)
        }
    }

    // A failing close must not hide the deploy's own outcome.
    private static async Close(client: RelayClient): Promise<void>
    {
        try
        {
            await client.DisposeAsync()
        }
        catch
        {
            // the connection is gone either way
        }
    }

    // A lightweight sanity gate only. The real trust boundary is ReadFile's path confinement
    // (resolved path must start with root + sep) plus tenant-scoping on the server.
    private static RequireBuildDir(outputDir: string): void
    {
        if (!resolve(outputDir).split(sep).includes(RemoteBuildDirName))
        {
            throw new Error(`${TenantDeployService.NotABuildDir}${outputDir}`)
        }
    }

    // Any failure other than the service's own sentences (an unexpected fs error naming a local path,
    // a TypeError from a malformed manifest entry) becomes one fixed sentence; only its name and code
    // are logged, never its message.
    private static async AssembleOrSentence(outputDir: string): Promise<CypherAppDeployParamsDto>
    {
        try
        {
            return await TenantDeployService.Assemble(outputDir)
        }
        catch (e)
        {
            if (e instanceof BuildOutputError) throw e
            const { name, code } = (e ?? {}) as { name?: unknown; code?: unknown }
            console.warn(TenantDeployService.UnreadableLog, String(name ?? typeof e), String(code ?? ''))
            throw new Error(TenantDeployService.Unreadable)
        }
    }

    private static async Assemble(outputDir: string): Promise<CypherAppDeployParamsDto>
    {
        const manifest = await TenantDeployService.ReadManifest(outputDir)
        const packages: CypherAppDeployParamsDto['packages'] = []
        for (const ref of manifest.packages)
        {
            const path = join(TenantDeployService.PackagesDir, ref.id, ref.version, TenantDeployService.ModelFile)
            const modelJson = (await TenantDeployService.ReadFile(outputDir, path)).toString(TenantDeployService.Utf8)
            packages.push({ id: ref.id, version: ref.version, modelJson })
        }
        const uiBundle: CypherAppDeployParamsDto['uiBundle'] = []
        const paths = manifest.ui.assets.includes(manifest.ui.entry) ? manifest.ui.assets : [manifest.ui.entry, ...manifest.ui.assets]
        for (const path of paths)
        {
            const bytes = await TenantDeployService.ReadFile(outputDir, path)
            uiBundle.push({ path, contentBase64: bytes.toString(TenantDeployService.Base64) })
        }
        return { appName: manifest.name, appVersion: manifest.version, packages, uiBundle, manifest }
    }

    private static async ReadManifest(outputDir: string): Promise<ServableAppManifestDto>
    {
        let text: string
        try
        {
            text = await fs.readFile(join(outputDir, TenantDeployService.ManifestFile), TenantDeployService.Utf8)
        }
        catch
        {
            throw new BuildOutputError(`${TenantDeployService.NoManifest}${outputDir}`)
        }
        let m: Partial<ServableAppManifestDto>
        try
        {
            m = JSON.parse(text) as Partial<ServableAppManifestDto>
        }
        catch
        {
            throw new BuildOutputError(TenantDeployService.ManifestNotJson)
        }
        if (m === null || typeof m !== 'object' || typeof m.name !== 'string' || typeof m.version !== 'string' || !Array.isArray(m.packages)
            || m.ui === undefined || typeof m.ui.entry !== 'string' || !Array.isArray(m.ui.assets))
        {
            throw new BuildOutputError(TenantDeployService.BadManifest)
        }
        return m as ServableAppManifestDto
    }

    private static async ReadFile(root: string, relative: string): Promise<Buffer>
    {
        const full = resolve(root, relative)
        if (!full.startsWith(resolve(root) + sep)) throw new BuildOutputError(`${TenantDeployService.UnsafePath}${relative}`)
        try
        {
            return await fs.readFile(full)
        }
        catch
        {
            throw new BuildOutputError(`${TenantDeployService.MissingFile}${relative}`)
        }
    }
}
