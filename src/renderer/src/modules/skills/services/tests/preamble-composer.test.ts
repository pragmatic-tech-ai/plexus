import { test, expect } from 'vitest'
import { PreambleComposer } from '../preamble-composer.js'
import { BindingPayloadKind, type SkillContext } from '../../../../../../shared/skill-context-api.js'
import { BindingSource } from '../../../../../../shared/skill-api.js'

const composer = new PreambleComposer()

test('empty context renders nothing (legacy parity)', () => {
    expect(composer.render({ skillName: 's', inputs: [], bindings: [] })).toBe('')
})

test('inputs + bindings render a deterministic block', () => {
    const ctx: SkillContext = {
        skillName: 's',
        inputs: [{ key: 'viewpoint', value: 'context' }, { key: 'includeExternal', value: true }],
        bindings: [{ source: BindingSource.CurrentProject, kind: BindingPayloadKind.Project, data: { name: 'MyArch', path: '/p' } }],
    }
    const out = composer.render(ctx)
    expect(out).toContain('**Inputs**')
    expect(out).toContain('- viewpoint: context')
    expect(out).toContain('- includeExternal: true')
    expect(out).toContain('**Context**')
    expect(out).toContain('currentProject: MyArch (/p)')
    expect(composer.render(ctx)).toBe(out)       // deterministic
})

test('selection binding summarizes the entity count', () => {
    const out = composer.render({
        skillName: 's', inputs: [],
        bindings: [{ source: BindingSource.DiagramSelection, kind: BindingPayloadKind.Selection, data: { entityIds: ['a', 'b', 'c'] } }],
    })
    expect(out).toContain('diagramSelection: 3 entities')
})
