import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { Observable, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    Solution, SolutionManagerService, SolutionMemberStatus, ProjectEvents, ProjectEventsKey, ProjectEventKind, type SolutionMember,
} from '@pragmatic-tech-ai/todl'
import { LiveValidationKey, type ILiveValidation } from '../../../../projects/capabilities/live-validation.js'
import { TypeScriptWorkspaceSinkKey, TypeScriptDiagnosticsSinkKey } from '../../../../typescript/typescript-seams.js'
import { LiveValidationSync } from '../live-validation-sync.js'

class FakeManager extends Observable
{
    private active: Solution | undefined

    public get ActiveSolution(): Solution | undefined { return this.active }

    public Swap(next: Solution | undefined): void
    {
        const old = this.active
        this.active = next
        this.RaisePropertyChanged('ActiveSolution', old, next)
    }
}

class FakeValidation implements ILiveValidation
{
    public readonly calls: string[] = []

    public async AttachProject(projectId: string, projectName: string, storage: IStorage): Promise<void>
    {
        this.calls.push(`attach:${projectId}:${projectName}:${(storage as unknown as { Tag: string }).Tag}`)
    }

    public DetachProject(storage: IStorage): void
    {
        this.calls.push(`detach:${(storage as unknown as { Tag: string }).Tag}`)
    }

    public async ResyncProject(projectId: string, storage: IStorage): Promise<void>
    {
        this.calls.push(`resync:${projectId}:${(storage as unknown as { Tag: string }).Tag}`)
    }

    public async RefreshBases(storage: IStorage): Promise<void>
    {
        this.calls.push(`refresh:${(storage as unknown as { Tag: string }).Tag}`)
    }
}

class FakeTsSink
{
    public readonly calls: string[] = []

    public async AttachProject(id: string, name: string, storage: IStorage): Promise<void>
    {
        this.calls.push(`ws-attach:${id}:${name}:${(storage as unknown as { Tag: string }).Tag}`)
    }

    public DetachProject(id: string): void { this.calls.push(`ws-detach:${id}`) }
    public TrackProject(id: string, name: string): void { this.calls.push(`diag-track:${id}:${name}`) }
    public UntrackProject(id: string): void { this.calls.push(`diag-untrack:${id}`) }
}

class Harness
{
    public readonly manager = new FakeManager()
    public readonly validation = new FakeValidation()
    public readonly events = new ProjectEvents()
    public readonly tsSink = new FakeTsSink()
    public readonly sync: LiveValidationSync

    constructor()
    {
        const provider = new ServiceProvider()
        provider.registerInstance(SolutionManagerService.Key, this.manager as unknown as SolutionManagerService)
        provider.registerInstance(LiveValidationKey, this.validation)
        provider.registerInstance(ProjectEventsKey, this.events)
        provider.registerInstance(TypeScriptWorkspaceSinkKey, this.tsSink as never)
        provider.registerInstance(TypeScriptDiagnosticsSinkKey, this.tsSink as never)
        this.sync = new LiveValidationSync(provider)
    }

    public static Storage(tag: string): IStorage
    {
        return { Tag: tag } as unknown as IStorage
    }

    public static Resolve(member: SolutionMember, tag: string): IStorage
    {
        const storage = Harness.Storage(tag)
        member.Storage = storage
        member.Project = { RootPath: `/${tag}`, Name: tag.toUpperCase() }
        member.Status = SolutionMemberStatus.Resolved
        return storage
    }
}

