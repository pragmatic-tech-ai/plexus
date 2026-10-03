import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DialogService, DocumentsContentHostService, DocumentTypeRegistry, type IDocument } from '@pragmatic-tech-ai/mural/framework'

import { EnvironmentService } from '@pragmatic-tech-ai/plexus-core/renderer/environment/environment-service.js'
import { FileSystemService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { FakeStorage, ObservableCollection } from '@pragmatic-tech-ai/todl-runtime'
import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { ProjectNode } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project.js'
import {
    Project, ProjectNode as DataProjectNode, ProjectNodeKind, ProjectFactoryRegistryKey,
    SolutionManagerService, SolutionMember, SolutionMemberStatus, SolutionBaseResolver, ProjectType,
    type IPackageRegistry, type PublishablePackage,
} from '@pragmatic-tech-ai/todl'
import { OpenProject } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-project.js'
import { DocumentCloseGuard } from '@pragmatic-tech-ai/plexus-core/renderer/documents/document-close-guard.js'
import { SavePromptResult } from '@pragmatic-tech-ai/plexus-core/renderer/dialogs/save-prompt-model.js'

// Build a todl DATA node (what a factory returns); the explorer projects it into a
// VM ProjectNode tree (op.Root). Tests fetch VM nodes back from op.Root by name.
const dnode = (name: string, path: string, kind: 'folder' | 'todl' | 'file' | 'diagram'): DataProjectNode =>
    new DataProjectNode(name, path, kind as unknown as ProjectNodeKind)
import { OpenProjectsStore } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-projects-store.js'
import { PROJECT_MANIFEST_FILENAME, type IProjectFactory, type IVersionedProjectFactory, type ProjectFileFormat } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project-factory.js'
import { ProjectSystemComposer, PackageStoreKey } from '@pragmatic-tech-ai/todl'
import { PACKAGES_BACKEND_ID } from '../../../services/projects/packages-backend.js'
import { PlexusPackageStore } from '../../../services/projects/storage-service-backends.js'
import { scanPublishedModels } from '../../meta-model/services/meta-model-tree-builder.js'
import { VersionPart } from '@pragmatic-tech-ai/plexus-core/renderer/projects/semver-bump.js'
import type { SetVersionResult } from '@pragmatic-tech-ai/plexus-core/renderer/projects/set-version-dialog-model.js'
import type { IDocumentFactory, IRelocatableDocumentFactory } from '@pragmatic-tech-ai/plexus-core/renderer/documents/document-factory.js'
import { ConfirmDialogModel } from '@pragmatic-tech-ai/plexus-core/renderer/dialogs/confirm-dialog-model.js'
import { ProjectExplorerService, applyPrefill, importFilters, uniqueStorageName } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer'
import { NewProjectDialogModel, ProjectTypeChoice } from '@pragmatic-tech-ai/plexus-core/renderer/projects/new-project-dialog-model.js'
import { MetaModelProjectFactory } from '../../meta-model/services/meta-model-project-factory.js'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostic.js'
import { LiveValidationKey, DiagramTreeExportKey, BaseResolverKey } from '@pragmatic-tech-ai/plexus-core/renderer/projects'

// A picked file as the OS dialog would hand it back (absolute path + raw bytes).
type Picked = { Path: string; Bytes: Uint8Array }
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s)

// Editors own files, not projects. The document factory (below) records file
// I/O; a project factory now provides only lifecycle + formats + publish.
interface Rec { opened: string[]; saved: IDocument[]; relocated: Array<[IDocument, string]> }

// A marker class: the DocumentDefinition.Factory token the explorer resolves for
// the `.todl` extension. Registered in the provider to a recording fake below.
class TodlDocFactoryToken {}

function fakeDocFactory(rec: Rec): IDocumentFactory & IRelocatableDocumentFactory
{
    const doc = (id: string): IDocument => ({ Id: id, Title: id, IsDirty: false, Save() {} })
    return {
        openFile: async (_s, path) => { rec.opened.push(path); return doc(path) },
        saveFile: async (d) => { rec.saved.push(d) },
        newFile: async (_s, name) => name,
        relocateOpenFile: (d, newPath) => { rec.relocated.push([d, newPath]) },
    }
}

