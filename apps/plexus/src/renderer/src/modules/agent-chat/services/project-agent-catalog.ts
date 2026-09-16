// Caches each open project's .claude/ catalog (agents + skills), fetched once via
// the agent bridge and refetched only after Invalidate (call on project rescan).
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IAgentApi, ProjectCatalog } from '../../../../../shared/agent-api.js'

export class ProjectAgentCatalog extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProjectAgentCatalog>('ProjectAgentCatalog')

    private readonly agent: IAgentApi
    private readonly cache = new Map<string, Promise<ProjectCatalog>>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { agent?: IAgentApi } }).api
        if (bridge?.agent === undefined)
            throw new Error('ProjectAgentCatalog: window.api.agent is unavailable — requires the Plexus desktop host.')
        this.agent = bridge.agent
    }

    public CatalogFor(projectDir: string): Promise<ProjectCatalog>
    {
        let pending = this.cache.get(projectDir)
        if (pending === undefined)
        {
            pending = this.agent.listAgentsAndSkills(projectDir)
            this.cache.set(projectDir, pending)
        }
        return pending
    }

    public Invalidate(projectDir: string): void { this.cache.delete(projectDir) }
}

export default ProjectAgentCatalog
