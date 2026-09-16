import { describe, it, expect } from 'vitest'
import {
  TodlSemanticScope, editorSemanticLegend, todlSemanticThemeRules,
  TODL_KEYWORD_BLUE_DARK, TODL_KEYWORD_BLUE_LIGHT,
} from '../semantic-scopes.js'

const SERVER = { tokenTypes: ['type', 'class', 'enumMember', 'property', 'method', 'variable'], tokenModifiers: [] }

describe('editorSemanticLegend', () => {
  it('renames EVERY token type to a todl* scope, order preserved', () => {
    const legend = editorSemanticLegend(SERVER)
    expect(legend.tokenTypes).toEqual([
      TodlSemanticScope.Type, TodlSemanticScope.Class,
      'todlEnumMember', 'todlProperty', 'todlMethod', 'todlVariable',
    ])
  })
  it('leaves no generic scope leaking through to the base theme', () => {
    const legend = editorSemanticLegend(SERVER)
    for (const generic of ['type', 'class', 'variable', 'property', 'method', 'enumMember'])
      expect(legend.tokenTypes).not.toContain(generic)
  })
  it('prefixes an unknown token type too', () => {
    expect(editorSemanticLegend({ tokenTypes: ['namespace'], tokenModifiers: [] }).tokenTypes)
      .toEqual(['todlNamespace'])
  })
  it('carries modifiers through and does not mutate the server legend', () => {
    const server = { tokenTypes: ['type'], tokenModifiers: ['declaration'] }
    const legend = editorSemanticLegend(server)
    expect(legend.tokenModifiers).toEqual(['declaration'])
    expect(server.tokenTypes).toEqual(['type'])
  })
})

describe('todlSemanticThemeRules', () => {
  it('colors ONLY the two concept scopes the dark keyword blue', () => {
    const rules = todlSemanticThemeRules(true)
    expect(rules).toEqual([
      { token: TodlSemanticScope.Type, foreground: TODL_KEYWORD_BLUE_DARK },
      { token: TodlSemanticScope.Class, foreground: TODL_KEYWORD_BLUE_DARK },
    ])
  })
  it('uses the light keyword blue on a light base', () => {
    const rules = todlSemanticThemeRules(false)
    expect(rules.every((r) => r.foreground === TODL_KEYWORD_BLUE_LIGHT)).toBe(true)
  })
})
