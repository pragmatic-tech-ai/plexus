import { parse as parseYaml } from 'yaml'
import { AgentSkillKind } from '../../shared/agent-api.js'
import {
    SkillScope, SkillSourceKind, InputKind, BindingSource, OutputKind, ProjectType,
    SkillProblemSeverity, SkillDescriptorFactory,
    type SkillDescriptor, type SkillInput, type SkillBinding, type SkillOutput,
} from '../../shared/skill-api.js'

const SUPPORTED_VERSION = 1

interface ParseContext { kind: AgentSkillKind; fallbackName: string; scope: SkillScope; folderPath: string }

// Parses a SKILL.md (or agent .md) frontmatter — base name/description plus the
// optional x-plexus superset block — into a SkillDescriptor. Never throws: every
// failure becomes a SkillProblem on an otherwise-valid base descriptor, so one
// bad file never breaks the scan (spec §5.4, CLI-parity constraint).
export class SkillFrontmatterParser
{
    parse(text: string, ctx: ParseContext): SkillDescriptor
    {
        const base = SkillDescriptorFactory.claudeCode(ctx.kind, ctx.fallbackName, '', ctx.scope, ctx.folderPath)
        const fence = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
        if (fence === null)
        {
            base.problems.push({ message: 'No YAML frontmatter fence found; using defaults.', severity: SkillProblemSeverity.Warning })
            return base
        }
        let doc: Record<string, unknown>
        try
        {
            doc = (parseYaml(fence[1]) ?? {}) as Record<string, unknown>
        }
        catch (e)
        {
            base.problems.push({ message: `Malformed frontmatter YAML: ${(e as Error).message}`, severity: SkillProblemSeverity.Error })
            return base
        }
        if (typeof doc.name === 'string' && doc.name.trim() !== '') base.name = doc.name.trim()
        base.title = base.name
        if (typeof doc.description === 'string') base.description = doc.description.trim()

        const x = doc['x-plexus']
        if (x !== undefined && x !== null) this.applyExtension(base, x)
        return base
    }

    private applyExtension(d: SkillDescriptor, raw: unknown): void
    {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        {
            d.problems.push({ message: 'x-plexus is not an object; ignored.', severity: SkillProblemSeverity.Warning })
            return
        }
        const x = raw as Record<string, unknown>
        const version = typeof x.version === 'number' ? x.version : 0
        if (version !== SUPPORTED_VERSION)
        {
            d.problems.push({ message: `Unsupported x-plexus.version ${String(x.version)}; expected ${SUPPORTED_VERSION}. Degrading to base behavior.`, severity: SkillProblemSeverity.Warning })
            return
        }
        d.sourceKind = SkillSourceKind.PlexusSuperset
        if (typeof x.title === 'string' && x.title.trim() !== '') d.title = x.title.trim()
        if (typeof x.category === 'string') d.category = x.category
        if (typeof x.icon === 'string') d.icon = x.icon
        if (typeof x.model === 'string') d.model = x.model
        d.tags = this.stringArray(x.tags)
        d.allowedTools = this.stringArray(x.allowedTools)
        d.requiresProjectType = this.enumArray(x.requiresProjectType, ProjectType, 'requiresProjectType', d)
        d.deprecation = this.deprecation(x.deprecation)
        d.inputs = this.inputs(x.inputs, d)
        d.bindings = this.bindings(x.bindings, d)
        d.outputs = this.outputs(x.outputs, d)
    }

    private stringArray(v: unknown): string[]
    {
        return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : []
    }

    // Map author-written PascalCase members (e.g. "Architecture") to enum values.
    private enumMember<T extends Record<string, string>>(token: unknown, e: T): T[keyof T] | undefined
    {
        if (typeof token !== 'string') return undefined
        for (const key of Object.keys(e))
        {
            const value = (e as Record<string, string>)[key]
            if (key === token || value === token) return value as T[keyof T]
        }
        return undefined
    }

    private enumArray<T extends Record<string, string>>(v: unknown, e: T, field: string, d: SkillDescriptor): Array<T[keyof T]>
    {
        if (!Array.isArray(v)) return []
        const out: Array<T[keyof T]> = []
        for (const token of v)
        {
            const m = this.enumMember(token, e)
            if (m === undefined) d.problems.push({ message: `Unknown ${field} value "${String(token)}".`, severity: SkillProblemSeverity.Warning })
            else out.push(m)
        }
        return out
    }

    private deprecation(v: unknown): SkillDescriptor['deprecation']
    {
        if (typeof v !== 'object' || v === null) return undefined
        const o = v as Record<string, unknown>
        return { replacedBy: typeof o.replacedBy === 'string' ? o.replacedBy : undefined, note: typeof o.note === 'string' ? o.note : undefined }
    }

    private inputs(v: unknown, d: SkillDescriptor): SkillInput[]
    {
        if (!Array.isArray(v)) return []
        const out: SkillInput[] = []
        for (const raw of v)
        {
            if (typeof raw !== 'object' || raw === null) continue
            const o = raw as Record<string, unknown>
            const type = this.enumMember(o.type, InputKind)
            if (typeof o.key !== 'string' || type === undefined)
            {
                d.problems.push({ message: `Skipping input with missing key or unknown type "${String(o.type)}".`, severity: SkillProblemSeverity.Warning })
                continue
            }
            out.push({
                key: o.key, label: typeof o.label === 'string' ? o.label : o.key, type,
                options: this.stringArray(o.options), required: o.required === true,
                default: (typeof o.default === 'string' || typeof o.default === 'number' || typeof o.default === 'boolean') ? o.default : undefined,
            })
        }
        return out
    }

    private bindings(v: unknown, d: SkillDescriptor): SkillBinding[]
    {
        if (!Array.isArray(v)) return []
        const out: SkillBinding[] = []
        for (const raw of v)
        {
            if (typeof raw !== 'object' || raw === null) continue
            const o = raw as Record<string, unknown>
            const source = this.enumMember(o.source, BindingSource)
            if (source === undefined) { d.problems.push({ message: `Unknown binding source "${String(o.source)}".`, severity: SkillProblemSeverity.Warning }); continue }
            out.push({ source, as: typeof o.as === 'string' ? o.as : undefined })
        }
        return out
    }

    private outputs(v: unknown, d: SkillDescriptor): SkillOutput[]
    {
        if (!Array.isArray(v)) return []
        const out: SkillOutput[] = []
        for (const raw of v)
        {
            if (typeof raw !== 'object' || raw === null) continue
            const o = raw as Record<string, unknown>
            const kind = this.enumMember(o.kind, OutputKind)
            if (kind === undefined) { d.problems.push({ message: `Unknown output kind "${String(o.kind)}".`, severity: SkillProblemSeverity.Warning }); continue }
            out.push({ kind, target: typeof o.target === 'string' ? o.target : undefined })
        }
        return out
    }
}
