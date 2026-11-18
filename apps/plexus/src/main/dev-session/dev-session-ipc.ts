import type { IpcMain } from 'electron'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { RelayWire, TargetIdentity, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DevSessionChannel } from '../../shared/dev-session-api.js'
import type { DevSessionHost } from './dev-session-host.js'

// The slice of a renderer's WebContents the Changed push needs (Electron's WebContents satisfies it).
export interface IDevSessionChangeSink
{
    send(channel: string, ...args: unknown[]): void;
    isDestroyed(): boolean;
}

// Binds the develop-session IPC channels. Every handler answers a RelayReply envelope so the failure
// sentence reaches the renderer intact; renderer arguments are checked before they reach the session.
// The session's storage changes are pushed to every renderer on DevSessionChannel.Changed.
export class DevSessionIpc
{
    private static readonly BadArguments = 'The development session request was malformed.'
    private static readonly PushFailedLog = '[dev-session] could not push a change to a window:'

    public static Register(ipc: IpcMain, host: DevSessionHost, renderers: () => readonly IDevSessionChangeSink[]): IDisposable
    {
        ipc.handle(DevSessionChannel.Open, async (_e, target: unknown) => RelayWire.Capture(async () => host.Open(DevSessionIpc.Target(target))))
        ipc.handle(DevSessionChannel.Close, async () => RelayWire.Capture(async () => host.Close()))
        ipc.handle(DevSessionChannel.ReadText, (_e, path: unknown) => RelayWire.Capture(async () => host.Session.ReadText(DevSessionIpc.Text(path))))
        ipc.handle(DevSessionChannel.ReadBytes, (_e, path: unknown) => RelayWire.Capture(async () => host.Session.ReadBytes(DevSessionIpc.Text(path))))
        ipc.handle(DevSessionChannel.WriteText, (_e, path: unknown, content: unknown) => RelayWire.Capture(async () =>
            host.Session.WriteText(DevSessionIpc.Text(path), DevSessionIpc.Text(content))))
        ipc.handle(DevSessionChannel.WriteBytes, (_e, path: unknown, bytes: unknown) => RelayWire.Capture(async () =>
            host.Session.WriteBytes(DevSessionIpc.Text(path), DevSessionIpc.Bytes(bytes))))
        ipc.handle(DevSessionChannel.Exists, (_e, path: unknown) => RelayWire.Capture(async () => host.Session.Exists(DevSessionIpc.Text(path))))
        ipc.handle(DevSessionChannel.Delete, (_e, path: unknown) => RelayWire.Capture(async () => host.Session.Delete(DevSessionIpc.Text(path))))
        ipc.handle(DevSessionChannel.CreateDirectory, (_e, path: unknown) => RelayWire.Capture(async () => host.Session.CreateDirectory(DevSessionIpc.Text(path))))
        ipc.handle(DevSessionChannel.Rename, (_e, from: unknown, to: unknown) => RelayWire.Capture(async () =>
            host.Session.Rename(DevSessionIpc.Text(from), DevSessionIpc.Text(to))))
        ipc.handle(DevSessionChannel.List, (_e, path: unknown) => RelayWire.Capture(async () => [...await host.Session.List(DevSessionIpc.Text(path))]))
        ipc.handle(DevSessionChannel.SelectAuthoring, (_e, solutionId: unknown) => RelayWire.Capture(async () => host.Session.SelectAuthoring(DevSessionIpc.Text(solutionId))))
        ipc.handle(DevSessionChannel.ListSolutions, (_e) => RelayWire.Capture(async () => host.Session.ListSolutions()))
        ipc.handle(DevSessionChannel.ActiveSolution, (_e) => RelayWire.Capture(async () => host.Session.ActiveSolution()))
        ipc.handle(DevSessionChannel.CompletionsAt, (_e, uri: unknown, position: unknown) => RelayWire.Capture(async () => host.Session.CompletionsAt(DevSessionIpc.Text(uri), DevSessionIpc.Obj(position))))
        ipc.handle(DevSessionChannel.HoverAt, (_e, uri: unknown, position: unknown) => RelayWire.Capture(async () => host.Session.HoverAt(DevSessionIpc.Text(uri), DevSessionIpc.Obj(position))))
        ipc.handle(DevSessionChannel.DefinitionAt, (_e, uri: unknown, position: unknown) => RelayWire.Capture(async () => host.Session.DefinitionAt(DevSessionIpc.Text(uri), DevSessionIpc.Obj(position))))
        ipc.handle(DevSessionChannel.ReferencesAt, (_e, uri: unknown, position: unknown, includeDeclaration: unknown) => RelayWire.Capture(async () => host.Session.ReferencesAt(DevSessionIpc.Text(uri), DevSessionIpc.Obj(position), DevSessionIpc.Flag(includeDeclaration))))
        ipc.handle(DevSessionChannel.PrepareRename, (_e, uri: unknown, position: unknown) => RelayWire.Capture(async () => host.Session.PrepareRename(DevSessionIpc.Text(uri), DevSessionIpc.Obj(position))))
        ipc.handle(DevSessionChannel.RenameEdits, (_e, uri: unknown, position: unknown, newName: unknown) => RelayWire.Capture(async () => host.Session.RenameEdits(DevSessionIpc.Text(uri), DevSessionIpc.Obj(position), DevSessionIpc.Text(newName))))
        ipc.handle(DevSessionChannel.DocumentSymbols, (_e, uri: unknown) => RelayWire.Capture(async () => host.Session.DocumentSymbols(DevSessionIpc.Text(uri))))
        ipc.handle(DevSessionChannel.FoldingRanges, (_e, uri: unknown) => RelayWire.Capture(async () => host.Session.FoldingRanges(DevSessionIpc.Text(uri))))
        ipc.handle(DevSessionChannel.WorkspaceSymbols, (_e, query: unknown) => RelayWire.Capture(async () => host.Session.WorkspaceSymbols(DevSessionIpc.Text(query))))
        ipc.handle(DevSessionChannel.SemanticTokens, (_e, uri: unknown) => RelayWire.Capture(async () => host.Session.SemanticTokens(DevSessionIpc.Text(uri))))
        ipc.handle(DevSessionChannel.SignatureHelpAt, (_e, uri: unknown, position: unknown) => RelayWire.Capture(async () => host.Session.SignatureHelpAt(DevSessionIpc.Text(uri), DevSessionIpc.Obj(position))))
        ipc.handle(DevSessionChannel.CodeActions, (_e, uri: unknown, range: unknown, diagnostics: unknown) => RelayWire.Capture(async () => host.Session.CodeActions(DevSessionIpc.Text(uri), DevSessionIpc.Obj(range), DevSessionIpc.List(diagnostics))))
        ipc.handle(DevSessionChannel.FormatDocument, (_e, uri: unknown) => RelayWire.Capture(async () => host.Session.FormatDocument(DevSessionIpc.Text(uri))))
        ipc.handle(DevSessionChannel.DiagnosticsFor, (_e, uri: unknown) => RelayWire.Capture(async () => host.Session.DiagnosticsFor(DevSessionIpc.Text(uri))))
        ipc.handle(DevSessionChannel.ModelView, (_e, memberId: unknown, page: unknown) => RelayWire.Capture(async () => host.Session.ModelView(DevSessionIpc.Text(memberId), DevSessionIpc.OptionalObj(page))))
        ipc.handle(DevSessionChannel.Resources, (_e, nodeId: unknown) => RelayWire.Capture(async () => host.Session.Resources(DevSessionIpc.Text(nodeId))))
        ipc.handle(DevSessionChannel.DidChange, (_e, uri: unknown, text: unknown) => RelayWire.Capture(async () => host.Session.DidChange(DevSessionIpc.Text(uri), DevSessionIpc.Text(text))))
        const offs = [
            host.OnChanged(change => DevSessionIpc.Push(renderers(), DevSessionChannel.Changed, change)),
            host.OnGraphChanged(change => DevSessionIpc.Push(renderers(), DevSessionChannel.GraphChanged, change)),
            host.OnBuildStateChanged(payload => DevSessionIpc.Push(renderers(), DevSessionChannel.BuildStateChanged, payload)),
            host.OnDiagnostics(params => DevSessionIpc.Push(renderers(), DevSessionChannel.Diagnostics, params)),
        ]
        return { dispose: () => { for (const off of offs) off() } }
    }

