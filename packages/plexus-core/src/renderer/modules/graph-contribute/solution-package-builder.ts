import type { IBuildProgress, IBuildStorageProvider, BuildSystemRegistry, SolutionBuildResult } from '@pragmatic-tech-ai/todl/build-system-core'
import { SolutionBuildManager } from '@pragmatic-tech-ai/todl/todl-build-system'
import type { SolutionProject, SolutionBuildRequest, TodlBuildContext, IPackageSource } from '@pragmatic-tech-ai/todl/todl-build-system'
import { parseManifest, toPackageJson, type ProjectManifest, type PackageJson } from '@pragmatic-tech-ai/todl/package-manager'
import { BuildService } from '@pragmatic-tech-ai/todl'
import type { SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { PROJECT_MANIFEST_FILENAME } from '../../projects/project-factory.js'
import type { ContributedPackage } from '../../../shared/graph-contribute-api.js'
import { CapturingBuildStorageProvider } from './capturing-build-storage-provider.js'

// SolutionBuildManager is a concrete class and not subclassable for a test double, so the builder
// takes a factory for it (defaulting to the real one). A unit test injects a fake factory whose Build
// simulates the engine (populating the capturing provider's outputs) without running a real build.
export type SolutionBuildManagerFactory = (
    registry: BuildSystemRegistry<TodlBuildContext, ProjectManifest>,
    storage: IBuildStorageProvider) => { Build(request: SolutionBuildRequest): Promise<SolutionBuildResult> }

// Builds the whole active solution with TODL's SolutionBuildManager in the renderer and captures each
// project's compiled model.json into ContributedPackage[] for the "contribute solution to graph"
// feature. The capturing storage decorator preserves each model.json across the engine's re-open (see
// CapturingBuildStorageProvider). Non-publishable projects (architectures) are skipped — a graph only
// ever receives meta-model / library packages.
export class SolutionPackageBuilder
{
    private static readonly NpmPackageBuildId = 'npm-package'
    private static readonly ModelFileName = 'model.json'
    // Dedupe key separator, consistent with the server-side union key (avoids '@'-in-id collisions).
    private static readonly KeySeparator = '\u0000'
    private static readonly NoActiveSolution = 'No active solution to build.'
    private static readonly BuildFailedPrefix = 'Solution build failed: '

    constructor(
        private readonly registry: BuildSystemRegistry<TodlBuildContext, ProjectManifest>,
        private readonly delegateStorageProvider: IBuildStorageProvider,
        private readonly externalSource: IPackageSource,
        private readonly solutions: SolutionManagerService,
        private readonly makeManager: SolutionBuildManagerFactory = (registry, storage) => new SolutionBuildManager(registry, storage))
    {
    }

    public async Build(progress?: IBuildProgress): Promise<readonly ContributedPackage[]>
    {
        const solution = this.solutions.ActiveSolution
        if (solution === undefined)
        {
            throw new Error(SolutionPackageBuilder.NoActiveSolution)
        }

        const projects: SolutionProject[] = []
        for (const member of solution.Members.ToArray())
        {
            const storage = member.Storage
            if (storage === undefined)
            {
                continue
            }
            const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
            projects.push({ Id: manifest.id ?? manifest.name, Project: storage, Manifest: manifest })
        }

        const capturing = new CapturingBuildStorageProvider(this.delegateStorageProvider)
        const manager = this.makeManager(this.registry, capturing)
        const request: SolutionBuildRequest = {
            Projects: projects,
            BuildSystemId: SolutionPackageBuilder.NpmPackageBuildId,
            BuildFlavorId: SolutionPackageBuilder.NpmPackageBuildId,
            ExternalSource: this.externalSource,
            ...(progress !== undefined ? { Progress: progress } : {}),
        }
        const result = await manager.Build(request)
        if (!result.Ok)
        {
            throw new Error(SolutionPackageBuilder.BuildFailedPrefix + BuildService.FormatErrors(result.Diagnostics))
        }

        const manifestById = new Map<string, ProjectManifest>(projects.map((p) => [p.Id, p.Manifest]))
        const packages: ContributedPackage[] = []
        const seen = new Set<string>()
        for (const [rootOverride, storage] of capturing.CapturedOutputs())
        {
            if (!(await storage.Exists(SolutionPackageBuilder.ModelFileName)))
            {
                continue
            }
            const manifest = manifestById.get(rootOverride)
            if (manifest === undefined)
            {
                continue
            }
            let packageJson: PackageJson
            try
            {
                packageJson = toPackageJson(manifest)
            }
            catch
            {
                // R6c: architecture / non-publishable manifest — not a graph package. Skip it.
                continue
            }
            const dedupeKey = packageJson.todl.id + SolutionPackageBuilder.KeySeparator + packageJson.version
            if (seen.has(dedupeKey))
            {
                continue
            }
            seen.add(dedupeKey)
            const modelJson = await storage.ReadText(SolutionPackageBuilder.ModelFileName)
            packages.push({ id: packageJson.todl.id, version: packageJson.version, modelJson })
        }
        return packages
    }
}
