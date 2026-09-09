import { test, expect } from 'vitest'
import { Key, ServiceProvider, type KeyEventArgs } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DialogService, DocumentsContentHostService, DocumentTypeRegistry, ProjectFactoryRegistry, type IDocument } from '@pragmatic-tech-ai/mural/framework'

import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { OpenProject } from '../../../../services/projects/open-project.js'
import { OpenProjectsStore } from '../../../../services/projects/open-projects-store.js'
import { PROJECT_MANIFEST_FILENAME, type IProjectFactory, type IPublishableProjectFactory, type IPresentationProjectFactory, type IVersionedProjectFactory, type ProjectFileFormat } from '../../../../services/projects/project-factory.js'
import { VersionPart } from '../../../../services/projects/semver-bump.js'
import type { SetVersionResult } from '../../../../services/projects/set-version-dialog-model.js'
import type { IDocumentFactory, IRelocatableDocumentFactory } from '../../../../services/documents/document-factory.js'
import { ConfirmDialogModel } from '../../../../services/dialogs/confirm-dialog-model.js'
import { ProjectExplorerService, applyPrefill, importFilters, uniqueStorageName } from '../project-explorer-service.js'
import { NewProjectDialogModel, ProjectTypeChoice } from '../../../../services/projects/new-project-dialog-model.js'
import { MetaModelProjectFactory } from '../../../meta-model/services/meta-model-project-factory.js'
import { TodlLanguageClient } from '../../../../services/todl/todl-language-client.js'
import { DiagnosticsService } from '../../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../../../services/diagnostics/diagnostic.js'
import { DiagramExportService } from '../../../diagram-export/services/diagram-export-service.js'
import { DiagramHeadlessRenderer } from '../../../diagram-export/services/diagram-headless-renderer.js'

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

