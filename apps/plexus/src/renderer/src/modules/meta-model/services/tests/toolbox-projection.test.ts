import { describe, it, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import { projectToolbox } from '../toolbox-projection.js'

// A doc with: a visible taxonomy `actors` (2 terms, one hidden), and a taxonomy
// `plain` with no toolbox annotation (excluded). Annotations are Annotated edges
// to `<node>@toolbox` application nodes carrying the `visible` attr.
function doc(): TodlDocument
{
  return {
    nodes: [
      { id: 'actors', tier: 'Ontology', metaKind: 'taxonomy', attrs: { label: 'Actors' } },
      { id: 'actors@toolbox', tier: 'Ontology', type: 'toolbox', attrs: { visible: true } },
      { id: 'actors.internal', tier: 'Instance', type: 'actor', metaKind: 'term', isClass: true, attrs: { label: 'Internal' } },
      { id: 'actors.external', tier: 'Instance', type: 'actor', metaKind: 'term', isClass: true, attrs: { label: 'External' } },
      { id: 'actors.external@toolbox', tier: 'Instance', type: 'toolbox', attrs: { visible: false } },
      { id: 'plain', tier: 'Ontology', metaKind: 'taxonomy', attrs: { label: 'Plain' } },
      { id: 'plain.x', tier: 'Instance', type: 'actor', metaKind: 'term', isClass: true, attrs: {} },
    ],
    edges: [
      { kind: 'Annotated', via: null, from: 'actors', to: 'actors@toolbox' },
      { kind: 'Contains', via: null, from: 'actors', to: 'actors.internal' },
      { kind: 'Contains', via: null, from: 'actors', to: 'actors.external' },
      { kind: 'Annotated', via: null, from: 'actors.external', to: 'actors.external@toolbox' },
      { kind: 'Contains', via: null, from: 'plain', to: 'plain.x' },
    ],
  } as unknown as TodlDocument
}

describe('projectToolbox', () => {
  it('returns only visible taxonomies, dropping hidden terms', () => {
    const tax = projectToolbox(doc())
    expect(tax.map((t) => t.id)).toEqual(['actors'])          // `plain` excluded (no toolbox annotation)
    expect(tax[0]!.label).toBe('Actors')
    expect(tax[0]!.terms.map((t) => t.id)).toEqual(['actors.internal'])  // external hidden
    expect(tax[0]!.terms[0]!.label).toBe('Internal')
    expect(tax[0]!.terms[0]!.concept).toBe('actor')
  })

  it('a doc with no visible taxonomies yields []', () => {
    const d = { nodes: [{ id: 'plain', tier: 'Ontology', metaKind: 'taxonomy', attrs: {} }], edges: [] } as unknown as TodlDocument
    expect(projectToolbox(d)).toEqual([])
  })
})