// A project factory: lifecycle + one 'todl' format. No file I/O — that lives on the
// document factory, resolved by extension. Not versioned, so the Publish command is
// disabled for it (publishability is now gated on isVersioned — the producer marker).
function fakeProjectFactory(): IProjectFactory
{
    return {
        typeId: 'todl', title: 'Test Project', description: '',
        formats: [{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' }],
        createProject: async (_s, name) => projectWith(name, 'C:/x'),
        openProject: async () => projectWith('P', 'C:/x'),
        saveProject: async () => {},
    }
}

function projectWith(name: string, folder: string): Project
{
    const root = dnode(name, '', 'folder')
    root.Children.Add(dnode('core.todl', 'core.todl', 'todl'))
    return new Project('meta-model', name, folder, root)
}

// A factory whose openProject SCANS the given storage (like the real
// TodlProjectFactory) instead of returning a fixed tree — so a rescan reflects
// files written since the project opened. Used to exercise the import →
// rescan → Adopt/reconcile refresh that the fixed fake above cannot.
function scanningFactory(): IProjectFactory
{
    const scan = async (storage: FakeStorage): Promise<Project> => {
        const root = dnode('proj', '', 'folder')
        const populate = async (node: DataProjectNode): Promise<void> => {
            for (const e of await storage.List(node.Path))
            {
                if (node.Path === '' && e.Name === PROJECT_MANIFEST_FILENAME) continue
                const childPath = node.Path === '' ? e.Name : `${node.Path}/${e.Name}`
                const child = dnode(e.Name, childPath, e.IsDirectory ? 'folder' : (e.Name.endsWith('.todl') ? 'todl' : 'file'))
                node.Children.Add(child)
                if (e.IsDirectory) await populate(child)
            }
        }
        await populate(root)
        return new Project('meta-model', 'A', storage.Root, root)
    }
    return {
        typeId: 'meta-model', title: 'Meta-model', description: '',
        formats: [{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' }],
        createProject: async (s) => scan(s as FakeStorage),
        openProject: async (s) => scan(s as FakeStorage),
        saveProject: async () => {},
    }
}

// A versioned fake factory whose version lives in the manifest of the storage it's
// given. Being versioned makes it a producer, so the Publish command is enabled for it.
function fakeVersionedFactory(): IProjectFactory & IVersionedProjectFactory
{
    return {
        ...fakeProjectFactory(),
        getVersion: async (s) => (JSON.parse(await s.ReadText(PROJECT_MANIFEST_FILENAME)) as { packageVersion: string }).packageVersion,
        setVersion: async (s, v) => {
            const m = JSON.parse(await s.ReadText(PROJECT_MANIFEST_FILENAME))
            m.packageVersion = v
            await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(m))
        },
    }
}

async function seededStorage(folder: string, version = '0.1.0'): Promise<FakeStorage>
{
    const s = new FakeStorage(folder)
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', name: 'A', packageVersion: version }))
    return s
}

// An in-memory OS source tree for folder-import tests: absolute file path →
// text content. OpenFolder returns `pickedFolder`; ListDirectory/ReadBytes read
// this map (directory entries derived from path prefixes).
interface FakeOsTree { pickedFolder: string | null; files: Record<string, string> }

function fakeFs(openFiles: Picked[] | null = null, os: FakeOsTree = { pickedFolder: null, files: {} }): FileSystemService
{
    const files = new Map<string, string>()          // storage-side text (unused here)
    const osFiles = new Map(Object.entries(os.files))
    return {
        Exists: (p: string) => Promise.resolve(files.has(p)),
        ReadText: (p: string) => Promise.resolve(files.get(p) ?? ''),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
        OpenFiles: () => Promise.resolve(openFiles),
        OpenFolder: () => Promise.resolve(os.pickedFolder),
        ReadBytes: (p: string) => Promise.resolve(bytesOf(osFiles.get(p) ?? '')),
        ListDirectory: (dir: string) => {
            const prefix = dir.replace(/[\\/]+$/, '') + '/'
            const names = new Map<string, boolean>()   // name → isDirectory
            for (const key of osFiles.keys())
            {
                if (!key.startsWith(prefix)) continue
                const rest = key.slice(prefix.length)
                const slash = rest.indexOf('/')
                names.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1)
            }
            return Promise.resolve([...names].map(([Name, IsDirectory]) => ({ Name, IsDirectory })))
        },
    } as unknown as FileSystemService
}

interface ExplorerPrivates
{
    addOpenProject(p: Project, f: IProjectFactory, s: FakeStorage): Promise<OpenProject>
    openProjectAt(folder: string): Promise<void>
    openNode(node: ProjectNode, op: OpenProject): Promise<void>
    importFilesInto(op: OpenProject, target?: string): Promise<void>
    importFolderInto(op: OpenProject, target?: string): Promise<void>
    newFileIn(op: OpenProject, parentFolder?: string, format?: ProjectFileFormat): Promise<void>
    newFolderIn(op: OpenProject, parentFolder?: string): Promise<void>
    beginRename(op: OpenProject, node: ProjectNode): void
    commitRename(op: OpenProject, node: ProjectNode): Promise<void>
    deleteNodes(op: OpenProject, nodes: readonly ProjectNode[]): Promise<void>
    deleteFromNode(op: OpenProject, node: ProjectNode): Promise<void>
    moveNodes(op: OpenProject, nodes: readonly ProjectNode[], destParentPath: string): Promise<void>
    moveNodesAcross(source: OpenProject, nodes: readonly ProjectNode[], target: OpenProject, destParentPath: string): Promise<void>
    closeProject(op: OpenProject): Promise<void>
    bumpVersion(op: OpenProject, part: VersionPart): Promise<void>
    setVersionDialog(op: OpenProject): Promise<void>
    updateAgentMetadata(op: OpenProject): Promise<void>
    manageReferences(op: OpenProject): Promise<void>
    // The Solution-Explorer mutation façade + its path-based cores.
    deleteFiles(op: OpenProject, paths: readonly string[]): Promise<void>
    memberFor(op: OpenProject): SolutionMember | undefined
    MoveMemberNodes(member: SolutionMember, paths: readonly string[], destPath: string): Promise<void>
}

// A fake DialogService: Show records the shown content and resolves the preset
// confirm answer (so the confirm-then-delete flow runs without a real dialog).
function fakeDialogs(confirm: boolean | object, shown: unknown[]): DialogService
{
    return {
        Show: (opts: { Content: unknown }) => { shown.push(opts.Content); return Promise.resolve(confirm) },
        Close: () => {},
    } as unknown as DialogService
}

// ── Solution member sync fixtures (Task 4: W3b) ─────────────────────────────
// ProjectExplorerService now projects OpenProjects from
// SolutionManagerService.ActiveSolution.Members, so every explorer under test
// needs a SolutionManagerService.Key registered. A full real SolutionManagerService
// needs three more collaborators of its own (storage/prompt/package-source) just to
// construct, so most tests here use this minimal fake instead — it supplies exactly
// the surface ProjectExplorerService actually calls (ActiveSolution.Members,
// PropertyChanged, OpenProject, CloseProject). ActiveSolution never changes in these
// tests, so PropertyChanged's subscription is never expected to fire.
class FakeSolutionManager
{
    public readonly Members = new ObservableCollection<SolutionMember>()
    public readonly CloseCalls: SolutionMember[] = []
    // The active publish target PackagePublisher now reads (W3c): unset here, so most
    // tests fall through to the publisher's local-store default; a publish test that
    // needs to assert the manager's registry is honored sets this to a fake.
    public PublishRegistry: IPackageRegistry | undefined = undefined
    // Most tests never call OpenProject/RestoreSession through this fake (they seed
    // OpenProjects directly via addOpenProject, below); a test that needs it
    // overrides this.
    public OpenProjectImpl: (folder: string) => Promise<SolutionMember> =
        () => { throw new Error('FakeSolutionManager.OpenProject is not wired for this test') }

    public get ActiveSolution(): { Members: ObservableCollection<SolutionMember> }
    {
        return { Members: this.Members }
    }

    public PropertyChanged(_name: string): { subscribe(handler: () => void): { dispose(): void } }
    {
        return { subscribe: () => ({ dispose: () => {} }) }
    }

    public OpenProject(folder: string): Promise<SolutionMember>
    {
        return this.OpenProjectImpl(folder)
    }

    public async CloseProject(member: SolutionMember): Promise<void>
    {
        this.CloseCalls.push(member)
        this.Members.Remove(member)
    }
}

// A mutable IProjectFactoryRegistry a test grows on demand — MemberProjection.Build
// resolves a member's factory through it by Ref.type, so a member that stands in for
// a directly-constructed test Project/factory pair needs a matching registration.
class FakeProjectFactoryRegistry
{
    private readonly map = new Map<string, IProjectFactory>()

    public register(type: string, factory: IProjectFactory): void { this.map.set(type, factory) }
    public factoryFor(type: string): IProjectFactory | undefined { return this.map.get(type) }
    public All(): IProjectFactory[] { return [...this.map.values()] }
}

// The service's private per-member sync task (set synchronously whenever the
// member-sync loop observes an insert/remove) — awaited so a test can rely on the
// projection's async tail (openStore.Add/Remove) having actually landed, instead of
// guessing at a timeout.
function memberSyncTaskFor(service: ProjectExplorerService, member: SolutionMember): Promise<void> | undefined
{
    return (service as unknown as { memberSyncTasks: Map<SolutionMember, Promise<void>> }).memberSyncTasks.get(member)
}

let syntheticMemberType = 0

// Attach a same-named `addOpenProject(project, factory, storage)` onto `service` —
// every existing test in this file was written against the old direct mutator of
// that name; the member-sync architecture replaces it with "register a resolved
// SolutionMember and let the sync loop project it", so this reproduces the old
// call shape on top of the new mechanism rather than rewriting ~60 call sites.
// Registers `factory` under a fresh synthetic type so MemberProjection.Build
// resolves back to the exact instance the test passed in.
function attachAddOpenProject(
    service: ProjectExplorerService, manager: FakeSolutionManager, factories: FakeProjectFactoryRegistry,
): ProjectExplorerService & Pick<ExplorerPrivates, 'addOpenProject'>
{
    // subscribeToManager is no longer done in the ctor (it now runs from the host's
    // Start() after the solution seams are wired) — the harness starts it here so the
    // member-sync projection is live for every explorer test.
    service.Start()
    return Object.assign(service, {
        addOpenProject: async (project: Project, factory: IProjectFactory, storage: FakeStorage): Promise<OpenProject> => {
            const type = `test-type-${syntheticMemberType++}`
            factories.register(type, factory)
            const member = new SolutionMember({ path: project.RootPath, type })
            member.Project = project
            member.Storage = storage
            // P1 made SolutionMember.IsResolved === (Status === Resolved). The real
            // Solution.OpenOne sets this on a successful open; this harness bypasses
            // OpenOne (it seeds Project/Storage directly), so mark it Resolved too or the
            // service's member-sync waits forever for a 'Project' change that never fires.
            member.Status = SolutionMemberStatus.Resolved
            manager.Members.Add(member)
            await memberSyncTaskFor(service, member)
            const op = service.OpenProjects.ToArray().find((o) => o.Folder === project.RootPath)
            if (op === undefined) throw new Error(`addOpenProject: "${project.RootPath}" was not projected onto OpenProjects`)
            return op
        },
    })
}

function makeExplorer(openFiles: Picked[] | null = null, confirm: boolean | object = true, os: FakeOsTree = { pickedFolder: null, files: {} }): {
    service: ProjectExplorerService
    host: DocumentsContentHostService
    store: OpenProjectsStore
    priv: ExplorerPrivates
    provider: ServiceProvider
    shownDialogs: unknown[]
    rec: Rec
    occupied: Set<string>
    created: Set<string>
    manager: FakeSolutionManager
    factories: FakeProjectFactoryRegistry
}
{
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    provider.registerInstance(FileSystemService.Key, fakeFs(openFiles, os))
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    const shownDialogs: unknown[] = []
    provider.registerInstance(DialogService.Key, fakeDialogs(confirm, shownDialogs))
    // Storage registry whose per-folder storage reports a project manifest only for
    // folders marked `occupied` — enough to exercise New-Project validation.
    const occupied = new Set<string>()
    const created = new Set<string>()
    provider.registerInstance(StorageService.Key, {
        Create: (_backend: string, folder: string) => ({
            Exists: (name: string) => Promise.resolve(occupied.has(folder) && name === PROJECT_MANIFEST_FILENAME),
            CreateDirectory: (rel: string) => { created.add(joinAbs(folder, rel)); return Promise.resolve() },
        }),
    } as unknown as StorageService)
    const store = new OpenProjectsStore(provider)
    provider.registerInstance(OpenProjectsStore.Key, store)
    // Editor routing: a recording `.todl` document factory + a registry that
    // resolves the extension to its token.
    const rec: Rec = { opened: [], saved: [], relocated: [] }
    provider.registerInstance(ServiceProvider.tokenFor(TodlDocFactoryToken), fakeDocFactory(rec))
    provider.registerInstance(DocumentTypeRegistry.Key, {
        GetByExtension: (ext: string) => ((ext === '.todl' || ext === '.diagram') ? { Factory: TodlDocFactoryToken } : undefined),
    } as unknown as DocumentTypeRegistry)
    const manager = new FakeSolutionManager()
    const factories = new FakeProjectFactoryRegistry()
    provider.registerInstance(ProjectFactoryRegistryKey, factories)
    provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService)
    const service = attachAddOpenProject(new ProjectExplorerService(provider), manager, factories)
    return { service, host, store, priv: service as unknown as ExplorerPrivates, provider, shownDialogs, rec, occupied, created, manager, factories }
}

// Mirror of the service's separator-aware absolute-path join, for asserting the
// subfolder a new project lands in.
function joinAbs(dir: string, name: string): string
{
    if (name === '') return dir
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    return dir.endsWith(sep) ? dir + name : dir + sep + name
}

function childNode(op: OpenProject): ProjectNode
{
    return op.Root.Children.ToArray()[0]!
}

test('opening two projects adds two roots; reopening one dedupes', async () => {
    const { service, priv, store } = makeExplorer()
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))
    await priv.addOpenProject(projectWith('A2', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))   // same folder

    expect(service.OpenProjects.Count).toBe(2)
    expect((await store.List()).slice().sort()).toEqual(['C:/a', 'C:/b'])
})

test('clicking a file already open in the editor re-activates its tab instead of opening a duplicate', async () => {
    const { priv, host, rec } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const node = childNode(op)

    await priv.openNode(node, op)
    await priv.openNode(node, op)   // second click on the same node

    expect(rec.opened).toEqual(['core.todl'])            // openFile called once — no duplicate document
    expect(host.OpenDocuments.ToArray().length).toBe(1)  // a single tab
})

test('RefreshProjects rescans each named project and refreshes its bases; unknown folders are skipped', async () => {
    const { service, priv, provider } = makeExplorer()
    const factory = fakeProjectFactory()
    await priv.addOpenProject(projectWith('A', 'C:/a'), factory, new FakeStorage('C:/a'))

    // A recording language client, registered AFTER open so AttachProject stays skipped.
    const calls: string[] = []
    provider.registerInstance(LiveValidationKey, {
        RefreshBases: async () => { calls.push('refresh') },
        ResyncProject: async () => { calls.push('resync') },
    } as never)

    // Count rescans via the factory's openProject.
    let opened = 0
    const orig = factory.openProject.bind(factory)
    factory.openProject = async (s) => { opened += 1; return orig(s) }

    await service.RefreshProjects(['C:/a', 'C:/does-not-exist'])

    expect(opened).toBe(1)                       // only the known project rescanned
    expect(calls).toEqual(['resync', 'refresh']) // rescan resyncs the doc set, then bases refresh
})

// W3b Task 5: WorkspaceBaseResolver retired — RefreshProjects now awaits the
// reshaped IBaseResolver.ProducedIdOf (async) and, for a changed producer,
// invalidates it through SolutionBaseResolver.Invalidate directly (no more
// RefreshDependentsOfIds fan-out on IBaseResolver itself).
test('RefreshProjects awaits ProducedIdOf and invalidates a changed producer via SolutionBaseResolver', async () => {
    const { service, priv, provider } = makeExplorer()
    const factory = fakeProjectFactory()
    const producerOp = await priv.addOpenProject(projectWith('A', 'C:/a'), factory, new FakeStorage('C:/a'))
    const consumerOp = await priv.addOpenProject(projectWith('B', 'C:/b'), factory, new FakeStorage('C:/b'))

    provider.registerInstance(LiveValidationKey, {
        RefreshBases: async () => {},
        ResyncProject: async () => {},
    } as never)

    const producedIdOfCalls: unknown[] = []
    provider.registerInstance(BaseResolverKey, {
        WorkspaceProducers: async () => [],
        ProducedIdOf: async (storage: unknown) => {
            producedIdOfCalls.push(storage)
            return storage === producerOp.Storage ? 'ea' : undefined
        },
    } as never)
    const invalidateCalls: string[] = []
    provider.registerInstance(SolutionBaseResolver.Key, {
        Invalidate: (id: string) => invalidateCalls.push(id),
    } as unknown as SolutionBaseResolver)

    await service.RefreshProjects(['C:/a', 'C:/b'])

    expect(producedIdOfCalls).toEqual([producerOp.Storage, consumerOp.Storage])
    expect(invalidateCalls).toEqual(['ea'])   // only the producer, not the consumer
})

