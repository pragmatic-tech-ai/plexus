import { existsSync, readFileSync } from 'node:fs'

// The pragmatic-server e2e stack descriptor (stack.json, written by
// admin/control-plane/live-loop/live-loop-stack.ts up) as the scripted sign-in's inputs: when
// PLEXUS_E2E_STACK names it, its owner email, password file, platform address, tenant, the IdP's CA and
// server certificate files and the IdP login kind are filled in underneath the environment (any variable
// already set wins). A named file that does not exist adds nothing, so the specs skip with their usual
// message instead of erroring. The descriptor holds only FILE paths for passwords, never a password.
//
// The sign-in variable names live here, once; ScriptedDesktopSignIn and OrchestratorClient use them.
export class E2eStackInputs
{
    public static readonly StackEnv = 'PLEXUS_E2E_STACK'
    public static readonly EmailEnv = 'PLEXUS_E2E_OWNER_EMAIL'
    public static readonly PasswordFileEnv = 'PLEXUS_E2E_OWNER_PASSWORD_FILE'
    public static readonly PlatformAddressEnv = 'PLEXUS_E2E_PLATFORM_ADDRESS'
    public static readonly TenantEnv = 'PLEXUS_E2E_TENANT'
    public static readonly IdpCaFileEnv = 'PLEXUS_E2E_IDP_CA_FILE'
    public static readonly IdpCertFileEnv = 'PLEXUS_E2E_IDP_CERT_FILE'
    public static readonly IdpLoginEnv = 'PLEXUS_E2E_IDP_LOGIN'
    private static readonly Utf8 = 'utf8'
    // stack.json key per sign-in variable (pragmatic-server LiveLoopStackDescriptor).
    private static readonly Keys: readonly (readonly [string, string])[] = [
        [E2eStackInputs.EmailEnv, 'ownerEmail'],
        [E2eStackInputs.PasswordFileEnv, 'ownerPasswordFile'],
        [E2eStackInputs.PlatformAddressEnv, 'platformAddress'],
        [E2eStackInputs.TenantEnv, 'tenant'],
        [E2eStackInputs.IdpCaFileEnv, 'idpCaFile'],
        [E2eStackInputs.IdpCertFileEnv, 'idpCertFile'],
        [E2eStackInputs.IdpLoginEnv, 'idpLogin'],
    ]

    // The environment with the stack's inputs underneath; the environment itself without PLEXUS_E2E_STACK
    // or when the named file is missing.
    public static Apply(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv
    {
        const file = env[E2eStackInputs.StackEnv]?.trim()
        if (file === undefined || file === '' || !existsSync(file)) return env
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