describe('LiveValidationSync', () =>
{
    it('attaches an already-resolved member present at Start', () =>
    {
        const h = new Harness()
        const sol = new Solution('S')
        Harness.Resolve(sol.AddMember('./a', 'architecture'), 'a')
        h.manager.Swap(sol)
        h.sync.Start()
        expect(h.validation.calls).toEqual(['attach:/a:A:a'])
    })

    it('attaches on member add (after resolution) and detaches on remove', () =>
    {
        const h = new Harness()
        const sol = new Solution('S')
        h.manager.Swap(sol)
        h.sync.Start()
        const member = sol.AddMember('./a', 'architecture')
        expect(h.validation.calls).toEqual([])   // unresolved: waits
        Harness.Resolve(member, 'a')
        expect(h.validation.calls).toEqual(['attach:/a:A:a'])
        sol.RemoveMember(member)
        expect(h.validation.calls).toEqual(['attach:/a:A:a', 'detach:a'])
    })

    it('drives the TypeScript workspace and diagnostics sinks on attach and detach', () =>
    {
        const h = new Harness()
        const sol = new Solution('S')
        h.manager.Swap(sol)
        h.sync.Start()
        const member = sol.AddMember('./a', 'architecture')
        expect(h.tsSink.calls).toEqual([])
        Harness.Resolve(member, 'a')
        expect(h.tsSink.calls).toEqual(['ws-attach:/a:A:a', 'diag-track:/a:A'])
        sol.RemoveMember(member)
        expect(h.tsSink.calls).toEqual(['ws-attach:/a:A:a', 'diag-track:/a:A', 'ws-detach:/a', 'diag-untrack:/a'])
    })

    it('never attaches a member removed before it resolved', () =>
    {
        const h = new Harness()
        const sol = new Solution('S')
        h.manager.Swap(sol)
        h.sync.Start()
        const member = sol.AddMember('./a', 'architecture')
        sol.RemoveMember(member)
        Harness.Resolve(member, 'a')
        expect(h.validation.calls).toEqual([])
    })

    it('ReferencesChanged for a tracked storage triggers RefreshBases (others ignored)', async () =>
    {
        const h = new Harness()
        const sol = new Solution('S')
        const storage = Harness.Resolve(sol.AddMember('./a', 'architecture'), 'a')
        h.manager.Swap(sol)
        h.sync.Start()
        h.validation.calls.length = 0
        const manifest = {} as never
        await h.events.Raise({ Kind: ProjectEventKind.ReferencesChanged, ProjectType: 'architecture', Project: storage, Manifest: manifest })
        await h.events.Raise({ Kind: ProjectEventKind.ReferencesChanged, ProjectType: 'architecture', Project: Harness.Storage('zzz'), Manifest: manifest })
        await h.events.Raise({ Kind: ProjectEventKind.Saved, ProjectType: 'architecture', Project: storage, Manifest: manifest })
        expect(h.validation.calls).toEqual(['refresh:a'])
    })

    it('switching ActiveSolution detaches the old members and attaches the new', () =>
    {
        const h = new Harness()
        const first = new Solution('One')
        Harness.Resolve(first.AddMember('./a', 'architecture'), 'a')
        h.manager.Swap(first)
        h.sync.Start()
        const second = new Solution('Two')
        Harness.Resolve(second.AddMember('./b', 'architecture'), 'b')
        h.manager.Swap(second)
        expect(h.validation.calls).toEqual(['attach:/a:A:a', 'detach:a', 'attach:/b:B:b'])
        // The old solution's Members no longer drive validation.
        Harness.Resolve(first.AddMember('./c', 'architecture'), 'c')
        expect(h.validation.calls).toHaveLength(3)
        // Clearing the solution detaches the last members.
        h.manager.Swap(undefined)
        expect(h.validation.calls.at(-1)).toBe('detach:b')
    })

    it('ResyncMember resyncs an attached member only', () =>
    {
        const h = new Harness()
        const sol = new Solution('S')
        const member = sol.AddMember('./a', 'architecture')
        Harness.Resolve(member, 'a')
        h.manager.Swap(sol)
        h.sync.Start()
        h.sync.ResyncMember(member)
        h.sync.ResyncMember(new Solution('X').AddMember('./x', 'architecture'))
        expect(h.validation.calls).toEqual(['attach:/a:A:a', 'resync:/a:a'])
    })

    it('a cleared collection detaches all attached members', () =>
    {
        const h = new Harness()
        const sol = new Solution('S')
        Harness.Resolve(sol.AddMember('./a', 'architecture'), 'a')
        Harness.Resolve(sol.AddMember('./b', 'architecture'), 'b')
        h.manager.Swap(sol)
        h.sync.Start()
        h.validation.calls.length = 0
        sol.Members.Clear()
        expect(h.validation.calls).toEqual(['detach:a', 'detach:b'])
    })

    it('follows Status both ways: LoadFailed then Resolved attaches; Resolved then LoadFailed detaches', () =>
    {
        const h = new Harness()
        const sol = new Solution('S')
        h.manager.Swap(sol)
        h.sync.Start()
        const member = sol.AddMember('./a', 'architecture')
        member.Status = SolutionMemberStatus.LoadFailed
        expect(h.validation.calls).toEqual([])
        Harness.Resolve(member, 'a')
        expect(h.validation.calls).toEqual(['attach:/a:A:a'])
        member.Status = SolutionMemberStatus.LoadFailed
        expect(h.validation.calls).toEqual(['attach:/a:A:a', 'detach:a'])
        member.Status = SolutionMemberStatus.Resolved
        expect(h.validation.calls).toEqual(['attach:/a:A:a', 'detach:a', 'attach:/a:A:a'])
    })

    it('dispose detaches everything and stops reacting', async () =>
    {
        const h = new Harness()
        const sol = new Solution('S')
        const storage = Harness.Resolve(sol.AddMember('./a', 'architecture'), 'a')
        h.manager.Swap(sol)
        h.sync.Start()
        h.sync.dispose()
        expect(h.validation.calls).toEqual(['attach:/a:A:a', 'detach:a'])
        Harness.Resolve(sol.AddMember('./b', 'architecture'), 'b')
        await h.events.Raise({ Kind: ProjectEventKind.ReferencesChanged, ProjectType: 'architecture', Project: storage, Manifest: {} as never })
        expect(h.validation.calls).toHaveLength(2)
    })
})
