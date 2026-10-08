// solution-workspace-service.ts — the UI side of member-keyed content mutations.
//
// SolutionWorkspaceService is the Solution Explorer's IContentMutations implementer
// built OVER the todl 0.40.0 engine ops (MemberContentOps / MemberProjectOps /
// ReferenceEditor / ProjectLifecycle) rather than over the legacy OpenProject VM.
// Each IContentMutations method constructs/calls the matching engine op for the
// member and wraps it with the UI the engine stays free of: the delete confirm
// (ConfirmDialogModel), the Set-Version and Manage-References dialogs, the OS file/
// folder pickers (FileSystemService), the publish BackgroundWork + Problems dock,
// and open-tab bookkeeping (DocOwnership).
//
// It is ALSO the engine's lifecycle guards: it implements IContentLifecycleGuard
// (CanRemove closes affected tabs through the dirty-save guard BEFORE the engine
// deletes; OnMoved re-points tabs after a rename/move; OnRemoved forgets closed
// tabs) and ICloseGuard (CanClose runs the dirty-save guard over a member's tabs so
// a Cancel vetoes the whole project close). The engine calls back into these as it
// runs, so disk mutation and tab bookkeeping never fall out of step.
//
// Scope note (PE retirement): the Solution Explorer is now wired onto this service. It
// also exposes the References / Connections views (IReferenceView / IConnectionView) the
// reference + connection branches read and mutate through. The Open / New project
// commands live on ProjectCommandsService.
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    ContentHostService,
    DialogService,
    type DocumentsContentHostService,
    type IDocument,
} from '@pragmatic-tech-ai/mural/framework'
import {
    BuildService,
    MemberProjectOps,
    ProjectEventsKey,
    ProjectType,
    ProjectNodeKind,
    SolutionLanguageService,
    type IBaseResolver,
    SolutionManagerService,
    UniqueName,
    VersionPart as EngineVersionPart,
    type BagVantage,
    type IBagPersister,
    type BuildPublishOutcome,
    type SolutionMember,
} from '@pragmatic-tech-ai/todl'
import { isLocalFileAccess, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    isVersioned,
    ProjectFactoryRegistryKey,
    type IProjectFactory,
    type ProjectFileFormat,
} from '../../../projects/project-factory.js'
import { PublishedBasesKey, LiveValidationKey, ProblemsDockKey } from '../../../projects/index.js'
import type { IContentMutations } from './content-mutations.js'
import { OpenProjectsStore } from '../../../projects/open-projects-store.js'
import { VersionPart } from '../../../projects/semver-bump.js'
import { ConfirmDialogModel } from '../../../dialogs/confirm-dialog-model.js'
import { SetVersionDialogModel, type SetVersionResult } from '../../../projects/set-version-dialog-model.js'
import { ManageReferencesDialogModel } from '../../../projects/manage-references-dialog-model.js'
import type { BaseBindings } from '../../../projects/base-binding.js'
import { DocumentCloseGuard } from '../../../documents/document-close-guard.js'
import type { IDocumentFactory } from '../../../documents/document-factory.js'
import { FileSystemService } from '../../storage/index.js'
import type { FileFilter } from '../../../../shared/file-system-api.js'
import { DiagnosticsService } from '../../../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../../diagnostics/diagnostic.js'
import { BackgroundWorkService, TaskKind, type InlineJob } from '../../background-work/index.js'
import { PublishTaskExecutor } from '../../../projects/publish-task-executor.js'
import { PublishFailure } from '../../../projects/publish-failure.js'
import { BuildProgressReporter } from './build-progress-reporter.js'
import type { IReferenceView } from './reference-view.js'
import type { IConnectionView } from './connection-view.js'
import { ConnectionsClientKey } from './connections-client.js'
import { SolutionReferenceView } from './solution-reference-view.js'
import { ConnectionEditingService, type IConnectionHost } from './connection-editing-service.js'
import { GlobalBagPersisterKey } from '../../bags/global-bag-persister.js'
import { InfoDialog } from './info-dialog.js'
import { DocOwnership, type ReloadableDocument } from './doc-ownership.js'
import { EnvironmentService } from '../../../environment/environment-service.js'
import {
    MemberContentOps,
    RenameError,
    ReferenceEditor,
    ProjectLifecycle,
    ConnectionSelection,
    type IContentLifecycleGuard,
    type ICloseGuard,
    type IPublishedBaseCatalog,
} from './todl-engine-ops.js'

