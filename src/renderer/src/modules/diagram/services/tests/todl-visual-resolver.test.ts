import { describe, it, expect, afterEach } from 'vitest'
import { Border, Icon, TextBlock } from '@pragmatic-tech-ai/mural/basic'
import { HorizontalAlignment, VerticalAlignment } from '@pragmatic-tech-ai/mural/visual-engine'
import { VisualContext, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import type { Visual } from '@pragmatic-tech-ai/mural/runtime'

import type { TodlPresentationRegistry } from '../todl-presentation-registry.js'
import { TodlVisualResolver, TodlVisualResolverKey } from '../todl-visual-resolver.js'
import { setIconResourceResolver } from '../icon-key-converter.js'

afterEach(() => setIconResourceResolver(undefined))

function hasType(v: Visual, ctor: Function): boolean {
    if (v instanceof ctor) return true
    for (const c of [...v.logicalChildren, ...v.visualChildren]) if (hasType(c, ctor)) return true
    return false
}

function findFirst<T extends Visual>(v: Visual, ctor: Function): T | undefined {
    if (v instanceof ctor) return v as T
    for (const c of [...v.logicalChildren, ...v.visualChildren]) {
        const hit = findFirst<T>(c, ctor)
        if (hit !== undefined) return hit
    }
    return undefined
}

function desc(key: string): ToolboxVisualDescriptor {
    return new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
}

// A registry stub exposing iconKeyFor + onChanged (the resolver's surface).
function fakeRegistry() {
    const listeners = new Set<(key: string) => void>()
    const index = new Map<string, string>([['mm:service', 'mm_icon_svc']])
    const asset = (k: string) => (k === 'mm_icon_svc' ? { ViewBoxWidth: 24, ViewBoxHeight: 24, Shapes: [] } : undefined)
    return {
        index,
        resolve: asset,
        resolveAsset: asset,
        iconKeyFor: (k: string) => index.get(k),
        onChanged: (cb: (key: string) => void) => { listeners.add(cb); return () => listeners.delete(cb) },
        fire(key: string) { for (const l of listeners) l(key) },
        listenerCount() { return listeners.size },
    }
}

describe('TodlVisualResolver', () => {
    it('exports a stable ServiceKey', () => {
        expect(TodlVisualResolverKey).toBeDefined()
    })

    it('resolves a known entity through the default template (a Border with an Icon), Tile → IsHitTestVisible=false', () => {
        const reg = fakeRegistry()
        setIconResourceResolver(reg.resolve)
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const tile = r.Resolve(desc('mm:service'), VisualContext.Tile) as Border
        expect(tile).toBeInstanceOf(Border)
        expect(hasType(tile, Icon)).toBe(true)
        expect(hasType(tile, TextBlock)).toBe(false)   // figure only; host draws caption
        expect(tile.IsHitTestVisible).toBe(false)
    })

    it('stretches the Figure-context icon to fill its container (no explicit size)', () => {
        const reg = fakeRegistry()
        setIconResourceResolver(reg.resolve)
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const fig = r.Resolve(desc('mm:service'), VisualContext.Figure) as Border
        const icon = findFirst<Icon>(fig, Icon)
        expect(icon).toBeDefined()
        // The shared icon body no longer carries an explicit width/height — the icon
        // stretches to fill its Grid cell so the outer ContentControl sizes it per
        // context (see visual-library ICON_BODY; the P3 markup owns the size).
        expect(icon!.HorizontalAlignment).toBe(HorizontalAlignment.Stretch)
        expect(icon!.VerticalAlignment).toBe(VerticalAlignment.Stretch)
    })

    it('does NOT force IsHitTestVisible=false in Figure context', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const fig = r.Resolve(desc('mm:service'), VisualContext.Figure) as Border
        expect(fig.IsHitTestVisible).not.toBe(false)
    })

    it('falls back to the mm: keyspace for a bare meta-model term id (arch canvas nodes)', () => {
        const reg = fakeRegistry()
        setIconResourceResolver(reg.resolve)
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        // A canvas node carries the bare term id 'service'; the index keys the
        // meta-model term as 'mm:service' — the resolver's mm: fallback finds it.
        const tile = r.Resolve(desc('service'), VisualContext.Tile) as Border
        expect(tile).toBeInstanceOf(Border)
        expect(hasType(tile, Icon)).toBe(true)
    })

    it('an entity with no indexed icon still renders the default template (default glyph, no label)', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const tile = r.Resolve(desc('unknown'), VisualContext.Tile)
        expect(tile).toBeInstanceOf(Border)
        expect(hasType(tile, TextBlock)).toBe(false)
    })

    it('bridges registry.onChanged: AddChangedListener delivers fired keys to the cb', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const seen: string[] = []
        const cb = (k: string) => seen.push(k)
        r.AddChangedListener(cb)
        reg.fire('mm:service')
        expect(seen).toEqual(['mm:service'])
    })

    it('RemoveChangedListener unsubscribes the cb', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const cb = (_k: string) => {}
        r.AddChangedListener(cb)
        r.RemoveChangedListener(cb)
        expect(reg.listenerCount()).toBe(0)
    })

    it('AddChangedListener is idempotent: registering the same cb twice subscribes once', () => {
        const reg = fakeRegistry()
        const r = new TodlVisualResolver(reg as unknown as TodlPresentationRegistry)
        const cb = (_k: string) => {}
        r.AddChangedListener(cb)
        r.AddChangedListener(cb)
        expect(reg.listenerCount()).toBe(1)
    })
})
