import { parse as parseYaml, parseDocument, Document } from 'yaml'
import {
    InputKind, BindingSource, OutputKind, ProjectType,
    type SkillInput, type SkillBinding, type SkillOutput,
} from '../../../../../shared/skill-api.js'

// The structured x-plexus block, decoupled from the on-disk YAML. Mirrors §3.2 of
// the umbrella spec. `unknownVersion` marks a block authored with a schema Plexus
// doesn't understand (preserved verbatim, edited read-only).
export interface XPlexus {
    version?: number
    title?: string
    category?: string
    icon?: string
    model?: string
    tags: string[]
    allowedTools: string[]
    requiresProjectType: ProjectType[]
    deprecation?: { replacedBy?: string; note?: string }
    inputs: SkillInput[]
    bindings: SkillBinding[]
    outputs: SkillOutput[]
    unknownVersion?: boolean
}

// Factory home for a blank extension (OOP: no free functions).
export class XPlexuses {
    static empty(): XPlexus {
        return { tags: [], allowedTools: [], requiresProjectType: [], inputs: [], bindings: [], outputs: [] }
    }
}

// Lossless SKILL.md round-trip that touches ONLY the `x-plexus` mapping. Built on
// yaml's CST-preserving Document so name/description/comments/key-order and the
// markdown body survive byte-stable (CLI-parity constraint). The body is spliced
// verbatim; only the frontmatter fence is re-serialized, and only when x-plexus
// actually changes.
export class SkillFileCodec {
    private static readonly FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n)?/

    // Read the x-plexus block into a plain typed object (empty when absent).
    readExtension(text: string): XPlexus {
        const split = this.split(text)
        const out = XPlexuses.empty()
        if (!split.hadFence) return out
        let doc: Record<string, unknown>
        try { doc = (parseYaml(split.fmText) ?? {}) as Record<string, unknown> } catch { return out }
        const x = doc['x-plexus']
        if (typeof x !== 'object' || x === null || Array.isArray(x)) return out
        const o = x as Record<string, unknown>
        if (typeof o.version === 'number') { out.version = o.version; out.unknownVersion = o.version !== 1 }
        if (typeof o.title === 'string') out.title = o.title
        if (typeof o.category === 'string') out.category = o.category
        if (typeof o.icon === 'string') out.icon = o.icon
        if (typeof o.model === 'string') out.model = o.model
        out.tags = this.strArr(o.tags)
        out.allowedTools = this.strArr(o.allowedTools)
        out.requiresProjectType = this.enumArr(o.requiresProjectType, ProjectType)
        out.deprecation = this.readDeprecation(o.deprecation)
        out.inputs = this.readInputs(o.inputs)
        out.bindings = this.readBindings(o.bindings)
        out.outputs = this.readOutputs(o.outputs)
        return out
    }

    // Return `text` with its x-plexus block set to `ext` (or removed when `ext` is
    // undefined/empty). Base keys + body are preserved verbatim.
    writeExtension(text: string, ext: XPlexus | undefined): string {
        const split = this.split(text)
        const empty = ext === undefined || this.isEmpty(ext)
        // Nothing to add and no fence to touch → byte-identical.
        if (!split.hadFence && empty) return text
        const doc = split.hadFence ? parseDocument(split.fmText) : new Document({})
        if (empty) {
            if (doc.get('x-plexus') === undefined) return text // already absent; don't reflow
            doc.delete('x-plexus')
        } else {
            doc.set('x-plexus', doc.createNode(this.toPlain(ext)))
        }
        const fm = doc.toString()
        const body = split.hadFence ? split.body : text
        return `---\n${fm}---\n${body}`
    }

    private split(text: string): { hadFence: boolean; fmText: string; body: string } {
        const m = SkillFileCodec.FENCE.exec(text)
        if (m === null) return { hadFence: false, fmText: '', body: text }
        return { hadFence: true, fmText: m[1], body: text.slice(m[0].length) }
    }

    private isEmpty(ext: XPlexus): boolean {
        return ext.title === undefined && ext.category === undefined && ext.icon === undefined
            && ext.model === undefined && ext.tags.length === 0 && ext.allowedTools.length === 0
            && ext.requiresProjectType.length === 0 && ext.deprecation === undefined
            && ext.inputs.length === 0 && ext.bindings.length === 0 && ext.outputs.length === 0
    }

    // Build the minimal plain object that YAML serializes — omit undefined scalars
    // and empty facets so the block stays readable. Enum members are already their
    // wire string values (InputKind.Enum === 'enum'), so they serialize CLI-ready.
    private toPlain(ext: XPlexus): Record<string, unknown> {
        const o: Record<string, unknown> = { version: ext.version ?? 1 }
        if (ext.title !== undefined) o.title = ext.title
        if (ext.category !== undefined) o.category = ext.category
        if (ext.icon !== undefined) o.icon = ext.icon
        if (ext.model !== undefined) o.model = ext.model
        if (ext.tags.length > 0) o.tags = [...ext.tags]
        if (ext.allowedTools.length > 0) o.allowedTools = [...ext.allowedTools]
        if (ext.requiresProjectType.length > 0) o.requiresProjectType = [...ext.requiresProjectType]
        if (ext.deprecation !== undefined) o.deprecation = this.plainDeprecation(ext.deprecation)
        if (ext.inputs.length > 0) o.inputs = ext.inputs.map(i => this.plainInput(i))
        if (ext.bindings.length > 0) o.bindings = ext.bindings.map(b => this.plainBinding(b))
        if (ext.outputs.length > 0) o.outputs = ext.outputs.map(x => this.plainOutput(x))
        return o
    }

    private plainDeprecation(d: { replacedBy?: string; note?: string }): Record<string, unknown> {
        const o: Record<string, unknown> = {}
        if (d.replacedBy !== undefined) o.replacedBy = d.replacedBy
        if (d.note !== undefined) o.note = d.note
        return o
    }

    private plainInput(i: SkillInput): Record<string, unknown> {
        const o: Record<string, unknown> = { key: i.key, label: i.label, type: i.type }
        if (i.options !== undefined && i.options.length > 0) o.options = [...i.options]
        if (i.required === true) o.required = true
        if (i.default !== undefined) o.default = i.default
        return o
    }

    private plainBinding(b: SkillBinding): Record<string, unknown> {
        const o: Record<string, unknown> = { source: b.source }
        if (b.as !== undefined) o.as = b.as
        return o
    }

    private plainOutput(x: SkillOutput): Record<string, unknown> {
        const o: Record<string, unknown> = { kind: x.kind }
        if (x.target !== undefined) o.target = x.target
        return o
    }

    private strArr(v: unknown): string[] {
        return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : []
    }

    // Map a token (enum wire value OR PascalCase key) to the enum value — parity
    // with SkillFrontmatterParser so authored + scanned files agree.
    private enumMember<T extends Record<string, string>>(token: unknown, e: T): T[keyof T] | undefined {
        if (typeof token !== 'string') return undefined
        for (const key of Object.keys(e)) {
            const value = (e as Record<string, string>)[key]
            if (key === token || value === token) return value as T[keyof T]
        }
        return undefined
    }

    private enumArr<T extends Record<string, string>>(v: unknown, e: T): Array<T[keyof T]> {
        if (!Array.isArray(v)) return []
        const out: Array<T[keyof T]> = []
        for (const token of v) { const m = this.enumMember(token, e); if (m !== undefined) out.push(m) }
        return out
    }

    private readDeprecation(v: unknown): XPlexus['deprecation'] {
        if (typeof v !== 'object' || v === null) return undefined
        const o = v as Record<string, unknown>
        return { replacedBy: typeof o.replacedBy === 'string' ? o.replacedBy : undefined, note: typeof o.note === 'string' ? o.note : undefined }
    }

    private readInputs(v: unknown): SkillInput[] {
        if (!Array.isArray(v)) return []
        const out: SkillInput[] = []
        for (const raw of v) {
            if (typeof raw !== 'object' || raw === null) continue
            const o = raw as Record<string, unknown>
            const type = this.enumMember(o.type, InputKind)
            if (typeof o.key !== 'string' || type === undefined) continue
            out.push({
                key: o.key, label: typeof o.label === 'string' ? o.label : o.key, type,
                options: this.strArr(o.options), required: o.required === true,
                default: (typeof o.default === 'string' || typeof o.default === 'number' || typeof o.default === 'boolean') ? o.default : undefined,
            })
        }
        return out
    }

    private readBindings(v: unknown): SkillBinding[] {
        if (!Array.isArray(v)) return []
        const out: SkillBinding[] = []
        for (const raw of v) {
            if (typeof raw !== 'object' || raw === null) continue
            const o = raw as Record<string, unknown>
            const source = this.enumMember(o.source, BindingSource)
            if (source === undefined) continue
            out.push({ source, as: typeof o.as === 'string' ? o.as : undefined })
        }
        return out
    }

    private readOutputs(v: unknown): SkillOutput[] {
        if (!Array.isArray(v)) return []
        const out: SkillOutput[] = []
        for (const raw of v) {
            if (typeof raw !== 'object' || raw === null) continue
            const o = raw as Record<string, unknown>
            const kind = this.enumMember(o.kind, OutputKind)
            if (kind === undefined) continue
            out.push({ kind, target: typeof o.target === 'string' ? o.target : undefined })
        }
        return out
    }
}
