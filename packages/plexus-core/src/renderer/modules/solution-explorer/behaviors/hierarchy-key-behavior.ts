import { Behavior, Key, type KeyEventArgs, Visual } from '@pragmatic-tech-ai/mural/runtime'

// The keyboard half of the Solution Explorer's editing UX, ported from the retired
// project-tree key handler and retargeted to the HierarchyTreeVM + HierarchyHost. It
// attaches to the TreeView (or its wrapper), whose DataContext is the capability service
// (the host, which also exposes Tree). KeyDown is a bubbling routed event, so listening
// on the wrapper catches it from the focused row:
//   * F2      → Anchor.BeginEdit()
//   * Return  → Anchor.CommitEdit()   (only while editing)
//   * Escape  → Anchor.CancelEdit()   (only while editing)
//   * Delete  → host.Delete(anchor) ONCE (the host deletes the whole selection under one
//              confirm); inert while a rename editor is open
interface HierarchyEditable
{
    BeginEdit(): void
    CommitEdit(): void
    CancelEdit(): void
    readonly IsEditing: boolean
}

interface HierarchyKeyTarget
{
    readonly Tree?: { readonly Anchor?: HierarchyEditable; readonly Selection: { ToArray(): readonly unknown[] } }
    Delete(vm: unknown): void
}

export class HierarchyKeyBehavior extends Behavior
{
    private _visual: Visual | undefined
    private _onKey: ((args: unknown) => void) | undefined

    // Structural narrowing of a DataContext to the key target (the capability host).
    private static asKeyTarget(dc: unknown): HierarchyKeyTarget | undefined
    {
        const t = dc as Partial<HierarchyKeyTarget> | undefined
        return t !== undefined && typeof t.Delete === 'function' ? (t as HierarchyKeyTarget) : undefined
    }

    public override OnAttached(visual: Visual): void
    {
        this._visual = visual
        const onKey = (args: unknown): void =>
        {
            const target = HierarchyKeyBehavior.asKeyTarget(this._visual?.DataContext)
            if (target === undefined) return
            const k = args as KeyEventArgs
            const anchor = target.Tree?.Anchor
            switch (k.Key)
            {
                case Key.F2:
                    if (anchor !== undefined) { anchor.BeginEdit(); k.Handled = true }
                    return
                case Key.Return:
                    if (anchor?.IsEditing === true) { anchor.CommitEdit(); k.Handled = true }
                    return
                case Key.Escape:
                    if (anchor?.IsEditing === true) { anchor.CancelEdit(); k.Handled = true }
                    return
                case Key.Delete:
                {
                    if (anchor?.IsEditing === true) return   // Delete edits text while renaming
                    // One call: the host deletes the whole selection (the anchor is part of
                    // it) under a single confirm — same choke point as the menu Delete.
                    if (anchor !== undefined) { target.Delete(anchor); k.Handled = true }
                    return
                }
                default:
                    return
            }
        }
        this._onKey = onKey
        visual.AddRoutedEventListener('KeyDown', onKey)
    }

    public override OnDetached(visual: Visual): void
    {
        if (this._onKey !== undefined) visual.RemoveRoutedEventListener('KeyDown', this._onKey)
        this._onKey = undefined
        this._visual = undefined
    }
}

export default HierarchyKeyBehavior
