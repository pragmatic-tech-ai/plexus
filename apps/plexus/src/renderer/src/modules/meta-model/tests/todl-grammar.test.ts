import { describe, it, expect } from 'vitest'
import {
  TODL_KEYWORDS, TODL_OPERATOR_PATTERN, TODL_IDENTIFIER_PATTERN, todlMonarchLanguage,
} from '../todl-grammar.js'

describe('TODL Monarch grammar data', () => {
  it('includes the current C-like keyword set', () => {
    for (const kw of [
      'namespace', 'import', 'package', 'primitive', 'concept', 'taxonomy', 'viewpoint',
      'annotation', 'annotate', 'model', 'operator', 'relationship', 'invariant', 'term',
      'class', 'internal', 'sealed', 'extends', 'represents', 'frames', 'uses', 'conforms',
      'instanceof', 'authoring', 'true', 'false',
    ]) expect(TODL_KEYWORDS).toContain(kw)
  })

  it('drops the stale pre-cutover kebab vocabulary', () => {
    for (const stale of ['meta-model', 'root-concept', 'top-level-concepts', 'enum', 'implies', 'none', 'this'])
      expect(TODL_KEYWORDS).not.toContain(stale)
  })

  it('matches operator glyphs but not a lone assignment =', () => {
    for (const glyph of ['->', '-->', '==>', '~>', '->>', '==', '!='])
      expect(new RegExp(`^${TODL_OPERATOR_PATTERN.source}$`).test(glyph)).toBe(true)
    expect(new RegExp(`^${TODL_OPERATOR_PATTERN.source}$`).test('=')).toBe(false)
  })

  it('uses a C-like identifier pattern (no kebab, no & sigil)', () => {
    expect(new RegExp(`^${TODL_IDENTIFIER_PATTERN.source}$`).test('agent_orchestrator')).toBe(true)
    expect(new RegExp(`^${TODL_IDENTIFIER_PATTERN.source}$`).test('agent-orchestrator')).toBe(false)
    expect(new RegExp(`^${TODL_IDENTIFIER_PATTERN.source}$`).test('&ref')).toBe(false)
  })

  it('routes operator glyphs and keywords to the keyword scope in the tokenizer', () => {
    const root = (todlMonarchLanguage as { tokenizer: { root: unknown[][] } }).tokenizer.root
    const flat = JSON.stringify(root)
    expect(flat).toContain('keyword')
    // the & sigil variable rule is gone
    expect(flat).not.toContain('&[A-Za-z]')
  })
})
