import { describe, it, expect, vi } from 'vitest'
import { Signal } from '@pragmatic-tech-ai/todl-runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { Cardinality, EdgeKind, GraphBuildState, Tier, WikiOriginKind } from '@pragmatic-tech-ai/todl'
import { RemoteLanguageService } from '../remote-language-service.js'
import type { ILocalBaseResolution, IRemoteLanguageSession, IRemoteMemberIds } from '../remote-language-service.js'

class Harness
{
    public static readonly Uri = 'file:///a.todl'
    public static readonly MemberId = 'member-a'
    public static readonly OtherMemberId = 'member-b'
    public static readonly Pos = { line: 1, character: 2 }

    public graphHandler: ((c: { memberIds: string[]; fileIds: string[] }) => void) | undefined
    public buildHandler: ((p: { buildState: string }) => void) | undefined
    public diagHandler: ((p: { uri: string; diagnostics: unknown[] }) => void) | undefined
    public readonly Session: Record<string, ReturnType<typeof vi.fn>>
    public readonly Local: Record<string, ReturnType<typeof vi.fn>> & { StaleMembers: Set<string> }
    public readonly Storage = {} as IStorage
    public readonly OtherStorage = {} as IStorage
    public readonly Service: RemoteLanguageService

    public constructor()
    {
        const echo = (name: string) => vi.fn(async (..._args: unknown[]) => ({ answered: name }))
        this.Session = {
            CompletionsAt: echo('CompletionsAt'), HoverAt: echo('HoverAt'), DefinitionAt: echo('DefinitionAt'),
            ReferencesAt: echo('ReferencesAt'), PrepareRename: echo('PrepareRename'), RenameEdits: echo('RenameEdits'),
            DocumentSymbols: echo('DocumentSymbols'), FoldingRanges: echo('FoldingRanges'), WorkspaceSymbols: echo('WorkspaceSymbols'),
            SemanticTokens: echo('SemanticTokens'), SignatureHelpAt: echo('SignatureHelpAt'), CodeActions: echo('CodeActions'),
            FormatDocument: echo('FormatDocument'), DiagnosticsFor: vi.fn(async () => [{ message: 'pulled' }]),
            DidChange: vi.fn(async () => undefined), ActiveSolution: vi.fn(async () => null), ModelView: vi.fn(), Resources: vi.fn(),
            OnGraphChanged: vi.fn((h) => { this.graphHandler = h; return () => undefined }),
            OnBuildStateChanged: vi.fn((h) => { this.buildHandler = h; return () => undefined }),
            OnDiagnostics: vi.fn((h) => { this.diagHandler = h; return () => undefined }),
        }
        this.Local = {
            ResolveBasesFor: vi.fn(async () => ({ bases: [], problems: [], originOf: new Map() })),
            ReferencedPublishedRefs: vi.fn(async () => new Set<string>(['x'])),
            WorkspaceProducers: vi.fn(async () => []),
            ProducedIdOf: vi.fn(async () => 'p'),
            ConsumerIdOf: vi.fn(async () => 'c'),
            Invalidate: vi.fn(),
            PropertyChanged: vi.fn(() => new Signal()),
            StaleMembers: new Set<string>(['m1']),
        } as never
        const members: IRemoteMemberIds = { MemberIdOf: (s) => (s === this.Storage ? Harness.MemberId : undefined), StorageOfMember: (id) => (id === Harness.OtherMemberId ? this.OtherStorage : undefined) }
        this.Service = new RemoteLanguageService(this.Session as unknown as IRemoteLanguageSession, this.Local as unknown as ILocalBaseResolution, members)
    }
}

