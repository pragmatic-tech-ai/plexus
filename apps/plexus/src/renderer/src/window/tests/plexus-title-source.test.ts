import { describe, expect, test } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { PlexusTitleSource } from '../plexus-title-source.js'
import { FakeSolutionManager } from '../../services/solution/tests/fake-solution-manager.js'

class Fixture
{
    public static Make(): { manager: FakeSolutionManager; source: PlexusTitleSource }
    {
        const manager = new FakeSolutionManager()
        const provider = new ServiceProvider()
        manager.RegisterOn(provider)
        return { manager, source: new PlexusTitleSource(provider) }
    }
}

describe('PlexusTitleSource', () => {
    test('firstProjectName is the first resolved member project name', () => {
        const { manager, source } = Fixture.Make()
        expect(source.firstProjectName()).toBeUndefined()
        manager.AddUnresolved('/pending')
        manager.AddResolved({ RootPath: '/a', Name: 'Alpha' })
        manager.AddResolved({ RootPath: '/b', Name: 'Beta' })
        expect(source.firstProjectName()).toBe('Alpha')
    })

    test('subscribe notifies on member changes and stops after unsubscribe', () => {
        const { manager, source } = Fixture.Make()
        let n = 0
        const off = source.subscribe(() => { n++ })
        manager.AddResolved({ RootPath: '/a', Name: 'Alpha' })
        expect(n).toBeGreaterThan(0)
        off()
        n = 0
        manager.AddResolved({ RootPath: '/b', Name: 'Beta' })
        expect(n).toBe(0)
    })
})
