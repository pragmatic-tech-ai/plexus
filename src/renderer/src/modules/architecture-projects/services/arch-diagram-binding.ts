import { Connector, ConnectorEndpoint, DiagramDocument, DialogService, Figure, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ContentContainerFigure } from '@pragmatic-tech-ai/mural/framework/diagram/content-container-figure.js'
import type { Entity, Repository } from '@pragmatic-tech-ai/todl'
import { showContainmentRejected } from './containment-modal.js'
import { TodlVisualResolverKey } from '../../diagram/services/todl-visual-resolver.js'
import type { ArchModel } from './arch-model.js'
import { ModelHistoryLayer } from './model-history-layer.js'
import { ArchNodeVM } from './arch-node-vm.js'
import { iconEntityKey } from './arch-icon.js'
import { desiredEdges, edgeKey, desiredConnectorEntityEdges, connectorEntityIdOf } from './edge-projection.js'
import { isContainerConcept, containingContainerOf, containmentMemberOf, containmentMemberFor, membershipFieldFor } from './containment.js'
import { resolveConnectorActions, type ConnectorAction } from './arch-connector-resolver.js'
import { canDrawConnectorEntity, mintConnectorEntity, CONNECTOR_DEFAULT_TYPE, CONNECTOR_DRAW_MEMBER } from './connector-entity.js'
import { readConnectorVisuals, writeConnectorVisual, captureConnectorVisual, applyConnectorVisual } from './arch-diagram-connector-visuals-store.js'
import { scenarioStepPairs, type FlowEntity } from './scenario-flow.js'
import type { DropCandidateChooserService } from './drop-candidate-chooser-service.js'
import type { WikiService } from '../../../services/wiki/wiki-service.js'
import type { ArchNavigationService } from './arch-navigation-service.js'

// Synthetic relationship member for a projected scenario step edge, so its
// edgeKey never collides with a real model relationship member.
const SCENARIO_STEP_MEMBER = '__scenario_step__'

// A status-bar sink (StatusService satisfies it) — settable message text.
export interface IStatusSink { Text: string }

// Binds an opened diagram to a project's ArchModel. On every model change it
// rescans doc.Nodes: ArchNodeVMs (and legacy Figures) whose Id is a live entity
// are tracked + labelled (this binds drop-created nodes too, since the drop fires
// notifyChanged after setting the Id); tracked nodes whose entity was deleted are
// removed. Nodes whose Id matches no entity are freeform shapes, left untouched.
export class ArchDiagramBinding
{
    private off: (() => void) | undefined
    private detachView: (() => void) | undefined
    private modelLayerOff: (() => void) | undefined   // unregisters the undo model layer
    private appliedOff: (() => void) | undefined       // unsubscribes the post-undo re-projection
    private readonly bound = new Map<string, Figure | ArchNodeVM>()   // entityId -> node
    private readonly boundEdges = new Map<string, Connector>()         // edgeKey -> projected connector
    private readonly connectorVisualTeardown = new Map<string, () => void>()   // edgeKey -> unwire route/port capture listeners
    private _applyingConnectorVisual = false                           // true while restoring a saved visual (mutes the capture echo)
    private readonly titleWired = new WeakSet<ArchNodeVM>()            // nodes whose title-commit is subscribed
    private readonly titleUnsubs: Array<() => void> = []              // title-commit unsubscribes (for dispose)
    private scope: string[] = []                                       // selected viewpoints ([] = all)
    private scenarios: string[] = []                                   // scenarios whose steps are shown
    private _writingBack = false                                       // true while the binding drives reparents (projection / snap-back) — the NodeReparented observer ignores those echoes
    // HasWiki cache. A concept's wiki-ness depends only on concept DECLARATIONS in
    // the loaded model, never on instances, so an instance edit (a scenario drop)
    // can't change it. Resolved synchronously off the repository and cached per
    // concept; the cache clears only when the repository object is rebuilt (a base
    // reload). This replaces the old per-node, per-rescan async recompile.
    private wikiRepo: Repository | undefined
    private readonly wikiByConcept = new Map<string, boolean>()
    // On mount (or view swap) re-wire the view listeners AND rescan, so the
    // containment projection — which needs realized Figures — runs once the view
    // exists (attach's first rescan may precede the mount).
    private readonly onActiveViewChanged = (): void => { this.attachView(); this.rescan() }

