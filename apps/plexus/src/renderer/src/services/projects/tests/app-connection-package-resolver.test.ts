import { describe, it, expect } from 'vitest'
import type { PackageRef, SourcedPackage } from '@pragmatic-tech-ai/todl'
import { AppConnectionPackageResolver, type ConnectionResolveApi, type IEffectiveConnection } from '../app-connection-package-resolver.js'

const Ref: PackageRef = { kind: 'meta-model', id: 'acme.base', version: '2.1.0' } as unknown as PackageRef

function sourced(id: string): SourcedPackage
{
    return { Document: { id } as unknown as SourcedPackage['Document'], Dependencies: [] }
}

class FakeApi implements ConnectionResolveApi
{
    public readonly calls: Array<{ id: string; version: string; connectionId?: string }> = []

    constructor(private readonly result: SourcedPackage | undefined)
    {
    }

    public Resolve(id: string, version: string, connectionId?: string): Promise<SourcedPackage | undefined>
    {
        this.calls.push({ id, version, connectionId })
        return Promise.resolve(this.result)
    }
}

class FixedEffective implements IEffectiveConnection
{
    public readonly asked: string[] = []

    constructor(private readonly id: string | undefined)
    {
    }

    public EffectiveConnectionIdFor(consumerId: string): Promise<string | undefined>
    {
        this.asked.push(consumerId)
        return Promise.resolve(this.id)
    }
}

describe('AppConnectionPackageResolver', () =>
{
    it('resolves the ref through the consumer\'s effective connection', async () =>
    {
        const api = new FakeApi(sourced('remote'))
        const effective = new FixedEffective('registry-b')
        const resolver = new AppConnectionPackageResolver(api, effective)

        const got = await resolver.ResolveFor('consumer.a', Ref)

        expect(got?.Document).toEqual({ id: 'remote' })
        expect(effective.asked).toEqual(['consumer.a'])
        expect(api.calls).toEqual([{ id: 'acme.base', version: '2.1.0', connectionId: 'registry-b' }])
    })

    it('passes undefined (the default connection) when there is no effective override', async () =>
    {
        const api = new FakeApi(sourced('remote'))
        const resolver = new AppConnectionPackageResolver(api, new FixedEffective(undefined))

        await resolver.ResolveFor('consumer.a', Ref)

        expect(api.calls).toEqual([{ id: 'acme.base', version: '2.1.0', connectionId: undefined }])
    })

    it('returns undefined when the connection cannot supply the package', async () =>
    {
        const api = new FakeApi(undefined)
        const resolver = new AppConnectionPackageResolver(api, new FixedEffective('registry-b'))

        expect(await resolver.ResolveFor('consumer.a', Ref)).toBeUndefined()
    })
})
