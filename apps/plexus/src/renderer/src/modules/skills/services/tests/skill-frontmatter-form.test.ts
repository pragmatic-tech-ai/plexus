import { describe, it, expect } from 'vitest'
import { SkillFrontmatterFormVm } from '../skill-frontmatter-form.js'
import { XPlexuses } from '../skill-file-codec.js'
import { InputKind, BindingSource, OutputKind } from '../../../../../../shared/skill-api.js'

describe('SkillFrontmatterFormVm', () => {
    it('seeds from an extension and round-trips via toExtension', () => {
        const ext = { ...XPlexuses.empty(), version: 1, title: 'T', category: 'Diagrams',
            inputs: [{ key: 'v', label: 'V', type: InputKind.Enum, options: ['a'], required: true }],
            bindings: [{ source: BindingSource.CurrentProject }], outputs: [{ kind: OutputKind.Conversation }] }
        const vm = new SkillFrontmatterFormVm(ext, false, () => {})
        const back = vm.toExtension()
        expect(back.title).toBe('T'); expect(back.category).toBe('Diagrams')
        expect(back.inputs[0]).toMatchObject({ key: 'v', type: InputKind.Enum, options: ['a'], required: true })
        expect(back.bindings[0].source).toBe(BindingSource.CurrentProject)
        expect(back.outputs[0].kind).toBe(OutputKind.Conversation)
    })

    it('adds and removes an input row and notifies onChange', () => {
        let changes = 0
        const vm = new SkillFrontmatterFormVm(XPlexuses.empty(), false, () => { changes++ })
        vm.AddInputCommand.Execute(undefined)
        expect(vm.Inputs.Count).toBe(1)
        const row = vm.Inputs.Get(0)!
        row.Key = 'x'
        vm.removeInput(row)
        expect(vm.Inputs.Count).toBe(0)
        expect(changes).toBeGreaterThan(0)
    })

    it('blocks edits when read-only', () => {
        const vm = new SkillFrontmatterFormVm({ ...XPlexuses.empty(), title: 'T' }, true, () => {})
        expect(vm.IsReadOnly).toBe(true)
        vm.Title = 'changed'
        expect(vm.Title).toBe('T')
        vm.AddInputCommand.Execute(undefined)
        expect(vm.Inputs.Count).toBe(0)
    })
})
