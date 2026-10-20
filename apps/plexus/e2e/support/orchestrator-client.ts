// Support for the runtime-publishing live-loop e2e (Task 5): a thin wrapper over the Task 2
// control-plane orchestrator CLI, plus a direct-wire environment-graph reader used by the
// pre-promote review assertion.
//
// The orchestrator (pragmatic-server/admin/control-plane/loop-orchestrator.ts) composes the
// real control-plane in-process and exposes three subcommands, each printing ONE JSON
// descriptor to stdout; stderr carries only redacted logs. Separate invocations share state
// through the --data-root directory, so the SAME data root (captured from create-dev) is passed
// to every call. Descriptors carry tokens and passwords: this client NEVER logs stdout.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    CypherProtocol, WsMessageSocket, WebSocketMessageReader, WebSocketMessageWriter,
    createMessageConnection, NullLogger, ResponseError, type MessageConnection,
} from '@pragmatic-tech-ai/pragmatic-protocol'
import { PLEXUS_ROOT } from '../plexus-app'

// ── The cross-task JSON contract (keys fixed by loop-orchestrator.ts; declared verbatim) ──

export interface CredentialDescriptor
{
    email: string
    password: string
}

/** Output of create-dev. */
export interface DevDescriptor
{
    dataRoot: string
    devEnv: string
    devWsUrl: string
    graphName: string
    makerToken: string
}

/** Output of promote-and-provision. */
export interface RuntimeDescriptor
{
    runtimeEnv: string
    tenant: string
    runtimeWsUrl: string
    runtimeHostPort: number
    appOriginBase: string
    deployToken: string
    reader: CredentialDescriptor
    ungranted: CredentialDescriptor
}

/** Output of teardown. */
export interface TeardownDescriptor
{
    ok: true
}

/** Spawns the Task 2 orchestrator CLI and parses its JSON descriptors. */
export class OrchestratorClient
{
    private static readonly ServerRepoEnv = 'SP_SERVER_REPO'
    // pragmatic-server is a sibling of the Plexus repo: apps/plexus -> apps -> Plexus -> architecture-agent.
    private static readonly DefaultServerRepoRel = '../../../pragmatic-server'
    private static readonly OrchestratorRel = 'admin/control-plane/loop-orchestrator.ts'
    private static readonly NpxWindows = 'npx.cmd'
    private static readonly NpxPosix = 'npx'
    private static readonly TsxBin = 'tsx'
    private static readonly CreateDevCommand = 'create-dev'
    private static readonly PromoteAndProvisionCommand = 'promote-and-provision'
    private static readonly TeardownCommand = 'teardown'
    private static readonly DataRootFlag = '--data-root'
    private static readonly GraphFlag = '--graph'
    private static readonly TmpPrefix = 'plexus-loop-'
    private static readonly WindowsPlatform = 'win32'
    private static readonly SpawnTimeoutMs = 600_000
    private static readonly Utf8 = 'utf8'
    private static readonly CloseEvent = 'close'
    private static readonly ErrorEvent = 'error'
    private static readonly DataEvent = 'data'
    private static readonly NoDataRootMessage = 'CreateDev must run before PromoteAndProvision/Teardown (no data root captured yet)'
    private static readonly NoJsonMessage = 'orchestrator produced no JSON descriptor on stdout'
    private static readonly FailedPrefix = 'orchestrator '
    private static readonly FailedExit = ' exited with code '
    private static readonly StderrSep = ': '
    private static readonly NewlinePattern = /\r?\n/

    private dataRoot: string | undefined

    public constructor(private readonly serverRepo: string)
    {
    }

    /** Resolves the server repo from SP_SERVER_REPO, falling back to the sibling default. */
    public static Create(): OrchestratorClient
    {
        const fromEnv = process.env[OrchestratorClient.ServerRepoEnv]
        const repo = fromEnv !== undefined && fromEnv !== '' ? fromEnv : path.resolve(PLEXUS_ROOT, OrchestratorClient.DefaultServerRepoRel)
        return new OrchestratorClient(repo)
    }

    public async CreateDev(graph?: string): Promise<DevDescriptor>
    {
        this.dataRoot = mkdtempSync(path.join(tmpdir(), OrchestratorClient.TmpPrefix))
        const args = [OrchestratorClient.CreateDevCommand, OrchestratorClient.DataRootFlag, this.dataRoot]
        if (graph !== undefined)
        {
            args.push(OrchestratorClient.GraphFlag, graph)
        }
        return this.Run<DevDescriptor>(args)
    }

    public async PromoteAndProvision(graph: string): Promise<RuntimeDescriptor>
    {
        const args = [OrchestratorClient.PromoteAndProvisionCommand, OrchestratorClient.DataRootFlag, this.RequireDataRoot(), OrchestratorClient.GraphFlag, graph]
        return this.Run<RuntimeDescriptor>(args)
    }

    public async Teardown(): Promise<TeardownDescriptor>
    {
        if (this.dataRoot === undefined)
        {
            return { ok: true }
        }
        return this.Run<TeardownDescriptor>([OrchestratorClient.TeardownCommand, OrchestratorClient.DataRootFlag, this.dataRoot])
    }

    private RequireDataRoot(): string
    {
        if (this.dataRoot === undefined)
        {
            throw new Error(OrchestratorClient.NoDataRootMessage)
        }
        return this.dataRoot
    }

