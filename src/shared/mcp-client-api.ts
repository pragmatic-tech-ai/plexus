// Wire contracts for the MCP-client feature: the persisted server model, the
// renderer<->main IPC surface, and the probe result. Real enums (kept out of .mu
// markup — the panel binds VM option lists / boolean flags instead, so no
// symbol-table ENUM_MEMBERS registration is needed).

export enum McpTransportKind { Stdio = 'stdio', Http = 'http', Sse = 'sse' }
export enum McpGatingMode { Prompt = 'prompt', AllowAll = 'allowAll', PerTool = 'perTool' }
export enum ValueSourceKind { Literal = 'literal', Env = 'env' }
export enum McpScope { Global = 'global', Project = 'project' }

// A secret-bearing value: either a stored literal or the NAME of an OS env var
// (the recommended form — the secret itself never lands in the JSON file).
export interface ValueSource { readonly kind: ValueSourceKind; readonly value: string }

export interface McpStdioTransport
{
    readonly kind: McpTransportKind.Stdio;
    readonly command: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, ValueSource>>;
}
export interface McpHttpTransport
{
    readonly kind: McpTransportKind.Http | McpTransportKind.Sse;
    readonly url: string;
    readonly headers: Readonly<Record<string, ValueSource>>;
}
export type McpTransport = McpStdioTransport | McpHttpTransport;

export interface McpGating { readonly mode: McpGatingMode; readonly tools: readonly string[] }

export interface McpServerEntry
{
    readonly key: string;       // unique within a scope; used in mcp__<key>__<tool>
    readonly label: string;
    readonly transport: McpTransport;
    readonly enabled: boolean;
    readonly gating: McpGating;
}

export interface McpProbeResult
{
    readonly ok: boolean;
    readonly toolCount?: number;
    readonly tools?: readonly string[];
    readonly error?: string;
}

// IPC channel names (renderer -> main via ipcRenderer.invoke).
export enum McpClientChannel
{
    ListGlobal       = 'mcp:list-global',
    SaveGlobal       = 'mcp:save-global',
    ListProject      = 'mcp:list-project',
    SaveProject      = 'mcp:save-project',
    Probe            = 'mcp:probe',
    ListTools        = 'mcp:list-tools',
    ImportCandidates = 'mcp:import-candidates',
}

// The renderer-facing bridge (exposed on window.api.mcp by the preload).
export interface IMcpClientApi
{
    listGlobal(): Promise<McpServerEntry[]>;
    saveGlobal(entries: McpServerEntry[]): Promise<void>;
    listProject(projectRoot: string): Promise<McpServerEntry[]>;
    saveProject(projectRoot: string, entries: McpServerEntry[]): Promise<void>;
    probe(entry: McpServerEntry): Promise<McpProbeResult>;
    listTools(entry: McpServerEntry): Promise<string[]>;
    importCandidates(projectRoot?: string): Promise<McpServerEntry[]>;
}
