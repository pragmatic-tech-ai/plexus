import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition } from '@pragmatic-tech-ai/mural/framework'
import { Solution, type SolutionMember } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { BuildContributor, BuildFlavorSubmenuContributor } from '../build-contributor.js'
import type { IContentMutations } from '../content-mutations.js'
import type { IBuildClient } from '../../../build/index.js'
import type { BuildRunRequest, BuildRunResult, BuildApplicable } from '../../../../../shared/build-api.js'

// A fake project row: it carries its member as ExtObject (what FileTreeContributor.MemberOf
// matches when BuildContributor.Resolve climbs to the owning member).
class FakeItem
{
    public Parent: FakeItem | undefined

    constructor(public readonly Key: string, public readonly ExtObject: unknown, parent?: FakeItem)
    {
        this.Parent = parent
    }
}

function fakeMutations(over: Partial<IContentMutations> = {}): IContentMutations & { published: SolutionMember[] }
{
    const rec = {
        published: [] as SolutionMember[],
        RenameMemberFile: async () => {}, DeleteMemberFiles: async () => {},
        NewFileForMember: async () => {}, NewFolderForMember: async () => {},
        ImportFilesForMember: async () => {}, ImportFolderForMember: async () => {},
        MoveMemberNodes: async () => {},
        PublishMember: async (m: SolutionMember) => { rec.published.push(m) },
        BumpMemberVersion: async () => {}, SetMemberVersion: async () => {},
        ManageMemberReferences: async () => {}, RefreshMemberBases: () => {},
        UpdateMemberAgentMetadata: async () => {}, CloseMember: async () => {}, RemoveMember: async () => {},
        FormatsFor: () => [], IsVersionedMember: () => false,
        CanRefreshBasesMember: () => false, SupportsScaffoldMember: () => false,
        ...over,
    }
    return rec as IContentMutations & { published: SolutionMember[] }
}

function memberRow(member: SolutionMember): HierarchyItem
{
    return new FakeItem(NodeKey.Project, member) as unknown as HierarchyItem
}

function ctxFor(anchor: HierarchyItem): HierarchyActionContext
{
    return new HierarchyActionContext(anchor, [anchor])
}

// A fake build client: records Build calls + progress subscriptions; Applicable resolves on demand.
class FakeBuildClient implements IBuildClient
{
    public builds: BuildRunRequest[] = []
    public subscribed: string[] = []
    public disposed = 0
    public result: BuildRunResult = { Ok: true, Diagnostics: [] }
    public applicableRows: readonly BuildApplicable[] = []
    private pending: Array<() => void> = []

    public async Build(req: BuildRunRequest): Promise<BuildRunResult>
    {
        this.builds.push(req)
        return this.result
    }

    public Applicable(_manifestJson: string): Promise<readonly BuildApplicable[]>
    {
        return new Promise((resolve) => { this.pending.push(() => resolve(this.applicableRows)) })
    }

    public Resolve(): void
    {
        this.pending.splice(0).forEach((r) => r())
    }

    public OnProgress(runId: string): { dispose(): void }
    {
        this.subscribed.push(runId)
        return { dispose: () => { this.disposed++ } }
    }
}

const noBuild = new FakeBuildClient()

function someMember(): SolutionMember
{
    return new Solution('S').AddMember('./p', 'architecture')
}

// A member whose storage returns a manifest JSON for the flavor-submenu read.
function memberWithManifest(json: string): SolutionMember
{
    const m = new Solution('S').AddMember('./p', 'architecture')
    m.Storage = { ReadText: async () => json, ResolveOsPath: (p: string) => p === '' ? '/proj' : `/proj/${p}` } as unknown as IStorage
    return m
}

const htmlRow: BuildApplicable = { systemId: 'html-bundle', systemName: 'HTML', flavorId: 'html-bundle', flavorName: 'HTML app' }

const validManifest = '{"type":"architecture","name":"p","version":1}'
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('BuildContributor', () =>
{
    it('contributes Build ▸ and Publish on the project row, Context-tagged to NodeKey.Project', () =>
    {
        const c = new BuildContributor(noBuild, undefined, fakeMutations())
        const titles = c.Actions.map((a) => a.Title)
        expect(titles).toContain('Build')
        expect(titles).toContain('Publish')
        expect(c.Actions.every((a) => a.Context === HierarchyContext.For(NodeKey.Project))).toBe(true)
    })

    it('Publish is executable only for a versioned member and routes to mutations.PublishMember', () =>
    {
        const member = someMember()
        const versioned = fakeMutations({ IsVersionedMember: () => true })
        const plain = new BuildContributor(noBuild, undefined, fakeMutations({ IsVersionedMember: () => false }))
        const row = memberRow(member)
        expect(plain.Resolve(BuildContributor.PublishId, ctxFor(row))!.CanExecute()).toBe(false)
        const c = new BuildContributor(noBuild, undefined, versioned)
        const publish = c.Resolve(BuildContributor.PublishId, ctxFor(row))!
        expect(publish.CanExecute()).toBe(true)
        publish.Execute()
        expect(versioned.published.at(-1)).toBe(member)
    })

    it('the Build ▸ menu header is always openable; its flavor children do the work', () =>
    {
        const c = new BuildContributor(noBuild, undefined, fakeMutations())
        const header = c.Resolve(BuildContributor.BuildMenuId, ctxFor(memberRow(someMember())))!
        expect(header.CanExecute()).toBe(true)
    })

    it('resolves nothing for a row with no owning member', () =>
    {
        const c = new BuildContributor(noBuild, undefined, fakeMutations())
        const orphan = new FakeItem(NodeKey.Project, { notAMember: true }) as unknown as HierarchyItem
        expect(c.Resolve(BuildContributor.PublishId, ctxFor(orphan))).toBeUndefined()
    })
})

