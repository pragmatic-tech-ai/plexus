import { describe, it, expect } from 'vitest'
import { ConnectionProviderIcon } from '../connection-provider-icon.js'

describe('ConnectionProviderIcon.For', () =>
{
    it('identifies a GitHub Packages registry by host', () =>
    {
        expect(ConnectionProviderIcon.For({ registry: 'https://npm.pkg.github.com' })).toBe('github')
        expect(ConnectionProviderIcon.For({ registry: 'https://npm.pkg.github.com/@acme' })).toBe('github')
    })

    it('returns no provider for a custom / public registry', () =>
    {
        expect(ConnectionProviderIcon.For({ registry: 'https://registry.npmjs.org' })).toBe('')
        expect(ConnectionProviderIcon.For({ registry: 'https://npm.internal.example' })).toBe('')
    })

    it('returns no provider when the registry is missing, empty, or unparseable', () =>
    {
        expect(ConnectionProviderIcon.For(undefined)).toBe('')
        expect(ConnectionProviderIcon.For({})).toBe('')
        expect(ConnectionProviderIcon.For({ registry: '' })).toBe('')
        expect(ConnectionProviderIcon.For({ registry: 'not a url' })).toBe('')
    })
})
