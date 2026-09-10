// project-explorer-service.ts — the GENERIC project host for the left panel.
//
// It owns the set of OPEN projects + orchestrates open/create/close/save, but
// knows nothing about diagrams or file formats: it reads a folder's manifest
// envelope (project.plexus → `type`), routes to the matching factory via the
// framework's ProjectFactoryRegistry, and delegates. A module contributes a
// project type by declaring a `.projectFactories:` entry whose Factory resolves
// to an IProjectFactory (see the diagram module's DiagramProjectFactory).
//
// Several projects can be open at once: each is an OpenProject (its own factory
// + storage + tree + per-project commands), rendered as a tree root. Uniform
// actions (Open / New / Save) live on the command bar; project-specific actions
// (New File / Publish / Close) live on each project's context menu. The open set
// is persisted (OpenProjectsStore) and restored at launch.
//
// Rendered by DataTemplate[DataType=ProjectExplorerService] (project-explorer.
// resources.mu): a command bar + a tree of DataTemplate[OpenProject] roots.
import {
    Key,
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    ServiceProvider,
    type ICommand,
    type IServiceProvider,
    type KeyEventArgs,
} from '@pragmatic-tech-ai/mural/runtime'
import {
    ContentHostService,
    DialogService,
    DocumentTypeRegistry,
    ProjectFactoryRegistry,
    type DocumentsContentHostService,
    type IDocument,
} from '@pragmatic-tech-ai/mural/framework'

