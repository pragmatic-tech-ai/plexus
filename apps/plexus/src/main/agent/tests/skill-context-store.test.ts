import { test, expect } from 'vitest'
import { SkillContextStore } from '../skill-context-store.js'
import { BindingPayloadKind, type SkillContext } from '../../../shared/skill-context-api.js'
import { BindingSource } from '../../../shared/skill-api.js'

const ctx: SkillContext = {
    skillName: 's', inputs: [{ key: 'k', value: 1 }],
    bindings: [{ source: BindingSource.CurrentProject, kind: BindingPayloadKind.Project, data: { path: '/p' } }],
}

test('set then get returns the context for that session', () => {
    const store = new SkillContextStore()
    store.set('sess-1', ctx)
    expect(store.get('sess-1')).toEqual(ctx)
})

test('get on an unknown session returns an empty context', () => {
    expect(new SkillContextStore().get('nope').inputs).toEqual([])
})

test('clear removes the session entry', () => {
    const store = new SkillContextStore()
    store.set('s', ctx); store.clear('s')
    expect(store.get('s').inputs).toEqual([])
})
