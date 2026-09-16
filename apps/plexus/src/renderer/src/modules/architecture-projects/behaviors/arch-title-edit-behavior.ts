import { Behavior, Key, type KeyEventArgs, Visual } from '@pragmatic-tech-ai/mural/runtime'

// ArchTitleEditBehavior — the commit/cancel half of an arch node's in-place
// title edit (the focus/select half is FocusOnVisibleBehavior). Attaches to the
// editor's wrapper Border in the ArchNodeVM DataTemplate; its DataContext is the
// ArchNodeVM. It translates the editor's keyboard + focus events into the VM's
// edit lifecycle:
//   * Enter      → CommitEdit (single-line TextBox leaves Return unhandled, so
//                  it bubbles up to this Border)
//   * Escape     → CancelEdit
//   * LostFocus  → CommitEdit (click-away, matching Visio / the ShapeText editor)
//
// KeyDown and LostFocus are bubbling routed events, so listening on the wrapper
// Border catches them from the focused TextBox child. CommitEdit / CancelEdit are
// idempotent (guarded on IsEditing), so the LostFocus that fires when an Enter /
// Escape collapses the editor is a harmless no-op.
//
// MVVM's third leg: it reads VIEW events a view-model can't and drives VM method
// calls; it holds only view-transient listener handles (no domain state).
interface TitleEditable
{
    CommitEdit(): void
    CancelEdit(): void
}

function asEditable(dc: unknown): TitleEditable | undefined
{
    const e = dc as Partial<TitleEditable> | undefined
    return e !== undefined && typeof e.CommitEdit === 'function' && typeof e.CancelEdit === 'function'
        ? (e as TitleEditable)
        : undefined
}

export class ArchTitleEditBehavior extends Behavior
{
    private _visual:   Visual | undefined
    private _onKey:    ((args: unknown) => void) | undefined
    private _onBlur:   ((args: unknown) => void) | undefined

    public override OnAttached(visual: Visual): void
    {
        this._visual = visual

        const onKey = (args: unknown): void =>
        {
            const vm = asEditable(this._visual?.DataContext)
            if (vm === undefined) return
            const k = args as KeyEventArgs
            if (k.Key === Key.Return) { vm.CommitEdit(); k.Handled = true }
            else if (k.Key === Key.Escape) { vm.CancelEdit(); k.Handled = true }
        }
        const onBlur = (): void => { asEditable(this._visual?.DataContext)?.CommitEdit() }

        this._onKey  = onKey
        this._onBlur = onBlur
        visual.AddRoutedEventListener('KeyDown', onKey)
        visual.AddRoutedEventListener('LostFocus', onBlur)
    }

    public override OnDetached(visual: Visual): void
    {
        if (this._onKey  !== undefined) visual.RemoveRoutedEventListener('KeyDown', this._onKey)
        if (this._onBlur !== undefined) visual.RemoveRoutedEventListener('LostFocus', this._onBlur)
        this._onKey  = undefined
        this._onBlur = undefined
        this._visual = undefined
    }
}

export default ArchTitleEditBehavior
