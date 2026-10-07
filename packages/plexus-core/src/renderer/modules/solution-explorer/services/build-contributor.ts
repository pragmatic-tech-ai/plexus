import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext, type ICommandContributor } from '@pragmatic-tech-ai/mural/framework'
import { BuildService, type SolutionMember } from '@pragmatic-tech-ai/todl'
import type { IStorage, ILocalFileAccess } from '@pragmatic-tech-ai/todl-runtime'
import { PROJECT_MANIFEST_FILENAME } from '../../../projects/project-factory.js'
import { FileTreeContributor } from './file-tree-contributor.js'
import { BuildProgressReporter } from './build-progress-reporter.js'
import { BackgroundWorkService } from '../../background-work/index.js'
import type { IContentMutations } from './content-mutations.js'
import type { IBuildClient } from '../../build/index.js'
import type { BuildApplicable } from '../../../../shared/build-api.js'

// Contributes the Build ▸ / Publish commands to a project (member) row. Build runs
// BuildService.Build for a chosen build-system flavor as a background-work task (its
// IBuildProgress maps onto the task through BuildProgressReporter); Publish delegates to
// SolutionWorkspaceService's publish path (IContentMutations.PublishMember),
// which itself runs BuildService.Publish through background-work. An action-only
// contributor (Contribute yields no nodes — the rows are ProjectsProvider's);
// the applicable systems/flavors are queried per open by BuildFlavorSubmenuContributor, so
// the submenu is rebuilt each time with no availability signal. Solution-wide Build All /
// Publish All is deferred (SolutionBuildManager is node-only — never imported here).
//
// DR8 (type-Key gating) — PARTIAL: Build ▸ / Publish are tagged with the generic
// HierarchyContext.For(NodeKey.Project), so they appear on every project row; the Build ▸
// flavor submenu resolves the applicable (system, flavor) pairs per open and shows
// "(nothing to build)" when none apply, and Publish stays gated by IsVersionedMember.
// Suppressing the top-level Build/Publish entirely for a type with no applicable system needs
// either a mural per-item action-availability signal or per-project-type node Keys (all rows
// share NodeKey.Project today) — neither exists in 0.61.1; deferred to Wave 5.
export class BuildContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<BuildContributor>('BuildContributor')

    public static readonly BuildMenuId = 'build.menu'
    public static readonly PublishId = 'build.publish'
    // Child-command id scheme for one (build-system, flavor) pair. '::' never occurs in a
    // build-system / flavor id, so split is unambiguous.
    private static readonly RunPrefix = 'build.run'
    private static readonly IdSeparator = '::'

    private static readonly BuildMenuLabel = 'Build'
    private static readonly PublishLabel = 'Publish'
    private static readonly BuildTitlePrefix = 'Building '
    private static readonly BuildFailedPrefix = 'Build failed: '
    // The empty path resolves to the storage root (the project directory itself).
    private static readonly RootMarker = ''
    private static runSeq = 0

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 20

    // The project-row build commands, Context-tagged to NodeKey.Project; passed to
    // HierarchyContributorRegistry.RegisterInstance(this, this.Actions) at rebuild() (the
    // runtime-dep ctor keeps this off the module DSL path). The Build ▸ header lazily fills
    // its flavor submenu from BuildFlavorSubmenuContributor.
    public readonly Actions: readonly CommandDefinition[]

    constructor(
        private readonly buildClient: IBuildClient,
        private readonly work: BackgroundWorkService | undefined,
        private readonly mutations: IContentMutations,
        // The flavor submenu contributor, warmed at context-menu open so the Build ▸ children are
        // ready before the submenu opens. Optional — absent in headless/unit contexts.
        private readonly submenu: BuildFlavorSubmenuContributor | undefined = undefined)
    {
        const buildMenu = BuildContributor.command(BuildContributor.BuildMenuId, BuildContributor.BuildMenuLabel, 50, true)
        buildMenu.ChildrenContributor = BuildFlavorSubmenuContributor.Key
        this.Actions = [
            buildMenu,
            BuildContributor.command(BuildContributor.PublishId, BuildContributor.PublishLabel, 51),
        ]
    }

    public static BuildRunId(systemId: string, flavorId: string): string
    {
        return [BuildContributor.RunPrefix, systemId, flavorId].join(BuildContributor.IdSeparator)
    }

    private static ParseBuildRun(commandId: string): { systemId: string; flavorId: string } | undefined
    {
        const parts = commandId.split(BuildContributor.IdSeparator)
        if (parts.length !== 3 || parts[0] !== BuildContributor.RunPrefix) return undefined
        return { systemId: parts[1], flavorId: parts[2] }
    }

    private static command(id: string, title: string, order: number, separatorBefore = false): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        def.Order = order
        def.Context = HierarchyContext.For(NodeKey.Project)
        def.SeparatorBefore = separatorBefore
        return def
    }

    // No node production — the member rows belong to ProjectsProvider.
    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return undefined
        if (commandId === BuildContributor.PublishId)
        {
            return new RelayCommand(() => void this.mutations.PublishMember(member), () => this.mutations.IsVersionedMember(member))
        }
        if (commandId === BuildContributor.BuildMenuId)
        {
            // The submenu header: always openable; the flavor children do the work. Resolving the
            // header happens at context-menu open, so warm the flavor submenu's manifest cache now
            // — the read finishes before the hover-dwell opens the submenu, so its first open shows
            // the real build rows rather than a "Loading…" placeholder.
            this.submenu?.Warm(member)
            return new RelayCommand(() => {}, () => true)
        }
        const placeholder = BuildFlavorSubmenuContributor.PlaceholderCommand(commandId)
        if (placeholder !== undefined) return placeholder
        const run = BuildContributor.ParseBuildRun(commandId)
        if (run === undefined) return undefined
        return new RelayCommand(() => this.runBuild(member, run.systemId, run.flavorId), () => this.work !== undefined)
    }

    // Build the member through the IBuildClient (main process) for the chosen flavor as a background-work task;
    // the task's row + output log surface progress (via BuildProgressReporter). A build that
    // fails its diagnostics throws so the task row shows the failure text.
    private runBuild(member: SolutionMember, systemId: string, flavorId: string): void
    {
        const work = this.work
        const storage = member.Storage
        if (work === undefined || storage === undefined) return
        const projectRoot = BuildContributor.ProjectRoot(storage)
        const title = `${BuildContributor.BuildTitlePrefix}${member.Title}`
        void work.run(title, async (ctx) =>
        {
            const runId = BuildContributor.NewRunId()
            const sub = this.buildClient.OnProgress(runId, new BuildProgressReporter(ctx))
            try
            {
                const result = await this.buildClient.Build({ runId, projectRoot, systemId, flavorId })
                if (!result.Ok)
                {
                    throw new Error(`${BuildContributor.BuildFailedPrefix}${BuildService.FormatErrors(result.Diagnostics as Parameters<typeof BuildService.FormatErrors>[0])}`)
                }
                return result
            }
            finally
            {
                sub.dispose()
            }
        })
    }

    // The project's OS root directory, via the storage's local-file access.
    private static ProjectRoot(storage: IStorage): string
    {
        return (storage as unknown as ILocalFileAccess).ResolveOsPath(BuildContributor.RootMarker)
    }

    private static NewRunId(): string
    {
        return `${Date.now().toString(36)}-${(BuildContributor.runSeq++).toString(36)}`
    }
}

