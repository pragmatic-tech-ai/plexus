import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition } from '@pragmatic-tech-ai/mural/framework'
import { Solution, type BuildService, type SolutionMember } from '@pragmatic-tech-ai/todl'
import type { BuildSystemRegistry } from '@pragmatic-tech-ai/todl/build-system-core'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { BuildContributor, BuildFlavorSubmenuContributor } from '../build-contributor.js'
import { BuildProgressReporter } from '../build-progress-reporter.js'
import type { IContentMutations } from '../content-mutations.js'

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

interface BuildCall
{
    storage: unknown
    systemId: string
    flavorId: string | undefined
    progress: unknown
    options: unknown
}

// A fake BuildService: records Build calls and returns a canned ProjectBuildOutput.
class FakeBuildService
{
    public builds: BuildCall[] = []
    public result: unknown = { Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } }

    public async Build(storage: unknown, systemId: string, flavorId?: string, progress?: unknown, options?: unknown): Promise<unknown>
    {
        this.builds.push({ storage, systemId, flavorId, progress, options })
        return this.result
    }

    public AsService(): BuildService
    {
        return this as unknown as BuildService
    }
}

// A fake BuildSystemRegistry: For() ignores the manifest and returns one system with the given flavors.
class FakeRegistry
{
    constructor(private readonly flavors: ReadonlyArray<{ Id: string; DisplayName: string }>)
    {
    }

    public For(_manifest: unknown): readonly unknown[]
    {
        if (this.flavors.length === 0) return []
        return [{ Id: 'html-bundle', DisplayName: 'HTML', Flavors: () => this.flavors }]
    }

    public AsRegistry(): BuildSystemRegistry
    {
        return this as unknown as BuildSystemRegistry
    }
}

class BuildTestHelper
{
    public static FakeMutations(over: Partial<IContentMutations> = {}): IContentMutations & { published: SolutionMember[] }
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

    public static MemberRow(member: SolutionMember): HierarchyItem
    {
        return new FakeItem(NodeKey.Project, member) as unknown as HierarchyItem
    }

    public static CtxFor(anchor: HierarchyItem): HierarchyActionContext
    {
        return new HierarchyActionContext(anchor, [anchor])
    }

    public static NoBuild(): BuildService
    {
        return new FakeBuildService().AsService()
    }

    public static HtmlRegistry(): BuildSystemRegistry
    {
        return new FakeRegistry([{ Id: 'html-bundle', DisplayName: 'HTML app' }]).AsRegistry()
    }

    public static SomeMember(): SolutionMember
    {
        return new Solution('S').AddMember('./p', 'architecture')
    }

    // A member whose storage returns a manifest JSON for the flavor-submenu read.
    public static MemberWithManifest(json: string): SolutionMember
    {
        const m = new Solution('S').AddMember('./p', 'architecture')
        m.Storage = { ReadText: async () => json } as unknown as IStorage
        return m
    }

    public static readonly ValidManifest = '{"type":"architecture","name":"a","version":1}'

    public static Flush(): Promise<void>
    {
        return new Promise((r) => setTimeout(r, 0))
    }

    // work.run invokes the job inline with a fake ctx and surfaces its promise.
    public static FakeWork(): { work: never; done: () => Promise<unknown> }
    {
        let p: Promise<unknown> = Promise.resolve()
        const work = { run: (_t: string, job: (ctx: unknown) => Promise<unknown>) => { p = job({ Report: () => {}, Log: () => {} }).catch((e) => e); return p } }
        return { work: work as unknown as never, done: () => p }
    }

    public static RunIt(service: FakeBuildService, member: SolutionMember = BuildTestHelper.MemberWithManifest(BuildTestHelper.ValidManifest))
    {
        const w = BuildTestHelper.FakeWork()
        const c = new BuildContributor(service.AsService(), w.work, BuildTestHelper.FakeMutations())
        c.Resolve(BuildContributor.BuildRunId('html-bundle', 'html-bundle'), BuildTestHelper.CtxFor(BuildTestHelper.MemberRow(member)))!.Execute()
        return w
    }
}

describe('BuildContributor', () =>
{
    it('contributes Build ▸ and Publish on the project row, Context-tagged to NodeKey.Project', () =>
    {
        const c = new BuildContributor(BuildTestHelper.NoBuild(), undefined, BuildTestHelper.FakeMutations())
        const titles = c.Actions.map((a) => a.Title)
        expect(titles).toContain('Build')
        expect(titles).toContain('Publish')
        expect(c.Actions.every((a) => a.Context === HierarchyContext.For(NodeKey.Project))).toBe(true)
    })

    it('Publish is executable only for a versioned member and routes to mutations.PublishMember', () =>
    {
        const member = BuildTestHelper.SomeMember()
        const versioned = BuildTestHelper.FakeMutations({ IsVersionedMember: () => true })
        const plain = new BuildContributor(BuildTestHelper.NoBuild(), undefined, BuildTestHelper.FakeMutations({ IsVersionedMember: () => false }))
        const row = BuildTestHelper.MemberRow(member)
        expect(plain.Resolve(BuildContributor.PublishId, BuildTestHelper.CtxFor(row))!.CanExecute()).toBe(false)
        const c = new BuildContributor(BuildTestHelper.NoBuild(), undefined, versioned)
        const publish = c.Resolve(BuildContributor.PublishId, BuildTestHelper.CtxFor(row))!
        expect(publish.CanExecute()).toBe(true)
        publish.Execute()
        expect(versioned.published.at(-1)).toBe(member)
    })

    it('the Build ▸ menu header is always openable; its flavor children do the work', () =>
    {
        const c = new BuildContributor(BuildTestHelper.NoBuild(), undefined, BuildTestHelper.FakeMutations())
        const header = c.Resolve(BuildContributor.BuildMenuId, BuildTestHelper.CtxFor(BuildTestHelper.MemberRow(BuildTestHelper.SomeMember())))!
        expect(header.CanExecute()).toBe(true)
    })

    it('resolves nothing for a row with no owning member', () =>
    {
        const c = new BuildContributor(BuildTestHelper.NoBuild(), undefined, BuildTestHelper.FakeMutations())
        const orphan = new FakeItem(NodeKey.Project, { notAMember: true }) as unknown as HierarchyItem
        expect(c.Resolve(BuildContributor.PublishId, BuildTestHelper.CtxFor(orphan))).toBeUndefined()
    })
})