import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import {
    PROJECT_MANIFEST_FILENAME,
    ProducerKind,
    isPublishable,
    canGeneratePresentation,
    isVersioned,
    type IProjectFactory,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import { isRelocatable, isRelocatableAcrossStorage, type IDocumentFactory } from '../../../services/documents/document-factory.js'
import { NewFileParticipantKey } from '../../../services/documents/new-file-participant.js'
import { NodeCommandContributorKey } from '../../../services/documents/node-command-contributor.js'
import { DiagramExportService, ExportFormat } from '../../diagram-export/services/diagram-export-service.js'
import { DiagramHeadlessRenderer } from '../../diagram-export/services/diagram-headless-renderer.js'
import { ProjectAgentCatalog } from '../../agent-chat/services/project-agent-catalog.js'
import { ChatSessionsService } from '../../agent-chat/services/chat-sessions-service.js'
import { AgentSkillChoice, buildAgentSkillChoices } from '../../agent-chat/services/agent-skill-choice.js'
import { copyTree } from '@pragmatic-tech-ai/todl-runtime'
import type { FileFilter } from '../../../../../shared/file-system-api.js'
import { ProjectNode } from '../../../services/projects/project.js'
import type { Project } from '../../../services/projects/project.js'
import { OpenProject } from '../../../services/projects/open-project.js'
import { isTodlProject } from '../../../services/projects/todl-project-factory.js'
import { VersionPart, bumpVersion } from '../../../services/projects/semver-bump.js'
import { SetVersionDialogModel, type SetVersionResult } from '../../../services/projects/set-version-dialog-model.js'
import { NewItemChoice } from '../../../services/projects/new-item-choice.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
import {
    NewProjectDialogModel,
    ProjectTypeChoice,
    type NewProjectResult,
} from '../../../services/projects/new-project-dialog-model.js'
import {
    OpenProjectDialogModel,
    type OpenProjectResult,
} from '../../../services/projects/open-project-dialog-model.js'
import type { BaseBindings, BaseRef } from '../../../services/projects/base-binding.js'
import { ensureMetaModelsBackend } from '../../meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../library/services/libraries-backend.js'
import { TodlLanguageClient } from '../../../services/todl/todl-language-client.js'
import { WorkspaceBaseResolver } from '../../../services/projects/workspace-base-resolver.js'
import { ProblemsService } from '../../problems/problems-service.js'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../../services/diagnostics/diagnostic.js'
import { planNodeMoves } from '../../../services/projects/node-move.js'
import { ConfirmDialogModel } from '../../../services/dialogs/confirm-dialog-model.js'
import { DocumentCloseGuard } from '../../../services/documents/document-close-guard.js'
import { ManageReferencesDialogModel } from '../../../services/projects/manage-references-dialog-model.js'
import { RecentProjectsService } from '../../../services/projects/recent-projects-service.js'
import { CodeDocument } from '../../code-editor/code-document.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { samePath } from '../../../services/file-watch/path-utils.js'
import { StorageProviderRegistry } from '../../../services/storage/storage-provider-registry.js'
import { isLocalFileAccess, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { CreateProjectPrefill, CreateProjectResult } from '../../../../../shared/agent-api.js'

// The result of CreateProject — the tool outcome minus its correlation id.
export type CreateOutcome = Omit<CreateProjectResult, 'id'>

// Apply the agent's optional prefill onto a New Project form: set the name /
// location text and select the matching type (unknown/missing values are ignored,
// leaving the form's defaults).
export function applyPrefill(form: NewProjectDialogModel, prefill?: CreateProjectPrefill): void
{
    if (prefill === undefined) return
    if (prefill.name !== undefined) form.Name = prefill.name
    if (prefill.location !== undefined) form.Location = prefill.location
    if (prefill.type !== undefined)
    {
        const match = form.Types.ToArray().find((t) => t.Type === prefill.type)
        if (match?.SelectCommand !== undefined) match.SelectCommand.Execute()
    }
    // Carry the base bindings the prefill proposes into the pickers, matched by
    // id@version against the published choices (the type is already selected, so
    // the collections are populated). Unknown refs are ignored — the user still
    // finalizes the form. Without this the pickers reset to empty even when the
    // agent named a meta-model/library, silently dropping the binding.
    if (prefill.metaModel !== undefined)
    {
        const ref = prefill.metaModel
        const choice = form.MetaModels.ToArray().find((m) => m.Ref.id === ref.id && m.Ref.version === ref.version)
        if (choice !== undefined) form.SelectedMetaModel = choice
    }
    if (prefill.libraries !== undefined)
    {
        const wanted = new Set(prefill.libraries.map((l) => `${l.id}@${l.version}`))
        for (const lib of form.Libraries.ToArray())
            if (wanted.has(`${lib.Ref.id}@${lib.Ref.version}`)) lib.IsSelected = true
    }
}

// Depth-first membership test: is `node` `root` or anywhere in its subtree?
// Used to resolve which open project owns a selected/dragged node.
function subtreeContains(root: ProjectNode, node: ProjectNode): boolean
{
    if (root === node) return true
    for (const child of root.Children.ToArray())
    {
        if (subtreeContains(child, node)) return true
    }
    return false
}

export class ProjectExplorerService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProjectExplorerService>('ProjectExplorerService')

    // The open projects — the tree's roots (each a collapsible DataTemplate
    // [OpenProject]). Empty until a project is opened or the session restores.
    public static readonly OpenProjectsKey = MuralBase.RegisterProperty<ObservableCollection<OpenProject>>(
        ProjectExplorerService, 'OpenProjects', undefined as unknown as ObservableCollection<OpenProject>, MetaData.None)
    public static readonly StatusKey = MuralBase.RegisterProperty<string>(
        ProjectExplorerService, 'Status', 'No project open.', MetaData.None)
    public static readonly OpenProjectCommandKey = MuralBase.RegisterProperty<ICommand>(
        ProjectExplorerService, 'OpenProjectCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly NewProjectCommandKey = MuralBase.RegisterProperty<ICommand>(
        ProjectExplorerService, 'NewProjectCommand', undefined as unknown as ICommand, MetaData.None)
    // Keyboard handler for the single project TreeView (bound `on KeyDown` from
    // the tree's wrapper). The whole tree is now ONE TreeView with unified
    // selection, so the key routes to whichever project currently holds the
    // selection (F2 rename / Delete / Enter-commit / Escape-cancel).
    public static readonly TreeKeyCommandKey = MuralBase.RegisterProperty<ICommand>(
        ProjectExplorerService, 'TreeKeyCommand', undefined as unknown as ICommand, MetaData.None)

    // Which open project each open document belongs to — for save-routing (the
    // active doc saves through its own factory) and close-cleanup.
    private readonly docOwners = new Map<IDocument, OpenProject>()
    // Each open document's project-relative path — so an in-place rename can
    // re-point the tab (via the factory's relocateOpenFile) instead of leaving
    // it stale.
    private readonly docPaths = new Map<IDocument, string>()

    // The open code-document whose resolved OS path matches `absPath`, if any —
    // for the file-watch editor-reload consumer. Matches a watcher-reported
    // absolute path against each open project document's ResolveOsPath, narrowing
    // to CodeDocument (only code buffers can be reloaded from disk).
    public FindOpenCodeDocByOsPath(absPath: string): CodeDocument | undefined
    {
        const ci = this.Provider.getRequired(EnvironmentService.Key).IsWindows
        for (const [doc, rel] of this.docPaths)
        {
            if (!(doc instanceof CodeDocument)) continue
            const storage = this.docOwners.get(doc)?.Storage
            if (storage === undefined || !isLocalFileAccess(storage)) continue
            if (samePath(storage.ResolveOsPath(rel), absPath, ci)) return doc
        }
        return undefined
    }

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(ProjectExplorerService.OpenProjectsKey, new ObservableCollection<OpenProject>())
        this.set_property_value(ProjectExplorerService.OpenProjectCommandKey, new RelayCommand(() => void this.openProject()))
        this.set_property_value(ProjectExplorerService.NewProjectCommandKey, new RelayCommand(() => void this.newProject()))
        this.set_property_value(ProjectExplorerService.TreeKeyCommandKey, new RelayCommand((arg) => this.handleTreeKeyGlobal(arg as KeyEventArgs)))
    }

    public get OpenProjects(): ObservableCollection<OpenProject> { return this.get_property_value(ProjectExplorerService.OpenProjectsKey) }
    public get Status(): string { return this.get_property_value(ProjectExplorerService.StatusKey) }
    public get OpenProjectCommand(): ICommand { return this.get_property_value(ProjectExplorerService.OpenProjectCommandKey) }
    public get NewProjectCommand(): ICommand { return this.get_property_value(ProjectExplorerService.NewProjectCommandKey) }
    public get TreeKeyCommand(): ICommand { return this.get_property_value(ProjectExplorerService.TreeKeyCommandKey) }

    // The project that owns `node` — the open project whose file tree contains
    // it. The single unified TreeView renders every project, so behaviors resolve
    // a node's project by membership (a node no longer sits under a per-project
    // tree whose DataContext names the owner). Undefined for a node that belongs
    // to no open project (e.g. one already detached by a concurrent delete).
    public OwnerOf(node: ProjectNode): OpenProject | undefined
    {
        for (const op of this.OpenProjects.ToArray())
        {
            if (subtreeContains(op.Root, node)) return op
        }
        return undefined
    }

    // Reveal channel: after an import lands files inside a folder, that folder is
    // expanded so the newly-added rows are visible (importing into a collapsed
    // folder otherwise changes nothing on screen). Expansion is TreeViewItem
    // view-state the service can't reach, so it raises the request and
    // ProjectTreeTemplateBehavior (which holds the tree) does the expand.
    private readonly revealListeners: ((folder: ProjectNode) => void)[] = []

    public AddRevealListener(listener: (folder: ProjectNode) => void): () => void
    {
        this.revealListeners.push(listener)
        return () => {
            const i = this.revealListeners.indexOf(listener)
            if (i >= 0) this.revealListeners.splice(i, 1)
        }
    }

    // Ask the tree to reveal (expand) the folder an import just filled. A root
    // import ('' target) needs nothing — the project root is always expanded.
    private revealImportTarget(op: OpenProject, target: string): void
    {
        if (target === '') return
        const folder = this.folderNodeAt(op.Root, target)
        if (folder === undefined) return
        for (const listener of [...this.revealListeners]) listener(folder)
    }

    // The folder node at project-relative `path` within `root`'s subtree, or
    // undefined if none matches (path identity is stable across rescans).
    private folderNodeAt(root: ProjectNode, path: string): ProjectNode | undefined
    {
        if (root.Path === path && root.Kind === 'folder') return root
        for (const child of root.Children.ToArray())
        {
            const found = this.folderNodeAt(child, path)
            if (found !== undefined) return found
        }
        return undefined
    }

    // Distribute the unified tree selection into each project's per-project
    // selection state, so the existing per-project operations (delete / rename /
    // key handling) keep reading op.SelectedNode / op.SelectedNodes unchanged.
    // `items` is the full multi-selection (ProjectNodes, possibly spanning
    // projects — though in practice one project at a time); `primary` is the
    // anchor row. Setting a project's SelectedNode to the anchor activates it
    // (OpenProject.OnPropertyChanged opens a leaf); every other project's anchor
    // is cleared so a stale selection in a now-inactive project doesn't linger.
    public ApplyTreeSelection(items: readonly unknown[], primary: unknown): void
    {
        const byOwner = new Map<OpenProject, ProjectNode[]>()
        for (const item of items)
        {
            if (!(item instanceof ProjectNode)) continue
            const op = this.OwnerOf(item)
            if (op === undefined) continue
            const bucket = byOwner.get(op)
            if (bucket === undefined) byOwner.set(op, [item])
            else bucket.push(item)
        }
        const primaryNode = primary instanceof ProjectNode ? primary : undefined
        const primaryOwner = primaryNode !== undefined ? this.OwnerOf(primaryNode) : undefined
        for (const op of this.OpenProjects.ToArray())
        {
            op.SelectedNodes = byOwner.get(op) ?? []
            // Assigning SelectedNode = the anchor opens a leaf (OpenProject's
            // OnPropertyChanged); an unchanged value is a DP no-op, so a
            // re-selection of the same row doesn't re-open it.
            op.SelectedNode = op === primaryOwner ? primaryNode : undefined
        }
    }

    // Route a tree key to the project currently holding the selection. With one
    // unified tree and unified selection, exactly one project has a live
    // selection at a time; find it and delegate to the per-project handler.
    private handleTreeKeyGlobal(args: KeyEventArgs): void
    {
        if (args === undefined) return
        const op = this.OpenProjects.ToArray().find(
            (p) => p.SelectedNode !== undefined || p.SelectedNodes.length > 0)
        if (op !== undefined) this.handleTreeKey(op, args)
    }

    private set Status(v: string) { this.set_property_value(ProjectExplorerService.StatusKey, v) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get storageRegistry(): StorageProviderRegistry { return this.Provider.getRequired(StorageProviderRegistry.Key) }
    private get dialogs(): DialogService { return this.Provider.getRequired(DialogService.Key) }
    private get recents(): RecentProjectsService { return this.Provider.getRequired(RecentProjectsService.Key) }
    private get openStore(): OpenProjectsStore { return this.Provider.getRequired(OpenProjectsStore.Key) }
    private get host(): DocumentsContentHostService
    {
        return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
    }

    // Open Project: present the recents-or-Browse dialog; open whatever folder it
    // resolves to. (Locating a project is local-only — a deferred, backend-
    // specific affordance — so Browse and recents both yield a local folder.)
    private async openProject(): Promise<void>
    {
        const recents = await this.recents.List()
        const vm = new OpenProjectDialogModel(recents, this.fs, (r) => this.dialogs.Close(r))
        const result = (await this.dialogs.Show({ Title: 'Open Project', Content: vm, Width: 720 })) as OpenProjectResult | undefined
        if (result === undefined) return
        await this.openProjectAt(result.location)
    }

    // New Project: present the full type-picker dialog; create the project in the
    // chosen folder on the default (local) backend.
    private async newProject(): Promise<void>
    {
        const choices = this.typeChoices()
        if (choices.length === 0) { this.Status = 'No project factory registered.'; return }
        const vm = await this.NewProjectFormFor((r) => this.dialogs.Close(r))
        const result = (await this.dialogs.Show({ Title: 'New Project', Content: vm, Width: 520 })) as NewProjectResult | undefined
        if (result === undefined) return
        await this.CreateProject(result)
    }

    // Build a configured New Project form: the type choices, the published
    // meta-models/libraries pickers, and live validation — pre-filled from the
    // agent's proposal. `close` is supplied by the caller (the modal or the chat
    // card). Shared by newProject() and the agent's create_project card.
    public async NewProjectFormFor(
        close: (result?: NewProjectResult) => void,
        prefill?: CreateProjectPrefill): Promise<NewProjectDialogModel>
    {
        const vm = new NewProjectDialogModel(
            this.typeChoices(),
            this.fs,
            (r) => this.validateNewProject(r),
            close,
            await this.publishedMetaModels(),
            await this.publishedLibraries(),
        )
        applyPrefill(vm, prefill)
        return vm
    }

    // The single project creator: validate, create on disk, add to the open set,
    // and return the outcome (which a void command cannot). Shared by the toolbar
    // dialog and the agent's create card.
    public async CreateProject(data: NewProjectResult): Promise<CreateOutcome>
    {
        const error = await this.validateNewProject(data)
        if (error !== null) return { created: false, error }
        // A project is ALWAYS self-contained in its own subfolder named after it,
        // created inside the chosen location — and it's that subfolder we create in
        // and then open. Writes don't mkdir parents, so create the subfolder first.
        const name = data.name.trim()
        const folder = joinPath(data.location, name)
        try {
            await this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, data.location).CreateDirectory(name)
        } catch (e) {
            return { created: false, error: `Could not create the project folder: ${(e as Error).message}` }
        }
        const op = await this.createProjectAt(data.type, name, folder, data.metaModel, data.libraries)
        if (op === undefined) return { created: false, error: this.Status }
        return { created: true, folder: op.Folder, name: op.Name, type: data.type }
    }

    // Read a folder's manifest envelope → build the project's storage for the
    // backend it names → route to the matching factory → add it to the open set.
    // A no-op (with a status) if the folder is already open.
    private async openProjectAt(folder: string): Promise<void>
    {
        const already = this.findByFolder(folder)
        if (already !== undefined) { this.Status = `${already.Name} is already open.`; return }

        const bootstrap = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, folder)

        let envelope: ProjectManifestEnvelope
        try {
            envelope = JSON.parse(await bootstrap.ReadText(PROJECT_MANIFEST_FILENAME)) as ProjectManifestEnvelope
        } catch {
            this.Status = `No ${PROJECT_MANIFEST_FILENAME} in that folder.`
            return
        }

        const factory = this.resolveFactory(envelope.type)
        if (factory === undefined) { this.Status = `No factory for project type "${envelope.type}".`; return }

        let storage: IStorage
        try {
            const backendId = envelope.storage ?? StorageProviderRegistry.DefaultBackendId
            storage = backendId === StorageProviderRegistry.DefaultBackendId
                ? bootstrap
                : this.storageRegistry.Create(backendId, folder)
        } catch (e) {
            this.Status = (e as Error).message   // unknown storage backend
            return
        }

        try {
            const project = await factory.openProject(storage)
            const op = await this.addOpenProject(project, factory, storage)
            await this.recents.Add({ name: op.Name, path: folder, type: envelope.type, openedAt: Date.now() })
            this.Status = `Opened ${op.Name}.`
        } catch (e) {
            this.Status = `Open failed: ${(e as Error).message}`
        }
    }

    // Create a project of `type` named `name` in `folder`, add + record it.
    // `metaModel` / `libraries` are the base bindings chosen in the dialog
    // (library binds a meta-model; architecture binds a meta-model + libraries).
    private async createProjectAt(
        type: string, name: string, folder: string,
        metaModel?: BaseRef, libraries?: readonly BaseRef[]): Promise<OpenProject | undefined>
    {
        const factory = this.resolveFactory(type)
        if (factory === undefined) { this.Status = `No factory for project type "${type}".`; return undefined }

        const storage = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, folder)
        try {
            const bindings = (metaModel !== undefined || (libraries !== undefined && libraries.length > 0))
                ? { metaModel, libraries }
                : undefined
            const project = await factory.createProject(storage, name, bindings)
            const op = await this.addOpenProject(project, factory, storage)
            await this.recents.Add({ name: op.Name, path: folder, type, openedAt: Date.now() })
            this.Status = `Created ${op.Name}.`
            return op
        } catch (e) {
            this.Status = `Create failed: ${(e as Error).message}`
            return undefined
        }
    }

    // Reopen the previous session's projects. Skips (and prunes) folders whose
    // project manifest is gone; already-open folders dedupe.
    public async RestoreSession(): Promise<void>
    {
        for (const folder of await this.openStore.List()) {
            let hasManifest = false
            try {
                const storage = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, folder)
                hasManifest = await storage.Exists(PROJECT_MANIFEST_FILENAME)
            } catch { hasManifest = false }
            if (hasManifest) await this.openProjectAt(folder)
            else await this.openStore.Remove(folder)
        }
    }

    // Wrap a project as an OpenProject, wire its per-project commands + node
    // open-commands, add it to the tree, and persist the folder. Deduped by
    // folder — a project already open is returned as-is (no duplicate, no
    // re-persist), so every entry point stays idempotent.
    private async addOpenProject(project: Project, factory: IProjectFactory, storage: IStorage): Promise<OpenProject>
    {
        const existing = this.findByFolder(project.RootPath)
        if (existing !== undefined) return existing

        const op = new OpenProject(project, factory, storage)
        this.wireProjectCommands(op)
        this.wireNodes(op.Root, op)
        this.OpenProjects.Add(op)
        // Register the project for whole-project live validation (populates the
        // Problems dock even before any file is opened).
        void this.Provider.get(TodlLanguageClient.Key)?.AttachProject(op.Project.RootPath, op.Project.Name, op.Storage)
        await this.openStore.Add(op.Folder)
        return op
    }

    private wireProjectCommands(op: OpenProject): void
    {
        op.NewItemChoices = this.newItemChoices(op, '')
        op.NewFolderCommand = new RelayCommand(() => void this.newFolderIn(op))
        op.ImportFileCommand = new RelayCommand(() => void this.importFilesInto(op, ''))
        op.ImportFolderCommand = new RelayCommand(() => void this.importFolderInto(op, ''))
        op.TreeKeyCommand = new RelayCommand((arg) => this.handleTreeKey(op, arg as KeyEventArgs))
        op.PublishCommand = new RelayCommand(() => void this.publishProject(op), () => isPublishable(op.Factory))
        op.BumpVersionMajorCommand = new RelayCommand(
            () => void this.bumpVersion(op, VersionPart.Major), () => isVersioned(op.Factory))
        op.BumpVersionMinorCommand = new RelayCommand(
            () => void this.bumpVersion(op, VersionPart.Minor), () => isVersioned(op.Factory))
        op.BumpVersionPatchCommand = new RelayCommand(
            () => void this.bumpVersion(op, VersionPart.Patch), () => isVersioned(op.Factory))
        op.SetVersionCommand = new RelayCommand(
            () => void this.setVersionDialog(op), () => isVersioned(op.Factory))
        op.GeneratePresentationColorfulCommand = new RelayCommand(
            () => void this.generatePresentation(op, true), () => canGeneratePresentation(op.Factory))
        op.GeneratePresentationMonochromeCommand = new RelayCommand(
            () => void this.generatePresentation(op, false), () => canGeneratePresentation(op.Factory))
        // Re-resolve the project's declared bases after a base was republished —
        // only meaningful for a type that binds one (library/architecture).
        op.RefreshBasesCommand = new RelayCommand(
            () => this.refreshBases(op),
            () => op.Factory.requiresMetaModel === true)
        // Refresh the agent scaffold docs to the current bundled version — any TODL project.
        op.UpdateAgentMetadataCommand = new RelayCommand(
            () => void this.updateAgentMetadata(op), () => isTodlProject(op.Factory))
        // Open the References manager — only for a consumer that binds a
        // meta-model (architecture / library), not a meta-model project.
        op.ManageReferencesCommand = new RelayCommand(
            () => void this.manageReferences(op),
            () => op.Factory.requiresMetaModel === true)
        op.CloseCommand = new RelayCommand(() => void this.closeProject(op))
        op.MoveNodesCommand = new RelayCommand((arg) => {
            const a = arg as MoveArg
            if (a.source === op) void this.moveNodes(op, a.nodes, a.destPath)
            else void this.moveNodesAcross(a.source, a.nodes, op, a.destPath)
        })
        void this.wireAgentSkillChoices(op)
    }

    // Fetch the project's .claude catalog and populate its "Run Agent / Skill"
    // submenu, each choice launching a background run via ChatSessionsService.
    private async wireAgentSkillChoices(op: OpenProject): Promise<void>
    {
        const catalog = this.Provider.get(ProjectAgentCatalog.Key)
        const chats = this.Provider.get(ChatSessionsService.Key)
        if (catalog === undefined || chats === undefined) return
        const found = await catalog.CatalogFor(op.Folder)
        const choices = buildAgentSkillChoices(found, (item) => { chats.RunAgentSkill(item, op.Folder, op.Name) })
        const collection = new ObservableCollection<AgentSkillChoice>()
        for (const c of choices) collection.Add(c)
        op.AgentSkillChoices = collection
        op.HasAgentSkills = choices.length > 0
    }

    // Create a new file of the project's primary format inside `parentFolder`
    // (project-relative; '' = the project root) and open it. The name is the
    // format kind, auto-numbered to dodge collisions (foo → foo-2).
    private async newFileIn(op: OpenProject, parentFolder = '', format: ProjectFileFormat | undefined = op.Factory.formats[0]): Promise<void>
    {
        if (format === undefined) { this.Status = 'This project type has no file format.'; return }
        const factory = this.resolveDocumentFactory(format.extension)
        if (factory === undefined) { this.Status = `No editor for ${format.extension}.`; return }
        try {
            const name = await uniqueStorageName(op.Storage, joinRel(parentFolder, `${format.kind}${format.extension}`))
            const path = await factory.newFile(op.Storage, name)
            // Refresh the project's tree so the new file appears, then open it.
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            // Optional per-project-type hook (e.g. the arch viewpoint picker). It
            // may abort creation (e.g. the user cancelled the picker); if so,
            // delete the file, re-scan, and skip opening it.
            const keep = await this.Provider.get(NewFileParticipantKey)?.OnCreated(op, path)
            if (keep === false) {
                await op.Storage.Delete(path)
                op.Adopt(await op.Factory.openProject(op.Storage))
                this.wireNodes(op.Root, op)
                this.Status = `New ${format.displayName} cancelled.`
                return
            }
            await this.openDocument(op, path, factory)
            this.Status = `New ${format.displayName} at ${basename(path)}.`
        } catch (e) {
            this.Status = `New file failed: ${(e as Error).message}`
        }
    }

    // One NewItemChoice per declared format, each creating that format in
    // `container` (project-relative; '' = root) and opening it. Bound by the
    // "Add New" submenu on a project header (container '') or a node (its folder).
    private newItemChoices(op: OpenProject, container: string): ObservableCollection<NewItemChoice>
    {
        const choices = new ObservableCollection<NewItemChoice>()
        for (const format of op.Factory.formats) {
            choices.Add(new NewItemChoice(format.displayName, new RelayCommand(() => void this.newFileIn(op, container, format))))
        }
        return choices
    }

    // Create a subfolder ("New Folder", auto-numbered on collision) inside
    // `parentFolder` (project-relative; '' = the project root) and refresh the
    // tree so it appears. Generic — a directory is backend state, not a factory
    // format, so this goes straight through the project's storage.
    private async newFolderIn(op: OpenProject, parentFolder = ''): Promise<void>
    {
        try {
            const path = await uniqueStorageName(op.Storage, joinRel(parentFolder, 'New Folder'))
            await op.Storage.CreateDirectory(path)
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            this.Status = `Created folder ${basename(path)}.`
        } catch (e) {
            this.Status = `New folder failed: ${(e as Error).message}`
        }
    }

    // Import existing file(s) into a project under `target` (project-relative;
    // '' = the project root): pick from the OS (multi-select, binary-safe), copy
    // each in under a non-colliding name (foo → foo-2), then rescan so they
    // appear. The picker is seeded with the factory's formats but not restricted.
    private async importFilesInto(op: OpenProject, target = ''): Promise<void>
    {
        const picked = await this.fs.OpenFiles({ Title: `Import files into ${op.Name}`, Filters: importFilters(op.Factory.formats) })
        if (picked === null || picked.length === 0) return

        try {
            const added: string[] = []
            for (const file of picked) {
                const name = await uniqueStorageName(op.Storage, joinRel(target, basename(file.Path)))
                await op.Storage.WriteBytes(name, file.Bytes)
                added.push(name)
            }
            // Refresh the tree so the imported files appear; re-wire the new nodes.
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            // Expand the destination folder so the freshly-added rows are visible.
            this.revealImportTarget(op, target)
            this.Status = added.length === 1
                ? `Added ${basename(added[0]!)}.`
                : `Added ${added.length} files.`
        } catch (e) {
            this.Status = `Import failed: ${(e as Error).message}`
        }
    }

    // Import an existing OS folder into the project under `target` (project-
    // relative; '' = root): pick a directory, then copy its whole subtree in
    // under a non-colliding TOP-level name (pics → pics-2). Descendants keep
    // their names. Rescans so the subtree appears.
    private async importFolderInto(op: OpenProject, target = ''): Promise<void>
    {
        const dir = await this.fs.OpenFolder({ Title: `Import folder into ${op.Name}` })
        if (dir === null) return

        try {
            const destTop = await uniqueStorageName(op.Storage, joinRel(target, basename(dir)))
            await this.copyOsFolderInto(dir, destTop, op)
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            // Expand the destination folder so the freshly-imported subtree is visible.
            this.revealImportTarget(op, target)
            this.Status = `Imported ${basename(destTop)}.`
        } catch (e) {
            this.Status = `Import failed: ${(e as Error).message}`
        }
    }

    // Recursively copy an OS directory subtree (srcAbsDir) into project storage
    // at destRel. Empty directories are preserved; files copy byte-for-byte.
    // node fs accepts '/' on Windows, so a plain string join builds child paths.
    private async copyOsFolderInto(srcAbsDir: string, destRel: string, op: OpenProject): Promise<void>
    {
        await op.Storage.CreateDirectory(destRel)
        for (const entry of await this.fs.ListDirectory(srcAbsDir)) {
            const childSrc = `${srcAbsDir}/${entry.Name}`
            const childDest = joinRel(destRel, entry.Name)
            if (entry.IsDirectory) {
                await this.copyOsFolderInto(childSrc, childDest, op)
            } else {
                await op.Storage.WriteBytes(childDest, await this.fs.ReadBytes(childSrc))
            }
        }
    }

    // TreeView key handler (bound via `on KeyDown`): F2 renames the selected
    // node, Enter commits the in-progress rename, Escape cancels it. Marks the
    // args handled so the keystroke doesn't also drive tree navigation.
    private handleTreeKey(op: OpenProject, args: KeyEventArgs): void
    {
        if (args === undefined) return
        switch (args.Key) {
            case Key.F2: {
                const node = op.SelectedNode
                if (node !== undefined && node.Path !== '') { this.beginRename(op, node); args.Handled = true }
                return
            }
            case Key.Return: {
                if (op.EditingNode !== undefined) { void this.commitRename(op, op.EditingNode); args.Handled = true }
                return
            }
            case Key.Escape: {
                if (op.EditingNode !== undefined) { this.cancelRename(op, op.EditingNode); args.Handled = true }
                return
            }
            case Key.Delete: {
                // Not while a rename editor is open — there Delete edits text.
                if (op.EditingNode !== undefined) return
                const targets = this.selectionOf(op)
                if (targets.length > 0) { void this.deleteNodes(op, targets); args.Handled = true }
                return
            }
        }
    }

    // The tree's current selection as an array: the full multi-selection when
    // present (kept in sync by TreeSelectionBehavior), else the single anchor
    // node. Empty when nothing is selected.
    private selectionOf(op: OpenProject): ProjectNode[]
    {
        if (op.SelectedNodes.length > 0) return [...op.SelectedNodes]
        return op.SelectedNode !== undefined ? [op.SelectedNode] : []
    }

    // Context-menu "Delete" on a node: if the node is part of a multi-selection,
    // delete the whole selected set; otherwise delete just this node. (Right-
    // clicking a row outside the selection acts on that row alone, VSCode-style.)
    private deleteFromNode(op: OpenProject, node: ProjectNode): Promise<void>
    {
        const selection = op.SelectedNodes
        const targets = selection.length > 1 && selection.includes(node) ? [...selection] : [node]
        return this.deleteNodes(op, targets)
    }

    // Delete one or more nodes: confirm once, remove each from storage (a folder
    // takes its contents with it), close any tabs the deletion invalidates, then
    // detach each from its parent in place. Nodes nested under another selected
    // node are dropped from the pass (their ancestor's delete already removes
    // them). The project root ('' path) is never deletable and is filtered out.
    private async deleteNodes(op: OpenProject, nodes: readonly ProjectNode[]): Promise<void>
    {
        const targets = nodes.filter((n) => n.Path !== '')
        if (targets.length === 0) return
        if (!(await this.confirmDelete(targets))) return

        try {
            for (const node of topLevelNodes(targets)) {
                await op.Storage.Delete(node.Path)
                this.closeDocumentsUnder(op, node.Path)
                this.removeNodeInPlace(op, node)
            }
            op.SelectedNodes = []
            this.Status = targets.length === 1 ? `Deleted ${targets[0].Name}.` : `Deleted ${targets.length} items.`
        } catch (e) {
            this.Status = `Delete failed: ${(e as Error).message}`
        }
    }

    // Detach a node from its parent's Children — the surgical counterpart to a
    // rescan for deletes. A removal shifts no surviving node's path, so unlike
    // renameNodeInPlace there's no reprefix or re-sort: the bound TreeView drops
    // just that row and every other node keeps its object identity (so expansion
    // and selection survive). Clears SelectedNode if it pointed at the removed
    // node, leaving no dangling reference to a detached row.
    private removeNodeInPlace(op: OpenProject, node: ProjectNode): void
    {
        const parent = this.findParent(op.Root, node)
        if (parent === undefined) return
        const i = parent.Children.IndexOf(node)
        if (i >= 0) parent.Children.RemoveAt(i)
        if (op.SelectedNode === node) op.SelectedNode = undefined
    }

    // Show the reusable confirm dialog and await the user's choice. The message
    // adapts to the selection — a single file, a single folder (whose contents
    // go too), or a multi-item batch. A scrim dismiss resolves undefined → false.
    private async confirmDelete(nodes: readonly ProjectNode[]): Promise<boolean>
    {
        const message = deleteMessage(nodes)
        const vm = new ConfirmDialogModel(message, 'Delete', (r) => this.dialogs.Close(r))
        const confirmed = await this.dialogs.Show<boolean>({ Title: 'Delete', Content: vm, Width: 420 })
        return confirmed === true
    }

    // Close every open tab whose file lived at `path` or under it (for a folder
    // delete), and forget it — the file is gone, so the tab can't save back.
    private closeDocumentsUnder(op: OpenProject, path: string): void
    {
        for (const [doc, docPath] of [...this.docPaths]) {
            if (this.docOwners.get(doc) !== op) continue
            if (docPath === path || docPath.startsWith(path + '/')) {
                this.host.Close(doc)
                this.docOwners.delete(doc)
                this.docPaths.delete(doc)
            }
        }
    }

    // Open a node's in-place editor: seed the buffer with the current name and
    // flip IsEditing (which the row template swaps to a focused TextBox). Only
    // one node edits at a time, so close any prior editor first.
    private beginRename(op: OpenProject, node: ProjectNode): void
    {
        if (node.Path === '') return
        const prev = op.EditingNode
        if (prev !== undefined && prev !== node) prev.IsEditing = false
        node.EditingName = node.Name
        node.IsEditing = true
        op.EditingNode = node
    }

    private cancelRename(op: OpenProject, node: ProjectNode): void
    {
        node.IsEditing = false
        if (op.EditingNode === node) op.EditingNode = undefined
    }

    // Commit a rename: move the file/folder within its parent, re-point any open
    // tabs to the new path, and rescan the tree. A no-op name, a collision, or a
    // name with a path separator aborts back to the label (with a status).
    private async commitRename(op: OpenProject, node: ProjectNode): Promise<void>
    {
        const proposed = node.EditingName.trim()
        if (proposed === '' || proposed === node.Name) { this.cancelRename(op, node); return }
        if (/[\\/]/.test(proposed)) { this.Status = "A name can't contain a path separator."; this.cancelRename(op, node); return }

        const dest = joinRel(parentOf(node.Path), proposed)
        try {
            if (await op.Storage.Exists(dest)) { this.Status = `"${proposed}" already exists.`; this.cancelRename(op, node); return }
            await this.relocatePath(op, node.Path, dest)
            // Surgical, in-place update — the node object (and the whole tree)
            // is preserved, so the TreeView keeps its expansion + selection
            // instead of rebuilding wholesale from a rescan.
            this.renameNodeInPlace(op, node, proposed, dest)
            op.EditingNode = undefined
            this.Status = `Renamed to ${proposed}.`
        } catch (e) {
            this.cancelRename(op, node)
            this.Status = `Rename failed: ${(e as Error).message}`
        }
    }

    // After a rename, re-point every open tab whose file lived at (or under, for
    // a folder rename) the old path — the factory updates the document's path +
    // title in place so the tab keeps working. No-op for factories that can't
    // relocate (their tabs would need a manual reopen).
    private repointOpenDocuments(op: OpenProject, oldPath: string, newPath: string): void
    {
        for (const [doc, path] of [...this.docPaths]) {
            if (this.docOwners.get(doc) !== op) continue
            const moved = path === oldPath ? newPath
                : path.startsWith(oldPath + '/') ? newPath + path.slice(oldPath.length)
                    : undefined
            if (moved === undefined) continue
            const factory = this.resolveDocumentFactory(extname(moved))
            if (factory !== undefined && isRelocatable(factory)) factory.relocateOpenFile(doc, moved)
            this.docPaths.set(doc, moved)
        }
    }

    // Rename a path on storage and re-point any open tabs under it. Shared by
    // rename (name change in place) and move (into another folder).
    private async relocatePath(op: OpenProject, fromPath: string, toPath: string): Promise<void>
    {
        await op.Storage.Rename(fromPath, toPath)
        this.repointOpenDocuments(op, fromPath, toPath)
    }

    // Update a renamed node (and, for a folder, its whole subtree) IN PLACE:
    // re-prefix descendant paths, set the node's own Name/Path, re-wire the
    // subtree's path-capturing commands, close the editor, and re-sort it among
    // its siblings when the new name changes its position. The node objects are
    // preserved, so the bound TreeView updates the affected rows in place rather
    // than rebuilding — expansion and selection survive.
    private renameNodeInPlace(op: OpenProject, node: ProjectNode, newName: string, newPath: string): void
    {
        this.reprefixSubtree(node, node.Path, newPath)   // descendants first (uses the OLD prefix)
        node.Name = newName
        node.Path = newPath
        // NewFile/NewFolder commands capture their container path at wire time,
        // so a path change needs the renamed subtree re-wired.
        this.wireNodes(node, op)
        node.IsEditing = false
        this.resortNode(op, node)
    }

    // Rewrite every descendant's Path, swapping the old path prefix for the new.
    // Names are unchanged; only the path (the identity + file-open key) moves.
    private reprefixSubtree(node: ProjectNode, oldPrefix: string, newPrefix: string): void
    {
        for (const child of node.Children.ToArray()) {
            child.Path = newPrefix + child.Path.slice(oldPrefix.length)
            this.reprefixSubtree(child, oldPrefix, newPrefix)
        }
    }

    // Re-position a node among its siblings to match the factory's order (folders
    // first, then case-insensitive by name) — but only touch the collection when
    // the index actually changes, so a rename that keeps its slot disturbs nothing.
    private resortNode(op: OpenProject, node: ProjectNode): void
    {
        const parent = this.findParent(op.Root, node)
        if (parent === undefined) return
        const kids = parent.Children
        const from = kids.IndexOf(node)
        if (from < 0) return
        const target = kids.ToArray().slice().sort(compareNodes).indexOf(node)
        if (target === from) return
        kids.RemoveAt(from)
        kids.Insert(target, node)
    }

    // The node whose Children contains `target`, searched from `root`. undefined
    // for the root itself or a node not attached under `root`.
    private findParent(root: ProjectNode, target: ProjectNode): ProjectNode | undefined
    {
        for (const child of root.Children.ToArray()) {
            if (child === target) return root
            if (child.Kind === 'folder') {
                const hit = this.findParent(child, target)
                if (hit !== undefined) return hit
            }
        }
        return undefined
    }

    // Re-scan the project so a structural change (move/new/delete) reappears with
    // correct paths, and re-wire the fresh nodes' commands.
    private async rescan(op: OpenProject): Promise<void>
    {
        op.Adopt(await op.Factory.openProject(op.Storage))
        this.wireNodes(op.Root, op)
        // Reconcile the language server's open document set with the new tree
        // (created/deleted/renamed .todl files) so diagnostics stay in sync.
        void this.Provider.get(TodlLanguageClient.Key)?.ResyncProject(op.Project.RootPath, op.Storage)
    }

    // Move the given nodes into destParentPath (project-relative; '' = root),
    // within this project. Planning (ancestor-filter, already-there, into-self/
    // descendant) is pure (planNodeMoves); here we add the storage collision check
    // + execute, then a single rescan.
    private async moveNodes(op: OpenProject, nodes: readonly ProjectNode[], destParentPath: string): Promise<void>
    {
        const { moves, rejects } = planNodeMoves(nodes, destParentPath)
        const collisions: string[] = []
        let moved = 0
        for (const m of moves) {
            if (await op.Storage.Exists(m.to)) { collisions.push(m.name); continue }
            await this.relocatePath(op, m.from, m.to)
            moved++
        }
        if (moved > 0) await this.rescan(op)

        if (collisions.length === 0 && rejects.length === 0) {
            if (moved > 0) this.Status = `Moved ${moved} item(s).`
            return
        }
        const parts: string[] = []
        if (moved > 0) parts.push(`moved ${moved}`)
        if (collisions.length > 0) parts.push(`${collisions.length} already exist`)
        if (rejects.length > 0) parts.push(`${rejects.length} can't move there`)
        this.Status = `Move: ${parts.join(', ')}.`
    }

    // Move nodes from `source` into `target` (a DIFFERENT project / storage): copy
    // each subtree across (binary-safe), delete the source, re-point any open tabs,
    // then rescan both projects. Target name-collisions are skipped with a status.
    private async moveNodesAcross(
        source: OpenProject, nodes: readonly ProjectNode[], target: OpenProject, destParentPath: string): Promise<void>
    {
        const { moves } = planNodeMoves(nodes, destParentPath, false)
        const collisions: string[] = []
        let moved = 0
        for (const m of moves) {
            if (await target.Storage.Exists(m.to)) { collisions.push(m.name); continue }
            const node = nodes.find((n) => n.Path === m.from)!
            await copyTree(source.Storage, m.from, target.Storage, m.to, node.Kind === 'folder')
            await source.Storage.Delete(m.from)
            this.repointMovedDocs(source, target, m.from, m.to)
            moved++
        }
        if (moved > 0) { await this.rescan(source); await this.rescan(target) }

        if (collisions.length === 0) { if (moved > 0) this.Status = `Moved ${moved} item(s) to ${target.Name}.`; return }
        this.Status = `Move to ${target.Name}: ${moved > 0 ? `moved ${moved}, ` : ''}${collisions.length} already exist.`
    }

    // Re-point every open doc that lived at (or under) fromPath in `source` to the
    // corresponding path under `toPath` in `target`: keep the tab open when its
    // editor supports a cross-storage relocate (reassigning ownership), else close
    // it (a non-relocatable editor can't follow the file across storages).
    private repointMovedDocs(source: OpenProject, target: OpenProject, fromPath: string, toPath: string): void
    {
        for (const [doc, path] of [...this.docPaths]) {
            if (this.docOwners.get(doc) !== source) continue
            const moved = path === fromPath ? toPath
                : path.startsWith(fromPath + '/') ? toPath + path.slice(fromPath.length)
                    : undefined
            if (moved === undefined) continue
            const factory = this.resolveDocumentFactory(extname(moved))
            if (factory !== undefined && isRelocatableAcrossStorage(factory)) {
                factory.relocateAcrossStorage(doc, target.Storage, moved)
                this.docOwners.set(doc, target)
                this.docPaths.set(doc, moved)
            } else {
                this.host.Close(doc); this.docOwners.delete(doc); this.docPaths.delete(doc)
            }
        }
    }

    // Bump the producer project's published version by one semver part and write
    // it back to the manifest. Menu items are disabled for non-versioned types,
    // but guard anyway.
    private async bumpVersion(op: OpenProject, part: VersionPart): Promise<void>
    {
        if (!isVersioned(op.Factory)) { this.Status = 'This project type has no version.'; return }
        const next = bumpVersion(await op.Factory.getVersion(op.Storage), part)
        await op.Factory.setVersion(op.Storage, next)
        this.Status = `Version bumped to ${next}.`
    }

    // The Custom… flow: show the set-version dialog pre-filled with the current
    // version; on OK write the chosen version and — if the dialog's Publish box was
    // checked — publish immediately (reusing publishProject's error handling).
    private async setVersionDialog(op: OpenProject): Promise<void>
    {
        if (!isVersioned(op.Factory)) { this.Status = 'This project type has no version.'; return }
        const current = await op.Factory.getVersion(op.Storage)
        const vm = new SetVersionDialogModel(current, (r) => this.dialogs.Close(r))
        const result = (await this.dialogs.Show({ Title: 'Set Version', Content: vm, Width: 380 })) as SetVersionResult | undefined
        if (result === undefined) return
        await op.Factory.setVersion(op.Storage, result.version)
        if (result.publish) { await this.publishProject(op); return }
        this.Status = `Version set to ${result.version}.`
    }

    // Refresh the project's agent scaffold docs (.claude/**) to the current bundled
    // version (preserving the author-owned CLAUDE.md), then rescan so any self-healed
    // file appears in the tree. Menu item is disabled for non-TODL types, but guard.
    private async updateAgentMetadata(op: OpenProject): Promise<void>
    {
        if (!isTodlProject(op.Factory)) { this.Status = 'This project type has no agent docs.'; return }
        const written = await op.Factory.updateScaffold(op.Storage)
        await this.rescan(op)
        this.Status = `Agent docs updated (${written.length} refreshed).`
    }

    // Publish the project through its factory (the menu item is disabled for
    // non-publishable types, but guard anyway). Surfaces the result message.
    private async publishProject(op: OpenProject): Promise<void>
    {
        if (!isPublishable(op.Factory)) { this.Status = "This project type can't be published."; return }
        // Refresh diagnostics so the Problems dock reflects exactly what publish sees.
        await this.Provider.get(TodlLanguageClient.Key)?.RefreshBases(op.Storage)
        try {
            const result = await op.Factory.publish(op.Project, op.Storage, this.Provider)
            if (result.ok) {
                this.Status = result.message
                this.reportProjectProblem(op, 'publish', undefined)   // clear any prior failure
                return
            }
            // A failure's error DESCRIPTION goes ONLY to the Problems dock — never
            // the status pane, which shows just a neutral pointer.
            this.Status = 'Publish failed — see Problems.'
            this.reportProjectProblem(op, 'publish', result.message)
            this.Provider.get(ProblemsService.Key)?.Expand()
        } catch (e) {
            this.Status = 'Publish failed — see Problems.'
            this.reportProjectProblem(op, 'publish', `Publish failed: ${(e as Error).message}`)
            this.Provider.get(ProblemsService.Key)?.Expand()
        }
    }

    // (Re)generate the project's presentation dictionary through its factory in the
    // chosen icon mode (colorful / monochrome), then rescan so the generated file
    // appears in the tree. Menu items are disabled for factories that don't support
    // it, but guard anyway.
    private async generatePresentation(op: OpenProject, colored: boolean): Promise<void>
    {
        if (!canGeneratePresentation(op.Factory)) { this.Status = 'This project type has no presentation.'; return }
        try {
            await op.Factory.regeneratePresentation(op.Storage, colored)
            await this.rescan(op)
            this.Status = `Presentation regenerated (${colored ? 'colorful' : 'monochrome'}).`
            this.reportProjectProblem(op, 'presentation', undefined)   // clear any prior failure
        } catch (e) {
            const message = `Generate presentation failed: ${(e as Error).message}`
            this.Status = message
            this.reportProjectProblem(op, 'presentation', message)
            this.Provider.get(ProblemsService.Key)?.Expand()
        }
    }

    // Publish (or clear, when `message` is undefined) a single project-level
    // diagnostic for one owner into the Problems store, so an operation error like
    // a blocked publish or a failed presentation shows in the dock, not only in the
    // status strip. The atomic-slice store replaces this owner's slice each call.
    private reportProjectProblem(op: OpenProject, owner: string, message: string | undefined): void
    {
        const diagnostics = this.Provider.get(DiagnosticsService.Key)
        if (diagnostics === undefined) return
        const projectId = op.Project.RootPath
        if (message === undefined) { diagnostics.Publish(owner, projectId, []); return }
        diagnostics.Publish(owner, projectId, [{
            owner, projectId, projectName: op.Project.Name, uri: null,
            message, severity: DiagnosticSeverity.Error, span: null,
        }])
    }

    // Refresh a project's bases: drop the validator's cached bases for this
    // project's storage and revalidate, so a meta-model/library republished since
    // the project opened is picked up (its live squiggles re-resolve).
    private refreshBases(op: OpenProject): void
    {
        void this.Provider.get(TodlLanguageClient.Key)?.RefreshBases(op.Storage)
        this.Status = `Refreshed bases for ${op.Name}.`
    }

    // Open the References manager for a consumer project (architecture / library):
    // show its current base bindings against the catalog of everything it could
    // reference — published packages plus open workspace producers — then persist
    // the edited set to the manifest and refresh its bases so added terms resolve
    // and removed ones drop. A workspace producer can be referenced before it is
    // published (resolution prefers the open project).
    private async manageReferences(op: OpenProject): Promise<void>
    {
        const manifest = JSON.parse(await op.Storage.ReadText(PROJECT_MANIFEST_FILENAME)) as {
            metaModel?: BaseRef; libraries?: BaseRef[]; [k: string]: unknown
        }
        const resolver = this.Provider.get(WorkspaceBaseResolver.Key)
        const offersLibraries = op.Factory.offersLibraries === true

        const availableMetaModels = [
            ...await this.publishedMetaModels(),
            ...(resolver !== undefined ? await resolver.WorkspaceProducers(ProducerKind.MetaModel) : []),
        ]
        const availableLibraries = offersLibraries
            ? [
                ...await this.publishedLibraries(),
                ...(resolver !== undefined ? await resolver.WorkspaceProducers(ProducerKind.Library) : []),
            ]
            : []

        const current: BaseBindings = { metaModel: manifest.metaModel, libraries: manifest.libraries }
        const vm = new ManageReferencesDialogModel(
            current, availableMetaModels, availableLibraries, offersLibraries, (r) => this.dialogs.Close(r))
        const result = await this.dialogs.Show<BaseBindings>({ Title: 'Manage References', Content: vm, Width: 480 })
        if (result === undefined) return

        // Apply the edited bindings, preserving every other manifest field.
        manifest.metaModel = result.metaModel
        if (offersLibraries) manifest.libraries = [...(result.libraries ?? [])]
        await op.Storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        await this.Provider.get(TodlLanguageClient.Key)?.RefreshBases(op.Storage)
        this.Status = `Updated references for ${op.Name}.`
    }

    // Re-scan the named open projects from disk and re-validate their models —
    // the agent's refresh_project path. Rescans + drops each project's cached
    // bases, then revalidates once (Revalidate covers all open projects). Unknown
    // folders are skipped. Awaitable so the caller knows validation has settled.
    public async RefreshProjects(folders: readonly string[]): Promise<void>
    {
        const client = this.Provider.get(TodlLanguageClient.Key)
        const resolver = this.Provider.get(WorkspaceBaseResolver.Key)
        const producerIds: string[] = []
        for (const folder of folders)
        {
            const op = this.findByFolder(folder)
            if (op === undefined) continue
            await this.rescan(op)   // also resyncs the server's document set
            await client?.RefreshBases(op.Storage)
            // Signal A: if the refreshed project is a producer, its dependents
            // consume its (now-changed) live source and must revalidate too.
            const id = resolver?.producedIdOf(op.Storage)
            if (id !== undefined) producerIds.push(id)
        }
        if (resolver !== undefined && producerIds.length > 0)
            await resolver.RefreshDependentsOfIds(producerIds)
    }

    // Close a project: close its open tabs, drop it from the tree, and forget it
    // from the persisted open set.
    private async closeProject(op: OpenProject): Promise<void>
    {
        // Close each owned tab through the guard so a dirty document prompts
        // Save / Don't Save / Cancel; Cancel aborts the whole project close (the
        // guard performs the actual Close on Save/Don't-Save, so we only forget
        // the doc's tracking afterwards).
        const guard = this.Provider.get(DocumentCloseGuard.Key)
        for (const [doc, owner] of [...this.docOwners]) {
            if (owner !== op) continue
            if (guard !== undefined) {
                if (!(await guard.TryCloseDocument(doc))) return   // cancelled — leave the project open
            } else {
                this.host.Close(doc)
            }
            this.docOwners.delete(doc); this.docPaths.delete(doc)
        }
        // Unregister from the language client and drop this project's diagnostics.
        this.Provider.get(TodlLanguageClient.Key)?.DetachProject(op.Storage)
        this.OpenProjects.Remove(op)
        await this.openStore.Remove(op.Folder)
        this.Status = `Closed ${op.Name}.`
    }

    // Activate a tree node: open a file whose extension a registered editor
    // handles in a tab (any project may contain any such file — editors own
    // files, not projects), or open it in the OS default app when the backend
    // supports local access and no editor claims the extension.
    private async openNode(node: ProjectNode, op: OpenProject): Promise<void>
    {
        if (node.Kind === 'folder') return
        const factory = this.resolveDocumentFactory(extname(node.Path))
        try {
            if (factory !== undefined) {
                await this.openDocument(op, node.Path, factory)
                this.Status = `Opened ${node.Name}.`
            } else if (isLocalFileAccess(op.Storage)) {
                await op.Storage.OpenExternal(node.Path)
            } else {
                this.Status = `Can't open ${node.Name} — no editor for its type.`
            }
        } catch (e) {
            this.Status = `Open failed: ${(e as Error).message}`
        }
    }

    // Open a project file as a document tab (through the resolved editor) and
    // record its owning project. Returns the opened document. If the file is
    // already open for this project, re-activates that tab instead of opening a
    // duplicate — the single dedupe point every open path funnels through.
    private async openDocument(op: OpenProject, path: string, factory: IDocumentFactory): Promise<IDocument>
    {
        const existing = this.findOpenDoc(op, path)
        if (existing !== undefined) { this.host.Open(existing); return existing }
        const doc = await factory.openFile(op.Storage, path)
        this.docOwners.set(doc, op)
        this.docPaths.set(doc, path)
        this.host.Open(doc)
        return doc
    }

    // Navigate to a diagnostic: open (or re-activate) `uri` in the project with the
    // given RootPath and scroll to (line, column). Used by the Problems dock. A
    // no-op when the project isn't open or no editor claims the file's extension.
    public async OpenFileInProject(projectId: string, uri: string, line: number, column: number): Promise<void>
    {
        const op = this.findByFolder(projectId)
        if (op === undefined) return
        const factory = this.resolveDocumentFactory(extname(uri))
        if (factory === undefined) return
        // openDocument re-activates an already-open tab (no duplicate).
        const doc = await this.openDocument(op, uri, factory)
        if (isRevealable(doc)) doc.RequestReveal(line, column)
    }

    // Open (or re-activate) a project file and return its document — the generic
    // "get me the live document for this path" entry point a node-command
    // contributor uses before acting on it. Undefined when no editor claims the
    // extension.
    public async OpenPath(op: OpenProject, path: string): Promise<IDocument | undefined>
    {
        const factory = this.resolveDocumentFactory(extname(path))
        if (factory === undefined) return undefined
        // openDocument re-activates an already-open tab (no duplicate).
        return this.openDocument(op, path, factory)
    }

    // The already-open document for (project, project-relative path), if any.
    private findOpenDoc(op: OpenProject, path: string): IDocument | undefined
    {
        for (const [doc, p] of this.docPaths) {
            if (p === path && this.docOwners.get(doc) === op) return doc
        }
        return undefined
    }

    // One selectable choice per registered project-type factory (Title +
    // Description straight from the ProjectFactoryDefinition). RequiresMetaModel
    // is read from the resolved factory so the dialog knows to show the picker.
    private typeChoices(): ProjectTypeChoice[]
    {
        return this.Provider.getRequired(ProjectFactoryRegistry.Key)
            .Definitions.ToArray()
            .map((d) => {
                const factory = this.resolveFactory(d.Type)
                return new ProjectTypeChoice(
                    d.Type, d.Title, d.Description,
                    factory?.requiresMetaModel ?? false,
                    factory?.offersLibraries ?? false)
            })
    }

    // Enumerate every published meta-model in the backend as a BaseRef
    // (`<id>/<version>/`), offered by the New-Project meta-model picker.
    private async publishedMetaModels(): Promise<BaseRef[]>
    {
        const backend = ensureMetaModelsBackend(this.Provider)
        const refs: BaseRef[] = []
        for (const id of await backend.List('')) {
            if (!id.IsDirectory) continue
            for (const version of await backend.List(id.Name)) {
                if (version.IsDirectory) refs.push({ id: id.Name, version: version.Name })
            }
        }
        return refs
    }

    // Enumerate every published library in the backend as a BaseRef
    // (`<id>/<version>/`), offered by the New-Project libraries multi-select.
    private async publishedLibraries(): Promise<BaseRef[]>
    {
        const backend = ensureLibrariesBackend(this.Provider)
        const refs: BaseRef[] = []
        for (const id of await backend.List('')) {
            if (!id.IsDirectory) continue
            for (const version of await backend.List(id.Name)) {
                if (version.IsDirectory) refs.push({ id: id.Name, version: version.Name })
            }
        }
        return refs
    }

    // New Project validation: refuse a folder that already holds a project.
    private async validateNewProject(result: NewProjectResult): Promise<string | null>
    {
        // Validate the SUBFOLDER we'll create in (location/name), not the chosen
        // parent location — a project lives in its own named subfolder.
        const folder = joinPath(result.location, result.name.trim())
        const storage = this.storageRegistry.Create(StorageProviderRegistry.DefaultBackendId, folder)
        if (await storage.Exists(PROJECT_MANIFEST_FILENAME)) return 'That folder already contains a project.'
        return null
    }

    private resolveFactory(type: string): IProjectFactory | undefined
    {
        const def = this.Provider.getRequired(ProjectFactoryRegistry.Key).GetByType(type)
        if (def?.Factory === undefined) return undefined
        // `Factory` holds the service class (from `Factory = DiagramProjectFactory`
        // in the .projectFactories block), but the module registers it under its
        // static `.Key` (tokenFor). Normalize class → .Key so the lookup matches.
        const token = ServiceProvider.tokenFor(def.Factory as unknown as new (...args: never[]) => IProjectFactory)
        return this.Provider.get(token) as IProjectFactory | undefined
    }

    // Resolve the editor for a file extension via the framework DocumentTypeRegistry.
    // A module contributes a DocumentDefinition whose `Factory` token resolves to an
    // IDocumentFactory (see DiagramDocumentFactory / TodlDocumentFactory). Mirrors
    // resolveFactory's class→token normalization. Unknown extension → undefined.
    private resolveDocumentFactory(ext: string): IDocumentFactory | undefined
    {
        const registry = this.Provider.get(DocumentTypeRegistry.Key)
        const def = registry?.GetByExtension(ext)
        if (def?.Factory === undefined) return undefined
        const token = ServiceProvider.tokenFor(def.Factory as unknown as new (...args: never[]) => IDocumentFactory)
        return this.Provider.get(token) as IDocumentFactory | undefined
    }

    private findByFolder(folder: string): OpenProject | undefined
    {
        return this.OpenProjects.ToArray().find((o) => o.Folder === folder)
    }

    // Give every node in a project's tree an OpenCommand closing over it + its
    // owning project, so a row binds `Command = $OpenCommand` and routes file-open
    // through the right factory/storage (folders get a no-op activation).
    private wireNodes(node: ProjectNode, op: OpenProject): void
    {
        node.OpenCommand = new RelayCommand(() => void this.openNode(node, op))
        // The folder a node's context-menu creations land in: a folder node
        // creates inside itself; a file node creates beside itself (VSCode-style).
        const container = node.Kind === 'folder' ? node.Path : parentOf(node.Path)
        node.NewItemChoices = this.newItemChoices(op, container)
        node.NewFolderCommand = new RelayCommand(() => void this.newFolderIn(op, container))
        node.ImportFileCommand = new RelayCommand(() => void this.importFilesInto(op, container))
        node.ImportFolderCommand = new RelayCommand(() => void this.importFolderInto(op, container))
        // The root node isn't shown as a row, so it never renames; every other
        // node's context-menu "Rename" opens its in-place editor.
        node.BeginRenameCommand = new RelayCommand(() => this.beginRename(op, node), () => node.Path !== '')
        node.DeleteCommand = new RelayCommand(() => void this.deleteFromNode(op, node), () => node.Path !== '')
        // Optional module-contributed action (e.g. the arch "Edit Viewpoints…" on a
        // .diagram node), surfaced on the node's context menu when present.
        const action = this.Provider.get(NodeCommandContributorKey)?.contribute(op, node)
        if (action !== undefined) {
            node.NodeActionLabel = action.label
            node.NodeActionCommand = action.command
            node.HasNodeAction = true
        }
        // Diagram export — a .diagram file can be exported straight from the tree
        // (SVG / PPTX) without being opened, when the diagram-export module is
        // loaded. The commands render the file headlessly then save via the shared
        // export pipeline; HasExport gates the context-menu submenu.
        if (node.Kind === 'diagram'
            && this.Provider.get(DiagramHeadlessRenderer.Key) !== undefined
            && this.Provider.get(DiagramExportService.Key) !== undefined) {
            node.ExportSvgCommand  = new RelayCommand(() => void this.exportNode(node, op, ExportFormat.Svg))
            node.ExportPptxCommand = new RelayCommand(() => void this.exportNode(node, op, ExportFormat.Pptx))
            node.HasExport = true
        }
        for (const child of node.Children.ToArray()) this.wireNodes(child, op)
    }

    // Render a .diagram node HEADLESSLY (no editor open) and save it in the chosen
    // format through the export service's shared save pipeline. Render returning
    // undefined (empty / unrenderable diagram) or a thrown error surfaces on the
    // status strip rather than silently failing.
    private async exportNode(node: ProjectNode, op: OpenProject, format: ExportFormat): Promise<void>
    {
        const renderer = this.Provider.get(DiagramHeadlessRenderer.Key)
        const exporter = this.Provider.get(DiagramExportService.Key)
        if (renderer === undefined || exporter === undefined) return
        try {
            const rendered = await renderer.renderFile(op, node.Path)
            if (rendered === undefined) { this.Status = `Nothing to export in ${node.Name}.`; return }
            const dot = node.Name.lastIndexOf('.')
            await exporter.exportRendered(format, rendered, dot > 0 ? node.Name.slice(0, dot) : node.Name)
        } catch (e) {
            this.Status = `Export failed: ${(e as Error).message}`
        }
    }
}

