import { type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { BuildSystemRegistryKey, LocalNpmRegistry, PackageStoreKey, SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { parseManifest } from '@pragmatic-tech-ai/todl/package-manager'
import { Severity, type BuildDiagnostic } from '@pragmatic-tech-ai/todl/build-system-core'
import { TodlProjectBuildManager } from '@pragmatic-tech-ai/todl/todl-build-system'

import { PROJECT_MANIFEST_FILENAME } from './project-factory.js'
import { InMemoryBuildStorage } from './in-memory-build-storage.js'
import { ScopeFlatteningStorage } from './scope-flattening-storage.js'

// The verdict of one publish attempt: the build's pass/fail plus its diagnostics and
// the published identity (for the caller's status line).
export interface PublishOutcome
{
    readonly Ok: boolean
    readonly Diagnostics: readonly BuildDiagnostic[]
    readonly Id: string
    readonly Version: string
}

// Builds a producer project (meta-model / library) with the npm-package build system's
// PUBLISH flavor and pushes the result to the workspace's local package registry — the
// replacement for the retired IProjectFactory.publish() path.
//
// The publish target is SolutionManagerService.PublishRegistry — the solution's active
// registry (the seam a future registry/connections picker sets). When unset (the default
// today, since the app has no picker yet), it falls back to a LocalNpmRegistry over the
// packages backend that PlexusPackageStore wraps (resolved through PackageStoreKey),
// wrapped in a ScopeFlatteningStorage so the scoped npm name collapses to the bare-id
// layout base resolution reads (see that class). The same package store is threaded as
// the build's base Source, so a producer resolves its own bases exactly as it does at
// author time. The composed BuildSystemRegistryKey is resolved from the provider (seeded
// by TodlProjectSystemModule).
export class PackagePublisher
{
    private static readonly BuildSystemId = 'npm-package'
    private static readonly PublishFlavorId = 'npm-publish'
    private static readonly DiagnosticSeparator = '; '
    private static readonly UnknownId = '(unknown)'
    private static readonly NoVersion = ''

    constructor(private readonly provider: IServiceProvider)
    {
    }

    public async Publish(storage: IStorage): Promise<PublishOutcome>
    {
        const store = this.provider.getRequired(PackageStoreKey)
        const registry = this.provider.getRequired(SolutionManagerService.Key).PublishRegistry
            ?? new LocalNpmRegistry(new ScopeFlatteningStorage(store.Storage))
        const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
        const buildSystems = this.provider.getRequired(BuildSystemRegistryKey)
        const manager = new TodlProjectBuildManager(buildSystems, new InMemoryBuildStorage())
        const { Result: result } = await manager.Build({
            Project: storage,
            Manifest: manifest,
            BuildSystemId: PackagePublisher.BuildSystemId,
            BuildFlavorId: PackagePublisher.PublishFlavorId,
            Source: store,
            PublishRegistry: registry,
        })
        return {
            Ok: result.Ok,
            Diagnostics: result.Diagnostics,
            Id: manifest.id ?? manifest.name ?? PackagePublisher.UnknownId,
            Version: manifest.packageVersion ?? PackagePublisher.NoVersion,
        }
    }

    // Join the error diagnostics into one Problems-dock message (the former single-string
    // publish result); warnings stay out of the blocking message.
    public static FormatErrors(diagnostics: readonly BuildDiagnostic[]): string
    {
        return diagnostics
            .filter((d) => d.severity === Severity.Error)
            .map((d) => d.message)
            .join(PackagePublisher.DiagnosticSeparator)
    }
}
