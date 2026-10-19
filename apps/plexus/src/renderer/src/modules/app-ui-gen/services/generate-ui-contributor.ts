import { RelayCommand, ServiceBase, ServiceKey, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { DialogService, type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { FileTreeContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer'
import {
    ConceptUiGenerationService, ConceptListViewGenerator, ConceptFormGenerator, ConceptCrudViewModelGenerator,
    ProjectModelProvider, SolutionBaseResolver, SolutionManagerService, PackageStoreKey, PROJECT_MANIFEST_FILENAME,
    parseManifest, type IPackageSource, type IProjectModelProvider, type ProjectManifest,
} from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PromptConceptSelection } from './concept-selection.js'
import { DialogGenerationReporter } from './generate-ui-report.js'
import { GenerateUiCommand, type IManifestReader, type IProjectModelProviderFactory } from './generate-ui-command.js'

// A package source with nothing in it, for a host with neither a solution nor a package store.
class EmptyPackageSource implements IPackageSource
{
    public TryGet(): Promise<undefined>
    {
        return Promise.resolve(undefined)
    }
}

// Compile seam over the same package source the project-system generators use: the open
// solution's base resolver when a solution manager exists, else the published store.
class ProjectModelProviderFactory implements IProjectModelProviderFactory
{
    public constructor(private readonly provider: IServiceProvider) {}

    public For(project: IStorage, manifest: ProjectManifest): IProjectModelProvider
    {
        const p = this.provider
        const source: IPackageSource =
            p.get(SolutionManagerService.Key) !== undefined ? p.getRequired(SolutionBaseResolver.Key)
            : p.get(PackageStoreKey) ?? new EmptyPackageSource()
        return new ProjectModelProvider(project, manifest, source)
    }
}

class StorageManifestReader implements IManifestReader
{
    public async Read(project: IStorage): Promise<ProjectManifest>
    {
        return parseManifest(await project.ReadText(PROJECT_MANIFEST_FILENAME))
    }
}

// "Generate UI…" on a project row: generates list/form/CRUD view-model UI for a concept.
// Action-only (Contribute yields no nodes).
export class GenerateUiContributor extends ServiceBase implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<GenerateUiContributor>('GenerateUiContributor')
    public static readonly GenerateCommandId = 'appui.generate'

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 110

    public constructor(provider: IServiceProvider) { super(provider) }

    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        if (commandId !== GenerateUiContributor.GenerateCommandId) return undefined
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        const storage = member?.Storage
        if (member === undefined || storage === undefined) return undefined
        return new RelayCommand(() => void this.Create().Run(storage, member.Title))
    }

    private Create(): GenerateUiCommand
    {
        const p = this.Provider
        const prompts = p.getRequired(SolutionManagerService.PromptServiceKey)
        const service = new ConceptUiGenerationService([
            new ConceptListViewGenerator(), new ConceptFormGenerator(), new ConceptCrudViewModelGenerator(),
        ])
        return new GenerateUiCommand(
            new PromptConceptSelection(prompts), service, new ProjectModelProviderFactory(p),
            new StorageManifestReader(), new DialogGenerationReporter(p.getRequired(DialogService.Key)))
    }
}

export default GenerateUiContributor
