import { test, expect } from 'vitest'
import { NewProjectCard } from '../new-project-card.js'

test('a fresh card is pending with no summary', () => {
    const card = new NewProjectCard('c1')
    expect(card.Id).toBe('c1')
    expect(card.IsPending).toBe(true)
    expect(card.IsDone).toBe(false)
    expect(card.ResultSummary).toBe('')
})

test('showResult flips to done and summarizes the created project', () => {
    const card = new NewProjectCard('c1')
    card.showResult({ created: true, folder: 'C:/acme', name: 'Acme', type: 'diagram' })
    expect(card.IsPending).toBe(false)
    expect(card.IsDone).toBe(true)
    expect(card.ResultSummary).toContain('Acme')
    expect(card.ResultSummary).toContain('C:/acme')
})

test('showResult on an error reports the error', () => {
    const card = new NewProjectCard('c1')
    card.showResult({ created: false, error: 'boom' })
    expect(card.IsDone).toBe(true)
    expect(card.ResultSummary).toContain('boom')
})

test('showCancelled marks it done with a cancelled note', () => {
    const card = new NewProjectCard('c1')
    card.showCancelled()
    expect(card.IsPending).toBe(false)
    expect(card.ResultSummary.toLowerCase()).toContain('cancel')
})
