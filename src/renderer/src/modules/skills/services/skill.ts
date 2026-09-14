import { Observable } from '@pragmatic-tech-ai/mural/runtime'
import { AgentSkillKind } from '../../../../../shared/agent-api.js'
import { SkillScope, SkillSourceKind, ProjectType, type SkillDescriptor } from '../../../../../shared/skill-api.js'

// Renderer view-model over one SkillDescriptor. Immutable wrapper (a rescan
// replaces the instance); extends the lightweight Observable INPC root per house
// style so a .mu can bind its typed getters.
export class Skill extends Observable {
    private readonly d: SkillDescriptor
    private readonly origin?: string

    // `originProjectPath` is the open project a Project-scoped skill was discovered
    // under (set by SkillCatalog.discoverAll). Global/packaged skills carry none.
    constructor(descriptor: SkillDescriptor, originProjectPath?: string) { super(); this.d = descriptor; this.origin = originProjectPath }

    get Descriptor(): SkillDescriptor { return this.d }
    get Name(): string { return this.d.name }
    get Title(): string { return this.d.title }
    get Description(): string { return this.d.description }
    get Kind(): AgentSkillKind { return this.d.kind }
    get Scope(): SkillScope { return this.d.scope }
    get IsProjectScoped(): boolean { return this.d.scope === SkillScope.Project }

    // The origin project path (the dedupe key across projects) and its display name
    // (the folder's basename, handling either separator). Undefined off a project scope.
    get OriginProjectPath(): string | undefined { return this.origin }
    get OriginProjectName(): string | undefined { return this.origin === undefined ? undefined : Skill.basename(this.origin) }
    get Category(): string | undefined { return this.d.category }
    get IconKey(): string | undefined { return this.d.icon }
    get Tags(): readonly string[] { return this.d.tags }
    get IsPlexusSuperset(): boolean { return this.d.sourceKind === SkillSourceKind.PlexusSuperset }
    get HasInputs(): boolean { return this.d.inputs.length > 0 }
    get IsDeprecated(): boolean { return this.d.deprecation !== undefined }
    get DeprecationNote(): string | undefined { return this.d.deprecation?.note }
    get HasProblems(): boolean { return this.d.problems.length > 0 }

    // Empty requiresProjectType ⇒ unconstrained (matches every project type).
    appliesToProjectType(t: ProjectType): boolean {
        return this.d.requiresProjectType.length === 0 || this.d.requiresProjectType.includes(t)
    }

    // Last path segment, tolerant of both `/` and `\` (renderer has no node:path).
    private static basename(path: string): string {
        const trimmed = path.replace(/[/\\]+$/, '')
        const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
        return cut >= 0 ? trimmed.slice(cut + 1) : trimmed
    }
}