// A document that can scroll to + select a span (the CodeDocument does). Duck-
// typed so the explorer stays decoupled from the code-editor module.
function isRevealable(doc: unknown): doc is { RequestReveal(line: number, column: number): void }
{
    return typeof (doc as Partial<{ RequestReveal: unknown }>).RequestReveal === 'function'
}

// Sibling order in the tree: folders before files, then case-insensitive by
// name with a case-sensitive tiebreak — mirrors compareStorageEntries so an
// in-place re-sort lands each node where a full rescan would have put it.
function compareNodes(a: ProjectNode, b: ProjectNode): number
{
    const aDir = a.Kind === 'folder', bDir = b.Kind === 'folder'
    if (aDir !== bDir) return aDir ? -1 : 1
    const ci = a.Name.toLowerCase().localeCompare(b.Name.toLowerCase())
    return ci !== 0 ? ci : a.Name.localeCompare(b.Name)
}

// ── project-relative path helpers (POSIX `/`; the storage backend translates) ──
function joinRel(dir: string, name: string): string
{
    return dir === '' ? name : dir + '/' + name
}

// Join an ABSOLUTE OS location with a subfolder name using the location's own
// separator (the renderer has no node:path). Used to place a new project in its
// own named subfolder under the chosen location.
function joinPath(dir: string, name: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    return dir.endsWith(sep) ? dir + name : dir + sep + name
}

