import { test, expect, afterEach } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { AgentSkillKind, type IAgentApi, type ProjectCatalog } from '../../../../../../shared/agent-api.js'
import { ProjectAgentCatalog } from '../project-agent-catalog.js'

let calls: string[]
function install(catalog: ProjectCatalog) {
    calls = []
    const agent = {
        listAgentsAndSkills: (dir: string) => { calls.push(dir); return Promise.resolve(catalog) },
    } as unknown as IAgentApi
    ;(globalThis as unknown as { api: unknown }).api = { agent }
}
afterEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

const CATALOG: ProjectCatalog = { agents: [{ kind: AgentSkillKind.Agent, name: 'reviewer', description: 'd' }], skills: [] }

test('CatalogFor fetches once and caches by directory', async () => {
    install(CATALOG)
    const svc = new ProjectAgentCatalog(new ServiceProvider())
    expect(await svc.CatalogFor('/p')).toEqual(CATALOG)
    await svc.CatalogFor('/p')
    expect(calls).toEqual(['/p'])   // second call served from cache
})

test('Invalidate forces a refetch for that directory', async () => {
    install(CATALOG)
    const svc = new ProjectAgentCatalog(new ServiceProvider())
    await svc.CatalogFor('/p')
    svc.Invalidate('/p')
    await svc.CatalogFor('/p')
    expect(calls).toEqual(['/p', '/p'])
})