// A project factory: lifecycle + one 'todl' format + optional publish. No file
// I/O — that lives on the document factory, resolved by extension.
function fakeProjectFactory(publishable = true): IProjectFactory
{
    const base: IProjectFactory = {
        formats: [{ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' }],
        createProject: async (_s, name) => projectWith(name, 'C:/x'),
        openProject: async () => projectWith('P', 'C:/x'),
        saveProject: async () => {},
    }
    if (!publishable) return base
    const pub: IProjectFactory & IPublishableProjectFactory = { ...base, publish: async () => ({ ok: true, message: 'Published.' }) }
    return pub
}

function projectWith(name: string, folder: string): Project
{
    const root = new ProjectNode(name, '', 'folder')
    root.Children.Add(new ProjectNode('core.todl', 'core.todl', 'todl'))
    return new Project('meta-model', name, folder, root)
}

// A publishable + versioned fake factory whose version lives in the manifest of
// the storage it's given; publish() records that it ran.
function fakeVersionedFactory(published: string[]): IProjectFactory & IVersionedProjectFactory & IPublishableProjectFactory
{
    const base = fakeProjectFactory(true) as IProjectFactory & IPublishableProjectFactory
    return {
        ...base,
        publish: async () => { published.push('published'); return { ok: true, message: 'Published.' } },
        getVersion: async (s) => (JSON.parse(await s.ReadText(PROJECT_MANIFEST_FILENAME)) as { modelVersion: string }).modelVersion,
        setVersion: async (s, v) => {
            const m = JSON.parse(await s.ReadText(PROJECT_MANIFEST_FILENAME))
            m.modelVersion = v
            await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(m))
        },
    }
}

async function seededStorage(folder: string, version = '0.1.0'): Promise<FakeStorage>
{
    const s = new FakeStorage(folder)
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', name: 'A', modelVersion: version }))
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
            for (const key of osFiles.keys()) {
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
    openNode(node: ProjectNode, op: OpenProject): Promise<void>
    importFilesInto(op: OpenProject, target?: string): Promise<void>
    importFolderInto(op: OpenProject, target?: string): Promise<void>
    newFileIn(op: OpenProject, parentFolder?: string, format?: ProjectFileFormat): Promise<void>
    newFolderIn(op: OpenProject, parentFolder?: string): Promise<void>
    beginRename(op: OpenProject, node: ProjectNode): void
    commitRename(op: OpenProject, node: ProjectNode): Promise<void>
    handleTreeKey(op: OpenProject, args: KeyEventArgs): void
    deleteNodes(op: OpenProject, nodes: readonly ProjectNode[]): Promise<void>
    deleteFromNode(op: OpenProject, node: ProjectNode): Promise<void>
    moveNodes(op: OpenProject, nodes: readonly ProjectNode[], destParentPath: string): Promise<void>
    moveNodesAcross(source: OpenProject, nodes: readonly ProjectNode[], target: OpenProject, destParentPath: string): Promise<void>
    closeProject(op: OpenProject): Promise<void>
    bumpVersion(op: OpenProject, part: VersionPart): Promise<void>
    setVersionDialog(op: OpenProject): Promise<void>
    updateAgentMetadata(op: OpenProject): Promise<void>
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
    provider.registerInstance(StorageProviderRegistry.Key, {
        Create: (_backend: string, folder: string) => ({
            Exists: (name: string) => Promise.resolve(occupied.has(folder) && name === PROJECT_MANIFEST_FILENAME),
            CreateDirectory: (rel: string) => { created.add(joinAbs(folder, rel)); return Promise.resolve() },
        }),
    } as unknown as StorageProviderRegistry)
    const store = new OpenProjectsStore(provider)
    provider.registerInstance(OpenProjectsStore.Key, store)
    // Editor routing: a recording `.todl` document factory + a registry that
    // resolves the extension to its token.
    const rec: Rec = { opened: [], saved: [], relocated: [] }
    provider.registerInstance(ServiceProvider.tokenFor(TodlDocFactoryToken), fakeDocFactory(rec))
    provider.registerInstance(DocumentTypeRegistry.Key, {
        GetByExtension: (ext: string) => ((ext === '.todl' || ext === '.diagram') ? { Factory: TodlDocFactoryToken } : undefined),
    } as unknown as DocumentTypeRegistry)
    const service = new ProjectExplorerService(provider)
    return { service, host, store, priv: service as unknown as ExplorerPrivates, provider, shownDialogs, rec, occupied, created }
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

test('a presentation-capable factory gets an enabled Generate Presentation command; others get it disabled', async () => {
    const { service, priv } = makeExplorer()
    const presFactory: IProjectFactory & IPresentationProjectFactory = {
        ...fakeProjectFactory(),
        regeneratePresentation: async () => {},
    }
    await priv.addOpenProject(projectWith('A', 'C:/a'), presFactory, new FakeStorage('C:/a'))
    await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))

    const a = service.OpenProjects.Get(0)!
    const b = service.OpenProjects.Get(1)!
    expect(a.GeneratePresentationColorfulCommand).toBeDefined()
    expect(a.GeneratePresentationMonochromeCommand).toBeDefined()
    expect(a.GeneratePresentationColorfulCommand!.CanExecute()).toBe(true)
    expect(a.GeneratePresentationMonochromeCommand!.CanExecute()).toBe(true)
    expect(b.GeneratePresentationColorfulCommand!.CanExecute()).toBe(false)   // plain factory: no presentation
    expect(b.GeneratePresentationMonochromeCommand!.CanExecute()).toBe(false)
})

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
    provider.registerInstance(TodlLanguageClient.Key, {
        RefreshBases: async () => { calls.push('refresh') },
        ResyncProject: async () => { calls.push('resync') },
    } as unknown as TodlLanguageClient)

    // Count rescans via the factory's openProject.
    let opened = 0
    const orig = factory.openProject.bind(factory)
    factory.openProject = async (s) => { opened += 1; return orig(s) }

    await service.RefreshProjects(['C:/a', 'C:/does-not-exist'])

    expect(opened).toBe(1)                       // only the known project rescanned
    expect(calls).toEqual(['resync', 'refresh']) // rescan resyncs the doc set, then bases refresh
})

