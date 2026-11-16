import { describe, it, expect } from 'vitest'
import type { ConnectionProvider } from '@pragmatic-tech-ai/todl/package-manager/connections'
import { ConnectionProviderMap } from '../connection-provider-map.js'

class Fixtures
{
    public static readonly GithubUrl = 'https://npm.pkg.github.com'

    public static Providers(): ConnectionProvider[]
    {
        return [
            { RegistryType: 'npm', PresetId: 'github', DisplayName: 'GitHub Packages', Settings: { registry: Fixtures.GithubUrl, githubApi: 'https://api.github.com' } },
            { RegistryType: 'file', PresetId: 'local', DisplayName: 'Local Directory', Settings: { directory: 'C:/packages' } }
        ]
    }
}

describe('ConnectionProviderMap', () =>
{
    it('matches an existing GitHub registry URL to its provider label', () =>
    {
        const map = new ConnectionProviderMap(Fixtures.Providers())
        expect(map.LabelForSettings({ registry: Fixtures.GithubUrl })).toBe('GitHub Packages')
    })

    it('unmatched registry URL resolves to Custom', () =>
    {
        const map = new ConnectionProviderMap(Fixtures.Providers())
        expect(map.LabelForSettings({ registry: 'https://example.com' })).toBe(ConnectionProviderMap.CustomLabel)
    })

    it('SettingsFor GitHub includes githubApi, Custom is undefined', () =>
    {
        const map = new ConnectionProviderMap(Fixtures.Providers())
        expect(map.SettingsFor('GitHub Packages')?.githubApi).toBe('https://api.github.com')
        expect(map.SettingsFor(ConnectionProviderMap.CustomLabel)).toBeUndefined()
        expect(map.SettingsFor('nope')).toBeUndefined()
    })

    it('Local Directory provider matches on directory setting', () =>
    {
        const map = new ConnectionProviderMap(Fixtures.Providers())
        expect(map.LabelForSettings({ directory: 'C:/packages' })).toBe('Local Directory')
    })

    it('registry takes precedence over directory', () =>
    {
        const map = new ConnectionProviderMap(Fixtures.Providers())
        expect(map.LabelForSettings({ registry: Fixtures.GithubUrl, directory: 'C:/packages' })).toBe('GitHub Packages')
    })

    it('empty provider list gives Labels() of just Custom', () =>
    {
        expect(new ConnectionProviderMap([]).Labels()).toEqual([ConnectionProviderMap.CustomLabel])
    })

    it('SettingsFor returns a copy', () =>
    {
        const map = new ConnectionProviderMap(Fixtures.Providers())
        const first = map.SettingsFor('GitHub Packages')!
        first.registry = 'mutated'
        expect(map.SettingsFor('GitHub Packages')!.registry).toBe(Fixtures.GithubUrl)
    })

    it('de-duplicates repeated display names', () =>
    {
        const p = Fixtures.Providers()
        const dup: ConnectionProvider[] = [p[0], { ...p[0], PresetId: 'b', Settings: { registry: 'https://b' } }, { ...p[0], PresetId: 'c', Settings: { registry: 'https://c' } }]
        const map = new ConnectionProviderMap(dup)
        expect(map.Labels()).toEqual(['GitHub Packages', 'GitHub Packages (2)', 'GitHub Packages (3)', 'Custom'])
        expect(map.SettingsFor('GitHub Packages (2)')?.registry).toBe('https://b')
        expect(map.LabelForSettings({ registry: 'https://c' })).toBe('GitHub Packages (3)')
    })
})