// W3b Task 5: manageReferences migrated its WorkspaceProducers kind argument from
// the old ProducerKind to TODL's ProjectType (the reshaped IBaseResolver).
test('manageReferences asks the resolver for open workspace meta-model producers via ProjectType', async () => {
    const { priv, provider } = makeExplorer()
    const storage = new FakeStorage('C:/arch')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', metaModels: [], libraries: [] }))
    const op = await priv.addOpenProject(projectWith('Arch', 'C:/arch'), fakeProjectFactory(), storage)

    const kinds: ProjectType[] = []
    provider.registerInstance(BaseResolverKey, {
        WorkspaceProducers: async (kind: ProjectType) => { kinds.push(kind); return [] },
        ProducedIdOf: async () => undefined,
    } as never)

    await priv.manageReferences(op)

    expect(kinds).toEqual([ProjectType.MetaModel])
})

function formWith(types: string[]): NewProjectDialogModel
{
    const choices = types.map((t) => new ProjectTypeChoice(t, t, `${t} project`))
    // fs/validate/close are unused by applyPrefill; pass inert stubs.
    return new NewProjectDialogModel(choices, {} as never, async () => null, () => {})
}

test('applyPrefill sets name/location and selects the matching type', () => {
    const form = formWith(['diagram', 'library'])
    applyPrefill(form, { name: 'Acme', location: 'C:/acme', type: 'library' })
    expect(form.Name).toBe('Acme')
    expect(form.Location).toBe('C:/acme')
    expect(form.SelectedType?.Type).toBe('library')
})

test('applyPrefill ignores an unknown type and missing fields', () => {
    const form = formWith(['diagram'])
    applyPrefill(form, { type: 'nope' })
    expect(form.SelectedType?.Type).toBe('diagram')   // stays on the default first type
    expect(form.Name).toBe('')
})

// A form whose architecture type requires a meta-model + offers libraries, with a
// published meta-model and two libraries available to the pickers.
function archForm(): NewProjectDialogModel
{
    const choices = [new ProjectTypeChoice('architecture', 'Architecture', 'arch project', true, true)]
    const metaModels = [{ id: 'tech-architecture', version: '0.1.0' }]
    const libraries = [{ id: 'microsoft', version: '0.1.0' }, { id: 'aws', version: '0.2.0' }]
    return new NewProjectDialogModel(choices, {} as never, async () => null, () => {}, metaModels, libraries)
}

test('applyPrefill selects the prefilled meta-model and checks the prefilled libraries', () => {
    const form = archForm()
    applyPrefill(form, {
        type: 'architecture',
        metaModels: [{ id: 'tech-architecture', version: '0.1.0' }],
        libraries: [{ id: 'microsoft', version: '0.1.0' }],
    })
    expect(form.SelectedMetaModels).toEqual([{ id: 'tech-architecture', version: '0.1.0' }])
    expect(form.SelectedLibraries).toEqual([{ id: 'microsoft', version: '0.1.0' }])   // aws stays unchecked
})

test('applyPrefill ignores meta-model/library refs not among the published choices', () => {
    const form = archForm()
    applyPrefill(form, {
        type: 'architecture',
        metaModels: [{ id: 'nope', version: '9' }],
        libraries: [{ id: 'ghost', version: '1' }],
    })
    expect(form.SelectedMetaModels).toEqual([])
    expect(form.SelectedLibraries).toEqual([])
})

test('CreateProject refuses when the project SUBFOLDER already contains a project', async () => {
    const { service, occupied } = makeExplorer()
    occupied.add('C:/loc/X')   // the subfolder location/name, not the parent
    const outcome = await service.CreateProject({ type: 'diagram', name: 'X', location: 'C:/loc' })
    expect(outcome.created).toBe(false)
    expect(outcome.error).toContain('already contains a project')
})

test('CreateProject targets a subfolder named after the project inside the chosen location', async () => {
    const { service, occupied, created, provider } = makeExplorer()
    // No factory for the type → createProjectAt bails cleanly after the subfolder
    // is created; we only assert the subfolder (location/name) was the target.
    provider.registerInstance(ProjectFactoryRegistryKey, { factoryFor: () => undefined, All: () => [] })
    // Parent occupied, subfolder free → not refused for the manifest reason.
    occupied.add('C:/loc')
    const outcome = await service.CreateProject({ type: 'diagram', name: 'My App', location: 'C:/loc' })
    expect(created.has('C:/loc/My App')).toBe(true)
    expect(outcome.error ?? '').not.toContain('already contains a project')
})

test('opening a node opens it through the registered document editor', async () => {
    const { priv, host, rec } = makeExplorer()
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))

    await priv.openNode(childNode(opB), opB)

    expect(rec.opened).toEqual(['core.todl'])
    expect(host.OpenDocuments.Count).toBe(1)
})

test('closing a project removes it, closes its tabs, and unpersists it', async () => {
    const { service, host, store, priv } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))

    await priv.openNode(childNode(op), op)
    expect(host.OpenDocuments.Count).toBe(1)

    await priv.closeProject(op)

    expect(service.OpenProjects.Count).toBe(0)
    expect(host.OpenDocuments.Count).toBe(0)
    expect(await store.List()).toEqual([])
})

// ── Solution member sync (Task 4: W3b) ──────────────────────────────────────

test('a member added to ActiveSolution.Members is projected into OpenProjects; AttachProject and openStore.Add run', async () => {
    const { service, manager, factories, provider, store } = makeExplorer()
    const attachCalls: unknown[] = []
    provider.registerInstance(LiveValidationKey, {
        AttachProject: async (...args: unknown[]) => { attachCalls.push(args) },
        DetachProject: () => {},
    } as never)
    factories.register('todl', fakeProjectFactory())
    const member = new SolutionMember({ path: 'C:/a', type: 'todl' })
    member.Project = projectWith('A', 'C:/a')
    member.Storage = new FakeStorage('C:/a')
    member.Status = SolutionMemberStatus.Resolved

    manager.Members.Add(member)
    await memberSyncTaskFor(service, member)

    const op = service.OpenProjects.ToArray()[0]
    expect(op).toBeDefined()
    expect(op!.Root).toBeDefined()
    expect(op!.RefreshBasesCommand).toBeDefined()
    expect(attachCalls).toHaveLength(1)
    expect(await store.List()).toEqual(['C:/a'])
})

test('a member removed from ActiveSolution.Members drops it from OpenProjects; DetachProject and openStore.Remove run', async () => {
    const { service, manager, factories, provider, store } = makeExplorer()
    const detachCalls: unknown[] = []
    provider.registerInstance(LiveValidationKey, {
        AttachProject: async () => {},
        DetachProject: (...args: unknown[]) => { detachCalls.push(args) },
    } as never)
    factories.register('todl', fakeProjectFactory())
    const member = new SolutionMember({ path: 'C:/a', type: 'todl' })
    member.Project = projectWith('A', 'C:/a')
    member.Storage = new FakeStorage('C:/a')
    member.Status = SolutionMemberStatus.Resolved
    manager.Members.Add(member)
    await memberSyncTaskFor(service, member)
    expect(service.OpenProjects.Count).toBe(1)

    manager.Members.Remove(member)
    await memberSyncTaskFor(service, member)

    expect(service.OpenProjects.Count).toBe(0)
    expect(detachCalls).toHaveLength(1)
    expect(await store.List()).toEqual([])
})

test('two members that resolve to the same folder project only once (dedupe by folder)', async () => {
    const { service, manager, factories } = makeExplorer()
    factories.register('todl-a', fakeProjectFactory())
    factories.register('todl-b', fakeProjectFactory())
    const memberA = new SolutionMember({ path: 'C:/a', type: 'todl-a' })
    memberA.Project = projectWith('A', 'C:/a')
    memberA.Storage = new FakeStorage('C:/a')
    memberA.Status = SolutionMemberStatus.Resolved
    const memberB = new SolutionMember({ path: 'C:/a', type: 'todl-b' })
    memberB.Project = projectWith('A2', 'C:/a')   // same folder as memberA
    memberB.Storage = new FakeStorage('C:/a')
    memberB.Status = SolutionMemberStatus.Resolved

    manager.Members.Add(memberA)
    await memberSyncTaskFor(service, memberA)
    manager.Members.Add(memberB)
    await memberSyncTaskFor(service, memberB)

    expect(service.OpenProjects.Count).toBe(1)
})

// Fix round 1 (review of 66cd3fa): a second member that resolves to the SAME
// folder WHILE the first is still mid-resolution races the entry-check dedupe
// (line ~401, exercised above) and must instead be caught by the RE-check inside
// projectMember (~line 423) — the one that runs after a member's own await on
// waitForResolution. Drive this explicitly: add memberA UNRESOLVED (so
// onMemberAdded suspends), let memberB (already resolved) win the folder, THEN
// resolve memberA and confirm its post-wait re-check skips it.
test('a member resolving to an already-claimed folder AFTER waiting is still deduped (async race, Review Focus #3)', async () => {
    const { service, manager, factories } = makeExplorer()
    factories.register('todl-a', fakeProjectFactory())
    factories.register('todl-b', fakeProjectFactory())

    const memberA = new SolutionMember({ path: 'C:/a', type: 'todl-a' })   // unresolved when added
    manager.Members.Add(memberA)
    const taskA = memberSyncTaskFor(service, memberA)!   // onMemberAdded is now suspended in waitForResolution

    const memberB = new SolutionMember({ path: 'C:/a', type: 'todl-b' })
    memberB.Project = projectWith('B', 'C:/a')   // already resolved before being added — projects immediately
    memberB.Storage = new FakeStorage('C:/a')
    memberB.Status = SolutionMemberStatus.Resolved
    manager.Members.Add(memberB)
    await memberSyncTaskFor(service, memberB)

    expect(service.OpenProjects.Count).toBe(1)
    expect(service.OpenProjects.ToArray()[0]!.Name).toBe('B')   // B won the folder first

    // Resolve A now — its post-wait re-check (line ~423) must find the folder
    // already taken and skip building, rather than double-projecting it. Set Status
    // before Project so IsResolved is true when waitForResolution's 'Project' handler runs.
    memberA.Storage = new FakeStorage('C:/a')
    memberA.Status = SolutionMemberStatus.Resolved
    memberA.Project = projectWith('A', 'C:/a')
    await taskA

    expect(service.OpenProjects.Count).toBe(1)
    expect(service.OpenProjects.ToArray()[0]!.Name).toBe('B')
})

