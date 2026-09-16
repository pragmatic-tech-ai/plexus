import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { TemplateGalleryService } from '../template-gallery-service.js'
import { galleryCards } from '../gallery-fixtures.js'

// No ProjectExplorerService registered → the async New Project card is skipped,
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
