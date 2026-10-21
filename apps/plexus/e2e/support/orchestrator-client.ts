// Support for the runtime-publishing live-loop e2e (Task 5): a thin wrapper over the Task 2
// control-plane orchestrator CLI, plus a runtime environment-graph reader used by the pre-promote
// review assertion.
//
// The orchestrator (pragmatic-server/admin/control-plane/loop-orchestrator.ts) composes the real
// control-plane in-process and exposes FOUR subcommands, each printing ONE JSON descriptor to
// stdout; stderr carries only redacted logs. Separate invocations share state through the
// --data-root directory, so the SAME data root (captured from create-dev) is passed to every call.
// Descriptors carry tokens and passwords: this client NEVER logs stdout.
//
//   create-dev                -> DevDescriptor
//   create-runtime            -> RuntimeDescriptor   (creates + provisions; env graph still EMPTY)
//   promote --graph <g>       -> PromoteDescriptor   (idempotent; relays dev graph into the runtime)
//   teardown                  -> TeardownDescriptor
//   db-exec --sql <sql>       -> DbExecDescriptor    (runs SQL against the runtime env's provisioned Postgres)
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PLEXUS_ROOT } from '../plexus-app'

// ── The cross-task JSON contract (keys fixed by loop-orchestrator.ts; declared verbatim) ──
//
// SOURCE OF TRUTH: these interfaces hand-mirror the ones EXPORTED by
// pragmatic-server/admin/control-plane/loop-orchestrator.ts — `CredentialDescriptor`,
// `DevDescriptor`, `RuntimeDescriptor`, `PromoteDescriptor`, `TeardownDescriptor`. Keep them in
// sync with that module (they are the only cross-process channel for these shapes).

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

/** Output of create-runtime: the runtime exists and reader/ungranted accounts are provisioned, but
 *  nothing has been promoted yet — the environment graph is empty. */
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

/** Output of promote: relays the dev graph into the existing runtime; re-runnable. */
/** Output of db-exec. */
export interface DbExecDescriptor
{
    ok: true
    rowCount: number
}

export interface PromoteDescriptor
{
    graphName: string
    packageCount: number
    targetEnv: string
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
    private static readonly TsxBin = 'tsx'
    private static readonly ImportFlag = '--import'
    private static readonly CreateDevCommand = 'create-dev'
    private static readonly CreateRuntimeCommand = 'create-runtime'
    private static readonly PromoteCommand = 'promote'
    private static readonly TeardownCommand = 'teardown'
    private static readonly DbExecCommand = 'db-exec'
    private static readonly SqlFlag = '--sql'
    private static readonly DataRootFlag = '--data-root'
    private static readonly GraphFlag = '--graph'
    private static readonly TmpPrefix = 'plexus-loop-'
    private static readonly SpawnTimeoutMs = 600_000
    private static readonly Utf8 = 'utf8'
    private static readonly CloseEvent = 'close'
    private static readonly ErrorEvent = 'error'
    private static readonly DataEvent = 'data'
    private static readonly NoDataRootMessage = 'CreateDev must run before CreateRuntime/Promote/Teardown (no data root captured yet)'
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

    public async CreateRuntime(): Promise<RuntimeDescriptor>
    {
        return this.Run<RuntimeDescriptor>([OrchestratorClient.CreateRuntimeCommand, OrchestratorClient.DataRootFlag, this.RequireDataRoot()])
    }

    public async Promote(graph: string): Promise<PromoteDescriptor>
    {
        return this.Run<PromoteDescriptor>([OrchestratorClient.PromoteCommand, OrchestratorClient.DataRootFlag, this.RequireDataRoot(), OrchestratorClient.GraphFlag, graph])
    }

