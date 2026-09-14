import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { SkillProblemSeverity, type SkillProblem } from '../../../../../shared/skill-api.js'
import type { ModelPatch, PatchOp } from '../../../../../shared/model-patch-api.js'
import { ArchModelGateway } from './arch-model-gateway.js'

// A resolved architecture model the applier drives, behind a narrow seam so the
// engine unit-tests with a fake and the production adapter (ArchModelGateway) wraps
// a real ArchModel.
export interface ArchModelHandle {
    snapshot(): Map<string, string>
    restore(snap: Map<string, string>): void
    apply(op: PatchOp): void
    validate(): Promise<SkillProblem[]>
    save(): Promise<void>
    notifyChanged(): void
}

// Resolves the ArchModel for a project path (undefined ⇒ not an architecture project).
export interface IArchModelGateway {
    resolve(projectPath: string): Promise<ArchModelHandle | undefined>
}

export enum ApplyOutcome { Applied = 'applied', Rejected = 'rejected', Invalid = 'invalid', NoModel = 'noModel' }
export interface ApplyResult { outcome: ApplyOutcome; problems: SkillProblem[] }

// Applies a structured ModelPatch atomically: snapshot → apply ops → validate against
// the meta-model → save on clean, else restore the snapshot. Nothing persists unless
// validation passes; a throwing op rolls back the same way. Keeps the last snapshot so
// the applied patch can be undone.
export class ModelPatchApplier {
    public static readonly Key = new ServiceKey<ModelPatchApplier>('ModelPatchApplier')

    private readonly gateway: IArchModelGateway
    private lastHandle: ArchModelHandle | undefined
    private lastSnapshot: Map<string, string> | undefined

    // As a registered service, built with the provider (production ArchModelGateway).
    // Tests pass a fake IArchModelGateway directly — distinguished by its `resolve`.
    constructor(providerOrGateway: IServiceProvider | IArchModelGateway) {
        this.gateway = 'resolve' in providerOrGateway
            ? providerOrGateway
            : new ArchModelGateway(providerOrGateway)
    }

    async apply(projectPath: string, patch: ModelPatch): Promise<ApplyResult> {
        const handle = await this.gateway.resolve(projectPath)
        if (handle === undefined) return { outcome: ApplyOutcome.NoModel, problems: [] }
        const snap = handle.snapshot()
        try {
            for (const op of patch.ops) handle.apply(op)
            handle.notifyChanged()
        } catch (e) {
            handle.restore(snap)
            return { outcome: ApplyOutcome.Invalid, problems: [{ message: `Patch failed to apply: ${(e as Error).message}`, severity: SkillProblemSeverity.Error }] }
        }
        const problems = await handle.validate()
        if (problems.some(p => p.severity === SkillProblemSeverity.Error)) {
            handle.restore(snap)
            return { outcome: ApplyOutcome.Invalid, problems }
        }
        await handle.save()
        this.lastHandle = handle
        this.lastSnapshot = snap
        return { outcome: ApplyOutcome.Applied, problems: [] }
    }

    // Revert the most recently applied patch (restore its pre-apply snapshot + save).
    async undo(): Promise<void> {
        if (this.lastHandle === undefined || this.lastSnapshot === undefined) return
        this.lastHandle.restore(this.lastSnapshot)
        await this.lastHandle.save()
        this.lastHandle = undefined
        this.lastSnapshot = undefined
    }
}
