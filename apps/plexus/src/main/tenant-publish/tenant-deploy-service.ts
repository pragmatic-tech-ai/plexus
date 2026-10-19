import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { TenantPublishStatus, TenantServerUrl } from '@pragmatic-tech-ai/plexus-core/shared/tenant-publish-api.js'
import type { CypherAppDeployParamsDto, ServableAppManifestDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { TenantPublishResult } from '../../shared/tenant-publish-api.js'
import type { ITenantProfileSource } from './tenant-profile.js'
import type { ITenantClientFactory } from './tenant-client.js'

// Main-process deploy: takes the output directory of a finished html-bundle-remote build
// (index.html, servable-manifest.json, packages/<id>/<version>/model.json for the full
// closure), assembles the protocol's CypherAppDeployParamsDto from it and uploads it to the
// configured tenant over the Node PragmaticClient. The renderer does the build; this class
// only reads its output, so no closure resolution happens here. Trust boundary: outputDir
// arrives from the renderer, so it must be a remote-build dir (a path segment named build-remote,
// the dir PublishTenantContributor builds into) and every file read stays confined inside it. The admin bearer token is
// handed to the client factory and nowhere else: never logged, never put in an error/result.
export class TenantDeployService
{
    private static readonly ManifestFile = 'servable-manifest.json'
    private static readonly PackagesDir = 'packages'
    private static readonly ModelFile = 'model.json'
    private static readonly Utf8 = 'utf8'
    private static readonly Base64 = 'base64'
    private static readonly NoProfile = 'No tenant is configured: set the tenant server URL and admin token before publishing.'
    private static readonly NoManifest = 'Remote build output has no servable-manifest.json: build the HTML app (remote) flavor first. Looked in: '
    private static readonly BadManifest = 'servable-manifest.json is not a valid servable app manifest.'
    private static readonly ManifestNotJson = 'servable-manifest.json is not valid JSON.'
    private static readonly MissingFile = 'Remote build output is missing: '
    private static readonly UnsafePath = 'Manifest references a path outside the build output: '
    private static readonly RemoteBuildDirName = 'build-remote'
    private static readonly NotABuildDir = 'Refusing to publish a directory that is not a remote build output: '
    private static readonly ConnectFailed = 'Could not connect to the tenant server: '

    constructor(private readonly profiles: ITenantProfileSource, private readonly clients: ITenantClientFactory)
    {
    }

    public async Deploy(outputDir: string): Promise<TenantPublishResult>
    {
        // Profile first: a missing tenant fails before any disk read or network call.
        const profile = await this.profiles.Load()
        if (profile === undefined) throw new Error(TenantDeployService.NoProfile)
        TenantDeployService.RequireBuildDir(outputDir)
        const serverUrl = TenantServerUrl.Validate(profile.ServerUrl)
        const params = await TenantDeployService.Assemble(outputDir)
        const client = await this.connect(serverUrl, profile.Token)
        try
        {
            const result = await client.DeployApplication(params)
            return { Status: result.status as string as TenantPublishStatus, Reason: result.reason, AppName: result.appName, AppVersion: result.appVersion }
        }
        finally
        {
            await client.Close()
        }
    }

    private async connect(serverUrl: string, token: string): ReturnType<ITenantClientFactory['Connect']>
    {
        try
        {
            return await this.clients.Connect(serverUrl, token)
        }
        catch (e)
        {
            // Only the server URL and the underlying message: the token is never interpolated.
            throw new Error(`${TenantDeployService.ConnectFailed}${serverUrl} (${e instanceof Error ? e.message : String(e)})`)
        }
    }

    private static RequireBuildDir(outputDir: string): void
    {
        if (!resolve(outputDir).split(sep).includes(TenantDeployService.RemoteBuildDirName))
        {
            throw new Error(`${TenantDeployService.NotABuildDir}${outputDir}`)
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
            throw new Error(`${TenantDeployService.NoManifest}${outputDir}`)
        }
        let m: Partial<ServableAppManifestDto>
        try
        {
            m = JSON.parse(text) as Partial<ServableAppManifestDto>
        }
        catch
        {
            throw new Error(TenantDeployService.ManifestNotJson)
        }
        if (m === null || typeof m !== 'object' || typeof m.name !== 'string' || typeof m.version !== 'string' || !Array.isArray(m.packages)
            || m.ui === undefined || typeof m.ui.entry !== 'string' || !Array.isArray(m.ui.assets))
        {
            throw new Error(TenantDeployService.BadManifest)
        }
        return m as ServableAppManifestDto
    }

    private static async ReadFile(root: string, relative: string): Promise<Buffer>
    {
        const full = resolve(root, relative)
        if (!full.startsWith(resolve(root) + sep)) throw new Error(`${TenantDeployService.UnsafePath}${relative}`)
        try
        {
            return await fs.readFile(full)
        }
        catch
        {
            throw new Error(`${TenantDeployService.MissingFile}${relative}`)
        }
    }
}
