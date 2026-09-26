import { FakeStorage, type IStorage, type ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { BuildSystemRegistryKey, ProjectSystemComposer } from '@pragmatic-tech-ai/todl'
import { StorageTree, type BuildDiagnostic, type IBuildStorageProvider, type OpenedOutput } from '@pragmatic-tech-ai/todl/build-system-core'
import { TodlProjectBuildManager, type IPackageSource } from '@pragmatic-tech-ai/todl/todl-build-system'
import { parseManifest } from '@pragmatic-tech-ai/todl/package-manager'
import { PROJECT_MANIFEST_FILENAME } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project-factory.js'

// The outcome of one composed npm-package build: the pass/fail verdict, its
// diagnostics, and the promoted package output (empty when the build failed).
export interface ComposedBuildOutcome
{
    readonly Ok: boolean
    readonly Diagnostics: readonly BuildDiagnostic[]
    readonly Output: FakeStorage
}

// Test driver for the TODL npm-package build (plain package flavor) exactly as Plexus
// composes it: ProjectSystemComposer seeds the build-system registry into the given
// container, and the build resolves the npm-package system from BuildSystemRegistryKey
// — so presentation baking goes through whatever PresentationBakerKey resolves to (the
// TODL default unless a test overrides it). Replaces the retired factory.publish() +
// MuralPresentationBaker path in the producer-factory tests.
export class ComposedPackageBuild
{
    private static readonly BuildSystemId = 'npm-package'

    constructor(private readonly container: ServiceProvider)
    {
        ProjectSystemComposer.Compose(container)
    }

    // Builds the project in `project` (its project.plexus manifest drives the type),
    // resolving bases through `source`.
    public async Build(project: IStorage, source: IPackageSource): Promise<ComposedBuildOutcome>
    {
        const manifest = parseManifest(await project.ReadText(PROJECT_MANIFEST_FILENAME))
        const storage = new InMemoryBuildStorage()
        const manager = new TodlProjectBuildManager(this.container.getRequired(BuildSystemRegistryKey), storage)
        const { Result: result } = await manager.Build({
            Project: project,
            Manifest: manifest,
            BuildSystemId: ComposedPackageBuild.BuildSystemId,
            Source: source,
        })
        return { Ok: result.Ok, Diagnostics: result.Diagnostics, Output: storage.Output }
    }

    // Copies a build's package output into `backend` under `<id>/<version>/` — the
    // layout Plexus's package loaders (bundle.json, presentation) read.
    public static async PlaceInto(output: IStorage, backend: IStorage, id: string, version: string): Promise<void>
    {
        for (const file of await StorageTree.Files(output))
        {
            await backend.WriteBytes(`${id}/${version}/${file}`, await output.ReadBytes(file))
        }
    }
}

// Sandboxes each build in a fresh FakeStorage and promotes into one in-memory output.
class InMemoryBuildStorage implements IBuildStorageProvider
{
    private static readonly OutputPath = 'memory://build'

    public readonly Output = new FakeStorage()

    public CreateSandbox(): Promise<IStorage>
    {
        return Promise.resolve(new FakeStorage())
    }

    public DeleteSandbox(_sandbox: IStorage): Promise<void>
    {
        return Promise.resolve()
    }

    public OpenOutput(_outputName: string): Promise<OpenedOutput>
    {
        return Promise.resolve({ Storage: this.Output, Path: InMemoryBuildStorage.OutputPath })
    }
}