// Fix round 1: openProjectAt used to hang forever opening a folder whose type has
// no registered factory — manager.OpenProject adds the member synchronously, then
// Solution.OpenOne sets member.Project = undefined (still raising 'Project' even
// though the value is unchanged); the old waitForResolution bailed on
// `!member.IsResolved` instead of settling, so its promise — and everything
// awaiting it, including this call — never resolved. Also verifies the orphaned
// member is dropped rather than left stranded in Members forever.
test('openProjectAt reports "no factory" without hanging, and KEEPS the unresolved member as an error row (P6b)', async () => {
    const { service, priv, manager, store } = makeExplorer()
    let capturedMember: SolutionMember | undefined

    manager.OpenProjectImpl = async (folder) => {
        const member = new SolutionMember({ path: folder, type: 'unregistered-type' })
        capturedMember = member
        manager.Members.Add(member)
        // Mirrors Solution.OpenOne's no-factory branch: explicitly (re-)assigns
        // Project to fire 'Project' even though the value doesn't change — the
        // signal ProjectExplorerService's internal wait settles on.
        member.Project = undefined
        return member
    }

    await priv.openProjectAt('C:/unregistered')
    await new Promise((r) => setTimeout(r, 0))   // let the member-sync loop settle

    expect(service.Status).toBe('No factory for project type "unregistered-type".')
    expect(service.OpenProjects.Count).toBe(0)                            // never projected
    // P6b: the unresolved member is NO LONGER auto-dropped — it stays so it renders as an
    // error/warning row the user can remove via RemoveMember.
    expect(manager.Members.ToArray()).toEqual([capturedMember])
    expect(memberSyncTaskFor(service, capturedMember!)).toBeDefined()
    expect(await store.List()).toEqual([])                               // nothing persisted
})

// Fix round 1: onMemberRemoved now prunes memberSyncTasks for every removed
// member (resolved-and-projected or not) — otherwise a long-lived explorer
// accumulates one dead map entry per member ever opened-and-closed.
test('closing a project prunes its member-sync bookkeeping (no unbounded growth across open/close cycles)', async () => {
    const { service, priv, manager, factories } = makeExplorer()
    factories.register('todl', fakeProjectFactory())
    const member = new SolutionMember({ path: 'C:/a', type: 'todl' })
    member.Project = projectWith('A', 'C:/a')
    member.Storage = new FakeStorage('C:/a')
    member.Status = SolutionMemberStatus.Resolved
    manager.Members.Add(member)
    await memberSyncTaskFor(service, member)
    expect(memberSyncTaskFor(service, member)).toBeDefined()

    const op = service.OpenProjects.ToArray()[0]!
    await priv.closeProject(op)

    expect(memberSyncTaskFor(service, member)).toBeUndefined()
})

// Fix round 2 (review of 672664b): trackRemoval's cleanup was attached as a
// fulfillment-only handler. onMemberRemoved's `await this.openStore.Remove(...)`
// for a PROJECTED member is real disk I/O and can reject — a fulfillment-only
// handler would then never prune the memberSyncTasks entry (reopening exactly
// the leak Fix 2 closed, just gated behind an I/O failure instead of the
// no-factory case) and would leave the derived `.then()` promise's rejection
// unhandled. closeProject's OWN error propagation is untouched by this fix (it
// awaits its own reference to the same task) and is expected to still reject —
// this test asserts that, but only to reach the post-rejection state; it isn't
// asserting anything new about that propagation itself.
test('a rejected openStore.Remove during close still prunes the member-sync bookkeeping (Fix 2 must survive an I/O failure, not just the no-factory case)', async () => {
    const { service, priv, manager, factories, store } = makeExplorer()
    factories.register('todl', fakeProjectFactory())
    const member = new SolutionMember({ path: 'C:/a', type: 'todl' })
    member.Project = projectWith('A', 'C:/a')
    member.Storage = new FakeStorage('C:/a')
    member.Status = SolutionMemberStatus.Resolved
    manager.Members.Add(member)
    await memberSyncTaskFor(service, member)
    const op = service.OpenProjects.ToArray()[0]!

    // Fail the NEXT Remove call once (the one onMemberRemoved's teardown makes),
    // then restore normal behavior.
    const realRemove = store.Remove.bind(store)
    store.Remove = async (): Promise<void> => {
        store.Remove = realRemove
        throw new Error('disk full (simulated)')
    }

    await expect(priv.closeProject(op)).rejects.toThrow('disk full (simulated)')

    // trackRemoval's own branch consumed the rejection via .then(cleanup, cleanup)
    // — the entry is pruned regardless of the I/O failure, and this test itself
    // completing (rather than vitest reporting an unhandled rejection from that
    // branch) is what proves nothing leaked out of it unhandled.
    expect(memberSyncTaskFor(service, member)).toBeUndefined()
})

test('closeProject cancelled by the DocumentCloseGuard leaves the project open and never calls SolutionManagerService.CloseProject', async () => {
    const { priv, service, manager, host, provider } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    await priv.openNode(childNode(op), op)
    const doc = host.OpenDocuments.ToArray()[0]!
    ;(doc as unknown as { IsDirty: boolean }).IsDirty = true
    provider.registerInstance(DocumentCloseGuard.Key, new DocumentCloseGuard(provider, { prompt: async () => SavePromptResult.Cancel }))

    await priv.closeProject(op)

    expect(service.OpenProjects.ToArray()).toContain(op)
    expect(manager.CloseCalls).toHaveLength(0)
    expect(host.OpenDocuments.Count).toBe(1)
})

test('Publish is enabled only for a versioned (producer) project', async () => {
    const { priv } = makeExplorer()
    const pub = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory(), new FakeStorage('C:/a'))
    const plain = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))

    expect(pub.PublishCommand!.CanExecute(undefined)).toBe(true)
    expect(plain.PublishCommand!.CanExecute(undefined)).toBe(false)
})

interface PublishPrivates { publishProject(op: OpenProject): Promise<void> }

// A clean meta-model source (concepts in one file) the composed npm-publish build
// compiles without diagnostics.
const PUBLISHABLE_TODL = 'namespace d { concept model { label : string; } concept component { label : string; } }'
// A syntax error (missing concept name) — the build fails and promotes nothing.
const UNPUBLISHABLE_TODL = 'namespace d { concept { label : string; } }'

// A meta-model project storage: a publish-ready manifest (type/name/id/version) plus
// one .todl source the build compiles.
async function metaModelStorage(folder: string, id: string, source: string, version = '0.1.0'): Promise<FakeStorage>
{
    const s = new FakeStorage(folder)
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', name: id, id, packageVersion: version }))
    await s.WriteText('defs.todl', source)
    return s
}

// An explorer wired for real publishing: the composed build system (BuildSystemRegistryKey
// seeded by ProjectSystemComposer) + PlexusPackageStore over an inspectable packages
// backend (pre-registered so ensurePackagesBackend finds it) + a Diagnostics store. This
// is the seam publishProject drives through PackagePublisher's npm-publish flavor.
function makePublishExplorer(confirm: boolean | object = true): {
    service: ProjectExplorerService
    priv: ExplorerPrivates
    provider: ServiceProvider
    diagnostics: DiagnosticsService
    packages: FakeStorage
    manager: FakeSolutionManager
    factories: FakeProjectFactoryRegistry
}
{
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    provider.registerInstance(FileSystemService.Key, fakeFs())
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    provider.registerInstance(DialogService.Key, fakeDialogs(confirm, []))
    const packages = new FakeStorage('fake://packages')
    const storage = new StorageService(provider)
    storage.Register(PACKAGES_BACKEND_ID, () => packages)
    provider.registerInstance(StorageService.Key, storage)
    provider.registerInstance(OpenProjectsStore.Key, new OpenProjectsStore(provider))
    provider.registerInstance(DocumentTypeRegistry.Key, {
        GetByExtension: (ext: string) => ((ext === '.todl' || ext === '.diagram') ? { Factory: TodlDocFactoryToken } : undefined),
    } as unknown as DocumentTypeRegistry)
    provider.registerInstance(ServiceProvider.tokenFor(TodlDocFactoryToken), fakeDocFactory({ opened: [], saved: [], relocated: [] }))
    provider.registerInstance(PackageStoreKey, new PlexusPackageStore(provider))
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    // Seed the build system registry (+ factories + default baker) into the container.
    ProjectSystemComposer.Compose(provider)
    // Replace the composed ProjectFactoryRegistry with a mutable fake: these tests
    // open projects via addOpenProject (an explicit factory instance per call), and
    // MemberProjection.Build must resolve back to that exact instance — nothing here
    // opens/creates through the real factory-registry path, so the built-ins
    // ProjectSystemComposer seeded are unused regardless.
    const manager = new FakeSolutionManager()
    const factories = new FakeProjectFactoryRegistry()
    provider.registerInstance(ProjectFactoryRegistryKey, factories)
    provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService)
    const service = attachAddOpenProject(new ProjectExplorerService(provider), manager, factories)
    return { service, priv: service as unknown as ExplorerPrivates, provider, diagnostics, packages, manager, factories }
}

test('a failed publish surfaces the build errors as a project-level diagnostic in the Problems store', async () => {
    const { service, priv, diagnostics } = makePublishExplorer()
    const op = await priv.addOpenProject(
        projectWith('A', 'C:/a'), fakeVersionedFactory(), await metaModelStorage('C:/a', 'a', UNPUBLISHABLE_TODL))

    await (service as unknown as PublishPrivates).publishProject(op)

    const pubs = [...diagnostics.All].filter((d) => d.owner === 'publish')
    expect(pubs).toHaveLength(1)
    expect(pubs[0]).toMatchObject({
        owner: 'publish', projectId: 'C:/a', projectName: 'A', uri: null,
        severity: DiagnosticSeverity.Error, span: null,
    })
    expect(pubs[0]!.message.length).toBeGreaterThan(0)
    // The error description goes ONLY to Problems — the status pane shows a neutral pointer.
    expect(service.Status).toBe('Publish failed — see Problems.')
})