    public constructor(
        private readonly doc: DiagramDocument,
        public readonly model: ArchModel,
        private readonly chooser?: DropCandidateChooserService,
        private readonly wiki?: WikiService,
        // A status sink (StatusService) for user feedback on a rejected draw.
        // Minimal shape so the binding doesn't hard-depend on the shell service.
        private readonly status?: IStatusSink,
        // Modal host for the illegal-drag-in rejection (shared with the drop path).
        private readonly dialogs?: DialogService,
        // The "Go to Definition" router + this diagram's owning project id
        // (Project.RootPath). Present in the live editor; omitted for headless
        // render binds (no navigation surface). When both are set, rescan populates
        // each node's nav-target facet so its right-click submenu is live.
        private readonly nav?: ArchNavigationService,
        private readonly projectId?: string,
    ) {}

    // Does `concept` declare a wiki page? A cheap `repo.resolve('X@wiki')` off the
    // loaded model, cached per concept. The cache is dropped when the repository is
    // rebuilt (base reload) so a just-published wiki reflects after a refresh, but
    // instance-only churn (scenario drops, moves) reuses it and does zero work.
    private conceptHasWiki(concept: string): boolean
    {
        if (this.wiki === undefined || concept.length === 0) return false
        const repo = this.model.repository()
        if (repo !== this.wikiRepo) { this.wikiRepo = repo; this.wikiByConcept.clear() }
        let present = this.wikiByConcept.get(concept)
        if (present === undefined) {
            present = this.wiki.hasWikiIn(repo, concept)
            this.wikiByConcept.set(concept, present)
        }
        return present
    }

    public attach(): void
    {
        this.rescan()
        this.off = this.model.onChanged(() => this.rescan())
        // The canvas view publishes itself on mount (ActiveView); (re)wire the
        // connector-authoring listener whenever it changes.
        this.attachView()
        this.doc.AddPropertyChangedListener(DiagramDocument.ActiveViewKey, this.onActiveViewChanged)
        // Bridge the model into the document's undo history for the binding's
        // lifetime, so model-mutating diagram edits (reparent, connector-draw,
        // Shift+Delete, drop-create — all inside a Diagram-event bracket — and the
        // rename bracketed below) undo the model alongside the visuals.
        this.modelLayerOff = this.doc.History.RegisterLayer(new ModelHistoryLayer(this.model))
        // After any undo/redo, re-project. A DIAGRAM-only restore (a move/delete
        // undo) runs the diagram layer's _deserialize, which rebuilds node instances
        // and drops derived connectors, but carries no model layer to reconcile — so
        // our projection caches (bound / boundEdges) now point at stale nodes and
        // vanished connectors. Reset them and rescan to rebuild the model-derived
        // overlay (labels, icons, projected connectors, nesting) against the restored
        // nodes. A model-affecting undo already reconciled, so this is a cheap
        // idempotent second pass there.
        this.appliedOff = this.doc.History.AddAppliedListener(() => {
            this.bound.clear()
            this.boundEdges.clear()
            this.rescan()
        })
    }

    // Attach the ConnectorCreated listener to the current canvas view. A user-drawn
    // connector routes to handleConnectorCreated (turns the draw into a model ref).
    private attachView(): void
    {
        this.detachView?.()
        this.detachView = undefined
        const view = this.doc.ActiveView
        if (view === undefined) return
        const onConnector = (args: { Source?: ConnectorEndpoint; Target?: ConnectorEndpoint }): void =>
            this.handleConnectorCreated(args.Source?.Node, args.Target?.Node)
        const onDelete = (args: { Items: readonly unknown[]; Connectors: readonly Connector[]; Shift: boolean }): void =>
            this.handleDeleteRequested(args.Items, args.Connectors, args.Shift)
        const onReparent = (args: { Node: { Id?: string }; OldParentId?: string; NewParentId?: string }): void =>
            this.handleReparent(args)
        view.AddConnectorCreatedListener(onConnector)
        view.AddDeleteRequestedListener(onDelete)
        view.AddNodeReparentedListener(onReparent)
        this.detachView = () => {
            view.RemoveConnectorCreatedListener(onConnector)
            view.RemoveDeleteRequestedListener(onDelete)
            view.RemoveNodeReparentedListener(onReparent)
        }
    }

