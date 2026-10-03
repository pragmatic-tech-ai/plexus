import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { CommandDefinition } from '@pragmatic-tech-ai/mural/framework'
import { HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution, SolutionMemberStatus, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SkillActionContributor } from '../skill-action-contributor.js'
import { SkillRunSubmenuContributor } from '../skill-run-submenu-contributor.js'
import { SkillCatalog } from '../skill-catalog.js'
import { SkillRunner } from '../skill-runner.js'

const tick = () => new Promise((r) => setTimeout(r, 10))

function providerWith(catalog: unknown, runner: unknown): ServiceProvider
{
    const p = new ServiceProvider()
    p.registerInstance(SkillCatalog.Key, catalog as SkillCatalog)
    p.registerInstance(SkillRunner.Key, runner as SkillRunner)
    return p
}

function archMember(): SolutionMember
{
    const m = new Solution('S').AddMember('./p', 'architecture')
    m.Status = SolutionMemberStatus.Resolved
    m.Storage = new FakeStorage('/p')
    return m
}

function memberRow(member: SolutionMember): HierarchyItem
{
    return { Key: 'project', ExtObject: member, Parent: undefined } as unknown as HierarchyItem
}

const ctx = (anchor: HierarchyItem): HierarchyActionContext => new HierarchyActionContext(anchor, [anchor])

describe('SkillActionContributor', () =>
{
    it('the Run header resolves + kicks discovery; the lazy submenu stays a disabled placeholder for an empty catalog', async () =>
    {
        const catalog = { discoverAll: async () => {}, forProject: () => [] }
        const runner = { run: async () => {} }
        const provider = providerWith(catalog, runner)
        const svc = new SkillActionContributor(provider)
        const submenu = new SkillRunSubmenuContributor(provider)
        const anchor = memberRow(archMember())

        const header = svc.Resolve(SkillActionContributor.RunId, ctx(anchor))!   // starts discovery (fire-and-forget)
        expect(header.CanExecute()).toBe(true)
        await tick()
        const rows = submenu.Contribute(new CommandDefinition(), ctx(anchor))
        expect(rows.length).toBe(1)                                              // empty catalog → one placeholder row, no throw
        expect(svc.Resolve(rows[0]!.Id, ctx(anchor))!.CanExecute()).toBe(false)  // the placeholder is disabled
    })

    it('a rejecting discovery leaves a usable (disabled-placeholder) submenu and raises no unhandled rejection', async () =>
    {
        const rejections: unknown[] = []
        const onUnhandled = (e: unknown): void => { rejections.push(e) }
        process.on('unhandledRejection', onUnhandled)
        try
        {
            const catalog = { discoverAll: async () => { throw new Error('unreadable project folder') }, forProject: () => [] }
            const runner = { run: async () => {} }
            const provider = providerWith(catalog, runner)
            const svc = new SkillActionContributor(provider)
            const submenu = new SkillRunSubmenuContributor(provider)
            const anchor = memberRow(archMember())
            svc.Resolve(SkillActionContributor.RunId, ctx(anchor))   // triggers the rejecting discovery
            await tick()
            const rows = submenu.Contribute(new CommandDefinition(), ctx(anchor))
            expect(rows.length).toBe(1)
            expect(svc.Resolve(rows[0]!.Id, ctx(anchor))!.CanExecute()).toBe(false)
            expect(rejections, `unhandled rejection escaped Discover(): ${rejections.map(String).join()}`).toHaveLength(0)
        }
        finally
        {
            process.off('unhandledRejection', onUnhandled)
        }
    })

    it('a discovered skill yields a runnable child that routes to the runner', async () =>
    {
        const skill = { Name: 'build-docs', Kind: 'skill' }
        const runs: string[] = []
        const catalog = { discoverAll: async () => {}, forProject: () => [skill] }
        const runner = { run: async (s: { Name: string }) => { runs.push(s.Name) } }
        const provider = providerWith(catalog, runner)
        const svc = new SkillActionContributor(provider)
        const submenu = new SkillRunSubmenuContributor(provider)
        const anchor = memberRow(archMember())

        const rows = submenu.Contribute(new CommandDefinition(), ctx(anchor))
        const row = rows.find((d) => d.Id === `${SkillActionContributor.RunChildPrefix}build-docs`)!
        expect(row).toBeDefined()
        svc.Resolve(row.Id, ctx(anchor))!.Execute()
        await tick()
        expect(runs).toEqual(['build-docs'])
    })
})