function parentOf(path: string): string
{
    const slash = path.lastIndexOf('/')
    return slash === -1 ? '' : path.slice(0, slash)
}

function basename(p: string): string
{
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
}

// The lowercased extension (with leading dot) of a path, e.g. ".todl"; '' when
// there's none or the name is a dotfile. Used to resolve a file's editor.
function extname(p: string): string
{
    const i = p.lastIndexOf('.')
    return i > 0 ? p.slice(i).toLowerCase() : ''
}

// The subset of `nodes` that isn't nested under another node in the same set —
// so a folder + a file inside it deletes only the folder (which takes the file
// with it), never the already-gone child. Order is preserved.
function topLevelNodes(nodes: readonly ProjectNode[]): ProjectNode[]
{
    return nodes.filter((n) => !nodes.some((other) => other !== n && n.Path.startsWith(other.Path + '/')))
}

// The confirmation prompt for a delete, phrased to the selection: a single file,
// a single folder (contents included), or an N-item batch. Always warns it's
// permanent — deletion has no undo (consistent with rename).
function deleteMessage(nodes: readonly ProjectNode[]): string
{
    if (nodes.length === 1) {
        const node = nodes[0]!
        return node.Kind === 'folder'
            ? `Delete folder "${node.Name}" and its contents? This can't be undone.`
            : `Delete "${node.Name}"? This can't be undone.`
    }
    return `Delete these ${nodes.length} items? This can't be undone.`
}

