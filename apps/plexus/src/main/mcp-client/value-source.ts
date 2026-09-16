import { ValueSourceKind, type ValueSource } from '../../shared/mcp-client-api.js'

// Resolves a ValueSource to a concrete string, or undefined when an env-var
// reference is unset/empty (callers treat "missing secret" as "skip this server").
export class ValueSourceResolver
{
    constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

    public resolve(v: ValueSource): string | undefined
    {
        if (v.kind === ValueSourceKind.Literal) return v.value
        const val = this.env[v.value]
        return val !== undefined && val !== '' ? val : undefined
    }
}
