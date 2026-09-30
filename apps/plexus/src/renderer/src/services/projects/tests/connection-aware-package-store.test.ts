import { describe, it, expect } from 'vitest'
import type { IPackageStore, PackageRef, SourcedPackage } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ConnectionAwarePackageStore, type IConnectionPackageResolver } from '../connection-aware-package-store.js'

// A publish PackageRef (kind/id/version); `kind` is irrelevant to the store, so it is cast.
const Ref: PackageRef = { kind: 'meta-model', id: 'acme.base', version: '1.0.0' } as unknown as PackageRef

function sourced(id: string): SourcedPackage
{
    return { Document: { id } as unknown as SourcedPackage['Document'], Dependencies: [] }
}

// Marker storage — identity-checked to prove Storage delegates to the inner store.
const InnerStorage = {} as unknown as IStorage

class FakeInner implements IPackageStore
{
    public readonly tryGetCalls: PackageRef[] = []

    constructor(private readonly hit: SourcedPackage | undefined)
    {
    }

    public get Storage(): IStorage
    {
        return InnerStorage
    }

    public TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        this.tryGetCalls.push(reference)
        return Promise.resolve(this.hit)
    }
}

class FakeResolver implements IConnectionPackageResolver
{
    public readonly calls: Array<{ consumerId: string; ref: PackageRef }> = []

    constructor(private readonly result: SourcedPackage | undefined)
    {
    }

    public ResolveFor(consumerId: string, ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        this.calls.push({ consumerId, ref })
        return Promise.resolve(this.result)
    }
}

describe('ConnectionAwarePackageStore', () =>
{
    it('resolves from the local store first, without touching the connection', async () =>
    {
        const inner = new FakeInner(sourced('local'))
        const resolver = new FakeResolver(sourced('remote'))
        const store = new ConnectionAwarePackageStore(inner, resolver)

        const got = await store.TryGet(Ref, { consumerId: 'consumer.a' })

        expect(got?.Document).toEqual({ id: 'local' })
        expect(resolver.calls).toHaveLength(0)
    })

    it('falls back to the connection when the local store misses', async () =>
    {
        const inner = new FakeInner(undefined)
        const resolver = new FakeResolver(sourced('remote'))
        const store = new ConnectionAwarePackageStore(inner, resolver)

        const got = await store.TryGet(Ref, { consumerId: 'consumer.a' })

        expect(got?.Document).toEqual({ id: 'remote' })
        expect(resolver.calls).toEqual([{ consumerId: 'consumer.a', ref: Ref }])
    })

    it('does not consult the connection when there is no consumer in context', async () =>
    {
        const inner = new FakeInner(undefined)
        const resolver = new FakeResolver(sourced('remote'))
        const store = new ConnectionAwarePackageStore(inner, resolver)

        expect(await store.TryGet(Ref)).toBeUndefined()
        expect(await store.TryGet(Ref, {})).toBeUndefined()
        expect(resolver.calls).toHaveLength(0)
    })

    it('returns undefined (Unresolved) when the connection cannot supply the package', async () =>
    {
        const inner = new FakeInner(undefined)
        const resolver = new FakeResolver(undefined)
        const store = new ConnectionAwarePackageStore(inner, resolver)

        expect(await store.TryGet(Ref, { consumerId: 'consumer.a' })).toBeUndefined()
        expect(resolver.calls).toHaveLength(1)
    })

    it('delegates Storage to the inner store', () =>
    {
        const inner = new FakeInner(undefined)
        const store = new ConnectionAwarePackageStore(inner, new FakeResolver(undefined))

        expect(store.Storage).toBe(InnerStorage)
    })
})
