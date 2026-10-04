import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { TemplateGalleryService } from '../template-gallery-service.js'
import { galleryCards } from '../gallery-fixtures.js'
import { ProjectCommandsService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/project-commands-service.js'

// No ProjectCommandsService registered → the async New Project card is skipped,
// so the gallery holds exactly the synchronous fixtures.
test('exposes an IDockPanel identity and the fixture cards', () => {
    const svc = new TemplateGalleryService(new ServiceProvider())
    expect(svc.Id).toBe('template-gallery')
    expect(svc.Title).toBe('Card Gallery')
    expect(svc.Cards.Count).toBe(galleryCards().length)
    svc.dispose()
})

test('Dispose stops the approval-card countdown timers', () => {
    const svc = new TemplateGalleryService(new ServiceProvider())
    // Should not throw and should leave no live intervals behind.
    expect(() => svc.dispose()).not.toThrow()
})

test('adds the New Project card once ProjectCommandsService builds its form', async () => {
    const provider = new ServiceProvider()
    const form = {}
    provider.registerInstance(ProjectCommandsService.Key, { NewProjectFormFor: async () => form } as unknown as ProjectCommandsService)
    const svc = new TemplateGalleryService(provider)
    await new Promise((r) => setTimeout(r, 0))
    expect(svc.Cards.Count).toBe(galleryCards().length + 1)
    svc.dispose()
})