// Optional post-new-file hook, member-keyed (the engine content model is member +
// path; there is no OpenProject). The participant may veto a just-created file (e.g.
// the architecture viewpoint picker was cancelled), after which the file is deleted.
// An unregistered participant is treated as "keep". A later task migrates the
// OpenProject-based INewFileParticipant (arch-new-diagram-participant) onto this seam.
export interface IMemberNewFileParticipant
{
    OnCreated(member: SolutionMember, path: string): Promise<boolean>
}

export const MemberNewFileParticipantKey = new ServiceKey<IMemberNewFileParticipant>('MemberNewFileParticipant')

export class SolutionWorkspaceService extends ServiceBase implements IContentMutations, IContentLifecycleGuard, ICloseGuard
{
    public static readonly Key = new ServiceKey<SolutionWorkspaceService>('SolutionWorkspaceService')

    // Dialog titles + the delete confirm button label.
    private static readonly DeleteTitle = 'Delete'
    private static readonly SetVersionTitle = 'Set Version'
    private static readonly ManageReferencesTitle = 'Manage References'
    private static readonly DeleteConfirmLabel = 'Delete'

    // Failure feedback (no notification/toast channel exists in solution-explorer, so a brief
    // OK-only info dialog — a ConfirmDialogModel with ShowCancel=false — surfaces these).
    private static readonly RenameTitle = 'Rename'
    private static readonly MoveTitle = 'Move'
    private static readonly InvalidNameMessage = "That name isn't valid."
    private static readonly NameExistsSuffix = '" already exists.'
    private static readonly NameExistsPrefix = '"'

    // OS picker titles (prefixes; the member name is appended).
    private static readonly ImportFilesTitlePrefix = 'Import files into '
    private static readonly ImportFolderTitlePrefix = 'Import folder into '

    // Empty-libraries guidance already lives in the dialog VM; here we keep the
    // filter catch-all name.
    private static readonly AllFilesFilterName = 'All files'
    private static readonly AllFilesExtension = '*'

    // Publish: the Problems-dock owner key, the task title prefix, and the failure
    // diagnostic prefix for a thrown publish (vs. a diagnostics failure).
    private static readonly PublishOwner = 'publish'
    private static readonly PublishingPrefix = 'Publishing '
    private static readonly PublishOperation = 'Publishing'
    // The published package's on-disk home is the app's packages backend,
    // <userData>/packages/<id>/<version> (see packages-backend.ts). Named here so the
    // success log can tell the user WHERE it went. [[feedback_user_facing_progress_messages]]
    private static readonly PackagesFolder = 'packages'
    private static readonly PublishedPrefix = 'Published '
    private static readonly LocalStoreLabel = ' to the local package store'
    private static readonly CoordSeparator = '@'
    private static readonly PublishFailedPrefix = 'Publish failed: '

    // Dialog widths (match the legacy explorer).
    private static readonly ConfirmWidth = 420
    private static readonly SetVersionWidth = 380
    private static readonly ManageReferencesWidth = 480

    private static readonly Separator = '/'

    // The open-document map (member, path) → tab. Also drives the guard callbacks.
    private readonly docs: DocOwnership

