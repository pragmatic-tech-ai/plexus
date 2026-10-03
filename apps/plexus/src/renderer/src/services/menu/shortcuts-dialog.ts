import { MuralBase, Observable } from '@pragmatic-tech-ai/mural/runtime'

// One row of the Keyboard Shortcuts dialog: a key gesture plus what it does.
// Plain Observable (default VM base) — it is a list ITEM rendered by its own
// nested DataTemplate (ItemsControl resolves per-item templates the same way
// ContentPresenter does, by constructor identity, not by MuralBase), never
// handed to DialogService as dialog Content itself, so it carries none of
// AboutDialogVm/ShortcutsDialogVm's MuralBase constraint.
export class ShortcutEntry extends Observable
{
    private readonly _gesture: string
    private readonly _description: string

    public constructor(gesture: string, description: string)
    {
        super()
        this._gesture = gesture
        this._description = description
    }

    public get Gesture(): string { return this._gesture }
    public get Description(): string { return this._description }
}

// Shortcuts-dialog body: a hand-maintained, static list of the app's real
// keyboard shortcuts. Read-only — no commands, no mutable state, the list
// never changes after construction.
//
// Extends MuralBase (not the usual default, Observable) for the same reason
// as AboutDialogVm: DialogService.Show({ Content }) requires the Content
// root to be a MuralBase | Visual.
export class ShortcutsDialogVm extends MuralBase
{
    private static readonly SaveGesture = 'Ctrl/⌘+S'
    private static readonly SaveDescription = 'Save'
    private static readonly SaveAllGesture = 'Ctrl/⌘+Shift+S'
    private static readonly SaveAllDescription = 'Save All'
    private static readonly CloseGesture = 'Ctrl/⌘+W'
    private static readonly CloseDescription = 'Close'
    private static readonly ZoomInGesture = 'Ctrl/⌘+='
    private static readonly ZoomInDescription = 'Zoom In'
    private static readonly ZoomOutGesture = 'Ctrl/⌘+−'
    private static readonly ZoomOutDescription = 'Zoom Out'
    private static readonly ResetZoomGesture = 'Ctrl/⌘+0'
    private static readonly ResetZoomDescription = 'Reset Zoom'
    private static readonly RenameGesture = 'F2'
    private static readonly RenameDescription = 'Rename'
    private static readonly CopyGesture = 'Ctrl+C'
    private static readonly CopyDescription = 'Copy (diagram)'
    private static readonly CutGesture = 'Ctrl+X'
    private static readonly CutDescription = 'Cut (diagram)'
    private static readonly PasteGesture = 'Ctrl+V'
    private static readonly PasteDescription = 'Paste (diagram)'
    private static readonly DeleteGesture = 'Delete'
    private static readonly DeleteDescription = 'Delete (diagram)'

    private static readonly StaticEntries: readonly ShortcutEntry[] = [
        new ShortcutEntry(ShortcutsDialogVm.SaveGesture, ShortcutsDialogVm.SaveDescription),
        new ShortcutEntry(ShortcutsDialogVm.SaveAllGesture, ShortcutsDialogVm.SaveAllDescription),
        new ShortcutEntry(ShortcutsDialogVm.CloseGesture, ShortcutsDialogVm.CloseDescription),
        new ShortcutEntry(ShortcutsDialogVm.ZoomInGesture, ShortcutsDialogVm.ZoomInDescription),
        new ShortcutEntry(ShortcutsDialogVm.ZoomOutGesture, ShortcutsDialogVm.ZoomOutDescription),
        new ShortcutEntry(ShortcutsDialogVm.ResetZoomGesture, ShortcutsDialogVm.ResetZoomDescription),
        new ShortcutEntry(ShortcutsDialogVm.RenameGesture, ShortcutsDialogVm.RenameDescription),
        new ShortcutEntry(ShortcutsDialogVm.CopyGesture, ShortcutsDialogVm.CopyDescription),
        new ShortcutEntry(ShortcutsDialogVm.CutGesture, ShortcutsDialogVm.CutDescription),
        new ShortcutEntry(ShortcutsDialogVm.PasteGesture, ShortcutsDialogVm.PasteDescription),
        new ShortcutEntry(ShortcutsDialogVm.DeleteGesture, ShortcutsDialogVm.DeleteDescription),
    ]

    public get Entries(): readonly ShortcutEntry[] { return ShortcutsDialogVm.StaticEntries }
}

export default ShortcutsDialogVm
