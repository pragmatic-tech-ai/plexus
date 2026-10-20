import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { GraphProfile, IGraphProfileSource } from './graph-profile.js'

// Structural twin of todl-platform-node's Encryptor (SafeStorageEncryptor satisfies it), kept
// local so this store has no Electron or cross-package dependency and tests use a plain fake.
export interface ITokenEncryptor
{
    IsAvailable(): boolean;
    Encrypt(plain: string): Buffer;
    Decrypt(blob: Buffer): string;
}

// Validates the graph server URL: wss:/https: always; ws:/http: only for loopback hosts, so a
// bearer token is never sent in cleartext over a network.
export class GraphServerUrl
{
    private static readonly Invalid = 'The graph server URL is not a valid URL.'
    private static readonly BadScheme = 'The graph server URL must use wss: or https:.'
    private static readonly Cleartext = 'The graph server URL uses cleartext ws:/http:, which is only allowed for localhost; use wss: or https:.'
    private static readonly SecureSchemes = ['wss:', 'https:']
    private static readonly CleartextSchemes = ['ws:', 'http:']
    private static readonly LoopbackHosts = ['localhost', '127.0.0.1', '[::1]']

    public static Validate(raw: string): string
    {
        const trimmed = raw.trim()
        let url: URL
        try
        {
            url = new URL(trimmed)
        }
        catch
        {
            throw new Error(GraphServerUrl.Invalid)
        }
        if (GraphServerUrl.SecureSchemes.includes(url.protocol)) return trimmed
        if (!GraphServerUrl.CleartextSchemes.includes(url.protocol)) throw new Error(GraphServerUrl.BadScheme)
        if (!GraphServerUrl.LoopbackHosts.includes(url.hostname)) throw new Error(GraphServerUrl.Cleartext)
        return trimmed
    }
}

// Persists the graph profile under the app userData dir as ONE OS-keyring-encrypted blob
// holding both the server URL and the bearer token. A single file written via temp + rename
// means a crash can never leave a URL without its token (or the reverse), and no plaintext
// token ever touches disk. There is no read path that hands the token to the renderer.
// Load returns undefined only when nothing is configured; an unusable store (secure storage
// unavailable, unreadable blob) throws a distinct error so it is not mistaken for "no profile".
export class GraphProfileStore implements IGraphProfileSource
{
    private static readonly ProfileFile = 'graph-profile.bin'
    private static readonly TempSuffix = '.tmp'
    private static readonly NotFoundCode = 'ENOENT'
    private static readonly EncryptionUnavailable = 'Secure storage is unavailable on this system; the graph token cannot be stored or read.'
    private static readonly Unreadable = 'The stored graph profile could not be read; configure the graph server again.'
    private static readonly EmptyProfile = 'Graph server URL and token are both required.'

    constructor(private readonly dir: string, private readonly encryptor: ITokenEncryptor)
    {
    }

    public async Save(serverUrl: string, token: string): Promise<void>
    {
        if (serverUrl.trim() === '' || token.trim() === '') throw new Error(GraphProfileStore.EmptyProfile)
        const validated = GraphServerUrl.Validate(serverUrl)
        if (!this.encryptor.IsAvailable()) throw new Error(GraphProfileStore.EncryptionUnavailable)
        const blob = this.encryptor.Encrypt(JSON.stringify({ ServerUrl: validated, Token: token }))
        await fs.mkdir(this.dir, { recursive: true })
        const target = join(this.dir, GraphProfileStore.ProfileFile)
        const temp = `${target}${GraphProfileStore.TempSuffix}`
        await fs.writeFile(temp, blob)
        await fs.rename(temp, target)
    }

    public async Load(): Promise<GraphProfile | undefined>
    {
        const blob = await this.readBlob()
        if (blob === undefined) return undefined
        if (!this.encryptor.IsAvailable()) throw new Error(GraphProfileStore.EncryptionUnavailable)
        return this.decode(blob)
    }

    // Decrypt/parse failures are reported without any of the blob content.
    private decode(blob: Buffer): GraphProfile
    {
        try
        {
            const parsed = JSON.parse(this.encryptor.Decrypt(blob)) as { ServerUrl?: unknown; Token?: unknown }
            if (typeof parsed.ServerUrl === 'string' && typeof parsed.Token === 'string' && parsed.ServerUrl !== '' && parsed.Token !== '')
            {
                return { ServerUrl: parsed.ServerUrl, Token: parsed.Token }
            }
        }
        catch
        {
            // fall through to the single generic error
        }
        throw new Error(GraphProfileStore.Unreadable)
    }

    private async readBlob(): Promise<Buffer | undefined>
    {
        try
        {
            return await fs.readFile(join(this.dir, GraphProfileStore.ProfileFile))
        }
        catch (e)
        {
            if ((e as NodeJS.ErrnoException).code === GraphProfileStore.NotFoundCode) return undefined
            throw e
        }
    }
}
