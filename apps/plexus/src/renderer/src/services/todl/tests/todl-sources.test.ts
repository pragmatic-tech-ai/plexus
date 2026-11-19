import { test, expect } from 'vitest'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { collectTaxonomySources, collectTodlSources } from '../todl-sources.js'

test('collectTodlSources skips build-output / vendor top-level dirs (build, dist, node_modules, .git)', async () => {
    // Reproduces the LSP crash: a meta-model with a local publish-staging `build/`
    // (and `dist/`) holds a COMPILED copy of `concepts/`, so walking it as source
    // re-declares every concept node → `checkAgainst` throws `node "…" already exists`.
    const s = new FakeStorage('fake://mm')
    await s.WriteText('concepts/actor.todl', 'namespace tech_architecture { concept actor {} }')
    await s.WriteText('build/npm-package/src/concepts/actor.todl', 'dup')
    await s.WriteText('dist/concepts/actor.todl', 'dup')
    await s.WriteText('node_modules/dep/x.todl', 'dep')
    await s.WriteText('.git/hooks/x.todl', 'vcs')

    const uris = (await collectTodlSources(s)).map((f) => f.uri).sort()
    expect(uris).toEqual(['concepts/actor.todl'])
})

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
