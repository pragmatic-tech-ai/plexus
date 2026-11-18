import type { IpcMain } from 'electron'
import { RelayWire, TargetIdentity, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { UploadChannel, type ContributedPackage, type UploadContribution, type UploadEntry } from '../../shared/upload-api.js'
import { UploadPathGuard } from '@pragmatic-tech-ai/plexus-core/shared/upload-path-guard.js'
import type { UploadService } from './upload-service.js'

// Binds the upload IPC channel. The handler answers a RelayReply envelope so the failure sentence
// (and an account kind) reaches the renderer intact. Renderer arguments are checked before they
// reach the service: the target must be { Name, Source } with a known source, the solution name a
// non-empty string, the tree an array of entries with a string Path and string content fields, and
// the optional contribution { GraphName, SolutionId, Packages }.
export class UploadIpc
{
    private static readonly BadArguments = 'The upload request was malformed.'

    public static Register(ipc: IpcMain, service: Pick<UploadService, 'Upload'>): void
    {
        ipc.handle(UploadChannel.Upload, (_e, target: unknown, solutionName: unknown, tree: unknown, contribution: unknown) => RelayWire.Capture(async () =>
            service.Upload(UploadIpc.Target(target), UploadIpc.Name(solutionName), UploadIpc.Tree(tree), UploadIpc.Contribution(contribution))))
    }

    private static Target(value: unknown): TargetRef
    {
        const target = TargetIdentity.RefFrom(value)
        if (target === undefined) throw new TypeError(UploadIpc.BadArguments)
        return target
    }

    private static Name(value: unknown): string
    {
        if (typeof value !== 'string' || value.trim() === '') throw new TypeError(UploadIpc.BadArguments)
        return value.trim()
    }

    private static Tree(value: unknown): UploadEntry[]
    {
        if (!Array.isArray(value)) throw new TypeError(UploadIpc.BadArguments)
        return value.map((item) => UploadIpc.Entry(item))
    }

    // Each Path passes the same safety guard as the enumerator (this is the process trust boundary).
    // Only Path / Text / BytesBase64 are handed on; whether exactly one content field is set is the service's check.
    private static Entry(value: unknown): UploadEntry
    {
        if (typeof value !== 'object' || value === null) throw new TypeError(UploadIpc.BadArguments)
        const raw = value as Record<string, unknown>
        if (typeof raw.Path !== 'string' || raw.Path === '') throw new TypeError(UploadIpc.BadArguments)
        if (raw.Text !== undefined && typeof raw.Text !== 'string') throw new TypeError(UploadIpc.BadArguments)
        if (raw.BytesBase64 !== undefined && typeof raw.BytesBase64 !== 'string') throw new TypeError(UploadIpc.BadArguments)
        UploadPathGuard.Clean(raw.Path)
        const entry: UploadEntry = { Path: raw.Path }
        if (raw.Text !== undefined) entry.Text = raw.Text as string
        if (raw.BytesBase64 !== undefined) entry.BytesBase64 = raw.BytesBase64 as string
        return entry
    }

    private static Contribution(value: unknown): UploadContribution | undefined
    {
        if (value === undefined || value === null) return undefined
        if (typeof value !== 'object') throw new TypeError(UploadIpc.BadArguments)
        const raw = value as Record<string, unknown>
        if (!Array.isArray(raw.Packages)) throw new TypeError(UploadIpc.BadArguments)
        return { GraphName: UploadIpc.Name(raw.GraphName), SolutionId: UploadIpc.Name(raw.SolutionId), Packages: raw.Packages.map((p) => UploadIpc.Package(p)) }
    }

    private static Package(value: unknown): ContributedPackage
    {
        if (typeof value !== 'object' || value === null) throw new TypeError(UploadIpc.BadArguments)
        const raw = value as Record<string, unknown>
        if (typeof raw.id !== 'string' || typeof raw.version !== 'string' || typeof raw.modelJson !== 'string') throw new TypeError(UploadIpc.BadArguments)
        return { id: raw.id, version: raw.version, modelJson: raw.modelJson }
    }
}
