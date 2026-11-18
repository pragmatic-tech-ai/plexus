import type { StorageEntry } from '@pragmatic-tech-ai/todl-runtime'
import type { ActiveSolutionSummary, BuildStateChangedPayload, PublishDiagnosticsParams, SolutionGraphChangePayload, StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import { RelayWire, type TargetRef } from '../../../shared/account-api.js'
import type { IDevStorageSession } from '../storage/remote-file-storage.js'
import type { IDevSessionBridge } from './dev-session-bridge.js'
import type { DevSessionRequests, IDevSessionPushes } from './dev-session-surface.js'

// The renderer end of the held develop session: IDevStorageSession over the preload bridge. The relay
// connection and credentials stay in main; each call unwraps its RelayReply so a failure rejects with
// its sentence.
export class IpcDevSession implements IDevStorageSession, DevSessionRequests, IDevSessionPushes
{
    public constructor(private readonly bridge: IDevSessionBridge)
    {
    }

    public async Open(target: TargetRef): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.Open({ Name: target.Name, Source: target.Source }))
    }

    public async Close(): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.Close())
    }

    public async ReadText(path: string): Promise<string>
    {
        return RelayWire.Unwrap(await this.bridge.ReadText(path))
    }

    public async ReadBytes(path: string): Promise<Uint8Array>
    {
        return RelayWire.Unwrap(await this.bridge.ReadBytes(path))
    }

    public async WriteText(path: string, content: string): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.WriteText(path, content))
    }

    public async WriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.WriteBytes(path, bytes))
    }

    public async Exists(path: string): Promise<boolean>
    {
        return RelayWire.Unwrap(await this.bridge.Exists(path))
    }

    public async Delete(path: string): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.Delete(path))
    }

    public async CreateDirectory(path: string): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.CreateDirectory(path))
    }

    public async Rename(from: string, to: string): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.Rename(from, to))
    }

    public async List(path: string): Promise<readonly StorageEntry[]>
    {
        return RelayWire.Unwrap(await this.bridge.List(path))
    }

    public OnStorageChanged(handler: (change: StorageChangedPayload) => void): () => void
    {
        return this.bridge.OnChanged(handler)
    }

    public OnGraphChanged(handler: (change: SolutionGraphChangePayload) => void): () => void
    {
        return this.bridge.OnGraphChanged(handler)
    }

    public OnBuildStateChanged(handler: (payload: BuildStateChangedPayload) => void): () => void
    {
        return this.bridge.OnBuildStateChanged(handler)
    }

    public OnDiagnostics(handler: (params: PublishDiagnosticsParams) => void): () => void
    {
        return this.bridge.OnDiagnostics(handler)
    }

    public async SelectAuthoring(solutionId: string): Promise<ActiveSolutionSummary>
    {
        return RelayWire.Unwrap(await this.bridge.SelectAuthoring(solutionId))
    }

    public async ListSolutions(...args: Parameters<DevSessionRequests['ListSolutions']>): ReturnType<DevSessionRequests['ListSolutions']>
    {
        return RelayWire.Unwrap(await this.bridge.ListSolutions(...args))
    }

    public async ActiveSolution(...args: Parameters<DevSessionRequests['ActiveSolution']>): ReturnType<DevSessionRequests['ActiveSolution']>
    {
        return RelayWire.Unwrap(await this.bridge.ActiveSolution(...args))
    }

    public async CompletionsAt(...args: Parameters<DevSessionRequests['CompletionsAt']>): ReturnType<DevSessionRequests['CompletionsAt']>
    {
        return RelayWire.Unwrap(await this.bridge.CompletionsAt(...args))
    }

    public async HoverAt(...args: Parameters<DevSessionRequests['HoverAt']>): ReturnType<DevSessionRequests['HoverAt']>
    {
        return RelayWire.Unwrap(await this.bridge.HoverAt(...args))
    }

    public async DefinitionAt(...args: Parameters<DevSessionRequests['DefinitionAt']>): ReturnType<DevSessionRequests['DefinitionAt']>
    {
        return RelayWire.Unwrap(await this.bridge.DefinitionAt(...args))
    }

    public async ReferencesAt(...args: Parameters<DevSessionRequests['ReferencesAt']>): ReturnType<DevSessionRequests['ReferencesAt']>
    {
        return RelayWire.Unwrap(await this.bridge.ReferencesAt(...args))
    }

    public async PrepareRename(...args: Parameters<DevSessionRequests['PrepareRename']>): ReturnType<DevSessionRequests['PrepareRename']>
    {
        return RelayWire.Unwrap(await this.bridge.PrepareRename(...args))
    }

    public async RenameEdits(...args: Parameters<DevSessionRequests['RenameEdits']>): ReturnType<DevSessionRequests['RenameEdits']>
    {
        return RelayWire.Unwrap(await this.bridge.RenameEdits(...args))
    }

    public async DocumentSymbols(...args: Parameters<DevSessionRequests['DocumentSymbols']>): ReturnType<DevSessionRequests['DocumentSymbols']>
    {
        return RelayWire.Unwrap(await this.bridge.DocumentSymbols(...args))
    }

    public async FoldingRanges(...args: Parameters<DevSessionRequests['FoldingRanges']>): ReturnType<DevSessionRequests['FoldingRanges']>
    {
        return RelayWire.Unwrap(await this.bridge.FoldingRanges(...args))
    }

    public async WorkspaceSymbols(...args: Parameters<DevSessionRequests['WorkspaceSymbols']>): ReturnType<DevSessionRequests['WorkspaceSymbols']>
    {
        return RelayWire.Unwrap(await this.bridge.WorkspaceSymbols(...args))
    }

    public async SemanticTokens(...args: Parameters<DevSessionRequests['SemanticTokens']>): ReturnType<DevSessionRequests['SemanticTokens']>
    {
        return RelayWire.Unwrap(await this.bridge.SemanticTokens(...args))
    }

    public async SignatureHelpAt(...args: Parameters<DevSessionRequests['SignatureHelpAt']>): ReturnType<DevSessionRequests['SignatureHelpAt']>
    {
        return RelayWire.Unwrap(await this.bridge.SignatureHelpAt(...args))
    }

    public async CodeActions(...args: Parameters<DevSessionRequests['CodeActions']>): ReturnType<DevSessionRequests['CodeActions']>
    {
        return RelayWire.Unwrap(await this.bridge.CodeActions(...args))
    }

    public async FormatDocument(...args: Parameters<DevSessionRequests['FormatDocument']>): ReturnType<DevSessionRequests['FormatDocument']>
    {
        return RelayWire.Unwrap(await this.bridge.FormatDocument(...args))
    }

    public async DiagnosticsFor(...args: Parameters<DevSessionRequests['DiagnosticsFor']>): ReturnType<DevSessionRequests['DiagnosticsFor']>
    {
        return RelayWire.Unwrap(await this.bridge.DiagnosticsFor(...args))
    }

    public async ModelView(...args: Parameters<DevSessionRequests['ModelView']>): ReturnType<DevSessionRequests['ModelView']>
    {
        return RelayWire.Unwrap(await this.bridge.ModelView(...args))
    }

    public async Resources(...args: Parameters<DevSessionRequests['Resources']>): ReturnType<DevSessionRequests['Resources']>
    {
        return RelayWire.Unwrap(await this.bridge.Resources(...args))
    }

    public async DidChange(...args: Parameters<DevSessionRequests['DidChange']>): ReturnType<DevSessionRequests['DidChange']>
    {
        return RelayWire.Unwrap(await this.bridge.DidChange(...args))
    }
}
