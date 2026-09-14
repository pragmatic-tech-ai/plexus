import { BindingSource, type SkillBinding } from '../../../../../shared/skill-api.js'
import { BindingPayloadKind, type ResolvedBinding } from '../../../../../shared/skill-context-api.js'

// The live-data seam the resolver reads. Each accessor returns undefined when its
// context is unavailable (no project open, nothing selected, no active doc). Kept
// as an interface so the resolver is unit-testable without renderer services.
export interface BindingContextSources {
    currentProject(): { name: string; path: string } | undefined
    diagramSelection(): { entityIds: string[]; entities: Array<{ id: string; term?: string }> } | undefined
    activeDocument(): { path: string; kind: string; text?: string } | undefined
    primaryEntity(): { id: string; term?: string; path?: string } | undefined   // EntityRef ← first selected
    workspaceRoot(): { path: string } | undefined
}

// Maps each declared BindingSource to a concrete ResolvedBinding by reading live
// renderer services (injected as BindingContextSources for testability). A source
// whose context is unavailable resolves to Empty — never throws, never blocks.
export class BindingResolver {
    private readonly sources: BindingContextSources
    constructor(sources: BindingContextSources) { this.sources = sources }

    resolve(bindings: SkillBinding[]): ResolvedBinding[] {
        return bindings.map(b => this.one(b))
    }

    private one(b: SkillBinding): ResolvedBinding {
        const wrap = (kind: BindingPayloadKind, data: unknown): ResolvedBinding =>
            data === undefined
                ? { source: b.source, as: b.as, kind: BindingPayloadKind.Empty, data: null }
                : { source: b.source, as: b.as, kind, data }
        switch (b.source) {
            case BindingSource.CurrentProject:   return wrap(BindingPayloadKind.Project, this.sources.currentProject())
            case BindingSource.DiagramSelection: return wrap(BindingPayloadKind.Selection, this.sources.diagramSelection())
            case BindingSource.ActiveDocument:   return wrap(BindingPayloadKind.Document, this.sources.activeDocument())
            case BindingSource.EntityRef:        return wrap(BindingPayloadKind.Entity, this.sources.primaryEntity())
            case BindingSource.WorkspaceRoot:    return wrap(BindingPayloadKind.Path, this.sources.workspaceRoot())
        }
    }
}
