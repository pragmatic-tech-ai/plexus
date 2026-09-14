import { test, expect } from 'vitest'
import { PlexusMcpServer } from '../plexus-mcp-server.js'
import { BindingPayloadKind, type SkillContext } from '../../../shared/skill-context-api.js'
import { BindingSource } from '../../../shared/skill-api.js'

const ctx: SkillContext = {
    skillName: 'gen',
    inputs: [{ key: 'vp', value: 'context' }],
    bindings: [{ source: BindingSource.CurrentProject, kind: BindingPayloadKind.Project, data: { path: '/p' } }],
}

test('setSkillContext stores per session; clear removes it', () => {
    const server = new PlexusMcpServer()
    server.setSkillContext('sess-1', ctx)
    expect(server.skillContextFor('sess-1')).toEqual(ctx)
    server.clearSkillContext('sess-1')
    expect(server.skillContextFor('sess-1').inputs).toEqual([])
})

test('context is keyed by session — a different session is empty', () => {
    const server = new PlexusMcpServer()
    server.setSkillContext('sess-1', ctx)
    expect(server.skillContextFor('other').bindings).toEqual([])
})
