import { test, expect } from 'vitest'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { collectTaxonomySources } from '../todl-sources.js'

test('collects every .todl except those under excluded top-level folders', async () => {
    const s = new FakeStorage('fake://lib')
    await s.WriteText('microsoft.todl', 'a')
    await s.WriteText('sub/more.todl', 'b')
    await s.WriteText('samples/demo.todl', 'c')          // excluded by default
    await s.WriteText('assets/logo.svg', '<svg/>')       // not a .todl

    const uris = (await collectTaxonomySources(s)).map((f) => f.uri).sort()
    expect(uris).toEqual(['microsoft.todl', 'sub/more.todl'])
})

test('a custom excludeDirs list overrides the default', async () => {
    const s = new FakeStorage('fake://lib')
    await s.WriteText('samples/demo.todl', 'c')
    await s.WriteText('scratch/x.todl', 'd')

    const uris = (await collectTaxonomySources(s, ['scratch'])).map((f) => f.uri).sort()
    expect(uris).toEqual(['samples/demo.todl'])   // samples now included; scratch excluded
})
