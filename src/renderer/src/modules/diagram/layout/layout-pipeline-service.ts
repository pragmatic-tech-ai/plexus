import {
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    type ICommand,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { Connector, ContentHostService, DialogService, DiagramDocument, DocumentsContentHostService, Figure, type LayoutPreviewNode, type LayoutPreviewEdge } from '@pragmatic-tech-ai/mural/framework'
import {
    GetPipelineCatalog,
    BuildPipeline,
    LoadElementRepository,
    type PipelineConfiguration,
    type CatalogSlot,
    type EdgeRouting,
    type Edge,
    type LayoutStageSpec,
} from '@pragmatic-tech-ai/fresco'

import {
    extract,
    computeOutcome,
    applySides,
    nodeSize,
    type FigureLike,
    type ConnectorLike,
    type ConnectorEdge,
    type EdgeSideLike,
    type NodeSize,
    type PositionSet,
    type SizedLike,
    type LayoutOutcome,
} from './diagram-graph-adapter.js'
import { planForMode, RunMode } from './run-modes.js'
import { LayoutPresetsStore } from './layout-presets-store.js'
import { ProjectLayoutPresetsStore } from './project-layout-presets-store.js'
import { promptSavePreset } from './save-preset-prompt.js'
import { PresetScope, LayoutPresetRef } from './preset-scope.js'
import { LayoutInspector } from './layout-inspector.js'
import { LayoutStageVM } from './layout-stage-vm.js'
import { FileDiagramStorage } from '../persistence/file-diagram-storage.js'
import {
    readLayoutConfig, writeLayoutConfig,
    diagramPresetNames, getDiagramPreset, saveDiagramPreset, deleteDiagramPreset,
} from '../persistence/diagram-layout-store.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Maps a catalog strategy-slot id to its PipelineConfiguration.layout field.
// graph-transforms is intentionally absent — it is a transform list, not a
// single-select stage.
const SLOT_CONFIG_KEY: Record<string, string> = {
    'layer-assigner':      'layerAssigner',
    'layer-improver':      'layerImprover',
    'first-layer-orderer': 'firstLayerOrderer',
    'dummy-inserter':      'dummyInserter',
    'reorderer':           'reorderer',
    'improver':            'improver',
    'position-computer':   'positionComputer',
    'vertical-aligner':    'verticalAligner',
    'edge-router':         'edgeRouter',
    'port-assigner':       'portAssigner',
}

// 'layer-assigner' -> 'Layer Assigner'
function stageLabel(slotId: string): string
{
    return slotId.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// Fresco's edge router that emits cardinal sides for the host diagram to
// route natively (rather than Fresco polyline points). When it's the
// selected edge router, the diagram owns port assignment, so the Port
// Assigner stage is disabled and turned off in the config.
const CARDINAL_SIDE_ROUTER = 'CardinalSideRouter'

// Fallback node size when a figure has not been measured yet (RenderSize 0).
const FALLBACK_SIZE: NodeSize = { width: 80, height: 40 }

// MakeAcyclic runs first so a cyclic diagram (feedback / bidirectional
// architecture relationships) is broken into a DAG before the longest-path
// layer assigner — which refuses cyclic input ('longest-path depths require a
// DAG') — ever sees it. It reverses the minimal feedback-arc set; on an
// already-acyclic graph it is a no-op.
const DEFAULT_CONFIG: PipelineConfiguration = { name: 'default', transforms: ['MakeAcyclicTransform'], layout: {} }

// The product of running the pipeline without committing: the figure index (id →
// geometry Figure), the connector edges (node-id pairs), the computed target
// positions/sizes, and any native side-routing. Shared by Run (apply now),
// Preview (show ghosts), and ApplyPreview (commit the shown result).
interface LayoutComputation
{
    index:          Map<string, FigureLike>
    connectorEdges: ConnectorEdge[]
    outcome:        LayoutOutcome
    lastRoutes:     Map<Edge, EdgeRouting> | undefined
}

// LayoutPipelineService — composes a Fresco layout pipeline and runs it on
// the active diagram. Holds the current PipelineConfiguration, exposes the
// catalog-derived stage rows for the builder UI, manages named presets, and
// applies the computed positions via the pure adapter.
//
// The pure work (extract / computeOutcome / planForMode) lives in unit-tested
// modules; this service is the mural-framework seam that reaches the active
// document and writes positions back.
export class LayoutPipelineService extends ServiceBase
{
    public static readonly Key = new ServiceKey<LayoutPipelineService>('LayoutPipelineService')

    // Every member bound from the .mu template MUST be a registered property:
    // mural's binding engine reads a path on a MuralBase only via a registered
    // PropertyKey (get_property_value) — it does NOT fall back to plain fields.
    public static readonly StatusKey = MuralBase.RegisterProperty<string>(
        LayoutPipelineService, 'Status', '', MetaData.None)
    public static readonly StagesKey = MuralBase.RegisterProperty<ObservableCollection<LayoutStageVM>>(
        LayoutPipelineService, 'Stages', undefined as unknown as ObservableCollection<LayoutStageVM>, MetaData.None)
    public static readonly InspectorKey = MuralBase.RegisterProperty<LayoutInspector>(
        LayoutPipelineService, 'Inspector', undefined as unknown as LayoutInspector, MetaData.None)
    public static readonly PresetsKey = MuralBase.RegisterProperty<ObservableCollection<LayoutPresetRef>>(
        LayoutPipelineService, 'Presets', undefined as unknown as ObservableCollection<LayoutPresetRef>, MetaData.None)
    public static readonly SelectedPresetKey = MuralBase.RegisterProperty<LayoutPresetRef | undefined>(
        LayoutPipelineService, 'SelectedPreset', undefined, MetaData.None)
    public static readonly CanDeleteKey = MuralBase.RegisterProperty<boolean>(
        LayoutPipelineService, 'CanDelete', false, MetaData.None)
    public static readonly RunCommandKey = MuralBase.RegisterProperty<ICommand>(
        LayoutPipelineService, 'RunCommand', undefined as unknown as ICommand, MetaData.None)
    // True while a preview overlay is showing — drives the Apply/Cancel buttons'
    // visibility in the preset strip.
    public static readonly PreviewActiveKey = MuralBase.RegisterProperty<boolean>(
        LayoutPipelineService, 'PreviewActive', false, MetaData.None)
    // Logical inverse of PreviewActive, kept in lock-step by the setter. Drives
    // the `Visibility` of the non-preview controls (presets, Save/Delete, Preview,
    // Run) so they collapse while a preview is being confirmed — `ToVisibility`
    // only maps truthy→Visible, so hiding on a flag needs its negation.
    public static readonly PreviewInactiveKey = MuralBase.RegisterProperty<boolean>(
        LayoutPipelineService, 'PreviewInactive', true, MetaData.None)
    public static readonly PreviewCommandKey = MuralBase.RegisterProperty<ICommand>(
        LayoutPipelineService, 'PreviewCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly ApplyPreviewCommandKey = MuralBase.RegisterProperty<ICommand>(
        LayoutPipelineService, 'ApplyPreviewCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly CancelPreviewCommandKey = MuralBase.RegisterProperty<ICommand>(
        LayoutPipelineService, 'CancelPreviewCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly SaveCommandKey = MuralBase.RegisterProperty<ICommand>(
        LayoutPipelineService, 'SaveCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly DeleteCommandKey = MuralBase.RegisterProperty<ICommand>(
        LayoutPipelineService, 'DeleteCommand', undefined as unknown as ICommand, MetaData.None)

    // Plain fields — used only from TS (not bound in markup).
    public readonly Catalog: CatalogSlot[] = GetPipelineCatalog()
    public Config: PipelineConfiguration = structuredClone(DEFAULT_CONFIG)

    // stage -> its PipelineConfiguration.layout key, for LoadPreset.
    private readonly stageKeys = new Map<LayoutStageVM, string>()
    private _presets: LayoutPresetsStore | undefined

    // True while hydrating Config from a document (or resetting to default) so
    // the stage callbacks fired by that drive don't loop back into an autosave.
    private _hydrating = false
    // Debounce timer + the document a pending autosave targets (captured at
    // schedule time so a mid-window tab switch persists to the right diagram).
    private _persistTimer: ReturnType<typeof setTimeout> | undefined
    private _persistTarget: DiagramDocument | undefined

    // The computation currently shown as a preview overlay, held so ApplyPreview
    // can commit exactly what was shown. Undefined when no preview is active.
    private _pendingPreview: { doc: DiagramDocument; comp: LayoutComputation } | undefined

    constructor(provider: IServiceProvider, private readonly persistDelayMs = 500)
    {
        super(provider)

        // The inspector panel host added to the shell's Inspector region.
        this.set_property_value(LayoutPipelineService.InspectorKey, new LayoutInspector())

        // One ComboBox row per configurable strategy slot (the transform-list
        // slot is excluded). Selecting a strategy writes its className into
        // Config.layout; "(default)" clears it (framework default applies).
        const stages = new ObservableCollection<LayoutStageVM>()
        // Captured so selecting the native side router (CardinalSideRouter)
        // in the Edge Router can disable + turn off the Port Assigner stage
        // — under native routing the diagram assigns ports itself.
        let portAssignerStage: LayoutStageVM | undefined
        for (const slot of this.Catalog)
        {
            if (slot.kind !== 'strategy-slot') continue
            const key = SLOT_CONFIG_KEY[slot.slotId]
            if (key === undefined) continue

            const isEdgeRouter = slot.slotId === 'edge-router'

            const stage = new LayoutStageVM(stageLabel(slot.slotId), slot.strategies, (spec) => {
                const layout = this.Config.layout as Record<string, unknown>
                if (spec === undefined) delete layout[key]
                else layout[key] = spec

                if (isEdgeRouter && portAssignerStage !== undefined) {
                    if (spec?.className === CARDINAL_SIDE_ROUTER) {
                        // Native routing owns port assignment: skip Fresco's
                        // port assigner and disable its combobox.
                        layout.portAssigner = { off: true }
                        portAssignerStage.Enabled = false
                    } else {
                        // Re-enable and restore the port assigner from its
                        // own current selection.
                        portAssignerStage.Enabled = true
                        portAssignerStage.Reapply()
                    }
                }

                // Every stage/param edit re-emits here — autosave the working
                // config to the active diagram (debounced; muted during hydrate).
                this.onConfigChanged()
            })
            stages.Add(stage)
            this.stageKeys.set(stage, key)
            if (slot.slotId === 'port-assigner') portAssignerStage = stage
        }
        this.set_property_value(LayoutPipelineService.StagesKey, stages)
        this.set_property_value(LayoutPipelineService.PresetsKey, new ObservableCollection<LayoutPresetRef>())

        this.set_property_value(LayoutPipelineService.RunCommandKey, new RelayCommand(() => this.Run()))
        this.set_property_value(LayoutPipelineService.PreviewCommandKey, new RelayCommand(() => this.Preview()))
        this.set_property_value(LayoutPipelineService.ApplyPreviewCommandKey, new RelayCommand(() => this.ApplyPreview()))
        this.set_property_value(LayoutPipelineService.CancelPreviewCommandKey, new RelayCommand(() => this.CancelPreview()))
        this.set_property_value(LayoutPipelineService.SaveCommandKey, new RelayCommand(() => { void this.save() }))
        this.set_property_value(LayoutPipelineService.DeleteCommandKey, new RelayCommand(() => { void this.deleteSelected() }))

        // Selecting a preset loads it (scope-aware); whatever is selected also
        // drives whether Delete is enabled.
        this.AddPropertyChangedListener(LayoutPipelineService.SelectedPresetKey, () => {
            const ref = this.SelectedPreset
            this.set_property_value(LayoutPipelineService.CanDeleteKey, ref !== undefined)
            if (ref !== undefined) void this.loadRef(ref)
        })

        // Follow the active document: hydrate the inspector from the newly
        // active diagram's saved config (or the default) and re-list its presets.
        // The fake host in unit tests has no property-change surface — guard so
        // construction there still works (and still lists global presets).
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        if (host !== undefined && typeof (host as unknown as MuralBase).AddPropertyChangedListener === 'function') {
            host.AddPropertyChangedListener(DocumentsContentHostService.ActiveDocumentKey, () => this.onActiveDocumentChanged())
            this.onActiveDocumentChanged()
        } else {
            void this.refreshPresets()
        }
    }

    public get Status(): string { return this.get_property_value(LayoutPipelineService.StatusKey) }
    private set Status(v: string) { this.set_property_value(LayoutPipelineService.StatusKey, v) }

    public get Stages(): ObservableCollection<LayoutStageVM> { return this.get_property_value(LayoutPipelineService.StagesKey) }
    public get Inspector(): LayoutInspector { return this.get_property_value(LayoutPipelineService.InspectorKey) }
    public get Presets(): ObservableCollection<LayoutPresetRef> { return this.get_property_value(LayoutPipelineService.PresetsKey) }
    public get SelectedPreset(): LayoutPresetRef | undefined { return this.get_property_value(LayoutPipelineService.SelectedPresetKey) }
    public set SelectedPreset(v: LayoutPresetRef | undefined) { this.set_property_value(LayoutPipelineService.SelectedPresetKey, v) }
    public get CanDelete(): boolean { return this.get_property_value(LayoutPipelineService.CanDeleteKey) }
    public get RunCommand(): ICommand { return this.get_property_value(LayoutPipelineService.RunCommandKey) }
    public get PreviewActive(): boolean { return this.get_property_value(LayoutPipelineService.PreviewActiveKey) }
    private set PreviewActive(v: boolean)
    {
        this.set_property_value(LayoutPipelineService.PreviewActiveKey, v)
        this.set_property_value(LayoutPipelineService.PreviewInactiveKey, !v)
    }
    public get PreviewInactive(): boolean { return this.get_property_value(LayoutPipelineService.PreviewInactiveKey) }
    public get PreviewCommand(): ICommand { return this.get_property_value(LayoutPipelineService.PreviewCommandKey) }
    public get ApplyPreviewCommand(): ICommand { return this.get_property_value(LayoutPipelineService.ApplyPreviewCommandKey) }
    public get CancelPreviewCommand(): ICommand { return this.get_property_value(LayoutPipelineService.CancelPreviewCommandKey) }
    public get SaveCommand(): ICommand { return this.get_property_value(LayoutPipelineService.SaveCommandKey) }
    public get DeleteCommand(): ICommand { return this.get_property_value(LayoutPipelineService.DeleteCommandKey) }

    // ── preset backends (one per scope) ─────────────────────────────────────

    // The global (user-data) preset store. Lazily created so a non-desktop
    // context (should not happen in the renderer) doesn't fail at construction
    // just because presets are unused.
    private get globalPresets(): LayoutPresetsStore
    {
        return (this._presets ??= new LayoutPresetsStore(this.Provider))
    }

    // The active diagram's project storage, when it is file-backed — the root
    // for project-scoped presets. Undefined for an unsaved/non-file diagram (or
    // no active diagram), in which case the Project scope is unavailable.
    private projectStorage(): IStorage | undefined
    {
        const store = this.activeDiagram()?.Storage
        return store instanceof FileDiagramStorage ? store.ProjectStorage : undefined
    }

    // A project-scoped preset store over the active diagram's project storage,
    // or undefined when there is none.
    private projectPresets(): ProjectLayoutPresetsStore | undefined
    {
        const storage = this.projectStorage()
        return storage === undefined ? undefined : new ProjectLayoutPresetsStore(storage)
    }

    // The scopes a preset can currently be saved to: Global always; Project when
    // the active diagram has project storage; Diagram when a diagram is active.
    public availableScopes(): PresetScope[]
    {
        const scopes: PresetScope[] = [PresetScope.Global]
        if (this.projectStorage() !== undefined) scopes.push(PresetScope.Project)
        if (this.activeDiagram() !== undefined) scopes.push(PresetScope.Diagram)
        return scopes
    }

    // Reload Presets from all scopes for the active diagram (ctor, active-doc
    // change, and after save/delete). Global first, then project, then diagram.
    private async refreshPresets(): Promise<void>
    {
        const refs: LayoutPresetRef[] = []
        for (const n of await this.globalPresets.names()) refs.push(new LayoutPresetRef(n, PresetScope.Global))
        const pp = this.projectPresets()
        if (pp !== undefined) for (const n of await pp.names()) refs.push(new LayoutPresetRef(n, PresetScope.Project))
        const doc = this.activeDiagram()
        if (doc !== undefined) for (const n of diagramPresetNames(doc)) refs.push(new LayoutPresetRef(n, PresetScope.Diagram))

        const coll = this.Presets
        coll.Clear()
        for (const r of refs) coll.Add(r)
    }

    // Fetch a preset's config from its own scope.
    private async getPreset(ref: LayoutPresetRef): Promise<PipelineConfiguration | undefined>
    {
        switch (ref.Scope) {
            case PresetScope.Global:  return this.globalPresets.get(ref.Name)
            case PresetScope.Project: return this.projectPresets()?.get(ref.Name)
            case PresetScope.Diagram: { const d = this.activeDiagram(); return d === undefined ? undefined : getDiagramPreset(d, ref.Name) }
        }
    }

    // Drive Config + every stage from a config: clone it into Config, then load
    // each stage from its layout entry. Stages load in insertion order (= Stages
    // order), so the Edge Router's native-routing choice disables the Port
    // Assigner before we reach it; a disabled Port Assigner is skipped so its
    // { off: true } directive (set by the Edge Router) survives.
    private applyConfig(cfg: PipelineConfiguration): void
    {
        this.Config = structuredClone(cfg)
        const layout = this.Config.layout as Record<string, LayoutStageSpec | undefined>
        for (const [stage, key] of this.stageKeys) {
            if (!stage.Enabled) continue
            stage.LoadSpec(layout[key])
        }
    }

    // Load a GLOBAL preset by name into the current settings. Retained as the
    // simple by-name entry point (used directly in tests); the scope-aware path
    // is loadRef.
    public async LoadPreset(name: string): Promise<void>
    {
        const cfg = await this.globalPresets.get(name)
        if (cfg === undefined) return
        this.applyConfig(cfg)
    }

    // Load a preset from whichever scope it lives in (the SelectedPreset path).
    private async loadRef(ref: LayoutPresetRef): Promise<void>
    {
        const cfg = await this.getPreset(ref)
        if (cfg === undefined) return
        this.applyConfig(cfg)
    }

    // Prompt for a name + scope and save the current Config as that preset, then
    // select it. A no-op when there is no DialogService (headless) or the user
    // cancels. The pre-selected scope is the selected preset's scope, else Global.
    private async save(): Promise<void>
    {
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs === undefined) return
        const initialScope = this.SelectedPreset?.Scope ?? PresetScope.Global
        const choice = await promptSavePreset(dialogs, this.SelectedPreset?.Name ?? '', this.availableScopes(), initialScope)
        if (choice === undefined) return
        const stem = await this.savePreset(choice.name, choice.scope, this.Config)
        await this.refreshPresets()
        this.SelectedPreset = this.Presets.ToArray().find((r) => r.Scope === choice.scope && r.Name === stem)
    }

    // Persist a config as a named preset in the given scope; returns the stored
    // name (sanitized for file-backed scopes). Diagram scope also saves the doc.
    private async savePreset(name: string, scope: PresetScope, cfg: PipelineConfiguration): Promise<string>
    {
        switch (scope) {
            case PresetScope.Global:
                return this.globalPresets.save(name, cfg)
            case PresetScope.Project: {
                const pp = this.projectPresets()
                return pp === undefined ? name : pp.save(name, cfg)
            }
            case PresetScope.Diagram: {
                const doc = this.activeDiagram()
                if (doc !== undefined) { saveDiagramPreset(doc, name.trim(), cfg); this.persistDocument(doc) }
                return name.trim()
            }
        }
    }

    // Delete the selected preset from its own scope and clear the selection; the
    // working Config / Stages are left as-is (deleting the saved copy does not
    // reset the editor).
    private async deleteSelected(): Promise<void>
    {
        const ref = this.SelectedPreset
        if (ref === undefined) return
        switch (ref.Scope) {
            case PresetScope.Global:  await this.globalPresets.delete(ref.Name); break
            case PresetScope.Project: await this.projectPresets()?.delete(ref.Name); break
            case PresetScope.Diagram: { const d = this.activeDiagram(); if (d !== undefined) { deleteDiagramPreset(d, ref.Name); this.persistDocument(d) } break }
        }
        await this.refreshPresets()
        this.SelectedPreset = undefined
    }

    // ── implicit per-diagram working-config persistence ─────────────────────

    // On active-document change: hydrate the inspector from the newly active
    // diagram's saved working config (or the default), and re-list its presets.
    private onActiveDocumentChanged(): void
    {
        this.clearPreview()   // a preview belongs to the diagram it was computed for
        const doc = this.activeDiagram()
        const saved = doc === undefined ? undefined : readLayoutConfig(doc)
        this._hydrating = true
        try { this.applyConfig(saved ?? DEFAULT_CONFIG) } finally { this._hydrating = false }
        void this.refreshPresets()
    }

    // A stage/param edit changed Config — autosave it to the active diagram's
    // working-config slot (debounced). Muted while hydrating so loading a
    // document doesn't immediately write back. The target doc is captured now so
    // a tab switch within the debounce window still persists to the right file.
    private onConfigChanged(): void
    {
        if (this._hydrating) return
        this.clearPreview()   // an edit invalidates the shown preview
        const doc = this.activeDiagram()
        if (doc === undefined) return
        this._persistTarget = doc
        if (this._persistTimer !== undefined) clearTimeout(this._persistTimer)
        this._persistTimer = setTimeout(() => {
            const target = this._persistTarget
            if (target === undefined) return
            writeLayoutConfig(target, this.Config)
            this.persistDocument(target)
        }, this.persistDelayMs)
    }

    // Save a document to its storage (no-op without storage), awaiting the disk
    // write when it is file-backed. Shared by working-config autosave and
    // diagram-scoped preset writes.
    private persistDocument(doc: DiagramDocument): void
    {
        doc.Save()
        const store = doc.Storage
        if (store instanceof FileDiagramStorage) void store.WhenWritten()
    }

    // Compose the pipeline from Config and run it on the active diagram, writing
    // the new positions to the figures. A direct Run supersedes any pending
    // preview.
    public Run(): void
    {
        const doc = this.activeDiagram()
        if (doc === undefined) { this.Status = 'Active document is not a diagram.'; return }
        this.CancelPreview()
        const comp = this.computeLayout(doc)
        if (comp === undefined) return
        this.applyLayout(doc, comp)
    }

    // Compose + run the pipeline WITHOUT committing, and return the computation
    // (figure index, connector edges, target positions, routing). Sets Status and
    // returns undefined when there is nothing to lay out or the pipeline errors.
    // Geometry lives on the container Figure (a shape node IS its own container; a
    // content VM's container wraps it and mirrors its Id), so this lays out the
    // CONTAINERS — nodes without a realized container are skipped.
    private computeLayout(doc: DiagramDocument): LayoutComputation | undefined
    {
        const figures = this.geometryFigures(doc)
        if (figures.length === 0) { this.Status = 'Diagram has no nodes to lay out.'; return undefined }
        const connectors = doc.Connectors.ToArray() as unknown as ConnectorLike[]
        const { graph, index, connectorEdges } = extract(figures, connectors)

        try {
            const { graphPipeline, layoutPipeline } = BuildPipeline(this.Config, LoadElementRepository())
            const transformed = graphPipeline.Apply(graph)
            // fresco's pipeline Apply now returns a LayoutResult { positions, routes }
            // (routes replaced the old `LastRoutes` side-channel on the pipeline).
            const result = layoutPipeline.Apply(transformed)
            const outcome = computeOutcome(index, transformed, result.positions, (f) => this.sizeOf(f))
            return { index, connectorEdges, outcome, lastRoutes: result.routes }
        } catch (err) {
            this.Status = `Pipeline error: ${(err as Error).message}`
            return undefined
        }
    }

    // Commit a computed layout: write positions, reset connector routing, assign
    // native sides, and persist the working config + scene.
    private applyLayout(doc: DiagramDocument, comp: LayoutComputation): void
    {
        const plan = planForMode(RunMode.Positions, comp.outcome)
        this.applyPositions(comp.index, plan.mutation.setPositions)
        this.clearConnectorWaypoints(doc)   // layout is the reset: drop user pins, rebuild routing

        let status = `Laid out ${plan.mutation.setPositions.length} nodes.`
        const n = this.applyDiagramSides(comp.connectorEdges, comp.lastRoutes)
        if (n > 0) status += ` Assigned sides to ${n} connectors.`
        this.Status = status

        // Record the config that produced this layout as the diagram's working
        // config (and persist the laid-out scene) — a deliberate apply sticks, even
        // if the user never edited a stage. Immediate (not the debounced edit
        // path) so it is deterministic. doc.Save() no-ops without storage.
        writeLayoutConfig(doc, this.Config)
        this.persistDocument(doc)
    }

    // Run the pipeline and PREVIEW the result: publish the target arrangement on
    // the live diagram's LayoutPreview (the framework overlay paints it over the
    // canvas) without moving anything. Apply/Cancel then commit or discard.
    public Preview(): void
    {
        const doc = this.activeDiagram()
        if (doc === undefined) { this.Status = 'Active document is not a diagram.'; return }
        const comp = this.computeLayout(doc)
        if (comp === undefined) return

        const nodes: LayoutPreviewNode[] = comp.outcome.setPositions.map((p) => {
            const fig = comp.index.get(p.id)
            const size = fig === undefined ? FALLBACK_SIZE : this.sizeOf(fig)
            return { id: p.id, left: p.left, top: p.top, width: size.width, height: size.height }
        })
        const ids = new Set(nodes.map((n) => n.id))
        const edges: LayoutPreviewEdge[] = comp.connectorEdges
            .filter((e) => ids.has(e.from) && ids.has(e.to))
            .map((e) => ({ from: e.from, to: e.to }))

        const view = doc.ActiveView
        if (view === undefined) { this.Status = 'Diagram view is not ready.'; return }
        view.LayoutPreview = { nodes, edges }
        this._pendingPreview = { doc, comp }
        this.PreviewActive = true
        this.Status = `Previewing ${nodes.length} nodes — Apply or Cancel.`
    }

    // Commit the currently-previewed layout, then clear the overlay.
    public ApplyPreview(): void
    {
        const pending = this._pendingPreview
        if (pending === undefined) return
        this.clearPreviewOverlay(pending.doc)
        this._pendingPreview = undefined
        this.PreviewActive = false
        this.applyLayout(pending.doc, pending.comp)
    }

    // Discard the preview without committing anything.
    public CancelPreview(): void
    {
        if (this._pendingPreview === undefined) return
        this.clearPreviewOverlay(this._pendingPreview.doc)
        this._pendingPreview = undefined
        this.PreviewActive = false
        this.Status = 'Preview cancelled.'
    }

    // Drop the overlay off the diagram (idempotent).
    private clearPreviewOverlay(doc: DiagramDocument): void
    {
        const view = doc.ActiveView
        if (view !== undefined) view.LayoutPreview = undefined
    }

    // Discard any active preview without a status change — used when the context
    // shifts underneath it (active-doc switch, config edit, direct Run).
    private clearPreview(): void
    {
        if (this._pendingPreview === undefined) return
        this.clearPreviewOverlay(this._pendingPreview.doc)
        this._pendingPreview = undefined
        this.PreviewActive = false
    }

    // Apply any `sides` routing directives the edge router produced onto the
    // connectors, keyed by node-id pair so parallel connectors share a side
    // (the diagram fans them into slots). A point-based router yields no
    // `sides` entries, so this is a no-op unless the native side router ran.
    // Returns the count of connectors assigned.
    private applyDiagramSides(
        connectorEdges: ConnectorEdge[],
        lastRoutes: Map<Edge, EdgeRouting> | undefined,
    ): number
    {
        if (lastRoutes === undefined) return 0
        const byPair = new Map<string, EdgeSideLike>()
        for (const [edge, routing] of lastRoutes) {
            if (routing.kind === 'sides') {
                byPair.set(`${edge.From}|${edge.To}`, { source: routing.source, target: routing.target })
            }
        }
        if (byPair.size === 0) return 0
        return applySides(connectorEdges, byPair)
    }

    // Layout is the single "reset to auto" operation: drop every connector's
    // waypoints (user pins included) so the route rebuilds from scratch. Without
    // this, moving nodes preserves pins (mural's per-move behaviour), leaving a
    // stale hand-route distorting the freshly laid-out diagram.
    private clearConnectorWaypoints(doc: DiagramDocument): void
    {
        for (const c of doc.Connectors.ToArray()) {
            if (c instanceof Connector) c.Waypoints = undefined
        }
    }

    // Resolve every diagram node to its geometry-owning container Figure: a shape
    // Figure is its own container; a content VM's container wraps it (and mirrors
    // its Id, so identity survives). Nodes whose container isn't realized (or
    // Groups) are skipped. Layout runs on the live, mounted diagram, so the
    // containers exist. Positions written back here land on the container; save
    // reads geometry off the container.
    private geometryFigures(doc: DiagramDocument): FigureLike[]
    {
        const view = doc.ActiveView
        const out: FigureLike[] = []
        for (const node of doc.Nodes.ToArray()) {
            const fig = node instanceof Figure ? node : view?.Generator.ContainerFromItem(node)
            if (fig instanceof Figure) out.push(fig as unknown as FigureLike)
        }
        return out
    }

    private applyPositions(index: Map<string, FigureLike>, sets: PositionSet[]): void
    {
        for (const s of sets) {
            const fig = index.get(s.id)
            if (fig === undefined) continue
            fig.Left = s.left
            fig.Top = s.top
        }
    }

    // The active tab's document when it's a diagram. In the multi-document
    // shell each diagram (architecture or standalone) opens as its OWN
    // DiagramDocument via the content host; layout must run on whichever is
    // active, not the fixed workspace singleton — same ActiveDocument source
    // the arch binding / viewpoint-scope services read.
    private activeDiagram(): DiagramDocument | undefined
    {
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        const doc = host?.ActiveDocument
        return doc instanceof DiagramDocument ? doc : undefined
    }

    // Node footprint: VM nodes (MuralBase) expose Width/Height but no RenderSize;
    // Figures expose both. nodeSize prefers Width/Height so VMs don't collapse
    // to the fallback size. See diagram-graph-adapter.nodeSize.
    private sizeOf(fig: FigureLike): NodeSize
    {
        return nodeSize(fig as unknown as SizedLike, FALLBACK_SIZE)
    }
}
