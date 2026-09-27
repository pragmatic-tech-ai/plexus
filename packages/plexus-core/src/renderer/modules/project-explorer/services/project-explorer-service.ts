// project-explorer-service.ts — the GENERIC project host for the left panel.
//
// It owns the set of OPEN projects + orchestrates open/create/close/save, but
// knows nothing about diagrams or file formats: it reads a folder's manifest
// envelope (project.plexus → `type`), routes to the matching factory via the
// engine's IProjectFactoryRegistry (ProjectFactoryRegistryKey), and delegates. A
// module contributes a project type by registering a self-describing
// IProjectFactory (typeId/title/description) that the registry enumerates.
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
    type DocumentsContentHostService,
    type IDocument,
} from '@pragmatic-tech-ai/mural/framework'

import { FileSystemService } from '../../storage/index.js'
import {
    PROJECT_MANIFEST_FILENAME,
    ProducerKind,
    isVersioned,
    ProjectFactoryRegistryKey,
    type IProjectFactory,
    type ProjectFileFormat,
} from '../../../projects/project-factory.js'
import { isRelocatable, isRelocatableAcrossStorage, type IDocumentFactory } from '../../../documents/document-factory.js'
import { NewFileParticipantKey } from '../../../documents/new-file-participant.js'
import { NodeCommandContributorKey } from '../../../documents/node-command-contributor.js'
import {
    ProjectMenuChoice,
    type MoveArg,
    type IProjectTreeHost,
    PublishedBasesKey,
    LiveValidationKey,
    BaseResolverKey,
    DiagramTreeExportKey,
    DiagramExportFormat,
    ProjectMenuSourceKey,
    ProblemsDockKey,
} from '../../../projects/index.js'
import { copyTree } from '@pragmatic-tech-ai/todl-runtime'
import type { FileFilter } from '../../../../shared/file-system-api.js'
import { ProjectNode } from '../../../projects/project.js'
import type { Project } from '../../../projects/project.js'
import { OpenProject } from '../../../projects/open-project.js'
import { VersionPart, bumpVersion } from '../../../projects/semver-bump.js'
import { SetVersionDialogModel, type SetVersionResult } from '../../../projects/set-version-dialog-model.js'
import { NewItemChoice } from '../../../projects/new-item-choice.js'
import { OpenProjectsStore } from '../../../projects/open-projects-store.js'
import {
    NewProjectDialogModel,
    ProjectTypeChoice,
    type NewProjectResult,
} from '../../../projects/new-project-dialog-model.js'
import {
    OpenProjectDialogModel,
    type OpenProjectResult,
} from '../../../projects/open-project-dialog-model.js'
import type { BaseBindings, BaseRef } from '../../../projects/base-binding.js'
import type { ReferenceNode } from '../../../projects/reference-node.js'
import { DiagnosticsService } from '../../../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../../diagnostics/diagnostic.js'
import { planNodeMoves } from '../../../projects/node-move.js'
import { ConfirmDialogModel } from '../../../dialogs/confirm-dialog-model.js'
import { DocumentCloseGuard } from '../../../documents/document-close-guard.js'
import { ManageReferencesDialogModel } from '../../../projects/manage-references-dialog-model.js'
import { RecentProjectsService } from '../../../projects/recent-projects-service.js'
import { PackagePublisher } from '../../../projects/package-publisher.js'
import { EnvironmentService } from '../../../environment/environment-service.js'
import { samePath } from '../../../file-watch/path-utils.js'
import { StorageService } from '../../storage/index.js'
import { isLocalFileAccess, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { Disposable, CollectionChange } from '@pragmatic-tech-ai/todl-runtime'
import type { CreateProjectPrefill, CreateProjectResult } from './project-create-contract.js'
import { ProjectEventKind, ProjectEventsKey, SolutionManagerService } from '@pragmatic-tech-ai/todl'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import type { ProjectManifest } from '@pragmatic-tech-ai/todl/package-manager'
import { MemberProjection } from './member-projection.js'

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
    // Carry the base bindings the prefill proposes into the References tree, matched
    // by id@version against the offered leaves (the type is already selected, so the
    // tree is populated). Unknown refs are ignored — the user still finalizes the
    // form. Without this the tree resets to unchecked even when the agent named a
    // meta-model/library, silently dropping the binding.
    if (prefill.metaModels !== undefined) checkLeaves(form.MetaModelNodes, prefill.metaModels)
    if (prefill.libraries !== undefined) checkLeaves(form.LibraryNodes, prefill.libraries)
}

