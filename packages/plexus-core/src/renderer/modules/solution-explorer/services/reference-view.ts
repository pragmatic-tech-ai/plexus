import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import type { ProjectType, SolutionMember } from '@pragmatic-tech-ai/todl'
import type { BaseRef } from '../../../projects/base-binding.js'

// How a declared reference resolves right now — the decoration the tree paints on a
// reference leaf. LiveWorkspace: an open sibling in this solution produces the id
// (resolution is local-first, so it wins even on a version drift). Published: the exact
// id@version is available from a registry. Unresolved: neither.
export enum ReferenceResolution
{
    Published,
    LiveWorkspace,
    Unresolved,
}

// One declared reference from a project's manifest, annotated with its current resolution.
export interface DeclaredReference
{
    readonly Ref: BaseRef
    readonly Resolution: ReferenceResolution
}

// The consumer project's declared references, grouped by kind, as the References branch
// renders them. OffersLibraries mirrors the project factory (architecture = true,
// library / meta-model = false); when false the Libraries group is omitted.
export interface MemberReferencesView
{
    readonly OffersLibraries: boolean
    readonly MetaModels: readonly DeclaredReference[]
    readonly Libraries: readonly DeclaredReference[]
}

// The read + mutate + refresh-signal seam the References branch depends on, implemented
// by ProjectExplorerService. The provider and the action contributor take this one
// interface so both are fakeable with a single stub. Every mutator writes the manifest
// through the same engine ReferenceEditor tail (RefreshBases + ReferencesChanged) and
// then fires OnReferencesViewChanged so the tree repaints; the modal "Manage
// References…" routes through the same tail, so it fires the signal too.
export interface IReferenceView
{
    // Whether the member is a references consumer (architecture / library) — the
    // synchronous gate the composite uses to decide whether to surface a References node
    // at all. A non-consumer (e.g. a meta-model project) gets no References node.
    IsConsumer(member: SolutionMember): boolean
    // The declared references for a member, annotated with resolution; undefined when the
    // member is not a references consumer (no References node is shown at all).
    ReferencesViewFor(member: SolutionMember): Promise<MemberReferencesView | undefined>
    // References the member could add for a kind — published ∪ workspace producers, minus
    // already-declared, deduped by id@version. Feeds the Add submenu.
    AvailableReferencesFor(member: SolutionMember, kind: ProjectType): Promise<readonly BaseRef[]>
    // The versions an id offers for a kind — published versions ∪ the live workspace
    // producer's version — newest first. Feeds the Set Version submenu.
    AvailableVersionsFor(member: SolutionMember, kind: ProjectType, id: string): Promise<readonly string[]>
    AddMemberReference(member: SolutionMember, kind: ProjectType, ref: BaseRef): Promise<void>
    RemoveMemberReference(member: SolutionMember, kind: ProjectType, ref: BaseRef): Promise<void>
    SetMemberReferenceVersion(member: SolutionMember, kind: ProjectType, id: string, version: string): Promise<void>
    // Fires after any reference edit. `affected` is the edited member on a manifest write,
    // or undefined when resolution changed globally (a producer sibling was invalidated) —
    // the provider re-fetches when affected is undefined or its own member.
    OnReferencesViewChanged(handler: (affected: SolutionMember | undefined) => void): IDisposable
}

export const ReferenceViewKey = new ServiceKey<IReferenceView>('IReferenceView')
