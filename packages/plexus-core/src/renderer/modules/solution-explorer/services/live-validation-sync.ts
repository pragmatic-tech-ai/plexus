// live-validation-sync.ts - keeps live (as-you-type) validation registered for exactly the
// projects in the active solution. Subscribes to SolutionManagerService.ActiveSolution and
// its Members, and drives ILiveValidation: AttachProject when a member resolves, DetachProject
// when it is removed (or its solution is swapped out), RefreshBases when the engine raises
// ProjectEvents.ReferencesChanged for a tracked member's storage. This is the replacement for
// the Attach/Detach side effects of the old project-explorer projection loop.
import { ServiceBase, ServiceKey, type IServiceProvider, type CollectionChange } from '@pragmatic-tech-ai/mural/runtime'
import type { IDisposable, IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    SolutionManagerService, SolutionMemberStatus, ProjectEventsKey, ProjectEvents, ProjectEventKind,
    type SolutionMember, type ProjectEvent,
} from '@pragmatic-tech-ai/todl'
import { LiveValidationKey, type ILiveValidation } from '../../../projects/capabilities/live-validation.js'

// The bits of a resolved member's Project that live validation registers under.
interface ProjectIdentity
{
    readonly RootPath: string
    readonly Name: string
}

// Adapts a bare-function disposer (ObservableCollection.Subscribe) to IDisposable.
class FunctionDisposable implements IDisposable
{
    constructor(private readonly disposer: () => void) {}

    public dispose(): void { this.disposer() }
}

export class LiveValidationSync extends ServiceBase
{
    public static readonly Key = new ServiceKey<LiveValidationSync>('LiveValidationSync')

    private static readonly ActiveSolutionPropertyName = 'ActiveSolution'
    private static readonly MemberStatusPropertyName = 'Status'

    private started = false
    private disposed = false
    private activeSolutionSub: IDisposable | undefined
    private membersSub: IDisposable | undefined
    // Members currently registered with live validation, and the storage they were registered under.
    private readonly attached = new Map<SolutionMember, IStorage>()
    // Members still waiting for their Project to settle.
    private readonly pending = new Map<SolutionMember, IDisposable>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
    }

    private get manager(): SolutionManagerService { return this.Provider.getRequired(SolutionManagerService.Key) }
    private get validation(): ILiveValidation | undefined { return this.Provider.get(LiveValidationKey) }

    // Begin syncing. Kept out of the constructor: the manager's collaborator seams resolve after
    // mount, so the host calls Start() once they are wired (before session restore). Idempotent.
    public Start(): void
    {
        if (this.started) return
        this.started = true
        this.activeSolutionSub = this.manager.PropertyChanged(LiveValidationSync.ActiveSolutionPropertyName)
            .subscribe(() => this.Rewire())
        this.SubscribeReferencesChanged()
        this.Rewire()
    }

    // Reconcile the language server's document set for one member after a structural change
    // (rescan). No-op for a member that is not currently attached.
    public ResyncMember(member: SolutionMember): void
    {
        const storage = this.attached.get(member)
        const identity = member.Project as ProjectIdentity | undefined
        if (storage === undefined || identity === undefined) return
        void this.validation?.ResyncProject(identity.RootPath, storage)
    }

    public override dispose(): void
    {
        this.disposed = true
        this.activeSolutionSub?.dispose()
        this.activeSolutionSub = undefined
        this.Teardown()
        super.dispose()
    }

    // Drop everything tied to the previous solution (detaching its members), then track the
    // current ActiveSolution's members and follow its Members collection.
    private Rewire(): void
    {
        if (this.disposed) return
        this.Teardown()
        const members = this.manager.ActiveSolution?.Members
        if (members === undefined) return
        for (const member of members.ToArray()) this.Track(member)
        this.membersSub = new FunctionDisposable(members.Subscribe((change) => this.OnMembersChanged(change)))
    }

    private Teardown(): void
    {
        this.membersSub?.dispose()
        this.membersSub = undefined
        for (const member of [...this.pending.keys()]) this.Untrack(member)
        for (const member of [...this.attached.keys()]) this.Untrack(member)
    }

    private OnMembersChanged(change: CollectionChange<SolutionMember>): void
    {
        switch (change.kind)
        {
            case 'inserted':
                for (const member of change.items) this.Track(member)
                return
            case 'removed':
                for (const member of change.items) this.Untrack(member)
                return
            default:
                return
        }
    }

    // Attach now if the member is resolved; otherwise wait for its Status to settle (the engine
    // appends to Members before it awaits the open, and sets Project/Storage BEFORE flipping
    // Status to Resolved - so Status, not Project, is the settle signal). An unresolvable
    // member (unknown type / load failure) settles without ever being attached.
    private Track(member: SolutionMember): void
    {
        if (this.attached.has(member) || this.pending.has(member)) return
        if (member.IsResolved)
        {
            this.Attach(member)
            return
        }
        const sub = member.PropertyChanged(LiveValidationSync.MemberStatusPropertyName).subscribe(() =>
        {
            if (member.Status === SolutionMemberStatus.Unopened) return
            this.pending.get(member)?.dispose()
            this.pending.delete(member)
            if (!this.disposed && member.IsResolved) this.Attach(member)
        })
        this.pending.set(member, sub)
    }

    private Untrack(member: SolutionMember): void
    {
        const waiting = this.pending.get(member)
        if (waiting !== undefined)
        {
            waiting.dispose()
            this.pending.delete(member)
        }
        const storage = this.attached.get(member)
        if (storage !== undefined)
        {
            this.attached.delete(member)
            this.validation?.DetachProject(storage)
        }
    }

    private Attach(member: SolutionMember): void
    {
        const storage = member.Storage
        const identity = member.Project as ProjectIdentity | undefined
        if (storage === undefined || identity === undefined) return
        this.attached.set(member, storage)
        void this.validation?.AttachProject(identity.RootPath, identity.Name, storage)
    }

    // The engine raises ReferencesChanged (carrying the project's storage) after a reference edit
    // is persisted: drop the validator's cached bases for that project and revalidate. The bus
    // exposes no unsubscribe, so the handler is guarded by the disposed flag.
    private SubscribeReferencesChanged(): void
    {
        const events = this.Provider.get(ProjectEventsKey)
        if (!(events instanceof ProjectEvents)) return
        events.Subscribe((event) => this.OnProjectEvent(event))
    }

    private async OnProjectEvent(event: ProjectEvent): Promise<void>
    {
        if (this.disposed || event.Kind !== ProjectEventKind.ReferencesChanged) return
        for (const storage of [...this.attached.values()])
        {
            if (storage === event.Project) await this.validation?.RefreshBases(storage)
        }
    }
}
