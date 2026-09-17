import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { checkAgainst, Severity, type SourceFile } from '@pragmatic-tech-ai/todl'
import { PatchOpKind, type PatchOp } from '../../../../../shared/model-patch-api.js'
import { SkillProblemSeverity, type SkillProblem } from '../../../../../shared/skill-api.js'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer'
import { WorkspaceBaseResolver } from '../../../services/projects/workspace-base-resolver.js'
import { ArchitectureModelService } from './architecture-model-service.js'
import type { ArchModel } from './arch-model.js'
import type { OpenProject } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-project.js'
import type { ArchModelHandle, IArchModelGateway } from './model-patch-applier.js'

// Production IArchModelGateway: resolves the open architecture project containing a
// path and adapts its ArchModel to the applier's handle. The op→mutator dispatch is
// a pure static (unit-tested directly); model resolution is integration.
export class ArchModelGateway implements IArchModelGateway {
    private readonly provider: IServiceProvider
    constructor(provider: IServiceProvider) { this.provider = provider }

    // Map one structured op to the matching ArchModel mutator.
    static applyOpTo(model: ArchModel, op: PatchOp): void {
        switch (op.kind) {
            case PatchOpKind.CreateEntity: model.create(op.concept, op.id, op.homeUri); break
            case PatchOpKind.SetField: model.setField(op.id, op.field, op.value); break
            case PatchOpKind.AddRef: model.addRef(op.from, op.member, op.to); break
            case PatchOpKind.RemoveRef: model.removeRef(op.from, op.member, op.to); break
            case PatchOpKind.RemoveEntity: model.remove(op.id); break
        }
    }

    async resolve(projectPath: string): Promise<ArchModelHandle | undefined> {
        const explorer = this.provider.get(ProjectExplorerService.Key)
        if (explorer === undefined) return undefined
        const op = explorer.OpenProjects.ToArray().find(p => ArchModelGateway.pathInProject(projectPath, p.Folder))
        if (op === undefined) return undefined
        const model = await this.provider.getRequired(ArchitectureModelService.Key).modelFor(op)
        return {
            snapshot: () => model.toTodlByFile(),
            restore: (s) => model.restore(s),
            apply: (o) => ArchModelGateway.applyOpTo(model, o),
            validate: () => this.validate(op, model),
            save: () => model.save(),
            notifyChanged: () => model.notifyChanged(),
        }
    }

    // Validate the model's own instances against its resolved bases (meta-model +
    // libraries) — the same composition modelFor uses, but returning diagnostics.
    private async validate(op: OpenProject, model: ArchModel): Promise<SkillProblem[]> {
        const { bases } = await this.provider.getRequired(WorkspaceBaseResolver.Key).ResolveForStorage(op.Storage)
        const sources: SourceFile[] = [...model.toTodlByFile()].map(([uri, text]) => ({ uri, text }))
        return checkAgainst(bases, sources).diagnostics.map((d) => ({
            message: d.message,
            severity: d.severity === Severity.Error ? SkillProblemSeverity.Error : SkillProblemSeverity.Warning,
        }))
    }

    // True when `path` is the project folder itself or lives under it (separator-agnostic).
    private static pathInProject(path: string, folder: string): boolean {
        const p = path.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
        const f = folder.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
        return p === f || p.startsWith(`${f}/`)
    }
}
