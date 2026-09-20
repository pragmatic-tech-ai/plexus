import { test, expect } from 'vitest'
import { removeSplash, type SplashDocument, type SplashElement } from '../splash.js'

function fakeSplash(): {
    el: SplashElement
    doc: SplashDocument
    removed: () => boolean
    fireTransitionEnd: () => void
}
{
    let removed = false
    let transitionEndCb: (() => void) | undefined
    const el: SplashElement = {
        style: { transition: '', opacity: '', pointerEvents: '' },
        addEventListener: (_t, cb) => { transitionEndCb = cb },
        remove: () => { removed = true },
    }
    const doc: SplashDocument = { getElementById: (id) => (id === 'splash' ? el : null) }
    return { el, doc, removed: () => removed, fireTransitionEnd: () => transitionEndCb?.() }
}

test('removeSplash fades the overlay out and disables its pointer events', () => {
    const f = fakeSplash()
    removeSplash(f.doc, 200)
    expect(f.el.style.opacity).toBe('0')
    expect(f.el.style.pointerEvents).toBe('none')
    expect(f.el.style.transition).toContain('200ms')
})

test('removeSplash removes the element on transitionend', () => {
    const f = fakeSplash()
    removeSplash(f.doc, 200)
    expect(f.removed()).toBe(false)
    f.fireTransitionEnd()
    expect(f.removed()).toBe(true)
})

test('removeSplash is a no-op when there is no splash element', () => {
    const doc: SplashDocument = { getElementById: () => null }
    expect(() => removeSplash(doc)).not.toThrow()
})
