import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DialogService, DocumentTypeRegistry, type IDocument } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { Solution, ProjectFactoryRegistryKey, SolutionBaseResolver, SolutionManagerService, SolutionMemberStatus, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { LiveValidationKey } from '../../../../projects/index.js'
import { DocumentCloseGuard } from '../../../../documents/document-close-guard.js'
import { SavePromptResult } from '../../../../dialogs/save-prompt-model.js'
import { SolutionWorkspaceService, MemberNewFileParticipantKey, type IMemberNewFileParticipant } from '../solution-workspace-service.js'

// A tracked document: the factory returns one of these per open so a test can assert
// its Path re-points after a rename, or flip IsDirty to drive the close guard.
class FakeDoc
{
    public IsDirty = false
    constructor(public Id: string, public Title: string, public Path: string) {}
}

// The one editor the fake DocumentTypeRegistry resolves (for '.todl'): writes empty
// files, hands back a tracked FakeDoc, and can re-point an open doc (relocatable).
class FakeDocFactory
{
    public readonly opened: FakeDoc[] = []
    constructor(private readonly store: FakeStorage) {}

    public async openFile(_storage: unknown, path: string): Promise<IDocument>
    {
        const doc = new FakeDoc(`doc:${path}`, path, path)
        this.opened.push(doc)
        return doc as unknown as IDocument
    }

    public async saveFile(_doc: IDocument): Promise<void> {}

    public async newFile(storage: FakeStorage, name: string): Promise<string>
    {
        await storage.WriteText(name, '')
        return name
    }

    public relocateOpenFile(doc: IDocument, newPath: string): void
    {
        (doc as unknown as FakeDoc).Path = newPath
    }
}

// Records the order of confirm / tab-close / disk-delete so a test can prove the
// ordering, and stands in for ContentHostService + the close guard's host surface.
class FakeHost
{
    public readonly open: IDocument[] = []
    constructor(private readonly log: string[]) {}

    public get OpenDocuments(): { ToArray(): IDocument[] } { return { ToArray: () => this.open } }
    public Open(doc: IDocument): void { if (!this.open.includes(doc)) this.open.push(doc) }
    public Close(doc: IDocument): void { const i = this.open.indexOf(doc); if (i >= 0) this.open.splice(i, 1); this.log.push('close') }
    public Save(doc: IDocument): void { (doc as unknown as FakeDoc).IsDirty = false }
}

interface HarnessOpts
{
    dialogResult?: unknown
    promptResult?: SavePromptResult
    participant?: IMemberNewFileParticipant
    closeProject?: (m: SolutionMember) => void
    calls?: string[]
}

async function harness(opts: HarnessOpts = {})
{
    const log: string[] = []
    const storage = new FakeStorage('mem://p')
    await storage.WriteText('project.plexus', JSON.stringify({ type: 'architecture', name: 'p' }))
    await storage.WriteText('a.todl', 'x')
    // Log every disk delete in order with the confirm/close events.
    const origDelete = storage.Delete.bind(storage)
    storage.Delete = async (path: string) => { log.push(`delete:${path}`); return origDelete(path) }

    const sol = new Solution('S')
    const member = sol.AddMember('./p', 'architecture')
    member.Status = SolutionMemberStatus.Resolved
    member.Storage = storage

    const provider = new ServiceProvider()
    const host = new FakeHost(log)
    const factory = new FakeDocFactory(storage)
    // Every dialog shown, captured by title + message (the VM's Message) so a test can assert
    // the right feedback surfaced.
    const shown: { title: string; message: string }[] = []
    provider.registerInstance(ContentHostService.Key, host as never)
    provider.registerInstance(DocumentTypeRegistry.Key, {
        GetByExtension: (ext: string) => (ext === '.todl' ? { Factory: FakeDocFactory } : undefined),
    } as never)
    provider.registerInstance(ServiceProvider.tokenFor(FakeDocFactory), factory as never)
    provider.registerInstance(DialogService.Key, {
        Show: async (opt: { Title: string; Content: { Message?: string } }) => {
            log.push('confirm')
            shown.push({ title: opt.Title, message: opt.Content?.Message ?? '' })
            return opts.dialogResult
        },
        Close: () => {},
    } as never)
    provider.registerInstance(DocumentCloseGuard.Key, new DocumentCloseGuard(provider, {
        host,
        prompt: async () => opts.promptResult ?? SavePromptResult.DontSave,
    }))
    provider.registerInstance(SolutionManagerService.Key, {
        ActiveSolution: sol,
        CloseProject: async (m: SolutionMember) => { opts.closeProject?.(m) },
    } as never)
    if (opts.participant !== undefined) provider.registerInstance(MemberNewFileParticipantKey, opts.participant)
    if (opts.calls !== undefined)
    {
        const calls = opts.calls
        provider.registerInstance(ProjectFactoryRegistryKey, { factoryFor: () => undefined } as never)
        provider.registerInstance(SolutionBaseResolver.Key, {
            ConsumerIdOf: async () => 'consumer-id',
            Invalidate: (id: string) => { calls.push(`invalidate:${id}`) },
        } as never)
        provider.registerInstance(LiveValidationKey, {
            ResyncProject: async (id: string) => { calls.push(`resync:${id}`) },
            RefreshBases: async () => { calls.push('validation-refresh') },
        } as never)
    }

    const service = new SolutionWorkspaceService(provider)
    return { service, member, storage, host, factory, log, sol, shown }
}

describe('SolutionWorkspaceService', () =>
{
    it('Delete confirms, then closes the open tab BEFORE the engine deletes (CanRemove ordering)', async () =>
    {
        const { service, member, storage, log } = await harness({ dialogResult: true })
        await service.OpenPath(member, 'a.todl')   // open a tab for the file
        log.length = 0                              // ignore the open; track the delete flow
        await service.DeleteMemberFiles(member, ['a.todl'])
        expect(log).toEqual(['confirm', 'close', 'delete:a.todl'])
        expect(await storage.Exists('a.todl')).toBe(false)
    })

    it('Delete declined at the confirm leaves the file (engine never runs)', async () =>
    {
        const { service, member, storage, log } = await harness({ dialogResult: false })
        await service.DeleteMemberFiles(member, ['a.todl'])
        expect(log).toEqual(['confirm'])
        expect(await storage.Exists('a.todl')).toBe(true)
    })

    it('Rename re-points the open tab via OnMoved', async () =>
    {
        const { service, member, storage } = await harness()
        const doc = (await service.OpenPath(member, 'a.todl')) as unknown as FakeDoc
        await service.RenameMemberFile(member, 'a.todl', 'b.todl')
        expect(await storage.Exists('b.todl')).toBe(true)
        expect(await storage.Exists('a.todl')).toBe(false)
        expect(doc.Path).toBe('b.todl')
    })

    it('NewFile runs the participant; a veto deletes the just-created file and opens no tab', async () =>
    {
        const vetoer: IMemberNewFileParticipant = { OnCreated: async () => false }
        const { service, member, storage, host } = await harness({ participant: vetoer })
        await service.NewFileForMember(member, '', { extension: '.todl', kind: 'model', displayName: 'Model' })
        expect(await storage.Exists('model.todl')).toBe(false)
        expect(host.open.length).toBe(0)
    })

    it('NewFile keeps the file and opens a tab when the participant approves', async () =>
    {
        const keeper: IMemberNewFileParticipant = { OnCreated: async () => true }
        const { service, member, storage, host } = await harness({ participant: keeper })
        await service.NewFileForMember(member, '', { extension: '.todl', kind: 'model', displayName: 'Model' })
        expect(await storage.Exists('model.todl')).toBe(true)
        expect(host.open.length).toBe(1)
    })

    it('CloseMember runs the dirty guard; a Cancel vetoes the whole close', async () =>
    {
        let closed = false
        const { service, member } = await harness({
            promptResult: SavePromptResult.Cancel,
            closeProject: () => { closed = true },
        })
        const doc = (await service.OpenPath(member, 'a.todl')) as unknown as FakeDoc
        doc.IsDirty = true
        await service.CloseMember(member)
        expect(closed).toBe(false)   // the engine close never ran — CanClose vetoed
    })

    it('CloseMember proceeds when the dirty guard resolves (Don\'t Save)', async () =>
    {
        let closed = false
        const { service, member } = await harness({
            promptResult: SavePromptResult.DontSave,
            closeProject: () => { closed = true },
        })
        const doc = (await service.OpenPath(member, 'a.todl')) as unknown as FakeDoc
        doc.IsDirty = true
        await service.CloseMember(member)
        expect(closed).toBe(true)
    })

    it('Rename to an existing name surfaces a collision message (not a silent no-op)', async () =>
    {
        const { service, member, storage, shown } = await harness()
        await storage.WriteText('b.todl', 'y')
        await service.RenameMemberFile(member, 'a.todl', 'b.todl')
        expect(shown).toContainEqual({ title: 'Rename', message: '"b.todl" already exists.' })
        expect(await storage.Exists('a.todl')).toBe(true)   // not renamed away
    })

    it('Rename to an invalid name surfaces feedback', async () =>
    {
        const { service, member, shown } = await harness()
        await service.RenameMemberFile(member, 'a.todl', 'x/y')
        expect(shown).toContainEqual({ title: 'Rename', message: "That name isn't valid." })
    })

    it('Move reports skipped items when the destination already has the name', async () =>
    {
        const { service, member, storage, shown } = await harness()
        await storage.CreateDirectory('dest')
        await storage.WriteText('dest/a.todl', 'z')
        await service.MoveMemberNodes(member, ['a.todl'], 'dest')
        expect(shown.some((s) => s.title === 'Move' && s.message.includes('1 item'))).toBe(true)
    })

    it('Delete confirm count collapses a folder + a file inside it to the one root deleted', async () =>
    {
        const { service, member, storage, shown } = await harness({ dialogResult: false })
        await storage.CreateDirectory('dir')
        await storage.WriteText('dir/x.todl', 'q')
        await service.DeleteMemberFiles(member, ['dir', 'dir/x.todl'])
        expect(shown[0]!.message).toContain('folder "dir"')          // single-root wording
        expect(shown[0]!.message).not.toContain('these 2 items')     // not a 2-item batch
    })

    it('RefreshFolders invalidates the member bases then resyncs + refreshes validation; unknown folders are skipped', async () =>
    {
        const calls: string[] = []
        const { service } = await harness({ calls })
        await service.RefreshFolders(['mem://p', 'mem://nope'])
        expect(calls[0]).toBe('invalidate:consumer-id')
        expect(calls.filter((c) => c.startsWith('resync:'))).toHaveLength(1)
        expect(calls.filter((c) => c === 'validation-refresh')).toHaveLength(1)
    })
})
