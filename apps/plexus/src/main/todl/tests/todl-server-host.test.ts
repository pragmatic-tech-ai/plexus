import { test, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import { StreamMessageWriter } from 'vscode-jsonrpc/node'
import { TodlServerHost, type ChildLike } from '../todl-server-host.js'
import { TodlLspChannel } from '../../../shared/todl-lsp-api.js'

function fakeChild(): { child: ChildLike; toRenderer: PassThrough; fromRenderer: PassThrough; exit: () => void } {
  const toRenderer = new PassThrough() // acts as child stdout
  const fromRenderer = new PassThrough() // acts as child stdin
  let exitCb: (() => void) | undefined
  return {
    child: { stdout: toRenderer, stdin: fromRenderer, on: (_e, cb) => { exitCb = cb }, kill: () => {} },
    toRenderer, fromRenderer, exit: () => exitCb?.(),
  }
}

test('frames child stdout messages and emits them to the renderer', async () => {
  const f = fakeChild()
  const emitted: Array<{ ch: string; msg: unknown }> = []
  const host = new TodlServerHost(() => f.child, (ch, msg) => emitted.push({ ch, msg }))
  host.start()
  void new StreamMessageWriter(f.toRenderer).write({ jsonrpc: '2.0', method: 'x', params: { a: 1 } } as never)
  await new Promise((r) => setTimeout(r, 20))
  expect(emitted.some((e) => e.ch === TodlLspChannel.FromServer && (e.msg as { method: string }).method === 'x')).toBe(true)
})

test('forwards renderer messages to the child stdin', async () => {
  const f = fakeChild()
  const host = new TodlServerHost(() => f.child, () => {})
  host.start()
  const received: string[] = []
  f.fromRenderer.on('data', (chunk: Buffer) => received.push(chunk.toString('utf8')))
  host.send({ jsonrpc: '2.0', method: 'y', params: {} })
  await new Promise((r) => setTimeout(r, 20))
  expect(received.join('')).toContain('"method":"y"')
})

test('restarts the child on exit and signals the renderer', async () => {
  let spawns = 0
  const f = fakeChild()
  const emitted: string[] = []
  const host = new TodlServerHost(() => { spawns++; return f.child }, (ch) => emitted.push(ch))
  host.start()
  f.exit()
  await new Promise((r) => setTimeout(r, 20))
  expect(spawns).toBe(2)
  expect(emitted).toContain(TodlLspChannel.ServerRestart)
})

test('does not restart after dispose', async () => {
  let spawns = 0
  const f = fakeChild()
  const host = new TodlServerHost(() => { spawns++; return f.child }, () => {})
  host.start()
  host.dispose()
  f.exit()
  await new Promise((r) => setTimeout(r, 20))
  expect(spawns).toBe(1)
})
