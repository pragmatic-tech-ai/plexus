import { test, expect, afterEach } from 'vitest'
import { Application, ResourceDictionary, ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import type { PresentationContribution, PresentationSource } from '../todl-presentation-registry.js'
import { TodlPresentationRegistry } from '../todl-presentation-registry.js'
import { setIconResourceResolver } from '../icon-key-converter.js'

afterEach(() => setIconResourceResolver(undefined))   // discover() bridges the converter; reset between tests

// Build a contribution: icon assets (resource key → value) + an entityKey → resource-key index.
function contribution(assets: [string, unknown][], keys: [string, string][]): PresentationContribution {
    const dict = new ResourceDictionary()
    for (const [k, v] of assets) dict.Set(k, v)
    return { assets: dict, iconKeys: new Map(keys) }
}

const src = (id: string, assets: [string, unknown][], keys: [string, string][]): PresentationSource => ({
    id,
    load: async () => contribution(assets, keys),
})

test('after discover, iconKeyFor maps entity → resource key and resolveAsset resolves it; unknown → undefined', async () => {
    const registry = new TodlPresentationRegistry(new ServiceProvider())
    registry.registerSource(src('a', [['r1', { tag: 'g1' }]], [['e1', 'r1']]))
    registry.registerSource(src('b', [['r2', { tag: 'g2' }]], [['mm:e2', 'r2']]))

    await registry.discover()

    expect(registry.iconKeyFor('e1')).toBe('r1')
    expect(registry.iconKeyFor('mm:e2')).toBe('r2')
    expect(registry.resolveAsset('r1')).toEqual({ tag: 'g1' })
    expect(registry.iconKeyFor('nope')).toBeUndefined()
    expect(registry.resolveAsset('nope')).toBeUndefined()
})

test('onChanged fires once per indexed entity key after discover', async () => {
    const registry = new TodlPresentationRegistry(new ServiceProvider())
    registry.registerSource(src('a', [['r1', {}], ['r2', {}]], [['e1', 'r1'], ['e2', 'r2']]))
    registry.registerSource(src('b', [['r3', {}]], [['e3', 'r3']]))

    const fired: string[] = []
    registry.onChanged((key) => fired.push(key))
    await registry.discover()

    expect(fired).toContain('e1')
    expect(fired).toContain('e2')
    expect(fired).toContain('e3')
    expect(fired).toHaveLength(3)
})

test('an entity key declared by two sources notifies exactly once per discover', async () => {
    const registry = new TodlPresentationRegistry(new ServiceProvider())
    registry.registerSource(src('a', [['ra', {}]], [['shared', 'ra'], ['onlyA', 'ra']]))
    registry.registerSource(src('b', [['rb', {}]], [['shared', 'rb']]))

    const fired: string[] = []
    registry.onChanged((key) => fired.push(key))
    await registry.discover()

    expect(fired.filter((k) => k === 'shared').length).toBe(1)
    expect(fired.filter((k) => k === 'onlyA').length).toBe(1)
    expect(fired).toHaveLength(2)
})

test('registerSource is idempotent by id — last registration wins', async () => {
    const registry = new TodlPresentationRegistry(new ServiceProvider())
    registry.registerSource(src('a', [['r1', {}]], [['e1', 'r1']]))
    registry.registerSource(src('a', [['r1b', {}]], [['e1', 'r1b']]))

    const fired: string[] = []
    registry.onChanged((key) => fired.push(key))
    await registry.discover()

    expect(registry.iconKeyFor('e1')).toBe('r1b')
    expect(fired.filter((k) => k === 'e1').length).toBe(1)
})

test('onChanged returns an unsubscribe function that stops further notifications', async () => {
    const registry = new TodlPresentationRegistry(new ServiceProvider())
    registry.registerSource(src('a', [['r1', {}]], [['e1', 'r1']]))

    const fired: string[] = []
    const unsub = registry.onChanged((key) => fired.push(key))
    await registry.discover()
    expect(fired).toContain('e1')

    unsub()
    fired.length = 0
    await registry.discover()
    expect(fired).toHaveLength(0)
})

test('a second discover re-runs sources and swaps — new index resolves correctly', async () => {
    const registry = new TodlPresentationRegistry(new ServiceProvider())
    let version = 0
    registry.registerSource({
        id: 'dynamic',
        load: async () => { version++; return contribution([['r', {}]], [['e1', version === 1 ? 'rv1' : 'rv2']]) },
    })

    await registry.discover()
    expect(registry.iconKeyFor('e1')).toBe('rv1')

    await registry.discover()
    expect(registry.iconKeyFor('e1')).toBe('rv2')
})

test('a re-discover notifies only keys whose icon mapping changed (added or remapped)', async () => {
    const registry = new TodlPresentationRegistry(new ServiceProvider())
    registry.registerSource(src('s', [['r1', {}], ['r2', {}]], [['a', 'r1'], ['b', 'r2']]))
    await registry.discover()

    const fired: string[] = []
    registry.onChanged((k) => fired.push(k))
    // a unchanged (r1), b remapped (r2 → r3), c new (r4)
    registry.registerSource(src('s', [['r1', {}], ['r3', {}], ['r4', {}]], [['a', 'r1'], ['b', 'r3'], ['c', 'r4']]))
    await registry.discover()

    expect(fired.sort()).toEqual(['b', 'c'])   // 'a' unchanged → not fired
})

test('a re-discover notifies a removed key so its presenter falls back to the default glyph', async () => {
    const registry = new TodlPresentationRegistry(new ServiceProvider())
    registry.registerSource(src('s', [['r1', {}], ['r2', {}]], [['a', 'r1'], ['b', 'r2']]))
    await registry.discover()

    const fired: string[] = []
    registry.onChanged((k) => fired.push(k))
    registry.registerSource(src('s', [['r1', {}]], [['a', 'r1']]))   // b removed from the index
    await registry.discover()

    expect(fired).toEqual(['b'])
})

test('populating N assets fires O(1) app-resource notifications, not one per key', async () => {
    const prior = Application.current
    try {
        const app = new Application()
        Application.current = app

        const registry = new TodlPresentationRegistry(new ServiceProvider())
        const N = 10
        const assets: [string, unknown][] = Array.from({ length: N }, (_, i) => [`r${i}`, {}])
        registry.registerSource(src('big', assets, [['e', 'r0']]))

        let general = 0, style = 0
        app.Resources.Subscribe(() => { general++ })
        app.Resources.SubscribeStyle(() => { style++ })

        await registry.discover()
        expect(general).toBeLessThan(N)   // one swap, not one per key

        const afterFirst = general
        const afterFirstStyle = style

        await registry.discover()
        expect(general - afterFirst).toBe(1)
        expect(style - afterFirstStyle).toBe(1)
    } finally {
        Application.current = prior
    }
})
