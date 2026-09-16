import { test, expect } from 'vitest'
import { ServiceProvider, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { DropActionKind, type DropAction } from '../arch-drop-resolver.js'
import { DropCandidateChooserService, ChooserRow } from '../drop-candidate-chooser-service.js'

const a: DropAction = { kind: DropActionKind.Reference, concept: 'component', member: 'realisedBy', term: 'Stack.azure', label: 'component  (realisedBy)' }
const b: DropAction = { kind: DropActionKind.Instance, concept: 'component', label: 'component' }

test('Show builds a row per candidate and opens the popup', () => {
    const svc = new DropCandidateChooserService(new ServiceProvider())
    svc.Show([a, b], () => {})
    expect(svc.IsOpen).toBe(true)
    expect(svc.Rows.ToArray().map((r: ChooserRow) => r.Label)).toEqual([a.label, b.label])
})

test('invoking a row command picks that candidate and closes the popup', () => {
    const svc = new DropCandidateChooserService(new ServiceProvider())
    let picked: DropAction | undefined
    svc.Show([a, b], (chosen) => { picked = chosen })
    const row = svc.Rows.ToArray()[1]
    ;(row.Command as ICommand).Execute(undefined)
    expect(picked).toBe(b)
    expect(svc.IsOpen).toBe(false)
    expect(svc.Rows.ToArray()).toHaveLength(0)
})
