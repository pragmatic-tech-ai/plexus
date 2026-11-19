import { test, expect } from 'vitest'
import { BindingPayloadKind, SkillContextChannel, SkillContexts, type SkillContext } from '../skill-context-api.js'

test('enum wire values are stable', () => {
    expect(BindingPayloadKind.Selection).toBe('selection')
    expect(SkillContextChannel.SetContext).toBe('skill-context:set')
})

test('empty context has the skill name and no inputs/bindings', () => {
    const c: SkillContext = SkillContexts.empty('gen-board')
    expect(c).toEqual({ skillName: 'gen-board', inputs: [], bindings: [] })
})
