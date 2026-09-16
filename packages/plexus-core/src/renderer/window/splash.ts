// Boot splash removal. The static #splash overlay (index.html) paints instantly
// with the document — a branded loading screen that covers the bundle-eval +
// mural-mount gap so the user never sees the bare white #app. Once the shell has
// painted its first frame the bootstrap calls removeSplash() to fade it out.
//
// Kept as a tiny helper over a minimal injected document so the fade/remove
// timing is unit-testable in the plain-'node' vitest env (no jsdom): the
// renderer passes the real `document`; tests pass a hand-rolled double.

export interface SplashElement {
    style: { transition: string; opacity: string; pointerEvents: string }
    addEventListener(type: 'transitionend', cb: () => void, opts?: { once?: boolean }): void
    remove(): void
}

export interface SplashDocument {
    getElementById(id: string): SplashElement | null
}

export function removeSplash(doc: SplashDocument = document, fadeMs = 240): void {
    const el = doc.getElementById('splash')
    if (!el) return

    let done = false
    const finish = (): void => {
        if (done) return
        done = true
        el.remove()
    }

    el.style.transition = `opacity ${fadeMs}ms ease`
    el.style.opacity = '0'
    // Stop the fading overlay from swallowing clicks meant for the app beneath it.
    el.style.pointerEvents = 'none'
    el.addEventListener('transitionend', finish, { once: true })
    // Fallback: transitionend can miss (element already detached, reduced-motion,
    // display quirks). Remove after the fade window elapses regardless.
    setTimeout(finish, fadeMs + 60)
}
