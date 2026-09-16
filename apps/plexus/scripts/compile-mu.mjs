// Compile every .mu under src/ to a sibling .mu.js via the mural CLI.
// Resolves the CLI through the package's package.json (hoist-proof: under npm
// workspaces mural lives in the ROOT node_modules, not this app's), so it works
// regardless of where the dependency is installed. .mu compilation is per-file
// and order-independent (each emits its own .mu.js; app.mu just emits imports of
// the others), so a glob over src is equivalent to the old explicit list.
import { execFileSync } from 'node:child_process'
import { globSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// mural's package "exports" don't expose package.json, so resolve the CLI by
// probing candidate node_modules locations: app-local first, then the hoisted
// workspace root. Robust to npm-workspace hoisting and to the exports map.
const CLI_REL = '@pragmatic-tech-ai/mural/dist/tooling/cli.js'
const candidates = [
    new URL(`../node_modules/${CLI_REL}`, import.meta.url),      // apps/plexus/node_modules
    new URL(`../../../node_modules/${CLI_REL}`, import.meta.url), // workspace root node_modules
].map(fileURLToPath)
const cli = candidates.find((p) => existsSync(p))
if (cli === undefined) {
    console.error('[compile-mu] cannot find mural CLI in:', candidates)
    process.exit(1)
}
const files = globSync('src/**/*.mu')
if (files.length === 0) {
    console.warn('[compile-mu] no .mu files found under src/')
    process.exit(0)
}
execFileSync(process.execPath, [cli, 'compile', ...files], { stdio: 'inherit' })
