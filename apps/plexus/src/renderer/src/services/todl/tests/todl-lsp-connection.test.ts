import { test, expect } from 'vitest'
import { createTodlLspConnection } from '../todl-lsp-connection.js'
import type { ITodlLspApi } from '../../../../../shared/todl-lsp-api.js'

// Two bridges cross-wired: whatever A sends, B's onMessage subscribers receive,
// and vice-versa — a stand-in for the main-process relay between two peers.
function loopback(): [ITodlLspApi, ITodlLspApi] {
  const cbs: Array<Array<(m: unknown) => void>> = [[], []]
  const make = (self: 0 | 1): ITodlLspApi => ({
    send: (m) => { for (const cb of cbs[1 - self]!) cb(m) },
    onMessage: (cb) => { cbs[self]!.push(cb); return () => {} },
    onServerRestart: () => () => {},
  })
  return [make(0), make(1)]
}

test('a request over the pipe reaches the peer and returns a response', async () => {
  const [a, b] = loopback()
  const ca = createTodlLspConnection(a)
  const cb = createTodlLspConnection(b)
  cb.onRequest('ping', (p: { n: number }) => ({ n: p.n + 1 }))
  const res = (await ca.sendRequest('ping', { n: 41 })) as { n: number }
  expect(res.n).toBe(42)
})

test('a notification over the pipe reaches the peer', async () => {
  const [a, b] = loopback()
  const ca = createTodlLspConnection(a)
  const cb = createTodlLspConnection(b)
  // Await the handler firing rather than a fixed delay — delivery is async.
  const received = new Promise<unknown>((resolve) => cb.onNotification('note', (p: unknown) => resolve(p)))
  await ca.sendNotification('note', { hi: true })
  expect(await received).toEqual({ hi: true })
})
