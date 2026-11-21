// Support for the runtime-publishing live-loop e2e (Task 5): a thin wrapper over the Task 2
// control-plane orchestrator CLI, plus a runtime environment-graph reader used by the pre-promote
// review assertion.
//
// The orchestrator (pragmatic-e2e src/live-loop/loop-orchestrator.ts) drives the
// RUNNING e2e stack (pragmatic-e2e live-loop-stack.ts up): the tenant owner creates the environments
// on the tenant's hive and provisions them, the operator promotes. Each subcommand prints ONE JSON
// descriptor to stdout; stderr carries only redacted logs. The stack descriptor is passed with --stack
// when PLEXUS_E2E_STACK is set (else the orchestrator's default, ~/.pragmatic/e2e-stack/stack.json).
// Descriptors carry passwords: this client NEVER logs stdout.
//
//   create-dev                -> DevDescriptor
//   create-runtime            -> RuntimeDescriptor   (creates + provisions; env graph still EMPTY)
//   promote --graph <g>       -> PromoteDescriptor   (idempotent; relays dev graph into the runtime)
//   teardown                  -> TeardownDescriptor
//   db-exec --sql <sql>       -> DbExecDescriptor    (runs SQL against the runtime env's provisioned Postgres)
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import path from 'node:path'
import { PLEXUS_ROOT } from '../plexus-app'
import { E2eStackInputs } from './e2e-stack-inputs'

// ── The cross-task JSON contract (keys fixed by loop-orchestrator.ts; declared verbatim) ──
//
// SOURCE OF TRUTH: these interfaces hand-mirror the ones EXPORTED by
// pragmatic-e2e src/live-loop/loop-orchestrator.ts — `CredentialDescriptor`,
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
    devEnv: string
    graphName: string
}

/** Output of create-runtime: the runtime exists and reader/ungranted accounts are provisioned, but
 *  nothing has been promoted yet — the environment graph is empty. */
export interface RuntimeDescriptor
{
    runtimeEnv: string
    /** The runtime environment's id. */
    environment: string
    runtimeWsUrl: string
    appOriginBase: string
    reader: CredentialDescriptor
    ungranted: CredentialDescriptor
}

/** Output of promote: relays the dev graph into the existing runtime; re-runnable. */
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

/** Output of db-exec. */
export interface DbExecDescriptor
{
    ok: true
    rowCount: number
}

/** How the orchestrator process is started: program, arguments, working folder and environment. */
export interface OrchestratorLaunch
{
    file: string
    args: string[]
    cwd: string
    env: NodeJS.ProcessEnv
}

/**
 * Spawns the Task 2 orchestrator CLI and parses its JSON descriptors. With PRAGMATIC_E2E_WSL_DISTRO set, the orchestrator
 * runs inside that WSL distro (where the stack runs on a machine whose Docker, kind and kubectl live in WSL, e.g. the hive
 * laptop): PRAGMATIC_E2E_REPO is then the checkout's Linux path, and the stack folder (PLEXUS_E2E_STACK's folder, a Windows
 * path) reaches it translated, as PRAGMATIC_E2E_STACK_DIR.
 */
export class OrchestratorClient
{
    public static readonly E2eRepoEnv = 'PRAGMATIC_E2E_REPO'
    public static readonly WslDistroEnv = 'PRAGMATIC_E2E_WSL_DISTRO'
    public static readonly StackDirEnv = 'PRAGMATIC_E2E_STACK_DIR'
    private static readonly Wsl = 'wsl.exe'
    private static readonly WslDistroFlag = '-d'
    private static readonly WslCdFlag = '--cd'
    private static readonly WslUserFlag = '-u'
    /** The user the stack runs as in the distro (hive run --wsl runs it as root, Docker's user there). */
    private static readonly WslUser = 'root'
    private static readonly StackFileName = 'stack.json'
    private static readonly ReachDeadlineMs = 15_000
    private static readonly ReachPollMs = 250
    private static readonly ConnectEvent = 'connect'
    private static readonly UnreachablePrefix = 'the runtime environment did not become reachable from this machine: '
    private static readonly WslStackNameMessage = 'with PRAGMATIC_E2E_WSL_DISTRO, PLEXUS_E2E_STACK must name the stack folder\'s stack.json: '
    private static readonly WslExecFlag = '--exec'
    private static readonly WslNode = 'node'
    private static readonly WslEnv = 'WSLENV'
    private static readonly WslEnvSeparator = ':'
    /** WSLENV flag: the value is a path, translated from Windows to WSL form. */
    private static readonly WslPathFlag = '/p'
    private static readonly WslNeedsRepoMessage = 'PRAGMATIC_E2E_WSL_DISTRO needs PRAGMATIC_E2E_REPO: the Linux path of the pragmatic-e2e checkout inside that distro'
    // pragmatic-e2e is a sibling of the Plexus repo (the workspace and the hive laptop's clone folder):
    // apps/plexus -> apps -> Plexus -> the folder both sit in.
    public static readonly DefaultE2eRepoRel = '../../../pragmatic-e2e'
    public static readonly OrchestratorRel = 'src/live-loop/loop-orchestrator.ts'
    private static readonly StackEnv = E2eStackInputs.StackEnv
    private static readonly StackFlag = '--stack'
    private static readonly KeepEnv = 'SP_RUNTIME_LOOP_KEEP'
    private static readonly KeepValue = '1'
    private static readonly TsxBin = 'tsx'
    private static readonly ImportFlag = '--import'
    private static readonly CreateDevCommand = 'create-dev'
    private static readonly CreateRuntimeCommand = 'create-runtime'
    private static readonly PromoteCommand = 'promote'
    private static readonly TeardownCommand = 'teardown'
    private static readonly DbExecCommand = 'db-exec'
    private static readonly SqlFlag = '--sql'
    private static readonly GraphFlag = '--graph'
    private static readonly SpawnTimeoutMs = 600_000
    private static readonly Utf8 = 'utf8'
    private static readonly CloseEvent = 'close'
    private static readonly ErrorEvent = 'error'
    private static readonly DataEvent = 'data'
    private static readonly NoJsonMessage = 'orchestrator produced no JSON descriptor on stdout'
    private static readonly FailedPrefix = 'orchestrator '
    private static readonly FailedExit = ' exited with code '
    private static readonly StderrSep = ': '
    private static readonly NewlinePattern = /\r?\n/