    // Delete routing: plain Delete is view-only (the standard mutator removes the
    // figures/connectors; the model entity stays and re-projects on reload).
    // Shift+Delete ALSO removes the underlying entity from the model — for a node,
    // its entity (→ rescan drops the node + its edges); for a projected `connector`
    // entity edge, the connector entity (→ the edge is gone for good). Relationship
    // and scenario-step edges have no standalone entity, so Shift+Delete on those
    // is a no-op here (the ref/step lives on another entity).
    public handleDeleteRequested(items: readonly unknown[], connectors: readonly Connector[], shift: boolean): void
    {
        if (!shift) return
        let removed = false
        for (const it of items) {
            const id = (it as { Id?: string } | undefined)?.Id
            if (id !== undefined && this.bound.has(id)) { this.model.remove(id); removed = true }
        }
        for (const c of connectors) {
            const entityId = this.connectorEntityIdFor(c)
            if (entityId !== undefined) { this.model.remove(entityId); removed = true }
        }
        if (removed) void this.model.save()
    }

    // The `connector` entity id behind a projected connector, or undefined when the
    // connector derives from a relationship / scenario step (no entity to delete).
    private connectorEntityIdFor(c: Connector): string | undefined
    {
        for (const [key, conn] of this.boundEdges) if (conn === c) return connectorEntityIdOf(key)
        return undefined
    }

    // A user drew a connector between two nodes. Reconcile away the raw connector
    // the standard mutator just created (arch diagrams are connector-authoritative),
    // then, when both endpoints are bound arch nodes, offer the legal outcomes:
    // concept relationship member(s) — write the ref — PLUS, when the meta-model's
    // `connector` from/to accept the pair, minting a typed `connector` entity
    // (default `calls`). 0 outcomes → reject (feedback); 1 → auto; many → chooser.
    // The projection redraws the result as a model-backed edge on the next rescan.
    public handleConnectorCreated(source: unknown, target: unknown): void
    {
        const fromId = (source as { Id?: string } | undefined)?.Id
        const toId = (target as { Id?: string } | undefined)?.Id
        this.model.notifyChanged()   // drops the raw connector via reconcile
        if (fromId === undefined || toId === undefined) return
        if (!this.bound.has(fromId) || !this.bound.has(toId)) return
        const srcConcept = this.conceptOf(fromId)
        const tgtConcept = this.conceptOf(toId)
        if (srcConcept === undefined || tgtConcept === undefined) return

        const repo = this.model.repository()
        const actions: ConnectorAction[] = []
        const applyByMember = new Map<string, () => void>()

        // Concept-relationship outcomes: write the ref on the source.
        for (const a of resolveConnectorActions(repo, srcConcept, tgtConcept, this.scopeSet())) {
            actions.push(a)
            applyByMember.set(a.member, () => { this.model.addRef(fromId, a.member, toId); void this.model.save() })
        }
        // Connector-entity outcome: mint a typed `connector` entity (default calls).
        if (canDrawConnectorEntity(repo, srcConcept, tgtConcept)) {
            actions.push({ member: CONNECTOR_DRAW_MEMBER, label: `connect (${CONNECTOR_DEFAULT_TYPE})` })
            applyByMember.set(CONNECTOR_DRAW_MEMBER, () => {
                mintConnectorEntity(this.model, fromId, toId, CONNECTOR_DEFAULT_TYPE); void this.model.save()
            })
        }

        if (actions.length === 0) { this.rejectDraw(srcConcept, tgtConcept); return }
        if (actions.length === 1) { applyByMember.get(actions[0].member)?.(); return }
        this.chooser?.Show(actions, (a) => applyByMember.get(a.member)?.())
    }

    // A drawn connector resolved to nothing legal (no relationship member accepts
    // the pair and it is not a valid `connector` from/to). The raw connector was
    // already reconciled away; tell the user why instead of leaving it a silent
    // vanish.
    private rejectDraw(srcConcept: string, tgtConcept: string): void
    {
        if (this.status !== undefined) this.status.Text = `Can't connect a ${srcConcept} to a ${tgtConcept} here`
    }