// Check every tree leaf whose Ref matches one of `wanted` (by id@version).
function checkLeaves(leaves: readonly ReferenceNode[], wanted: readonly BaseRef[]): void
{
    const keys = new Set(wanted.map((r) => `${r.id}@${r.version}`))
    for (const leaf of leaves)
        if (leaf.Ref !== undefined && keys.has(`${leaf.Ref.id}@${leaf.Ref.version}`)) leaf.IsSelected = true
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

export class ProjectExplorerService extends ServiceBase implements IProjectTreeHost
{
    public static readonly Key = new ServiceKey<ProjectExplorerService>('ProjectExplorerService')

    // Status prefix when a lifecycle event's subscribers (the project generators) fail.
    private static readonly LifecycleFailedPrefix = 'Project generators failed: '

    // Publish command strings + the Problems-dock owner key for a publish failure.
    private static readonly NotPublishableStatus = "This project type can't be published."
    private static readonly PublishedPrefix = 'Published '
    private static readonly PublishFailedStatus = 'Publish failed — see Problems.'
    private static readonly PublishFailedPrefix = 'Publish failed: '
    private static readonly PublishOwner = 'publish'

    // The INPC property names this service observes on its solution collaborators
    // (ActiveSolution on the manager, Project on a member) — hoisted so the
    // watched name and the watcher can't drift, mirroring
    // SolutionBaseResolver's own local copy of the same well-known names.
    private static readonly ActiveSolutionPropertyName = 'ActiveSolution'
    private static readonly MemberProjectPropertyName = 'Project'

    // The open projects — the tree's roots (each a collapsible DataTemplate
    // [OpenProject]). Empty until a project is opened or the session restores.
    private readonly _openProjects = new ObservableCollection<OpenProject>()
    private _status = 'No project open.'
    private _openProjectCommand!: ICommand
    private _newProjectCommand!: ICommand
    // Keyboard handler for the single project TreeView (bound `on KeyDown` from
    // the tree's wrapper). The whole tree is now ONE TreeView with unified
    // selection, so the key routes to whichever project currently holds the
    // selection (F2 rename / Delete / Enter-commit / Escape-cancel).
    private _treeKeyCommand!: ICommand

    // Which open project each open document belongs to — for save-routing (the
    // active doc saves through its own factory) and close-cleanup.
    private readonly docOwners = new Map<IDocument, OpenProject>()
    // Each open document's project-relative path — so an in-place rename can
    // re-point the tab (via the factory's relocateOpenFile) instead of leaving
    // it stale.
    private readonly docPaths = new Map<IDocument, string>()

    // OpenProjects is a PROJECTION of the active solution's Members — see the
    // "── Solution member sync ──" section below, which is the sole mutator of
    // OpenProjects. Builds a member into an OpenProject (Task 3).
    private readonly memberProjection: MemberProjection
    // The live OpenProject for each currently-projected member.
    private readonly projected = new Map<SolutionMember, OpenProject>()
    // A member observed still unresolved (SolutionManagerService.OpenProject
    // appends to Members synchronously, then resolves the member's Project/
    // Storage afterwards — see todl's Solution.AddMember/OpenOne) — the pending
    // wait for its own Project to settle, plus the means to unblock it early if
    // the member is removed before it ever resolves.
    private readonly pendingResolution = new Map<SolutionMember, { subscription: Disposable; resolve: () => void }>()
    // The in-flight (or settled) sync task for each member last observed added or
    // removed — awaited by closeProject (after the manager confirms the removal)
    // and by callers that need the projection's side effects (OpenProjects /
    // openStore) to have actually landed, since the collection-change listener
    // itself is synchronous and can't be awaited directly.
    private readonly memberSyncTasks = new Map<SolutionMember, Promise<void>>()
    private membersUnsubscribe: (() => void) | undefined

    // The open reloadable document whose resolved OS path matches `absPath`, if
    // any — for the file-watch editor-reload consumer. Matches a watcher-reported
    // absolute path against each open project document's ResolveOsPath, narrowing
    // to a reloadable buffer (only code buffers can be reloaded from disk). Duck-
    // typed via isReloadable so the explorer stays off the code-editor module.
    public FindOpenCodeDocByOsPath(absPath: string): ReloadableDocument | undefined
    {
        const ci = this.Provider.getRequired(EnvironmentService.Key).IsWindows
        for (const [doc, rel] of this.docPaths)
        {
            if (!isReloadable(doc)) continue
            const storage = this.docOwners.get(doc)?.Storage
            if (storage === undefined || !isLocalFileAccess(storage)) continue
            if (samePath(storage.ResolveOsPath(rel), absPath, ci)) return doc
        }
        return undefined
    }

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this._openProjectCommand = new RelayCommand(() => void this.openProject())
        this._newProjectCommand = new RelayCommand(() => void this.newProject())
        this._treeKeyCommand = new RelayCommand((arg) => this.handleTreeKeyGlobal(arg as KeyEventArgs))
        this.memberProjection = new MemberProjection(provider)
        this.subscribeToManager()
    }

    public get OpenProjects(): ObservableCollection<OpenProject> { return this._openProjects }
    public get Status(): string { return this._status }
    public get OpenProjectCommand(): ICommand { return this._openProjectCommand }
    public get NewProjectCommand(): ICommand { return this._newProjectCommand }
    public get TreeKeyCommand(): ICommand { return this._treeKeyCommand }

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

    private set Status(v: string) { const old = this._status; this._status = v; this.RaisePropertyChanged('Status', old, v) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get storageRegistry(): StorageService { return this.Provider.getRequired(StorageService.Key) }
    private get dialogs(): DialogService { return this.Provider.getRequired(DialogService.Key) }
    private get recents(): RecentProjectsService { return this.Provider.getRequired(RecentProjectsService.Key) }
    private get openStore(): OpenProjectsStore { return this.Provider.getRequired(OpenProjectsStore.Key) }
    private get manager(): SolutionManagerService { return this.Provider.getRequired(SolutionManagerService.Key) }
    private get host(): DocumentsContentHostService
    {
        return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
    }

    // ── Solution member sync ────────────────────────────────────────────────
    // OpenProjects is a PROJECTION of the active solution's Members; the methods
    // below are the SOLE mutator of it. Every open/create/close/restore path only
    // ever asks the manager to change Members — the actual OpenProjects.Add/
    // Remove happens here, in reaction to the collection's own change events, so
    // there is exactly one place that can put an entry in the tree.

    // Subscribe to the manager's CURRENT Members, projecting whatever is already
    // there; re-subscribe whenever ActiveSolution itself changes (mirrors
    // SolutionBaseResolver.rewireMembers).
    private subscribeToManager(): void
    {
        const manager = this.manager
        manager.PropertyChanged(ProjectExplorerService.ActiveSolutionPropertyName)
            .subscribe(() => this.rewireMembers(manager))
        this.rewireMembers(manager)
    }

    private rewireMembers(manager: SolutionManagerService): void
    {
        this.membersUnsubscribe?.()
        this.membersUnsubscribe = undefined
        const members = manager.ActiveSolution?.Members
        if (members === undefined) return
        for (const member of members.ToArray())
            this.memberSyncTasks.set(member, this.onMemberAdded(member))
        this.membersUnsubscribe = members.Subscribe((change) => this.onMembersChanged(change))
    }

    private onMembersChanged(change: CollectionChange<SolutionMember>): void
    {
        switch (change.kind)
        {
            case 'inserted':
                for (const member of change.items) this.memberSyncTasks.set(member, this.onMemberAdded(member))
                return
            case 'removed':
                for (const member of change.items) this.trackRemoval(member)
                return
            default:
                return
        }
    }

    // Run onMemberRemoved for `member`, track it under memberSyncTasks like any
    // other in-flight sync task, and forget the entry once it settles — a member
    // that's gone for good has nothing left worth awaiting, and a long-lived
    // explorer must not accumulate one dead entry per member ever opened-and-
    // closed. This can't be done by having onMemberRemoved delete its OWN entry
    // (as an earlier version did): for a member that was never actually
    // projected (see onMemberRemoved), the whole function runs synchronously to
    // completion with no `await` to cross, so a self-delete would run BEFORE the
    // `.set()` two lines below even executes — deleting nothing, then leaking the
    // entry forever once `.set()` finally lands. `.then()` callbacks are always
    // scheduled asynchronously, even for an already-settled promise, so doing the
    // cleanup here instead can never race the `.set()` call it follows. The
    // identity check guards against pruning a NEWER task for the same member out
    // from under it.
    private trackRemoval(member: SolutionMember): void
    {
        const task = this.onMemberRemoved(member)
        this.memberSyncTasks.set(member, task)
        void task.then(() => {
            if (this.memberSyncTasks.get(member) === task) this.memberSyncTasks.delete(member)
        })
    }

    // Project a member added to Members. A member the manager hasn't finished
    // resolving yet (Project/Storage still undefined — SolutionManagerService
    // appends to Members before it awaits the open) waits for its own Project to
    // settle first. Settling can land either way: resolved → build it; still
    // unresolved (no factory registered for its type) → there is nothing to
    // project and no way this member will ever open, so it is dropped rather than
    // left stranded in Members with no live subscription. A member removed while
    // still waiting (see onMemberRemoved) unblocks this early with IsResolved
    // left false, landing on the same drop path.
    private async onMemberAdded(member: SolutionMember): Promise<void>
    {
        if (this.findByFolder(this.memberProjection.FolderOf(member)) !== undefined) return
        if (!member.IsResolved) await this.waitForResolution(member)
        if (member.IsResolved) { await this.projectMember(member); return }
        this.dropUnresolvedMember(member)
    }

    // Wait for `member`'s OWN resolution to settle. SolutionManagerService's
    // Solution.OpenOne sets Project exactly once — to a resolved Project, or
    // explicitly to `undefined` when no factory is registered for the member's
    // type (still raising PropertyChanged even though the value didn't change) —
    // so the FIRST 'Project' change this member raises after subscribing always
    // means "settled", resolved or not. The handler must therefore resolve
    // unconditionally here: bailing out on `!member.IsResolved` (as an earlier
    // version did) leaves the promise pending forever for the no-factory case,
    // hanging every caller awaiting it and leaking the subscription.
    private waitForResolution(member: SolutionMember): Promise<void>
    {
        return new Promise<void>((resolve) => {
            const subscription = member.PropertyChanged(ProjectExplorerService.MemberProjectPropertyName).subscribe(() => {
                this.pendingResolution.delete(member)
                subscription.dispose()
                resolve()
            })
            this.pendingResolution.set(member, { subscription, resolve })
        })
    }

    // A member that settled without ever resolving (no registered factory for its
    // type) has nothing to project and no way to ever open. Remove it from
    // Members rather than leaving a permanently-broken entry behind — the
    // removal fires onMemberRemoved, which is a no-op beyond forgetting this
    // member's own sync-task bookkeeping (nothing was ever projected for it).
    private dropUnresolvedMember(member: SolutionMember): void
    {
        this.manager.ActiveSolution?.Members.Remove(member)
    }

    private async projectMember(member: SolutionMember): Promise<void>
    {
        // Re-check: another member may have resolved to the same folder while
        // this one was waiting (Review Focus #3 — dedupe by folder).
        if (this.findByFolder(this.memberProjection.FolderOf(member)) !== undefined) return
        const op = this.memberProjection.Build(member)
        this.wireProjectCommands(op)
        this.wireNodes(op.Root, op)
        this.OpenProjects.Add(op)
        this.projected.set(member, op)
        // Register the project for whole-project live validation (populates the
        // Problems dock even before any file is opened).
        void this.Provider.get(LiveValidationKey)?.AttachProject(op.Project.RootPath, op.Project.Name, op.Storage)
        await this.openStore.Add(op.Folder)
    }

    // The removal counterpart: a member removed before it ever resolved just has
    // its pending wait cancelled (nothing was projected); one already projected
    // has its tabs untracked (the actual Close already ran — see closeProject),
    // is detached from live validation, and drops out of the tree + persisted
    // open set. The memberSyncTasks entry itself is pruned by trackRemoval, the
    // caller — not here (see its comment for why).
    private async onMemberRemoved(member: SolutionMember): Promise<void>
    {
        const pending = this.pendingResolution.get(member)
        if (pending !== undefined)
        {
            this.pendingResolution.delete(member)
            pending.subscription.dispose()
            pending.resolve()
        }

        const op = this.projected.get(member)
        if (op !== undefined)
        {
            for (const [doc, owner] of [...this.docOwners])
            {
                if (owner !== op) continue
                this.docOwners.delete(doc)
                this.docPaths.delete(doc)
            }
            this.Provider.get(LiveValidationKey)?.DetachProject(op.Storage)
            this.OpenProjects.Remove(op)
            this.projected.delete(member)
            await this.openStore.Remove(op.Folder)
            this.Status = `Closed ${op.Name}.`
        }
    }

    // The solution member currently projected as `op` — the reverse lookup of
    // `projected`, needed to hand the manager the member identity it removes.
    private memberFor(op: OpenProject): SolutionMember | undefined
    {
        for (const [member, projectedOp] of this.projected)
            if (projectedOp === op) return member
        return undefined
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
        try
        {
            await this.storageRegistry.Create(StorageService.DefaultBackendId, data.location).CreateDirectory(name)
        }
        catch (e)
        {
            return { created: false, error: `Could not create the project folder: ${(e as Error).message}` }
        }
        const op = await this.createProjectAt(data.type, name, folder, data.metaModels, data.libraries)
        if (op === undefined) return { created: false, error: this.Status }
        return { created: true, folder: op.Folder, name: op.Name, type: data.type }
    }

    // Open Project: hand the folder to the solution manager (which reads its
    // manifest, resolves storage + factory, and mints/opens the member) and let
    // the member-sync loop project the result into the tree. A no-op (with a
    // status) if the folder is already open — dedupe is guarded up front so a
    // folder already projected never asks the manager again.
    private async openProjectAt(folder: string): Promise<void>
    {
        const already = this.findByFolder(folder)
        if (already !== undefined) { this.Status = `${already.Name} is already open.`; return }

        try
        {
            const member = await this.manager.OpenProject(folder)
            // member.IsResolved is already the FINAL truth here — SolutionManagerService
            // awaits the whole open (Solution.OpenOne sets Project exactly once, resolved
            // or not) before returning the member — so a no-factory outcome is reported
            // right away. Waiting on memberSyncTasks first would be wrong: for an
            // unresolved member, that task's tail runs onMemberAdded's drop-and-forget
            // cleanup (dropUnresolvedMember), not a projection — nothing to wait for here,
            // and awaiting it anyway previously hung forever (waitForResolution never
            // used to settle for a no-factory member — now fixed, but this order is also
            // just the correct one regardless).
            if (!member.IsResolved)
            {
                this.Status = `No factory for project type "${member.Ref.type}".`
                return
            }
            // Let the sync loop's projection (OpenProjects.Add, openStore.Add)
            // actually land before reporting success — the collection-change
            // listener that runs it is synchronous and can't be awaited directly.
            await this.memberSyncTasks.get(member)
            const name = (member.Project as Project | undefined)?.Name ?? member.Ref.path
            await this.recents.Add({ name, path: folder, type: member.Ref.type, openedAt: Date.now() })
            this.Status = `Opened ${name}.`
            // A real open (Open Project / session restore) — NOT factory.openProject,
            // which also serves every tree rescan. Created needs no raise here: the
            // TODL factory's createProject raises it itself.
            if (member.Storage !== undefined) await this.raiseLifecycleEvent(ProjectEventKind.Opened, member.Storage)
        }
        catch (e)
        {
            this.Status = `Open failed: ${(e as Error).message}`
        }
    }

    // Create a project of `type` named `name` in `folder` on disk via its
    // factory, then hand the folder to the solution manager exactly like an Open
    // — the member-sync loop projects the resulting member into the tree.
    // `metaModels` / `libraries` are the base bindings chosen in the dialog
    // (library binds meta-models; architecture binds meta-models + libraries).
    private async createProjectAt(
        type: string, name: string, folder: string,
        metaModels?: readonly BaseRef[], libraries?: readonly BaseRef[]): Promise<OpenProject | undefined>
    {
        const factory = this.resolveFactory(type)
        if (factory === undefined) { this.Status = `No factory for project type "${type}".`; return undefined }

        const storage = this.storageRegistry.Create(StorageService.DefaultBackendId, folder)
        try
        {
            const bindings = ((metaModels !== undefined && metaModels.length > 0) || (libraries !== undefined && libraries.length > 0))
                ? { metaModels, libraries }
                : undefined
            await factory.createProject(storage, name, bindings)
            const member = await this.manager.OpenProject(folder)
            // Same ordering as openProjectAt: a no-factory outcome here would mean the
            // registry changed between resolveFactory (above) and the manager's own
            // resolution — report it directly rather than waiting on a sync task whose
            // tail, for an unresolved member, never produces a projection to wait for.
            if (!member.IsResolved) { this.Status = `No factory for project type "${type}".`; return undefined }
            await this.memberSyncTasks.get(member)
            const op = this.findByFolder(folder)
            if (op === undefined) { this.Status = 'Create failed: the project did not open.'; return undefined }
            await this.recents.Add({ name: op.Name, path: folder, type, openedAt: Date.now() })
            this.Status = `Created ${op.Name}.`
            return op
        }
        catch (e)
        {
            this.Status = `Create failed: ${(e as Error).message}`
            return undefined
        }
    }

    // Reopen the previous session's projects. Skips (and prunes) folders whose
    // project manifest is gone; already-open folders dedupe.
    public async RestoreSession(): Promise<void>
    {
        for (const folder of await this.openStore.List())
        {
            let hasManifest = false
            try
            {
                const storage = this.storageRegistry.Create(StorageService.DefaultBackendId, folder)
                hasManifest = await storage.Exists(PROJECT_MANIFEST_FILENAME)
            }
            catch { hasManifest = false }
            if (hasManifest) await this.manager.OpenProject(folder)
            else await this.openStore.Remove(folder)
        }
    }

    private wireProjectCommands(op: OpenProject): void
    {
        op.NewItemChoices = this.newItemChoices(op, '')
        op.NewFolderCommand = new RelayCommand(() => void this.newFolderIn(op))
        op.ImportFileCommand = new RelayCommand(() => void this.importFilesInto(op, ''))
        op.ImportFolderCommand = new RelayCommand(() => void this.importFolderInto(op, ''))
        op.TreeKeyCommand = new RelayCommand((arg) => this.handleTreeKey(op, arg as KeyEventArgs))
        op.PublishCommand = new RelayCommand(() => void this.publishProject(op), () => isVersioned(op.Factory))
        op.BumpVersionMajorCommand = new RelayCommand(
            () => void this.bumpVersion(op, VersionPart.Major), () => isVersioned(op.Factory))
        op.BumpVersionMinorCommand = new RelayCommand(
            () => void this.bumpVersion(op, VersionPart.Minor), () => isVersioned(op.Factory))
        op.BumpVersionPatchCommand = new RelayCommand(
            () => void this.bumpVersion(op, VersionPart.Patch), () => isVersioned(op.Factory))
        op.SetVersionCommand = new RelayCommand(
            () => void this.setVersionDialog(op), () => isVersioned(op.Factory))
        // Re-resolve the project's declared bases after a base was republished —
        // only meaningful for a type that binds one (library/architecture).
        op.RefreshBasesCommand = new RelayCommand(
            () => this.refreshBases(op),
            () => op.Factory.requiresMetaModel === true)
        // Refresh the agent scaffold docs to the current bundled version — any TODL project.
        op.UpdateAgentMetadataCommand = new RelayCommand(
            () => void this.updateAgentMetadata(op), () => supportsScaffold(op.Factory))
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
        void this.wireProjectMenu(op)
    }

    // Populate the project's host-contributed header menu (e.g. the app's "Run
    // Agent / Skill" entries) from the registered IProjectMenuSource. Empty (and
    // HasProjectMenu=false) when no host contributes rows for this project.
    private async wireProjectMenu(op: OpenProject): Promise<void>
    {
        const source = this.Provider.get(ProjectMenuSourceKey)
        if (source === undefined) return
        const choices = await source.MenuFor(op)
        const collection = new ObservableCollection<ProjectMenuChoice>()
        for (const c of choices) collection.Add(c)
        op.ProjectMenuChoices = collection
        op.HasProjectMenu = choices.length > 0
    }

    // Create a new file of the project's primary format inside `parentFolder`
    // (project-relative; '' = the project root) and open it. The name is the
    // format kind, auto-numbered to dodge collisions (foo → foo-2).
    private async newFileIn(op: OpenProject, parentFolder = '', format: ProjectFileFormat | undefined = op.Factory.formats[0]): Promise<void>
    {
        if (format === undefined) { this.Status = 'This project type has no file format.'; return }
        const factory = this.resolveDocumentFactory(format.extension)
        if (factory === undefined) { this.Status = `No editor for ${format.extension}.`; return }
        try
        {
            const name = await uniqueStorageName(op.Storage, joinRel(parentFolder, `${format.kind}${format.extension}`))
            const path = await factory.newFile(op.Storage, name)
            // Refresh the project's tree so the new file appears, then open it.
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            // Optional per-project-type hook (e.g. the arch viewpoint picker). It
            // may abort creation (e.g. the user cancelled the picker); if so,
            // delete the file, re-scan, and skip opening it.
            const keep = await this.Provider.get(NewFileParticipantKey)?.OnCreated(op, path)
            if (keep === false)
            {
                await op.Storage.Delete(path)
                op.Adopt(await op.Factory.openProject(op.Storage))
                this.wireNodes(op.Root, op)
                this.Status = `New ${format.displayName} cancelled.`
                return
            }
            await this.openDocument(op, path, factory)
            this.Status = `New ${format.displayName} at ${basename(path)}.`
        }
        catch (e)
        {
            this.Status = `New file failed: ${(e as Error).message}`
        }
    }

    // One NewItemChoice per declared format, each creating that format in
    // `container` (project-relative; '' = root) and opening it. Bound by the
    // "Add New" submenu on a project header (container '') or a node (its folder).
    private newItemChoices(op: OpenProject, container: string): ObservableCollection<NewItemChoice>
    {
        const choices = new ObservableCollection<NewItemChoice>()
        for (const format of op.Factory.formats)
        {
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
        try
        {
            const path = await uniqueStorageName(op.Storage, joinRel(parentFolder, 'New Folder'))
            await op.Storage.CreateDirectory(path)
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            this.Status = `Created folder ${basename(path)}.`
        }
        catch (e)
        {
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

        try
        {
            const added: string[] = []
            for (const file of picked)
            {
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
        }
        catch (e)
        {
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

        try
        {
            const destTop = await uniqueStorageName(op.Storage, joinRel(target, basename(dir)))
            await this.copyOsFolderInto(dir, destTop, op)
            op.Adopt(await op.Factory.openProject(op.Storage))
            this.wireNodes(op.Root, op)
            // Expand the destination folder so the freshly-imported subtree is visible.
            this.revealImportTarget(op, target)
            this.Status = `Imported ${basename(destTop)}.`
        }
        catch (e)
        {
            this.Status = `Import failed: ${(e as Error).message}`
        }
    }

    // Recursively copy an OS directory subtree (srcAbsDir) into project storage
    // at destRel. Empty directories are preserved; files copy byte-for-byte.
    // node fs accepts '/' on Windows, so a plain string join builds child paths.
    private async copyOsFolderInto(srcAbsDir: string, destRel: string, op: OpenProject): Promise<void>
    {
        await op.Storage.CreateDirectory(destRel)
        for (const entry of await this.fs.ListDirectory(srcAbsDir))
        {
            const childSrc = `${srcAbsDir}/${entry.Name}`
            const childDest = joinRel(destRel, entry.Name)
            if (entry.IsDirectory)
            {
                await this.copyOsFolderInto(childSrc, childDest, op)
            }
            else
            {
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
        switch (args.Key)
        {
            case Key.F2:
            {
                const node = op.SelectedNode
                if (node !== undefined && node.Path !== '') { this.beginRename(op, node); args.Handled = true }
                return
            }
            case Key.Return:
            {
                if (op.EditingNode !== undefined) { void this.commitRename(op, op.EditingNode); args.Handled = true }
                return
            }
            case Key.Escape:
            {
                if (op.EditingNode !== undefined) { this.cancelRename(op, op.EditingNode); args.Handled = true }
                return
            }
            case Key.Delete:
            {
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

        try
        {
            for (const node of topLevelNodes(targets))
            {
                await op.Storage.Delete(node.Path)
                this.closeDocumentsUnder(op, node.Path)
                this.removeNodeInPlace(op, node)
            }
            op.SelectedNodes = []
            this.Status = targets.length === 1 ? `Deleted ${targets[0].Name}.` : `Deleted ${targets.length} items.`
        }
        catch (e)
        {
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
        for (const [doc, docPath] of [...this.docPaths])
        {
            if (this.docOwners.get(doc) !== op) continue
            if (docPath === path || docPath.startsWith(path + '/'))
            {
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
        try
        {
            if (await op.Storage.Exists(dest)) { this.Status = `"${proposed}" already exists.`; this.cancelRename(op, node); return }
            await this.relocatePath(op, node.Path, dest)
            // Surgical, in-place update — the node object (and the whole tree)
            // is preserved, so the TreeView keeps its expansion + selection
            // instead of rebuilding wholesale from a rescan.
            this.renameNodeInPlace(op, node, proposed, dest)
            op.EditingNode = undefined
            this.Status = `Renamed to ${proposed}.`
        }
        catch (e)
        {
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
        for (const [doc, path] of [...this.docPaths])
        {
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
        for (const child of node.Children.ToArray())
        {
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
        for (const child of root.Children.ToArray())
        {
            if (child === target) return root
            if (child.Kind === 'folder')
            {
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
        void this.Provider.get(LiveValidationKey)?.ResyncProject(op.Project.RootPath, op.Storage)
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
        for (const m of moves)
        {
            if (await op.Storage.Exists(m.to)) { collisions.push(m.name); continue }
            await this.relocatePath(op, m.from, m.to)
            moved++
        }
        if (moved > 0) await this.rescan(op)

        if (collisions.length === 0 && rejects.length === 0)
        {
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
        for (const m of moves)
        {
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
        for (const [doc, path] of [...this.docPaths])
        {
            if (this.docOwners.get(doc) !== source) continue
            const moved = path === fromPath ? toPath
                : path.startsWith(fromPath + '/') ? toPath + path.slice(fromPath.length)
                    : undefined
            if (moved === undefined) continue
            const factory = this.resolveDocumentFactory(extname(moved))
            if (factory !== undefined && isRelocatableAcrossStorage(factory))
            {
                factory.relocateAcrossStorage(doc, target.Storage, moved)
                this.docOwners.set(doc, target)
                this.docPaths.set(doc, moved)
            }
            else
            {
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
        if (!supportsScaffold(op.Factory)) { this.Status = 'This project type has no agent docs.'; return }
        const written = await op.Factory.updateScaffold(op.Storage)
        await this.rescan(op)
        this.Status = `Agent docs updated (${written.length} refreshed).`
    }

    // Publish the project through the TODL build system's npm-publish flavor (the menu
    // item is disabled for non-producer types, but guard anyway). Builds the package and
    // pushes it to the workspace package registry via PackagePublisher, then surfaces the
    // build diagnostics: success clears any prior failure, a failure's error text goes
    // ONLY to the Problems dock while the status pane shows a neutral pointer.
    private async publishProject(op: OpenProject): Promise<void>
    {
        if (!isVersioned(op.Factory)) { this.Status = ProjectExplorerService.NotPublishableStatus; return }
        // Refresh diagnostics so the Problems dock reflects exactly what publish sees.
        await this.Provider.get(LiveValidationKey)?.RefreshBases(op.Storage)
        try
        {
            const outcome = await new PackagePublisher(this.Provider).Publish(op.Storage)
            if (outcome.Ok)
            {
                this.Status = `${ProjectExplorerService.PublishedPrefix}${outcome.Id}@${outcome.Version}.`
                this.reportProjectProblem(op, ProjectExplorerService.PublishOwner, undefined)   // clear any prior failure
                return
            }
            this.Status = ProjectExplorerService.PublishFailedStatus
            this.reportProjectProblem(op, ProjectExplorerService.PublishOwner, PackagePublisher.FormatErrors(outcome.Diagnostics))
            this.Provider.get(ProblemsDockKey)?.Expand()
        }
        catch (e)
        {
            this.Status = ProjectExplorerService.PublishFailedStatus
            this.reportProjectProblem(op, ProjectExplorerService.PublishOwner, `${ProjectExplorerService.PublishFailedPrefix}${(e as Error).message}`)
            this.Provider.get(ProblemsDockKey)?.Expand()
        }
    }

    // Publish (or clear, when `message` is undefined) a single project-level
    // diagnostic for one owner into the Problems store, so an operation error like
    // a blocked publish shows in the dock, not only in the
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
        void this.Provider.get(LiveValidationKey)?.RefreshBases(op.Storage)
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
            metaModels?: BaseRef[]; libraries?: BaseRef[]; [k: string]: unknown
        }
        const resolver = this.Provider.get(BaseResolverKey)
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

        const current: BaseBindings = { metaModels: manifest.metaModels, libraries: manifest.libraries }
        const vm = new ManageReferencesDialogModel(
            current, availableMetaModels, availableLibraries, offersLibraries, (r) => this.dialogs.Close(r))
        const result = await this.dialogs.Show<BaseBindings>({ Title: 'Manage References', Content: vm, Width: 480 })
        if (result === undefined) return

        // Apply the edited bindings, preserving every other manifest field.
        manifest.metaModels = [...(result.metaModels ?? [])]
        if (offersLibraries) manifest.libraries = [...(result.libraries ?? [])]
        await op.Storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        await this.Provider.get(LiveValidationKey)?.RefreshBases(op.Storage)
        this.Status = `Updated references for ${op.Name}.`
        await this.raiseLifecycleEvent(ProjectEventKind.ReferencesChanged, op.Storage)
    }

    // Announce a project lifecycle moment on TODL's ProjectEvents bus (registered by
    // TodlProjectSystemModule's composer, which subscribes the generator scheduler).
    // No bus registered => nothing raised. The event carries the manifest as written
    // on disk. A subscriber failure surfaces in the status line rather than failing
    // the open / reference edit that already succeeded.
    private async raiseLifecycleEvent(kind: ProjectEventKind, storage: IStorage): Promise<void>
    {
        const events = this.Provider.get(ProjectEventsKey)
        if (events === undefined) return
        try
        {
            const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ProjectManifest
            await events.Raise({ Kind: kind, ProjectType: manifest.type, Project: storage, Manifest: manifest })
        }
        catch (e)
        {
            this.Status = ProjectExplorerService.LifecycleFailedPrefix + (e as Error).message
        }
    }

    // Re-scan the named open projects from disk and re-validate their models —
    // the agent's refresh_project path. Rescans + drops each project's cached
    // bases, then revalidates once (Revalidate covers all open projects). Unknown
    // folders are skipped. Awaitable so the caller knows validation has settled.
    public async RefreshProjects(folders: readonly string[]): Promise<void>
    {
        const client = this.Provider.get(LiveValidationKey)
        const resolver = this.Provider.get(BaseResolverKey)
        const producerIds: string[] = []
        for (const folder of folders)
        {
            const op = this.findByFolder(folder)
            if (op === undefined) continue
            await this.rescan(op)   // also resyncs the server's document set
            await client?.RefreshBases(op.Storage)
            // Signal A: if the refreshed project is a producer, its dependents
            // consume its (now-changed) live source and must revalidate too.
            const id = resolver?.ProducedIdOf(op.Storage)
            if (id !== undefined) producerIds.push(id)
        }
        if (resolver !== undefined && producerIds.length > 0)
            await resolver.RefreshDependentsOfIds(producerIds)
    }

    // Close a project: close its open tabs through the save/discard guard FIRST —
    // a Cancel aborts the whole close, leaving the project (and its Members entry)
    // untouched — then hand the underlying solution member to the manager.
    // Removing it from ActiveSolution.Members fires onMemberRemoved, which does
    // the actual tree/tracking teardown (the member-sync loop stays the sole
    // mutator of OpenProjects; see Review Focus #1 on ordering).
    private async closeProject(op: OpenProject): Promise<void>
    {
        // Close each owned tab through the guard so a dirty document prompts
        // Save / Don't Save / Cancel; Cancel aborts the whole project close. The
        // guard (or, absent one, a direct Close) performs the actual tab close
        // here — the docOwners/docPaths bookkeeping teardown happens afterward,
        // in onMemberRemoved, once the manager confirms the member is gone.
        const guard = this.Provider.get(DocumentCloseGuard.Key)
        for (const [doc, owner] of [...this.docOwners])
        {
            if (owner !== op) continue
            if (guard !== undefined)
            {
                if (!(await guard.TryCloseDocument(doc))) return   // cancelled — leave the project open
            }
            else
            {
                this.host.Close(doc)
            }
        }
        const member = this.memberFor(op)
        if (member === undefined) return
        await this.manager.CloseProject(member)
        // Let onMemberRemoved's teardown (docOwners/docPaths, live-validation
        // detach, OpenProjects.Remove, openStore.Remove) actually land before
        // this call returns.
        await this.memberSyncTasks.get(member)
    }

    // Activate a tree node: open a file whose extension a registered editor
    // handles in a tab (any project may contain any such file — editors own
    // files, not projects), or open it in the OS default app when the backend
    // supports local access and no editor claims the extension.
    private async openNode(node: ProjectNode, op: OpenProject): Promise<void>
    {
        if (node.Kind === 'folder') return
        const factory = this.resolveDocumentFactory(extname(node.Path))
        try
        {
            if (factory !== undefined)
            {
                await this.openDocument(op, node.Path, factory)
                this.Status = `Opened ${node.Name}.`
            }
            else if (isLocalFileAccess(op.Storage))
            {
                await op.Storage.OpenExternal(node.Path)
            }
            else
            {
                this.Status = `Can't open ${node.Name} — no editor for its type.`
            }
        }
        catch (e)
        {
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
        for (const [doc, p] of this.docPaths)
        {
            if (p === path && this.docOwners.get(doc) === op) return doc
        }
        return undefined
    }

    // One selectable choice per installed factory — the factory is self-describing
    // (typeId / title / description), and requiresMetaModel / offersLibraries drive
    // whether the dialog shows the meta-model picker / libraries multi-select.
    private typeChoices(): ProjectTypeChoice[]
    {
        return this.Provider.getRequired(ProjectFactoryRegistryKey)
            .All()
            .map((f) => new ProjectTypeChoice(
                f.typeId, f.title, f.description,
                f.requiresMetaModel ?? false,
                f.offersLibraries ?? false))
    }

    // The published meta-models offered by the New-Project meta-model picker —
    // enumerated by the host's IPublishedBases, or empty when none is registered.
    private async publishedMetaModels(): Promise<BaseRef[]>
    {
        return (await this.Provider.get(PublishedBasesKey)?.ListMetaModels()) ?? []
    }

    // The published libraries offered by the New-Project libraries multi-select —
    // enumerated by the host's IPublishedBases, or empty when none is registered.
    private async publishedLibraries(): Promise<BaseRef[]>
    {
        return (await this.Provider.get(PublishedBasesKey)?.ListLibraries()) ?? []
    }

    // New Project validation: refuse a folder that already holds a project.
    private async validateNewProject(result: NewProjectResult): Promise<string | null>
    {
        // Validate the SUBFOLDER we'll create in (location/name), not the chosen
        // parent location — a project lives in its own named subfolder.
        const folder = joinPath(result.location, result.name.trim())
        const storage = this.storageRegistry.Create(StorageService.DefaultBackendId, folder)
        if (await storage.Exists(PROJECT_MANIFEST_FILENAME)) return 'That folder already contains a project.'
        return null
    }

    private resolveFactory(type: string): IProjectFactory | undefined
    {
        return this.Provider.getRequired(ProjectFactoryRegistryKey).factoryFor(type)
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
        if (action !== undefined)
        {
            node.NodeActionLabel = action.label
            node.NodeActionCommand = action.command
            node.HasNodeAction = true
        }
        // Diagram export — a .diagram file can be exported straight from the tree
        // (SVG / PPTX) without being opened, when a host provides IDiagramTreeExport.
        // HasExport gates the context-menu submenu.
        if (node.Kind === 'diagram' && this.Provider.get(DiagramTreeExportKey) !== undefined)
        {
            node.ExportSvgCommand  = new RelayCommand(() => void this.exportNode(node, op, DiagramExportFormat.Svg))
            node.ExportPptxCommand = new RelayCommand(() => void this.exportNode(node, op, DiagramExportFormat.Pptx))
            node.HasExport = true
        }
        for (const child of node.Children.ToArray()) this.wireNodes(child, op)
    }

    // Export a .diagram node in the chosen format via the host's IDiagramTreeExport
    // (headless render + save). A thrown error surfaces on the status strip.
    private async exportNode(node: ProjectNode, op: OpenProject, format: DiagramExportFormat): Promise<void>
    {
        const exporter = this.Provider.get(DiagramTreeExportKey)
        if (exporter === undefined) return
        try
        {
            await exporter.Export(op, node.Path, format)
        }
        catch (e)
        {
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

// A document that can reload itself from disk (the code buffer can). IDocument
// supplies Id/IsDirty; Reload is the buffer's own. Duck-typed so the explorer
// stays decoupled from the code-editor module.
export type ReloadableDocument = IDocument & { Reload(): Promise<void> }
function isReloadable(doc: IDocument): doc is ReloadableDocument
{
    return typeof (doc as Partial<{ Reload: unknown }>).Reload === 'function'
}

// A factory that ships an agent scaffold it can refresh (.claude/**). Duck-typed
// so the explorer's "Update Agent Meta-data" gate doesn't depend on the concrete
// TodlProjectFactory.
function supportsScaffold(f: IProjectFactory): f is IProjectFactory & { updateScaffold(s: IStorage): Promise<readonly string[]> }
{
    return typeof (f as { updateScaffold?: unknown }).updateScaffold === 'function'
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
    if (nodes.length === 1)
    {
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
    for (let n = 2; ; n++)
    {
        const candidate = `${stem}-${n}${ext}`
        if (!(await storage.Exists(candidate))) return candidate
    }
}

// The open-dialog filters for importing into a project: one entry per factory
// format (so its files surface first) plus an All-files catch-all — a guide,
// not a restriction. Extensions carry no leading dot (the dialog's convention).
export function importFilters(formats: readonly ProjectFileFormat[]): FileFilter[]
{
    const known = formats.map((f) => ({ Name: f.displayName, Extensions: [f.extension.replace(/^\./, '')] }))
    return [...known, { Name: 'All files', Extensions: ['*'] }]
}