    private static Push(sinks: readonly IDevSessionChangeSink[], channel: DevSessionChannel, payload: unknown): void
    {
        for (const renderer of sinks)
        {
            // One window failing (closing mid-push) must not fail the change that raised it.
            try
            {
                if (!renderer.isDestroyed()) renderer.send(channel, payload)
            }
            catch (e)
            {
                console.error(DevSessionIpc.PushFailedLog, e instanceof Error ? e.name : typeof e)
            }
        }
    }

    private static Target(value: unknown): TargetRef
    {
        const target = TargetIdentity.RefFrom(value)
        if (target === undefined) throw new TypeError(DevSessionIpc.BadArguments)
        return target
    }

    private static Text(value: unknown): string
    {
        if (typeof value !== 'string') throw new TypeError(DevSessionIpc.BadArguments)
        return value
    }

    private static Flag(value: unknown): boolean
    {
        if (typeof value !== 'boolean') throw new TypeError(DevSessionIpc.BadArguments)
        return value
    }

    // A structured argument (a position, a range, a page): its fields belong to the server to judge.
    private static Obj<T>(value: unknown): T
    {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(DevSessionIpc.BadArguments)
        return value as T
    }

    private static OptionalObj<T>(value: unknown): T | undefined
    {
        return value === undefined || value === null ? undefined : DevSessionIpc.Obj<T>(value)
    }

    private static List<T>(value: unknown): T[]
    {
        if (!Array.isArray(value)) throw new TypeError(DevSessionIpc.BadArguments)
        return value as T[]
    }

    private static Bytes(value: unknown): Uint8Array
    {
        if (!(value instanceof Uint8Array)) throw new TypeError(DevSessionIpc.BadArguments)
        return value
    }
}