test('a successful publish clears any prior publish diagnostic and lands the package where bases resolve', async () => {
    const { service, priv, diagnostics, packages } = makePublishExplorer()
    const storage = await metaModelStorage('C:/a', 'a', UNPUBLISHABLE_TODL)
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory(), storage)

    await (service as unknown as PublishPrivates).publishProject(op)
    expect([...diagnostics.All].some((d) => d.owner === 'publish')).toBe(true)

    await storage.WriteText('defs.todl', PUBLISHABLE_TODL)   // fix the error, then republish
    await (service as unknown as PublishPrivates).publishProject(op)

    expect([...diagnostics.All].some((d) => d.owner === 'publish')).toBe(false)
    expect(service.Status.startsWith('Published ')).toBe(true)
    // Round-trip (ruling 2): the package lands at the BARE-id path the meta-model
    // discovery scan reads, so a sibling project resolves it as a base.
    const published = await scanPublishedModels(packages)
    expect(published).toEqual([{ id: 'a', versions: ['0.1.0'] }])
})

// A recording publish target: the publisher only ever calls Publish, so this captures
// each Publish and is cast to IPackageRegistry at the assignment site rather than
// stubbing that interface's full read surface. A test uses it to assert the publisher
// targeted the registry set on SolutionManagerService.PublishRegistry rather than
// constructing its own local-store default.
class RecordingRegistry
{
    public readonly Published: PublishablePackage[] = []

    public async Publish(pkg: PublishablePackage): Promise<void> { this.Published.push(pkg) }
}

test('publish targets the registry set on SolutionManagerService.PublishRegistry, not the local-store default (W3c)', async () => {
    const { service, priv, manager, packages } = makePublishExplorer()
    const registry = new RecordingRegistry()
    manager.PublishRegistry = registry as unknown as IPackageRegistry
    const op = await priv.addOpenProject(
        projectWith('A', 'C:/a'), fakeVersionedFactory(), await metaModelStorage('C:/a', 'a', PUBLISHABLE_TODL))

    await (service as unknown as PublishPrivates).publishProject(op)

    // The build succeeded and pushed to the manager's registry, not the local default.
    expect(service.Status.startsWith('Published ')).toBe(true)
    expect(registry.Published).toHaveLength(1)
    // Nothing landed in the local packages store — the manager's registry overrode it.
    expect(await scanPublishedModels(packages)).toEqual([])
})

test('RestoreSession reopens folders that exist and prunes missing ones', async () => {
    const provider = new ServiceProvider()
    const host = new DocumentsContentHostService(provider)
    provider.registerInstance(ContentHostService.Key, host)
    provider.registerInstance(FileSystemService.Key, fakeFs())
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    const store = new OpenProjectsStore(provider)
    provider.registerInstance(OpenProjectsStore.Key, store)

    // Per-folder FakeStorage; only C:/a has a project manifest.
    const storages = new Map<string, FakeStorage>()
    const storageFor = (folder: string): FakeStorage => {
        let s = storages.get(folder)
        if (s === undefined) { s = new FakeStorage(folder); storages.set(folder, s) }
        return s
    }
    const registry = new StorageService(provider)
    registry.Register(StorageService.DefaultBackendId, (folder) => storageFor(folder))
    provider.registerInstance(StorageService.Key, registry)
    // A fake factory registry (the real one's ctor needs the ApplicationService).
    // GetByType returns undefined → C:/a is opened-attempted but its type has no
    // factory, so it's kept (not pruned); only manifest-less C:/b is pruned.
    provider.registerInstance(ProjectFactoryRegistryKey, { factoryFor: () => undefined, All: () => [] })
    await storageFor('C:/a').WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'unregistered' }))

    await store.Add('C:/a')
    await store.Add('C:/b')   // no manifest → should be pruned

    // A minimal fake manager whose OpenProject mirrors just enough of the real
    // SolutionManagerService.OpenProject (Solution.AddMember/OpenOne) to exercise
    // RestoreSession's delegation: read the manifest, add a member (its own
    // Members.Add is what the member-sync loop reacts to), and resolve its
    // factory — which the registered fake leaves undefined, so the member stays
    // unresolved (matching "its factory type isn't registered" below).
    const manager = new FakeSolutionManager()
    let openProjectCalls = 0
    manager.OpenProjectImpl = async (folder) => {
        openProjectCalls++
        const storage = storageFor(folder)
        const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as { type: string }
        const member = new SolutionMember({ path: folder, type: manifest.type })
        manager.Members.Add(member)
        const factory = provider.getRequired(ProjectFactoryRegistryKey).factoryFor(manifest.type)
        if (factory !== undefined) { member.Storage = storage; member.Project = await factory.openProject(storage) }
        return member
    }
    provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService)

    const service = new ProjectExplorerService(provider)
    // Mirror the host boot order: Start() (member-sync subscription) before
    // RestoreSession, since the ctor no longer subscribes.
    service.Start()
    await service.RestoreSession()

    // C:/b pruned (missing manifest); C:/a kept (it has a manifest, even though
    // its factory type isn't registered in this test, so it isn't removed) — and
    // OpenProject was asked for exactly once (only C:/a has a manifest).
    expect(await store.List()).toEqual(['C:/a'])
    expect(openProjectCalls).toBe(1)
})

test('Add Existing Files copies each picked file into the project storage', async () => {
    const picked: Picked[] = [
        { Path: 'C:/ext/logo.png', Bytes: bytesOf('PNG') },
        { Path: 'C:/ext/notes.txt', Bytes: bytesOf('hello') },
    ]
    const { service, priv } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.importFilesInto(op)

    expect(await storage.Exists('logo.png')).toBe(true)
    expect(await storage.Exists('notes.txt')).toBe(true)
    expect(service.Status).toBe('Added 2 files.')
})

test('Add Existing Files auto-renames on a name collision, leaving the original', async () => {
    const picked: Picked[] = [{ Path: 'C:/ext/core.todl', Bytes: bytesOf('imported') }]
    const { priv } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'existing')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.importFilesInto(op)

    expect(await storage.Exists('core-2.todl')).toBe(true)   // imported under a fresh name
    expect(await storage.ReadText('core.todl')).toBe('existing')   // original untouched
})

test('Add Existing Files is a no-op when the picker is cancelled', async () => {
    const { priv } = makeExplorer(null)
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const before = storage.size

    await priv.importFilesInto(op)

    expect(storage.size).toBe(before)
})

test('Import File rescans + reconciles so the imported node appears in the tree', async () => {
    const picked: Picked[] = [{ Path: 'C:/ext/logo.png', Bytes: bytesOf('PNG') }]
    const { priv } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('a.todl', 'x')
    const factory = scanningFactory()
    const op = await priv.addOpenProject(await factory.openProject(storage), factory, storage)
    expect(op.Root.Children.ToArray().map((c) => c.Path)).toEqual(['a.todl'])

    await priv.importFilesInto(op)

    // The tree model (op.Root.Children) reflects the rescanned + reconciled node.
    expect(op.Root.Children.ToArray().map((c) => c.Path)).toEqual(['a.todl', 'logo.png'])
})

test('Import File into a subfolder raises a reveal request for that folder', async () => {
    const picked: Picked[] = [{ Path: 'C:/ext/logo.png', Bytes: bytesOf('PNG') }]
    const { service, priv } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('src/a.todl', 'x')
    const factory = scanningFactory()
    const op = await priv.addOpenProject(await factory.openProject(storage), factory, storage)
    const revealed: ProjectNode[] = []
    service.AddRevealListener((folder) => revealed.push(folder))

    await priv.importFilesInto(op, 'src')

    // The reveal targets the SAME src node the tree renders (so its row can expand).
    expect(revealed.map((n) => n.Path)).toEqual(['src'])
    expect(revealed[0]).toBe(op.Root.Children.ToArray().find((n) => n.Path === 'src'))
})

test('Import File into the project root raises no reveal request (root is always expanded)', async () => {
    const picked: Picked[] = [{ Path: 'C:/ext/logo.png', Bytes: bytesOf('PNG') }]
    const { service, priv } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('a.todl', 'x')
    const factory = scanningFactory()
    const op = await priv.addOpenProject(await factory.openProject(storage), factory, storage)
    const revealed: ProjectNode[] = []
    service.AddRevealListener((folder) => revealed.push(folder))

    await priv.importFilesInto(op)

    expect(revealed).toEqual([])
})

test('Import File into a SUBFOLDER rescans + reconciles so the node appears under it', async () => {
    const picked: Picked[] = [{ Path: 'C:/ext/logo.png', Bytes: bytesOf('PNG') }]
    const { priv } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('src/a.todl', 'x')
    const factory = scanningFactory()
    const op = await priv.addOpenProject(await factory.openProject(storage), factory, storage)
    const src = op.Root.Children.ToArray().find((n) => n.Path === 'src')!
    expect(src.Children.ToArray().map((c) => c.Path)).toEqual(['src/a.todl'])

    await priv.importFilesInto(op, 'src')

    // The SAME src node instance (the one the tree observes) gains the imported file.
    expect(op.Root.Children.ToArray().find((n) => n.Path === 'src')).toBe(src)
    expect(src.Children.ToArray().map((c) => c.Path)).toEqual(['src/a.todl', 'src/logo.png'])
})

test('Import File through the REAL MetaModelProjectFactory refreshes the tree', async () => {
    const picked: Picked[] = [{ Path: 'C:/ext/logo.png', Bytes: bytesOf('PNG') }]
    const { priv, provider } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', name: 'A', id: 'a', packageVersion: '0.1.0', version: 1 }))
    await storage.WriteText('core.todl', 'x')
    const factory = new MetaModelProjectFactory(provider)
    const op = await priv.addOpenProject(await factory.openProject(storage), factory, storage)
    const before = op.Root.Children.ToArray().map((c) => c.Path)
    expect(before).toContain('core.todl')
    expect(before).not.toContain('logo.png')

    await priv.importFilesInto(op)

    expect(op.Root.Children.ToArray().map((c) => c.Path)).toContain('logo.png')
})

test('Import File targets the given folder', async () => {
    const picked: Picked[] = [{ Path: 'C:/ext/logo.png', Bytes: bytesOf('PNG') }]
    const { priv } = makeExplorer(picked)
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.importFilesInto(op, 'src')

    expect(await storage.Exists('src/logo.png')).toBe(true)
    expect(await storage.Exists('logo.png')).toBe(false)
})

