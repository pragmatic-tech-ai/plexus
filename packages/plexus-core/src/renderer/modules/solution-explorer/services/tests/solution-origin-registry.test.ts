import { describe, it, expect } from 'vitest'
import { Solution } from '@pragmatic-tech-ai/todl'
import { TargetSource, type TargetRef } from '../../../../../shared/account-api.js'
import { DevEnvironmentLocation } from '../../../storage/dev-environment-location.js'
import { RemoteFileStorage, type IDevStorageSession } from '../../../storage/remote-file-storage.js'
import { SolutionOriginRegistry } from '../solution-origin-registry.js'

class RegistryRig
{
    public static readonly Ref: TargetRef = { Name: 'dev', Source: TargetSource.Console }

    public static Remote(root: string): Solution
    {
        return new Solution(root, new RemoteFileStorage({} as IDevStorageSession, root))
    }
}

describe('SolutionOriginRegistry expected open', () =>
{
    it('gives the expected origin to the first remote solution rooted at the expected location', () =>
    {
        const registry = new SolutionOriginRegistry()
        registry.ExpectOpen(DevEnvironmentLocation.Build('dev', 'orders'), RegistryRig.Ref, 'orders')
        const solution = RegistryRig.Remote('orders')
        expect(registry.Get(solution)?.EnvironmentName).toBe('dev')
        // Adopted once and keyed by the solution itself from then on.
        expect(registry.Get(solution)?.SolutionName).toBe('orders')
        expect(registry.Get(RegistryRig.Remote('orders'))).toBeUndefined()
    })

    it('ignores local solutions and other remote roots, and a cancelled expectation', () =>
    {
        const registry = new SolutionOriginRegistry()
        registry.ExpectOpen(DevEnvironmentLocation.Build('dev', 'orders'), RegistryRig.Ref, 'orders')
        expect(registry.Get(new Solution('orders'))).toBeUndefined()
        expect(registry.Get(RegistryRig.Remote('billing'))).toBeUndefined()
        registry.CancelExpected()
        expect(registry.Get(RegistryRig.Remote('orders'))).toBeUndefined()
    })
})