describe('BuildContributor.runBuild', () =>
{
    // work.run invokes the job inline with a fake ctx and surfaces its promise.
    function fakeWork(): { work: never; done: () => Promise<unknown> }
    {
        let p: Promise<unknown> = Promise.resolve()
        const work = { run: (_t: string, job: (ctx: unknown) => Promise<unknown>) => { p = job({ Report: () => {}, Log: () => {} }).catch((e) => e); return p } }
        return { work: work as unknown as never, done: () => p }
    }

    function runIt(client: FakeBuildClient)
    {
        const w = fakeWork()
        const member = memberWithManifest(validManifest)
        const c = new BuildContributor(client, w.work, fakeMutations())
        c.Resolve(BuildContributor.BuildRunId('html-bundle', 'html-bundle'), ctxFor(memberRow(member)))!.Execute()
        return w
    }

    it('calls Build with runId/projectRoot/systemId/flavorId and registers + disposes progress', async () =>
    {
        const client = new FakeBuildClient()
        await runIt(client).done()
        expect(client.builds).toHaveLength(1)
        expect(client.builds[0]).toMatchObject({ projectRoot: '/proj', systemId: 'html-bundle', flavorId: 'html-bundle' })
        expect(client.subscribed).toEqual([client.builds[0].runId])
        expect(client.disposed).toBe(1)
    })

    it('throws the formatted diagnostics on a non-Ok result (and still disposes progress)', async () =>
    {
        const client = new FakeBuildClient()
        client.result = { Ok: false, Diagnostics: [{ severity: 'error', message: 'boom' }] } as unknown as BuildRunResult
        const err = await runIt(client).done()
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toContain('Build failed: ')
        expect((err as Error).message).toContain('boom')
        expect(client.disposed).toBe(1)
    })
})

describe('BuildFlavorSubmenuContributor', () =>
{
    const parent = new CommandDefinition()

    it('shows Loading… before Applicable resolves', () =>
    {
        const sub = new BuildFlavorSubmenuContributor(new FakeBuildClient())
        const rows = sub.Contribute(parent, ctxFor(memberRow(memberWithManifest(validManifest))))
        expect(rows.map((r) => r.Title)).toEqual(['Loading…'])
    })

    it('Warm caches the applicable rows and emits build.run::<system>::<flavor>', async () =>
    {
        const client = new FakeBuildClient()
        client.applicableRows = [htmlRow]
        const sub = new BuildFlavorSubmenuContributor(client)
        const member = memberWithManifest(validManifest)
        sub.Warm(member)
        await flush()
        client.Resolve()
        await flush()
        const rows = sub.Contribute(parent, ctxFor(memberRow(member)))
        expect(rows.map((r) => r.Id)).toEqual(['build.run::html-bundle::html-bundle'])
        expect(rows.map((r) => r.Title)).toEqual(['HTML app'])
    })

    it('shows (nothing to build) when no system applies', async () =>
    {
        const client = new FakeBuildClient()
        const sub = new BuildFlavorSubmenuContributor(client)
        const member = memberWithManifest(validManifest)
        sub.Warm(member)
        await flush()
        client.Resolve()
        await flush()
        expect(sub.Contribute(parent, ctxFor(memberRow(member))).map((r) => r.Title)).toEqual(['(nothing to build)'])
    })

    it('resolving the Build ▸ header warms the submenu', async () =>
    {
        const client = new FakeBuildClient()
        client.applicableRows = [htmlRow]
        const sub = new BuildFlavorSubmenuContributor(client)
        const member = memberWithManifest(validManifest)
        const c = new BuildContributor(client, undefined, fakeMutations(), sub)
        c.Resolve(BuildContributor.BuildMenuId, ctxFor(memberRow(member)))
        await flush()
        client.Resolve()
        await flush()
        expect(sub.Contribute(parent, ctxFor(memberRow(member))).map((r) => r.Title)).toEqual(['HTML app'])
    })
})
