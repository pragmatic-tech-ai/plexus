import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IPropertyBag, IPropertyBagStore, IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { type IBagPersister, BagScope, RecordPropertyBag } from '@pragmatic-tech-ai/todl'

// kind → instance id → { property name → value }, the shape held under the aggregate bag's one
// property and written to application-bags.json by the durable store.
type BagValues = Record<string, Record<string, Record<string, unknown>>>

// Resolves the app's single global-scoped bag persister.
export const GlobalBagPersisterKey = new ServiceKey<IBagPersister>('GlobalBagPersister')

// The GLOBAL-scope IBagPersister, backed by a durable IPropertyBagStore (in the app, the
// DurableApplicationStore over userData/application-bags.json). It registers ONE aggregate bag
// with the store — the store's Register/Restore/Save model is bag-centric, not an enumerable
// key-value store — and keeps the whole kind→id→values structure under that bag's single `data`
// property, so the store persists and restores it as a unit. Secrets never flow through here: a
// connection bag holds only token references (see ConnectionBag).
export class GlobalBagPersister implements IBagPersister
{
    public readonly Scope = BagScope.Global

    private static readonly StoreKey = 'global-bags'
    private static readonly DataProperty = 'data'

    private readonly aggregate: IPropertyBag
    private readonly registration: IDisposable

    constructor(private readonly store: IPropertyBagStore)
    {
        // Seed `data` up front so the store observes it at Register (it subscribes to every
        // property present then) and so Restore applies the persisted slice onto an existing key.
        this.aggregate = new RecordPropertyBag(new Map<string, unknown>([[GlobalBagPersister.DataProperty, {}]]))
        this.registration = store.Register(GlobalBagPersister.StoreKey, this.aggregate)
    }

    public Ids(kind: string): readonly string[]
    {
        return Object.keys(this.data()[kind] ?? {})
    }

    public Bag(kind: string, id: string): IPropertyBag
    {
        const values = new Map<string, unknown>(Object.entries(this.instance(kind, id)))
        return new RecordPropertyBag(values, () => this.persist(kind, id, values))
    }

    public Create(kind: string, id: string): IPropertyBag
    {
        const document = this.data()
        const byId = document[kind] ?? (document[kind] = {})
        if (byId[id] === undefined)
        {
            byId[id] = {}
            this.writeData(document)
        }
        return this.Bag(kind, id)
    }

    public Delete(kind: string, id: string): void
    {
        const document = this.data()
        if (document[kind]?.[id] !== undefined)
        {
            delete document[kind]![id]
            this.writeData(document)
        }
    }

    // Persist synchronously through the store (the app calls this on teardown / explicit save;
    // property changes also schedule the store's own debounced save).
    public Flush(): Promise<void>
    {
        return this.store.Save()
    }

    public dispose(): void
    {
        this.registration.dispose()
    }

    private data(): BagValues
    {
        const raw = this.aggregate.GetValue(GlobalBagPersister.DataProperty)
        return (raw !== null && typeof raw === 'object') ? (raw as BagValues) : {}
    }

    private instance(kind: string, id: string): Record<string, unknown>
    {
        return this.data()[kind]?.[id] ?? {}
    }

    private writeData(document: BagValues): void
    {
        this.aggregate.SetValue(GlobalBagPersister.DataProperty, document)
    }

    private persist(kind: string, id: string, values: Map<string, unknown>): void
    {
        const document = this.data()
        const byId = document[kind] ?? (document[kind] = {})
        byId[id] = Object.fromEntries(values)
        this.writeData(document)
    }
}
