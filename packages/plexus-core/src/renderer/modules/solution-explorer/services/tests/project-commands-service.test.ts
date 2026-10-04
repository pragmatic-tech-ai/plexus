import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { PublishedBasesKey } from '../../../../projects/index.js'
import { SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { OpenProjectsStore } from '../../../../projects/open-projects-store.js'
import { RecentProjectsService } from '../../../../projects/recent-projects-service.js'
import { StorageService } from '../../../storage/index.js'
import { ProjectCommandsService } from '../project-commands-service.js'
import { NewProjectDialogModel, ProjectTypeChoice } from '../../../../projects/new-project-dialog-model.js'

describe('ProjectCommandsService', () =>
{
    it('exposes the Open / New project commands the command bar binds to', () =>
    {
        const svc = new ProjectCommandsService(new ServiceProvider())
        expect(svc.OpenProjectCommand).toBeDefined()
        expect(svc.NewProjectCommand).toBeDefined()
    })

    it('CreateProject refuses a folder that already holds a project (no engine call)', async () =>
    {
        const provider = new ServiceProvider()
        provider.registerInstance(StorageService.Key, { Create: () => ({ Exists: async () => true }) } as never)
        provider.registerInstance(PublishedBasesKey, { ListMetaModels: async () => [], ListLibraries: async () => [] } as never)
        const svc = new ProjectCommandsService(provider)
        const outcome = await svc.CreateProject({ type: 'architecture', name: 'p', location: '/work' })
        expect(outcome.created).toBe(false)
        expect(outcome.error).toBe('That folder already contains a project.')
    })

    it('RestoreSession reopens every folder in the session store via the engine lifecycle', async () =>
    {
        const opened: string[] = []
        const provider = new ServiceProvider()
        provider.registerInstance(OpenProjectsStore.Key, {
            List: async () => ['/work/a', '/work/b'], Add: async () => {}, Remove: async () => {},
        } as never)
        provider.registerInstance(RecentProjectsService.Key, { Add: async () => {} } as never)
        provider.registerInstance(SolutionManagerService.StorageRegistryKey, {
            CreateStorage: () => ({ Exists: async () => true }),
        } as never)
        provider.registerInstance(SolutionManagerService.Key, {
            OpenProject: async (folder: string) => { opened.push(folder); return {} },
        } as never)
        await new ProjectCommandsService(provider).RestoreSession()
        expect(opened).toEqual(['/work/a', '/work/b'])
    })

    it('ApplyPrefill sets name/location and selects the matching type', () =>
    {
        const form = ProjectCommandsServiceTestForms.Plain(['diagram', 'library'])
        ProjectCommandsService.ApplyPrefill(form, { name: 'Acme', location: 'C:/acme', type: 'library' })
        expect(form.Name).toBe('Acme')
        expect(form.Location).toBe('C:/acme')
        expect(form.SelectedType?.Type).toBe('library')
    })

    it('ApplyPrefill ignores an unknown type and missing fields', () =>
    {
        const form = ProjectCommandsServiceTestForms.Plain(['diagram'])
        ProjectCommandsService.ApplyPrefill(form, { type: 'nope' })
        expect(form.SelectedType?.Type).toBe('diagram')
        expect(form.Name).toBe('')
    })

    it('ApplyPrefill selects the prefilled meta-model and checks the prefilled libraries', () =>
    {
        const form = ProjectCommandsServiceTestForms.Arch()
        ProjectCommandsService.ApplyPrefill(form, {
            type: 'architecture',
            metaModels: [{ id: 'tech-architecture', version: '0.1.0' }],
            libraries: [{ id: 'microsoft', version: '0.1.0' }],
        })
        expect(form.SelectedMetaModels).toEqual([{ id: 'tech-architecture', version: '0.1.0' }])
        expect(form.SelectedLibraries).toEqual([{ id: 'microsoft', version: '0.1.0' }])
    })

    it('ApplyPrefill ignores meta-model/library refs not among the published choices', () =>
    {
        const form = ProjectCommandsServiceTestForms.Arch()
        ProjectCommandsService.ApplyPrefill(form, {
            type: 'architecture',
            metaModels: [{ id: 'nope', version: '9' }],
            libraries: [{ id: 'ghost', version: '1' }],
        })
        expect(form.SelectedMetaModels).toEqual([])
        expect(form.SelectedLibraries).toEqual([])
    })
})

// Inert-stub New Project forms (fs/validate/close are unused by ApplyPrefill).
class ProjectCommandsServiceTestForms
{
    public static Plain(types: string[]): NewProjectDialogModel
    {
        const choices = types.map((t) => new ProjectTypeChoice(t, t, `${t} project`))
        return new NewProjectDialogModel(choices, {} as never, async () => null, () => {})
    }

    public static Arch(): NewProjectDialogModel
    {
        const choices = [new ProjectTypeChoice('architecture', 'Architecture', 'arch project', true, true)]
        const metaModels = [{ id: 'tech-architecture', version: '0.1.0' }]
        const libraries = [{ id: 'microsoft', version: '0.1.0' }, { id: 'aws', version: '0.2.0' }]
        return new NewProjectDialogModel(choices, {} as never, async () => null, () => {}, metaModels, libraries)
    }
}