    // Spawns `npx tsx <orchestrator> <subcommand> ...` in the server repo and parses the single
    // JSON object the subcommand prints to stdout. stdout is never logged (it carries secrets);
    // only the orchestrator's already-redacted stderr is surfaced on failure.
    private Run<T>(args: readonly string[]): Promise<T>
    {
        const orchestrator = path.join(this.serverRepo, OrchestratorClient.OrchestratorRel)
        const npx = process.platform === OrchestratorClient.WindowsPlatform ? OrchestratorClient.NpxWindows : OrchestratorClient.NpxPosix
        const command = args[0]
        return new Promise<T>((resolve, reject) =>
        {
            const child = spawn(npx, [OrchestratorClient.TsxBin, orchestrator, ...args], {
                cwd: this.serverRepo,
                timeout: OrchestratorClient.SpawnTimeoutMs,
            })
            let stdout = ''
            let stderr = ''
            child.stdout.setEncoding(OrchestratorClient.Utf8)
            child.stderr.setEncoding(OrchestratorClient.Utf8)
            child.stdout.on(OrchestratorClient.DataEvent, (chunk: string) => { stdout += chunk })
            child.stderr.on(OrchestratorClient.DataEvent, (chunk: string) => { stderr += chunk })
            child.on(OrchestratorClient.ErrorEvent, reject)
            child.on(OrchestratorClient.CloseEvent, (code) =>
            {
                if (code !== 0)
                {
                    reject(new Error(OrchestratorClient.FailedPrefix + String(command) + OrchestratorClient.FailedExit + String(code) + (stderr.trim() === '' ? '' : OrchestratorClient.StderrSep + stderr.trim())))
                    return
                }
                try
                {
                    resolve(OrchestratorClient.ParseDescriptor<T>(stdout))
                }
                catch (error)
                {
                    reject(error)
                }
            })
        })
    }

    // The subcommand prints exactly one JSON object; take the last non-empty stdout line so any
    // incidental stdout noise before it is ignored. Parse errors never echo stdout (secrets).
    private static ParseDescriptor<T>(stdout: string): T
    {
        const lines = stdout.split(OrchestratorClient.NewlinePattern).map((l) => l.trim()).filter((l) => l !== '')
        const last = lines[lines.length - 1]
        if (last === undefined)
        {
            throw new Error(OrchestratorClient.NoJsonMessage)
        }
        return JSON.parse(last) as T
    }
}

/** Outcome of a direct-wire environment-graph read: either rows came back, or the server rejected cleanly. */
export interface WireReadOutcome
{
    Ok: boolean
    RowCount?: number
    ErrorMessage?: string
}

// Issues a single Cypher read against a runtime tenant's environment graph over the same WebSocket
// JSON-RPC surface the real clients use. Used by the pre-promote review assertion to prove the
// "no environment graph loaded" path surfaces a clean, structured error rather than crashing.
//
// The `ws` package is not hoisted to the Plexus workspace root, so it is imported dynamically (and
// only when this reader actually runs) through a non-literal specifier — this keeps the module
// resolvable/typecheckable without a top-level `ws` dependency; an operator enabling the gated
// pre-promote step installs `ws` in apps/plexus.
export class EnvGraphWireReader
{
    private static readonly WsModuleSpecifier = 'ws'
    private static readonly WebSocketExport = 'WebSocket'
    private static readonly DefaultExport = 'default'
    private static readonly AuthorizationHeader = 'Authorization'
    private static readonly BearerPrefix = 'Bearer '
    private static readonly OpenEvent = 'open'
    private static readonly ErrorEvent = 'error'

    public async ReadEnvGraph(wsUrl: string, token: string, cypher: string): Promise<WireReadOutcome>
    {
        const connection = await this.Connect(wsUrl, token)
        try
        {
            const page = await connection.sendRequest(CypherProtocol.Query, { cypher })
            return { Ok: true, RowCount: page.items.length }
        }
        catch (error)
        {
            if (error instanceof ResponseError)
            {
                return { Ok: false, ErrorMessage: error.message }
            }
            return { Ok: false, ErrorMessage: error instanceof Error ? error.message : String(error) }
        }
        finally
        {
            connection.dispose()
        }
    }

    private async Connect(wsUrl: string, token: string): Promise<MessageConnection>
    {
        const specifier = EnvGraphWireReader.WsModuleSpecifier
        const wsModule = await import(specifier) as Record<string, unknown>
        const WebSocketCtor = (wsModule[EnvGraphWireReader.WebSocketExport] ?? wsModule[EnvGraphWireReader.DefaultExport]) as new (url: string, options: { headers: Record<string, string> }) => unknown
        const socket = new WebSocketCtor(wsUrl, { headers: { [EnvGraphWireReader.AuthorizationHeader]: EnvGraphWireReader.BearerPrefix + token } }) as { once(event: string, handler: (arg?: unknown) => void): void }
        await new Promise<void>((resolve, reject) =>
        {
            socket.once(EnvGraphWireReader.OpenEvent, () => resolve())
            socket.once(EnvGraphWireReader.ErrorEvent, (err) => reject(err instanceof Error ? err : new Error(String(err))))
        })
        const messageSocket = new WsMessageSocket(socket as never)
        const connection = createMessageConnection(new WebSocketMessageReader(messageSocket), new WebSocketMessageWriter(messageSocket), NullLogger)
        connection.listen()
        return connection
    }
}
