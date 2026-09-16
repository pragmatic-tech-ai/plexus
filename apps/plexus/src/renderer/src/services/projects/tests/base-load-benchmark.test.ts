/// <reference types="node" />
import { test, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { check, checkAgainst, toJSON, type TodlDocument } from '@pragmatic-tech-ai/todl'

// Opt-in CPU benchmark for the VALIDATION base-resolution path. Not a correctness
// test — it quantifies the renderer-side cost of loading a library as a base so we
// can decide what to move off the main thread. Runs only when PLEXUS_BENCH is set:
//   PLEXUS_BENCH=1 npx vitest run src/renderer/src/services/projects/tests/base-load-benchmark.test.ts
//
// It isolates the four CPU phases the base/validation path pays in the renderer
// (IPC latency + stdio transfer are NOT measured here — those need the live app):
//   compile   — checkAgainst(meta, [librarySource])  → the open-sibling producer
//               path (WorkspaceBaseResolver.resolveOne → compileToDocument).
//   stringify — toJSON + JSON.stringify of the library model.json (publish + the
//               size that later crosses stdio to the TODL server).
//   parse     — JSON.parse of that model.json (base-resolver.read / resolveOne
//               published fallback — paid on every project attach).
//   validate  — checkAgainst([meta, lib], [instanceSource]) → the inline factory
//               validation (library-project-factory / meta-model / arch-instance).
const RUN = process.env.PLEXUS_BENCH === '1'

const META = `namespace ea {
  concept Technology { label : string; }
  concept Component { label : string; realisedBy : Technology?; deployedTo : Technology[]; }
}`

// A library = one taxonomy of N `technology` terms under `stack`.
function librarySource(n: number): string {
    const terms: string[] = []
    for (let i = 0; i < n; i++) terms.push(`  technology t${i} { label = "Tech ${i}"; }`)
    return `namespace ms { taxonomy Stack : represents Technology {\n${terms.join('\n')}\n} }`
}

// An architecture project referencing a spread of the library's terms.
function instanceSource(n: number): string {
    const comps: string[] = []
    for (let i = 0; i < n; i++) comps.push(`  component c${i} { label = "C${i}"; realisedBy = stack.t${i % Math.max(1, n)}; }`)
    return `namespace app {\n${comps.join('\n')}\n}`
}

function ms(fn: () => void): number {
    const t0 = performance.now()
    fn()
    return performance.now() - t0
}

test.skipIf(!RUN)('base-load CPU profile across library sizes', () => {
    const metaDoc = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const sizes = [100, 500, 1000, 2000]
    const rows: Array<Record<string, string>> = []

    for (const n of sizes) {
        const libSrc = librarySource(n)
        const instSrc = instanceSource(Math.min(n, 200))   // realistic project: ~200 components

        let libDoc!: TodlDocument
        const tCompile = ms(() => { libDoc = toJSON(checkAgainst([metaDoc], [{ uri: 'ms.todl', text: libSrc }]).model) })

        let json!: string
        const tStringify = ms(() => { json = JSON.stringify(libDoc) })

        let parsed!: TodlDocument
        const tParse = ms(() => { parsed = JSON.parse(json) as TodlDocument })

        const tValidate = ms(() => { checkAgainst([metaDoc, parsed], [{ uri: 'app.todl', text: instSrc }]) })

        rows.push({
            terms: String(n),
            'model.json KB': (json.length / 1024).toFixed(0),
            'compile ms': tCompile.toFixed(1),
            'stringify ms': tStringify.toFixed(1),
            'parse ms': tParse.toFixed(1),
            'validate ms': tValidate.toFixed(1),
        })
        expect(Number.isFinite(tCompile + tStringify + tParse + tValidate)).toBe(true)
    }

    const cols = ['terms', 'model.json KB', 'compile ms', 'stringify ms', 'parse ms', 'validate ms']
    const header = cols.map((c) => c.padStart(14)).join(' | ')
    const lines = rows.map((r) => cols.map((c) => r[c]!.padStart(14)).join(' | '))
    const table = '=== base-load CPU profile (renderer, no IPC/stdio) ===\n' + header + '\n' + lines.join('\n')
    const out = process.env.PLEXUS_BENCH_OUT
    if (out !== undefined) writeFileSync(out, table + '\n')
    // eslint-disable-next-line no-console
    console.log('\n' + table + '\n')
})
