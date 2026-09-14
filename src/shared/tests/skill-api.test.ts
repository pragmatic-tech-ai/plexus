import { test, expect } from 'vitest'
import { AgentSkillKind } from '../agent-api.js'
import {
    SkillScope, SkillSourceKind, InputKind, ProjectType, SkillChannel,
    SkillDescriptorFactory, type SkillDescriptor,
} from '../skill-api.js'

test('enum wire values are stable', () => {
    expect(SkillScope.Project).toBe('project')
    expect(SkillSourceKind.ClaudeCode).toBe('claudeCode')
    expect(InputKind.Entity).toBe('entity')
    expect(ProjectType.MetaModel).toBe('metaModel')
    expect(SkillChannel.ListSkills).toBe('skill:list-skills')
})

test('claudeCode factory yields a base descriptor with empty superset fields', () => {
    const d: SkillDescriptor = SkillDescriptorFactory.claudeCode(
        AgentSkillKind.Skill, 'security-review', 'Reviews a diff', SkillScope.Project, '/p/.claude/skills/security-review')
    expect(d.sourceKind).toBe(SkillSourceKind.ClaudeCode)
    expect(d.title).toBe('security-review')          // title falls back to name
    expect(d.tags).toEqual([])
    expect(d.requiresProjectType).toEqual([])
    expect(d.allowedTools).toEqual([])
    expect(d.inputs).toEqual([])
    expect(d.bindings).toEqual([])
    expect(d.outputs).toEqual([])
    expect(d.problems).toEqual([])
    expect(d.deprecation).toBeUndefined()
})
