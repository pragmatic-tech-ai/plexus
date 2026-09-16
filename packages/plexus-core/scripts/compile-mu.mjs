// Compile plexus-core's shared .mu → .mu.js via the mural CLI. Resolves the CLI
// by probing candidate node_modules (package-local, then the hoisted workspace
// root), so it works regardless of npm-workspace hoisting.
import { execFileSync } from 'node:child_process'
import { globSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLI_REL = '@pragmatic-tech-ai/mural/dist/tooling/cli.js'
const cli = [
    new URL(`../node_modules/${CLI_REL}`, import.meta.url),       // packages/plexus-core/node_modules
    new URL(`../../../node_modules/${CLI_REL}`, import.meta.url),  // workspace root node_modules
].map(fileURLToPath).find(existsSync)
if (cli === undefined) {
    console.error('[compile-mu] cannot find mural CLI')
    process.exit(1)
}
const files = globSync('src/**/*.mu')
if (files.length === 0) {
    console.warn('[compile-mu] no .mu files under src/')
    process.exit(0)
}
execFileSync(process.execPath, [cli, 'compile', ...files], { stdio: 'inherit' })
