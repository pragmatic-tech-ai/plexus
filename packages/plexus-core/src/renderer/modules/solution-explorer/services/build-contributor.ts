import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext, type ICommandContributor } from '@pragmatic-tech-ai/mural/framework'
import { BuildService, parseManifest, type BuildSystemRegistryKey, type SolutionMember } from '@pragmatic-tech-ai/todl'
import type { ILocalFileAccess } from '@pragmatic-tech-ai/todl-runtime'
import { PROJECT_MANIFEST_FILENAME } from '../../../projects/project-factory.js'
import { FileTreeContributor } from './file-tree-contributor.js'
import { BuildProgressReporter } from './build-progress-reporter.js'
import { BackgroundWorkService } from '../../background-work/index.js'
import type { IContentMutations } from './content-mutations.js'

// Contributes the Build ▸ / Publish commands to a project (member) row. Build dispatches the
// chosen build-system flavor through the in-renderer BuildService as a background-work task
// (its progress maps onto the task through BuildProgressReporter); Publish delegates to
// SolutionWorkspaceService's publish path (IContentMutations.PublishMember),
// which itself runs BuildService.Publish through background-work. An action-only
// contributor (Contribute yields no nodes — the rows are ProjectsProvider's);
// the applicable systems/flavors come from BuildFlavorSubmenuContributor (cached per member from
// BuildSystemRegistry.For), so there is no availability signal. Solution-wide Build All /
// Publish All is deferred (SolutionBuildManager is node-only — never imported here).
//
// DR8 (type-Key gating) — PARTIAL: Build ▸ / Publish are tagged with the generic
// HierarchyContext.For(NodeKey.Project), so they appear on every project row; the Build ▸
// flavor submenu lists the applicable (system, flavor) pairs the registry reports and shows
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
    // Build output lands in the project's own build/ dir (per OutputName under it), so each
    // project's output is isolated — without an override the engine falls back to a single
    // shared <userData>/build-output that one project's build would clobber for another.
    private static readonly BuildDir = 'build'

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 20

    // The project-row build commands, Context-tagged to NodeKey.Project; passed to
    // HierarchyContributorRegistry.RegisterInstance(this, this.Actions) at rebuild() (the
    // runtime-dep ctor keeps this off the module DSL path). The Build ▸ header lazily fills
    // its flavor submenu from BuildFlavorSubmenuContributor.
    public readonly Actions: readonly CommandDefinition[]

    constructor(
        private readonly buildService: BuildService,
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

    // Build the member through the BuildService for the chosen flavor as a background-work task;
    // the task's row + output log surface progress (via BuildProgressReporter). A build that
    // fails its diagnostics throws so the task row shows the failure text.
    private runBuild(member: SolutionMember, systemId: string, flavorId: string): void
    {
        const work = this.work
        const storage = member.Storage
        if (work === undefined || storage === undefined) return
        const title = `${BuildContributor.BuildTitlePrefix}${member.Title}`
        void work.run(title, async (ctx) =>
        {
            // Ensure the project's generated content exists before the build requires it — a
            // project opened before its bases were published never regenerated, so without this
            // the build fails its "generated/… is missing" check even though the bases now resolve.
            await this.mutations.EnsureMemberGenerated(member)
            const options = { OutputRootOverride: BuildContributor.ProjectBuildDir(storage) }
            const result = await this.buildService.Build(storage, systemId, flavorId, new BuildProgressReporter(ctx), options)
            if (!result.Result.Ok)
            {
                throw new Error(`${BuildContributor.BuildFailedPrefix}${BuildService.FormatErrors(result.Result.Diagnostics)}`)
            }
            return result
        })
    }

    // The project's build/ output dir (OS path), via the storage's local-file access — the
    // same per-project build root HtmlAppContributor.OutputRoot uses.
    private static ProjectBuildDir(storage: SolutionMember['Storage']): string
    {
        return (storage as unknown as ILocalFileAccess).ResolveOsPath(BuildContributor.BuildDir)
    }
}

// The renderer-composed registry the BuildSystemRegistryKey resolves (generic args fixed by todl).
type FlavorRegistry = typeof BuildSystemRegistryKey extends { readonly __service_type__: infer R } ? R : never

// One applicable (build-system, flavor) pair shown as a Build ▸ submenu row.
interface FlavorRow
{
    systemId: string
    systemName: string
    flavorId: string
    flavorName: string
}

// The lazy submenu under Build ▸: it reads the member's manifest text, asks the BuildSystemRegistry which
// (system, flavor) pairs apply (locally, via For) and yields one command per pair. The rows are
// cached per member (async read, a Loading… row until warmed). The child ids
// are resolved back to a build by BuildContributor.Resolve (via the routing-dispatcher fallback).
export class BuildFlavorSubmenuContributor implements ICommandContributor
{
    public static readonly Key = new ServiceKey<BuildFlavorSubmenuContributor>('BuildFlavorSubmenuContributor')

    private static readonly EmptyId = 'build.submenu.empty'
    private static readonly LoadingId = 'build.submenu.loading'
    private static readonly NothingToBuildLabel = '(nothing to build)'
    private static readonly LoadingLabel = 'Loading…'

    // Applicable rows cached per member for the service's life; `null` records a read/query
    // failure (a member that never builds) so it is not retried every open. Rows are NOT
    // re-queried on a mid-session manifest edit — build systems are fixed at composition, so no
    // invalidation is needed. `loading` guards an in-flight read so concurrent Warm/Contribute
    // calls for the same member start it once.
    private readonly applicable = new Map<SolutionMember, readonly FlavorRow[] | null>()
    private readonly loading = new Set<SolutionMember>()

    constructor(private readonly registry: FlavorRegistry | undefined)
    {
    }

    // Begin reading a member's manifest and computing the registry's applicable rows into the per-member cache unless it is already
    // loaded or in flight — idempotent, fire-and-forget. Called at context-menu open (the Build ▸
    // header resolves then, see BuildContributor.Resolve) so the flavor children are ready by the
    // time the hover-dwell opens the submenu: the first Contribute hits a warm cache and renders
    // the real rows instead of a "Loading…" placeholder that only filled on the NEXT open.
    public Warm(member: SolutionMember): void
    {
        if (this.applicable.has(member) || this.loading.has(member)) return
        const storage = member.Storage
        const registry = this.registry
        if (storage === undefined || registry === undefined) return
        this.loading.add(member)
        void (async () =>
        {
            try
            {
                const text = await storage.ReadText(PROJECT_MANIFEST_FILENAME)
                this.applicable.set(member, BuildFlavorSubmenuContributor.RowsFrom(registry, text))
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
        if (this.registry === undefined || member.Storage === undefined) return []
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

    // The (system, flavor) rows the registry reports for a manifest. parseManifest throws on bad
    // JSON; Warm's catch records that as a member that never builds.
    private static RowsFrom(registry: FlavorRegistry, text: string): readonly FlavorRow[]
    {
        const manifest = parseManifest(text)
        const rows: FlavorRow[] = []
        for (const system of registry.For(manifest))
        {
            for (const flavor of system.Flavors())
            {
                rows.push({ systemId: system.Id, systemName: system.DisplayName, flavorId: flavor.Id, flavorName: flavor.DisplayName })
            }
        }
        return rows
    }

    private static rowsFor(applicable: readonly FlavorRow[]): readonly CommandDefinition[]
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
