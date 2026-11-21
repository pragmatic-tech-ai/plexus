import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLEXUS_ROOT } from '../../plexus-app'
import { OrchestratorClient } from '../orchestrator-client'

describe('OrchestratorClient.E2eRepoOf', () => {
    it('runs the orchestrator from the pragmatic-e2e checkout beside the Plexus repo by default', () => {
        expect(OrchestratorClient.E2eRepoOf({})).toBe(path.resolve(PLEXUS_ROOT, '..', '..', '..', 'pragmatic-e2e'))
        expect(OrchestratorClient.E2eRepoOf({ PRAGMATIC_E2E_REPO: '' })).toBe(path.resolve(PLEXUS_ROOT, '..', '..', '..', 'pragmatic-e2e'))
    })

    it('honours PRAGMATIC_E2E_REPO and ignores the retired SP_SERVER_REPO', () => {
        expect(OrchestratorClient.E2eRepoOf({ PRAGMATIC_E2E_REPO: 'D:/tmp/pragmatic-e2e', SP_SERVER_REPO: 'D:/old/pragmatic-server' })).toBe('D:/tmp/pragmatic-e2e')
        expect(OrchestratorClient.E2eRepoOf({ SP_SERVER_REPO: 'D:/old/pragmatic-server' })).toBe(path.resolve(PLEXUS_ROOT, '..', '..', '..', 'pragmatic-e2e'))
    })

    it('spawns src/live-loop/loop-orchestrator.ts inside that checkout', () => {
        const client = OrchestratorClient.Create({ PRAGMATIC_E2E_REPO: 'D:/tmp/pragmatic-e2e' })
        expect(client.OrchestratorPath()).toBe(path.join('D:/tmp/pragmatic-e2e', 'src', 'live-loop', 'loop-orchestrator.ts'))
    })
})
