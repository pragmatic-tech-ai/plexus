// live-validation-sync.ts - keeps live (as-you-type) validation registered for exactly the
// projects in the active solution. Subscribes to SolutionManagerService.ActiveSolution and
// its Members, and drives ILiveValidation: AttachProject when a member resolves, DetachProject
// when it is removed (or its solution is swapped out), RefreshBases when the engine raises
// ProjectEvents.ReferencesChanged for a tracked member's storage. This is the replacement for
// the Attach/Detach side effects of the old project-explorer projection loop.
import { ServiceBase, ServiceKey, type IServiceProvider, type CollectionChange } from '@pragmatic-tech-ai/mural/runtime'
import type { IDisposable, IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    SolutionManagerService, ProjectEventsKey, type Solution, ProjectEvents, ProjectEventKind,
    type SolutionMember, type ProjectEvent,
} from '@pragmatic-tech-ai/todl'
import { TypeScriptWorkspaceSinkKey, TypeScriptDiagnosticsSinkKey } from '../../../typescript/typescript-seams.js'
import { LiveValidationKey, type ILiveValidation } from '../../../projects/capabilities/live-validation.js'

// The bits of a resolved member's Project that live validation registers under.
interface ProjectIdentity
{
    readonly RootPath: string
    readonly Name: string
}

// What Attach recorded for a member, so Detach/Resync need not re-read the (possibly gone) Project.
interface AttachedProject
{
    readonly storage: IStorage
    readonly projectId: string
    readonly projectName: string
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
    private readonly attached = new Map<SolutionMember, AttachedProject>()
    // Per-member Status subscriptions, alive while the member is in the tracked collection.
    private readonly watching = new Map<SolutionMember, IDisposable>()
    private currentMembers: Solution['Members'] | undefined

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
        const rec = this.attached.get(member)
        const identity = member.Project as ProjectIdentity | undefined
        if (rec === undefined || identity === undefined) return
        void this.validation?.ResyncProject(identity.RootPath, rec.storage)
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
        this.currentMembers = members
        this.TrackAll()
        this.membersSub = new FunctionDisposable(members.Subscribe((change) => this.OnMembersChanged(change)))
    }

    private Teardown(): void
    {
        this.membersSub?.dispose()
        this.membersSub = undefined
        this.currentMembers = undefined
        this.UntrackAll()
    }

    private TrackAll(): void
    {
        if (this.currentMembers === undefined) return
        for (const member of this.currentMembers.ToArray()) this.Track(member)
    }

    private UntrackAll(): void
    {
        for (const member of [...this.watching.keys()]) this.Untrack(member)
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
            case 'cleared':
            case 'reset':
            case 'replaced':
                // The delta is not enumerable: detach everything, then re-track the collection as it now stands.
                this.UntrackAll()
                this.TrackAll()
                return
            default:
                return
        }
    }

    // Follow the member's Status for as long as it is in the collection (until Untrack): attach
    // when it becomes Resolved, detach when it leaves Resolved (the engine sets Project/Storage
    // BEFORE flipping Status, so Status - not Project - is the signal). A load-failed member that
    // later resolves (re-open / rescan) therefore attaches, and a resolved one that fails detaches.
    private Track(member: SolutionMember): void
    {
        if (this.watching.has(member)) return
        const sub = member.PropertyChanged(LiveValidationSync.MemberStatusPropertyName)
            .subscribe(() => this.Reconcile(member))
        this.watching.set(member, sub)
        this.Reconcile(member)
    }

    private Reconcile(member: SolutionMember): void
    {
        if (this.disposed) return
        if (member.IsResolved)
        {
            if (!this.attached.has(member)) this.Attach(member)
        }
        else
        {
            this.Detach(member)
        }
    }

    private Untrack(member: SolutionMember): void
    {
        this.watching.get(member)?.dispose()
        this.watching.delete(member)
        this.Detach(member)
    }

    private Detach(member: SolutionMember): void
    {
        const rec = this.attached.get(member)
        if (rec === undefined) return
        this.attached.delete(member)
        this.validation?.DetachProject(rec.storage)
        this.Provider.get(TypeScriptWorkspaceSinkKey)?.DetachProject(rec.projectId)
        this.Provider.get(TypeScriptDiagnosticsSinkKey)?.UntrackProject(rec.projectId)
    }

    private Attach(member: SolutionMember): void
    {
        const storage = member.Storage
        const identity = member.Project as ProjectIdentity | undefined
        if (storage === undefined || identity === undefined) return
        this.attached.set(member, { storage, projectId: identity.RootPath, projectName: identity.Name })
        void this.validation?.AttachProject(identity.RootPath, identity.Name, storage)
        void this.Provider.get(TypeScriptWorkspaceSinkKey)?.AttachProject(identity.RootPath, identity.Name, storage)
        this.Provider.get(TypeScriptDiagnosticsSinkKey)?.TrackProject(identity.RootPath, identity.Name)
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
        for (const rec of [...this.attached.values()])
        {
            if (rec.storage === event.Project) await this.validation?.RefreshBases(rec.storage)
        }
    }
}