    /** Runs arbitrary SQL against the runtime env's provisioned Postgres (the SQL is never logged by the orchestrator). */
    public async DbExec(sql: string): Promise<void>
    {
        await this.Run<DbExecDescriptor>([OrchestratorClient.DbExecCommand, OrchestratorClient.DataRootFlag, this.RequireDataRoot(), OrchestratorClient.SqlFlag, sql])
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

    // Spawns `node --import tsx <orchestrator> <subcommand> ...` in the server repo and parses the single
    // JSON object the subcommand prints to stdout. stdout is never logged (it carries secrets);
    // only the orchestrator's already-redacted stderr is surfaced on failure.
    private Run<T>(args: readonly string[]): Promise<T>
    {
        const orchestrator = path.join(this.serverRepo, OrchestratorClient.OrchestratorRel)
        const command = args[0]
        return new Promise<T>((resolve, reject) => {
            const child = spawn(process.execPath, [OrchestratorClient.ImportFlag, OrchestratorClient.TsxBin, orchestrator, ...args], {
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
            child.on(OrchestratorClient.CloseEvent, (code) => {
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

/** Outcome of a runtime environment-graph read: either rows came back, or the server rejected cleanly. */
export interface WireReadOutcome
{
    Ok: boolean
    RowCount?: number
    ErrorMessage?: string
}

// Reads a runtime tenant's ENVIRONMENT graph node-side over the same PragmaticClient the real Node
// clients use (control-plane-smoke / the sp1 capstone read this way). A Cypher read issued WITHOUT
// OpenApplication resolves to the environment graph. Used by two symmetric review assertions:
//   - pre-promote (as the reader): nothing promoted yet, so the server surfaces a clean
//     NoEnvironmentGraphError ("no environment graph is loaded") rather than crashing;
//   - ungranted (after promote): a graph IS loaded, so the readTenant/RBAC gate refuses the
//     ungranted principal with a permission denial ("no grant covers this action on this resource").
// No raw `ws` dependency: importing the protocol barrel installs its Node dialer for ConnectAsync.
export class RuntimeEnvGraphReader
{
    private static readonly LoginPath = '/auth/login'
    private static readonly TenantQuery = '?tenant='
    private static readonly PostMethod = 'POST'
    private static readonly ContentTypeHeader = 'content-type'
    private static readonly JsonContentType = 'application/json'
    private static readonly LoginFailedPrefix = 'login failed with HTTP '
    private static readonly NoTokenMessage = 'login response contained no token'
    private static readonly TokenKey = 'token'

    // Logs in (bearer), connects node-side, runs one environment-graph read without binding an app,
    // and returns the outcome. A ResponseError (the server's clean rejection) is an Error, so its
    // message is captured by the single catch. The bearer token never leaves this method.
    public async ReadEnvGraph(appOriginBase: string, runtimeWsUrl: string, tenant: string, email: string, password: string, cypher: string): Promise<WireReadOutcome>
    {
        const token = await this.Login(appOriginBase, tenant, email, password)
        const { PragmaticClient } = await import('@pragmatic-tech-ai/pragmatic-protocol')
        const client = await PragmaticClient.ConnectAsync(runtimeWsUrl, { bearerToken: token })
        try
        {
            const page = await client.CypherQuery(cypher)
            return { Ok: true, RowCount: page.items.length }
        }
        catch (error)
        {
            return { Ok: false, ErrorMessage: error instanceof Error ? error.message : String(error) }
        }
        finally
        {
            await client.DisposeAsync()
        }
    }

    private async Login(appOriginBase: string, tenant: string, email: string, password: string): Promise<string>
    {
        const url = `${appOriginBase}${RuntimeEnvGraphReader.LoginPath}${RuntimeEnvGraphReader.TenantQuery}${encodeURIComponent(tenant)}`
        const response = await fetch(url, {
            method: RuntimeEnvGraphReader.PostMethod,
            headers: { [RuntimeEnvGraphReader.ContentTypeHeader]: RuntimeEnvGraphReader.JsonContentType },
            body: JSON.stringify({ email, password }),
        })
        if (!response.ok)
        {
            throw new Error(RuntimeEnvGraphReader.LoginFailedPrefix + String(response.status))
        }
        const body = await response.json() as Record<string, unknown>
        const token = body[RuntimeEnvGraphReader.TokenKey]
        if (typeof token !== 'string' || token === '')
        {
            throw new Error(RuntimeEnvGraphReader.NoTokenMessage)
        }
        return token
    }
}