function formWith(types: string[]): NewProjectDialogModel {
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
function archForm(): NewProjectDialogModel {
    const choices = [new ProjectTypeChoice('architecture', 'Architecture', 'arch project', true, true)]
    const metaModels = [{ id: 'tech-architecture', version: '0.1.0' }]
    const libraries = [{ id: 'microsoft', version: '0.1.0' }, { id: 'aws', version: '0.2.0' }]
    return new NewProjectDialogModel(choices, {} as never, async () => null, () => {}, metaModels, libraries)
}

test('applyPrefill selects the prefilled meta-model and checks the prefilled libraries', () => {
    const form = archForm()
    applyPrefill(form, {
        type: 'architecture',
        metaModel: { id: 'tech-architecture', version: '0.1.0' },
        libraries: [{ id: 'microsoft', version: '0.1.0' }],
    })
    expect(form.SelectedMetaModel?.Ref).toEqual({ id: 'tech-architecture', version: '0.1.0' })
    expect(form.SelectedLibraries).toEqual([{ id: 'microsoft', version: '0.1.0' }])   // aws stays unchecked
})

test('applyPrefill ignores meta-model/library refs not among the published choices', () => {
    const form = archForm()
    applyPrefill(form, {
        type: 'architecture',
        metaModel: { id: 'nope', version: '9' },
        libraries: [{ id: 'ghost', version: '1' }],
    })
    expect(form.SelectedMetaModel).toBeUndefined()
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
    provider.registerInstance(ProjectFactoryRegistry.Key, { GetByType: () => undefined } as unknown as ProjectFactoryRegistry)
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

test('Publish is disabled for a non-publishable project', async () => {
    const { priv } = makeExplorer()
    const pub = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(true), new FakeStorage('C:/a'))
    const plain = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(false), new FakeStorage('C:/b'))

    expect(pub.PublishCommand!.CanExecute(undefined)).toBe(true)
    expect(plain.PublishCommand!.CanExecute(undefined)).toBe(false)
})

// A publishable factory whose publish returns a preset result.
function factoryReturning(result: { ok: boolean; message: string }): IProjectFactory & IPublishableProjectFactory {
    return { ...fakeProjectFactory(true), publish: async () => result } as IProjectFactory & IPublishableProjectFactory
}
interface PublishPrivates { publishProject(op: OpenProject): Promise<void>; generatePresentation(op: OpenProject, colored: boolean): Promise<void> }

test('a failed publish surfaces its message as a project-level diagnostic in the Problems store', async () => {
    const { service, priv, provider } = makeExplorer()
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), factoryReturning({ ok: false, message: 'missing icon file(s): x.svg' }), new FakeStorage('C:/a'))

    await (service as unknown as PublishPrivates).publishProject(op)

    const pubs = [...diagnostics.All].filter((d) => d.owner === 'publish')
    expect(pubs).toHaveLength(1)
    expect(pubs[0]).toMatchObject({
        owner: 'publish', projectId: 'C:/a', projectName: 'A', uri: null,
        message: 'missing icon file(s): x.svg', severity: DiagnosticSeverity.Error, span: null,
    })
    // The error description goes ONLY to Problems — the status pane never carries it.
    expect(service.Status).toBe('Publish failed — see Problems.')
    expect(service.Status).not.toContain('missing icon')
})

test('a successful publish clears any prior publish diagnostic', async () => {
    const { service, priv, provider } = makeExplorer()
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    // One project whose publish result flips fail → success; the second run must
    // clear the diagnostic the first seeded.
    const result = { ok: false, message: 'boom' }
    const factory = { ...fakeProjectFactory(true), publish: async () => result } as IProjectFactory & IPublishableProjectFactory
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), factory, new FakeStorage('C:/a'))

    await (service as unknown as PublishPrivates).publishProject(op)
    expect([...diagnostics.All].some((d) => d.owner === 'publish')).toBe(true)

    result.ok = true
    result.message = 'Published.'
    await (service as unknown as PublishPrivates).publishProject(op)
    expect([...diagnostics.All].some((d) => d.owner === 'publish')).toBe(false)
})

