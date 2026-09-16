import { test, expect } from 'vitest'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { readDiagramViewpoints, writeDiagramViewpoints } from '../diagram-viewpoints.js'

async function seeded(): Promise<FakeStorage> {
    const s = new FakeStorage('fake://Acme')
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({
        type: 'architecture', name: 'Acme', version: 1,
        metaModel: { id: 'ea', version: '5' }, libraries: [{ id: 'aws', version: '2' }],
    }))
    return s
}

test('write then read round-trips a diagram’s viewpoints', async () => {
    const s = await seeded()
    await writeDiagramViewpoints(s, 'deploy.diagram', ['DeploymentView'])
    expect(await readDiagramViewpoints(s, 'deploy.diagram')).toEqual(['DeploymentView'])
})

test('write preserves the other manifest fields', async () => {
    const s = await seeded()
    await writeDiagramViewpoints(s, 'deploy.diagram', ['DeploymentView'])
    const m = JSON.parse(await s.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.name).toBe('Acme')
    expect(m.metaModel).toEqual({ id: 'ea', version: '5' })
    expect(m.libraries).toEqual([{ id: 'aws', version: '2' }])
})

test('reading an absent diagram path returns undefined', async () => {
    const s = await seeded()
    expect(await readDiagramViewpoints(s, 'nope.diagram')).toBeUndefined()
})
