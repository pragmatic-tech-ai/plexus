import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DialogService, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import type { Skill } from './skill.js'
import type { CatalogItem } from '../../../../../shared/agent-api.js'
import { type ResolvedInput, type SkillContext } from '../../../../../shared/skill-context-api.js'
import { BindingResolver, type BindingContextSources } from './binding-resolver.js'
import { PreambleComposer } from './preamble-composer.js'
import { SkillInputFormVm } from './skill-input-form.js'
import { SkillInputDialogVm } from './skill-input-dialog.js'
import { ChatSessionsService } from '../../agent-chat/services/chat-sessions-service.js'

// The collaborators the runner needs, injected for testing (the production set is
// built from the provider in buildDeps).
export interface RunnerDeps {
    presentForm(skill: Skill): Promise<ResolvedInput[] | undefined>
    bindingSourcesFor(projectDir: string, projectName: string): BindingContextSources
    runAgentSkill(item: CatalogItem, dir: string, name: string, opts?: { contextBlock?: string; context?: SkillContext }): { Id: string }
}

// Orchestrates a typed, model-aware skill run: collect inputs (form) → resolve
// bindings against live context → compose a context block + structured context →
// hand off to ChatSessionsService.RunAgentSkill. A skill with no inputs/bindings
// runs exactly as before (no form, no context block, no context push).
export class SkillRunner extends ServiceBase {
    public static readonly Key = new ServiceKey<SkillRunner>('SkillRunner')
    private readonly deps: RunnerDeps
    private readonly composer = new PreambleComposer()

    constructor(provider: IServiceProvider, deps?: RunnerDeps) {
        super(provider)
        this.deps = deps ?? this.buildDeps()
    }

    async run(skill: Skill, projectDir: string, projectName: string): Promise<void> {
        let inputs: ResolvedInput[] = []
        if (skill.HasInputs) {
            const collected = await this.deps.presentForm(skill)
            if (collected === undefined) return          // cancelled — no side effects
            inputs = collected
        }
        const bindings = new BindingResolver(this.deps.bindingSourcesFor(projectDir, projectName)).resolve(skill.Descriptor.bindings)
        const context: SkillContext = { skillName: skill.Name, inputs, bindings }
        const contextBlock = this.composer.render(context)
        const item: CatalogItem = { kind: skill.Kind, name: skill.Name, description: skill.Description }
        const hasContext = inputs.length > 0 || bindings.length > 0
        this.deps.runAgentSkill(item, projectDir, projectName, hasContext ? { contextBlock, context } : undefined)
    }

    // ── Production wiring ───────────────────────────────────────────────
    private buildDeps(): RunnerDeps {
        return {
            presentForm: (skill) => this.presentModalForm(skill),
            bindingSourcesFor: (dir, name) => this.liveSources(dir, name),
            runAgentSkill: (item, dir, name, opts) => this.chats().RunAgentSkill(item, dir, name, opts),
        }
    }

    // Show the generated input form as a modal dialog; resolves with the collected
    // inputs or undefined on cancel/dismiss.
    private async presentModalForm(skill: Skill): Promise<ResolvedInput[] | undefined> {
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs === undefined) return []                 // no dialog host → run with defaults
        const form = new SkillInputFormVm(skill.Descriptor.inputs, (r) => dialogs.Close(r))
        const dialog = new SkillInputDialogVm(form, skill.Title)
        const result = await dialogs.Show<ResolvedInput[] | undefined>({ Title: skill.Title, Content: dialog, Width: 420 })
        return result ?? undefined
    }

    // The five live binding sources for a run. Each returns undefined when its
    // context is absent (BindingResolver maps that to an Empty payload).
    private liveSources(projectDir: string, projectName: string): BindingContextSources {
        return {
            currentProject: () => ({ name: projectName, path: projectDir }),
            diagramSelection: () => this.selection(),
            activeDocument: () => this.activeDoc(),
            primaryEntity: () => this.selection()?.entities[0],
            workspaceRoot: () => { const p = this.Provider.get(EnvironmentService.Key)?.CurrentDirectory; return p !== undefined ? { path: p } : undefined },
        }
    }

    private selection(): { entityIds: string[]; entities: Array<{ id: string; term?: string }> } | undefined {
        const view = (this.activeDocument() as { ActiveView?: { SelectedItems?: readonly unknown[] } } | undefined)?.ActiveView
        const items = view?.SelectedItems
        if (items === undefined || items.length === 0) return undefined
        const ids = items.map((v) => (v as { Id?: string }).Id).filter((id): id is string => id !== undefined)
        if (ids.length === 0) return undefined
        return { entityIds: ids, entities: ids.map((id) => ({ id })) }
    }

    private activeDoc(): { path: string; kind: string; text?: string } | undefined {
        const doc = this.activeDocument() as { Id?: string } | undefined
        if (doc?.Id === undefined) return undefined
        return { path: doc.Id, kind: this.extensionOf(doc.Id) }
    }

    private activeDocument(): unknown {
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        return (host as unknown as { ActiveDocument?: unknown } | undefined)?.ActiveDocument
    }

    private extensionOf(path: string): string { const dot = path.lastIndexOf('.'); return dot >= 0 ? path.slice(dot + 1) : '' }

    // Resolved at call time (not ctor) so the runner never forces ChatSessionsService
    // to construct early.
    private chats(): ChatSessionsService { return this.Provider.getRequired(ChatSessionsService.Key) }
}
