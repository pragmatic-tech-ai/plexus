import { describe, it, expect } from 'vitest'
import { SkillFileCodec, XPlexuses } from '../skill-file-codec.js'
import { InputKind, BindingSource, OutputKind } from '../../../../../../shared/skill-api.js'

const BASE = `---\nname: demo\ndescription: A demo skill.\n---\n\n# Demo\n\nBody text.\n`

describe('SkillFileCodec', () => {
    const codec = new SkillFileCodec()

    it('round-trips a base-only file byte-identically when writing an empty extension', () => {
        expect(codec.writeExtension(BASE, undefined)).toBe(BASE)
    })

    it('reads an empty extension from a base-only file', () => {
        const x = codec.readExtension(BASE)
        expect(x.tags).toEqual([]); expect(x.inputs).toEqual([]); expect(x.title).toBeUndefined()
    })

    it('adds x-plexus while preserving base keys and body', () => {
        const ext = { ...XPlexuses.empty(), version: 1, title: 'Demo', tags: ['a'] }
        const out = codec.writeExtension(BASE, ext)
        expect(out).toContain('name: demo')
        expect(out).toContain('description: A demo skill.')
        expect(out).toContain('# Demo')
        expect(out).toContain('Body text.')
        expect(out).toMatch(/x-plexus:/)
        const back = codec.readExtension(out)
        expect(back.title).toBe('Demo'); expect(back.tags).toEqual(['a']); expect(back.version).toBe(1)
    })

    it('reads typed inputs/bindings/outputs', () => {
        const text = `---\nname: d\ndescription: x\nx-plexus:\n  version: 1\n  inputs:\n    - key: v\n      label: V\n      type: enum\n      options: [a, b]\n      required: true\n  bindings:\n    - source: currentProject\n  outputs:\n    - kind: conversation\n---\nbody\n`
        const x = codec.readExtension(text)
        expect(x.inputs[0]).toMatchObject({ key: 'v', type: InputKind.Enum, options: ['a', 'b'], required: true })
        expect(x.bindings[0].source).toBe(BindingSource.CurrentProject)
        expect(x.outputs[0].kind).toBe(OutputKind.Conversation)
    })

    it('deletes x-plexus when writing undefined, leaving base intact', () => {
        const withExt = codec.writeExtension(BASE, { ...XPlexuses.empty(), version: 1, title: 'T' })
        const stripped = codec.writeExtension(withExt, undefined)
        expect(stripped).not.toMatch(/x-plexus/)
        expect(stripped).toContain('name: demo')
        expect(stripped).toContain('Body text.')
    })

    it('adds a frontmatter fence to a fence-less file', () => {
        const out = codec.writeExtension('# Just a body\n', { ...XPlexuses.empty(), version: 1, title: 'T' })
        expect(out).toMatch(/^---\r?\n/)
        expect(out).toMatch(/x-plexus:/)
        expect(out).toContain('# Just a body')
    })

    it('flags an unknown version but preserves it', () => {
        const text = `---\nname: d\ndescription: x\nx-plexus:\n  version: 99\n---\nbody\n`
        const x = codec.readExtension(text)
        expect(x.unknownVersion).toBe(true); expect(x.version).toBe(99)
    })
})
