import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { ConceptGenerationResult, IProjectModelProvider, ProjectManifest } from '@pragmatic-tech-ai/todl'
import type { IConceptSelection } from './concept-selection.js'
import type { IGenerationReporter } from './generate-ui-report.js'

// The slice of TODL's ConceptUiGenerationService the command drives (satisfied by it).
export interface IConceptUiGenerationService
{
    GenerateFor(
        project: IStorage, manifest: ProjectManifest,
        model: IProjectModelProvider, concept: string): Promise<ConceptGenerationResult>
}

// Supplies the compile seam (IProjectModelProvider) for a project.
export interface IProjectModelProviderFactory
{
    For(project: IStorage, manifest: ProjectManifest): IProjectModelProvider
}

// Reads the project's manifest.
export interface IManifestReader
{
    Read(project: IStorage): Promise<ProjectManifest>
}

// The Generate UI handler: pick a concept, run the generation service against the project,
// and report what was written / skipped.
export class GenerateUiCommand
{
    public constructor(
        private readonly selection: IConceptSelection,
        private readonly service: IConceptUiGenerationService,
        private readonly models: IProjectModelProviderFactory,
        private readonly manifests: IManifestReader,
        private readonly reporter: IGenerationReporter) {}

    public async Run(project: IStorage, projectTitle: string): Promise<void>
    {
        const concept = await this.selection.Select(projectTitle)
        if (concept === undefined) return
        try
        {
            const manifest = await this.manifests.Read(project)
            const result = await this.service.GenerateFor(project, manifest, this.models.For(project, manifest), concept)
            await this.reporter.Report(concept, result)
        }
        catch (error)
        {
            await this.reporter.ReportFailure(concept, error)
        }
    }
}
