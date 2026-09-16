import { test, expect } from 'vitest'
import { load } from '@pragmatic-tech-ai/todl'
import { defaultLabel, humanize } from '../arch-default-label.js'
import { DropActionKind, type DropAction } from '../arch-drop-resolver.js'

const MM = `namespace ta {
  concept component {}
  taxonomy Kinds : represents component { term m365_copilot { label = "M365 Copilot"; } term barebones {} }
}`
function repo() { return load([{ uri: 'mm.todl', text: MM }]).model }

test('humanize turns an id into a title-cased phrase', () => {
    expect(humanize('m365_copilot')).toBe('M365 Copilot')
    expect(humanize('component')).toBe('Component')
    expect(humanize('Kinds.barebones')).toBe('Barebones')
})

test('a reference drop uses the dropped term label when present', () => {
    const action: DropAction = { kind: DropActionKind.Reference, concept: 'edge', member: 'end', term: 'Kinds.m365_copilot', label: 'x' }
    expect(defaultLabel(repo(), action)).toBe('M365 Copilot')
})

test('a reference drop falls back to a humanized term id when unlabelled', () => {
    const action: DropAction = { kind: DropActionKind.Reference, concept: 'edge', member: 'end', term: 'Kinds.barebones', label: 'x' }
    expect(defaultLabel(repo(), action)).toBe('Barebones')
})

test('an instance drop uses a humanized concept name', () => {
    const action: DropAction = { kind: DropActionKind.Instance, concept: 'component', label: 'x' }
    expect(defaultLabel(repo(), action)).toBe('Component')
})
