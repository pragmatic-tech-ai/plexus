import { test, expect } from 'vitest'
import { AgentSkillKind } from '../../../shared/agent-api.js'
import { SkillFrontmatterParser } from '../skill-frontmatter-parser.js'
import { SkillScope, SkillSourceKind, InputKind, BindingSource, OutputKind, ProjectType, SkillProblemSeverity } from '../../../shared/skill-api.js'

const CTX = { kind: AgentSkillKind.Skill, fallbackName: 'fallback', scope: SkillScope.Project, folderPath: '/p/.claude/skills/x' }
const parser = new SkillFrontmatterParser()

const BASE = `---
name: plain-skill
description: A plain skill.
---
# body`

const SUPER = `---
name: gen-diagram
description: Make a diagram.
x-plexus:
  version: 1
  title: Generate Diagram
  category: Diagrams
  model: sonnet
  tags: [c4, arch]
  requiresProjectType: [Architecture]
  allowedTools: [Read, Grep]
  deprecation:
    replacedBy: gen-c4
    note: superseded
  inputs:
    - key: viewpoint
      label: Viewpoint
      type: Enum
      options: [context, container]
      required: true
      default: context
  bindings:
    - source: CurrentProject
    - source: DiagramSelection
      as: selectedNodes
  outputs:
    - kind: Conversation
    - kind: ModelPatch
      target: CurrentProject
---
# body`

test('base-only skill parses to a ClaudeCode descriptor', () => {
    const d = parser.parse(BASE, CTX)
    expect(d.name).toBe('plain-skill')
    expect(d.description).toBe('A plain skill.')
    expect(d.title).toBe('plain-skill')
    expect(d.sourceKind).toBe(SkillSourceKind.ClaudeCode)
    expect(d.problems).toEqual([])
})

test('x-plexus block parses all superset fields', () => {
    const d = parser.parse(SUPER, CTX)
    expect(d.sourceKind).toBe(SkillSourceKind.PlexusSuperset)
    expect(d.title).toBe('Generate Diagram')
    expect(d.category).toBe('Diagrams')
    expect(d.model).toBe('sonnet')
    expect(d.tags).toEqual(['c4', 'arch'])
    expect(d.requiresProjectType).toEqual([ProjectType.Architecture])
    expect(d.allowedTools).toEqual(['Read', 'Grep'])
    expect(d.deprecation).toEqual({ replacedBy: 'gen-c4', note: 'superseded' })
    expect(d.inputs[0]).toEqual({ key: 'viewpoint', label: 'Viewpoint', type: InputKind.Enum, options: ['context', 'container'], required: true, default: 'context' })
    expect(d.bindings).toEqual([{ source: BindingSource.CurrentProject, as: undefined }, { source: BindingSource.DiagramSelection, as: 'selectedNodes' }])
    expect(d.outputs).toEqual([{ kind: OutputKind.Conversation, target: undefined }, { kind: OutputKind.ModelPatch, target: 'CurrentProject' }])
})

test('missing frontmatter yields a base descriptor with a warning, never throws', () => {
    const d = parser.parse('# just a body, no fence', CTX)
    expect(d.name).toBe('fallback')
    expect(d.sourceKind).toBe(SkillSourceKind.ClaudeCode)
    expect(d.problems.some(p => p.severity === SkillProblemSeverity.Warning)).toBe(true)
})

test('malformed YAML yields a problem, not a throw', () => {
    const d = parser.parse('---\nname: "unterminated\n---', CTX)
    expect(d.problems.length).toBeGreaterThan(0)
    expect(d.name).toBe('fallback')
})

test('unknown x-plexus.version degrades to base + a problem', () => {
    const d = parser.parse('---\nname: n\ndescription: d\nx-plexus:\n  version: 999\n---', CTX)
    expect(d.sourceKind).toBe(SkillSourceKind.ClaudeCode)
    expect(d.problems.some(p => /version/i.test(p.message))).toBe(true)
})

test('unknown enum member for an input type is a problem, input dropped', () => {
    const d = parser.parse('---\nname: n\ndescription: d\nx-plexus:\n  version: 1\n  inputs:\n    - key: k\n      label: L\n      type: Bogus\n---', CTX)
    expect(d.inputs).toEqual([])
    expect(d.problems.some(p => /Bogus|type/i.test(p.message))).toBe(true)
})
