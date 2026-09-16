import { describe, test, expect } from 'vitest'
import { attachSaveShortcuts } from '../save-shortcuts.js'

// A minimal ICommand — only CanExecute/Execute matter here; the
// CanExecuteChanged listeners are inert no-ops to satisfy the interface.
function fakeCommand(execute: () => void) {
    return {
        CanExecute: () => true,
        Execute: execute,
        AddCanExecuteChangedListener: () => {},
        RemoveCanExecuteChangedListener: () => {},
    }
}

function fakeHost() {
    const calls = { save: 0, saveAll: 0, close: 0 }
    return {
        calls,
        SaveActiveCommand:  fakeCommand(() => { calls.save++ }),
        SaveAllCommand:     fakeCommand(() => { calls.saveAll++ }),
        CloseActiveCommand: fakeCommand(() => { calls.close++ }),
    }
}

// Minimal EventTarget capturing the capture-phase keydown listener.
function fakeWindow() {
    let handler: ((e: KeyboardEvent) => void) | undefined
    return {
        addEventListener: (t: string, h: (e: KeyboardEvent) => void, opts?: unknown) => {
            if (t === 'keydown' && (opts as { capture?: boolean })?.capture) handler = h
        },
        removeEventListener: () => { handler = undefined },
        fire: (init: Partial<KeyboardEvent>) => {
            let defaulted = false
            handler?.({ key: 'a', ctrlKey: false, metaKey: false, shiftKey: false,
                        preventDefault: () => { defaulted = true }, stopPropagation: () => {}, ...init } as KeyboardEvent)
            return defaulted
        },
    }
}

describe('attachSaveShortcuts', () => {
    test('Ctrl+S saves the active document and prevents default', () => {
        const host = fakeHost(); const win = fakeWindow()
        attachSaveShortcuts(host, win as unknown as Window)
        const prevented = win.fire({ key: 's', ctrlKey: true })
        expect(host.calls.save).toBe(1)
        expect(host.calls.saveAll).toBe(0)
        expect(prevented).toBe(true)
    })

    test('Ctrl+Shift+S saves all', () => {
        const host = fakeHost(); const win = fakeWindow()
        attachSaveShortcuts(host, win as unknown as Window)
        win.fire({ key: 's', ctrlKey: true, shiftKey: true })
        expect(host.calls.saveAll).toBe(1)
        expect(host.calls.save).toBe(0)
    })

    test('Ctrl+W closes the active document and prevents default', () => {
        const host = fakeHost(); const win = fakeWindow()
        attachSaveShortcuts(host, win as unknown as Window)
        const prevented = win.fire({ key: 'w', ctrlKey: true })
        expect(host.calls.close).toBe(1)
        expect(host.calls.save).toBe(0)
        expect(prevented).toBe(true)
    })

    test('an unrelated chord does nothing and is not prevented', () => {
        const host = fakeHost(); const win = fakeWindow()
        attachSaveShortcuts(host, win as unknown as Window)
        const prevented = win.fire({ key: 'a', ctrlKey: true })
        expect(host.calls.save).toBe(0)
        expect(host.calls.saveAll).toBe(0)
        expect(prevented).toBe(false)
    })

    test('detach removes the listener', () => {
        const host = fakeHost(); const win = fakeWindow()
        const detach = attachSaveShortcuts(host, win as unknown as Window)
        detach()
        win.fire({ key: 's', ctrlKey: true })
        expect(host.calls.save).toBe(0)
    })
})
