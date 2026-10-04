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
// Scope note (PE retirement): this coexists with ProjectExplorerService — both
// implement IContentMutations in parallel until the Solution Explorer is rewired
// onto this one (a later task). It does NOT own OpenProjects / Open·New-project
// commands / References·Connections views; those stay on ProjectExplorerService.
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
    SolutionBaseResolver,
    SolutionManagerService,
    UniqueName,
    VersionPart as EngineVersionPart,
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
import { DocOwnership, type ReloadableDocument } from './doc-ownership.js'
import {
    MemberContentOps,
    ReferenceEditor,
    ProjectLifecycle,
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
    // at mount (same reason ProjectExplorerService defers its wiring).
    private memberOps: MemberProjectOps | undefined
    private lifecycle: ProjectLifecycle | undefined
    // The Publish-kind background-work executor is registered once, lazily.
    private publishExecutorRegistered = false

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.docs = new DocOwnership(this.Provider)
    }

    // ── collaborators (lazy) ────────────────────────────────────────────────
    private get manager(): SolutionManagerService { return this.Provider.getRequired(SolutionManagerService.Key) }
    private get resolver(): SolutionBaseResolver { return this.Provider.getRequired(SolutionBaseResolver.Key) }
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

    private get projects(): ProjectLifecycle
    {
        // Session pruning on close is left to the parallel ProjectExplorerService (it owns
        // OpenProjectsStore); passing no session here avoids a double-remove with a
        // differently-normalized key while the two implementers coexist (PE retirement).
        return (this.lifecycle ??= new ProjectLifecycle(this.Provider, this.manager))
    }

    // ── IContentMutations: file/folder ──────────────────────────────────────
    public async RenameMemberFile(member: SolutionMember, path: string, newName: string): Promise<void>
    {
        // Engine renames on storage and fires OnMoved on success → tabs re-point.
        await new MemberContentOps(member, this).Rename(path, newName)
    }

    public async DeleteMemberFiles(member: SolutionMember, paths: readonly string[]): Promise<void>
    {
        const real = paths.filter((p) => p !== '')   // the project root ('') is never deletable
        if (real.length === 0) return
        // The irreversible delete confirm is the UI's; the engine Delete then calls
        // CanRemove (dirty-tab guard) BEFORE touching disk, then OnRemoved after.
        if (!(await this.ConfirmDelete(member, real))) return
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
        // OnMoved per moved path → tabs re-point.
        await new MemberContentOps(member, this).Move(paths, destPath)
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
    public async OpenMemberFile(member: SolutionMember, path: string, kind: ProjectNodeKind): Promise<void>
    {
        if (kind === ProjectNodeKind.Folder) return
        const storage = member.Storage
        if (storage === undefined) return
        const doc = await this.docs.OpenFile(member, path)
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

    // The open reloadable document whose resolved OS path matches `absPath` — the
    // file-watch editor-reload consumer.
    public FindOpenCodeDocByOsPath(absPath: string): ReloadableDocument | undefined
    {
        return this.docs.FindOpenCodeDocByOsPath(absPath)
    }

    // ── publish helpers (ported from ProjectExplorerService, member-keyed) ────
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
            payload: async (ctx) => PublishFailure.Guard(await build.Publish(storage, new BuildProgressReporter(ctx))),
        })
        return done.catch((e) =>
        {
            if (e instanceof PublishFailure) return e.Outcome
            throw e
        })
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
