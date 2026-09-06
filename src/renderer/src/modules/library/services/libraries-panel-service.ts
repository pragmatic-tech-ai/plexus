import { Application, MetaData, MuralBase, ObservableCollection, RelayCommand, ServiceBase, ServiceKey, type IServiceProvider, type PropertyDescriptor, type ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService, type IActivatable } from '@pragmatic-tech-ai/mural/framework'

import { LibraryRegistry } from './library-registry.js'
import { LibraryTreeNode, LibraryNodeKind } from './library-tree-node.js'
import { ConfirmDialogModel } from '../../../services/dialogs/confirm-dialog-model.js'
import { StorageProviderRegistry } from '../../../services/storage/storage-provider-registry.js'
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

    public static readonly RootsKey = MuralBase.RegisterProperty<ObservableCollection<LibraryTreeNode>>(
        LibrariesPanelService, 'Roots', undefined as unknown as ObservableCollection<LibraryTreeNode>, MetaData.None)
    public static readonly SelectedNodeKey = MuralBase.RegisterProperty<LibraryTreeNode | undefined>(
        LibrariesPanelService, 'SelectedNode', undefined, MetaData.None)
    public static readonly IsEmptyKey = MuralBase.RegisterProperty<boolean>(LibrariesPanelService, 'IsEmpty', false, MetaData.None)
    // True while discover() runs — bound to a loading indicator in the panel .mu.
    public static readonly IsLoadingKey = MuralBase.RegisterProperty<boolean>(LibrariesPanelService, 'IsLoading', false, MetaData.None)

    // Bottom preview pane, driven by the selected class leaf. The preview hosts
    // the selected NODE itself (Content = $PreviewData); the node carries its visual
    // Descriptor + Concept, which the preview DataTemplate renders through the shared
    // ToolboxVisualPresenter (which owns the lazy-compile upgrade). Driving the
    // preview off the node — rather than off a service-level DP — is deliberate: a
    // bare ContentPresenter pins its own DataContext to the content it renders, which
    // would break a service-scoped binding after the first class (the preview then
    // froze on the first selection). See [[library-preview-datacontext]].
    public static readonly PreviewDataKey = MuralBase.RegisterProperty<LibraryTreeNode | undefined>(
        LibrariesPanelService, 'PreviewData', undefined, MetaData.None)
    public static readonly HasPreviewKey = MuralBase.RegisterProperty<boolean>(LibrariesPanelService, 'HasPreview', false, MetaData.None)
    // Transient status line (e.g. a reveal miss). Bindable if the panel wants to
    // surface it; set by RevealTerm.
    public static readonly StatusKey = MuralBase.RegisterProperty<string>(LibrariesPanelService, 'Status', '', MetaData.None)

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
        this.set_property_value(LibrariesPanelService.RootsKey, new ObservableCollection<LibraryTreeNode>())
        // The preview's ToolboxVisualPresenter owns the lazy-compile upgrade (it
        // subscribes to the library resolver's changed signal), so the panel no
        // longer tracks onChanged or resolves templates itself.
        void this.Reload()
    }

    public get Roots(): ObservableCollection<LibraryTreeNode> { return this.get_property_value(LibrariesPanelService.RootsKey) }
    public get SelectedNode(): LibraryTreeNode | undefined { return this.get_property_value(LibrariesPanelService.SelectedNodeKey) }
    public set SelectedNode(v: LibraryTreeNode | undefined) { this.set_property_value(LibrariesPanelService.SelectedNodeKey, v) }
    public get IsEmpty(): boolean { return this.get_property_value(LibrariesPanelService.IsEmptyKey) }
    public get IsLoading(): boolean { return this.get_property_value(LibrariesPanelService.IsLoadingKey) }
    public get PreviewData(): LibraryTreeNode | undefined { return this.get_property_value(LibrariesPanelService.PreviewDataKey) }
    public get HasPreview(): boolean { return this.get_property_value(LibrariesPanelService.HasPreviewKey) }

    public get Status(): string { return this.get_property_value(LibrariesPanelService.StatusKey) }
    public set Status(v: string) { this.set_property_value(LibrariesPanelService.StatusKey, v) }

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
            this.set_property_value(LibrariesPanelService.IsEmptyKey, true)
            this.set_property_value(LibrariesPanelService.IsLoadingKey, false)
            return
        }
        this.set_property_value(LibrariesPanelService.IsLoadingKey, true)
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
                )
                conceptNode.Children.Add(leaf)
                leaves.push(leaf)
            }
            for (const conceptName of [...byConcept.keys()].sort()) libNode.Children.Add(byConcept.get(conceptName)!)
            roots.Add(libNode)
        }
        this.set_property_value(LibrariesPanelService.IsEmptyKey, roots.Count === 0)
        this.set_property_value(LibrariesPanelService.IsLoadingKey, false)
        this.markWiki(leaves)

        // Refresh the shared visual aggregate so the panel's preview (and any open
        // canvas) reflects installs/uninstalls even when the toolbox/canvas hasn't
        // been the trigger.
        const services = (Application.current?.Services ?? this.Provider) as ServiceProvider
        if (services.get(StorageProviderRegistry.Key) !== undefined) {
            registerArchToolboxAdapters(services)
            await services.get(TodlPresentationRegistry.Key)?.discover()
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

    // Selection drives the bottom preview pane: a Class leaf populates it with the
    // class's data + mounted template + concept; any other selection clears it.
    protected override OnPropertyChanged(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        if (descriptor.Name !== 'SelectedNode') return
        const node = newValue instanceof LibraryTreeNode ? newValue : undefined
        if (node !== undefined && node.Kind === LibraryNodeKind.Class) {
            // The node's Descriptor drives the preview through ToolboxVisualPresenter,
            // which resolves + upgrades the class visual itself.
            this.set_property_value(LibrariesPanelService.PreviewDataKey, node)
            this.set_property_value(LibrariesPanelService.HasPreviewKey, true)
        } else {
            this.clearPreview()
        }
    }

    private clearPreview(): void
    {
        this.set_property_value(LibrariesPanelService.PreviewDataKey, undefined)
        this.set_property_value(LibrariesPanelService.HasPreviewKey, false)
    }
}
