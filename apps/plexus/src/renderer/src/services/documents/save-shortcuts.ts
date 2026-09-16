import type { ICommand } from '@pragmatic-tech-ai/mural/runtime'

// The bits of the document host the shortcuts drive.
interface SaveCommands {
    readonly SaveActiveCommand: ICommand
    readonly SaveAllCommand: ICommand
    // Closes the active document THROUGH the close guard (prompts if dirty). Bound
    // to Ctrl+W. Supplied by the caller (main.js) since the host's own
    // CloseDocumentCommand is keyed by document id, not "the active one".
    readonly CloseActiveCommand: ICommand
}

// Wire Ctrl+S (Save active) / Ctrl+Shift+S (Save All) at the window, CAPTURE
// phase. Capture is deliberate: it fires before Monaco's own handlers AND before
// the code-editor host's key-swallow boundary, so Ctrl+S works even while the
// editor is focused — the case that matters most. Cmd (metaKey) is accepted too
// for parity. Only these two chords are intercepted (everything else passes
// through untouched); a chord fires only when its command CanExecute, so nothing
// is swallowed when there is nothing to save. Returns a detach thunk.
export function attachSaveShortcuts(
    host: SaveCommands,
    target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
    const onKeyDown = (e: KeyboardEvent): void => {
        const mod = e.ctrlKey || e.metaKey
        if (!mod) return
        const key = e.key.toLowerCase()
        if (key === 'w') {
            if (!host.CloseActiveCommand.CanExecute(undefined)) return
            e.preventDefault()
            e.stopPropagation()
            host.CloseActiveCommand.Execute(undefined)
            return
        }
        if (key !== 's') return
        const command = e.shiftKey ? host.SaveAllCommand : host.SaveActiveCommand
        if (!command.CanExecute(undefined)) return
        e.preventDefault()
        e.stopPropagation()
        command.Execute(undefined)
    }
    target.addEventListener('keydown', onKeyDown, { capture: true })
    return () => target.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions)
}
