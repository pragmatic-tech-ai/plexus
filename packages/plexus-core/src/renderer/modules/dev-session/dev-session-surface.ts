import type { PragmaticClient, ActiveSolutionSummary, BuildStateChangedPayload, PublishDiagnosticsParams, SolutionGraphChangePayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { RelayReply } from '../../../shared/account-api.js'

// The held develop session's language / model / solution requests: the PragmaticClient methods the
// environment's solution services are driven through, named and typed by the client itself.
type RelayedRequest = 'ListSolutions'
    | 'ActiveSolution'
    | 'CompletionsAt'
    | 'HoverAt'
    | 'DefinitionAt'
    | 'ReferencesAt'
    | 'PrepareRename'
    | 'RenameEdits'
    | 'DocumentSymbols'
    | 'FoldingRanges'
    | 'WorkspaceSymbols'
    | 'SemanticTokens'
    | 'SignatureHelpAt'
    | 'CodeActions'
    | 'FormatDocument'
    | 'DiagnosticsFor'
    | 'ModelView'
    | 'Resources'
    | 'DidChange'

type RequestResult<K extends RelayedRequest> = Awaited<ReturnType<PragmaticClient[K]>>

// What a Remote solution-services proxy calls. DidChange is a fire-and-forget notification (it resolves
// once handed to the relay); SelectAuthoring takes the solution id rather than the wire params.
export type DevSessionRequests = {
    [K in RelayedRequest]: (...args: Parameters<PragmaticClient[K]>) => Promise<RequestResult<K>>
} & {
    SelectAuthoring(solutionId: string): Promise<ActiveSolutionSummary>;
}

// The same requests as the preload bridge exposes them: each call answers its RelayReply envelope.
export type DevSessionReplies = {
    [K in RelayedRequest]: (...args: Parameters<PragmaticClient[K]>) => Promise<RelayReply<RequestResult<K>>>
} & {
    SelectAuthoring(solutionId: string): Promise<RelayReply<ActiveSolutionSummary>>;
}

// Server-to-client pushes of the held session; each subscription returns its disposer.
export interface IDevSessionPushes
{
    OnGraphChanged(handler: (change: SolutionGraphChangePayload) => void): () => void;
    OnBuildStateChanged(handler: (payload: BuildStateChangedPayload) => void): () => void;
    OnDiagnostics(handler: (params: PublishDiagnosticsParams) => void): () => void;
}
