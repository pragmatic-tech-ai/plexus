import { test, expect } from 'vitest'
import { load } from '@pragmatic-tech-ai/todl'
import { conceptTypeOf, acceptSet } from '../arch-concept-type.js'

const MM = `namespace m {
  concept technology {}
  concept component {}
  concept application : component {}
  taxonomy Stack : represents technology { term azure {} }
}`
function repo() { return load([{ uri: 'm.todl', text: MM }]).model }

test('conceptTypeOf: a taxonomy term resolves to the concept its taxonomy represents', () => {
    expect(conceptTypeOf(repo(), 'm.Stack.azure')).toBe('m.technology')
})

test('conceptTypeOf: a bare concept resolves to itself', () => {
    expect(conceptTypeOf(repo(), 'm.component')).toBe('m.component')
})

test('acceptSet: a concept plus its supertypes', () => {
    expect(acceptSet(repo(), 'm.application')).toEqual(new Set(['m.application', 'm.component']))
})