test('a failed generate-presentation surfaces its error as a project-level diagnostic', async () => {
    const { service, priv, provider } = makeExplorer()
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    const presFactory: IProjectFactory & IPresentationProjectFactory = {
        ...fakeProjectFactory(),
        regeneratePresentation: async () => { throw new Error('kaboom') },
    }
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), presFactory, new FakeStorage('C:/a'))

    await (service as unknown as PublishPrivates).generatePresentation(op, true)

    const diags = [...diagnostics.All].filter((d) => d.owner === 'presentation')
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({ owner: 'presentation', projectId: 'C:/a', uri: null, severity: DiagnosticSeverity.Error })
    expect(diags[0].message).toContain('kaboom')
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
    const registry = new StorageProviderRegistry(provider)
    registry.Register(StorageProviderRegistry.DefaultBackendId, (folder) => storageFor(folder))
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    // A fake factory registry (the real one's ctor needs the ApplicationService).
    // GetByType returns undefined → C:/a is opened-attempted but its type has no
    // factory, so it's kept (not pruned); only manifest-less C:/b is pruned.
    provider.registerInstance(ProjectFactoryRegistry.Key, { GetByType: () => undefined } as unknown as ProjectFactoryRegistry)
    await storageFor('C:/a').WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'unregistered' }))

    await store.Add('C:/a')
    await store.Add('C:/b')   // no manifest → should be pruned

    const service = new ProjectExplorerService(provider)
    await service.RestoreSession()

    // C:/b pruned (missing manifest); C:/a kept (it has a manifest, even though
    // its factory type isn't registered in this test, so it isn't removed).
    expect(await store.List()).toEqual(['C:/a'])
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
    const root = new ProjectNode('A', '', 'folder')
    root.Children.Add(new ProjectNode('src', 'src', 'folder'))
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

test('F2 begins rename on the selected node; Escape cancels it', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)
    op.SelectedNode = node

    const f2 = { Key: Key.F2, Handled: false } as unknown as KeyEventArgs
    priv.handleTreeKey(op, f2)
    expect(node.IsEditing).toBe(true)
    expect(f2.Handled).toBe(true)

    const esc = { Key: Key.Escape, Handled: false } as unknown as KeyEventArgs
    priv.handleTreeKey(op, esc)
    expect(node.IsEditing).toBe(false)
    expect(op.EditingNode).toBeUndefined()
    expect(esc.Handled).toBe(true)
})

// ── Unified single-tree selection & key routing ────────────────────────────

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

