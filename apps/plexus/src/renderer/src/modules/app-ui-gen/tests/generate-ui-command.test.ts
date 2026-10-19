import { test, expect } from 'vitest'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { ConceptGenerationResult, IProjectModelProvider, ProjectManifest } from '@pragmatic-tech-ai/todl'
import { GenerateUiCommand, type IConceptUiGenerationService, type IManifestReader, type IProjectModelProviderFactory } from '../services/generate-ui-command.js'
import type { IConceptSelection } from '../services/concept-selection.js'
import { DialogGenerationReporter, type IGenerationReporter } from '../services/generate-ui-report.js'

class FakeSelection implements IConceptSelection
{
    public constructor(private readonly concept: string | undefined) {}
    public Select(): Promise<string | undefined> { return Promise.resolve(this.concept) }
}

class FakeService implements IConceptUiGenerationService
{
    public readonly Calls: { project: IStorage, manifest: ProjectManifest, model: IProjectModelProvider, concept: string }[] = []
    public constructor(private readonly result: ConceptGenerationResult | Error) {}
    public async GenerateFor(project: IStorage, manifest: ProjectManifest, model: IProjectModelProvider, concept: string): Promise<ConceptGenerationResult>
    {
        this.Calls.push({ project, manifest, model, concept })
        if (this.result instanceof Error) throw this.result
        return this.result
    }
}

class FakeReporter implements IGenerationReporter
{
    public readonly Reports: { concept: string, result: ConceptGenerationResult }[] = []
    public readonly Failures: { concept: string, error: unknown }[] = []
    public async Report(concept: string, result: ConceptGenerationResult): Promise<void> { this.Reports.push({ concept, result }) }
    public async ReportFailure(concept: string, error: unknown): Promise<void> { this.Failures.push({ concept, error }) }
}

class Fixtures
{
    public readonly Project = { Root: 'C:/p' } as unknown as IStorage
    public readonly Manifest = { name: 'acme', type: 'html-app' } as unknown as ProjectManifest
    public readonly Model = {} as IProjectModelProvider
    public readonly Result: ConceptGenerationResult = {
        Written: ['src/ui/Customer/list.mu', 'src/ui/Customer/form.mu'],
        Skipped: ['src/app.mu'],
        Messages: ['src/app.mu was hand-edited; reference the generated view yourself.'],
    }
}

class FakeModels implements IProjectModelProviderFactory
{
    public constructor(private readonly model: IProjectModelProvider) {}
    public For(): IProjectModelProvider { return this.model }
}

class FakeManifests implements IManifestReader
{
    public constructor(private readonly manifest: ProjectManifest) {}
    public Read(): Promise<ProjectManifest> { return Promise.resolve(this.manifest) }
}

test('Run generates for the selected concept and reports Written/Skipped', async () => {
    const f = new Fixtures()
    const service = new FakeService(f.Result)
    const reporter = new FakeReporter()
    await new GenerateUiCommand(new FakeSelection('acme.Customer'), service, new FakeModels(f.Model), new FakeManifests(f.Manifest), reporter).Run(f.Project, 'Acme')

    expect(service.Calls).toHaveLength(1)
    expect(service.Calls[0]).toEqual({ project: f.Project, manifest: f.Manifest, model: f.Model, concept: 'acme.Customer' })
    expect(reporter.Reports).toEqual([{ concept: 'acme.Customer', result: f.Result }])
    expect(reporter.Failures).toEqual([])
})

test('Run does nothing when no concept is chosen', async () => {
    const f = new Fixtures()
    const service = new FakeService(f.Result)
    const reporter = new FakeReporter()
    await new GenerateUiCommand(new FakeSelection(undefined), service, new FakeModels(f.Model), new FakeManifests(f.Manifest), reporter).Run(f.Project, 'Acme')

    expect(service.Calls).toEqual([])
    expect(reporter.Reports).toEqual([])
})

test('Run reports a generation failure instead of throwing', async () => {
    const f = new Fixtures()
    const boom = new Error('compile failed')
    const reporter = new FakeReporter()
    await new GenerateUiCommand(new FakeSelection('acme.Customer'), new FakeService(boom), new FakeModels(f.Model), new FakeManifests(f.Manifest), reporter).Run(f.Project, 'Acme')

    expect(reporter.Failures).toEqual([{ concept: 'acme.Customer', error: boom }])
    expect(reporter.Reports).toEqual([])
})

test('Format lists Written, lists Skipped, and appends each message', () => {
    const f = new Fixtures()
    const text = DialogGenerationReporter.Format('acme.Customer', f.Result)

    expect(text).toContain('acme.Customer')
    expect(text).toContain('2 file(s) written:')
    expect(text).toContain('  - src/ui/Customer/list.mu')
    expect(text).toContain('  - src/ui/Customer/form.mu')
    expect(text).toContain('1 file(s) skipped:')
    expect(text).toContain('  - src/app.mu')
    expect(text).toContain(f.Result.Messages[0]!)
})
