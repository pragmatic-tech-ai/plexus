import { MetaData, MuralBase, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramDocument, DialogService, type CommandDefinition, type DiagramStorage, type Diagram } from '@pragmatic-tech-ai/mural/framework'
import { DiagramCommandExtensionKey } from './diagram-command-extension.js'
import { FileDiagramStorage } from '../persistence/file-diagram-storage.js'
import { attachMediaDrop, attachMediaPaste, type MediaDropDeps } from '../media/media-drop-handler.js'
import { makeLargeFilePrompt } from '../media/prompt-large-file.js'

// The `.diagram` document used across Plexus: a DiagramDocument that additionally
// routes app-contributed toolbar commands. When the shell dispatches a command
// this document doesn't natively run, it consults the registered
// IDiagramCommandExtension (see DiagramCommandExtensionKey) before deferring to
// the base document. Behaves exactly like DiagramDocument when no extension owns
// the command — so standalone (non-architecture) diagrams are unaffected.
export class PlexusDiagramDocument extends DiagramDocument
{
    // The node the user right-clicked, published so the shared diagram context
    // menu (which opens with THIS document as its DataContext — the diagram surface
    // captures the pointer, so a node's own attached menu never opens) can bind
    // node-specific items through it: `$ContextTargetNode.HasNavTargets`,
    // `…GoToComponentCommand`, `…HasWiki`, etc. Set by ArchDiagramBinding's
    // right-click hit-test just before the menu opens; undefined on empty canvas.
    // Typed as the INPC root (not ArchNodeVM) to keep the diagram module from
    // depending on architecture-projects; bindings resolve the facet by name.
    public static readonly ContextTargetNodeKey = MuralBase.RegisterProperty<MuralBase | undefined>(
        PlexusDiagramDocument, 'ContextTargetNode', undefined, MetaData.None)
    public get ContextTargetNode(): MuralBase | undefined { return this.get_property_value(PlexusDiagramDocument.ContextTargetNodeKey) }
    public set ContextTargetNode(v: MuralBase | undefined) { this.set_property_value(PlexusDiagramDocument.ContextTargetNodeKey, v) }

    private _wiredView: Diagram | undefined
    private _detachMediaDrop: (() => void) | undefined
    private _detachMediaPaste: (() => void) | undefined

    public constructor(storage: DiagramStorage, private readonly provider: IServiceProvider)
    {
        super(storage)
        // Wire OS media drop (files / links) whenever the diagram view mounts.
        // General to every .diagram — not just architecture projects.
        this.AddPropertyChangedListener(DiagramDocument.ActiveViewKey, this._onActiveViewChanged)
    }

    private readonly _onActiveViewChanged = (): void => {
        const view = this.ActiveView
        if (view === this._wiredView) return
        this._detachMediaDrop?.()
        this._detachMediaPaste?.()
        this._detachMediaDrop = undefined
        this._detachMediaPaste = undefined
        this._wiredView = view
        if (view === undefined) return
        const deps = this._mediaDropDeps()
        if (deps !== undefined) {
            this._detachMediaDrop = attachMediaDrop(view, this, deps)
            this._detachMediaPaste = attachMediaPaste(view, this, deps)
        }
    }

    private _mediaDropDeps(): MediaDropDeps | undefined
    {
        const store = this.Storage
        if (!(store instanceof FileDiagramStorage)) return undefined
        return {
            storage: store.ProjectStorage,
            promptLargeFile: makeLargeFilePrompt(this.provider.get(DialogService.Key)),
            newId: () => `media-${crypto.randomUUID()}`,
        }
    }

    public override Execute(definition: CommandDefinition): void
    {
        const ext = this.provider.get(DiagramCommandExtensionKey)
        if (ext !== undefined && ext.handles(definition.Id)) { ext.execute(this, definition.Id); return }
        super.Execute(definition)
    }

    public override CanExecute(definition: CommandDefinition): boolean
    {
        const ext = this.provider.get(DiagramCommandExtensionKey)
        if (ext !== undefined && ext.handles(definition.Id)) return ext.canExecute(this, definition.Id)
        return super.CanExecute(definition)
    }
}