// The lazy submenu under Build ▸: at each open it asks the composed build-system registry
// which systems apply to the member's manifest and yields one command per (system, flavor).
// Only the parsed MANIFEST is cached per member (async read, a Loading… row until the next
// open fills it) — the applicable systems/flavors are re-queried from the registry on EVERY
// open, so a build system registered mid-session appears the next time the submenu opens (it
// would never appear if the computed rows were cached for the service's life). The child ids
// are resolved back to a build by BuildContributor.Resolve (via the routing-dispatcher fallback).
export class BuildFlavorSubmenuContributor implements ICommandContributor
{
    public static readonly Key = new ServiceKey<BuildFlavorSubmenuContributor>('BuildFlavorSubmenuContributor')

    private static readonly EmptyId = 'build.submenu.empty'
    private static readonly LoadingId = 'build.submenu.loading'
    private static readonly NothingToBuildLabel = '(nothing to build)'
    private static readonly LoadingLabel = 'Loading…'

    // Cache the parsed manifest only; `null` records a read/parse failure (a member that never
    // builds) so a failed read is not retried every open. Rows are recomputed from the live
    // registry each open. `loading` guards an in-flight read so concurrent Warm/Contribute calls
    // for the same member start the read once.
    private readonly applicable = new Map<SolutionMember, readonly BuildApplicable[] | null>()
    private readonly loading = new Set<SolutionMember>()

