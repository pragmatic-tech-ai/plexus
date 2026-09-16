import { test, expect, beforeAll } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { StreamMessageReader, StreamMessageWriter, createMessageConnection } from 'vscode-jsonrpc/node'

// Build the vendored bundle once, then exercise it as a plain Node child over
// stdio (no Electron needed — the bundle is transport-agnostic). This is the
// packaging-risk gate: it proves the entry, its bundled deps, and the LSP
// handshake all work in the shipped artifact.
beforeAll(() => { execFileSync('node', ['scripts/build-todl-server.mjs'], { stdio: 'inherit' }) }, 60_000)

test('the vendored bundle answers initialize over stdio', async () => {
  const child = spawn('node', ['out/main/todl-language-server.cjs'], { stdio: ['pipe', 'pipe', 'inherit'] })
  const conn = createMessageConnection(new StreamMessageReader(child.stdout!), new StreamMessageWriter(child.stdin!))
  conn.listen()
  const res = (await conn.sendRequest('initialize', {
    processId: null, rootUri: null, capabilities: {}, initializationOptions: { mode: 'pushed' },
  })) as { capabilities: { hoverProvider?: boolean; renameProvider?: unknown } }
  expect(res.capabilities.hoverProvider).toBe(true)
  expect(res.capabilities.renameProvider).toBeTruthy()
  conn.dispose()
  child.kill()
})
