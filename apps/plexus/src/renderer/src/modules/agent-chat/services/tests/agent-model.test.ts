import { test, expect } from 'vitest'
import { AgentModel, DEFAULT_MODELS } from '../agent-model.js'

test('DEFAULT_MODELS leads with Default and every option carries a label', () => {
    expect(DEFAULT_MODELS[0].Value).toBe(AgentModel.Default)
    expect(DEFAULT_MODELS.every((o) => o.Label.length > 0)).toBe(true)
})

test('model values are the claude --model aliases', () => {
    const values = DEFAULT_MODELS.map((o) => o.Value)
    expect(values).toContain(AgentModel.Opus)
    expect(values).toContain(AgentModel.Sonnet)
    expect(values).toContain(AgentModel.Haiku)
    expect(AgentModel.Opus).toBe('opus')
    expect(AgentModel.Default).toBe('')
})
