import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { PublishedBasesKey } from '../../../../projects/index.js'
import { StorageService } from '../../../storage/index.js'
import { ProjectCommandsService } from '../project-commands-service.js'

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
})
