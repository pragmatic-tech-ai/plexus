import { test, expect } from 'vitest'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PROJECT_MANIFEST_FILENAME } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project-factory.js'
import { readBoardViewpoints, writeBoardViewpoints } from '../board-viewpoints.js'

async function seeded(): Promise<FakeStorage>
{
    const s = new FakeStorage('fake://Acme')
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({
        type: 'architecture', name: 'Acme', version: 1,
        metaModels: [{ id: 'ea', version: '5' }], libraries: [{ id: 'aws', version: '2' }],
    }))
    return s
}

test('write then read round-trips a board’s viewpoints', async () => {
    const s = await seeded()
    await writeBoardViewpoints(s, 'deploy.board', ['DeploymentView'])
    expect(await readBoardViewpoints(s, 'deploy.board')).toEqual(['DeploymentView'])
})

test('write preserves the other manifest fields', async () => {
    const s = await seeded()
    await writeBoardViewpoints(s, 'deploy.board', ['DeploymentView'])
    const m = JSON.parse(await s.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.name).toBe('Acme')
    expect(m.metaModels).toEqual([{ id: 'ea', version: '5' }])
    expect(m.libraries).toEqual([{ id: 'aws', version: '2' }])
})

test('reading an absent board path returns undefined', async () => {
    const s = await seeded()
    expect(await readBoardViewpoints(s, 'nope.board')).toBeUndefined()
})

test('reads a legacy manifest that stored the selection under the pre-rename "diagrams" key', async () => {
    // This reader is the load-time fallback for projects saved BEFORE the Board rename,
    // whose manifests persisted the selection under the on-disk key `diagrams`. That key
    // must NOT be renamed to `boards` or legacy selections silently vanish.
    const s = new FakeStorage('fake://Acme')
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({
        type: 'architecture', name: 'Acme', version: 1,
        diagrams: { 'deploy.diagram': { viewpoints: ['DeploymentView'] } },
    }))
    expect(await readBoardViewpoints(s, 'deploy.diagram')).toEqual(['DeploymentView'])
})
