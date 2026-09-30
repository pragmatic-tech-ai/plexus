import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { type HierarchyItemVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution, SolutionMemberStatus, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SkillActionContributor } from '../skill-action-contributor.js'
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

function memberRowVm(member: SolutionMember): HierarchyItemVM
{
    return { Data: member, Parent: undefined } as unknown as HierarchyItemVM
}

describe('SkillActionContributor', () =>
{
    it('yields a Run action whose Children fill async; an empty catalog leaves an empty, usable submenu', async () =>
    {
        const catalog = { discoverAll: async () => {}, forProject: () => [] }
        const runner = { run: async () => {} }
        const svc = new SkillActionContributor(providerWith(catalog, runner))
        const [run] = svc.ActionsFor({ Anchor: memberRowVm(archMember()), Selection: [] })
        expect(run!.Label).toBe('Run Agent / Skill')
        await tick()
        expect(run!.Children.Count).toBe(0)   // empty catalog → empty submenu, no throw, no spinner-forever
    })

    it('a rejecting discovery leaves an empty, usable submenu and raises no unhandled rejection', async () =>
    {
        const rejections: unknown[] = []
        const onUnhandled = (e: unknown): void => { rejections.push(e) }
        process.on('unhandledRejection', onUnhandled)
        try
        {
            const catalog = { discoverAll: async () => { throw new Error('unreadable project folder') }, forProject: () => [] }
            const runner = { run: async () => {} }
            const svc = new SkillActionContributor(providerWith(catalog, runner))
            const [run] = svc.ActionsFor({ Anchor: memberRowVm(archMember()), Selection: [] })
            await tick()
            expect(run!.Children.Count).toBe(0)
            expect(rejections, `unhandled rejection escaped fill(): ${rejections.map(String).join()}`).toHaveLength(0)
        }
        finally
        {
            process.off('unhandledRejection', onUnhandled)
        }
    })
})
