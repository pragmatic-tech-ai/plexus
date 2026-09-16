import { describe, it, expect } from 'vitest'
import { SkillValidator } from '../skill-validator.js'
import { XPlexuses } from '../skill-file-codec.js'
import { InputKind, SkillProblemSeverity } from '../../../../../../shared/skill-api.js'

describe('SkillValidator', () => {
    const v = new SkillValidator()

    it('accepts a valid superset object', () => {
        const ext = { ...XPlexuses.empty(), version: 1, title: 'T',
            inputs: [{ key: 'a', label: 'A', type: InputKind.Text }] }
        expect(v.validate(ext)).toEqual([])
    })

    it('flags an unsupported version', () => {
        const p = v.validate({ ...XPlexuses.empty(), version: 2 })
        expect(p.some(x => x.severity === SkillProblemSeverity.Warning && /version/i.test(x.message))).toBe(true)
    })

    it('flags an input missing a key', () => {
        const p = v.validate({ ...XPlexuses.empty(), version: 1,
            inputs: [{ key: '', label: 'A', type: InputKind.Text }] })
        expect(p.some(x => /key/i.test(x.message))).toBe(true)
    })

    it('flags duplicate input keys', () => {
        const p = v.validate({ ...XPlexuses.empty(), version: 1, inputs: [
            { key: 'a', label: 'A', type: InputKind.Text }, { key: 'a', label: 'B', type: InputKind.Text }] })
        expect(p.some(x => /duplicate/i.test(x.message))).toBe(true)
    })

    it('flags an Enum input with no options', () => {
        const p = v.validate({ ...XPlexuses.empty(), version: 1,
            inputs: [{ key: 'a', label: 'A', type: InputKind.Enum, options: [] }] })
        expect(p.some(x => /option/i.test(x.message))).toBe(true)
    })
})
