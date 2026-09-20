import { test, expect } from 'vitest'
import { BindingResolver, type BindingContextSources } from '../binding-resolver.js'
import { BindingSource } from '../../../../../../shared/skill-api.js'
import { BindingPayloadKind } from '../../../../../../shared/skill-context-api.js'

function sources(over: Partial<BindingContextSources> = {}): BindingContextSources
{
    return {
        currentProject: () => ({ name: 'P', path: '/p' }),
        diagramSelection: () => ({ entityIds: ['a', 'b'], entities: [{ id: 'a' }, { id: 'b' }] }),
        activeDocument: () => ({ path: '/p/x.todl', kind: 'todl' }),
        primaryEntity: () => ({ id: 'a', term: 'Service' }),
        workspaceRoot: () => ({ path: '/ws' }),
        ...over,
    }
}

test('resolves each source to its payload kind, preserving the alias', () => {
    const r = new BindingResolver(sources())
    const out = r.resolve([
        { source: BindingSource.CurrentProject }, { source: BindingSource.DiagramSelection },
        { source: BindingSource.ActiveDocument }, { source: BindingSource.EntityRef, as: 'ent' },
        { source: BindingSource.WorkspaceRoot },
    ])
    expect(out.map(b => b.kind)).toEqual([
        BindingPayloadKind.Project, BindingPayloadKind.Selection, BindingPayloadKind.Document,
        BindingPayloadKind.Entity, BindingPayloadKind.Path,
    ])
    expect(out[3].as).toBe('ent')
})

test('absent context resolves to Empty, never throws', () => {
    const r = new BindingResolver(sources({ diagramSelection: () => undefined }))
    const [b] = r.resolve([{ source: BindingSource.DiagramSelection }])
    expect(b.kind).toBe(BindingPayloadKind.Empty)
    expect(b.data).toBeNull()
})
