import { describe, it, expect } from 'vitest'
import type { ConnectionInspection } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connections-client.js'
import { ConnectionInspectionViewModel } from '../connection-inspection-dialog-model.js'

const FineGrained = 'Fine-grained token — no classic scopes.'
const ScopesNotExposed = 'This registry does not expose token scopes.'
const IdentityUnreadable = 'Could not read the token identity or scopes.'
const NoPackages = 'No packages are visible to this token.'
const PackagesNotSupported = 'Package listing is not supported for this registry.'

describe('ConnectionInspectionViewModel', () =>
{
    it('shows no notes for a classic token', () =>
    {
        const i: ConnectionInspection = { ok: true, identity: 'octocat', scopes: ['read:packages'], scopesSupported: true, packages: ['a'], packagesSupported: true, message: 'HTTP 200' }
        const vm = new ConnectionInspectionViewModel(i, () => {})
        expect(vm.HasIdentity).toBe(true)
        expect(vm.ScopesNote).toBe('')
        expect(vm.PackagesNote).toBe('')
    })

    it('notes a fine-grained token', () =>
    {
        const vm = new ConnectionInspectionViewModel({ ok: true, identity: 'octocat', scopes: [], scopesSupported: true, packages: ['a'], packagesSupported: true, message: '' }, () => {})
        expect(vm.ScopesNote).toBe(FineGrained)
    })

    it('notes unsupported scopes and packages for generic npm', () =>
    {
        const vm = new ConnectionInspectionViewModel({ ok: true, identity: 'alice', scopes: [], scopesSupported: false, packages: [], packagesSupported: false, message: '' }, () => {})
        expect(vm.ScopesNote).toBe(ScopesNotExposed)
        expect(vm.PackagesNote).toBe(PackagesNotSupported)
    })

    it('notes empty but supported packages', () =>
    {
        const vm = new ConnectionInspectionViewModel({ ok: true, identity: 'octocat', scopes: ['x'], scopesSupported: true, packages: [], packagesSupported: true, message: '' }, () => {})
        expect(vm.PackagesNote).toBe(NoPackages)
    })

    it('does not read a degraded identity as fine-grained', () =>
    {
        const vm = new ConnectionInspectionViewModel({ ok: true, identity: '', scopes: [], scopesSupported: true, packages: ['a'], packagesSupported: true, message: '' }, () => {})
        expect(vm.HasIdentity).toBe(false)
        expect(vm.ScopesNote).toBe(IdentityUnreadable)
        expect(vm.ScopesNote).not.toBe(FineGrained)
    })

    it('shows no section notes when not ok', () =>
    {
        const vm = new ConnectionInspectionViewModel({ ok: false, identity: '', scopes: [], scopesSupported: true, packages: [], packagesSupported: true, message: 'authentication failed: HTTP 401' }, () => {})
        expect(vm.ScopesNote).toBe('')
        expect(vm.PackagesNote).toBe('')
        expect(vm.HasIdentity).toBe(false)
        expect(vm.Message).toBe('authentication failed: HTTP 401')
    })

    it('OkCommand invokes the close callback', () =>
    {
        let closed = 0
        const vm = new ConnectionInspectionViewModel({ ok: false, identity: '', scopes: [], scopesSupported: true, packages: [], packagesSupported: true, message: '' }, () => { closed++ })
        vm.OkCommand.Execute(undefined)
        expect(closed).toBe(1)
    })
})
