// Pure rule model + a small persistent store for agent tool-approval decisions.
// A rule is { tool, prefix? }: prefix (Bash only) is the leading command family,
// so "always allow python" grants `python …`, not all shell access. The store is
// a JSON map { [projectKey]: ApprovalRule[] } behind an injectable IO seam (no
// direct fs here — the caller wires Electron userData in).
import type { ApprovalRule } from '../../shared/agent-api.js'

// The first shell token of a Bash command, lowercased; undefined for non-Bash or
// an empty command. `input` is the tool's raw input object.
export function derivePrefix(toolName: string, input: unknown): string | undefined
{
    if (toolName !== 'Bash') return undefined
    const command = (input as { command?: unknown } | null)?.command
    if (typeof command !== 'string') return undefined
    const first = command.trim().split(/\s+/)[0]
    return first !== undefined && first.length > 0 ? first.toLowerCase() : undefined
}

export function ruleFor(toolName: string, input: unknown): ApprovalRule
{
    const prefix = derivePrefix(toolName, input)
    return prefix === undefined ? { tool: toolName } : { tool: toolName, prefix }
}

// True when `rule` authorises using `toolName` with `input`. A prefix-less rule
// matches any input of that tool; a prefixed rule matches when the command's
// first token equals the prefix (token boundary — "python" ≠ "pythonic").
export function matches(rule: ApprovalRule, toolName: string, input: unknown): boolean
{
    if (rule.tool !== toolName) return false
    if (rule.prefix === undefined) return true
    return derivePrefix(toolName, input) === rule.prefix
}

function sameRule(a: ApprovalRule, b: ApprovalRule): boolean
{
    return a.tool === b.tool && (a.prefix ?? '') === (b.prefix ?? '')
}

// Minimal synchronous file IO seam so the store is unit-testable without fs.
export interface RuleIo { read(path: string): string | undefined; write(path: string, contents: string): void }

// Persistent per-project allow-list. Loads the whole map on construction; each
// mutation rewrites the file. Keys are opaque project identifiers (the agent
// working directory).
export class RuleStore
{
    private readonly map: Record<string, ApprovalRule[]>

    constructor(private readonly io: RuleIo, private readonly path: string)
    {
        const raw = io.read(path)
        let parsed: Record<string, ApprovalRule[]> = {}
        if (raw !== undefined) { try { parsed = JSON.parse(raw) as Record<string, ApprovalRule[]> } catch { parsed = {} } }
        this.map = parsed
    }

    public list(projectKey: string): ApprovalRule[] { return [...(this.map[projectKey] ?? [])] }

    public add(projectKey: string, rule: ApprovalRule): void
    {
        const rules = this.map[projectKey] ?? []
        if (rules.some((r) => sameRule(r, rule))) return
        this.map[projectKey] = [...rules, rule]
        this.flush()
    }

    public remove(projectKey: string, rule: ApprovalRule): void
    {
        const rules = this.map[projectKey]
        if (rules === undefined) return
        this.map[projectKey] = rules.filter((r) => !sameRule(r, rule))
        this.flush()
    }

    public matches(projectKey: string, toolName: string, input: unknown): boolean
    {
        return (this.map[projectKey] ?? []).some((r) => matches(r, toolName, input))
    }

    private flush(): void { this.io.write(this.path, JSON.stringify(this.map, null, 2)) }
}