// A project-relative name for `fileName` that doesn't collide with an existing
// entry: returns it as-is when free, else the first free `stem-N.ext` (N ≥ 2),
// mirroring an OS "copy" rename. The extension (leading dot only — dotfiles like
// `.gitignore` keep their whole name) is preserved on the suffix.
export async function uniqueStorageName(storage: IStorage, fileName: string): Promise<string>
{
    if (!(await storage.Exists(fileName))) return fileName
    const dot = fileName.lastIndexOf('.')
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName
    const ext = dot > 0 ? fileName.slice(dot) : ''
    for (let n = 2; ; n++) {
        const candidate = `${stem}-${n}${ext}`
        if (!(await storage.Exists(candidate))) return candidate
    }
}

// The command argument for OpenProject.MoveNodesCommand — the dragged nodes, the
// destination folder path (project-relative; '' = root), and the SOURCE project
// the nodes came from (equal to the target for a same-project move). Exported so
// the drag behavior can construct it.
export interface MoveArg { nodes: readonly ProjectNode[]; destPath: string; source: OpenProject }

// The open-dialog filters for importing into a project: one entry per factory
// format (so its files surface first) plus an All-files catch-all — a guide,
// not a restriction. Extensions carry no leading dot (the dialog's convention).
export function importFilters(formats: readonly ProjectFileFormat[]): FileFilter[]
{
    const known = formats.map((f) => ({ Name: f.displayName, Extensions: [f.extension.replace(/^\./, '')] }))
    return [...known, { Name: 'All files', Extensions: ['*'] }]
}
