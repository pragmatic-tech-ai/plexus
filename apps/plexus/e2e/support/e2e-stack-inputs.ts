import { readFileSync } from 'node:fs'

// The pragmatic-server e2e stack descriptor (stack.json, written by
// admin/control-plane/live-loop/live-loop-stack.ts up) as the scripted sign-in's inputs: when
// PLEXUS_E2E_STACK names it, its owner email, password file, platform address, tenant, the IdP's CA and
// server certificate files and the IdP login kind
// are filled in underneath the environment (any variable already set wins). The descriptor holds only
// FILE paths for passwords, never a password.
export class E2eStackInputs
{
    public static readonly StackEnv = 'PLEXUS_E2E_STACK'
    private static readonly Utf8 = 'utf8'
    // stack.json key per sign-in variable (pragmatic-server LiveLoopStackDescriptor).
    private static readonly Keys: readonly (readonly [string, string])[] = [
        ['PLEXUS_E2E_OWNER_EMAIL', 'ownerEmail'],
        ['PLEXUS_E2E_OWNER_PASSWORD_FILE', 'ownerPasswordFile'],
        ['PLEXUS_E2E_PLATFORM_ADDRESS', 'platformAddress'],
        ['PLEXUS_E2E_TENANT', 'tenant'],
        ['PLEXUS_E2E_IDP_CA_FILE', 'idpCaFile'],
        ['PLEXUS_E2E_IDP_CERT_FILE', 'idpCertFile'],
        ['PLEXUS_E2E_IDP_LOGIN', 'idpLogin'],
    ]

    // The environment with the stack's inputs underneath, or the environment itself without PLEXUS_E2E_STACK.
    public static Apply(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv
    {
        const file = env[E2eStackInputs.StackEnv]?.trim()
        if (file === undefined || file === '') return env
        return E2eStackInputs.Merge(env, JSON.parse(readFileSync(file, E2eStackInputs.Utf8)) as Record<string, unknown>)
    }

    // Pure: the stack's non-empty string inputs, overlaid by every non-blank environment variable.
    public static Merge(env: NodeJS.ProcessEnv, stack: Record<string, unknown>): NodeJS.ProcessEnv
    {
        const merged: NodeJS.ProcessEnv = {}
        for (const [name, key] of E2eStackInputs.Keys)
        {
            const value = stack[key]
            if (typeof value === 'string' && value !== '') merged[name] = value
        }
        for (const [name, value] of Object.entries(env))
        {
            if (value !== undefined && value.trim() !== '') merged[name] = value
        }
        return merged
    }
}