test('TreeKeyCommand routes Delete to the project holding the selection', async () => {
    const { service, priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    service.ApplyTreeSelection([childNode(op)], childNode(op))

    const del = { Key: Key.Delete, Handled: false } as unknown as KeyEventArgs
    service.TreeKeyCommand.Execute(del)
    await new Promise((r) => setTimeout(r, 0))

    expect(await storage.Exists('core.todl')).toBe(false)
    expect(del.Handled).toBe(true)
})

test('TreeKeyCommand routes F2 to begin rename in the selected project', async () => {
    const { service, priv } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const node = childNode(op)
    service.ApplyTreeSelection([node], node)

    const f2 = { Key: Key.F2, Handled: false } as unknown as KeyEventArgs
    service.TreeKeyCommand.Execute(f2)

    expect(node.IsEditing).toBe(true)
    expect(f2.Handled).toBe(true)
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
    const root = new ProjectNode('A', '', 'folder')
    root.Children.Add(new ProjectNode('a.todl', 'a.todl', 'todl'))
    root.Children.Add(new ProjectNode('b.todl', 'b.todl', 'todl'))
    const src = new ProjectNode('src', 'src', 'folder')
    src.Children.Add(new ProjectNode('c.todl', 'src/c.todl', 'todl'))
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

test('the Delete key deletes the selected node', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    op.SelectedNode = childNode(op)

    const del = { Key: Key.Delete, Handled: false } as unknown as KeyEventArgs
    priv.handleTreeKey(op, del)
    await new Promise((r) => setTimeout(r, 0))   // let the fire-and-forget delete settle

    expect(await storage.Exists('core.todl')).toBe(false)
    expect(del.Handled).toBe(true)
})

test('the Delete key does nothing while a rename editor is open', async () => {
    const { priv } = makeExplorer()
    const storage = new FakeStorage('C:/a')
    await storage.WriteText('core.todl', 'x')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), storage)
    const node = childNode(op)
    priv.beginRename(op, node)   // editor open

    const del = { Key: Key.Delete, Handled: false } as unknown as KeyEventArgs
    priv.handleTreeKey(op, del)
    await new Promise((r) => setTimeout(r, 0))

    expect(await storage.Exists('core.todl')).toBe(true)   // not deleted
    expect(del.Handled).toBe(false)
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

// Build a small tree: root / [ src(folder)/[a.todl], m.todl ] on FakeStorage.
async function projectTree(folder: string): Promise<{ project: Project; storage: FakeStorage; src: ProjectNode; a: ProjectNode; m: ProjectNode }> {
    const storage = new FakeStorage(folder)
    await storage.WriteText('src/a.todl', 'a')
    await storage.WriteText('m.todl', 'm')
    const root = new ProjectNode('P', '', 'folder')
    const src = new ProjectNode('src', 'src', 'folder')
    const a = new ProjectNode('a.todl', 'src/a.todl', 'todl')
    src.Children.Add(a)
    const m = new ProjectNode('m.todl', 'm.todl', 'todl')
    root.Children.Add(src); root.Children.Add(m)
    return { project: new Project('meta-model', 'P', folder, root), storage, src, a, m }
}

test('rename updates the node in place — the tree is NOT rebuilt', async () => {
    const { priv } = makeExplorer()
    const { project, storage, src, a } = await projectTree('C:/p')
    const op = await priv.addOpenProject(project, fakeProjectFactory(), storage)

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
    const { project, storage, m } = await projectTree('C:/p')
    const op = await priv.addOpenProject(project, fakeProjectFactory(), storage)

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
    const { project, storage, src, m } = await projectTree('C:/p')
    const op = await priv.addOpenProject(project, fakeProjectFactory(), storage)

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
    const root = new ProjectNode('A', '', 'folder')
    root.Children.Add(new ProjectNode('flow.diagram', 'flow.diagram', 'diagram'))
    root.Children.Add(new ProjectNode('core.todl', 'core.todl', 'todl'))
    return new Project('diagram', 'A', folder, root)
}

test('a .diagram node is wired with an Export submenu (SVG + PPTX); a non-diagram node is not', async () => {
    const { priv, provider } = makeExplorer()
    // Gating requires both diagram-export services present in the provider.
    provider.registerInstance(DiagramHeadlessRenderer.Key, {} as never)
    provider.registerInstance(DiagramExportService.Key, {} as never)
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
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory([]), storage)
    await priv.bumpVersion(op, VersionPart.Minor)
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.modelVersion).toBe('0.2.0')
})

test('bump commands are enabled only for versioned factories', async () => {
    const { priv } = makeExplorer()
    const vOp = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory([]), await seededStorage('C:/a'))
    const plainOp = await priv.addOpenProject(projectWith('B', 'C:/b'), fakeProjectFactory(), new FakeStorage('C:/b'))
    expect(vOp.BumpVersionMajorCommand!.CanExecute(undefined)).toBe(true)
    expect(vOp.SetVersionCommand!.CanExecute(undefined)).toBe(true)
    expect(plainOp.BumpVersionMajorCommand!.CanExecute(undefined)).toBe(false)
    expect(plainOp.SetVersionCommand!.CanExecute(undefined)).toBe(false)
})

test('setVersionDialog sets the version and publishes only when the flag is set', async () => {
    const published: string[] = []
    const result: SetVersionResult = { version: '3.0.0', publish: true }
    const { priv } = makeExplorer(null, result)                 // dialog resolves this result
    const storage = await seededStorage('C:/a', '0.1.0')
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeVersionedFactory(published), storage)
    await priv.setVersionDialog(op)
    expect(JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)).modelVersion).toBe('3.0.0')
    expect(published).toEqual(['published'])                    // publish ran

    const published2: string[] = []
    const { priv: priv2 } = makeExplorer(null, { version: '4.0.0', publish: false })
    const storage2 = await seededStorage('C:/b', '0.1.0')
    const op2 = await priv2.addOpenProject(projectWith('B', 'C:/b'), fakeVersionedFactory(published2), storage2)
    await priv2.setVersionDialog(op2)
    expect(JSON.parse(await storage2.ReadText(PROJECT_MANIFEST_FILENAME)).modelVersion).toBe('4.0.0')
    expect(published2).toEqual([])                              // publish did NOT run
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
