import { describe, expect, test } from 'vitest'
import { Solution, type SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { ActiveSolutionMembers } from '../active-solution-members.js'
import { FakeSolutionManager } from './fake-solution-manager.js'

class Fixture
{
    public static ViewOf(m: FakeSolutionManager): ActiveSolutionMembers
    {
        return new ActiveSolutionMembers(m as unknown as SolutionManagerService)
    }
}

describe('ActiveSolutionMembers', () => {
    test('Resolved lists only resolved members, with folder and name from the project', () => {
        const m = new FakeSolutionManager()
        m.AddResolved({ RootPath: '/a', Name: 'A' })
        m.AddUnresolved('/pending')
        const got = Fixture.ViewOf(m).Resolved()
        expect(got.map((r) => [r.Folder, r.Name])).toEqual([['/a', 'A']])
    })

    test('Resolved is empty with no manager or no active solution', () => {
        expect(new ActiveSolutionMembers(undefined).Resolved()).toEqual([])
        const m = new FakeSolutionManager()
        m.ActiveSolution = undefined
        expect(Fixture.ViewOf(m).Resolved()).toEqual([])
    })

    test('Subscribe fires on add, remove, late resolution and solution switch; stops after dispose', () => {
        const m = new FakeSolutionManager()
        let n = 0
        const sub = Fixture.ViewOf(m).Subscribe(() => { n++ })
        const member = m.AddResolved({ RootPath: '/a', Name: 'A' })
        expect(n).toBeGreaterThan(0)
        const late = m.AddUnresolved('/b')
        n = 0
        late.Project = { RootPath: '/b', Name: 'B' }
        expect(n).toBe(1)                      // a pending member resolving re-notifies
        n = 0
        m.Remove(member)
        expect(n).toBe(1)
        n = 0
        const next = new Solution('other')
        m.ActiveSolution = next
        expect(n).toBe(1)
        n = 0
        next.AddMember('/c', 'fake')           // re-subscribed to the NEW solution's Members
        expect(n).toBe(1)
        sub.dispose()
        n = 0
        next.AddMember('/d', 'fake')
        expect(n).toBe(0)
    })

    test('a removed member stops notifying immediately', () => {
        const m = new FakeSolutionManager()
        const member = m.AddResolved({ RootPath: '/a', Name: 'A' })
        let n = 0
        const sub = Fixture.ViewOf(m).Subscribe(() => { n++ })
        m.Remove(member)
        n = 0
        member.Project = { RootPath: '/a2', Name: 'A2' }
        expect(n).toBe(0)
        sub.dispose()
    })

    test('a cleared then re-added member notifies on its later resolution', () => {
        const m = new FakeSolutionManager()
        const members = m.ActiveSolution!.Members
        const first = m.AddResolved({ RootPath: '/a', Name: 'A' })
        let n = 0
        const sub = Fixture.ViewOf(m).Subscribe(() => { n++ })
        members.Clear()
        n = 0
        members.Add(first)
        n = 0
        first.Project = { RootPath: '/a2', Name: 'A2' }
        expect(n).toBe(1)
        sub.dispose()
    })
})