    // The concept an already-placed entity instantiates (from the live model).
    private conceptOf(id: string): string | undefined
    {
        return this.model.entities().find((e) => e.id === id)?.concept
    }

    private rescan(): void
    {
        // The rescan REDRAWS diagram content derived from the model — labels,
        // icons, projected connectors, re-minted containers, nesting. That churn
        // must be invisible to undo history: it is not a user edit, and undo re-
        // derives it via the model layer's reconcile (which rescans again). Without
        // this, each projection pass tripped the safety net, littering the undo
        // stack with phantom "connectors removed/added" / "nodes churned" entries
        // (and a load's projection recorded the whole diagram as one giant edit).
        // Explicit brackets (a drop, the rename) are unaffected — RunSilently only
        // mutes the un-bracketed safety net.
        //
        // BeginSettle additionally holds the mute across the projection's ASYNC tail:
        // a rescan re-fits containers to new labels and re-routes connectors on a
        // LATER layout pass, firing the safety net after this synchronous scope has
        // closed. Without the settle window those async writes land as phantom
        // geometry/connector undo entries that bury the real edit beneath them.
        this.doc.History.BeginSettle()
        this.doc.History.RunSilently(() => this.rescanCore())
    }

    private rescanCore(): void
    {
        const byId = new Map(this.model.entities().map((e) => [e.id, e]))
        // Also resolve placed nodes that are NOT own instances but DO resolve to a
        // repo entity — imported library terms (e.g. the `microsoft_tech.*` locations
        // referenced by the model's `in`/`parent` chains). The user placed them
        // deliberately; they carry a concept + containment refs, so they bind, render,
        // and (for container concepts) nest exactly like an own arch node. Read-only:
        // write-back (handleReparent) still guards against mutating library entities.
        const repo = this.model.repository()
        for (const node of this.doc.Nodes.ToArray()) {
            const id = (node as { Id?: string }).Id
            if (id === undefined || byId.has(id)) continue
            if (repo.has(id)) { const e = repo.entity(id); if (e !== undefined) byId.set(id, e) }
        }
        // Bind + derive label/icon for every node that maps to a live entity.
        for (const node of this.doc.Nodes.ToArray()) {
            if (node instanceof ArchNodeVM) {
                const id = node.Id
                if (id === undefined) continue
                const entity = byId.get(id)
                if (entity === undefined) continue
                this.bound.set(id, node)
                node.Label = displayLabel(entity)
                // Persist an in-place title edit back to the entity's `label`
                // field (subscribe once per node; the WeakSet guards re-scans).
                // setField fires onChanged → rescan re-derives the same Label,
                // and save() writes it to the entity's home .todl file.
                if (!this.titleWired.has(node)) {
                    this.titleWired.add(node)
                    const entityId = id
                    this.titleUnsubs.push(node.AddLabelCommittedListener((title) => {
                        // Rename is not a Diagram mutating event → bracket it here so
                        // it is one undo step (the model layer captures the label change).
                        this.doc.History.Begin('Rename')
                        try {
                            this.model.setField(entityId, 'label', title)
                            void this.model.save()
                        } finally {
                            this.doc.History.Commit()
                        }
                    }))
                }
                // Key the icon by the entity's stamped icon-annotation resource key
                // (referenced term first, then own concept); fall back to the bare
                // concept when nothing carries an icon (→ default glyph).
                const key = iconEntityKey(this.model.repository(), entity) ?? entity.concept
                node.Descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
                node.Concept = entity.concept
                // A container concept realizes as a ContentContainerFigure (mural
                // reads IsContainer duck-typed); its `in` refs project as nesting.
                node.IsContainer = isContainerConcept(this.model.repository(), entity.concept)
                node.HasWiki = this.conceptHasWiki(entity.concept)
                // Hand the node its document so its right-click menu can reuse the
                // shared @DiagramContextMenu ($ActiveView / $Inspector resolve via
                // ArchNodeVM's HostDocument aliases).
                node.HostDocument = this.doc
                // Populate the "Go to Definition" facet: resolve this entity's
                // navigable relations (component / technology / category) and hand
                // the node its bindable, adaptive targets + a router that opens the
                // source or reveals the published term.
                if (this.nav !== undefined && this.projectId !== undefined) {
                    const nav = this.nav
                    const projectId = this.projectId
                    const targets = nav.resolveTargets(this.model, id)
                    node.ApplyNavTargets(targets, (t) => void nav.navigateTo(this.model, projectId, t))
                }
            } else if (node instanceof Figure) {
                // Back-compat for any freeform Figure with a matching entity id.
                const id = node.Id
                if (id === undefined) continue
                const entity = byId.get(id)
                if (entity === undefined) continue
                this.bound.set(id, node)
                node.LabelText = displayLabel(entity)
            }
        }
        // Remove tracked nodes whose entity is gone.
        for (const [id, node] of [...this.bound]) {
            if (!byId.has(id)) {
                this.doc.DeleteNodes([node])
                this.bound.delete(id)
            }
        }

        this.reconcileContainerRealization()
        this.projectEdges(byId)
        this.projectContainment(byId)
    }