    private started = false

    public constructor(
        private readonly e2eRepo: string,
        private readonly stack: string | undefined,
        private readonly wslDistro: string | undefined = undefined,
        private readonly env: NodeJS.ProcessEnv = process.env)
    {
    }

    /** Resolves the pragmatic-e2e checkout from PRAGMATIC_E2E_REPO, falling back to the sibling default (not in WSL). */
    public static Create(env: NodeJS.ProcessEnv = process.env): OrchestratorClient
    {
        const C = OrchestratorClient
        const stack = env[C.StackEnv]
        const distro = env[C.WslDistroEnv]?.trim()
        if (distro !== undefined && distro !== '')
        {
            const repo = env[C.E2eRepoEnv]?.trim()
            if (repo === undefined || repo === '')
            {
                throw new Error(C.WslNeedsRepoMessage)
            }
            return new OrchestratorClient(repo, stack !== undefined && stack !== '' ? stack : undefined, distro, env)
        }
        return new OrchestratorClient(C.E2eRepoOf(env), stack !== undefined && stack !== '' ? stack : undefined, undefined, env)
    }

    /**
     * How the orchestrator starts for `args`: this Node with tsx in the checkout, or (WSL) `wsl.exe -d <distro> --cd <checkout>
     * --exec node --import tsx ...` with the stack folder passed as a translated path variable instead of --stack.
     */
    public Launch(args: readonly string[]): OrchestratorLaunch
    {
        const C = OrchestratorClient
        if (this.wslDistro === undefined)
        {
            const stackArgs = this.stack === undefined ? [] : [C.StackFlag, this.stack]
            return { file: process.execPath, args: [C.ImportFlag, C.TsxBin, this.OrchestratorPath(), ...args, ...stackArgs], cwd: this.e2eRepo, env: this.env }
        }
        let env = this.env
        if (this.stack !== undefined)
        {
            const stack = path.win32.resolve(this.stack)
            if (path.win32.basename(stack).toLowerCase() !== C.StackFileName)
            {
                // The orchestrator in WSL reads stack.json from the folder it is given; another file name would be ignored.
                throw new Error(C.WslStackNameMessage + stack)
            }
            const names = (this.env[C.WslEnv] ?? '').split(C.WslEnvSeparator).filter((name) => name !== '')
            env = { ...this.env, [C.StackDirEnv]: path.win32.dirname(stack), [C.WslEnv]: [...names, C.StackDirEnv + C.WslPathFlag].join(C.WslEnvSeparator) }
        }
        return {
            file: C.Wsl,
            args: [C.WslDistroFlag, this.wslDistro, C.WslUserFlag, C.WslUser, C.WslCdFlag, this.e2eRepo, C.WslExecFlag, C.WslNode, C.ImportFlag, C.TsxBin, C.OrchestratorRel, ...args],
            cwd: PLEXUS_ROOT,
            env,
        }
    }

    /** The pragmatic-e2e checkout the orchestrator runs from: PRAGMATIC_E2E_REPO when set, else the sibling of the Plexus repo. */
    public static E2eRepoOf(env: NodeJS.ProcessEnv): string
    {
        const fromEnv = env[OrchestratorClient.E2eRepoEnv]
        return fromEnv !== undefined && fromEnv !== '' ? fromEnv : path.resolve(PLEXUS_ROOT, OrchestratorClient.DefaultE2eRepoRel)
    }

    /** The orchestrator script inside that checkout. */
    public OrchestratorPath(): string
    {
        return path.join(this.e2eRepo, OrchestratorClient.OrchestratorRel)
    }

