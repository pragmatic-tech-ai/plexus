// Wire contract for the held develop session: the renderer<->main IPC channel names. The bridge shape
// (exposed on window.api.devSession by the preload) is IDevSessionBridge, declared in plexus-core next
// to the renderer IpcDevSession that consumes it. Calls run on the session main holds open for the
// target; no credential crosses the bridge.
import type { IDevSessionBridge } from '@pragmatic-tech-ai/plexus-core/renderer/modules/dev-session'

export type { IDevSessionBridge }

export enum DevSessionChannel
{
    Open = 'dev-session:open',
    Close = 'dev-session:close',
    ReadText = 'dev-session:read-text',
    ReadBytes = 'dev-session:read-bytes',
    WriteText = 'dev-session:write-text',
    WriteBytes = 'dev-session:write-bytes',
    Exists = 'dev-session:exists',
    Delete = 'dev-session:delete',
    CreateDirectory = 'dev-session:create-directory',
    Rename = 'dev-session:rename',
    List = 'dev-session:list',
    // Pushed main to renderer for every storage change the held session reports.
    Changed = 'dev-session:changed',
    // Pushed main to renderer for every solution-graph, build-state and diagnostics push of the held session.
    GraphChanged = 'dev-session:graph-changed',
    BuildStateChanged = 'dev-session:build-state-changed',
    Diagnostics = 'dev-session:diagnostics',
    // Language / model / solution requests answered by the held session.
    SelectAuthoring = 'dev-session:select-authoring',
    ListSolutions = 'dev-session:list-solutions',
    ActiveSolution = 'dev-session:active-solution',
    CompletionsAt = 'dev-session:completions-at',
    HoverAt = 'dev-session:hover-at',
    DefinitionAt = 'dev-session:definition-at',
    ReferencesAt = 'dev-session:references-at',
    PrepareRename = 'dev-session:prepare-rename',
    RenameEdits = 'dev-session:rename-edits',
    DocumentSymbols = 'dev-session:document-symbols',
    FoldingRanges = 'dev-session:folding-ranges',
    WorkspaceSymbols = 'dev-session:workspace-symbols',
    SemanticTokens = 'dev-session:semantic-tokens',
    SignatureHelpAt = 'dev-session:signature-help-at',
    CodeActions = 'dev-session:code-actions',
    FormatDocument = 'dev-session:format-document',
    DiagnosticsFor = 'dev-session:diagnostics-for',
    ModelView = 'dev-session:model-view',
    Resources = 'dev-session:resources',
    DidChange = 'dev-session:did-change',
}