    // Container-ness (ArchNodeVM.IsContainer) is discovered only once the model
    // loads (async) and rescan runs — but a node realizes its Figure earlier, when
    // the view first mounts, so mural's GetContainerForItemOverride saw IsContainer
    // still false and minted a PLAIN Figure. That decision is one-shot per
    // realization, so flipping IsContainer afterward doesn't upgrade it. Force a
    // re-realization: a node that is now a container but whose realized Figure is
    // not a ContentContainerFigure is removed and re-inserted, so the ItemsControl
    // recycles the stale container and mints a fresh one reading the now-true flag.
    // Runs once per container node (subsequent rescans see the right type → skip);
    // geometry survives (the NodeVisualStore keys it by id).
    private reconcileContainerRealization(): void
    {
        const view = this.doc.ActiveView
        if (view === undefined) return
        const stale: Array<{ vm: ArchNodeVM; index: number }> = []
        for (const [, node] of this.bound) {
            if (!(node instanceof ArchNodeVM) || !node.IsContainer) continue
            const fig = view.Generator.ContainerFromItem(node)
            if (fig instanceof ContentContainerFigure) continue   // already the right container
            const index = this.doc.Nodes.IndexOf(node)
            if (index >= 0) stale.push({ vm: node, index })
        }
        if (stale.length === 0) return
        this._writingBack = true   // suppress NodeReparented echoes during the churn
        try {
            for (const { vm, index } of stale) {
                this.doc.Nodes.Remove(vm)
                this.doc.Nodes.Insert(index, vm)   // re-mints the container as a ContentContainerFigure (mural styles its default box)
            }
        } finally {
            this._writingBack = false
        }
    }

    // Project each bound node's containment ref (`in`) as visual NESTING: the
    // node's realized Figure is re-parented into its container's Figure. Model is
    // the source of truth — a node's container is whatever its containment ref
    // points at (and is placed + a container concept); everything else sits at
    // root. Needs the mounted view (nesting operates on realized Figures), so it
    // no-ops until ActiveView exists; onActiveViewChanged re-rescans on mount.
    //
    // Reconcile-only: on load the visual store already restored the nesting
    // (ContainerParent === target → skip), and a user drag already nested the
    // Figure before the write-back rescans (also a skip). It actively reparents
    // only when the model and the visual tree disagree (model wins). The write-
    // back observer (Task C5) guards against the reparents THIS pass emits.
    private projectContainment(byId: ReadonlyMap<string, Entity>): void
    {
        const view = this.doc.ActiveView
        if (view === undefined) return
        const repo = this.model.repository()
        const placement = view.ContainerPlacement
        this._writingBack = true
        try {
            placement.placeAll()   // register realized containers + restore saved nesting
            for (const [id, node] of this.bound) {
                if (!(node instanceof ArchNodeVM)) continue
                const entity = byId.get(id)
                if (entity === undefined) continue
                const fig = view.Generator.ContainerFromItem(node)
                if (!(fig instanceof Figure)) continue
                const parent = containingContainerOf(repo, entity)
                const targetId = (parent !== undefined && this.bound.has(parent.id)
                    && isContainerConcept(repo, parent.concept)) ? parent.id : undefined
                if ((fig.ContainerParent?.Id) === targetId) continue   // already nested correctly
                placement.reparent(fig, targetId)
            }
        } finally {
            this._writingBack = false
        }
    }