test('uniqueStorageName returns the name when free, else the next stem-N.ext', async () => {
    const s = new FakeStorage()
    expect(await uniqueStorageName(s, 'a.diagram')).toBe('a.diagram')
    await s.WriteText('a.diagram', '')
    expect(await uniqueStorageName(s, 'a.diagram')).toBe('a-2.diagram')
    await s.WriteText('a-2.diagram', '')
    expect(await uniqueStorageName(s, 'a.diagram')).toBe('a-3.diagram')
})

test('uniqueStorageName keeps a dotfile name whole (no false extension split)', async () => {
    const s = new FakeStorage()
    await s.WriteText('.gitignore', '')
    expect(await uniqueStorageName(s, '.gitignore')).toBe('.gitignore-2')
})

test('New Folder creates "New Folder" under the given parent, auto-numbering on collision', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.newFolderIn(op, '')
    expect(await storage.Exists('New Folder')).toBe(true)

    await priv.newFolderIn(op, '')
    expect(await storage.Exists('New Folder-2')).toBe(true)
})

test('New Folder nests under a subfolder', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.newFolderIn(op, 'src')
    expect(await storage.Exists('src/New Folder')).toBe(true)
})

test('New File in a subfolder is created and opened under that folder', async () => {
    const { priv, rec } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.newFileIn(op, 'src')
    expect(rec.opened).toEqual(['src/todl.todl'])
})

// A factory declaring two formats (diagram primary, todl second) — for the
// "Add New" submenu path: one choice per format, each creating THAT format.
function twoFormatFactory(): IProjectFactory
{
    return {
        typeId: 'diagram', title: 'Two Format', description: '',
        formats: [
            { extension: '.diagram', kind: 'diagram', displayName: 'Diagram' },
            { extension: '.todl',    kind: 'todl',    displayName: 'TODL Definition' },
        ],
        createProject: async (_s, name) => projectWith(name, 'C:/x'),
        openProject: async () => projectWith('P', 'C:/x'),
        saveProject: async () => {},
    }
}

test('a two-format project builds one Add-New choice per format on the project and each node', async () => {
    const { priv } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), twoFormatFactory(), new FakeStorage('C:/a'))

    expect(op.NewItemChoices.ToArray().map((c) => c.Label)).toEqual(['Diagram', 'TODL Definition'])
    const child = op.Root.Children.ToArray()[0]!
    expect(child.NewItemChoices.ToArray().map((c) => c.Label)).toEqual(['Diagram', 'TODL Definition'])
})

test('a New choice creates and opens a file of THAT format, not just the primary', async () => {
    const { priv, rec } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), twoFormatFactory(), new FakeStorage('C:/a'))

    op.NewItemChoices.ToArray()[1]!.Command!.Execute(undefined)     // the TODL choice
    await new Promise((r) => setTimeout(r, 0))
    expect(rec.opened).toContain('todl.todl')

    op.NewItemChoices.ToArray()[0]!.Command!.Execute(undefined)     // the Diagram choice
    await new Promise((r) => setTimeout(r, 0))
    expect(rec.opened).toContain('diagram.diagram')
})

test('a folder node is wired to create inside itself (container-aware)', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const root = dnode('A', '', 'folder')
    root.Children.Add(dnode('src', 'src', 'folder'))
    const op = await priv.addOpenProject(new Project('meta-model', 'A', 'C:/a', root), fakeProjectFactory(), storage)

    const folder = op.Root.Children.ToArray().find((n) => n.Kind === 'folder')!
    folder.NewFolderCommand!.Execute(undefined)
    await new Promise((r) => setTimeout(r, 0))   // let the fire-and-forget command settle

    expect(await storage.Exists('src/New Folder')).toBe(true)
})

test('commitRename moves the file on storage under the same parent', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)

    priv.beginRename(op, node)
    node.EditingName = 'renamed.todl'
    await priv.commitRename(op, node)

    expect(await storage.Exists('renamed.todl')).toBe(true)
    expect(await storage.Exists('core.todl')).toBe(false)
})

test('commitRename rejects a name that collides and leaves the file put', async () => {
    const { service, priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    await storage.WriteText('taken.todl', 'y')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)

    priv.beginRename(op, node)
    node.EditingName = 'taken.todl'
    await priv.commitRename(op, node)

    expect(service.Status).toContain('already exists')
    expect(await storage.Exists('core.todl')).toBe(true)
    expect(node.IsEditing).toBe(false)
})

test('commitRename with an unchanged name is a no-op that closes the editor', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)

    priv.beginRename(op, node)
    node.EditingName = 'core.todl'   // unchanged
    await priv.commitRename(op, node)

    expect(node.IsEditing).toBe(false)
    expect(op.EditingNode).toBeUndefined()
})

test('renaming an open file re-points its document to the new path', async () => {
    const { priv, rec } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)
    await priv.openNode(node, op)   // opens core.todl → tracked as an open document

    priv.beginRename(op, node)
    node.EditingName = 'renamed.todl'
    await priv.commitRename(op, node)

    expect(rec.relocated.map(([, p]) => p)).toEqual(['renamed.todl'])
})

// ── Unified single-tree selection & key routing ────────────────────────────
// (The legacy in-service F2 / Delete key path + TreeKeyCommand were retired in the
// mural 0.61 Hierarchy B+C1 migration — the default HierarchyTreeBehavior bundle owns
// keys now — so those cases were removed with it. Selection routing below survives.)

test('OwnerOf resolves the project whose subtree contains a node', async () => {
    const { service, priv } = makeExplorer()
    const opA = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))

    expect(service.OwnerOf(childNode(opA))).toBe(opA)
    expect(service.OwnerOf(childNode(opB))).toBe(opB)
    expect(service.OwnerOf(opA.Root)).toBe(opA)                       // the root itself belongs to its project
    expect(service.OwnerOf(new ProjectNode('x', 'x', 'todl'))).toBeUndefined()   // a foreign node
})

test('ApplyTreeSelection distributes selection per project and opens the anchor leaf', async () => {
    const { service, priv, rec } = makeExplorer()
    const opA = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))
    const aNode = childNode(opA)   // the 'core.todl' leaf

    service.ApplyTreeSelection([aNode], aNode)

    expect(opA.SelectedNodes).toEqual([aNode])
    expect(opA.SelectedNode).toBe(aNode)
    expect(opB.SelectedNodes).toEqual([])
    expect(opB.SelectedNode).toBeUndefined()
    await new Promise((r) => setTimeout(r, 0))
    expect(rec.opened).toContain('core.todl')                        // anchoring a leaf opens it
})

test('ApplyTreeSelection moving the anchor to another project clears the first project selection', async () => {
    const { service, priv } = makeExplorer()
    const opA = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))

    service.ApplyTreeSelection([childNode(opA)], childNode(opA))
    service.ApplyTreeSelection([childNode(opB)], childNode(opB))     // unified selection: one active project at a time

    expect(opA.SelectedNode).toBeUndefined()
    expect(opA.SelectedNodes).toEqual([])
    expect(opB.SelectedNode).toBe(childNode(opB))
})

test('importFilters lists each format plus an All-files catch-all', () => {
    const filters = importFilters([{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' }])
    expect(filters).toEqual([
        { Name: 'TODL Definition', Extensions: ['todl'] },
        { Name: 'All files', Extensions: ['*'] },
    ])
})

// ── Delete ───────────────────────────────────────────────────────────────

// A root with two todl files and a subfolder holding one — for delete tests
// that need multiple siblings and a nested file.
function projectWithTree(folder: string): Project
{
    const root = dnode('A', '', 'folder')
    root.Children.Add(dnode('a.todl', 'a.todl', 'todl'))
    root.Children.Add(dnode('b.todl', 'b.todl', 'todl'))
    const src = dnode('src', 'src', 'folder')
    src.Children.Add(dnode('c.todl', 'src/c.todl', 'todl'))
    root.Children.Add(src)
    return new Project('meta-model', 'A', folder, root)
}

test('deleting a confirmed file removes it from storage and closes its open tab', async () => {
    const { priv, host } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)
    await priv.openNode(node, op)
    expect(host.OpenDocuments.Count).toBe(1)

    await priv.deleteNodes(op, [node])

    expect(await storage.Exists('core.todl')).toBe(false)
    expect(host.OpenDocuments.Count).toBe(0)
})

test('cancelling the confirm dialog leaves the file in place', async () => {
    const { priv } = makeExplorer(null, false)   // dialog resolves "not confirmed"
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.deleteNodes(op, [childNode(op)])

    expect(await storage.Exists('core.todl')).toBe(true)
})

test('deleting a folder removes its whole subtree and closes tabs underneath', async () => {
    const { priv, host } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('src/c.todl', 'x')
    const op = await priv.addOpenProject(projectWithTree('C:/a'), fakeProjectFactory(), storage)
    const src = op.Root.Children.ToArray().find((n) => n.Kind === 'folder')!
    await priv.openNode(src.Children.ToArray()[0]!, op)   // open src/c.todl
    expect(host.OpenDocuments.Count).toBe(1)

    await priv.deleteNodes(op, [src])

    expect(await storage.Exists('src/c.todl')).toBe(false)
    expect(await storage.Exists('src')).toBe(false)
    expect(host.OpenDocuments.Count).toBe(0)
})

test('deleting one node of a multi-selection removes the whole selected set', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('a.todl', 'x')
    await storage.WriteText('b.todl', 'y')
    const op = await priv.addOpenProject(projectWithTree('C:/a'), fakeProjectFactory(), storage)
    const [a, b] = op.Root.Children.ToArray()
    op.SelectedNodes = [a!, b!]

    await priv.deleteFromNode(op, a!)   // right-clicked a, but b is selected too

    expect(await storage.Exists('a.todl')).toBe(false)
    expect(await storage.Exists('b.todl')).toBe(false)
})

test('a selection of a folder and a file inside it deletes without a double-removal error', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('src/c.todl', 'x')
    const op = await priv.addOpenProject(projectWithTree('C:/a'), fakeProjectFactory(), storage)
    const src = op.Root.Children.ToArray().find((n) => n.Kind === 'folder')!
    const child = src.Children.ToArray()[0]!

    await priv.deleteNodes(op, [src, child])

    expect(await storage.Exists('src')).toBe(false)
})

// ── Solution-Explorer mutation façade: delete confirmation + move collision ──
// The row-menu / Delete-key path routes through the path-based deleteFile and the
// member-keyed MoveMemberNodes, NOT the legacy ProjectNode deleteNodes/moveNodes.
// These must carry the same safety guards the legacy UX had.

