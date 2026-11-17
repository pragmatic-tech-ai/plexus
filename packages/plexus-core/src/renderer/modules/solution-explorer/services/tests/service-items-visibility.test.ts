import { describe, it, expect } from 'vitest'
import { ServiceItemsVisibility } from '../service-items-visibility.js'
import { ProjectHierarchyProvider } from '../project-hierarchy-provider.js'

describe('ServiceItemsVisibility', () =>
{
    it('defaults to hidden', () =>
    {
        expect(new ServiceItemsVisibility().Show).toBe(false)
    })

    it('ShowAll() is shown', () =>
    {
        expect(ServiceItemsVisibility.ShowAll().Show).toBe(true)
    })

    it('toggles', () =>
    {
        const v = new ServiceItemsVisibility()
        v.Toggle()
        expect(v.Show).toBe(true)
        v.Toggle()
        expect(v.Show).toBe(false)
    })
})

describe('ProjectHierarchyProvider.IsHiddenServiceItem', () =>
{
    const hidden = new ServiceItemsVisibility(false)
    const shown = ServiceItemsVisibility.ShowAll()

    it('hides a dot node when the toggle is off', () =>
    {
        expect(ProjectHierarchyProvider.IsHiddenServiceItem('.claude', hidden)).toBe(true)
        expect(ProjectHierarchyProvider.IsHiddenServiceItem('.git', hidden)).toBe(true)
    })

    it('shows a dot node when the toggle is on', () =>
    {
        expect(ProjectHierarchyProvider.IsHiddenServiceItem('.claude', shown)).toBe(false)
    })

    it('never hides an ordinary node', () =>
    {
        expect(ProjectHierarchyProvider.IsHiddenServiceItem('concepts', hidden)).toBe(false)
        expect(ProjectHierarchyProvider.IsHiddenServiceItem('model.todl', hidden)).toBe(false)
    })
})