    // A drag nested / un-nested a node (mural's NodeReparented). Mirror the
    // membership change into the model: nest → write the containment ref, un-nest
    // → remove it. Model-backed nodes only — a reparent of a node with no backing
    // entity (a generic container / freeform shape) is visual-only, left alone. An
    // illegal nesting (the meta-model has no relationship that can hold it) is
    // rejected: no ref is written and the node is snapped back out.
    private handleReparent(args: { Node: { Id?: string }; OldParentId?: string; NewParentId?: string }): void
    {
        if (this._writingBack) return                     // ignore the echo of our own projection / snap-back
        const childId = args.Node.Id
        if (childId === undefined) return
        const child = this.entityById(childId)
        if (child === undefined) return                   // visual-only node (no model backing)
        const repo = this.model.repository()

        if (args.NewParentId === undefined) {
            // Un-nest: sever every containment tie to the old parent (own OR library
            // entity) — both the child's up-ref and the parent's membership list.
            const oldId = args.OldParentId
            if (oldId !== undefined && this.resolveEntity(oldId) !== undefined) {
                this.severContainment(childId, child, oldId)
                void this.model.save()
            }
            return
        }

        // Nest into a NON-entity parent (a generic container / freeform shape):
        // visual-only grouping — accept it, write no model ref (a reload restores
        // the nesting from the visual store, not the model). Generic accepts any.
        // The parent resolves against ANY repo entity, so a model-backed container
        // that is an imported LIBRARY location (not an own instance) still gets its
        // `in`/containment ref written — the child stays own-instance-only, so we
        // never mutate a library entity.
        const parent = this.resolveEntity(args.NewParentId)
        if (parent === undefined) return

        // Nest into a MODEL-backed parent: the meta-model must permit
        // child --containment--> parent; otherwise reject (modal + snap back, no write).
        const member = containmentMemberFor(repo, child.concept, parent.concept)
        if (member === undefined) {
            this._writingBack = true
            try { this.doc.ActiveView?.ContainerPlacement.reparent(args.Node as unknown as Figure, undefined) }
            finally { this._writingBack = false }
            showContainmentRejected(this.dialogs, displayLabel(child), displayLabel(parent))
            return
        }
        // Legal: rewrite the containment ref (sever the old parent's ties, if any,
        // then add the canonical child up-ref to the new one).
        if (args.OldParentId !== undefined && this.resolveEntity(args.OldParentId) !== undefined)
            this.severContainment(childId, child, args.OldParentId)
        this.model.addRef(childId, member, args.NewParentId)
        void this.model.save()
    }

    // Sever every containment tie between a child and an old parent: the child's own
    // @containment up-ref AND the parent's forward membership list (block.components),
    // so an un-nest or cross-parent move sticks regardless of which channel made it a
    // member. A no-op for a channel that doesn't hold it. The up-ref member is the one
    // that targets THIS parent's concept (a component has both `in` → location and
    // `in_block` → block; stripping the wrong one leaves the nesting in place).
    private severContainment(childId: string, child: Entity, oldParentId: string): void
    {
        const repo = this.model.repository()
        const oldParent = this.resolveEntity(oldParentId)
        const upMember = oldParent !== undefined
            ? containmentMemberFor(repo, child.concept, oldParent.concept)
            : undefined
        this.model.removeRef(childId, upMember ?? containmentMemberOf(repo, child.concept), oldParentId)
        if (oldParent === undefined) return
        const field = membershipFieldFor(repo, oldParent.concept, child.concept)
        if (field !== undefined) this.model.removeRef(oldParentId, field, childId)
    }

    // Own instances only — the write-back CHILD guard: dragging a library entity
    // (not an own instance) resolves to undefined here, so handleReparent leaves it
    // alone rather than mutating a library file.
    private entityById(id: string): Entity | undefined
    {
        return this.model.entities().find((e) => e.id === id)
    }

    // Own instance OR any resolvable repo entity (e.g. an imported library
    // location). Used for write-back PARENT/target resolution and rescan binding —
    // a library-location container is a legitimate containment target even though
    // it is not an own instance.
    private resolveEntity(id: string): Entity | undefined
    {
        const own = this.model.entities().find((e) => e.id === id)
        if (own !== undefined) return own
        const repo = this.model.repository()
        return repo.has(id) ? repo.entity(id) : undefined
    }