test('deleteFiles confirms before the disk delete; a declined confirm leaves the files', async () => {
    const { priv, shownDialogs } = makeExplorer(null, false)   // dialog resolves "not confirmed"
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.deleteFiles(op, ['core.todl'])

    expect(shownDialogs.length).toBe(1)                        // a confirm was shown
    expect(await storage.Exists('core.todl')).toBe(true)       // and the decline kept the file
})

test('deleteFiles deletes on a confirmed dialog', async () => {
    const { priv } = makeExplorer(null, true)                  // dialog resolves "confirmed"
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.deleteFiles(op, ['core.todl'])

    expect(await storage.Exists('core.todl')).toBe(false)
})

test('deleteFiles deletes a whole batch under ONE confirm', async () => {
    const { priv, shownDialogs } = makeExplorer(null, true)
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('a.todl', 'x')
    await storage.WriteText('b.todl', 'y')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.deleteFiles(op, ['a.todl', 'b.todl'])

    expect(shownDialogs.length).toBe(1)                        // ONE prompt for the whole batch
    expect(await storage.Exists('a.todl')).toBe(false)
    expect(await storage.Exists('b.todl')).toBe(false)
})

test('MoveMemberNodes does not overwrite a same-named file already in the destination', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('a.todl', 'ROOT')
    await storage.WriteText('sub/a.todl', 'DEST')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const member = priv.memberFor(op)!

    await priv.MoveMemberNodes(member, ['a.todl'], 'sub')

    // The collision must be refused: the destination file keeps its content and the
    // source stays put — never a silent overwrite of the destination.
    expect(await storage.ReadText('sub/a.todl')).toBe('DEST')
    expect(await storage.Exists('a.todl')).toBe(true)
})

test('deleting the project root is refused (no dialog, nothing removed)', async () => {
    const { priv, shownDialogs } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.deleteNodes(op, [op.Root])   // root's Path is ''

    expect(shownDialogs.length).toBe(0)
    expect(await storage.Exists('core.todl')).toBe(true)
})

test('the delete confirmation names the file and labels the button "Delete"', async () => {
    const { priv, shownDialogs } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.deleteNodes(op, [childNode(op)])

    expect(shownDialogs.length).toBe(1)
    const vm = shownDialogs[0] as ConfirmDialogModel
    expect(vm.Message).toContain('core.todl')
    expect(vm.ConfirmLabel).toBe('Delete')
})

test('ConfirmDialogModel resolves true on confirm and false on cancel', () => {
    let result: boolean | undefined
    const confirm = new ConfirmDialogModel('msg', 'Delete', (r) => { result = r })

    confirm.ConfirmCommand.Execute(undefined)
    expect(result).toBe(true)

    confirm.CancelCommand.Execute(undefined)
    expect(result).toBe(false)
})

test('moveNodes renames a file into a subfolder on storage', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/p')
    await storage.WriteText('a.todl', 'x')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('P', 'C:/p'), fakeProjectFactory(), storage)
    await priv.moveNodes(op, [new ProjectNode('a.todl', 'a.todl', 'todl')], 'src')
    expect(await storage.Exists('src/a.todl')).toBe(true)
    expect(await storage.Exists('a.todl')).toBe(false)
})

test('moveNodes skips a name collision, leaving both paths intact', async () => {
    const { priv, service } = makeExplorer()
    const storage = new FakeStorage('C:/p')
    await storage.WriteText('a.todl', 'x')
    await storage.WriteText('src/a.todl', 'y')
    const op = await priv.addOpenProject(projectWith('P', 'C:/p'), fakeProjectFactory(), storage)
    await priv.moveNodes(op, [new ProjectNode('a.todl', 'a.todl', 'todl')], 'src')
    expect(await storage.ReadText('a.todl')).toBe('x')        // not moved
    expect(await storage.ReadText('src/a.todl')).toBe('y')    // untouched
    expect(service.Status).toMatch(/exist/i)
})

test('moveNodes into the current parent is a silent no-op', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/p')
    await storage.WriteText('src/a.todl', 'x')
    const op = await priv.addOpenProject(projectWith('P', 'C:/p'), fakeProjectFactory(), storage)
    await priv.moveNodes(op, [new ProjectNode('a.todl', 'src/a.todl', 'todl')], 'src')
    expect(await storage.Exists('src/a.todl')).toBe(true)
})

test('moveNodesAcross copies a file to the target storage and removes it from the source', async () => {
    const { priv } = makeExplorer()
    const a = new FakeStorage('C:/a'); await a.WriteText('x.todl', 'hi')
    const b = new FakeStorage('C:/b'); await b.CreateDirectory('src')
    const opA = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), a)
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), b)
    await priv.moveNodesAcross(opA, [new ProjectNode('x.todl', 'x.todl', 'todl')], opB, 'src')
    expect(await b.ReadText('src/x.todl')).toBe('hi')
    expect(await a.Exists('x.todl')).toBe(false)
})

test('moveNodesAcross skips a target collision, leaving source intact', async () => {
    const { priv, service } = makeExplorer()
    const a = new FakeStorage('C:/a'); await a.WriteText('x.todl', 'hi')
    const b = new FakeStorage('C:/b'); await b.WriteText('src/x.todl', 'other')
    const opA = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), a)
    const opB = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), b)
    await priv.moveNodesAcross(opA, [new ProjectNode('x.todl', 'x.todl', 'todl')], opB, 'src')
    expect(await a.Exists('x.todl')).toBe(true)                 // not moved
    expect(await b.ReadText('src/x.todl')).toBe('other')        // untouched
    expect(service.Status).toMatch(/exist/i)
})

// Build a small tree: root / [ src(folder)/[a.todl], m.todl ] on FakeStorage. Returns
// the DATA project + storage; a test opens it and fetches the VM nodes it needs from
// op.Root by name (the explorer projects the data tree into the VM tree — see `vm`).
async function projectTree(folder: string): Promise<{ project: Project; storage: FakeStorage }>
{
    const storage = new FakeStorage(folder)
    await storage.WriteText('src/a.todl', 'a')
    await storage.WriteText('m.todl', 'm')
    const root = dnode('P', '', 'folder')
    const src = dnode('src', 'src', 'folder')
    src.Children.Add(dnode('a.todl', 'src/a.todl', 'todl'))
    root.Children.Add(src); root.Children.Add(dnode('m.todl', 'm.todl', 'todl'))
    return { project: new Project('meta-model', 'P', folder, root), storage }
}

// Fetch a VM node from an open project's tree by project-relative path (the VM tree
// the explorer projected from the data scan). Depth-first; throws if absent.
function vm(op: OpenProject, path: string): ProjectNode
{
    const find = (n: ProjectNode): ProjectNode | undefined => {
        if (n.Path === path) return n
        for (const c of n.Children.ToArray()) { const hit = find(c); if (hit !== undefined) return hit }
        return undefined
    }
    const found = find(op.Root)
    if (found === undefined) throw new Error(`no VM node at "${path}"`)
    return found
}

test('rename updates the node in place — the tree is NOT rebuilt', async () => {
    const { priv } = makeExplorer()
    const { project, storage } = await projectTree('C:/p')
    const op = await priv.addOpenProject(project, fakeProjectFactory(), storage)
    const src = vm(op, 'src')
    const a = vm(op, 'src/a.todl')

    const rootBefore = op.Root
    const childrenBefore = op.Root.Children
    priv.beginRename(op, src)
    src.EditingName = 'lib'
    await priv.commitRename(op, src)

    // No wholesale rebuild: the Root node and its Children collection are the
    // same object instances (a rescan would have replaced them).
    expect(op.Root).toBe(rootBefore)
    expect(op.Root.Children).toBe(childrenBefore)
    // The renamed node is the SAME object, mutated in place.
    expect(op.Root.Children.ToArray()).toContain(src)
    expect(src.Name).toBe('lib')
    expect(src.Path).toBe('lib')
    // A folder rename re-prefixes every descendant's path.
    expect(a.Path).toBe('lib/a.todl')
    // The rename editor closed.
    expect(src.IsEditing).toBe(false)
    // Storage actually moved.
    expect(await storage.ReadText('lib/a.todl')).toBe('a')
})

test('rename re-sorts the node within its parent when the position changes', async () => {
    const { priv } = makeExplorer()
    const { project, storage } = await projectTree('C:/p')
    const op = await priv.addOpenProject(project, fakeProjectFactory(), storage)
    const m = vm(op, 'm.todl')

    // 'm.todl' → 'a2.todl' should sort before 'src'? No — folders sort first, so
    // among the two files/folder it lands after the 'src' folder but the file
    // order is by name; here only one file exists, so order is [src, a2.todl].
    // Rename the file 'm.todl' → 'a2.todl' (still a file → stays after the folder).
    priv.beginRename(op, m)
    m.EditingName = 'a2.todl'
    await priv.commitRename(op, m)

    const names = op.Root.Children.ToArray().map((n) => n.Name)
    // Folders first, then files by name: the folder 'src' stays first.
    expect(names).toEqual(['src', 'a2.todl'])
    expect(m.Name).toBe('a2.todl')
})

test('delete detaches the node in place — the tree is NOT rebuilt', async () => {
    const { priv } = makeExplorer()   // confirm defaults to true
    const { project, storage } = await projectTree('C:/p')
    const op = await priv.addOpenProject(project, fakeProjectFactory(), storage)
    const src = vm(op, 'src')
    const m = vm(op, 'm.todl')

    const rootBefore = op.Root
    const childrenBefore = op.Root.Children
    await priv.deleteNodes(op, [m])

    // No wholesale rebuild: the Root node and its Children collection are the
    // same object instances (a rescan would have replaced them).
    expect(op.Root).toBe(rootBefore)
    expect(op.Root.Children).toBe(childrenBefore)
    // The surviving sibling is the SAME object, still attached.
    expect(op.Root.Children.ToArray()).toContain(src)
    // The deleted node is gone from the tree and from storage.
    expect(op.Root.Children.ToArray()).not.toContain(m)
    expect(await storage.Exists('m.todl')).toBe(false)
})

test('Import Folder copies the picked directory subtree into the project', async () => {
    const os = { pickedFolder: 'C:/ext/pics', files: {
        'C:/ext/pics/a.png': 'AA',
        'C:/ext/pics/sub/b.png': 'BB',
    } }
    const { priv } = makeExplorer(null, true, os)
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.importFolderInto(op, '')

    expect(await storage.ReadText('pics/a.png')).toBe('AA')
    expect(await storage.ReadText('pics/sub/b.png')).toBe('BB')
})

