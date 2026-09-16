import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { removeSplash, type SplashDocument, type SplashElement } from '../splash.js'

// A hand-rolled DOM double so this stays a pure node test (vitest env is 'node',
// no jsdom). It records the transitionend handler and whether remove() ran.
function makeEl(): SplashElement & { removed: boolean; fireTransitionEnd: () => void } {
    let handler: (() => void) | null = null
    return {
        style: { transition: '', opacity: '1', pointerEvents: 'auto' },
        removed: false,
        addEventListener(_type, cb) { handler = cb },
        remove() { this.removed = true },
        fireTransitionEnd() { handler?.() },
    }
}

function makeDoc(el: SplashElement | null): SplashDocument {
    return { getElementById: () => el }
}

describe('removeSplash', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('fades the overlay out (opacity 0 + transition) and stops taking input', () => {
        const el = makeEl()
        removeSplash(makeDoc(el), 200)
        expect(el.style.opacity).toBe('0')
        expect(el.style.transition).toContain('200ms')
        expect(el.style.pointerEvents).toBe('none')
    })

    it('removes the overlay from the DOM when the fade transition ends', () => {
        const el = makeEl()
        removeSplash(makeDoc(el), 200)
        expect(el.removed).toBe(false)
        el.fireTransitionEnd()
        expect(el.removed).toBe(true)
    })

    it('removes the overlay via the fallback timer even if transitionend never fires', () => {
        const el = makeEl()
        removeSplash(makeDoc(el), 200)
        expect(el.removed).toBe(false)
        vi.advanceTimersByTime(200 + 60)
        expect(el.removed).toBe(true)
    })

    it('only removes once even if both the transition and the fallback fire', () => {
        const el = makeEl()
        const spy = vi.spyOn(el, 'remove')
        removeSplash(makeDoc(el), 200)
        el.fireTransitionEnd()
        vi.advanceTimersByTime(1000)
        expect(spy).toHaveBeenCalledTimes(1)
    })

    it('is a no-op when there is no splash element', () => {
        expect(() => removeSplash(makeDoc(null), 200)).not.toThrow()
    })
})