describe('RemoteLanguageService', () =>
{
    it('forwards each LSP method to the session and returns its result', async () =>
    {
        const h = new Harness()
        const s = h.Service
        const pos = Harness.Pos
        const range = { start: pos, end: pos }
        const calls: [string, () => Promise<unknown>, unknown[]][] = [
            ['CompletionsAt', () => s.CompletionsAt(Harness.Uri, pos), [Harness.Uri, pos]],
            ['HoverAt', () => s.HoverAt(Harness.Uri, pos), [Harness.Uri, pos]],
            ['DefinitionAt', () => s.DefinitionAt(Harness.Uri, pos), [Harness.Uri, pos]],
            ['ReferencesAt', () => s.ReferencesAt(Harness.Uri, pos, true), [Harness.Uri, pos, true]],
            ['PrepareRename', () => s.PrepareRename(Harness.Uri, pos), [Harness.Uri, pos]],
            ['RenameEdits', () => s.RenameEdits(Harness.Uri, pos, 'n'), [Harness.Uri, pos, 'n']],
            ['DocumentSymbols', () => s.DocumentSymbols(Harness.Uri), [Harness.Uri]],
            ['FoldingRanges', () => s.FoldingRanges(Harness.Uri), [Harness.Uri]],
            ['WorkspaceSymbols', () => s.WorkspaceSymbols('q'), ['q']],
            ['SemanticTokens', () => s.SemanticTokens(Harness.Uri), [Harness.Uri]],
            ['SignatureHelpAt', () => s.SignatureHelpAt(Harness.Uri, pos), [Harness.Uri, pos]],
            ['CodeActions', () => s.CodeActions(Harness.Uri, range, []), [Harness.Uri, range, []]],
            ['FormatDocument', () => s.FormatDocument(Harness.Uri), [Harness.Uri]],
        ]
        for (const [name, invoke, args] of calls)
        {
            expect(await invoke()).toEqual({ answered: name })
            expect(h.Session[name]).toHaveBeenCalledWith(...args)
        }
    })

    it('DiagnosticsFor pulls from the session and refreshes the cache; pushes update it too', async () =>
    {
        const h = new Harness()
        expect(await h.Service.DiagnosticsFor(Harness.Uri)).toEqual([{ message: 'pulled' }])
        expect(h.Service.CachedDiagnostics(Harness.Uri)).toEqual([{ message: 'pulled' }])
        const seen: string[] = []
        h.Service.DiagnosticsPublished.subscribe(p => seen.push(p.uri))
        h.diagHandler!({ uri: Harness.Uri, diagnostics: [{ message: 'pushed' }] })
        expect(h.Service.CachedDiagnostics(Harness.Uri)).toEqual([{ message: 'pushed' }])
        expect(seen).toEqual([Harness.Uri])
    })

    it('DidChange forwards to the session and WhenIdle settles it', async () =>
    {
        const h = new Harness()
        h.Service.DidChange(Harness.Uri, 'text')
        expect(h.Session.DidChange).toHaveBeenCalledWith(Harness.Uri, 'text')
        await h.Service.WhenIdle()
    })

    it('a rejected DidChange raises DidChangeFailed instead of vanishing', async () =>
    {
        const h = new Harness()
        h.Session.DidChange.mockRejectedValueOnce(new Error('dead'))
        const failures: string[] = []
        h.Service.DidChangeFailed.subscribe(f => failures.push(f.Uri))
        h.Service.DidChange(Harness.Uri, 'x')
        await h.Service.WhenIdle()
        expect(failures).toEqual([Harness.Uri])
    })

    it('seeds BuildState from the session ActiveSolution, unless a push already arrived', async () =>
    {
        const h = new Harness()
        h.Session.ActiveSolution.mockResolvedValue({ name: 'n', members: [], buildState: 'ready' })
        await h.Service.SyncBuildState()
        expect(h.Service.BuildState).toBe(GraphBuildState.Ready)
        h.buildHandler!({ buildState: 'failed' })
        await h.Service.SyncBuildState()
        expect(h.Service.BuildState).toBe(GraphBuildState.Failed)
    })

    it('an unrecognized build-state push does not block a later sync', async () =>
    {
        const h = new Harness()
        h.buildHandler!({ buildState: 'garbage' })
        h.Session.ActiveSolution.mockResolvedValue({ name: 'n', members: [], buildState: 'ready' })
        await h.Service.SyncBuildState()
        expect(h.Service.BuildState).toBe(GraphBuildState.Ready)
    })

    it('traces dropped edges through the log', async () =>
    {
        const h = new Harness()
        const debug = vi.fn()
        const service = new RemoteLanguageService(h.Session as unknown as IRemoteLanguageSession, h.Local as unknown as ILocalBaseResolution, { MemberIdOf: () => 'm', StorageOfMember: () => undefined }, { Debug: debug, Warn: vi.fn() })
        h.Session.ModelView.mockResolvedValue({ items: [{ id: 'a', kind: 'k', localId: 'a', namespace: '', tier: 'Instance', isClass: false, attrs: {}, edges: [{ kind: 'Nope', via: null, to: 'a' }, { kind: 'Relationship', via: null, to: 'gone' }] }], provenanceOf: {} })
        await service.ModelView(h.Storage)
        expect(debug).toHaveBeenCalledTimes(2)
    })

    it('an OnGraphChanged push fires GraphChanged and bumps GraphRevision', () =>
    {
        const h = new Harness()
        const seen: unknown[] = []
        h.Service.GraphChanged.subscribe(c => seen.push(c))
        h.graphHandler!({ memberIds: ['m'], fileIds: ['f'] })
        expect(seen).toEqual([{ memberIds: ['m'], fileIds: ['f'] }])
        expect(h.Service.GraphRevision).toBe(1)
    })

    it('an OnBuildStateChanged push updates BuildState and fires only on a real transition', () =>
    {
        const h = new Harness()
        expect(h.Service.BuildState).toBe(GraphBuildState.Building)
        const seen: GraphBuildState[] = []
        h.Service.BuildStateChanged.subscribe(s => seen.push(s))
        h.buildHandler!({ buildState: 'ready' })
        h.buildHandler!({ buildState: 'ready' })
        h.buildHandler!({ buildState: 'failed' })
        expect(seen).toEqual([GraphBuildState.Ready, GraphBuildState.Failed])
        expect(h.Service.BuildState).toBe(GraphBuildState.Failed)
    })

    it('ModelView pages the member and materializes the DTO into an engine Repository', async () =>
    {
        const h = new Harness()
        h.Session.ModelView
            .mockResolvedValueOnce({
                items: [{ id: 'a.Foo', kind: 'todl.Thing', localId: 'Foo', namespace: 'a', tier: 'Instance', isClass: false, attrs: { title: 'T', n: 3, gone: null }, edges: [{ kind: 'Relationship', via: 'owner', to: 'a.Bar' }, { kind: 'Relationship', via: null, to: 'missing' }] }],
                provenanceOf: { 'a.Foo': 'src' },
                nextCursor: 'c1',
            })
            .mockResolvedValueOnce({
                items: [{ id: 'a.Bar', kind: 'concept', localId: '', namespace: '', tier: 'Meta', isClass: false, attrs: {}, edges: [] }],
                provenanceOf: {},
            })
        const view = await h.Service.ModelView(h.Storage)
        expect(h.Session.ModelView).toHaveBeenNthCalledWith(1, Harness.MemberId, undefined)
        expect(h.Session.ModelView).toHaveBeenNthCalledWith(2, Harness.MemberId, { cursor: 'c1' })
        const foo = view!.model.resolve('a.Foo')!
        expect(foo.tier).toBe(Tier.Instance)
        expect(foo.type).toBe('todl.Thing')
        expect(foo.metaKind).toBeNull()
        expect(foo.attrs.get('title')).toBe('T')
        expect(foo.attrs.has('gone')).toBe(false)
        const bar = view!.model.resolve('a.Bar')!
        expect(bar.metaKind).toBe('concept')
        expect(bar.type).toBeNull()
        expect(bar.localId).toBeNull()
        expect(view!.model.outEdges('a.Foo')).toEqual([{ kind: EdgeKind.Relationship, via: 'owner', from: 'a.Foo', to: 'a.Bar' }])
        expect(view!.provenanceOf.get('a.Foo')).toBe('src')
    })

    it('ModelView materializes class/canonicalId/storageId/fields and rebuilds originOf so per-member slicing works', async () =>
    {
        const h = new Harness()
        h.Session.ModelView.mockResolvedValueOnce({
            items: [
                { id: 'a.Foo', kind: 'a.Thing', localId: 'Foo', namespace: 'a', tier: 'Instance', isClass: false, attrs: {}, edges: [], class: 'a.Gold', canonicalId: 'a.Canon', storageId: 'sid' },
                { id: 'a.Thing', kind: 'concept', localId: 'Thing', namespace: 'a', tier: 'Ontology', isClass: false, attrs: {}, edges: [], fields: [{ name: 'region', type: 'a.string', cardinality: 'Optional', secured: true }, { name: 'n', type: 'a.int', cardinality: 'Many' }] },
            ],
            provenanceOf: {},
            originOf: {
                'a.Foo': { kind: 'openProject', memberId: Harness.MemberId },
                'a.Thing': { kind: 'openProject', memberId: Harness.OtherMemberId },
                'a.Pkg': { kind: 'package', id: 'acme.pkg', version: '1.2.3' },
                'a.Lost': { kind: 'openProject', memberId: 'unknown' },
            },
        })
        const view = await h.Service.ModelView(h.Storage)
        const foo = view!.model.resolve('a.Foo')!
        expect(foo.class).toBe('a.Gold')
        expect(foo.canonicalId).toBe('a.Canon')
        expect(foo.storageId).toBe('sid')
        expect(view!.model.resolve('a.Thing')!.fields).toEqual([
            { name: 'region', type: 'a.string', cardinality: Cardinality.Optional, secured: true },
            { name: 'n', type: 'a.int', cardinality: Cardinality.Many },
        ])
        expect(view!.originOf.get('a.Foo')).toEqual({ kind: WikiOriginKind.OpenProject, storage: h.Storage })
        expect(view!.originOf.get('a.Thing')).toEqual({ kind: WikiOriginKind.OpenProject, storage: h.OtherStorage })
        expect(view!.originOf.get('a.Pkg')).toEqual({ kind: WikiOriginKind.Package, id: 'acme.pkg', version: '1.2.3' })
        expect(view!.originOf.has('a.Lost')).toBe(false)
    })

    it('ModelView is undefined for a storage that is not a known member, without hitting the wire', async () =>
    {
        const h = new Harness()
        expect(await h.Service.ModelView({} as IStorage)).toBeUndefined()
        expect(h.Session.ModelView).not.toHaveBeenCalled()
    })

    it('Resources materializes the DTO with a remote storage at its root', async () =>
    {
        const h = new Harness()
        h.Session.Resources.mockResolvedValue([{ annotation: 'todl.MuralResource', path: 'x.mu', storageRoot: '/root' }])
        const [resource] = await h.Service.Resources('a.Foo')
        expect(resource.annotation).toBe('todl.MuralResource')
        expect(resource.path).toBe('x.mu')
        expect(resource.storage.Root).toBe('/root')
    })

    it('delegates base resolution and StaleMembers to the local resolver, never the wire', async () =>
    {
        const h = new Harness()
        const s = h.Service
        await s.ResolveBasesFor(h.Storage)
        expect(await s.ReferencedPublishedRefs(h.Storage)).toEqual(new Set(['x']))
        await s.WorkspaceProducers('app' as never)
        expect(await s.ProducedIdOf(h.Storage)).toBe('p')
        expect(await s.ConsumerIdOf(h.Storage)).toBe('c')
        s.Invalidate('m')
        expect(s.StaleMembers.has('m1')).toBe(true)
        s.PropertyChanged('StaleMembers')
        expect(h.Local.Invalidate).toHaveBeenCalledWith('m')
        expect(h.Local.PropertyChanged).toHaveBeenCalledWith('StaleMembers')
        for (const name of ['CompletionsAt', 'ModelView', 'Resources', 'DiagnosticsFor', 'DidChange'])
        {
            expect(h.Session[name]).not.toHaveBeenCalled()
        }
    })
})
