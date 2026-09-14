import { BindingPayloadKind, type ResolvedBinding, type SkillContext } from '../../../../../shared/skill-context-api.js'

// Renders the SkillContext into a deterministic Markdown block appended AFTER the
// /skill-name seed (never before — the slash command must lead). Empty when the
// skill declares no inputs/bindings, so legacy skills seed exactly /name.
export class PreambleComposer {
    render(context: SkillContext): string {
        if (context.inputs.length === 0 && context.bindings.length === 0) return ''
        const lines: string[] = ['<!-- plexus:skill-context -->']
        if (context.inputs.length > 0) {
            lines.push('**Inputs**')
            for (const i of context.inputs) lines.push(`- ${i.key}: ${String(i.value)}`)
        }
        if (context.bindings.length > 0) {
            lines.push('**Context**')
            for (const b of context.bindings) lines.push(`- ${b.source}: ${this.describe(b)}`)
        }
        lines.push('<!-- /plexus:skill-context -->')
        return lines.join('\n')
    }

    private describe(b: ResolvedBinding): string {
        const d = b.data as Record<string, unknown> | null
        switch (b.kind) {
            case BindingPayloadKind.Project:   return `${String(d?.name ?? '')} (${String(d?.path ?? '')})`.trim()
            case BindingPayloadKind.Selection: return `${((d?.entityIds as unknown[]) ?? []).length} entities`
            case BindingPayloadKind.Document:  return String(d?.path ?? '')
            case BindingPayloadKind.Entity:    return String(d?.id ?? '')
            case BindingPayloadKind.Path:      return String(d?.path ?? '')
            case BindingPayloadKind.Empty:     return '(none)'
        }
    }
}
