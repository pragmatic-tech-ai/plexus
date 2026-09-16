// Bundle the TODL language server into a single self-contained CJS file so the
// forked child needs nothing from node_modules at runtime (vendored, decoupled
// from the registry version). The entry is TODL's own canonical stdio bin
// (dist/language-server/stdio.js) — the same path whether @pragmatic-tech-ai/todl is
// npm-linked for dev or installed from the registry — bundled with its own deps
// (vscode-languageserver, the compiler, the language-service). Only Node
// built-ins stay external.
import { build } from 'esbuild'
import { builtinModules } from 'node:module'
import { existsSync } from 'node:fs'

// Probe app-local then hoisted workspace-root node_modules — under npm
// workspaces @pragmatic-tech-ai/todl is hoisted to the repo root.
const REL = '@pragmatic-tech-ai/todl/dist/language-server/stdio.js'
const ENTRY = [`node_modules/${REL}`, `../../node_modules/${REL}`].find((p) => existsSync(p))

if (ENTRY === undefined) {
  console.error(
    `\n[build-todl-server] Missing ${REL} in app or workspace-root node_modules.\n` +
    `The TODL language server must be available: publish @pragmatic-tech-ai/todl (>=0.3.0, ` +
    `with dist built) to the registry and reinstall, or 'npm run build' in the TODL ` +
    `checkout and 'npm link @pragmatic-tech-ai/todl' here.\n`,
  )
  process.exit(1)
}

await build({
  entryPoints: [ENTRY],
  outfile: 'out/main/todl-language-server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
})
console.log('built out/main/todl-language-server.cjs')
