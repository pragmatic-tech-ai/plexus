import { describe, expect, it } from 'vitest'
import type { Position } from 'vscode-languageserver-types'
import type { PublishDiagnosticsParams, StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import { RemoteLanguageService, type IRemoteLanguageSession, type ILocalBaseResolution, type IRemoteMemberIds } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-seams/remote/remote-language-service.js'
import { RemoteFileStorage } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/remote-file-storage.js'
import { RemoteChangeCoordinator, type ITrackedDocument } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/remote-change-coordinator.js'
import { IncomingApplyResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/incoming-apply-result.js'

// Remote LSP + live collaboration over one mock dev session. Real: RemoteLanguageService,
// RemoteFileStorage (its Watch), RemoteChangeCoordinator and its IncomingChangeGuard. Mocked: the
// held session (records LSP calls, answers canned results, pushes diagnostics / storage changes)
// and the open buffer (FakeDoc). No Electron, no socket.

class Fixture
{
    public static readonly Uri = 'file:///orders/app/model.todl'
    public static readonly Path = 'app/model.todl'
    public static readonly OtherPath = 'app/other.todl'
    public static readonly Root = 'orders'
    public static readonly PushedMessage = 'pushed problem'
    public static readonly PulledMessage = 'pulled problem'
    public static readonly CompletionLabel = 'EntityB'
    public static readonly ServerText = 'entity A; entity B;'
    public static readonly LocalText = 'entity A;'
    public static readonly DirtyText = 'entity A; local edit'
    public static readonly Position: Position = { line: 3, character: 7 }
    public static readonly CompletionsMethod = 'CompletionsAt'
    public static readonly DiagnosticsMethod = 'DiagnosticsFor'
    public static readonly ChangedKind = 'changed'
}

class MockSession
{
    public readonly Calls: Array<{ Method: string; Args: unknown[] }> = []
    public readonly Pulled = [{ message: Fixture.PulledMessage }]
    private readonly diagnostics: Array<(p: PublishDiagnosticsParams) => void> = []
    private readonly storage: Array<(c: StorageChangedPayload) => void> = []

    public async CompletionsAt(...args: unknown[]): Promise<unknown>
    {
        this.Calls.push({ Method: Fixture.CompletionsMethod, Args: args })
        return [{ label: Fixture.CompletionLabel }]
    }

    public async DiagnosticsFor(...args: unknown[]): Promise<unknown>
    {
        this.Calls.push({ Method: Fixture.DiagnosticsMethod, Args: args })
        return this.Pulled
    }

    public async ActiveSolution(): Promise<null> { return null }
    public OnGraphChanged(): () => void { return () => undefined }
    public OnBuildStateChanged(): () => void { return () => undefined }

    public OnDiagnostics(handler: (p: PublishDiagnosticsParams) => void): () => void
    {
        this.diagnostics.push(handler)
        return () => { this.diagnostics.splice(this.diagnostics.indexOf(handler), 1) }
    }

    public OnStorageChanged(handler: (c: StorageChangedPayload) => void): () => void
    {
        this.storage.push(handler)
        return () => { this.storage.splice(this.storage.indexOf(handler), 1) }
    }

    public PushDiagnostics(params: PublishDiagnosticsParams): void
    {
        for (const h of [...this.diagnostics]) h(params)
    }

    public PushStorageChanged(path: string): void
    {
        for (const h of [...this.storage]) h({ Path: path, Kind: Fixture.ChangedKind, IsDirectory: false } as StorageChangedPayload)
    }

    public AsSession(): IRemoteLanguageSession { return this as unknown as IRemoteLanguageSession }
}

class FakeDoc implements ITrackedDocument
{
    public IsDirty = false
    public Content = Fixture.LocalText
    public Reloads = 0
    public Marker = false
    public ServerText = Fixture.ServerText
    // The in-flight ApplyIncoming, so tests await it deterministically instead of a timer.
    public LastApply: Promise<IncomingApplyResult> | undefined
    private saved = Fixture.LocalText

    public ApplyIncoming(): Promise<IncomingApplyResult>
    {
        this.LastApply = this.Apply()
        return this.LastApply
    }

    private async Apply(): Promise<IncomingApplyResult>
    {
        await Promise.resolve()
        if (this.ServerText === this.saved) return IncomingApplyResult.Unchanged
        if (this.IsDirty) return IncomingApplyResult.DirtySkipped
        this.Reloads++
        this.Content = this.ServerText
        this.saved = this.ServerText
        return IncomingApplyResult.Applied
    }

    public async Save(): Promise<void>
    {
        this.IsDirty = false
        this.saved = this.Content
    }

    public SetChangedOnServer(flag: boolean): void { this.Marker = flag }
}

class Rig
{
    public readonly Session = new MockSession()
    public readonly Language: RemoteLanguageService
    public readonly Storage = new RemoteFileStorage(this.Session.AsSession(), Fixture.Root)
    public readonly Coordinator = new RemoteChangeCoordinator()
    public readonly Doc = new FakeDoc()
    public readonly Raised: string[] = []

    public constructor()
    {
        const local = { StaleMembers: new Set<string>() } as unknown as ILocalBaseResolution
        const members = { MemberIdOf: () => undefined, StorageOfMember: () => undefined } as IRemoteMemberIds
        this.Language = new RemoteLanguageService(this.Session.AsSession(), local, members)
        this.Coordinator.PropertyChanged(RemoteChangeCoordinator.ChangedOnServerPathsProp).subscribe(e => this.Raised.push(e.property))
        this.Coordinator.Track(this.Storage, Fixture.Path, this.Doc)
    }

    // Awaits the doc's in-flight ApplyIncoming, then one microtask so the coordinator's continuation
    // (registered before ours) has run. No timers.
    public async Settle(): Promise<void>
    {
        await this.Doc.LastApply
        await Promise.resolve()
    }
}

describe('remote LSP over the dev session', () =>
{
    it('forwards CompletionsAt params to the session and returns its result', async () =>
    {
        const rig = new Rig()
        const result = await rig.Language.CompletionsAt(Fixture.Uri, Fixture.Position)
        expect(rig.Session.Calls).toEqual([{ Method: Fixture.CompletionsMethod, Args: [Fixture.Uri, Fixture.Position] }])
        expect(result).toEqual([{ label: Fixture.CompletionLabel }])
    })

    it('DiagnosticsFor pulls from the session and refreshes the cache', async () =>
    {
        const rig = new Rig()
        expect(rig.Language.CachedDiagnostics(Fixture.Uri)).toBeUndefined()
        const result = await rig.Language.DiagnosticsFor(Fixture.Uri)
        expect(rig.Session.Calls).toEqual([{ Method: Fixture.DiagnosticsMethod, Args: [Fixture.Uri] }])
        expect(result).toEqual(rig.Session.Pulled)
        expect(rig.Language.CachedDiagnostics(Fixture.Uri)).toEqual(rig.Session.Pulled)
    })

    it('an OnDiagnostics push updates the cache and raises DiagnosticsPublished', () =>
    {
        const rig = new Rig()
        const seen: PublishDiagnosticsParams[] = []
        rig.Language.DiagnosticsPublished.subscribe(p => seen.push(p))
        const params = { uri: Fixture.Uri, diagnostics: [{ message: Fixture.PushedMessage }] } as unknown as PublishDiagnosticsParams
        rig.Session.PushDiagnostics(params)
        expect(rig.Language.CachedDiagnostics(Fixture.Uri)).toEqual(params.diagnostics)
        expect(seen).toEqual([params])
    })
})

describe('live collaboration: incoming storage/changed through the coordinator and guard', () =>
{
    // Scope: this proves the coordinator's flag / marker / event / LWW path. The buffer-write prevention
    // itself (ApplyIncoming never overwriting a dirty buffer) is pinned by Task 10's CodeDocument test;
    // FakeDoc only reports the decision.
    it('a clean buffer (Applied) reloads the server content and the flag stays clear', async () =>
    {
        const rig = new Rig()
        rig.Session.PushStorageChanged(Fixture.Path)
        await rig.Settle()
        expect(rig.Doc.Reloads).toBe(1)
        expect(rig.Doc.Content).toBe(Fixture.ServerText)
        expect(rig.Coordinator.IsChangedOnServer(Fixture.Path)).toBe(false)
        expect(rig.Raised).toEqual([])
    })

    it('a dirty buffer is never clobbered; the path is flagged reactively; a local save clears it', async () =>
    {
        const rig = new Rig()
        rig.Doc.IsDirty = true
        rig.Doc.Content = Fixture.DirtyText
        rig.Session.PushStorageChanged(Fixture.Path)
        await rig.Settle()
        expect(rig.Doc.Reloads).toBe(0)
        expect(rig.Doc.Content).toBe(Fixture.DirtyText)
        expect(rig.Coordinator.IsChangedOnServer(Fixture.Path)).toBe(true)
        expect(rig.Doc.Marker).toBe(true)
        expect(rig.Raised).toEqual([RemoteChangeCoordinator.ChangedOnServerPathsProp])

        await rig.Doc.Save()
        expect(rig.Coordinator.IsChangedOnServer(Fixture.Path)).toBe(false)
        expect(rig.Doc.Marker).toBe(false)
        expect(rig.Doc.Content).toBe(Fixture.DirtyText)
        expect(rig.Raised).toHaveLength(2)
    })

    it('ignores a change to a different file', async () =>
    {
        const rig = new Rig()
        rig.Session.PushStorageChanged(Fixture.OtherPath)
        await rig.Settle()
        expect(rig.Doc.Reloads).toBe(0)
    })
})
