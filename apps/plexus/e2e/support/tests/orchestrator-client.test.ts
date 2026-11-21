import { createServer, type AddressInfo } from 'node:net'
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

describe('OrchestratorClient.Launch', () => {
    it('runs this Node with tsx in the checkout, passing --stack when PLEXUS_E2E_STACK is set', () => {
        const env = { PRAGMATIC_E2E_REPO: 'D:/tmp/pragmatic-e2e', PLEXUS_E2E_STACK: 'C:/s/stack.json' }
        const launch = OrchestratorClient.Create(env).Launch(['create-dev'])
        expect(launch.file).toBe(process.execPath)
        expect(launch.args).toEqual(['--import', 'tsx', path.join('D:/tmp/pragmatic-e2e', 'src', 'live-loop', 'loop-orchestrator.ts'), 'create-dev', '--stack', 'C:/s/stack.json'])
        expect(launch.cwd).toBe('D:/tmp/pragmatic-e2e')
        expect(launch.env).toBe(env)
    })

    it('runs inside the WSL distro with PRAGMATIC_E2E_WSL_DISTRO, the stack folder passed as a translated path variable', () => {
        const env = { PRAGMATIC_E2E_WSL_DISTRO: 'hive', PRAGMATIC_E2E_REPO: '/root/work/architecture-agent/pragmatic-e2e', PLEXUS_E2E_STACK: 'C:\\Users\\v\\.pragmatic\\e2e-stack\\stack.json', WSLENV: 'X' }
        const launch = OrchestratorClient.Create(env).Launch(['promote', '--graph', 'g'])
        expect(launch.file).toBe('wsl.exe')
        expect(launch.args).toEqual(['-d', 'hive', '-u', 'root', '--cd', '/root/work/architecture-agent/pragmatic-e2e', '--exec', 'node', '--import', 'tsx', 'src/live-loop/loop-orchestrator.ts', 'promote', '--graph', 'g'])
        expect(launch.cwd).toBe(PLEXUS_ROOT)
        expect(launch.env.PRAGMATIC_E2E_STACK_DIR).toBe('C:\\Users\\v\\.pragmatic\\e2e-stack')
        expect(launch.env.WSLENV).toBe('X:PRAGMATIC_E2E_STACK_DIR/p')
    })

    it('leaves the WSL orchestrator on its default stack folder without PLEXUS_E2E_STACK', () => {
        const env = { PRAGMATIC_E2E_WSL_DISTRO: 'hive', PRAGMATIC_E2E_REPO: '/root/e2e' }
        const launch = OrchestratorClient.Create(env).Launch(['teardown'])
        expect(launch.env).toBe(env)
        expect(launch.args).not.toContain('--stack')
    })

    it('refuses a WSL stack file not named stack.json (the orchestrator there reads stack.json from the folder)', () => {
        const env = { PRAGMATIC_E2E_WSL_DISTRO: 'hive', PRAGMATIC_E2E_REPO: '/root/e2e', PLEXUS_E2E_STACK: 'C:\\s\\other.json' }
        expect(() => OrchestratorClient.Create(env).Launch(['teardown'])).toThrow(/stack\.json/)
    })

    it('refuses the WSL distro without the Linux checkout path', () => {
        expect(() => OrchestratorClient.Create({ PRAGMATIC_E2E_WSL_DISTRO: 'hive' })).toThrow(/PRAGMATIC_E2E_REPO/)
    })
})

describe('OrchestratorClient.WaitReachable', () => {
    it('resolves once the origin accepts a connection', async () => {
        const server = createServer()
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
        try
        {
            const port = (server.address() as AddressInfo).port
            await expect(OrchestratorClient.WaitReachable(`http://127.0.0.1:${port}`, 2_000)).resolves.toBeUndefined()
        }
        finally
        {
            server.close()
        }
    })

    it('fails naming the origin when nothing answers by the deadline', async () => {
        const server = createServer()
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
        const port = (server.address() as AddressInfo).port
        await new Promise<void>((resolve) => server.close(() => resolve()))
        await expect(OrchestratorClient.WaitReachable(`http://127.0.0.1:${port}`, 600)).rejects.toThrow(`http://127.0.0.1:${port}`)
    })
})
