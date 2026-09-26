import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DialogService, DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchitectureProjectFactory, ProjectEventKind, ProjectEventsKey, ProjectSystemComposer, type ProjectEvent } from '@pragmatic-tech-ai/todl'

import { EnvironmentService } from '@pragmatic-tech-ai/plexus-core/renderer/environment/environment-service.js'
import { FileSystemService, StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { OpenProjectsStore } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-projects-store.js'
import { RecentProjectsService } from '@pragmatic-tech-ai/plexus-core/renderer/projects/recent-projects-service.js'
import { PROJECT_MANIFEST_FILENAME } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project-factory.js'
import type { OpenProject } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-project.js'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer'

// Task 14: the explorer's create / open / reference-change paths reach TODL's
// ProjectEvents bus, and the composer's GeneratorScheduler runs the architecture
// project's generators (DtoGenerator → generated/model.ts, UiPlaceholderGenerator →
// generated/app.mu) against REAL project storage — no spy on the generators.

interface ExplorerPrivates
{
    openProjectAt(folder: string): Promise<void>
    manageReferences(op: OpenProject): Promise<void>
}

// A composed Plexus-shaped container: TODL's ProjectSystemComposer (what
// TodlProjectSystemModule runs at the head of app.mu) plus the explorer's host
// services, over per-folder in-memory storages.
class LifecycleHarness
{
    public static readonly Location = 'C:/work'
    public static readonly ProjectName = 'Shop'
    public static readonly ProjectId = 'shop'
    public static readonly PackageVersion = '0.1.0'
    public static readonly ModelFile = 'model.todl'
    public static readonly ArchModel = 'namespace acme { concept Widget { label : string?; } }'
    public static readonly DtoFile = 'generated/model.ts'
    public static readonly AppUiFile = 'generated/app.mu'

    public readonly Provider = new ServiceProvider()
    public readonly Service: ProjectExplorerService
    public readonly Raised: ProjectEventKind[] = []
    private readonly storages = new Map<string, FakeStorage>()

    constructor(dialogResult: unknown = undefined)
    {
        ProjectSystemComposer.Compose(this.Provider)
        this.Provider.registerInstance(ContentHostService.Key, new DocumentsContentHostService(this.Provider))
        // The recents / open-set stores persist through FileSystemService — an in-memory map.
        const files = new Map<string, string>()
        this.Provider.registerInstance(FileSystemService.Key, {
            Exists: (p: string) => Promise.resolve(files.has(p)),
            ReadText: (p: string) => Promise.resolve(files.get(p) ?? ''),
            WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
        } as unknown as FileSystemService)
        this.Provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
        this.Provider.registerInstance(DialogService.Key, {
            Show: () => Promise.resolve(dialogResult),
            Close: () => {},
        } as unknown as DialogService)
        const registry = new StorageService(this.Provider)
        registry.Register(StorageService.DefaultBackendId, (folder) => this.StorageFor(folder))
        this.Provider.registerInstance(StorageService.Key, registry)
        this.Provider.registerInstance(OpenProjectsStore.Key, new OpenProjectsStore(this.Provider))
        this.Provider.registerInstance(RecentProjectsService.Key, new RecentProjectsService(this.Provider))
        // Record every event the composed bus delivers (its real subscriber, the
        // scheduler, stays wired — this only observes).
        const events = this.Provider.getRequired(ProjectEventsKey) as unknown as { Subscribe(h: (e: ProjectEvent) => Promise<void>): void }
        events.Subscribe(async (e) => { this.Raised.push(e.Kind) })
        this.Service = new ProjectExplorerService(this.Provider)
    }

    public get Privates(): ExplorerPrivates
    {
        return this.Service as unknown as ExplorerPrivates
    }

    public get ProjectFolder(): string
    {
        return `${LifecycleHarness.Location}/${LifecycleHarness.ProjectName}`
    }

    public StorageFor(folder: string): FakeStorage
    {
        let storage = this.storages.get(folder)
        if (storage === undefined)
        {
            storage = new FakeStorage(folder)
            this.storages.set(folder, storage)
        }
        return storage
    }

    // An architecture project already on disk (manifest + one model file), with no
    // generated/ output yet — what Open Project / session restore finds.
    public async SeedExistingProject(): Promise<FakeStorage>
    {
        const storage = this.StorageFor(this.ProjectFolder)
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({
            type: ArchitectureProjectFactory.ProjectType, name: LifecycleHarness.ProjectName, version: 1,
            id: LifecycleHarness.ProjectId, packageVersion: LifecycleHarness.PackageVersion,
        }))
        await storage.WriteText(LifecycleHarness.ModelFile, LifecycleHarness.ArchModel)
        return storage
    }
}

test('creating an architecture project raises Created once and runs its generators', async () => {
    const harness = new LifecycleHarness()

    const outcome = await harness.Service.CreateProject({
        type: ArchitectureProjectFactory.ProjectType, name: LifecycleHarness.ProjectName, location: LifecycleHarness.Location,
    })

    expect(outcome.created).toBe(true)
    // The TODL factory raises Created itself; the explorer must not raise it again.
    expect(harness.Raised).toEqual([ProjectEventKind.Created])
    const project = harness.StorageFor(harness.ProjectFolder)
    expect(await project.Exists(LifecycleHarness.DtoFile)).toBe(true)
    expect(await project.Exists(LifecycleHarness.AppUiFile)).toBe(true)
})

test('opening an existing architecture project raises Opened, which backfills missing generated files', async () => {
    const harness = new LifecycleHarness()
    const project = await harness.SeedExistingProject()

    await harness.Privates.openProjectAt(harness.ProjectFolder)

    expect(harness.Service.Status).toBe(`Opened ${LifecycleHarness.ProjectName}.`)
    expect(harness.Raised).toEqual([ProjectEventKind.Opened])
    expect(await project.Exists(LifecycleHarness.DtoFile)).toBe(true)
    expect(await project.Exists(LifecycleHarness.AppUiFile)).toBe(true)
    expect(await project.ReadText(LifecycleHarness.DtoFile)).toContain('Widget')
})

test('opening does not overwrite generated files that are already present', async () => {
    const harness = new LifecycleHarness()
    const project = await harness.SeedExistingProject()
    const handAuthored = '// hand-authored\n'
    await project.WriteText(LifecycleHarness.DtoFile, handAuthored)
    await project.WriteText(LifecycleHarness.AppUiFile, handAuthored)

    await harness.Privates.openProjectAt(harness.ProjectFolder)

    expect(await project.ReadText(LifecycleHarness.DtoFile)).toBe(handAuthored)
    expect(await project.ReadText(LifecycleHarness.AppUiFile)).toBe(handAuthored)
})

test('editing references raises ReferencesChanged, which regenerates the model DTO', async () => {
    const harness = new LifecycleHarness({ metaModels: [], libraries: [] })
    const project = await harness.SeedExistingProject()
    await harness.Privates.openProjectAt(harness.ProjectFolder)
    const op = harness.Service.OpenProjects.ToArray()[0]!
    const stale = '// stale\n'
    await project.WriteText(LifecycleHarness.DtoFile, stale)
    harness.Raised.length = 0

    await harness.Privates.manageReferences(op)

    expect(harness.Raised).toEqual([ProjectEventKind.ReferencesChanged])
    const dto = await project.ReadText(LifecycleHarness.DtoFile)
    expect(dto).not.toBe(stale)
    expect(dto).toContain('Widget')
})