test('Import Folder targets a subfolder', async () => {
    const os = { pickedFolder: 'C:/ext/pics', files: { 'C:/ext/pics/a.png': 'AA' } }
    const { priv } = makeExplorer(null, true, os)
    const storage = new FakeStorage('C:/a')
    await storage.CreateDirectory('src')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.importFolderInto(op, 'src')

    expect(await storage.ReadText('src/pics/a.png')).toBe('AA')
})

test('Import Folder auto-renames the top folder on a collision', async () => {
    const os = { pickedFolder: 'C:/ext/pics', files: { 'C:/ext/pics/a.png': 'AA' } }
    const { priv } = makeExplorer(null, true, os)
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('pics/existing.txt', 'x')   // makes 'pics' already exist
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    await priv.importFolderInto(op, '')

    expect(await storage.ReadText('pics-2/a.png')).toBe('AA')       // imported under a fresh name
    expect(await storage.ReadText('pics/existing.txt')).toBe('x')   // original untouched
})

test('Import Folder is a no-op when the picker is cancelled', async () => {
    const { priv } = makeExplorer(null, true, { pickedFolder: null, files: {} })
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const before = storage.size

    await priv.importFolderInto(op, '')

    expect(storage.size).toBe(before)
})

test('Import commands are wired on the project and on each node', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)

    expect(op.ImportFileCommand).toBeDefined()
    expect(op.ImportFolderCommand).toBeDefined()
    const child = op.Root.Children.ToArray()[0]!   // the 'core.todl' node
    expect(child.ImportFileCommand).toBeDefined()
    expect(child.ImportFolderCommand).toBeDefined()
})

// A project whose tree holds one .diagram file and one .todl file — for the
// explorer-export wiring (only diagram nodes get the Export submenu).
function projectWithDiagram(folder: string): Project
{
    const root = dnode('A', '', 'folder')
    root.Children.Add(dnode('flow.diagram', 'flow.diagram', 'diagram'))
    root.Children.Add(dnode('core.todl', 'core.todl', 'todl'))
    return new Project('diagram', 'A', folder, root)
}

test('a .diagram node is wired with an Export submenu (SVG + PPTX); a non-diagram node is not', async () => {
    const { priv, provider } = makeExplorer()
    // Gating requires the IDiagramTreeExport capability present in the provider.
    provider.registerInstance(DiagramTreeExportKey, { Export: async () => {} } as never)
    const op = await priv.addOpenProject(projectWithDiagram('C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))

    const [diagram, todl] = op.Root.Children.ToArray()
    expect(diagram!.HasExport).toBe(true)
    expect(diagram!.ExportSvgCommand).toBeDefined()
    expect(diagram!.ExportPptxCommand).toBeDefined()
    expect(todl!.HasExport).toBe(false)            // a .todl node gets no Export submenu
    expect(todl!.ExportSvgCommand).toBeUndefined()
})

test('without the diagram-export services loaded, a .diagram node gets no Export submenu', async () => {
    const { priv } = makeExplorer()                // services NOT registered
    const op = await priv.addOpenProject(projectWithDiagram('C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const diagram = op.Root.Children.ToArray()[0]!
    expect(diagram.HasExport).toBe(false)
})

test('bumpVersion writes the incremented version to the manifest', async () => {
    const { priv } = makeExplorer()
    const storage = await seededStorage('C:/a', '0.1.0')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory(), storage)
    await priv.bumpVersion(op, VersionPart.Minor)
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.packageVersion).toBe('0.2.0')
})

test('bump commands are enabled only for versioned factories', async () => {
    const { priv } = makeExplorer()
    const vOp = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory(), await seededStorage('C:/a'))
    const plainOp = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))
    expect(vOp.BumpVersionMajorCommand!.CanExecute(undefined)).toBe(true)
    expect(vOp.SetVersionCommand!.CanExecute(undefined)).toBe(true)
    expect(plainOp.BumpVersionMajorCommand!.CanExecute(undefined)).toBe(false)
    expect(plainOp.SetVersionCommand!.CanExecute(undefined)).toBe(false)
})

test('setVersionDialog sets the version and publishes only when the flag is set', async () => {
    const first = makePublishExplorer({ version: '3.0.0', publish: true } as SetVersionResult)
    const storage = await metaModelStorage('C:/a', 'a', PUBLISHABLE_TODL)
    const op = await first.priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory(), storage)
    await first.priv.setVersionDialog(op)
    expect(JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)).packageVersion).toBe('3.0.0')
    expect(await scanPublishedModels(first.packages)).toEqual([{ id: 'a', versions: ['3.0.0'] }])   // publish ran

    const second = makePublishExplorer({ version: '4.0.0', publish: false } as SetVersionResult)
    const storage2 = await metaModelStorage('C:/b', 'b', PUBLISHABLE_TODL)
    const op2 = await second.priv.addOpenProject(projectWith('B', 'C:/b'), fakeVersionedFactory(), storage2)
    await second.priv.setVersionDialog(op2)
    expect(JSON.parse(await storage2.ReadText(PROJECT_MANIFEST_FILENAME)).packageVersion).toBe('4.0.0')
    expect(await scanPublishedModels(second.packages)).toEqual([])                                  // publish did NOT run
})

test('Update Agent Meta-data is enabled for a TODL project, disabled for a plain factory', async () => {
    const { priv } = makeExplorer()
    const tOp = await priv.addOpenProject(projectWith('A', 'C:/a'), new MetaModelProjectFactory(new ServiceProvider()), new FakeStorage('C:/a'))
    const plainOp = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))
    expect(tOp.UpdateAgentMetadataCommand!.CanExecute(undefined)).toBe(true)
    expect(plainOp.UpdateAgentMetadataCommand!.CanExecute(undefined)).toBe(false)
})

test('updateAgentMetadata refreshes a stale scaffold doc', async () => {
    const { priv } = makeExplorer()
    const factory = new MetaModelProjectFactory(new ServiceProvider())
    const storage = new FakeStorage('C:/a')
    await factory.createProject(storage, 'A')                 // full scaffold
    await storage.WriteText('.claude/todl-manual.md', 'HACKED')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), factory, storage)
    await priv.updateAgentMetadata(op)
    expect(await storage.ReadText('.claude/todl-manual.md')).toMatch(/namespace/)   // refreshed
})

test('OpenMemberFile opens (or re-activates) a file tab for a resolved member', async () => {
    const { service, priv, rec, manager } = makeExplorer()
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const member = manager.Members.ToArray().at(-1)!

    await service.OpenMemberFile(member, 'core.todl', ProjectNodeKind.Todl)
    expect(rec.opened).toEqual(['core.todl'])
})

test('OpenMemberFile is a no-op for a folder kind', async () => {
    const { service, priv, rec, manager } = makeExplorer()
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const member = manager.Members.ToArray().at(-1)!

    await service.OpenMemberFile(member, 'src', ProjectNodeKind.Folder)
    expect(rec.opened).toEqual([])
})

test('OpenMemberFile is a no-op when the member has no projected OpenProject', async () => {
    const { service, rec } = makeExplorer()
    const orphan = new SolutionMember({ path: 'C:/none', type: 'test-type-x' })
    await service.OpenMemberFile(orphan, 'core.todl', ProjectNodeKind.Todl)
    expect(rec.opened).toEqual([])
})

// ── P3/P4: member-keyed IContentMutations surface (Task 9) ───────────────────
test('RenameMemberFile resolves the projected op and renames via storage', async () => {
    const { service, priv, manager } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('a.todl', '')
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const member = manager.Members.ToArray().at(-1)!
    await service.RenameMemberFile(member, 'a.todl', 'b.todl')
    expect(await storage.Exists('a.todl')).toBe(false)
    expect(await storage.Exists('b.todl')).toBe(true)
})

test('IsVersionedMember reflects the member factory', async () => {
    const { service, priv, manager } = makeExplorer()
    await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    expect(service.IsVersionedMember(manager.Members.ToArray().at(-1)!)).toBe(false)

    const versioned = { ...fakeProjectFactory(), getVersion: async () => '1.0.0', setVersion: async () => {} } as unknown as IProjectFactory
    await priv.addOpenProject(projectWith('B', 'C:/b'), versioned, new FakeStorage('C:/b'))
    expect(service.IsVersionedMember(manager.Members.ToArray().at(-1)!)).toBe(true)
})

test('dispose() releases the References stale-bases subscription (no fire after teardown)', () => {
    const { service, provider } = makeExplorer()
    let staleHandler: (() => void) | undefined
    provider.registerInstance(SolutionBaseResolver.Key, {
        PropertyChanged: (name: string) => ({
            subscribe: (h: () => void) => {
                if (name === 'StaleMemberIds') staleHandler = h
                return { dispose: () => { if (name === 'StaleMemberIds') staleHandler = undefined } }
            },
        }),
    } as unknown as SolutionBaseResolver)

    let fires = 0
    service.References.OnReferencesViewChanged(() => { fires += 1 })
    staleHandler!()                 // resolver announces stale bases → the view refreshes
    expect(fires).toBe(1)

    service.dispose()
    staleHandler?.()                // after dispose the subscription is gone → no further fire
    expect(fires).toBe(1)
})

// ── P6b: Remove from Solution + keep unresolved members visible ─────────────

test('an unresolved member is NOT auto-dropped; it stays in Members', async () => {
    const { service, manager } = makeExplorer()
    const member = new SolutionMember({ path: './x', type: 'no-such-type' })
    manager.Members.Add(member)                  // triggers the member-sync loop
    member.Status = SolutionMemberStatus.UnknownType
    member.Project = undefined                   // settles waitForResolution (unresolved)
    await memberSyncTaskFor(service, member)
    expect(manager.Members.ToArray()).toContain(member)
})

test('RemoveMember removes an unresolved member directly', async () => {
    const { service, manager } = makeExplorer()
    const member = new SolutionMember({ path: './x', type: 'no-such-type' })
    manager.Members.Add(member)
    member.Project = undefined
    await memberSyncTaskFor(service, member)
    await service.RemoveMember(member)
    expect(manager.Members.ToArray()).not.toContain(member)
})

test('RemoveMember on a projected member routes through the guarded close', async () => {
    const { service, priv, manager } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const member = priv.memberFor(op)!
    await service.RemoveMember(member)
    expect(manager.CloseCalls).toContain(member)
})
