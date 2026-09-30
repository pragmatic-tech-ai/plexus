import { describe, it, expect } from 'vitest'
import type { IPropertyBag, IPropertyBagStore, Disposable } from '@pragmatic-tech-ai/todl-runtime'
import { BagScope } from '@pragmatic-tech-ai/todl'
import { GlobalBagPersister } from '../global-bag-persister.js'

// A minimal IPropertyBagStore that captures registered bags on Save, so the test can inspect
// exactly what would be persisted.
class FakeStore implements IPropertyBagStore
{
    public readonly saved = new Map<string, Record<string, unknown>>()
    private readonly tracked = new Map<string, IPropertyBag>()

    public Register(key: string, bag: IPropertyBag): Disposable
    {
        this.tracked.set(key, bag)
        return { dispose: () => { this.tracked.delete(key) } }
    }

    public Restore(): Promise<void> { return Promise.resolve() }

    public Save(): Promise<void>
    {
        for (const [key, bag] of this.tracked)
        {
            const out: Record<string, unknown> = {}
            for (const [name] of bag) out[name] = bag.GetValue(name)
            this.saved.set(key, out)
        }
        return Promise.resolve()
    }
}

const KIND = 'npm-connection'

describe('GlobalBagPersister', () =>
{
    it('creates, reads, and deletes npm-connection instances over the durable store', () =>
    {
        const persister = new GlobalBagPersister(new FakeStore())
        expect(persister.Scope).toBe(BagScope.Global)

        const gh = persister.Create(KIND, 'gh')
        gh.SetValue('displayName', 'GitHub')
        gh.SetValue('registryType', 'npm')
        expect([...persister.Ids(KIND)]).toEqual(['gh'])

        const read = persister.Bag(KIND, 'gh')
        expect(read.GetValue('displayName')).toBe('GitHub')
        expect(read.GetValue('registryType')).toBe('npm')

        persister.Delete(KIND, 'gh')
        expect([...persister.Ids(KIND)]).toEqual([])
    })

    it('persists only token REFERENCES through the store — never a raw secret', async () =>
    {
        const store = new FakeStore()
        const persister = new GlobalBagPersister(store)

        const gh = persister.Create(KIND, 'gh')
        gh.SetValue('tokenSource', 'stored')
        gh.SetValue('tokenRef', 'gh')          // a reference key, resolved from the secret store elsewhere
        await persister.Flush()

        const doc = store.saved.get('global-bags') as { data: Record<string, Record<string, Record<string, unknown>>> }
        const persisted = doc.data[KIND]!.gh!
        expect('tokenRef' in persisted).toBe(true)
        expect(Object.keys(persisted).some((k) => /token$|secret|password|value/i.test(k))).toBe(false)
    })

    it('does not overwrite an existing instance on Create (idempotent)', () =>
    {
        const persister = new GlobalBagPersister(new FakeStore())
        persister.Create(KIND, 'gh').SetValue('displayName', 'Original')
        persister.Create(KIND, 'gh')   // second create must not clobber
        expect(persister.Bag(KIND, 'gh').GetValue('displayName')).toBe('Original')
        expect([...persister.Ids(KIND)]).toEqual(['gh'])
    })
})