    // Project the model's relationships between placed nodes as connectors, and
    // keep the diagram connector-authoritative: the ONLY connectors between two
    // bound arch nodes are the ones we derive from the model. A raw user-drawn
    // connector (added by the standard mutator) is removed here — SP3 turns the
    // draw gesture into a model ref, which then projects back as a real edge.
    // Restore a projected connector's saved presentation (route waypoints + port
    // sides) from the diagram metadata, then wire listeners that capture the user's
    // subsequent route/port edits back into that metadata (keyed by the model edge
    // key) so they persist across a reopen. The apply runs under a guard so it does
    // not echo straight back into the capture.
    private applyAndTrackConnectorVisual(key: string, c: Connector): void
    {
        this.connectorVisualTeardown.get(key)?.()   // idempotent re-wire
        const saved = readConnectorVisuals(this.doc)[key]
        if (saved !== undefined) {
            this._applyingConnectorVisual = true
            try { applyConnectorVisual(c, saved) } finally { this._applyingConnectorVisual = false }
        }
        const onVisualEdit = (): void => {
            if (this._applyingConnectorVisual) return
            writeConnectorVisual(this.doc, key, captureConnectorVisual(c))
        }
        c.AddPropertyChangedListener(Connector.WaypointsKey, onVisualEdit)
        c.AddPropertyChangedListener(Connector.RoutingModeKey, onVisualEdit)
        const wireEp = (e: ConnectorEndpoint | undefined): (() => void) => {
            if (e === undefined) return () => {}
            e.AddPropertyChangedListener(ConnectorEndpoint.PortSideKey, onVisualEdit)
            e.AddPropertyChangedListener(ConnectorEndpoint.PortIndexKey, onVisualEdit)
            return () => {
                e.RemovePropertyChangedListener(ConnectorEndpoint.PortSideKey, onVisualEdit)
                e.RemovePropertyChangedListener(ConnectorEndpoint.PortIndexKey, onVisualEdit)
            }
        }
        const offSrc = wireEp(c.Source)
        const offTgt = wireEp(c.Target)
        this.connectorVisualTeardown.set(key, () => {
            c.RemovePropertyChangedListener(Connector.WaypointsKey, onVisualEdit)
            c.RemovePropertyChangedListener(Connector.RoutingModeKey, onVisualEdit)
            offSrc(); offTgt()
        })
    }