describe('BuildContributor.runBuild', () =>
{
    it('calls Build with the member storage, systemId/flavorId and a BuildProgressReporter', async () =>
    {
        const svc = new FakeBuildService()
        const member = BuildTestHelper.MemberWithManifest(BuildTestHelper.ValidManifest)
        await BuildTestHelper.RunIt(svc, member).done()
        expect(svc.builds).toHaveLength(1)
        expect(svc.builds[0].storage).toBe(member.Storage)
        expect(svc.builds[0].systemId).toBe('html-bundle')
        expect(svc.builds[0].flavorId).toBe('html-bundle')
        expect(svc.builds[0].progress).toBeInstanceOf(BuildProgressReporter)
    })

    it('throws the formatted diagnostics on a non-Ok result', async () =>
    {
        const svc = new FakeBuildService()
        svc.result = { Result: { Ok: false, Diagnostics: [{ severity: 'error', message: 'boom' }] } }
        const err = await BuildTestHelper.RunIt(svc).done()
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toContain('Build failed: ')
        expect((err as Error).message).toContain('boom')
    })
})

describe('BuildFlavorSubmenuContributor', () =>
{
    const parent = new CommandDefinition()

    it('shows Loading… before the manifest read resolves', () =>
    {
        const sub = new BuildFlavorSubmenuContributor(BuildTestHelper.HtmlRegistry())
        const rows = sub.Contribute(parent, BuildTestHelper.CtxFor(BuildTestHelper.MemberRow(BuildTestHelper.MemberWithManifest(BuildTestHelper.ValidManifest))))
        expect(rows.map((r) => r.Title)).toEqual(['Loading…'])
    })

    it('Warm computes the applicable rows locally and emits build.run::<system>::<flavor>', async () =>
    {
        const sub = new BuildFlavorSubmenuContributor(BuildTestHelper.HtmlRegistry())
        const member = BuildTestHelper.MemberWithManifest(BuildTestHelper.ValidManifest)
        sub.Warm(member)
        await BuildTestHelper.Flush()
        const rows = sub.Contribute(parent, BuildTestHelper.CtxFor(BuildTestHelper.MemberRow(member)))
        expect(rows.map((r) => r.Id)).toEqual(['build.run::html-bundle::html-bundle'])
        expect(rows.map((r) => r.Title)).toEqual(['HTML app'])
    })

    it('shows (nothing to build) when no system applies', async () =>
    {
        const sub = new BuildFlavorSubmenuContributor(new FakeRegistry([]).AsRegistry())
        const member = BuildTestHelper.MemberWithManifest(BuildTestHelper.ValidManifest)
        sub.Warm(member)
        await BuildTestHelper.Flush()
        expect(sub.Contribute(parent, BuildTestHelper.CtxFor(BuildTestHelper.MemberRow(member))).map((r) => r.Title)).toEqual(['(nothing to build)'])
    })

    it('shows (nothing to build) when the manifest text is unparseable', async () =>
    {
        const sub = new BuildFlavorSubmenuContributor(BuildTestHelper.HtmlRegistry())
        const member = BuildTestHelper.MemberWithManifest('not json')
        sub.Warm(member)
        await BuildTestHelper.Flush()
        expect(sub.Contribute(parent, BuildTestHelper.CtxFor(BuildTestHelper.MemberRow(member))).map((r) => r.Title)).toEqual(['(nothing to build)'])
    })

    it('resolving the Build ▸ header warms the submenu', async () =>
    {
        const sub = new BuildFlavorSubmenuContributor(BuildTestHelper.HtmlRegistry())
        const member = BuildTestHelper.MemberWithManifest(BuildTestHelper.ValidManifest)
        const c = new BuildContributor(BuildTestHelper.NoBuild(), undefined, BuildTestHelper.FakeMutations(), sub)
        c.Resolve(BuildContributor.BuildMenuId, BuildTestHelper.CtxFor(BuildTestHelper.MemberRow(member)))
        await BuildTestHelper.Flush()
        expect(sub.Contribute(parent, BuildTestHelper.CtxFor(BuildTestHelper.MemberRow(member))).map((r) => r.Title)).toEqual(['HTML app'])
    })
})
