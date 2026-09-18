import { Application, ObservableCollection, RelayCommand, ServiceBase, ServiceKey, type IServiceProvider, type ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService, type IActivatable } from '@pragmatic-tech-ai/mural/framework'

import { LibraryRegistry } from './library-registry.js'
import { LibraryTreeNode, LibraryNodeKind } from './library-tree-node.js'
import { ConfirmDialogModel } from '@pragmatic-tech-ai/plexus-core/renderer/dialogs/confirm-dialog-model.js'
import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { registerArchToolboxAdapters } from '../../diagram/services/register-arch-toolbox-adapters.js'
import { TodlPresentationRegistry } from '../../diagram/services/todl-presentation-registry.js'
import { WikiService } from '../../../services/wiki/wiki-service.js'

// The Libraries capability's panel content: a TreeView of published libraries
// grouped Library -> Concept -> Class. Class leaves are draggable onto the
// architecture canvas (via the term payload on the node) and, when selected,
// drive a preview pane docked at the bottom of the panel (the class's mounted
// visual + its concept). The preview is panel-level (not per-row) because the
// tree's list rows are fixed-height and can't host tall inline content.
export class LibrariesPanelService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<LibrariesPanelService>('LibrariesPanelService')

    private readonly _roots = new ObservableCollection<LibraryTreeNode>()
    private _selectedNode: LibraryTreeNode | undefined = undefined
    private _isEmpty = false
    // True while discover() runs — bound to a loading indicator in the panel .mu.
    private _isLoading = false

    // Bottom preview pane, driven by the selected class leaf. The preview hosts
    // the selected NODE itself (Content = $PreviewData); the node carries its $Icon
    // VM + Concept, which the preview DataTemplate renders through a ContentControl +
    // TodlVisualSelector (the icon VM upgrades in place as the class compiles).
    // Driving the preview off the node — rather than off a service-level DP — is
    // deliberate: a
    // bare ContentPresenter pins its own DataContext to the content it renders, which
    // would break a service-scoped binding after the first class (the preview then
    // froze on the first selection). See [[library-preview-datacontext]].
    private _previewData: LibraryTreeNode | undefined = undefined
    private _hasPreview = false
    // Transient status line (e.g. a reveal miss). Bindable if the panel wants to
    // surface it; set by RevealTerm.
    private _status = ''

    private reloadSeq = 0
    private readonly changedListeners = new Set<() => void>()

    // Fires after every completed Reload() (install / uninstall / publish). The
    // toolbox's LibraryToolboxPages subscribe to self-reconcile instead of a
    // global toolbox rebuild being pushed at them.
    public onLibrariesChanged(cb: () => void): () => void
    {
        this.changedListeners.add(cb)
        return () => { this.changedListeners.delete(cb) }
    }

    private fireLibrariesChanged(): void { for (const l of [...this.changedListeners]) l() }

    constructor(provider: IServiceProvider)
    {
        super(provider)
        // Each leaf's EntityIconVM upgrades in place on library-discovery changes
        // (owner-driven), so the panel no longer tracks onChanged or resolves
        // templates itself.
        void this.Reload()
    }

    public get Roots(): ObservableCollection<LibraryTreeNode> { return this._roots }
    public get SelectedNode(): LibraryTreeNode | undefined { return this._selectedNode }
    // Selection drives the bottom preview pane: a Class leaf populates it with the
    // class's data + mounted template + concept; any other selection clears it.
    public set SelectedNode(v: LibraryTreeNode | undefined)
    {
        const old = this._selectedNode
        this._selectedNode = v
        this.RaisePropertyChanged('SelectedNode', old, v)
        if (v !== undefined && v.Kind === LibraryNodeKind.Class) {
            // The node's $Icon VM drives the preview through the ContentControl +
            // TodlVisualSelector, which renders + upgrades the class visual itself.
            this.setPreviewData(v)
            this.setHasPreview(true)
        } else {
            this.clearPreview()
        }
    }
    public get IsEmpty(): boolean { return this._isEmpty }
    public get IsLoading(): boolean { return this._isLoading }
    public get PreviewData(): LibraryTreeNode | undefined { return this._previewData }
    public get HasPreview(): boolean { return this._hasPreview }

    public get Status(): string { return this._status }
    public set Status(v: string) { const old = this._status; this._status = v; this.RaisePropertyChanged('Status', old, v) }

    private setIsEmpty(v: boolean): void { const old = this._isEmpty; this._isEmpty = v; this.RaisePropertyChanged('IsEmpty', old, v) }
    private setIsLoading(v: boolean): void { const old = this._isLoading; this._isLoading = v; this.RaisePropertyChanged('IsLoading', old, v) }
    private setPreviewData(v: LibraryTreeNode | undefined): void { const old = this._previewData; this._previewData = v; this.RaisePropertyChanged('PreviewData', old, v) }
    private setHasPreview(v: boolean): void { const old = this._hasPreview; this._hasPreview = v; this.RaisePropertyChanged('HasPreview', old, v) }

    public OnActivated(): void { void this.Reload() }

    // Reveal a published term as a node: expand its ancestor chain and select the
    // leaf whose TermId matches. Returns false (and sets Status) when no loaded
    // library carries it. Callers make the Libraries panel the active side pane.
    public RevealTerm(termId: string): boolean
    {
        const path = this.findLeafPath(termId)
        if (path === undefined) {
            this.Status = `"${termId}" is not in any loaded library.`
            return false
        }
        // Expand every ancestor (all but the leaf); the tree's ItemContainerStyle
        // mirrors IsExpanded onto the TreeViewItem containers.
        for (let i = 0; i < path.length - 1; i++) path[i].IsExpanded = true
        this.SelectedNode = path[path.length - 1]
        return true
    }

    // Depth-first [library, concept-group, …, leaf] whose leaf's TermId === termId,
    // or undefined if none.
    private findLeafPath(termId: string): LibraryTreeNode[] | undefined
    {
        const walk = (node: LibraryTreeNode, trail: LibraryTreeNode[]): LibraryTreeNode[] | undefined => {
            const here = [...trail, node]
            if (node.TermId === termId) return here
            for (const child of node.Children) {
                const hit = walk(child, here)
                if (hit !== undefined) return hit
            }
            return undefined
        }
        for (const root of this.Roots) {
            const hit = walk(root, [])
            if (hit !== undefined) return hit
        }
        return undefined
    }

    // Uninstall a library after a confirm, then reload so its row disappears. When
    // no DialogService is registered (headless), skips the confirm and proceeds.
    private async deleteLibrary(node: LibraryTreeNode): Promise<void>
    {
        const registry = this.Provider.get(LibraryRegistry.Key)
        if (registry === undefined) return
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs !== undefined) {
            const vm = new ConfirmDialogModel(
                `Delete library "${node.Name}"? This removes it from your installed libraries.`,
                'Delete', (r) => dialogs.Close(r))
            const ok = await dialogs.Show<boolean>({ Title: 'Delete Library', Content: vm, Width: 420 })
            if (ok !== true) return
        }
        await registry.delete(node.LibId, node.LibVersion)
        await this.Reload()
    }

    public async Reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const registry = this.Provider.get(LibraryRegistry.Key)
        const roots = this.Roots
        if (registry === undefined) {
            roots.Clear()
            this.setIsEmpty(true)
            this.setIsLoading(false)
            return
        }
        this.setIsLoading(true)
        // Each class leaf carries an EntityIconVM resolved against the presentation
        // registry (the preview's $Icon). Ensure the adapters (which get-or-create
        // the registry) are registered up front so a leaf built below can resolve it.
        const services = (Application.current?.Services ?? this.Provider) as ServiceProvider
        registerArchToolboxAdapters(services)
        const presentation = services.getRequired(TodlPresentationRegistry.Key)
        // Cheap metadata discovery only — the tree is built from library metadata;
        // visual compilation is eager in the presentation sources (done by discover()
        // below), not deferred to preview/canvas.
        const libs = await registry.discover()
        if (seq !== this.reloadSeq) return

        roots.Clear()
        this.clearPreview()
        const leaves: LibraryTreeNode[] = []
        for (const lib of libs) {
            const libNode = LibraryTreeNode.library(`${lib.name}  ·  ${lib.version}`, lib.id, lib.version)
            libNode.DeleteCommand = new RelayCommand(() => void this.deleteLibrary(libNode))
            const byConcept = new Map<string, LibraryTreeNode>()
            const sorted = [...lib.classes].sort((x, y) => (x.label ?? x.localId ?? x.id).localeCompare(y.label ?? y.localId ?? y.id))
            for (const cls of sorted) {
                let conceptNode = byConcept.get(cls.concept)
                if (conceptNode === undefined) { conceptNode = LibraryTreeNode.group(cls.concept, LibraryNodeKind.Concept); byConcept.set(cls.concept, conceptNode) }
                const display = cls.label ?? cls.localId ?? cls.id
                const leaf = LibraryTreeNode.leaf(
                    { display, label: cls.label ?? '', localId: cls.localId ?? '', termId: cls.id, concept: cls.concept },
                    presentation,
                )
                conceptNode.Children.Add(leaf)
                leaves.push(leaf)
            }
            for (const conceptName of [...byConcept.keys()].sort()) libNode.Children.Add(byConcept.get(conceptName)!)
            roots.Add(libNode)
        }
        this.setIsEmpty(roots.Count === 0)
        this.setIsLoading(false)
        this.markWiki(leaves)

        // Refresh the shared visual aggregate so the panel's preview (and any open
        // canvas) reflects installs/uninstalls even when the toolbox/canvas hasn't
        // been the trigger. (Adapters were registered up front, above, so the leaf
        // icon VMs could resolve the registry.)
        if (services.get(StorageService.Key) !== undefined) {
            await presentation.discover()
        }

        // A newer Reload may have superseded this one across the awaits; only the
        // latest announces the change so subscribers reconcile once.
        if (seq === this.reloadSeq) this.fireLibrariesChanged()
    }

    // Asynchronously flag which class leaves have an openable wiki page (→ their
    // "Open Wiki" menu shows). Concept resolution routes through the declaring
    // open meta-model; a stale-item guard drops a resolve onto a rebuilt node.
    private markWiki(nodes: readonly LibraryTreeNode[]): void
    {
        const wiki = this.Provider.get(WikiService.Key)
        if (wiki === undefined) return
        for (const n of nodes) {
            if (n.Kind !== LibraryNodeKind.Class) continue
            const concept = n.Concept
            if (concept.length === 0) continue
            void wiki.hasWiki(concept).then((h) => { if (n.Concept === concept) n.HasWiki = h })
        }
    }

    private clearPreview(): void
    {
        this.setPreviewData(undefined)
        this.setHasPreview(false)
    }
}