    constructor(private readonly buildClient: IBuildClient | undefined)
    {
    }

    // Begin reading + parsing a member's manifest into the per-member cache unless it is already
    // loaded or in flight — idempotent, fire-and-forget. Called at context-menu open (the Build ▸
    // header resolves then, see BuildContributor.Resolve) so the flavor children are ready by the
    // time the hover-dwell opens the submenu: the first Contribute hits a warm cache and renders
    // the real rows instead of a "Loading…" placeholder that only filled on the NEXT open.
    public Warm(member: SolutionMember): void
    {
        if (this.applicable.has(member) || this.loading.has(member)) return
        const storage = member.Storage
        const client = this.buildClient
        if (storage === undefined || client === undefined) return
        this.loading.add(member)
        void (async () =>
        {
            try
            {
                const text = await storage.ReadText(PROJECT_MANIFEST_FILENAME)
                this.applicable.set(member, await client.Applicable(text))
            }
            catch
            {
                this.applicable.set(member, null)
            }
            finally
            {
                this.loading.delete(member)
            }
        })()
    }

    public Contribute(_parent: CommandDefinition, context: CommandContext): readonly CommandDefinition[]
    {
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return []
        if (this.buildClient === undefined || member.Storage === undefined) return []
        const rows = this.applicable.get(member)
        if (rows === undefined)
        {
            // Not warmed yet (menu opened faster than the read) — kick it off and show Loading…;
            // it fills on the next open, and pre-warming at header-resolve makes this rare.
            this.Warm(member)
            return [BuildFlavorSubmenuContributor.row(BuildFlavorSubmenuContributor.LoadingId, BuildFlavorSubmenuContributor.LoadingLabel)]
        }
        if (rows === null) return [BuildFlavorSubmenuContributor.row(BuildFlavorSubmenuContributor.EmptyId, BuildFlavorSubmenuContributor.NothingToBuildLabel)]
        return BuildFlavorSubmenuContributor.rowsFor(rows)
    }

    private static rowsFor(applicable: readonly BuildApplicable[]): readonly CommandDefinition[]
    {
        const rows = applicable.map((a) => BuildFlavorSubmenuContributor.row(BuildContributor.BuildRunId(a.systemId, a.flavorId), a.flavorName))
        if (rows.length === 0) return [BuildFlavorSubmenuContributor.row(BuildFlavorSubmenuContributor.EmptyId, BuildFlavorSubmenuContributor.NothingToBuildLabel)]
        return rows
    }

    private static row(id: string, title: string): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        return def
    }

    // The disabled command backing a placeholder (Loading… / nothing-to-build) row.
    public static PlaceholderCommand(commandId: string): ICommand | undefined
    {
        if (commandId === BuildFlavorSubmenuContributor.EmptyId || commandId === BuildFlavorSubmenuContributor.LoadingId)
        {
            return new RelayCommand(() => {}, () => false)
        }
        return undefined
    }
}

export default BuildContributor
