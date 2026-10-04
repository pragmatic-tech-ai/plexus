import { describe, expect, test } from 'vitest'
import { ActiveSolutionMembers } from '../active-solution-members.js'
import { FakeSolutionManager } from './fake-solution-manager.js'
import { Solution, type SolutionManagerService } from '@pragmatic-tech-ai/todl'

function viewOf(m: FakeSolutionManager): ActiveSolutionMembers
{
  return new ActiveSolutionMembers(m as unknown as SolutionManagerService)
}

describe('ActiveSolutionMembers', () => {
  test('Resolved lists only resolved members, with folder and name from the project', () => {
    const m = new FakeSolutionManager()
    m.AddResolved({ RootPath: '/a', Name: 'A' })
    m.AddUnresolved('/pending')
    const got = viewOf(m).Resolved()
    expect(got.map((r) => [r.Folder, r.Name])).toEqual([['/a', 'A']])
  })

  test('Resolved is empty with no manager or no active solution', () => {
    expect(new ActiveSolutionMembers(undefined).Resolved()).toEqual([])
    const m = new FakeSolutionManager()
    m.ActiveSolution = undefined
    expect(viewOf(m).Resolved()).toEqual([])
  })

  test('Subscribe fires on add, remove, late resolution and solution switch; stops after dispose', () => {
    const m = new FakeSolutionManager()
    let n = 0
    const sub = viewOf(m).Subscribe(() => { n++ })
    const member = m.AddResolved({ RootPath: '/a', Name: 'A' })
    expect(n).toBeGreaterThan(0)
    n = 0
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
})