    public async CreateDev(graph?: string): Promise<DevDescriptor>
    {
        this.started = true
        const args = [OrchestratorClient.CreateDevCommand]
        if (graph !== undefined)
        {
            args.push(OrchestratorClient.GraphFlag, graph)
        }
        return this.Run<DevDescriptor>(args)
    }

    public async CreateRuntime(): Promise<RuntimeDescriptor>
    {
        const runtime = await this.Run<RuntimeDescriptor>([OrchestratorClient.CreateRuntimeCommand])
        if (this.wslDistro !== undefined)
        {
            // The orchestrator opened its port-forward inside WSL; Windows reaches it only once WSL's localhost relay has
            // picked the new port up (a few hundred milliseconds later), so wait for that before anyone uses the origin.
            await OrchestratorClient.WaitReachable(runtime.appOriginBase)
        }
        return runtime
    }

    /** Resolves once a TCP connection to `origin`'s host and port succeeds; throws naming the origin after `deadlineMs`. */
    public static async WaitReachable(origin: string, deadlineMs: number = OrchestratorClient.ReachDeadlineMs): Promise<void>
    {
        const C = OrchestratorClient
        const url = new URL(origin)
        const deadline = Date.now() + deadlineMs
        while (Date.now() < deadline)
        {
            const reached = await new Promise<boolean>((resolve) => {
                const socket = createConnection({ host: url.hostname, port: Number(url.port) })
                socket.once(C.ConnectEvent, () => { socket.destroy(); resolve(true) })
                socket.once(C.ErrorEvent, () => resolve(false))
            })
            if (reached)
            {
                return
            }
            await new Promise<void>((resolve) => setTimeout(resolve, C.ReachPollMs))
        }
        throw new Error(C.UnreachablePrefix + origin)
    }

    public async Promote(graph: string): Promise<PromoteDescriptor>
    {
        return this.Run<PromoteDescriptor>([OrchestratorClient.PromoteCommand, OrchestratorClient.GraphFlag, graph])
    }

    /** Runs arbitrary SQL against the runtime env's provisioned Postgres (the SQL is never logged by the orchestrator). */
    public async DbExec(sql: string): Promise<void>
    {
        await this.Run<DbExecDescriptor>([OrchestratorClient.DbExecCommand, OrchestratorClient.SqlFlag, sql])
    }

    public async Teardown(): Promise<TeardownDescriptor>
    {
        // SP_RUNTIME_LOOP_KEEP=1 keeps the environments for inspection after a run; clean up later with the
        // orchestrator's own teardown command.
        if (!this.started || process.env[OrchestratorClient.KeepEnv] === OrchestratorClient.KeepValue)
        {
            return { ok: true }
        }
        return this.Run<TeardownDescriptor>([OrchestratorClient.TeardownCommand])
    }

    // Spawns `node --import tsx <orchestrator> <subcommand> ...` in the pragmatic-e2e checkout and parses the single
    // JSON object the subcommand prints to stdout. stdout is never logged (it carries secrets);
    // only the orchestrator's already-redacted stderr is surfaced on failure.
    private Run<T>(args: readonly string[]): Promise<T>
    {
        const launch = this.Launch(args)
        const command = args[0]
        return new Promise<T>((resolve, reject) => {
            const child = spawn(launch.file, launch.args, {
                cwd: launch.cwd,
                env: launch.env,
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
//   - pre-promote (as the reader): nothing promoted yet, so the environment engine answers the read
//     cleanly with no rows;
//   - ungranted (after promote): data IS promoted, so the readTenant/RBAC gate refuses the
//     ungranted principal with a permission denial ("no grant covers this action on this resource").
// No raw `ws` dependency: importing the protocol barrel installs its Node dialer for ConnectAsync.
export class RuntimeEnvGraphReader
{
    private static readonly LoginPath = '/auth/login'
    private static readonly EnvironmentQuery = '?environment='
    private static readonly PostMethod = 'POST'
    private static readonly ContentTypeHeader = 'content-type'
    private static readonly JsonContentType = 'application/json'
    private static readonly LoginFailedPrefix = 'login failed with HTTP '
    private static readonly NoTokenMessage = 'login response contained no token'
    private static readonly TokenKey = 'token'

    // Logs in (bearer), connects node-side, runs one environment-graph read without binding an app,
    // and returns the outcome. A ResponseError (the server's clean rejection) is an Error, so its
    // message is captured by the single catch. The bearer token never leaves this method.
    public async ReadEnvGraph(appOriginBase: string, runtimeWsUrl: string, environment: string, email: string, password: string, cypher: string): Promise<WireReadOutcome>
    {
        const token = await this.Login(appOriginBase, environment, email, password)
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

    private async Login(appOriginBase: string, environment: string, email: string, password: string): Promise<string>
    {
        const url = `${appOriginBase}${RuntimeEnvGraphReader.LoginPath}${RuntimeEnvGraphReader.EnvironmentQuery}${encodeURIComponent(environment)}`
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