    // Engine ops that are per-service (not per-member): resolved lazily because the
    // solution engine seams they need are registered after this service's ctor runs
    // at mount (the ctor runs before those seams register).
    private memberOps: MemberProjectOps | undefined
    private lifecycle: ProjectLifecycle | undefined
    private readonly referenceView: SolutionReferenceView
    private connectionView: ConnectionEditingService | undefined
    private connectionSelection: ConnectionSelection | undefined
    // The Publish-kind background-work executor is registered once, lazily.
    private publishExecutorRegistered = false

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.docs = new DocOwnership(this.Provider)
        this.referenceView = new SolutionReferenceView(this.Provider)
    }

    // ── collaborators (lazy) ────────────────────────────────────────────────
    private get manager(): SolutionManagerService { return this.Provider.getRequired(SolutionManagerService.Key) }
    private get resolver(): IBaseResolver
    {
        return this.Provider.getRequired(SolutionLanguageService.Key)
    }
    private get dialogs(): DialogService { return this.Provider.getRequired(DialogService.Key) }
    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get host(): DocumentsContentHostService
    {
        return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
    }

    private get projectOps(): MemberProjectOps
    {
        return (this.memberOps ??= new MemberProjectOps(this.Provider.getRequired(ProjectFactoryRegistryKey), this.resolver))
    }

    // The References branch view (engine ReferenceEditor + the offersLibraries gate).
    public get References(): IReferenceView { return this.referenceView }

    // The Connections branch + per-project active-connection view, built lazily: the
    // connections client (window.api.connections) is registered after this ctor runs at boot.
    public get Connections(): IConnectionView
    {
        if (this.connectionView === undefined)
        {
            this.connectionView = new ConnectionEditingService(
                this.Provider.getRequired(ConnectionsClientKey), this.ConnectionHost(), this.Selection())
        }
        return this.connectionView
    }

    // The effective connection id a consuming project (identified by its manifest id — the
    // resolution context's consumerId) resolves its published bases against: the project-local
    // selection, else the solution default, else the global default. Undefined when no open
    // member produces that id or no connection applies.
    public async EffectiveConnectionIdForConsumer(consumerId: string): Promise<string | undefined>
    {
        const member = await this.Selection().MemberForConsumerId(consumerId)
        if (member === undefined) return undefined
        return (await this.Connections.ActiveConnectionFor(member))?.Id
    }

    // The engine connection-selection ops (bag reads/writes live there). The global bag
    // persister is app-registered, so this is resolved lazily; absent (headless) -> the
    // engine ops no-op.
    private Selection(): ConnectionSelection
    {
        return (this.connectionSelection ??= new ConnectionSelection(
            this.manager, this.resolver, this.Provider.get(GlobalBagPersisterKey) as IBagPersister))
    }

    // The host ConnectionEditingService needs: the requiresMetaModel factory gate, base
    // re-resolution on an active-connection change, and the property-bag vantage.
    private ConnectionHost(): IConnectionHost
    {
        return {
            ConsumerIdOf: async (m) => (m.Storage === undefined ? undefined : this.resolver.ConsumerIdOf(m.Storage)),
            ProjectFor: (m) =>
            {
                const factory = m.IsResolved ? this.factoryFor(m) : undefined
                return factory === undefined ? undefined : { Factory: factory }
            },
            SetStatus: () => { /* solution-explorer has no status channel */ },
            RefreshBasesFor: async (m) => { this.RefreshMemberBases(m) },
            Vantage: (m) => this.BuildVantage(m),
        }
    }

    // The bag vantage for connection resolution: always global; the active solution when one
    // is open; and, for a member, that project's shared + local scopes. Undefined when the
    // global persister is not wired (headless) — callers then use the client inventory alone.
    private BuildVantage(member?: SolutionMember): Promise<BagVantage | undefined>
    {
        return this.manager.BuildVantage(this.Provider.get(GlobalBagPersisterKey), member)
    }

    public override dispose(): void
    {
        this.referenceView.dispose()
        super.dispose()
    }

    private get projects(): ProjectLifecycle
    {
        // The session store lets CloseProject drop the folder from the persisted open set.
        return (this.lifecycle ??= new ProjectLifecycle(this.Provider, this.manager, this.Provider.getRequired(OpenProjectsStore.Key)))
    }

    // ── IContentMutations: file/folder ──────────────────────────────────────
    public async RenameMemberFile(member: SolutionMember, path: string, newName: string): Promise<void>
    {
        // Engine renames on storage and fires OnMoved on success → tabs re-point. A failed
        // outcome must not be swallowed: surface a collision / invalid name to the user (a
        // blank name is an abandoned edit — no feedback, matching the legacy explorer).
        const result = await new MemberContentOps(member, this).Rename(path, newName)
        if (result.ok) return
        if (result.error === RenameError.Collision)
        {
            await this.Inform(SolutionWorkspaceService.RenameTitle, SolutionWorkspaceService.NameExistsMessage(newName.trim()))
        }
        else if (result.error === RenameError.Invalid)
        {
            await this.Inform(SolutionWorkspaceService.RenameTitle, SolutionWorkspaceService.InvalidNameMessage)
        }
    }

    public async DeleteMemberFiles(member: SolutionMember, paths: readonly string[]): Promise<void>
    {
        // Collapse nested selections to the roots the engine actually deletes (a folder carries
        // its descendants), so the confirm count matches what is removed.
        const roots = SolutionWorkspaceService.Roots(paths.filter((p) => p !== ''))   // the project root ('') is never deletable
        if (roots.length === 0) return
        // The irreversible delete confirm is the UI's; the engine Delete then calls
        // CanRemove (dirty-tab guard) BEFORE touching disk, then OnRemoved after.
        if (!(await this.ConfirmDelete(member, roots))) return
        await new MemberContentOps(member, this).Delete(paths)
    }

    public async NewFileForMember(member: SolutionMember, folder: string, format: ProjectFileFormat): Promise<void>
    {
        const storage = member.Storage
        if (storage === undefined) return
        // The editor authors the file's content (binary-safe, format-specific), so the
        // create goes through the document factory on the member's storage (the same
        // watchable storage the engine ProjectContentStore observes). UniqueName is the
        // engine helper (foo → foo-2).
        const factory = this.docs.FactoryFor(format.extension)
        if (factory === undefined) return
        const name = await UniqueName.For(storage, SolutionWorkspaceService.Join(folder, `${format.kind}${format.extension}`))
        const path = await factory.newFile(storage, name)
        // Optional per-type participant (e.g. the arch viewpoint picker) may veto —
        // then the just-created file is deleted and the tab never opens.
        const participant = this.Provider.get(MemberNewFileParticipantKey)
        const keep = participant === undefined ? true : await participant.OnCreated(member, path)
        if (keep === false)
        {
            await storage.Delete(path)
            return
        }
        await this.docs.OpenDocument(member, path, factory)
    }

    public async NewFolderForMember(member: SolutionMember, folder: string, name: string): Promise<void>
    {
        const proposed = name.trim()
        // Engine auto-names "New Folder" (numbered on collision) when none is given.
        await new MemberContentOps(member, this).NewFolder(folder, proposed === '' ? undefined : proposed)
    }

    public async ImportFilesForMember(member: SolutionMember, target: string): Promise<void>
    {
        const picked = await this.fs.OpenFiles({
            Title: SolutionWorkspaceService.ImportFilesTitlePrefix + member.Title,
            Filters: SolutionWorkspaceService.ImportFilters(this.projectOps.FormatsFor(member)),
        })
        if (picked === null || picked.length === 0) return
        const files = picked.map((f) => ({ name: SolutionWorkspaceService.BaseName(f.Path), bytes: f.Bytes }))
        await new MemberContentOps(member, this).ImportBytes(target, files)
    }

    // The engine has no ImportFolder (it owns no OS file system), so the UI
    // orchestrates: OS folder picker → walk the OS tree → engine NewFolder +
    // ImportBytes per directory. The top folder is uniquified against the target
    // (pics → pics-2); descendants keep their names inside the fresh subtree.
    public async ImportFolderForMember(member: SolutionMember, target: string): Promise<void>
    {
        const dir = await this.fs.OpenFolder({ Title: SolutionWorkspaceService.ImportFolderTitlePrefix + member.Title })
        if (dir === null) return
        const ops = new MemberContentOps(member, this)
        const top = await ops.NewFolder(target, SolutionWorkspaceService.BaseName(dir))
        await this.ImportOsTreeInto(dir, top, ops)
    }

    // Recursively copy an OS directory subtree (srcAbsDir) into the member's storage
    // at destRel. node fs accepts '/' on Windows, so a plain join builds child paths.
    private async ImportOsTreeInto(srcAbsDir: string, destRel: string, ops: MemberContentOps): Promise<void>
    {
        const files: { name: string; bytes: Uint8Array }[] = []
        for (const entry of await this.fs.ListDirectory(srcAbsDir))
        {
            const childSrc = `${srcAbsDir}${SolutionWorkspaceService.Separator}${entry.Name}`
            if (entry.IsDirectory)
            {
                const sub = await ops.NewFolder(destRel, entry.Name)
                await this.ImportOsTreeInto(childSrc, sub, ops)
            }
            else
            {
                files.push({ name: entry.Name, bytes: await this.fs.ReadBytes(childSrc) })
            }
        }
        if (files.length > 0) await ops.ImportBytes(destRel, files)
    }

    public async MoveMemberNodes(member: SolutionMember, paths: readonly string[], destPath: string): Promise<void>
    {
        // Engine plans + executes the move (ancestor-filter, collision-skip) and fires
        // OnMoved per moved path → tabs re-point. Report anything skipped (a name already
        // exists at the destination, or the move was into itself) rather than swallowing it.
        const result = await new MemberContentOps(member, this).Move(paths, destPath)
        if (result.skipped.length > 0)
        {
            await this.Inform(SolutionWorkspaceService.MoveTitle, SolutionWorkspaceService.MoveSkippedMessage(result.skipped.length))
        }
    }

    // ── IContentMutations: version / publish / scaffold / bases ──────────────
    public async BumpMemberVersion(member: SolutionMember, part: VersionPart): Promise<void>
    {
        if (!this.projectOps.IsVersioned(member)) return
        await this.projectOps.BumpVersion(member, SolutionWorkspaceService.MapVersionPart(part))
    }

    public async SetMemberVersion(member: SolutionMember): Promise<void>
    {
        if (!this.projectOps.IsVersioned(member)) return
        const current = await this.CurrentVersion(member)
        const vm = new SetVersionDialogModel(current, (r) => this.dialogs.Close(r))
        const result = await this.dialogs.Show<SetVersionResult>({
            Title: SolutionWorkspaceService.SetVersionTitle, Content: vm, Width: SolutionWorkspaceService.SetVersionWidth,
        })
        if (result === undefined) return
        await this.projectOps.SetVersion(member, result.version)
        if (result.publish) await this.PublishMember(member)
    }

    public async UpdateMemberAgentMetadata(member: SolutionMember): Promise<void>
    {
        if (!this.projectOps.SupportsScaffold(member)) return
        await this.projectOps.UpdateScaffold(member)
    }

    public RefreshMemberBases(member: SolutionMember): void
    {
        // Engine drops the resolver's cached bases (keyed by manifest id); the UI
        // validator also drops its cache so live squiggles re-resolve immediately.
        void this.projectOps.RefreshBases(member)
        const storage = member.Storage
        if (storage !== undefined) void this.Provider.get(LiveValidationKey)?.RefreshBases(storage)
    }

    public async ManageMemberReferences(member: SolutionMember): Promise<void>
    {
        const storage = member.Storage
        if (storage === undefined) return
        const editor = new ReferenceEditor(this.resolver, storage, this.publishedCatalog(), this.Provider.get(ProjectEventsKey))
        const manifest = await editor.ReadManifest()
        // The gate the engine does NOT apply: only an architecture offers libraries;
        // a library project omits them, so never build a libraries list for it.
        const offersLibraries = this.factoryFor(member)?.offersLibraries === true
        const availableMetaModels = await editor.AvailableReferencesFor(ProjectType.MetaModel)
        const availableLibraries = offersLibraries ? await editor.AvailableReferencesFor(ProjectType.Library) : []
        const current: BaseBindings = { metaModels: manifest.metaModels, libraries: manifest.libraries }
        const vm = new ManageReferencesDialogModel(
            current, availableMetaModels, availableLibraries, offersLibraries, (r) => this.dialogs.Close(r))
        const result = await this.dialogs.Show<BaseBindings>({
            Title: SolutionWorkspaceService.ManageReferencesTitle, Content: vm, Width: SolutionWorkspaceService.ManageReferencesWidth,
        })
        if (result === undefined) return
        // Engine write tail persists → Invalidate → raise ReferencesChanged. Only
        // write libraries for a type that offers them, so a library manifest keeps shape.
        await editor.WriteReferences({
            metaModels: result.metaModels,
            libraries: offersLibraries ? (result.libraries ?? []) : undefined,
        })
        this.RefreshMemberBases(member)
        this.referenceView.NotifyChanged(member)   // repaint the References branch
    }

    // Publish through the engine BuildService as a background-work Publish task (its
    // status row + output log surface progress); success clears the Problems slice, a
    // failure's errors go to the Problems dock. BuildContributor calls this (kept
    // contract: mutations.PublishMember + mutations.IsVersionedMember).
    public async PublishMember(member: SolutionMember): Promise<void>
    {
        if (!this.projectOps.IsVersioned(member)) return
        const storage = member.Storage
        if (storage === undefined) return
        await this.Provider.get(LiveValidationKey)?.RefreshBases(storage)
        const build = this.Provider.get(BuildService.Key) ?? new BuildService(this.Provider)
        try
        {
            this.ApplyPublishOutcome(member, await this.PublishThroughWork(member, build))
        }
        catch (e)
        {
            this.ReportProblem(member, `${SolutionWorkspaceService.PublishFailedPrefix}${(e as Error).message}`)
            this.Provider.get(ProblemsDockKey)?.Expand()
        }
    }

    // ── IContentMutations: capability queries (engine) ──────────────────────
    public FormatsFor(member: SolutionMember): readonly ProjectFileFormat[] { return this.projectOps.FormatsFor(member) }
    public IsVersionedMember(member: SolutionMember): boolean { return this.projectOps.IsVersioned(member) }
    public CanRefreshBasesMember(member: SolutionMember): boolean { return this.projectOps.CanRefreshBases(member) }
    public SupportsScaffoldMember(member: SolutionMember): boolean { return this.projectOps.SupportsScaffold(member) }

    // ── IContentMutations: lifecycle (close / remove) ───────────────────────
    public async CloseMember(member: SolutionMember): Promise<void>
    {
        // Engine CloseProject runs CanClose (dirty guard) first; a veto returns false
        // and leaves the member open. On close it removes the member + session entry.
        if (await this.projects.CloseProject(member, this)) this.docs.UntrackMember(member)
    }

    public async RemoveMember(member: SolutionMember): Promise<void>
    {
        // A resolved member goes through the dirty-tab-guarded close; an unresolved /
        // never-opened member (no tabs) drops out of Members directly.
        if (member.IsResolved) { await this.CloseMember(member); return }
        this.manager.ActiveSolution?.Members.Remove(member)
        this.docs.UntrackMember(member)
    }

    // ── IContentLifecycleGuard (the engine content ops call back into these) ──
    // Close every open tab under the paths about to be deleted — through the dirty
    // guard so an unsaved buffer prompts Save / Don't Save / Cancel. A Cancel vetoes
    // the whole delete (returns false before the engine touches disk).
    public async CanRemove(member: SolutionMember, paths: readonly string[]): Promise<boolean>
    {
        const guard = this.Provider.get(DocumentCloseGuard.Key)
        for (const doc of this.docs.DocsUnder(member, paths))
        {
            if (guard !== undefined)
            {
                if (!(await guard.TryCloseDocument(doc))) return false
                this.docs.Forget(doc)
            }
            else
            {
                this.host.Close(doc)
                this.docs.Forget(doc)
            }
        }
        return true
    }

    public OnMoved(member: SolutionMember, from: string, to: string): void
    {
        this.docs.RepointOpenDocuments(member, from, to)
    }

    public OnRemoved(member: SolutionMember, paths: readonly string[]): void
    {
        // Tabs were closed in CanRemove; this forgets any residual map entries for the
        // paths the engine actually removed (defensive / partial-delete safe).
        for (const path of paths) this.docs.CloseDocumentsUnder(member, path)
    }

    // ── ICloseGuard (the engine ProjectLifecycle.CloseProject calls this) ────
    public async CanClose(member: SolutionMember): Promise<boolean>
    {
        const guard = this.Provider.get(DocumentCloseGuard.Key)
        for (const doc of this.docs.OwnedDocs(member))
        {
            if (guard !== undefined)
            {
                if (!(await guard.TryCloseDocument(doc))) return false
                this.docs.Forget(doc)
            }
            else
            {
                this.host.Close(doc)
                this.docs.Forget(doc)
            }
        }
        return true
    }

    // ── open-document surface the solution-explorer + app need ───────────────
    // Open (or re-activate) a file in the member's project — the open-on-activate
    // entry point. A folder is a no-op; a file with no editor falls back to the OS on
    // local storage.
    public async OpenMemberFile(member: SolutionMember, path: string, kind: ProjectNodeKind, preview = false): Promise<void>
    {
        if (kind === ProjectNodeKind.Folder) return
        const storage = member.Storage
        if (storage === undefined) return
        const doc = await this.docs.OpenFile(member, path, preview)
        if (doc === undefined && isLocalFileAccess(storage)) await storage.OpenExternal(path)
    }

    // Open (or re-activate) a project file and return its document — the generic
    // "get me the live document for this path" entry a node-command contributor uses.
    public OpenPath(member: SolutionMember, path: string): Promise<IDocument | undefined>
    {
        return this.docs.OpenFile(member, path)
    }

    // Navigate to a diagnostic (Problems dock): open/re-activate `uri` in the project
    // rooted at `projectId` and scroll to (line, column). No-op when that project is
    // not open or no editor claims the extension.
    public async OpenFileInProject(projectId: string, uri: string, line: number, column: number): Promise<void>
    {
        const member = this.MemberByFolder(projectId)
        if (member === undefined) return
        const doc = await this.docs.OpenFile(member, uri)
        if (doc !== undefined && SolutionWorkspaceService.IsRevealable(doc)) doc.RequestReveal(line, column)
    }

    // The document factory registered for a file extension (e.g. `.md`), or undefined when no
    // editor handles it. Public read seam over the document-type registry (used by e2e).
    public DocumentFactoryFor(extension: string): IDocumentFactory | undefined
    {
        return this.docs.FactoryFor(extension)
    }

    // The open reloadable document whose resolved OS path matches `absPath` — the
    // file-watch editor-reload consumer.
    public FindOpenCodeDocByOsPath(absPath: string): ReloadableDocument | undefined
    {
        return this.docs.FindOpenCodeDocByOsPath(absPath)
    }

    // Awaitable folder-keyed refresh (file-watch rescan + the agent's refresh_project): for each
    // open member rooted at a folder, drop its cached bases (engine; also invalidates dependents,
    // raising StaleMembers), reconcile the language server's document set, and revalidate.
    // Unknown folders are skipped. Resolves once validation has settled.
    public async RefreshFolders(folders: readonly string[]): Promise<void>
    {
        const validation = this.Provider.get(LiveValidationKey)
        for (const folder of folders)
        {
            const member = this.MemberByFolder(folder)
            const storage = member?.Storage
            if (member === undefined || storage === undefined) continue
            await this.projectOps.RefreshBases(member)
            await validation?.ResyncProject(storage.Root, storage)
            await validation?.RefreshBases(storage)
        }
    }

    // ── publish helpers (ported from the retired ProjectExplorerService, member-keyed) ────
    private PublishThroughWork(member: SolutionMember, build: BuildService): Promise<BuildPublishOutcome>
    {
        const storage = member.Storage as IStorage
        const work = this.Provider.get(BackgroundWorkService.Key)
        if (work === undefined) return build.Publish(storage, undefined)
        this.EnsurePublishExecutor(work)
        const title = `${SolutionWorkspaceService.PublishingPrefix}${member.Title}`
        const { done } = work.submit<InlineJob<BuildPublishOutcome>, BuildPublishOutcome>({
            kind: TaskKind.Publish,
            title,
            payload: async (ctx) =>
            {
                const reporter = new BuildProgressReporter(ctx, SolutionWorkspaceService.PublishOperation)
                const outcome = await build.Publish(storage, reporter)
                if (outcome.Ok) ctx.log(this.PublishedLocationLine(outcome))
                return PublishFailure.Guard(outcome)
            },
        })
        return done.catch((e) =>
        {
            if (e instanceof PublishFailure) return e.Outcome
            throw e
        })
    }

    // The final "where it went" line appended to a successful publish's log: the package
    // coordinate (<id>@<version>) and its on-disk home in the local package store, so the
    // user can see and verify the result rather than reading internal step ids.
    private PublishedLocationLine(outcome: BuildPublishOutcome): string
    {
        const coord = `${outcome.Id}${SolutionWorkspaceService.CoordSeparator}${outcome.Version}`
        const head = `${SolutionWorkspaceService.PublishedPrefix}${coord}${SolutionWorkspaceService.LocalStoreLabel}`
        const env = this.Provider.get(EnvironmentService.Key)
        if (env === undefined) return head
        const path = [env.UserDataDirectory, SolutionWorkspaceService.PackagesFolder, outcome.Id, outcome.Version].join(env.PathSeparator)
        return `${head} (${path})`
    }

    private ApplyPublishOutcome(member: SolutionMember, outcome: BuildPublishOutcome): void
    {
        if (outcome.Ok)
        {
            this.ReportProblem(member, undefined)   // clear any prior failure
            return
        }
        this.ReportProblem(member, BuildService.FormatErrors(outcome.Diagnostics))
        this.Provider.get(ProblemsDockKey)?.Expand()
    }

    private EnsurePublishExecutor(work: BackgroundWorkService): void
    {
        if (this.publishExecutorRegistered) return
        work.Register(new PublishTaskExecutor())
        this.publishExecutorRegistered = true
    }

    // Publish (or clear, when `message` is undefined) a single project-level publish
    // diagnostic for the member into the Problems store. The atomic-slice store
    // replaces this owner's slice each call.
    private ReportProblem(member: SolutionMember, message: string | undefined): void
    {
        const diagnostics = this.Provider.get(DiagnosticsService.Key)
        const storage = member.Storage
        if (diagnostics === undefined || storage === undefined) return
        const projectId = storage.Root
        if (message === undefined) { diagnostics.Publish(SolutionWorkspaceService.PublishOwner, projectId, []); return }
        diagnostics.Publish(SolutionWorkspaceService.PublishOwner, projectId, [{
            owner: SolutionWorkspaceService.PublishOwner, projectId, projectName: member.Title, uri: null,
            message, severity: DiagnosticSeverity.Error, span: null,
        }])
    }

    // ── small helpers ────────────────────────────────────────────────────────
    private factoryFor(member: SolutionMember): IProjectFactory | undefined
    {
        return this.Provider.getRequired(ProjectFactoryRegistryKey).factoryFor(member.Ref.type)
    }

    // The member's current published version for the Set-Version dialog prefill. The
    // engine MemberProjectOps exposes no GetVersion, so read it from the member's
    // versioned factory directly (guarded by IsVersioned upstream).
    private async CurrentVersion(member: SolutionMember): Promise<string>
    {
        const factory = this.factoryFor(member)
        const storage = member.Storage
        if (factory === undefined || storage === undefined || !isVersioned(factory)) return '0.0.0'
        return factory.getVersion(storage)
    }

    private publishedCatalog(): IPublishedBaseCatalog | undefined
    {
        return this.Provider.get(PublishedBasesKey) as IPublishedBaseCatalog | undefined
    }

    // Surface an operation failure through a brief OK-only info dialog (ConfirmDialogModel
    // with ShowCancel=false, so only the OK button renders) — solution-explorer has no
    // notification/toast/status channel.
    private async Inform(title: string, message: string): Promise<void>
    {
        await InfoDialog.Show(this.dialogs, title, message)
    }

    // Confirm an irreversible delete before the engine touches disk. A single item
    // detects folder-vs-file (so the prompt names the recursion); a batch uses a count.
    private async ConfirmDelete(member: SolutionMember, paths: readonly string[]): Promise<boolean>
    {
        const message = paths.length === 1
            ? SolutionWorkspaceService.DeleteMessageFor(SolutionWorkspaceService.BaseName(paths[0]!), await this.IsFolder(member, paths[0]!))
            : SolutionWorkspaceService.DeleteBatchMessage(paths.length)
        const vm = new ConfirmDialogModel(message, SolutionWorkspaceService.DeleteConfirmLabel, (r) => this.dialogs.Close(r))
        return (await this.dialogs.Show<boolean>({
            Title: SolutionWorkspaceService.DeleteTitle, Content: vm, Width: SolutionWorkspaceService.ConfirmWidth,
        })) === true
    }

    private async IsFolder(member: SolutionMember, path: string): Promise<boolean>
    {
        const storage = member.Storage
        if (storage === undefined) return false
        const entries = await storage.List(SolutionWorkspaceService.ParentOf(path))
        return entries.find((e) => e.Name === SolutionWorkspaceService.BaseName(path))?.IsDirectory ?? false
    }

    private MemberByFolder(folder: string): SolutionMember | undefined
    {
        const target = SolutionWorkspaceService.Normalize(folder)
        return this.manager.ActiveSolution?.Members.ToArray().find(
            (m) => m.Storage !== undefined && SolutionWorkspaceService.Normalize(m.Storage.Root) === target)
    }

    // The single-item delete confirmation text — one home, shared by the count path.
    private static DeleteMessageFor(name: string, isFolder: boolean): string
    {
        return isFolder
            ? `Delete folder "${name}" and its contents? This can't be undone.`
            : `Delete "${name}"? This can't be undone.`
    }

    private static DeleteBatchMessage(count: number): string
    {
        return `Delete these ${count} items? This can't be undone.`
    }

    private static NameExistsMessage(name: string): string
    {
        return SolutionWorkspaceService.NameExistsPrefix + name + SolutionWorkspaceService.NameExistsSuffix
    }

    private static MoveSkippedMessage(count: number): string
    {
        return `Couldn't move ${count} item(s) — a name already exists at the destination.`
    }

    // The roots of a selection — paths not nested under another selected path (a folder move/
    // delete carries its descendants). Mirrors the engine's own Roots() so the confirm count
    // matches what is actually deleted.
    private static Roots(paths: readonly string[]): string[]
    {
        return paths.filter((path) => !paths.some((p) => p !== path && path.startsWith(p + SolutionWorkspaceService.Separator)))
    }

    // The open-dialog filters for importing: one entry per factory format plus an
    // All-files catch-all — a guide, not a restriction (no leading dot).
    private static ImportFilters(formats: readonly ProjectFileFormat[]): FileFilter[]
    {
        const known = formats.map((f) => ({ Name: f.displayName, Extensions: [f.extension.replace(/^\./, '')] }))
        return [...known, { Name: SolutionWorkspaceService.AllFilesFilterName, Extensions: [SolutionWorkspaceService.AllFilesExtension] }]
    }

    // Map plexus-core's VersionPart onto the engine's (identical string values, but
    // nominally distinct enums).
    private static MapVersionPart(part: VersionPart): EngineVersionPart
    {
        switch (part)
        {
            case VersionPart.Major: return EngineVersionPart.Major
            case VersionPart.Minor: return EngineVersionPart.Minor
            case VersionPart.Patch: return EngineVersionPart.Patch
        }
    }

    private static Join(dir: string, name: string): string
    {
        return dir === '' ? name : dir + SolutionWorkspaceService.Separator + name
    }

    private static ParentOf(path: string): string
    {
        const i = path.lastIndexOf(SolutionWorkspaceService.Separator)
        return i === -1 ? '' : path.slice(0, i)
    }

    private static BaseName(path: string): string
    {
        const parts = path.split(/[\\/]/)
        return parts[parts.length - 1] || path
    }

    private static Normalize(p: string): string
    {
        return p.replace(/\\/g, SolutionWorkspaceService.Separator).replace(/\/+$/, '')
    }

    // A document that can scroll to + select a span (the CodeDocument does). Duck-
    // typed so this stays decoupled from the code-editor module.
    private static IsRevealable(doc: unknown): doc is { RequestReveal(line: number, column: number): void }
    {
        return typeof (doc as Partial<{ RequestReveal: unknown }>).RequestReveal === 'function'
    }
}

export default SolutionWorkspaceService