    private projectEdges(byId: ReadonlyMap<string, Entity>): void
    {
        const placed = new Map<string, Entity>()
        for (const id of this.bound.keys()) {
            const e = byId.get(id)
            if (e !== undefined) placed.set(id, e)
        }
        const repo = this.model.repository()
        const desired = desiredEdges(repo, placed, this.scopeSet())

        // Scenario overlay: each active scenario projects its steps as connectors
        // between placed participants. These are model-derived (the steps live in
        // the model), so they are "ours" — the sweep below keeps them and a reload
        // re-projects them from the persisted scenario ids.
        if (this.scenarios.length > 0) {
            const scEnts = this.scenarios
                .map((id) => byId.get(id))
                .filter((e): e is Entity => e !== undefined) as unknown as FlowEntity[]
            for (const [s, d] of scenarioStepPairs(scEnts, new Set(this.bound.keys())))
                desired.add(edgeKey(s, SCENARIO_STEP_MEMBER, d))
        }

        // Standalone `connector` entities ({from, to, type}) project as labeled
        // edges between their placed endpoints — the meta-model's actual
        // component↔component connector. Their type term is the connector label.
        const connEntityEdges = desiredConnectorEntityEdges(repo, this.model.entities(), new Set(this.bound.keys()), this.scopeSet())
        for (const key of connEntityEdges.keys()) desired.add(key)

        // Add missing projected connectors eagerly. An endpoint whose container
        // Figure is already realized is re-homed onto it up front by CreateConnector
        // (_hostEndpoint); one that isn't stays a VM ref and is re-pointed onto its
        // container when it later binds (ContainerBound → _repointEndpointsToContainer)
        // — the same recovery a reopen relies on.
        for (const key of desired) {
            if (this.boundEdges.has(key)) continue
            const [fromId, , toId] = key.split('|')
            const src = this.bound.get(fromId)
            const tgt = this.bound.get(toId)
            if (src === undefined || tgt === undefined) continue
            const c = this.doc.CreateConnector(
                new ConnectorEndpoint({ Node: src }),
                new ConnectorEndpoint({ Node: tgt }),
            )
            if (c !== null) {
                // Projected connectors are model-derived — re-projected on every
                // reconcile — so they must not persist to the .diagram file nor
                // enter the undo-history snapshot (else their create/delete/re-route
                // churn litters history and duplicates on reload).
                c.IsDerived = true
                const label = connEntityEdges.get(key)
                if (label !== undefined) c.LabelText = label
                // Restore this edge's saved presentation (pinned route + port sides),
                // then track future edits so they persist in the diagram metadata.
                this.applyAndTrackConnectorVisual(key, c)
                this.boundEdges.set(key, c)
            }
        }
        // Remove projected connectors no longer desired.
        for (const [key, c] of [...this.boundEdges]) {
            if (!desired.has(key)) {
                this.connectorVisualTeardown.get(key)?.()
                this.connectorVisualTeardown.delete(key)
                this.doc.DeleteConnectors([c])
                this.boundEdges.delete(key)
            }
        }
        // Drop any connector between two bound arch nodes that isn't one of ours
        // — including a persisted connector rehydrated from the .diagram file, so
        // the diagram stays connector-authoritative and edges don't accumulate as
        // duplicates across opens. Identify an endpoint's node by entity id: under
        // container-owned-geometry a connector references the container Figure
        // (whose Id mirrors the entity id), or is still deferred by UnresolvedNodeId
        // before its container binds — the VM object itself is no longer the node.
        const ours = new Set<Connector>(this.boundEdges.values())
        const boundIds = new Set<string>(this.bound.keys())
        const endpointId = (ep: ConnectorEndpoint | undefined): string | undefined =>
            (ep?.Node as { Id?: string } | undefined)?.Id ?? ep?.UnresolvedNodeId
        for (const c of this.doc.Connectors.ToArray()) {
            if (ours.has(c)) continue
            const s = endpointId(c.Source)
            const t = endpointId(c.Target)
            if (s !== undefined && t !== undefined && boundIds.has(s) && boundIds.has(t)) this.doc.DeleteConnectors([c])
        }
    }

    // Whether an entity is currently placed as a node on this diagram.
    public isPlaced(entityId: string): boolean
    {
        return this.bound.has(entityId)
    }

    // The set of entity ids currently placed on this diagram.
    public placedIds(): ReadonlySet<string>
    {
        return new Set(this.bound.keys())
    }

    // Replace the diagram's selected-viewpoint scope (empty = all).
    public setScope(viewpoints: string[]): void
    {
        this.scope = [...viewpoints]
    }

    // Replace the set of scenarios whose steps are projected as connectors.
    public setScenarios(ids: readonly string[]): void
    {
        this.scenarios = [...new Set(ids)]
    }

    // Add one scenario to the projected set (deduped). Caller triggers a rescan
    // (via the model's notifyChanged) to draw its step connectors.
    public addScenario(id: string): void
    {
        if (!this.scenarios.includes(id)) this.scenarios.push(id)
    }

    // The scenarios currently projected on this diagram.
    public scenarioIds(): string[]
    {
        return [...this.scenarios]
    }

    // The scope as a set; empty falls back to every viewpoint the model declares.
    public scopeSet(): Set<string>
    {
        return this.scope.length > 0
            ? new Set(this.scope)
            : new Set(this.model.viewpoints().map((v) => v.id))
    }

    public dispose(): void
    {
        this.off?.()
        this.off = undefined
        this.doc.RemovePropertyChangedListener(DiagramDocument.ActiveViewKey, this.onActiveViewChanged)
        this.detachView?.()
        this.detachView = undefined
        this.modelLayerOff?.()
        this.modelLayerOff = undefined
        this.appliedOff?.()
        this.appliedOff = undefined
        for (const off of this.connectorVisualTeardown.values()) off()
        this.connectorVisualTeardown.clear()
        for (const un of this.titleUnsubs.splice(0)) un()
    }
}

// An entity's display label: its `label`, else `name`, else its id.
function displayLabel(entity: Entity): string
{
    const v = entity.field('label') ?? entity.field('name')
    return v !== undefined ? String(v) : entity.id
}
