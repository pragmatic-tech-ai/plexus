import * as tls from 'node:tls'

export enum TlsCaStore
{
    Default = 'default',
    System = 'system',
}

/** The slice of node:tls SystemTrust uses (NodeTlsDefaults adapts the real module). */
export interface ITlsDefaults
{
    GetCaCertificates(store: TlsCaStore): string[]
    SetDefaultCaCertificates(certs: string[]): void
}

export class NodeTlsDefaults implements ITlsDefaults
{
    public GetCaCertificates(store: TlsCaStore): string[]
    {
        return tls.getCACertificates(store)
    }

    public SetDefaultCaCertificates(certs: string[]): void
    {
        tls.setDefaultCACertificates(certs)
    }
}

export class SystemTrust
{
    private static readonly WarnMessage = 'System certificate trust not applied:'

    /**
     * Sets Node's default CA list to the union (deduplicated, default first) of the current defaults and the OS
     * store, so Node fetch and ws trust what Windows trusts (incl. CurrentUser\Root). Returns false, changing
     * nothing, when the OS store cannot be read; logs only the error name.
     *
     * Scope: this widens trust for every Node TLS client in the main process (agent runtime, MCP clients,
     * package registries), including user-installed and corporate roots. That matches Chromium, whose renderer
     * and the system browser already trust the OS store. The list is read once, so a CA installed while Plexus
     * runs is trusted after a restart.
     */
    public static Apply(tlsDefaults: ITlsDefaults = new NodeTlsDefaults()): boolean
    {
        try
        {
            const union = new Set<string>([
                ...tlsDefaults.GetCaCertificates(TlsCaStore.Default),
                ...tlsDefaults.GetCaCertificates(TlsCaStore.System),
            ])
            tlsDefaults.SetDefaultCaCertificates([...union])
            return true
        }
        catch (e)
        {
            console.warn(SystemTrust.WarnMessage, e instanceof Error ? e.name : typeof e)
            return false
        }
    }
}

export class TlsFailure
{
    private static readonly CertificateCodes: ReadonlySet<string> = new Set([
        'SELF_SIGNED_CERT_IN_CHAIN',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'UNABLE_TO_GET_ISSUER_CERT',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'CERT_UNTRUSTED',
        'CERT_HAS_EXPIRED',
        'CERT_NOT_YET_VALID',
        'ERR_TLS_CERT_ALTNAME_INVALID',
        // The rest of Node's X509 verify error codes (node_crypto X509ErrorCode).
        'UNABLE_TO_GET_CRL',
        'UNABLE_TO_DECRYPT_CERT_SIGNATURE',
        'UNABLE_TO_DECRYPT_CRL_SIGNATURE',
        'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY',
        'CERT_SIGNATURE_FAILURE',
        'CRL_SIGNATURE_FAILURE',
        'CRL_NOT_YET_VALID',
        'CRL_HAS_EXPIRED',
        'ERROR_IN_CERT_NOT_BEFORE_FIELD',
        'ERROR_IN_CERT_NOT_AFTER_FIELD',
        'ERROR_IN_CRL_LAST_UPDATE_FIELD',
        'ERROR_IN_CRL_NEXT_UPDATE_FIELD',
        'CERT_CHAIN_TOO_LONG',
        'CERT_REVOKED',
        'INVALID_CA',
        'PATH_LENGTH_EXCEEDED',
        'INVALID_PURPOSE',
        'CERT_REJECTED',
        'HOSTNAME_MISMATCH',
        // A verify error Node has no name for (Electron's BoringSSL: "unsupported name constraint type").
        'UNSPECIFIED',
    ])

    /** True when `error` (or its `cause`, one level) carries a certificate-verification code. */
    public static IsCertificate(error: unknown): boolean
    {
        return TlsFailure.HasCode(error) || TlsFailure.HasCode((error as { cause?: unknown } | null | undefined)?.cause)
    }

    private static HasCode(value: unknown): boolean
    {
        if (typeof value !== 'object' || value === null)
        {
            return false
        }
        const code = (value as { code?: unknown }).code
        return typeof code === 'string' && TlsFailure.CertificateCodes.has(code)
    }
}
