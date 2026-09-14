import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IAgentApi } from '../../../../../shared/agent-api.js'
import { SkillScope, ProjectType, type SkillDescriptor } from '../../../../../shared/skill-api.js'
import { Skill } from './skill.js'

type SkillLoader = (projectDir: string) => Promise<SkillDescriptor[]>

// Root-service catalog of skills across all scopes. Aggregates a scan, dedupes by
// precedence (project ▶ global ▶ packaged), and offers search / category / project-
// type views. The loader is injectable for testing; production reads window.api.
export class SkillCatalog extends ServiceBase {
    public static readonly Key = new ServiceKey<SkillCatalog>('SkillCatalog')

    private readonly load: SkillLoader
    private _all: Skill[] = []

    constructor(provider: IServiceProvider, loader?: SkillLoader) {
        super(provider)
        this.load = loader ?? ((dir) => this.bridgeAgent().listSkills(dir))
    }

    private bridgeAgent(): IAgentApi {
        const bridge = (globalThis as unknown as { api?: { agent?: IAgentApi } }).api
        if (bridge?.agent === undefined) throw new Error('SkillCatalog: window.api.agent is unavailable — requires the Plexus desktop host.')
        return bridge.agent
    }

    get All(): readonly Skill[] { return this._all }

    async discover(projectDir: string): Promise<void> {
        const descriptors = await this.load(projectDir)
        const prev = this._all
        this._all = this.dedupe(descriptors).map(d => new Skill(d))
        this.RaisePropertyChanged('All', prev, this._all)
    }

    invalidate(): void {
        const prev = this._all
        this._all = []
        this.RaisePropertyChanged('All', prev, this._all)
    }

    search(text: string): Skill[] {
        const q = text.trim().toLowerCase()
        if (q === '') return [...this._all]
        return this._all.filter(s => {
            const d = s.Descriptor
            return [d.name, d.title, d.description, d.category ?? '', ...d.tags].some(f => f.toLowerCase().includes(q))
        })
    }

    byCategory(): Map<string, Skill[]> {
        const m = new Map<string, Skill[]>()
        for (const s of this._all) {
            const key = s.Category ?? 'Uncategorized'
            const arr = m.get(key) ?? []
            arr.push(s); m.set(key, arr)
        }
        return m
    }

    forProjectType(t: ProjectType): Skill[] { return this._all.filter(s => s.appliesToProjectType(t)) }

    // Keep the highest-precedence entry per name: project ▶ global ▶ packaged.
    private dedupe(descriptors: SkillDescriptor[]): SkillDescriptor[] {
        const rank = (scope: SkillScope): number => scope === SkillScope.Project ? 0 : scope === SkillScope.Global ? 1 : 2
        const best = new Map<string, SkillDescriptor>()
        for (const d of descriptors) {
            const key = `${d.kind}:${d.name}`
            const cur = best.get(key)
            if (cur === undefined || rank(d.scope) < rank(cur.scope)) best.set(key, d)
        }
        return [...best.values()]
    }
}
