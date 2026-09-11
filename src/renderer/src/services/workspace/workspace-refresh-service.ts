// Renderer orchestrator for the agent's workspace tools. Subscribes to the pushed
// agent event stream and handles:
//   • RefreshProject — resolve target open project(s), re-scan + re-validate them
//     via ProjectExplorerService, and return a compact per-project summary.
//   • GetProblems    — read the current diagnostics from DiagnosticsService and
//     return the (filtered, capped) problems list — no re-scan, read-only.
// Both reply via the agent bridge, which unblocks the tool call in main. Eagerly
// constructed at startup so the tools work even if the chat panel was never opened.
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { GetProblemsRequest, IAgentApi, RefreshProjectRequest } from '../../../../shared/agent-api.js'
import { AgentEventKind } from '../../../../shared/agent-api.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { DiagnosticsService } from '../diagnostics/diagnostics-service.js'
import { collectProblems, resolveOwningProject, summarizeProject, type OpenProjectRef } from './refresh-targets.js'

export class WorkspaceRefreshService extends ServiceBase
{
    public static readonly Key = new ServiceKey<WorkspaceRefreshService>('WorkspaceRefreshService')

    private readonly agent: IAgentApi
    private readonly unsubscribe: () => void

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { agent?: IAgentApi } }).api
        if (bridge?.agent === undefined)
        {
            throw new Error(
                'WorkspaceRefreshService: window.api.agent is unavailable — the Electron preload '
                + 'bridge did not load. This service requires the Plexus desktop host.',
            )
        }
        this.agent = bridge.agent
        // refresh_project / get_problems are workspace-scoped (they act on the open
        // projects, not one conversation), so we ignore the event's SessionId and
        // just unwrap it. The tool call is correlated back by its own request id.
        this.unsubscribe = this.agent.onEvent(({ Event: event }) => {
            if (event.Kind === AgentEventKind.RefreshProject) void this.handle(event.Request)
            else if (event.Kind === AgentEventKind.GetProblems) this.handleProblems(event.Request)
        })
    }

    public dispose(): void { this.unsubscribe() }

    // Read the current diagnostics and return the (path/severity-filtered, capped)
    // problems list. Read-only — no project re-scan. A missing DiagnosticsService
    // (shouldn't happen in the host) yields an empty list rather than a throw.
    private handleProblems(req: GetProblemsRequest): void
    {
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const open: OpenProjectRef[] = explorer.OpenProjects.ToArray().map((o) => ({ folder: o.Folder, name: o.Name }))
        const diagnostics = this.Provider.get(DiagnosticsService.Key)?.All.ToArray() ?? []
        const payload = collectProblems(diagnostics, open, req.path, req.severity)
        void this.agent.getProblemsResult({ id: req.id, ...payload })
    }

    private async handle(req: RefreshProjectRequest): Promise<void>
    {
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const open: OpenProjectRef[] = explorer.OpenProjects.ToArray().map((o) => ({ folder: o.Folder, name: o.Name }))

        let targets = open
        let note: string | undefined
        if (req.path !== undefined)
        {
            const owner = resolveOwningProject(open, req.path)
            if (owner === undefined) { targets = []; note = `No open project contains ${req.path}.` }
            else targets = [owner]
        }
        else if (open.length === 0)
        {
            note = 'No projects are open.'
        }

        try
        {
            await explorer.RefreshProjects(targets.map((t) => t.folder))
        }
        catch (e)
        {
            void this.agent.refreshProjectResult({ id: req.id, projects: [], error: (e as Error).message })
            return
        }

        const diagnostics = this.Provider.getRequired(DiagnosticsService.Key).All.ToArray()
        const projects = targets.map((t) => summarizeProject(t, diagnostics))
        void this.agent.refreshProjectResult({ id: req.id, projects, note })
    }
}

export default WorkspaceRefreshService
