import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { CommandContext, type BoardDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { BoardDocumentFactory } from '../board-document-factory.js'
import { BoardCommandExtensionKey, type IBoardCommandExtension } from '../board-command-extension.js'

// A real IBoardCommandExtension stand-in that owns exactly one command id and records the
// execute call — enough to prove PlexusBoardDocument.Resolve routes owned ids to it and
// defers everything else to the base document.
class FakeExtension implements IBoardCommandExtension
{
    public readonly executed: string[] = []

    constructor(private readonly ownedId: string, private readonly executable = true)
    {
    }

    public handles(id: string): boolean { return id === this.ownedId }
    public execute(_doc: BoardDocument, id: string): void { this.executed.push(id) }
    public canExecute(_doc: BoardDocument, _id: string): boolean { return this.executable }
}

async function boardDoc(provider: ServiceProvider): Promise<BoardDocument>
{
    const storage = new FakeStorage()
    const factory = new BoardDocumentFactory(provider)
    return factory.openFile(storage, await factory.newFile(storage, 'city')) as Promise<BoardDocument>
}

describe('PlexusBoardDocument.Resolve', () =>
{
    it('routes a command the registered extension owns to a RelayCommand over its execute/canExecute', async () =>
    {
        const provider = new ServiceProvider()
        const ext = new FakeExtension('arch.editViewpoints')
        provider.registerInstance(BoardCommandExtensionKey, ext)
        const doc = await boardDoc(provider)

        const command = doc.Resolve('arch.editViewpoints', new CommandContext())
        expect(command).toBeDefined()
        expect(command!.CanExecute()).toBe(true)
        command!.Execute()
        expect(ext.executed).toEqual(['arch.editViewpoints'])
    })

    it('reflects the extension CanExecute gate', async () =>
    {
        const provider = new ServiceProvider()
        provider.registerInstance(BoardCommandExtensionKey, new FakeExtension('arch.editViewpoints', false))
        const doc = await boardDoc(provider)
        expect(doc.Resolve('arch.editViewpoints', new CommandContext())!.CanExecute()).toBe(false)
    })

    it('defers a command the extension does not own to the base document (undefined here)', async () =>
    {
        const provider = new ServiceProvider()
        provider.registerInstance(BoardCommandExtensionKey, new FakeExtension('arch.editViewpoints'))
        const doc = await boardDoc(provider)
        expect(doc.Resolve('nobody.owns.this', new CommandContext())).toBeUndefined()
    })

    it('with no extension registered, every command defers to the base document', async () =>
    {
        const doc = await boardDoc(new ServiceProvider())
        expect(doc.Resolve('arch.editViewpoints', new CommandContext())).toBeUndefined()
    })
})
